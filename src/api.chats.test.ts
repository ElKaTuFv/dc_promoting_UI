import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get, post, put, remove } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), remove: vi.fn() }))
vi.mock('axios', () => ({ default: { create: () => ({ get, post, put, delete: remove }) } }))

import { chatWebSocketUrl, chatsApi, parseApiJson, profilesApi } from './api'

beforeEach(() => {
  vi.clearAllMocks()
  post.mockResolvedValue({ status: 200, data: { status: 'success', message: 'ok', data: { id: 12, listener_status: 'running' } } })
  put.mockResolvedValue({ status: 200, data: { status: 'success', message: 'ok', data: null } })
  remove.mockResolvedValue({ status: 200, data: { status: 'success', message: 'ok', data: null } })
})

describe('chatsApi', () => {
  const response = (data: unknown, status = 200) => ({ status, data: { status: 'success', message: 'ok', data } })

  it('preserves exact large numeric room IDs from JSON responses', () => {
    const body = parseApiJson('{"status":"success","message":"ok","data":[{"room_id":1562315127397548042}]}')
    expect(body).toEqual({
      status: 'success',
      message: 'ok',
      data: [{ room_id: '1562315127397548042' }],
    })
  })

  it('URL-encodes the exact username in the conversation query', async () => {
    get.mockResolvedValue(response([]))
    await chatsApi.conversation(12, 'name+tag &value')
    expect(get).toHaveBeenCalledWith(
      '/chats/profiles/12/conversation?username=name%2Btag+%26value',
      { signal: undefined },
    )
  })

  it('parses outgoing conversation rows from envelope.data with nullable fields intact', async () => {
    get.mockResolvedValue(response([{
          id: 56,
          profile_id: 1,
          global_name: 'bersan',
          username: 'bersan',
          content: 'Pesan milik profil',
          status: null,
          timestamp: '2026-11-10 15:40:09.812113+00',
          created_at: '2026-11-10 15:40:09.812113+00',
          updated_at: null,
          is_me: true,
          room_id: 156231512,
        }]))

    await expect(chatsApi.conversation(1, 'bersan')).resolves.toEqual([{
      id: 56,
      profile_id: 1,
      global_name: 'bersan',
      username: 'bersan',
      content: 'Pesan milik profil',
      timestamp: '2026-11-10 15:40:09.812113+00',
      created_at: '2026-11-10 15:40:09.812113+00',
      updated_at: null,
      is_me: true,
      room_id: 156231512,
      status: null,
    }])
  })

  it('passes the optional room filter to chat endpoints and omits it when unset', async () => {
    get.mockResolvedValueOnce(response([]))
    get.mockResolvedValueOnce(response([]))
    get.mockResolvedValueOnce(response({
      id: 17, room_id: 456, profile_id: 12, global_name: 'Alice', username: 'alice',
      is_me: false, content: 'hello', status: 'read', timestamp: null, created_at: '2026-11-10T10:00:00Z', updated_at: null,
    }))
    get.mockResolvedValueOnce(response([]))
    get.mockResolvedValueOnce(response([]))
    await chatsApi.list()
    await chatsApi.list(undefined, 456)
    await chatsApi.get(17, 456)
    await chatsApi.contacts(12, undefined, 456)
    await chatsApi.conversation(12, 'name+tag &value', undefined, 456)
    expect(get).toHaveBeenNthCalledWith(1, '/chats', { signal: undefined })
    expect(get).toHaveBeenNthCalledWith(2, '/chats?room_id=456', { signal: undefined })
    expect(get).toHaveBeenNthCalledWith(3, '/chats/17?room_id=456')
    expect(get).toHaveBeenNthCalledWith(4, '/chats/profiles/12/contacts?room_id=456', { signal: undefined })
    expect(get).toHaveBeenNthCalledWith(5, '/chats/profiles/12/conversation?username=name%2Btag+%26value&room_id=456', { signal: undefined })
  })

  it('parses contacts from envelope.data and validates each nested last_chat', async () => {
    const lastChat = {
      id: 42, room_id: '1562315127397548042', profile_id: 1, global_name: 'Magangerz', username: 'magangerz9963',
      is_me: false, content: 'lahhh?', status: 'read', timestamp: '2026-11-10T13:20:00.437000+00:00',
      created_at: '2026-11-10T13:20:02.581849+00:00', updated_at: '2026-11-10T14:26:31.406686+00:00',
    }
    get.mockResolvedValueOnce(response([{ username: 'magangerz9963', global_name: 'Magangerz', last_chat: lastChat }]))
    await expect(chatsApi.contacts(1)).resolves.toEqual([{ username: 'magangerz9963', global_name: 'Magangerz', last_chat: lastChat }])
    expect(get).toHaveBeenCalledWith('/chats/profiles/1/contacts', { signal: undefined })
  })

  it('enqueues a reply with the selected chat id and specified-reply setting', async () => {
    const accepted = {
      status: 'accepted',
      message: 'Reply queued for sending',
      data: { chat_id: 17, task_id: 'task-abc', status: 'queued' },
    }
    post.mockResolvedValue({ status: 202, data: accepted })
    await expect(chatsApi.reply(17, { reply: '  Halo  ', specified_reply: true })).resolves.toEqual(accepted)
    expect(post).toHaveBeenCalledWith('/chats/17/reply', { reply: '  Halo  ', specified_reply: true })
  })

  it('does not treat a non-202 or malformed accepted response as a queued reply', async () => {
    post.mockResolvedValueOnce({
      status: 200,
      data: { status: 'accepted', message: 'ok', data: { chat_id: 17, task_id: 'task-abc', status: 'queued' } },
    })
    await expect(chatsApi.reply(17, { reply: 'Halo', specified_reply: false })).rejects.toMatchObject({ kind: 'error' })

    post.mockResolvedValueOnce({ status: 202, data: { status: 'accepted', message: 'ok', data: null } })
    await expect(chatsApi.reply(17, { reply: 'Halo', specified_reply: false })).rejects.toMatchObject({ kind: 'error' })
  })

  it('surfaces broker and FastAPI validation errors for reply requests', async () => {
    post.mockRejectedValueOnce({
      response: { status: 503, data: { detail: { message: 'Broker tidak tersedia', data: { status: 'failed', error: 'Broker tidak tersedia' } } } },
    })
    await expect(chatsApi.reply(17, { reply: 'Halo', specified_reply: false })).rejects.toMatchObject({ message: 'Broker tidak tersedia' })

    post.mockResolvedValueOnce({ status: 503, data: { detail: { data: { error: 'Broker unavailable' } } } })
    await expect(chatsApi.reply(17, { reply: 'Halo', specified_reply: false })).rejects.toMatchObject({ message: 'Broker unavailable' })

    post.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ loc: ['body', 'reply'], msg: 'Field required' }] } },
    })
    await expect(chatsApi.reply(17, { reply: 'Halo', specified_reply: false })).rejects.toMatchObject({ message: 'reply: Field required' })
  })

  it('fetches and validates the latest status for a reply task', async () => {
    const status = {
      task_id: 'task /?1',
      chat_id: 17,
      profile_id: 12,
      room_id: 456,
      status: 'processing',
      error: null,
      reply_chat_id: null,
      created_at: '2026-11-10T10:00:00Z',
      updated_at: null,
    } as const
    get.mockResolvedValueOnce(response(status))
    await expect(chatsApi.replyStatus(status.task_id)).resolves.toEqual(status)
    expect(get).toHaveBeenCalledWith('/chats/replies/task%20%2F%3F1', { signal: undefined })

    get.mockResolvedValueOnce(response({ ...status, status: 'sending' }))
    await expect(chatsApi.replyStatus(status.task_id)).rejects.toMatchObject({ message: 'Backend mengembalikan status balasan yang tidak valid.' })
  })

  it('rejects an error envelope even when the HTTP request succeeds', async () => {
    get.mockResolvedValue({ status: 200, data: { status: 'error', message: 'Tidak diizinkan', data: null } })
    await expect(chatsApi.contacts(12)).rejects.toMatchObject({ message: 'Tidak diizinkan', kind: 'error' })
  })

  it('parses chat CRUD from response envelopes and exposes the declared routes', async () => {
    const message = {
      id: 1, room_id: null, profile_id: null, global_name: 'Sender', username: 'sender',
      is_me: false, content: null, status: null, timestamp: null, created_at: '2026-11-10T10:00:00Z', updated_at: null,
    }
    post.mockResolvedValueOnce(response(message, 201))
    put.mockResolvedValueOnce(response({ ...message, content: 'edited' }))
    await expect(chatsApi.create({ global_name: 'Sender', username: 'sender', is_me: false })).resolves.toEqual(message)
    await expect(chatsApi.update(1, { content: 'edited' })).resolves.toEqual({ ...message, content: 'edited' })
    await expect(chatsApi.remove(1)).resolves.toEqual({ status: 'success', message: 'ok', data: null })
    expect(post).toHaveBeenCalledWith('/chats', { global_name: 'Sender', username: 'sender', is_me: false })
    expect(put).toHaveBeenCalledWith('/chats/1', { content: 'edited' })
    expect(remove).toHaveBeenCalledWith('/chats/1')
  })

  it('rejects malformed or error envelopes, including missing required nullable chat fields', async () => {
    get.mockResolvedValueOnce({ status: 200, data: { status: 'success', message: 'ok', data: { status: 'error' } } })
    await expect(chatsApi.list()).rejects.toMatchObject({ message: 'Backend mengembalikan daftar chat yang tidak valid.' })
    get.mockResolvedValueOnce({ status: 200, data: { status: 'success', message: 'ok', data: [{
      id: 1, room_id: 'not-a-room-id', profile_id: null, global_name: 'A', username: 'a', is_me: false,
      content: 'hello', status: null, timestamp: null, created_at: 'now', updated_at: null,
    }] } })
    await expect(chatsApi.list()).rejects.toMatchObject({ message: 'Backend mengembalikan pesan chat dengan field yang tidak valid.' })
    get.mockResolvedValueOnce({ status: 200, data: { status: 'error', message: 'Gagal', data: null } })
    await expect(chatsApi.get(1)).rejects.toMatchObject({ message: 'Gagal' })
  })

  it('handles HTTPException details and rejects non-success HTTP status responses', async () => {
    get.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Task tidak ditemukan' } } })
    await expect(chatsApi.replyStatus('missing')).rejects.toMatchObject({ message: 'Task tidak ditemukan', kind: 'http' })
    get.mockResolvedValueOnce({ status: 422, data: { detail: [{ loc: ['query', 'username'], msg: 'Field required' }] } })
    await expect(chatsApi.list()).rejects.toMatchObject({ message: 'username: Field required', kind: 'http' })
  })

  it('uses the configured frontend origin protocol for the WebSocket URL', () => {
    const url = new URL(chatWebSocketUrl(12))
    expect(['ws:', 'wss:']).toContain(url.protocol)
    expect(url.pathname).toBe('/api/v1/chats/ws/12')
  })

  it('calls listener controls and rejects failed response envelopes', async () => {
    await profilesApi.startListener(12)
    expect(post).toHaveBeenCalledWith('/profiles/12/listener/start')
    await profilesApi.stopListener(12)
    expect(post).toHaveBeenCalledWith('/profiles/12/listener/stop')

    post.mockResolvedValue({ data: { status: 'error', message: 'Token belum dikonfigurasi', data: null } })
    await expect(profilesApi.startListener(12)).rejects.toMatchObject({ message: 'Token belum dikonfigurasi' })
  })
})
