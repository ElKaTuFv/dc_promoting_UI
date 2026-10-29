import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { promotionApi, promotionWebSocketUrl } from '../api'
import { useChannels, useLogs, useMessages, useProfiles } from '../hooks'
import type { PromotionCompletion, SendResult } from '../types'
import { isWaitingForRetry, notifyPromotionCompletion, parsePromotionCompletion } from '../promotionEvents'
import { Banner, Btn, Confirm, Field, PageHead, inp, toast } from '../ui'

type Res = { kind: 'queued'; result: SendResult } | { kind: 'completed'; event: PromotionCompletion } | { kind: 'failed'; message: string }

export default function Send() {
  const qc = useQueryClient()
  const ms = useMessages(), ch = useChannels(), pr = useProfiles(), logs = useLogs()
  const [m, setM] = useState(''), [c, setC] = useState(''), [p, setP] = useState('')
  const [ask, setAsk] = useState(false)
  const [res, setRes] = useState<Res | null>(null)
  const [connectionIssue, setConnectionIssue] = useState('')
  const details = useRef<{ channel?: string; message?: string }>({})
  const msg = ms.data?.find((x) => x.id === +m), chan = ch.data?.find((x) => x.id === +c), prof = pr.data?.find((x) => x.id === +p)
  const low = prof && chan && prof.level < chan.channel_level
  const queued = res?.kind === 'queued' ? res.result : null
  const completed = res?.kind === 'completed' ? res.event : null
  const currentLog = completed ? logs.data?.find((log) => log.id === completed.log_id) : undefined
  const completedStatus = currentLog?.status === 'sent' || currentLog?.status === 'success'
    ? 'success'
    : currentLog?.status === 'error' ? 'error' : completed?.status
  const waitingForRetry = Boolean(currentLog && isWaitingForRetry(currentLog))

  useEffect(() => {
    if (!queued) return
    let stopped = false
    let socket: WebSocket | undefined
    let retryTimer = 0
    let pollTimer = 0
    let retry = 0
    let checkingLog = false
    let finishing = false
    const backoff = () => Math.min(1000 * 2 ** retry++, 30_000)
    const finish = async (event: PromotionCompletion) => {
      if (stopped || finishing) return
      finishing = true
      if (event.status === 'cancelled') {
        try {
          const logs = await promotionApi.logs()
          if (!stopped) qc.setQueryData(['logs'], logs)
        } catch (error) {
          if (!stopped) setConnectionIssue(`Belum dapat menyelaraskan status log: ${(error as Error).message}`)
        }
      }
      if (stopped) return
      stopped = true
      window.clearTimeout(retryTimer)
      window.clearInterval(pollTimer)
      socket?.close()
      notifyPromotionCompletion(event, details.current)
      setRes({ kind: 'completed', event })
      if (event.status !== 'cancelled') setConnectionIssue('')
      void qc.invalidateQueries({ queryKey: ['logs'] })
    }
    const reconcile = async () => {
      if (checkingLog || stopped) return
      checkingLog = true
      try {
        const logs = await promotionApi.logs()
        if (!stopped) qc.setQueryData(['logs'], logs)
        const log = logs.find((item) => item.id === queued.log_id)
        if (!log) return
        if (log.status === 'sent' || log.status === 'success' || log.status === 'error' || log.status === 'cancelled') {
          finish({
            type: 'promotion.completed',
            log_id: queued.log_id,
            source: 'manual',
            status: log.status === 'sent' ? 'success' : log.status,
            message: log.status === 'error' ? 'Worker melaporkan pengiriman gagal.' : log.status === 'cancelled' ? 'Pengiriman dibatalkan oleh worker.' : 'Worker menyelesaikan pengiriman.',
            data: { channel_id: log.channel_id, message_id: log.message_id },
          })
        }
      } catch (error) {
        if (!stopped) setConnectionIssue(`Belum dapat memeriksa hasil worker: ${(error as Error).message}`)
      } finally {
        checkingLog = false
      }
    }
    const connect = () => {
      if (stopped) return
      try {
        socket = new WebSocket(promotionWebSocketUrl(queued.websocket_path))
      } catch (error) {
        setConnectionIssue(`Koneksi WebSocket gagal: ${(error as Error).message}`)
        retryTimer = window.setTimeout(connect, backoff())
        return
      }
      socket.onopen = () => {
        setConnectionIssue('')
        void reconcile()
      }
      socket.onmessage = (message) => {
        const event = parsePromotionCompletion(String(message.data))
        if (event?.log_id === queued.log_id) void finish(event)
      }
      socket.onerror = () => {
        setConnectionIssue('Koneksi ke worker terganggu; mencoba kembali dan memeriksa log.')
        socket?.close()
      }
      socket.onclose = () => {
        if (stopped) return
        setConnectionIssue('Koneksi ke worker terputus; mencoba kembali dan memeriksa log.')
        retryTimer = window.setTimeout(connect, backoff())
      }
    }

    connect()
    pollTimer = window.setInterval(() => { void reconcile() }, 10_000)
    return () => {
      stopped = true
      window.clearTimeout(retryTimer)
      window.clearInterval(pollTimer)
      socket?.close()
    }
  }, [queued, qc])

  const send = useMutation({
    mutationFn: () => promotionApi.send({ message_id: +m, channel_id: +c, ...(p ? { profile_id: +p } : {}) }),
    onSuccess: (r) => {
      details.current = { channel: chan?.name, message: msg ? `Pesan untuk ${msg.world}` : undefined }
      setRes({ kind: 'queued', result: r.data })
      setConnectionIssue('')
      qc.invalidateQueries({ queryKey: ['logs'] })
      toast('warn', `Pengiriman diterima dan masuk antrean (log #${r.data.log_id}). Menunggu konfirmasi worker.`)
    },
    onError: (e) => { setRes({ kind: 'failed', message: e.message }); toast('error', e.message) },
    onSettled: () => setAsk(false),
  })
  return (
    <>
      <PageHead title="Kirim promosi" sub="Permintaan masuk antrean backend. Jika belum ada profil Discord yang memenuhi syarat, scheduler akan mencoba lagi otomatis pada siklus berikutnya." />
      <div className="grid gap-6 lg:grid-cols-2">
        <form className="space-y-4 rounded-lg bg-surface p-5 ring-1 ring-line" onSubmit={(e) => { e.preventDefault(); if (m && c) setAsk(true) }}>
          <Field label="Pesan"><select className={inp} value={m} onChange={(e) => setM(e.target.value)} required><option value="">Pilih pesan…</option>{ms.data?.map((x) => <option key={x.id} value={x.id}>#{x.id} · {x.world} — {x.message.slice(0, 40)}</option>)}</select></Field>
          <Field label="Channel"><select className={inp} value={c} onChange={(e) => setC(e.target.value)} required><option value="">Pilih channel…</option>{ch.data?.map((x) => <option key={x.id} value={x.id}>{x.name} (level min. {x.channel_level})</option>)}</select></Field>
          <Field label="Profil" hint="Tanpa pilihan, backend memilih profil aktif yang memenuhi level channel."><select className={inp} value={p} onChange={(e) => setP(e.target.value)}><option value="">Pilih otomatis oleh backend</option>{pr.data?.map((x) => <option key={x.id} value={x.id}>{x.name} (level {x.level})</option>)}</select></Field>
          {low && <Banner>Level profil ({prof!.level}) lebih rendah dari level minimum channel ({chan!.channel_level}). Backend kemungkinan menolak pengiriman ini.</Banner>}
          <Btn type="submit" disabled={!m || !c || send.isPending || Boolean(queued)}>{send.isPending ? 'Mengirim…' : queued ? 'Menunggu hasil worker…' : 'Tinjau & kirim'}</Btn>
        </form>
        <div>
          {send.isPending && <Banner kind="info">Mengirim permintaan ke backend…</Banner>}
          {connectionIssue && <Banner kind="warn">{connectionIssue}</Banner>}
          {res && (
            res.kind === 'queued'
              ? <Banner kind="info"><b>Diterima dan masuk antrean; belum berarti sudah terkirim.</b> Menunggu hasil worker.<div className="mt-1">Log #{res.result.log_id} · status {res.result.status}</div></Banner>
              : res.kind === 'failed'
                ? <Banner kind="error"><b>Permintaan gagal.</b> — {res.message}</Banner>
                : <Banner kind={completedStatus === 'success' ? 'success' : completedStatus === 'cancelled' ? 'warn' : 'error'}>
                    {waitingForRetry
                      ? <><b>Menunggu profil Discord yang memenuhi syarat; akan dicoba ulang otomatis.</b> Scheduler akan mencoba pada siklus berikutnya.<div className="mt-1">Jadwal berikutnya: {currentLog?.next_run ? new Date(currentLog.next_run).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB' : 'menunggu jadwal backend'}</div></>
                      : <><b>{completedStatus === 'success' ? 'Pengiriman berhasil' : completedStatus === 'cancelled' ? 'Pengiriman dibatalkan' : 'Pengiriman gagal'}</b> — {completedStatus === res.event.status ? res.event.message : completedStatus === 'success' ? 'Scheduler berhasil menyelesaikan pengiriman.' : 'Scheduler melaporkan pengiriman gagal.'}</>}
                    <div className="mt-1">Log #{res.event.log_id}</div>
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
