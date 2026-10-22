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

// `searches` maps each word, exactly as it appears in `words`, to the web-search phrase for the sense
// this category uses ("BASS" -> "bass fish"). A map rather than a parallel array because the UI
// reorders words. Optional because every game generated before it existed lacks one, and any word
// without an entry falls back to searching the bare word.
export interface Category {
  embeddedSubstrings?: string[]
  hint: string
  searches?: Record<string, string>
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

// A word the generator claims plausibly belongs to `looksLike` -- a DIFFERENT category in the same
// grid -- as well as to its own. Decoys exist only to make the model commit to cross-category
// misdirection while it is generating; they are validated and dropped, never stored or returned.
export interface Decoy {
  looksLike: string
  word: string
}

// Verification

export interface VerificationResult {
  verdict: 'pass' | 'fix' | 'fail'
  reason: string
  fixes?: {
    [categoryName: string]: {
      words?: string[]
      hint?: string
      searches?: Record<string, string>
      category?: {
        name: string
        words: string[]
        hint: string
        embeddedSubstrings?: string[]
        searches?: Record<string, string>
      }
    }
  }
}

// Usage

// Per-model token totals. inputCached is prompt-cache reads, inputCacheWrite is prompt-cache writes;
// output tokens are never cached. costUsd is absent for a model with no known pricing.
export interface ModelTokenUsage {
  costUsd?: number
  input: number
  inputCacheWrite: number
  inputCached: number
  invocations: number
  model: string
  output: number
}

// Summed across every Lambda attempt that went into one game. wallClockMs and cpuMs cover handler
// time only (not cold-start init or the gap between a failed attempt and its retry). maxMemoryMb is
// the peak RSS of any attempt's process.
export interface GenerationUsage {
  attempts: number
  costUsd: { lambda: number; models: number; total: number }
  cpuMs: number
  gbSeconds: number
  maxMemoryMb: number
  memoryLimitMb: number
  tokens: ModelTokenUsage[]
  wallClockMs: number
}

// A game generated locally by scripts/local-game.ts, where the model steps ran outside Bedrock. There
// is no Lambda or token cost to record, only where the game came from.
export interface LocalGenerationUsage {
  source: 'local'
}

export type StoredUsage = GenerationUsage | LocalGenerationUsage

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
