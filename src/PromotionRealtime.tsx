import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { promotionApi } from './api'
import { notifyPromotionCompletion, parsePromotionCompletion, schedulingWebSocketUrl } from './promotionEvents'
import { Banner, Btn } from './ui'

type Connection = 'connecting' | 'connected' | 'reconnecting'

export default function PromotionRealtime() {
  const qc = useQueryClient()
  const [connection, setConnection] = useState<Connection>('connecting')
  const [apiIssue, setApiIssue] = useState('')
  const [queuedCount, setQueuedCount] = useState(0)
  const [permission, setPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const [permissionIssue, setPermissionIssue] = useState('')
  const secure = typeof window !== 'undefined' && window.isSecureContext
  const canRequestPermission = secure && permission === 'default'

  useEffect(() => {
    let stopped = false
    let socket: WebSocket | undefined
    let retryTimer = 0
    let stableTimer = 0
    let retry = 0
    let reconciling = false
    const backoff = () => Math.min(1000 * 2 ** retry++, 30_000)
    const reconcile = async () => {
      if (reconciling || stopped) return
      reconciling = true
      try {
        const logs = await promotionApi.logs()
        if (!stopped) {
          qc.setQueryData(['logs'], logs)
          setQueuedCount(logs.filter((log) => log.status === 'queued' && log.next_run).length)
          setApiIssue('')
        }
      } catch (error) {
        if (!stopped) setApiIssue(`Tidak dapat memuat status/log pengiriman: ${(error as Error).message}`)
      } finally {
        reconciling = false
      }
    }
    const connect = () => {
      if (stopped) return
      setConnection(retry ? 'reconnecting' : 'connecting')
      try {
        socket = new WebSocket(schedulingWebSocketUrl())
      } catch (error) {
        setApiIssue(`WebSocket scheduler tidak tersedia: ${(error as Error).message}`)
        setConnection('reconnecting')
        retryTimer = window.setTimeout(() => {
          void reconcile()
          connect()
        }, backoff())
        return
      }
      socket.onmessage = (message) => {
        let value: unknown
        try {
          value = JSON.parse(String(message.data))
        } catch (error) {
          console.error('Received invalid JSON from the scheduling WebSocket.', error)
          return
        }
        if (value && typeof value === 'object' && (value as Record<string, unknown>).type === 'scheduling.connected') {
          window.clearTimeout(stableTimer)
          stableTimer = window.setTimeout(() => { retry = 0 }, 30_000)
          setConnection('connected')
          void reconcile()
          return
        }
        const event = parsePromotionCompletion(String(message.data))
        if (!event || event.source !== 'scheduled') return
        notifyPromotionCompletion(event)
        void qc.invalidateQueries({ queryKey: ['logs'] })
      }
      socket.onerror = () => {
        if (!stopped) setApiIssue('Koneksi WebSocket scheduler gagal; mencoba menyambung kembali.')
      }
      socket.onclose = () => {
        if (stopped) return
        window.clearTimeout(stableTimer)
        setConnection('reconnecting')
        void reconcile()
        retryTimer = window.setTimeout(connect, backoff())
      }
    }

    void reconcile()
    connect()
    return () => {
      stopped = true
      window.clearTimeout(retryTimer)
      window.clearTimeout(stableTimer)
      socket?.close()
    }
  }, [qc])

  const requestPermission = async () => {
    if (!canRequestPermission) return
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      setPermissionIssue('')
    } catch (error) {
      setPermissionIssue(`Tidak dapat meminta izin notifikasi: ${(error as Error).message}`)
    }
  }

  const connectionText = connection === 'connected' ? 'Terhubung' : connection === 'connecting' ? 'Menghubungkan…' : 'Menyambungkan kembali…'
  return (
    <section className="mb-5 rounded-lg bg-surface p-4 ring-1 ring-line" aria-label="Koneksi pengiriman dan notifikasi">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className={`mr-2 inline-block size-2 rounded-full ${connection === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          Pengiriman terjadwal: <b>{connectionText}</b>
          {permission === 'granted' && <span className="ml-3 text-muted">Notifikasi browser diizinkan</span>}
          {permission === 'denied' && <span className="ml-3 text-muted">Notifikasi browser ditolak</span>}
          {permission === 'unsupported' && <span className="ml-3 text-muted">Browser ini tidak mendukung notifikasi</span>}
        </div>
        {canRequestPermission && <Btn variant="ghost" onClick={() => { void requestPermission() }}>Aktifkan notifikasi browser</Btn>}
      </div>
      {apiIssue && <Banner kind="warn">{apiIssue} Status terakhir tetap dapat dilihat di Log Pengiriman.</Banner>}
      {queuedCount > 0 && <p className="mt-2 text-xs text-muted">{queuedCount} log terjadwal masih dalam antrean dengan waktu berikutnya; detail ada di Log Pengiriman.</p>}
      {!secure && <p className="mt-2 text-xs text-amber-200">Notifikasi Chrome memerlukan konteks aman (HTTPS; localhost dikecualikan). Buka dashboard melalui HTTPS dan gunakan API HTTPS/WSS.</p>}
      {permission === 'denied' && <p className="mt-2 text-xs text-amber-200">Izin notifikasi ditolak. Ubah izin situs di pengaturan browser jika ingin mengaktifkannya.</p>}
      {permissionIssue && <p role="alert" className="mt-2 text-xs text-amber-200">{permissionIssue}</p>}
      <p className="mt-2 text-xs text-muted">Notifikasi hanya muncul ketika halaman terbuka dan terhubung. Notifikasi saat halaman ditutup memerlukan Web Push dan dukungan backend yang belum tersedia.</p>
    </section>
  )
}
