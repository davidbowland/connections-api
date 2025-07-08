import { ScheduledEvent } from 'aws-lambda'

import { connectionsData } from '../__mocks__'
import { scheduledCreateGameHandler } from '@handlers/scheduled-create-game'
import * as dynamodb from '@services/dynamodb'
import * as games from '@services/games'

jest.mock('@services/dynamodb')
jest.mock('@services/games')
jest.mock('@utils/logging')

const scheduledEvent = {
  'detail-type': 'Scheduled Event',
  source: 'aws.events',
} as ScheduledEvent

describe('scheduled-create-game', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('scheduledCreateGameHandler', () => {
    it('should create a game for today when game does not exist', async () => {
      jest.mocked(dynamodb).getGameById.mockRejectedValue(new Error('Game not found'))
      jest.mocked(games).createGame.mockResolvedValue(connectionsData)

      await scheduledCreateGameHandler(scheduledEvent)

      expect(dynamodb.getGameById).toHaveBeenCalledWith(expect.any(String))
      expect(games.createGame).toHaveBeenCalledWith(expect.any(String))
    })

    it('should not create a game when game already exists', async () => {
      jest.mocked(dynamodb).getGameById.mockResolvedValue(connectionsData)

      await scheduledCreateGameHandler(scheduledEvent)

      expect(dynamodb.getGameById).toHaveBeenCalledWith(expect.any(String))
      expect(games.createGame).not.toHaveBeenCalled()
    })

    it('should retry on game creation failure', async () => {
      jest.mocked(dynamodb).getGameById.mockRejectedValue(new Error('Game not found'))
      jest
        .mocked(games)
        .createGame.mockRejectedValueOnce(new Error('Creation failed'))
        .mockResolvedValue(connectionsData)

      await scheduledCreateGameHandler(scheduledEvent)

      expect(games.createGame).toHaveBeenCalledTimes(2)
    })
  })
})
