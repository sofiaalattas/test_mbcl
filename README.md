# Papan Status Tim

Satu layar web sederhana untuk melihat status kerja tim (Belum Mulai / Dikerjakan / Selesai). Dibuat untuk tim kecil (5-10 orang) yang terbiasa pakai HP, tanpa login/akun rumit.

## Cara kerja singkat

- Setiap anggota membuka link di HP, memilih namanya sekali (tersimpan di HP itu), lalu bisa mengubah status & tugas singkat miliknya sendiri.
- Semua orang melihat papan yang sama, otomatis ter-update setiap ~8 detik.
- Tidak ada tambah/hapus anggota dari UI — daftar nama diatur lewat file konfigurasi oleh admin (kamu).

## 1. Atur daftar anggota tim

Edit file `data/team.json`, isi dengan nama-nama anggota tim (5-10 nama), contoh:

```json
[
  "Sofia",
  "Budi",
  "Citra",
  "Dewi",
  "Eka"
]
```

Simpan file. Tidak perlu langkah lain — aplikasi otomatis membaca file ini setiap kali diakses.

Untuk mengganti nama seseorang di kemudian hari, cukup edit nama di file ini. (Catatan: jika nama diganti, status lama milik nama sebelumnya tidak lagi terhubung — orang tersebut perlu "pilih nama" ulang di HP-nya.)

## 2. Jalankan di komputer (untuk coba-coba / development)

Butuh [Node.js](https://nodejs.org) (versi 18 ke atas).

```bash
npm install
npm start
```

Buka `http://localhost:3000` di browser.

## 3. Deploy supaya bisa diakses tim dari HP

Aplikasi ini adalah server Node.js biasa (Express) yang menyimpan data di file `data/status.json`. Yang perlu diperhatikan saat pilih tempat hosting: **harus ada disk yang tidak hilang saat server restart**, supaya status tidak ke-reset.

Beberapa pilihan yang simpel:

- **Railway** atau **Render** (paket berbayar dengan "persistent disk"/volume) — hubungkan repo, set start command `npm start`, tambahkan volume yang di-mount ke folder `data/`.
- **VPS murah** (mis. DigitalOcean, tinggal jalankan `npm start` dengan `pm2` supaya tetap hidup, lalu pasang domain/HTTPS lewat Nginx atau Caddy).

Vercel/Netlify (yang serverless) **kurang cocok** karena filesystem-nya sementara (data akan hilang) — pilih platform yang punya disk permanen seperti di atas.

Setelah live, cukup share satu link ke semua anggota tim (via WhatsApp), dan minta mereka membukanya dari HP masing-masing lalu memilih nama sekali.

## Struktur file

```
server.js          -> server (API + menyajikan halaman web)
public/             -> halaman web (HTML/CSS/JS polos, tanpa framework)
data/team.json      -> daftar nama anggota tim (edit manual oleh admin)
data/status.json    -> data status berjalan (dibuat & diisi otomatis, jangan diedit manual)
```

## Batasan versi pertama (sengaja disederhanakan)

- Tidak ada login/password — siapa pun yang tahu link bisa memilih nama siapa saja. Cocok untuk tim kecil yang saling percaya (mirip grup WhatsApp).
- Tidak ada riwayat/histori status, hanya status terakhir yang ditampilkan.
- Tambah/hapus anggota hanya lewat edit file `data/team.json`, tidak ada tombol di UI.
