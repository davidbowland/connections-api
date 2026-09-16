import { llmVerifyPromptId } from '../config'
import { CategoryObject, ConnectionsGame, Decoy, ToolSchema, VerificationResult } from '../types'
import { log } from '../utils/logging'
import { invokeModel } from './bedrock'
import { getPromptById } from './dynamodb'

const categoryReplacementSchema = {
  properties: {
    embeddedSubstrings: { items: { type: 'string' }, type: 'array' },
    hint: { type: 'string' },
    name: { type: 'string' },
    words: { items: { type: 'string' }, maxItems: 4, minItems: 4, type: 'array' },
  },
  required: ['name', 'words', 'hint'],
  type: 'object',
}

export const verdictTool: ToolSchema = {
  description: 'Submit the verification verdict for a Connections game.',
  input_schema: {
    properties: {
      fixes: {
        additionalProperties: {
          properties: {
            category: categoryReplacementSchema,
            hint: { type: 'string' },
            words: { items: { type: 'string' }, maxItems: 4, minItems: 4, type: 'array' },
          },
          type: 'object',
        },
        type: 'object',
      },
      reason: { type: 'string' },
      verdict: { enum: ['pass', 'fix', 'fail'], type: 'string' },
    },
    required: ['verdict', 'reason'],
    type: 'object',
  },
  name: 'submit_verdict',
}

const applyFixes = (game: ConnectionsGame, result: VerificationResult): ConnectionsGame => {
  if (!result.fixes) {
    return game
  }

  const categories: CategoryObject = { ...game.categories }
  let totalWordChanges = 0
  let categoryReplacements = 0

  for (const [oldName, fix] of Object.entries(result.fixes)) {
    if (!(oldName in categories)) {
      throw new Error(`Fix references unknown category: ${oldName}`)
    }

    if (fix.category) {
      categoryReplacements++
      if (categoryReplacements > 1) {
        throw new Error('Fix exceeds category replacement limit (> 1)')
      }
      log('Verification fix: category replacement', {
        before: { name: oldName, ...categories[oldName] },
        after: fix.category,
      })
      delete categories[oldName]
      categories[fix.category.name] = {
        embeddedSubstrings: fix.category.embeddedSubstrings ?? [],
        hint: fix.category.hint,
        words: fix.category.words,
      }
    } else {
      if (fix.words) {
        const oldWords = categories[oldName].words
        const wordChanges = fix.words.filter((w) => !oldWords.includes(w)).length
        if (wordChanges > 2) {
          throw new Error(`Fix exceeds per-category word change limit (> 2) for category: ${oldName}`)
        }
        totalWordChanges += wordChanges
        log('Verification fix: words', {
          category: oldName,
          before: oldWords,
          after: fix.words,
        })
        categories[oldName] = { ...categories[oldName], words: fix.words }
      }
      if (fix.hint) {
        log('Verification fix: hint', {
          category: oldName,
          before: categories[oldName].hint,
          after: fix.hint,
        })
        categories[oldName] = { ...categories[oldName], hint: fix.hint }
      }
    }
  }

  if (totalWordChanges > 4) {
    throw new Error('Fix exceeds total word change limit (> 4)')
  }

  return { ...game, categories }
}

// Decoys ride alongside the game rather than inside it. validateDecoys can only check that a decoy
// is well-formed; whether the claim is TRUE is a judgment call, so the verifier gets the claims as
// read-only context and audits them. The key is spread in only when there is something to audit --
// an always-present `decoys: undefined` would defeat the prompt's "when the input includes decoys"
// branch, and merging them into `game` would put them back on the path to storage.
const getVerifierContext = (
  game: ConnectionsGame,
  modelContext: Record<string, any>,
  decoys?: Decoy[],
): Record<string, any> => {
  return {
    game,
    categoryConstraints: modelContext.categoryConstraints,
    wordConstraints: modelContext.wordConstraints,
    ...(decoys && decoys.length > 0 ? { decoys } : {}),
  }
}

export const verifyAndFixGame = async (
  game: ConnectionsGame,
  modelContext: Record<string, any>,
  decoys?: Decoy[],
): Promise<ConnectionsGame> => {
  const verifierContext = getVerifierContext(game, modelContext, decoys)
  log('Invoking verify prompt', { verifierContext })
  const prompt = await getPromptById(llmVerifyPromptId)
  const result: VerificationResult = await invokeModel(prompt, verdictTool, verifierContext)

  log('Verify prompt result', {
    reason: result.reason,
    verdict: result.verdict,
    fixes: result.fixes,
  })

  if (result.verdict === 'pass') {
    return game
  } else if (result.verdict === 'fail') {
    throw new Error(`Verification failed: ${result.reason}`)
  } else if (result.verdict === 'fix') {
    return applyFixes(game, result)
  } else {
    throw new Error(`Unrecognized verdict: ${(result as any).verdict}`)
  }
}
