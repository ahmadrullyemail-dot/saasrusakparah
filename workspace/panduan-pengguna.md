# Panduan Pengguna & Dokumentasi Fungsional

**rusakparah.web.id**  
Panduan untuk Admin, HR Staff, dan Viewer  
Versi dokumen: 1.0 · Diperbarui: 25 Oktober 2026

> **Panduan PDF A4:** Versi siap dibagikan dengan tangkapan layar aplikasi tersedia di [Panduan Pengguna A4](./panduan-pengguna-a4.pdf). Screenshot modul internal memakai data simulasi, bukan data perusahaan. File Markdown ini menjadi referensi teks; placeholder screenshot di bawah bukan bagian dari PDF final.

## Daftar Isi

1. [Pengantar](#1-pengantar)
2. [Mulai menggunakan aplikasi](#2-mulai-menggunakan-aplikasi)
3. [Tata letak dan navigasi](#3-tata-letak-dan-navigasi)
4. [Peran dan hak akses](#4-peran-dan-hak-akses)
5. [Ringkasan / Dashboard](#5-ringkasan--dashboard)
6. [Manajemen pekerja](#6-manajemen-pekerja)
   - [Kuota paket Free](#65-kuota-paket-free)
7. [Presensi, matriks bulanan, dan pusat persetujuan](#7-presensi-matriks-bulanan-dan-pusat-persetujuan)
8. [Portal Presensi Pekerja](#8-portal-presensi-pekerja)
9. [Dokumen dan masa berlaku](#9-dokumen-dan-masa-berlaku)
10. [Pengaturan dan tema](#10-pengaturan-dan-tema)
11. [Riwayat aktivitas](#11-riwayat-aktivitas)
12. [Pemecahan masalah](#12-pemecahan-masalah)
13. [Catatan keamanan dan batasan](#13-catatan-keamanan-dan-batasan)

## 1. Pengantar

rusakparah.web.id adalah pusat operasional HRD untuk mengelola siklus pekerja setelah menerima offering letter, kelengkapan dokumen, status keaktifan, dan presensi. Aplikasi membantu HRD melihat kondisi operasional perusahaan, menindaklanjuti dokumen yang mendekati atau melewati masa berlaku, serta meninjau pengajuan presensi.

Siklus status pekerja yang dikelola:

**Offering → Pra-aktif → Aktif → Nonaktif**

Pekerja dapat diaktifkan setelah persyaratan dokumen yang ditetapkan perusahaan terpenuhi. Kelayakan yang ditampilkan aplikasi merupakan rekomendasi; perubahan status tetap dilakukan oleh Admin.

## 2. Mulai menggunakan aplikasi

1. Buka alamat aplikasi yang disediakan perusahaan, misalnya `http://localhost:5173/` untuk lingkungan lokal.
2. Masuk menggunakan akun perusahaan. Jika perusahaan belum terdaftar dan pendaftaran dibuka, Admin pertama dapat membuat tenant perusahaan melalui halaman registrasi.
3. Setelah login, aplikasi menampilkan menu Ringkasan. Menu dan tindakan yang tersedia menyesuaikan role akun.
4. Gunakan tombol **Keluar** di sidebar untuk mengakhiri sesi.

> [Placeholder screenshot — Halaman login atau tampilan awal setelah login]
>
> *Sisipkan gambar layar login dan Ringkasan awal di sini.*

## 3. Tata letak dan navigasi

### 3.1 Sidebar

Navigasi utama berada di sisi kiri layar. Sidebar **diringkas/minimize secara default**, sehingga ikon menu ditampilkan tanpa label panjang. Arahkan kursor ke ikon untuk melihat tooltip nama menu. Gunakan tombol panah di bagian atas sidebar untuk memperluas atau meringkasnya.

Menu yang dapat tersedia:

- **Ringkasan** — metrik operasional perusahaan.
- **Data pekerja** — pencarian, daftar, detail, dan tindakan pekerja sesuai role.
- **Dokumen & masa berlaku** — pemantauan kelengkapan serta masa berlaku dokumen.
- **Presensi** — metrik, pusat persetujuan, matriks bulanan, dan operasional harian.
- **Riwayat aktivitas** — audit trail untuk Admin dan HR Staff.
- **Pengaturan** — profil, keamanan, dan pengaturan perusahaan sesuai role.

Menu **Riwayat aktivitas** tidak ditampilkan kepada Viewer. Tab pengaturan perusahaan juga dibatasi untuk Admin.

> [Placeholder screenshot — Sidebar dalam mode minimize dan mode diperluas]
>
> *Sisipkan screenshot yang menunjukkan ikon, tooltip, dan tombol toggle sidebar.*

### 3.2 Area kerja

Area utama berada di sebelah kanan sidebar. Bagian atas menampilkan judul ruang kerja, indikator koneksi real-time, tombol **Tambah Pekerja** jika role mengizinkan, serta profil pengguna.

Indikator **Live** menunjukkan koneksi real-time aktif. Jika koneksi terputus, aplikasi mencoba tersambung kembali; pembaruan berkala tetap digunakan sebagai fallback.

## 4. Peran dan hak akses

| Fitur | Admin | HR Staff | Viewer |
|---|---:|---:|---:|
| Melihat dashboard dan data operasional tenant | Ya | Ya | Ya |
| Membuat pekerja dan mencatat dokumen | Ya | Ya | Tidak |
| Mengubah atau mengarsipkan data pekerja/dokumen | Ya | Tidak | Tidak |
| Mengubah status siklus pekerja | Ya | Tidak | Tidak |
| Membuat link presensi pekerja | Ya | Ya | Tidak |
| Mengelola pengaturan perusahaan | Ya | Tidak | Tidak |
| Menyetujui/menolak klaim presensi | Ya | Tidak | Tidak |
| Melihat Riwayat Aktivitas | Ya | Ya | Tidak |
| Mengelola profil sendiri dan keamanan akun | Ya | Ya | Ya |

Hak akses diperiksa di backend, bukan hanya dengan menyembunyikan tombol pada antarmuka. Viewer menggunakan aplikasi dalam mode baca.

## 5. Ringkasan / Dashboard

Dashboard menampilkan enam metrik:

- **Offering** — pekerja pada tahap offering.
- **Pra-aktif** — pekerja yang sedang melengkapi persyaratan sebelum aktif.
- **Aktif** — pekerja dengan status aktif.
- **Nonaktif** — pekerja dengan status nonaktif.
- **Dokumen perlu tindak lanjut** — dokumen yang masuk ambang peringatan efektif atau sudah kedaluwarsa.
- **Klaim presensi pending** — klaim yang masih menunggu keputusan.

Metrik bersumber dari backend. Saat terjadi perubahan operasional, aplikasi menyegarkan dashboard secara real-time melalui koneksi Socket.IO. Ringkasan juga diperbarui berkala sebagai fallback saat halaman Ringkasan dibuka.

> [Placeholder screenshot — Kartu metrik Ringkasan]
>
> *Sisipkan screenshot dashboard yang menampilkan enam kartu metrik dan indikator Live.*

## 6. Manajemen pekerja

### 6.1 Menambah pekerja

Admin dan HR Staff dapat menambahkan pekerja setelah menerima offering letter:

1. Buka **Data pekerja** atau gunakan tombol **Tambah Pekerja**.
2. Isi identitas dan kontak sesuai formulir, termasuk nama, email, nomor telepon, NIK jika tersedia, departemen, posisi, serta data kontrak dan tanggal.
3. Pilih jenis dokumen yang wajib dipenuhi pekerja.
4. Simpan data. Pekerja baru dimulai pada status **Offering**.

### 6.2 Mencari dan membuka profil

Gunakan kolom pencarian pada Data pekerja untuk mencari berdasarkan nama, NIK, posisi, atau departemen. Pilih filter status untuk mempersempit daftar. Klik nama pekerja untuk membuka profil dan melihat dokumen, riwayat status, dan rekomendasi kelayakan.

### 6.3 Mengubah status dan jadwal nonaktif

Admin mengelola transisi status dari area detail/profil pekerja:

1. Buka profil pekerja.
2. Pilih status tujuan yang tersedia sesuai transisi siklus.
3. Untuk menonaktifkan di kemudian hari, pilih tanggal efektif nonaktif lalu simpan.
4. Jadwal akan ditampilkan pada data pekerja dan backend mengubah status menjadi **Nonaktif** saat tanggalnya tiba.

Perubahan status langsung hanya tersedia jika transisi diizinkan. Aktivasi pekerja memerlukan seluruh dokumen wajib terbaru berstatus valid dan masih berlaku. Penonaktifan pekerja juga mencabut link presensi aktifnya.

### 6.4 Impor dan ekspor Excel

Fitur impor/ekspor tersedia untuk Admin:

**Impor**

1. Pilih **Unduh template Excel** untuk memperoleh format kolom yang sesuai.
2. Isi workbook dengan data pekerja. Gunakan kode jenis dokumen yang berlaku, dipisahkan koma, untuk daftar persyaratan.
3. Pilih **Impor Excel**, lalu pilih file `.xlsx`.
4. File diproses di browser dan tidak disimpan sebagai berkas di server. Aplikasi mengirimkan data baris untuk divalidasi backend.
5. Tinjau hasil: jumlah berhasil ditambahkan, dilewati, dan baris bermasalah. Buka **Lihat detail baris** untuk rincian.

Impor menerima maksimal **500 baris**. Baris duplikat berdasarkan **nama, NIK, atau email** akan dilewati. Baris yang tidak valid dilaporkan sebagai kesalahan, bukan disimpan.

**Ekspor**

Pilih **Ekspor Excel** untuk mengunduh data pekerja yang tersedia dalam daftar saat ini.

### 6.5 Kuota paket Free

Paket **Free** membatasi perusahaan hingga **20 pekerja aktif**. Pemakaian kuota ditampilkan pada Ringkasan dan Data Pekerja, misalnya `12/20 Pekerja`. Pekerja berstatus Offering, Pra-aktif, atau Nonaktif tidak dihitung sebagai pekerja aktif. Saat kuota penuh, penambahan pekerja manual, impor Excel, dan aktivasi pekerja baru ditolak oleh backend. Arsipkan atau nonaktifkan pekerja aktif sesuai prosedur perusahaan untuk menyediakan kembali kuota.

Pada Pengaturan → **Paket Langganan**, Admin dapat melihat paket dan pemakaian kuota. Paket **Pro** dan **Enterprise** berstatus **Segera Hadir** dan tombolnya belum dapat digunakan.

> [Placeholder screenshot — Kontrol pencarian, filter, impor, ekspor, dan aksi pekerja]
>
> *Sisipkan screenshot daftar pekerja dengan kontrol Admin. Jangan sertakan data pribadi nyata dalam gambar dokumentasi.*

## 7. Presensi, matriks bulanan, dan pusat persetujuan

Buka menu **Presensi** untuk melihat ringkasan dan operasional presensi.

### 7.1 Kartu metrik

Empat kartu di bagian atas menunjukkan:

- **Pegawai aktif** — jumlah pekerja aktif pada matriks periode.
- **Tercatat masuk** — jumlah catatan dengan waktu Check-In pada periode tersebut.
- **Total log presensi** — jumlah log presensi yang tercatat pada periode tersebut.
- **Klaim pending** — jumlah pengajuan yang menunggu tinjauan.

Gunakan pemilih **Bulan** untuk mengganti periode matriks, pusat persetujuan, dan rekap yang ditampilkan.

### 7.2 Pusat Persetujuan

Bagian **Pusat Persetujuan** menampilkan klaim pending pada bulan terpilih. Kartu klaim berisi nama dan posisi pekerja, jenis/status pengajuan, tanggal, waktu masuk jika tersedia, serta tombol **Tinjau Bukti & Validasi**.

1. Admin memilih **Tinjau Bukti & Validasi**.
2. Periksa detail pengajuan dan bukti yang dilampirkan, jika ada.
3. Pilih **Setujui** atau **Tolak**; tambahkan catatan bila diperlukan.
4. Setelah keputusan tersimpan, status klaim dan metrik terkait diperbarui untuk klien yang terhubung.

HR Staff dan Viewer dapat melihat daftar pending, tetapi keputusan persetujuan hanya dapat dilakukan Admin.

### 7.3 Matriks presensi bulanan

Matriks menampilkan satu baris per pekerja dan kolom tanggal dinamis sesuai jumlah hari dalam bulan aktif. Kolom kiri memuat identitas pekerja; kolom kanan memuat rekap kode status. Matriks dapat digulir horizontal.

Legenda kode:

| Kode | Arti |
|---|---|
| **H** | Hadir |
| **T** | Terlambat |
| **I** | Izin/Cuti |
| **S** | Sakit |
| **X** | Inkomplit |
| **P** | Pending |

Gunakan pencarian nama/posisi, pemilih jumlah baris (**25, 50, atau 100**), serta tombol pagination untuk menavigasi daftar. Status terlambat ditampilkan jika tersedia pada data; sistem belum menghitung keterlambatan berdasarkan jadwal shift otomatis.

**Buka operasional harian langsung dari matriks**

1. Temukan baris pekerja yang ingin diperiksa.
2. Klik sel pada tanggal yang diperlukan.
3. Aplikasi memilih tanggal tersebut dan menggulir ke bagian **Operasional Harian**.
4. Periksa waktu Check-In/Check-Out, status, koordinat lokasi, dan tindakan yang diizinkan.

Pemilih tanggal di Operasional Harian tetap tersedia sebagai cara alternatif memilih tanggal.

> [Placeholder screenshot — Presensi: metrik, Pusat Persetujuan, dan matriks]
>
> *Sisipkan screenshot dengan bulan, legenda, kontrol pencarian, dan pagination.*
>
> [Placeholder screenshot — Sel matriks dipilih dan Operasional Harian]
>
> *Sisipkan dua screenshot atau satu screenshot beranotasi yang menunjukkan sel tanggal dan bagian Operasional Harian yang terbuka.*
>
> [Placeholder screenshot — Dialog tinjau klaim]
>
> *Sisipkan screenshot tinjauan bukti dengan data dummy/samaran dan tombol keputusan.*

## 8. Portal Presensi Pekerja

Portal pekerja dibuka menggunakan tautan personal yang memuat identitas pekerja dan token akses, biasanya berbentuk:

`/presensi?worker_id=…&token=…`

Tautan dibuat HRD dari Data pekerja. Bagikan melalui kanal yang aman; siapa pun yang memiliki tautan dapat mengakses portal pekerja terkait. Jika salt perusahaan dirotasi, semua link lama tidak berlaku dan HRD perlu membuat serta membagikan tautan baru.

### 8.1 Check-In dan Check-Out

1. Pekerja membuka tautan pada browser/perangkat yang mengizinkan akses lokasi.
2. Periksa nama perusahaan, nama pekerja, tanggal, dan status hari ini.
3. Pilih aktivitas yang sesuai bila diminta.
4. Tekan **Check-In / Hadir**. Berikan izin lokasi ketika browser memintanya.
5. Setelah Check-In tercatat, portal menampilkan waktunya. Pekerja dapat melakukan **Check-Out** saat selesai bekerja.

Portal mencatat waktu berdasarkan server dan menyertakan koordinat lokasi. Jika aktivitas diwajibkan pada geofence, pekerja harus berada dalam radius salah satu area yang memenuhi aturan aktivitas tersebut. Dinas dapat dilakukan di luar geofence, tetapi Check-In Dinas memerlukan foto bukti JPG/PNG; pengajuan Dinas menunggu persetujuan Admin.

Pengajuan Off, Izin, Cuti, atau Sakit dikirim sebagai klaim dan akan menunggu persetujuan HR sesuai alur perusahaan.

### 8.2 Anti-Mock Location

Jika Admin mengaktifkan **Anti-Mock Location**, portal dan server memeriksa sinyal lokasi yang tersedia. Presensi dapat diblokir bila browser melaporkan lokasi mock, akurasi lebih buruk dari 1.000 meter, kecepatan tidak masuk akal, atau perpindahan lokasi tidak realistis.

Aktifkan izin lokasi presisi dan coba kembali di area dengan sinyal GPS yang baik bila pemeriksaan menolak lokasi.

> [Placeholder screenshot — Portal pekerja sebelum dan sesudah Check-In]
>
> *Sisipkan screenshot portal tanpa menampilkan token URL atau informasi personal nyata.*
>
> [Placeholder screenshot — Peringatan Anti-Mock Location]
>
> *Sisipkan screenshot pesan peringatan dengan identitas dan koordinat yang disamarkan.*

## 9. Dokumen dan masa berlaku

Menu **Dokumen & masa berlaku** digunakan untuk mencari pekerja, melihat kelayakan, mencatat dokumen, dan menindaklanjuti masa berlaku. Jenis dokumen dikelola pada Pengaturan Dokumen oleh Admin.

Pencatatan dokumen menyesuaikan status:

- **Menunggu/Pending** — dapat mencatat target penyelesaian.
- **Valid/Kedaluwarsa** — mencatat rentang tanggal berlaku.
- **Ditolak** — ditampilkan tanpa tanggal berlaku.

Hanya catatan terbaru per jenis yang dipakai sebagai acuan persyaratan. Dokumen yang tidak valid atau sudah melewati tanggal berlaku dapat menghalangi aktivasi pekerja. Dashboard dan daftar tindak lanjut menggunakan ambang peringatan efektif per jenis; dokumen kedaluwarsa tetap masuk daftar.

> [Placeholder screenshot — Profil pekerja dan panel dokumen]
>
> *Sisipkan screenshot profil dengan dokumen contoh dan data yang disamarkan.*

## 10. Pengaturan dan tema

### 10.1 Profil Saya dan Keamanan

Semua role dapat membuka **Profil Saya** untuk mengubah nama dan foto profil, serta memilih tema. Pada **Keamanan**, pengguna dapat mengganti password dengan memasukkan password lama dan konfirmasi password baru. Password baru minimal 12 karakter; sesi di perangkat lain akan dicabut setelah perubahan.

### 10.2 Pengaturan Dokumen

Admin membuka **Pengaturan → Pengaturan Dokumen** untuk:

1. Mengatur ambang peringatan default perusahaan dari **1 sampai 365 hari**.
2. Menambah jenis dokumen, mengubah nama, atau mengaktifkan/menonaktifkan jenis.
3. Mengatur ambang peringatan khusus pada setiap jenis dokumen.
4. Mengosongkan override/reset agar jenis tersebut mengikuti ambang default perusahaan.

Pengaturan spesifik jenis dokumen mengalahkan nilai default perusahaan. Perubahan memengaruhi pemantauan masa berlaku dan ringkasan dashboard.

### 10.3 Pengaturan Presensi

Admin membuka tab **Pengaturan Presensi** untuk mengaktifkan atau menonaktifkan switch **Anti-Mock Location**, mengelola lokasi/geofence, serta membuat atau merotasi salt tautan presensi.

> **Perhatian:** Rotasi salt membatalkan semua link pekerja yang sudah dibagikan. Siapkan distribusi tautan pengganti sebelum melakukan rotasi.

### 10.4 Tema aplikasi

Pada bagian **Tema aplikasi** di Profil Saya, pilih salah satu tema:

- **Default / Standard** — tampilan standar.
- **Dark Mode** — tampilan gelap.
- **Compact / Light Clean** — tampilan terang dengan jarak antarkomponen lebih ringkas.

Tema diterapkan langsung dan tersimpan di `localStorage` browser untuk pengguna/peramban tersebut. Pengaturan ini tidak mengubah tema untuk pengguna lain dan tidak disimpan sebagai preferensi perusahaan.

> [Placeholder screenshot — Tab Pengaturan Dokumen, Pengaturan Presensi, dan pilihan tema]
>
> *Sisipkan screenshot terpisah untuk setiap pengaturan. Hindari menampilkan key, token, atau informasi rahasia.*

## 11. Riwayat aktivitas

Admin dan HR Staff dapat membuka **Riwayat aktivitas** untuk meninjau perubahan penting dalam tenant, termasuk aktor, role, waktu, jenis aksi, entitas, dan ringkasan perubahan. Daftar memuat hingga 100 aktivitas terbaru dan diperbarui otomatis.

Viewer tidak memiliki akses ke halaman maupun endpoint riwayat aktivitas.

> [Placeholder screenshot — Riwayat aktivitas]
>
> *Sisipkan screenshot feed dengan identitas dan rincian perusahaan yang disamarkan.*

## 12. Pemecahan masalah

| Kendala | Langkah yang disarankan |
|---|---|
| Tidak dapat Check-In/Check-Out | Pastikan tautan masih aktif, pekerja masih berstatus Aktif, dan izin lokasi browser menyala. |
| Lokasi di luar area kerja | Periksa aturan aktivitas dan radius lokasi pada portal. Aktivitas yang diwajibkan di geofence harus dilakukan di area yang cocok. |
| Anti-Mock Location menolak presensi | Aktifkan lokasi presisi, nonaktifkan aplikasi lokasi simulasi, dan coba kembali dengan sinyal GPS yang lebih baik. |
| Pengajuan tidak muncul pada Pusat Persetujuan | Pastikan bulan yang dipilih sesuai dengan tanggal pengajuan dan koneksi aplikasi aktif. |
| Pekerja tidak dapat diaktifkan | Periksa dokumen wajib, status dokumen terbaru, serta tanggal mulai dan akhir berlaku. |
| Link pekerja tidak berlaku | Admin perlu memeriksa status aktif pekerja dan menerbitkan ulang link, khususnya setelah rotasi salt. |
| Indikator Live tidak tersambung | Tunggu proses reconnect, periksa koneksi jaringan, lalu muat ulang aplikasi jika tetap tidak tersambung. Perubahan juga akan diperbarui melalui fallback berkala. |
| Impor Excel menandai baris bermasalah | Periksa format kolom dari template, nilai wajib, format tanggal, kode jenis dokumen, serta duplikasi nama/NIK/email. |

## 13. Catatan keamanan dan batasan

- Data operasional dipisahkan per perusahaan dan dilindungi role akun.
- Jangan membagikan tautan presensi, token, password, atau screenshot yang menampilkan data pribadi kepada pihak yang tidak berwenang.
- Web Geolocation dan Anti-Mock Location adalah pemeriksaan **best-effort**. Browser tidak dapat membuktikan sepenuhnya bahwa koordinat berasal dari GPS asli; jaminan perangkat yang lebih kuat memerlukan aplikasi native dan device attestation.
- Keterlambatan otomatis berdasarkan shift belum tersedia.
- Dokumen MCU dipakai sebagai metadata/status dan masa berlaku. Jangan masukkan hasil pemeriksaan medis rinci ke kolom yang tidak dirancang untuk itu.
- Dashboard dan antarmuka diperbarui melalui event real-time saat koneksi tersedia. Bila koneksi real-time terganggu, aplikasi memakai pembaruan berkala; perubahan tidak menggantikan penyimpanan dan validasi di backend.
