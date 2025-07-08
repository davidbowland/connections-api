import { ScheduledEvent } from 'aws-lambda'

import { getGameById } from '../services/dynamodb'
import { createGame } from '../services/games'
import { log } from '../utils/logging'

export const scheduledCreateGameHandler = async (event: ScheduledEvent): Promise<void> => {
  log('Received scheduled event', { event })

  const gameId = new Date().toISOString().split('T')[0]
  log('Creating game', { gameId })

  const gameExists = await getGameById(gameId)
    .then(() => true)
    .catch(() => false)
  if (gameExists) {
    log('Game already exists, skipping creation', { gameId })
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
