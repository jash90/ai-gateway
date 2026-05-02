import { ProviderUsage, ProxyResult } from '../../../common/types/types'

export interface AIProvider {
  name: string
  canHandle(model: string): boolean
  proxy(requestBody: unknown, apiKey: string, isStreaming: boolean): Promise<ProxyResult>
}

export abstract class BaseProvider implements AIProvider {
  abstract name: string

  canHandle(_model: string): boolean {
    return false
  }

  abstract proxy(requestBody: unknown, apiKey: string, isStreaming: boolean): Promise<ProxyResult>

  protected extractUsage(_data: any): ProviderUsage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    }
  }
}
