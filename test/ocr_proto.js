// Uji cepat OCR di Node (bukan bagian aplikasi): node test/ocr_proto.js <gambar.png> [psm]
import { createWorker } from 'tesseract.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const img = process.argv[2];
const psm = process.argv[3] || '6';
const langPath = path.join(here, '..', 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int');

const t0 = Date.now();
const worker = await createWorker('eng', 1, { langPath, gzip: true, cachePath: path.join(here, '.cache') });
await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
const { data } = await worker.recognize(fs.readFileSync(img));
await worker.terminate();
console.error(`OCR ${((Date.now() - t0) / 1000).toFixed(1)}s, conf ${data.confidence}`);
fs.writeFileSync(process.argv[4] || 'ocr_out.txt', data.text);
console.log(data.text);
