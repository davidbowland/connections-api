import { llmPromptId } from '../config'
import { ConnectionsData, GameId } from '../types'
import { log } from '../utils/logging'
import { invokeModel } from './bedrock'
import { getGamesByIds, getPromptById, setGameById } from './dynamodb'

export const createGame = async (gameId: GameId): Promise<ConnectionsData> => {
  const gameDate = new Date(gameId)
  const contextGameIds: GameId[] = []
  for (let i = -60; i <= 60; i++) {
    const contextDate = new Date(gameDate)
    contextDate.setDate(contextDate.getDate() + i)
    if (contextDate >= new Date('2025-01-01') && contextDate < new Date()) {
      contextGameIds.push(contextDate.toISOString().split('T')[0])
    }
  }

  const contextGames = await getGamesByIds(contextGameIds)
  const disallowedCategories = Object.values(contextGames).flatMap((game) => Object.keys(game.categories))
  const disallowedWords = Object.values(contextGames).flatMap((game) =>
    Object.values(game.categories).flatMap((cat) => cat.words),
  )

  const prompt = await getPromptById(llmPromptId)
  const connectionsData = (await invokeModel(prompt, { disallowedCategories, disallowedWords })) as ConnectionsData
  const wordList = Object.values(connectionsData.categories).flatMap((cat) => cat.words)

  if (new Set(wordList).size !== wordList.length) {
    throw new Error('Generated words are not unique')
  }

  const hasOverlap = wordList.some((word) => disallowedWords.includes(word))
  if (hasOverlap) {
    log('Generated words overlap with avoid words', {
      bannedWords: wordList.filter((word) => disallowedWords.includes(word)),
      wordList,
    })
    throw new Error('Generated words overlap with avoid words')
  }

  const dataWithWordList = { ...connectionsData, wordList }
  await setGameById(gameId, dataWithWordList)
  return dataWithWordList
}
