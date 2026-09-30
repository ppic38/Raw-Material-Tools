// Parser teks hasil OCR invoice Knitto -> struktur data.
// Murni (tanpa DOM) supaya sama persis dipakai di browser dan di test Node.

const OCR_DIGIT = { O: '0', o: '0', I: '1', l: '1', '|': '1' };
const fixDigits = (s) => String(s).replace(/[OoIl|]/g, (c) => OCR_DIGIT[c]);

export function parseMoney(s) {
  const d = fixDigits(s).replace(/[^\d]/g, '');
  return d ? parseInt(d, 10) : NaN;
}

export function parseWeight(s) {
  let t = fixDigits(s).replace(',', '.').replace(/[^\d.]/g, '');
  const parts = t.split('.');
  if (parts.length > 2) t = parts[0] + '.' + parts.slice(1).join('');
  return t ? parseFloat(t) : NaN;
}

export const round2 = (n) => Math.round(n * 100) / 100;
const NUM = '[0-9OoIl|][0-9OoIl|.,]*';
const DETAIL = new RegExp(`^\\s*(${NUM})\\s*K\\s*[GC6]\\b[\\s.:]*(${NUM})\\s+(${NUM})\\s*$`, 'i');
const HEADER = /^\s*(R[I1l]B\s+)?(.*?)\s*\b(\d{1,3})\s*[S5$]\s*[-–—~]\s*(.+?)\s*$/i;
const NOISE = /^[\s_\-–—=~.‗|]*$/;
const KEYWORDS = /(SUB\s*TOTAL|Total|Diskon|Bayar|Ekspedisi|Customer|Tanggal|Penjualan|Antrian|Pengambilan|Faktur|NB\s*:)/i;

const lastNumber = (line) => {
  const m = line.match(new RegExp(`(${NUM})\\s*$`));
  return m ? parseMoney(m[1]) : NaN;
};

/**
 * "OH300726111.YOGI01.MANUAL.pdf" -> {noPenjualan:'OH300726111', tujuan:'YOGI01', kodeTransfer:'MANUAL'}.
 * Nama file yang bukan format ini (bagian pertama bukan No Penjualan) dibiarkan kosong, bukan ditebak.
 */
export function parseFileName(name) {
  const base = String(name || '').replace(/^.*[\\/]/, '').replace(/\.pdf$/i, '')
    .replace(/(\s*-\s*copy)?(\s*\(\d+\))?\s*$/i, '') // akhiran salinan dari Windows/browser: " - Copy", " (1)"
    .trim();
  const [no = '', tujuan = '', ...rest] = base.split('.');
  const noPenjualan = no.trim().toUpperCase();
  if (!/^[A-Z]{2}\d{6,}$/.test(noPenjualan)) return { noPenjualan: '', tujuan: '', kodeTransfer: '' };
  return { noPenjualan, tujuan: tujuan.trim().toUpperCase(), kodeTransfer: rest.join('.').trim().toUpperCase() };
}

export const normColor =(s) => String(s).toUpperCase().replace(/\s+/g, ' ').trim();

export function parseDate(text) {
  const m = text.match(/Tanggal\s*[:;]?\s*(\d{2})\s*[-/.]\s*(\d{2})\s*[-/.]\s*(\d{4})/i);
  if (!m) return null;
  return { d: +m[1], m: +m[2], y: +m[3] };
}

/**
 * @param {string} text  teks mentah hasil OCR (atau ekstraksi teks PDF)
 * @param {string} fileName
 */
