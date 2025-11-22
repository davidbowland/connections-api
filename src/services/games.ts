import { adjectives } from '../assets/adjectives'
import { normalConstraintCounts, normalConstraints, specialConstraints } from '../assets/constraints'
import { nouns } from '../assets/nouns'
import { verbs } from '../assets/verbs'
import {
  avoidNextGamesCount,
  avoidPastGamesCount,
  categoryConstraintChance,
  inspirationAdjectivesCount,
  inspirationNounsCount,
  inspirationVerbsCount,
  llmPromptId,
} from '../config'
import { CategoryObject, ConnectionsData, GameId } from '../types'
import { getDateConstraint } from '../utils/constraints'
import { log } from '../utils/logging'
import { invokeModel } from './bedrock'
import { getGamesByIds, getPromptById, setGameById } from './dynamodb'

const getRandomSample = <T>(array: T[], count: number, length?: number): T[] => {
  const max = length ?? array.length - 1
  const index = Math.floor(Math.random() * max)
  const value = array[index]
  array[index] = array[max]
  return count > 1 ? [value, ...getRandomSample(array, count - 1, max - 1)] : [value]
}

const padList = <T>(array: T[], padValue: T, length = 4) => array.concat(Array(length).fill(padValue)).slice(0, length)

const getModelContext = (date: Date, disallowedCategories: string[]): Record<string, any> => {
  const constraintValue = Math.random()
  const useSpecialConstraint = constraintValue < categoryConstraintChance
  const holidayConstraints = getDateConstraint(date)

  const inspirationNouns = getRandomSample(nouns, inspirationNounsCount)
  const inspirationVerbs = getRandomSample(verbs, inspirationVerbsCount)
  const inspirationAdjectives = getRandomSample(adjectives, inspirationAdjectivesCount)

  log('Constraint chance', {
    categoryConstraintChance,
    categoryConstraintValue: constraintValue,
    holidayConstraints,
    useSpecialConstraint,
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

  // Use either specialConstraints (for all words) or normalConstraints (for categories)
  if (useSpecialConstraint) {
    const wordConstraints = getRandomSample(specialConstraints, 1)[0]
    return {
      disallowedCategories,
      inspirationAdjectives,
      inspirationNouns,
      inspirationVerbs,
      wordConstraints,
    }
  } else {
    const categoryConstraintCount = getRandomSample(normalConstraintCounts, 1)[0]
    const categoryConstraints = getRandomSample(normalConstraints, categoryConstraintCount)
    return {
      categoryConstraints: padList(categoryConstraints, categoryConstraints[0], 4),
      disallowedCategories,
      inspirationAdjectives,
      inspirationNouns,
      inspirationVerbs,
    }
  }
}

export const getContextGameIds = (gameId: string): GameId[] => {
  const gameDate = new Date(gameId)
  const contextGameIds: GameId[] = []
  for (let i = -avoidPastGamesCount; i <= avoidNextGamesCount; i++) {
    const contextDate = new Date(gameDate)
    contextDate.setDate(contextDate.getDate() + i)
    if (contextDate >= new Date('2025-01-01') && contextDate < new Date()) {
      contextGameIds.push(contextDate.toISOString().split('T')[0])
    }
  }
  return contextGameIds
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

export const createGame = async (gameId: GameId): Promise<ConnectionsData> => {
  const contextGameIds = getContextGameIds(gameId)
  const contextGames = await getGamesByIds(contextGameIds)
  const disallowedCategories = Object.values(contextGames).flatMap((game) => Object.keys(game.categories))
  const modelContext = getModelContext(new Date(gameId), disallowedCategories)
  log('Creating game with context', { modelContext })

  const prompt = await getPromptById(llmPromptId)
  const returnedData: ConnectionsData = await invokeModel(prompt, modelContext)
  const connectionsData = transformWordsToUpperCase(returnedData)
  const wordList = Object.values(connectionsData.categories).flatMap((cat) => cat.words.map((w) => w.toUpperCase()))

  if (new Set(wordList).size !== wordList.length) {
    log('Generated words are not unique', { wordList })
    throw new Error('Generated words are not unique')
  } else if ([4, 5].indexOf(Object.keys(connectionsData.categories).length) < 0) {
    log('Generated wrong number of categories', { categories: connectionsData.categories })
    throw new Error('Generated wrong number of categories')
  } else if (Object.values(connectionsData.categories).some((category) => category.words.length !== 4)) {
    log('Generated a category with the wrong number of words', {
      categories: JSON.stringify(connectionsData.categories, undefined, 2),
    })
    throw new Error('Generated a category with the wrong number of words')
  } else if (
    !Object.values(connectionsData.categories).every((category) =>
      isEmbeddedSubstringsValid(category.words, category.embeddedSubstrings),
    )
  ) {
    log('Generated invalid embedded substrings', {
      categories: JSON.stringify(connectionsData.categories, undefined, 2),
    })
    throw new Error('Generated invalid embedded substrings')
  }

  const dataWithWordList = { ...connectionsData, wordList }
  await setGameById(gameId, dataWithWordList)
  return dataWithWordList
}
