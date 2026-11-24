import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Only these named addresses reach the browser; anything else starting with K1_ stays on the server.
const PUBLIC_K1 = ['K1_API_STAGING', 'K1_API_PRODUCTION', 'K1_API_PRODUCTION_LIVE']

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'K1_'), ...process.env }
  return {
    plugins: [react()],
    define: { __K1_ENV__: JSON.stringify(Object.fromEntries(PUBLIC_K1.map((name) => [name, env[name] ?? '']))) },
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          legacy: fileURLToPath(new URL('./legacy.html', import.meta.url)),
        },
      },
    },
  }
})
