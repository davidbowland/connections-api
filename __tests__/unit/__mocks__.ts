/* eslint sort-keys:0 */
import { CategoryObject, ConnectionsData, ConnectionsGame, GameId, Prompt, PromptConfig, PromptId } from '@types'

// Games

export const gameId: GameId = '2025-01-01'

const categories: CategoryObject = {
  Boast: { hint: 'Boast hint', words: ['BLUSTER', 'CROW', 'SHOW OFF', 'STRUT'] },
  'Arc-shaped things': { hint: 'Arc-shaped things hint', words: ['BANANA', 'EYEBROW', 'FLIGHT PATH', 'RAINBOW'] },
  'Cereal mascots': { hint: 'Cereal mascots hint', words: ['COUNT', 'ELVES', 'LEPRECHAUN', 'ROOSTER'] },
  'Ways to denote a citation': {
    hint: 'Ways to denote a citation hint',
    words: ['ASTERISK', 'DAGGER', 'NUMBER', 'PARENS'],
  },
}

const fakeCategories: CategoryObject = {
  Fake: { hint: 'Fake hint', words: ['MADE', 'UP', 'WORDS', 'HERE'] },
}

export const connectionsData: ConnectionsData = {
  categories,
  fakeCategories,
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
  fakeCategories,
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
