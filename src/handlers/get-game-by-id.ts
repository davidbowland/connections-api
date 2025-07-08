import { getGameById } from '../services/dynamodb'
import { createGame } from '../services/games'
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
  log('Retrieving game', { gameId })
  try {
    return await getGameById(gameId)
  } catch {
    log('Game not found, creating new game', { gameId })
    const game = await createGame(gameId)

    log('New game created', { game, gameId })
    return game
  }
}

export const getGameByIdHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2<unknown>> => {
  log('Received event', { ...event, body: undefined })

  try {
    const gameId: GameId | undefined = event.pathParameters?.gameId
    if (!gameId || !isValidGameId(gameId)) {
      log('Invalid gameId', { gameId })
      return { ...status.BAD_REQUEST, body: JSON.stringify({ error: 'Invalid gameId' }) }
    }

    const connectionsData = await getConnectionsData(gameId)
    log('Returning game data', { connectionsData: JSON.stringify(connectionsData, null, 2) })
    return { ...status.OK, body: JSON.stringify({ categories: connectionsData.categories }) }
  } catch (error: unknown) {
    const isContentError = error instanceof Error && error.message.includes('Generated words')
    if (isContentError) {
      log('Content generation error', { error })
    } else {
      logError('getGameHandler', { error })
    }
    return { ...status.INTERNAL_SERVER_ERROR, body: JSON.stringify({ error: 'Error retrieving game' }) }
  }
}
