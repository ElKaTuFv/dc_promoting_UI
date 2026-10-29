import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: /api diteruskan ke backend sehingga tidak butuh CORS (same-origin).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const allowedHost = (env.CLOUDFLARED_HOST || 'localhost')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      allowedHosts: [allowedHost],
      proxy: {
        '/api': { target: env.VITE_API_BASE_URL || 'http://localhost:2525', ws: true },
        '/discord-emojis/image/': {
          target: 'https://cdn.discordapp.com',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => `/emojis${path.replace(/^\/discord-emojis\/image/, '')}`,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              const token = env.DISCORD_TOKEN?.trim()
              if (token) proxyReq.setHeader('Authorization', /^Bot\s/i.test(token) ? token : `Bot ${token}`)
            })
            proxy.on('proxyRes', (proxyRes) => {
              if (proxyRes.statusCode === 200) proxyRes.headers['cache-control'] = 'public, max-age=86400'
            })
          },
        },
        '/discord-emojis/list': {
          target: 'https://discord.com',
          changeOrigin: true,
          secure: true,
          rewrite: () => '/api/v10/guilds/571992648190263317/emojis',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              const token = env.DISCORD_TOKEN?.trim()
              if (token) proxyReq.setHeader('Authorization', /^Bot\s/i.test(token) ? token : `Bot ${token}`)
            })
          },
        },
      },
    },
  }
})
