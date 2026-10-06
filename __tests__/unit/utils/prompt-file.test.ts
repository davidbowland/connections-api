import { parsePromptFile, splitPromptFile } from '@utils/prompt-file'

describe('prompt-file', () => {
  const config = '{"anthropicVersion":"bedrock-2023-05-31","maxTokens":100,"model":"m","thinkingEffort":"high"}'
  const content = `# ${config}\n\n<instructions>\nDo the thing.\n</instructions>\n`

  describe('splitPromptFile', () => {
    it('should split the config line from the system prompt', () => {
      expect(splitPromptFile(content)).toEqual({
        config,
        systemPrompt: '<instructions>\nDo the thing.\n</instructions>',
      })
    })

    it('should return no fields for content without a system prompt', () => {
      expect(splitPromptFile('just one line')).toEqual({})
    })
  })

  describe('parsePromptFile', () => {
    it('should parse the config and keep the system prompt as the contents', () => {
      expect(parsePromptFile(content)).toEqual({
        config: JSON.parse(config),
        contents: '<instructions>\nDo the thing.\n</instructions>',
      })
    })

    it('should throw on a malformed prompt file', () => {
      expect(() => parsePromptFile('just one line')).toThrow('Malformed prompt file')
    })

    it('should throw on an invalid config line', () => {
      expect(() => parsePromptFile('# not json\n\nprompt body\n')).toThrow()
    })
  })
})
