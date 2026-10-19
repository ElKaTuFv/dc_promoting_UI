import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { profilesApi } from '../api'
import { useProfiles } from '../hooks'
import type { Profile } from '../types'
import { Async, Banner, Btn, Confirm, Field, FormModal, PageHead, Tbl, fmt, inp, toIso, toLocal, toast } from '../ui'

const blank = { name: '', level: '0', active: '', nonactive: '' }

export default function Profiles() {
  const qc = useQueryClient()
  const q = useProfiles()
  const [edit, setEdit] = useState<Profile | 'new' | null>(null)
  const [del, setDel] = useState<Profile | null>(null)
  const [f, setF] = useState(blank)
  const [err, setErr] = useState<Record<string, string>>({})
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const open = (p: Profile | 'new') => {
    setF(p === 'new' ? blank : { name: p.name, level: String(p.level), active: toLocal(p.active_at), nonactive: toLocal(p.nonactive_at) })
    setErr({}); setEdit(p)
  }
  const done = (m: string) => { toast('success', m); qc.invalidateQueries({ queryKey: ['profiles'] }) }
  const save = useMutation({
    mutationFn: () => {
      const base = { name: f.name.trim(), level: +f.level }
      const sched = { active_at: toIso(f.active), nonactive_at: toIso(f.nonactive) } // keduanya null = hapus jadwal
      return edit === 'new' ? profilesApi.create(f.active ? { ...base, ...sched } : base) : profilesApi.update((edit as Profile).id, { ...base, ...sched })
    },
    onSuccess: (r) => { done(r.message); setEdit(null) },
  })
  const rm = useMutation({ mutationFn: (id: number) => profilesApi.remove(id), onSuccess: (r) => { done(r.message); setDel(null) } })
  const login = useMutation({ mutationFn: (p: Profile) => profilesApi.login(p.id), onSuccess: (r) => toast('success', r.message) })
  const submit = () => {
    const e: Record<string, string> = {}
    if (!f.name.trim()) e.name = 'Nama wajib diisi'
    if (!/^\d+$/.test(f.level)) e.level = 'Isi bilangan bulat minimal 0'
    if (!!f.active !== !!f.nonactive) e.nonactive = 'Waktu aktif dan nonaktif harus diisi bersamaan'
    else if (f.active) {
      const h = (Date.parse(toIso(f.nonactive)!) - Date.parse(toIso(f.active)!)) / 36e5
      if (h <= 0) e.nonactive = 'Waktu nonaktif harus setelah waktu aktif'
      else if (h > 9) e.nonactive = 'Rentang aktif maksimal 9 jam'
    }
    setErr(e)
    if (!Object.keys(e).length) save.mutate()
  }
  return (
    <>
      <PageHead title="Profil Discord" sub="Akun yang dipakai backend untuk mengirim pesan. Kredensial Discord tidak pernah dimasukkan di sini." action={<Btn onClick={() => open('new')}>Tambah profil</Btn>} />
      <Banner kind="info">“Login Discord” membuka browser di komputer backend dan menunggu Anda menyelesaikan login di sana. Menghapus profil hanya menghapus datanya di dashboard, bukan data browser tersimpan.</Banner>
      {login.isPending && <Banner kind="warn">Menunggu login di browser backend untuk profil <b>{login.variables?.name}</b>… Proses ini bisa memakan waktu. Jangan tutup halaman ini.</Banner>}
      <Async q={q} empty="Belum ada profil. Tambahkan profil, lalu jalankan Login Discord.">
        <Tbl head={['Nama', 'Level', 'Aktif', 'Nonaktif', 'Jadwal', 'Aksi']}>
          {q.data?.map((p) => (
            <tr key={p.id}>
              <td className="font-medium">{p.name}</td><td>{p.level}</td><td>{fmt(p.active_at)}</td><td>{fmt(p.nonactive_at)}</td>
              <td>{p.active_at ? 'Berulang setiap hari' : 'Tanpa jadwal (tidak dipilih otomatis)'}</td>
              <td className="whitespace-nowrap">
                <Btn disabled={login.isPending} onClick={() => login.mutate(p)}>{login.isPending && login.variables?.id === p.id ? 'Menunggu…' : 'Login Discord'}</Btn>{' '}
                <Btn variant="ghost" onClick={() => open(p)}>Edit</Btn> <Btn variant="ghost" onClick={() => setDel(p)}>Hapus</Btn>
              </td>
            </tr>
          ))}
        </Tbl>
      </Async>
      {edit && (
        <FormModal title={edit === 'new' ? 'Tambah profil' : 'Edit profil'} onClose={() => setEdit(null)} onSubmit={submit} pending={save.isPending}>
          <Field label="Nama profil" error={err.name}><input className={inp} value={f.name} onChange={set('name')} /></Field>
          <Field label="Level" error={err.level} hint="Harus ≥ level minimum channel agar boleh mengirim."><input className={inp} inputMode="numeric" value={f.level} onChange={set('level')} /></Field>
          <fieldset className="grid grid-cols-2 gap-3 rounded-md border border-line p-3">
            <legend className="px-1 text-sm font-medium">Jadwal aktif harian (WIB, UTC+07:00)</legend>
            <Field label="Mulai aktif"><input type="datetime-local" className={inp} value={f.active} onChange={set('active')} /></Field>
            <Field label="Selesai aktif" error={err.nonactive}><input type="datetime-local" className={inp} value={f.nonactive} onChange={set('nonactive')} /></Field>
            <p className="col-span-2 text-xs text-muted">Isi keduanya atau kosongkan keduanya. Maksimal 9 jam; dikirim ke backend dengan offset +07:00.</p>
            {(f.active || f.nonactive) && <Btn variant="ghost" className="col-span-2" onClick={() => setF({ ...f, active: '', nonactive: '' })}>Hapus jadwal</Btn>}
          </fieldset>
        </FormModal>
      )}
      {del && <Confirm danger title="Hapus profil?" label="Hapus profil" pending={rm.isPending} onOk={() => rm.mutate(del.id)} onClose={() => setDel(null)} text={<>Profil <b>{del.name}</b> dihapus dari dashboard. Data browser tersimpan di backend <b>tidak ikut terhapus</b>.</>} />}
    </>
  )
}
