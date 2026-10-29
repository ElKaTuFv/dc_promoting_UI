import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { messagesApi } from '../api'
import { useMessages } from '../hooks'
import type { Msg } from '../types'
import { Async, Btn, Confirm, Field, FormModal, PageHead, fmt, inp, toast } from '../ui'
import MessagePreview from '../components/MessagePreview'

export default function Messages() {
  const qc = useQueryClient()
  const q = useMessages()
  const [edit, setEdit] = useState<Msg | 'new' | null>(null)
  const [del, setDel] = useState<Msg | null>(null)
  const [f, setF] = useState({ world: '', message: '' })
  const [err, setErr] = useState<Record<string, string>>({})
  const [s, setS] = useState('')
  const open = (m: Msg | 'new') => { setF(m === 'new' ? { world: '', message: '' } : { world: m.world, message: m.message }); setErr({}); setEdit(m) }
  const done = (m: string) => { toast('success', m); qc.invalidateQueries({ queryKey: ['messages'] }) }
  const save = useMutation({
    mutationFn: () => {
      const body = f.message.replace(/\r\n/g, '\n').trimEnd() // dikirim sebagai text/plain
      return edit === 'new' ? messagesApi.create(f.world.trim(), body) : messagesApi.update((edit as Msg).id, f.world.trim(), body)
    },
    onSuccess: (r) => { done(r.message); setEdit(null) },
  })
  const rm = useMutation({ mutationFn: (id: number) => messagesApi.remove(id), onSuccess: (r) => { done(r.message); setDel(null) } })
  const submit = () => {
    const e: Record<string, string> = {}
    if (!f.world.trim()) e.world = 'Nama world wajib diisi'
    if (!f.message.trim()) e.message = 'Isi pesan wajib diisi'
    setErr(e)
    if (!Object.keys(e).length) save.mutate()
  }
  const list = (q.data ?? []).filter((m) => `${m.world} ${m.message}`.toLowerCase().includes(s.toLowerCase()))
  return (
    <>
      <PageHead title="Pesan" sub="Pesan promosi beserta nama world. Baris baru pada pesan dipertahankan saat dikirim." action={<Btn onClick={() => open('new')}>Tambah pesan</Btn>} />
      <input className={`${inp} mb-4 max-w-sm`} placeholder="Cari world atau isi pesan…" aria-label="Cari pesan" value={s} onChange={(e) => setS(e.target.value)} />
      <Async q={q} empty="Belum ada pesan. Tambahkan pesan promosi pertama.">
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((m) => (
            <article key={m.id} className="rounded-lg border-l-4 border-accent bg-surface p-4 ring-1 ring-line">
              <div className="flex items-baseline justify-between gap-2"><h2 className="font-semibold">{m.world}</h2><span className="text-xs text-muted">#{m.id} · {fmt(m.updated_at ?? m.created_at)}</span></div>
              <pre className="my-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{m.message}</pre>
              <div className="flex gap-2"><Btn variant="ghost" onClick={() => open(m)}>Edit</Btn><Btn variant="ghost" onClick={() => setDel(m)}>Hapus</Btn></div>
            </article>
          ))}
        </div>
        {!list.length && <p className="text-sm text-muted">Tidak ada pesan yang cocok dengan pencarian.</p>}
      </Async>
      {edit && (
        <FormModal title={edit === 'new' ? 'Tambah pesan' : 'Edit pesan'} onClose={() => setEdit(null)} onSubmit={submit} pending={save.isPending}>
          <Field label="World" error={err.world}><input className={inp} value={f.world} onChange={(e) => setF({ ...f, world: e.target.value })} /></Field>
          <MessagePreview textInput={f.message} error={err.message} onTextChange={(message) => setF({ ...f, message })} />
        </FormModal>
      )}
      {del && <Confirm danger title="Hapus pesan?" label="Hapus pesan" pending={rm.isPending} onOk={() => rm.mutate(del.id)} onClose={() => setDel(null)} text={<>Pesan untuk world <b>{del.world}</b> akan dihapus permanen.</>} />}
    </>
  )
}
