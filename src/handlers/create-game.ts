import { ScheduledEvent } from 'aws-lambda'

import { setGameGenerationStarted } from '../services/dynamodb'
import { createGame } from '../services/games'
import { log } from '../utils/logging'

interface CreateGameEvent {
  gameId?: string
}

const nextGameId = (): string => {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.toISOString().split('T')[0]
}

export const createGameHandler = async (event: ScheduledEvent | CreateGameEvent): Promise<void> => {
  log('Received event', { event })

  const gameId = (event as CreateGameEvent).gameId ?? nextGameId()
  log('Creating game', { gameId })

  const acquired = await setGameGenerationStarted(gameId)
  if (!acquired) {
    log('Game already exists or is being generated, skipping creation', { gameId })
    return
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const game = await createGame(gameId)
      log('Game created successfully', { game, gameId })
      break
    } catch (error: unknown) {
      log('Game creation failed, retrying', { error, gameId })
    }
  }
}
