import { connectionsData, gameId } from '../__mocks__'
import { getGameByIdHandler } from '@handlers/get-game-by-id'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-lambda', () => ({
  InvokeCommand: jest.fn().mockImplementation((x) => x),
  LambdaClient: jest.fn(() => ({
    send: (...args) => mockSend(...args),
  })),
}))
jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

const event = {
  pathParameters: { gameId },
} as unknown as APIGatewayProxyEventV2

describe('get-game-by-id', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2025-01-05'))

    jest
      .mocked(dynamodb)
      .getGameById.mockResolvedValue({ game: connectionsData, isGenerating: false })
    mockSend.mockResolvedValue({})
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('getGameByIdHandler', () => {
    it('returns existing game from database', async () => {
      const result: any = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.OK.statusCode }))
      expect(JSON.parse(result.body)).toEqual({ categories: connectionsData.categories })
      expect(dynamodb.getGameById).toHaveBeenCalledWith('2025-01-01')
    })

    it('returns 202 Accepted and invokes create-game when game not found', async () => {
      jest.mocked(dynamodb).getGameById.mockResolvedValueOnce({ isGenerating: false })

      const result: any = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.ACCEPTED.statusCode }))
      expect(JSON.parse(result.body)).toEqual({ message: 'Game is being generated' })
      expect(mockSend).toHaveBeenCalled()
    })

    it('returns 202 Accepted when game is already being generated', async () => {
      jest.mocked(dynamodb).getGameById.mockResolvedValueOnce({ isGenerating: true })

      const result: any = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.ACCEPTED.statusCode }))
      expect(JSON.parse(result.body)).toEqual({ message: 'Game is being generated' })
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('returns bad request for future date', async () => {
      const futureEvent = {
        pathParameters: { gameId: '2025-01-10' },
      } as unknown as APIGatewayProxyEventV2

      const result = await getGameByIdHandler(futureEvent)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('returns bad request for invalid gameId', async () => {
      const invalidEvent = {
        pathParameters: { gameId: 'invalid' },
      } as unknown as APIGatewayProxyEventV2

      const result: any = await getGameByIdHandler(invalidEvent)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      expect(JSON.parse(result.body)).toEqual({ error: 'Invalid gameId' })
    })

    it('returns bad request for missing gameId', async () => {
      const noGameIdEvent = {
        pathParameters: {},
      } as unknown as APIGatewayProxyEventV2

      const result = await getGameByIdHandler(noGameIdEvent)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('returns bad request for date before 2025-01-01', async () => {
      const pastEvent = {
        pathParameters: { gameId: '2024-12-31' },
      } as unknown as APIGatewayProxyEventV2

      const result = await getGameByIdHandler(pastEvent)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('handles lambda invocation failure gracefully', async () => {
      jest.mocked(dynamodb).getGameById.mockResolvedValueOnce({ isGenerating: false })
      mockSend.mockRejectedValueOnce(new Error('Lambda invocation failed'))

      const result: any = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.ACCEPTED.statusCode }))
      expect(JSON.parse(result.body)).toEqual({ message: 'Game is being generated' })
    })

    it('handles getGameById error and returns isGenerating false', async () => {
      jest.mocked(dynamodb).getGameById.mockRejectedValueOnce(new Error('DynamoDB error'))

      const result: any = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.ACCEPTED.statusCode }))
      expect(JSON.parse(result.body)).toEqual({ message: 'Game is being generated' })
    })
  })
})
