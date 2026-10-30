# Catatan Legalitas dan Hak Cipta

Catatan ini menjadi daftar perhatian awal sebelum aplikasi dipublikasikan, didistribusikan, atau digunakan secara komersial. Ini bukan pendapat hukum; minta tinjauan penasihat hukum untuk keputusan lisensi dan kepatuhan.

## Hak atas kode aplikasi

- Repository belum memiliki lisensi proyek yang memberikan hak penggunaan atau distribusi kepada publik. `frontend/package.json` memakai `"private": true` (metadata publikasi npm, bukan lisensi), sedangkan `backend/package.json` memakai `"license": "UNLICENSED"`.
- Jangan menganggap kode bebas disalin, dimodifikasi, atau dijual hanya karena dapat diakses di repository.
- Pastikan pemegang hak atas kode asli dan kontribusi pihak lain melalui riwayat kepengarangan, kontrak kerja/kontraktor, pengalihan hak yang relevan, dan ketentuan alat atau layanan yang digunakan. Riwayat Git sendiri tidak membuktikan pengalihan hak.
- Tetapkan secara sadar apakah produk akan tetap proprietary atau dilisensikan secara terbuka. Jangan menambahkan lisensi publik sebelum hak atas semua kontribusi dipastikan.

## Dependency, atribusi, dan aset

- Buat dan pelihara inventaris dependency/SBOM serta `THIRD-PARTY-NOTICES` yang memuat lisensi dan pemberitahuan hak cipta yang diwajibkan saat distribusi.
- Perhatian khusus: `react-leaflet@4.2.1` dan `@react-leaflet/core@2.1.0` menggunakan Hippocratic License 2.1, bukan lisensi permissive standar. Tinjau ketentuannya, termasuk penggunaan yang konsisten dengan prinsip/hukum HAM, kewajiban pemberitahuan, dan ketentuan sengketa. Minta penasihat hukum menilai kesesuaiannya untuk produk HR SaaS sebelum distribusi/komersialisasi.
- Metadata lokal untuk dependency transitif `buffers@0.1.1` tidak menyatakan lisensi dan paket tidak menyertakan berkas lisensi yang ditemukan. Verifikasi sumber dan izin distribusinya; catat hasilnya sebelum rilis.
- Pertahankan pilihan lisensi dan copyright notice paket lain sesuai syaratnya. Contoh yang terdeteksi antara lain MIT/BSD/ISC; JSZip menyatakan pilihan MIT atau GPL-3.0-or-later, sementara LightningCSS menyatakan MPL-2.0.
- Pertahankan atribusi OpenStreetMap dan CARTO pada peta, dan tinjau syarat, batas penggunaan, atribusi, serta konfigurasi API key penyedia basemap.
- Pastikan asal dan izin penggunaan aset yang masuk repository, termasuk gambar logo di `backend/uploads/company-logos/`, terdokumentasi. Jangan menyimpan aset milik klien ke repository tanpa izin dan kebutuhan yang jelas.
- Pastikan penggunaan nama/brand dan domain `rusakparah.web.id` telah diotorisasi. Metadata SEO, sitemap, dan schema terstruktur harus menggambarkan fitur yang benar; metadata tersebut bukan bukti kepemilikan atau endorsement pihak ketiga.
- Sitemap publik hanya mencantumkan landing page utama (`https://www.rusakparah.web.id/`); jangan memasukkan URL portal pekerja, endpoint API, atau halaman aplikasi tenant yang berpotensi memuat konteks privat.

## Data pekerja dan kewajiban operasional

- Sebelum produksi, tetapkan dan dokumentasikan tujuan serta dasar pemrosesan, pemberitahuan kepada pekerja, kontrol akses, masa retensi/penghapusan, keamanan, penanganan permintaan subjek data, dan pembagian tanggung jawab antara penyedia SaaS dan perusahaan klien sesuai hukum yang berlaku.
- Perlakukan catatan presensi/lokasi, bukti foto, identitas, dan metadata MCU sebagai data sensitif. Arahan produk saat ini melarang penyimpanan hasil medis rinci dan mencatat bahwa retensi lokasi/bukti masih harus ditentukan.
- Tinjau kontrak layanan, syarat penggunaan, kebijakan privasi, keamanan, serta ketentuan vendor/infrastruktur sebelum menerima data klien di produksi.

## Gerbang sebelum rilis publik/komersial

- [ ] Konfirmasi kepemilikan dan hak kontribusi atas seluruh kode/aset.
- [ ] Putuskan model lisensi aplikasi dan siapkan pemberitahuan hak cipta yang sesuai.
- [ ] Tinjau Hippocratic-2.1 dan selesaikan verifikasi lisensi `buffers@0.1.1`.
- [ ] Hasilkan SBOM dan berkas `THIRD-PARTY-NOTICES`; pastikan pemberitahuan ikut tersedia dalam bentuk distribusi frontend/backend yang relevan.
- [ ] Verifikasi atribusi serta syarat layanan CARTO/OpenStreetMap dan hak semua aset gambar/font/ikon.
- [ ] Verifikasi hak penggunaan brand/domain dan pastikan sitemap/schema hanya memuat informasi publik yang akurat.
- [ ] Tetapkan dokumen privasi, retensi, keamanan, serta perjanjian pengolahan data untuk data pekerja.
- [ ] Minta tinjauan penasihat hukum pada yurisdiksi operasional sebelum peluncuran atau penjualan.
