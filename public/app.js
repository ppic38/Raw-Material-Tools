import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import { parseInvoiceText, validate, parseMoney, parseWeight, lineOk, fmt, deriveDiskonPerKg, round2 } from './parser.js';
import { buildWorkbook, layoutRows, columnTotals, HEADERS, COLS } from './excel.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const $ = (s) => document.querySelector(s);
const abs = (p) => new URL(p, location.href).href;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = { invoices: [], busy: false, titleEdited: false };

/* ---------------- status ---------------- */
function setStatus(kind, text, progress) {
  const tile = $('#statusTile');
  tile.className = 'tile' + (kind ? ' ' + kind : '');
  $('#statusText').textContent = text;
  const bar = $('#bar');
  bar.hidden = progress == null;
  if (progress != null) $('#barFill').style.width = Math.round(progress * 100) + '%';
}

/* ---------------- PDF -> teks ---------------- */
let ocrWorker = null;
let onOcr = () => {};

async function getWorker() {
  if (ocrWorker) return ocrWorker;
  ocrWorker = await Tesseract.createWorker('eng', 1, {
    workerPath: abs('vendor/tesseract/worker.min.js'),
    corePath: abs('vendor/tesseract/core'),
    langPath: abs('vendor/tesseract/lang'),
    gzip: true,
    logger: (m) => onOcr(m),
  });
  await ocrWorker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  return ocrWorker;
}

/** Bila PDF ternyata punya teks asli, pakai itu (lebih akurat dari OCR). */
async function textLayer(page) {
  const tc = await page.getTextContent();
  const items = tc.items.filter((i) => i.str && i.str.trim());
  if (items.length < 20) return null;
  const rows = new Map();
  for (const it of items) {
    const y = Math.round(it.transform[5] / 3);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(it);
  }
  return [...rows.entries()].sort((a, b) => b[0] - a[0])
    .map(([, r]) => r.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join('   '))
    .join('\n');
}

async function pdfToText(file, label) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const native = await textLayer(page);
    if (native) { text += native + '\n'; continue; }
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 15000 / vp1.height);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    setStatus('busy', `${label} — menyiapkan mesin OCR…`, 0.02);
    const worker = await getWorker();
    onOcr = (m) => {
      if (m.status === 'recognizing text') setStatus('busy', `${label} — membaca halaman ${p}/${pdf.numPages}… ${Math.round(m.progress * 100)}%`, m.progress);
    };
    const { data } = await worker.recognize(canvas);
    text += data.text + '\n';
  }
  return text;
}

/* ---------------- proses file ---------------- */
async function handleFiles(files) {
  const pdfs = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!pdfs.length || state.busy) return;
  state.busy = true;
  $('#download').disabled = true;
  const failed = [];
  for (let i = 0; i < pdfs.length; i++) {
    const label = `File ${i + 1}/${pdfs.length} (${pdfs[i].name})`;
    try {
      setStatus('busy', `${label} — membuka PDF…`, 0.01);
      const text = await pdfToText(pdfs[i], label);
      const inv = parseInvoiceText(text, pdfs[i].name);
      state.invoices.push(inv);
      render();
    } catch (err) {
      console.error(err);
      failed.push(`${pdfs[i].name}: ${err.message || err}`);
    }
  }
  state.busy = false;
  $('#file').value = '';
  afterChange();
  if (failed.length) setStatus('warn', 'Gagal memproses: ' + failed.join('; '));
}

/* ---------------- render ---------------- */
const isoWeek = (t) => {
  const d = new Date(Date.UTC(t.y, t.m - 1, t.d));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y0) / 86400000 + 1) / 7);
};
const dateValue = (t) => (t ? `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}` : '');

function render() {
  $('#results').innerHTML = (state.invoices.length > 1 ? '<section class="card summary" id="summary"></section>' : '')
    + state.invoices.map(invCard).join('');
  state.invoices.forEach((_, i) => refresh(i));
  updateSummary();
}

