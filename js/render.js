// Draws the world into a W×H pixel buffer, then scales it to the screen with a wrap-around camera.
import { W, H, SEASON, DEEP, SHALLOW, SAND, GRASS, ROCK, tdelta } from './sim.js';

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
const BERRY = [196, 128, 236];
export function hslRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export function creatureRgb(c) {
  if (!c._rgb) c._rgb = c.k === 0 ? hslRgb(((c.hue % 360) + 360) % 360, 58, 72) : hslRgb(((c.hue % 360) + 360) % 360, 86, 64);
  return c._rgb;
}

export class Renderer {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas'); this.off.width = W; this.off.height = H;
    this.octx = this.off.getContext('2d');
    this.img = this.octx.createImageData(W, H); this.buf = new Uint32Array(this.img.data.buffer);
    this.base = new Uint32Array(W * H);
    this.trailH = new Float32Array(W * H); this.trailC = new Float32Array(W * H);
    this.phase = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) this.phase[i] = (Math.imul(i, 2654435761) >>> 24);
    this.cam = { x: W / 2, y: H / 2, zoom: 1 };
    this.fx = []; this.frame = 0; this.bakedKey = -1;
    this.trails = true; this.effects = true;
    this.resize();
  }
  setWorld(world) { this.world = world; this.bakedKey = -1; this.trailH.fill(0); this.trailC.fill(0); this.fx.length = 0; }
  resize() {
    const dpr = window.devicePixelRatio || 1, r = this.cv.getBoundingClientRect();
    this.cv.width = Math.max(1, Math.round(r.width * dpr)); this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
  }
  get scale() { return this.cv.width / W * this.cam.zoom; }
  clampCam() {
    this.cam.zoom = clamp(this.cam.zoom, 1, 10);
    this.cam.x = ((this.cam.x % W) + W) % W; this.cam.y = ((this.cam.y % H) + H) % H;
  }
  // CSS pixel position on the canvas -> world coordinates
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
    const old = this.cam.zoom; this.cam.zoom = clamp(old * factor, 1, 10);
    const s = this.scale / this.dpr, cw = this.cv.width / this.dpr, ch = this.cv.height / this.dpr;
    this.cam.x = wx - (px - cw / 2) / s; this.cam.y = wy - (py - ch / 2) / s;
    this.clampCam();
  }

  bakeTerrain(w) {
    const t = (w.T % SEASON) / SEASON, s = w.season, n = (s + 1) % 4, f = clamp((t - 0.7) / 0.3, 0, 1);
    const key = s * 100 + Math.round(f * 25);
    if (key === this.bakedKey) return;
    this.bakedKey = key;
    const P = {}; for (const k in PAL) P[k] = mix(PAL[k][s], PAL[k][n], f);
    this.leaf = P.leaf; this.sprout = P.sprout;
    const { type, height, moist } = w, base = this.base;
    for (let i = 0; i < W * H; i++) {
      const tp = type[i], d = ((this.phase[i] & 15) - 7.5) * 0.7;
      let c;
      if (tp === DEEP) c = mix(P.deep, P.shallow, clamp(height[i] * 1.5, 0, 0.5));
      else if (tp === SHALLOW) c = P.shallow;
      else if (tp === SAND) c = P.sand;
      else if (tp === ROCK) c = mix(P.rock, [200, 200, 204], clamp((height[i] - 0.9) * 3, 0, 0.5));
      else c = mix(P.grassLo, P.grassHi, clamp(moist[i] * 0.85 + w.fert[i] * 0.3, 0, 1));
      base[i] = pack(clamp(c[0] + d, 0, 255) | 0, clamp(c[1] + d, 0, 255) | 0, clamp(c[2] + d, 0, 255) | 0);
    }
  }

  // world.fx is filled by the simulation; take ownership each frame
  pullFx(w) {
    if (!this.effects) { w.fx.length = 0; return; }
    for (const e of w.fx) if (this.fx.length < 220) this.fx.push({ ...e, life: 0 });
    w.fx.length = 0;
  }

  draw(w, selected) {
    this.frame++;
    this.bakeTerrain(w);
    this.pullFx(w);
    const buf = this.buf, base = this.base, tH = this.trailH, tC = this.trailC, ph = this.phase, type = w.type;
    const dk = w.darkness, mr = 1 - 0.64 * dk, mg = 1 - 0.58 * dk, mb = 1 - 0.36 * dk;
    const slot = this.frame >> 3;
    const hc = [143, 211, 232], cc = [255, 132, 102];
    // trails from current positions
    if (this.trails) for (const c of w.creatures) { const i = (c.y | 0) * W + (c.x | 0); if (c.k === 0) tH[i] = Math.min(1, tH[i] + 0.3); else tC[i] = Math.min(1, tC[i] + 0.4); }
    for (let i = 0; i < W * H; i++) {
      const t = base[i]; let r = t & 255, g = (t >> 8) & 255, b = (t >> 16) & 255;
      if (type[i] <= SHALLOW && ((ph[i] + slot) & 63) === 0) { r += 34; g += 40; b += 40; }
      if (this.trails) {
        const th = tH[i], tc = tC[i];
        if (th > 0.01 || tc > 0.01) {
          r += (hc[0] * th + cc[0] * tc) * 0.22; g += (hc[1] * th + cc[1] * tc) * 0.22; b += (hc[2] * th + cc[2] * tc) * 0.22;
          tH[i] = th * 0.95; tC[i] = tc * 0.95;
        }
      }
      buf[i] = pack(Math.min(255, r * mr) | 0, Math.min(255, g * mg) | 0, Math.min(255, b * mb) | 0);
    }
    const put = (x, y, col) => { x = ((x % W) + W) % W; y = ((y % H) + H) % H; buf[y * W + x] = col; };
    const shade = (c, m = 1) => pack(Math.min(255, c[0] * mr * m) | 0, Math.min(255, c[1] * mg * m) | 0, Math.min(255, c[2] * mb * m) | 0);

    // carrion
    for (const d of w.corpses) { const f = 0.5 + 0.5 * Math.min(1, d.t / 1800); put(d.x | 0, d.y | 0, shade([120 * f + 30, 82 * f + 26, 70 * f + 24])); }
    // plants
    const leaf = shade(this.leaf), sprout = shade(this.sprout), berry = shade(BERRY);
    for (const p of w.plants) {
      const x = p.x | 0, y = p.y | 0;
      if (p.e < 0.5) put(x, y, sprout);
      else { put(x, y, leaf); if (p.e > 1) put(x + 1, y, berry); }
    }
    // creatures stay brighter than the landscape at night
    const cm = 1 - dk * 0.12, eye = pack(255, 246, 222);
    for (const c of w.creatures) {
      const rgb = creatureRgb(c), col = pack(rgb[0] * cm | 0, rgb[1] * cm | 0, rgb[2] * cm | 0), x = Math.round(c.x), y = Math.round(c.y);
      let rad;
      if (c.k === 0) {
        if (c.size < 1.2) { put(x - 1, y - 1, col); put(x, y - 1, col); put(x - 1, y, col); put(x, y, col); rad = 1.4; }
        else { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) put(x + i, y + j, col); rad = 2; }
      } else {
        if (c.size < 1.2) { put(x, y, col); put(x + 1, y, col); put(x - 1, y, col); put(x, y + 1, col); put(x, y - 1, col); rad = 2; }
        else { for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (Math.abs(i) + Math.abs(j) <= 2) put(x + i, y + j, col); rad = 3; }
      }
      put(Math.round(c.x + Math.cos(c.a) * rad), Math.round(c.y + Math.sin(c.a) * rad), eye);
    }
    this.octx.putImageData(this.img, 0, 0);

    // to screen, tiled so the edges wrap
    const ctx = this.ctx, cw = this.cv.width, ch = this.cv.height, s = this.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0e1815'; ctx.fillRect(0, 0, cw, ch);
    const ox = cw / 2 - this.cam.x * s, oy = ch / 2 - this.cam.y * s;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      const x = ox + kx * W * s, y = oy + ky * H * s;
      if (x > cw || y > ch || x + W * s < 0 || y + H * s < 0) continue;
      ctx.drawImage(this.off, Math.round(x), Math.round(y), Math.ceil(W * s), Math.ceil(H * s));
    }

    // effects
    const px = Math.max(2, s * 0.9);
    this.fx = this.fx.filter(e => {
      e.life++;
      const [sx, sy] = this.toScreen(e.x, e.y);
      if (e.type === 'birth') {
        const r = (2 + e.life * 0.35) * s, a = 1 - e.life / 16;
        ctx.fillStyle = e.k ? `rgba(255,170,140,${a})` : `rgba(190,236,250,${a})`;
        for (let q = 0; q < 4; q++) { const ang = q * Math.PI / 2 + Math.PI / 4; ctx.fillRect(sx + Math.cos(ang) * r - px / 2, sy + Math.sin(ang) * r - px / 2, px, px); }
        return e.life < 16;
      }
      if (e.type === 'kill') {
        const r = (1 + e.life * 0.5) * s, a = 1 - e.life / 12;
        ctx.fillStyle = `rgba(255,96,80,${a})`;
        for (let q = 0; q < 6; q++) { const ang = q * Math.PI / 3; ctx.fillRect(sx + Math.cos(ang) * r - px / 2, sy + Math.sin(ang) * r - px / 2, px, px); }
        return e.life < 12;
      }
      return false;
    });

    // selection: sight circle and brackets
    if (selected && !selected.dead) {
      const [sx, sy] = this.toScreen(selected.x, selected.y), R = w.sightR(selected) * s;
      ctx.save();
      ctx.strokeStyle = 'rgba(242,193,78,0.5)'; ctx.lineWidth = Math.max(1, this.dpr);
      ctx.setLineDash([3 * this.dpr, 5 * this.dpr]); ctx.lineDashOffset = -this.frame * 0.4;
      ctx.beginPath(); ctx.arc(sx, sy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2 * this.dpr;
      const b = Math.max(14 * this.dpr, 6 * s), l = b * 0.45;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath(); ctx.moveTo(sx + dx * b, sy + dy * (b - l)); ctx.lineTo(sx + dx * b, sy + dy * b); ctx.lineTo(sx + dx * (b - l), sy + dy * b); ctx.stroke();
      }
      ctx.restore();
    }
  }
}
