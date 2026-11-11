import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Chats from './Chats'
import { ChatRealtimeProvider } from '../ChatRealtime'
import type { Chat, ChatContact, Profile } from '../types'

const mocks = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  listChats: vi.fn(),
  contacts: vi.fn(),
  conversation: vi.fn(),
  reply: vi.fn(),
  replyStatus: vi.fn(),
}))

vi.mock('../api', () => ({
  chatWebSocketUrl: (profileId: number) => `ws://test/api/v1/chats/ws/${profileId}`,
  parseApiJson: (data: string) => JSON.parse(data) as unknown,
  channelsApi: { list: vi.fn() },
  messagesApi: { list: vi.fn() },
  profilesApi: { list: mocks.listProfiles },
  chatsApi: { list: mocks.listChats, contacts: mocks.contacts, conversation: mocks.conversation, reply: mocks.reply, replyStatus: mocks.replyStatus },
  promotionApi: { logs: vi.fn() },
}))

const profiles: Profile[] = [
  { id: 1, name: 'Profile one', level: 0, listener_status: 'stopped', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
  { id: 2, name: 'Profile two', level: 0, listener_status: 'stopped', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
]
const chat = (overrides: Partial<Chat> = {}): Chat => ({
  id: 1,
  room_id: 42,
  profile_id: 1,
  global_name: 'Contact',
  username: 'contact',
  is_me: false,
  content: 'Pesan lama',
  status: 'unread',
  timestamp: '2026-10-29T01:00:00Z',
  created_at: '2026-10-29T01:00:00Z',
  updated_at: null,
  ...overrides,
})
const contact = (username = 'contact', globalName = 'Contact', lastChat: Chat = chat()): ChatContact => ({
  username,
  global_name: globalName,
  last_chat: { ...lastChat, username },
})
const setRoomMessages = (messages: Chat[], roomId: number | string = 42) => {
  mocks.listChats.mockImplementation((_signal: AbortSignal | undefined, requestedRoomId?: number | string) =>
    requestedRoomId === undefined ? Promise.resolve([]) : Promise.resolve(String(requestedRoomId) === String(roomId) ? messages : []),
  )
}
const acceptedReply = {
  status: 'accepted' as const,
  message: 'Reply queued for sending',
  data: { chat_id: 1, task_id: 'task-abc', status: 'queued' as const },
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><ChatRealtimeProvider><Chats /></ChatRealtimeProvider></QueryClientProvider>)
}

async function selectProfile(id = 1) {
  fireEvent.change(await screen.findByLabelText('Pilih profil'), { target: { value: String(id) } })
  return screen.findByRole('region', { name: 'Daftar kontak' })
}

class ChatTestWebSocket {
  static instances: ChatTestWebSocket[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  close = vi.fn()
  constructor(readonly url: string) { ChatTestWebSocket.instances.push(this) }
  open() { this.onopen?.(new Event('open')) }
  message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent) }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.clearAllMocks()
  ChatTestWebSocket.instances = []
  mocks.listProfiles.mockResolvedValue(profiles)
  mocks.listChats.mockImplementation((_signal: AbortSignal | undefined, roomId?: number | string) =>
    roomId === undefined ? Promise.resolve([]) : Promise.resolve([chat({ room_id: roomId })]),
  )
  mocks.contacts.mockResolvedValue([contact()])
  mocks.conversation.mockResolvedValue([chat({ status: 'read' })])
  mocks.reply.mockResolvedValue(acceptedReply)
  mocks.replyStatus.mockResolvedValue({
    task_id: 'task-abc', chat_id: 1, profile_id: 1, room_id: 42, status: 'queued',
    error: null, reply_chat_id: null, created_at: '2026-11-10T10:00:00Z', updated_at: null,
  })
})

