# Frontend Tasks

Backlog frontend SaaS HRD. MVP memakai React + Vite dan tidak menampilkan data demo.

Status: `Todo` · Prioritas: `P0` (MVP) / `P1` (lanjutan)

## P0 — MVP

- [x] **Siapkan React + Vite** — Kerangka aplikasi, proxy API untuk pengembangan, dan layout responsif.
- [x] **Bangun autentikasi perusahaan** — Form registrasi perusahaan/login yang memakai sesi cookie HttpOnly dari backend.
- [x] **Bangun dashboard status worker** — Ringkasan offering, pra-aktif, aktif, nonaktif, serta jumlah dokumen yang segera kedaluwarsa; widget Tindak Lanjut Dokumen menampilkan hingga lima dokumen terdekat dengan nama pekerja, ambang efektif per jenis, tanggal berakhir, dan tautan ke profil/dokumen. Widget Pusat Persetujuan menampilkan jumlah klaim presensi pending dan tautan ke panel presensi.
- [x] **Bangun riwayat aktivitas** — Feed audit terbaru tenant untuk Admin/HR Staff dengan aktor, role, waktu, aksi, dan ringkasan perubahan.
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

- [x] **Bangun landing page dan autentikasi** — Halaman root menampilkan brand rusakparah.web.id, navigasi, ringkasan fitur, ilustrasi preview statis, dan form login/registrasi yang tetap terhubung ke API autentikasi.
- [x] **Tambah navigasi dan riwayat changelog** — Landing page memiliki tautan Changelog dengan rilis dan fitur yang sudah tersedia dalam urutan terbaru ke fondasi produk.
- [x] **Tambah pemulihan kata sandi** — Form lupa kata sandi mengirim permintaan generik melalui API dan tautan reset membuka form kata sandi baru.
- [x] **Tampilkan paket dan kuota Free** — Dashboard/Data Pekerja memperlihatkan penggunaan kuota 20 pekerja aktif; Pengaturan menampilkan paket Free serta Pro/Enterprise sebagai belum tersedia tanpa aksi upgrade.
- [x] **Sinkronkan UI secara real-time** — Socket.IO memicu pemuatan ulang data ringkasan, pekerja, presensi, pengaturan, dan riwayat sesuai panel yang aktif; Ringkasan dan History juga memiliki refresh berkala 15 detik.
- [x] **Sediakan pilihan tema lokal** — Standard, Dark, dan Compact/Clean disimpan per browser.
- [x] **Rapikan sistem visual dan responsivitas** — Terapkan tipografi Inter dengan fallback sistem lokal, hierarki teks, whitespace, kartu/bentuk tombol konsisten, status soft-badge, pencarian dokumen yang jelas, dan breakpoint mobile tanpa menambah framework styling baru.
- [x] **Standarkan ikon antarmuka** — Gunakan Lucide React dengan gaya outline dan ukuran konsisten pada navigasi, dashboard, landing page, aksi utama, status, menu pengaturan, dan portal presensi; kontrol ikon-only tetap memiliki nama aksesibel.
- [x] **Bangun halaman dan rekap presensi** — Halaman mobile `Presensi.jsx` dengan profil, jam WIB realtime, log hari ini, riwayat presensi dan pengajuan bulanan, autentikasi UUID perangkat, clock in/out geolokasi, rekap HRD, dan pengaturan tautan portal perusahaan.
- [x] **Tampilkan tautan portal perusahaan di menu Presensi** — Admin dapat menyalin tautan kapan saja; backend menyimpan token terenkripsi agar dapat dipulihkan setelah reload, sementara nilai hash tetap digunakan untuk verifikasi.
- [x] **Sederhanakan autentikasi portal pekerja** — Hilangkan kolom UUID pada UI; UUID tetap dimuat dari `localStorage` dan dikirim ke backend otomatis bersama nomor pekerja.
- [x] **Tambahkan Kunci UUID per pekerja** — Admin/HR Staff dapat mengganti switch di tabel pekerja; mode nonaktif merotasi sesi saat UUID klien hilang/berbeda untuk pemulihan `localStorage` iOS.
- [x] **Kelola geofence dan persetujuan presensi** — Peta Leaflet lokasi/radius/checkbox aktivitas, pengajuan Dinas dengan bukti gambar, serta tindakan persetujuan HR di rekap.
- [x] **Tambah Anti-Mock Location best-effort** — Switch Admin dan pemeriksaan mock flag, akurasi, serta kecepatan di portal; batas deteksi browser dijelaskan pada UI.
- [ ] **Tambah upload dan pratinjau dokumen** — Tunggu keputusan penyimpanan, izin akses, enkripsi, dan retensi.
- [ ] **Tambah pengingat dan filter masa berlaku** — Setelah aturan waktu tindak lanjut disepakati.
- [ ] **Tambah undangan dan izin terperinci** — Lengkapi manajemen MVP dengan proses undangan dan matriks izin yang lebih granular.
- [ ] **Tambah perubahan persyaratan per posisi/client** — Ikuti konfigurasi persyaratan yang disepakati.
- [ ] **Lanjutkan pemecahan modul frontend** — Komponen autentikasi, pekerja, presensi, pengaturan, peta, dan kartu metrik sudah dipisah; `App.jsx` masih mengorkestrasi state dan alur data utama sehingga ekstraksi lanjutan perlu menjaga perilaku lintas fitur.

## Catatan

- Data operasional berasal dari API dan tidak memakai seed worker/dokumen. Angka di ilustrasi landing page adalah preview statis, bukan data perusahaan.
- Jangan tampilkan hasil MCU atau informasi medis rinci.
- Validasi build/test dilakukan dengan perintah yang tercantum dalam `README.md`.
