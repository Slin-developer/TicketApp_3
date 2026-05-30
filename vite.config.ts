import path from 'node:path'
import fs from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isDev = process.env.NODE_ENV === 'development'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: isDev ? {
    host: true,
    port: 5173,
    https: {
      key: fs.readFileSync('./certs/localhost.key'),
      cert: fs.readFileSync('./certs/localhost.crt'),
    },
  } : undefined,
  preview: {
    host: true,
    port: 4173,
  },
})

// Note: For local network testing with both HTTPS (camera support) and HTTP (faster testing),
// use: npm run dev:both
// This serves HTTPS on 5173 and HTTP on 5174
