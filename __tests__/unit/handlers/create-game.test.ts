import { ScheduledEvent } from 'aws-lambda'

import { connectionsData } from '../__mocks__'
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

const createGameEvent = {
  gameId: '2025-01-15',
}

describe('create-game', () => {
  beforeAll(() => {
    jest.mocked(dynamodb).getGameById.mockResolvedValue({ isGenerating: false })
    jest.mocked(dynamodb).setGameGenerationStarted.mockResolvedValue({} as any)
    jest.mocked(games).createGame.mockResolvedValue(connectionsData)
  })

  describe('createGameHandler', () => {
    it('should create a game for today when game does not exist and no gameId provided', async () => {
      await createGameHandler(scheduledEvent)

      expect(dynamodb.getGameById).toHaveBeenCalledWith(expect.any(String))
      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith(expect.any(String))
      expect(games.createGame).toHaveBeenCalledWith(expect.any(String))
    })

    it('should create a game for specified gameId when provided', async () => {
      await createGameHandler(createGameEvent)

      expect(dynamodb.getGameById).toHaveBeenCalledWith('2025-01-15')
      expect(dynamodb.setGameGenerationStarted).toHaveBeenCalledWith('2025-01-15')
      expect(games.createGame).toHaveBeenCalledWith('2025-01-15')
    })

    it('should not create a game when game already exists', async () => {
      jest.mocked(dynamodb).getGameById.mockResolvedValueOnce({ game: connectionsData, isGenerating: false })

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
