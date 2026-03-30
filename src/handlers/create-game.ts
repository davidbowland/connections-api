import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { ScheduledEvent } from 'aws-lambda'

import { maxGameGenerationAttempts } from '../config'
import { resetGameGenerationStarted, setGameGenerationStarted } from '../services/dynamodb'
import { createGame } from '../services/games'
import { log, xrayCapture } from '../utils/logging'

interface CreateGameEvent {
  gameId?: string
  attempt?: number
  generationStartedAt?: number
}

const lambda = xrayCapture(new LambdaClient({ apiVersion: '2012-08-10' }))

const nextGameId = (): string => {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.toISOString().split('T')[0]
}

export const createGameHandler = async (event: ScheduledEvent | CreateGameEvent): Promise<void> => {
  log('Received event', { event })

  const {
    gameId: eventGameId,
    attempt = 1,
    generationStartedAt: eventGenerationStartedAt,
  } = event as CreateGameEvent
  const gameId = eventGameId ?? nextGameId()
  log('Creating game', { attempt, gameId })

  let generationStartedAt: number
  if (attempt === 1) {
    const result = await setGameGenerationStarted(gameId)
    if (result === false) {
      log('Game already exists or is being generated, skipping creation', { gameId })
      return
    }
    generationStartedAt = result
  } else {
    const result = await resetGameGenerationStarted(gameId, eventGenerationStartedAt as number)
    if (result === false) {
      log('Generation lock no longer owned by this run, skipping', { gameId })
      return
    }
    generationStartedAt = result
  }

  try {
    const game = await createGame(gameId)
    log('Game created successfully', { game, gameId })
  } catch (error: unknown) {
    if (attempt < maxGameGenerationAttempts) {
      log('Game creation failed, invoking self for retry', { attempt, error, gameId })
      try {
        await lambda.send(
          new InvokeCommand({
            FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
            InvocationType: 'Event',
            Payload: JSON.stringify({ gameId, attempt: attempt + 1, generationStartedAt }),
          }),
        )
      } catch (invokeError: unknown) {
        log('Failed to invoke self for retry', { attempt, gameId, invokeError })
      }
    } else {
      log('Game creation failed at max attempts, giving up', { attempt, error, gameId })
    }
  }
}
