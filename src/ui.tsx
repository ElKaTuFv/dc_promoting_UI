import { useEffect, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react'

/* ---------- waktu: selalu WIB (UTC+07:00, tanpa DST) ---------- */
export const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB' : '—')
export const toIso = (local: string) => (local ? `${local}:00+07:00` : null)
export const toLocal = (s: string | null) => (s ? new Date(new Date(s).getTime() + 7 * 36e5).toISOString().slice(0, 16) : '')

/* ---------- toast ---------- */
type T = { id: number; kind: 'success' | 'error' | 'warn'; text: string }
let push: (t: Omit<T, 'id'>) => void = () => {}
export const toast = (kind: T['kind'], text: string) => push({ kind, text })
export function Toaster() {
  const [items, set] = useState<T[]>([])
  useEffect(() => {
    push = (t) => {
      const id = Math.random()
      set((s) => [...s, { ...t, id }])
      setTimeout(() => set((s) => s.filter((x) => x.id !== id)), 7000)
    }
  }, [])
  const c = { success: 'bg-emerald-700', error: 'bg-red-700', warn: 'bg-amber-600' }
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 max-w-sm space-y-2">
      {items.map((t) => <div key={t.id} className={`${c[t.kind]} rounded-lg px-4 py-3 text-sm text-white shadow-lg`}>{t.text}</div>)}
    </div>
  )
}

/* ---------- dasar ---------- */
export function Btn({ variant = 'primary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const v = { primary: 'bg-accent text-white hover:bg-accent-dark', ghost: 'bg-raised text-body hover:bg-[#4e5058]', danger: 'bg-danger text-white hover:bg-[#a12828]' }[variant]
  return <button type="button" {...p} className={`rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`} />
}
export const inp = 'w-full rounded-md border border-transparent bg-canvas px-3 py-2.5 text-sm text-body placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40'
export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-soft">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
      {error && <span role="alert" className="mt-1.5 block text-xs text-red-400">{error}</span>}
    </label>
  )
}
export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5">
      <div><h1 className="text-2xl font-bold">{title}</h1>{sub && <p className="mt-1 max-w-2xl text-sm text-muted">{sub}</p>}</div>
      {action}
    </div>
  )
}
export const Banner = ({ kind = 'warn', children }: { kind?: 'warn' | 'info' | 'error' | 'success'; children: ReactNode }) => {
  const c = { warn: 'border-amber-400 bg-amber-400/10 text-amber-50', info: 'border-link bg-link/10 text-sky-100', error: 'border-red-500 bg-red-500/10 text-red-100', success: 'border-emerald-500 bg-emerald-500/10 text-emerald-100' }[kind]
  return <div role={kind === 'error' ? 'alert' : undefined} className={`mb-4 rounded-md border-l-4 px-4 py-3 text-sm ${c}`}>{children}</div>
}

const sc: Record<string, string> = { sent: 'bg-emerald-500/15 text-emerald-300', queued: 'bg-sky-500/15 text-sky-300', running: 'bg-indigo-400/20 text-indigo-200', cancelled: 'bg-amber-400/15 text-amber-300', waiting: 'bg-amber-400/15 text-amber-300', disabled: 'bg-raised text-muted', error: 'bg-red-500/15 text-red-300' }
const lbl: Record<string, string> = { sent: 'Terkirim', queued: 'Antre', running: 'Berjalan', cancelled: 'Dibatalkan', waiting: 'Menunggu profil', disabled: 'Dinonaktifkan', error: 'Gagal' }
export const Badge = ({ s }: { s: string }) => <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${sc[s] ?? 'bg-raised text-soft'}`}><span aria-hidden className="size-1.5 rounded-full bg-current" />{lbl[s] ?? s}</span>

export function Tbl({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-surface ring-1 ring-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-canvas/50 text-xs font-semibold text-muted"><tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line [&>tr:hover]:bg-raised/40 [&_td]:px-4 [&_td]:py-3 [&_td]:align-middle [&_button]:px-2.5 [&_button]:py-1 [&_button]:text-xs">{children}</tbody>
      </table>
    </div>
  )
}

/** Menangani loading (skeleton), error, dan empty state; children dirender bila ada data. */
export function Async({ q, empty, children }: { q: { isLoading: boolean; error: unknown; data?: unknown[] }; empty: string; children: ReactNode }) {
  if (q.isLoading) return <div aria-busy className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-raised" />)}</div>
  if (q.error) return <Banner kind="error">{(q.error as Error).message}</Banner>
  if (!q.data?.length) return <div className="rounded-lg border border-dashed border-line bg-surface/50 p-12 text-center text-sm text-muted">{empty}</div>
  return <>{children}</>
}

/* ---------- dialog ---------- */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-page shadow-2xl ring-1 ring-line">
        <h2 className="px-6 pt-6 text-xl font-bold">{title}</h2>
        <div className="px-6 pb-4 pt-4">{children}</div>
      </div>
    </div>
  )
}
const Foot = ({ children }: { children: ReactNode }) => <div className="-mx-6 -mb-4 mt-6 flex justify-end gap-2 bg-surface px-6 py-4">{children}</div>
export function FormModal({ title, onClose, onSubmit, pending, children }: { title: string; onClose: () => void; onSubmit: () => void; pending: boolean; children: ReactNode }) {
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!pending) onSubmit() }} className="space-y-4">
        {children}
        <Foot>
          <Btn variant="ghost" onClick={onClose}>Batal</Btn>
          <Btn type="submit" disabled={pending}>{pending ? 'Menyimpan…' : 'Simpan'}</Btn>
        </Foot>
      </form>
    </Modal>
  )
}
export function Confirm({ title, text, label = 'Ya, lanjutkan', danger, pending, onOk, onClose, children }: { title: string; text: ReactNode; label?: string; danger?: boolean; pending?: boolean; onOk: () => void; onClose: () => void; children?: ReactNode }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="text-sm text-soft">{text}</div>
      {children}
      <Foot>
        <Btn variant="ghost" onClick={onClose}>Batal</Btn>
        <Btn variant={danger ? 'danger' : 'primary'} disabled={pending} onClick={onOk}>{pending ? 'Memproses…' : label}</Btn>
      </Foot>
    </Modal>
  )
}
