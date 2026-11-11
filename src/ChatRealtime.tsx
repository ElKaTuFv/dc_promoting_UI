import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { chatWebSocketUrl, chatsApi } from './api'
import { useProfiles } from './hooks'
import type { Chat, ChatConnectedEvent, ChatContact, ChatMessageCreatedEvent, ChatMessageUpdatedEvent, Profile, RoomId } from './types'
import { toast } from './ui'

type ConversationUnread = Record<string, number[]>
type SocketEntry = {
  socket: WebSocket | null
  timer: ReturnType<typeof setTimeout> | null
  attempts: number
  notified: boolean
}
type ChatRealtimeValue = {
  hasUnread: (profileId: number, roomId: RoomId) => boolean
  hasAnyUnread: boolean
  unreadCount: (profileId: number, roomId: RoomId) => number
  liveVersion: number
  notificationPermission: NotificationPermission | 'unsupported'
  requestBrowserNotifications: () => Promise<void>
  markConversationRead: (profileId: number, roomId: RoomId, chats: Chat[]) => void
  mergeContacts: (profileId: number, contacts: ChatContact[]) => ChatContact[]
  mergeConversation: (profileId: number, roomId: RoomId, chats: Chat[]) => Chat[]
}

const ChatRealtimeContext = createContext<ChatRealtimeValue | null>(null)
const conversationKey = (profileId: number, roomId: RoomId) => JSON.stringify([profileId, roomId])
const roomKey = (roomId: RoomId) => roomId
const sentAt = (chat: Chat) => Date.parse(chat.timestamp ?? chat.created_at) || 0
const isLater = (chat: Chat, other: Chat) => sentAt(chat) > sentAt(other) || (sentAt(chat) === sentAt(other) && chat.id >= other.id)
const preferLatestRecord = (candidate: Chat, current: Chat) => {
  const candidateUpdatedAt = Date.parse(candidate.updated_at ?? '') || 0
  const currentUpdatedAt = Date.parse(current.updated_at ?? '') || 0
  return candidateUpdatedAt >= currentUpdatedAt
}
const mergeLiveContacts = (profileId: number, contacts: ChatContact[], liveChats: Map<string, Map<number, Chat>>, restLatest: Map<string, Chat>) => {
  const merged = new Map(contacts.flatMap((contact) => contact.room_id === null ? [] : [[roomKey(contact.room_id), contact] as const]))
  const latestByRoom = new Map<string, Chat>()
  const contactsWithIncoming = new Set<string>()
  for (const [key, messages] of liveChats) {
    const [id, roomId] = JSON.parse(key) as [number, RoomId]
    if (id !== profileId) continue
    for (const chat of messages.values()) {
      if (chat.room_id == null) continue
      const keyForRoom = roomKey(roomId)
      if (!chat.is_me) contactsWithIncoming.add(keyForRoom)
      const current = latestByRoom.get(keyForRoom)
      if (!current || isLater(chat, current)) latestByRoom.set(keyForRoom, chat)
    }
  }
  for (const [key, chat] of restLatest) {
    const [id, roomId] = JSON.parse(key) as [number, RoomId]
    if (id !== profileId) continue
    if (chat.room_id == null) continue
    const keyForRoom = roomKey(roomId)
    const current = latestByRoom.get(keyForRoom)
    if (!current || isLater(chat, current)) latestByRoom.set(keyForRoom, chat)
  }
  for (const [keyForRoom, latest] of latestByRoom) {
    const existing = merged.get(keyForRoom)
    if (!existing && latest.is_me && !contactsWithIncoming.has(keyForRoom)) continue
    if (latest.room_id == null) continue
    if (!existing || isLater(latest, existing.last_chat)) {
      merged.set(keyForRoom, {
        global_name: existing?.global_name || latest.global_name,
        username: existing?.username || latest.username,
        room_id: latest.room_id,
        last_chat: latest,
      })
    }
  }
  return Array.from(merged.values()).sort((a, b) => sentAt(b.last_chat) - sentAt(a.last_chat) || b.last_chat.id - a.last_chat.id)
}
const isChat = (value: unknown): value is Chat => {
  if (!value || typeof value !== 'object') return false
  const chat = value as Partial<Chat>
  return Number.isSafeInteger(chat.id)
    && (chat.profile_id === null || Number.isSafeInteger(chat.profile_id))
    && typeof chat.global_name === 'string'
    && typeof chat.username === 'string'
    && typeof chat.is_me === 'boolean'
    && (chat.content === null || typeof chat.content === 'string')
    && (chat.room_id === null || typeof chat.room_id === 'string')
    && (chat.status === null || (typeof chat.status === 'string' && ['read', 'unread', 'queued', 'processing', 'sent', 'failed'].includes(chat.status)))
    && (chat.timestamp === null || typeof chat.timestamp === 'string')
    && typeof chat.created_at === 'string'
    && (chat.updated_at === null || typeof chat.updated_at === 'string')
}
const isChatConnectedEvent = (value: unknown): value is ChatConnectedEvent =>
  !!value && typeof value === 'object'
  && (value as Partial<ChatConnectedEvent>).type === 'chat.connected'
  && Number.isSafeInteger((value as Partial<ChatConnectedEvent>).profile_id)
