// Small canvas charts: the brain diagram, population history and gene trends.
import { KINDS, N_IN, N_H, N_OUT, OUT_LABELS, DAY, labelsFor } from './sim.js';
import { kindRgb } from './render.js';

const C = { ink: '#ebe5d3', muted: '#93a399', rule: '#26372f', bg: '#0e1815', carn: [255, 132, 102], amber: [242, 193, 78], plant: [194, 216, 107] };
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const KC = KINDS.map((_, k) => kindRgb(k));

function fit(cv, h) {
  const dpr = window.devicePixelRatio || 1, w = Math.max(10, Math.min(cv.clientWidth, cv.parentElement ? cv.parentElement.clientWidth : cv.clientWidth));
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  cv.style.height = h + 'px';
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  return [x, w];
}

export function drawBrain(cv, c) {
  const h = 300, [x, w] = fit(cv, h);
  if (!c) return;
  const labels = labelsFor(c.k);
  const xi = Math.min(110, w * 0.36), xh = xi + (w - xi - 70) * 0.55, xo = w - 62;
  const yi = i => 10 + i * (h - 20) / (N_IN - 1), yh = i => 34 + i * (h - 68) / (N_H - 1), yo = i => h / 2 - 70 + i * 70;
  const { w1, w2 } = c;
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

function frame(x, w, h, top, bottom, label, hist) {
  x.strokeStyle = C.rule; x.lineWidth = 1;
  for (let i = 0; i <= 2; i++) { const y = Math.round(top + (h - top - bottom) * i / 2) + .5; x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); }
  x.fillStyle = C.muted; x.font = `10px ${MONO}`; x.textBaseline = 'bottom'; x.textAlign = 'left';
  if (label) x.fillText(label, 2, top - 2);
  if (hist.length > 1) {
    const d0 = Math.floor(hist[0].t / DAY) + 1, d1 = Math.floor(hist[hist.length - 1].t / DAY) + 1;
    x.textBaseline = 'top'; x.fillText('day ' + d0, 2, h - bottom + 3); x.textAlign = 'right'; x.fillText('day ' + d1, w - 2, h - bottom + 3);
  }
}
function series(x, vals, col, w, h, top, bottom, lo, hi, fill, width = 1.6) {
  const pts = []; const n = vals.length;
  vals.forEach((v, i) => { if (v == null) return; pts.push([i / Math.max(1, n - 1) * w, top + (1 - (v - lo) / (hi - lo)) * (h - top - bottom)]); });
  if (pts.length < 2) return;
  x.beginPath(); pts.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py));
  x.strokeStyle = rgba(col, 1); x.lineWidth = width; x.stroke();
  if (fill) { x.lineTo(pts[pts.length - 1][0], h - bottom); x.lineTo(pts[0][0], h - bottom); x.closePath(); x.fillStyle = rgba(col, 0.08); x.fill(); }
  const [ex, ey] = pts[pts.length - 1]; x.fillStyle = rgba(col, 1); x.beginPath(); x.arc(ex, ey, 2.4, 0, 7); x.fill();
}

// population on a log-like square-root scale so small species stay visible next to big herds
export function drawPopulation(cv, hist) {
  const h = 150, [x, w] = fit(cv, h), top = 14, bottom = 16;
  if (hist.length < 2) return;
  let max = 0; for (const r of hist) for (const v of r.n) max = Math.max(max, v);
  max = Math.ceil(Math.max(50, max) / 100) * 100;
  const sq = Math.sqrt(max);
  frame(x, w, h, top, bottom, `${max} (square-root scale)`, hist);
  for (let k = KINDS.length - 1; k >= 0; k--) series(x, hist.map(r => Math.sqrt(r.n[k] || 0)), KC[k], w, h, top, bottom, 0, sq, k === 0);
}

export function drawTrait(cv, hist, key) {
  const h = 64, [x, w] = fit(cv, h), top = 6, bottom = 6;
  if (hist.length < 2) return;
  let lo = 1, hi = 1;
  for (const r of hist) for (const v of r[key]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  lo = Math.floor((lo - 0.05) * 10) / 10; hi = Math.ceil((hi + 0.05) * 10) / 10;
  const y1 = Math.round(top + (1 - (1 - lo) / (hi - lo)) * (h - top - bottom)) + .5;
  x.strokeStyle = C.rule; x.setLineDash([2, 3]); x.beginPath(); x.moveTo(0, y1); x.lineTo(w, y1); x.stroke(); x.setLineDash([]);
  x.fillStyle = C.muted; x.font = `10px ${MONO}`; x.textAlign = 'right'; x.textBaseline = 'top'; x.fillText(hi.toFixed(1) + '×', w - 2, 0);
  x.textBaseline = 'bottom'; x.fillText(lo.toFixed(1) + '×', w - 2, h);
  for (let k = 0; k < KINDS.length; k++) series(x, hist.map(r => r[key][k]), KC[k], w, h, top, bottom, lo, hi, false, 1.3);
}

// how many times better than random brains, per species, on a log scale
export function drawIQ(cv, hist) {
  const h = 120, [x, w] = fit(cv, h), top = 12, bottom = 16;
  if (!hist || hist.length < 2) {
    x.fillStyle = C.muted; x.font = `11px ${MONO}`; x.textBaseline = 'middle'; x.fillText('The history appears after two days.', 2, h / 2); return;
  }
  let hi = 2; for (const r of hist) for (const v of r.r) if (v) hi = Math.max(hi, v);
  const ticks = [1, 2, 5, 10, 20, 50, 100].filter(t => t <= hi * 1.2);
  const top2 = Math.log(Math.max(hi * 1.15, ticks[ticks.length - 1])), lo = Math.log(0.8);
  const y = v => top + (1 - (Math.log(Math.max(0.8, v)) - lo) / (top2 - lo)) * (h - top - bottom);
  x.font = `10px ${MONO}`; x.fillStyle = C.muted; x.textAlign = 'left';
  for (const t of ticks) {
    const yy = Math.round(y(t)) + .5;
    x.strokeStyle = C.rule; x.lineWidth = 1; if (t === 1) x.setLineDash([2, 3]);
    x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy); x.stroke(); x.setLineDash([]);
    x.textBaseline = 'bottom'; x.fillText(t === 1 ? '1× random' : t + '×', 2, yy - 1);
  }
  const d0 = Math.floor(hist[0].t / DAY), d1 = Math.floor(hist[hist.length - 1].t / DAY);
  x.textBaseline = 'top'; x.fillText('day ' + d0, 2, h - bottom + 3); x.textAlign = 'right'; x.fillText('day ' + d1, w - 2, h - bottom + 3);
  for (let k = 0; k < KINDS.length; k++) {
    const pts = []; hist.forEach((r, i) => { const v = r.r[k]; if (v) pts.push([i / (hist.length - 1) * w, y(v)]); });
    if (pts.length < 2) continue;
    x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b));
    x.strokeStyle = rgba(KC[k], 1); x.lineWidth = 1.6; x.stroke();
    const [ex, ey] = pts[pts.length - 1]; x.fillStyle = rgba(KC[k], 1); x.beginPath(); x.arc(ex, ey, 2.4, 0, 7); x.fill();
  }
}
