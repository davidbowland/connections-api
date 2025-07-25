import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log } from '../utils/logging'
import status from '../utils/status'

export const getGameIdsHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2<unknown>> => {
  log('Received event', { ...event, body: undefined })

  const startDate = new Date('2025-01-01')
  const gameIds: string[] = []
  for (const d = new Date(); d >= startDate; d.setDate(d.getDate() - 1)) {
    gameIds.push(d.toISOString().split('T')[0])
  }

  return { ...status.OK, body: JSON.stringify({ gameIds }) }
}
