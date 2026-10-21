import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: /api diteruskan ke backend sehingga tidak butuh CORS (same-origin).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      allowedHosts: [env.CLOUDFLARED_HOST || 'leo-hay-fish-vegetation.trycloudflare.com'],
      proxy: { '/api': { target: env.VITE_API_BASE_URL || 'http://localhost:2525', ws: true } },
    },
  }
})
