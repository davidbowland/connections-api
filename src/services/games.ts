import { adjectives } from '../assets/adjectives'
import { chargedWords } from '../assets/blocklist'
import { alwaysDisallowedCategories, wordConstraints as wordConstraintsChoices } from '../assets/constraints'
import { nouns } from '../assets/nouns'
import { verbs } from '../assets/verbs'
import {
  disallowedCategoryLimit,
  inspirationAdjectivesCount,
  inspirationNounsCount,
  inspirationVerbsCount,
  llmPromptId,
  wordConstraintChance,
} from '../config'
import { CategoryHistory, CategoryObject, ConnectionsData, Decoy, GameId, ToolSchema } from '../types'
import { canonicalize, tokenKey } from '../utils/category-keys'
import { selectCategoryConstraints } from '../utils/constraint-selection'
import { getDateConstraint } from '../utils/constraints'
import { log } from '../utils/logging'
import { invokeModel } from './bedrock'
import { getAllGames, getPromptById, setGameById } from './dynamodb'
import { verifyAndFixGame } from './verification'

// A word constraint can ask for five categories ("always generate 5 categories rather than 4"),
// but that constraint is mutually exclusive with category constraints -- the word-constraint branch
// of getModelContext returns before any category constraint is drawn. This path is therefore always
// the four-category one.
const CATEGORY_SLOT_COUNT = 4

// Nothing enforces a tool schema on the way out of the model, so the lower bound is re-checked in
// validateDecoys. MAX_DECOYS is schema guidance only and deliberately not enforced there.
const MIN_DECOYS = 3
const MAX_DECOYS = 5
// Counted over BOTH endpoints of every decoy (owning category and looksLike). Owners alone would
// let the model satisfy the rule with three decoys that all point at one category.
const MIN_DECOY_CATEGORY_SPAN = 3

// The model returns decoys alongside the game. They are a generation-time forcing device, not game
// data, so ConnectionsData deliberately has no room for them.
type GeneratedGame = ConnectionsData & { decoys?: Decoy[] }

export const gameTool: ToolSchema = {
  description:
    'Submit the generated Connections game. `decoys` names words that plausibly belong to a different category in the same grid; supply 3 to 5, spanning at least 3 categories.',
  input_schema: {
    properties: {
      categories: {
        additionalProperties: {
          properties: {
            embeddedSubstrings: { items: { type: 'string' }, type: 'array' },
            hint: { type: 'string' },
            words: { items: { type: 'string' }, maxItems: 4, minItems: 4, type: 'array' },
          },
          required: ['words', 'hint'],
          type: 'object',
        },
        type: 'object',
      },
      decoys: {
        items: {
          properties: {
            looksLike: { type: 'string' },
            word: { type: 'string' },
          },
          required: ['word', 'looksLike'],
          type: 'object',
        },
        maxItems: MAX_DECOYS,
        minItems: MIN_DECOYS,
        type: 'array',
      },
    },
    required: ['categories', 'decoys'],
    type: 'object',
  },
  name: 'submit_game',
}

// Samples without replacement, so callers must pass a copy -- it swaps drawn entries to the tail of
// the array it is given. The duplicate-allowing mode this used to carry existed only for the flat
// category-constraint pool; selectCategoryConstraints owns that draw now.
const getRandomSample = <T>(
  array: T[],
  count: number,
  { length, random = Math.random }: { length?: number; random?: () => number } = {},
): T[] => {
  const max = length ?? array.length
  const index = Math.floor(random() * max)
  const value = array[index]
  if (count === 1) {
    return [value]
  }
  array[index] = array[max - 1]
  return [value, ...getRandomSample(array, count - 1, { length: max - 1, random })]
}

const getModelContext = (date: Date, disallowedCategories: string[], random = Math.random): Record<string, any> => {
  const wordConstraintValue = random()
  const useWordConstraint = wordConstraintValue < wordConstraintChance
  const holidayConstraints = getDateConstraint(date)

  const inspirationNouns = getRandomSample([...nouns], inspirationNounsCount, { random })
  const inspirationVerbs = getRandomSample([...verbs], inspirationVerbsCount, { random })
  const inspirationAdjectives = getRandomSample([...adjectives], inspirationAdjectivesCount, {
    random,
  })

  log('Constraint chance', {
    holidayConstraints,
    useWordConstraint,
    wordConstraintChance,
    wordConstraintValue,
  })

  // Holiday constraints override everything
  if (holidayConstraints) {
    return {
      disallowedCategories,
      inspirationAdjectives,
      inspirationNouns,
      inspirationVerbs,
      wordConstraints: holidayConstraints,
    }
  }

  if (useWordConstraint) {
    const wordConstraints = getRandomSample([...wordConstraintsChoices], 1, { random })[0]
    return {
      disallowedCategories,
      inspirationAdjectives,
      inspirationNouns,
      inspirationVerbs,
      wordConstraints,
    }
  } else {
    const categoryConstraints = selectCategoryConstraints(CATEGORY_SLOT_COUNT, random)
    return {
      categoryConstraints,
      disallowedCategories,
      inspirationAdjectives,
      inspirationNouns,
      inspirationVerbs,
    }
  }
}

