import { defineConfig, loadEnv } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { validateHostedApiUrl } from './src/app/services/apiConfig'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode, command }) => {
  const webBuild = mode === 'web' || process.env.VERCEL === '1';
  const env = loadEnv(mode, __dirname, 'VITE_');
  const apiUrl = process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL;
  if (command === 'build' && webBuild) validateHostedApiUrl(apiUrl);
  return {
  base: webBuild ? '/' : './',
  server: {
    host: '127.0.0.1',
    port: 8080,
    strictPort: true,
    watch: {
      ignored: ['**/.venv/**'],
    },
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // Code splitting optimization for better startup performance
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large charting library
          recharts: ['recharts'],
          // Split map engine
          maplibre: ['maplibre-gl'],
          // Split UI components library
          radix: [
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-dialog',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
          ],
        },
      },
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 1000,
  },
  }
})
