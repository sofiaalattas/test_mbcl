# Papan Status Tim

Satu layar web sederhana untuk melihat status kerja tim (Belum Mulai / Dikerjakan / Selesai). Dibuat untuk tim kecil (5-10 orang) yang terbiasa pakai HP, tanpa login/akun rumit.

## Cara kerja singkat

- Setiap anggota membuka link di HP, memilih namanya sekali (tersimpan di HP itu), lalu bisa mengubah status, tugas singkat, deskripsi, dan lampiran file miliknya sendiri.
- Semua orang melihat papan yang sama, otomatis ter-update setiap ~8 detik.
- Tidak ada tambah/hapus anggota dari UI — daftar nama diatur lewat file konfigurasi oleh admin (kamu).
- Tombol **Export CSV** di halaman utama mengunduh daftar nama, status, dan tugas singkat terkini.

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

Status kerja sekarang disimpan di **Redis (Vercel Storage → Upstash for Redis)**, bukan file lagi — jadi cocok dipakai di platform serverless seperti Vercel yang filesystem-nya sementara. Kalau environment variable KV belum di-set (mis. waktu jalan di komputer sendiri), aplikasi otomatis jatuh ke penyimpanan file lokal (`data/status.json`) supaya tetap bisa dicoba tanpa setup tambahan.

### Deploy ke Vercel (cara yang dipakai sekarang)

1. Hubungkan repo ini ke project Vercel (kalau belum, import dari dashboard Vercel).
2. Di dashboard project → tab **Storage** → **Create Database** (atau "Browse Marketplace") → pilih **Upstash** produk **Redis** → buat database baru.
3. Saat proses connect, pastikan database itu di-**Connect** ke project ini untuk environment **Production** (dan **Preview** kalau mau).
4. Vercel otomatis menambahkan environment variable ke project (biasanya bernama `KV_REST_API_URL` dan `KV_REST_API_TOKEN`). Cek di **Project Settings → Environment Variables** — kalau namanya berbeda dari itu, tidak masalah, aplikasi juga mengenali nama `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
5. Redeploy project (biasanya otomatis terpicu setelah connect storage; kalau tidak, klik **Redeploy** manual dari tab Deployments).
6. Selesai — coba buka link Vercel-nya, pilih nama, ubah status, harus tersimpan tanpa error 500 lagi.

### Alternatif lain (tanpa Vercel)

Kalau suatu saat pindah dari Vercel, aplikasi ini tetap jalan biasa sebagai server Node.js/Express — tinggal jangan set env var KV supaya otomatis pakai file lokal, dengan syarat platform hosting-nya punya disk permanen (mis. **Railway**/**Render** dengan volume, atau **VPS** + `pm2`).

Setelah live, cukup share satu link ke semua anggota tim (via WhatsApp), dan minta mereka membukanya dari HP masing-masing lalu memilih nama sekali.

## 4. Lampiran file (Vercel Blob)

Lampiran yang diunggah lewat popup "Ubah Status Kamu" disimpan lewat pola yang sama seperti status: **Vercel Blob** di production, file lokal (`data/uploads/`) kalau env var belum ada (mis. waktu development).

1. Di dashboard project Vercel → tab **Storage** → **Create Database** (atau "Browse Marketplace") → pilih **Blob**.
2. **Connect** ke project ini untuk environment **Production** (dan **Preview** kalau mau).
3. Vercel otomatis menambahkan environment variable `BLOB_READ_WRITE_TOKEN`.
4. Redeploy project.

Kalau `BLOB_READ_WRITE_TOKEN` belum di-set di Vercel, upload lampiran tetap "berhasil" secara teknis tapi filenya tersimpan di disk sementara Vercel yang bisa hilang kapan saja — jadi pastikan langkah di atas sudah dilakukan sebelum tim mulai pakai fitur lampiran.

Batas ukuran lampiran: **5MB per file**. Tipe file tidak dibatasi.

## Struktur file

```
server.js             -> server (API + menyajikan halaman web)
lib/store.js           -> lapisan penyimpanan status: Redis (Vercel KV) kalau tersedia, file lokal kalau tidak
lib/attachments.js      -> lapisan penyimpanan lampiran: Vercel Blob kalau tersedia, file lokal kalau tidak
public/                -> halaman web (HTML/CSS/JS polos, tanpa framework)
data/team.json         -> daftar nama anggota tim (edit manual oleh admin)
data/status.json       -> fallback penyimpanan status untuk development lokal (dibuat otomatis, jangan diedit manual)
data/uploads/          -> fallback penyimpanan lampiran untuk development lokal (dibuat otomatis, jangan diedit manual)
```

## Batasan versi pertama (sengaja disederhanakan)

- Tidak ada login/password — siapa pun yang tahu link bisa memilih nama siapa saja. Cocok untuk tim kecil yang saling percaya (mirip grup WhatsApp).
- Tidak ada riwayat/histori status, hanya status terakhir yang ditampilkan (termasuk deskripsi & lampiran — ganti status akan menimpa yang lama).
- Tambah/hapus anggota hanya lewat edit file `data/team.json`, tidak ada tombol di UI.
- Satu lampiran per anggota (mengunggah file baru otomatis mengganti file lama).
