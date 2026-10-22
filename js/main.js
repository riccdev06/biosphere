// Wires the simulation, renderer and interface together.
import { World, KINDS, SEASONS, DAY, creatureName, randomSeed, cleanSeed, tdelta, W, H } from './sim.js';
import { Renderer, creatureRgb } from './render.js';
import { drawBrain, drawPopulation, drawTrait } from './charts.js';
import { saveWorld, loadWorld, storageWorks } from './storage.js';

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('en-US');
const days = t => { const d = t / DAY; return d < 10 ? d.toFixed(1) : fmt(d); };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canSave = storageWorks();

const renderer = new Renderer($('view'));
renderer.trails = !reduceMotion; renderer.effects = !reduceMotion;

let world = null, selected = null, follow = false, running = true, speed = 1, tool = 'inspect';
let frame = 0, lastSave = 0, catchingUp = false, logHead = null, tab = 'creature', diedNote = '';

// ---------- world lifecycle ----------
function setWorld(w) {
  world = w; world.fxOn = renderer.effects;
  renderer.setWorld(w); renderer.cam = { x: W / 2, y: H / 2, zoom: 1 };
  selected = null; follow = false; diedNote = ''; logHead = null;
  pickMostEvolved(0);
  $('seed').value = w.seed;
  try { history.replaceState(null, '', '#' + w.seed); } catch (e) {}
  refreshAll();
}
function newWorld(seed) {
  showOverlayText('Growing a new world', `Shaping land, water and the first creatures of "${seed}".`);
  setTimeout(() => {
    setWorld(World.create(seed));
    lastSave = saveWorld(world);
    hideOverlay();
  }, 30);
}

// ---------- selection ----------
function pickMostEvolved(k) {
  const pool = world.creatures.filter(c => k == null || c.k === k);
  selected = (pool.length ? pool : world.creatures).reduce((b, c) => !b || c.gen * 10000 + c.age > b.gen * 10000 + b.age ? c : b, null);
}
function select(c) { selected = c; diedNote = ''; renderCreature(true); }
function checkSelected() {
  if (!selected || !selected.dead) return;
  const old = selected;
  diedNote = `${creatureName(old.id)} died at ${days(old.age)} days old, after ${old.kids} ${old.kids === 1 ? 'child' : 'children'}. Now watching a relative.`;
  const kin = world.creatures.filter(c => c.lin === old.lin);
  selected = kin.length ? kin.reduce((b, c) => (c.parent === old.id ? 1e9 : 0) + c.gen * 1000 + c.age > (b.parent === old.id ? 1e9 : 0) + b.gen * 1000 + b.age ? c : b) : null;
  if (!selected) pickMostEvolved(old.k);
}

