import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { chatsApi } from '../api'
import { useProfiles } from '../hooks'
import type { Chat, ChatContact } from '../types'
import { Banner, Btn, PageHead, fmt, inp } from '../ui'
import { useChatRealtime } from '../ChatRealtime'

export default function Chats() {
  const queryClient = useQueryClient()
  const profilesQuery = useProfiles()
  const realtime = useChatRealtime()
  const [profileId, setProfileId] = useState<number | null>(null)
  const [contactUsername, setContactUsername] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const lastSynced = useRef<{ key: string; data: Chat[] } | null>(null)

  useEffect(() => {
    if (!profilesQuery.data) return
    if (profileId === null || !profilesQuery.data.some((profile) => profile.id === profileId)) {
      setProfileId(profilesQuery.data[0]?.id ?? null)
      setContactUsername(null)
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
    queryKey: ['conversation', profileId, contactUsername],
    queryFn: ({ signal }) => {
      if (profileId === null || contactUsername === null) throw new Error('Pilih kontak terlebih dahulu.')
      return chatsApi.conversation(profileId, contactUsername, signal)
        .then((chats) => realtime.mergeConversation(profileId, contactUsername, chats))
    },
    enabled: profileId !== null && contactUsername !== null,
  })

  useEffect(() => {
    if (!conversationQuery.isSuccess || !conversationQuery.isFetchedAfterMount || profileId === null || contactUsername === null) return
    const syncKey = JSON.stringify([profileId, contactUsername])
    if (!conversationQuery.dataUpdatedAt || (lastSynced.current?.key === syncKey && lastSynced.current.data === conversationQuery.data)) return
    lastSynced.current = { key: syncKey, data: conversationQuery.data }
    realtime.markConversationRead(profileId, contactUsername, conversationQuery.data)

    const latestChat = conversationQuery.data.at(-1)
    if (latestChat) {
      queryClient.setQueryData<ChatContact[]>(['chatContacts', profileId], (contacts) =>
        contacts?.map((contact) => contact.username === contactUsername
          ? { ...contact, last_chat: latestChat }
          : contact),
      )
    }
    void queryClient.invalidateQueries({ queryKey: ['chatContacts', profileId] })
  }, [contactUsername, conversationQuery.data, conversationQuery.dataUpdatedAt, conversationQuery.isFetchedAfterMount, conversationQuery.isSuccess, profileId, queryClient, realtime])

  const contacts = profileId !== null ? realtime.mergeContacts(profileId, contactsQuery.data ?? []) : []
  const filteredContacts = contacts.filter((contact) =>
    `${contact.username} ${contact.global_name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  )
  const conversationMessages = profileId !== null && contactUsername !== null
    ? realtime.mergeConversation(profileId, contactUsername, conversationQuery.data ?? [])
    : []

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
            setContactUsername(null)
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
                placeholder="Cari nama atau username…"
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
                {filteredContacts.map((contact) => (
                  <li key={contact.username}>
                    <button
                      type="button"
                      aria-pressed={contact.username === contactUsername}
                      onClick={() => setContactUsername(contact.username)}
                      className={`w-full px-3 py-3 text-left transition-colors hover:bg-raised/60 focus-visible:outline-2 focus-visible:outline-link ${contact.username === contactUsername ? 'bg-raised' : ''}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{contact.global_name || contact.username}</span>
                        <span className="shrink-0 text-xs text-muted">{fmt(contact.last_chat.timestamp ?? contact.last_chat.created_at)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">@{contact.username}</span>
                      <span className="mt-1 block truncate text-sm text-soft">{contact.last_chat.content?.trim() || 'Pesan tanpa teks'}</span>
                      {realtime.hasUnread(profileId, contact.username) && <span role="img" aria-label="Pesan belum dibaca" className="mt-2 inline-block size-2 rounded-full bg-red-500 align-middle" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Percakapan" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-surface ring-1 ring-line">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">
                {contactUsername
                  ? (contacts.find((contact) => contact.username === contactUsername)?.global_name || contactUsername)
                  : 'Pilih kontak'}
              </h2>
              {contactUsername && <p className="text-sm text-muted">@{contactUsername}</p>}
            </div>
            {!contactUsername && <p className="m-auto p-6 text-center text-sm text-muted">Pilih kontak untuk membuka percakapan.</p>}
            {contactUsername && conversationQuery.isLoading && <div aria-busy className="m-4 flex-1 animate-pulse rounded-md bg-raised" />}
            {contactUsername && conversationQuery.isError && <div className="p-4"><Banner kind="error">{conversationQuery.error.message}</Banner></div>}
            {contactUsername && conversationQuery.isSuccess && conversationMessages.length === 0 && (
              <p className="m-auto p-6 text-center text-sm text-muted">Belum ada pesan di percakapan ini.</p>
            )}
            {contactUsername && conversationQuery.isSuccess && conversationMessages.length > 0 && (
              <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {conversationMessages.map((chat) => (
                  <li key={chat.id} className={`flex ${chat.is_me ? 'justify-end' : 'justify-start'}`}>
                    <article data-status={chat.status ?? undefined} className={`max-w-[85%] rounded-xl px-3 py-2 ${chat.is_me ? 'bg-accent text-white' : 'bg-raised text-body'}`}>
                      <div className="mb-1 flex items-baseline justify-between gap-4 text-xs opacity-80">
                        <span className="font-semibold">{chat.is_me ? 'Anda' : chat.global_name || chat.username}</span>
                        <time dateTime={chat.timestamp ?? chat.created_at}>{fmt(chat.timestamp ?? chat.created_at)}</time>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm">{chat.content ?? 'Pesan tanpa teks'}</p>
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </>
  )
}
