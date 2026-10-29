import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { getEmojiState, loadDiscordEmojis, setEmojiOverride, subscribeEmojiState, type EmojiMap } from '../emojiMap'
import { Btn, Field, inp } from '../ui'

const subscribe = (listener: () => void) => subscribeEmojiState(listener)
const snapshot = () => getEmojiState()

export function renderParsedPreview(textInput: string, emojiMap: EmojiMap): ReactNode {
  const tokenPattern = /:([a-zA-Z0-9_]+):/g
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(textInput)) !== null) {
    if (match.index > lastIndex) parts.push(textInput.slice(lastIndex, match.index))
    const imageUrl = emojiMap[match[1]]
    if (imageUrl) {
      const token = `:${match[1]}:`
      parts.push(
        <img
          key={`${match.index}-${match[1]}`}
          src={imageUrl}
          alt={token}
          title={token}
          loading="lazy"
          decoding="async"
          style={{ width: 20, height: 20, verticalAlign: 'middle', display: 'inline-block', margin: '0 2px' }}
        />,
      )
    } else {
      parts.push(match[0])
    }
    lastIndex = tokenPattern.lastIndex
  }
  if (lastIndex < textInput.length) parts.push(textInput.slice(lastIndex))
  return parts
}

export default function MessagePreview({ textInput, onTextChange, error }: { textInput: string; onTextChange: (value: string) => void; error?: string }) {
  const emojiState = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [code, setCode] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [issue, setIssue] = useState('')
  const emojiMap = emojiState.emojis

  const preview = useMemo(() => renderParsedPreview(textInput, emojiMap), [textInput, emojiMap])

  const saveEmoji = () => {
    const normalizedCode = code.trim().replace(/^:|:$/g, '')
    const normalizedUrl = imageUrl.trim()
    if (!/^[a-zA-Z0-9_]+$/.test(normalizedCode)) {
      setIssue('Kode emoji hanya boleh berisi huruf, angka, dan garis bawah.')
      return
    }
    try {
      const parsedUrl = new URL(normalizedUrl)
      if (parsedUrl.protocol !== 'https:') throw new Error()
    } catch {
      setIssue('URL gambar emoji harus berupa URL HTTPS yang valid.')
      return
    }
    setEmojiOverride(normalizedCode, normalizedUrl)
    setCode('')
    setImageUrl('')
    setIssue('')
  }

  const removeEmoji = () => {
    const normalizedCode = code.trim().replace(/^:|:$/g, '')
    if (!normalizedCode || !emojiMap[normalizedCode]) {
      setIssue('Masukkan kode emoji yang sudah ada untuk menghapusnya.')
      return
    }
    setEmojiOverride(normalizedCode, null)
    setIssue('')
  }

  return (
    <section className="space-y-3" aria-label="Editor dan pratinjau pesan">
      <Field label="Isi pesan">
        <textarea
          rows={7}
          className={inp}
          value={textInput}
          onChange={(event) => onTextChange(event.target.value)}
          aria-label="Isi pesan"
        />
      </Field>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">Live Preview</span>
          <span className="text-xs text-muted">{Object.keys(emojiMap).length} emoji tersedia{emojiState.loading ? ' · memuat…' : ''}</span>
        </div>
        <div className="min-h-12 max-h-64 overflow-auto rounded-md bg-canvas p-3 text-sm leading-relaxed [overflow-wrap:anywhere] [white-space:pre-wrap]">
          {textInput ? preview : '—'}
        </div>
      </div>
      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium">Pengaturan emoji (tersimpan di browser ini)</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted">Daftar emoji dimuat sekali saat aplikasi dibuka dan di-cache lokal selama 24 jam. Gambar hanya diminta saat kode emoji dipakai dan di-cache browser selama sehari.</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input className={inp} aria-label="Kode emoji" placeholder="Kode, mis. WL" value={code} onChange={(event) => setCode(event.target.value)} />
            <input className={inp} aria-label="URL gambar emoji" placeholder="https://…/emoji.png" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
            <Btn variant="ghost" onClick={saveEmoji}>Simpan</Btn>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="ghost" disabled={emojiState.loading} onClick={() => { setIssue(''); void loadDiscordEmojis(true) }}>{emojiState.loading ? 'Memuat emoji…' : 'Muat ulang daftar Discord'}</Btn>
            <Btn variant="ghost" onClick={removeEmoji}>Hapus kode di atas</Btn>
          </div>
          {(issue || emojiState.error) && <p role="alert" className="text-xs text-amber-200">{issue || emojiState.error}</p>}
        </div>
      </details>
    </section>
  )
}
