// Uji beberapa invoice dalam satu workbook: node test/multi.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { parseInvoiceText } from '../public/parser.js';
import { buildWorkbook, layoutRows } from '../public/excel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const a = fs.readFileSync(path.join(here, 'fixtures', 'OH300726111.ocr.txt'), 'utf8');
// Invoice kedua: order & tanggal berbeda, satu warna saja, tanpa rib, diskon Rp 2.000/kg
const b = `No Penjualan :OH310726005
Tanggal :31-07-2026
Customer :PT TIGALAPAN
SUKSES INDONESIA
COMBED 30S - ABU MISTY
25.28 KG    133,000     3,362,240
25.16 KG    133,000     3,346,280
SUBTOTAL:             Rp 6,708,520
Total Diskon:         - Rp 100,880
Total Bayar           Rp. 6,607,640
Total KG-an:     0 KG (0)
Total Roll-an:   50.44 Kg (2)
`;
const invs = [parseInvoiceText(a, 'A.pdf'), parseInvoiceText(b, 'B.pdf')];
const { rows, last } = layoutRows(invs);
console.log('rows', rows.length, 'last', last);
for (const r of rows.filter((x) => x.cells.M)) console.log('order mulai baris', r.row, 'M:', r.cells.M.f, '->', r.cells.M.r, '| N:', r.cells.N.f, '->', r.cells.N.r);
const wb = await buildWorkbook(ExcelJS, fs.readFileSync(path.join(here, '..', 'public', 'template.xlsx')), invs, { title: 'UJI MULTI' });
fs.mkdirSync(path.join(here, '..', 'out'), { recursive: true });
await wb.xlsx.writeFile(path.join(here, '..', 'out', 'multi.xlsx'));
