#!/usr/bin/env ts-node
// Generates a game without Bedrock: this script runs every code step of the create-game pipeline, and
// the two model steps are done by whoever reads the prompts it writes (in practice, `claude -p` driven
// by scripts/generate-games.sh). Run through `npm run local-game`, which loads
// .env.local so src/config.ts sees the same settings as the Lambda, and sets TZ=UTC as the Lambda
// runtime does. getDateConstraint reads local-time fields of a UTC-midnight date, so in any zone west
// of UTC every game would otherwise roll as the previous day and miss its holiday.
//
//   prepare <gameId>   Fail if the game exists, else roll constraints and write generate-prompt.txt
//   check <gameId>     Validate generated.json and write verify-prompt.txt
//   finalize <gameId>  Validate verdict.json, apply fixes, and upload (never overwrites)
//
// Work files live in .local-games/<gameId>/. Each step reads only what earlier steps wrote there.
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'

import { gameTool } from '../src/services/games'
import { checkLocalGame, finalizeLocalGame, prepareLocalGame } from '../src/services/local-generation'
import { verdictTool } from '../src/services/verification'
import { Prompt } from '../src/types'
import { parsePromptFile } from '../src/utils/prompt-file'

const ROOT = join(__dirname, '..')
const WORK_ROOT = join(ROOT, '.local-games')

const usage = 'Usage: npm run local-game -- <prepare|check|finalize> <YYYY-MM-DD>'

// Not isValidGameId: that rejects future dates because players may not read ahead, and generating
// ahead is the point of this script.
const isWellFormedGameId = (gameId: string): boolean => {
  const date = new Date(gameId)
  return /^\d{4}-\d{2}-\d{2}$/.test(gameId) && !isNaN(date.getTime()) && date.toISOString().startsWith(gameId)
}

const loadPrompt = async (promptId: string): Promise<Prompt> =>
  parsePromptFile(await readFile(join(ROOT, 'prompts', `${promptId}.txt`), 'utf-8'))

const readJson = async (path: string): Promise<any> => {
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch (error: unknown) {
    throw new Error(`Could not read JSON from ${path}: ${(error as Error).message}`)
  }
}

const writeJson = (path: string, value: unknown): Promise<void> =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`)

const prepare = async (workDir: string, gameId: string): Promise<void> => {
  const { modelContext, promptContents } = await prepareLocalGame(gameId, await loadPrompt('create-connections-game'))
  // A fresh directory per attempt, so a stale generated.json or verdict.json from a failed attempt
  // can never be checked against new constraints.
  await rm(workDir, { force: true, recursive: true })
  await mkdir(workDir, { recursive: true })
  await writeJson(join(workDir, 'state.json'), { gameId, modelContext })
  await writeFile(join(workDir, 'generate-prompt.txt'), promptContents)
  await writeJson(join(workDir, 'generate-tool.json'), gameTool)
  console.log(`PREPARED ${gameId}`)
  console.log(`  prompt: ${join(workDir, 'generate-prompt.txt')}`)
  console.log(`  tool:   ${join(workDir, 'generate-tool.json')}`)
  console.log(`  write:  ${join(workDir, 'generated.json')}`)
}

const check = async (workDir: string): Promise<void> => {
  const { gameId, modelContext } = await readJson(join(workDir, 'state.json'))
  const generated = await readJson(join(workDir, 'generated.json'))
  const { promptContents } = checkLocalGame(modelContext, generated, await loadPrompt('verify-connections-game'))
  await writeFile(join(workDir, 'verify-prompt.txt'), promptContents)
  await writeJson(join(workDir, 'verify-tool.json'), verdictTool)
  console.log(`CHECKED ${gameId}`)
  console.log(`  prompt: ${join(workDir, 'verify-prompt.txt')}`)
  console.log(`  tool:   ${join(workDir, 'verify-tool.json')}`)
  console.log(`  write:  ${join(workDir, 'verdict.json')}`)
}

const finalize = async (workDir: string): Promise<void> => {
  const { gameId, modelContext } = await readJson(join(workDir, 'state.json'))
  const generated = await readJson(join(workDir, 'generated.json'))
  const verdict = await readJson(join(workDir, 'verdict.json'))
  const game = await finalizeLocalGame(gameId, modelContext, generated, verdict)
  await writeJson(join(workDir, 'final.json'), game)
  console.log(`UPLOADED ${gameId} (verdict: ${verdict.verdict})`)
  Object.entries(game.categories).forEach(([name, { words }]) => console.log(`  ${name}: ${words.join(', ')}`))
}

const main = async (): Promise<void> => {
  const [step, gameId] = process.argv.slice(2)
  if (!gameId || !isWellFormedGameId(gameId)) {
    throw new Error(usage)
  }
  const workDir = join(WORK_ROOT, gameId)
  if (step === 'prepare') {
    await prepare(workDir, gameId)
  } else if (step === 'check') {
    await check(workDir)
  } else if (step === 'finalize') {
    await finalize(workDir)
  } else {
    throw new Error(usage)
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`FAILED: ${(error as Error).message}`)
    process.exit(1)
  })
}
