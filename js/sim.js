// Biosphere simulation engine. No DOM here: it runs in the browser and in Node.

export const W = 320, H = 200;          // world size in pixels (wraps around like a torus)
const CS = 20, GX = 16, GY = 10, HW = W / 2, HH = H / 2; // spatial grid
export const DAY = 2400;                // ticks per day
export const SEASON = 6000;             // ticks per season
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const GROWTH = [1.35, 1.0, 0.7, 0.4];
const MAX_PLANTS = 950;

export const N_IN = 14, N_H = 8, N_OUT = 3;
export const OUT_LABELS = ['Steer', 'Speed', 'Memory'];

export const KINDS = [
  { name: 'Herbivore', plural: 'Herbivores', baseSp: 0.85, baseR: 26, cost: 1.0, maxAge: 4200, cap: 300, min: 10, hue: 195, score: 'Meals',
    labels: ['Food side', 'Food ahead', 'Food near', 'Danger side', 'Danger ahead', 'Danger near', 'Kin side', 'Kin ahead', 'Kin near', 'Water ahead', 'Water side', 'Energy', 'Memory', 'Constant'] },
  { name: 'Predator', plural: 'Predators', baseSp: 1.0, baseR: 32, cost: 1.45, maxAge: 4800, cap: 45, min: 4, hue: 12, score: 'Kills',
    labels: ['Prey side', 'Prey ahead', 'Prey near', 'Carrion side', 'Carrion ahead', 'Carrion near', 'Kin side', 'Kin ahead', 'Kin near', 'Water ahead', 'Water side', 'Energy', 'Memory', 'Constant'] },
];

// Terrain types
export const DEEP = 0, SHALLOW = 1, SAND = 2, GRASS = 3, ROCK = 4;

