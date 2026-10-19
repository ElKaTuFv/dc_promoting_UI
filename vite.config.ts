import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: /api diteruskan ke backend sehingga tidak butuh CORS (same-origin).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://10.0.0.9:2525' } },
})
