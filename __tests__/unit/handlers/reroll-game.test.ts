import { gameId } from '../__mocks__'
import { rerollGameHandler } from '@handlers/reroll-game'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

const mockSsmSend = jest.fn()
const mockLambdaSend = jest.fn()

jest.mock('@aws-sdk/client-ssm', () => ({
  GetParameterCommand: jest.fn().mockImplementation((x) => x),
  SSMClient: jest.fn(() => ({
    send: (...args) => mockSsmSend(...args),
  })),
}))
jest.mock('@aws-sdk/client-lambda', () => ({
  InvokeCommand: jest.fn().mockImplementation((x) => x),
  LambdaClient: jest.fn(() => ({
    send: (...args) => mockLambdaSend(...args),
  })),
}))
jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

const password = 'test-password'

describe('reroll-game', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2025-01-05'))
  })

  beforeEach(() => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: password } })
    mockLambdaSend.mockResolvedValue({})
    jest.mocked(dynamodb).deleteGameById.mockResolvedValue(undefined)
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('rerollGameHandler', () => {
    it('deletes game, invokes create-game lambda, and returns 202 on valid request', async () => {
      const result: any = await rerollGameHandler({
        pathParameters: { gameId },
        body: JSON.stringify({ password }),
      } as unknown as APIGatewayProxyEventV2)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.ACCEPTED.statusCode }))
      expect(JSON.parse(result.body)).toEqual({ message: 'Game is being regenerated' })
      expect(dynamodb.deleteGameById).toHaveBeenCalledWith(gameId)
      expect(mockLambdaSend).toHaveBeenCalledWith(
        expect.objectContaining({
          FunctionName: 'create-game-function',
          InvocationType: 'Event',
          Payload: JSON.stringify({ gameId }),
        }),
      )
    })

    it('returns 400 for a date before 2025-01-01', async () => {
      const result = await rerollGameHandler({
        pathParameters: { gameId: '2024-12-31' },
        body: JSON.stringify({ password }),
      } as unknown as APIGatewayProxyEventV2)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('returns 400 for invalid gameId format', async () => {
      const result = await rerollGameHandler({
        pathParameters: { gameId: 'invalid' },
        body: JSON.stringify({ password }),
      } as unknown as APIGatewayProxyEventV2)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      expect(JSON.parse((result as any).body)).toEqual({ error: 'Invalid gameId' })
    })

    it('returns 400 for missing gameId', async () => {
      const result = await rerollGameHandler({
        pathParameters: {},
        body: JSON.stringify({ password }),
      } as unknown as APIGatewayProxyEventV2)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('returns 400 for missing password', async () => {
      const result = await rerollGameHandler({
        pathParameters: { gameId },
        body: JSON.stringify({}),
      } as unknown as APIGatewayProxyEventV2)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      expect(JSON.parse((result as any).body)).toEqual({ error: 'Missing password' })
    })

    it('returns 400 for invalid JSON body', async () => {
      const result = await rerollGameHandler({
        pathParameters: { gameId },
        body: 'not-json',
      } as unknown as APIGatewayProxyEventV2)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      expect(JSON.parse((result as any).body)).toEqual({ error: 'Invalid request body' })
    })

    it('returns 403 for wrong password', async () => {
      const result = await rerollGameHandler({
        pathParameters: { gameId },
        body: JSON.stringify({ password: 'wrong-password' }),
      } as unknown as APIGatewayProxyEventV2)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.FORBIDDEN.statusCode }))
      expect(dynamodb.deleteGameById).not.toHaveBeenCalled()
    })

    it('returns 500 when SSM fails', async () => {
      mockSsmSend.mockRejectedValueOnce(new Error('SSM error'))

      const result = await rerollGameHandler({
        pathParameters: { gameId },
        body: JSON.stringify({ password }),
      } as unknown as APIGatewayProxyEventV2)

      expect(result).toEqual(
        expect.objectContaining({ statusCode: status.INTERNAL_SERVER_ERROR.statusCode }),
      )
      expect(dynamodb.deleteGameById).not.toHaveBeenCalled()
    })

    it('returns 202 when lambda invocation fails', async () => {
      mockLambdaSend.mockRejectedValueOnce(new Error('Lambda error'))

      const result: any = await rerollGameHandler({
        pathParameters: { gameId },
        body: JSON.stringify({ password }),
      } as unknown as APIGatewayProxyEventV2)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.ACCEPTED.statusCode }))
      expect(dynamodb.deleteGameById).toHaveBeenCalledWith(gameId)
    })

    it('returns 500 when DynamoDB delete fails', async () => {
      jest.mocked(dynamodb).deleteGameById.mockRejectedValueOnce(new Error('DynamoDB error'))

      const result = await rerollGameHandler({
        pathParameters: { gameId },
        body: JSON.stringify({ password }),
      } as unknown as APIGatewayProxyEventV2)

      expect(result).toEqual(
        expect.objectContaining({ statusCode: status.INTERNAL_SERVER_ERROR.statusCode }),
      )
      expect(mockLambdaSend).not.toHaveBeenCalled()
    })
  })
})
