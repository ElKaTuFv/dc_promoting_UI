import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { chatsApi } from '../api'
import { useProfiles } from '../hooks'
import type { Chat, ChatContact, RoomId } from '../types'
import { Banner, Btn, PageHead, fmt, inp } from '../ui'
import { useChatRealtime } from '../ChatRealtime'

const messageTime = (chat: Chat) => chat.timestamp ?? chat.created_at
const senderName = (chat: Chat) => chat.global_name || chat.username || 'Pengguna'

function SendIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-5">
    <path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function ReplyIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-4">
    <path d="m9 17-5-5 5-5M4 12h10a6 6 0 0 1 6 6v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function DeliveryStatus({ status }: { status: Chat['status'] }) {
  if (status !== 'queued' && status !== 'processing' && status !== 'sent' && status !== 'failed') return null
  const labels = {
    queued: 'Pesan sedang menunggu antrean',
    processing: 'Pesan sedang diproses',
    sent: 'Pesan terkirim',
    failed: 'Pengiriman pesan gagal',
  }
  const label = labels[status]
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 items-center">
      {status === 'queued' && <span className="size-1.5 rounded-full bg-sky-300" />}
      {status === 'processing' && <span className="size-1.5 rounded-full animate-pulse bg-sky-200" />}
      {status === 'sent' && <svg aria-hidden="true" viewBox="0 0 18 14" className="size-3">
        <path d="m1 7 4 4L13 2M8 11l2 1 7-9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>}
      {status === 'failed' && <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3 text-red-200">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.5v4M8 11.2v.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>}
    </span>
  )
}

