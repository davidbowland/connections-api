import { connectionsData, game } from '../__mocks__'
import { getGameByIdHandler } from '@handlers/get-game-by-id'
import * as dynamodb from '@services/dynamodb'
import * as games from '@services/games'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@services/games')
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

      const result: any = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.OK.statusCode }))
      expect(JSON.parse(result.body)).toEqual(game)
      expect(dynamodb.getGameById).toHaveBeenCalledWith('2025-01-01')
    })

    it('creates and returns new game when not found', async () => {
      jest.mocked(dynamodb).getGameById.mockRejectedValue(new Error('Not found'))
      jest.mocked(games).createGame.mockResolvedValue(connectionsData)

      const result: any = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.OK.statusCode }))
      expect(JSON.parse(result.body)).toEqual(game)
      expect(games.createGame).toHaveBeenCalledWith('2025-01-01')
    })

    it('returns bad request for invalid gameId', async () => {
      const invalidEvent = {
        pathParameters: { gameId: 'invalid' },
      } as unknown as APIGatewayProxyEventV2

      const result: any = await getGameByIdHandler(invalidEvent)

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

    it('returns internal server error when game creation fails', async () => {
      jest.mocked(dynamodb).getGameById.mockRejectedValue(new Error('Not found'))
      jest.mocked(games).createGame.mockRejectedValue(new Error('Creation error'))

      const result: any = await getGameByIdHandler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: status.INTERNAL_SERVER_ERROR.statusCode }))
      expect(JSON.parse(result.body)).toEqual({ error: 'Error retrieving game' })
    })
  })
})
