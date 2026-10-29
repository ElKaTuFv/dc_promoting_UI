import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Chats from './Chats'
import { ChatRealtimeProvider } from '../ChatRealtime'
import type { Chat, ChatContact, Profile } from '../types'

const mocks = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  listChats: vi.fn(),
  contacts: vi.fn(),
  conversation: vi.fn(),
}))

vi.mock('../api', () => ({
  channelsApi: { list: vi.fn() },
  messagesApi: { list: vi.fn() },
  profilesApi: { list: mocks.listProfiles },
  chatsApi: { list: mocks.listChats, contacts: mocks.contacts, conversation: mocks.conversation },
  promotionApi: { logs: vi.fn() },
}))

const profiles: Profile[] = [
  { id: 1, name: 'Profile one', level: 0, listener_status: 'stopped', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
  { id: 2, name: 'Profile two', level: 0, listener_status: 'stopped', active_at: null, nonactive_at: null, created_at: '', updated_at: null },
]
const chat = (overrides: Partial<Chat> = {}): Chat => ({
  id: 1,
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
const contact = (username: string, globalName: string, lastChat: Chat = chat()): ChatContact => ({
  username,
  global_name: globalName,
  last_chat: { ...lastChat, username },
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><ChatRealtimeProvider><Chats /></ChatRealtimeProvider></QueryClientProvider>)
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.listChats.mockResolvedValue([])
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
    const unreadChat = chat({ id: 8, username: 'contact', status: 'unread' })
    mocks.listProfiles.mockResolvedValue(profiles.slice(0, 1))
    mocks.listChats.mockResolvedValue([unreadChat])
    mocks.contacts.mockResolvedValue([contact('contact', 'Contact', unreadChat)])
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
    const firstContact = contact('first-user', 'First Contact')
    const secondContact = contact('exact+user&tag', 'Second Contact')
    mocks.listProfiles.mockResolvedValue(profiles)
    mocks.contacts
      .mockResolvedValueOnce([firstContact, secondContact])
      .mockResolvedValue([contact('first-user', 'First Contact', chat({ status: 'read' })), contact('exact+user&tag', 'Second Contact', chat({ id: 4, content: 'Balasan terbaru', is_me: true, status: 'read', username: 'profile' }))])

    let finishFirstConversation!: (value: Chat[]) => void
    mocks.conversation.mockImplementation((profileId: number, username: string) => {
      if (profileId === 1 && username === 'first-user') return new Promise<Chat[]>((resolve) => { finishFirstConversation = resolve })
      if (profileId === 1 && username === 'exact+user&tag') return Promise.resolve([
        chat({ id: 2, content: 'Pesan masuk lama', status: 'read' }),
        chat({ id: 3, content: 'Balasan sendiri terbaru', is_me: true, username: 'profile', status: 'read' }),
      ])
      return Promise.resolve([chat({ id: 5, content: 'Pesan profil dua' })])
    })

    renderPage()
    const contactsRegion = await screen.findByRole('region', { name: 'Daftar kontak' })
    const secondButton = await within(contactsRegion).findByRole('button', { name: /Second Contact/ })
    fireEvent.click(within(contactsRegion).getByRole('button', { name: /First Contact/ }))
    await waitFor(() => expect(mocks.conversation).toHaveBeenCalledWith(1, 'first-user', expect.anything()))
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
    expect(mocks.conversation).toHaveBeenCalledWith(1, 'exact+user&tag', expect.anything())

    await waitFor(() => expect(mocks.contacts).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(contactsRegion).queryByText('Belum dibaca')).toBeNull())

    fireEvent.change(screen.getByLabelText('Pilih profil'), { target: { value: '2' } })
    await waitFor(() => expect(mocks.contacts).toHaveBeenCalledWith(2, expect.anything()))
    expect(screen.queryByText('Pesan masuk lama')).toBeNull()
    expect(screen.getByText('Pilih kontak untuk membuka percakapan.')).toBeTruthy()
    fireEvent.click(await within(contactsRegion).findByRole('button', { name: /Second Contact/ }))
    expect(await screen.findByText('Pesan profil dua')).toBeTruthy()
    expect(mocks.conversation).toHaveBeenCalledWith(2, 'exact+user&tag', expect.anything())
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
})
