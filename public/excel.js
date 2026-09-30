// Membentuk baris sesuai TEMPLATE BERAT RATA-RATA.xlsx (rumus + nilai hasil) dan menulisnya ke file template asli.
import { buildBlocks } from './parser.js';

export const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];
export const HEADERS = ['TANGGAL INVOICE', 'TUJUAN', 'WARNA', 'BENANG', 'ROLL', 'BERAT ()/ROLL', 'BERAT TOTAL', 'BERAT RATA2', 'RIB ()',
  'HARGA RIB', 'HARGA/ROLL', 'HARGA/WARNA', 'DISKON', 'HARGA TOTAL', 'NO INVOICE', 'NO ORDER'];
export const FIRST_ROW = 4;

const sum = (a) => a.reduce((x, y) => x + y, 0);

/**
 * @returns {{rows: Array<{row:number, first:boolean, cells:Object}>, last:number}}
 * cells[col] = { v } (nilai biasa) | { f, r } (rumus + hasil hitung)
 */
export function layoutRows(invoices, startRow = FIRST_ROW) {
  const rows = [];
  let r = startRow;
  for (const inv of invoices) {
    const blocks = buildBlocks(inv);
    if (!blocks.length) continue;
    const orderStart = r;
    const orderRows = blocks.map((b) => Math.max(1, b.rolls.length));
    const orderEnd = orderStart + sum(orderRows) - 1;
    const date = inv.tanggal ? new Date(Date.UTC(inv.tanggal.y, inv.tanggal.m - 1, inv.tanggal.d)) : null;

    const blockCalc = [];
    blocks.forEach((b, bi) => {
      const s = r;
      const n = orderRows[bi];
      const e = s + n - 1;
      const weights = b.rolls.map((l) => l.w);
      const ribKg = sum(b.ribs.map((l) => l.w));
      const ribPrices = [...new Set(b.ribs.map((l) => l.price))];
      const ribCost = sum(b.ribs.map((l) => l.w * l.price));
      const rollCost = b.rolls.map((l) => l.w * l.price);
      const G = sum(weights);
      const calc = { s, e, G, I: ribKg, J: ribCost, L: ribCost + sum(rollCost) };
      blockCalc.push(calc);

      for (let i = 0; i < n; i++) {
        const cells = {};
        const roll = b.rolls[i];
        if (i === 0) {
          if (date) cells.A = { v: date };
          cells.C = { v: b.warna };
          cells.D = { v: b.benang };
          cells.E = { v: b.rolls.length };
          cells.G = { f: `SUM(F${s}:F${e})`, r: G };
          cells.H = { f: `AVERAGE(F${s}:F${e})`, r: weights.length ? G / weights.length : 0 };
          if (b.ribs.length === 1) cells.I = { v: b.ribs[0].w };
          else if (b.ribs.length > 1) cells.I = { f: b.ribs.map((l) => l.w).join('+'), r: ribKg };
          if (b.ribs.length) {
            cells.J = ribPrices.length === 1
              ? { f: `I${s}*${ribPrices[0]}`, r: ribCost }
              : { f: b.ribs.map((l) => `${l.w}*${l.price}`).join('+'), r: ribCost };
          }
          cells.L = { f: `SUM(J${s}:K${e})`, r: calc.L };
          // TUJUAN (B) dan NO INVOICE (O) tidak ada di isi invoice; diambil dari nama file, kosong bila tidak ada
          if (inv.tujuan) cells.B = { v: inv.tujuan };
          if (inv.kodeTransfer) cells.O = { v: /^\d+$/.test(inv.kodeTransfer) ? Number(inv.kodeTransfer) : inv.kodeTransfer };
          cells.P = { v: inv.noPenjualan };
        }
        if (roll) {
          cells.F = { v: roll.w };
          cells.K = { f: `F${r}*${roll.price}`, r: roll.w * roll.price };
        }
        rows.push({ row: r, first: i === 0, cells });
        r++;
      }
    });

    // Diskon & harga total per order, di baris pertama order (sama seperti template)
    const kgOrder = sum(blockCalc.map((c) => c.G + c.I));
    const M = kgOrder * (inv.diskonPerKg || 0);
    const N = sum(blockCalc.map((c) => c.L)) - M;
    const firstRow = rows.find((x) => x.row === orderStart);
    firstRow.cells.M = { f: `SUM(G${orderStart}:G${orderEnd},I${orderStart}:I${orderEnd})*${inv.diskonPerKg || 0}`, r: M };
    firstRow.cells.N = { f: `SUM(L${orderStart}:L${orderEnd})-M${orderStart}`, r: N };
  }
  return { rows, last: r - 1 };
}

/** Total baris 2 (rumus SUM template, tetap dipertahankan) */
export function columnTotals(layout) {
  const t = {};
  for (const c of COLS.slice(4)) {
    t[c] = 0;
    for (const row of layout.rows) {
      const cell = row.cells[c];
      if (!cell) continue;
      const val = 'v' in cell ? cell.v : cell.r;
      if (typeof val === 'number') t[c] += val;
    }
  }
  return t;
}

const clone = (o) => JSON.parse(JSON.stringify(o));

export async function buildWorkbook(ExcelJS, templateBuffer, invoices, { title } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer);
  const ws = wb.worksheets[0];

  // Ambil gaya dari template: baris 4 = baris pertama blok, baris 5 = baris lanjutan
  const protoFirst = COLS.map((_, i) => clone(ws.getCell(FIRST_ROW, i + 1).style));
  const protoNext = COLS.map((_, i) => clone(ws.getCell(FIRST_ROW + 1, i + 1).style));

  // Kosongkan data lama
  for (let r = FIRST_ROW; r <= ws.rowCount; r++) {
    for (let c = 1; c <= COLS.length; c++) {
      const cell = ws.getCell(r, c);
      cell.value = null;
      cell.style = {};
    }
  }

  const layout = layoutRows(invoices);
  for (const { row, first, cells } of layout.rows) {
    COLS.forEach((col, i) => {
      const cell = ws.getCell(`${col}${row}`);
      cell.style = clone(first ? protoFirst[i] : protoNext[i]);
      const c = cells[col];
      if (!c) return;
      if ('f' in c) cell.value = { formula: c.f, result: c.r };
      else cell.value = c.v;
    });
  }

  // Kolom L (HARGA/WARNA) di template terlalu sempit: nilai besar tampil "####". Samakan dengan lebar J.
  ws.getColumn('L').width = Math.max(ws.getColumn('L').width || 0, 17);

  if (title) ws.getCell('A1').value = title;
  const totals = columnTotals(layout);
  for (const col of COLS.slice(4)) {
    const cell = ws.getCell(`${col}2`);
    const f = cell.value && cell.value.formula ? cell.value.formula : `SUM(${col}4:${col}46507)`;
    cell.value = { formula: f, result: totals[col] };
  }
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(layout.last, 4), column: COLS.length } };
  return wb;
}
