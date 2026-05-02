# @raccoon/sdk

Native TypeScript client for [Raccoon AI Gateway](https://api.raccoon.dev) — a BYOK (bring-your-own-key) proxy for OpenAI, Anthropic, and OpenRouter with usage attribution, audit, and analytics.

## Install

```bash
npm install @raccoon/sdk
```

## Two ways to use it

### 1. As a baseURL for the official OpenAI / Anthropic SDKs

The gateway is drop-in compatible — point your existing SDK at it.

```ts
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.RACCOON_KEY, // sk-rcn-live-...
  baseURL: 'https://api.raccoon.dev/v1',
})

// Use cross-provider models via prefix:
const completion = await openai.chat.completions.create({
  model: 'anthropic/claude-sonnet-4-5', // routed + translated to Anthropic
  messages: [{ role: 'user', content: 'Hello' }],
})
```

### 2. As a typed client with end-user attribution

```ts
import { RaccoonClient } from '@raccoon/sdk'

const client = new RaccoonClient({ apiKey: process.env.RACCOON_KEY! })

// Attribute usage to a specific end-user of your app
const userClient = client.withEndUser('user_abc123')

const response = await userClient.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hi' }],
})

console.log(response.choices[0].message.content)
console.log('Tokens:', response.usage)
```

## Headers

| Header | When | What |
|---|---|---|
| `Authorization: Bearer sk-rcn-live-...` | Always | Application key from the dashboard |
| `x-rcn-end-user: <opaque-id>` | Optional | Attribute usage to your app's user |
| `x-rcn-provider: OPENAI \| ANTHROPIC \| OPENROUTER` | Optional | Override inferred provider |

## Endpoints

- `POST /v1/chat/completions` — OpenAI-compatible chat completions
- `POST /v1/messages` — Anthropic-compatible messages API
- `GET /v1/models` — list models from your configured BYOK keys

## Errors

```ts
import { RaccoonError } from '@raccoon/sdk'

try {
  await client.chat.completions.create({ ... })
} catch (e) {
  if (e instanceof RaccoonError) {
    console.error(e.status, e.errorCode, e.message)
    // PROVIDER_KEY_NOT_CONFIGURED → user needs to add a BYOK key in dashboard
    // INVALID_KEY                 → application key was revoked / wrong
    // KEY_REVOKED, KEY_EXPIRED    → application key issue
  }
}
```

## License

MIT