// ---------- catching up after time away ----------
function awayText(ms) {
  const m = ms / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))} minute${Math.round(m) === 1 ? '' : 's'}`;
  const h = m / 60; if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
  return `${Math.round(h / 24)} days`;
}
function catchUp(savedAt) {
  const away = Date.now() - savedAt;
  const total = Math.min(20000, Math.floor(away / 1000));       // one tick per real second away, capped
  if (total < 240) { for (let i = 0; i < total; i++) world.tick(); return; }
  const before = { T: world.T, births: world.stats.births, deaths: world.stats.deaths, gen: [...world.records.maxGen], n: world.counts() };
  catchingUp = true; world.fxOn = false;
  $('away').hidden = false; $('away-title').textContent = 'Welcome back';
  $('away-text').innerHTML = `You were away for <b>${awayText(away)}</b>. Your world is living through that time now.`;
  $('away-progress').hidden = false; $('away-list').hidden = true;
  $('away-btn').textContent = 'Skip ahead'; $('away-btn').hidden = false;
  let done = 0, stop = false;
  $('away-btn').onclick = () => { stop = true; };
  const step = () => {
    const t0 = performance.now();
    while (done < total && !stop && performance.now() - t0 < 40) { world.tick(); done++; }
    $('away-bar').style.width = (done / total * 100).toFixed(1) + '%';
    if (done < total && !stop) { requestAnimationFrame(step); renderer.draw(world, null); return; }
    finishCatchUp(before, done);
  };
  requestAnimationFrame(step);
}
function finishCatchUp(b, ticks) {
  catchingUp = false; world.fxOn = renderer.effects;
  if (!selected || selected.dead) pickMostEvolved(0);
  diedNote = '';
  const n = world.counts(), g = world.records.maxGen;
  $('away-title').textContent = `${days(ticks)} days went by`;
  $('away-text').innerHTML = `<b>${fmt(world.stats.births - b.births)}</b> creatures were born and <b>${fmt(world.stats.deaths - b.deaths)}</b> died. ` +
    `Herbivores reached generation <b>${g[0]}</b>${g[0] > b.gen[0] ? ` (from ${b.gen[0]})` : ''}, predators <b>${g[1]}</b>. ` +
    `Now: ${n[0]} herbivores and ${n[1]} predators.`;
  const news = world.log.filter(l => l.t > b.T).slice(0, 8);
  $('away-list').innerHTML = news.map(l => `<li>${l.msg}</li>`).join('');
  $('away-list').hidden = !news.length; $('away-progress').hidden = true;
  $('away-btn').textContent = 'Continue';
  $('away-btn').onclick = hideOverlay;
  lastSave = saveWorld(world);
  refreshAll();
}
function showOverlayText(title, text) {
  $('away').hidden = false; $('away-title').textContent = title; $('away-text').textContent = text;
  $('away-progress').hidden = true; $('away-list').hidden = true; $('away-btn').hidden = true;
}
function hideOverlay() { $('away').hidden = true; $('away-btn').hidden = false; }

// ---------- in-page confirmation ----------
function ask(title, text, yesLabel, onYes) {
  $('ask').hidden = false; $('ask-title').textContent = title; $('ask-text').textContent = text; $('ask-yes').textContent = yesLabel;
  $('ask-yes').onclick = () => { $('ask').hidden = true; onYes(); };
  $('ask-no').onclick = () => { $('ask').hidden = true; };
  $('ask-no').focus();
}
const worldSummary = () => `Your current world "${world.seed}" is on day ${world.day}, with herbivores at generation ${world.records.maxGen[0]}. It will be gone for good.`;

// ---------- interface rendering ----------
function renderHud() {
  const hours = (world.T % DAY) / DAY * 24, hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60 / 10) * 10;
  $('clock').textContent = `Day ${fmt(world.day)} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  $('season').textContent = `${SEASONS[world.season]} · year ${world.year}`;
}
function setGene(id, v) { $('g-' + id).style.width = ((v - 0.5) / 1.2 * 100).toFixed(1) + '%'; $('v-' + id).textContent = v.toFixed(2) + '×'; }
function renderCreature(withBrain) {
  const c = selected;
  $('c-died').hidden = !diedNote; $('c-died').textContent = diedNote;
  if (!c) { $('c-name').textContent = 'No creatures'; return; }
  const K = KINDS[c.k], rgb = creatureRgb(c), lin = world.lineages.get(c.lin);
  $('c-kind').textContent = K.name; $('c-kind').style.color = `rgb(${rgb})`;
  $('c-lin').textContent = lin ? `${lin.name} line · ${lin.count} alive` : 'founder';
  $('c-name').textContent = creatureName(c.id);
  $('c-gen').textContent = c.gen; $('c-age').textContent = days(c.age) + 'd';
  $('c-score-l').textContent = K.score; $('c-score').textContent = c.score; $('c-kids').textContent = c.kids;
  $('c-energy').style.width = Math.max(0, Math.min(100, c.e / world.maxE(c) * 100)).toFixed(0) + '%';
  setGene('size', c.size); setGene('spd', c.spd); setGene('sight', c.sight);
  $('follow').setAttribute('aria-pressed', follow); $('follow').textContent = follow ? 'Following' : 'Follow';
  if (withBrain) drawBrain($('brain'), c);
}
function renderWorldTab() {
  const n = world.counts();
  $('n-h').textContent = n[0]; $('n-c').textContent = n[1]; $('n-p').textContent = world.plants.length;
  drawPopulation($('pop'), world.history);
  drawTrait($('tr-spd'), world.history, 'hs', 'cs');
  drawTrait($('tr-size'), world.history, 'hz', 'cz');
  drawTrait($('tr-sight'), world.history, 'hv', 'cv');
  const lines = [...world.topLineages(0, 3), ...world.topLineages(1, 2)];
  $('lines').innerHTML = lines.map(l => {
    const col = l.k ? `hsl(${l.hue},86%,64%)` : `hsl(${l.hue},58%,72%)`;
    return `<li><i style="background:${col}"></i><span>${l.name} · ${KINDS[l.k].plural.toLowerCase()}</span><span>${l.count} alive</span></li>`;
  }).join('') || '<li><i></i><span>No lines yet</span><span></span></li>';
  const R = world.records, row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  $('records').innerHTML =
    row('Oldest ever', R.oldest ? `${R.oldest.name}, ${days(R.oldest.age)} days` : '—') +
    row('Most children', R.mostKids ? `${R.mostKids.name}, ${R.mostKids.kids}` : '—') +
    row('Highest generation', `${R.maxGen[0]} herb · ${R.maxGen[1]} pred`) +
    row('Born so far', fmt(world.stats.births)) +
    row('World age', `${days(world.T)} days`);
  if (!canSave) $('save-msg').textContent = "This browser can't save, so your world resets when you close it.";
  else $('save-msg').textContent = lastSave ? `Saved in this browser ${Math.max(0, Math.round((Date.now() - lastSave) / 1000))}s ago.` : 'Not saved yet.';
}
function renderJournal() {
  if (world.log[0] === logHead) return;
  logHead = world.log[0];
  $('journal').innerHTML = world.log.map(l => `<li><time>day ${fmt(Math.floor(l.t / DAY) + 1)}</time><span>${l.msg}</span></li>`).join('');
}
function refreshAll() { renderHud(); renderCreature(true); renderWorldTab(); renderJournal(); }

