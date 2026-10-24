// Records a small picture of the whole world twice a day (in daylight) and plays them back as a film.
// Pictures live in IndexedDB; if that is unavailable they are kept in memory for this visit only.
import { DAY, SEASONS } from './sim.js';

const DB = 'biosphere', STORE = 'frames', MAX = 360, FW = 320, FH = 200;

function req(r) { return new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }

export class TimeLapse {
  constructor() {
    this.db = null; this.mem = []; this.seed = ''; this.lastBucket = -1; this.busy = false;
    this.small = document.createElement('canvas'); this.small.width = FW; this.small.height = FH;
    this.ready = this.open();
  }
  async open() {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE, { keyPath: ['seed', 't'] }); s.createIndex('seed', 'seed'); };
      this.db = await req(r);
    } catch (e) { this.db = null; }
  }
  tx(mode) { return this.db.transaction(STORE, mode).objectStore(STORE); }

  // a new world: forget other worlds' films, and continue this one's where it left off
  async setWorld(seed) {
    await this.ready;
    this.seed = seed; this.lastBucket = -1;
    if (!this.db) { this.mem = this.mem.filter(f => f.seed === seed); this.lastBucket = this.mem.length ? Math.floor(this.mem[this.mem.length - 1].t / (DAY / 2)) : -1; return; }
    try {
      const all = await req(this.tx('readonly').getAllKeys());
      const store = this.tx('readwrite');
      let last = -1;
      for (const k of all) { if (k[0] !== seed) store.delete(k); else last = Math.max(last, k[1]); }
      this.lastBucket = last >= 0 ? Math.floor(last / (DAY / 2)) : -1;
    } catch (e) {}
  }

  // called after every drawn frame; worldCanvas holds the whole map
  maybeCapture(f, worldCanvas, counts) {
    if (!this.seed || this.busy) return;
    const bucket = Math.floor(f.T / (DAY / 2));
    if (bucket <= this.lastBucket || f.dark > 0.45) return;
    this.lastBucket = bucket;
    const x = this.small.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(worldCanvas, 0, 0, FW, FH);
    const rec = { seed: this.seed, t: f.T, day: f.day, season: f.season, year: f.year, ev: f.ev ? f.ev.name : '', counts: (counts || []).slice() };
    this.busy = true;
    this.small.toBlob(async blob => {
      try {
        rec.img = blob;
        if (this.db) {
          const s = this.tx('readwrite'); s.put(rec);
          const keys = await req(this.tx('readonly').index('seed').getAllKeys(IDBKeyRange.only(this.seed)));
          if (keys.length > MAX) { const d = this.tx('readwrite'); keys.sort((a, b) => a[1] - b[1]).slice(0, keys.length - MAX).forEach(k => d.delete(k)); }
        } else { this.mem.push(rec); if (this.mem.length > MAX) this.mem.shift(); }
      } catch (e) {}
      this.busy = false;
    }, 'image/png');
  }

  async frames() {
    await this.ready;
    let list = [];
    if (this.db) { try { list = await req(this.tx('readonly').index('seed').getAll(IDBKeyRange.only(this.seed))); } catch (e) { list = []; } }
    else list = this.mem.filter(f => f.seed === this.seed);
    return list.sort((a, b) => a.t - b.t);
  }
}

// ---------- the player ----------
export class Player {
  constructor(els) {
    this.el = els; this.frames = []; this.bitmaps = []; this.i = 0; this.playing = false; this.timer = 0; this.fps = 8;
    this.ctx = els.canvas.getContext('2d');
    els.play.onclick = () => this.playing ? this.pause() : this.play();
    els.range.oninput = () => { this.pause(); this.show(+els.range.value); };
  }
  async load(frames) {
    this.pause();
    this.frames = frames;
    this.bitmaps = await Promise.all(frames.map(f => createImageBitmap(f.img).catch(() => null)));
    this.el.range.max = Math.max(0, frames.length - 1);
    this.show(Math.max(0, frames.length - 1));
  }
  show(i) {
    this.i = i; this.el.range.value = i;
    const f = this.frames[i], b = this.bitmaps[i], c = this.el.canvas, x = this.ctx;
    if (!f || !b) return;
    if (c.width !== FW * 2) { c.width = FW * 2; c.height = FH * 2; }
    x.imageSmoothingEnabled = false;
    x.drawImage(b, 0, 0, c.width, c.height);
    this.el.label.textContent = `Day ${f.day} · ${SEASONS[f.season]} · year ${f.year}${f.ev ? ' · ' + f.ev : ''}`;
  }
  play() {
    if (this.frames.length < 2) return;
    if (this.i >= this.frames.length - 1) this.show(0);
    this.playing = true; this.el.play.textContent = 'Pause';
    const step = () => {
      if (!this.playing) return;
      if (this.i >= this.frames.length - 1) { this.pause(); if (this.onEnd) this.onEnd(); return; }
      this.show(this.i + 1);
      this.timer = setTimeout(step, 1000 / this.fps);
    };
    this.timer = setTimeout(step, 1000 / this.fps);
  }
  pause() { this.playing = false; clearTimeout(this.timer); this.el.play.textContent = 'Play'; }

  // records the film to a video file, where the browser supports it
  canRecord() {
    return !!(window.MediaRecorder && this.el.canvas.captureStream) &&
      ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].some(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
  }
  record() {
    return new Promise(resolve => {
      const type = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
      const stream = this.el.canvas.captureStream(this.fps);
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4e6 });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => resolve(new Blob(chunks, { type: type.split(';')[0] }));
      this.show(0);
      rec.start();
      this.onEnd = () => { this.onEnd = null; setTimeout(() => rec.stop(), 400); };
      setTimeout(() => this.play(), 150);
    });
  }
}
