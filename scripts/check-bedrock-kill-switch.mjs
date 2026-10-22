#!/usr/bin/env node
// Bedrock kill-switch coverage guard.
//
// VENDORED, BYTE-IDENTICAL, INTO FIVE REPOSITORIES. There is no shared package in this fleet; every
// repo is standalone. The siblings of this file live at `scripts/check-bedrock-kill-switch.mjs` in:
//
//   bridge-api  connections-api  food-api  lull-api  sse-api
//
// Keep the five copies byte-identical so that drift shows up in a plain `diff`/`md5sum` across the
// checkouts. Fix a bug here and copy the whole file to the other four in the same change; do not
// hand-patch one copy.
//
// WHY THIS EXISTS. The Bedrock kill switch works by flipping the default version of the
// `kill-switch-bedrock-<env>` managed policy to a document that denies `bedrock:*`. It can only stop
// a function whose role has that policy ATTACHED. A new Bedrock-capable function added without the
// ARN is a silent hole: nothing fails, nothing alerts, and the switch simply does not stop it. This
// guard makes coverage a property of CI rather than of someone remembering.
//
// TWO HALVES, AND THE SECOND IS THE ONE THAT MATTERS.
//
//   (a) TEMPLATE HALF — every `bedrock:` action in a function's `Policies:` implies that function
//       also carries the kill-switch policy ARN.
//
//   (b) SOURCE HALF — every function whose handler transitively imports a module that constructs a
//       `BedrockRuntimeClient` or one of the Bedrock runtime commands must carry BOTH a `bedrock:`
//       grant AND the ARN.
//
// A template-only guard cannot catch the defect this exists for. `food-api`'s `RecipesFunction`
// called Bedrock in code for months with no `bedrock:` statement in its template, while carrying a
// hand-written `Version: '2012-10-17'` policy block for an unrelated `lambda:InvokeFunction` — which
// reads at a glance like a function whose permissions were deliberately worked out. A template-only
// check passes that shape clean, every time. Half (b) is what sees it.
//
// The source half follows the IMPORT GRAPH, not call sites. `food-api` wraps its client in
// `src/data/bedrock.ts` and exports `default { send }`, so a grep for SDK symbols at the call site
// would report zero Bedrock callers there.
//
// Usage:  node scripts/check-bedrock-kill-switch.mjs [--template template.yaml] [--verbose]
// Exit 0 when every Bedrock-capable function is covered, 1 otherwise.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

// The ARN is built with !Sub in every repo, so this matches the unresolved template string. Keyed on
// the policy path rather than the full ARN so a partition or account change does not blind the guard.
const KILL_SWITCH_POLICY = /:policy\/kill-switch-bedrock-/

const FUNCTION_TYPE = 'AWS::Serverless::Function'

// Constructing any of these is the marker for "this module can spend Bedrock money". Type-only use
// does not count, which is why the construction regex requires `new`.
const BEDROCK_SYMBOLS = [
  'BedrockRuntimeClient',
  'ConverseCommand',
  'ConverseStreamCommand',
  'InvokeModelCommand',
  'InvokeModelWithResponseStreamCommand',
]

const BEDROCK_SDK_PACKAGE = '@aws-sdk/client-bedrock-runtime'

// Tried in order against a relative import specifier, TypeScript-resolution style.
const MODULE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
]

// ---------------------------------------------------------------------------------------------
// A deliberately small YAML reader
//
// Enough of the YAML block subset to read a SAM template: block maps, block sequences, inline
// sequences and maps, quoted and plain scalars, block scalars (skipped), comments, and the four CFN
// tags these templates use. No anchors, no aliases, no multi-document streams -- none of the five
// templates has any, and the guard reports rather than guesses if that changes.
//
// A real YAML parser is not an option: adding a dependency to five Lambda repos to run one CI check
// is a worse trade than 150 lines that only ever read templates this repo owns.
// ---------------------------------------------------------------------------------------------

