import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'path'

export default defineConfig({
  plugins: [
    // Must run BEFORE react() so the route tree is fresh on every reload.
    TanStackRouterVite({
      routesDirectory: path.resolve(import.meta.dirname, 'src/routes'),
      generatedRouteTree: path.resolve(import.meta.dirname, 'src/routeTree.gen.ts'),
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
      '@features': path.resolve(import.meta.dirname, 'src/features'),
      '@gen': path.resolve(import.meta.dirname, 'src/gen'),
    },
  },
  server: {
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/docs': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
