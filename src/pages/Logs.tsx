import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { promotionApi } from '../api'
import { useChannels, useLogs } from '../hooks'
import type { PromoLog } from '../types'
import { isWaitingForRetry } from '../promotionEvents'
import { Async, Badge, Btn, Confirm, PageHead, Tbl, fmt, inp, toast } from '../ui'

type Act = { log: PromoLog; kind: 'disable' | 'clear' | 'status' }
const copy = { disable: ['Nonaktifkan log?', 'Status menjadi “Dinonaktifkan” dan jadwal berikutnya dihapus; log ini tidak akan dikirim ulang otomatis.'], clear: ['Hapus jadwal berikutnya?', 'Jadwal berikutnya dikosongkan; status log tidak berubah.'], status: ['Ubah status log?', 'Hanya mengubah catatan status di database, tidak mengirim apa pun.'] } as const

export default function Logs() {
  const qc = useQueryClient()
  const q = useLogs(), ch = useChannels()
  const [st, setSt] = useState(''), [s, setS] = useState(''), [ns, setNs] = useState('sent')
  const [act, setAct] = useState<Act | null>(null)
  const name = (id: number) => ch.data?.find((c) => c.id === id)?.name ?? ''
  const rows = (q.data ?? []).filter((l) => (!st || l.status === st) && (!s.trim() || `${l.id} ${l.channel_id} ${l.message_id} ${l.profile_id ?? ''} ${name(l.channel_id)}`.toLowerCase().includes(s.trim().toLowerCase())))
  const upd = useMutation({
    mutationFn: () => { const { log, kind } = act!; return promotionApi.updateLog(log.id, kind === 'disable' ? { disable: true } : kind === 'clear' ? { clear_schedule: true } : { status_update: ns }) },
    onSuccess: (r) => { toast('success', r.message); qc.invalidateQueries({ queryKey: ['logs'] }); setAct(null) },
  })
  return (
    <>
      <PageHead title="Log pengiriman" sub="Diperbarui otomatis setiap 15 detik. Filter dan pencarian dilakukan di browser; log tidak dapat dihapus." action={<Btn variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? 'Memuat…' : 'Muat ulang'}</Btn>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className={`${inp} max-w-xs`} aria-label="Cari log" placeholder="Cari ID atau nama channel…" value={s} onChange={(e) => setS(e.target.value)} />
        <select className={`${inp} max-w-44`} aria-label="Filter status" value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="">Semua status</option>{['queued', 'running', 'sent', 'cancelled', 'disabled', 'error'].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      <Async q={q} empty="Belum ada log pengiriman.">
        <Tbl head={['Dibuat', 'Channel', 'Pesan', 'Profil', 'Status', 'Timestamp', 'Jadwal berikutnya', 'Aksi']}>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>{fmt(l.created_at)}</td><td>{name(l.channel_id)} <span className="text-muted">#{l.channel_id}</span></td><td>#{l.message_id}</td><td>{l.profile_id ? `#${l.profile_id}` : '—'}</td>
              <td><Badge s={isWaitingForRetry(l) ? 'waiting' : l.status} />{isWaitingForRetry(l) && <div className="mt-1 max-w-52 text-xs text-amber-200">Menunggu profil Discord yang memenuhi syarat; akan dicoba ulang otomatis.</div>}</td><td>{fmt(l.timestamp)}</td><td>{fmt(l.next_run)}</td>
              <td className="whitespace-nowrap">
                <Btn variant="ghost" disabled={l.status === 'disabled'} onClick={() => setAct({ log: l, kind: 'disable' })}>Nonaktifkan</Btn>{' '}
                <Btn variant="ghost" disabled={!l.next_run} onClick={() => setAct({ log: l, kind: 'clear' })}>Hapus jadwal</Btn>{' '}
                <Btn variant="ghost" onClick={() => { setNs('sent'); setAct({ log: l, kind: 'status' }) }}>Ubah status</Btn>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="!py-8 text-center text-muted">Tidak ada log yang cocok dengan filter.</td></tr>}
        </Tbl>
      </Async>
      {act && (
        <Confirm title={copy[act.kind][0]} text={`Log #${act.log.id}. ${copy[act.kind][1]}`} danger={act.kind !== 'status'} pending={upd.isPending} onOk={() => upd.mutate()} onClose={() => setAct(null)}>
          {act.kind === 'status' && <select className={`${inp} mt-3`} aria-label="Status baru" value={ns} onChange={(e) => setNs(e.target.value)}>{['queued', 'running', 'sent'].map((x) => <option key={x}>{x}</option>)}</select>}
        </Confirm>
      )}
    </>
  )
}
