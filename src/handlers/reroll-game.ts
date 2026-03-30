import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'

import { createGameFunctionName, ssmRerollPasswordPath } from '../config'
import { deleteGameById } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, GameId } from '../types'
import { isValidGameId } from '../utils/game-id'
import { log, logError, xrayCapture } from '../utils/logging'
import status from '../utils/status'

const lambda = xrayCapture(new LambdaClient({ apiVersion: '2012-08-10' }))
const ssm = xrayCapture(new SSMClient({}))

const getPassword = async (): Promise<string> => {
  const command = new GetParameterCommand({
    Name: ssmRerollPasswordPath,
    WithDecryption: true,
  })
  const response = await ssm.send(command)
  return response.Parameter?.Value as string
}

export const rerollGameHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2<unknown>> => {
  log('Received event', { ...event, body: undefined })

  const gameId: GameId | undefined = event.pathParameters?.gameId
  if (!gameId || !isValidGameId(gameId)) {
    log('Invalid gameId', { gameId })
    return { ...status.BAD_REQUEST, body: JSON.stringify({ error: 'Invalid gameId' }) }
  }

  let body: { password?: string }
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return { ...status.BAD_REQUEST, body: JSON.stringify({ error: 'Invalid request body' }) }
  }

  if (!body.password) {
    return { ...status.BAD_REQUEST, body: JSON.stringify({ error: 'Missing password' }) }
  }

  let expectedPassword: string
  try {
    expectedPassword = await getPassword()
  } catch (error: unknown) {
    logError('Failed to retrieve password from SSM', { error })
    return status.INTERNAL_SERVER_ERROR
  }

  if (body.password !== expectedPassword) {
    log('Invalid password provided', { gameId })
    return status.FORBIDDEN
  }

  try {
    await deleteGameById(gameId)
    log('Game deleted', { gameId })
  } catch (error: unknown) {
    logError('Failed to delete game', { error, gameId })
    return status.INTERNAL_SERVER_ERROR
  }

  const command = new InvokeCommand({
    FunctionName: createGameFunctionName,
    InvocationType: 'Event',
    Payload: JSON.stringify({ gameId }),
  })
  try {
    await lambda.send(command)
    log('Create game lambda invoked', { gameId })
  } catch (error: unknown) {
    logError('Failed to invoke create game lambda', { error, gameId })
  }

  return { ...status.ACCEPTED, body: JSON.stringify({ message: 'Game is being regenerated' }) }
}
