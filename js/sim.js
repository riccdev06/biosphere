// Biosphere simulation engine. No DOM here: it runs in a Web Worker, the browser and Node.

export const W = 640, H = 400;           // world size in pixels (wraps around like a little planet)
const CS = 20, GX = W / CS, GY = H / CS, HW = W / 2, HH = H / 2;
export const DAY = 2400;                 // ticks per day
export const SEASON = 6000;              // ticks per season
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const GROWTH = [1.35, 1.0, 0.75, 0.5];
const MAX_PLANTS = 3400;
export const CARRION_T = 2600;     // ticks before carrion rots away

export const N_IN = 16, N_H = 8, N_OUT = 4;
export const OUT_LABELS = ['Steer', 'Speed', 'Memory', 'Call'];
const OLD_IN = 14, OLD_OUT = 3;      // brain shape before creatures could call
export const CALL_R = 40;            // how far a call carries
const HEAR = new Float32Array(3);

// Who eats what. prey: kinds this one can hunt; ratio: how big a prey it can take down.
export const KINDS = [
  { key: 'herb', name: 'Herbivore', plural: 'Herbivores', baseSp: 0.85, baseR: 26, cost: 1.0, maxAge: 4200, cap: 560, min: 15, start: 220,
    hue: 195, sat: 58, lit: 72, score: 'Meals', plants: 1.15, prey: [], carrion: 0, berriesOnly: false, flies: false,
    food: 'Food', danger: 'Danger' },
  { key: 'pred', name: 'Predator', plural: 'Predators', baseSp: 1.0, baseR: 32, cost: 1.3, maxAge: 4800, cap: 60, min: 4, start: 26, breed: 0.75, breedAge: 300,
    hue: 12, sat: 86, lit: 64, score: 'Kills', plants: 0, prey: [0, 2], ratio: 1.35, preyGain: 0.9, carrion: 0.5, flies: false,
    food: 'Prey', danger: 'Rival' },
  { key: 'omni', name: 'Omnivore', plural: 'Omnivores', baseSp: 0.9, baseR: 28, cost: 0.88, maxAge: 4500, cap: 120, min: 5, start: 36,
    hue: 44, sat: 80, lit: 62, score: 'Meals', plants: 0.78, prey: [0], ratio: 0.8, preyGain: 0.6, carrion: 0.4, flies: false,
    food: 'Food', danger: 'Danger' },
  { key: 'scav', name: 'Scavenger', plural: 'Scavengers', baseSp: 0.8, baseR: 52, cost: 0.65, maxAge: 6000, cap: 90, min: 4, start: 30,
    hue: 278, sat: 52, lit: 70, score: 'Carcasses', plants: 0, prey: [], carrion: 1, flies: false,
    food: 'Carrion', danger: 'Danger' },
  { key: 'fly', name: 'Flyer', plural: 'Flyers', baseSp: 1.25, baseR: 40, cost: 0.82, maxAge: 3800, cap: 130, min: 4, start: 30,
    hue: 330, sat: 70, lit: 82, score: 'Berries', plants: 1, berriesOnly: true, prey: [], carrion: 0, flies: true,
    food: 'Berry', danger: 'Danger' },
];
const NK = KINDS.length;
// danger[k] = kinds that hunt k
const DANGER = KINDS.map((_, k) => KINDS.map((K, j) => K.prey.includes(k) ? j : -1).filter(j => j >= 0));
export function labelsFor(k) {
  const K = KINDS[k];
  return [`${K.food} side`, `${K.food} ahead`, `${K.food} near`, `${K.danger} side`, `${K.danger} ahead`, `${K.danger} near`,
    'Kin side', 'Kin ahead', 'Kin near', 'Water ahead', 'Water side', 'Energy', 'Memory', 'Constant', 'Call side', 'Call near'];
}

// Terrain types
export const DEEP = 0, SHALLOW = 1, SAND = 2, GRASS = 3, ROCK = 4;

