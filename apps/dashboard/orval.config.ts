import { defineConfig } from 'orval'

export default defineConfig({
  dashboard: {
    input: 'http://localhost:3000/docs-json',
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
