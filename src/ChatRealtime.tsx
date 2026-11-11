import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { chatWebSocketUrl, chatsApi, parseApiJson } from './api'
import { useProfiles } from './hooks'
import { type Chat, type ChatConnectedEvent, type ChatContact, type ChatMessageCreatedEvent, type ChatReplyStatusEvent, type ChatRoomId, type Profile, type ReplyTaskStatus, type ReplyTaskStatusData } from './types'
import { toast } from './ui'

type ConversationUnread = Record<string, number[]>
type SocketEntry = {
  socket: WebSocket | null
  timer: ReturnType<typeof setTimeout> | null
  attempts: number
  notified: boolean
}
export type ChatConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
type ChatRealtimeValue = {
  hasUnread: (profileId: number, username: string, roomId?: ChatRoomId | null) => boolean
  hasAnyUnread: boolean
  unreadCount: (profileId: number, username: string, roomId?: ChatRoomId | null) => number
  liveVersion: number
  connectionStatus: (profileId: number) => ChatConnectionStatus
  notificationPermission: NotificationPermission | 'unsupported'
  requestBrowserNotifications: () => Promise<void>
  markConversationRead: (profileId: number, username: string, chats: Chat[], roomId?: ChatRoomId | null) => void
  mergeContacts: (profileId: number, contacts: ChatContact[], roomId?: ChatRoomId | null) => ChatContact[]
  mergeConversation: (profileId: number, username: string, chats: Chat[], roomId?: ChatRoomId | null) => Chat[]
  replyStatuses: Record<string, ReplyTaskStatusData>
  registerReplyTask: (taskId: string, profileId: number, chatId: number, roomId: ChatRoomId | null) => void
}
type ReplyTaskRegistration = { profileId: number; chatId: number; roomId: ChatRoomId | null }

const ChatRealtimeContext = createContext<ChatRealtimeValue | null>(null)
const sameRoomId = (left: ChatRoomId | null, right: ChatRoomId | null) => left === right
const conversationKey = (profileId: number, username: string, roomId: ChatRoomId | null = null) => JSON.stringify([profileId, username, roomId])
const keyMatchesTarget = (key: string, profileId: number, username: string, roomId: ChatRoomId | null) => {
  const [id, name, messageRoomId] = JSON.parse(key) as [number, string, ChatRoomId | null]
  return id === profileId && name === username && (roomId === null || sameRoomId(roomId, messageRoomId))
}
const sentAt = (chat: Chat) => Date.parse(chat.timestamp ?? chat.created_at) || 0
const isLater = (chat: Chat, other: Chat) => sentAt(chat) > sentAt(other) || (sentAt(chat) === sentAt(other) && chat.id >= other.id)
const mergeLiveContacts = (profileId: number, contacts: ChatContact[], liveChats: Map<string, Map<number, Chat>>, restLatest: Map<string, Chat>, roomId: ChatRoomId | null = null) => {
  const merged = new Map(contacts.map((contact) => [contact.username, contact]))
  const latestByContact = new Map<string, Chat>()
  const contactsWithIncoming = new Set<string>()
  for (const [key, messages] of liveChats) {
    const [id, username, messageRoomId] = JSON.parse(key) as [number, string, ChatRoomId | null]
    if (id !== profileId || (roomId !== null && !sameRoomId(messageRoomId, roomId))) continue
    for (const chat of messages.values()) {
      if (!chat.is_me) contactsWithIncoming.add(username)
      const current = latestByContact.get(username)
      if (!current || isLater(chat, current)) latestByContact.set(username, chat)
    }
  }
  for (const [key, chat] of restLatest) {
    const [id, username, messageRoomId] = JSON.parse(key) as [number, string, ChatRoomId | null]
    if (id !== profileId || (roomId !== null && !sameRoomId(messageRoomId, roomId))) continue
    const current = latestByContact.get(username)
    if (!current || isLater(chat, current)) latestByContact.set(username, chat)
  }
  for (const [username, latest] of latestByContact) {
    const existing = merged.get(username)
    if (!existing && latest.is_me && !contactsWithIncoming.has(username)) continue
    if (!existing || isLater(latest, existing.last_chat)) {
      merged.set(username, { username, global_name: latest.global_name || existing?.global_name || username, last_chat: latest })
    }
  }
  return Array.from(merged.values()).sort((a, b) => sentAt(b.last_chat) - sentAt(a.last_chat) || b.last_chat.id - a.last_chat.id)
}
const isChat = (value: unknown): value is Chat => {
  if (!value || typeof value !== 'object') return false
  const chat = value as Partial<Chat>
  return Number.isSafeInteger(chat.id)
    && (chat.room_id === null
      || (typeof chat.room_id === 'number' && Number.isSafeInteger(chat.room_id) && chat.room_id > 0)
      || (typeof chat.room_id === 'string' && /^[1-9]\d*$/.test(chat.room_id)))
    && (chat.profile_id === null || Number.isSafeInteger(chat.profile_id))
    && typeof chat.global_name === 'string'
    && typeof chat.username === 'string'
    && typeof chat.is_me === 'boolean'
    && (chat.content === null || typeof chat.content === 'string')
    && (chat.status === null || chat.status === 'read' || chat.status === 'unread')
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
    && Number.isSafeInteger(event.profile_id)
    && isChat(event.data)
}
const isReplyTaskStatus = (value: unknown): value is ReplyTaskStatus =>
  value === 'queued' || value === 'processing' || value === 'sent' || value === 'failed'
