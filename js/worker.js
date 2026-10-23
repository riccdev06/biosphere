// Runs the simulation in a background thread and streams snapshots to the page.
import { World, KINDS, DAY, creatureName, EVENTS, tdelta, W, H, CARRION_T } from './sim.js';

let world = null, running = true, speed = 1, selId = 0, fxOn = true;
let lastStep = 0, carry = 0, frameReady = true, lastInfo = 0, lastFamily = 0, lastLog = null, lastWater = -1;
let catchup = null, tpsMeasured = 60, tickCount = 0, tickClock = 0;

const post = (msg, transfer) => postMessage(msg, transfer || []);

function sendTerrain() {
  lastWater = world.waterVer;
  post({ type: 'terrain', W: world.type.length, typeArr: world.type.slice(), height: world.height, moist: world.moist, fert: world.fert, waterVer: world.waterVer });
}
function sendWater() {
  lastWater = world.waterVer;
  const t = world.type.slice();
  post({ type: 'water', typeArr: t, waterVer: world.waterVer }, [t.buffer]);
}

function selected() { return selId ? world.creatures.find(c => c.id === selId) || null : null; }
function pickMostEvolved(k) {
  let best = null;
  for (const c of world.creatures) if ((k == null || c.k === k) && (!best || c.gen * 10000 + c.age > best.gen * 10000 + best.age)) best = c;
  if (!best) for (const c of world.creatures) if (!best || c.gen > best.gen) best = c;
  selId = best ? best.id : 0; lastFamily = 0;
}
function checkSelected() {
  if (!selId) return;
  if (world.creatures.some(c => c.id === selId)) return;
  const a = world.anc.get(selId);
  const name = creatureName(selId);
  let next = null;
  if (a) {
    for (const c of world.creatures) if (c.parent === selId && (!next || c.age > next.age)) next = c;
    if (!next) for (const c of world.creatures) if (c.lin === a.lin && (!next || c.gen * 10000 + c.age > next.gen * 10000 + next.age)) next = c;
  }
  const note = a ? `${name} died at ${((a.d - a.b) / DAY).toFixed(1)} days old, after ${a.kids} ${a.kids === 1 ? 'child' : 'children'}.` + (next ? ` Now watching ${next.parent === selId ? 'its child' : 'a relative'}, ${creatureName(next.id)}.` : '') : '';
  if (next) { selId = next.id; lastFamily = 0; } else pickMostEvolved(a ? a.k : 0);
  if (note) post({ type: 'died', note });
}

function frame() {
  const n = world.creatures.length, cre = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    const c = world.creatures[i], o = i * 8;
    cre[o] = c.id; cre[o + 1] = c.k; cre[o + 2] = c.x; cre[o + 3] = c.y; cre[o + 4] = c.a; cre[o + 5] = c.size; cre[o + 6] = c.hue; cre[o + 7] = c.e / world.maxE(c);
  }
  const pl = new Float32Array(world.plants.length * 3);
  world.plants.forEach((p, i) => { pl[i * 3] = p.x; pl[i * 3 + 1] = p.y; pl[i * 3 + 2] = p.e; });
  const co = new Float32Array(world.corpses.length * 3);
  world.corpses.forEach((d, i) => { co[i * 3] = d.x; co[i * 3 + 1] = d.y; co[i * 3 + 2] = d.t / CARRION_T; });
  const s = selected();
  const sel = s ? {
    id: s.id, k: s.k, name: creatureName(s.id), gen: s.gen, age: s.age, score: s.score, kids: s.kids, e: s.e / world.maxE(s),
    size: s.size, spd: s.spd, sight: s.sight, x: s.x, y: s.y, R: world.sightR(s), lin: s.lin,
    line: world.lineages.get(s.lin) ? { name: world.lineages.get(s.lin).name, count: world.lineages.get(s.lin).count } : null,
    inp: Array.from(s.inp), hid: Array.from(s.hid), out: Array.from(s.out), w1: Array.from(s.brain.w1), w2: Array.from(s.brain.w2),
  } : null;
  const ev = world.event ? { type: world.event.type, name: EVENTS[world.event.type].name, left: world.event.end - world.T, x: world.event.x, y: world.event.y } : null;
  const fx = world.fx; world.fx = [];
  post({
    type: 'frame', T: world.T, season: world.season, dark: world.darkness, day: world.day, year: world.year, ev, sel, fx,
    meteors: world.meteors, cre, plants: pl, corpses: co, tps: tpsMeasured, catchup: catchup ? { done: catchup.done, total: catchup.total } : null,
  }, [cre.buffer, pl.buffer, co.buffer]);
  frameReady = false;
}

