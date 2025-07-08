import { llmPromptId } from '../config'
import { invokeModel } from '../services/bedrock'
import { getGameById, getGamesByIds, getPromptById, setGameById } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, ConnectionsData, GameId } from '../types'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

const isValidGameId = (gameId: string): boolean => {
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!isoDateRegex.test(gameId)) {
    return false
  }

  const date = new Date(gameId)
  const startDate = new Date('2025-01-01')
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)

  return date >= startDate && date < tomorrow && date.toISOString().split('T')[0] === gameId
}

const getConnectionsData = async (gameId: GameId): Promise<ConnectionsData> => {
  try {
    return await getGameById(gameId)
  } catch {
    log('Game not found, creating new game', { gameId })

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
    const avoidWords = Object.values(contextGames)
      .flatMap((game) => Object.values(game.categories).flatMap((cat) => cat.words))
      .join(', ')

    const prompt = await getPromptById(llmPromptId)
    const connectionsData = (await invokeModel(prompt, { avoidWords })) as ConnectionsData
    const wordList = Object.values(connectionsData.categories).flatMap((cat) => cat.words)
    const dataWithWordList = { ...connectionsData, wordList }

    await setGameById(gameId, dataWithWordList)
    return dataWithWordList
  }
}

export const getGameByIdHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2<any>> => {
  log('Received event', { ...event, body: undefined })

  try {
    const gameId: GameId | undefined = event.pathParameters?.gameId
    if (!gameId || !isValidGameId(gameId)) {
      log('Invalid gameId', { gameId })
      return { ...status.BAD_REQUEST, body: JSON.stringify({ error: 'Invalid gameId' }) }
    }

    const connectionsData = await getConnectionsData(gameId)
    return { ...status.OK, body: JSON.stringify({ categories: connectionsData.categories }) }
  } catch (error: unknown) {
    logError('getGameHandler', { error })
    return { ...status.INTERNAL_SERVER_ERROR, body: JSON.stringify({ error: 'Error retrieving game' }) }
  }
}
