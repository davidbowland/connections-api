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
import { CategoryHistory, CategoryObject, ConnectionsData, GameId, ToolSchema } from '../types'
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

export const gameTool: ToolSchema = {
  description: 'Submit the generated Connections game.',
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
    },
    required: ['categories'],
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
  const returnedData: ConnectionsData = await invokeModel(prompt, gameTool, modelContext)
  const connectionsData = transformWordsToUpperCase(returnedData)
  validateGame(connectionsData.categories, categoryHistory)

  // Checked again after verification: the verifier is allowed to replace a category outright, and
  // its replacement can itself be a repeat.
  const verifiedGame = await verifyAndFixGame(connectionsData, modelContext)
  const finalWordList = validateGame(verifiedGame.categories, categoryHistory)

  const dataWithWordList = { ...verifiedGame, wordList: finalWordList }
  await setGameById(gameId, dataWithWordList)
  return dataWithWordList
}
