import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'

import { connectionsData, gameId, prompt, promptConfig, promptId } from '../__mocks__'
import {
  deleteGameById,
  getGameById,
  getGamesByIds,
  getPromptById,
  resetGameGenerationStarted,
  setGameById,
  setGameGenerationStarted,
} from '@services/dynamodb'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb')
  return {
    BatchGetItemCommand: jest.fn().mockImplementation((x) => x),
    ConditionalCheckFailedException: actual.ConditionalCheckFailedException,
    DeleteItemCommand: jest.fn().mockImplementation((x) => x),
    DynamoDB: jest.fn(() => ({
      send: (...args) => mockSend(...args),
    })),
    GetItemCommand: jest.fn().mockImplementation((x) => x),
    PutItemCommand: jest.fn().mockImplementation((x) => x),
    QueryCommand: jest.fn().mockImplementation((x) => x),
  }
})
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

describe('dynamodb', () => {
  describe('getPromptById', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue({
        Items: [
          { Config: { S: JSON.stringify(promptConfig) }, SystemPrompt: { S: prompt.contents } },
        ],
      })
    })

    it('should call DynamoDB and parse the prompt', async () => {
      const result = await getPromptById(promptId)

      expect(mockSend).toHaveBeenCalledWith({
        ExpressionAttributeValues: { ':promptId': { S: `${promptId}` } },
        KeyConditionExpression: 'PromptId = :promptId',
        Limit: 1,
        ScanIndexForward: false,
        TableName: 'prompts-table',
      })
      expect(result).toEqual(prompt)
    })
  })

  describe('getGameById', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('should return game data when game exists', async () => {
      mockSend.mockResolvedValue({
        Item: { Data: { S: JSON.stringify(connectionsData) } },
      })

      const result = await getGameById(gameId)

      expect(mockSend).toHaveBeenCalledWith({
        Key: {
          GameId: { S: gameId },
        },
        TableName: 'games-table',
      })
      expect(result).toEqual({ game: connectionsData, isGenerating: false })
    })

    it('should return isGenerating true when generation started recently', async () => {
      const recentTime = Date.now() - 100000 // 100 seconds ago
      mockSend.mockResolvedValue({
        Item: { GenerationStarted: { N: recentTime.toString() } },
      })

      const result = await getGameById(gameId)

      expect(result).toEqual({ isGenerating: true })
    })

    it('should return isGenerating false when generation started long ago', async () => {
      const oldTime = Date.now() - 1_000_000 // 1000 seconds ago, beyond 900s timeout
      mockSend.mockResolvedValue({
        Item: { GenerationStarted: { N: oldTime.toString() } },
      })

      const result = await getGameById(gameId)

      expect(result).toEqual({ isGenerating: false })
    })

    it('should return isGenerating false when no item exists', async () => {
      mockSend.mockResolvedValue({})

      const result = await getGameById(gameId)

      expect(result).toEqual({ isGenerating: false })
    })
  })

  describe('getGamesByIds', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue({
        Responses: {
          'games-table': [
            { Data: { S: JSON.stringify(connectionsData) }, GameId: { S: '2025-01-01' } },
            { Data: { S: JSON.stringify(connectionsData) }, GameId: { S: '2025-01-02' } },
          ],
        },
      })
    })

    it('should call DynamoDB with batch request', async () => {
      const gameIds = ['2025-01-01', '2025-01-02']
      const result = await getGamesByIds(gameIds)

      expect(mockSend).toHaveBeenCalledWith({
        RequestItems: {
          'games-table': {
            Keys: [{ GameId: { S: '2025-01-01' } }, { GameId: { S: '2025-01-02' } }],
          },
        },
      })
      expect(result).toEqual({
        '2025-01-01': connectionsData,
        '2025-01-02': connectionsData,
      })
    })

    it('should return empty object for empty input', async () => {
      const result = await getGamesByIds([])
      expect(result).toEqual({})
    })
  })

  describe('setGameById', () => {
    it('should call DynamoDB with the correct arguments', async () => {
      await setGameById(gameId, connectionsData)

      expect(mockSend).toHaveBeenCalledWith({
        Item: {
          Data: {
            S: JSON.stringify(connectionsData),
          },
          GameId: {
            S: gameId,
          },
        },
        TableName: 'games-table',
      })
    })
  })

  describe('setGameGenerationStarted', () => {
    it('should call DynamoDB with GenerationStarted timestamp and condition expression', async () => {
      const mockNow = 1234567890
      jest.spyOn(Date, 'now').mockReturnValue(mockNow)

      const result = await setGameGenerationStarted(gameId)

      expect(result).toBe(mockNow)
      expect(mockSend).toHaveBeenCalledWith({
        ConditionExpression:
          'attribute_not_exists(GameId) OR (attribute_not_exists(#data) AND (attribute_not_exists(GenerationStarted) OR GenerationStarted < :expiry))',
        ExpressionAttributeNames: {
          '#data': 'Data',
        },
        ExpressionAttributeValues: {
          ':expiry': { N: `${mockNow - 900_000}` },
        },
        Item: {
          GameId: {
            S: gameId,
          },
          GenerationStarted: {
            N: mockNow.toString(),
          },
        },
        TableName: 'games-table',
      })

      jest.restoreAllMocks()
    })

    it('should return false when conditional check fails', async () => {
      mockSend.mockRejectedValueOnce(
        new ConditionalCheckFailedException({ $metadata: {}, message: 'Condition not met' }),
      )

      const result = await setGameGenerationStarted(gameId)

      expect(result).toBe(false)
    })

    it('should rethrow non-conditional-check errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'))

      await expect(setGameGenerationStarted(gameId)).rejects.toThrow('DynamoDB unavailable')
    })
  })

  describe('resetGameGenerationStarted', () => {
    it('should write new timestamp conditionally and return it', async () => {
      const mockNow = 1234567890
      const expectedTimestamp = 1000000000
      jest.spyOn(Date, 'now').mockReturnValue(mockNow)

      const result = await resetGameGenerationStarted(gameId, expectedTimestamp)

      expect(result).toBe(mockNow)
      expect(mockSend).toHaveBeenCalledWith({
        ConditionExpression: 'GenerationStarted = :expected',
        ExpressionAttributeValues: {
          ':expected': { N: String(expectedTimestamp) },
        },
        Item: {
          GameId: { S: gameId },
          GenerationStarted: { N: mockNow.toString() },
        },
        TableName: 'games-table',
      })

      jest.restoreAllMocks()
    })

    it('should return false when conditional check fails', async () => {
      mockSend.mockRejectedValueOnce(
        new ConditionalCheckFailedException({ $metadata: {}, message: 'Condition not met' }),
      )

      const result = await resetGameGenerationStarted(gameId, 1000000000)

      expect(result).toBe(false)
    })

    it('should rethrow non-conditional-check errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'))

      await expect(resetGameGenerationStarted(gameId, 1000000000)).rejects.toThrow(
        'DynamoDB unavailable',
      )
    })
  })

  describe('deleteGameById', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({})
    })

    it('should send DeleteItemCommand with correct params', async () => {
      await deleteGameById(gameId)

      expect(mockSend).toHaveBeenCalledWith({
        Key: {
          GameId: { S: gameId },
        },
        TableName: 'games-table',
      })
    })

    it('should propagate errors thrown by DynamoDB', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'))

      await expect(deleteGameById(gameId)).rejects.toThrow('DynamoDB unavailable')
    })
  })
})
