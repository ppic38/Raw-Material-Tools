// Menyalin pustaka dari node_modules ke public/vendor supaya aplikasi bisa jalan offline
// dan folder app/ bisa dipindah tanpa "npm install". Jalankan: npm run vendor
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = (...p) => path.join(root, 'public', 'vendor', ...p);

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log('  ', path.relative(root, to), `(${(fs.statSync(to).size / 1024).toFixed(0)} KB)`);
}

copy(nm('tesseract.js', 'dist', 'tesseract.min.js'), out('tesseract', 'tesseract.min.js'));
copy(nm('tesseract.js', 'dist', 'worker.min.js'), out('tesseract', 'worker.min.js'));
for (const f of fs.readdirSync(nm('tesseract.js-core'))) {
  // model bahasa "best_int" hanya LSTM, jadi cukup varian *-lstm.wasm.js (wasm ditanam di dalam js)
  if (/^tesseract-core.*lstm\.wasm\.js$/.test(f)) copy(nm('tesseract.js-core', f), out('tesseract', 'core', f));
}
copy(nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), out('tesseract', 'lang', 'eng.traineddata.gz'));
copy(nm('pdfjs-dist', 'build', 'pdf.min.mjs'), out('pdfjs', 'pdf.min.mjs'));
copy(nm('pdfjs-dist', 'build', 'pdf.worker.min.mjs'), out('pdfjs', 'pdf.worker.min.mjs'));
copy(nm('exceljs', 'dist', 'exceljs.min.js'), out('exceljs.min.js'));
console.log('Selesai.');
