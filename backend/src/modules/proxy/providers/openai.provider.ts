import { Injectable } from '@nestjs/common'
import { BaseProvider } from './provider.interface'
import { ProviderUsage, ProxyResult } from '../../../common/types/types'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class OpenAIProvider extends BaseProvider {
  name = 'OPENAI'
  private apiKey: string
  private baseUrl = 'https://api.openai.com'

  constructor(config: ConfigService) {
    super()
    this.apiKey = config.get<string>('OPENAI_API_KEY') ?? ''
  }

  canHandle(model: string): boolean {
    const lower = model.toLowerCase()
    return lower.includes('gpt') || lower.includes('o1') || lower.includes('o3')
  }

  async proxy(requestBody: unknown, _apiKey: string, isStreaming: boolean): Promise<ProxyResult> {
    const body = requestBody as Record<string, unknown>
    const model = (body.model as string) ?? 'gpt-4o'

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    }

    if (isStreaming) {
      body.stream = true
      body.stream_options = { include_usage: true }
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    const responseBody = await response.text()
    const usage = isStreaming
      ? this.extractStreamUsage(responseBody)
      : this.extractUsage(JSON.parse(responseBody))

    return {
      status: response.status,
      body: responseBody,
      headers: Object.fromEntries(response.headers.entries()),
      model,
      usage,
    }
  }

  protected extractUsage(data: Record<string, unknown>): ProviderUsage {
    const usage = data.usage as Record<string, number> | undefined
    const promptDetails = usage?.prompt_tokens_details as Record<string, number> | undefined

    return {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      cacheReadTokens: promptDetails?.cached_tokens ?? 0,
      cacheCreationTokens: 0,
    }
  }

  private extractStreamUsage(body: string): ProviderUsage {
    const usage: ProviderUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    }

    for (const line of body.split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
      try {
        const chunk = JSON.parse(line.slice(6))
        if (chunk.usage) {
          usage.inputTokens = chunk.usage.prompt_tokens ?? 0
          usage.outputTokens = chunk.usage.completion_tokens ?? 0
          const details = chunk.usage.prompt_tokens_details as Record<string, number> | undefined
          usage.cacheReadTokens = details?.cached_tokens ?? 0
        }
      } catch {
        // Skip malformed lines
      }
    }

    return usage
  }
}
