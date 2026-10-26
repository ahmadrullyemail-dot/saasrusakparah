# Backend HRD Management

API SaaS HRD menggunakan Node.js, Express, dan MySQL. Data dipisahkan per tenant/perusahaan; aplikasi tidak membuat data contoh.

## Persyaratan

- Node.js 20 atau lebih baru.
- MySQL 8.0+ atau MariaDB yang mendukung InnoDB dan foreign key, berjalan dan dapat diakses.
- Akun MySQL yang diizinkan membuat database dan tabel saat pertama kali dijalankan.

## Menjalankan lokal

1. Salin `.env.example` menjadi `.env`, lalu isi koneksi MySQL dan `JWT_SECRET` dengan nilai acak rahasia minimal 32 karakter.
2. Isi `FRONTEND_URL` dan konfigurasi SMTP untuk mengaktifkan pemulihan kata sandi. Gunakan port 465 dengan `SMTP_SECURE=true`, atau port submission TLS provider (umumnya 587) dengan `SMTP_SECURE=false`; set kredensial dan `SMTP_FROM` sesuai provider email.
3. Jika API berada di belakang reverse proxy, set `TRUST_PROXY_HOPS` ke jumlah hop proxy tepercaya yang tepat agar pembatasan permintaan memakai IP klien dengan benar. Biarkan `0` saat API menerima koneksi langsung; jangan percayai header proxy dari hop yang tidak dikelola.
4. Pasang dependency: `npm install`.
5. Jalankan API: `npm run dev` (atau `npm start`).

Saat startup, server menjalankan `CREATE DATABASE IF NOT EXISTS`, membuat tabel yang belum ada, serta menambahkan kolom akun/pekerja dan jenis dokumen yang diperlukan ke skema lama. Perubahan skema ini tidak menghapus data. Sintaks kolom generated untuk batas unik log presensi dipilih berdasarkan produk server (`PERSISTENT` pada MariaDB, `STORED` pada MySQL) agar kompatibel dengan versi MariaDB yang tidak menerima alias `STORED`. Tidak ada akun, tenant, pekerja, ataupun dokumen yang di-seed. Pengguna pertama membuat tenant dan akun admin melalui formulir pendaftaran. Email pengguna harus unik secara global sampai dukungan satu akun untuk beberapa tenant tersedia; indeks unik memakai hash SHA-256 biner agar tetap di bawah batas panjang kunci MySQL lama. Daftar jenis dokumen wajib disimpan sebagai JSON dalam kolom `LONGTEXT` agar kompatibel dengan MariaDB lama.

Server HTTP juga menyediakan Socket.IO di `/socket.io`. Koneksi memakai cookie sesi HttpOnly, hanya bergabung ke room tenant yang diambil dari sesi valid, dan diperiksa ulang untuk pencabutan sesi. Mutasi API yang berhasil dan presensi publik yang commit memancarkan event ringkas untuk menyegarkan UI tenant terkait. Jangan menerima room/tenant dari parameter client; pengiriman data operasional tetap melalui endpoint API ber-RBAC.

Bootstrap ini untuk database baru dan tidak mengubah skema/tabel yang sudah ada. Data pada SQLite lama tidak digunakan atau dimigrasikan.

Admin dapat membuat akun tenant melalui Pengaturan; role yang tersedia adalah Admin, HR Staff (`hr_manager`), dan Viewer. User mengelola nama, foto profil JPG/PNG (maksimal 900 KiB setelah kompresi browser), dan passwordnya sendiri. Batas foto menjaga nilai BLOB di bawah `max_allowed_packet` MariaDB lama yang dapat membatasi data tersimpan maupun ekspresi BLOB; foto dilayani melalui endpoint yang memerlukan sesi. Password minimum 12 karakter dan maksimum 72 byte UTF-8, disimpan sebagai bcrypt hash; perubahan password mencabut sesi lain. Email akun tetap unik global pada MVP, sehingga satu email tidak dapat dipakai untuk tenant lain.

