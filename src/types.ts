export type Envelope<T> = { status: 'success' | 'error' | 'cancelled'; message: string; data: T }
export type ChatReadStatus = 'read' | 'unread'
export type ChatStatus = ChatReadStatus | null
export type ChatRoomId = number | string
export interface ChatCreateRequest {
  room_id?: ChatRoomId | null
  profile_id?: number | null
  global_name: string
  username: string
  is_me: boolean
  content?: string | null
  status?: ChatStatus
  timestamp?: string | null
}
export type ChatUpdateRequest = Partial<Omit<ChatMessage, 'id' | 'created_at'>>
export interface ChatMessage {
  id: number
  room_id: ChatRoomId | null
  profile_id: number | null
  global_name: string
  username: string
  is_me: boolean
  content: string | null
  status: ChatStatus | null
  timestamp: string | null
  created_at: string
  updated_at: string | null
}
export type Chat = ChatMessage
export interface ChatContact {
  username: string
  global_name: string
  last_chat: Chat
}
export interface ChatReplyRequest {
  reply: string
  specified_reply: boolean
}
export interface ChatReplyAccepted {
  status: 'accepted'
  message: string
  data: {
    chat_id: number
    task_id: string
    status: 'queued'
  }
}
export type ReplyTaskStatus = 'queued' | 'processing' | 'sent' | 'failed'
export interface ReplyTaskStatusData {
  task_id: string
  chat_id: number
  profile_id: number
  room_id: ChatRoomId
  status: ReplyTaskStatus
  error: string | null
  reply_chat_id: number | null
  created_at: string
  updated_at: string | null
}
export interface ChatConnectedEvent {
  type: 'chat.connected'
  profile_id: number
}
export interface ChatMessageCreatedEvent {
  type: 'chat.message.created'
  profile_id: number
  data: ChatMessage
}
export interface ChatReplyStatusEvent {
  type: 'chat.reply.status'
  profile_id: number
  data: ReplyTaskStatusData
}
export type ChatWebSocketEvent = ChatConnectedEvent | ChatMessageCreatedEvent | ChatReplyStatusEvent
export interface ApiResponse<T> {
  status: 'success' | 'error'
  message: string
  data: T | null
}
export type Channel = { id: number; name: string; description: string; minutes_interval: number; url: string; channel_level: number; created_at: string; updated_at: string | null }
export type ChannelInput = { name: string; description: string; minutes_interval: number; channel_url: string; channel_level: number }
export type Msg = { id: number; message: string; world: string; created_at: string; updated_at: string | null }
export type ListenerStatus = 'running' | 'stopped'
export interface DiscordProfile {
  id: number
  name: string
  listener_status: ListenerStatus
  level?: number
}
export interface Profile extends DiscordProfile {
  level: number
  active_at: string | null
  nonactive_at: string | null
  created_at: string
  updated_at: string | null
}
export type ProfileInput = { name: string; level: number; active_at?: string | null; nonactive_at?: string | null }
export type PromoLog = { id: number; message_id: number; channel_id: number; profile_id: number | null; timestamp: string; next_run: string | null; status: string; created_at: string; updated_at: string }
export type SendResult = { log_id: number; status: 'queued'; websocket_path: string }
export type PromotionCompletion = {
  type: 'promotion.completed'
  log_id: number
  source: 'manual' | 'scheduled' | string
  status: 'success' | 'error' | 'cancelled' | string
  message: string
  data: unknown
}
export type LogUpdate = { status_update?: string; clear_schedule?: boolean; disable?: boolean }
