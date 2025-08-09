import axios from 'axios'
import axiosRetry from 'axios-retry'

// Axios

axiosRetry(axios, { retries: 3 })

// DynamoDB

export const dynamodbGamesTableName = process.env.DYNAMODB_GAMES_TABLE_NAME as string
export const dynamodbPromptsTableName = process.env.DYNAMODB_PROMPTS_TABLE_NAME as string

// Lambda

export const createGameFunctionName = process.env.CREATE_GAME_FUNCTION_NAME as string

// LLM

export const llmPromptId = process.env.LLM_PROMPT_ID as string

// Games

export const avoidNextGamesCount = parseInt(process.env.AVOID_NEXT_GAMES_COUNT as string, 10)
export const avoidPastGamesCount = parseInt(process.env.AVOID_PAST_GAMES_COUNT as string, 10)
export const categoryConstraintChance = Number(process.env.CATEGORY_CONSTRAINT_CHANCE as string)
export const inspirationAdjectivesCount = parseInt(process.env.INSPIRATION_ADJECTIVES_COUNT as string, 10)
export const inspirationNounsCount = parseInt(process.env.INSPIRATION_NOUNS_COUNT as string, 10)
export const inspirationVerbsCount = parseInt(process.env.INSPIRATION_VERBS_COUNT as string, 10)

// Logging

export const debugLogging = (process.env.DEBUG_LOGGING as string) === 'true'
