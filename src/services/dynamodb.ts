import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDB,
  GetItemCommand,
  PutItemCommand,
  PutItemOutput,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb'

import {
  dynamodbGamesTableName,
  dynamodbPromptsTableName,
  gameGenerationTimeoutMs,
} from '../config'
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

export const getGameById = async (gameId: GameId, now = Date.now): Promise<GameResult> => {
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
  const isGenerating = generationStarted
    ? parseInt(generationStarted) + gameGenerationTimeoutMs > now()
    : false
  return { isGenerating }
}

export const getAllGames = async (): Promise<Record<GameId, ConnectionsData>> => {
  const result: Record<GameId, ConnectionsData> = {}
  let lastEvaluatedKey: Record<string, any> | undefined

  do {
    const command = new ScanCommand({
      ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      TableName: dynamodbGamesTableName,
    })
    const response = await dynamodb.send(command)
    response.Items?.forEach((item: any) => {
      if (item.Data?.S) {
        result[item.GameId?.S as GameId] = JSON.parse(item.Data.S as string) as ConnectionsData
      }
    })
    lastEvaluatedKey = response.LastEvaluatedKey
  } while (lastEvaluatedKey)

  return result
}

export const setGameById = async (
  gameId: GameId,
  data: ConnectionsData,
): Promise<PutItemOutput> => {
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

export const setGameGenerationStarted = async (
  gameId: GameId,
  now = Date.now,
): Promise<number | false> => {
  const timestamp = now()
  const command = new PutItemCommand({
    ConditionExpression:
      'attribute_not_exists(GameId) OR (attribute_not_exists(#data) AND (attribute_not_exists(GenerationStarted) OR GenerationStarted < :expiry))',
    ExpressionAttributeNames: {
      '#data': 'Data',
    },
    ExpressionAttributeValues: {
      ':expiry': { N: `${timestamp - gameGenerationTimeoutMs}` },
    },
    Item: {
      GameId: {
        S: `${gameId}`,
      },
      GenerationStarted: {
        N: `${timestamp}`,
      },
    },
    TableName: dynamodbGamesTableName,
  })
  try {
    await dynamodb.send(command)
    return timestamp
  } catch (error: unknown) {
    if (error instanceof ConditionalCheckFailedException) {
      return false
    }
    throw error
  }
}

export const resetGameGenerationStarted = async (
  gameId: GameId,
  expectedTimestamp: number,
  now = Date.now,
): Promise<number | false> => {
  const timestamp = now()
  const command = new PutItemCommand({
    ConditionExpression: 'GenerationStarted = :expected',
    ExpressionAttributeValues: {
      ':expected': { N: String(expectedTimestamp) },
    },
    Item: {
      GameId: {
        S: `${gameId}`,
      },
      GenerationStarted: {
        N: `${timestamp}`,
      },
    },
    TableName: dynamodbGamesTableName,
  })
  try {
    await dynamodb.send(command)
    return timestamp
  } catch (error: unknown) {
    if (error instanceof ConditionalCheckFailedException) {
      return false
    }
    throw error
  }
}

export const deleteGameById = async (gameId: GameId): Promise<void> => {
  const command = new DeleteItemCommand({
    Key: {
      GameId: {
        S: `${gameId}`,
      },
    },
    TableName: dynamodbGamesTableName,
  })
  await dynamodb.send(command)
}
