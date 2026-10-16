import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the repo at /<repo>/ — assets must use that base.
  // Local dev keeps "/". Configure via VITE_BASE_PATH when the repo name
  // differs from the default below.
  base:
    process.env.VITE_BASE_PATH ??
    (process.env.GITHUB_PAGES === 'true' ? '/hyperliquid-smc-stocks/' : '/'),
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
