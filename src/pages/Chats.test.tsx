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
  chatWebSocketUrl: vi.fn((profileId: number) => `ws://test/api/v1/chats/ws/${profileId}`),
}))

vi.mock('../api', () => ({
  channelsApi: { list: vi.fn() },
  messagesApi: { list: vi.fn() },
  profilesApi: { list: mocks.listProfiles },
  chatsApi: { list: mocks.listChats, contacts: mocks.contacts, conversation: mocks.conversation, reply: mocks.reply },
  chatWebSocketUrl: mocks.chatWebSocketUrl,
  promotionApi: { logs: vi.fn() },
}))

const profiles: Profile[] = [
  { id: 1, name: 'Profile one', level: 0, listener_status: 'stopped', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
  { id: 2, name: 'Profile two', level: 0, listener_status: 'stopped', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
]
const chat = (overrides: Partial<Chat> = {}): Chat => ({
  id: 1,
  profile_id: 1,
  room_id: 'room-contact',
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
const contact = (roomId: string, globalName: string, lastChat: Chat = chat()): ChatContact => ({
  global_name: globalName,
  username: globalName.toLocaleLowerCase().replaceAll(' ', '-'),
  room_id: roomId,
  last_chat: { ...lastChat, room_id: roomId },
})

class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  close = vi.fn()

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  open() {
    this.onopen?.(new Event('open'))
  }

  message(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent)
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><ChatRealtimeProvider><Chats /></ChatRealtimeProvider></QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.clearAllMocks()
  MockWebSocket.instances = []
  mocks.listChats.mockResolvedValue([])
  mocks.reply.mockImplementation(async (_id: number, reply: string) => chat({
    id: 100,
    is_me: true,
    username: 'profile',
    content: reply,
    status: 'queued',
    created_at: '2026-10-29T02:00:00Z',
  }))
})

describe('Chats page', () => {
  it('shows profile loading and error states', async () => {
    mocks.listProfiles.mockImplementation(() => new Promise(() => {}))
    const firstRender = renderPage()
    expect(screen.getByLabelText('Pilih profil').hasAttribute('disabled')).toBe(true)
    firstRender.unmount()

    mocks.listProfiles.mockRejectedValue(new Error('Profil gagal dimuat'))
    renderPage()
    expect(await screen.findByText('Profil gagal dimuat')).toBeTruthy()
  })

  it('shows contacts loading and error states', async () => {
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.contacts.mockImplementation(() => new Promise(() => {}))
    const firstRender = renderPage()
    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    expect(contactsRegion.querySelector('[aria-busy]')).toBeTruthy()
    firstRender.unmount()

    mocks.contacts.mockRejectedValue(new Error('Kontak gagal dimuat'))
    renderPage()
    expect(await screen.findByText('Kontak gagal dimuat')).toBeTruthy()
  })

  it('shows empty states and conversation loading/error states', async () => {
    mocks.listProfiles.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('Belum ada profil untuk menampilkan chat.')).toBeTruthy()

    cleanup()
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.contacts.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('Belum ada kontak untuk profil ini.')).toBeTruthy()

    cleanup()
    mocks.contacts.mockResolvedValue([contact('contact', 'Contact')])
    let rejectConversation!: (reason: Error) => void
    mocks.conversation.mockImplementation(() => new Promise<Chat[]>((_resolve, reject) => { rejectConversation = reject }))
    renderPage()
    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Contact/ }))
    await waitFor(() => expect(mocks.conversation).toHaveBeenCalled())
    expect(screen.getByRole('region', { name: 'Percakapan' }).querySelector('[aria-busy]')).toBeTruthy()
    rejectConversation(new Error('Percakapan gagal dimuat'))
    expect(await screen.findByText('Percakapan gagal dimuat')).toBeTruthy()
  })

  it('clears the contact unread dot only after conversation fetch succeeds', async () => {
    const unreadChat = chat({ id: 8, room_id: 'room-contact', username: 'contact', status: 'unread' })
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.listChats.mockResolvedValue([])
    mocks.contacts
      .mockResolvedValueOnce([contact('contact', 'Contact', unreadChat)])
      .mockResolvedValue([contact('contact', 'Contact', { ...unreadChat, status: 'read' })])
    mocks.conversation.mockResolvedValue([chat({ ...unreadChat, status: 'read' })])
    renderPage()

    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    const contactButton = await within(contactsRegion).findByRole('button', { name: /Contact/ })
    expect(await within(contactButton).findByRole('img', { name: 'Pesan belum dibaca' })).toBeTruthy()
    fireEvent.click(contactButton)
    expect(await screen.findByText('Pesan lama')).toBeTruthy()
    await waitFor(() => expect(within(contactButton).queryByRole('img', { name: 'Pesan belum dibaca' })).toBeNull())
  })

  it('keeps selection scoped to the active profile/contact and renders returned order/status', async () => {
    const firstContact = contact('room-first', 'First Contact')
    const secondContact = contact('room-second', 'Second Contact')
    mocks.listProfiles.mockResolvedValue(profiles)
    mocks.contacts
      .mockResolvedValueOnce([firstContact, secondContact])
      .mockResolvedValue([contact('room-first', 'First Contact', chat({ room_id: 'room-first', status: 'read' })), contact('room-second', 'Second Contact', chat({ id: 4, room_id: 'room-second', content: 'Balasan terbaru', is_me: true, status: 'read', username: 'profile' }))])

    let finishFirstConversation!: (value: Chat[]) => void
    mocks.conversation.mockImplementation((profileId: number, roomId: string) => {
      if (profileId === 1 && roomId === 'room-first') return new Promise<Chat[]>((resolve) => { finishFirstConversation = resolve })
      if (profileId === 1 && roomId === 'room-second') return Promise.resolve([
        chat({ id: 2, room_id: 'room-second', content: 'Pesan masuk lama', status: 'read' }),
        chat({ id: 3, room_id: 'room-second', content: 'Balasan sendiri terbaru', is_me: true, username: 'profile', status: 'read' }),
      ])
      return Promise.resolve([chat({ id: 5, room_id: roomId, content: 'Pesan profil dua' })])
    })

    renderPage()
    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    const secondButton = await within(contactsRegion).findByRole('button', { name: /Second Contact/ })
    fireEvent.click(within(contactsRegion).getByRole('button', { name: /First Contact/ }))
    await waitFor(() => expect(mocks.conversation).toHaveBeenCalledWith(1, 'room-first', expect.anything()))
    fireEvent.click(secondButton)

    finishFirstConversation([chat({ id: 1, content: 'Respons lama tidak boleh tampil' })])

    const incoming = await screen.findByText('Pesan masuk lama')
    const outgoing = await screen.findByText('Balasan sendiri terbaru')
    const conversation = screen.getByRole('region', { name: 'Percakapan' }).querySelector('ol')!
    const renderedMessages = Array.from(conversation.querySelectorAll('li'))
    expect(renderedMessages[0].textContent).toContain('Pesan masuk lama')
    expect(renderedMessages[1].textContent).toContain('Balasan sendiri terbaru')
    expect(incoming.closest('li')?.className).toContain('justify-start')
    expect(outgoing.closest('li')?.className).toContain('justify-end')
    expect(outgoing.closest('article')?.getAttribute('data-status')).toBe('read')
    expect(screen.queryByText('Respons lama tidak boleh tampil')).toBeNull()
    expect(mocks.conversation).toHaveBeenCalledWith(1, 'room-second', expect.anything())

    await waitFor(() => expect(mocks.contacts).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(contactsRegion).queryByText('Belum dibaca')).toBeNull())

    fireEvent.change(screen.getByLabelText('Pilih profil'), { target: { value: '2' } })
    await waitFor(() => expect(mocks.contacts).toHaveBeenCalledWith(2, expect.anything()))
    expect(screen.queryByText('Pesan masuk lama')).toBeNull()
    expect(screen.getByText('Pilih kontak untuk membuka percakapan.')).toBeTruthy()
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Second Contact/ }))
    expect(await screen.findByText('Pesan profil dua')).toBeTruthy()
    expect(mocks.conversation).toHaveBeenCalledWith(2, 'room-second', expect.anything())
  })

  it('keeps contacts with the same username separate when their room IDs differ', async () => {
    const first = contact('room-one', 'First', chat({ username: 'shared' }))
    const second = contact('room-two', 'Second', chat({ username: 'shared' }))
    first.last_chat.username = 'shared'
    second.last_chat.username = 'shared'
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.contacts.mockResolvedValue([first, second])
    mocks.conversation.mockResolvedValue([])
    renderPage()

    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    await within(contactsRegion).findByRole('button', { name: /First/ })
    expect(contactsRegion.querySelectorAll('li')).toHaveLength(2)
    fireEvent.click(within(contactsRegion).getByRole('button', { name: /Second/ }))
    await waitFor(() => expect(mocks.conversation).toHaveBeenCalledWith(1, 'room-two', expect.anything()))
  })

  it('preserves a large room ID string from contacts through conversation selection', async () => {
    const largeRoomId = '1562315127397548042'
    const largeRoomContact = contact(largeRoomId, 'Large room', chat({ room_id: largeRoomId }))
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.contacts.mockResolvedValue([largeRoomContact])
    mocks.conversation.mockResolvedValue([chat({ room_id: largeRoomId, content: 'Pesan room besar' })])
    renderPage()

    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    const roomButton = await within(contactsRegion).findByRole('button', { name: /Large room/ })
    expect(contactsRegion.querySelectorAll('li')).toHaveLength(1)
    fireEvent.click(roomButton)

    expect(await screen.findByText('Pesan room besar')).toBeTruthy()
    expect(mocks.conversation).toHaveBeenCalledWith(1, '1562315127397548042', expect.anything())
  })

  it('prefixes the contact preview with You when the latest message is from the profile', async () => {
    const ownMessage = chat({ id: 24, is_me: true, username: 'profile', content: 'Pesan dari saya' })
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.contacts.mockResolvedValue([contact('room-contact', 'Contact', ownMessage)])
    renderPage()

    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    const contactButton = await within(contactsRegion).findByRole('button', { name: /Contact/ })
    expect(within(contactButton).getByText('You: Pesan dari saya')).toBeTruthy()
  })

  it('uses the top-level contact identity instead of the last chat sender', async () => {
    const lastChat = chat({
      id: 73,
      room_id: '1562315127397548042',
      global_name: 'bersan',
      username: 'bersan',
      is_me: true,
      content: 'allooo',
      status: 'sent',
    })
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.contacts.mockResolvedValue([{
      global_name: 'Magangerz',
      username: 'magangerz9963',
      room_id: '1562315127397548042',
      last_chat: lastChat,
    }])
    mocks.conversation.mockResolvedValue([lastChat])
    renderPage()

    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    const contactButton = await within(contactsRegion).findByRole('button', { name: /Magangerz/ })
    expect(within(contactButton).getByText('@magangerz9963')).toBeTruthy()
    expect(within(contactButton).getByText('You: allooo')).toBeTruthy()
    fireEvent.click(contactButton)
    expect(await screen.findByRole('heading', { name: 'Magangerz' })).toBeTruthy()
    expect(await screen.findAllByText('@magangerz9963')).toHaveLength(2)
  })

  it('sends an explicit reply to the selected message and immediately renders its queued response', async () => {
    const incoming = chat({ id: 22, room_id: 'room-contact', content: 'Pesan yang dibalas', status: 'read' })
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.contacts.mockResolvedValue([contact('room-contact', 'Contact', incoming)])
    mocks.conversation.mockResolvedValue([incoming])
    mocks.reply.mockResolvedValue(chat({
      id: 100,
      room_id: 'room-contact',
      is_me: true,
      username: 'profile',
      content: 'Balasan langsung',
      status: 'queued',
    }))
    renderPage()

    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Contact/ }))
    await screen.findByText('Pesan yang dibalas')
    fireEvent.click(await screen.findByRole('button', { name: 'Balas pesan Contact' }))
    fireEvent.change(screen.getByLabelText('Tulis balasan'), { target: { value: 'Balasan langsung' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }))

    expect(await screen.findByText('Balasan langsung')).toBeTruthy()
    expect(mocks.reply).toHaveBeenCalledWith(22, 'Balasan langsung', true)
    const queuedStatus = screen.getByRole('img', { name: 'Pesan sedang menunggu antrean' })
    expect(queuedStatus).toBeTruthy()
    expect(queuedStatus.querySelector('span')?.className).toContain('size-1.5')
    expect(screen.getAllByText('Balasan langsung')).toHaveLength(1)
  })

  it('does not guess a delivery status missing from the reply response', async () => {
    const incoming = chat({ id: 25, content: 'Balas pesan ini' })
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.contacts.mockResolvedValue([contact('room-contact', 'Contact', incoming)])
    mocks.conversation.mockResolvedValue([incoming])
    mocks.reply.mockResolvedValue(chat({
      id: 101,
      room_id: 'room-contact',
      is_me: false,
      username: 'profile',
      content: 'Balasan tanpa status',
      status: null,
    }))
    renderPage()

    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Contact/ }))
    await screen.findByText('Balas pesan ini')
    fireEvent.change(screen.getByLabelText('Tulis balasan'), { target: { value: 'Balasan tanpa status' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }))

    await screen.findByText('Balasan tanpa status')
    expect(screen.queryByRole('img', { name: 'Pesan sedang menunggu antrean' })).toBeNull()
  })

  it('updates the visible reply status from WebSocket records without duplicating the message', async () => {
    const incoming = chat({ id: 26, room_id: 'room-contact', content: 'Pesan masuk' })
    const reply = chat({
      id: 102,
      room_id: 'room-contact',
      is_me: true,
      username: 'profile',
      content: 'Balasan realtime',
      status: 'queued',
    })
    mocks.listProfiles.mockResolvedValue([{ ...profiles[0], listener_status: 'running' }])
    mocks.contacts.mockResolvedValue([contact('room-contact', 'Contact', incoming)])
    mocks.conversation.mockResolvedValue([incoming, reply])
    vi.stubGlobal('WebSocket', MockWebSocket)
    renderPage()

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))
    const socket = MockWebSocket.instances[0]
    act(() => socket.open())
    act(() => socket.message({ type: 'chat.connected', profile_id: 1 }))

    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Contact/ }))
    await screen.findByText('Balasan realtime')
    expect(screen.getByRole('img', { name: 'Pesan sedang menunggu antrean' })).toBeTruthy()

    act(() => socket.message({
      type: 'chat.message.updated',
      profile_id: 1,
      data: { ...reply, status: 'processing', updated_at: '2026-10-29T02:01:00Z' },
    }))
    expect(screen.getByRole('img', { name: 'Pesan sedang diproses' })).toBeTruthy()

    act(() => socket.message({
      type: 'chat.message.updated',
      profile_id: 1,
      data: { ...reply, status: 'sent', updated_at: '2026-10-29T02:02:00Z' },
    }))
    expect(screen.getByRole('img', { name: 'Pesan terkirim' })).toBeTruthy()
    expect(screen.getAllByText('Balasan realtime')).toHaveLength(1)
  })

  it('uses the latest incoming chat as the default reply target', async () => {
    const incoming = chat({ id: 23, room_id: 'room-contact', content: 'Pesan terbaru', status: 'read' })
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.contacts.mockResolvedValue([contact('room-contact', 'Contact', incoming)])
    mocks.conversation.mockResolvedValue([incoming])
    renderPage()

    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Contact/ }))
    await screen.findByRole('button', { name: 'Balas pesan Contact' })
    expect(screen.queryByText(/Membalas Contact:/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Tulis balasan'), { target: { value: 'Balasan biasa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }))

    await screen.findByText('Balasan biasa')
    expect(mocks.reply).toHaveBeenCalledWith(23, 'Balasan biasa', false)
  })

  it('constrains chat columns and scrolls the contacts and conversation contents', async () => {
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.contacts.mockResolvedValue([contact('contact', 'Contact')])
    mocks.conversation.mockResolvedValue([chat({ status: 'read' })])
    renderPage()

    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    const layout = contactsRegion.parentElement!
    expect(layout.className).toContain('h-[min(70vh,48rem)]')

    await within(contactsRegion).findByRole('button', { name: /Contact/ })
    const contactsList = contactsRegion.querySelector('ul')!
    expect(contactsRegion.className).toContain('min-h-0')
    expect(contactsList.className).toContain('overflow-y-auto')

    fireEvent.click(within(contactsRegion).getByRole('button', { name: /Contact/ }))
    const conversationRegion = screen.getByRole('region', { name: 'Percakapan' })
    const messages = await within(conversationRegion).findByRole('list')
    expect(conversationRegion.className).toContain('min-h-0')
    expect(messages.className).toContain('overflow-y-auto')
    expect(messages.className).toContain('min-h-0')
  })

  it('scrolls the conversation to the latest message when it opens', async () => {
    const scrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLOListElement.prototype, 'scrollTop')
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLOListElement.prototype, 'scrollHeight')
    const setScrollTop = vi.fn()
    Object.defineProperty(HTMLOListElement.prototype, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: setScrollTop,
    })
    Object.defineProperty(HTMLOListElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 640,
    })

    try {
      mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
      mocks.contacts.mockResolvedValue([contact('contact', 'Contact')])
      mocks.conversation.mockResolvedValue([
        chat({ id: 1, content: 'Pesan awal' }),
        chat({ id: 2, content: 'Pesan terbaru', created_at: '2026-10-29T02:00:00Z' }),
      ])
      renderPage()

      const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
      fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Contact/ }))
      await screen.findByText('Pesan terbaru')
      await waitFor(() => expect(setScrollTop).toHaveBeenCalledWith(640))
    } finally {
      if (scrollTopDescriptor) Object.defineProperty(HTMLOListElement.prototype, 'scrollTop', scrollTopDescriptor)
      else delete (HTMLOListElement.prototype as { scrollTop?: number }).scrollTop
      if (scrollHeightDescriptor) Object.defineProperty(HTMLOListElement.prototype, 'scrollHeight', scrollHeightDescriptor)
      else delete (HTMLOListElement.prototype as { scrollHeight?: number }).scrollHeight
    }
  })
})
