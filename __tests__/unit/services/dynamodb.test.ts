import { connectionsData, gameId, prompt, promptConfig, promptId } from '../__mocks__'
import { getGameById, getPromptById, setGameById } from '@services/dynamodb'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
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