const CFN_TAGS = ['!Sub', '!Ref', '!GetAtt', '!FindInMap', '!Join', '!Select', '!Split', '!If', '!Equals', '!Not']

const countIndent = (line) => line.length - line.trimStart().length

// Strips a trailing `# comment`, respecting quoted scalars. Only a `#` that starts a token is a
// comment in YAML, which is what keeps `arn:...#fragment` intact.
const stripYamlComment = (text) => {
  let quote = null
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quote) {
      if (char === quote) {
        quote = null
      }
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (char === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd()
    }
  }
  return text.trimEnd()
}

// Block scalar headers look like `key: |`, `key: >-`, `- |2`.
const isBlockScalarHeader = (content) => /(^|[\s:])[|>][-+]?\d*$/.test(content)

const tokenize = (text) => {
  const lines = text.split('\n')
  const tokens = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue
    }
    if (line.includes('\t')) {
      throw new Error(`Tab character in template at line ${i + 1}; this reader only handles space indentation.`)
    }
    const indent = countIndent(line)
    const content = stripYamlComment(line.slice(indent))
    if (content === '') {
      continue
    }
    if (/(^|\s)[&*][A-Za-z_]/.test(content)) {
      throw new Error(
        `YAML anchor or alias at line ${i + 1}; this reader cannot resolve one. Extend it or drop the anchor.`,
      )
    }
    tokens.push({ content, indent, line: i + 1 })
    if (isBlockScalarHeader(content)) {
      // Swallow the block scalar body. Its text is never something this guard inspects.
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || countIndent(lines[i + 1]) > indent)) {
        i += 1
      }
    }
  }
  return tokens
}

const unquote = (text) => {
  if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") {
    return text.slice(1, -1).replace(/''/g, "'")
  }
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
    return text.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return text
}

// Splits `key: value` at the first colon that terminates a key. Returns null when the text is not a
// mapping entry, which is how `- 'bedrock:Invoke*'` and `!Sub 'arn:...'` stay scalars.
const splitMappingEntry = (content) => {
  if (content.startsWith('!')) {
    return null
  }
  if (content[0] === "'" || content[0] === '"') {
    const quote = content[0]
    let end = -1
    for (let i = 1; i < content.length; i += 1) {
      if (content[i] === quote) {
        if (quote === "'" && content[i + 1] === "'") {
          i += 1
          continue
        }
        end = i
        break
      }
    }
    if (end === -1 || content[end + 1] !== ':') {
      return null
    }
    return { key: unquote(content.slice(0, end + 1)), rest: content.slice(end + 2).trim() }
  }
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === ':' && (i + 1 === content.length || content[i + 1] === ' ')) {
      return { key: content.slice(0, i).trim(), rest: content.slice(i + 1).trim() }
    }
  }
  return null
}

const splitFlowItems = (body) => {
  const items = []
  let depth = 0
  let quote = null
  let start = 0
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]
    if (quote) {
      if (char === quote) {
        quote = null
      }
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (char === '[' || char === '{') {
      depth += 1
    } else if (char === ']' || char === '}') {
      depth -= 1
    } else if (char === ',' && depth === 0) {
      items.push(body.slice(start, i))
      start = i + 1
    }
  }
  items.push(body.slice(start))
  return items.map((item) => item.trim()).filter((item) => item !== '')
}

const parseScalar = (text) => {
  const trimmed = text.trim()
  if (trimmed === '') {
    return null
  }
  for (const tag of CFN_TAGS) {
    if (trimmed === tag || trimmed.startsWith(`${tag} `)) {
      return { tag: tag.slice(1), value: parseScalar(trimmed.slice(tag.length)) }
    }
  }
  if (trimmed.startsWith('!')) {
    // An unrecognized CFN tag. Keep the payload so ARN matching still sees the string.
    const space = trimmed.indexOf(' ')
    return space === -1
      ? { tag: trimmed.slice(1), value: null }
      : { tag: trimmed.slice(1, space), value: parseScalar(trimmed.slice(space)) }
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitFlowItems(trimmed.slice(1, -1)).map(parseScalar)
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const map = {}
    for (const item of splitFlowItems(trimmed.slice(1, -1))) {
      const entry = splitMappingEntry(item)
      if (entry) {
        map[entry.key] = parseScalar(entry.rest)
      }
    }
    return map
  }
  return unquote(trimmed)
}