function info(force) {
  const now = Date.now();
  if (!force && now - lastInfo < 600) return;
  lastInfo = now;
  const head = world.log[0];
  const msg = {
    type: 'info', seed: world.seed, T: world.T, counts: world.counts(), plants: world.plants.length, history: world.history,
    lines: world.topLineages(8), records: world.records, stats: world.stats, iq: world.iq, iqHistory: world.iqHistory,
    log: head !== lastLog ? world.log : null,
  };
  lastLog = head;
  if (selId && (force || now - lastFamily > 1500)) { lastFamily = now; msg.family = world.family(selId); }
  post(msg);
}

function summaryFrom(b) {
  const news = world.log.filter(l => l.t > b.T).slice(0, 10).map(l => l.msg);
  return {
    ticks: world.T - b.T, births: world.stats.births - b.births, deaths: world.stats.deaths - b.deaths,
    genFrom: b.gen, genTo: world.records.maxGen.slice(), counts: world.counts(), news,
    iqFrom: b.iq, iqTo: world.iq.map(q => q ? q.ratio : null),
  };
}

function loop() {
  if (!world) { setTimeout(loop, 50); return; }
  const now = performance.now();
  if (catchup) {
    world.fxOn = false;
    const t0 = performance.now();
    if (!catchup.started) catchup.started = t0;
    while (catchup.done < catchup.total && !catchup.stop && performance.now() - t0 < 120) { world.tick(); catchup.done++; }
    // keep the wait under about 30 seconds on slower devices
    const spent = performance.now() - catchup.started;
    if (spent > 28000 && catchup.done < catchup.total) { catchup.fullTotal = catchup.total; catchup.stop = true; }
    catchup.frac = Math.max(catchup.done / catchup.total, spent / 28000);
    if (world.waterVer !== lastWater) sendWater();
    const nowc = performance.now();
    if (frameReady && nowc - (catchup.lastFrame || 0) > 200) { catchup.lastFrame = nowc; frame(); post({ type: 'progress', done: catchup.done, total: catchup.total, frac: catchup.frac }); }
    if (catchup.done >= catchup.total || catchup.stop) {
      const sum = summaryFrom(catchup.before); if (catchup.fullTotal) sum.missed = catchup.fullTotal; catchup = null; world.fxOn = fxOn;
      if (!selected()) pickMostEvolved(0);
      tpsMeasured = 60 * speed; tickCount = 0; tickClock = performance.now();
      post({ type: 'caughtup', summary: sum });
      info(true);
      lastStep = performance.now(); carry = 0;
    }
    setTimeout(loop, 0);
    return;
  }
  if (running) {
    const dt = Math.min(250, now - lastStep);
    carry += dt * 60 * speed / 1000;
    let n = Math.floor(carry); carry -= n;
    const t0 = performance.now();
    while (n-- > 0) {
      world.tick(); tickCount++;
      if (performance.now() - t0 > 45) { carry = 0; break; }   // falling behind: run as fast as we can
    }
  }
  lastStep = now;
  if (now - tickClock > 1000) { tpsMeasured = tickCount * 1000 / (now - tickClock || 1); tickCount = 0; tickClock = now; }
  checkSelected();
  if (world.waterVer !== lastWater) sendWater();
  if (frameReady) frame();
  info(false);
  setTimeout(loop, running ? 4 : 30);
}