const isReplyTaskStatusData = (value: unknown): value is ReplyTaskStatusData => {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<ReplyTaskStatusData>
  return typeof task.task_id === 'string'
    && Number.isSafeInteger(task.chat_id)
    && Number.isSafeInteger(task.profile_id)
    && ((typeof task.room_id === 'number' && Number.isSafeInteger(task.room_id) && task.room_id > 0)
      || (typeof task.room_id === 'string' && /^[1-9]\d*$/.test(task.room_id)))
    && isReplyTaskStatus(task.status)
    && (task.error === null || typeof task.error === 'string')
    && (task.reply_chat_id === null || Number.isSafeInteger(task.reply_chat_id))
    && typeof task.created_at === 'string'
    && (task.updated_at === null || typeof task.updated_at === 'string')
}
const isChatReplyStatusEvent = (value: unknown): value is ChatReplyStatusEvent => {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<ChatReplyStatusEvent>
  return event.type === 'chat.reply.status'
    && Number.isSafeInteger(event.profile_id)
    && isReplyTaskStatusData(event.data)
}
const replyStatusRank: Record<ReplyTaskStatus, number> = {
  queued: 0,
  processing: 1,
  sent: 2,
  failed: 2,
}

export function ChatRealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const profilesQuery = useProfiles()
  const [unread, setUnread] = useState<ConversationUnread>({})
  const [liveVersion, setLiveVersion] = useState(0)
  const [connectionStatuses, setConnectionStatuses] = useState<Record<number, ChatConnectionStatus>>({})
  const [replyStatuses, setReplyStatuses] = useState<Record<string, ReplyTaskStatusData>>({})
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const unreadRef = useRef<ConversationUnread>({})
  const sockets = useRef(new Map<number, SocketEntry>())
  const desiredProfiles = useRef(new Map<number, Profile>())
  const seenIds = useRef(new Set<number>())
  const revision = useRef(0)
  const syncSequence = useRef(0)
  const syncAbort = useRef<AbortController | null>(null)
  const readAt = useRef(new Map<string, number>())
  const liveUnread = useRef(new Map<string, Map<number, { chat: Chat; revision: number }>>())
  const liveChats = useRef(new Map<string, Map<number, Chat>>())
  const restLatest = useRef(new Map<string, Chat>())
  const profilesById = useRef(new Map<number, Profile>())
  const replyStatusesRef = useRef<Record<string, ReplyTaskStatusData>>({})
  const replyTasks = useRef(new Map<string, ReplyTaskRegistration>())
  const replyStatusRequests = useRef(new Map<string, AbortController>())

  const publishUnread = useCallback((next: ConversationUnread) => {
    unreadRef.current = next
    setUnread(next)
  }, [])
  const publishConnectionStatus = useCallback((profileId: number, status: ChatConnectionStatus) => {
    setConnectionStatuses((current) => current[profileId] === status ? current : { ...current, [profileId]: status })
  }, [])
  const publishReplyStatus = useCallback((status: ReplyTaskStatusData) => {
    const current = replyStatusesRef.current[status.task_id]
    if (current && (replyStatusRank[current.status] > replyStatusRank[status.status]
      || (replyStatusRank[current.status] === 2 && replyStatusRank[status.status] === 2)
      || (current.status === 'processing' && status.status === 'queued'))) return
    const next = { ...replyStatusesRef.current, [status.task_id]: status }
    replyStatusesRef.current = next
    setReplyStatuses(next)
  }, [])
  const recoverReplyTask = useCallback((taskId: string, registration: ReplyTaskRegistration) => {
    if (replyStatusRequests.current.has(taskId)) return
    const current = replyStatusesRef.current[taskId]
    if (current && replyStatusRank[current.status] === 2) return
    const controller = new AbortController()
    replyStatusRequests.current.set(taskId, controller)
    void chatsApi.replyStatus(taskId, controller.signal).then((status) => {
      if (controller.signal.aborted || replyTasks.current.get(taskId) !== registration) return
      if (status.profile_id !== registration.profileId || status.chat_id !== registration.chatId
        || (registration.roomId !== null && !sameRoomId(status.room_id, registration.roomId))) return
      publishReplyStatus(status)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        toast('warn', error instanceof Error ? `Status balasan belum dapat diperbarui: ${error.message}` : 'Status balasan belum dapat diperbarui.')
      }
    }).finally(() => {
      if (replyStatusRequests.current.get(taskId) === controller) replyStatusRequests.current.delete(taskId)
    })
  }, [publishReplyStatus])
  const recoverReplyTasks = useCallback((profileId: number) => {
    for (const [taskId, registration] of replyTasks.current) {
      if (registration.profileId === profileId) recoverReplyTask(taskId, registration)
    }
  }, [recoverReplyTask])
  const registerReplyTask = useCallback((taskId: string, profileId: number, chatId: number, roomId: ChatRoomId | null) => {
    const registration = { profileId, chatId, roomId }
    replyTasks.current.set(taskId, registration)
    const current = replyStatusesRef.current[taskId]
    if (current && (current.profile_id !== profileId || current.chat_id !== chatId
      || (roomId !== null && !sameRoomId(current.room_id, roomId)))) return
    if (connectionStatuses[profileId] === 'connected') recoverReplyTask(taskId, registration)
  }, [connectionStatuses, recoverReplyTask])

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
        seenIds.current.add(chat.id)
        if (chat.profile_id === null) continue
        const key = conversationKey(chat.profile_id, chat.username, chat.room_id)
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
        for (const query of queryClient.getQueryCache().findAll({ queryKey: ['chatContacts', profileId] })) {
          if (query.state.data === undefined) continue
          const roomId = typeof query.queryKey[2] === 'number' ? query.queryKey[2] : null
          queryClient.setQueryData<ChatContact[]>(query.queryKey, (contacts) =>
            mergeLiveContacts(profileId, contacts ?? [], liveChats.current, restLatest.current, roomId),
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

  const mergeConversation = useCallback((profileId: number, username: string, chats: Chat[], roomId: ChatRoomId | null = null) => {
    const combined = [...chats]
    const ids = new Set(chats.map((chat) => chat.id))
    for (const [key, live] of liveChats.current) {
      const [messageProfileId, messageUsername, messageRoomId] = JSON.parse(key) as [number, string, ChatRoomId | null]
      const matchesConversation = messageProfileId === profileId && (roomId === null
        ? messageUsername === username
        : sameRoomId(roomId, messageRoomId))
      if (!matchesConversation) continue
      for (const [id, chat] of live) {
        if (!ids.has(id)) {
          combined.push(chat)
          ids.add(id)
        }
      }
    }
    return combined.sort((left, right) => sentAt(left) - sentAt(right) || left.id - right.id)
  }, [])

  const mergeContacts = useCallback((profileId: number, contacts: ChatContact[], roomId: ChatRoomId | null = null) => {
    return mergeLiveContacts(profileId, contacts, liveChats.current, restLatest.current, roomId)
  }, [])

  const markConversationRead = useCallback((profileId: number, username: string, chats: Chat[], roomId: ChatRoomId | null = null) => {
    const readIds = new Set(chats.filter((chat) => chat.status !== 'unread').map((chat) => chat.id))
    const readRevision = ++revision.current
    const next = { ...unreadRef.current }
    const knownKeys = new Set([
      ...Object.keys(next),
      ...liveUnread.current.keys(),
      ...liveChats.current.keys(),
      ...restLatest.current.keys(),
      ...chats.map((chat) => conversationKey(profileId, username, chat.room_id)),
    ])
    for (const key of knownKeys) {
      if (!keyMatchesTarget(key, profileId, username, roomId)) continue
      readAt.current.set(key, readRevision)
      const pending = liveUnread.current.get(key)
      if (pending) {
        for (const id of readIds) pending.delete(id)
        for (const [id, event] of pending) pending.set(id, { ...event, revision: ++revision.current })
        if (!pending.size) liveUnread.current.delete(key)
      }
      const remaining = (next[key] ?? []).filter((id) => !readIds.has(id))
      if (remaining.length) next[key] = remaining
      else delete next[key]
      const live = liveChats.current.get(key)
      if (live) {
        for (const id of readIds) {
          const chat = live.get(id)
          if (chat) live.set(id, { ...chat, status: 'read' })
        }
      }
      for (const [latestKey, chat] of restLatest.current) {
        if (latestKey === key && readIds.has(chat.id)) restLatest.current.set(latestKey, { ...chat, status: 'read' })
      }
    }
    publishUnread(next)
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
      sockets.current.delete(profileId)
      publishConnectionStatus(profileId, 'disconnected')
    }

    const connect = (profileId: number) => {
      if (!desiredProfiles.current.has(profileId) || sockets.current.has(profileId)) return
      const entry: SocketEntry = { socket: null, timer: null, attempts: 0, notified: false }
      sockets.current.set(profileId, entry)
      publishConnectionStatus(profileId, 'connecting')
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
            message = parseApiJson(String(event.data))
          } catch {
            console.warn(`Malformed chat WebSocket JSON for profile ${profileId}`)
            return
          }
          if (isChatConnectedEvent(message)) {
            if (message.profile_id !== profileId) {
              console.warn(`Unexpected chat.connected profile for socket ${profileId}`)
              return
            }
            publishConnectionStatus(profileId, 'connected')
            recoverReplyTasks(profileId)
            return
          }
          if (isChatReplyStatusEvent(message)) {
            if (message.profile_id !== profileId || message.data.profile_id !== profileId) return
            const registration = replyTasks.current.get(message.data.task_id)
            if (registration && (registration.profileId !== profileId || registration.chatId !== message.data.chat_id
              || (registration.roomId !== null && !sameRoomId(registration.roomId, message.data.room_id)))) return
            publishReplyStatus(message.data)
            return
          }
          if (!isChatMessageCreatedEvent(message)) {
            if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'chat.message.created') {
              console.warn(`Malformed chat.message.created event for profile ${profileId}`)
            }
            if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'chat.reply.status') {
              console.warn(`Malformed chat.reply.status event for profile ${profileId}`)
            }
            return
          }
          if (message.profile_id !== profileId || message.data.profile_id !== profileId) return
          const chat = message.data
          if (seenIds.current.has(chat.id)) return
          seenIds.current.add(chat.id)

          const key = conversationKey(profileId, chat.username, chat.room_id)
          const eventRevision = ++revision.current
          const conversationMessages = liveChats.current.get(key) ?? new Map<number, Chat>()
          conversationMessages.set(chat.id, chat)
          liveChats.current.set(key, conversationMessages)
          setLiveVersion((version) => version + 1)
          if (!chat.is_me && chat.status === 'unread') {
            const unreadMessages = liveUnread.current.get(key) ?? new Map<number, { chat: Chat; revision: number }>()
            unreadMessages.set(chat.id, { chat, revision: eventRevision })
            liveUnread.current.set(key, unreadMessages)
            const next = { ...unreadRef.current, [key]: Array.from(unreadMessages.keys()) }
            publishUnread(next)
          }

          for (const query of queryClient.getQueryCache().findAll({ queryKey: ['chatContacts', profileId] })) {
            if (query.state.data === undefined) continue
            const roomId = typeof query.queryKey[2] === 'number' ? query.queryKey[2] : null
            queryClient.setQueryData<ChatContact[]>(query.queryKey, (contacts) =>
              mergeContacts(profileId, contacts ?? [], roomId),
            )
          }
          if (!chat.is_me) {
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
          publishConnectionStatus(profileId, 'reconnecting')
          socket.close()
        }
        socket.onclose = () => {
          if (sockets.current.get(profileId) !== entry || !desiredProfiles.current.has(profileId)) return
          entry.socket = null
          publishConnectionStatus(profileId, 'reconnecting')
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
        publishConnectionStatus(id, 'reconnecting')
      }
      open()
    }

    for (const profileId of desired.keys()) connect(profileId)
  }, [mergeContacts, mergeConversation, notifyOutsideApp, profilesQuery.data, publishConnectionStatus, publishReplyStatus, publishUnread, queryClient, recoverReplyTasks, syncUnread])

  useEffect(() => {
    void syncUnread()
  }, [syncUnread])

  useEffect(() => () => {
    desiredProfiles.current.clear()
    syncSequence.current += 1
    syncAbort.current?.abort()
    for (const controller of replyStatusRequests.current.values()) controller.abort()
    replyStatusRequests.current.clear()
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
    hasUnread: (profileId, username, roomId = null) => Object.entries(unread)
      .some(([key, ids]) => ids.length > 0 && keyMatchesTarget(key, profileId, username, roomId)),
    hasAnyUnread: Object.values(unread).some((ids) => ids.length > 0),
    unreadCount: (profileId, username, roomId = null) => Object.entries(unread)
      .filter(([key]) => keyMatchesTarget(key, profileId, username, roomId))
      .reduce((count, [, ids]) => count + ids.length, 0),
    liveVersion,
    connectionStatus: (profileId) => connectionStatuses[profileId] ?? 'disconnected',
    notificationPermission,
    requestBrowserNotifications,
    markConversationRead,
    mergeContacts,
    mergeConversation,
    replyStatuses,
    registerReplyTask,
  }), [connectionStatuses, liveVersion, markConversationRead, mergeContacts, mergeConversation, notificationPermission, registerReplyTask, replyStatuses, requestBrowserNotifications, unread])

  return <ChatRealtimeContext.Provider value={value}>{children}</ChatRealtimeContext.Provider>
}

export function useChatRealtime() {
  const value = useContext(ChatRealtimeContext)
  if (!value) throw new Error('useChatRealtime harus digunakan di dalam ChatRealtimeProvider.')
  return value
}
