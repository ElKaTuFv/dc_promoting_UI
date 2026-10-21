import { useEffect, useState } from 'react'
import { Toaster } from './ui'
import Dashboard from './pages/Dashboard'
import Channels from './pages/Channels'
import Messages from './pages/Messages'
import Profiles from './pages/Profiles'
import Send from './pages/Send'
import Logs from './pages/Logs'
import PromotionRealtime from './PromotionRealtime'

const pages = {
  dashboard: ['Dashboard', Dashboard], send: ['Kirim promosi', Send], logs: ['Log pengiriman', Logs],
  channels: ['Channel', Channels], messages: ['Pesan', Messages], profiles: ['Profil Discord', Profiles],
} as const
type Key = keyof typeof pages
const groups: [string, Key[]][] = [['Operasional', ['dashboard', 'send', 'logs']], ['Data', ['channels', 'messages', 'profiles']]]
const read = (): Key => (location.hash.slice(1) in pages ? (location.hash.slice(1) as Key) : 'dashboard')

export default function App() {
  const [k, setK] = useState<Key>(read)
  useEffect(() => {
    const h = () => setK(read())
    addEventListener('hashchange', h)
    return () => removeEventListener('hashchange', h)
  }, [])
  const Page = pages[k][1]
  return (
    <div className="min-h-screen md:flex">
      <aside className="bg-ink md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0">
        <div className="flex items-center gap-2.5 px-4 py-3 shadow-[0_1px_0_rgba(0,0,0,.3)] md:h-14">
          <img src="/logo.svg" alt="" className="size-9" />
          <span className="font-bold text-white">Promosi Discord</span>
        </div>
        <nav aria-label="Navigasi utama" className="flex gap-3 overflow-x-auto px-2 pb-2 md:block md:space-y-5 md:p-3">
          {groups.map(([g, ids]) => (
            <div key={g} className="flex gap-1 md:block md:space-y-0.5">
              <div className="hidden px-2 pb-1 text-xs font-semibold text-muted md:block">{g}</div>
              {ids.map((id) => (
                <a key={id} href={`#${id}`} aria-current={id === k ? 'page' : undefined}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-link ${id === k ? 'bg-raised font-semibold text-white' : 'text-muted hover:bg-raised/60 hover:text-body'}`}>
                  <span aria-hidden className="text-lg leading-none opacity-60">#</span>{pages[id][0]}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="mx-auto w-full max-w-6xl p-4 md:p-8"><PromotionRealtime /><Page /></main>
      <Toaster />
    </div>
  )
}