const isChatMessageCreatedEvent = (value: unknown): value is ChatMessageCreatedEvent => {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<ChatMessageCreatedEvent>
  return event.type === 'chat.message.created'
    && (event.profile_id === undefined || Number.isSafeInteger(event.profile_id))
    && isChat(event.data)
}
const isChatMessageUpdatedEvent = (value: unknown): value is ChatMessageUpdatedEvent => {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<ChatMessageUpdatedEvent>
  return event.type === 'chat.message.updated'
    && (event.profile_id === undefined || Number.isSafeInteger(event.profile_id))
    && isChat(event.data)
}
const upsertChat = (chats: Chat[], chat: Chat) => {
  const index = chats.findIndex((item) => item.id === chat.id)
  const next = index < 0 ? [...chats, chat] : chats.map((item) => item.id === chat.id ? chat : item)
  return next.sort((a, b) => sentAt(a) - sentAt(b) || a.id - b.id)
}

export function ChatRealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const profilesQuery = useProfiles()
  const [unread, setUnread] = useState<ConversationUnread>({})
  const [liveVersion, setLiveVersion] = useState(0)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const unreadRef = useRef<ConversationUnread>({})
  const sockets = useRef(new Map<number, SocketEntry>())
  const desiredProfiles = useRef(new Map<number, Profile>())
  const connectedProfiles = useRef(new Set<number>())
  const createdEventIds = useRef(new Set<string>())
  const revision = useRef(0)
  const syncSequence = useRef(0)
  const syncAbort = useRef<AbortController | null>(null)
  const readAt = useRef(new Map<string, number>())
  const liveUnread = useRef(new Map<string, Map<number, { chat: Chat; revision: number }>>())
  const liveChats = useRef(new Map<string, Map<number, Chat>>())
  const restLatest = useRef(new Map<string, Chat>())
  const profilesById = useRef(new Map<number, Profile>())

  const publishUnread = useCallback((next: ConversationUnread) => {
    unreadRef.current = next
    setUnread(next)
  }, [])

  const requestBrowserNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setNotificationPermission('unsupported')
      return
    }
    if (Notification.permission === 'granted') {
      setNotificationPermission('granted')
      return
    }
    if (Notification.permission === 'denied') {
      setNotificationPermission('denied')
      return
    }
    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)
    } catch (error) {
      toast('error', error instanceof Error ? `Izin notifikasi tidak dapat diminta: ${error.message}` : 'Izin notifikasi tidak dapat diminta.')
    }
  }, [])

  const notifyOutsideApp = useCallback((profileName: string, chat: Chat) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
    try {
      const notification = new Notification(`${profileName} · ${chat.global_name || chat.username}`, {
        body: chat.content?.trim() || 'Pesan tanpa teks',
        icon: '/logo.svg',
        tag: `chat-${chat.profile_id}-${chat.id}`,
      })
      notification.onclick = () => {
        window.focus()
        window.location.hash = '#chats'
        notification.close()
      }
    } catch (error) {
      console.warn('Browser notification could not be displayed', error)
    }
  }, [])

  const syncUnread = useCallback(async () => {
    const sequence = ++syncSequence.current
    const startedAt = revision.current
    syncAbort.current?.abort()
    const controller = new AbortController()
    syncAbort.current = controller
    try {
      const chats = await chatsApi.list(controller.signal)
      if (sequence !== syncSequence.current || controller.signal.aborted) return
      const next = new Map<string, Map<number, Chat>>()
      const latestFromRest = new Map<string, Chat>()
      for (const chat of chats) {
        if (!isChat(chat)) continue
        if (chat.profile_id === null || chat.room_id == null) continue
        const key = conversationKey(chat.profile_id, chat.room_id)
        const latest = latestFromRest.get(key)
        if (!latest || isLater(chat, latest)) latestFromRest.set(key, chat)
        if (chat.is_me || chat.status !== 'unread') continue
        const group = next.get(key) ?? new Map<number, Chat>()
        group.set(chat.id, chat)
        next.set(key, group)
      }

      for (const [key, readRevision] of readAt.current) {
        if (readRevision > startedAt) next.delete(key)
      }
      for (const [key, messages] of liveUnread.current) {
        const readRevision = readAt.current.get(key) ?? -1
        const group = next.get(key) ?? new Map<number, Chat>()
        for (const [id, event] of messages) {
          if (event.revision > startedAt && event.revision > readRevision) group.set(id, event.chat)
        }
        if (group.size) next.set(key, group)
      }

      restLatest.current = latestFromRest
      const snapshot: ConversationUnread = {}
      for (const [key, messages] of next) snapshot[key] = Array.from(messages.keys())
      publishUnread(snapshot)
      const profileIds = new Set([...latestFromRest.keys()].map((key) => JSON.parse(key)[0] as number))
      for (const profileId of profileIds) {
        if (queryClient.getQueryData<ChatContact[]>(['chatContacts', profileId])) {
          queryClient.setQueryData<ChatContact[]>(['chatContacts', profileId], (contacts) =>
            mergeLiveContacts(profileId, contacts ?? [], liveChats.current, restLatest.current),
          )
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return
      toast('error', error instanceof Error ? `Gagal menyinkronkan unread chat: ${error.message}` : 'Gagal menyinkronkan unread chat.')
    } finally {
      if (syncAbort.current === controller) syncAbort.current = null
    }
  }, [publishUnread, queryClient])

  const mergeConversation = useCallback((profileId: number, roomId: RoomId, chats: Chat[]) => {
    const key = conversationKey(profileId, roomId)
    let combined = [...chats]
    for (const [id, chat] of liveChats.current.get(key) ?? []) {
      const index = combined.findIndex((item) => item.id === id)
      if (index < 0) combined = [...combined, chat]
      else if (preferLatestRecord(chat, combined[index])) combined = combined.map((item) => item.id === id ? chat : item)
    }
    return combined.sort((a, b) => sentAt(a) - sentAt(b) || a.id - b.id)
  }, [])

  const mergeContacts = useCallback((profileId: number, contacts: ChatContact[]) => {
    return mergeLiveContacts(profileId, contacts, liveChats.current, restLatest.current)
  }, [])

  const markConversationRead = useCallback((profileId: number, roomId: RoomId, chats: Chat[]) => {
    const key = conversationKey(profileId, roomId)
    const readIds = new Set(chats.filter((chat) => !chat.is_me && chat.status === 'read').map((chat) => chat.id))
    const readRevision = ++revision.current
    readAt.current.set(key, readRevision)
    const pending = liveUnread.current.get(key)
    if (pending) {
      for (const id of readIds) pending.delete(id)
      for (const [id, event] of pending) pending.set(id, { ...event, revision: ++revision.current })
      if (!pending.size) liveUnread.current.delete(key)
    }
    const next = { ...unreadRef.current }
    const remaining = (next[key] ?? []).filter((id) => !readIds.has(id))
    if (remaining.length) next[key] = remaining
    else delete next[key]
    publishUnread(next)
    const live = liveChats.current.get(key)
    if (live) {
      for (const id of readIds) {
        const chat = live.get(id)
        if (chat) live.set(id, { ...chat, status: 'read' })
      }
    }
    for (const [id, chat] of restLatest.current) {
      if (id !== key || !readIds.has(chat.id)) continue
      restLatest.current.set(id, { ...chat, status: 'read' })
    }
  }, [publishUnread])

  useEffect(() => {
    if (!profilesQuery.data) return
    profilesById.current = new Map(profilesQuery.data.map((profile) => [profile.id, profile]))
    const desired = new Map(profilesQuery.data
      .filter((profile) => profile.listener_status === 'running')
      .map((profile) => [profile.id, profile]))
    desiredProfiles.current = desired

    for (const [profileId, entry] of sockets.current) {
      if (desired.has(profileId)) continue
      if (entry.timer) clearTimeout(entry.timer)
      if (entry.socket) {
        entry.socket.onopen = null
        entry.socket.onmessage = null
        entry.socket.onerror = null
        entry.socket.onclose = null
        entry.socket.close()
      }
      connectedProfiles.current.delete(profileId)
      sockets.current.delete(profileId)
    }

    const connect = (profileId: number) => {
      if (!desiredProfiles.current.has(profileId) || sockets.current.has(profileId)) return
      const entry: SocketEntry = { socket: null, timer: null, attempts: 0, notified: false }
      sockets.current.set(profileId, entry)
      const open = () => {
        if (sockets.current.get(profileId) !== entry || !desiredProfiles.current.has(profileId)) return
        let socket: WebSocket
        try {
          socket = new WebSocket(chatWebSocketUrl(profileId))
        } catch (error) {
          if (!entry.notified) {
            entry.notified = true
            toast('warn', `Koneksi chat profil ${desiredProfiles.current.get(profileId)?.name ?? profileId} gagal. Akan mencoba kembali.`)
          }
          scheduleReconnect(profileId, entry)
          return
        }
        entry.socket = socket
        socket.onopen = () => {
          if (sockets.current.get(profileId) !== entry || !desiredProfiles.current.has(profileId)) return
          entry.attempts = 0
          entry.notified = false
          void syncUnread()
        }
        socket.onmessage = (event) => {
          if (sockets.current.get(profileId) !== entry || !desiredProfiles.current.has(profileId)) return
          let message: unknown
          try {
            message = JSON.parse(String(event.data))
          } catch {
            console.warn(`Malformed chat WebSocket JSON for profile ${profileId}`)
            return
          }
          if (isChatConnectedEvent(message)) {
            if (message.profile_id !== profileId) console.warn(`Unexpected chat.connected profile for socket ${profileId}`)
            else {
              connectedProfiles.current.add(profileId)
              void queryClient.invalidateQueries({ queryKey: ['conversation', profileId] })
            }
            return
          }
          let chatEvent: ChatMessageCreatedEvent | ChatMessageUpdatedEvent | null = null
          if (isChatMessageCreatedEvent(message)) chatEvent = message
          else if (isChatMessageUpdatedEvent(message)) chatEvent = message
          if (!chatEvent) {
            if (message && typeof message === 'object' && ['chat.message.created', 'chat.message.updated'].includes(String((message as { type?: unknown }).type))) {
              console.warn(`Malformed chat WebSocket event for profile ${profileId}`)
            }
            return
          }
          if ((chatEvent.profile_id !== undefined && chatEvent.profile_id !== profileId)
            || (chatEvent.data.profile_id !== profileId)
            || chatEvent.data.room_id == null) return
          const created = chatEvent.type === 'chat.message.created'
          const chat = chatEvent.data
          const eventRoomId = chat.room_id
          if (eventRoomId == null) return
          const eventId = JSON.stringify([profileId, chat.id])
          const wasCreatedEventSeen = createdEventIds.current.has(eventId)
          if (created) createdEventIds.current.add(eventId)
          const updated = chatEvent.type === 'chat.message.updated'

          const key = conversationKey(profileId, eventRoomId)
          const eventRevision = ++revision.current
          const conversationMessages = liveChats.current.get(key) ?? new Map<number, Chat>()
          conversationMessages.set(chat.id, chat)
          liveChats.current.set(key, conversationMessages)
          queryClient.setQueryData<Chat[]>(['conversation', profileId, eventRoomId], (current) =>
            upsertChat(current ?? [], chat),
          )
          setLiveVersion((version) => version + 1)
          if (!chat.is_me && (created || updated)) {
            const unreadMessages = liveUnread.current.get(key) ?? new Map<number, { chat: Chat; revision: number }>()
            if (chat.status === 'unread') unreadMessages.set(chat.id, { chat, revision: eventRevision })
            else unreadMessages.delete(chat.id)
            if (unreadMessages.size) liveUnread.current.set(key, unreadMessages)
            else liveUnread.current.delete(key)
            const next = { ...unreadRef.current }
            const ids = new Set(next[key] ?? [])
            if (chat.status === 'unread') ids.add(chat.id)
            else ids.delete(chat.id)
            if (ids.size) next[key] = Array.from(ids)
            else delete next[key]
            publishUnread(next)
          }

          if (queryClient.getQueryData<ChatContact[]>(['chatContacts', profileId])) {
            queryClient.setQueryData<ChatContact[]>(['chatContacts', profileId], (contacts) =>
              mergeContacts(profileId, contacts ?? []),
            )
          }
          if (created && !chat.is_me && !wasCreatedEventSeen) {
            const profileName = profilesById.current.get(profileId)?.name ?? `Profil ${profileId}`
            const preview = chat.content?.trim() || 'Pesan tanpa teks'
            toast('success', `${profileName} · ${chat.global_name || chat.username}: ${preview.slice(0, 120)}`)
            notifyOutsideApp(profileName, chat)
          }
        }
        socket.onerror = () => {
          if (sockets.current.get(profileId) !== entry || !desiredProfiles.current.has(profileId)) return
          if (!entry.notified) {
            entry.notified = true
            toast('warn', `Koneksi chat profil ${desiredProfiles.current.get(profileId)?.name ?? profileId} terputus. Akan mencoba kembali.`)
          }
          socket.close()
        }
        socket.onclose = () => {
          if (sockets.current.get(profileId) !== entry || !desiredProfiles.current.has(profileId)) return
          connectedProfiles.current.delete(profileId)
          entry.socket = null
          scheduleReconnect(profileId, entry)
        }
      }
      const scheduleReconnect = (id: number, current: SocketEntry) => {
        if (sockets.current.get(id) !== current || !desiredProfiles.current.has(id) || current.timer) return
        const delay = Math.min(30_000, 1_000 * (2 ** current.attempts))
        current.attempts += 1
        current.timer = setTimeout(() => {
          current.timer = null
          if (sockets.current.get(id) !== current || !desiredProfiles.current.has(id)) return
          sockets.current.delete(id)
          connect(id)
        }, delay)
      }
      open()
    }

    for (const profileId of desired.keys()) connect(profileId)
  }, [mergeContacts, mergeConversation, notifyOutsideApp, profilesQuery.data, publishUnread, queryClient, syncUnread])

  useEffect(() => {
    void syncUnread()
  }, [syncUnread])

  useEffect(() => () => {
    desiredProfiles.current.clear()
    connectedProfiles.current.clear()
    syncSequence.current += 1
    syncAbort.current?.abort()
    for (const entry of sockets.current.values()) {
      if (entry.timer) clearTimeout(entry.timer)
      if (entry.socket) {
        entry.socket.onopen = null
        entry.socket.onmessage = null
        entry.socket.onerror = null
        entry.socket.onclose = null
        entry.socket.close()
      }
    }
    sockets.current.clear()
  }, [])

  const value = useMemo<ChatRealtimeValue>(() => ({
    hasUnread: (profileId, roomId) => !!unread[conversationKey(profileId, roomId)]?.length,
    hasAnyUnread: Object.values(unread).some((ids) => ids.length > 0),
    unreadCount: (profileId, roomId) => unread[conversationKey(profileId, roomId)]?.length ?? 0,
    liveVersion,
    notificationPermission,
    requestBrowserNotifications,
    markConversationRead,
    mergeContacts,
    mergeConversation,
  }), [liveVersion, markConversationRead, mergeContacts, mergeConversation, notificationPermission, requestBrowserNotifications, unread])

  return <ChatRealtimeContext.Provider value={value}>{children}</ChatRealtimeContext.Provider>
}

export function useChatRealtime() {
  const value = useContext(ChatRealtimeContext)
  if (!value) throw new Error('useChatRealtime harus digunakan di dalam ChatRealtimeProvider.')
  return value
}
