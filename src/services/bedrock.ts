import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'

import { Prompt, ToolSchema } from '../types'
import { logDebug } from '../utils/logging'

const runtimeClient = new BedrockRuntimeClient({ region: 'us-east-1' })

// Context values may originate from prior LLM output (e.g. category names), which is untrusted.
// Escaping </> stops it from breaking out of the <context> XML tags in the prompt templates.
const escapeXml = (value: string): string => value.replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const invokeModel = async <T>(
  prompt: Prompt,
  tool: ToolSchema,
  context?: Record<string, any>,
): Promise<T> => {
  const promptWithContext = context
    ? {
      ...prompt,
      // A replacer function (not a string) avoids Node interpreting $&/$`/$'-style
      // sequences that might appear in untrusted context values as replacement patterns.
      contents: prompt.contents.replace('${context}', () => escapeXml(JSON.stringify(context))),
    }
    : prompt
  return invokeModelMessage(promptWithContext, tool)
}

export const invokeModelMessage = async <T>(prompt: Prompt, tool: ToolSchema): Promise<T> => {
  logDebug('Invoking model', { prompt, tool })
  const messageBody = {
    anthropic_version: prompt.config.anthropicVersion,
    max_tokens: prompt.config.maxTokens,
    messages: [{ content: prompt.contents, role: 'user' }],
    output_config: { effort: prompt.config.thinkingEffort },
    thinking: { type: 'adaptive' },
    // Forced tool_choice ("tool"/"any") is not supported alongside extended thinking, so we can
    // only steer the model to call the tool via "auto" and validate that it did so below.
    tool_choice: { type: 'auto' },
    tools: [tool],
  }
  logDebug('Passing to model', {
    messageBody,
    messages: JSON.stringify(messageBody.messages, null, 2),
  })
  const command = new InvokeModelCommand({
    body: new TextEncoder().encode(JSON.stringify(messageBody)),
    contentType: 'application/json',
    modelId: prompt.config.model,
  })
  const response = await runtimeClient.send(command)
  const modelResponse = JSON.parse(new TextDecoder().decode(response.body))
  const toolBlock = modelResponse.content.find((b: { type: string }) => b.type === 'tool_use') as
    { input?: T } | undefined
  logDebug('Model response', { modelResponse, toolInput: toolBlock?.input })
  if (!toolBlock?.input) {
    throw new Error(`Model response contained no ${tool.name} tool call`)
  }
  return toolBlock.input
}