export const EVENTS = {
  drought: { name: 'Drought', days: 0.75, growth: 0.45, water: -1 },
  flood: { name: 'Floods', days: 0.6, growth: 1.1, water: 1 },
  bloom: { name: 'Bloom', days: 0.5, growth: 3.0, water: 0 },
  frost: { name: 'Cold snap', days: 0.55, growth: 0.35, water: 0, cost: 1.12 },
  meteor: { name: 'Meteor', days: 0.3, growth: 1, water: 0 },
};

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
const lineageName = id => { const a = SYL[(id * 5 + 1) % 24], b = SYL[(id * 11 + 7) % 24], c = SYL[(id * 3 + 2) % 24]; return a[0].toUpperCase() + a.slice(1) + b + c; };
const ADJ = ['quiet', 'windy', 'ancient', 'golden', 'misty', 'wild', 'bright', 'hidden', 'warm', 'remote', 'silver', 'sleepy'];
const NOUN = ['swamp', 'valley', 'island', 'prairie', 'forest', 'lagoon', 'dune', 'glade', 'hill', 'delta', 'marsh', 'reef'];
export function randomSeed() { const r = Math.random; return ADJ[r() * 12 | 0] + '-' + NOUN[r() * 12 | 0] + '-' + (10 + (r() * 90 | 0)); }
export const cleanSeed = s => String(s).toLowerCase().trim().replace(/[^a-z0-9._~-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// ---------- helpers ----------
const wrap = (v, L) => ((v % L) + L) % L;
export function tdelta(a, b, L) { let d = b - a; if (d > L / 2) d -= L; else if (d < -L / 2) d += L; return d; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const f2b = a => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
const b2f = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Float32Array(u.buffer); };

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
  const oct = [[W / 40, H / 40, .5], [W / 20, H / 20, .27], [W / 10, H / 10, .15], [W / 5, H / 5, .08]].map(([nx, ny, w]) => [periodicNoise(rng, nx, ny), w]);
  return (x, y) => { let s = 0; for (const [n, w] of oct) s += n(x, y) * w; return s; };
}
function percentile(arr, p) { const s = Float32Array.from(arr).sort(); return s[Math.floor(p * (s.length - 1))]; }

// ---------- brains ----------
function makeBrain(rng) {
  const w1 = new Float32Array(N_H * N_IN), w2 = new Float32Array(N_OUT * (N_H + 1));
  for (let i = 0; i < w1.length; i++) w1[i] = rng.gauss() * 0.8;
  for (let i = 0; i < w2.length; i++) w2[i] = rng.gauss() * 0.8;
  return { w1, w2 };
}
// Brains from before calls existed get the new senses and the call output wired at zero,
// so they behave exactly as they did and never call until a mutation says otherwise.
export function upgradeBrain(w1, w2) {
  if (w1.length === N_H * N_IN && w2.length === N_OUT * (N_H + 1)) return { w1, w2 };
  if (w1.length !== N_H * OLD_IN || w2.length !== OLD_OUT * (N_H + 1)) return null;
  const n1 = new Float32Array(N_H * N_IN), n2 = new Float32Array(N_OUT * (N_H + 1));
  for (let h = 0; h < N_H; h++) for (let i = 0; i < OLD_IN; i++) n1[h * N_IN + i] = w1[h * OLD_IN + i];
  n2.set(w2);
  n2[OLD_OUT * (N_H + 1) + N_H] = -1;   // bias the new call output toward silence
  return { w1: n1, w2: n2 };
}
function mutateArr(rng, src, rate = 1) {
  const w = Float32Array.from(src);
  for (let i = 0; i < w.length; i++) {
    const r = rng.next();
    if (r < 0.015 * rate) w[i] = rng.gauss();
    else if (r < 0.15 * rate) w[i] += rng.gauss() * 0.3;
  }
  return w;
}

// One step of thinking: senses -> hidden layer -> steer, speed, memory.
export function think(brain, inp, hid, out) {
  const { w1, w2 } = brain;
  for (let h = 0; h < N_H; h++) { let s = 0; const o = h * N_IN; for (let i = 0; i < N_IN; i++) s += w1[o + i] * inp[i]; hid[h] = Math.tanh(s); }
  for (let o = 0; o < N_OUT; o++) { const b = o * (N_H + 1); let s = w2[b + N_H]; for (let h = 0; h < N_H; h++) s += w2[b + h] * hid[h]; out[o] = Math.tanh(s); }
}
// Turns a nearest-thing hit into three senses: how far to the side, how far ahead, how close.
function senseInto(inp, off, a, hit, R) {
  if (!hit) { inp[off] = 0; inp[off + 1] = 0; inp[off + 2] = 0; return; }
  const ca = Math.cos(a), sa = Math.sin(a), d = hit.d || 1e-3;
  inp[off] = (-hit.dx * sa + hit.dy * ca) / d;
  inp[off + 1] = (hit.dx * ca + hit.dy * sa) / d;
  inp[off + 2] = Math.max(0, 1 - hit.d / R);
}

// ---------- intelligence test ----------
// A brain is dropped into a small, flat arena for a fixed time. Plant eaters and scavengers
// look for food; predators chase wandering prey; herbivores and omnivores also have to dodge
// a hunter. The score is how much food it finds before it starves or gets caught.
// The same arenas are used for every brain, so evolved brains and random ones get a fair race.
const ARENA = 160, ARENA_STEPS = 600, ARENA_FOOD = 26;
export function trial(brain, k, arenaSeed) {
  const K = KINDS[k], r = new RNG(arenaSeed * 7919 + k * 104729), A = ARENA, HA = A / 2;
  const d = (a, b) => { let v = b - a; if (v > HA) v -= A; else if (v < -HA) v += A; return v; };
  const food = []; for (let i = 0; i < ARENA_FOOD; i++) food.push({ x: r.next() * A, y: r.next() * A, a: r.next() * 6.28 });
  const hunted = DANGER[k].length > 0;
  const hunter = hunted ? { x: r.next() * A, y: r.next() * A } : null;
  const me = { x: A / 2, y: A / 2, a: r.next() * 6.28, e: 1.2, mem: 0 };
  const inp = new Float32Array(N_IN), hid = new Float32Array(N_H), out = new Float32Array(N_OUT);
  const R = K.baseR, sp0 = K.baseSp, moving = k === 1;
  let score = 0;
  for (let t = 0; t < ARENA_STEPS; t++) {
    let best = null, bd = R * R;
    for (const f of food) { const dx = d(me.x, f.x), dy = d(me.y, f.y), q = dx * dx + dy * dy; if (q < bd) { bd = q; best = { o: f, dx, dy, d: Math.sqrt(q) }; } }
    senseInto(inp, 0, me.a, best, R);
    let hd = null;
    if (hunter) { const dx = d(me.x, hunter.x), dy = d(me.y, hunter.y), q = Math.sqrt(dx * dx + dy * dy); if (q < R) hd = { dx, dy, d: q }; }
    senseInto(inp, 3, me.a, hd, R);
    inp[6] = inp[7] = inp[8] = inp[9] = inp[10] = 0;
    inp[11] = me.e / 2.4 * 2 - 1; inp[12] = me.mem; inp[13] = 1;
    think(brain, inp, hid, out);
    me.mem = out[2]; me.a += out[0] * 0.3;
    const sp = (out[1] + 1) * 0.5 * sp0;
    me.x = (me.x + Math.cos(me.a) * sp + A) % A; me.y = (me.y + Math.sin(me.a) * sp + A) % A;
    me.e -= (0.0011 + 0.0032 * sp * sp + 0.0005) * K.cost;
    if (best && best.d < 2.3) {
      score++; me.e = Math.min(2.4, me.e + 0.4);
      best.o.x = r.next() * A; best.o.y = r.next() * A;
    }
    if (moving) for (const f of food) { f.a += (r.next() - .5) * 0.6; f.x = (f.x + Math.cos(f.a) * 0.45 + A) % A; f.y = (f.y + Math.sin(f.a) * 0.45 + A) % A; }
    if (hunter) {
      const dx = d(hunter.x, me.x), dy = d(hunter.y, me.y), q = Math.sqrt(dx * dx + dy * dy) || 1;
      const hs = q < 34 ? 0.72 : 0.3;
      hunter.x = (hunter.x + dx / q * hs + A) % A; hunter.y = (hunter.y + dy / q * hs + A) % A;
      if (q < 2) break;          // caught
    }
    if (me.e <= 0) break;        // starved
  }
  return score;
}
const TRIAL_ARENAS = [1, 2, 3];
const baselineCache = new Map();
// The random-brain score is the same for every world, so it is worked out once and kept.
export function baseline(k) {
  if (baselineCache.has(k)) return baselineCache.get(k);
  const r = new RNG(424242 + k); let sum = 0, n = 0;
  for (let i = 0; i < 24; i++) { const b = makeBrain(r); for (const s of TRIAL_ARENAS) { sum += trial(b, k, s); n++; } }
  const v = sum / n; baselineCache.set(k, v); return v;
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
    this.anc = new Map();          // family registry: id -> record
    this.history = []; this.log = [];
    this.stats = { births: 0, deaths: 0, eaten: 0, rescues: 0, fights: 0, events: 0 };
    this.records = { oldest: null, mostKids: null, maxGen: new Array(NK).fill(0) };
    this.lastRescue = new Array(NK).fill(-1e9); this.genMark = new Array(NK).fill(0);
    this.event = null; this.nextEventAt = DAY * (1.5 + this.rng.next() * 1.5);
    this.waterLevel = 0; this.waterTarget = 0;
    this.meteors = [];
    this.fx = []; this.fxOn = false; this.fightsToday = 0;
    this.iq = new Array(NK).fill(null); this.iqHistory = []; this.iqMark = new Array(NK).fill(0);
    // per species: [calls near danger, ticks near danger, calls near food, ticks near food, calls otherwise, ticks otherwise]
    this.lang = Array.from({ length: NK }, () => new Array(6).fill(0));
    this.calls = new Array(NK).fill(null); this.callMark = Array.from({ length: NK }, () => ({}));
    this.grids = Array.from({ length: NK + 3 }, () => Array.from({ length: GX * GY }, () => []));
  }

  static create(seed, warmup = 600) {
    const w = new World(seed);
    for (let i = 0; i < 1800; i++) w.growPlant(true);
    for (let k = 0; k < NK; k++) for (let i = 0; i < KINDS[k].start; i++) w.spawnRandom(k);
    w.addLog(`World "${seed}" is born. Five species start out with random brains.`);
    for (let i = 0; i < warmup; i++) w.tick();
    for (let k = 0; k < NK; k++) w.measureIQ(k, true);
    return w;
  }

  // ----- terrain -----
  buildTerrain() {
    const r = this.rng, hN = fbm(r), mN = fbm(r);
    const N = W * H, h = new Float32Array(N), m = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { h[y * W + x] = hN(x, y); m[y * W + x] = mN(x, y); }
    // water thresholds for low, normal and high water
    this.th = {
      deep: percentile(h, 0.10), shallow: [percentile(h, 0.115), percentile(h, 0.165), percentile(h, 0.235)],
      sand: percentile(h, 0.215), rock: percentile(h, 0.94),
    };
    this.elev = h;
    const type = new Uint8Array(N);
    this.type = type; this.waterVer = 0; this.classify(0);
    // distance to normal water
    const dist = new Uint8Array(N).fill(255), q = new Int32Array(N); let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (type[i] <= SHALLOW) { dist[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++], d = dist[i]; if (d >= 14) continue;
      const x = i % W, y = (i / W) | 0;
      for (const j of [y * W + (x + 1) % W, y * W + (x + W - 1) % W, ((y + 1) % H) * W + x, ((y + H - 1) % H) * W + x])
        if (dist[j] > d + 1) { dist[j] = d + 1; q[qt++] = j; }
    }
    const mMin = percentile(m, 0.02), mMax = percentile(m, 0.98), fert = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const mm = clamp((m[i] - mMin) / (mMax - mMin), 0, 1); m[i] = mm;
      const t = type[i];
      fert[i] = t === GRASS ? clamp(0.12 + 0.7 * mm + Math.max(0, (12 - dist[i]) / 12) * 0.35, 0, 1) : t === SAND ? 0.06 : t === ROCK ? 0.02 : 0.25;
    }
    const hMin = this.th.deep, hMax = percentile(h, 0.99), height = new Float32Array(N);
    for (let i = 0; i < N; i++) height[i] = clamp((h[i] - hMin) / (hMax - hMin), 0, 1);
    this.height = height; this.moist = m; this.fert = fert;
    this.bonus = new Float32Array(N);   // fertility from carrion and meteor ash
  }
  // level: -1 low water, 0 normal, 1 high water (fractions ease between them)
  classify(level) {
    const th = this.th, i0 = level < 0 ? 0 : 1, f = level < 0 ? 1 + level : level;
    const sh = th.shallow[i0] + (th.shallow[i0 + 1] - th.shallow[i0]) * f;
    const sand = Math.max(th.sand, sh + 0.004);
    const h = this.elev, type = this.type;
    for (let i = 0; i < h.length; i++) type[i] = h[i] < th.deep ? DEEP : h[i] < sh ? SHALLOW : h[i] < sand ? SAND : h[i] > th.rock ? ROCK : GRASS;
    this.waterVer++;
  }
  isWater(x, y) { return this.type[(wrap(y | 0, H)) * W + wrap(x | 0, W)] <= SHALLOW; }
  get season() { return Math.floor(this.T / SEASON) % 4; }
  get day() { return Math.floor(this.T / DAY) + 1; }
  get year() { return Math.floor(this.T / (SEASON * 4)) + 1; }
  get light() { const p = (this.T % DAY) / DAY; return 0.5 - 0.5 * Math.cos(2 * Math.PI * p); }
  get darkness() { return clamp((0.5 - this.light) / 0.4, 0, 1); }
  get growth() { return GROWTH[this.season] * (this.event ? EVENTS[this.event.type].growth : 1); }

  addLog(msg, kind) { this.log.unshift({ t: this.T, msg, kind }); if (this.log.length > 80) this.log.length = 80; }
  emit(type, x, y, k) { if (this.fxOn && this.fx.length < 300) this.fx.push({ type, x, y, k }); }

  randomLand() {
    for (let tries = 0; tries < 300; tries++) {
      const x = this.rng.next() * W, y = this.rng.next() * H;
      if (!this.isWater(x, y)) return [x, y];
    }
    return [W / 2, H / 2];
  }
  growPlant(full) {
    const r = this.rng;
    for (let tries = 0; tries < 3; tries++) {
      const x = r.next() * W | 0, y = r.next() * H | 0, i = y * W + x;
      if (this.type[i] <= SHALLOW) continue;
      if (r.next() < this.fert[i] + this.bonus[i]) { this.plants.push({ x: x + .5, y: y + .5, e: full ? 0.6 + r.next() * 0.8 : 0.1, dead: false }); return; }
    }
  }

  // ----- creatures -----
  newLineage(k, hue, name) {
    const id = this.nextId;
    this.lineages.set(id, { id, name: name || lineageName(id), k, hue, born: this.T, count: 0, peak: 0 });
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
      inp: new Float32Array(N_IN), hid: new Float32Array(N_H), out: new Float32Array(N_OUT), dead: false, eaten: false, call: 0, heard: 0,
    };
    if (!c.lin) c.lin = this.newLineage(k, hue, o.linName);
    this.anc.set(c.id, { id: c.id, p: c.parent, k, g: c.gen, b: this.T, d: -1, kids: 0, lin: c.lin, hue, s: 0 });
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
  maxE(c) { return 2.4 * c.size; }
  maxSp(c) { return KINDS[c.k].baseSp * c.spd / Math.sqrt(c.size); }
  sightR(c) { return Math.min(c.k === 3 ? 64 : 46, KINDS[c.k].baseR * c.sight * (1 - this.darkness * (c.k === 1 ? 0.25 : 0.4))); }

  // ----- spatial grid -----
  // grids[0..NK-1]: creatures by kind, NK: plants, NK+1: berries, NK+2: carrion
  buildGrids() {
    const G = this.grids;
    for (const g of G) for (let i = 0; i < g.length; i++) g[i].length = 0;
    const cell = (x, y) => ((y / CS) | 0) % GY * GX + ((x / CS) | 0) % GX;
    const gP = G[NK], gB = G[NK + 1], gX = G[NK + 2];
    for (const p of this.plants) { const i = cell(p.x, p.y); gP[i].push(p); if (p.e > 0.45) gB[i].push(p); }
    for (const c of this.creatures) G[c.k][cell(c.x, c.y)].push(c);
    for (const d of this.corpses) gX[cell(d.x, d.y)].push(d);
  }
  nearest(grid, x, y, R, self, best) {
    const x0 = Math.floor((x - R) / CS), x1 = Math.floor((x + R) / CS), y0 = Math.floor((y - R) / CS), y1 = Math.floor((y + R) / CS);
    let bd = best ? best.d * best.d : R * R, b = null, bx = 0, by = 0;
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
          if (d < bd) { bd = d; b = o; bx = dx; by = dy; }
        }
      }
    }
    return b ? { o: b, dx: bx, dy: by, d: Math.sqrt(bd) } : best;
  }
  nearestCaller(grid, x, y, R, self) {
    const x0 = Math.floor((x - R) / CS), x1 = Math.floor((x + R) / CS), y0 = Math.floor((y - R) / CS), y1 = Math.floor((y + R) / CS);
    let bd = R * R, b = null, bx = 0, by = 0;
    for (let j = y0; j <= y1; j++) {
      const row = ((j % GY) + GY) % GY * GX;
      for (let i = x0; i <= x1; i++) {
        const cell = grid[row + ((i % GX) + GX) % GX];
        for (let n = 0; n < cell.length; n++) {
          const o = cell[n];
          if (!o.call || o.dead || o === self) continue;
          let dx = o.x - x; if (dx > HW) dx -= W; else if (dx < -HW) dx += W;
          let dy = o.y - y; if (dy > HH) dy -= H; else if (dy < -HH) dy += H;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; b = o; bx = dx; by = dy; }
        }
      }
    }
    return b ? { o: b, dx: bx, dy: by, d: Math.sqrt(bd) } : null;
  }
  sense(c, off, hit, R) { senseInto(c.inp, off, c.a, hit, R); }
  waterAt(c, ang, dist) { return this.isWater(c.x + Math.cos(c.a + ang) * dist, c.y + Math.sin(c.a + ang) * dist) ? 1 : 0; }

  // ----- one step -----
  tick() {
    this.T++;
    const T = this.T, r = this.rng, season = this.season, G = this.grids;
    if (T % SEASON === 0) this.seasonChange(season);
    this.updateEvent();
    const g = this.growth;

    // plants
    const att = 26 * g; let n = Math.floor(att) + (r.next() < att % 1 ? 1 : 0);
    while (n-- > 0 && this.plants.length < MAX_PLANTS) this.growPlant(false);
    let anyDead = false;
    const wither = (season === 3 ? 0.0002 : 0) + (this.event && this.event.type === 'drought' ? 0.00025 : 0);
    const grow = 0.003 * Math.min(g, 1.6);
    for (const p of this.plants) {
      if (p.dead) { anyDead = true; continue; }
      if (p.e < 1.4) p.e += grow;
      if (wither && r.next() < wither) { p.dead = true; anyDead = true; }
    }
    // carrion decays into fertile soil
    for (const d of this.corpses) {
      if (--d.t <= 0 || d.e <= 0) {
        d.dead = true; anyDead = true;
        if (d.e > 0) this.fertilize(d.x, d.y, 3, 0.25);
      }
    }
    if (T % 50 === 0) { const b = this.bonus; for (let i = 0; i < b.length; i++) if (b[i] > 0.001) b[i] *= 0.97; else b[i] = 0; }

    this.buildGrids();
    const gP = G[NK], gB = G[NK + 1], gX = G[NK + 2];
    const count = this.counts();
    const born = [];
    const costMul = (this.event && EVENTS[this.event.type].cost) || 1;

    for (const c of this.creatures) {
      if (c.dead) continue;
      const K = KINDS[c.k], R = this.sightR(c);
      // senses: food, danger, kin
      let food = null;
      if (K.berriesOnly) food = this.nearest(gB, c.x, c.y, R);
      else if (K.plants) food = this.nearest(gP, c.x, c.y, R);
      for (const pk of K.prey) food = this.nearest(G[pk], c.x, c.y, R, null, food);
      if (K.carrion) food = this.nearest(gX, c.x, c.y, R, null, food);
      let danger = null;
      if (c.k === 1) { // bigger rival predators
        const rv = this.nearest(G[1], c.x, c.y, R * 0.7, c);
        if (rv && rv.o.size > c.size * 1.12) danger = rv;
      } else for (const dk of DANGER[c.k]) danger = this.nearest(G[dk], c.x, c.y, R, null, danger);
      const slow = ((T + c.id) & 1) === 0 || c.k === 1;   // kin and water senses refresh every other step
      const kin = slow ? this.nearest(G[c.k], c.x, c.y, R * 0.6, c) : null;
      this.sense(c, 0, food, R); this.sense(c, 3, danger, R); if (slow) this.sense(c, 6, kin, R * 0.6);
      if (slow) { const heard = this.nearestCaller(G[c.k], c.x, c.y, CALL_R, c); senseInto(HEAR, 0, c.a, heard, CALL_R); c.inp[14] = HEAR[0]; c.inp[15] = HEAR[2]; c.heard = heard ? 1 : 0; }
      if (K.flies) { c.inp[9] = 0; c.inp[10] = 0; }
      else if (((T + c.id) % 3) === 0) { c.inp[9] = this.waterAt(c, 0, 3) || this.waterAt(c, 0, 6) * 0.5; c.inp[10] = this.waterAt(c, 0.7, 5) - this.waterAt(c, -0.7, 5); }
      c.inp[11] = c.e / this.maxE(c) * 2 - 1; c.inp[12] = c.mem; c.inp[13] = 1;
      // think
      think(c.brain, c.inp, c.hid, c.out);
      c.mem = c.out[2];
      c.call = c.out[3] > 0.3 ? 1 : 0;
      if (c.call) c.e -= 0.0006;
      if ((T & 3) === 0) {  // who calls, and when: the raw material for the language statistics
        const L = this.lang[c.k], dn = c.inp[5] > 0.25, fn = c.inp[2] > 0.5;
        const b = dn ? 0 : fn ? 2 : 4; L[b] += c.call; L[b + 1]++;
      }
      // move
      c.a += c.out[0] * 0.3;
      const sp = (c.out[1] + 1) * 0.5 * this.maxSp(c);
      const nx = c.x + Math.cos(c.a) * sp, ny = c.y + Math.sin(c.a) * sp;
      if (!K.flies && this.isWater(nx, ny) && !this.isWater(c.x, c.y)) { c.a += (r.next() < .5 ? 1 : -1) * 0.9; c.e -= 0.002; }
      else { c.x = wrap(nx, W); c.y = wrap(ny, H); }
      // starving creatures slow their metabolism, which lets a few survive the lean times
      const torpor = c.e < 0.25 * this.maxE(c) ? 0.5 : 1;
      c.e -= (0.0011 * c.size * torpor + 0.0032 * sp * sp * c.size + 0.0005 * c.sight) * K.cost * costMul;
      c.age++;
      // eat
      const reach = 1.4 + c.size * 0.9;
      if (food && food.d < reach && !food.o.dead) {
        const o = food.o;
        if (o.brain) { // live prey
          // bigger prey and well-fed prey escape more often; the hunter leaves leftovers for scavengers
          if (o.size <= c.size * K.ratio && r.next() < 0.55 - 0.15 * (o.size / c.size - 0.7) - (o.k === 2 ? 0.25 : 0)) { // omnivores fight back
            o.dead = true; o.eaten = true; c.e += (0.3 + 0.35 * o.e) * K.preyGain; c.score++; this.stats.eaten++;
            this.corpses.push({ x: o.x, y: o.y, e: 0.2 + 0.15 * o.size, t: CARRION_T, k: o.k, dead: false });
            this.emit('kill', o.x, o.y, c.k);
          } else if (o.size <= c.size * K.ratio) { o.a += Math.PI * 0.8; }
        } else if (o.t !== undefined) { // carrion
          const bite = Math.min(o.e, c.k === 3 ? 0.32 : 0.25); o.e -= bite; c.e += bite * K.carrion * (c.k === 3 ? 1.6 : 1);
          if (c.k === 3 && o.e <= 0) c.score++;
        } else { // plant
          o.dead = true; anyDead = true;
          c.e += (o.e > 1 ? 0.6 : 0.42 * o.e) * K.plants * (K.berriesOnly ? 1.4 : 1); c.score++;
        }
      }
      // territory: big predators drive small ones off
      if (c.k === 1 && kin && kin.d < 3 && kin.o.size > c.size * 1.15) {
        c.e -= 0.05; c.a += Math.PI * 0.7; this.stats.fights++; this.fightsToday++;
        if (r.next() < 0.05) this.emit('fight', c.x, c.y, 1);
      }
      const mE = this.maxE(c); if (c.e > mE) c.e = mE;
      // reproduce
      // crowding makes breeding rarer, so populations level off instead of slamming into the cap
      const crowd = count[c.k] / K.cap;
      if (c.k === 1 ? r.next() < 1 - crowd : true) if (c.e >= (K.breed || 0.66) * mE && c.age > (K.breedAge || 150) && count[c.k] < K.cap && (c.k === 1 || r.next() < 1 - crowd * crowd * crowd)) {
        const childE = c.e * 0.45; c.e -= childE; c.kids++; count[c.k]++;
        const mut = v => v + r.gauss() * 0.05;
        let cx = wrap(c.x + (r.next() - .5) * 5, W), cy = wrap(c.y + (r.next() - .5) * 5, H);
        if (!K.flies && this.isWater(cx, cy)) { cx = c.x; cy = c.y; }
        const ch = this.makeCreature(c.k, cx, cy, {
          brain: { w1: mutateArr(r, c.brain.w1), w2: mutateArr(r, c.brain.w2) },
          size: clamp(mut(c.size), 0.6, 1.7), spd: clamp(mut(c.spd), 0.5, 1.6), sight: clamp(mut(c.sight), 0.5, 1.7),
          hue: c.hue + r.gauss() * 2.5, lin: c.lin, gen: c.gen + 1, parent: c.id, e: childE,
        });
        const pa = this.anc.get(c.id); if (pa) pa.kids++;
        born.push(ch); this.stats.births++;
        this.emit('birth', cx, cy, c.k);
        if (ch.gen > this.records.maxGen[c.k]) {
          this.records.maxGen[c.k] = ch.gen;
          if (ch.gen >= this.genMark[c.k] + 25) { this.genMark[c.k] = ch.gen; this.addLog(`${K.plural} reach generation ${ch.gen}.`); }
        }
      }
      if (c.e <= 0 || c.age > K.maxAge * (0.8 + 0.2 * c.size)) c.dead = true;
    }
    this.cleanup(born);
    if (anyDead || T % 30 === 0) { this.plants = this.plants.filter(p => !p.dead); this.corpses = this.corpses.filter(d => !d.dead); }

    this.rescue();
    if (T % 60 === 0) this.countLineages();
    if (T % 100 === 0) this.sample();
    if (T % 1200 === 0) this.pruneFamily();
    { const slot = T % DAY; if (slot % 400 === 0 && slot / 400 < NK) this.measureIQ(slot / 400); }
    if (T % DAY === 0) { this.recordIQ(); this.summarizeCalls(); }
    if (T % DAY === 0) {
      if (this.fightsToday > 400) this.addLog(`Territory wars: predators clashed ${this.fightsToday.toLocaleString('en-US')} times today. The biggest ones hold the best hunting grounds.`);
      this.fightsToday = 0;
    }
  }
  // the dead leave carrion, unless they were eaten
  cleanup(born = []) {
    const alive = [];
    for (const c of this.creatures) {
      if (!c.dead) { alive.push(c); continue; }
      this.stats.deaths++; this.noteDeath(c);
      if (!c.eaten) { this.corpses.push({ x: c.x, y: c.y, e: 0.25 + 0.3 * c.size, t: CARRION_T, k: c.k, dead: false }); this.emit('death', c.x, c.y, c.k); }
    }
    for (const b of born) alive.push(b);
    this.creatures = alive;
  }

  fertilize(x, y, rad, amt) {
    for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
      const d2 = i * i + j * j; if (d2 > rad * rad) continue;
      const k = wrap((y | 0) + j, H) * W + wrap((x | 0) + i, W);
      if (this.type[k] >= SAND) this.bonus[k] = Math.min(0.7, this.bonus[k] + amt * (1 - d2 / (rad * rad * 2)));
    }
  }

  // ----- climate events -----
  updateEvent() {
    const T = this.T, r = this.rng;
    // the water level eases toward its target
    if (T % 40 === 0 && this.waterLevel !== this.waterTarget) {
      const diff = this.waterTarget - this.waterLevel;
      this.waterLevel = Math.abs(diff) < 0.11 ? this.waterTarget : Math.round((this.waterLevel + 0.1 * Math.sign(diff)) * 10) / 10;
      this.classify(this.waterLevel);
      if (this.waterLevel > 0) for (const p of this.plants) if (this.isWater(p.x, p.y)) p.dead = true;
    }
    if (this.event) {
      if (T >= this.event.end) {
        const msg = { drought: 'The drought is over. Water returns to the lakes.', flood: 'The floodwaters recede, leaving rich soil behind.',
          bloom: 'The bloom fades.', frost: 'The cold snap breaks.', meteor: 'The dust from the impact settles.' }[this.event.type];
        if (this.event.type === 'flood') {
          for (let i = 0; i < this.type.length; i++) if (this.type[i] === SHALLOW && this.elev[i] >= this.th.shallow[1]) this.bonus[i] = Math.min(0.7, this.bonus[i] + 0.3);
        }
        this.addLog(msg, 'event');
        this.event = null; this.waterTarget = 0;
        this.nextEventAt = T + DAY * (1.6 + r.next() * 2.4);
      }
      return;
    }
    if (T < this.nextEventAt) return;
    const s = this.season;
    const pool = [['drought', s === 1 ? 4 : 1.5], ['flood', s === 0 || s === 2 ? 3.5 : 1.2], ['bloom', s === 0 ? 3 : 1.2], ['meteor', 1.4], ['frost', s === 3 || s === 2 ? 3.5 : 0.3]];
    const tot = pool.reduce((a, p) => a + p[1], 0); let pick = r.next() * tot, type = 'meteor';
    for (const [k, w] of pool) { pick -= w; if (pick <= 0) { type = k; break; } }
    this.startEvent(type);
  }
  startEvent(type, x, y) {
    const E = EVENTS[type], T = this.T;
    this.event = { type, start: T, end: T + Math.round(E.days * DAY) };
    this.stats.events++;
    this.waterTarget = E.water;
    if (type === 'meteor') {
      if (x == null) [x, y] = this.randomLand();
      const R = 16; let lost = 0;
      for (const c of this.creatures) {
        const dx = tdelta(x, c.x, W), dy = tdelta(y, c.y, H);
        if (!c.dead && dx * dx + dy * dy < R * R) { c.dead = true; lost++; }
      }
      this.cleanup();
      for (const p of this.plants) { const dx = tdelta(x, p.x, W), dy = tdelta(y, p.y, H); if (dx * dx + dy * dy < R * R) p.dead = true; }
      this.fertilize(x, y, R + 4, 0.5);
      this.meteors.push({ x, y, t: T }); if (this.meteors.length > 8) this.meteors.shift();
      this.emit('meteor', x, y, 0);
      this.event.x = x; this.event.y = y;
      this.addLog(`A meteor strikes! ${lost} creature${lost === 1 ? ' is' : 's are'} lost, and the crater will turn into fertile ash.`, 'event');
      return;
    }
    this.addLog({
      drought: 'A drought begins. Shallow lakes dry up and plants wither.',
      flood: 'Heavy rains. Lakes overflow and flood the lowlands.',
      bloom: 'A bloom! Plants burst out across the land.',
      frost: 'A cold snap freezes the land. Moving costs more energy.',
    }[type], 'event');
  }

  seasonChange(season) {
    this.addLog(['Spring arrives. Plants are growing fast again.', 'Summer. Food is steady across the meadows.',
      'Autumn. Growth slows down.', 'Winter. Plants grow slowly and food gets scarce.'][season], 'season');
  }

  // ----- bookkeeping -----
  noteDeath(c) {
    const a = this.anc.get(c.id); if (a) { a.d = this.T; a.s = c.score; }
    const R = this.records;
    if (!R.oldest || c.age > R.oldest.age) {
      const was = R.oldest;
      R.oldest = { name: creatureName(c.id), age: c.age, k: c.k };
      if (was && c.age > was.age + 600 && this.T > 3 * DAY) this.addLog(`${creatureName(c.id)} dies at ${(c.age / DAY).toFixed(1)} days old, the oldest creature so far.`);
    }
    if (!R.mostKids || c.kids > R.mostKids.kids) R.mostKids = { name: creatureName(c.id), kids: c.kids, k: c.k };
  }
  rescue() {
    const n = this.counts();
    for (let k = 0; k < NK; k++) {
      if (n[k] >= KINDS[k].min) continue;
      const pool = this.creatures.filter(c => c.k === k).sort((a, b) => (b.score + b.kids * 2) - (a.score + a.kids * 2));
      const add = Math.max(5, KINDS[k].min);
      for (let i = 0; i < add; i++) this.spawnRandom(k, null, null, pool.length && this.rng.next() < 0.7 ? pool[i % Math.min(3, pool.length)] : null);
      this.stats.rescues++;
      if (this.T - this.lastRescue[k] > DAY * 2) {
        this.lastRescue[k] = this.T;
        this.addLog(`${KINDS[k].plural} were nearly gone. A few newcomers wander in from beyond the map.`);
      }
    }
  }
  countLineages() {
    for (const l of this.lineages.values()) l.count = 0;
    for (const c of this.creatures) { const l = this.lineages.get(c.lin); if (l) l.count++; }
    const n = this.counts();
    for (const [id, l] of this.lineages) {
      if (l.count > l.peak) {
        if (l.peak <= n[l.k] * 0.5 && l.count > n[l.k] * 0.5 && l.count >= 20) this.addLog(`The ${l.name} line now makes up most ${KINDS[l.k].plural.toLowerCase()}.`);
        l.peak = l.count;
      }
      if (l.count === 0) {
        if (l.peak >= 30) this.addLog(`The ${l.name} line of ${KINDS[l.k].plural.toLowerCase()} has died out after ${Math.max(1, Math.round((this.T - l.born) / DAY))} days.`);
        this.lineages.delete(id);
      }
    }
  }
  // keep family records of everyone with living descendants, plus the recently dead
  pruneFamily() {
    const keep = new Set();
    for (const c of this.creatures) { let id = c.id, guard = 0; while (id && !keep.has(id) && guard++ < 4000) { keep.add(id); id = this.anc.get(id)?.p; } }
    const recent = this.T - DAY;
    for (const [id, a] of this.anc) if (!keep.has(id) && !(a.d >= recent)) this.anc.delete(id);
  }
  sample() {
    const acc = Array.from({ length: NK }, () => [0, 0, 0, 0]);
    for (const c of this.creatures) { const a = acc[c.k]; a[0]++; a[1] += c.spd; a[2] += c.size; a[3] += c.sight; }
    const avg = (a, i) => a[0] ? +(a[i] / a[0]).toFixed(3) : null;
    this.history.push({ t: this.T, p: this.plants.length, n: acc.map(a => a[0]), spd: acc.map(a => avg(a, 1)), size: acc.map(a => avg(a, 2)), sight: acc.map(a => avg(a, 3)) });
    if (this.history.length > 480) this.history.shift();
  }
  counts() { const n = new Array(NK).fill(0); for (const c of this.creatures) if (!c.dead) n[c.k]++; return n; }
  topLineages(n = 6) { return [...this.lineages.values()].filter(l => l.count > 0).sort((a, b) => b.count - a.count).slice(0, n); }

  // ----- intelligence -----
  // Runs a dozen grown-up members of species k through the arenas and compares them with random brains.
  measureIQ(k, quiet) {
    const pop = this.creatures.filter(c => c.k === k && c.age > 200);
    if (pop.length < 3) return;
    const n = Math.min(12, pop.length), step = pop.length / n;
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) { const c = pop[Math.floor(i * step)]; for (const a of TRIAL_ARENAS) { sum += trial(c.brain, k, a); cnt++; } }
    const score = sum / cnt, base = baseline(k), ratio = score / Math.max(0.5, base);
    this.iq[k] = { t: this.T, score: +score.toFixed(2), base: +base.toFixed(2), ratio: +ratio.toFixed(2) };
    if (quiet) return;
    const marks = [2, 3, 5, 10, 20, 40];
    const next = marks.findIndex(m => m > (this.iqMark[k] || 0));
    if (next >= 0 && ratio >= marks[next]) {
      let m = marks[next]; for (const x of marks) if (ratio >= x) m = x;
      this.iqMark[k] = m;
      const what = k === 1 ? 'catch' : k === 3 ? 'find' : 'find';
      const food = k === 1 ? 'prey' : k === 3 ? 'carrion' : k === 4 ? 'berries' : 'food';
      this.addLog(`Intelligence test: ${KINDS[k].plural.toLowerCase()} now ${what} ${m}× more ${food} than random brains.`, 'iq');
    }
  }
  recordIQ() {
    this.iqHistory.push({ t: this.T, r: this.iq.map(q => q ? q.ratio : null) });
    if (this.iqHistory.length > 240) this.iqHistory.shift();
  }
  // Do creatures call more when danger or food is near than when nothing is going on?
  summarizeCalls() {
    for (let k = 0; k < NK; k++) {
      const [cd, td, cf, tf, cn, tn] = this.lang[k];
      const base = (cn + 0.5) / (tn + 5);
      const rate = (cd + cf + cn) / Math.max(1, td + tf + tn);
      const alarm = td >= 150 ? ((cd + 0.5) / (td + 5)) / base : null;
      const food = tf >= 150 ? ((cf + 0.5) / (tf + 5)) / base : null;
      this.calls[k] = { t: this.T, rate: +rate.toFixed(3), alarm: alarm == null ? null : +alarm.toFixed(2), food: food == null ? null : +food.toFixed(2) };
      const K = KINDS[k], M = this.callMark[k], who = K.plural;
      M.alarmDays = alarm != null && alarm >= 2.5 && rate > 0.02 ? (M.alarmDays || 0) + 1 : 0;
      M.foodDays = food != null && food >= 2.5 && rate > 0.02 ? (M.foodDays || 0) + 1 : 0;
      if (M.alarmDays >= 2 && !M.alarm) {
        M.alarm = true;
        this.addLog(k === 1
          ? `${who} have started calling ${alarm.toFixed(1)}× more often when a bigger rival is near. A warning call is evolving.`
          : `${who} now call ${alarm.toFixed(1)}× more often when danger is near. An alarm call is evolving!`, 'lang');
      }
      if (M.foodDays >= 2 && !M.food) {
        M.food = true;
        this.addLog(`${who} now call ${food.toFixed(1)}× more often when ${k === 1 ? 'prey' : 'food'} is near. They are telling their kin where to ${k === 1 ? 'hunt' : 'eat'}.`, 'lang');
      }
      this.lang[k].fill(0);
    }
  }
  testBrain(id) {
    const c = this.creatures.find(x => x.id === id); if (!c) return null;
    let sum = 0; for (const a of TRIAL_ARENAS) sum += trial(c.brain, c.k, a);
    const score = sum / TRIAL_ARENAS.length, base = baseline(c.k);
    return { id, k: c.k, name: creatureName(id), score: +score.toFixed(1), base: +base.toFixed(1), ratio: +(score / Math.max(0.5, base)).toFixed(1) };
  }

  // ----- family tree -----
  family(id) {
    const a = this.anc.get(id); if (!a) return null;
    const living = new Set(this.creatures.map(c => c.id));
    const node = r => ({ id: r.id, k: r.k, g: r.g, hue: r.hue, alive: living.has(r.id), born: r.b, died: r.d, kids: r.kids, name: creatureName(r.id) });
    const ancestors = []; let p = a.p, guard = 0;
    while (p && guard++ < 5) { const r = this.anc.get(p); if (!r) { ancestors.push({ id: p, missing: true, name: creatureName(p) }); break; } ancestors.push(node(r)); p = r.p; }
    const byParent = new Map();
    for (const r of this.anc.values()) { if (!byParent.has(r.p)) byParent.set(r.p, []); byParent.get(r.p).push(r); }
    const children = (byParent.get(id) || []).map(r => {
      const gk = byParent.get(r.id) || [];
      return { ...node(r), grandkids: gk.length, grandAlive: gk.filter(x => living.has(x.id)).length };
    }).sort((x, y) => x.born - y.born);
    let descAlive = 0;
    for (const c of this.creatures) { let q = c.parent, gg = 0; while (q && gg++ < 80) { if (q === id) { descAlive++; break; } q = this.anc.get(q)?.p; } }
    const lin = this.lineages.get(a.lin);
    return { self: node(a), ancestors, children, kidsTotal: a.kids, descAlive, line: lin ? { name: lin.name, count: lin.count, born: lin.born } : null };
  }

  // ----- god tools -----
  seedPlants(x, y) {
    let added = 0;
    for (let i = 0; i < 80 && this.plants.length < MAX_PLANTS + 400; i++) {
      const a = this.rng.next() * Math.PI * 2, d = Math.sqrt(this.rng.next()) * 14;
      const px = wrap(x + Math.cos(a) * d, W), py = wrap(y + Math.sin(a) * d, H);
      if (!this.isWater(px, py)) { this.plants.push({ x: px, y: py, e: 0.8 + this.rng.next() * 0.5, dead: false }); added++; }
    }
    return added;
  }
  addCreatures(k, x, y, n) {
    if (!KINDS[k].flies && this.isWater(x, y)) return 0;
    for (let i = 0; i < n; i++) {
      const px = wrap(x + (this.rng.next() - .5) * 8, W), py = wrap(y + (this.rng.next() - .5) * 8, H);
      const ok = KINDS[k].flies || !this.isWater(px, py);
      this.spawnRandom(k, ok ? px : x, ok ? py : y);
    }
    return n;
  }

  // ----- champions: share a creature between worlds -----
  exportChampion(id) {
    const c = this.creatures.find(x => x.id === id); if (!c) return null;
    const data = { v: 1, k: c.k, size: +c.size.toFixed(3), spd: +c.spd.toFixed(3), sight: +c.sight.toFixed(3), hue: +c.hue.toFixed(1),
      gen: c.gen, name: creatureName(c.id), world: this.seed, w1: f2b(c.brain.w1), w2: f2b(c.brain.w2) };
    return 'BIO1.' + btoa(JSON.stringify(data));
  }
  static parseChampion(str) {
    const s = String(str).trim().replace(/\s+/g, '');
    if (!s.startsWith('BIO1.')) throw new Error('That is not a Biosphere champion code. It should start with BIO1.');
    let d;
    try { d = JSON.parse(atob(s.slice(5))); } catch (e) { throw new Error('This champion code is damaged. Copy it again in full.'); }
    if (d.v !== 1 || !(d.k >= 0 && d.k < NK)) throw new Error('This champion code is from a different version of Biosphere.');
    const brain = upgradeBrain(b2f(d.w1), b2f(d.w2));
    if (!brain) throw new Error('This champion has a brain shape this world cannot use.');
    return { ...d, brain };
  }
  importChampion(str) {
    const d = World.parseChampion(str);
    const [x, y] = this.randomLand();
    const lin = this.newLineage(d.k, d.hue, d.name.split('-')[0] + ' of ' + d.world);
    const base = { size: d.size, spd: d.spd, sight: d.sight, hue: d.hue, lin, gen: d.gen, e: 1.6 };
    const first = this.makeCreature(d.k, x, y, { ...base, brain: { w1: d.brain.w1, w2: d.brain.w2 } });
    this.creatures.push(first);
    for (let i = 0; i < 5; i++) {
      const c = this.makeCreature(d.k, wrap(x + (this.rng.next() - .5) * 8, W), wrap(y + (this.rng.next() - .5) * 8, H),
        { ...base, brain: { w1: mutateArr(this.rng, d.brain.w1, 0.5), w2: mutateArr(this.rng, d.brain.w2, 0.5) } });
      if (this.isWater(c.x, c.y) && !KINDS[d.k].flies) { c.x = x; c.y = y; }
      this.creatures.push(c);
    }
    this.addLog(`${d.name}, a ${KINDS[d.k].name.toLowerCase()} champion from the world "${d.world}", arrives with 5 offspring.`, 'event');
    this.emit('birth', x, y, d.k);
    return { id: first.id, name: d.name, kind: KINDS[d.k].name, world: d.world };
  }

  // ----- save / load -----
  toJSON() {
    const r3 = v => Math.round(v * 1000) / 1000;
    return {
      v: 4, seed: this.seed, rng: this.rng.s, T: this.T, nextId: this.nextId,
      creatures: this.creatures.map(c => [c.id, c.k, r3(c.x), r3(c.y), r3(c.a), r3(c.e), c.age, c.gen, r3(c.hue), r3(c.size), r3(c.spd), r3(c.sight), c.lin, c.parent, c.score, c.kids, r3(c.mem), c.born, f2b(c.brain.w1), f2b(c.brain.w2)]),
      plants: this.plants.map(p => [r3(p.x), r3(p.y), r3(p.e)]),
      corpses: this.corpses.map(d => [r3(d.x), r3(d.y), r3(d.e), d.t, d.k]),
      lineages: [...this.lineages.values()],
      anc: [...this.anc.values()].map(a => [a.id, a.p, a.k, a.g, a.b, a.d, a.kids, a.lin, Math.round(a.hue), a.s]),
      history: this.history, log: this.log, stats: this.stats, records: this.records,
      lastRescue: this.lastRescue, genMark: this.genMark,
      iq: this.iq, iqHistory: this.iqHistory, iqMark: this.iqMark, calls: this.calls, callMark: this.callMark,
      event: this.event, nextEventAt: this.nextEventAt, waterLevel: this.waterLevel, waterTarget: this.waterTarget, meteors: this.meteors,
      bonus: (() => { const o = []; const b = this.bonus; for (let i = 0; i < b.length; i++) if (b[i] > 0.01) o.push(i, Math.round(b[i] * 100)); return o; })(),
    };
  }
  static fromJSON(d) {
    if (!d || (d.v !== 3 && d.v !== 4)) throw new Error('Unsupported save');
    const w = new World(d.seed);
    w.rng = new RNG(d.rng); w.T = d.T; w.nextId = d.nextId;
    w.creatures = d.creatures.map(a => ({
      id: a[0], k: a[1], x: a[2], y: a[3], a: a[4], e: a[5], age: a[6], gen: a[7], hue: a[8], size: a[9], spd: a[10], sight: a[11],
      lin: a[12], parent: a[13], score: a[14], kids: a[15], mem: a[16], born: a[17], brain: upgradeBrain(b2f(a[18]), b2f(a[19])),
      inp: new Float32Array(N_IN), hid: new Float32Array(N_H), out: new Float32Array(N_OUT), dead: false, eaten: false, call: 0, heard: 0,
    }));
    w.plants = d.plants.map(a => ({ x: a[0], y: a[1], e: a[2], dead: false }));
    w.corpses = d.corpses.map(a => ({ x: a[0], y: a[1], e: a[2], t: a[3], k: a[4], dead: false }));
    w.lineages = new Map(d.lineages.map(l => [l.id, l]));
    w.anc = new Map(d.anc.map(a => [a[0], { id: a[0], p: a[1], k: a[2], g: a[3], b: a[4], d: a[5], kids: a[6], lin: a[7], hue: a[8], s: a[9] }]));
    w.history = d.history; w.log = d.log; w.stats = d.stats; w.records = d.records;
    w.lastRescue = d.lastRescue; w.genMark = d.genMark;
    if (d.iq) { w.iq = d.iq; w.iqHistory = d.iqHistory || []; w.iqMark = d.iqMark || w.iqMark; }
    if (d.calls) { w.calls = d.calls; w.callMark = d.callMark || w.callMark; }
    w.event = d.event; w.nextEventAt = d.nextEventAt; w.waterLevel = d.waterLevel; w.waterTarget = d.waterTarget; w.meteors = d.meteors || [];
    if (w.waterLevel) w.classify(w.waterLevel);
    if (Array.isArray(d.bonus)) for (let i = 0; i < d.bonus.length; i += 2) w.bonus[d.bonus[i]] = d.bonus[i + 1] / 100;
    return w;
  }
}
