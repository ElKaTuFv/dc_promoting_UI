import axios, { type AxiosError, type AxiosResponse } from 'axios'
import { type Channel, type ChannelInput, type Chat, type ChatContact, type ChatCreateRequest, type ChatReplyAccepted, type ChatReplyRequest, type ChatRoomId, type ChatUpdateRequest, type Envelope, type ListenerStatus, type LogUpdate, type Msg, type Profile, type ProfileInput, type PromoLog, type ReplyTaskStatusData, type SendResult } from './types'

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
export function parseApiJson(data: string): unknown {
  const losslessRoomIds = data.replace(/("room_id"\s*:\s*)(\d+)(?=\s*[,}])/g, (match, prefix: string, digits: string) => {
    return Number.isSafeInteger(Number(digits)) ? match : `${prefix}"${digits}"`
  })
  return JSON.parse(losslessRoomIds) as unknown
}

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

export function chatWebSocketUrl(profileId: number) {
  const base = apiBaseUrl || window.location.origin
  const url = new URL(`${base}/api/v1/chats/ws/${profileId}`)
  url.protocol = new URL(base).protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

const http = axios.create({
  baseURL: `${apiBaseUrl}/api/v1`,
  timeout: 20_000,
  transformResponse: [(data: unknown) => typeof data === 'string' ? parseApiJson(data) : data],
})

export class ApiError extends Error {
  constructor(message: string, public kind: 'error' | 'cancelled' | 'http' | 'network') { super(message) }
}

function isChatReplyAccepted(value: unknown): value is ChatReplyAccepted {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<ChatReplyAccepted>
  if (result.status !== 'accepted' || typeof result.message !== 'string' || !result.data || typeof result.data !== 'object') return false
  const data = result.data as Partial<ChatReplyAccepted['data']>
  return Number.isSafeInteger(data.chat_id) && typeof data.task_id === 'string' && data.task_id.length > 0 && data.status === 'queued'
}

function isReplyTaskStatusData(value: unknown): value is ReplyTaskStatusData {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<ReplyTaskStatusData>
  return typeof task.task_id === 'string'
    && Number.isSafeInteger(task.chat_id)
    && Number.isSafeInteger(task.profile_id)
    && isChatRoomId(task.room_id)
    && (task.status === 'queued' || task.status === 'processing' || task.status === 'sent' || task.status === 'failed')
    && (task.error === null || typeof task.error === 'string')
    && (task.reply_chat_id === null || Number.isSafeInteger(task.reply_chat_id))
    && typeof task.created_at === 'string'
    && (task.updated_at === null || typeof task.updated_at === 'string')
}

function isChatRoomId(value: unknown): value is ChatRoomId {
  return (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    || (typeof value === 'string' && /^[1-9]\d*$/.test(value))
}

function normalizeChatMessage(value: unknown): Chat {
  if (!value || typeof value !== 'object') throw new ApiError('Backend mengembalikan pesan chat yang tidak valid.', 'error')
  const raw = value as Record<string, unknown>
  if (!Number.isSafeInteger(raw.id)
    || (raw.room_id !== null && !isChatRoomId(raw.room_id))
    || (raw.profile_id !== null && !Number.isSafeInteger(raw.profile_id))
    || typeof raw.global_name !== 'string'
    || typeof raw.username !== 'string'
    || typeof raw.is_me !== 'boolean'
    || (raw.content !== null && typeof raw.content !== 'string')
    || (raw.status !== null && raw.status !== 'read' && raw.status !== 'unread')
    || (raw.timestamp !== null && typeof raw.timestamp !== 'string')
    || typeof raw.created_at !== 'string'
    || (raw.updated_at !== null && typeof raw.updated_at !== 'string')) {
    throw new ApiError('Backend mengembalikan pesan chat dengan field yang tidak valid.', 'error')
  }
  return {
    id: raw.id as number,
    room_id: raw.room_id as ChatRoomId | null,
    profile_id: raw.profile_id as number | null,
    global_name: raw.global_name,
    username: raw.username,
    is_me: raw.is_me,
    content: raw.content as string | null,
    status: raw.status as Chat['status'],
    timestamp: raw.timestamp as string | null,
    created_at: raw.created_at,
    updated_at: raw.updated_at as string | null,
  }
}

function normalizeChatList(value: unknown): Chat[] {
  if (!Array.isArray(value)) throw new ApiError('Backend mengembalikan daftar chat yang tidak valid.', 'error')
  return value.map(normalizeChatMessage)
}

function normalizeChatContacts(value: unknown): ChatContact[] {
  if (!Array.isArray(value)) throw new ApiError('Backend mengembalikan daftar kontak chat yang tidak valid.', 'error')
  return value.map((value) => {
    if (!value || typeof value !== 'object') throw new ApiError('Backend mengembalikan kontak chat yang tidak valid.', 'error')
    const contact = value as Record<string, unknown>
    if (typeof contact.username !== 'string' || typeof contact.global_name !== 'string') {
      throw new ApiError('Backend mengembalikan kontak chat dengan field yang tidak valid.', 'error')
    }
    return {
      username: contact.username,
      global_name: contact.global_name,
      last_chat: normalizeChatMessage(contact.last_chat),
    }
  })
}

function errorMessage(error: unknown) {
  const ax = error as AxiosError<unknown>
  if (!ax.response) {
    return new ApiError(
      ax.code === 'ECONNABORTED'
        ? 'Waktu permintaan habis. Cek status di Log Pengiriman sebelum mencoba lagi.'
        : 'Tidak dapat terhubung ke backend. Periksa alamat API dan pengaturan CORS/proxy.',
      'network',
    )
  }
  const data = ax.response.data
  if (data && typeof data === 'object') {
    const body = data as { detail?: unknown; message?: unknown }
    if (body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail)) {
      const detail = body.detail as { message?: unknown; data?: unknown }
      if (typeof detail.message === 'string') return new ApiError(detail.message, 'http')
      if (detail.data && typeof detail.data === 'object' && !Array.isArray(detail.data)) {
        const detailData = detail.data as { error?: unknown }
        if (typeof detailData.error === 'string') return new ApiError(detailData.error, 'http')
      }
    }
    if (Array.isArray(body.detail)) {
      const details = body.detail.map((item) => {
        if (!item || typeof item !== 'object') return ''
        const detail = item as { loc?: unknown; msg?: unknown }
        const location = Array.isArray(detail.loc) ? detail.loc.slice(1).join('.') : ''
        return `${location ? `${location}: ` : ''}${typeof detail.msg === 'string' ? detail.msg : 'Input tidak valid.'}`
      }).filter(Boolean).join('; ')
      if (details) return new ApiError(details, 'http')
    }
    const message = typeof body.message === 'string' ? body.message : typeof body.detail === 'string' ? body.detail : ''
    if (message) return new ApiError(message, 'http')
  }
  return new ApiError(`Permintaan gagal (HTTP ${ax.response.status}).`, 'http')
}

/** Memeriksa HTTP status DAN envelope: HTTP 200 dengan status "error"/"cancelled" bukan sukses. */
async function call<T>(req: Promise<AxiosResponse<unknown>>, opts: { allowCancelled?: boolean } = {}): Promise<Envelope<T>> {
  try {
    const response = await req
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
      throw errorMessage({ response } as AxiosError<unknown>)
    }
    const body: unknown = response.data
    if (!body || typeof body !== 'object') throw new ApiError('Backend mengembalikan response yang tidak valid.', 'error')
    const envelope = body as Partial<Envelope<T>>
    if (typeof envelope.message !== 'string' || !('data' in envelope)) {
      throw new ApiError('Backend mengembalikan envelope response yang tidak valid.', 'error')
    }
    if (envelope.status === 'error') throw new ApiError(envelope.message || 'Operasi gagal.', 'error')
    if (envelope.status === 'cancelled' && !opts.allowCancelled) {
      throw new ApiError(envelope.message || 'Operasi dibatalkan.', 'cancelled')
    }
    if (envelope.status !== 'success' && envelope.status !== 'cancelled') {
      throw new ApiError('Backend mengembalikan status response yang tidak valid.', 'error')
    }
    return envelope as Envelope<T>
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw errorMessage(e)
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
  startListener: (id: number) => call<{ id: number; listener_status: ListenerStatus }>(http.post(`/profiles/${id}/listener/start`)),
  stopListener: (id: number) => call<{ id: number; listener_status: ListenerStatus }>(http.post(`/profiles/${id}/listener/stop`)),
}

export const chatsApi = {
  list: (signal?: AbortSignal, roomId?: ChatRoomId) => {
    const params = new URLSearchParams()
    if (roomId !== undefined) params.set('room_id', String(roomId))
    const encoded = params.toString()
    const query = encoded ? `?${encoded}` : ''
    return call<unknown>(http.get(`/chats${query}`, { signal })).then((r) => normalizeChatList(r.data))
  },
  get: (chatId: number, roomId?: ChatRoomId) => {
    const params = new URLSearchParams()
    if (roomId !== undefined) params.set('room_id', String(roomId))
    const encoded = params.toString()
    const query = encoded ? `?${encoded}` : ''
    return call<unknown>(http.get(`/chats/${chatId}${query}`)).then((r) => normalizeChatMessage(r.data))
  },
  contacts: (profileId: number, signal?: AbortSignal, roomId?: ChatRoomId) => {
    const params = new URLSearchParams()
    if (roomId !== undefined) params.set('room_id', String(roomId))
    const encoded = params.toString()
    const query = encoded ? `?${encoded}` : ''
    return call<unknown>(http.get(`/chats/profiles/${profileId}/contacts${query}`, { signal })).then((r) => normalizeChatContacts(r.data))
  },
  conversation: (profileId: number, username: string, signal?: AbortSignal, roomId?: ChatRoomId) => {
    const params = new URLSearchParams({ username })
    if (roomId !== undefined) params.set('room_id', String(roomId))
    return call<unknown>(http.get(`/chats/profiles/${profileId}/conversation?${params}`, { signal })).then((r) => normalizeChatList(r.data))
  },
  create: (body: ChatCreateRequest) =>
    call<unknown>(http.post('/chats', body)).then((response) => normalizeChatMessage(response.data)),
  update: (chatId: number, body: ChatUpdateRequest) =>
    call<unknown>(http.put(`/chats/${chatId}`, body)).then((response) => normalizeChatMessage(response.data)),
  remove: (chatId: number) => call<null>(http.delete(`/chats/${chatId}`)),
  reply: async (chatId: number, body: ChatReplyRequest) => {
    try {
      const response = await http.post<ChatReplyAccepted>(`/chats/${chatId}/reply`, body)
      const result: unknown = response.data
      if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
        throw errorMessage({ response } as AxiosError<unknown>)
      }
      if (response.status !== 202 || !isChatReplyAccepted(result)) {
        throw new ApiError('Backend tidak mengonfirmasi bahwa balasan masuk antrean.', 'error')
      }
      return result
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw errorMessage(error)
    }
  },
  replyStatus: (taskId: string, signal?: AbortSignal) =>
    call<unknown>(http.get(`/chats/replies/${encodeURIComponent(taskId)}`, { signal }))
      .then((response) => {
        if (!isReplyTaskStatusData(response.data) || response.data.task_id !== taskId) {
          throw new ApiError('Backend mengembalikan status balasan yang tidak valid.', 'error')
        }
        return response.data
      }),
}

export const promotionApi = {
  send: (b: { message_id: number; channel_id: number; profile_id?: number }) =>
    call<SendResult>(http.post('/promotion/send-message', b), { allowCancelled: true }),
  logs: () => call<PromoLog[]>(http.get('/promotion/logs')).then((r) => r.data ?? []),
  log: (id: number) => call<PromoLog>(http.get(`/promotion/logs/${id}`)).then((r) => r.data),
  updateLog: (id: number, params: LogUpdate) => call<PromoLog>(http.put(`/promotion/logs/${id}`, null, { params })),
}
