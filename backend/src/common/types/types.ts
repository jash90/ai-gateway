// Types for AI provider responses

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ProxyResult {
  status: number;
  body: string;
  headers: Record<string, string>;
  model: string;
  usage: ProviderUsage;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
}

// Pricing per million tokens
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  totalUsd: number;
  credits: number;
}

export interface CustomerContext {
  id: string;
  name: string;
  tier: string;
}