Untuk deployment, gunakan HTTPS dan frontend/API pada site yang sama (atau reverse proxy), set `NODE_ENV=production`, `CORS_ORIGIN` ke origin frontend yang tepat, serta ganti secret contoh dengan secret acak yang tidak disimpan di repository.

Backend memuat `backend/.env` berdasarkan lokasi file aplikasi, tidak berdasarkan direktori kerja PM2. Pada VM, buat file tersebut dari `.env.example`, isi `JWT_SECRET` dengan secret acak minimal 32 karakter dan nilai koneksi database yang benar, lalu batasi akses file (mis. `chmod 600 backend/.env`). PM2 tidak membaca file `.env` secara otomatis; aplikasi memuatnya saat start. Jangan menaruh secret di workflow GitHub, log, atau repository. Pertahankan nilai `JWT_SECRET` yang sudah digunakan: menggantinya akan mengakhiri sesi aktif dan membatalkan seluruh tautan presensi yang sudah diterbitkan.
Hosting frontend produksi harus mengarahkan fallback SPA untuk path `/presensi` ke `index.html`, sementara path `/api` diteruskan ke Express.

## API

API berjalan di port 4000 secara default. Vite meneruskan `/api` dan `/socket.io` (termasuk upgrade WebSocket) ke backend.

