import { readFileSync } from 'fs'
import { join } from 'path'

import { Category } from '@types'

// The prompt files are the only thing that asks the model for search phrases -- the tool schema
// leaves `searches` optional so an old prompt cannot fail validation. A prompt edit that loses the
// request would therefore fail silently: every game would still generate, just with bare-word links.
describe('prompts', () => {
  const readPrompt = (name: string): string => readFileSync(join(__dirname, '../../../prompts', `${name}.txt`), 'utf-8')

  const blocks = (contents: string, tag: string): string[] =>
    [...contents.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((match) => match[1])

  describe('create-connections-game', () => {
    const contents = readPrompt('create-connections-game')

    it('should describe searches in the format block', () => {
      expect(blocks(contents, 'format').join('')).toContain('searches')
    })

    it('should have a search_rules block', () => {
      expect(blocks(contents, 'search_rules')).toHaveLength(1)
    })

    it('should include a search phrase for every word in both example outputs', () => {
      const examples = blocks(contents, 'example_output').map((example) => JSON.parse(example))
      const categories: Category[] = examples.flatMap((example) => Object.values(example.categories))

      expect(examples).toHaveLength(2)
      expect(categories.map(({ searches, words }) => [Object.keys(searches ?? {}).sort(), [...words].sort()])).toEqual(
        categories.map(({ words }) => [[...words].sort(), [...words].sort()]),
      )
    })
  })

  describe('verify-connections-game', () => {
    const contents = readPrompt('verify-connections-game')

    it('should show searches in the format block', () => {
      expect(blocks(contents, 'format').join('')).toContain('"searches"')
    })

    it('should ask for a searches entry for every word a fix introduces', () => {
      expect(blocks(contents, 'verdict-rules').join('')).toMatch(/introduces a new word.*`searches`/)
    })
  })
})
