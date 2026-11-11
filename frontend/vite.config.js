import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// In dev, proxy the backend API routes to the FastAPI server on :8014.
// In production these paths are served by the same FastAPI app (same origin),
// so no proxy / CORS is involved.
const backend = 'http://127.0.0.1:8014'

export default defineConfig({
  plugins: [
    react(),
    // PWA (DESIGN_V2.md §2): the home-screen icon opens straight into the app
    // at /app, skipping the landing page. The service worker is build-only
    // (devOptions off by default), so `npm run dev` is unaffected.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Echo',
        short_name: 'Echo',
        description: 'Turn any sound into an interactive 3D trail through pitch, timbre and motion.',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        theme_color: '#121A15',
        background_color: '#121A15',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell is precached; API responses are never cached.
        // Workbox's default navigation fallback would answer EVERY page
        // navigation with index.html — including someone opening /history or
        // /samples (JSON API routes on this same origin) in a browser tab.
        // Allowlist only the two SPA entry points so everything else always
        // reaches FastAPI.
        // Precache the latin font files too, so the installed app keeps its
        // typefaces offline (other subsets load on demand from the network).
        globPatterns: ['**/*.{js,css,html}', 'assets/*-latin-*.woff2'],
        globIgnores: ['assets/*-latin-ext-*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/(\?.*)?$/, /^\/app([/?].*)?$/],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/upload': { target: backend, changeOrigin: true },
      '/capture': { target: backend, changeOrigin: true },
      '/history': { target: backend, changeOrigin: true },
      '/audio': { target: backend, changeOrigin: true },
      '/samples': { target: backend, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    globals: true,
  },
})
