import { ScheduledEvent } from 'aws-lambda'

import { getGameById, setGameGenerationStarted } from '../services/dynamodb'
import { createGame } from '../services/games'
import { log } from '../utils/logging'

interface CreateGameEvent {
  gameId?: string
}

export const createGameHandler = async (event: ScheduledEvent | CreateGameEvent): Promise<void> => {
  log('Received event', { event })

  const gameId = (event as CreateGameEvent).gameId ?? new Date().toISOString().split('T')[0]
  log('Creating game', { gameId })

  const gameResult = await getGameById(gameId)
  if (gameResult.game) {
    log('Game already exists, skipping creation', { gameId })
    return
  } else if (gameResult.isGenerating) {
    log('Game is already being generated, skipping creation', { gameId })
    return
  }
  await setGameGenerationStarted(gameId)

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
