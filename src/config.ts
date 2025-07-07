import axios from 'axios'
import axiosRetry from 'axios-retry'

// Axios

axiosRetry(axios, { retries: 3 })

// DynamoDB

export const dynamodbGamesTableName = process.env.DYNAMODB_GAMES_TABLE_NAME as string
export const dynamodbPromptsTableName = process.env.DYNAMODB_PROMPTS_TABLE_NAME as string

// LLM

export const llmPromptId = process.env.LLM_PROMPT_ID as string

// Logging

export const debugLogging = (process.env.DEBUG_LOGGING as string) === 'true'
