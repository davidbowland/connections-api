/* eslint sort-keys:0 */
import {
  CategoryObject,
  ConnectionsData,
  ConnectionsGame,
  GameId,
  Prompt,
  PromptConfig,
  PromptId,
  ToolSchema,
} from '@types'

// Games

export const gameId: GameId = '2025-01-01'

const categories: CategoryObject = {
  Boast: { hint: 'Boast hint', words: ['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT'] },
  'Arc-shaped things': {
    hint: 'Arc-shaped things hint',
    words: ['BANANA', 'EYEBROW', 'FLIGHT PATH', 'RAINBOW'],
  },
  'Cereal mascots': {
    hint: 'Cereal mascots hint',
    words: ['COUNT', 'ELVES', 'LEPRECHAUN', 'ROOSTER'],
  },
  'Ways to denote a citation': {
    hint: 'Ways to denote a citation hint',
    words: ['ASTERISK', 'DAGGER', 'NUMBER', 'PARENS'],
  },
}

export const connectionsData: ConnectionsData = {
  categories,
  wordList: [
    'BLUSTER',
    'CROW',
    'SHOW OFF',
    'STRUT',
    'BANANA',
    'EYEBROW',
    'FLIGHT PATH',
    'RAINBOW',
    'COUNT',
    'ELVES',
    'LEPRECHAUN',
    'ROOSTER',
    'ASTERISK',
    'DAGGER',
    'NUMBER',
    'PARENS',
  ],
}

export const game: ConnectionsGame = {
  categories,
}

// Bedrock

export const invokeModelCategories = {
  categories,
}

export const invokeModelResponseData = {
  id: 'msg_bdrk_01YA7pmVfUZvZM9reruSimYT',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-6',
  content: [
    {
      type: 'thinking',
      thinking: 'Let me think about the categories...',
    },
    {
      type: 'tool_use',
      id: 'toolu_bdrk_01YA7pmVfUZvZM9reruSimYT',
      name: 'submit_game',
      input: invokeModelCategories,
    },
  ],
  stop_reason: 'tool_use',
  stop_sequence: null,
  usage: { input_tokens: 3_398, output_tokens: 99 },
}

export const invokeModelResponse = {
  $metadata: {
    attempts: 1,
    cfId: undefined,
    extendedRequestId: undefined,
    httpStatusCode: 200,
    requestId: 'fragglerock',
    retryDelay: 0,
    statusCode: 200,
    success: true,
    totalRetryDelay: 0,
  },
  body: new TextEncoder().encode(JSON.stringify(invokeModelResponseData)),
}

export const toolSchema: ToolSchema = {
  name: 'submit_data',
  description: 'Submit the data.',
  input_schema: {
    type: 'object',
    properties: { data: { type: 'string' } },
    required: ['data'],
  },
}

// Prompts

export const promptConfig: PromptConfig = {
  anthropicVersion: 'bedrock-2023-05-31',
  maxTokens: 32_000,
  model: 'the-thinking-ai:1.0',
  thinkingBudgetTokens: 25_000,
}

export const promptId: PromptId = '5253'

export const prompt: Prompt = {
  config: promptConfig,
  contents: 'You are a helpful assistant. ${data}',
}
