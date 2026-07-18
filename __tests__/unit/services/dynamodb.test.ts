import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'

import { connectionsData, gameId, prompt, promptConfig, promptId } from '../__mocks__'
import {
  deleteGameById,
  getAllGames,
  getGameById,
  getPromptById,
  resetGameGenerationStarted,
  setGameById,
  setGameGenerationStarted,
} from '@services/dynamodb'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb')
  return {
    ConditionalCheckFailedException: actual.ConditionalCheckFailedException,
    DeleteItemCommand: jest.fn().mockImplementation((x) => x),
    DynamoDB: jest.fn(() => ({
      send: (...args) => mockSend(...args),
    })),
    GetItemCommand: jest.fn().mockImplementation((x) => x),
    PutItemCommand: jest.fn().mockImplementation((x) => x),
    QueryCommand: jest.fn().mockImplementation((x) => x),
    ScanCommand: jest.fn().mockImplementation((x) => x),
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
    it('should return game data when game exists', async () => {
      mockSend.mockResolvedValueOnce({
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
      const now = 1_000_000_000_000
      mockSend.mockResolvedValueOnce({
        Item: { GenerationStarted: { N: (now - 100_000).toString() } },
      })

      const result = await getGameById(gameId, () => now)

      expect(result).toEqual({ isGenerating: true })
    })

    it('should return isGenerating false when generation started long ago', async () => {
      const now = 1_000_000_000_000
      mockSend.mockResolvedValueOnce({
        Item: { GenerationStarted: { N: (now - 1_000_000).toString() } },
      })

      const result = await getGameById(gameId, () => now)

      expect(result).toEqual({ isGenerating: false })
    })

    it('should return isGenerating false when no item exists', async () => {
      mockSend.mockResolvedValueOnce({})

      const result = await getGameById(gameId)

      expect(result).toEqual({ isGenerating: false })
    })
  })

  describe('getAllGames', () => {
    it('should scan the table and return games, skipping items without data', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { Data: { S: JSON.stringify(connectionsData) }, GameId: { S: '2025-01-01' } },
          { GameId: { S: '2025-01-02' }, GenerationStarted: { N: '1000' } },
        ],
      })

      const result = await getAllGames()

      expect(mockSend).toHaveBeenCalledWith({ TableName: 'games-table' })
      expect(result).toEqual({ '2025-01-01': connectionsData })
    })

    it('should follow pagination until all pages are scanned', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [{ Data: { S: JSON.stringify(connectionsData) }, GameId: { S: '2025-01-01' } }],
          LastEvaluatedKey: { GameId: { S: '2025-01-01' } },
        })
        .mockResolvedValueOnce({
          Items: [{ Data: { S: JSON.stringify(connectionsData) }, GameId: { S: '2025-01-02' } }],
        })

      const result = await getAllGames()

      expect(mockSend).toHaveBeenCalledWith({ TableName: 'games-table' })
      expect(mockSend).toHaveBeenCalledWith({
        ExclusiveStartKey: { GameId: { S: '2025-01-01' } },
        TableName: 'games-table',
      })
      expect(result).toEqual({
        '2025-01-01': connectionsData,
        '2025-01-02': connectionsData,
      })
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

      const result = await setGameGenerationStarted(gameId, () => mockNow)

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

      const result = await resetGameGenerationStarted(gameId, expectedTimestamp, () => mockNow)

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
    beforeAll(() => {
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
