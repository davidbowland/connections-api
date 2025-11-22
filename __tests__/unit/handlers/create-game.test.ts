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
    jest.mocked(dynamodb).getGameById.mockResolvedValue({ isGenerating: false })
    jest.mocked(dynamodb).setGameGenerationStarted.mockResolvedValue({} as any)
    jest.mocked(games).createGame.mockResolvedValue(connectionsData)

    jest.useFakeTimers()
    jest.setSystemTime(new Date(today))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('createGameHandler', () => {
    it('should create a game for today when game does not exist and no gameId provided', async () => {
      await createGameHandler(scheduledEvent)

      expect(dynamodb.getGameById).toHaveBeenCalledWith(tomorrow)
      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith(tomorrow)
      expect(games.createGame).toHaveBeenCalledWith(tomorrow)
    })

    it('should create a game for specified gameId when provided', async () => {
      await createGameHandler(event)

      expect(dynamodb.getGameById).toHaveBeenCalledWith(gameId)
      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith(gameId)
      expect(games.createGame).toHaveBeenCalledWith(gameId)
    })

    it('should not create a game when game already exists', async () => {
      jest
        .mocked(dynamodb)
        .getGameById.mockResolvedValueOnce({ game: connectionsData, isGenerating: false })

      await createGameHandler(scheduledEvent)

      expect(dynamodb.getGameById).toHaveBeenCalledWith(expect.any(String))
      expect(dynamodb.setGameGenerationStarted).not.toHaveBeenCalled()
      expect(games.createGame).not.toHaveBeenCalled()
    })

    it('should not create a game when game is already being generated', async () => {
      jest.mocked(dynamodb).getGameById.mockResolvedValueOnce({ isGenerating: true })

      await createGameHandler(scheduledEvent)

      expect(dynamodb.getGameById).toHaveBeenCalledWith(expect.any(String))
      expect(dynamodb.setGameGenerationStarted).not.toHaveBeenCalled()
      expect(games.createGame).not.toHaveBeenCalled()
    })

    it('should retry on game creation failure', async () => {
      jest.mocked(dynamodb).getGameById.mockResolvedValueOnce({ isGenerating: false })
      jest.mocked(games).createGame.mockRejectedValueOnce(new Error('Creation failed'))

      await createGameHandler(scheduledEvent)

      expect(games.createGame).toHaveBeenCalledTimes(2)
    })
  })
})