/** Pemeriksaan per invoice + deteksi invoice ganda (No Penjualan sama di beberapa file). */
function checksFor(i) {
  const inv = state.invoices[i];
  const checks = validate(inv);
  if (inv.noPenjualan && state.invoices.some((v, j) => j !== i && v.noPenjualan === inv.noPenjualan)) {
    checks.push({ ok: false, label: 'Invoice ganda', detail: `No Penjualan ${inv.noPenjualan} muncul lebih dari sekali — hapus salah satu` });
  }
  return checks;
}
const problemCount = () => state.invoices.reduce((a, _, i) => a + checksFor(i).filter((c) => !c.ok).length, 0);

function updateSummary() {
  const el = $('#summary');
  if (!el) return;
  const t = columnTotals(layoutRows(state.invoices));
  el.innerHTML = `<strong>${state.invoices.length} invoice akan digabung dalam satu Excel</strong>
    <span>${fmt(t.E)} roll · ${fmt(round2(t.G))} kg roll · ${fmt(round2(t.I))} kg rib</span>
    <span>Total harga: <b>Rp ${fmt(Math.round(t.N))}</b></span>
    <button class="btn btn--ghost" data-act="clear-all">Hapus semua</button>`;
}

function invCard(inv, i) {
  const groups = inv.groups.map((g, gi) => {
    const rows = g.lines.map((l, li) => `
      <tr data-inv="${i}" data-g="${gi}" data-l="${li}">
        <td></td>
        <td><input class="cell w" data-f="l.w" value="${esc(l.w)}" inputmode="decimal" aria-label="Berat kg"></td>
        <td><input class="cell p" data-f="l.price" value="${esc(l.price)}" inputmode="numeric" aria-label="Harga per kg"></td>
        <td><input class="cell a" data-f="l.amount" value="${esc(l.amount)}" inputmode="numeric" aria-label="Jumlah"></td>
        <td class="st"></td>
        <td><button class="x" data-act="del-line" title="Hapus baris" aria-label="Hapus baris">×</button></td>
      </tr>`).join('');
    return `
      <tr class="grp" data-inv="${i}" data-g="${gi}">
        <td colspan="6"><span class="badge ${g.kind}">${g.kind === 'rib' ? 'RIB' : 'ROLL'}</span>
          <input class="cell" data-f="g.warna" value="${esc(g.warna)}" aria-label="Warna">
          <input class="cell short" data-f="g.benang" value="${esc(g.benang)}" aria-label="Benang">
          <button class="btn btn--ghost" data-act="add-line" data-inv="${i}" data-g="${gi}">+ baris</button></td>
      </tr>${rows}`;
  }).join('');

  return `
  <article class="card" data-card="${i}">
    <div class="inv-head">
      <h2 class="inv-title" style="margin:0">${esc(inv.fileName)}<small>${esc(inv.customer || 'Customer tidak terbaca')}</small></h2>
      <button class="btn btn--ghost" data-act="del-inv" data-inv="${i}">Hapus invoice</button>
    </div>
    <div class="inv-fields">
      <label class="field"><span>No Order (kolom P)</span><input type="text" data-inv="${i}" data-f="noPenjualan" value="${esc(inv.noPenjualan)}"></label>
      <label class="field"><span>Tanggal invoice (kolom A)</span><input type="date" data-inv="${i}" data-f="tanggal" value="${dateValue(inv.tanggal)}"></label>
      <label class="field"><span>Tujuan (kolom B)</span><input type="text" data-inv="${i}" data-f="tujuan" value="${esc(inv.tujuan)}" placeholder="dari nama file"></label>
      <label class="field"><span>Kode transfer (kolom O)</span><input type="text" data-inv="${i}" data-f="kodeTransfer" value="${esc(inv.kodeTransfer)}" placeholder="dari nama file"></label>
      <label class="field"><span>Diskon per kg (Rp)</span><input type="text" data-inv="${i}" data-f="diskonPerKg" value="${esc(inv.diskonPerKg)}" inputmode="decimal"></label>
      <div class="field"><span>Total Bayar di invoice</span><div class="ro">${Number.isFinite(inv.totals.totalBayar) ? 'Rp ' + fmt(inv.totals.totalBayar) : '—'}</div></div>
    </div>
    <div class="checks" data-role="checks" aria-live="polite"></div>
    <h3>Hasil baca (bisa diedit)</h3>
    <div class="scroll"><table class="lines"><thead><tr><th></th><th class="num">Berat (kg)</th><th class="num">Harga/kg</th><th class="num">Jumlah</th><th></th><th></th></tr></thead>
      <tbody>${groups}</tbody></table></div>
    <h3>Pratinjau hasil di Excel</h3>
    <div class="scroll" data-role="preview"></div>
    <details style="margin-top:14px"><summary>Teks mentah hasil OCR</summary><pre class="raw">${esc(inv.rawText)}</pre></details>
  </article>`;
}

