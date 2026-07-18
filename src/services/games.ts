import { adjectives } from '../assets/adjectives'
import {
  alwaysDisallowedCategories,
  categoryConstraints as categoryConstraintChoices,
  wordConstraints as wordConstraintsChoices,
} from '../assets/constraints'
import { nouns } from '../assets/nouns'
import { verbs } from '../assets/verbs'
import {
  inspirationAdjectivesCount,
  inspirationNounsCount,
  inspirationVerbsCount,
  llmPromptId,
  wordConstraintChance,
} from '../config'
import { CategoryObject, ConnectionsData, GameId, ToolSchema } from '../types'
import { getDateConstraint } from '../utils/constraints'
import { log } from '../utils/logging'
import { invokeModel } from './bedrock'
import { getAllGames, getPromptById, setGameById } from './dynamodb'
import { verifyAndFixGame } from './verification'

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

const getRandomSample = <T>(
  array: T[],
  count: number,
  {
    withDuplicates = false,
    length,
    random = Math.random,
  }: { withDuplicates?: boolean; length?: number; random?: () => number } = {},
): T[] => {
  const max = length ?? array.length
  const index = Math.floor(random() * max)
  const value = array[index]
  if (count === 1) {
    return [value]
  } else if (withDuplicates) {
    return [
      value,
      ...getRandomSample(array, count - 1, { withDuplicates: true, length: max, random }),
    ]
  } else {
    array[index] = array[max - 1]
    return [value, ...getRandomSample(array, count - 1, { length: max - 1, random })]
  }
}

const getModelContext = (
  date: Date,
  disallowedCategories: string[],
  random = Math.random,
): Record<string, any> => {
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
    const categoryConstraints = getRandomSample([...categoryConstraintChoices], 4, {
      withDuplicates: true,
      random,
    })
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

export const validateGame = (categories: CategoryObject): string[] => {
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
  return wordList
}

export const createGame = async (
  gameId: GameId,
  random = Math.random,
): Promise<ConnectionsData> => {
  const pastGames = await getAllGames()
  const disallowedCategories = [
    ...alwaysDisallowedCategories,
    ...Object.values(pastGames).flatMap((game) => Object.keys(game.categories)),
  ]
  const modelContext = getModelContext(new Date(gameId), disallowedCategories, random)
  log('Creating game with context', { modelContext })

  const prompt = await getPromptById(llmPromptId)
  const returnedData: ConnectionsData = await invokeModel(prompt, gameTool, modelContext)
  const connectionsData = transformWordsToUpperCase(returnedData)
  validateGame(connectionsData.categories)

  const verifiedGame = await verifyAndFixGame(connectionsData, modelContext)
  const finalWordList = validateGame(verifiedGame.categories)

  const dataWithWordList = { ...verifiedGame, wordList: finalWordList }
  await setGameById(gameId, dataWithWordList)
  return dataWithWordList
}
