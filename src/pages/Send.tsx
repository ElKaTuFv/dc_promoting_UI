import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { promotionApi } from '../api'
import { useChannels, useMessages, useProfiles } from '../hooks'
import type { SendResult } from '../types'
import { Banner, Btn, Confirm, Field, PageHead, fmt, inp, toast } from '../ui'

type Res = { status: string; message: string; data: SendResult | null }

export default function Send() {
  const qc = useQueryClient()
  const ms = useMessages(), ch = useChannels(), pr = useProfiles()
  const [m, setM] = useState(''), [c, setC] = useState(''), [p, setP] = useState('')
  const [ask, setAsk] = useState(false)
  const [res, setRes] = useState<Res | null>(null)
  const msg = ms.data?.find((x) => x.id === +m), chan = ch.data?.find((x) => x.id === +c), prof = pr.data?.find((x) => x.id === +p)
  const low = prof && chan && prof.level < chan.channel_level
  const send = useMutation({
    mutationFn: () => promotionApi.send({ message_id: +m, channel_id: +c, ...(p ? { profile_id: +p } : {}) }),
    onSuccess: (r) => { setRes({ status: r.status, message: r.message, data: r.data }); qc.invalidateQueries({ queryKey: ['logs'] }); toast(r.status === 'cancelled' ? 'warn' : 'success', r.message) },
    onError: (e) => { setRes({ status: 'error', message: e.message, data: null }); toast('error', e.message) },
    onSettled: () => setAsk(false),
  })
  const kind = res?.status === 'success' ? 'success' : res?.status === 'cancelled' ? 'warn' : 'error'
  return (
    <>
      <PageHead title="Kirim promosi" sub="Pengiriman berjalan lewat browser backend dan bisa memakan waktu beberapa menit. Jangan kirim ulang sebelum hasil muncul." />
      <div className="grid gap-6 lg:grid-cols-2">
        <form className="space-y-4 rounded-lg bg-surface p-5 ring-1 ring-line" onSubmit={(e) => { e.preventDefault(); if (m && c) setAsk(true) }}>
          <Field label="Pesan"><select className={inp} value={m} onChange={(e) => setM(e.target.value)} required><option value="">Pilih pesan…</option>{ms.data?.map((x) => <option key={x.id} value={x.id}>#{x.id} · {x.world} — {x.message.slice(0, 40)}</option>)}</select></Field>
          <Field label="Channel"><select className={inp} value={c} onChange={(e) => setC(e.target.value)} required><option value="">Pilih channel…</option>{ch.data?.map((x) => <option key={x.id} value={x.id}>{x.name} (level min. {x.channel_level})</option>)}</select></Field>
          <Field label="Profil" hint="Tanpa pilihan, backend memilih profil aktif yang memenuhi level channel."><select className={inp} value={p} onChange={(e) => setP(e.target.value)}><option value="">Pilih otomatis oleh backend</option>{pr.data?.map((x) => <option key={x.id} value={x.id}>{x.name} (level {x.level})</option>)}</select></Field>
          {low && <Banner>Level profil ({prof!.level}) lebih rendah dari level minimum channel ({chan!.channel_level}). Backend kemungkinan menolak pengiriman ini.</Banner>}
          <Btn type="submit" disabled={!m || !c || send.isPending}>{send.isPending ? 'Mengirim…' : 'Tinjau & kirim'}</Btn>
        </form>
        <div>
          {send.isPending && <Banner kind="info">Pengiriman sedang berjalan di backend… Mohon tunggu.</Banner>}
          {res && (
            <Banner kind={kind === 'success' ? 'success' : kind === 'warn' ? 'warn' : 'error'}>
              <b>{res.status === 'success' ? 'Terkirim' : res.status === 'cancelled' ? 'Dibatalkan' : 'Gagal'}</b> — {res.message}
              {res.data && <div className="mt-1">Log #{res.data.log_id}{res.status === 'cancelled' && (res.data.next_run ? <> · dicoba lagi pada {fmt(res.data.next_run)}</> : ' · belum ada jadwal ulang')}{res.status === 'success' && <> · jadwal berikutnya {fmt(res.data.next_run)}</>}</div>}
            </Banner>
          )}
        </div>
      </div>
      {ask && msg && chan && (
        <Confirm title="Kirim promosi sekarang?" label="Kirim sekarang" pending={send.isPending} onOk={() => send.mutate()} onClose={() => setAsk(false)}
          text={<dl className="space-y-2"><div><dt className="font-medium">Channel</dt><dd>{chan.name}</dd></div><div><dt className="font-medium">Profil</dt><dd>{prof ? `${prof.name} (level ${prof.level})` : 'Dipilih otomatis oleh backend'}</dd></div><div><dt className="font-medium">Pesan ({msg.world})</dt><dd><pre className="whitespace-pre-wrap rounded bg-canvas p-2 font-sans">{msg.message}</pre></dd></div></dl>} />
      )}
    </>
  )
}
