import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { ChatRealtimeProvider, useChatRealtime } from './ChatRealtime'
import type { Chat, ChatContact, Profile } from './types'

const mocks = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  listChats: vi.fn(),
  replyStatus: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('./api', () => ({
  profilesApi: { list: mocks.listProfiles },
  chatsApi: { list: mocks.listChats, replyStatus: mocks.replyStatus },
  chatWebSocketUrl: (profileId: number) => `ws://test/api/v1/chats/ws/${profileId}`,
  parseApiJson: (data: string) => JSON.parse(data) as unknown,
}))
vi.mock('./ui', () => ({ toast: mocks.toast }))

const profiles: Profile[] = [
  { id: 1, name: 'Profile one', level: 0, listener_status: 'running', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
  { id: 2, name: 'Profile two', level: 0, listener_status: 'running', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
  { id: 3, name: 'Stopped profile', level: 0, listener_status: 'stopped', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
]
const chat = (overrides: Partial<Chat> = {}): Chat => ({
  id: 1,
  room_id: null,
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
      <span data-testid="profile-two-room-99-count">{realtime.unreadCount(2, 'alice', 99)}</span>
      <span data-testid="profile-two-room-100-count">{realtime.unreadCount(2, 'alice', 100)}</span>
      <span data-testid="live-conversation">{realtime.mergeConversation(2, 'alice', []).map((message) => message.id).join(',')}</span>
      <span data-testid="room-99-conversation">{realtime.mergeConversation(2, 'alice', [], 99).map((message) => message.id).join(',')}</span>
      <span data-testid="profile-two-connection">{realtime.connectionStatus(2)}</span>
      <span data-testid="reply-task-status">{realtime.replyStatuses['task-1']?.status ?? 'unknown'}</span>
      <span data-testid="notification-permission">{realtime.notificationPermission}</span>
      <button onClick={() => { void realtime.requestBrowserNotifications() }}>Enable desktop notifications</button>
      <button onClick={() => realtime.markConversationRead(1, 'alice', [chat({ status: 'read' })])}>Read profile one</button>
      <button onClick={() => realtime.registerReplyTask('task-1', 2, 44, 99)}>Register reply task</button>
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
  mocks.replyStatus.mockResolvedValue({
    task_id: 'task-1', chat_id: 44, profile_id: 2, room_id: 99, status: 'queued',
    error: null, reply_chat_id: null, created_at: '2026-11-10T10:00:00Z', updated_at: null,
  })
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
    expect(screen.getByTestId('profile-two-connection').textContent).toBe('connected')
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

  it('keeps same-username unread and live messages isolated by room and includes own messages without notifying', async () => {
    renderProvider()
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2))
    const socket = MockWebSocket.instances.find((instance) => instance.url.endsWith('/2'))!
    act(() => socket.message({ type: 'chat.connected', profile_id: 2 }))
    const room99 = chat({ id: 31, room_id: 99, profile_id: 2, status: 'unread', content: 'Room 99' })
    const room100 = chat({ id: 32, room_id: 100, profile_id: 2, status: 'unread', content: 'Room 100' })
    act(() => socket.message({ type: 'chat.message.created', profile_id: 2, data: room99 }))
    act(() => socket.message({ type: 'chat.message.created', profile_id: 2, data: room100 }))
    expect(screen.getByTestId('profile-two-room-99-count').textContent).toBe('1')
    expect(screen.getByTestId('profile-two-room-100-count').textContent).toBe('1')
    expect(screen.getByTestId('room-99-conversation').textContent).toBe('31')
    expect(screen.getByTestId('live-conversation').textContent).toBe('31,32')

    act(() => socket.message({
      type: 'chat.message.created',
      profile_id: 2,
      data: chat({ id: 33, room_id: 99, profile_id: 2, username: 'alice', is_me: true, status: 'read' }),
    }))
    expect(screen.getByTestId('room-99-conversation').textContent).toBe('31,33')
    expect(mocks.toast).toHaveBeenCalledTimes(2)
    expect(MockNotification.instances).toHaveLength(0)
  })

  it('merges reply task events monotonically, ignores other targets, and restores active tasks', async () => {
    renderProvider()
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2))
    const socket = MockWebSocket.instances.find((instance) => instance.url.endsWith('/2'))!
    act(() => socket.open())
    act(() => socket.message({ type: 'chat.connected', profile_id: 2 }))
    const task = {
      task_id: 'task-1', chat_id: 44, profile_id: 2, room_id: 99,
      status: 'processing', error: null, reply_chat_id: null,
      created_at: '2026-11-10T10:00:00Z', updated_at: null,
    }
    act(() => socket.message({ type: 'chat.reply.status', profile_id: 2, data: task }))
    expect(screen.getByTestId('reply-task-status').textContent).toBe('processing')
    act(() => screen.getByRole('button', { name: 'Register reply task' }).click())
    await waitFor(() => expect(mocks.replyStatus).toHaveBeenCalledWith('task-1', expect.any(AbortSignal)))

    act(() => socket.message({ type: 'chat.reply.status', profile_id: 1, data: task }))
    act(() => socket.message({ type: 'chat.reply.status', profile_id: 2, data: { ...task, room_id: 100 } }))
    expect(screen.getByTestId('reply-task-status').textContent).toBe('processing')

    act(() => socket.message({ type: 'chat.reply.status', profile_id: 2, data: { ...task, status: 'queued' } }))
    expect(screen.getByTestId('reply-task-status').textContent).toBe('processing')
    act(() => socket.message({ type: 'chat.reply.status', profile_id: 2, data: { ...task, status: 'sent', reply_chat_id: 77 } }))
    expect(screen.getByTestId('reply-task-status').textContent).toBe('sent')
    act(() => socket.message({ type: 'chat.reply.status', profile_id: 2, data: task }))
    expect(screen.getByTestId('reply-task-status').textContent).toBe('sent')

    act(() => socket.disconnect())
    expect(screen.getByTestId('reply-task-status').textContent).toBe('sent')
    expect(screen.getByTestId('profile-two-connection').textContent).toBe('reconnecting')
  })

  it('recovers nonterminal reply tasks after reconnect without treating disconnect as failure', async () => {
    const view = renderProvider()
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2))
    const first = MockWebSocket.instances.find((instance) => instance.url.endsWith('/2'))!
    act(() => screen.getByRole('button', { name: 'Register reply task' }).click())
    expect(mocks.replyStatus).not.toHaveBeenCalled()

    act(() => first.open())
    act(() => first.message({ type: 'chat.connected', profile_id: 2 }))
    await waitFor(() => expect(mocks.replyStatus).toHaveBeenCalledTimes(1))
    const processing = {
      task_id: 'task-1', chat_id: 44, profile_id: 2, room_id: 99, status: 'processing',
      error: null, reply_chat_id: null, created_at: '2026-11-10T10:00:00Z', updated_at: null,
    }
    act(() => first.message({ type: 'chat.reply.status', profile_id: 2, data: processing }))
    expect(screen.getByTestId('reply-task-status').textContent).toBe('processing')
    act(() => first.disconnect())
    expect(screen.getByTestId('reply-task-status').textContent).toBe('processing')
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    const reconnected = MockWebSocket.instances.filter((instance) => instance.url.endsWith('/2')).at(-1)!
    expect(reconnected).not.toBe(first)
    act(() => reconnected.open())
    act(() => reconnected.message({ type: 'chat.connected', profile_id: 2 }))
    await waitFor(() => expect(mocks.replyStatus).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('reply-task-status').textContent).toBe('processing')
    view.unmount()
    expect(first.close).not.toHaveBeenCalled()
    expect(reconnected.close).toHaveBeenCalled()
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