describe('Discord inbox', () => {
  it('does not fetch contacts until a profile is selected and displays listener/socket states separately', async () => {
    renderPage()
    await screen.findByLabelText('Pilih profil')
    expect(mocks.contacts).not.toHaveBeenCalled()
    expect(screen.getByText('Pilih profil untuk memuat kontak.')).toBeTruthy()

    await selectProfile()
    await waitFor(() => expect(mocks.contacts).toHaveBeenCalledWith(1, expect.anything(), undefined))
    expect(screen.getByText('Listener berhenti')).toBeTruthy()
    expect(screen.getByText('Terputus')).toBeTruthy()
  })

  it('shows profile, contacts, and conversation loading/error/empty states', async () => {
    mocks.listProfiles.mockRejectedValueOnce(new Error('Profil gagal dimuat'))
    renderPage()
    expect(await screen.findByText('Profil gagal dimuat')).toBeTruthy()

    cleanup()
    mocks.listProfiles.mockResolvedValueOnce([])
    renderPage()
    expect(await screen.findByText('Belum ada profil untuk menampilkan inbox.')).toBeTruthy()

    cleanup()
    mocks.listProfiles.mockResolvedValue(profiles)
    mocks.contacts.mockRejectedValueOnce(new Error('Kontak gagal dimuat'))
    renderPage()
    await selectProfile()
    expect(await screen.findByText('Kontak gagal dimuat')).toBeTruthy()

    cleanup()
    mocks.contacts.mockResolvedValue([])
    renderPage()
    const region = await selectProfile()
    expect(await within(region).findByText('Belum ada kontak untuk pilihan ini.')).toBeTruthy()

    cleanup()
    mocks.contacts.mockResolvedValue([contact()])
    mocks.listChats.mockImplementation((_signal: AbortSignal | undefined, requestedRoomId?: number | string) =>
      requestedRoomId === undefined ? Promise.resolve([]) : new Promise<Chat[]>(() => {}),
    )
    renderPage()
    const contactsRegion = await selectProfile()
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Contact/ }))
    await waitFor(() => expect(mocks.listChats).toHaveBeenCalledWith(expect.anything(), 42))
    expect(screen.getByRole('region', { name: 'Percakapan' }).querySelector('[aria-busy]')).toBeTruthy()

    cleanup()
    mocks.contacts.mockResolvedValue([])
    renderPage()
    const emptyContacts = await selectProfile()
    expect(await within(emptyContacts).findByText('Belum ada kontak untuk pilihan ini.')).toBeTruthy()
  })

  it('does not render a late conversation response after a different contact is selected', async () => {
    mocks.contacts.mockResolvedValue([
      contact('first', 'First', chat({ room_id: 41 })),
      contact('second', 'Second', chat({ room_id: 42 })),
    ])
    let resolveFirst!: (messages: Chat[]) => void
    mocks.listChats.mockImplementation((_signal: AbortSignal | undefined, roomId?: number | string) => {
      if (roomId === undefined) return Promise.resolve([])
      return String(roomId) === '41'
        ? new Promise<Chat[]>((resolve) => { resolveFirst = resolve })
        : Promise.resolve([chat({ id: 2, username: 'second', content: 'Percakapan terbaru', room_id: 42 })])
    })
    renderPage()
    const contactsRegion = await selectProfile()
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /First/ }))
    await waitFor(() => expect(mocks.listChats).toHaveBeenCalledWith(expect.anything(), 41))
    fireEvent.click(within(contactsRegion).getByRole('button', { name: /Second/ }))
    const messages = await screen.findByRole('list', { name: 'Pesan' })
    expect(await within(messages).findByText('Percakapan terbaru')).toBeTruthy()
    resolveFirst([chat({ id: 1, username: 'first', content: 'Respons lama', room_id: 41 })])
    expect(within(messages).queryByText('Respons lama')).toBeNull()
    expect(within(messages).getByText('Percakapan terbaru')).toBeTruthy()
  })

  it('scopes contacts and conversations to profile, room, and exact username, resetting selection on target change', async () => {
    mocks.contacts.mockResolvedValue([contact('name+tag&other', 'Target')])
    setRoomMessages([chat({ id: 17, username: 'name+tag&other', room_id: 42, content: 'Pesan room 42' })])
    renderPage()
    const region = await selectProfile(1)
    fireEvent.change(screen.getByLabelText('Filter room'), { target: { value: '42' } })
    const targetButton = await within(region).findByRole('button', { name: /Target/ })
    fireEvent.click(targetButton)

    await waitFor(() => expect(mocks.contacts).toHaveBeenCalledWith(1, expect.anything(), 42))
    await waitFor(() => expect(mocks.listChats).toHaveBeenCalledWith(expect.anything(), 42))
    expect(await screen.findByText('Pesan room 42')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Filter room'), { target: { value: '43' } })
    expect(screen.getByText('Pilih profil, lalu kontak untuk membuka percakapan.')).toBeTruthy()
    expect(screen.queryByText('Pesan room 42')).toBeNull()
    await waitFor(() => expect(mocks.contacts).toHaveBeenCalledWith(1, expect.anything(), 43))

    fireEvent.change(screen.getByLabelText('Pilih profil'), { target: { value: '2' } })
    expect(screen.getByText('Pilih profil, lalu kontak untuk membuka percakapan.')).toBeTruthy()
    await waitFor(() => expect(mocks.contacts).toHaveBeenCalledWith(2, expect.anything(), 43))
  })

  it('loads both sender and profile messages by the contact room ID when usernames differ', async () => {
    const roomId = '1562315127397548042'
    const incoming = chat({
      id: 55, profile_id: 1, room_id: roomId, username: 'sender',
      global_name: 'Sender', content: 'Pesan dari sender', is_me: false,
    })
    const outgoing = chat({
      id: 56, profile_id: 1, room_id: roomId, username: 'bersan',
      global_name: 'bersan', content: 'Pesan dari profile', is_me: true,
    })
    mocks.contacts.mockResolvedValue([contact('sender', 'Sender', incoming)])
    setRoomMessages([incoming, outgoing], roomId)
    renderPage()
    const contactsRegion = await selectProfile()
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Sender/ }))

    await waitFor(() => expect(mocks.listChats).toHaveBeenCalledWith(expect.anything(), roomId))
    const messages = await screen.findByRole('list', { name: 'Pesan' })
    expect(await within(messages).findByText('Pesan dari sender')).toBeTruthy()
    const ownMessage = await within(messages).findByText('Pesan dari profile')
    expect(ownMessage.closest('li')?.className).toContain('justify-end')
    expect(within(messages).getByText('Pesan dari sender').closest('li')?.className).toContain('justify-start')
    expect(mocks.listChats).toHaveBeenCalledWith(expect.anything(), roomId)
    expect(mocks.conversation).toHaveBeenCalledWith(1, 'sender', expect.anything(), roomId)
  })

  it('keeps the message list scrolled to its newest message', async () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLOListElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLOListElement.prototype, 'scrollHeight', { configurable: true, get: () => 480 })
    try {
      renderPage()
      const contactsRegion = await selectProfile()
      fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Contact/ }))
      const messages = await screen.findByRole('list', { name: 'Pesan' })
      expect(messages.scrollTop).toBe(480)
    } finally {
      if (originalScrollHeight) Object.defineProperty(HTMLOListElement.prototype, 'scrollHeight', originalScrollHeight)
      else Reflect.deleteProperty(HTMLOListElement.prototype, 'scrollHeight')
    }
  })

  it('disables whitespace-only replies and immediately shows a right-aligned optimistic bubble', async () => {
    mocks.contacts.mockResolvedValue([contact('contact', 'Contact', chat({ id: 55 }))])
    setRoomMessages([chat({ id: 55, status: 'read' })])
    let acceptReply!: (value: typeof acceptedReply) => void
    mocks.reply.mockImplementation(() => new Promise((resolve) => { acceptReply = resolve }))
    renderPage()
    const region = await selectProfile()
    fireEvent.click(await within(region).findByRole('button', { name: /Contact/ }))
    const messages = await screen.findByRole('list', { name: 'Pesan' })

    const sendButton = screen.getByRole('button', { name: 'Kirim balasan' })
    expect((sendButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Balasan'), { target: { value: '   ' } })
    expect((sendButton as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.reply).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Balasan'), { target: { value: '  Halo  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim balasan' }))
    await waitFor(() => expect(mocks.reply).toHaveBeenCalledWith(55, { reply: '  Halo  ', specified_reply: false }))
    const outgoing = await within(messages).findByText(/Halo/)
    expect(outgoing.closest('li')?.className).toContain('justify-end')
    expect(outgoing.closest('article')?.getAttribute('data-status')).toBeNull()
    acceptReply(acceptedReply)
    expect(await screen.findByRole('img', { name: /Dalam antrean/ })).toBeTruthy()
    expect(screen.queryByText('Masuk antrean.')).toBeNull()
  })

  it('updates the optimistic bubble from early queued/processing events through sent without duplicating the outgoing event', async () => {
    vi.stubGlobal('WebSocket', ChatTestWebSocket)
    mocks.listProfiles.mockResolvedValue(profiles.map((profile) => ({ ...profile, listener_status: profile.id === 1 ? 'running' as const : 'stopped' as const })))
    mocks.contacts.mockResolvedValue([contact('contact', 'Contact', chat({ id: 55 }))])
    setRoomMessages([chat({ id: 55, status: 'read' })])
    mocks.replyStatus.mockResolvedValue({
      task_id: 'task-abc', chat_id: 55, profile_id: 1, room_id: 42, status: 'queued',
      error: null, reply_chat_id: null, created_at: '2026-11-10T10:00:00Z', updated_at: null,
    })
    let acceptReply!: (value: typeof acceptedReply) => void
    mocks.reply.mockImplementation(() => new Promise((resolve) => { acceptReply = resolve }))
    renderPage()
    const region = await selectProfile()
    await waitFor(() => expect(ChatTestWebSocket.instances).toHaveLength(1))
    const socket = ChatTestWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.message({ type: 'chat.connected', profile_id: 1 }))
    fireEvent.click(await within(region).findByRole('button', { name: /Contact/ }))
    const messages = await screen.findByRole('list', { name: 'Pesan' })
    fireEvent.change(screen.getByLabelText('Balasan'), { target: { value: 'Balasan realtime' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim balasan' }))
    await waitFor(() => expect(mocks.reply).toHaveBeenCalledWith(55, { reply: 'Balasan realtime', specified_reply: false }))

    const task = {
      task_id: 'task-abc', chat_id: 55, profile_id: 1, room_id: 42,
      error: null, reply_chat_id: null, created_at: '2026-11-10T10:00:00Z', updated_at: null,
    }
    act(() => socket.message({ type: 'chat.reply.status', profile_id: 1, data: { ...task, status: 'queued' } }))
    act(() => socket.message({ type: 'chat.reply.status', profile_id: 1, data: { ...task, status: 'processing' } }))
    acceptReply(acceptedReply)
    const outgoing = await within(messages).findByText('Balasan realtime')
    expect(outgoing.closest('li')?.className).toContain('justify-end')
    const processingIndicator = await screen.findByRole('img', { name: /Sedang dikirim/ })
    expect(processingIndicator.getAttribute('title')).toContain('Balasan 1 dari 1')
    await waitFor(() => expect(mocks.replyStatus).toHaveBeenCalledWith('task-abc', expect.anything()))

    const echo = chat({
      id: 88, profile_id: 1, room_id: 42, username: 'contact', global_name: 'Contact',
      is_me: true, content: 'Balasan realtime', status: 'read',
      timestamp: new Date().toISOString(), created_at: new Date().toISOString(),
    })
    act(() => socket.message({ type: 'chat.message.created', profile_id: 1, data: echo }))
    expect(within(messages).getAllByText('Balasan realtime')).toHaveLength(1)
    expect(screen.getByText('Pesan lama').closest('li')?.className).toContain('justify-start')

    act(() => socket.message({ type: 'chat.reply.status', profile_id: 1, data: { ...task, status: 'sent', reply_chat_id: 88 } }))
    const sentIndicator = await screen.findByRole('img', { name: /Terkirim/ })
    expect(sentIndicator.getAttribute('title')).toContain('terkirim 1')
    expect(within(messages).getAllByText('Balasan realtime')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).toBeNull()
  })

  it('shows a safe per-bubble failed status and retries the failed reply task', async () => {
    vi.stubGlobal('WebSocket', ChatTestWebSocket)
    mocks.listProfiles.mockResolvedValue(profiles.map((profile) => ({ ...profile, listener_status: profile.id === 1 ? 'running' as const : 'stopped' as const })))
    mocks.contacts.mockResolvedValue([contact('contact', 'Contact', chat({ id: 55 }))])
    setRoomMessages([chat({ id: 55, status: 'read' })])
    renderPage()
    const region = await selectProfile()
    await waitFor(() => expect(ChatTestWebSocket.instances).toHaveLength(1))
    const socket = ChatTestWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.message({ type: 'chat.connected', profile_id: 1 }))
    fireEvent.click(await within(region).findByRole('button', { name: /Contact/ }))
    await screen.findByRole('list', { name: 'Pesan' })
    fireEvent.change(screen.getByLabelText('Balasan'), { target: { value: 'Coba lagi nanti' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim balasan' }))
    await waitFor(() => expect(mocks.reply).toHaveBeenCalledTimes(1))

    act(() => socket.message({
      type: 'chat.reply.status',
      profile_id: 1,
      data: {
        task_id: 'task-abc', chat_id: 55, profile_id: 1, room_id: 42, status: 'failed',
        error: 'Traceback: internal token=secret', reply_chat_id: null,
        created_at: '2026-11-10T10:00:00Z', updated_at: null,
      },
    }))
    expect(await screen.findByText('Balasan gagal dikirim.')).toBeTruthy()
    expect(screen.getByRole('img', { name: /Gagal/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    await waitFor(() => expect(mocks.reply).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Traceback: internal token=secret')).toBeNull()
  })

  it.each([
    ['503 broker', new Error('Broker tidak tersedia')],
    ['422 validation', new Error('reply: Field required')],
  ])('shows reply API failure for %s without claiming it was queued', async (_label, error) => {
    mocks.reply.mockRejectedValueOnce(error)
    renderPage()
    const region = await selectProfile()
    fireEvent.click(await within(region).findByRole('button', { name: /Contact/ }))
    await screen.findByRole('list', { name: 'Pesan' })
    fireEvent.change(screen.getByLabelText('Balasan'), { target: { value: 'Halo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim balasan' }))
    expect(await screen.findByText(error.message)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    await waitFor(() => expect(mocks.reply).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('img', { name: /Dalam antrean/ })).toBeTruthy()
  })

  it('keeps auto-reply disabled without making a network request', async () => {
    renderPage()
    const region = await selectProfile()
    fireEvent.click(await within(region).findByRole('button', { name: /Contact/ }))
    await screen.findByRole('list', { name: 'Pesan' })
    const autoReply = screen.getByRole('checkbox', { name: 'Auto-Reply belum didukung backend' })
    expect((autoReply as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/Auto-Reply belum didukung/)).toBeTruthy()
    expect(mocks.reply).not.toHaveBeenCalled()
  })

  it('rejects invalid room filters without fetching contacts', async () => {
    renderPage()
    await selectProfile()
    fireEvent.change(screen.getByLabelText('Filter room'), { target: { value: '-1' } })
    expect(await screen.findByText('Room ID harus berupa bilangan bulat positif.')).toBeTruthy()
    expect(mocks.contacts).toHaveBeenCalledTimes(1)
  })

  it('selects and cancels a specified target, and refreshes through the conversation endpoint', async () => {
    mocks.contacts.mockResolvedValue([contact('contact', 'Contact', chat({ id: 55 }))])
    setRoomMessages([
      chat({ id: 55, content: 'Pesan yang dipilih', status: 'read' }),
      chat({ id: 56, is_me: true, username: 'profile', content: 'Pesan biasa', status: 'read' }),
    ])
    renderPage()
    const contactsRegion = await selectProfile()
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Contact/ }))
    const messages = await screen.findByRole('list', { name: 'Pesan' })
    expect(await within(messages).findByText('Pesan yang dipilih')).toBeTruthy()
    expect(within(messages).getByText('Pesan yang dipilih').closest('li')?.className).toContain('justify-start')
    expect(within(messages).getByText('Pesan biasa').closest('li')?.className).toContain('justify-end')
    const targetModeButton = screen.getByRole('button', { name: 'Pilih pesan target' })
    expect(targetModeButton.getAttribute('title')).toBe('Pilih pesan target')
    fireEvent.click(targetModeButton)
    expect((screen.getByRole('button', { name: 'Batalkan pemilihan target' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/pesan duplikat bisa memilih target berbeda/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Pilih pesan ini' })[0])
    const targetMessage = within(messages).getByText('Pesan yang dipilih').closest('article')!
    expect(targetMessage.className).toContain('ring-2')
    expect(screen.getByText(/Membalas: Pesan yang dipilih/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Balasan'), { target: { value: 'Balasan target' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim balasan' }))
    await waitFor(() => expect(mocks.reply).toHaveBeenCalledWith(55, { reply: 'Balasan target', specified_reply: true }))

    fireEvent.click(screen.getByRole('button', { name: 'Hapus target balasan' }))
    expect(screen.queryByText(/Membalas: Pesan yang dipilih/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Balasan'), { target: { value: 'Balasan biasa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim balasan' }))
    await waitFor(() => expect(mocks.reply).toHaveBeenLastCalledWith(56, { reply: 'Balasan biasa', specified_reply: false }))

    const beforeRefresh = mocks.listChats.mock.calls.length
    mocks.listChats.mockImplementationOnce((_signal: AbortSignal | undefined, requestedRoomId?: number | string) =>
      requestedRoomId === undefined ? Promise.resolve([]) : new Promise<Chat[]>(() => {}),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh percakapan' }))
    await waitFor(() => expect(mocks.listChats.mock.calls.length).toBeGreaterThan(beforeRefresh))
    expect((screen.getByRole('button', { name: 'Refresh percakapan' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('auto-resizes the composer from 44px to 120px and supports shift-enter multiline', async () => {
    renderPage()
    const contactsRegion = await selectProfile()
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Contact/ }))
    await screen.findByRole('list', { name: 'Pesan' })
    const textarea = screen.getByLabelText('Balasan') as HTMLTextAreaElement
    expect(textarea.style.height).toBe('44px')
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 80 })
    fireEvent.change(textarea, { target: { value: 'Satu baris' } })
    expect(textarea.style.height).toBe('80px')
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 200 })
    fireEvent.change(textarea, { target: { value: 'Teks panjang'.repeat(20) } })
    expect(textarea.style.height).toBe('120px')
    expect(textarea.style.overflowY).toBe('auto')
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 0 })
    fireEvent.change(textarea, { target: { value: '' } })
    expect(textarea.style.height).toBe('44px')
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(mocks.reply).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Pilih pesan target' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh percakapan' })).toBeTruthy()
  })

  it('reconciles an optimistic bubble with a scoped outgoing WebSocket event without duplicating it', async () => {
    class TestWebSocket {
      static instances: TestWebSocket[] = []
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null
      close = vi.fn()
      constructor(readonly url: string) { TestWebSocket.instances.push(this) }
      emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent) }
    }
    vi.stubGlobal('WebSocket', TestWebSocket)
    mocks.listProfiles.mockResolvedValue([{ ...profiles[0], listener_status: 'running' }])
    mocks.contacts.mockResolvedValue([contact('contact', 'Contact', chat({ id: 55, room_id: 42 }))])
    setRoomMessages([chat({ id: 55, room_id: 42, status: 'read' })])
    renderPage()
    const contactsRegion = await selectProfile()
    fireEvent.change(screen.getByLabelText('Filter room'), { target: { value: '42' } })
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Contact/ }))
    await screen.findByRole('list', { name: 'Pesan' })
    fireEvent.change(screen.getByLabelText('Balasan'), { target: { value: 'Balasan realtime' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim balasan' }))
    const messages = screen.getByRole('list', { name: 'Pesan' })
    const optimistic = await within(messages).findByText('Balasan realtime')
    expect(optimistic.closest('li')?.className).toContain('justify-end')
    await screen.findByRole('img', { name: /Dalam antrean/ })

    const socket = await waitFor(() => {
      expect(TestWebSocket.instances.length).toBe(1)
      return TestWebSocket.instances[0]
    })
    act(() => socket.emit({ type: 'chat.connected', profile_id: 1 }))
    const eventChat: Chat = {
      ...chat({ id: 99, room_id: 42, username: 'contact', is_me: true, content: 'Balasan realtime', status: 'read' }),
      timestamp: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
    act(() => socket.emit({ type: 'chat.message.created', profile_id: 2, data: { ...eventChat, profile_id: 2 } }))
    act(() => socket.emit({ type: 'chat.message.created', profile_id: 1, data: { ...eventChat, id: 98, room_id: 43 } }))
    act(() => socket.emit({ type: 'chat.message.created', profile_id: 1, data: { ...eventChat, id: 97, username: 'other-contact', content: 'Pesan lain' } }))
    act(() => socket.emit({ type: 'chat.message.created', profile_id: 1, data: eventChat }))
    act(() => socket.emit({ type: 'chat.message.created', profile_id: 1, data: eventChat }))
    await waitFor(() => expect(within(messages).getAllByText('Balasan realtime')).toHaveLength(1))
    expect(within(messages).getByText('Balasan realtime').closest('li')?.className).toContain('justify-end')
    expect(within(messages).queryByText('Status belum diketahui')).toBeNull()
  })
})