// Returns [value, nextIndex]. `indent` is the column the block's entries start at.
const parseBlock = (tokens, index, indent) => {
  if (index >= tokens.length || tokens[index].indent < indent) {
    return [null, index]
  }
  if (tokens[index].content.startsWith('-')) {
    const list = []
    let i = index
    while (i < tokens.length && tokens[i].indent === indent && tokens[i].content.startsWith('-')) {
      const token = tokens[i]
      const afterDash = token.content.slice(1)
      const rest = afterDash.trimStart()
      if (rest === '') {
        const [value, next] = parseBlock(tokens, i + 1, indent + 1)
        list.push(value)
        i = next
        continue
      }
      const childIndent = token.indent + 1 + (afterDash.length - rest.length)
      const entry = splitMappingEntry(rest)
      if (entry) {
        tokens[i] = { content: rest, indent: childIndent, line: token.line }
        const [value, next] = parseBlock(tokens, i, childIndent)
        list.push(value)
        i = next
        continue
      }
      // `- !Sub` with the argument list on the lines below it.
      if (i + 1 < tokens.length && tokens[i + 1].indent > token.indent && rest.startsWith('!')) {
        const [value, next] = parseBlock(tokens, i + 1, tokens[i + 1].indent)
        list.push({ __line: token.line, __scalar: { tag: rest.slice(1).trim(), value } })
        i = next
        continue
      }
      list.push({ __line: token.line, __scalar: parseScalar(rest) })
      i += 1
    }
    return [list, i]
  }
  const map = { __line: tokens[index].line }
  let i = index
  while (i < tokens.length && tokens[i].indent === indent) {
    const token = tokens[i]
    const entry = splitMappingEntry(token.content)
    if (!entry) {
      throw new Error(`Cannot read line ${token.line} of the template: ${token.content}`)
    }
    if (entry.rest === '') {
      const [value, next] = parseBlock(tokens, i + 1, i + 1 < tokens.length ? tokens[i + 1].indent : indent)
      map[entry.key] = next === i + 1 ? null : value
      i = next
    } else if (i + 1 < tokens.length && tokens[i + 1].indent > indent && entry.rest.startsWith('!')) {
      // `CertificateArn: !Sub` with the argument list on the lines below it.
      const [value, next] = parseBlock(tokens, i + 1, tokens[i + 1].indent)
      map[entry.key] = { __line: token.line, __scalar: { tag: entry.rest.slice(1).trim(), value } }
      i = next
    } else {
      map[entry.key] = { __line: token.line, __scalar: parseScalar(entry.rest) }
      i += 1
    }
  }
  return [map, i]
}

const parseYaml = (text) => {
  const tokens = tokenize(text)
  const [value, consumed] = parseBlock(tokens, 0, 0)
  // Silent truncation is the failure mode that would make this guard pass vacuously: a construct the
  // reader does not understand leaves the rest of the template unparsed, `Resources` half empty, and
  // every unread function trivially "covered". Refuse instead.
  if (consumed !== tokens.length) {
    const token = tokens[consumed]
    throw new Error(
      `Stopped reading the template at line ${token.line} (${token.content}). ` +
        `This reader handles only the YAML subset these templates use; extend it rather than ignoring this.`,
    )
  }
  return value
}

// ---------------------------------------------------------------------------------------------
// Walking the parsed template
// ---------------------------------------------------------------------------------------------

// Scalar nodes are wrapped as `{ __line, __scalar }` so failures can name a line. Unwrap one layer.
const nodeValue = (node) => (node && typeof node === 'object' && '__scalar' in node ? node.__scalar : node)
const nodeLine = (node) => (node && typeof node === 'object' && '__line' in node ? node.__line : null)

