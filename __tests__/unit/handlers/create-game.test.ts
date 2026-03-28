import { ScheduledEvent } from 'aws-lambda'

import { connectionsData, gameId } from '../__mocks__'
import eventJson from '@events/create-game.json'
import { createGameHandler } from '@handlers/create-game'
import * as dynamodb from '@services/dynamodb'
import * as games from '@services/games'

jest.mock('@services/dynamodb')
jest.mock('@services/games')
jest.mock('@utils/logging')

const scheduledEvent = {
  'detail-type': 'Scheduled Event',
  source: 'aws.events',
} as ScheduledEvent

describe('create-game', () => {
  const event = eventJson as { gameId?: string }

  const today = '2025-01-05'
  const tomorrow = '2025-01-06'

  beforeAll(() => {
    jest.mocked(dynamodb).setGameGenerationStarted.mockResolvedValue(true)
    jest.mocked(games).createGame.mockResolvedValue(connectionsData)

    jest.useFakeTimers()
    jest.setSystemTime(new Date(today))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('createGameHandler', () => {
    it('should create a game for tomorrow when no gameId provided', async () => {
      await createGameHandler(scheduledEvent)

      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith(tomorrow)
      expect(games.createGame).toHaveBeenCalledWith(tomorrow)
    })

    it('should create a game for specified gameId when provided', async () => {
      await createGameHandler(event)

      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith(gameId)
      expect(games.createGame).toHaveBeenCalledWith(gameId)
    })

    it('should not create a game when generation lock is not acquired', async () => {
      jest.mocked(dynamodb).setGameGenerationStarted.mockResolvedValueOnce(false)

      await createGameHandler(scheduledEvent)

      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith(tomorrow)
      expect(games.createGame).not.toHaveBeenCalled()
    })

    it('should rethrow errors from setGameGenerationStarted', async () => {
      jest
        .mocked(dynamodb)
        .setGameGenerationStarted.mockRejectedValueOnce(new Error('DynamoDB unavailable'))

      await expect(createGameHandler(scheduledEvent)).rejects.toThrow('DynamoDB unavailable')
      expect(games.createGame).not.toHaveBeenCalled()
    })

    it('should retry on game creation failure', async () => {
      jest.mocked(games).createGame.mockRejectedValueOnce(new Error('Creation failed'))

      await createGameHandler(scheduledEvent)

      expect(games.createGame).toHaveBeenCalledTimes(2)
    })
  })
})
