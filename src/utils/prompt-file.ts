import { Prompt } from '../types'

// A prompt file is a `#`-prefixed JSON config line, then the system prompt. The same files are the
// source of truth for scripts/deploy-prompts.ts (which uploads them) and scripts/local-game.ts (which
// reads them directly), so both go through this one parser.
const PROMPT_FILE = /^[\s#]*(?<config>[^\n]+)\s*\n\s+(?<systemPrompt>.*?)\s+$/s

export const splitPromptFile = (content: string): { [key: string]: string } => PROMPT_FILE.exec(content)?.groups ?? {}

export const parsePromptFile = (content: string): Prompt => {
  const { config, systemPrompt } = splitPromptFile(content)
  if (!config || !systemPrompt) {
    throw new Error('Malformed prompt file: expected a config line followed by the system prompt')
  }
  return { config: JSON.parse(config), contents: systemPrompt }
}
