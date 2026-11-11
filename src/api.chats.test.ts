import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('axios', () => ({ default: { create: () => ({ get, post }) } }))

import { chatWebSocketUrl, chatsApi, profilesApi } from './api'

beforeEach(() => {
  vi.clearAllMocks()
  post.mockResolvedValue({ data: { status: 'success', message: 'ok', data: { id: 12, listener_status: 'running' } } })
})

describe('chatsApi', () => {
  it('requests a conversation by room_id without a username parameter', async () => {
    get.mockResolvedValue({ data: { status: 'success', message: 'ok', data: [] } })
    await chatsApi.conversation(12, 'room+tag &value')
    expect(get).toHaveBeenCalledWith(
      '/chats/profiles/12/conversation',
      { params: { room_id: 'room+tag &value' }, signal: undefined },
    )
  })

  it('preserves a large Discord room ID as a string in the conversation query', async () => {
    get.mockResolvedValue({ data: { status: 'success', message: 'ok', data: [] } })
    const roomId = '1562315127397548042'
    await chatsApi.conversation(12, roomId)
    expect(get).toHaveBeenCalledWith(
      '/chats/profiles/12/conversation',
      { params: { room_id: '1562315127397548042' }, signal: undefined },
    )
  })

  it('returns contact room IDs as strings without converting large IDs', async () => {
    const contacts = [{
      room_id: '1562315127397548042',
      last_chat: { id: 32, room_id: '1562315127397548042' },
    }]
    get.mockResolvedValue({ data: { status: 'success', message: 'ok', data: contacts } })
    const response = await chatsApi.contacts(12)
    expect(response[0].room_id).toBe('1562315127397548042')
    expect(response[0].last_chat.room_id).toBe('1562315127397548042')
  })

  it('posts a reply to the chat ID and returns the queued message from data.message', async () => {
    const replyMessage = { id: 32, status: 'queued' }
    post.mockResolvedValue({ data: { status: 'success', message: 'ok', data: { message: replyMessage } } })
    await expect(chatsApi.reply(19, 'Halo', true)).resolves.toEqual(replyMessage)
    expect(post).toHaveBeenCalledWith('/chats/19/reply', { reply: 'Halo', specified_reply: true })
  })

  it('rejects an error envelope even when the HTTP request succeeds', async () => {
    get.mockResolvedValue({ data: { status: 'error', message: 'Tidak diizinkan', data: null } })
    await expect(chatsApi.contacts(12)).rejects.toMatchObject({ message: 'Tidak diizinkan', kind: 'error' })
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
