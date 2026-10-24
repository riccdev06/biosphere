// Tests for the simulation engine. Run with: npm test (or node --test test/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, KINDS, DAY, trial, baseline, cleanSeed, upgradeBrain, think, N_IN, N_H, N_OUT, RNG } from '../js/sim.js';

const run = (w, n) => { for (let i = 0; i < n; i++) w.tick(); return w; };

test('the same world code always grows the same world', () => {
  const a = run(World.create('test-valley-1', 100), 400);
  const b = run(World.create('test-valley-1', 100), 400);
  assert.deepEqual(Array.from(a.type.slice(0, 5000)), Array.from(b.type.slice(0, 5000)));
  assert.equal(a.creatures.length, b.creatures.length);
  assert.equal(a.creatures[10].x, b.creatures[10].x);
  const c = World.create('test-valley-2', 100);
  assert.notDeepEqual(Array.from(a.type.slice(0, 5000)), Array.from(c.type.slice(0, 5000)));
});

test('world codes are cleaned up', () => {
  assert.equal(cleanSeed('  Quiet Swamp!! 37 '), 'quiet-swamp-37');
  assert.equal(cleanSeed('---'), '');
});

test('a saved world loads back and keeps running', () => {
  const w = run(World.create('test-save', 200), 300);
  const json = JSON.stringify(w.toJSON());
  const back = World.fromJSON(JSON.parse(json));
  assert.equal(back.T, w.T);
  assert.equal(back.seed, w.seed);
  assert.equal(back.creatures.length, w.creatures.length);
  assert.deepEqual(back.counts(), w.counts());
  assert.equal(back.lineages.size, w.lineages.size);
  run(back, 200);
  assert.ok(back.creatures.length > 0);
  assert.throws(() => World.fromJSON({ v: 1 }));
});

test('every species has food, and nothing eats itself', () => {
  for (const K of KINDS) {
    assert.ok(K.plants > 0 || K.prey.length > 0 || K.carrion > 0, `${K.name} needs something to eat`);
    assert.ok(!K.prey.includes(KINDS.indexOf(K)), `${K.name} should not hunt its own kind`);
  }
});

test('champions travel between worlds', () => {
  const home = run(World.create('test-home', 200), 200);
  const c = home.creatures.find(x => x.k === 1) || home.creatures[0];
  const code = home.exportChampion(c.id);
  assert.match(code, /^BIO1\./);
  const away = World.create('test-away', 100);
  const before = away.creatures.length;
  const res = away.importChampion(code);
  assert.equal(away.creatures.length, before + 6);
  assert.equal(res.world, 'test-home');
  const arrived = away.creatures.find(x => x.id === res.id);
  assert.deepEqual(Array.from(arrived.brain.w1), Array.from(c.brain.w1));
  assert.throws(() => away.importChampion('hello'), /not a Biosphere champion/);
  assert.throws(() => away.importChampion('BIO1.@@@'), /damaged/);
});

test('the intelligence test is fair and repeatable', () => {
  const w = World.create('test-iq', 100);
  const c = w.creatures[0];
  assert.equal(trial(c.brain, c.k, 1), trial(c.brain, c.k, 1));
  for (let k = 0; k < KINDS.length; k++) {
    const b = baseline(k);
    assert.ok(b >= 0 && b < 6, `random ${KINDS[k].plural} should score low, got ${b}`);
  }
});

test('a meteor clears its crater and leaves fertile ground', () => {
  const w = World.create('test-meteor', 100);
  const [x, y] = w.randomLand();
  w.startEvent('meteor', x, y);
  const near = w.creatures.filter(c => Math.hypot(c.x - x, c.y - y) < 10);
  assert.equal(near.length, 0);
  assert.ok(w.bonus[(y | 0) * 640 + (x | 0)] > 0);
});

test('floods raise the water and droughts lower it', () => {
  const w = World.create('test-water', 50);
  const water = () => w.type.reduce((n, t) => n + (t <= 1 ? 1 : 0), 0);
  const normal = water();
  w.classify(1); const high = water();
  w.classify(-1); const low = water();
  assert.ok(high > normal && normal > low);
});

test('after four days, evolved brains beat random ones and every species is alive', { timeout: 180000 }, () => {
  const w = World.create('test-evolution');
  let rescues = 0; const orig = w.rescue.bind(w);
  w.rescue = function () { const b = this.stats.rescues; orig(); rescues += this.stats.rescues - b; };
  run(w, DAY * 4);
  const n = w.counts();
  KINDS.forEach((K, k) => assert.ok(n[k] > 0, `${K.plural} went extinct`));
  assert.ok(w.iq[0] && w.iq[0].ratio > 2, `herbivores should beat random brains by 2x, got ${w.iq[0] && w.iq[0].ratio}`);
  assert.ok(w.iq[1] && w.iq[1].ratio > 2, `predators should beat random brains by 2x, got ${w.iq[1] && w.iq[1].ratio}`);
  assert.ok(rescues < 15, `too many rescue migrations: ${rescues}`);
});

test('brains from before calls existed still think the same, and stay silent', () => {
  const r = new RNG(7), oldIn = 14, oldOut = 3;
  const w1 = Float32Array.from({ length: N_H * oldIn }, () => r.gauss()), w2 = Float32Array.from({ length: oldOut * (N_H + 1) }, () => r.gauss());
  const up = upgradeBrain(w1, w2);
  assert.equal(up.w1.length, N_H * N_IN); assert.equal(up.w2.length, N_OUT * (N_H + 1));
  const inp = Float32Array.from({ length: N_IN }, (_, i) => i < oldIn ? r.next() * 2 - 1 : 0.7);
  const hid = new Float32Array(N_H), out = new Float32Array(N_OUT);
  think(up, inp, hid, out);
  // the same brain computed by hand with the old shape
  const h2 = new Float32Array(N_H);
  for (let h = 0; h < N_H; h++) { let s = 0; for (let i = 0; i < oldIn; i++) s += w1[h * oldIn + i] * inp[i]; h2[h] = Math.tanh(s); }
  for (let o = 0; o < oldOut; o++) { let s = w2[o * (N_H + 1) + N_H]; for (let h = 0; h < N_H; h++) s += w2[o * (N_H + 1) + h] * h2[h]; assert.ok(Math.abs(Math.tanh(s) - out[o]) < 1e-5); }
  assert.ok(out[3] < 0.3, 'an upgraded brain should not call');
  assert.equal(upgradeBrain(new Float32Array(5), new Float32Array(5)), null);
});

test('creatures can call, and the world reports what calls mean', () => {
  const w = run(World.create('test-calls', 200), DAY + 10);
  assert.ok(w.calls.every(c => c && c.rate >= 0 && c.rate <= 1));
  const back = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.deepEqual(back.calls, w.calls);
});
