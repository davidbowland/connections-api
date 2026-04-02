import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'

import { Prompt } from '../types'
import { log, logDebug } from '../utils/logging'

const runtimeClient = new BedrockRuntimeClient({ region: 'us-east-1' })

export const invokeModel = async <T>(prompt: Prompt, context?: Record<string, any>): Promise<T> => {
  const promptWithContext = context
    ? { ...prompt, contents: prompt.contents.replace('${context}', JSON.stringify(context)) }
    : prompt
  return invokeModelMessage(promptWithContext)
}

export const invokeModelMessage = async <T>(prompt: Prompt): Promise<T> => {
  logDebug('Invoking model', { prompt })
  const thinkingConfig = prompt.config.thinkingBudgetTokens
    ? { thinking: { type: 'enabled', budget_tokens: prompt.config.thinkingBudgetTokens } }
    : { temperature: prompt.config.temperature, top_k: prompt.config.topK }
  const messageBody = {
    anthropic_version: prompt.config.anthropicVersion,
    max_tokens: prompt.config.maxTokens,
    messages: [{ content: prompt.contents, role: 'user' }],
    ...thinkingConfig,
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
  const textBlock = modelResponse.content.find((b: { type: string }) => b.type === 'text')
  logDebug('Model response', { modelResponse, text: textBlock?.text })
  return parseResponse(textBlock?.text ?? '')
}

const parseResponse = <T>(str: string): T => {
  const content = str.replace(/(^\s*<thinking>.*?<\/thinking>\s*|^\s*|\s*`(json)?\s*|\s*$)/gs, '')
  const jsonMatch = content.match(/{.*}/s)?.[0] ?? content
  try {
    return JSON.parse(jsonMatch)
  } catch {
    log('Response is not valid JSON', { content })
    throw new Error(`Response is not valid JSON: ${content.substring(0, 200)}`)
  }
}
