export type EmojiMap = Record<string, string>

type EmojiState = {
  emojis: EmojiMap
  overrides: EmojiMap
  fetchedAt: number
  loading: boolean
  error: string
}

type StoredEmojiState = { emojis?: unknown; overrides?: unknown; fetchedAt?: unknown }
type DiscordEmoji = { id: string; name: string; animated?: boolean }

const endpoint = '/discord-emojis/list'
const storageKey = 'promo-dashboard-emoji-map-v1'
const cacheDuration = 24 * 60 * 60 * 1000
const listeners = new Set<() => void>()

function validEmojiMap(value: unknown): EmojiMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, url]) => {
      if (!/^[a-zA-Z0-9_]+$/.test(name) || typeof url !== 'string') return []
      const cdnImage = url.match(/^https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.(png|gif)$/)
      if (cdnImage) return [[name, `/discord-emojis/image/${cdnImage[1]}.${cdnImage[2]}`]]
      return url.startsWith('/') || url.startsWith('https://') ? [[name, url]] : []
    }),
  )
}

function readStoredState(): Pick<EmojiState, 'emojis' | 'overrides' | 'fetchedAt'> {
  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return { emojis: {}, overrides: {}, fetchedAt: 0 }
    const value = JSON.parse(stored) as StoredEmojiState
    const emojis = validEmojiMap(value.emojis)
    return {
      emojis,
      overrides: validEmojiMap(value.overrides),
      fetchedAt: typeof value.fetchedAt === 'number' ? value.fetchedAt : 0,
    }
  } catch (error) {
    console.warn('Could not read the saved emoji map.', error)
    return { emojis: {}, overrides: {}, fetchedAt: 0 }
  }
}

const initialState = readStoredState()
let state: EmojiState = { ...initialState, loading: false, error: '' }
let request: Promise<void> | null = null

function publish(next: EmojiState) {
  state = next
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      emojis: state.emojis,
      overrides: state.overrides,
      fetchedAt: state.fetchedAt,
    }))
  } catch (error) {
    console.error('Could not save the emoji map to local storage.', error)
    state = { ...state, error: 'Penyimpanan emoji di browser gagal. Periksa ruang penyimpanan situs.' }
  }
  listeners.forEach((listener) => listener())
}

export const getEmojiState = () => state

export function subscribeEmojiState(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setEmojiOverride(code: string, url: string | null) {
  const overrides = { ...state.overrides }
  const emojis = { ...state.emojis }
  if (url) {
    overrides[code] = url
    emojis[code] = url
  } else {
    delete overrides[code]
    delete emojis[code]
  }
  publish({ ...state, emojis, overrides })
}

export function loadDiscordEmojis(force = false): Promise<void> {
  if (request) return request
  if (!force && state.emojis && state.fetchedAt && Date.now() - state.fetchedAt < cacheDuration) return Promise.resolve()

  publish({ ...state, loading: true, error: '' })
  request = (async () => {
    try {
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      if (!response.ok) {
        const reason = response.status === 401 || response.status === 403
          ? 'Periksa DISCORD_TOKEN di .env dan pastikan token memiliki akses ke guild emoji.'
          : `Discord mengembalikan HTTP ${response.status}.`
        throw new Error(reason)
      }
      const payload: unknown = await response.json()
      if (!Array.isArray(payload)) throw new Error('Format daftar emoji dari Discord tidak valid.')
      const fetched: EmojiMap = {}
      for (const item of payload as DiscordEmoji[]) {
        if (typeof item?.id !== 'string' || typeof item.name !== 'string' ||
            !/^[a-zA-Z0-9_]+$/.test(item.name) || !/^\d+$/.test(item.id)) continue
        const extension = item.animated ? 'gif' : 'png'
        fetched[item.name] = `/discord-emojis/image/${item.id}.${extension}`
      }
      if (!Object.keys(fetched).length) throw new Error('Tidak ada emoji yang dapat digunakan dari daftar Discord.')
      publish({
        ...state,
        emojis: { ...fetched, ...state.overrides },
        fetchedAt: Date.now(),
        loading: false,
        error: '',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tidak dapat mengambil daftar emoji Discord.'
      publish({
        ...state,
        loading: false,
        error: `${message} Anda tetap dapat menambahkan emoji secara manual.`,
      })
    } finally {
      request = null
    }
  })()
  return request
}
