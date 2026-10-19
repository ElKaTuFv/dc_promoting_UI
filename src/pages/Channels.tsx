import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { channelsApi } from '../api'
import { useChannels } from '../hooks'
import type { Channel } from '../types'
import { Async, Btn, Confirm, Field, FormModal, PageHead, Tbl, fmt, inp, toast } from '../ui'

const blank = { name: '', description: '', url: '', minutes_interval: '120', channel_level: '0' }

export default function Channels() {
  const qc = useQueryClient()
  const q = useChannels()
  const [edit, setEdit] = useState<Channel | 'new' | null>(null)
  const [del, setDel] = useState<Channel | null>(null)
  const [f, setF] = useState(blank)
  const [err, setErr] = useState<Record<string, string>>({})
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const open = (c: Channel | 'new') => {
    setF(c === 'new' ? blank : { name: c.name, description: c.description, url: c.url, minutes_interval: String(c.minutes_interval), channel_level: String(c.channel_level) })
    setErr({}); setEdit(c)
  }
  const done = (m: string) => { toast('success', m); qc.invalidateQueries({ queryKey: ['channels'] }) }
  const save = useMutation({
    mutationFn: () => {
      const p = { name: f.name.trim(), description: f.description.trim(), channel_url: f.url.trim(), minutes_interval: +f.minutes_interval, channel_level: +f.channel_level }
      return edit === 'new' ? channelsApi.create(p) : channelsApi.update((edit as Channel).id, p)
    },
    onSuccess: (r) => { done(r.message); setEdit(null) },
  })
  const rm = useMutation({ mutationFn: (id: number) => channelsApi.remove(id), onSuccess: (r) => { done(r.message); setDel(null) } })
  const submit = () => {
    const e: Record<string, string> = {}
    if (!f.name.trim()) e.name = 'Nama wajib diisi'
    if (!f.description.trim()) e.description = 'Deskripsi wajib diisi'
    if (!/^https?:\/\/\S+$/.test(f.url.trim())) e.url = 'Masukkan URL lengkap berawalan https://'
    if (!/^[1-9]\d*$/.test(f.minutes_interval)) e.minutes_interval = 'Isi bilangan bulat minimal 1'
    if (!/^\d+$/.test(f.channel_level)) e.channel_level = 'Isi bilangan bulat minimal 0'
    setErr(e)
    if (!Object.keys(e).length) save.mutate()
  }
  return (
    <>
      <PageHead title="Channel" sub="Channel Discord tujuan promosi. Level minimum menentukan profil mana yang boleh mengirim." action={<Btn onClick={() => open('new')}>Tambah channel</Btn>} />
      <Async q={q} empty="Belum ada channel. Tambahkan channel pertama untuk mulai mengirim promosi.">
        <Tbl head={['Nama', 'Deskripsi', 'URL Channel', 'Interval', 'Level min.', 'Diperbarui', 'Aksi']}>
          {q.data?.map((c) => (
            <tr key={c.id}>
              <td className="font-medium">{c.name}</td><td className="max-w-xs">{c.description}</td>
              <td><a className="text-link hover:underline" href={c.url} target="_blank" rel="noreferrer">Buka</a></td>
              <td>{c.minutes_interval} menit</td><td>{c.channel_level}</td><td>{fmt(c.updated_at ?? c.created_at)}</td>
              <td className="whitespace-nowrap"><Btn variant="ghost" onClick={() => open(c)}>Edit</Btn> <Btn variant="ghost" onClick={() => setDel(c)}>Hapus</Btn></td>
            </tr>
          ))}
        </Tbl>
      </Async>
      {edit && (
        <FormModal title={edit === 'new' ? 'Tambah channel' : 'Edit channel'} onClose={() => setEdit(null)} onSubmit={submit} pending={save.isPending}>
          <Field label="Nama" error={err.name}><input className={inp} value={f.name} onChange={set('name')} /></Field>
          <Field label="Deskripsi" error={err.description}><input className={inp} value={f.description} onChange={set('description')} /></Field>
          <Field label="URL Channel" error={err.url}><input className={inp} value={f.url} onChange={set('url')} placeholder="https://discord.com/channels/…" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Interval (menit)" error={err.minutes_interval}><input className={inp} inputMode="numeric" value={f.minutes_interval} onChange={set('minutes_interval')} /></Field>
            <Field label="Level minimum profil" error={err.channel_level}><input className={inp} inputMode="numeric" value={f.channel_level} onChange={set('channel_level')} /></Field>
          </div>
        </FormModal>
      )}
      {del && <Confirm danger title="Hapus channel?" label="Hapus channel" pending={rm.isPending} onOk={() => rm.mutate(del.id)} onClose={() => setDel(null)} text={<>Channel <b>{del.name}</b> akan dihapus permanen.</>} />}
    </>
  )
}
