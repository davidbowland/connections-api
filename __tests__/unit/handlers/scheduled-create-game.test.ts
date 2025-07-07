import { ScheduledEvent } from 'aws-lambda'

import { connectionsData, prompt } from '../__mocks__'
import { scheduledCreateGameHandler } from '@handlers/scheduled-create-game'
import * as bedrock from '@services/bedrock'
import * as dynamodb from '@services/dynamodb'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

const scheduledEvent = {
  'detail-type': 'Scheduled Event',
  source: 'aws.events',
} as ScheduledEvent

describe('scheduled-create-game', () => {
  beforeAll(() => {
    jest.mocked(bedrock).invokeModel.mockResolvedValue(connectionsData)
    jest.mocked(dynamodb).getGameById.mockRejectedValue(new Error('Game not found'))
    jest.mocked(dynamodb).getPromptById.mockResolvedValue(prompt)
    jest.mocked(dynamodb).setGameById.mockResolvedValue({} as any)
  })

  describe('scheduledCreateGameHandler', () => {
    it('should create a game for today when game does not exist', async () => {
      jest.mocked(dynamodb).getGameById.mockRejectedValue(new Error('Game not found'))

      await scheduledCreateGameHandler(scheduledEvent)

      expect(dynamodb.getGameById).toHaveBeenCalledWith(expect.any(String))
      expect(dynamodb.getPromptById).toHaveBeenCalledWith('create-connections-game')
      expect(dynamodb.setGameById).toHaveBeenCalledWith(expect.any(String), connectionsData)
    })

    it('should not create a game when game already exists', async () => {
      jest.mocked(dynamodb).getGameById.mockResolvedValue(connectionsData)

      await scheduledCreateGameHandler(scheduledEvent)

      expect(dynamodb.getGameById).toHaveBeenCalledWith(expect.any(String))
      expect(dynamodb.getPromptById).not.toHaveBeenCalled()
      expect(dynamodb.setGameById).not.toHaveBeenCalled()
    })
  })
})
