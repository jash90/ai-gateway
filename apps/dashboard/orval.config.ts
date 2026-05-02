import { defineConfig } from 'orval'

const apiUrl =
  process.env.RACCOON_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'

export default defineConfig({
  dashboard: {
    input: `${apiUrl}/docs-json`,
    output: {
      target: './src/gen/api.ts',
      client: 'react-query',
      mode: 'split',
      baseUrl: '',
      override: {
        mutator: {
          path: './src/shared/lib/api-fetch.ts',
          name: 'customFetch',
        },
      },
    },
  },
})
