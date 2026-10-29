import { Async, Badge, PageHead, Tbl, fmt } from '../ui'
import { useChannels, useLogs, useMessages, useProfiles } from '../hooks'
import { isWaitingForRetry } from '../promotionEvents'

export default function Dashboard() {
  const ch = useChannels(), ms = useMessages(), pr = useProfiles(), lg = useLogs()
  const stats = [['Channel', ch, 'border-accent'], ['Pesan', ms, 'border-emerald-500'], ['Profil Discord', pr, 'border-fuchsia-500'], ['Log pengiriman', lg, 'border-amber-400']] as const
  const name = (id: number) => ch.data?.find((c) => c.id === id)?.name ?? `#${id}`
  const cnt = (lg.data ?? []).reduce<Record<string, number>>((a, l) => {
    const status = isWaitingForRetry(l) ? 'waiting' : l.status
    return { ...a, [status]: (a[status] ?? 0) + 1 }
  }, {})
  return (
    <>
      <PageHead title="Dashboard" sub="Angka dihitung dari data endpoint yang tersedia. Pengiriman terjadwal dijalankan oleh scheduler (Celery Beat) dan worker di backend, bukan oleh halaman ini." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([l, q, c]) => (
          <div key={l} className={`rounded-lg border-l-4 bg-surface p-4 ring-1 ring-line ${c}`}>
            <div className="text-sm text-muted">{l}</div>
            <div className="mt-1 text-3xl font-bold text-white" title={q.error ? (q.error as Error).message : undefined}>{q.isLoading ? '…' : q.error ? 'Gagal' : q.data?.length}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{Object.entries(cnt).map(([s, n]) => <span key={s} className="flex items-center gap-1.5 text-sm"><Badge s={s} />{n}</span>)}</div>
      <h2 className="mb-2 mt-6 text-lg font-semibold">Pengiriman terbaru</h2>
      <Async q={lg} empty="Belum ada log pengiriman. Mulai dari menu Kirim promosi.">
        <Tbl head={['Waktu', 'Channel', 'Pesan', 'Status', 'Jadwal berikutnya']}>
          {lg.data?.slice(0, 8).map((l) => (
            <tr key={l.id}><td>{fmt(l.timestamp)}</td><td>{name(l.channel_id)}</td><td>#{l.message_id}</td><td><Badge s={isWaitingForRetry(l) ? 'waiting' : l.status} />{isWaitingForRetry(l) && <div className="mt-1 text-xs text-amber-200">Akan dicoba ulang otomatis</div>}</td><td>{fmt(l.next_run)}</td></tr>
          ))}
        </Tbl>
      </Async>
    </>
  )
}
