import { adjectives } from '../assets/adjectives'
import { constraints } from '../assets/constraints'
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

const getModelContext = (disallowedCategories: string[]): Record<string, any> => {
  const wordConstraints = Math.random() < categoryConstraintChance ? getRandomSample(constraints, 1)[0] : undefined
  const inspirationNouns = getRandomSample(nouns, inspirationNounsCount)
  const inspirationVerbs = getRandomSample(verbs, inspirationVerbsCount)
  const inspirationAdjectives = getRandomSample(adjectives, inspirationAdjectivesCount)
  return {
    disallowedCategories,
    inspirationAdjectives,
    inspirationNouns,
    inspirationVerbs,
    wordConstraints,
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
        words: category.words.map((word: string) => word.toUpperCase()),
      },
    }),
    {} as CategoryObject,
  ),
})

export const createGame = async (gameId: GameId): Promise<ConnectionsData> => {
  const contextGameIds = getContextGameIds(gameId)
  const contextGames = await getGamesByIds(contextGameIds)
  const disallowedCategories = Object.values(contextGames).flatMap((game) => Object.keys(game.categories))
  const modelContext = getModelContext(disallowedCategories)
  log('Creating game with context', { modelContext })

  const prompt = await getPromptById(llmPromptId)
  const returnedData = (await invokeModel(prompt, modelContext)) as ConnectionsData
  const connectionsData = transformWordsToUpperCase(returnedData)
  const wordList = Object.values(connectionsData.categories).flatMap((cat) => cat.words.map((w) => w.toUpperCase()))

  if (new Set(wordList).size !== wordList.length) {
    throw new Error('Generated words are not unique')
  } else if ([4, 5].indexOf(Object.keys(connectionsData.categories).length) < 0) {
    throw new Error('Generated wrong number of categories')
  } else if (Object.values(connectionsData.categories).find((category) => category.words.length !== 4)) {
    throw new Error('Generated a category with the wrong number of words')
  }

  const dataWithWordList = { ...connectionsData, wordList }
  await setGameById(gameId, dataWithWordList)
  return dataWithWordList
}
