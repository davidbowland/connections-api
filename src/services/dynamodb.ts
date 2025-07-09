import {
  BatchGetItemCommand,
  DynamoDB,
  GetItemCommand,
  PutItemCommand,
  PutItemOutput,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'

import { dynamodbGamesTableName, dynamodbPromptsTableName } from '../config'
import { ConnectionsData, GameId, Prompt, PromptId } from '../types'
import { xrayCapture } from '../utils/logging'

const dynamodb = xrayCapture(new DynamoDB({ apiVersion: '2012-08-10' }))

// Prompts

export const getPromptById = async (promptId: PromptId): Promise<Prompt> => {
  const command = new QueryCommand({
    ExpressionAttributeValues: { ':promptId': { S: `${promptId}` } },
    KeyConditionExpression: 'PromptId = :promptId',
    Limit: 1,
    ScanIndexForward: false,
    TableName: dynamodbPromptsTableName,
  })
  const response = await dynamodb.send(command)
  return {
    config: JSON.parse(response.Items?.[0]?.Config?.S as string),
    contents: response.Items?.[0]?.SystemPrompt?.S as string,
  }
}

// Games

export interface GameResult {
  isGenerating: boolean
  game?: ConnectionsData
}

export const getGameById = async (gameId: GameId): Promise<GameResult> => {
  const command = new GetItemCommand({
    Key: {
      GameId: {
        S: `${gameId}`,
      },
    },
    TableName: dynamodbGamesTableName,
  })
  const response = await dynamodb.send(command)
  if (response.Item?.Data?.S) {
    return {
      game: JSON.parse(response.Item.Data.S as string),
      isGenerating: false,
    }
  }

  const generationStarted = response.Item?.GenerationStarted?.N
  const isGenerating = generationStarted ? parseInt(generationStarted) + 300000 > Date.now() : false
  return { isGenerating }
}

export const getGamesByIds = async (gameIds: GameId[]): Promise<Record<GameId, ConnectionsData>> => {
  if (gameIds.length === 0) return {}

  const command = new BatchGetItemCommand({
    RequestItems: {
      [dynamodbGamesTableName]: {
        Keys: gameIds.map((gameId) => ({ GameId: { S: gameId } })),
      },
    },
  })
  const response = await dynamodb.send(command)
  const result: Record<GameId, ConnectionsData> = {}

  response.Responses?.[dynamodbGamesTableName]?.forEach((item: any) => {
    const gameId = item.GameId?.S as GameId
    if (item.Data?.S) {
      const data = JSON.parse(item.Data.S as string) as ConnectionsData
      result[gameId] = data
    }
  })

  return result
}

export const setGameById = async (gameId: GameId, data: ConnectionsData): Promise<PutItemOutput> => {
  const command = new PutItemCommand({
    Item: {
      Data: {
        S: JSON.stringify(data),
      },
      GameId: {
        S: `${gameId}`,
      },
    },
    TableName: dynamodbGamesTableName,
  })
  return await dynamodb.send(command)
}

export const setGameGenerationStarted = async (gameId: GameId): Promise<PutItemOutput> => {
  const command = new PutItemCommand({
    Item: {
      GameId: {
        S: `${gameId}`,
      },
      GenerationStarted: {
        N: `${Date.now()}`,
      },
    },
    TableName: dynamodbGamesTableName,
  })
  return await dynamodb.send(command)
}
