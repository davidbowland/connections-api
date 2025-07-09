import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

import { getGameById, GameResult } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, GameId } from '../types'
import { log, logError, xrayCapture } from '../utils/logging'
import status from '../utils/status'

const lambda = xrayCapture(new LambdaClient({ apiVersion: '2012-08-10' }))

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

const getConnectionsData = async (gameId: GameId): Promise<GameResult> => {
  log('Retrieving game', { gameId })
  try {
    return await getGameById(gameId)
  } catch (error: unknown) {
    log('Error retrieving game', { error, gameId })
    return { isGenerating: false }
  }
}

export const getGameByIdHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2<unknown>> => {
  log('Received event', { ...event, body: undefined })

  // We don't need try / catch here because all errors are caught
  const gameId: GameId | undefined = event.pathParameters?.gameId
  if (!gameId || !isValidGameId(gameId)) {
    log('Invalid gameId', { gameId })
    return { ...status.BAD_REQUEST, body: JSON.stringify({ error: 'Invalid gameId' }) }
  }

  const gameResult = await getConnectionsData(gameId)

  if (!gameResult.game) {
    if (!gameResult.isGenerating) {
      // Invoke create-game lambda asynchronously
      const command = new InvokeCommand({
        FunctionName: process.env.CREATE_GAME_FUNCTION_NAME,
        InvocationType: 'Event',
        Payload: JSON.stringify({ gameId }),
      })

      try {
        await lambda.send(command)
        log('Create game lambda invoked', { gameId })
      } catch (error) {
        logError('Failed to invoke create game lambda', { error, gameId })
      }
    }
    return { ...status.ACCEPTED, body: JSON.stringify({ message: 'Game is being generated' }) }
  }

  log('Returning game data', { connectionsData: JSON.stringify(gameResult.game, null, 2) })
  return { ...status.OK, body: JSON.stringify({ categories: gameResult.game.categories }) }
}