// Reduces a scalar -- possibly CFN-tagged -- to the string it would interpolate from, or null.
const asString = (value) => {
  const inner = nodeValue(value)
  if (typeof inner === 'string') {
    return inner
  }
  if (inner && typeof inner === 'object' && 'tag' in inner) {
    return asString(inner.value)
  }
  return null
}

const asList = (value) => {
  const inner = nodeValue(value)
  if (inner === null || inner === undefined) {
    return []
  }
  return Array.isArray(inner) ? inner : [inner]
}

// Every string anywhere under `node`, tags unwrapped.
const collectStrings = (node, out = []) => {
  const inner = nodeValue(node)
  if (typeof inner === 'string') {
    out.push(inner)
  } else if (Array.isArray(inner)) {
    inner.forEach((item) => collectStrings(item, out))
  } else if (inner && typeof inner === 'object') {
    if ('tag' in inner) {
      collectStrings(inner.value, out)
    } else {
      Object.entries(inner).forEach(([key, item]) => {
        if (!key.startsWith('__')) {
          collectStrings(item, out)
        }
      })
    }
  }
  return out
}

// Every `Action:`/`NotAction:` value under `node` that names a `bedrock:` action, with its line.
const collectBedrockActions = (node, out = []) => {
  const inner = nodeValue(node)
  if (Array.isArray(inner)) {
    inner.forEach((item) => collectBedrockActions(item, out))
  } else if (inner && typeof inner === 'object' && !('tag' in inner)) {
    Object.entries(inner).forEach(([key, item]) => {
      if (key.startsWith('__')) {
        return
      }
      if (key === 'Action' || key === 'NotAction') {
        for (const action of asList(item)) {
          const text = asString(action)
          if (text && /^bedrock:/.test(text)) {
            out.push({ action: text, line: nodeLine(action) ?? nodeLine(item) ?? nodeLine(inner) })
          }
        }
      }
      collectBedrockActions(item, out)
    })
  }
  return out
}

const templateFunctions = (doc) => {
  const resources = nodeValue(doc?.Resources)
  if (!resources || typeof resources !== 'object') {
    throw new Error('No Resources section in the template.')
  }
  const globals = nodeValue(nodeValue(doc?.Globals)?.Function) ?? {}
  return Object.entries(resources)
    .filter(([key]) => !key.startsWith('__'))
    .map(([logicalId, node]) => ({ line: nodeLine(node), logicalId, resource: nodeValue(node) }))
    .filter(({ resource }) => resource && typeof resource === 'object' && asString(resource.Type) === FUNCTION_TYPE)
    .map(({ line, logicalId, resource }) => {
      const properties = nodeValue(resource.Properties) ?? {}
      // SAM Globals are overridden wholesale by a resource-level value, never merged.
      const policies = properties.Policies ?? globals.Policies
      const handler = asString(properties.Handler ?? globals.Handler)
      const codeUri = asString(properties.CodeUri ?? globals.CodeUri) ?? ''
      const buildProperties = nodeValue(nodeValue(nodeValue(resource.Metadata)?.BuildProperties)) ?? {}
      const entryPoints = asList(buildProperties.EntryPoints).map(asString).filter(Boolean)
      return {
        bedrockActions: collectBedrockActions(policies),
        codeUri,
        entryPoints,
        handler,
        hasKillSwitchPolicy: collectStrings(policies).some((text) => KILL_SWITCH_POLICY.test(text)),
        line,
        logicalId,
        policies,
      }
    })
}

// ---------------------------------------------------------------------------------------------
// Reading source
// ---------------------------------------------------------------------------------------------

