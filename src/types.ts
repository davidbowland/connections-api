export * from 'aws-lambda'
export { Operation as PatchOperation } from 'fast-json-patch'

// API

export type GameId = string

export interface ConnectionsGame {
  categories: CategoryObject
}

export interface ConnectionsData {
  categories: CategoryObject
  wordList: string[]
}

export interface Category {
  embeddedSubstrings?: string[]
  hint: string
  words: string[]
}

export interface CategoryObject {
  [key: string]: Category
}

// Verification

export interface VerificationResult {
  verdict: 'pass' | 'fix' | 'fail'
  reason: string
  fixes?: {
    [categoryName: string]: {
      words?: string[]
      hint?: string
      category?: {
        name: string
        words: string[]
        hint: string
        embeddedSubstrings?: string[]
      }
    }
  }
}

// LLM

// Prompts

export type PromptId = string

export interface PromptConfig {
  anthropicVersion: string
  maxTokens: number
  model: string
  temperature: number
  topK: number
}

export interface LargePromptOptions {
  chunkSize?: number
  useSystemMessage?: boolean
  systemMessage?: string
}

export interface Prompt {
  config: PromptConfig
  contents: string
}