// ---------- random numbers ----------
export class RNG {
  constructor(s) { this.s = s | 0; }
  next() {
    let a = this.s = (this.s + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  gauss() { let u = 0; while (!u) u = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next()); }
}
export function hashStr(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  return h >>> 0;
}

// ---------- names ----------
const SYL = ['ka', 'zo', 'mi', 'ru', 'te', 'lo', 'vi', 'na', 'be', 'so', 'qu', 'fi', 'do', 'ri', 'ul', 'pe', 'ga', 'no', 'xi', 'ta', 'ar', 'en', 'os', 'il'];
export const creatureName = id => { const a = SYL[id % 24], b = SYL[(id * 7 + 3) % 24]; return a[0].toUpperCase() + a.slice(1) + b + '-' + id; };
const lineageName = (id) => { const a = SYL[(id * 5 + 1) % 24], b = SYL[(id * 11 + 7) % 24], c = SYL[(id * 3 + 2) % 24]; return a[0].toUpperCase() + a.slice(1) + b + c; };
const ADJ = ['quiet', 'windy', 'ancient', 'golden', 'misty', 'wild', 'bright', 'hidden', 'warm', 'remote', 'silver', 'sleepy'];
const NOUN = ['swamp', 'valley', 'island', 'prairie', 'forest', 'lagoon', 'dune', 'glade', 'hill', 'delta', 'marsh', 'reef'];
export function randomSeed() { const r = Math.random; return ADJ[r() * 12 | 0] + '-' + NOUN[r() * 12 | 0] + '-' + (10 + (r() * 90 | 0)); }
export const cleanSeed = s => String(s).toLowerCase().trim().replace(/[^a-z0-9._~-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// ---------- helpers ----------
const wrap = (v, L) => ((v % L) + L) % L;
export function tdelta(a, b, L) { let d = b - a; if (d > L / 2) d -= L; else if (d < -L / 2) d += L; return d; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

function periodicNoise(rng, nx, ny) {
  const v = new Float32Array(nx * ny);
  for (let i = 0; i < v.length; i++) v[i] = rng.next();
  return (x, y) => {
    const fx = x / W * nx, fy = y / H * ny, x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const x1 = (x0 + 1) % nx, y1 = (y0 + 1) % ny;
    const a = v[y0 * nx + x0], b = v[y0 * nx + x1], c = v[y1 * nx + x0], d = v[y1 * nx + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function fbm(rng) {
  const oct = [[8, 5, .5], [16, 10, .27], [32, 20, .15], [64, 40, .08]].map(([nx, ny, w]) => [periodicNoise(rng, nx, ny), w]);
  return (x, y) => { let s = 0; for (const [n, w] of oct) s += n(x, y) * w; return s; };
}
function percentile(arr, p) { const s = Float32Array.from(arr).sort(); return s[Math.floor(p * (s.length - 1))]; }

// ---------- brains and genes ----------
function makeBrain(rng) {
  const w1 = new Float32Array(N_H * N_IN), w2 = new Float32Array(N_OUT * (N_H + 1));
  for (let i = 0; i < w1.length; i++) w1[i] = rng.gauss() * 0.8;
  for (let i = 0; i < w2.length; i++) w2[i] = rng.gauss() * 0.8;
  return { w1, w2 };
}
function mutateArr(rng, src) {
  const w = Float32Array.from(src);
  for (let i = 0; i < w.length; i++) {
    const r = rng.next();
    if (r < 0.015) w[i] = rng.gauss();
    else if (r < 0.15) w[i] += rng.gauss() * 0.3;
  }
  return w;
}

// ---------- the world ----------
export class World {
  constructor(seed) {
    this.seed = seed;
    this.rng = new RNG(hashStr(seed));
    this.buildTerrain();
    this.T = 0; this.nextId = 1;
    this.creatures = []; this.plants = []; this.corpses = [];
    this.lineages = new Map();
    this.history = []; this.log = [];
    this.stats = { births: 0, deaths: 0, eaten: 0, rescues: 0 };
    this.records = { oldest: null, mostKids: null, maxGen: [0, 0] };
    this.lastRescue = [-1e9, -1e9]; this.genMark = [0, 0];
    this.fx = []; this.fxOn = false;
    this.grids = [[], [], [], []].map(() => Array.from({ length: GX * GY }, () => []));
  }

  static create(seed, warmup = 600) {
    const w = new World(seed);
    for (let i = 0; i < 520; i++) w.growPlant(true);
    for (let i = 0; i < 80; i++) w.spawnRandom(0);
    for (let i = 0; i < 12; i++) w.spawnRandom(1);
    w.addLog(`World "${seed}" is born: 80 herbivores and 12 predators with random brains.`);
    for (let i = 0; i < warmup; i++) w.tick();
    return w;
  }

  buildTerrain() {
    const r = this.rng, hN = fbm(r), mN = fbm(r);
    const N = W * H, h = new Float32Array(N), m = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { h[y * W + x] = hN(x, y); m[y * W + x] = mN(x, y); }
    const tDeep = percentile(h, 0.11), tShallow = percentile(h, 0.17), tSand = percentile(h, 0.22), tRock = percentile(h, 0.94);
    const type = new Uint8Array(N);
    for (let i = 0; i < N; i++) type[i] = h[i] < tDeep ? DEEP : h[i] < tShallow ? SHALLOW : h[i] < tSand ? SAND : h[i] > tRock ? ROCK : GRASS;
    // distance to water (BFS, wraps)
    const dist = new Uint8Array(N).fill(255), q = new Int32Array(N); let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (type[i] <= SHALLOW) { dist[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++], d = dist[i]; if (d >= 14) continue;
      const x = i % W, y = (i / W) | 0;
      for (const j of [y * W + (x + 1) % W, y * W + (x + W - 1) % W, ((y + 1) % H) * W + x, ((y + H - 1) % H) * W + x])
        if (dist[j] > d + 1) { dist[j] = d + 1; q[qt++] = j; }
    }
    const mMin = percentile(m, 0.02), mMax = percentile(m, 0.98);
    const fert = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const mm = clamp((m[i] - mMin) / (mMax - mMin), 0, 1); m[i] = mm;
      const t = type[i];
      fert[i] = t === GRASS ? clamp(0.12 + 0.7 * mm + Math.max(0, (12 - dist[i]) / 12) * 0.35, 0, 1) : t === SAND ? 0.05 : t === ROCK ? 0.02 : 0;
    }
    const hMin = tDeep, hMax = percentile(h, 0.99);
    for (let i = 0; i < N; i++) h[i] = clamp((h[i] - hMin) / (hMax - hMin), 0, 1);
    this.height = h; this.moist = m; this.type = type; this.fert = fert;
    this.bonus = new Float32Array(N); // fertility from decomposed corpses
  }

  isWater(x, y) { return this.type[(wrap(y | 0, H)) * W + wrap(x | 0, W)] <= SHALLOW; }
  get season() { return Math.floor(this.T / SEASON) % 4; }
  get day() { return Math.floor(this.T / DAY) + 1; }
  get year() { return Math.floor(this.T / (SEASON * 4)) + 1; }
  get light() { const p = (this.T % DAY) / DAY; return 0.5 - 0.5 * Math.cos(2 * Math.PI * p); } // 0 midnight, 1 noon
  get darkness() { const l = this.light; return clamp((0.5 - l) / 0.4, 0, 1); }

  addLog(msg) { this.log.unshift({ t: this.T, msg }); if (this.log.length > 60) this.log.length = 60; }
  emit(type, x, y, k) { if (this.fxOn) this.fx.push({ type, x, y, k }); }

  randomLand() {
    for (let tries = 0; tries < 200; tries++) {
      const x = this.rng.next() * W, y = this.rng.next() * H;
      if (!this.isWater(x, y)) return [x, y];
    }
    return [W / 2, H / 2];
  }

  growPlant(full) {
    const r = this.rng;
    for (let tries = 0; tries < 3; tries++) {
      const x = r.next() * W | 0, y = r.next() * H | 0, i = y * W + x;
      if (r.next() < this.fert[i] + this.bonus[i]) { this.plants.push({ x: x + .5, y: y + .5, e: full ? 0.6 + r.next() * 0.8 : 0.1, dead: false }); return; }
    }
  }

  newLineage(k, hue) {
    const id = this.nextId;
    const lin = { id, name: lineageName(id), k, hue, born: this.T, count: 0, peak: 0 };
    this.lineages.set(id, lin);
    return id;
  }

  makeCreature(k, x, y, o = {}) {
    const r = this.rng, K = KINDS[k];
    const hue = o.hue ?? (K.hue + (r.next() - .5) * 50);
    const c = {
      id: this.nextId++, k, x, y, a: r.next() * Math.PI * 2, e: o.e ?? 1.0, age: 0, gen: o.gen ?? 0,
      hue, size: o.size ?? 1, spd: o.spd ?? 1, sight: o.sight ?? 1,
      lin: o.lin ?? 0, parent: o.parent ?? 0, score: 0, kids: 0, mem: 0, born: this.T,
      brain: o.brain || makeBrain(r),
      inp: new Float32Array(N_IN), hid: new Float32Array(N_H), out: new Float32Array(N_OUT), dead: false,
    };
    if (!c.lin) c.lin = this.newLineage(k, hue);
    return c;
  }
  spawnRandom(k, x, y, clone) {
    if (x == null) [x, y] = this.randomLand();
    const r = this.rng;
    const o = clone ? {
      brain: { w1: mutateArr(r, clone.brain.w1), w2: mutateArr(r, clone.brain.w2) },
      size: clone.size, spd: clone.spd, sight: clone.sight, hue: clone.hue, lin: clone.lin, gen: clone.gen + 1,
    } : {};
    const c = this.makeCreature(k, x, y, o);
    this.creatures.push(c);
    return c;
  }

  // traits derived from genes
  maxE(c) { return 2.4 * c.size; }
  maxSp(c) { return KINDS[c.k].baseSp * c.spd / Math.sqrt(c.size); }
  sightR(c) { return Math.min(44, KINDS[c.k].baseR * c.sight * (1 - this.darkness * (c.k ? 0.25 : 0.4))); }

  buildGrids() {
    const [gP, gH, gC, gX] = this.grids;
    for (let i = 0; i < GX * GY; i++) { gP[i].length = 0; gH[i].length = 0; gC[i].length = 0; gX[i].length = 0; }
    const cell = (x, y) => ((y / CS) | 0) % GY * GX + ((x / CS) | 0) % GX;
    for (const p of this.plants) gP[cell(p.x, p.y)].push(p);
    for (const c of this.creatures) (c.k === 0 ? gH : gC)[cell(c.x, c.y)].push(c);
    for (const d of this.corpses) gX[cell(d.x, d.y)].push(d);
  }
  nearest(grid, x, y, R, self) {
    const x0 = Math.floor((x - R) / CS), x1 = Math.floor((x + R) / CS), y0 = Math.floor((y - R) / CS), y1 = Math.floor((y + R) / CS);
    let best = null, bd = R * R, bx = 0, by = 0;
    for (let j = y0; j <= y1; j++) {
      const row = ((j % GY) + GY) % GY * GX;
      for (let i = x0; i <= x1; i++) {
        const cell = grid[row + ((i % GX) + GX) % GX];
        for (let n = 0; n < cell.length; n++) {
          const o = cell[n];
          if (o.dead || o === self) continue;
          let dx = o.x - x; if (dx > HW) dx -= W; else if (dx < -HW) dx += W;
          let dy = o.y - y; if (dy > HH) dy -= H; else if (dy < -HH) dy += H;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = o; bx = dx; by = dy; }
        }
      }
    }
    return best ? { o: best, dx: bx, dy: by, d: Math.sqrt(bd) } : null;
  }
  sense(c, off, hit, R) {
    const inp = c.inp;
    if (!hit) { inp[off] = 0; inp[off + 1] = 0; inp[off + 2] = 0; return; }
    const ca = Math.cos(c.a), sa = Math.sin(c.a), d = hit.d || 1e-3;
    inp[off] = (-hit.dx * sa + hit.dy * ca) / d;
    inp[off + 1] = (hit.dx * ca + hit.dy * sa) / d;
    inp[off + 2] = 1 - hit.d / R;
  }
  waterAt(c, ang, dist) { return this.isWater(c.x + Math.cos(c.a + ang) * dist, c.y + Math.sin(c.a + ang) * dist) ? 1 : 0; }

  tick() {
    this.T++;
    const T = this.T, r = this.rng, season = this.season, g = GROWTH[season];
    if (T % SEASON === 0) this.seasonChange(season);

    // plants
    const att = 7 * g; let n = Math.floor(att) + (r.next() < att % 1 ? 1 : 0);
    while (n-- > 0 && this.plants.length < MAX_PLANTS) this.growPlant(false);
    let anyDead = false;
    for (const p of this.plants) {
      if (p.e < 1.4) p.e += 0.003 * g;
      if (season === 3 && r.next() < 0.00025) { p.dead = true; anyDead = true; }
    }
    // carrion decays into fertile soil
    for (const d of this.corpses) {
      if (--d.t <= 0 || d.e <= 0) {
        d.dead = true; anyDead = true;
        for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
          const k = wrap((d.y | 0) + j, H) * W + wrap((d.x | 0) + i, W);
          if (this.type[k] >= SAND) this.bonus[k] = Math.min(0.6, this.bonus[k] + 0.25 * (1 - (i * i + j * j) / 18));
        }
      }
    }
    if (T % 50 === 0) { const b = this.bonus; for (let i = 0; i < b.length; i++) if (b[i] > 0) b[i] *= 0.97; }

    this.buildGrids();
    const [gP, gH, gC, gX] = this.grids;
    const count = [0, 0]; for (const c of this.creatures) count[c.k]++;
    const born = [];

    for (const c of this.creatures) {
      if (c.dead) continue;
      const K = KINDS[c.k], R = this.sightR(c);
      // senses
      const food = this.nearest(c.k === 0 ? gP : gH, c.x, c.y, R);
      const other = this.nearest(c.k === 0 ? gC : gX, c.x, c.y, R);
      const kin = this.nearest(c.k === 0 ? gH : gC, c.x, c.y, R * 0.6, c);
      this.sense(c, 0, food, R); this.sense(c, 3, other, R); this.sense(c, 6, kin, R * 0.6);
      c.inp[9] = this.waterAt(c, 0, 3) || this.waterAt(c, 0, 6) * 0.5;
      c.inp[10] = this.waterAt(c, 0.7, 5) - this.waterAt(c, -0.7, 5);
      c.inp[11] = c.e / this.maxE(c) * 2 - 1;
      c.inp[12] = c.mem; c.inp[13] = 1;
      // think
      const { w1, w2 } = c.brain;
      for (let h = 0; h < N_H; h++) { let s = 0; const o = h * N_IN; for (let i = 0; i < N_IN; i++) s += w1[o + i] * c.inp[i]; c.hid[h] = Math.tanh(s); }
      for (let o = 0; o < N_OUT; o++) { const b = o * (N_H + 1); let s = w2[b + N_H]; for (let h = 0; h < N_H; h++) s += w2[b + h] * c.hid[h]; c.out[o] = Math.tanh(s); }
      c.mem = c.out[2];
      // move
      c.a += c.out[0] * 0.3;
      const sp = (c.out[1] + 1) * 0.5 * this.maxSp(c);
      const nx = c.x + Math.cos(c.a) * sp, ny = c.y + Math.sin(c.a) * sp;
      if (this.isWater(nx, ny)) { c.a += (r.next() < .5 ? 1 : -1) * 0.9; c.e -= 0.002; }
      else { c.x = wrap(nx, W); c.y = wrap(ny, H); }
      c.e -= (0.0011 * c.size + 0.0032 * sp * sp * c.size + 0.0005 * c.sight) * K.cost;
      c.age++;
      // eat
      const reach = 1.4 + c.size * 0.9;
      if (c.k === 0) {
        if (food && food.d < reach && !food.o.dead) {
          const p = food.o; p.dead = true; anyDead = true;
          c.e += p.e > 1 ? 0.6 : 0.42 * p.e; c.score++;
        }
      } else {
        if (food && food.d < reach && !food.o.dead && food.o.size <= c.size * 1.35) {
          const prey = food.o; prey.dead = true; prey.eaten = true;
          c.e += 0.35 + 0.4 * prey.e; c.score++; this.stats.eaten++;
          this.emit('kill', prey.x, prey.y, 1);
        } else if (other && other.d < reach) {
          const d = other.o, bite = Math.min(d.e, 0.25); d.e -= bite; c.e += bite;
        }
      }
      const mE = this.maxE(c); if (c.e > mE) c.e = mE;
      // reproduce
      if (c.e >= 0.66 * mE && c.age > 150 && count[c.k] < K.cap) {
        const childE = c.e * 0.45; c.e -= childE; c.kids++; count[c.k]++;
        const mut = v => v + r.gauss() * 0.05;
        let [cx, cy] = [wrap(c.x + (r.next() - .5) * 5, W), wrap(c.y + (r.next() - .5) * 5, H)];
        if (this.isWater(cx, cy)) { cx = c.x; cy = c.y; }
        const ch = this.makeCreature(c.k, cx, cy, {
          brain: { w1: mutateArr(r, c.brain.w1), w2: mutateArr(r, c.brain.w2) },
          size: clamp(mut(c.size), 0.6, 1.7), spd: clamp(mut(c.spd), 0.5, 1.6), sight: clamp(mut(c.sight), 0.5, 1.7),
          hue: c.hue + r.gauss() * 2.5, lin: c.lin, gen: c.gen + 1, parent: c.id, e: childE,
        });
        born.push(ch); this.stats.births++;
        this.emit('birth', cx, cy, c.k);
        if (ch.gen > this.records.maxGen[c.k]) {
          this.records.maxGen[c.k] = ch.gen;
          if (ch.gen >= this.genMark[c.k] + 25) { this.genMark[c.k] = ch.gen; this.addLog(`${K.plural} reach generation ${ch.gen}.`); }
        }
      }
      // die
      if (c.e <= 0 || c.age > K.maxAge * (0.8 + 0.2 * c.size)) c.dead = true;
    }

    // remove the dead, leave carrion
    const alive = [];
    for (const c of this.creatures) {
      if (!c.dead) { alive.push(c); continue; }
      this.stats.deaths++; this.noteDeath(c);
      if (!c.eaten) { this.corpses.push({ x: c.x, y: c.y, e: 0.25 + 0.3 * c.size, t: 1800, k: c.k, dead: false }); this.emit('death', c.x, c.y, c.k); }
    }
    for (const b of born) alive.push(b);
    this.creatures = alive;
    if (anyDead || T % 30 === 0) { this.plants = this.plants.filter(p => !p.dead); this.corpses = this.corpses.filter(d => !d.dead); }

    this.rescue();
    if (T % 60 === 0) this.countLineages();
    if (T % 50 === 0) this.sample();
  }

  seasonChange(season) {
    const msg = [
      'Spring arrives. Plants are growing fast again.',
      'Summer. Food is steady across the meadows.',
      'Autumn. Growth slows down.',
      'Winter. Plants wither and food gets scarce.',
    ][season];
    this.addLog(msg);
  }

  noteDeath(c) {
    const R = this.records;
    if (!R.oldest || c.age > R.oldest.age) {
      const was = R.oldest;
      R.oldest = { name: creatureName(c.id), age: c.age, k: c.k };
      if (was && c.age > was.age + 600 && this.T > 3 * DAY) this.addLog(`${creatureName(c.id)} dies at ${(c.age / DAY).toFixed(1)} days old, the oldest creature so far.`);
    }
    if (!R.mostKids || c.kids > R.mostKids.kids) R.mostKids = { name: creatureName(c.id), kids: c.kids, k: c.k };
  }

  rescue() {
    const n = [0, 0]; for (const c of this.creatures) n[c.k]++;
    for (let k = 0; k < 2; k++) {
      if (n[k] >= KINDS[k].min) continue;
      const pool = this.creatures.filter(c => c.k === k).sort((a, b) => (b.score + b.kids * 2) - (a.score + a.kids * 2));
      const add = k ? 5 : 14;
      for (let i = 0; i < add; i++) this.spawnRandom(k, null, null, pool.length && this.rng.next() < 0.7 ? pool[i % Math.min(3, pool.length)] : null);
      this.stats.rescues++;
      if (this.T - this.lastRescue[k] > 1500) {
        this.lastRescue[k] = this.T;
        this.addLog(k ? 'Predators were nearly gone. A new pack wanders in from beyond the map.' : 'Herbivores were nearly extinct. A small herd migrates in.');
      }
    }
  }

  countLineages() {
    for (const l of this.lineages.values()) l.count = 0;
    for (const c of this.creatures) { const l = this.lineages.get(c.lin); if (l) l.count++; }
    const n = [0, 0]; for (const c of this.creatures) n[c.k]++;
    for (const [id, l] of this.lineages) {
      if (l.count > l.peak) {
        if (l.peak <= n[l.k] * 0.5 && l.count > n[l.k] * 0.5 && l.count >= 20) this.addLog(`The ${l.name} line now makes up most ${KINDS[l.k].plural.toLowerCase()}.`);
        l.peak = l.count;
      }
      if (l.count === 0) { if (l.peak >= 30) this.addLog(`The ${l.name} line has died out after ${(Math.max(1, Math.round((this.T - l.born) / DAY)))} days.`); this.lineages.delete(id); }
    }
  }

  sample() {
    const acc = [[0, 0, 0, 0], [0, 0, 0, 0]];
    for (const c of this.creatures) { const a = acc[c.k]; a[0]++; a[1] += c.spd; a[2] += c.size; a[3] += c.sight; }
    const avg = (a, i) => a[0] ? +(a[i] / a[0]).toFixed(3) : null;
    this.history.push({
      t: this.T, h: acc[0][0], c: acc[1][0], p: this.plants.length,
      hs: avg(acc[0], 1), hz: avg(acc[0], 2), hv: avg(acc[0], 3),
      cs: avg(acc[1], 1), cz: avg(acc[1], 2), cv: avg(acc[1], 3),
    });
    if (this.history.length > 480) this.history.shift();
  }

  counts() { const n = [0, 0]; for (const c of this.creatures) n[c.k]++; return n; }
  topLineages(k, n = 3) { return [...this.lineages.values()].filter(l => l.k === k && l.count > 0).sort((a, b) => b.count - a.count).slice(0, n); }

  // ---------- god tools ----------
  seedPlants(x, y) {
    let added = 0;
    for (let i = 0; i < 60 && this.plants.length < MAX_PLANTS + 200; i++) {
      const a = this.rng.next() * Math.PI * 2, d = Math.sqrt(this.rng.next()) * 12;
      const px = wrap(x + Math.cos(a) * d, W), py = wrap(y + Math.sin(a) * d, H);
      if (!this.isWater(px, py)) { this.plants.push({ x: px, y: py, e: 0.8, dead: false }); added++; }
    }
    return added;
  }
  addCreatures(k, x, y, n) {
    if (this.isWater(x, y)) return 0;
    for (let i = 0; i < n; i++) {
      const px = wrap(x + (this.rng.next() - .5) * 6, W), py = wrap(y + (this.rng.next() - .5) * 6, H);
      this.spawnRandom(k, this.isWater(px, py) ? x : px, this.isWater(px, py) ? y : py);
    }
    return n;
  }

  // ---------- save / load ----------
  toJSON() {
    const f2b = a => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
    const r3 = v => Math.round(v * 1000) / 1000;
    return {
      v: 2, seed: this.seed, rng: this.rng.s, T: this.T, nextId: this.nextId,
      creatures: this.creatures.map(c => [c.id, c.k, r3(c.x), r3(c.y), r3(c.a), r3(c.e), c.age, c.gen, r3(c.hue), r3(c.size), r3(c.spd), r3(c.sight), c.lin, c.parent, c.score, c.kids, r3(c.mem), c.born, f2b(c.brain.w1), f2b(c.brain.w2)]),
      plants: this.plants.map(p => [r3(p.x), r3(p.y), r3(p.e)]),
      corpses: this.corpses.map(d => [r3(d.x), r3(d.y), r3(d.e), d.t, d.k]),
      lineages: [...this.lineages.values()],
      history: this.history, log: this.log, stats: this.stats, records: this.records,
      lastRescue: this.lastRescue, genMark: this.genMark,
    };
  }
  static fromJSON(d) {
    if (!d || d.v !== 2) throw new Error('Unsupported save');
    const b2f = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Float32Array(u.buffer); };
    const w = new World(d.seed);
    w.rng = new RNG(d.rng); w.T = d.T; w.nextId = d.nextId;
    w.creatures = d.creatures.map(a => ({
      id: a[0], k: a[1], x: a[2], y: a[3], a: a[4], e: a[5], age: a[6], gen: a[7], hue: a[8], size: a[9], spd: a[10], sight: a[11],
      lin: a[12], parent: a[13], score: a[14], kids: a[15], mem: a[16], born: a[17], brain: { w1: b2f(a[18]), w2: b2f(a[19]) },
      inp: new Float32Array(N_IN), hid: new Float32Array(N_H), out: new Float32Array(N_OUT), dead: false,
    }));
    w.plants = d.plants.map(a => ({ x: a[0], y: a[1], e: a[2], dead: false }));
    w.corpses = d.corpses.map(a => ({ x: a[0], y: a[1], e: a[2], t: a[3], k: a[4], dead: false }));
    w.lineages = new Map(d.lineages.map(l => [l.id, l]));
    w.history = d.history; w.log = d.log; w.stats = d.stats; w.records = d.records;
    w.lastRescue = d.lastRescue; w.genMark = d.genMark;
    return w;
  }
}
