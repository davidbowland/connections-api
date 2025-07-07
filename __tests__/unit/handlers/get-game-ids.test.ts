import eventJson from '@events/get-game-ids.json'
import { getGameIdsHandler } from '@handlers/get-game-ids'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

jest.mock('@utils/logging')

describe('get-game-ids', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.useFakeTimers()
  })

  beforeEach(() => {
    jest.setSystemTime(new Date('2025-01-05'))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('getGameIdsHandler', () => {
    it('returns game IDs from January 1, 2025 to today', async () => {
      const result = await getGameIdsHandler(event)
      const body = JSON.parse(result.body)

      expect(result).toEqual(expect.objectContaining(status.OK))
      expect(body.gameIds).toEqual(['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05'])
    })

    it('returns single game ID when today is January 1, 2025', async () => {
      jest.setSystemTime(new Date('2025-01-01'))

      const result = await getGameIdsHandler(event)
      const body = JSON.parse(result.body)

      expect(body.gameIds).toEqual(['2025-01-01'])
    })
  })
})