function startCatchup(savedAt) {
  const away = Math.max(0, (Date.now() - savedAt) / 1000);
  // one step per second for the first 6 hours away, then one step every 3 seconds, up to 36,000 steps (15 world days)
  const total = Math.floor(Math.min(36000, Math.min(away, 21600) + Math.max(0, away - 21600) / 3));
  if (total < 240) { for (let i = 0; i < total; i++) world.tick(); return false; }
  catchup = { total, done: 0, stop: false, away,
    before: { T: world.T, births: world.stats.births, deaths: world.stats.deaths, gen: world.records.maxGen.slice(), iq: world.iq.map(q => q ? q.ratio : null) } };
  post({ type: 'catchupStart', total, away });
  return true;
}

onmessage = e => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'new':
        world = World.create(m.seed); world.fxOn = fxOn; catchup = null;
        pickMostEvolved(0); sendTerrain(); frameReady = true; frame(); info(true);
        post({ type: 'ready', seed: world.seed, fresh: true });
        break;
      case 'load': {
        let w;
        try { w = World.fromJSON(JSON.parse(m.json)); } catch (err) { post({ type: 'loadFailed', reason: String(err.message || err) }); break; }
        world = w; world.fxOn = fxOn;
        pickMostEvolved(0); sendTerrain();
        const long = startCatchup(m.savedAt);
        frameReady = true; frame(); info(true);
        post({ type: 'ready', seed: world.seed, fresh: false, catchingUp: long });
        break;
      }
      case 'ack': frameReady = true; break;
      case 'run': running = m.running; break;
      case 'speed': speed = m.speed; break;
      case 'fx': fxOn = m.on; if (world) world.fxOn = m.on; break;
      case 'skip': if (catchup) catchup.stop = true; break;
      case 'select': if (world.creatures.some(c => c.id === m.id)) { selId = m.id; lastFamily = 0; info(true); } break;
      case 'best': pickMostEvolved(m.k); info(true); break;
      case 'pick': {
        let best = null, bd = m.reach * m.reach;
        for (const c of world.creatures) {
          const dx = tdelta(m.x, c.x, W), dy = tdelta(m.y, c.y, H);
          const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; }
        }
        if (best) { selId = best.id; lastFamily = 0; info(true); post({ type: 'picked', id: best.id, name: creatureName(best.id) }); }
        break;
      }
      case 'tool': {
        const { tool, x, y } = m;
        let ok = true;
        if (tool === 'plants') { ok = world.seedPlants(x, y) > 0; if (ok) world.addLog('You scattered a grove of plants.'); }
        else if (tool === 'meteor') { if (world.event) ok = false; else world.startEvent('meteor', x, y); }
        else {
          const k = KINDS.findIndex(K => K.key === tool), n = k === 0 ? 8 : 4;
          ok = world.addCreatures(k, x, y, n) > 0;
          if (ok) { world.addLog(`You released ${n} ${KINDS[k].plural.toLowerCase()} with fresh random brains.`); world.emit('birth', x, y, k); }
        }
        post({ type: 'toolResult', tool, ok, busy: tool === 'meteor' && !ok });
        info(true);
        break;
      }
      case 'save': if (world) post({ type: 'saved', json: JSON.stringify(world.toJSON()), seed: world.seed, reason: m.reason }); break;
      case 'export': {
        const code = world.exportChampion(m.id || selId);
        post({ type: 'champion', code, name: creatureName(m.id || selId) });
        break;
      }
      case 'import': {
        try { const r = world.importChampion(m.code); selId = r.id; lastFamily = 0; post({ type: 'imported', ...r }); info(true); }
        catch (err) { post({ type: 'importFailed', reason: err.message }); }
        break;
      }
      case 'family': if (selId) post({ type: 'info', family: world.family(selId) }); break;
      case 'testBrain': post({ type: 'brainTest', result: world.testBrain(m.id || selId) }); break;
    }
  } catch (err) {
    post({ type: 'error', reason: String(err && err.stack || err) });
  }
};
lastStep = performance.now(); tickClock = lastStep;
loop();
