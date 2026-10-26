# Backend Tasks

Backlog backend SaaS HRD. MVP dibangun dengan Node.js, Express, dan MySQL, tanpa data seed/mock.

Status: `Todo` · Prioritas: `P0` (MVP) / `P1` (lanjutan)

## P0 — MVP

- [x] **Tetapkan alur worker** — `offered` → `preactive` → `active` atau `inactive`; Admin mengubah status dan dapat menjadwalkan tanggal efektif nonaktif, dengan reaktivasi dari nonaktif.
- [x] **Definisikan persyaratan dokumen awal** — Jenis dokumen dikelola melalui katalog per tenant yang dimulai kosong; Admin menentukan jenis dan dokumen wajib per pekerja. MCU, PKWT, sertifikasi, dan SIM dapat dibuat sebagai jenis dokumen, bukan pilihan bawaan sistem. Tanggal kedaluwarsa digunakan sesuai konfigurasi jenis dan aturan kelayakan.
- [x] **Pilih stack dan database** — Node.js + Express + MySQL/MariaDB; database/tabel dibuat saat startup jika belum ada, tanpa seed/mock data.
- [x] **Bangun autentikasi tenant awal** — Pendaftaran perusahaan membuat tenant dan akun admin; cookie sesi HttpOnly dan query data dibatasi tenant.
- [x] **Buat kontrak API MVP** — Registrasi/login, dashboard, daftar/detail pekerja, kelayakan, pencatatan dokumen, dan perubahan status.
- [x] **Implementasikan model data** — Tenant, pengguna, pekerja, dokumen, dan riwayat status; relasi worker/dokumen menjaga tenant yang sama.
- [x] **Implementasikan evaluasi kelayakan** — Dokumen wajib harus valid dan masih berlaku; kelayakan tidak mengubah status otomatis.
- [x] **Jadwalkan penonaktifan pekerja** — Simpan tanggal efektif per pekerja dan proses jadwal jatuh tempo saat startup/berkala secara idempotent, catat riwayat, dan cabut tautan presensi.
- [x] **Catat audit trail tenant** — Simpan aktor/waktu/role/aksi dan ringkasan perubahan penting; endpoint riwayat dibatasi tenant dan role Admin/HR Staff, dengan pagination batas jumlah terbaru.
- [x] **Amankan impor pekerja masal** — Endpoint khusus Admin menerima JSON yang sudah diproses browser, memvalidasi hingga 500 record dan melewati duplikasi nama/NIK/email.
- [x] **Edit data pekerja sebagai Admin** — PATCH tenant-scoped memvalidasi field, email unik, dan persyaratan dokumen; soft-delete tetap dipakai untuk penghapusan.
- [x] **Batasi penyimpanan data MCU** — Simpan metadata dan status dokumen saja, bukan hasil medis rinci.
- [x] **Bangun profil dan keamanan akun** — Edit profil, unggah foto JPG/PNG tenant-scoped (signature divalidasi, batas 900 KiB agar kompatibel dengan `max_allowed_packet` MariaDB lama), ubah password terverifikasi, hash bcrypt, serta pencabutan sesi.
- [x] **Bangun manajemen user tenant** — Admin dapat membuat user, mengubah role/status, dan mereset password dengan pembatasan tenant serta proteksi admin terakhir.
- [x] **Bangun katalog jenis dokumen dinamis** — Katalog per tenant dimulai kosong; Admin dapat tambah/edit/nonaktifkan jenis, dan form pekerja serta pencatatan dokumen menggunakan katalog aktif.
- [ ] **Validasi startup dan endpoint dengan database aktif** — Jalankan API terhadap MySQL/MariaDB yang digunakan, verifikasi database/tabel dibuat otomatis dan semua alur MVP berfungsi.
- [x] **Tambahkan pengujian unit backend** — Uji kelayakan dokumen, tanggal, persyaratan wajib, dan transisi status.
- [ ] **Lengkapi pengujian integrasi backend** — Uji API/authentication, otomatisasi bootstrap schema, dan isolasi tenant dengan MySQL aktif.
- [ ] **Tentukan hardening produksi** — Putuskan migrasi skema berversi, undangan/reset password via email, retensi audit trail, backup, dan aturan operasional yang belum disepakati.

## P1 — Pengembangan lanjutan

- [x] **Terapkan paket dan kuota pekerja** — Paket Free menjadi default tenant dan membatasi 20 pekerja berstatus aktif yang tidak diarsipkan. API subscription menyajikan paket/pemakaian; backend menolak penambahan manual/impor saat kuota sudah penuh dan menolak aktivasi yang melampaui kuota.
- [x] **Tambahkan sinkronisasi real-time tenant** — Socket.IO berjalan pada HTTP server Express, memvalidasi sesi cookie dan tenant dari database, mengirim event metadata setelah perubahan berhasil, serta memeriksa validitas sesi secara berkala.
- [x] **Bangun presensi pekerja** — Salt tenant dan link HMAC statis, validasi worker aktif/tenant, check-in/out dengan geolokasi tervalidasi, status izin/sakit/tidak hadir, dan rekap HRD per tanggal.
- [x] **Tambahkan geofence dan approval presensi** — Lokasi tenant, aturan aktivitas/radius dengan validasi Haversine server-side, pengajuan Off/Izin/Cuti/Sakit, bukti Dinas JPG/PNG di MySQL, dan persetujuan HR.
- [x] **Tambahkan Anti-Mock Location best-effort** — Preferensi tenant Admin, validasi sinyal mock/akurasi/kecepatan request dan pemeriksaan lompatan lokasi terhadap riwayat; bukan GPS attestation dan perlu aplikasi native untuk jaminan kuat.
- [ ] **Tambah upload dan pengelolaan berkas** — Tentukan penyimpanan, akses, enkripsi, retensi, serta kebijakan data sensitif sebelum menyimpan salinan dokumen.
- [ ] **Tambah pengingat masa berlaku** — Implementasikan setelah ambang waktu, penerima, dan kanal notifikasi disepakati.
- [ ] **Tambah aturan dokumen berdasarkan posisi/client** — Kelola template persyaratan setelah variasi per client dan posisi dikonfirmasi.
- [ ] **Tambah undangan dan izin terperinci** — Dukung alur undangan HRD/client dan matriks izin lebih granular dari role dasar MVP.

## Catatan

- Variabel koneksi dan prasyarat MySQL ada di `README.md` dan `.env.example`.
- File SQLite legacy `data/hrd.db` dibiarkan utuh, tidak digunakan, dan tidak dimigrasikan.
- Tandai tugas selesai hanya setelah implementasi dan validasi terkait selesai; catat keputusan yang masih terbuka.
