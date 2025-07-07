import { DynamoDB, GetItemCommand, PutItemCommand, PutItemOutput, QueryCommand } from '@aws-sdk/client-dynamodb'

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

export const getGameById = async (gameId: GameId): Promise<ConnectionsData> => {
  const command = new GetItemCommand({
    Key: {
      GameId: {
        S: `${gameId}`,
      },
    },
    TableName: dynamodbGamesTableName,
  })
  const response = await dynamodb.send(command)
  return JSON.parse(response.Item.Data.S as string)
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
