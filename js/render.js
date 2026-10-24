// Draws world snapshots into a W×H pixel buffer, then scales it to the screen with a wrap-around camera.
import { W, H, SEASON, DAY, DEEP, SHALLOW, SAND, ROCK, KINDS, tdelta } from './sim.js';

const pack = (r, g, b) => ((255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Seasonal palettes: spring, summer, autumn, winter
const PAL = {
  grassLo: [[34, 58, 42], [50, 66, 38], [70, 58, 36], [78, 88, 92]],
  grassHi: [[60, 108, 60], [88, 114, 54], [128, 98, 50], [148, 160, 162]],
  sand: [[146, 130, 92], [166, 144, 98], [150, 124, 88], [168, 170, 164]],
  rock: [[82, 82, 86], [92, 88, 84], [88, 80, 76], [156, 160, 166]],
  shallow: [[46, 98, 114], [50, 108, 120], [44, 88, 104], [100, 132, 148]],
  deep: [[20, 46, 74], [22, 54, 80], [20, 44, 68], [42, 68, 92]],
  leaf: [[146, 214, 98], [194, 216, 92], [226, 156, 66], [190, 206, 186]],
  sprout: [[84, 134, 66], [104, 132, 60], [130, 104, 58], [116, 132, 124]],
};
const BERRY = [232, 72, 92];
export function hslRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export const kindRgb = k => hslRgb(KINDS[k].hue, KINDS[k].sat, KINDS[k].lit);
export const kindCss = k => `rgb(${kindRgb(k)})`;
export const lineCss = (k, hue) => `rgb(${hslRgb(hue, KINDS[k].sat, KINDS[k].lit)})`;
const KTRAIL = KINDS.map((_, k) => kindRgb(k));
const colorCache = new Map();
function creatureCol(k, hue) {
  const key = k * 1000 + Math.round(((hue % 360) + 360) % 360);
  let c = colorCache.get(key);
  if (!c) { c = hslRgb(Math.round(hue), KINDS[k].sat, KINDS[k].lit); colorCache.set(key, c); }
  return c;
}

// Pixel sprites per kind, small and large: offsets from the creature's pixel.
const SPR = [
  [[[-1, -1], [0, -1], [-1, 0], [0, 0]], [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]],
  [[[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]], [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]]],
  [[[-1, 0], [0, 0], [1, 0], [-1, -1], [0, -1], [1, -1]], [[-1, 0], [0, 0], [1, 0], [2, 0], [-1, -1], [0, -1], [1, -1], [2, -1], [-1, 1], [0, 1], [1, 1], [2, 1]]],
  [[[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]], [[0, 0], [1, 0], [-1, -1], [2, -1], [-1, 1], [2, 1], [0, -1], [1, 1]]],
];
const WINGS_UP = [[0, 0], [-1, -1], [1, -1], [-2, -1], [2, -1]];
const WINGS_DOWN = [[0, 0], [-1, 0], [1, 0], [-2, 1], [2, 1]];

export class Renderer {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas'); this.off.width = W; this.off.height = H;
    this.octx = this.off.getContext('2d');
    this.img = this.octx.createImageData(W, H); this.buf = new Uint32Array(this.img.data.buffer);
    this.base = new Uint32Array(W * H);
    this.trail = new Float32Array(W * H * 3);
    this.phase = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) this.phase[i] = (Math.imul(i + 7, 2654435761) >>> 24);
    this.cam = { x: W / 2, y: H / 2, zoom: 2 };
    this.fx = []; this.parts = []; this.frame = 0; this.bakedKey = '';
    this.trails = true; this.effects = true; this.terrain = null;
    this.resize();
  }
  setTerrain(t) { this.terrain = t; this.bakedKey = ''; this.trail.fill(0); this.fx.length = 0; }
  setWater(typeArr, ver) { if (this.terrain) { this.terrain.typeArr = typeArr; this.terrain.waterVer = ver; this.bakedKey = ''; } }
  resize() {
    const dpr = window.devicePixelRatio || 1, r = this.cv.getBoundingClientRect();
    this.cv.width = Math.max(1, Math.round(r.width * dpr)); this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
  }
  get scale() { return this.cv.width / W * this.cam.zoom; }
  clampCam() {
    this.cam.zoom = clamp(this.cam.zoom, 1, 12);
    this.cam.x = ((this.cam.x % W) + W) % W; this.cam.y = ((this.cam.y % H) + H) % H;
  }
  toWorld(px, py) {
    const s = this.scale / this.dpr, cw = this.cv.width / this.dpr, ch = this.cv.height / this.dpr;
    const x = this.cam.x + (px - cw / 2) / s, y = this.cam.y + (py - ch / 2) / s;
    return [((x % W) + W) % W, ((y % H) + H) % H];
  }
  toScreen(wx, wy) {
    const s = this.scale;
    return [this.cv.width / 2 + tdelta(this.cam.x, wx, W) * s, this.cv.height / 2 + tdelta(this.cam.y, wy, H) * s];
  }
  zoomAt(px, py, factor) {
    const [wx, wy] = this.toWorld(px, py);
    this.cam.zoom = clamp(this.cam.zoom * factor, 1, 12);
    const s = this.scale / this.dpr, cw = this.cv.width / this.dpr, ch = this.cv.height / this.dpr;
    this.cam.x = wx - (px - cw / 2) / s; this.cam.y = wy - (py - ch / 2) / s;
    this.clampCam();
  }

  bakeTerrain(T, ev) {
    const t = (T % SEASON) / SEASON, s = Math.floor(T / SEASON) % 4, n = (s + 1) % 4, f = clamp((t - 0.7) / 0.3, 0, 1);
    const tint = ev && (ev.type === 'drought' || ev.type === 'frost') ? ev.type : '';
    const key = `${s}:${Math.round(f * 25)}:${this.terrain.waterVer}:${tint}`;
    if (key === this.bakedKey) return;
    this.bakedKey = key;
    const P = {}; for (const k in PAL) P[k] = mix(PAL[k][s], PAL[k][n], f);
    if (tint === 'drought') for (const k of ['grassLo', 'grassHi', 'leaf', 'sprout']) P[k] = mix(P[k], [150, 128, 80], 0.45);
    if (tint === 'frost') for (const k in P) P[k] = mix(P[k], [196, 214, 226], 0.4);
    this.leaf = P.leaf; this.sprout = P.sprout;
    const { typeArr: type, height, moist, fert } = this.terrain, base = this.base;
    for (let i = 0; i < W * H; i++) {
      const tp = type[i], d = ((this.phase[i] & 15) - 7.5) * 0.7;
      let c;
      if (tp === DEEP) c = mix(P.deep, P.shallow, clamp(height[i] * 1.5, 0, 0.5));
      else if (tp === SHALLOW) c = P.shallow;
      else if (tp === SAND) c = P.sand;
      else if (tp === ROCK) c = mix(P.rock, [200, 200, 204], clamp((height[i] - 0.9) * 3, 0, 0.5));
      else c = mix(P.grassLo, P.grassHi, clamp(moist[i] * 0.85 + fert[i] * 0.3, 0, 1));
      base[i] = pack(clamp(c[0] + d, 0, 255) | 0, clamp(c[1] + d, 0, 255) | 0, clamp(c[2] + d, 0, 255) | 0);
    }
  }

  // weather particles live in screen space
  weather(f, ctx, cw, ch) {
    const ev = f.ev ? f.ev.type : '', season = f.season, dpr = this.dpr;
    let kind = '', rate = 0;
    if (ev === 'flood') { kind = 'rain'; rate = 9; }
    else if (ev === 'frost') { kind = 'snow'; rate = 4; }
    else if (ev === 'bloom') { kind = 'pollen'; rate = 1.5; }
    else if (ev === 'drought') { kind = 'dust'; rate = 0.8; }
    else if (season === 3) { kind = 'snow'; rate = 0.7; }
    else if (season === 2) { kind = 'rain'; rate = 1; }
    if (!this.effects) rate = 0;
    const P = this.parts, spawn = rate * (cw / dpr / 900 + 0.3);
    for (let i = 0; i < spawn; i++) {
      if (P.length > 600) break;
      if (i + 1 > spawn && Math.random() > spawn % 1) break;
      if (kind === 'rain') P.push({ k: kind, x: Math.random() * cw * 1.2, y: -10, vx: -2 * dpr, vy: 14 * dpr, life: 0 });
      else if (kind === 'snow') P.push({ k: kind, x: Math.random() * cw * 1.1, y: -6, vx: (Math.random() - .5) * dpr, vy: (1 + Math.random()) * dpr, life: 0 });
      else P.push({ k: kind, x: Math.random() * cw, y: Math.random() * ch, vx: (Math.random() - .5) * 0.6 * dpr, vy: (Math.random() - .7) * 0.5 * dpr, life: 0 });
    }
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.x += p.vx; p.y += p.vy; p.life++;
      if (p.y > ch + 10 || p.x < -20 || ((p.k === 'pollen' || p.k === 'dust') && p.life > 120)) { P.splice(i, 1); continue; }
      if (p.k === 'rain') { ctx.strokeStyle = 'rgba(180,210,235,0.45)'; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.6, p.y - p.vy * 0.6); ctx.stroke(); }
      else if (p.k === 'snow') { ctx.fillStyle = 'rgba(240,246,250,0.8)'; ctx.fillRect(p.x, p.y, 2 * dpr, 2 * dpr); }
      else if (p.k === 'pollen') { ctx.fillStyle = `rgba(230,240,140,${Math.sin(p.life / 120 * Math.PI) * 0.8})`; ctx.fillRect(p.x, p.y, 2 * dpr, 2 * dpr); }
      else { ctx.fillStyle = `rgba(210,180,120,${Math.sin(p.life / 120 * Math.PI) * 0.35})`; ctx.fillRect(p.x, p.y, 3 * dpr, 1.5 * dpr); }
    }
  }

  draw(f) {
    if (!this.terrain || !f) return;
    this.frame++;
    this.bakeTerrain(f.T, f.ev);
    if (this.effects) for (const e of f.fx) if (this.fx.length < 260 || e.type === 'meteor') this.fx.push({ ...e, life: 0 });
    f.fx = [];
    const buf = this.buf, base = this.base, tr = this.trail, ph = this.phase, type = this.terrain.typeArr;
    const dk = f.dark, mr = 1 - 0.64 * dk, mg = 1 - 0.58 * dk, mb = 1 - 0.36 * dk;
    const slot = this.frame >> 3, cre = f.cre, n = cre.length / 8;
    if (this.trails) for (let i = 0; i < n; i++) {
      const k = cre[i * 8 + 1]; if (k === 4) continue;
      const p = ((cre[i * 8 + 3] | 0) * W + (cre[i * 8 + 2] | 0)) * 3, c = KTRAIL[k];
      tr[p] = Math.min(255, tr[p] + c[0] * 0.3); tr[p + 1] = Math.min(255, tr[p + 1] + c[1] * 0.3); tr[p + 2] = Math.min(255, tr[p + 2] + c[2] * 0.3);
    }
    for (let i = 0, j = 0; i < W * H; i++, j += 3) {
      const t = base[i]; let r = t & 255, g = (t >> 8) & 255, b = (t >> 16) & 255;
      if (type[i] <= SHALLOW && ((ph[i] + slot) & 63) === 0) { r += 34; g += 40; b += 40; }
      if (this.trails) {
        const a = tr[j], bb = tr[j + 1], c = tr[j + 2];
        if (a + bb + c > 2) { r += a * 0.22; g += bb * 0.22; b += c * 0.22; tr[j] = a * 0.95; tr[j + 1] = bb * 0.95; tr[j + 2] = c * 0.95; }
      }
      buf[i] = pack(Math.min(255, r * mr) | 0, Math.min(255, g * mg) | 0, Math.min(255, b * mb) | 0);
    }
    const put = (x, y, col) => { x = ((x % W) + W) % W; y = ((y % H) + H) % H; buf[y * W + x] = col; };
    const shade = c => pack(Math.min(255, c[0] * mr) | 0, Math.min(255, c[1] * mg) | 0, Math.min(255, c[2] * mb) | 0);

    // meteor craters: scorched ground that fades over two days
    for (const m of f.meteors || []) {
      const age = (f.T - m.t) / (DAY * 2); if (age > 1 || age < 0) continue;
      const R = 16, cx = m.x | 0, cy = m.y | 0;
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
        const d2 = i * i + j * j; if (d2 > R * R) continue;
        const p = (((cy + j) % H + H) % H) * W + ((cx + i) % W + W) % W, c = buf[p];
        const k = (1 - age) * (0.7 - 0.4 * d2 / (R * R));
        let r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
        r = r * (1 - k) + 30 * k; g = g * (1 - k) + 24 * k; b = b * (1 - k) + 22 * k;
        if (age < 0.15 && d2 > (R - 2) * (R - 2) && (ph[p] & 3) === 0) { r = 255; g = 140; b = 60; }
        buf[p] = pack(r | 0, g | 0, b | 0);
      }
    }
    const co = f.corpses;
    for (let i = 0; i < co.length; i += 3) { const q = 0.5 + 0.5 * co[i + 2]; put(co[i] | 0, co[i + 1] | 0, shade([120 * q + 30, 82 * q + 26, 70 * q + 24])); }
    const leaf = shade(this.leaf), sprout = shade(this.sprout), berry = shade(BERRY), pl = f.plants;
    for (let i = 0; i < pl.length; i += 3) {
      const x = pl[i] | 0, y = pl[i + 1] | 0, e = pl[i + 2];
      if (e < 0.5) put(x, y, sprout);
      else { put(x, y, leaf); if (e > 1) put(x + 1, y, berry); }
    }
    // creatures stay bright at night, so the world glows with life
    const cm = 1 - dk * 0.12, eye = pack(255, 246, 222), shadow = pack(10, 18, 16), callCol = pack(255, 250, 230);
    for (let i = 0; i < n; i++) {
      const o = i * 8, k = cre[o + 1], cx = cre[o + 2], cy = cre[o + 3], a = cre[o + 4], size = cre[o + 5];
      const rgb = creatureCol(k, cre[o + 6]), col = pack(rgb[0] * cm | 0, rgb[1] * cm | 0, rgb[2] * cm | 0);
      const x = Math.round(cx), y = Math.round(cy);
      if (k === 4) {
        put(x + 1, y + 2, shadow);
        for (const [dx, dy] of (((cre[o] | 0) + (this.frame >> 3)) & 1) ? WINGS_UP : WINGS_DOWN) put(x + dx, y + dy, col);
        if (cre[o + 7] >= 10 && ((this.frame >> 2) + (cre[o] | 0)) % 3 === 0) put(x, y - 3, callCol);
        continue;
      }
      const big = size >= 1.2;
      for (const [dx, dy] of SPR[k][big ? 1 : 0]) put(x + dx, y + dy, col);
      if (cre[o + 7] >= 10 && ((this.frame >> 2) + (cre[o] | 0)) % 3 === 0) { put(x, y - 3 - (big ? 1 : 0), callCol); put(x - 1, y - 4 - (big ? 1 : 0), callCol); put(x + 1, y - 4 - (big ? 1 : 0), callCol); }
      const rad = big ? 2.6 : 1.8;
      put(Math.round(cx + Math.cos(a) * rad), Math.round(cy + Math.sin(a) * rad), eye);
    }
    this.octx.putImageData(this.img, 0, 0);

    const ctx = this.ctx, cw = this.cv.width, ch = this.cv.height, s = this.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0e1815'; ctx.fillRect(0, 0, cw, ch);
    const ox = cw / 2 - this.cam.x * s, oy = ch / 2 - this.cam.y * s;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      const x = ox + kx * W * s, y = oy + ky * H * s;
      if (x > cw || y > ch || x + W * s < 0 || y + H * s < 0) continue;
      ctx.drawImage(this.off, Math.round(x), Math.round(y), Math.ceil(W * s), Math.ceil(H * s));
    }

    const px = Math.max(2, s * 0.9);
    let flash = 0;
    this.fx = this.fx.filter(e => {
      e.life++;
      const [sx, sy] = this.toScreen(e.x, e.y);
      if (e.type === 'birth') {
        const r = (2 + e.life * 0.35) * s, al = 1 - e.life / 16, c = KTRAIL[e.k] || KTRAIL[0];
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${al})`;
        for (let q = 0; q < 4; q++) { const ang = q * Math.PI / 2 + Math.PI / 4; ctx.fillRect(sx + Math.cos(ang) * r - px / 2, sy + Math.sin(ang) * r - px / 2, px, px); }
        return e.life < 16;
      }
      if (e.type === 'kill' || e.type === 'fight') {
        const r = (1 + e.life * 0.5) * s, al = 1 - e.life / 12;
        ctx.fillStyle = e.type === 'kill' ? `rgba(255,96,80,${al})` : `rgba(255,230,200,${al})`;
        for (let q = 0; q < 6; q++) { const ang = q * Math.PI / 3; ctx.fillRect(sx + Math.cos(ang) * r - px / 2, sy + Math.sin(ang) * r - px / 2, px, px); }
        return e.life < 12;
      }
      if (e.type === 'meteor') {
        if (e.life < 14) flash = Math.max(flash, 1 - e.life / 14);
        const r = e.life * 1.4 * s, al = Math.max(0, 1 - e.life / 50);
        ctx.strokeStyle = `rgba(255,190,120,${al})`; ctx.lineWidth = 3 * this.dpr;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
        return e.life < 50;
      }
      return false;
    });
    this.weather(f, ctx, cw, ch);
    if (flash > 0) { ctx.fillStyle = `rgba(255,240,210,${flash * 0.6})`; ctx.fillRect(0, 0, cw, ch); }

    const sel = f.sel;
    if (sel) {
      const [sx, sy] = this.toScreen(sel.x, sel.y), R = sel.R * s;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,246,222,0.45)'; ctx.lineWidth = Math.max(1, this.dpr);
      ctx.setLineDash([3 * this.dpr, 5 * this.dpr]); ctx.lineDashOffset = -this.frame * 0.4;
      ctx.beginPath(); ctx.arc(sx, sy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.strokeStyle = '#fff6de'; ctx.lineWidth = 2 * this.dpr;
      const b = Math.max(14 * this.dpr, 6 * s), l = b * 0.45;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath(); ctx.moveTo(sx + dx * b, sy + dy * (b - l)); ctx.lineTo(sx + dx * b, sy + dy * b); ctx.lineTo(sx + dx * (b - l), sy + dy * b); ctx.stroke();
      }
      ctx.restore();
    }
  }
}