// Blanks out comments while preserving length, so offsets and line numbers survive. Regex literals
// are tracked well enough that `/\/\//` is not mistaken for a comment.
const stripJsComments = (source) => {
  const out = source.split('')
  let i = 0
  const regexAllowedAfter = /[(,=:[!&|?{};+\-*%~^<>]$/
  const keywordBefore = /(^|[^\w$])(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/
  let significant = ''
  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1]
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out[i] = ' '
        i += 1
      }
      continue
    }
    if (char === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') {
          out[i] = ' '
        }
        i += 1
      }
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      i += 1
      while (i < source.length && source[i] !== char) {
        i += source[i] === '\\' ? 2 : 1
      }
      i += 1
      significant = char
      continue
    }
    if (
      char === '/' &&
      (significant === '' || regexAllowedAfter.test(significant) || keywordBefore.test(significant))
    ) {
      i += 1
      let inClass = false
      while (i < source.length && source[i] !== '\n') {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === '[') {
          inClass = true
        } else if (source[i] === ']') {
          inClass = false
        } else if (source[i] === '/' && !inClass) {
          break
        }
        i += 1
      }
      i += 1
      significant = '/'
      continue
    }
    if (!/\s/.test(char)) {
      significant = (significant + char).slice(-24)
    }
    i += 1
  }
  return out.join('')
}