export function parseInvoiceText(text, fileName = '') {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const inv = {
    fileName,
    noPenjualan: '',
    tanggal: parseDate(text),
    customer: '',
    groups: [], // {kind:'roll'|'rib', warna, benang, lines:[{w,price,amount}]}
    totals: { subtotal: NaN, diskon: NaN, totalBayar: NaN, kgan: null, rollan: null },
    diskonPerKg: NaN,
    warnings: [],
    rawText: text,
  };

  const mNo = text.match(/No\s*Penjualan\s*[:;]?\s*([A-Z0-9]{8,})/i);
  if (mNo) inv.noPenjualan = mNo[1].toUpperCase().replace(/^0H/, 'OH');

  // Nama file NOPENJUALAN.TUJUAN.KODETRANSFER.pdf -> kolom TUJUAN (B) dan NO INVOICE (O)
  const fn = parseFileName(fileName);
  inv.tujuan = fn.tujuan;
  inv.kodeTransfer = fn.kodeTransfer;
  if (!inv.noPenjualan) inv.noPenjualan = fn.noPenjualan;
  else if (fn.noPenjualan && fn.noPenjualan !== inv.noPenjualan) {
    inv.warnings.push(`No Penjualan di nama file (${fn.noPenjualan}) berbeda dengan yang terbaca di invoice (${inv.noPenjualan}) — cek.`);
  }

  let i = 0;
  let current = null; // group yang sedang dibaca
  let inItems = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*Customer/i.test(line)) {
      let c = line.replace(/^\s*Customer\s*[:;]?\s*/i, '');
      const next = lines[i + 1] || '';
      if (next && !/[:;]/.test(next) && !NOISE.test(next)) c += ' ' + next.trim();
      inv.customer = c.trim();
    }
    if (/SUB\s*TOTAL/i.test(line)) { inv.totals.subtotal = lastNumber(line); inItems = false; continue; }
    if (/Total\s*Diskon/i.test(line)) { inv.totals.diskon = lastNumber(line); continue; }
    if (/Total\s*Bayar/i.test(line)) { inv.totals.totalBayar = lastNumber(line); continue; }
    if (/Total\s*KG\s*-?\s*an/i.test(line)) {
      const m = line.match(new RegExp(`(${NUM})\\s*KG\\s*\\(\\s*(\\d+)\\s*\\)`, 'i'));
      if (m) inv.totals.kgan = { kg: parseWeight(m[1]), n: +m[2] };
      continue;
    }
    if (/Total\s*Roll\s*-?\s*an/i.test(line) && !inv.totals.rollan) {
      const m = line.match(new RegExp(`(${NUM})\\s*KG\\s*\\(\\s*(\\d+)\\s*\\)`, 'i'));
      if (m) inv.totals.rollan = { kg: parseWeight(m[1]), n: +m[2] };
      continue;
    }

    const det = line.match(DETAIL);
    if (det && current) {
      current.lines.push({ w: parseWeight(det[1]), price: parseMoney(det[2]), amount: parseMoney(det[3]) });
      inItems = true;
      continue;
    }
    const hd = line.match(HEADER);
    if (hd && !/^\s*(Total|SUB)/i.test(line)) {
      current = { kind: hd[1] ? 'rib' : 'roll', warna: normColor(hd[4]), benang: `${hd[3]}S`, lines: [] };
      inv.groups.push(current);
      inItems = true;
      continue;
    }
    // nama warna panjang yang terpotong ke baris berikut
    if (current && current.lines.length === 0 && line.trim() && !NOISE.test(line) && !KEYWORDS.test(line)) {
      current.warna = normColor(current.warna + ' ' + line);
    }
  }

  inv.groups = inv.groups.filter((g) => g.lines.length);
  if (!inv.groups.length) inv.warnings.push('Tidak ada baris barang yang terbaca dari PDF.');
  if (!inv.noPenjualan) inv.warnings.push('No Penjualan tidak terbaca — isi manual.');
  if (!inv.tanggal) inv.warnings.push('Tanggal tidak terbaca — isi manual.');

  // No Penjualan memuat tanggal (OH + ddmmyy + urut). Pakai untuk melengkapi/menegur tanggal.
  const mId = inv.noPenjualan.match(/^OH(\d{2})(\d{2})(\d{2})\d+$/);
  if (mId) {
    const idDate = { d: +mId[1], m: +mId[2], y: 2000 + +mId[3] };
    if (!inv.tanggal) inv.tanggal = idDate;
    else if (inv.tanggal.d !== idDate.d || inv.tanggal.m !== idDate.m || inv.tanggal.y !== idDate.y) {
      inv.warnings.push('Tanggal di invoice tidak sama dengan tanggal yang tertanam di No Penjualan — cek.');
    }
  }

  reconcile(inv);
  inv.diskonPerKg = deriveDiskonPerKg(inv);
  return inv;
}

const allLines = (inv) => inv.groups.flatMap((g) => g.lines);
const sumAmount = (inv) => allLines(inv).reduce((a, l) => a + (Number.isFinite(l.amount) ? l.amount : 0), 0);
const expected = (l) => Math.round(l.w * l.price);
export const lineOk = (l) => Number.isFinite(l.w) && Number.isFinite(l.price) && Number.isFinite(l.amount) && Math.abs(expected(l) - l.amount) <= 1;

/**
 * Koreksi otomatis salah baca OCR memakai redundansi: berat x harga = jumlah, dan total jumlah = SUBTOTAL.
 * Hanya diterapkan bila tepat satu kombinasi perbaikan yang membuat SUBTOTAL cocok.
 */
export function reconcile(inv) {
  const bad = allLines(inv).filter((l) => !lineOk(l));
  if (!bad.length || !Number.isFinite(inv.totals.subtotal) || bad.length > 4) return;
  const options = bad.map((l) => {
    const opts = [];
    if (Number.isFinite(l.price) && l.price > 0 && Number.isFinite(l.amount)) {
      const w = l.amount / l.price;
      if (Math.abs(w * 100 - Math.round(w * 100)) < 1e-6) opts.push({ w: round2(w), amount: l.amount, how: 'berat dikoreksi dari jumlah' });
    }
    if (Number.isFinite(l.w) && Number.isFinite(l.price)) opts.push({ w: l.w, amount: expected(l), how: 'jumlah dihitung ulang dari berat × harga' });
    return opts;
  });
  if (options.some((o) => !o.length)) return;
  const base = sumAmount(inv) - bad.reduce((a, l) => a + (Number.isFinite(l.amount) ? l.amount : 0), 0);
  const winners = [];
  const walk = (k, picks, total) => {
    if (k === bad.length) { if (total === inv.totals.subtotal) winners.push(picks); return; }
    for (const o of options[k]) walk(k + 1, [...picks, o], total + o.amount);
  };
  walk(0, [], base);
  if (winners.length !== 1) return;
  winners[0].forEach((o, k) => {
    Object.assign(bad[k], { w: o.w, amount: o.amount, fixed: o.how });
  });
}

