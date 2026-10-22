// Small canvas charts: the brain diagram, population history and gene trends.
import { KINDS, N_IN, N_H, N_OUT, OUT_LABELS, DAY } from './sim.js';

const C = {
  ink: '#ebe5d3', muted: '#93a399', rule: '#26372f', bg: '#0e1815',
  herb: [143, 211, 232], carn: [255, 132, 102], plant: [194, 216, 107], amber: [242, 193, 78],
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

function fit(cv, h) {
  const dpr = window.devicePixelRatio || 1, w = Math.max(10, cv.clientWidth);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  cv.style.height = h + 'px';
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  return [x, w];
}

export function drawBrain(cv, c) {
  const h = 300, [x, w] = fit(cv, h);
  if (!c) return;
  const labels = KINDS[c.k].labels;
  const xi = Math.min(108, w * 0.36), xh = xi + (w - xi - 70) * 0.55, xo = w - 62;
  const yi = i => 10 + i * (h - 20) / (N_IN - 1), yh = i => 34 + i * (h - 68) / (N_H - 1), yo = i => h / 2 - 70 + i * 70;
  const { w1, w2 } = c.brain;
  const line = (ax, ay, bx, by, v, act) => {
    const a = Math.min(0.85, 0.08 + Math.abs(v) * 0.2 + Math.abs(act) * 0.25);
    x.strokeStyle = v >= 0 ? rgba([235, 229, 211], a) : rgba(C.carn, a);
    x.lineWidth = Math.min(3, 0.4 + Math.abs(v) * 1.1);
    x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
  };
  for (let j = 0; j < N_H; j++) for (let i = 0; i < N_IN; i++) line(xi, yi(i), xh, yh(j), w1[j * N_IN + i], c.inp[i]);
  for (let o = 0; o < N_OUT; o++) for (let j = 0; j < N_H; j++) line(xh, yh(j), xo, yo(o), w2[o * (N_H + 1) + j], c.hid[j]);
  const node = (nx, ny, v) => {
    x.fillStyle = C.bg; x.beginPath(); x.arc(nx, ny, 5.5, 0, 7); x.fill();
    x.fillStyle = rgba(v >= 0 ? C.amber : C.carn, 0.12 + Math.min(1, Math.abs(v)) * 0.88);
    x.beginPath(); x.arc(nx, ny, 5.5, 0, 7); x.fill();
    x.strokeStyle = C.muted; x.lineWidth = 1; x.stroke();
  };
  x.font = `11px ${MONO}`; x.textBaseline = 'middle';
  for (let i = 0; i < N_IN; i++) { node(xi, yi(i), c.inp[i]); x.fillStyle = C.muted; x.textAlign = 'right'; x.fillText(labels[i], xi - 10, yi(i)); }
  for (let j = 0; j < N_H; j++) node(xh, yh(j), c.hid[j]);
  for (let o = 0; o < N_OUT; o++) { node(xo, yo(o), c.out[o]); x.fillStyle = C.ink; x.textAlign = 'left'; x.fillText(OUT_LABELS[o], xo + 10, yo(o)); }
}

function axes(x, w, h, top, bottom, max, history) {
  x.strokeStyle = C.rule; x.lineWidth = 1;
  for (let i = 0; i <= 2; i++) { const y = Math.round(top + (h - top - bottom) * i / 2) + .5; x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); }
  x.fillStyle = C.muted; x.font = `10px ${MONO}`; x.textBaseline = 'bottom'; x.textAlign = 'left';
  x.fillText(String(max), 2, top - 2);
  if (history.length > 1) {
    const d0 = Math.floor(history[0].t / DAY) + 1, d1 = Math.floor(history[history.length - 1].t / DAY) + 1;
    x.textBaseline = 'top'; x.fillText('day ' + d0, 2, h - bottom + 3); x.textAlign = 'right'; x.fillText('day ' + d1, w - 2, h - bottom + 3);
  }
}
function series(x, hist, key, col, w, h, top, bottom, lo, hi, fill) {
  const pts = []; const n = hist.length;
  hist.forEach((r, i) => { const v = r[key]; if (v == null) return; pts.push([i / (n - 1) * w, top + (1 - (v - lo) / (hi - lo)) * (h - top - bottom)]); });
  if (pts.length < 2) return;
  x.beginPath(); pts.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py));
  x.strokeStyle = rgba(col, 1); x.lineWidth = 1.6; x.stroke();
  if (fill) { x.lineTo(pts[pts.length - 1][0], h - bottom); x.lineTo(pts[0][0], h - bottom); x.closePath(); x.fillStyle = rgba(col, 0.1); x.fill(); }
  const [ex, ey] = pts[pts.length - 1]; x.fillStyle = rgba(col, 1); x.beginPath(); x.arc(ex, ey, 2.6, 0, 7); x.fill();
}

export function drawPopulation(cv, hist) {
  const h = 140, [x, w] = fit(cv, h), top = 14, bottom = 16;
  if (hist.length < 2) return;
  let max = 0; for (const r of hist) max = Math.max(max, r.h, r.c * 3);
  max = Math.ceil(Math.max(50, max) / 50) * 50;
  axes(x, w, h, top, bottom, max, hist);
  const scaled = hist.map(r => ({ ...r, c3: r.c * 3, p4: r.p / 4 }));
  series(x, scaled, 'p4', C.plant, w, h, top, bottom, 0, max, false);
  series(x, scaled, 'h', C.herb, w, h, top, bottom, 0, max, true);
  series(x, scaled, 'c3', C.carn, w, h, top, bottom, 0, max, true);
}

export function drawTrait(cv, hist, kh, kc) {
  const h = 64, [x, w] = fit(cv, h), top = 6, bottom = 6;
  if (hist.length < 2) return;
  let lo = 1, hi = 1;
  for (const r of hist) for (const k of [kh, kc]) if (r[k] != null) { lo = Math.min(lo, r[k]); hi = Math.max(hi, r[k]); }
  lo = Math.floor((lo - 0.05) * 10) / 10; hi = Math.ceil((hi + 0.05) * 10) / 10;
  const y1 = top + (1 - (1 - lo) / (hi - lo)) * (h - top - bottom);
  x.strokeStyle = C.rule; x.setLineDash([2, 3]); x.beginPath(); x.moveTo(0, Math.round(y1) + .5); x.lineTo(w, Math.round(y1) + .5); x.stroke(); x.setLineDash([]);
  series(x, hist, kh, C.herb, w, h, top, bottom, lo, hi, false);
  series(x, hist, kc, C.carn, w, h, top, bottom, lo, hi, false);
}
