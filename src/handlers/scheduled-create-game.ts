import { ScheduledEvent } from 'aws-lambda'

import { llmPromptId } from '../config'
import { invokeModel } from '../services/bedrock'
import { getGameById, getPromptById, setGameById } from '../services/dynamodb'
import { ConnectionsData } from '../types'
import { log } from '../utils/logging'

export const scheduledCreateGameHandler = async (event: ScheduledEvent): Promise<void> => {
  log('Received scheduled event', { event })

  const gameId = new Date().toISOString().split('T')[0] // GameId is the date in YYYY-MM-DD
  const gameExists = await getGameById(gameId)
    .then(() => true)
    .catch(() => false)
  if (!gameExists) {
    const prompt = await getPromptById(llmPromptId)
    const connectionsData = (await invokeModel(prompt)) as ConnectionsData
    log('Connections data', { connectionsData })

    await setGameById(gameId, connectionsData)
  }
}