- `GET /api/health`
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/auth/forgot-password` — meminta email reset; jawaban selalu generik untuk mencegah enumerasi akun. Pengiriman membutuhkan SMTP dan `FRONTEND_URL`.
- `POST /api/auth/reset-password` — menerima token sekali pakai dan kata sandi baru (12–72 byte UTF-8); token disimpan sebagai hash, berlaku 30 menit, dan perubahan mencabut semua sesi.
- `PATCH /api/profile`, `POST /api/profile/photo`, `GET /api/profile/photo`, `PATCH /api/profile/password`
- `GET /api/admin/users`, `POST /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/reset-password` (Admin-only)
- `GET /api/dashboard` — metrik status pekerja, dokumen yang perlu ditindaklanjuti, dan klaim presensi pending untuk tenant aktif
- `GET /api/admin/document-settings`, `PATCH /api/admin/document-settings` — baca/simpan default ambang pemantauan masa berlaku dokumen per tenant (1–365 hari; default 30; Admin-only); nilai ini menjadi fallback jenis dokumen.
- `GET /api/admin/attendance-settings`, `POST /api/admin/attendance-settings/salt` — cek status/generate/rotasi salt perusahaan (Admin-only).
- `PATCH /api/admin/attendance-settings` — mengaktifkan atau menonaktifkan Anti-Mock Location untuk tenant (Admin-only).
- `GET /api/admin/attendance-locations`, `POST /api/admin/attendance-locations`, `DELETE /api/admin/attendance-locations/:id` — lokasi geofence dan aktivitas yang diwajibkan berada di tiap area (Admin-only).
- `GET /api/attendance?date=YYYY-MM-DD`, `GET /api/attendance/month?month=YYYY-MM` — data presensi tenant-scoped untuk Admin, HR Staff, dan Viewer.
- `DELETE /api/attendance/:workerId?date=YYYY-MM-DD` — soft-delete log presensi, Admin-only.
- `PATCH /api/attendance/:workerId/status`, `PATCH /api/attendance/:workerId/approval` — perubahan status manual dan persetujuan hanya Admin.
- `GET /api/attendance/:workerId/evidence?date=YYYY-MM-DD` — foto bukti presensi untuk role terautentikasi tenant.
- `POST /api/workers/:id/attendance-link` — buat/ambil tautan (Admin/HR Staff); `DELETE /api/workers/:id/attendance-link` — cabut tautan (Admin-only).
- `GET /api/public/attendance?worker_id=...&token=...`, `POST /api/public/attendance` — halaman publik memvalidasi link HMAC, aturan lokasi/radius, pengajuan status, dan check-in/out.
- `GET /api/workers`, `POST /api/workers`, `GET /api/workers/:id`
- `PATCH /api/workers/:id` — ubah data pekerja dan persyaratan dokumen, Admin-only.
- `POST /api/admin/workers/import` — terima hingga 500 baris pekerja sebagai JSON, Admin-only; file Excel diproses client-side dan tidak disimpan di server.
- `DELETE /api/workers/:id`, `DELETE /api/workers/:id/documents/:documentId` — arsipkan data worker/catatan dokumen (soft-delete, Admin-only).
- `GET /api/departments` — daftar departemen/divisi yang tersimpan pada tenant aktif
- `GET /api/document-types` — katalog jenis dokumen dinamis per tenant termasuk ambang peringatan spesifik (null mengikuti default tenant)
- `POST /api/admin/document-types`, `PATCH /api/admin/document-types/:code` — PATCH juga dapat mengubah `warning_threshold_days` menjadi 1–365 atau `null` untuk kembali ke default tenant (Admin-only)
- `GET /api/workers/:id/eligibility`
- `POST /api/workers/:id/documents`
- `PATCH /api/workers/:id/status`

Penonaktifan dapat dijadwalkan melalui `effective_date`. Jadwal disimpan per pekerja dan diproses saat startup serta setiap menit; saat jatuh tempo backend mengubah status, mencatat riwayat, dan mencabut tautan presensi.

Hak akses backend: `admin` mengelola pengaturan dan mutasi termasuk perubahan status, persetujuan, serta pencabutan link; `hr_manager` hanya membuat data pekerja/dokumen dan link presensi serta membaca data operasional; `viewer` hanya membaca. Endpoint API tetap memvalidasi role meskipun permintaan dibuat langsung tanpa UI.

Sesi menggunakan cookie HttpOnly; password disimpan sebagai hash. Endpoint pekerja mensyaratkan sesi. Aktivasi ditolak jika dokumen wajib tidak lengkap atau tidak valid pada tanggal hari ini. Kelayakan tidak mengubah status secara otomatis.

Route profil dan password mensyaratkan autentikasi; operasi pengelolaan akun dan katalog dokumen dibatasi Admin pada backend, bukan hanya disembunyikan di UI. Akun baru menerima role `admin`, `hr_manager` (HR Staff), atau `viewer`. Admin dapat mengubah role/status serta mereset password user tenant yang sama. Admin tidak dapat menurunkan/menonaktifkan dirinya sendiri atau menghilangkan admin aktif terakhir. Perubahan role/status/password mencabut sesi akun terkait. Jangan mengirim password awal melalui kanal publik; gunakan HTTPS dan sampaikan kepada pengguna melalui kanal aman.

Pengaturan lokasi menggunakan tile CARTO Light dengan API key frontend `VITE_CARTO_API_KEY`, serta atribusi OpenStreetMap dan CARTO yang diwajibkan. Karena key dikirim dari browser, batasi website/referrer key pada host aplikasi yang digunakan (misalnya `localhost` untuk pengembangan dan domain produksi); penggunaan tile tetap tunduk pada ketentuan CARTO. Aktivitas yang dicentang untuk suatu lokasi wajib dilakukan dalam radius salah satu lokasi yang mencentang aktivitas tersebut; aktivitas yang tidak dicentang di lokasi mana pun boleh dilakukan dari luar area. Backend menegakkan aturan ini dengan jarak Haversine dan mencatat lokasi yang cocok. Dinas dikecualikan dari geofence; bukti JPG/PNG wajib saat check-in Dinas dan disimpan sebagai BLOB maksimal 900 KiB, menunggu keputusan HR. Bukti dan koordinat memerlukan kebijakan retensi sebelum produksi; koordinat browser tidak melawan GPS spoofing.

Data pekerja mencakup kontak, NIK, alamat, departemen/divisi, kontrak, tanggal bergabung, dan rate gaji. Departemen dapat dipilih dari `GET /api/departments` atau diketik sebagai nilai baru. Nama, alamat, departemen, posisi, area kerja, serta nama jenis dokumen dinormalisasi server-side (trim, rapikan spasi, lowercase); UI menampilkannya dalam uppercase dengan CSS. Nama departemen disimpan unik per tenant menggunakan hash dari nilai normalisasi. Informasi kontak pribadi, NIK, alamat, dan rate gaji tidak dikirimkan ke peran `viewer`; batasi akses database dan lindungi backup karena data disimpan pada basis data tenant.

Presensi menggunakan tabel `tenant_attendance_settings`, `worker_attendance_links`, dan `attendance`. Admin membuat atau merotasi salt tenant acak 256-bit; secret tidak pernah dikembalikan API. Link statis `/presensi?worker_id=...&token=...` merupakan HMAC-SHA256 dari tenant, ID pekerja, salt perusahaan, serta `JWT_SECRET`; hanya hash link yang disimpan untuk revokasi. Worker ID tanpa token tidak dapat melihat atau mencatat presensi. Rotasi salt atau perubahan `JWT_SECRET` membatalkan semua link; buat dan bagikan ulang link melalui dashboard. Link hanya berlaku untuk pekerja aktif. Halaman pekerja mengambil profil dan maksimum 30 riwayat dari API publik bertoken. Check-in/out wajib menyertakan koordinat geolocation valid dan waktu otomatis dari database. Anti-Mock Location opsional menolak mock flag yang dilaporkan browser, akurasi di atas 1.000 m, kecepatan di atas 300 m/s, dan lompatan lokasi historis server di atas 300 m/s dalam 24 jam. Ini hanya mitigasi best-effort: browser tidak menyediakan bukti GPS yang dapat dipercaya dan request klien dapat dimodifikasi; untuk attestation kuat diperlukan aplikasi native dan integritas perangkat. Geofence menegakkan aktivitas yang ditandai wajib berada di area, tetapi tidak dengan sendirinya mencegah spoofing. HR dapat mencatat izin/sakit/tidak hadir sebelum ada check-in. `CURDATE()`/`CURRENT_TIMESTAMP` mengikuti timezone koneksi/database, jadi sesuaikan timezone dengan kebijakan operasional perusahaan. Kolom koordinat baru ditambahkan otomatis pada startup backend untuk database lama.

Jenis dokumen persyaratan disimpan dalam tabel `document_types` per tenant. Katalog tenant baru kosong tanpa pilihan bawaan; Admin menambahkan jenis dan memilih persyaratan pekerja sendiri melalui Pengaturan. Nama disimpan lowercase setelah trim/spasi dirapikan; UI menampilkannya uppercase. Kode sistem dibuat dari nama dengan huruf kecil dan underscore (contoh `Sertifikat K3` → `sertifikat_k3`), dan nomor ditambahkan bila kode bentrok. Edit nama mempertahankan kode agar riwayat dan relasi lama tidak berubah. Jenis nonaktif tidak tersedia untuk pekerja baru, tetapi masih dapat dicatat untuk melengkapi persyaratan pekerja yang sudah ada. Bootstrap menormalkan data teks lama ke lowercase; jenis bawaan lama yang tak dipakai dihapus, sedangkan yang sudah dirujuk dipertahankan nonaktif. Kolom `documents.type` menggunakan `VARCHAR(64)` agar mendukung katalog dinamis. Kode legacy `mcu`, `pkwt`, dan `sim` tetap memerlukan tanggal kedaluwarsa untuk memenuhi syarat aktivasi; jenis lain tidak memiliki kewajiban tanggal akhir secara default. Hasil pemeriksaan medis, catatan bebas, serta alasan status tidak disimpan.

Saat mencatat dokumen, status `pending` menerima `target_completion_date` dan tidak menyimpan masa berlaku; status `valid`/`expired` menerima `valid_from`/`valid_until`; status `rejected` mengabaikan dan mengosongkan semua tanggal. Kolom target selesai dibuat otomatis untuk database lama.

## Pengujian

Jalankan `npm test`. Pengujian unit tidak membutuhkan server MySQL. Uji integrasi startup dan API memerlukan MySQL yang sesuai dengan konfigurasi `.env`.
