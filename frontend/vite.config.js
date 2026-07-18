import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, proxy the backend API routes to the FastAPI server on :8014.
// In production these paths are served by the same FastAPI app (same origin),
// so no proxy / CORS is involved.
const backend = 'http://127.0.0.1:8014'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/upload': { target: backend, changeOrigin: true },
      '/capture': { target: backend, changeOrigin: true },
      '/history': { target: backend, changeOrigin: true },
      '/audio': { target: backend, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    globals: true,
  },
})