// ---------- main loop ----------
function loop() {
  if (!catchingUp && world) {
    if (running) for (let i = 0; i < speed; i++) world.tick();
    checkSelected();
    if (follow && selected) {
      const k = 0.15;
      renderer.cam.x += tdelta(renderer.cam.x, selected.x, W) * k; renderer.cam.y += tdelta(renderer.cam.y, selected.y, H) * k;
      renderer.clampCam();
    }
    renderer.draw(world, selected);
    frame++;
    if (frame % 6 === 0) { renderHud(); if (tab === 'creature') renderCreature(frame % 12 === 0 || !running); }
    if (frame % 45 === 0) { if (tab === 'world') renderWorldTab(); if (tab === 'journal') renderJournal(); }
    if (canSave && Date.now() - lastSave > 15000) lastSave = saveWorld(world);
  }
  requestAnimationFrame(loop);
}

// ---------- controls ----------
function syncPlay() { $('play').textContent = running ? 'Pause' : 'Play'; }
$('play').onclick = () => { running = !running; syncPlay(); };
document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => {
  speed = +b.dataset.speed;
  document.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', x === b));
});
const HINTS = {
  inspect: 'Tap a creature to open its brain. Drag to look around, pinch or scroll to zoom.',
  plants: 'Tap the land to scatter a grove of plants.',
  herb: 'Tap the land to release a small herd of new herbivores with fresh random brains.',
  carn: 'Tap the land to release a small pack of new predators with fresh random brains.',
};
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
  tool = b.dataset.tool;
  document.querySelectorAll('[data-tool]').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('view').classList.toggle('tool', tool !== 'inspect');
  $('hint').textContent = HINTS[tool];
});
document.querySelectorAll('[role=tab]').forEach(b => b.onclick = () => {
  tab = b.id.slice(2);
  document.querySelectorAll('[role=tab]').forEach(x => { const on = x === b; x.setAttribute('aria-selected', on); $('p-' + x.id.slice(2)).hidden = !on; });
  if (tab === 'world') renderWorldTab(); if (tab === 'journal') { logHead = null; renderJournal(); } if (tab === 'creature') renderCreature(true);
});
$('follow').onclick = () => { follow = !follow; if (follow && renderer.cam.zoom < 3) renderer.cam.zoom = 3; renderCreature(false); };
$('best').onclick = () => { pickMostEvolved(selected ? selected.k : 0); diedNote = ''; renderCreature(true); };
$('zin').onclick = () => { const r = $('view').getBoundingClientRect(); renderer.zoomAt(r.width / 2, r.height / 2, 1.5); };
$('zout').onclick = () => { const r = $('view').getBoundingClientRect(); renderer.zoomAt(r.width / 2, r.height / 2, 1 / 1.5); };

$('new').onclick = () => ask('Start a new world?', worldSummary(), 'Start new world', () => newWorld(randomSeed()));
$('load').onclick = () => {
  const s = cleanSeed($('seed').value);
  if (!s) { $('seed-msg').textContent = 'Type a world code first, for example quiet-swamp-37.'; return; }
  if (s === world.seed) { $('seed-msg').textContent = "That's the world you're already in."; return; }
  ask(`Open "${s}"?`, worldSummary(), 'Open this world', () => newWorld(s));
};
$('seed').addEventListener('keydown', e => { if (e.key === 'Enter') $('load').click(); });
$('copy').onclick = () => {
  let standalone = false; try { standalone = window.top === window && /^https?:$/.test(location.protocol); } catch (e) {}
  const text = standalone ? location.origin + location.pathname + '#' + world.seed : world.seed;
  const ok = () => { $('seed-msg').textContent = (standalone ? 'Link copied: ' : 'Code copied: ') + text; };
  const fail = () => { $('seed').focus(); $('seed').select(); $('seed-msg').textContent = 'Copy the selected code and send it to a friend.'; };
  try { navigator.clipboard.writeText(text).then(ok, fail); } catch (e) { fail(); }
};

