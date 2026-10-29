import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Profiles from './Profiles'
import { ChatRealtimeProvider } from '../ChatRealtime'
import type { Profile } from '../types'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  listChats: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  login: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('../api', () => ({
  profilesApi: {
    list: mocks.list,
    startListener: mocks.start,
    stopListener: mocks.stop,
    login: mocks.login,
    create: mocks.create,
    update: mocks.update,
    remove: mocks.remove,
  },
  chatsApi: { list: mocks.listChats },
  chatWebSocketUrl: (id: number) => `ws://test/api/v1/chats/ws/${id}`,
}))

const profile = (listener_status: 'running' | 'stopped' = 'stopped'): Profile => ({
  id: 1,
  name: 'Test profile',
  level: 0,
  listener_status,
  active_at: null,
  nonactive_at: null,
  created_at: '',
  updated_at: null,
})

function renderProfiles() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><Profiles /></QueryClientProvider>)
}

class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  close = vi.fn()
  constructor(readonly url: string) { MockWebSocket.instances.push(this) }
}

beforeEach(() => {
  vi.clearAllMocks()
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
  mocks.listChats.mockResolvedValue([])
  mocks.list.mockResolvedValue([profile()])
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Profile listener controls', () => {
  it('updates status only after successful start/stop responses', async () => {
    mocks.start.mockResolvedValue({ status: 'success', message: 'Listener started', data: { id: 1, listener_status: 'running' } })
    mocks.stop.mockResolvedValue({ status: 'success', message: 'Listener stopped', data: { id: 1, listener_status: 'stopped' } })
    renderProfiles()

    fireEvent.click(await screen.findByRole('button', { name: 'Start listener' }))
    expect(await screen.findByRole('button', { name: 'Stop listener' })).toBeTruthy()
    expect(mocks.start).toHaveBeenCalledWith(1)

    fireEvent.click(screen.getByRole('button', { name: 'Stop listener' }))
    expect(await screen.findByRole('button', { name: 'Start listener' })).toBeTruthy()
    expect(mocks.stop).toHaveBeenCalledWith(1)
  })

  it('opens the profile WebSocket after successful start and closes it after successful stop', async () => {
    mocks.start.mockResolvedValue({ status: 'success', message: 'Listener started', data: { id: 1, listener_status: 'running' } })
    mocks.stop.mockResolvedValue({ status: 'success', message: 'Listener stopped', data: { id: 1, listener_status: 'stopped' } })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><ChatRealtimeProvider><Profiles /></ChatRealtimeProvider></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: 'Start listener' }))
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))
    expect(MockWebSocket.instances[0].url).toBe('ws://test/api/v1/chats/ws/1')

    fireEvent.click(await screen.findByRole('button', { name: 'Stop listener' }))
    await waitFor(() => expect(MockWebSocket.instances[0].close).toHaveBeenCalled())
    expect(screen.getByText('stopped')).toBeTruthy()
  })

  it('shows backend errors and preserves stopped status when start fails', async () => {
    mocks.start.mockRejectedValue(new Error('Token profil belum dikonfigurasi'))
    renderProfiles()

    fireEvent.click(await screen.findByRole('button', { name: 'Start listener' }))
    expect(await screen.findByText(/Token profil belum dikonfigurasi/)).toBeTruthy()
    expect(screen.getAllByText('stopped').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Start listener' }).hasAttribute('disabled')).toBe(false)
  })

  it('shows stop errors and preserves running status when stop fails', async () => {
    mocks.list.mockResolvedValue([profile('running')])
    mocks.stop.mockRejectedValue(new Error('Worker gagal dihentikan'))
    renderProfiles()

    fireEvent.click(await screen.findByRole('button', { name: 'Stop listener' }))
    expect(await screen.findByText(/Worker gagal dihentikan/)).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith(1))
  })
})
