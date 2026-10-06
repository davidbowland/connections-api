import { ConnectionsData, GameId, Prompt, VerificationResult } from '../types'
import { log } from '../utils/logging'
import { buildPromptContents, validateResponse } from './bedrock'
import { getAllGames, getGameById, setGameByIdIfAbsent } from './dynamodb'
import {
  buildCategoryHistory,
  buildGenerationContext,
  checkGeneratedGame,
  finalizeVerifiedGame,
  gameTool,
  GeneratedGame,
} from './games'
import { applyVerdict, getVerifierContext, verdictTool } from './verification'

// The create-game pipeline with its two model calls cut out, for scripts/local-game.ts. Each step is
// the Lambda's own code: the only difference is that the rendered prompts are handed to the caller and
// the model's tool input comes back as an argument instead of from Bedrock. Every payload is checked
// against the same tool schema bedrock.ts enforces, because a payload written outside Bedrock is no
// more trustworthy than one that came from it.
//
// State between steps is just the model context. The category history is rebuilt from its
// disallowedCategories, and finalize re-runs the generation checks on the raw payload rather than
// trusting an intermediate file.

export interface PreparedLocalGame {
  modelContext: Record<string, any>
  promptContents: string
}

export interface CheckedLocalGame {
  promptContents: string
}

export const prepareLocalGame = async (
  gameId: GameId,
  createPrompt: Prompt,
  random = Math.random,
): Promise<PreparedLocalGame> => {
  const existing = await getGameById(gameId)
  if (existing.game) {
    throw new Error(`Game already exists: ${gameId}`)
  }
  // Read fresh on every prepare, so a batch generated in order sees each game uploaded before it.
  const pastGames = await getAllGames()
  const { modelContext } = buildGenerationContext(pastGames, gameId, random)
  return { modelContext, promptContents: buildPromptContents(createPrompt, modelContext) }
}

const checkPayload = (modelContext: Record<string, any>, generatedPayload: unknown) => {
  const generated = validateResponse<GeneratedGame>(gameTool, generatedPayload)
  const categoryHistory = buildCategoryHistory(modelContext.disallowedCategories)
  return { categoryHistory, ...checkGeneratedGame(generated, categoryHistory) }
}

export const checkLocalGame = (
  modelContext: Record<string, any>,
  generatedPayload: unknown,
  verifyPrompt: Prompt,
): CheckedLocalGame => {
  const { connectionsData, decoys } = checkPayload(modelContext, generatedPayload)
  const verifierContext = getVerifierContext(connectionsData, modelContext, decoys)
  return { promptContents: buildPromptContents(verifyPrompt, verifierContext) }
}

export const finalizeLocalGame = async (
  gameId: GameId,
  modelContext: Record<string, any>,
  generatedPayload: unknown,
  verdictPayload: unknown,
): Promise<ConnectionsData> => {
  const { categoryHistory, connectionsData } = checkPayload(modelContext, generatedPayload)
  const verdict = validateResponse<VerificationResult>(verdictTool, verdictPayload)
  const data = finalizeVerifiedGame(applyVerdict(connectionsData, verdict), categoryHistory)

  const stored = await setGameByIdIfAbsent(gameId, data, { source: 'local' })
  if (!stored) {
    throw new Error(`Game already exists: ${gameId}`)
  }
  log('Uploaded local game', { gameId })
  return data
}
