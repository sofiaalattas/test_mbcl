# Financial Dashboard — PT Manufaktur Indonesia Sejahtera

Dashboard eksekutif keuangan berbasis upload file General Ledger (GL) dari ESB. Upload 1 file Excel, dapatkan otomatis: Ringkasan Eksekutif, Laba Rugi, Neraca, Cash Flow (estimasi), dan Kinerja Cabang — lengkap dengan filter, drill-down, dan export ke Excel.

## Cara kerja singkat

- Buka link, masukkan password sekali per sesi browser.
- Buka tab **Upload GL**, unggah file `.xlsx` dari ESB (drag-drop atau pilih file).
- Sistem otomatis mem-parsing & menghitung semua laporan (< 30 detik untuk file berukuran wajar).
- Upload file baru akan **menggantikan** data lama (bukan menambah riwayat).
- Semua laporan bisa difilter per periode/cabang/departemen, dan filter tersimpan di URL (bisa di-share).

## 1. Jalankan di komputer (development)

Butuh [Node.js](https://nodejs.org) versi 18 ke atas.

```bash
npm install
cp .env.example .env   # lalu isi APP_PASSWORD & APP_SECRET (opsional untuk dev, ada default)
npm start
```

Buka `http://localhost:3000`, masuk dengan password dari `APP_PASSWORD` (default: `dashboard123`).

### Coba dengan data contoh

Ada 2 file contoh:
- `sample-data/contoh-GL.xlsx` — 7 cabang, 6 bulan transaksi P&L + saldo neraca akhir periode. Generate ulang: `node scripts/generate-sample-gl.js`.
- `sample-data/contoh-GL-format-real.xlsx` — 16 kolom meniru format export ESB umum (Journal Date, Created Date, Reference Number, Dr/Cr Amount berlabel "(IDR)", dll). Generate ulang: `node scripts/generate-real-format-gl.js`.

Unggah salah satu di tab **Upload GL** untuk melihat dashboard terisi. Kolom yang dikenali sistem (nama header boleh variasi kapitalisasi/spasi, dan suffix satuan mata uang seperti `(IDR)`/`(Rp)` otomatis diabaikan saat pencocokan):

| Kolom yang dikenali (nama boleh variasi) | Wajib? |
|---|---|
| Tanggal / Date / Journal Date | Tidak wajib, tapi tanpa ini tren bulanan & filter kalender tidak muncul. **Bukan** "Created Date" (itu tanggal audit/pembuatan record, sengaja diabaikan) |
| CoA No / Account Code / Kode Akun | **Wajib** |
| CoA Description / Nama Akun | Tidak wajib |
| Branch / Cabang | **Wajib** |
| Department / Departemen / Divisi / Cost Center | Tidak wajib |
| Dr Amount / Debit (boleh diberi label satuan, mis. "Dr Amount (IDR)") | Salah satu dari Dr/Cr **atau** Balance wajib ada — **Dr/Cr selalu diprioritaskan** kalau ada, Balance hanya dipakai sebagai fallback |
| Cr Amount / Credit / Kredit | " |
| Balance / Saldo | " |

Kolom **CoA No** harus mengikuti klasifikasi standar (digit pertama menentukan jenis akun & normal balance-nya):

```
1xxx = Asset      (11xx Current Asset, 12xx Fixed Asset)   → normal balance DEBIT  → saldo = Debit − Kredit
2xxx = Liability  (21xx Current Liability, 22xx LT Liab.)  → normal balance KREDIT → saldo = Kredit − Debit
3xxx = Equity                                              → normal balance KREDIT → saldo = Kredit − Debit
4xxx = Revenue                                             → normal balance KREDIT → saldo = Kredit − Debit
5xxx = COGS (Cost of Goods Sold)                           → normal balance DEBIT  → saldo = Debit − Kredit
6xxx = Operating Expense                                   → normal balance DEBIT  → saldo = Debit − Kredit
```

**Cara verifikasi hasil parsing benar:** buka tab **Upload GL** setelah mengunggah — panel "Data GL Saat Ini" menampilkan daftar kolom yang terdeteksi dan metode perhitungan yang dipakai (✅ Debit & Kredit = akurat, ⚠️ Balance saja = berpotensi tidak akurat kalau kolom Balance ternyata saldo kumulatif bukan net per-baris). Kalau kolom Dr/Cr Amount Anda tidak muncul di daftar terdeteksi, cek nama headernya — sistem butuh minimal salah satu alias di atas.

## 2. Deploy ke Vercel (production)

1. Push repo ini ke GitHub, import project ke Vercel.
2. **Storage → Create Database → Upstash Redis**, connect ke project (Production + Preview). Vercel otomatis menambahkan `KV_REST_API_URL` & `KV_REST_API_TOKEN`.
3. **Storage → Create Database → Blob**, connect ke project. Vercel otomatis menambahkan `BLOB_READ_WRITE_TOKEN`.
4. Di **Project Settings → Environment Variables**, tambahkan:
   - `APP_PASSWORD` — password akses dashboard (bagikan ke 3 executive)
   - `APP_SECRET` — string acak panjang (untuk tanda tangan sesi login)
5. Redeploy. Buka link Vercel, login, lalu upload GL file pertama.

Kalau env var Redis/Blob belum di-set, aplikasi otomatis jatuh ke penyimpanan file lokal — jalan tanpa error, tapi **tidak cocok untuk Vercel production** karena filesystem-nya sementara (data GL akan hilang saat cold start baru). Pastikan langkah 2-3 sudah dilakukan sebelum tim mulai pakai.

## 3. Struktur file

```
server.js                 -> server Express (semua endpoint API + menyajikan halaman web)
lib/store.js               -> penyimpanan dataset GL: Redis (Vercel KV) kalau tersedia, file lokal kalau tidak
lib/attachments.js          -> penyimpanan arsip file GL asli: Vercel Blob kalau tersedia, file lokal kalau tidak
lib/excel-parser.js         -> parsing file GL Excel -> baris transaksi terklasifikasi
lib/calculations.js         -> semua logika hitung: Overview, P&L, Neraca, Cash Flow, Kinerja Cabang
lib/excel-export.js         -> generate file Excel export per laporan
lib/auth.js                 -> password protection sederhana (token sesi ber-HMAC)
public/                     -> halaman web (HTML/CSS/JS polos, tanpa build step)
public/vendor/               -> Chart.js di-vendor (bukan CDN) supaya dashboard tetap jalan di jaringan kantor yang membatasi akses CDN eksternal. Update: npm i chart.js lalu copy node_modules/chart.js/dist/chart.umd.js ke sini.
sample-data/contoh-GL.xlsx  -> file GL contoh untuk testing
scripts/generate-sample-gl.js -> generator file contoh di atas
data/gl-data.json           -> fallback penyimpanan GL untuk development lokal (dibuat otomatis)
data/uploads/                -> fallback penyimpanan arsip file GL untuk development lokal (dibuat otomatis)
```

## 4. Fitur yang tersedia (Phase 1 MVP)

- ✅ Upload & parsing GL Excel (auto-deteksi kolom, validasi, replace file lama)
- ✅ Dashboard Overview (KPI cards, tren bulanan, breakdown expense)
- ✅ Laporan Laba Rugi (ringkasan + rincian akun + waterfall chart)
- ✅ Neraca (Assets vs Liabilities+Equity, validasi balance, rasio keuangan)
- ✅ Cash Flow — **lihat catatan di bawah**
- ✅ Kinerja Cabang (perbandingan 7 cabang, drill-down per cabang)
- ✅ Export tiap laporan ke Excel (format currency, header bold)
- ✅ Password protection (sesi per browser, token HMAC 12 jam)
- ✅ Filter periode/cabang/departemen (tersimpan di URL, bisa di-share)
- ✅ Mobile responsive (mobile-first, tab & filter scrollable, chart resize otomatis)

### Catatan penting: Cash Flow adalah estimasi

Cash Flow yang akurat butuh perbandingan neraca **awal vs akhir periode**. Karena aplikasi ini hanya menyimpan **1 file GL snapshot** (sesuai spec: upload baru menggantikan yang lama), laporan Cash Flow di sini adalah **estimasi berbasis klasifikasi akun**:

- Operating ≈ Net Income dari P&L
- Investing ≈ pergerakan akun Fixed Asset (12xx)
- Financing ≈ akun Long-term Liability (22xx) + Equity (3xxx)

Ini cukup untuk gambaran kasar, tapi **bukan** cash flow method langsung/tidak langsung yang presisi. Peringatan ini juga tampil di UI & file export.

## 5. Batasan versi pertama (sengaja disederhanakan)

- Password tunggal (bukan multi-user login) — cocok untuk tim kecil yang saling percaya, bagikan lewat link privat.
- Hanya 1 dataset GL aktif — upload baru menimpa yang lama (tidak ada riwayat multi-periode antar file).
- Tren bulanan & filter periode hanya berfungsi kalau file GL punya kolom tanggal per baris transaksi.
- Cash Flow adalah estimasi (lihat di atas), bukan hasil rekonsiliasi neraca 2 periode.

## Phase 2 (rencana pengembangan lanjutan)

- Cash Flow presisi (upload neraca awal & akhir periode terpisah)
- Perbandingan YoY / periode sebelumnya
- Budget vs Actual
- Multi-user login dengan role