const transformWordsToUpperCase = (connectionsData: ConnectionsData): ConnectionsData => ({
  ...connectionsData,
  categories: Object.entries(connectionsData.categories).reduce(
    (acc, [key, category]) => ({
      ...acc,
      [key]: {
        ...category,
        embeddedSubstrings: category.embeddedSubstrings?.map((word: string) => word.toUpperCase()),
        words: category.words.map((word: string) => word.toUpperCase()),
      },
    }),
    {} as CategoryObject,
  ),
})

const isEmbeddedSubstringsValid = (words: string[], embeddedSubstrings?: string[]): boolean => {
  if (!embeddedSubstrings || embeddedSubstrings.length === 0) {
    return true
  }
  return words.every((word) => embeddedSubstrings.some((substring) => word.includes(substring)))
}

const TOKEN_SPLIT = /[^A-Z0-9]+/

const tokenize = (value: string): string[] => value.toUpperCase().split(TOKEN_SPLIT).filter(Boolean)

// Hints are checked alongside names and words because get-game-by-id returns the whole Category
// object, hints included, so they are player-visible model prose -- and the verifier is allowed to
// rewrite them wholesale. embeddedSubstrings are deliberately excluded: they are substrings by
// construction, so whole-token matching against them is meaningless.
export const findChargedTerm = (categories: CategoryObject): string | undefined => {
  const candidates = Object.entries(categories).flatMap(([name, category]) => [name, category.hint, ...category.words])
  return candidates.flatMap(tokenize).find((token) => chargedWords.has(token))
}

// A null token key means the name is blank-bearing or all-stopwords and has no order-independent
// identity; those must be filtered out rather than stored, because a single null in the set would
// match every other keyless name forever.
export const buildCategoryHistory = (names: string[]): CategoryHistory => ({
  canonical: new Set(names.map(canonicalize)),
  token: new Set(names.map(tokenKey).filter((key): key is string => key !== null)),
})

const findRepeatedCategory = (categories: CategoryObject, history: CategoryHistory): string | undefined =>
  Object.keys(categories).find((name) => {
    const token = tokenKey(name)
    return history.canonical.has(canonicalize(name)) || (token !== null && history.token.has(token))
  })

// "Some words should look like they belong to another category" is the single most important line
// in the generation prompt and the least enforceable one. Making the model name its own traps in
// the tool call turns the request into a commitment that can be checked. Structural only: a decoy
// that is well-formed here can still be a claim that does not hold, which is the verifier's job.
//
// Words are compared uppercased because transformWordsToUpperCase has already normalized the grid.
// Category names are compared exactly -- they are echoed back from the same tool call, so the model
// has no reason to re-case them.
export const validateDecoys = (categories: CategoryObject, decoys: Decoy[]): void => {
  if (decoys.length < MIN_DECOYS) {
    log('Generated too few decoys', { decoyCount: decoys.length })
    throw new Error(`Generated too few decoys: ${decoys.length}`)
  }
  // No upper bound is enforced here. The schema declares maxItems as guidance, but a game with
  // more decoys than asked for is MORE misdirection-rich, not less -- discarding it would burn a
  // generation attempt to punish the model for exceeding the goal. Every entry is still validated.

  const categoryNames = new Set(Object.keys(categories))
  const owningCategory = new Map<string, string>()
  Object.entries(categories).forEach(([name, category]) => {
    category.words.forEach((word) => owningCategory.set(word.toUpperCase(), name))
  })

  // Both endpoints of every decoy, not just the owners -- see MIN_DECOY_CATEGORY_SPAN.
  const touched = new Set<string>()
  decoys.forEach(({ looksLike, word }) => {
    const owner = owningCategory.get(word.toUpperCase())
    if (owner === undefined) {
      log('Decoy references unknown word', { word })
      throw new Error(`Decoy references unknown word: ${word}`)
    }
    // Set membership rather than `in`, which would accept inherited keys like `constructor`.
    if (!categoryNames.has(looksLike)) {
      log('Decoy references unknown category', { looksLike })
      throw new Error(`Decoy references unknown category: ${looksLike}`)
    }
    if (looksLike === owner) {
      log('Decoy points at its own category', { looksLike, word })
      throw new Error(`Decoy points at its own category: ${word}`)
    }
    touched.add(owner)
    touched.add(looksLike)
  })

  // Without this the model satisfies the count by loading every trap into one pair of categories
  // and leaving the other two clean -- the exact failure this is meant to prevent.
  if (touched.size < MIN_DECOY_CATEGORY_SPAN) {
    log('Decoys must span more categories', { touched: [...touched] })
    throw new Error(`Decoys must span at least ${MIN_DECOY_CATEGORY_SPAN} categories`)
  }
}

