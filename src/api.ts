import axios, { type AxiosError, type AxiosResponse } from 'axios'
import type { Channel, ChannelInput, Envelope, LogUpdate, Msg, Profile, ProfileInput, PromoLog, SendResult } from './types'

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
export const apiBaseUrl = (() => {
  if (!configuredApiBase) return ''
  const base = new URL(configuredApiBase)
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && base.protocol === 'http:') base.protocol = 'https:'
  return base.toString().replace(/\/+$/, '')
})()

export function promotionWebSocketUrl(path: string) {
  const base = apiBaseUrl || window.location.origin
  const url = new URL(path, `${base}/`)
  url.protocol = new URL(base).protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

const http = axios.create({ baseURL: `${apiBaseUrl}/api/v1`, timeout: 20_000 })

export class ApiError extends Error {
  constructor(message: string, public kind: 'error' | 'cancelled' | 'http' | 'network') { super(message) }
}

/** Memeriksa HTTP status DAN envelope: HTTP 200 dengan status "error"/"cancelled" bukan sukses. */
async function call<T>(req: Promise<AxiosResponse<Envelope<T>>>, opts: { allowCancelled?: boolean } = {}): Promise<Envelope<T>> {
  try {
    const { data } = await req
    if (data.status === 'error') throw new ApiError(data.message || 'Operasi gagal.', 'error')
    if (data.status === 'cancelled' && !opts.allowCancelled) throw new ApiError(data.message || 'Operasi dibatalkan.', 'cancelled')
    return data
  } catch (e) {
    if (e instanceof ApiError) throw e
    const ax = e as AxiosError<any>
    if (!ax.response) throw new ApiError(ax.code === 'ECONNABORTED' ? 'Waktu permintaan habis. Cek status di Log Pengiriman sebelum mencoba lagi.' : 'Tidak dapat terhubung ke backend. Periksa alamat API dan pengaturan CORS/proxy.', 'network')
    const d = ax.response.data
    const msg = Array.isArray(d?.detail) ? d.detail.map((x: any) => `${(x.loc ?? []).slice(1).join('.')}: ${x.msg}`).join('; ') : (d?.message ?? d?.detail)
    throw new ApiError(typeof msg === 'string' && msg ? msg : `Permintaan gagal (HTTP ${ax.response.status}).`, 'http')
  }
}

const text = { headers: { 'Content-Type': 'text/plain' } }

export const channelsApi = {
  list: () => call<Channel[]>(http.get('/channels')).then((r) => r.data ?? []),
  get: (id: number) => call<Channel>(http.get(`/channels/${id}`)).then((r) => r.data),
  create: (b: ChannelInput) => call<unknown>(http.post('/channels/add-channel', b)),
  update: (id: number, b: Partial<ChannelInput>) => call<Channel>(http.put(`/channels/${id}`, b)),
  remove: (id: number) => call<null>(http.delete(`/channels/${id}`)),
}

export const messagesApi = {
  list: () => call<Msg[]>(http.get('/messages')).then((r) => r.data ?? []),
  get: (id: number) => call<Msg>(http.get(`/messages/${id}`)).then((r) => r.data),
  // Body text/plain, world di query string — bukan JSON.
  create: (world: string, body: string) => call<Msg>(http.post('/messages/add-message', body, { params: { world }, ...text })),
  update: (id: number, world: string, body: string) => call<Msg>(http.put(`/messages/${id}`, body, { params: { world }, ...text })),
  remove: (id: number) => call<null>(http.delete(`/messages/${id}`)),
}

export const profilesApi = {
  list: () => call<Profile[]>(http.get('/profiles')).then((r) => r.data ?? []),
  get: (id: number) => call<Profile>(http.get(`/profiles/${id}`)).then((r) => r.data),
  create: (b: ProfileInput) => call<Profile>(http.post('/profiles', b)),
  update: (id: number, b: Partial<ProfileInput>) => call<Profile>(http.put(`/profiles/${id}`, b)),
  remove: (id: number) => call<null>(http.delete(`/profiles/${id}`)),
  // Menunggu pengguna login di browser backend; bisa lama.
  login: (id: number) => call<{ id: number; name: string }>(http.post(`/profiles/${id}/login`, null, { timeout: 600_000 })),
}

export const promotionApi = {
  send: (b: { message_id: number; channel_id: number; profile_id?: number }) =>
    call<SendResult>(http.post('/promotion/send-message', b), { allowCancelled: true }),
  logs: () => call<PromoLog[]>(http.get('/promotion/logs')).then((r) => r.data ?? []),
  log: (id: number) => call<PromoLog>(http.get(`/promotion/logs/${id}`)).then((r) => r.data),
  updateLog: (id: number, params: LogUpdate) => call<PromoLog>(http.put(`/promotion/logs/${id}`, null, { params })),
}
