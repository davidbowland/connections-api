/* eslint sort-keys:0 */
import { CategoryObject, ConnectionsData, ConnectionsGame, GameId, Prompt, PromptConfig, PromptId } from '@types'

// Bedrock

export const invokeModelCategories = {
  categories: {
    Boast: { words: ['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT'] },
    'Arc-shaped things': { words: ['BANANA', 'EYEBROW', 'FLIGHT PATH', 'RAINBOW'] },
    'Cereal mascots': { words: ['COUNT', 'ELVES', 'LEPRECHAUN', 'ROOSTER'] },
    'Ways to denote a citation': { words: ['ASTERISK', 'DAGGER', 'NUMBER', 'PARENS'] },
  },
  fakeCategories: {
    Fake: { words: ['MADE', 'UP', 'WORDS', 'HERE'] },
  },
}

export const invokeModelResponseData = {
  id: 'msg_bdrk_01YA7pmVfUZvZM9reruSimYT',
  type: 'message',
  role: 'assistant',
  model: 'claude-3-5-sonnet-20241022',
  content: [
    {
      type: 'text',
      text: JSON.stringify(invokeModelCategories, null, 2),
    },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 3398, output_tokens: 99 },
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

export const invokeModelInvalidResponseData = {
  id: 'msg_bdrk_01YA7pmVfUZvZM9reruSimYT',
  type: 'message',
  role: 'assistant',
  model: 'claude-3-5-sonnet-20241022',
  content: [
    {
      type: 'text',
      text: 'this-is-invalid-json',
    },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 3398, output_tokens: 99 },
}

export const invokeModelInvalidResponse = {
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
  body: new TextEncoder().encode(JSON.stringify(invokeModelInvalidResponseData)),
}

// Prompts

export const promptConfig: PromptConfig = {
  anthropicVersion: 'bedrock-2023-05-31',
  maxTokens: 256,
  model: 'the-best-ai:1.0',
  temperature: 0.5,
  topK: 250,
}

export const promptId: PromptId = '5253'

export const prompt: Prompt = {
  config: promptConfig,
  contents: 'You are a helpful assistant. ${data}',
}

// Games

export const gameId: GameId = '2025-01-01'

const categories: CategoryObject = {
  Boast: { words: ['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT'] },
  'Arc-shaped things': { words: ['BANANA', 'EYEBROW', 'FLIGHT PATH', 'RAINBOW'] },
  'Cereal mascots': { words: ['COUNT', 'ELVES', 'LEPRECHAUN', 'ROOSTER'] },
  'Ways to denote a citation': { words: ['ASTERISK', 'DAGGER', 'NUMBER', 'PARENS'] },
}

export const connectionsData: ConnectionsData = {
  categories,
  fakeCategories: { Fake: { words: ['MADE', 'UP', 'WORDS', 'HERE'] } },
}

export const game: ConnectionsGame = {
  categories,
}