function refresh(i) {
  const inv = state.invoices[i];
  const card = document.querySelector(`[data-card="${i}"]`);
  if (!inv || !card) return;

  card.querySelector('[data-role="checks"]').innerHTML = checksFor(i)
    .map((c) => `<span class="chip ${c.ok ? '' : 'bad'}">${c.ok ? '✓' : '⚠'} ${esc(c.label)}${c.detail ? `<small>${esc(c.detail)}</small>` : ''}</span>`).join('');

  card.querySelectorAll('tr[data-l]').forEach((tr) => {
    const l = inv.groups[+tr.dataset.g].lines[+tr.dataset.l];
    tr.classList.toggle('bad', !lineOk(l));
    tr.classList.toggle('fixed', !!l.fixed && lineOk(l));
    tr.querySelector('.st').innerHTML = !lineOk(l)
      ? `<span class="note" style="color:var(--bad)">≠ ${fmt(Math.round(l.w * l.price))}</span>`
      : l.fixed ? `<span class="note">dikoreksi otomatis: ${esc(l.fixed)}</span>` : '';
  });

  card.querySelector('[data-role="preview"]').innerHTML = previewTable(inv);
  updateSummary();
}

const rp = (n) => 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
function previewTable(inv) {
  const { rows } = layoutRows([inv]);
  if (!rows.length) return '<p class="note" style="padding:10px">Belum ada baris untuk diekspor.</p>';
  const cellText = (col, c) => {
    if (!c) return '';
    const v = 'v' in c ? c.v : c.r;
    if (v instanceof Date) return v.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
    if (typeof v !== 'number') return esc(v);
    if ('JKLMN'.includes(col)) return rp(v);
    if ('GHI'.includes(col)) return v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 3 });
    return v.toLocaleString('id-ID', { maximumFractionDigits: 3 });
  };
  const body = rows.map(({ first, cells }) => `<tr class="${first ? 'first' : ''}">${COLS.map((col) => {
    const blank = (col === 'B' || col === 'O') && first && !cells[col];
    const l = col === 'C' ? ' l' : '';
    return `<td class="${blank ? 'blank' : ''}${l}">${cellText(col, cells[col])}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="preview"><thead><tr>${HEADERS.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

/* ---------------- edit & aksi ---------------- */
$('#results').addEventListener('input', (e) => {
  const el = e.target;
  const f = el.dataset.f;
  if (!f) return;
  const tr = el.closest('tr');
  const i = +(el.dataset.inv ?? tr?.dataset.inv ?? el.closest('[data-card]').dataset.card);
  const inv = state.invoices[i];
  if (f === 'noPenjualan') inv.noPenjualan = el.value.trim().toUpperCase();
  else if (f === 'tujuan') inv.tujuan = el.value.trim().toUpperCase();
  else if (f === 'kodeTransfer') inv.kodeTransfer = el.value.trim().toUpperCase();
  else if (f === 'tanggal') {
    const m = el.value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    inv.tanggal = m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  } else if (f === 'diskonPerKg') inv.diskonPerKg = parseWeight(el.value) || 0;
  else if (f === 'g.warna') inv.groups[+tr.dataset.g].warna = el.value.toUpperCase().replace(/\s+/g, ' ').trim();
  else if (f === 'g.benang') inv.groups[+tr.dataset.g].benang = el.value.toUpperCase().trim();
  else if (f.startsWith('l.')) {
    const l = inv.groups[+tr.dataset.g].lines[+tr.dataset.l];
    const key = f.slice(2);
    l[key] = key === 'w' ? parseWeight(el.value) : parseMoney(el.value);
    delete l.fixed;
  }
  refresh(i);
  if (f === 'noPenjualan') state.invoices.forEach((_, j) => { if (j !== i) refresh(j); }); // peringatan ganda ikut diperbarui
  afterChange();
});

$('#results').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const tr = b.closest('tr');
  const i = +(b.dataset.inv ?? tr?.dataset.inv);
  const inv = state.invoices[i];
  if (b.dataset.act === 'clear-all') {
    if (!confirm(`Hapus semua ${state.invoices.length} invoice dari daftar?`)) return;
    state.invoices = [];
  } else if (b.dataset.act === 'del-inv') state.invoices.splice(i, 1);
  else if (b.dataset.act === 'add-line') {
    const g = inv.groups[+b.dataset.g];
    const last = g.lines[g.lines.length - 1];
    g.lines.push({ w: NaN, price: last ? last.price : NaN, amount: NaN });
    inv.diskonPerKg = inv.diskonPerKg || deriveDiskonPerKg(inv);
  } else if (b.dataset.act === 'del-line') {
    const g = inv.groups[+tr.dataset.g];
    g.lines.splice(+tr.dataset.l, 1);
    if (!g.lines.length) inv.groups.splice(+tr.dataset.g, 1);
  }
  render();
  afterChange();
});