// ---------- pointer: tap, drag, pinch, wheel ----------
const view = $('view'), pts = new Map();
let drag = null, pinch = null, moved = false;
const local = e => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
view.addEventListener('pointerdown', e => {
  view.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e));
  if (pts.size === 1) { const p = local(e); drag = { x: p.x, y: p.y, cx: renderer.cam.x, cy: renderer.cam.y }; moved = false; }
  if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: renderer.cam.zoom }; moved = true; }
});
view.addEventListener('pointermove', e => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, local(e));
  if (pinch && pts.size >= 2) {
    const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    renderer.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.zoom * d / pinch.d) / renderer.cam.zoom);
  } else if (drag) {
    const p = local(e), dx = p.x - drag.x, dy = p.y - drag.y;
    if (!moved && Math.hypot(dx, dy) > 6) moved = true;
    if (moved && renderer.cam.zoom > 1.01) {
      const s = renderer.scale / renderer.dpr;
      renderer.cam.x = drag.cx - dx / s; renderer.cam.y = drag.cy - dy / s; renderer.clampCam(); follow = false;
    }
  }
});
const end = e => {
  if (!pts.has(e.pointerId)) return;
  const p = pts.get(e.pointerId);
  if (!moved && pts.size === 1) tap(p.x, p.y);
  pts.delete(e.pointerId);
  if (pts.size < 2) pinch = null;
  if (pts.size === 1) { const q = [...pts.values()][0]; drag = { x: q.x, y: q.y, cx: renderer.cam.x, cy: renderer.cam.y }; }
  if (pts.size === 0) drag = null;
};
view.addEventListener('pointerup', end);
view.addEventListener('pointercancel', e => { moved = true; end(e); });
view.addEventListener('wheel', e => { e.preventDefault(); const p = local(e); renderer.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

function tap(px, py) {
  const [x, y] = renderer.toWorld(px, py);
  if (tool === 'inspect') {
    const reach = 12 / renderer.cam.zoom + 2;
    let best = null, bd = reach * reach;
    for (const c of world.creatures) { const dx = tdelta(x, c.x, W), dy = tdelta(y, c.y, H), d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; } }
    if (best) {
      select(best);
      if (tab !== 'creature') $('t-creature').click();
      if (matchMedia('(max-width: 960px)').matches) $('hint').textContent = `Showing ${creatureName(best.id)} below.`;
    }
    return;
  }
  if (world.isWater(x, y)) { $('hint').textContent = 'That spot is water. Tap on land.'; return; }
  if (tool === 'plants') { world.seedPlants(x, y); world.addLog('You scattered a grove of plants.'); }
  if (tool === 'herb') { world.addCreatures(0, x, y, 6); world.addLog('You released a herd of 6 herbivores.'); }
  if (tool === 'carn') { world.addCreatures(1, x, y, 3); world.addLog('You released a pack of 3 predators.'); }
  world.emit('birth', x, y, tool === 'carn' ? 1 : 0);
}

// ---------- start ----------
window.addEventListener('resize', () => { renderer.resize(); if (world) refreshAll(); });
new ResizeObserver(() => renderer.resize()).observe(view);
const save = () => { if (world && !catchingUp && canSave) lastSave = saveWorld(world); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
window.addEventListener('pagehide', save);

function start() {
  const fromLink = cleanSeed(decodeURIComponent((location.hash || '').slice(1)));
  const saved = canSave ? loadWorld() : null;
  if (saved) {
    setWorld(saved.world); lastSave = saved.savedAt;
    catchUp(saved.savedAt);
    if (fromLink && fromLink !== saved.world.seed) {
      ask(`Open "${fromLink}"?`, `Someone shared the world "${fromLink}" with you. ${worldSummary()}`, 'Open shared world', () => newWorld(fromLink));
      try { history.replaceState(null, '', '#' + saved.world.seed); } catch (e) {}
    }
  } else {
    newWorld(fromLink || randomSeed());
  }
  syncPlay();
  requestAnimationFrame(loop);
}
start();
