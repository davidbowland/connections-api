import { llmVerifyPromptId } from '../config'
import { CategoryObject, ConnectionsGame, VerificationResult } from '../types'
import { log } from '../utils/logging'
import { invokeModel } from './bedrock'
import { getPromptById } from './dynamodb'

const applyFixes = (game: ConnectionsGame, result: VerificationResult): ConnectionsGame => {
  if (!result.fixes) {
    return game
  }

  const categories: CategoryObject = { ...game.categories }
  let totalWordChanges = 0
  let categoryReplacements = 0

  for (const [oldName, fix] of Object.entries(result.fixes)) {
    if (!(oldName in categories)) {
      throw new Error(`Fix references unknown category: ${oldName}`)
    }

    if (fix.category) {
      categoryReplacements++
      if (categoryReplacements > 1) {
        throw new Error('Fix exceeds category replacement limit (> 1)')
      }
      log('Verification fix: category replacement', {
        before: { name: oldName, ...categories[oldName] },
        after: fix.category,
      })
      delete categories[oldName]
      categories[fix.category.name] = {
        embeddedSubstrings: fix.category.embeddedSubstrings ?? [],
        hint: fix.category.hint,
        words: fix.category.words,
      }
    } else {
      if (fix.words) {
        const oldWords = categories[oldName].words
        const wordChanges = fix.words.filter((w) => !oldWords.includes(w)).length
        if (wordChanges > 2) {
          throw new Error(
            `Fix exceeds per-category word change limit (> 2) for category: ${oldName}`,
          )
        }
        totalWordChanges += wordChanges
        log('Verification fix: words', {
          category: oldName,
          before: oldWords,
          after: fix.words,
        })
        categories[oldName] = { ...categories[oldName], words: fix.words }
      }
      if (fix.hint) {
        log('Verification fix: hint', {
          category: oldName,
          before: categories[oldName].hint,
          after: fix.hint,
        })
        categories[oldName] = { ...categories[oldName], hint: fix.hint }
      }
    }
  }

  if (totalWordChanges > 4) {
    throw new Error('Fix exceeds total word change limit (> 4)')
  }

  return { ...game, categories }
}

export const verifyAndFixGame = async (
  game: ConnectionsGame,
  modelContext: Record<string, any>,
): Promise<ConnectionsGame> => {
  const prompt = await getPromptById(llmVerifyPromptId)
  const result: VerificationResult = await invokeModel(prompt, { game, modelContext })

  log('Haiku verification result', { reason: result.reason, verdict: result.verdict })

  if (result.verdict === 'pass') {
    return game
  } else if (result.verdict === 'fail') {
    throw new Error(`Haiku verification failed: ${result.reason}`)
  } else if (result.verdict === 'fix') {
    return applyFixes(game, result)
  } else {
    throw new Error(`Unrecognised verdict: ${(result as any).verdict}`)
  }
}
