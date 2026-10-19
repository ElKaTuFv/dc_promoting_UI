import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import { toast } from './ui'

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false }, mutations: { onError: (e) => toast('error', e.message) } },
})
createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={qc}><App /></QueryClientProvider></StrictMode>,
)
