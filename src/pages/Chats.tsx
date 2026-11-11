import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { chatsApi } from '../api'
import { useProfiles } from '../hooks'
import type { Chat, ChatContact, ChatReplyRequest, ChatRoomId, Profile, ReplyTaskStatus } from '../types'
import { Banner, Btn, PageHead, fmt, inp } from '../ui'
import { useChatRealtime, type ChatConnectionStatus } from '../ChatRealtime'

type ContactSelection = { profileId: number; roomId: ChatRoomId | null; filterRoomId: ChatRoomId | null; username: string }
type ReplyTarget = { key: string; chat: Chat }
type OptimisticMessage = Omit<Chat, 'id' | 'profile_id'> & {
  profile_id: number
  id: `optimistic-${number}`
  local: true
  targetKey: string
  delivery: 'enqueuing' | 'failed'
  taskStatus?: ReplyTaskStatus
  failureMessage?: string
  taskError?: string | null
  taskId?: string
  serverChatId?: number
  submittedAt: number
  request: ChatReplyRequest
  targetChatId: number
  replyOrdinal: number
  replyTotal: number
  replyStatusCounts: Record<OptimisticDeliveryStatus, number>
}
type ConversationMessage = Chat | OptimisticMessage
type OptimisticDeliveryStatus = ReplyTaskStatus | 'enqueuing'
type ReplyVariables = {
  optimisticId: OptimisticMessage['id']
  targetChatId: number
  body: ChatReplyRequest
  key: string
  profileId: number
  roomId: ChatRoomId | null
}
const targetKey = (profileId: number, roomId: ChatRoomId | null) => JSON.stringify([profileId, roomId])
const sameRoomId = (left: ChatRoomId | null, right: ChatRoomId | null) => left === right
const taskErrorText = (error: string | null | undefined) => {
  const message = error?.trim()
  if (!message || message.length > 200 || /[\r\n]|traceback|stack trace|authorization|password|token/i.test(message)) {
    return 'Balasan gagal dikirim.'
  }
  return message
}
let optimisticSequence = 0
const parseRoomId = (value: string): ChatRoomId | null | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed) || /^0+$/.test(trimmed)) return undefined
  const id = Number(trimmed)
  return Number.isSafeInteger(id) ? id : trimmed
}

