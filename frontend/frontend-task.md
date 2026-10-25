# Frontend Tasks

Backlog frontend SaaS HRD. MVP memakai React + Vite dan tidak menampilkan data demo.

Status: `Todo` · Prioritas: `P0` (MVP) / `P1` (lanjutan)

## P0 — MVP

- [x] **Siapkan React + Vite** — Kerangka aplikasi, proxy API untuk pengembangan, dan layout responsif.
- [x] **Bangun autentikasi perusahaan** — Form registrasi perusahaan/login yang memakai sesi cookie HttpOnly dari backend.
- [x] **Bangun dashboard status worker** — Ringkasan offering, pra-aktif, aktif, nonaktif, serta jumlah dokumen yang segera kedaluwarsa.
- [x] **Bangun daftar dan formulir pekerja** — Filter status serta pencatatan pekerja setelah offering dan pilihan dokumen wajib.
- [x] **Tambah impor/ekspor dan aksi Admin** — Impor Excel diproses hanya di browser, ekspor `.xlsx`, duplikasi nama/NIK dilewati, edit/delete hanya untuk Admin.
- [x] **Tambah tanggal efektif nonaktif** — Admin dapat menjadwalkan perubahan status dan melihat tanggal jadwal pada daftar pekerja.
- [x] **Tambah pencarian profil pekerja** — Filter daftar pekerja dan pemilih profil cepat pada halaman Dokumen.
- [x] **Bangun pemantauan dokumen** — Catat jenis/status/tanggal berlaku MCU, PKWT, sertifikasi, dan SIM; tampilkan kelayakan dan masa berlaku.
- [x] **Bangun tindakan status manual** — Pra-aktif, aktif, nonaktif, dan reaktivasi sesuai kelayakan backend.
- [x] **Bangun Pengaturan akun** — Profil, unggah foto JPG/PNG yang dikompresi otomatis hingga 900 KiB, ubah password, dan manajemen user khusus Admin dalam tenant aktif.
- [x] **Bangun Pengaturan Dokumen** — Admin mengelola jenis dokumen; modal pekerja dan formulir pencatatan memakai opsi aktif dari backend.
- [x] **Verifikasi build produksi** — `npm run build` berhasil setelah tooling diperbarui.
- [ ] **Validasi alur UI dengan backend/MySQL** — Uji registrasi, login, tambah pekerja, pencatatan dokumen, status, dan error dengan database aktif.
- [ ] **Tambah pengujian frontend** — Uji kondisi kosong, loading/error, filter, formulir, dan aksesibilitas dasar.

## P1 — Pengembangan lanjutan

- [x] **Bangun halaman dan rekap presensi** — Halaman mobile `Presensi.jsx` dengan profil, jam WIB realtime, log hari ini, riwayat 30 hari, navigasi bawah, link HMAC statis, check-in/out geolokasi, rekap HRD, dan pengaturan salt Admin.
- [x] **Kelola geofence dan persetujuan presensi** — Peta Leaflet lokasi/radius/checkbox aktivitas, pengajuan Dinas dengan bukti gambar, serta tindakan persetujuan HR di rekap.
- [ ] **Tambah upload dan pratinjau dokumen** — Tunggu keputusan penyimpanan, izin akses, enkripsi, dan retensi.
- [ ] **Tambah pengingat dan filter masa berlaku** — Setelah aturan waktu tindak lanjut disepakati.
- [ ] **Tambah undangan dan izin terperinci** — Lengkapi manajemen MVP dengan proses undangan dan matriks izin yang lebih granular.
- [ ] **Tambah perubahan persyaratan per posisi/client** — Ikuti konfigurasi persyaratan yang disepakati.

## Catatan

- Aplikasi menampilkan data dari API saja; tidak ada worker/dokumen contoh.
- Jangan tampilkan hasil MCU atau informasi medis rinci.
- Validasi build/test dilakukan dengan perintah yang tercantum dalam `README.md`.
