import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('axios', () => ({ default: { create: () => ({ get, post }) } }))

import { chatWebSocketUrl, chatsApi, profilesApi } from './api'

beforeEach(() => {
  vi.clearAllMocks()
  post.mockResolvedValue({ data: { status: 'success', message: 'ok', data: { id: 12, listener_status: 'running' } } })
})

describe('chatsApi', () => {
  it('URL-encodes the exact username in the conversation query', async () => {
    get.mockResolvedValue({ data: { status: 'success', message: 'ok', data: [] } })
    await chatsApi.conversation(12, 'name+tag &value')
    expect(get).toHaveBeenCalledWith(
      '/chats/profiles/12/conversation?username=name%2Btag+%26value',
      { signal: undefined },
    )
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