function ProfileSelector({ profiles, value, disabled, onChange }: {
  profiles: Profile[]
  value: number | null
  disabled: boolean
  onChange: (profileId: number | null) => void
}) {
  return (
    <label className="block min-w-0">
      {/* <span className="mb-1 block text-xs font-semibold text-soft">Profil Discord</span> */}
      <select className={inp} aria-label="Pilih profil" value={value ?? ''} disabled={disabled}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
        <option value="">Pilih profil terlebih dahulu</option>
        {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select>
    </label>
  )
}

function RoomSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="sr-only">Filter room</span>
      <input className={`${inp} py-2`} aria-label="Filter room" inputMode="numeric" placeholder="Semua room"
        value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function IconButton({ label, title, active = false, disabled = false, onClick, children }: {
  label: string
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'bg-accent text-white' : 'bg-raised text-soft hover:bg-[#4e5058]'} `}>
      {children}
    </button>
  )
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`size-5 ${spinning ? 'animate-spin' : ''}`}>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M5.6 9A7 7 0 0 1 17.5 6L20 12M4 12l2.5 6A7 7 0 0 0 18.4 15" />
    </svg>
  )
}

function TargetIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
      <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v2m10 8h-2" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
      <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
      <path d="m18 6-12 12M6 6l12 12" />
    </svg>
  )
}

function ReplyStatusIndicator({ status, ordinal, total, counts }: {
  status: OptimisticDeliveryStatus
  ordinal: number
  total: number
  counts: Record<OptimisticDeliveryStatus, number>
}) {
  const labels: Record<OptimisticDeliveryStatus, string> = {
    enqueuing: 'Mengantre',
    queued: 'Dalam antrean',
    processing: 'Sedang dikirim',
    sent: 'Terkirim',
    failed: 'Gagal',
  }
  const countSummary = `Dalam antrean ${counts.queued}, sedang dikirim ${counts.processing}, terkirim ${counts.sent}, gagal ${counts.failed}.`
  const description = `Balasan ${ordinal} dari ${total}: ${labels[status]}. ${countSummary}`
  return (
    <span role="img" aria-label={`Status balasan: ${description}`} aria-live="polite" tabIndex={0} title={description}
      className="group relative ml-2 inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle outline-none focus-visible:ring-2 focus-visible:ring-white/80">
      {status === 'enqueuing' || status === 'processing' ? (
        <span aria-hidden className={`size-2 rounded-full ${status === 'processing' ? 'animate-pulse bg-sky-200' : 'bg-white/60'}`} />
      ) : status === 'failed' ? (
        <span aria-hidden className="text-[11px] font-bold leading-none text-red-200">!</span>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 18 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`size-3.5 ${status === 'sent' ? 'text-sky-200' : 'text-white/70'}`}>
          <path d="m1 6 3 3 6-6" />
          {status === 'sent' && <path d="m7 6 3 3 6-6" />}
        </svg>
      )}
      <span aria-hidden className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 hidden w-max max-w-64 rounded-md bg-black/90 px-2.5 py-1.5 text-left text-[11px] font-normal text-white shadow-lg group-hover:block group-focus:block">
        {description}
      </span>
    </span>
  )
}

function LiveStatusIndicator({ profile, connection }: { profile: Profile; connection: ChatConnectionStatus }) {
  const connectionLabel: Record<ChatConnectionStatus, string> = {
    connecting: 'Menghubungkan',
    connected: 'Terhubung',
    reconnecting: 'Menyambungkan ulang',
    disconnected: 'Terputus',
  }
  const connectionStyle = connection === 'connected' ? 'text-emerald-300' : connection === 'reconnecting' ? 'text-amber-300' : 'text-muted'
  return (
    <div className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
      <span className={`size-2 rounded-full ${profile.listener_status === 'running' ? 'bg-emerald-400' : 'bg-muted'}`} title={`Listener ${profile.listener_status}`} />
      <span>{profile.listener_status === 'running' ? 'Listener aktif' : 'Listener berhenti'}</span>
      <span aria-hidden>·</span>
      <span className={`size-2 rounded-full ${connection === 'connected' ? 'bg-emerald-400' : connection === 'reconnecting' ? 'bg-amber-400' : 'bg-muted'}`} title={`WebSocket: ${connectionLabel[connection]}`} />
      <span className={connectionStyle}>{connectionLabel[connection]}</span>
    </div>
  )
}

function ChatContactList({ contacts, selectedRoomId, profileId, roomId, realtime, onSelect }: {
  contacts: ChatContact[]
  selectedRoomId: ChatRoomId | null | undefined
  profileId: number
  roomId: ChatRoomId | null
  realtime: ReturnType<typeof useChatRealtime>
  onSelect: (contact: ChatContact) => void
}) {
  if (!contacts.length) return <p className="p-6 text-center text-sm text-muted">Belum ada kontak untuk pilihan ini.</p>
  return (
    <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
      {contacts.map((contact) => (
        <li key={`${contact.username}-${contact.last_chat.room_id ?? 'no-room'}`}>
          <button type="button" aria-pressed={selectedRoomId !== undefined && sameRoomId(contact.last_chat.room_id, selectedRoomId)} onClick={() => onSelect(contact)}
            className={`w-full px-3 py-3 text-left transition-colors hover:bg-raised/60 focus-visible:outline-2 focus-visible:outline-link ${selectedRoomId !== undefined && sameRoomId(contact.last_chat.room_id, selectedRoomId) ? 'bg-raised' : ''}`}>
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold">{contact.global_name || contact.username}</span>
              <span className="shrink-0 text-xs text-muted">{fmt(contact.last_chat.timestamp ?? contact.last_chat.created_at)}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">@{contact.username}</span>
            <span className="mt-1 block truncate text-sm text-soft">{contact.last_chat.content?.trim() || 'Pesan tanpa teks'}</span>
            {realtime.hasUnread(profileId, contact.username, roomId) && <span role="img" aria-label="Pesan belum dibaca" className="mt-2 inline-block size-2 rounded-full bg-red-500 align-middle" />}
          </button>
        </li>
      ))}
    </ul>
  )
}

function ReplyComposer({ canReply, pending, specifiedReply, selectedTarget, onClearTarget, onSubmit }: {
  canReply: boolean
  pending: boolean
  specifiedReply: boolean
  selectedTarget: Chat | null
  onClearTarget: () => void
  onSubmit: (body: ChatReplyRequest) => void
}) {
  const [reply, setReply] = useState('')
  const [validationError, setValidationError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canSubmit = !!reply.trim() && canReply && !pending

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '44px'
    const scrollHeight = textarea.scrollHeight
    const height = Math.min(scrollHeight, 120)
    textarea.style.height = `${Math.max(44, height)}px`
    textarea.style.overflowY = scrollHeight > 120 ? 'auto' : 'hidden'
  }, [reply])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!reply.trim()) {
      setValidationError('Balasan tidak boleh kosong.')
      return
    }
    if (!canReply) {
      setValidationError('Pilih pesan untuk membalas.')
      return
    }
    setValidationError('')
    onSubmit({ reply, specified_reply: specifiedReply })
    setReply('')
  }

  return (
    <form onSubmit={submit} className="shrink-0 border-t border-line p-3">
      {selectedTarget && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-raised px-3 py-1.5 text-xs text-soft">
          <span className="truncate">Membalas: {selectedTarget.content?.trim() || 'Pesan tanpa teks'}</span>
          <IconButton label="Hapus target balasan" title="Hapus target balasan" onClick={onClearTarget}><CloseIcon /></IconButton>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Balasan</span>
          <textarea ref={textareaRef} rows={1} className={`${inp} h-11 min-h-11 max-h-[120px] resize-none overflow-y-hidden py-2.5`}
            aria-label="Balasan" placeholder="Tulis pesan…" value={reply}
            onChange={(event) => { setReply(event.target.value); setValidationError('') }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }} />
        </label>
        <button type="submit" aria-label="Kirim balasan" title="Kirim balasan" disabled={!canSubmit}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? <span aria-label="Mengirim" className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <SendIcon />}
        </button>
      </div>
      {validationError && <p role="alert" className="mt-2 text-xs text-red-300">{validationError}</p>}
    </form>
  )
}

function ChatConversation({ username, messages, loading, refreshing, error, targetMode, selectedTargetId, onToggleTargetMode, onSelectTarget, onRefresh, onRetry, replyComposer }: {
  username: string | null
  messages: ConversationMessage[]
  loading: boolean
  refreshing: boolean
  error?: string
  targetMode: boolean
  selectedTargetId: number | null
  onToggleTargetMode: () => void
  onSelectTarget: (chat: Chat) => void
  onRefresh: () => void
  onRetry: (message: OptimisticMessage) => void
  replyComposer?: ReactNode
}) {
  const messagesRef = useRef<HTMLOListElement>(null)

  useLayoutEffect(() => {
    const list = messagesRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [username, messages.length, messages.at(-1)?.id])

  return (
    <section aria-label="Percakapan" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-surface ring-1 ring-line">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line p-3">
        <h2 className="min-w-0 truncate font-semibold">{username ? `@${username}` : 'Pilih percakapan'}</h2>
        {username && (
          <div className="flex shrink-0 gap-1">
            <IconButton label={selectedTargetId !== null ? 'Batalkan target pesan' : targetMode ? 'Batalkan pemilihan target' : 'Pilih pesan target'}
              title={selectedTargetId !== null ? 'Batalkan target pesan' : targetMode ? 'Batalkan pemilihan target' : 'Pilih pesan target'}
              active={targetMode || selectedTargetId !== null} onClick={onToggleTargetMode}><TargetIcon /></IconButton>
            <IconButton label="Refresh percakapan" title="Refresh percakapan" disabled={refreshing} onClick={onRefresh}><RefreshIcon spinning={refreshing} /></IconButton>
          </div>
        )}
      </div>
      {!username && <p className="m-auto p-6 text-center text-sm text-muted">Pilih profil, lalu kontak untuk membuka percakapan.</p>}
      {username && targetMode && <p className="shrink-0 px-4 py-2 text-xs text-muted" aria-live="polite">Pilih target balasan. Backend mencocokkan teks; pesan duplikat bisa memilih target berbeda.</p>}
      {username && loading && messages.length === 0 && <div aria-busy className="m-4 min-h-32 flex-1 animate-pulse rounded-md bg-raised" />}
      {username && error && <div className="p-4"><Banner kind="error">{error}</Banner></div>}
      {username && !loading && !error && messages.length === 0 && <p className="m-auto p-6 text-center text-sm text-muted">Belum ada pesan.</p>}
      {username && messages.length > 0 && (
        <ol ref={messagesRef} aria-label="Pesan" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {messages.map((chat) => (
            <li key={chat.id} className={`flex ${chat.is_me ? 'justify-end' : 'justify-start'}`}>
              <article data-status={chat.status ?? undefined}
                className={`max-w-[85%] rounded-xl px-3 py-2 ${chat.is_me ? 'bg-accent text-white' : 'bg-raised text-body'} ${!('local' in chat) && selectedTargetId === chat.id ? 'ring-2 ring-link' : ''}`}>
                <div className="mb-1 flex items-baseline justify-between gap-4 text-xs opacity-80">
                  <span className="font-semibold">{chat.is_me ? 'Anda' : chat.global_name || chat.username}</span>
                  <time dateTime={chat.timestamp ?? chat.created_at}>{fmt(chat.timestamp ?? chat.created_at)}</time>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{chat.content ?? 'Pesan tanpa teks'}</p>
                {'local' in chat && (
                  <div className="mt-1 flex min-h-4 items-center justify-end gap-2">
                    {chat.delivery === 'failed' && <span className="text-xs text-red-100">{taskErrorText(chat.taskError ?? chat.failureMessage)}</span>}
                    {chat.taskId && <span className="sr-only">Task {chat.taskId}</span>}
                    <ReplyStatusIndicator status={chat.delivery === 'failed' ? 'failed' : chat.taskStatus ?? 'enqueuing'}
                      ordinal={chat.replyOrdinal} total={chat.replyTotal} counts={chat.replyStatusCounts} />
                    {chat.delivery === 'failed' && (
                      <button type="button" onClick={() => onRetry(chat)} className="text-xs underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-link">Coba lagi</button>
                    )}
                  </div>
                )}
                {!('local' in chat) && targetMode && (
                  <button type="button" aria-pressed={selectedTargetId === chat.id} onClick={() => onSelectTarget(chat)}
                    className="mt-2 rounded text-xs underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-link">
                    {selectedTargetId === chat.id ? 'Target dipilih' : 'Pilih pesan ini'}
                  </button>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
      {username && replyComposer}
    </section>
  )
}

export default function Chats() {
  const queryClient = useQueryClient()
  const profilesQuery = useProfiles()
  const realtime = useChatRealtime()
  const [profileId, setProfileId] = useState<number | null>(null)
  const [roomInput, setRoomInput] = useState('')
  const [selectedContact, setSelectedContact] = useState<ContactSelection | null>(null)
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null)
  const [targetMode, setTargetMode] = useState(false)
  const [search, setSearch] = useState('')
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([])
  const lastSynced = useRef<{ key: string; dataUpdatedAt: number; data: Chat[] } | null>(null)
  const roomId = parseRoomId(roomInput)
  const activeProfile = profilesQuery.data?.find((profile) => profile.id === profileId) ?? null
  const selectedUsername = selectedContact?.profileId === profileId && sameRoomId(selectedContact.filterRoomId, roomId ?? null)
    ? selectedContact.username
    : null
  const selectedConversationRoomId = selectedUsername !== null ? selectedContact?.roomId ?? null : null
  const activeTargetKey = profileId !== null && selectedUsername !== null ? targetKey(profileId, selectedConversationRoomId) : null

  const contactsQuery = useQuery({
    queryKey: ['chatContacts', profileId, roomId],
    queryFn: ({ signal }) => {
      if (profileId === null || roomId === undefined) throw new Error('Pilih profil dan room yang valid.')
      return chatsApi.contacts(profileId, signal, roomId ?? undefined)
        .then((contacts) => realtime.mergeContacts(profileId, contacts, roomId))
    },
    enabled: profileId !== null && roomId !== undefined,
  })

  const conversationQuery = useQuery({
    queryKey: ['conversation', profileId, selectedConversationRoomId, selectedUsername],
    queryFn: async ({ signal }) => {
      if (profileId === null || selectedUsername === null || roomId === undefined) throw new Error('Pilih profil dan kontak terlebih dahulu.')
      const readMessagesRequest = chatsApi.conversation(profileId, selectedUsername, signal, selectedConversationRoomId ?? undefined)
      const messagesRequest = selectedConversationRoomId === null
        ? readMessagesRequest
        : chatsApi.list(signal, selectedConversationRoomId).then((messages) =>
          messages.filter((message) => message.profile_id === profileId
            && message.room_id !== null && sameRoomId(message.room_id, selectedConversationRoomId)),
        )
      const [messages, readMessages] = await Promise.all([messagesRequest, readMessagesRequest])
      if (!signal.aborted) {
        realtime.markConversationRead(profileId, selectedUsername, readMessages, selectedConversationRoomId)
      }
      return realtime.mergeConversation(profileId, selectedUsername, messages, selectedConversationRoomId)
    },
    enabled: profileId !== null && selectedUsername !== null && roomId !== undefined,
  })

  useEffect(() => {
    if (!conversationQuery.isSuccess || !conversationQuery.isFetchedAfterMount || profileId === null || selectedUsername === null || roomId === undefined) return
    const syncKey = targetKey(profileId, selectedConversationRoomId)
    if (!conversationQuery.dataUpdatedAt || (lastSynced.current?.key === syncKey
      && lastSynced.current.dataUpdatedAt === conversationQuery.dataUpdatedAt
      && lastSynced.current.data === conversationQuery.data)) return
    lastSynced.current = { key: syncKey, dataUpdatedAt: conversationQuery.dataUpdatedAt, data: conversationQuery.data }
    realtime.markConversationRead(profileId, selectedUsername, conversationQuery.data, roomId)
    const latestChat = conversationQuery.data.at(-1)
    if (latestChat) {
      queryClient.setQueryData<ChatContact[]>(['chatContacts', profileId, roomId], (contacts) =>
        contacts?.map((contact) => contact.username === selectedUsername
          ? { ...contact, last_chat: latestChat }
          : contact),
      )
    }
    void queryClient.invalidateQueries({ queryKey: ['chatContacts', profileId, roomId] })
  }, [conversationQuery.data, conversationQuery.dataUpdatedAt, conversationQuery.isFetchedAfterMount, conversationQuery.isSuccess, profileId, queryClient, realtime, roomId, roomInput, selectedConversationRoomId, selectedUsername])

  const contacts = profileId !== null && roomId !== undefined
    ? realtime.mergeContacts(profileId, contactsQuery.data ?? [], roomId)
    : []
  const filteredContacts = useMemo(() => contacts.filter((contact) =>
    `${contact.username} ${contact.global_name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  ), [contacts, search])
  const conversationMessages = profileId !== null && selectedUsername !== null && roomId !== undefined
    ? realtime.mergeConversation(profileId, selectedUsername, conversationQuery.data ?? [], selectedConversationRoomId)
    : []
  const selectedTarget = replyTarget?.key === activeTargetKey
    ? conversationMessages.find((message): message is Chat => !('local' in message) && message.id === replyTarget.chat.id) ?? null
    : null
  const defaultReplyTarget = [...conversationMessages].reverse().find((message): message is Chat => !('local' in message)) ?? null
  const replyChat = selectedTarget ?? defaultReplyTarget
  const pendingOptimisticMessages = optimisticMessages.filter((message) => message.targetKey === activeTargetKey)
  const replyStatusCounts: Record<OptimisticDeliveryStatus, number> = {
    enqueuing: 0,
    queued: 0,
    processing: 0,
    sent: 0,
    failed: 0,
  }
  const activeOptimisticMessages = pendingOptimisticMessages.map((message, index) => {
    const task = message.taskId ? realtime.replyStatuses[message.taskId] : undefined
    const matchingTask = task && task.profile_id === message.profile_id && task.chat_id === message.targetChatId
      && (message.room_id === null || sameRoomId(task.room_id, message.room_id))
      ? task
      : undefined
    const taskStatus = matchingTask?.status ?? message.taskStatus
    const delivery = taskStatus === 'failed' ? 'failed' : message.delivery
    const replyStatus = delivery === 'failed' ? 'failed' : taskStatus ?? 'enqueuing'
    replyStatusCounts[replyStatus] += 1
    return {
      ...message,
      delivery,
      taskStatus,
      taskError: matchingTask?.status === 'failed' ? matchingTask.error : message.taskError,
      serverChatId: matchingTask?.status === 'sent' ? matchingTask.reply_chat_id ?? message.serverChatId : message.serverChatId,
      replyOrdinal: index + 1,
      replyTotal: pendingOptimisticMessages.length,
      replyStatusCounts,
    }
  })
  const reconciledServerIds = new Set(activeOptimisticMessages.flatMap((message) => message.serverChatId === undefined ? [] : [message.serverChatId]))
  const displayMessages: ConversationMessage[] = [
    ...conversationMessages.filter((message) => !reconciledServerIds.has(message.id)),
    ...activeOptimisticMessages,
  ]

  useEffect(() => {
    if (!activeTargetKey || !profileId || !selectedUsername || !conversationMessages.length) return
    const now = Date.now()
    const candidates = pendingOptimisticMessages.filter((optimistic) => optimistic.delivery !== 'failed' && optimistic.serverChatId === undefined)
    const possibleMatches = candidates.map((optimistic) => ({
      optimistic,
      echoes: conversationMessages.filter((message) => {
        if (!message.is_me || message.profile_id !== optimistic.profile_id
            || !sameRoomId(message.room_id, optimistic.room_id)
          || message.content !== optimistic.content) return false
        const serverTime = Date.parse(message.timestamp ?? message.created_at)
        return Number.isFinite(serverTime) && serverTime >= optimistic.submittedAt - 5_000
          && serverTime <= Math.max(now, optimistic.submittedAt) + 5 * 60_000
      }),
    }))
    const echoMatchCounts = new Map<number, number>()
    for (const { echoes } of possibleMatches) {
      for (const echo of echoes) echoMatchCounts.set(echo.id, (echoMatchCounts.get(echo.id) ?? 0) + 1)
    }
    const matched = new Map<OptimisticMessage['id'], number>()
    for (const { optimistic, echoes } of possibleMatches) {
      if (echoes.length === 1 && echoMatchCounts.get(echoes[0].id) === 1) matched.set(optimistic.id, echoes[0].id)
    }
    if (!matched.size) return
    setOptimisticMessages((current) => current.map((message) => matched.has(message.id)
      ? { ...message, serverChatId: matched.get(message.id) }
      : message))
  }, [activeTargetKey, conversationMessages, pendingOptimisticMessages, profileId, realtime.liveVersion, selectedUsername])

  const replyMutation = useMutation({
    mutationFn: ({ targetChatId, body }: ReplyVariables) => chatsApi.reply(targetChatId, body),
    onSuccess: (result, variables) => {
      realtime.registerReplyTask(result.data.task_id, variables.profileId, variables.targetChatId, variables.roomId)
      setOptimisticMessages((current) => current.map((message) => message.id === variables.optimisticId
        ? { ...message, delivery: 'enqueuing', taskStatus: 'queued', taskId: result.data.task_id, failureMessage: undefined, taskError: null }
        : message))
    },
    onError: (error, variables) => {
      setOptimisticMessages((current) => current.map((message) => message.id === variables.optimisticId
          ? { ...message, delivery: 'failed', taskStatus: 'failed', failureMessage: error instanceof Error ? error.message : 'Balasan gagal dikirim.' }
        : message))
    },
  })

  const sendOptimistic = (message: OptimisticMessage) => {
    replyMutation.mutate({
      optimisticId: message.id,
      targetChatId: message.targetChatId,
      body: message.request,
      key: message.targetKey,
      profileId: message.profile_id,
      roomId: message.room_id,
    })
  }

  const submitReply = (body: ChatReplyRequest) => {
    if (!activeTargetKey || profileId === null || !selectedUsername || !replyChat) return
    const submittedAt = Date.now()
    const optimistic: OptimisticMessage = {
      id: `optimistic-${++optimisticSequence}`,
      targetKey: activeTargetKey,
      room_id: replyChat.room_id,
      profile_id: profileId,
      global_name: contacts.find((contact) => contact.username === selectedUsername)?.global_name || selectedUsername,
      username: selectedUsername,
      is_me: true,
      content: body.reply,
      status: null,
      timestamp: new Date(submittedAt).toISOString(),
      created_at: new Date(submittedAt).toISOString(),
      updated_at: null,
      local: true,
      delivery: 'enqueuing',
      submittedAt,
      request: body,
      targetChatId: replyChat.id,
      replyOrdinal: 1,
      replyTotal: 1,
      replyStatusCounts: { enqueuing: 1, queued: 0, processing: 0, sent: 0, failed: 0 },
    }
    setOptimisticMessages((current) => [...current, optimistic])
    sendOptimistic(optimistic)
  }

  const retryReply = (message: OptimisticMessage) => {
    const retry = { ...message, delivery: 'enqueuing' as const, taskStatus: undefined, taskId: undefined, taskError: null, failureMessage: undefined, serverChatId: undefined, submittedAt: Date.now() }
    setOptimisticMessages((current) => current.map((item) => item.id === message.id ? retry : item))
    sendOptimistic(retry)
  }
  const notificationAction = realtime.notificationPermission === 'granted'
    ? null
    : <Btn onClick={() => { void realtime.requestBrowserNotifications() }}>Aktifkan notifikasi</Btn>

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHead title="Inbox" action={notificationAction} />

      <div className="mb-3 grid grid-cols-2 gap-2">
        <ProfileSelector profiles={profilesQuery.data ?? []} value={profileId}
          disabled={profilesQuery.isLoading || !profilesQuery.data?.length}
          onChange={(nextProfileId) => { setProfileId(nextProfileId); setSelectedContact(null); setReplyTarget(null); setTargetMode(false) }} />
        {/* <RoomSelector value={roomInput} onChange={(value) => { setRoomInput(value); setSelectedContact(null); setReplyTarget(null); setTargetMode(false) }} /> */}
      </div>
      {profilesQuery.isLoading && <div aria-busy className="mb-5 h-12 max-w-md animate-pulse rounded-lg bg-raised" />}
      {profilesQuery.isError && <Banner kind="error">{profilesQuery.error.message}</Banner>}
      {!profilesQuery.isLoading && !profilesQuery.isError && profilesQuery.data?.length === 0 && (
        <p className="mb-5 rounded-lg border border-dashed border-line p-6 text-sm text-muted">Belum ada profil untuk menampilkan inbox.</p>
      )}
      {roomId === undefined && <Banner kind="error">Room ID harus berupa bilangan bulat positif.</Banner>}
      {profileId === null && !profilesQuery.isLoading && !profilesQuery.isError && profilesQuery.data?.length ? (
        <p className="mb-3 text-sm text-muted">Pilih profil untuk memuat kontak.</p>
      ) : null}
      {activeProfile && (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <LiveStatusIndicator profile={activeProfile} connection={realtime.connectionStatus(activeProfile.id)} />
            <label title="Belum didukung backend" className="flex items-center gap-1 text-[10px] text-muted">
              <input type="checkbox" disabled checked={false} readOnly aria-label="Auto-Reply belum didukung backend" className="size-3" />
              Auto-Reply belum didukung
            </label>
          </div>
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(7rem,0.4fr)_minmax(0,1.6fr)] gap-2 sm:gap-3 lg:grid-cols-[minmax(14rem,0.7fr)_minmax(0,1.7fr)] lg:grid-rows-1">
            <section aria-label="Daftar kontak" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-surface ring-1 ring-line">
              <div className="shrink-0 border-b border-line p-3">
                <input className={`${inp} py-2`} aria-label="Cari kontak" placeholder="Cari kontak…"
                  value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              {contactsQuery.isLoading && <div aria-busy className="space-y-2 p-3">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-md bg-raised" />)}</div>}
              {contactsQuery.isError && <div className="p-3"><Banner kind="error">{contactsQuery.error.message}</Banner></div>}
              {contactsQuery.isSuccess && contacts.length > 0 && filteredContacts.length === 0 && <p className="p-6 text-center text-sm text-muted">Tidak ada kontak yang cocok dengan pencarian.</p>}
              {contactsQuery.isSuccess && <ChatContactList contacts={filteredContacts}
                selectedRoomId={selectedUsername !== null ? selectedConversationRoomId : undefined}
                profileId={activeProfile.id} roomId={roomId ?? null} realtime={realtime}
                onSelect={(contact) => {
                  setSelectedContact({
                    profileId: activeProfile.id,
                    roomId: contact.last_chat.room_id,
                    filterRoomId: roomId ?? null,
                    username: contact.username,
                  })
                  setReplyTarget(null)
                  setTargetMode(false)
                }} />}
            </section>
            <ChatConversation username={selectedUsername} messages={displayMessages}
              loading={!!selectedUsername && conversationQuery.isLoading}
              refreshing={conversationQuery.isFetching}
              error={selectedUsername && conversationQuery.isError ? conversationQuery.error.message : undefined}
              targetMode={targetMode}
              selectedTargetId={selectedTarget?.id ?? null}
              onToggleTargetMode={() => {
                if (targetMode || selectedTarget) {
                  setTargetMode(false)
                  setReplyTarget(null)
                } else setTargetMode(true)
              }}
              onSelectTarget={(chat) => {
                if (!activeTargetKey) return
                setReplyTarget({ key: activeTargetKey, chat })
                setTargetMode(false)
              }}
              onRefresh={() => { void conversationQuery.refetch() }}
              onRetry={retryReply}
              replyComposer={selectedUsername && !conversationQuery.isError ? (
                <ReplyComposer key={activeTargetKey ?? 'no-target'} canReply={replyChat !== null}
                  pending={replyMutation.isPending} specifiedReply={selectedTarget !== null}
                  selectedTarget={selectedTarget} onClearTarget={() => setReplyTarget(null)} onSubmit={submitReply} />
              ) : null} />
          </div>
        </>
      )}
    </div>
  )
}
