import { connectionsData, game, prompt } from '../__mocks__'
import { getGameByIdHandler } from '@handlers/get-game-by-id'
import * as bedrock from '@services/bedrock'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

jest.mock('@services/bedrock')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

const event = {
  pathParameters: { gameId: '2025-01-01' },
} as unknown as APIGatewayProxyEventV2

describe('get-game-by-id', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2025-01-05'))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('getGameByIdHandler', () => {
    it('returns existing game from database', async () => {
      jest.mocked(dynamodb).getGameById.mockResolvedValue(connectionsData)

      const result = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.OK.statusCode }))
      expect(JSON.parse(result.body)).toEqual(game)
      expect(dynamodb.getGameById).toHaveBeenCalledWith('2025-01-01')
    })

    it('creates and returns new game when not found', async () => {
      jest.mocked(dynamodb).getGameById.mockRejectedValue(new Error('Not found'))
      jest.mocked(dynamodb).getPromptById.mockResolvedValue(prompt)
      jest.mocked(bedrock).invokeModel.mockResolvedValue(connectionsData)

      const result = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.OK.statusCode }))
      expect(JSON.parse(result.body)).toEqual(game)
      expect(dynamodb.setGameById).toHaveBeenCalledWith('2025-01-01', connectionsData)
    })

    it('returns bad request for invalid gameId', async () => {
      const invalidEvent = {
        pathParameters: { gameId: 'invalid' },
      } as unknown as APIGatewayProxyEventV2

      const result = await getGameByIdHandler(invalidEvent)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      expect(JSON.parse(result.body)).toEqual({ error: 'Invalid gameId' })
    })

    it('returns bad request for future date', async () => {
      const futureEvent = {
        pathParameters: { gameId: '2025-01-10' },
      } as unknown as APIGatewayProxyEventV2

      const result = await getGameByIdHandler(futureEvent)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
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

    it('returns internal server error when prompt retrieval fails', async () => {
      jest.mocked(dynamodb).getGameById.mockRejectedValue(new Error('Not found'))
      jest.mocked(dynamodb).getPromptById.mockRejectedValue(new Error('Prompt error'))

      const result = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.INTERNAL_SERVER_ERROR.statusCode }))
      expect(JSON.parse(result.body)).toEqual({ error: 'Error retrieving game' })
    })

    it('returns internal server error when LLM invocation fails', async () => {
      jest.mocked(dynamodb).getGameById.mockRejectedValue(new Error('Not found'))
      jest.mocked(dynamodb).getPromptById.mockResolvedValue(prompt)
      jest.mocked(bedrock).invokeModel.mockRejectedValue(new Error('LLM error'))

      const result = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.INTERNAL_SERVER_ERROR.statusCode }))
    })

    it('returns internal server error when game save fails', async () => {
      jest.mocked(dynamodb).getGameById.mockRejectedValue(new Error('Not found'))
      jest.mocked(dynamodb).getPromptById.mockResolvedValue(prompt)
      jest.mocked(bedrock).invokeModel.mockResolvedValue({ categories: game.categories, fakeCategories: {} })
      jest.mocked(dynamodb).setGameById.mockRejectedValue(new Error('Save error'))

      const result = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.INTERNAL_SERVER_ERROR.statusCode }))
    })
  })
})
