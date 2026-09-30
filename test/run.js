// Uji parser + penulis Excel tanpa browser: node test/run.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { parseInvoiceText, validate, buildBlocks } from '../public/parser.js';
import { buildWorkbook, layoutRows } from '../public/excel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = path.join(here, 'fixtures');
const invoices = fs.readdirSync(fx).filter((f) => f.endsWith('.ocr.txt'))
  .map((f) => parseInvoiceText(fs.readFileSync(path.join(fx, f), 'utf8'), f.replace('.ocr.txt', '.YOGI01.MANUAL.pdf')));

for (const inv of invoices) {
  console.log(inv.fileName, inv.noPenjualan, inv.tanggal, '|', inv.customer, '| diskon/kg', inv.diskonPerKg);
  for (const b of buildBlocks(inv)) console.log('  ', b.warna, b.benang, 'roll', b.rolls.length, 'rib', b.ribs.map((r) => r.w));
  for (const c of validate(inv)) console.log('  ', c.ok ? 'OK ' : 'ERR', c.label, '-', c.detail);
}
const layout = layoutRows(invoices);
console.log('rows', layout.rows.length, 'last', layout.last);

const tpl = fs.readFileSync(path.join(here, '..', 'public', 'template.xlsx'));
const wb = await buildWorkbook(ExcelJS, tpl, invoices, { title: 'DATA BAHAN BERDASARKAN FAKTUR W31' });
fs.mkdirSync(path.join(here, '..', 'out'), { recursive: true });
const out = path.join(here, '..', 'out', 'hasil-test.xlsx');
await wb.xlsx.writeFile(out);
console.log('ditulis', out);

// ---- uji koreksi otomatis OCR: sengaja rusak satu berat & satu jumlah ----
import assert from 'node:assert/strict';
const src = fs.readFileSync(path.join(fx, 'OH300726111.ocr.txt'), 'utf8');
const broken = src.replace('24.87 KG    111,000     2,760,570', '24.67 KG    111,000     2,760,570')
  .replace('24.61 KG    114,000     2,805,540', '24.61 KG    114,000     2,805,549');
const b = parseInvoiceText(broken, 'rusak');
const fixedLines = b.groups.flatMap((g) => g.lines).filter((l) => l.fixed);
assert.equal(fixedLines.length, 2, 'dua baris harus dikoreksi otomatis');
assert.ok(validate(b).every((c) => c.ok), 'setelah koreksi semua pemeriksaan harus lolos');
assert.equal(b.groups[0].lines[0].w, 24.87);
// kerusakan yang tidak bisa dikoreksi harus ditandai, bukan disembunyikan
const worse = parseInvoiceText(src.replace('24.87 KG    111,000     2,760,570', '24.97 KG    111,000     2,760,999'), 'x');
assert.ok(validate(worse).some((c) => !c.ok), 'jumlah salah harus terdeteksi');
console.log('uji koreksi OCR: OK');
const o = parseInvoiceText(src.replace('2,805,540', '2,805,54O'), 'o');
assert.ok(validate(o).every((c) => c.ok) && !o.groups.flatMap((g) => g.lines).some((l) => l.fixed), 'O→0 harus dinormalisasi diam-diam');
console.log('uji normalisasi digit: OK');

// ---- nama file -> TUJUAN (B) & NO INVOICE (O) ----
import { parseFileName } from '../public/parser.js';
assert.deepEqual(parseFileName('OH300726111.YOGI01.MANUAL.pdf'), { noPenjualan: 'OH300726111', tujuan: 'YOGI01', kodeTransfer: 'MANUAL' });
assert.deepEqual(parseFileName('C:\\x\\OH300726111.yogi01.7295 (1).pdf'), { noPenjualan: 'OH300726111', tujuan: 'YOGI01', kodeTransfer: '7295' });
assert.deepEqual(parseFileName('scan-001.pdf'), { noPenjualan: '', tujuan: '', kodeTransfer: '' });
assert.equal(parseFileName('OH300726111.pdf').tujuan, '');
const named = layoutRows([invoices[0]]).rows.filter((r) => r.first);
assert.ok(named.every((r) => r.cells.B.v === 'YOGI01' && r.cells.O.v === 'MANUAL' && r.cells.P.v === 'OH300726111'), 'B/O/P terisi di tiap baris pertama blok');
const plain = layoutRows([parseInvoiceText(src, 'scan-001.pdf')]).rows.filter((r) => r.first);
assert.ok(plain.every((r) => !r.cells.B && !r.cells.O), 'nama file tak sesuai format -> B & O kosong');
const mism = parseInvoiceText(src, 'OH300726999.YOGI01.MANUAL.pdf');
assert.ok(validate(mism).some((c) => !c.ok && /nama file/.test(c.label)), 'beda No Penjualan nama file vs invoice harus diperingatkan');
const num = layoutRows([parseInvoiceText(src, 'OH300726111.BAYU.7295.pdf')]).rows[0].cells.O.v;
assert.strictEqual(num, 7295, 'kode transfer angka disimpan sebagai angka');
console.log('uji nama file: OK');
assert.equal(parseFileName('OH300726111.YOGI01.MANUAL - Copy.pdf').kodeTransfer, 'MANUAL');
assert.equal(parseFileName('OH300726111.YOGI01.MANUAL - Copy (2).pdf').kodeTransfer, 'MANUAL');
assert.equal(parseFileName('OH300726111.YOGI01.5641.pdf').kodeTransfer, '5641');
console.log('uji nama file salinan: OK');