export default function Chats() {
  const queryClient = useQueryClient()
  const profilesQuery = useProfiles()
  const realtime = useChatRealtime()
  const [profileId, setProfileId] = useState<number | null>(null)
  const [roomId, setRoomId] = useState<RoomId | null>(null)
  const [search, setSearch] = useState('')
  const [replyTarget, setReplyTarget] = useState<Chat | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const lastSynced = useRef<{ key: string; data: Chat[] } | null>(null)
  const messagesListRef = useRef<HTMLOListElement | null>(null)

  useEffect(() => {
    if (!profilesQuery.data) return
    if (profileId === null || !profilesQuery.data.some((profile) => profile.id === profileId)) {
      setProfileId(profilesQuery.data[0]?.id ?? null)
      setRoomId(null)
      setReplyTarget(null)
    }
  }, [profileId, profilesQuery.data])

  const contactsQuery = useQuery({
    queryKey: ['chatContacts', profileId],
    queryFn: ({ signal }) => {
      if (profileId === null) throw new Error('Pilih profil terlebih dahulu.')
      return chatsApi.contacts(profileId, signal).then((contacts) => realtime.mergeContacts(profileId, contacts))
    },
    enabled: profileId !== null,
  })

  const conversationQuery = useQuery({
    queryKey: ['conversation', profileId, roomId],
    queryFn: ({ signal }) => {
      if (profileId === null || roomId === null) throw new Error('Pilih kontak terlebih dahulu.')
      return chatsApi.conversation(profileId, roomId, signal)
        .then((chats) => realtime.mergeConversation(profileId, roomId, chats))
    },
    enabled: profileId !== null && roomId !== null,
  })

  useEffect(() => {
    if (!conversationQuery.isSuccess || !conversationQuery.isFetchedAfterMount || profileId === null || roomId === null) return
    const syncKey = JSON.stringify([profileId, roomId])
    if (!conversationQuery.dataUpdatedAt || (lastSynced.current?.key === syncKey && lastSynced.current.data === conversationQuery.data)) return
    lastSynced.current = { key: syncKey, data: conversationQuery.data }
    realtime.markConversationRead(profileId, roomId, conversationQuery.data)

    const latestChat = conversationQuery.data.at(-1)
    if (latestChat) {
      queryClient.setQueryData<ChatContact[]>(['chatContacts', profileId], (contacts) =>
        contacts?.map((contact) => contact.room_id === roomId
          ? { ...contact, last_chat: latestChat }
          : contact),
      )
    }
    void queryClient.invalidateQueries({ queryKey: ['chatContacts', profileId] })
  }, [conversationQuery.data, conversationQuery.dataUpdatedAt, conversationQuery.isFetchedAfterMount, conversationQuery.isSuccess, profileId, queryClient, realtime, roomId])

  const contacts = profileId !== null
    ? realtime.mergeContacts(profileId, contactsQuery.data ?? []).filter((contact): contact is ChatContact & { room_id: RoomId } => contact.room_id !== null)
    : []
  const filteredContacts = contacts.filter((contact) => {
    return `${contact.global_name} ${contact.username} ${contact.last_chat.content ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  })
  const conversationMessages = profileId !== null && roomId !== null
    ? realtime.mergeConversation(profileId, roomId, conversationQuery.data ?? [])
    : []
  const newestMessageId = conversationMessages.at(-1)?.id
  const activeContact = contacts.find((contact) => contact.room_id === roomId)
  const defaultReplyTarget = [...conversationMessages].reverse().find((chat) => !chat.is_me)
  const targetMessage = replyTarget ?? defaultReplyTarget

  useLayoutEffect(() => {
    const messagesList = messagesListRef.current
    if (messagesList) messagesList.scrollTop = messagesList.scrollHeight
  }, [newestMessageId, roomId])

  const sendReply = async (event: FormEvent) => {
    event.preventDefault()
    const body = replyText.trim()
    if (!body || !targetMessage || profileId === null || roomId === null || sending) return
    setSending(true)
    setSendError(null)
    try {
      const message = await chatsApi.reply(targetMessage.id, body, replyTarget !== null)
      const newMessage: Chat = {
        ...message,
        profile_id: message.profile_id ?? profileId,
        room_id: message.room_id ?? roomId,
        is_me: true,
      }
      queryClient.setQueryData<Chat[]>(['conversation', profileId, roomId], (current) =>
        current ? realtime.mergeConversation(profileId, roomId, [...current.filter((chat) => chat.id !== newMessage.id), newMessage]) : [newMessage],
      )
      queryClient.setQueryData<ChatContact[]>(['chatContacts', profileId], (current) =>
        current?.map((contact) => contact.room_id === roomId
          ? { ...contact, last_chat: newMessage }
          : contact),
      )
      setReplyText('')
      setReplyTarget(null)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Pesan gagal dikirim.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <PageHead
        title="Chat"
        sub="Pesan real-time diterima dari listener backend untuk semua profil aktif. Setelah koneksi tersambung kembali, riwayat diselaraskan melalui REST."
        action={realtime.notificationPermission === 'granted'
          ? <Btn disabled variant="ghost" aria-label="Notifikasi desktop aktif">Notifikasi desktop aktif</Btn>
          : <Btn onClick={() => { void realtime.requestBrowserNotifications() }}>Aktifkan notifikasi desktop</Btn>}
      />
      {realtime.notificationPermission === 'denied' && <Banner kind="warn">Notifikasi desktop diblokir oleh browser. Izinkan notifikasi untuk situs ini melalui pengaturan Chrome; toast di aplikasi tetap aktif.</Banner>}
      {realtime.notificationPermission === 'unsupported' && <Banner kind="info">Browser ini tidak mendukung notifikasi desktop. Toast di aplikasi tetap aktif.</Banner>}

      <label className="mb-5 block max-w-md">
        <span className="mb-1.5 block text-sm font-semibold text-soft">Profil Discord</span>
        <select
          className={inp}
          aria-label="Pilih profil"
          value={profileId ?? ''}
          disabled={profilesQuery.isLoading || !profilesQuery.data?.length}
          onChange={(event) => {
            const value = event.target.value
            setProfileId(value ? Number(value) : null)
            setRoomId(null)
            setReplyTarget(null)
          }}
        >
          {!profilesQuery.data?.length && <option value="">Tidak ada profil</option>}
          {profilesQuery.data?.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      </label>

      {profilesQuery.isLoading && <div aria-busy className="mb-5 h-12 max-w-md animate-pulse rounded-lg bg-raised" />}
      {profilesQuery.isError && <Banner kind="error">{profilesQuery.error.message}</Banner>}
      {!profilesQuery.isLoading && !profilesQuery.isError && profilesQuery.data?.length === 0 && (
        <p className="mb-5 rounded-lg border border-dashed border-line p-6 text-sm text-muted">Belum ada profil untuk menampilkan chat.</p>
      )}

      {profileId !== null && (
        <div className="grid h-[min(70vh,48rem)] min-h-[24rem] grid-rows-2 gap-4 lg:min-h-[32rem] lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.5fr)] lg:grid-rows-1">
          <section aria-label="Daftar kontak" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-surface ring-1 ring-line">
            <div className="border-b border-line p-3">
              <h2 className="mb-2 text-base font-semibold">Kontak</h2>
              <input
                className={inp}
                aria-label="Cari kontak"
                placeholder="Cari nama atau pesan…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {contactsQuery.isLoading && contacts.length === 0 && <div aria-busy className="space-y-2 p-3">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-md bg-raised" />)}</div>}
            {contactsQuery.isError && <div className="p-3"><Banner kind="error">{contactsQuery.error.message}</Banner></div>}
            {contactsQuery.isSuccess && contacts.length === 0 && <p className="p-6 text-center text-sm text-muted">Belum ada kontak untuk profil ini.</p>}
            {contactsQuery.isSuccess && contacts.length > 0 && filteredContacts.length === 0 && <p className="p-6 text-center text-sm text-muted">Tidak ada kontak yang cocok dengan pencarian.</p>}
            {filteredContacts.length > 0 && (
              <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
                {filteredContacts.map((contact) => {
                  const latest = contact.last_chat
                  const name = contact.global_name || contact.username || senderName(latest)
                  return (
                    <li key={contact.room_id}>
                      <button
                        type="button"
                        aria-pressed={contact.room_id === roomId}
                        onClick={() => {
                          setRoomId(contact.room_id)
                          setReplyTarget(null)
                          setSendError(null)
                        }}
                        className={`w-full px-3 py-3 text-left transition-colors hover:bg-raised/60 focus-visible:outline-2 focus-visible:outline-link ${contact.room_id === roomId ? 'bg-raised' : ''}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">{name}</span>
                          <span className="shrink-0 text-xs text-muted">{fmt(messageTime(latest))}</span>
                        </span>
                        {contact.username && <span className="mt-0.5 block truncate text-xs text-muted">@{contact.username}</span>}
                        <span className="mt-1 block truncate text-sm text-soft">{latest.is_me ? 'You: ' : ''}{latest.content?.trim() || 'Pesan tanpa teks'}</span>
                        {(contact.last_chat.status === 'unread' || realtime.hasUnread(profileId, contact.room_id)) && (
                          <span role="img" aria-label="Pesan belum dibaca" title="Pesan belum dibaca" className="mt-2 inline-block size-2 rounded-full bg-red-500 align-middle" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section aria-label="Percakapan" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-surface ring-1 ring-line">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">{activeContact ? activeContact.global_name || activeContact.username || senderName(activeContact.last_chat) : 'Pilih kontak'}</h2>
              {activeContact?.username && <p className="text-sm text-muted">@{activeContact.username}</p>}
            </div>
            {!roomId && <p className="m-auto p-6 text-center text-sm text-muted">Pilih kontak untuk membuka percakapan.</p>}
            {roomId !== null && conversationQuery.isLoading && <div aria-busy className="m-4 flex-1 animate-pulse rounded-md bg-raised" />}
            {roomId !== null && conversationQuery.isError && <div className="p-4"><Banner kind="error">{conversationQuery.error.message}</Banner></div>}
            {roomId !== null && conversationQuery.isSuccess && conversationMessages.length === 0 && (
              <p className="m-auto p-6 text-center text-sm text-muted">Belum ada pesan di percakapan ini.</p>
            )}
            {roomId !== null && conversationQuery.isSuccess && conversationMessages.length > 0 && (
              <ol ref={messagesListRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {conversationMessages.map((chat) => (
                  <li key={chat.id} className={`flex ${chat.is_me ? 'justify-end' : 'justify-start'}`}>
                    <article data-status={chat.status ?? undefined} className={`group max-w-[85%] rounded-xl px-3 py-2 ${chat.is_me ? 'bg-accent text-white' : 'bg-raised text-body'}`}>
                      <div className="mb-1 flex items-baseline justify-between gap-4 text-xs opacity-80">
                        <span className="font-semibold">{chat.is_me ? 'Anda' : senderName(chat)}</span>
                        <time dateTime={messageTime(chat)}>{fmt(messageTime(chat))}</time>
                      </div>
                      <div className="flex items-end gap-2">
                        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{chat.content ?? 'Pesan tanpa teks'}</p>
                        {chat.is_me && <DeliveryStatus status={chat.status} />}
                        <button
                          type="button"
                          aria-label={`Balas pesan ${senderName(chat)}`}
                          title="Balas pesan"
                          onClick={() => {
                            setReplyTarget(chat)
                            setSendError(null)
                          }}
                          className="shrink-0 rounded p-1 opacity-70 transition hover:bg-black/10 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-link"
                        >
                          <ReplyIcon />
                        </button>
                      </div>
                    </article>
                  </li>
                ))}
              </ol>
            )}
            {roomId !== null && (
              <form onSubmit={sendReply} className="border-t border-line p-3">
                {sendError && <div className="mb-2"><Banner kind="error">{sendError}</Banner></div>}
                {replyTarget && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-raised px-3 py-2 text-xs text-soft">
                    <span className="min-w-0 truncate">Membalas {senderName(replyTarget)}: {replyTarget.content?.trim() || 'Pesan tanpa teks'}</span>
                    <button type="button" onClick={() => setReplyTarget(null)} className="shrink-0 text-muted hover:text-body" aria-label="Hapus target balasan">×</button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    className={`${inp} min-h-10 max-h-28 resize-y`}
                    aria-label="Tulis balasan"
                    placeholder={targetMessage ? 'Tulis balasan…' : 'Tidak ada pesan yang dapat dibalas'}
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    disabled={!targetMessage || sending}
                    rows={1}
                  />
                  <button
                    type="submit"
                    aria-label="Kirim pesan"
                    title="Kirim pesan"
                    disabled={!replyText.trim() || !targetMessage || sending}
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <SendIcon />
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  )
}
