import { llmPromptId } from '../config'
import { invokeModel } from '../services/bedrock'
import { getGameById, getPromptById, setGameById } from '../services/dynamodb'
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
    const prompt = await getPromptById(llmPromptId)
    const connectionsData = (await invokeModel(prompt)) as ConnectionsData

    await setGameById(gameId, connectionsData)
    return connectionsData
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
    const game = { categories: connectionsData.categories }
    return { ...status.OK, body: JSON.stringify(game) }
  } catch (error: unknown) {
    logError('getGameHandler', { error })
    return { ...status.INTERNAL_SERVER_ERROR, body: JSON.stringify({ error: 'Error retrieving game' }) }
  }
}
