import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { ChatRealtimeProvider, useChatRealtime } from './ChatRealtime'
import type { Chat, ChatContact, Profile } from './types'

const mocks = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  listChats: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('./api', () => ({
  profilesApi: { list: mocks.listProfiles },
  chatsApi: { list: mocks.listChats },
  chatWebSocketUrl: (profileId: number) => `ws://test/api/v1/chats/ws/${profileId}`,
}))
vi.mock('./ui', () => ({ toast: mocks.toast }))

const profiles: Profile[] = [
  { id: 1, name: 'Profile one', level: 0, listener_status: 'running', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
  { id: 2, name: 'Profile two', level: 0, listener_status: 'running', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
  { id: 3, name: 'Stopped profile', level: 0, listener_status: 'stopped', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
]
const chat = (overrides: Partial<Chat> = {}): Chat => ({
  id: 1,
  profile_id: 1,
  global_name: 'Alice',
  username: 'alice',
  is_me: false,
  content: 'REST unread',
  status: 'unread',
  timestamp: '2026-10-29T01:00:00Z',
  created_at: '2026-10-29T01:00:00Z',
  updated_at: null,
  ...overrides,
})

class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  close = vi.fn(() => {
    this.onclose?.(new CloseEvent('close'))
  })

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  open() {
    this.onopen?.(new Event('open'))
  }

  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  disconnect() {
    this.onclose?.(new CloseEvent('close'))
  }

  error() {
    this.onerror?.(new Event('error'))
  }
}

class MockNotification {
  static instances: MockNotification[] = []
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>()
  onclick: ((event: Event) => void) | null = null
  close = vi.fn()

  constructor(readonly title: string, readonly options?: NotificationOptions) {
    MockNotification.instances.push(this)
  }
}

function Probe() {
  const realtime = useChatRealtime()
  const queryClient = useQueryClient()
  return (
    <>
      <span data-testid="global-unread">{String(realtime.hasAnyUnread)}</span>
      <span data-testid="profile-one-unread">{String(realtime.hasUnread(1, 'alice'))}</span>
      <span data-testid="profile-two-count">{realtime.unreadCount(2, 'alice')}</span>
      <span data-testid="profile-two-read-count">{realtime.unreadCount(2, 'bob')}</span>
      <span data-testid="live-conversation">{realtime.mergeConversation(2, 'alice', []).map((message) => message.id).join(',')}</span>
      <span data-testid="notification-permission">{realtime.notificationPermission}</span>
      <button onClick={() => { void realtime.requestBrowserNotifications() }}>Enable desktop notifications</button>
      <button onClick={() => realtime.markConversationRead(1, 'alice', [chat({ status: 'read' })])}>Read profile one</button>
      <button onClick={() => queryClient.setQueryData<Profile[]>(['profiles'], profiles.map((profile) => profile.id === 1 ? { ...profile, listener_status: 'stopped' } : profile))}>Stop profile one</button>
    </>
  )
}

function renderProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData<ChatContact[]>(['chatContacts', 2], [{
    username: 'alice',
    global_name: 'Alice',
    last_chat: chat({ id: 20, profile_id: 2, status: 'read', content: 'Preview sebelumnya' }),
  }])
  const result = render(<QueryClientProvider client={queryClient}><ChatRealtimeProvider><Probe /></ChatRealtimeProvider></QueryClientProvider>)
  return { ...result, queryClient }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
beforeEach(() => {
  vi.clearAllMocks()
  MockWebSocket.instances = []
  MockNotification.instances = []
  MockNotification.permission = 'granted'
  MockNotification.requestPermission.mockResolvedValue('granted')
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.stubGlobal('Notification', MockNotification)
  mocks.listProfiles.mockResolvedValue(profiles)
  mocks.listChats.mockResolvedValue([
    chat(),
    chat({ id: 4, profile_id: 2, is_me: true }),
    chat({ id: 5, profile_id: 2, username: 'bob', status: 'read' }),
  ])
})

describe('ChatRealtimeProvider', () => {
  it('connects each running profile and syncs unread messages from REST', async () => {
    const view = renderProvider()
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2))
    expect(MockWebSocket.instances.map((socket) => socket.url)).toEqual([
      'ws://test/api/v1/chats/ws/1',
      'ws://test/api/v1/chats/ws/2',
    ])
    expect((await screen.findByTestId('profile-one-unread')).textContent).toBe('true')
    expect(screen.getByTestId('global-unread').textContent).toBe('true')
    expect(screen.getByTestId('profile-two-count').textContent).toBe('0')
    expect(screen.getByTestId('profile-two-read-count').textContent).toBe('0')
    expect(mocks.listChats).toHaveBeenCalled()
    view.unmount()
    expect(MockWebSocket.instances.every((socket) => socket.close.mock.calls.length > 0)).toBe(true)
  })

  it('notifies once for valid incoming events from other profiles, ignores self and duplicates', async () => {
    const view = renderProvider()
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2))
    const socket = MockWebSocket.instances.find((instance) => instance.url.endsWith('/2'))!
    act(() => socket.open())
    await waitFor(() => expect(mocks.listChats).toHaveBeenCalledTimes(2))

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const eventChat = chat({ id: 21, profile_id: 2, content: 'Halo dari profile lain', status: 'unread' })
    const event = { type: 'chat.message.created', profile_id: 2, data: eventChat }
    act(() => socket.message({ type: 'chat.connected', profile_id: 2 }))
    act(() => socket.message({ ...event, data: { ...eventChat, profile_id: 1 } }))
    expect(mocks.toast).not.toHaveBeenCalled()
    act(() => socket.message(event))
    expect((await screen.findByTestId('profile-two-count')).textContent).toBe('1')
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('success', expect.stringContaining('Profile two'))
    expect(MockNotification.instances).toHaveLength(1)
    expect(MockNotification.instances[0].title).toBe('Profile two · Alice')
    expect(MockNotification.instances[0].options?.body).toBe('Halo dari profile lain')
    expect(screen.getByTestId('live-conversation').textContent).toBe('21')
    expect(view.queryClient.getQueryData<Chat[]>(['conversation', 2, 'alice'])).toBeUndefined()
    expect(view.queryClient.getQueryData<ChatContact[]>(['chatContacts', 2])?.[0].last_chat.content).toBe('Halo dari profile lain')

    act(() => socket.message(event))
    expect(screen.getByTestId('profile-two-count').textContent).toBe('1')
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(MockNotification.instances).toHaveLength(1)

    act(() => socket.message({ ...event, data: { ...eventChat, id: 22, is_me: true } }))
    expect(screen.getByTestId('profile-two-count').textContent).toBe('1')
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(MockNotification.instances).toHaveLength(1)

    act(() => screen.getByRole('button', { name: 'Read profile one' }).click())
    expect(screen.getByTestId('profile-one-unread').textContent).toBe('false')
    expect(screen.getByTestId('global-unread').textContent).toBe('true')
  })

  it('requests browser notification permission only after a user action', async () => {
    MockNotification.permission = 'default'
    renderProvider()
    expect(MockNotification.requestPermission).not.toHaveBeenCalled()
    expect(screen.getByTestId('notification-permission').textContent).toBe('default')

    act(() => screen.getByRole('button', { name: 'Enable desktop notifications' }).click())
    await waitFor(() => expect(screen.getByTestId('notification-permission').textContent).toBe('granted'))
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending reconnect after stop and closes all sockets on unmount', async () => {
    const view = renderProvider()
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2))
    expect(MockWebSocket.instances).toHaveLength(2)
    const first = MockWebSocket.instances.find((socket) => socket.url.endsWith('/1'))!
    act(() => first.disconnect())
    act(() => screen.getByRole('button', { name: 'Stop profile one' }).click())
    await waitFor(() => expect(view.queryClient.getQueryData<Profile[]>(['profiles'])?.find((profile) => profile.id === 1)?.listener_status).toBe('stopped'))
    expect(view.queryClient.getQueryData<Profile[]>(['profiles'])?.find((profile) => profile.id === 1)?.listener_status).toBe('stopped')
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    expect(MockWebSocket.instances.filter((socket) => socket.url.endsWith('/1'))).toHaveLength(1)
    view.unmount()
    expect(MockWebSocket.instances.find((socket) => socket.url.endsWith('/2'))?.close).toHaveBeenCalled()
  })

  it('handles malformed websocket JSON without crashing the provider', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderProvider()
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2))
    act(() => MockWebSocket.instances[0].onmessage?.({ data: '{' } as MessageEvent))
    expect(warn).toHaveBeenCalledWith('Malformed chat WebSocket JSON for profile 1')
    expect(screen.getByTestId('global-unread').textContent).toBe('true')
    act(() => MockWebSocket.instances[0].error())
    expect(MockWebSocket.instances[0].close).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('warn', expect.stringContaining('Koneksi chat profil'))
    warn.mockRestore()
  })
})
