import type { PromotionCompletion } from './types'
import { promotionWebSocketUrl } from './api'
import { toast } from './ui'

const notificationKey = 'promotion-completion-log-ids'
const handledIds = new Set<number>()

function readHandledIds() {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(notificationKey) ?? '[]')
    if (Array.isArray(ids)) ids.forEach((id) => { if (typeof id === 'number') handledIds.add(id) })
  } catch (error) {
    console.warn('Could not read saved promotion notification IDs.', error)
  }
}

readHandledIds()

export function parsePromotionCompletion(data: string): PromotionCompletion | null {
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch (error) {
    console.error('Received invalid JSON from the promotion WebSocket.', error)
    return null
  }
  if (!value || typeof value !== 'object') return null
  const event = value as Record<string, unknown>
  if (event.type !== 'promotion.completed') return null
  if (typeof event.log_id !== 'number' ||
      typeof event.source !== 'string' || typeof event.status !== 'string' ||
      typeof event.message !== 'string') {
    console.error('Received an invalid promotion completion event.', value)
    return null
  }
  return event as PromotionCompletion
}

function eventDetails(event: PromotionCompletion, fallback?: { channel?: string; message?: string }) {
  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : {}
  const channel = fallback?.channel ?? (typeof data.channel_name === 'string' ? data.channel_name : undefined)
  const message = fallback?.message ?? (typeof data.message_text === 'string' ? data.message_text : undefined)
  const channelId = typeof data.channel_id === 'number' ? data.channel_id : undefined
  const messageId = typeof data.message_id === 'number' ? data.message_id : undefined
  const values = [channel ?? (channelId ? `Channel #${channelId}` : undefined), message ?? (messageId ? `Pesan #${messageId}` : undefined)]
  return values.filter(Boolean).join(' · ')
}

export function notifyPromotionCompletion(event: PromotionCompletion, fallback?: { channel?: string; message?: string }) {
  if (handledIds.has(event.log_id)) return
  handledIds.add(event.log_id)
  const ids = [...handledIds].slice(-500)
  try {
    localStorage.setItem(notificationKey, JSON.stringify(ids))
  } catch (error) {
    console.warn('Could not save promotion notification IDs.', error)
  }

  const source = event.source === 'scheduled' ? 'terjadwal' : 'manual'
  const detail = eventDetails(event, fallback)
  const result = event.status === 'success' ? 'berhasil' : event.status === 'cancelled' ? 'dibatalkan' : 'gagal'
  const message = `Promosi ${source} ${result}${detail ? ` · ${detail}` : ''}: ${event.message}`
  toast(event.status === 'success' ? 'success' : event.status === 'cancelled' ? 'warn' : 'error', message)

  if (event.status === 'success' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const notification = new Notification(`Promosi ${source} berhasil`, {
        body: detail || event.message,
        tag: `promotion-${event.log_id}`,
      })
      notification.onerror = (error) => console.error('Could not display the promotion notification.', error)
    } catch (error) {
      console.error('Could not display the promotion notification.', error)
    }
  }
}

export const schedulingWebSocketUrl = () => promotionWebSocketUrl('/api/v1/promotion/ws/scheduling')