// TYPE-ONLY IMPORTS ARE NOT EDGES. `import type { RecipeAiJobRequest } from './recipe-ai-worker'` is
// erased before anything is bundled, so it puts no Bedrock code in the caller's deployment package.
// Counting it as an edge is not a conservative over-approximation, it is a false alarm that would
// demand a grant on a function that never calls the model -- which is the opposite of least
// privilege. food-api's `RecipeAiFunction` is exactly that shape and was the case that found this.
const eraseTypeOnlyImports = (source) =>
  source
    .replace(/\b(?:import|export)\s+type\s[\s\S]*?\bfrom\s*(['"])[^'"\n]*\1/g, ' ')
    // Every named binding marked `type`, and no default or namespace binding: also fully erased.
    .replace(/\bimport\s*\{([^}]*)\}\s*from\s*(['"])[^'"\n]*\2/g, (match, clause) => {
      const names = clause
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '')
      return names.length > 0 && names.every((name) => /^type\s/.test(name)) ? ' ' : match
    })

const importSpecifiers = (rawSource) => {
  const source = eraseTypeOnlyImports(rawSource)
  const found = new Set()
  const patterns = [
    /\bfrom\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
    /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  ]
  for (const pattern of patterns) {
    let match = pattern.exec(source)
    while (match) {
      found.add(match[2])
      match = pattern.exec(source)
    }
  }
  return [...found]
}

const resolveModule = (fromFile, specifier) => {
  if (!specifier.startsWith('.')) {
    return null
  }
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [...MODULE_SUFFIXES.map((suffix) => base + suffix)]
  // `./x.js` in TypeScript ESM means `./x.ts` on disk.
  if (/\.(js|mjs|cjs)$/.test(base)) {
    const stem = base.replace(/\.(js|mjs|cjs)$/, '')
    candidates.push(`${stem}.ts`, `${stem}.mts`, `${stem}.cts`, `${stem}.tsx`)
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

// Why a module counts as a Bedrock caller. Returns [] when it does not.
const bedrockMarkers = (source) => {
  const markers = []
  for (const symbol of BEDROCK_SYMBOLS) {
    if (new RegExp(`\\bnew\\s+${symbol}\\s*\\(`).test(source)) {
      markers.push(`constructs ${symbol}`)
    }
  }
  const importPattern = new RegExp(`import\\s+([^;\\n]*?)\\s+from\\s*['"]${BEDROCK_SDK_PACKAGE}['"]`, 'g')
  let match = importPattern.exec(source)
  while (match) {
    const clause = match[1]
    if (!/^type\b/.test(clause.trim())) {
      for (const symbol of BEDROCK_SYMBOLS) {
        const named = new RegExp(`(^|[{,\\s])(${symbol})(\\s*[,}]|\\s+as\\b|$)`)
        const valueImport = new RegExp(`(^|[{,])\\s*${symbol}\\s*(,|}|$)`)
        if (named.test(clause) && valueImport.test(clause) && !new RegExp(`type\\s+${symbol}\\b`).test(clause)) {
          markers.push(`imports ${symbol} from ${BEDROCK_SDK_PACKAGE}`)
        }
      }
    }
    match = importPattern.exec(source)
  }
  return [...new Set(markers)]
}

// ---------------------------------------------------------------------------------------------
// The two halves
// ---------------------------------------------------------------------------------------------

const handlerEntryFile = (root, fn) => {
  if (!fn.handler) {
    return null
  }
  // `src/handlers/recipes.handler` -> `src/handlers/recipes`; the last dot segment is the export.
  const modulePath = fn.handler.slice(0, fn.handler.lastIndexOf('.'))
  if (modulePath === '') {
    return null
  }
  const base = resolve(root, fn.codeUri || '.', modulePath)
  for (const suffix of MODULE_SUFFIXES) {
    const candidate = base + suffix
    if (suffix !== '' && existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

const entryFilesFor = (root, fn) => {
  const files = new Set()
  const handlerFile = handlerEntryFile(root, fn)
  if (handlerFile) {
    files.add(handlerFile)
  }
  for (const entry of fn.entryPoints) {
    const resolved = resolve(root, fn.codeUri || '.', entry)
    if (existsSync(resolved) && statSync(resolved).isFile()) {
      files.add(resolved)
    } else {
      const withExt = MODULE_SUFFIXES.map((suffix) => resolved + suffix).find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
      )
      if (withExt) {
        files.add(withExt)
      }
    }
  }
  return [...files]
}

const moduleGraph = (entryFiles, cache, warnings) => {
  const seen = new Set()
  const queue = [...entryFiles]
  while (queue.length > 0) {
    const file = queue.shift()
    if (seen.has(file)) {
      continue
    }
    seen.add(file)
    if (!cache.has(file)) {
      cache.set(file, stripJsComments(readFileSync(file, 'utf8')))
    }
    for (const specifier of importSpecifiers(cache.get(file))) {
      if (!specifier.startsWith('.')) {
        continue
      }
      const resolved = resolveModule(file, specifier)
      if (resolved) {
        queue.push(resolved)
      } else {
        warnings.push(`Unresolved relative import ${JSON.stringify(specifier)} in ${file}`)
      }
    }
  }
  return seen
}

const run = () => {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose')
  const templateIndex = args.indexOf('--template')
  const root = process.cwd()
  const templatePath = resolve(root, templateIndex === -1 ? 'template.yaml' : args[templateIndex + 1])

  if (!existsSync(templatePath)) {
    console.error(`No template at ${templatePath}`)
    return 1
  }

  const doc = parseYaml(readFileSync(templatePath, 'utf8'))
  const functions = templateFunctions(doc)
  if (functions.length === 0) {
    console.error(`No ${FUNCTION_TYPE} resources found in ${relative(root, templatePath)}. Refusing to report success.`)
    return 1
  }

  const failures = []
  const warnings = []
  const notes = []
  const grantedWithoutSource = []

  // --- (a) template half ------------------------------------------------------------------
  for (const fn of functions) {
    if (fn.bedrockActions.length > 0 && !fn.hasKillSwitchPolicy) {
      const lines = fn.bedrockActions.map((entry) => `${entry.action} (line ${entry.line})`).join(', ')
      failures.push(
        `[template] ${fn.logicalId} grants ${lines} but its Policies list does not include the kill-switch policy ARN.\n` +
          `           Add: - !Sub 'arn:\${AWS::Partition}:iam::\${AWS::AccountId}:policy/kill-switch-bedrock-\${Environment}'`,
      )
    }
  }

  // A `bedrock:` action that belongs to no Serverless function is something this guard cannot
  // reason about. Say so rather than pass.
  const functionActionLines = new Set(functions.flatMap((fn) => fn.bedrockActions.map((entry) => entry.line)))
  for (const stray of collectBedrockActions(doc)) {
    if (!functionActionLines.has(stray.line)) {
      failures.push(
        `[template] ${stray.action} at line ${stray.line} is not inside an ${FUNCTION_TYPE}'s Policies.\n` +
          `           This guard cannot resolve its owning role; move it or extend the guard.`,
      )
    }
  }

  // --- (b) source half --------------------------------------------------------------------
  const cache = new Map()
  const bedrockModules = new Map()
  for (const fn of functions) {
    const entryFiles = entryFilesFor(root, fn)
    if (entryFiles.length === 0) {
      failures.push(
        `[source] ${fn.logicalId} (line ${fn.line}): could not resolve an entry point from Handler ` +
          `${JSON.stringify(fn.handler)}. The source half cannot see this function, so its coverage is unproven.`,
      )
      continue
    }
    const graph = moduleGraph(entryFiles, cache, warnings)
    const reached = []
    for (const file of graph) {
      if (!bedrockModules.has(file)) {
        bedrockModules.set(file, bedrockMarkers(cache.get(file)))
      }
      if (bedrockModules.get(file).length > 0) {
        reached.push(file)
      }
    }
    if (reached.length === 0) {
      if (fn.bedrockActions.length > 0) {
        // Not a failure: sse-api's seven pass-through handlers hold grants and enqueue the model work
        // to LlmResponseWorkerFunction. Worth surfacing as an over-grant signal, not worth failing on.
        grantedWithoutSource.push(fn.logicalId)
      }
      continue
    }
    const why = reached.map((file) => `${relative(root, file)} (${bedrockModules.get(file).join('; ')})`).join(', ')
    if (fn.bedrockActions.length === 0) {
      failures.push(
        `[source] ${fn.logicalId} (line ${fn.line}) reaches Bedrock in code but its Policies list holds NO ` +
          `bedrock: action.\n           via ${why}`,
      )
    }
    if (!fn.hasKillSwitchPolicy) {
      failures.push(
        `[source] ${fn.logicalId} (line ${fn.line}) reaches Bedrock in code but does not carry the kill-switch ` +
          `policy ARN.\n           via ${why}`,
      )
    }
    if (verbose && fn.bedrockActions.length > 0 && fn.hasKillSwitchPolicy) {
      notes.push(`${fn.logicalId} covered: grant + kill-switch ARN, reaches Bedrock via ${why}`)
    }
  }

  // --- report ------------------------------------------------------------------------------
  const covered = functions.filter((fn) => fn.hasKillSwitchPolicy).length
  const granted = functions.filter((fn) => fn.bedrockActions.length > 0).length

  if (verbose) {
    for (const warning of warnings) {
      console.log(`  warn: ${warning}`)
    }
    for (const logicalId of grantedWithoutSource) {
      console.log(
        `  note: ${logicalId} holds a bedrock: grant but no module on its handler's import graph calls ` +
          `Bedrock (a pass-through that enqueues the work, or an over-broad grant).`,
      )
    }
  }
  for (const note of notes) {
    console.log(`  note: ${note}`)
  }

  if (failures.length > 0) {
    console.error('')
    console.error(`Bedrock kill-switch coverage FAILED in ${relative(root, templatePath) || 'template.yaml'}:`)
    console.error('')
    for (const failure of failures) {
      console.error(`  ${failure}`)
    }
    console.error('')
    console.error('A Bedrock-capable function without the kill-switch policy cannot be stopped by the kill switch.')
    return 1
  }

  const passThrough =
    grantedWithoutSource.length === 0
      ? ''
      : ` ${grantedWithoutSource.length} hold a grant with no source path to Bedrock (--verbose to list).`
  console.log(
    `Bedrock kill-switch coverage OK: ${functions.length} functions, ${granted} with a bedrock: grant, ` +
      `${covered} carrying the kill-switch policy ARN.${passThrough}`,
  )
  return 0
}

try {
  process.exitCode = run()
} catch (error) {
  console.error(`Bedrock kill-switch guard could not complete: ${error.message}`)
  process.exitCode = 1
}