/* ---------------- status ringkas & export ---------------- */
function afterChange() {
  if (state.busy) return;
  const n = state.invoices.length;
  $('#download').disabled = n === 0;
  if (!n) { setStatus('', 'Menunggu file. Teks dibaca dengan OCR lalu dicek silang dengan total di invoice.'); return; }
  const bad = problemCount();
  setStatus(bad ? 'warn' : 'ok', bad
    ? `${n} invoice terbaca, ${bad} pemeriksaan perlu dicek (lihat tanda ⚠ di bawah).`
    : `${n} invoice terbaca dan semua pemeriksaan silang cocok dengan total di invoice.`);
  const first = state.invoices.find((v) => v.tanggal);
  if (!state.titleEdited && first) $('#title').value = `DATA BAHAN BERDASARKAN FAKTUR W${isoWeek(first.tanggal)}`;
}

$('#title').addEventListener('input', () => { state.titleEdited = true; });

$('#download').addEventListener('click', async () => {
  const bad = problemCount();
  if (bad && !confirm(`Masih ada ${bad} pemeriksaan yang belum cocok. Tetap download?`)) return;
  const btn = $('#download');
  btn.disabled = true;
  btn.textContent = 'Membuat file…';
  try {
    const tpl = await (await fetch('template.xlsx')).arrayBuffer();
    const wb = await buildWorkbook(ExcelJS, tpl, state.invoices, { title: $('#title').value.trim() || undefined });
    const buf = await wb.xlsx.writeBuffer();
    const name = state.invoices.length === 1 && state.invoices[0].noPenjualan
      ? `BERAT RATA-RATA ${state.invoices[0].noPenjualan}.xlsx`
      : `BERAT RATA-RATA ${state.invoices.length} invoice.xlsx`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    console.error(err);
    alert('Gagal membuat Excel: ' + (err.message || err));
  } finally {
    btn.textContent = 'Download Excel';
    btn.disabled = false;
  }
});

/* ---------------- upload ---------------- */
const drop = $('#drop');
const overlay = $('#dropOverlay');
$('#file').addEventListener('change', (e) => handleFiles(e.target.files));
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); } });

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// Seluruh halaman jadi area drop. Penghitung dipakai karena dragenter/dragleave ikut menyala untuk elemen anak.
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
let depth = 0;
const setOver = (on) => { overlay.hidden = !on; drop.classList.toggle('over', on); };
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setOver(true); });
window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setOver(false); });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  depth = 0;
  setOver(false);
  const files = [...e.dataTransfer.files];
  if (state.busy) { toast('Masih memproses file sebelumnya, tunggu sampai selesai.'); return; }
  if (!files.some((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf')) { toast('Hanya file PDF yang bisa diproses.'); return; }
  if (files.some((f) => !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf')) toast('File non-PDF dilewati.');
  handleFiles(files);
});
