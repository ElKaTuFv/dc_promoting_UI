# Dashboard Promosi Discord (React + TypeScript + Vite + Tailwind v4)

## Menjalankan
```bash
npm install
cp .env.example .env     # opsional
npm run dev              # http://localhost:5173
npm run build            # type-check + build produksi
```

## Alamat API & CORS
- `VITE_API_BASE_URL` kosong (default): browser memanggil `/api/v1/...` di origin yang sama. Saat `npm run dev`, Vite meneruskan `/api` ke `http://localhost:2525` (lihat `vite.config.ts`), jadi **tidak perlu CORS**.
- Jika diisi (mis. `http://localhost:2525`), backend harus mengizinkan origin frontend lewat CORS, karena backend belum mengonfigurasinya.
- Produksi: sajikan frontend dan API dari origin yang sama (reverse proxy `/api` ke FastAPI).

## Catatan integrasi
- Respons dengan HTTP 200 tetapi `status: "error"`/`"cancelled"` tidak dianggap sukses (`src/api.ts`).
- Endpoint pesan memakai body `text/plain` dan `world` sebagai query string.
- Login profil (10 menit) dan kirim promosi (5 menit) memakai timeout panjang; waktu jadwal selalu dikirim ber-offset `+07:00`.
- Tidak ada autentikasi, statistik server, maupun hapus log, sesuai kontrak backend.
