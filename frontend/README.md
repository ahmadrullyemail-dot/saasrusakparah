# Frontend HRD Management

Antarmuka React + Vite untuk SaaS HRD.

## Menjalankan lokal

1. Gunakan Node.js 20.19+; jalankan API backend di port 4000 dan siapkan konfigurasi MySQL sesuai `../backend/README.md`.
2. Jalankan `npm install`.
3. Salin `.env.example` ke `.env.local` dan isi `VITE_CARTO_API_KEY` dengan API key CARTO.
4. Jalankan `npm run dev`, lalu buka alamat lokal yang ditampilkan Vite.

Vite meneruskan request `/api` dan Socket.IO `/socket.io` (termasuk upgrade WebSocket) ke `http://localhost:4000`. Tidak ada data contoh; daftar pekerja kosong sampai pengguna membuatnya.

## Deploy ke Vercel

Atur **Root Directory** proyek Vercel ke `frontend`, Framework Preset ke **Vite**, Build Command ke `npm run build`, dan Output Directory ke `dist`. `vercel.json` meneruskan `/api/*` serta `/socket.io/*` ke backend VM dan mengarahkan `/presensi` ke SPA. Jika alamat atau port backend berubah, perbarui destination tersebut. Backend harus dapat diakses dari jaringan Vercel pada port yang dikonfigurasi; untuk deployment publik, HTTPS pada backend/reverse proxy disarankan. Production client menggunakan transport polling Socket.IO karena koneksi polling dapat diteruskan oleh external rewrite Vercel; transport WebSocket tidak berhasil melewati konfigurasi rewrite yang digunakan. `server.proxy` di `vite.config.js` hanya digunakan oleh Vite development server dan bukan routing untuk deployment Vercel.

## Alur MVP

- Registrasi perusahaan dan login admin.
- Tambah pekerja pasca-offering melalui modal dari dashboard, termasuk kontak wajib, departemen/divisi, posisi, data kontrak, tanggal, dan rate gaji; pemilihan dokumen untuk pemantauan opsional dan dokumen dapat dicatat kemudian.
- Field Departemen/Divisi menawarkan daftar nilai yang disimpan per tenant dan tetap menerima nama baru; backend menormalisasi format teks saat menyimpan.
- Pengaturan Profil Saya: lihat dan ubah nama, unggah foto profil JPG/PNG dari perangkat, lihat email/role, dan ganti password dengan verifikasi password lama.
- Pengaturan Presensi memuat peta Leaflet dengan basemap CARTO Light menggunakan `VITE_CARTO_API_KEY` dan atribusi OpenStreetMap/CARTO untuk lokasi geofence, radius, dan aktivitas yang diwajibkan di tiap area. Browser mengirim key tersebut ke CARTO, jadi batasi key dengan website/referrer yang tepat (contoh host lokal `localhost` dan domain produksi) di dashboard CARTO. Hanya aktivitas yang dicentang yang harus berada dalam radius salah satu area terkait; aktivitas yang tidak dicentang di area mana pun boleh dilakukan dari luar geofence. Dinas bebas geofence dengan bukti JPG/PNG terkompresi maksimal 900 KiB dan persetujuan HR.
- Admin dapat mengaktifkan Anti-Mock Location. Portal memeriksa `isMocked` bila browser/perangkat menyediakannya, kualitas akurasi dan sinyal kecepatan; backend menolak penanda mock, nilai akurasi buruk/kecepatan tak masuk akal, serta lompatan lokasi yang mustahil dibanding riwayat. Ini best-effort saja: browser web tidak dapat membuktikan keaslian GPS dan sinyal klien dapat dimanipulasi; perlindungan kuat memerlukan aplikasi native dengan device attestation.
- Menu Presensi menyediakan metrik harian/bulanan, pusat tinjauan pengajuan pending dengan bukti Dinas serta aksi setuju/tolak, dan matriks kehadiran bulanan dengan pencarian, pagination, serta scroll horizontal. Status terlambat ditampilkan jika disediakan oleh data; jadwal shift dan kalkulasi keterlambatan otomatis belum tersedia.
- Ringkasan menampilkan metrik siklus pekerja, dokumen perlu tindak lanjut, dan klaim presensi pending dari backend; metrik diperbarui setiap 15 detik saat halaman Ringkasan aktif. Pengaturan Profil Saya menyediakan tema Standard, Dark Mode, dan Compact/Light Clean yang disimpan di localStorage browser.
- Saat sesi HRD valid, aplikasi membuka koneksi Socket.IO melalui cookie HttpOnly dan menerima event tenant-scoped untuk perubahan pekerja, dokumen, presensi, approval, pengaturan, serta metrik dashboard. Event menyegarkan state lokal pekerja, Ringkasan, matriks/operasional harian, dan History tanpa refresh manual; retry/reconnect dan polling berkala tetap menjadi fallback.
- Admin mengatur default peringatan dokumen 1–365 hari pada Pengaturan → Pengaturan Dokumen, serta dapat menentukan ambang khusus per jenis dokumen atau reset agar mengikuti default tenant. Dashboard dan daftar tindak lanjut memakai ambang efektif masing-masing jenis; dokumen kedaluwarsa tetap ditampilkan.
- Admin dapat membuka Manajemen Akun untuk melihat akun satu tenant dan membuat user ber-role Admin, HR Staff, atau Viewer. HR Staff dan Viewer tidak melihat bagian ini; backend juga memvalidasi izin.
- Data Pekerja menyediakan pencarian cepat; Admin dapat mengedit/mengarsipkan pekerja, menjadwalkan tanggal efektif nonaktif, serta mengimpor/mengekspor `.xlsx`. Workbook impor dibaca dan divalidasi di browser, maksimal 500 baris dan 10 MB; server hanya menerima record JSON untuk validasi dan penyimpanan. Nama/NIK/email duplikat dilewati dan hasil tiap baris ditampilkan.
- RBAC: Admin memiliki akses penuh; HR Staff dapat membuat dan membaca data operasional, tetapi kontrol perubahan status, persetujuan, dan pencabutan link hanya untuk Admin; Viewer hanya membaca. Menu Pengaturan selain Profil Saya dan Keamanan hanya tersedia untuk Admin. Backend menerapkan aturan yang sama pada endpoint, bukan hanya menyembunyikan kontrol frontend.
- Foto profil menerima JPG/PNG dan dikompresi di browser hingga maksimal 900 KiB sebelum disimpan backend dalam MySQL. Password baru minimal 12 karakter dan maksimal 72 byte UTF-8; password dikirim ke API melalui sesi cookie HttpOnly dan disimpan backend sebagai bcrypt hash.
- Catat status serta masa berlaku MCU, PKWT, sertifikasi, dan SIM.
- Lihat rekomendasi kelayakan; HRD secara manual mengubah status pekerja.