export const validateGame = (categories: CategoryObject, history?: CategoryHistory): string[] => {
  const wordList = Object.values(categories).flatMap((cat) => cat.words.map((w) => w.toUpperCase()))
  if (new Set(wordList).size !== wordList.length) {
    log('Generated words are not unique', { wordList })
    throw new Error('Generated words are not unique')
  } else if ([4, 5].indexOf(Object.keys(categories).length) < 0) {
    log('Generated wrong number of categories', { categories })
    throw new Error('Generated wrong number of categories')
  } else if (Object.values(categories).some((category) => category.words.length !== 4)) {
    log('Generated a category with the wrong number of words', {
      categories: JSON.stringify(categories, undefined, 2),
    })
    throw new Error('Generated a category with the wrong number of words')
  } else if (
    !Object.values(categories).every((category) =>
      isEmbeddedSubstringsValid(category.words, category.embeddedSubstrings),
    )
  ) {
    log('Generated invalid embedded substrings', {
      categories: JSON.stringify(categories, undefined, 2),
    })
    throw new Error('Generated invalid embedded substrings')
  }

  const chargedTerm = findChargedTerm(categories)
  if (chargedTerm) {
    log('Generated a charged term', { chargedTerm })
    throw new Error(`Generated a charged term: ${chargedTerm}`)
  }

  // Optional so the rest of validateGame stays testable in isolation; createGame always supplies it.
  const repeated = history && findRepeatedCategory(categories, history)
  if (repeated) {
    log('Generated a repeated category', { repeated })
    throw new Error(`Generated a repeated category: ${repeated}`)
  }

  return wordList
}

export const createGame = async (gameId: GameId, random = Math.random): Promise<ConnectionsData> => {
  const pastGames = await getAllGames()
  // GameIds are ISO dates, so a descending string sort is newest-first.
  const pastCategories = Object.entries(pastGames)
    .sort(([left], [right]) => right.localeCompare(left))
    .flatMap(([, game]) => Object.keys(game.categories))
  // Only the model-visible list is bounded. Its job is to stop semantic restatement, which only the
  // model can judge and where recency matters most, so it pays tokens for the newest names only.
  const disallowedCategories = [...alwaysDisallowedCategories, ...pastCategories.slice(0, disallowedCategoryLimit)]
  // The code-level history covers the FULL archive, not just the model-visible window. Exact and
  // reordered repeats are caught deterministically here at no token cost, so there is no reason to
  // truncate it.
  const categoryHistory = buildCategoryHistory([...alwaysDisallowedCategories, ...pastCategories])
  const modelContext = getModelContext(new Date(gameId), disallowedCategories, random)
  log('Creating game with context', { modelContext })

  const prompt = await getPromptById(llmPromptId)
  // Decoys are split off the model response here and never re-attached: verification, storage, and
  // the API response are all downstream of `returnedGame`, so they cannot leak by construction.
  // Dropping them also stops them going stale when the verifier replaces a category outright.
  const { decoys, ...returnedGame }: GeneratedGame = await invokeModel(prompt, gameTool, modelContext)
  const connectionsData = transformWordsToUpperCase(returnedGame)
  validateGame(connectionsData.categories, categoryHistory)
  // `decoys` is required by the tool schema, so a response without it is a real error, not a
  // response to be waved through.
  validateDecoys(connectionsData.categories, decoys ?? [])

  // Checked again after verification: the verifier is allowed to replace a category outright, and
  // its replacement can itself be a repeat.
  const verifiedGame = await verifyAndFixGame(connectionsData, modelContext)
  const finalWordList = validateGame(verifiedGame.categories, categoryHistory)

  const dataWithWordList = { ...verifiedGame, wordList: finalWordList }
  await setGameById(gameId, dataWithWordList)
  return dataWithWordList
}
