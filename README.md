# Konversi Invoice PDF → Excel (template BERAT RATA-RATA)

Jalankan: klik dua kali `start.bat` (butuh Node.js), atau `node server.js` lalu buka http://127.0.0.1:3471.
Semua proses (OCR, parsing, pembuatan Excel) terjadi di browser; PDF tidak dikirim ke mana pun. Tidak perlu internet.

Alur: upload PDF → OCR (Tesseract) → parser → pemeriksaan silang → (opsional edit) → Download Excel.
Pemetaan kolom PDF → Excel ada di kartu "Pemetaan kolom" pada halaman.

- `public/parser.js`  teks OCR → data + validasi silang + koreksi otomatis
- `public/excel.js`   data → baris & rumus template, ditulis ke `public/template.xlsx`
- `test/run.js`       `npm test` (parser + Excel, memakai `test/fixtures/*.ocr.txt`)
- `npm run vendor`    salin ulang pustaka dari node_modules ke public/vendor (setelah `npm install`)

Jika format invoice berubah (judul barang, kata "SUBTOTAL"/"Total Diskon", dst.), sesuaikan regex di `parser.js`.
Tab browser harus tetap terlihat (di depan) selama OCR berjalan.
