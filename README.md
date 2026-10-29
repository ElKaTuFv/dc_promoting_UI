# Dashboard Promosi Discord (React + TypeScript + Vite + Tailwind v4)

## Menjalankan
```bash
npm install
cp .env.example .env     # opsional
npm run dev              # http://localhost:5173
npm run build            # type-check + build produksi
npm test                 # tes komponen dan API
```

## Alamat API & CORS
- `VITE_API_BASE_URL` kosong (default): browser memanggil `/api/v1/...` pada origin yang sama. Saat `npm run dev`, Vite meneruskan `/api` dan WebSocket ke `http://localhost:2525`, jadi **tidak perlu CORS**.
- Untuk mengakses API secara langsung, isi `.env` dengan `VITE_API_BASE_URL=http://<computer-ip>:2525`. Backend harus mengizinkan origin frontend lewat CORS. Jangan masukkan alamat IP tertentu ke kode.
- Produksi: sajikan frontend dan API dari origin yang sama (reverse proxy `/api` ke FastAPI), atau atur URL API publik melalui `VITE_API_BASE_URL`. Pada situs HTTPS, API harus HTTPS dan WebSocket otomatis menggunakan WSS untuk mencegah mixed content.
- Untuk Cloudflare Tunnel saat menjalankan Vite dev server, atur `CLOUDFLARED_HOST` di `.env` ke hostname tunnel persis (tanpa `https://`), misalnya `leo-hay-fish-vegetation.trycloudflare.com`. Hostname contoh tersebut diizinkan secara default; ganti nilainya ketika Quick Tunnel menghasilkan hostname baru. Mulai ulang `npm run dev` setelah mengubah konfigurasi.

## Catatan integrasi
- Pratinjau pesan mengenali token `:NAMA_EMOJI:` pada halaman Pesan. Daftar emoji dimuat satu kali saat aplikasi dibuka, disimpan di `localStorage`, dan diperbarui maksimal sekali sehari. Gambar hanya diminta saat token dipakai; Vite mem-proxy gambar ke CDN dan mengatur cache browser satu hari. Request daftar dan gambar sama-sama mendapat header `Authorization` yang ditambahkan Vite dari `DISCORD_TOKEN` di `.env` hanya di server. Jangan gunakan awalan `VITE_` atau menaruh token di frontend. Masukkan token bot (dengan atau tanpa awalan `Bot `; Vite menambahkan skema jika belum ada), pastikan token memiliki akses ke guild emoji, lalu mulai ulang Vite setelah mengubah `.env`.
- Respons dengan HTTP 200 tetapi `status: "error"`/`"cancelled"` tidak dianggap sukses (`src/api.ts`).
- Endpoint pesan memakai body `text/plain` dan `world` sebagai query string.
- Halaman Chat mengambil profil dari `/api/v1/profiles`, kontak dari `/api/v1/chats/profiles/{profile_id}/contacts`, dan percakapan dari `/api/v1/chats/profiles/{profile_id}/conversation`. Listener berstatus `running` masing-masing mendapat koneksi WebSocket `/api/v1/chats/ws/{profile_id}`; koneksi mencoba kembali dengan jeda progresif dan mengambil ulang `/api/v1/chats` setelah tersambung kembali untuk menyelaraskan event yang terlewat. Start/stop listener tersedia di daftar profil. Browser tidak terhubung langsung ke Discord Gateway, tidak ada polling chat, dan UI belum mengirim pesan karena backend belum memiliki endpoint pengiriman.
- Pengiriman promosi menganggap HTTP 202 sebagai diterima/masuk antrean, bukan terkirim. Hasil akhir ditampilkan setelah worker mengirim event WebSocket; log juga diselaraskan ulang saat koneksi scheduler aktif.
- Koneksi WebSocket scheduler mencoba kembali dengan jeda progresif. Aktifkan notifikasi melalui tombol di dashboard; izin tidak diminta otomatis. Notifikasi browser memerlukan konteks aman (HTTPS, kecuali localhost). Notifikasi tidak dijamin saat halaman ditutup atau terputus; itu memerlukan Web Push, service worker, dan dukungan backend.
- Login profil (10 menit) memakai timeout panjang; waktu jadwal selalu dikirim ber-offset `+07:00`.
- Tidak ada autentikasi, statistik server, maupun hapus log, sesuai kontrak backend.
