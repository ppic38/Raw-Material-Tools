Kamu adalah engineer di codebase ERP PT Tigalapan Indonesia. Tugasmu: menambahkan fitur "Konversi Invoice PDF ke Excel" ke ERP ini, dengan mem-port implementasi referensi yang sudah jadi dan teruji.

## 1. Tujuan fitur
User upload/drag PDF invoice supplier bahan (PDF berupa GAMBAR, teks tidak bisa diselect). Sistem membaca isinya dengan OCR, mencocokkan ke template Excel "BERAT RATA-RATA", lalu user mengunduh .xlsx lengkap dengan rumus. Kolom TUJUAN dan NO INVOICE tidak ada di isi invoice; keduanya diambil dari NAMA FILE dengan format `NOPENJUALAN.TUJUAN.KODETRANSFER.pdf` (mis. `OH300726111.YOGI01.MANUAL.pdf`), dan dikosongkan bila nama file tidak sesuai. Di ERP, sumber ini bisa diganti dengan field yang dipilih user atau data master vendor. Konfirmasi ke saya.

## 2. Implementasi referensi (JANGAN tulis ulang logika inti)
Repo: https://github.com/ppic38/Raw-Material-Tools (branch main). Baca README.md dulu. File penting di `public/`:
- `parser.js`: teks OCR -> data terstruktur, validasi silang, koreksi otomatis salah-baca OCR. JS murni tanpa DOM; pakai apa adanya.
- `excel.js`: data -> baris + rumus sesuai template, menulis ke `template.xlsx` lewat ExcelJS (`layoutRows`, `buildWorkbook`). Pakai apa adanya.
- `app.js`, `index.html`, `style.css`: UI referensi (upload, drag & drop seluruh halaman, progres OCR, chip validasi, tabel yang bisa diedit, pratinjau Excel, tombol download). Ini yang di-port ke stack/komponen ERP.
- `template.xlsx`: template Excel asli. `vendor/`: pdf.js, Tesseract.js (worker, core wasm, eng.traineddata.gz), ExcelJS.
- `test/run.js` + `test/fixtures/*.ocr.txt`: tes parser + pembuatan Excel.

Alur teknis: pdf.js merender halaman PDF ke canvas (scale 3) -> Tesseract.js OCR di browser (PSM 6) -> `parseInvoiceText` -> `validate`/`reconcile` -> preview yang bisa diedit -> `buildWorkbook` -> unduh. Semua di browser; PDF tidak dikirim ke server.

## 3. Pemetaan kolom (harus dipertahankan persis)
A TANGGAL INVOICE = "Tanggal" invoice | B TUJUAN = bagian ke-2 NAMA FILE (`OH300726111.YOGI01.MANUAL.pdf` -> YOGI01; kosong bila nama file tidak berformat NOPENJUALAN.TUJUAN.KODETRANSFER) | C WARNA = bagian setelah "-" pada judul barang ("COMBED 24S - TOSCA MUDA" -> TOSCA MUDA) | D BENANG = "24S" | E ROLL = jumlah baris berat | F BERAT/ROLL = satu baris Excel per roll | G =SUM(F) | H =AVERAGE(F) | I RIB = berat baris "RIB COMBED 24S - warna" (bila >1 baris: =12+2.6) | J =I*harga rib | K =F*harga roll per baris | L =SUM(J:K) per warna | M DISKON =SUM(G,I seluruh order)*diskon per kg (baris pertama order) | N =SUM(L order)-M | O NO INVOICE = bagian ke-3 NAMA FILE / kode transfer (MANUAL; angka disimpan sebagai angka; kosong bila tidak ada) | P NO ORDER = "No Penjualan" (mis. OH300726111). Baris 2 = total kolom (SUM), header pink di baris 3, judul di A1.

## 4. Yang harus kamu lakukan
1. **Eksplorasi dulu, jangan langsung menulis kode.** Pelajari stack ERP (framework, bahasa, UI kit, routing, auth, RBAC/permission, cara menambah menu/modul, cara serve static asset, CSP, build system). Ringkas temuanmu dan rencanamu, lalu minta konfirmasi sebelum implementasi besar.
2. **Tentukan modul induk.** Portal ERP punya modul: PPIC, Procurement, Finance, Produksi, Warehouse, SCM, General Manager, Sysadmin, Vendor Produksi. Usulan: taruh sebagai menu/tool di modul **Procurement** ("Purchase order, material, invoice vendor"). Konfirmasi ke saya bila ragu.
3. **Port UI** ke komponen/gaya ERP (bukan menyalin CSS referensi). Pertahankan perilaku: upload klik + drag & drop, multi-file, progres OCR, chip pemeriksaan silang (hijau/merah), tabel hasil yang bisa diedit (tandai baris tidak cocok merah, hasil koreksi otomatis kuning), pratinjau hasil Excel, tombol Download, kartu "Pemetaan kolom".
4. **Hak akses.** Tambah permission khusus untuk fitur ini, ikuti mekanisme RBAC ERP. Hanya role yang berwenang yang melihat menunya.
5. **Aset & performa.** Sajikan Tesseract (worker, core wasm, traineddata) dan pdf.js dari origin yang sama (bukan CDN) agar jalan di jaringan tertutup dan sesuai CSP. Sesuaikan CSP bila perlu (`worker-src`, `wasm-unsafe-eval`, `blob:`). Muat pustaka berat secara lazy, hanya saat halaman ini dibuka. Sajikan `template.xlsx` sebagai aset terkelola (mudah diganti tanpa deploy ulang bila memungkinkan).
6. **(Opsional, tanyakan dulu) Riwayat/audit.** Simpan log konversi: user, waktu, nama file, No Penjualan, jumlah roll, total bayar, status validasi. JANGAN menyimpan file PDF kecuali saya minta.
7. **Tes.** Pertahankan/adaptasi `test/run.js`. Tambahkan tes untuk kode integrasi. Jangan commit data invoice asli; gunakan fixture dummy.

## 5. Kriteria penerimaan (pakai PDF/teks contoh dari repo)
Untuk invoice OH300726111: 2 warna (TOSCA MUDA 4 roll + rib 2,6; STEEL BLUE 23 roll + rib 12 + 2,6), total 27 roll / 670,02 kg, rib 17,2 kg, SUBTOTAL Rp 78.191.280, diskon Rp 1.374.440 (Rp 2.000/kg), Total Bayar Rp 76.816.840. Excel hasil: `N4 = 76.816.840`, `M4 = 1.374.440`, untuk file bernama `OH300726111.YOGI01.MANUAL.pdf` kolom B = YOGI01 dan O = MANUAL di tiap baris pertama warna, rumus tetap hidup (bukan nilai mati), tidak ada error rumus dan tidak ada `####`. Keenam chip validasi hijau.

## 6. Batasan & catatan
- Parser baru diuji dengan satu format (struk Knitto Tekstil). Bila supplier lain ditambahkan, buat parser per-supplier (adapter) dan jangan merusak yang ada.
- Pemrosesan tab browser tertahan bila tab tersembunyi; beri petunjuk agar tab tetap di depan selama OCR (±15-20 detik/file).
- Judul sheet (A1) default "DATA BAHAN BERDASARKAN FAKTUR W{minggu ISO}" dan bisa diedit user; diskon per kg diturunkan dari Total Diskon / total kg (bukan angka tanam).
- Jangan ubah modul lain, jangan tambah dependensi berat tanpa alasan, dan jangan lakukan push/deploy tanpa persetujuan saya.
- Jika ada keputusan yang tidak bisa dijawab dari kode (modul, permission, lokasi menu, penyimpanan riwayat), tanyakan padaku.
