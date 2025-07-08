import { connectionsData, gameId, prompt, promptConfig, promptId } from '../__mocks__'
import { getGameById, getGamesByIds, getPromptById, setGameById } from '@services/dynamodb'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
  BatchGetItemCommand: jest.fn().mockImplementation((x) => x),
  DynamoDB: jest.fn(() => ({
    send: (...args) => mockSend(...args),
  })),
  GetItemCommand: jest.fn().mockImplementation((x) => x),
  PutItemCommand: jest.fn().mockImplementation((x) => x),
  QueryCommand: jest.fn().mockImplementation((x) => x),
}))
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

describe('dynamodb', () => {
  describe('getPromptById', () => {
    beforeAll(() => {
      mockSend.mockResolvedValue({
        Items: [{ Config: { S: JSON.stringify(promptConfig) }, SystemPrompt: { S: prompt.contents } }],
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
    beforeAll(() => {
      mockSend.mockResolvedValue({
        Item: { Data: { S: JSON.stringify(connectionsData) } },
      })
    })

    it('should call DynamoDB with the correct arguments', async () => {
      const result = await getGameById(gameId)

      expect(mockSend).toHaveBeenCalledWith({
        Key: {
          GameId: { S: gameId },
        },
        TableName: 'games-table',
      })
      expect(result).toEqual(connectionsData)
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
})
