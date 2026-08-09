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

// Repeat-detection keys for every category ever generated, built by buildCategoryHistory. The two
// sets are separate because they catch different things: `canonical` catches exact and
// punctuation-only restatements (including blank-bearing names, which have no token key), while
// `token` catches pure reorderings.
export interface CategoryHistory {
  canonical: Set<string>
  token: Set<string>
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

// Prompts

export type PromptId = string

export interface PromptConfig {
  anthropicVersion: string
  maxTokens: number
  model: string
  thinkingEffort: 'low' | 'medium' | 'high' | 'max'
}

export interface Prompt {
  config: PromptConfig
  contents: string
}

export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, any>
}
