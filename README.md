# TOKO BUNG EDI POS — Hybrid Offline Kasir + Cloud Admin

Versi ini merombak alur POS agar **Kasir tidak bergantung pada Firebase**. Firebase hanya dimuat secara lazy ketika pengguna masuk sebagai **ADMIN**.

## Perbaikan yang diterapkan

1. **Kasir benar-benar offline/local** — tidak menginisialisasi Firebase, Firestore, Cloud Functions, atau listener realtime saat sesi Kasir.
2. **Checkout lokal** — Form Bayar, validasi stok, transaksi, poin member, stok log, preview struk, dan print tidak memanggil Firebase.
3. **IndexedDB persistence** — transaksi/stok/member/log tetap tersedia setelah refresh. Ada fallback localStorage bila IndexedDB tidak tersedia.
4. **Checkout atomic di sisi lokal** — seluruh keranjang divalidasi lebih dahulu; jika penyimpanan snapshot gagal, state dikembalikan sehingga tidak ada transaksi setengah jadi.
5. **Nomor transaksi aman** — menggunakan counter per tanggal, bukan `transactions.length`, sehingga penghapusan/refresh tidak membuat nomor duplikat. Counter BRI Link juga diperbaiki.
6. **CASH / QRIS / TRANSFER** — QRIS dan Transfer otomatis menggunakan nominal total dan tidak menampilkan kembalian tunai. CASH tetap memakai input uang diterima.
7. **Struk thermal** — preview lokal, percobaan print otomatis, dan tombol `Cetak Thermal` sebagai fallback browser. Format print 76 mm dipertahankan.
8. **Firebase lifecycle** — listener Admin disimpan dan dihentikan saat logout; sesi Kasir memutus aplikasi Firebase sehingga tidak ada listener cloud aktif.
9. **Login lokal lebih aman** — akun default lokal menyimpan SHA-256 password hash, bukan password plaintext. Akun Admin dari cloud tetap dapat dipakai saat cloud tersedia.
10. **XSS hardening** — data nama produk/member/transaksi/aktivitas yang masuk ke HTML dirender dengan escaping pada area utama. Tombol buka struk tidak lagi menyisipkan seluruh objek transaksi ke atribut HTML.
11. **Zona waktu** — tanggal transaksi dan mutasi stok memakai `getLocalDateKey()` secara konsisten, bukan `toISOString().slice(...)`.
12. **Duplikasi fungsi** — `getPeriodFilter`, `matchesPeriod`, dan `clearKasFilters` hanya memiliki satu definisi.
13. **Backup** — ekspor JSON bekerja terhadap state yang sedang tersedia di browser dan diberi label lokal/cloud sesuai mode.
14. **Admin tetap dapat menggunakan Firebase** — Firestore dan Cloud Functions tetap ada di project untuk fitur Admin/cloud.

## Arsitektur

```text
TOKO BUNG EDI
├── KASIR
│   ├── IndexedDB / localStorage
│   ├── Checkout lokal
│   ├── Stok lokal
│   ├── Transaksi lokal
│   └── Struk + printer lokal
└── ADMIN
    ├── Firebase Firestore
    ├── Cloud Functions
    └── Realtime listener
```

## Cloud Functions
Folder `functions/` dipertahankan untuk fitur Admin/cloud. Jika backend Functions digunakan, deploy dengan:

```bash
cd functions
npm install
cd ..
firebase use toko-bung-edi
firebase deploy --only functions
```

**Catatan:** deployment Functions tidak mengubah Firestore Rules. File `firestore.rules` tidak disertakan dalam paket ini.

## Pengujian yang disarankan

1. Masuk sebagai Kasir.
2. Tambahkan Aqua 600ml.
3. Pilih CASH, isi Rp3.000, lalu `BAYAR & BUKA STRUK`.
4. Pastikan preview struk muncul dan tombol `Cetak Thermal` membuka dialog print.
5. Refresh halaman, masuk lagi sebagai Kasir, dan pastikan transaksi/stok tetap ada.
6. Uji QRIS/TRANSFER: nominal pembayaran otomatis sama dengan total dan kembalian Rp0.
7. Uji stok kurang: transaksi harus ditolak tanpa mengurangi stok/member/pencatatan transaksi.
8. Masuk sebagai Admin dan verifikasi Firebase tetap dapat digunakan.
