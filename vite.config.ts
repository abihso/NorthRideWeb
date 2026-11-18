import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode, command, isPreview }) => {
  const env = loadEnv(mode, import.meta.dirname)
  const apiUrl = (env.VITE_API_BASE_URL?.trim() || 'http://localhost:4000/api').replace(/\/+$/, '')

  return {
    plugins: [react()],
    // Only local development uses this proxy; deployed clients keep their API URL.
    server: command === 'serve' && !isPreview ? {
      proxy: {
        '^/api(?:/|$)': {
          target: apiUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          cookieDomainRewrite: '',
          cookiePathRewrite: '/',
          bypass(req) {
            // Do not turn the dev proxy into a cross-origin session endpoint.
            if (req.headers['sec-fetch-site'] === 'cross-site') return false
            if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return false
          },
          configure(proxy) {
            proxy.on('proxyReq', (request) => {
              // This is now a server-to-server request, not a browser CORS request.
              request.removeHeader('origin')
            })
            proxy.on('proxyRes', (response) => {
              // Keep session cookies usable on the local HTTP development server.
              const cookies = response.headers['set-cookie']
              if (cookies) {
                response.headers['set-cookie'] = cookies.map((cookie) => cookie
                  .replace(/;\s*Secure\b/gi, '')
                  .replace(/;\s*SameSite=None\b/gi, '; SameSite=Lax'))
              }
            })
          },
        },
      },
    } : undefined,
  }
})
