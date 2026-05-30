#!/usr/bin/env node

/**
 * Serves app on both HTTP and HTTPS for local network testing:
 * - HTTPS on 5173 (camera works on iOS Safari)
 * - HTTP on 5174 (faster, no camera - just for UI testing)
 */

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const certKey = path.resolve(__dirname, 'certs/localhost.key')
const certFile = path.resolve(__dirname, 'certs/localhost.crt')

async function start() {
  // Create Vite middleware for HTTPS
  const httpsVite = await createServer({
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      middlewareMode: true,
    },
  })

  // Create Vite middleware for HTTP
  const httpVite = await createServer({
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      middlewareMode: true,
    },
  })

  // HTTPS server
  const httpsServer = https.createServer(
    {
      key: fs.readFileSync(certKey),
      cert: fs.readFileSync(certFile),
    },
    httpsVite.middlewares
  )

  // HTTP server
  const httpServer = http.createServer(httpVite.middlewares)

  httpsServer.listen(5173)
  httpServer.listen(5174)

  console.log('\n✅ Local network dev servers ready!\n')
  console.log('🔒 HTTPS (with camera):  https://localhost:5173')
  console.log('🏃 HTTP (faster, no cam):  http://localhost:5174')

  try {
    const ip = execSync("ipconfig getifaddr en0", { encoding: 'utf-8' }).trim()
    console.log('\n📱 iPhone on same WiFi:')
    console.log(`   🔒 https://${ip}:5173  (camera works here!)`)
    console.log(`   🏃 http://${ip}:5174   (faster, but no camera)`)
  } catch (e) {
    // Silently ignore if can't get IP
  }
  console.log()
}

start().catch(console.error)
