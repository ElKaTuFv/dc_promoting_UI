# Dashboard Promosi Discord (React + TypeScript + Vite + Tailwind v4)

## Menjalankan
```bash
npm install
cp .env.example .env     # opsional
npm run dev              # http://localhost:5173
npm run build            # type-check + build produksi
```

## Alamat API & CORS
- `VITE_API_BASE_URL` kosong (default): browser memanggil `/api/v1/...` pada origin yang sama. Saat `npm run dev`, Vite meneruskan `/api` dan WebSocket ke `http://localhost:2525`, jadi **tidak perlu CORS**.
- Untuk mengakses API secara langsung, isi `.env` dengan `VITE_API_BASE_URL=http://<computer-ip>:2525`. Backend harus mengizinkan origin frontend lewat CORS. Jangan masukkan alamat IP tertentu ke kode.
- Produksi: sajikan frontend dan API dari origin yang sama (reverse proxy `/api` ke FastAPI), atau atur URL API publik melalui `VITE_API_BASE_URL`. Pada situs HTTPS, API harus HTTPS dan WebSocket otomatis menggunakan WSS untuk mencegah mixed content.
- Untuk Cloudflare Tunnel saat menjalankan Vite dev server, atur `CLOUDFLARED_HOST` di `.env` ke hostname tunnel persis (tanpa `https://`), misalnya `leo-hay-fish-vegetation.trycloudflare.com`. Hostname contoh tersebut diizinkan secara default; ganti nilainya ketika Quick Tunnel menghasilkan hostname baru. Mulai ulang `npm run dev` setelah mengubah konfigurasi.

## Catatan integrasi
- Respons dengan HTTP 200 tetapi `status: "error"`/`"cancelled"` tidak dianggap sukses (`src/api.ts`).
- Endpoint pesan memakai body `text/plain` dan `world` sebagai query string.
- Pengiriman promosi menganggap HTTP 202 sebagai diterima/masuk antrean, bukan terkirim. Hasil akhir ditampilkan setelah worker mengirim event WebSocket; log juga diselaraskan ulang saat koneksi scheduler aktif.
- Koneksi WebSocket scheduler mencoba kembali dengan jeda progresif. Aktifkan notifikasi melalui tombol di dashboard; izin tidak diminta otomatis. Notifikasi browser memerlukan konteks aman (HTTPS, kecuali localhost). Notifikasi tidak dijamin saat halaman ditutup atau terputus; itu memerlukan Web Push, service worker, dan dukungan backend.
- Login profil (10 menit) memakai timeout panjang; waktu jadwal selalu dikirim ber-offset `+07:00`.
- Tidak ada autentikasi, statistik server, maupun hapus log, sesuai kontrak backend.
