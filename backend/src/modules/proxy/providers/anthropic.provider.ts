import { Injectable } from '@nestjs/common'
import { BaseProvider } from './provider.interface'
import { ProviderUsage, ProxyResult } from '../../../common/types/types'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class AnthropicProvider extends BaseProvider {
  name = 'ANTHROPIC'
  private apiKey: string
  private baseUrl = 'https://api.anthropic.com'

  constructor(config: ConfigService) {
    super()
    this.apiKey = config.get<string>('ANTHROPIC_API_KEY') ?? ''
  }

  canHandle(model: string): boolean {
    const lower = model.toLowerCase()
    return lower.includes('claude')
  }

  async proxy(requestBody: unknown, _apiKey: string, isStreaming: boolean): Promise<ProxyResult> {
    const body = requestBody as Record<string, unknown>
    const model = (body.model as string) ?? 'claude-sonnet-4-5'

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': this.apiKey,
    }

    if (isStreaming) {
      body.stream = true
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    const responseBody = isStreaming
      ? await response.text()
      : await response.text()

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
    return {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
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
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6))
        if (event.type === 'message_start' && event.message?.usage) {
          usage.inputTokens = event.message.usage.input_tokens ?? 0
          usage.cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0
          usage.cacheCreationTokens = event.message.usage.cache_creation_input_tokens ?? 0
        }
        if (event.type === 'message_delta' && event.usage) {
          usage.outputTokens = event.usage.output_tokens ?? 0
        }
      } catch {
        // Skip malformed lines
      }
    }

    return usage
  }
}
