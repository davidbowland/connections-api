import { adjectives } from '../assets/adjectives'
import { nouns } from '../assets/nouns'
import { themes } from '../assets/themes'
import { verbs } from '../assets/verbs'
import {
  avoidNextGamesCount,
  avoidPastGamesCount,
  inspirationAdjectivesCount,
  inspirationNounsCount,
  inspirationVerbsCount,
  llmPromptId,
} from '../config'
import { ConnectionsData, GameId } from '../types'
import { log } from '../utils/logging'
import { invokeModel } from './bedrock'
import { getGamesByIds, getPromptById, setGameById } from './dynamodb'

const VALID_THEME_COUNTS = [1, 2, 4]

const getRandomSample = <T>(array: T[], count: number, length?: number): T[] => {
  const max = length ?? array.length - 1
  const index = Math.floor(Math.random() * max)
  const value = array[index]
  array[index] = array[max]
  return count > 1 ? [value, ...getRandomSample(array, count - 1, max - 1)] : [value]
}

export const createGame = async (gameId: GameId): Promise<ConnectionsData> => {
  const gameDate = new Date(gameId)
  const contextGameIds: GameId[] = []
  for (let i = -avoidPastGamesCount; i <= avoidNextGamesCount; i++) {
    const contextDate = new Date(gameDate)
    contextDate.setDate(contextDate.getDate() + i)
    if (contextDate >= new Date('2025-01-01') && contextDate < new Date()) {
      contextGameIds.push(contextDate.toISOString().split('T')[0])
    }
  }

  const contextGames = await getGamesByIds(contextGameIds)
  const disallowedCategories = Object.values(contextGames).flatMap((game) => Object.keys(game.categories))

  const categoryThemeCount = getRandomSample(VALID_THEME_COUNTS, 1)[0]
  const categoryThemes = getRandomSample(themes, categoryThemeCount)

  const inspirationNouns = getRandomSample(nouns, inspirationNounsCount)
  const inspirationVerbs = getRandomSample(verbs, inspirationVerbsCount)
  const inspirationAdjectives = getRandomSample(adjectives, inspirationAdjectivesCount)

  const modelContext = {
    categoryThemes,
    disallowedCategories,
    inspirationAdjectives,
    inspirationNouns,
    inspirationVerbs,
  }
  log('Creating game with context', { modelContext })

  const prompt = await getPromptById(llmPromptId)
  const connectionsData = (await invokeModel(prompt, modelContext)) as ConnectionsData
  const wordList = Object.values(connectionsData.categories).flatMap((cat) => cat.words)

  if (new Set(wordList).size !== wordList.length) {
    throw new Error('Generated words are not unique')
  }

  const dataWithWordList = { ...connectionsData, wordList }
  await setGameById(gameId, dataWithWordList)
  return dataWithWordList
}