export function deriveDiskonPerKg(inv) {
  const kg = allLines(inv).reduce((a, l) => a + (Number.isFinite(l.w) ? l.w : 0), 0);
  const d = inv.totals.diskon;
  if (!Number.isFinite(d)) return 2000; // default template; ditandai sebagai asumsi lewat validate()
  if (!kg) return 0;
  const rate = d / kg;
  return Math.abs(rate - Math.round(rate)) * kg < 1 ? Math.round(rate) : round2(rate);
}

/** Kelompokkan baris jadi blok warna seperti di template: roll + rib yang cocok (warna & benang). */
export function buildBlocks(inv) {
  const blocks = [];
  for (const g of inv.groups.filter((x) => x.kind === 'roll')) {
    blocks.push({ warna: g.warna, benang: g.benang, rolls: g.lines, ribs: [] });
  }
  for (const g of inv.groups.filter((x) => x.kind === 'rib')) {
    let b = blocks.find((x) => normColor(x.warna) === normColor(g.warna) && x.benang === g.benang);
    if (!b) {
      b = { warna: g.warna, benang: g.benang, rolls: [], ribs: [], orphanRib: true };
      blocks.push(b);
    }
    b.ribs.push(...g.lines);
  }
  return blocks;
}

/** Daftar pemeriksaan silang. ok=false berarti ada yang perlu dicek manual. */
export function validate(inv) {
  const checks = [];
  const add = (id, label, ok, detail) => checks.push({ id, label, ok, detail });
  const lines = allLines(inv);
  const badLines = lines.filter((l) => !lineOk(l));
  add('lines', 'Berat × harga = jumlah di setiap baris', badLines.length === 0,
    badLines.length ? `${badLines.length} baris tidak cocok (ditandai merah)` : `${lines.length} baris cocok`);

  const fixed = lines.filter((l) => l.fixed);
  if (fixed.length) add('fixed', 'Koreksi otomatis OCR', true, `${fixed.length} baris dikoreksi (ditandai kuning)`);

  const t = inv.totals;
  const sum = sumAmount(inv);
  if (Number.isFinite(t.subtotal)) add('subtotal', 'Total jumlah = SUBTOTAL invoice', sum === t.subtotal, `${fmt(sum)} vs ${fmt(t.subtotal)}`);
  else add('subtotal', 'SUBTOTAL terbaca', false, 'SUBTOTAL tidak terbaca');

  if (Number.isFinite(t.subtotal) && Number.isFinite(t.totalBayar)) {
    const dsk = Number.isFinite(t.diskon) ? t.diskon : 0;
    add('bayar', 'SUBTOTAL − Diskon = Total Bayar', t.subtotal - dsk === t.totalBayar, `${fmt(t.subtotal - dsk)} vs ${fmt(t.totalBayar)}`);
  }

  const rolls = inv.groups.filter((g) => g.kind === 'roll').flatMap((g) => g.lines);
  const ribs = inv.groups.filter((g) => g.kind === 'rib').flatMap((g) => g.lines);
  const kgSum = (a) => round2(a.reduce((x, l) => x + (Number.isFinite(l.w) ? l.w : 0), 0));
  if (t.rollan) add('roll', 'Jumlah & berat roll = Total Roll-an', rolls.length === t.rollan.n && Math.abs(kgSum(rolls) - t.rollan.kg) < 0.011,
    `${rolls.length} roll / ${kgSum(rolls)} kg vs ${t.rollan.n} / ${t.rollan.kg} kg`);
  if (t.kgan) add('rib', 'Jumlah & berat rib = Total KG-an', ribs.length === t.kgan.n && Math.abs(kgSum(ribs) - t.kgan.kg) < 0.011,
    `${ribs.length} baris / ${kgSum(ribs)} kg vs ${t.kgan.n} / ${t.kgan.kg} kg`);

  const kgAll = kgSum(lines);
  const dsk = Math.round(kgAll * (inv.diskonPerKg || 0));
  if (Number.isFinite(t.diskon)) add('diskon', `Diskon = total kg × Rp ${fmt(inv.diskonPerKg)}/kg`, Math.abs(dsk - t.diskon) <= 1,
    `${fmt(dsk)} vs ${fmt(t.diskon)}`);
  else add('diskon', 'Total Diskon terbaca', false, `Tidak terbaca — memakai Rp ${fmt(inv.diskonPerKg)}/kg (default template), cek manual`);

  for (const b of buildBlocks(inv)) {
    if (b.orphanRib) add('orphan', `Rib ${b.warna} punya roll?`, false, 'Ada rib tanpa roll warna yang sama');
  }
  for (const w of inv.warnings) add('warn', w, false, '');
  return checks;
}

export const fmt = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n).toLocaleString('id-ID');
