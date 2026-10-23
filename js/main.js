// Wires the page together: the simulation runs in a worker, this file draws it and runs the interface.
import { KINDS, SEASONS, DAY, W, H, tdelta, randomSeed, cleanSeed } from './sim.js';
import { Renderer, kindCss, lineCss } from './render.js';
import { drawBrain, drawPopulation, drawTrait, drawIQ } from './charts.js';
import { writeSave, readSave, storageWorks } from './storage.js';
import { Ambience } from './audio.js';

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('en-US');
const days = t => { const d = t / DAY; return d < 10 ? d.toFixed(1) : fmt(d); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canSave = storageWorks();
let standalone = false; try { standalone = window.top === window && /^(https?|file):$/.test(location.protocol); } catch (e) {}

const renderer = new Renderer($('view'));
renderer.trails = !reduceMotion; renderer.effects = !reduceMotion;
const sound = new Ambience();

let frame = null, frameFresh = false, info = { history: [], log: [], counts: [] }, family = null;
let seed = '', follow = false, running = true, speed = 1, tool = 'inspect', tab = 'creature';
let lastSave = 0, diedNote = '', drawn = 0, catchingUp = false, logHead = null, lastSelId = 0, ready = false;

// ---------- the worker ----------
function makeWorker() {
  if (window.__BIO_WORKER_SRC) return new Worker(URL.createObjectURL(new Blob([window.__BIO_WORKER_SRC], { type: 'text/javascript' })));
  return new Worker('js/worker.js', { type: 'module' });
}
let worker;
try { worker = makeWorker(); } catch (e) { worker = null; }
const send = m => worker && worker.postMessage(m);
if (!worker) showLoading("This browser can't run Biosphere", 'Biosphere needs Web Workers, which this browser has turned off.');
else worker.onerror = e => { console.error(e); showLoading("Something went wrong", 'The simulation stopped unexpectedly. Reload the page to continue from your last save.'); };

worker && (worker.onmessage = e => {
  const m = e.data;
  switch (m.type) {
    case 'terrain': renderer.setTerrain({ typeArr: m.typeArr, height: m.height, moist: m.moist, fert: m.fert, waterVer: m.waterVer }); break;
    case 'water': renderer.setWater(m.typeArr, m.waterVer); break;
    case 'frame': frame = m; frameFresh = true; break;
    case 'info':
      if (m.history) info = { ...info, ...m, log: m.log || info.log };
      if (m.family !== undefined) family = m.family;
      if (m.seed) seed = m.seed;
      break;
    case 'died': diedNote = m.note; break;
    case 'ready':
      ready = true; hideLoading(); seed = m.seed; $('seed').value = seed;
      try { history.replaceState(null, '', '#' + seed); } catch (err) {}
      if (m.fresh) requestSave('new');
      if (m.fresh && !toured()) setTimeout(() => showTour(0), 600);
      if (!m.catchingUp) setTimeout(renderPanels, 50);
      break;
    case 'loadFailed':
      showLoading('Starting a new world', "Your saved world couldn't be opened, so a new one is growing.");
      send({ type: 'new', seed: randomSeed() });
      break;
    case 'catchupStart': startAway(m.away, m.total); break;
    case 'progress': $('away-bar').style.width = Math.min(100, (m.frac || m.done / m.total) * 100).toFixed(1) + '%';
      $('away-days').textContent = `${days(m.done)} of ${days(m.total)} days`; break;
    case 'caughtup': finishAway(m.summary); break;
    case 'saved': if (canSave) { lastSave = writeSave(m.json); } break;
    case 'picked': diedNote = ''; showPicked(m.name); break;
    case 'brainTest': {
      const r = m.result, el = $('iq-result'); el.hidden = false;
      if (!r) { el.textContent = 'This creature died before the test could run.'; break; }
      const unit = KINDS[r.k].score.toLowerCase();
      el.textContent = r.ratio >= 1.2
        ? `${r.name} scored ${r.score} ${unit} in the arenas. Random brains average ${r.base}, so this brain is ${r.ratio}× better.`
        : `${r.name} scored ${r.score} ${unit} in the arenas, about the same as a random brain (${r.base}). Its line still has some learning to do.`;
      break;
    }
    case 'champion':
      $('champ-out').hidden = false; $('champ-code').value = m.code;
      $('champ-note').textContent = `${m.name} is ready to travel. Send this code to a friend. In their world it arrives with five offspring.`;
      $('champ-save').hidden = !standalone;
      break;
    case 'imported':
      $('champ-msg').textContent = `${m.name}, a ${m.kind.toLowerCase()} from "${m.world}", has arrived. You're now watching it.`;
      $('champ-in').value = ''; follow = true; renderer.cam.zoom = Math.max(renderer.cam.zoom, 4); openTab('creature');
      break;
    case 'importFailed': $('champ-msg').textContent = m.reason; break;
    case 'toolResult':
      if (m.busy) $('hint').textContent = 'The sky is busy with another event. Try the meteor again once it ends.';
      else if (!m.ok) $('hint').textContent = 'That spot is water. Tap on land.';
      break;
    case 'error': console.error(m.reason); break;
  }
});

// ---------- overlays ----------
function showLoading(title, text) { $('loading').hidden = false; $('loading-title').textContent = title; $('loading-text').textContent = text; }
function hideLoading() { $('loading').hidden = true; }
function awayText(sec) {
  const m = sec / 60;
  if (m < 60) return `${Math.max(1, Math.round(m))} minute${Math.round(m) === 1 ? '' : 's'}`;
  const h = m / 60; if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
  return `${Math.round(h / 24)} days`;
}
function startAway(sec, total) {
  catchingUp = true;
  $('away').hidden = false; $('away-title').textContent = 'Welcome back';
  $('away-text').innerHTML = `You were away for <b>${awayText(sec)}</b>. Your world is fast-forwarding through that time now: <span id="away-days"></span>.`;
  $('away-progress').hidden = false; $('away-list').hidden = true;
  $('away-btn').textContent = 'Skip ahead'; $('away-btn').onclick = () => send({ type: 'skip' });
}
function finishAway(s) {
  catchingUp = false; diedNote = '';
  const g0 = s.genFrom, g1 = s.genTo;
  const best = g1.reduce((b, g, k) => g - g0[k] > g1[b] - g0[b] ? k : b, 0);
  $('away-title').textContent = `${days(s.ticks)} days went by`;
  $('away-text').innerHTML = `<b>${fmt(s.births)}</b> creatures were born and <b>${fmt(s.deaths)}</b> died. ` +
    `${KINDS[best].plural} evolved the most, from generation ${g0[best]} to <b>${g1[best]}</b>. ` +
    iqSentence(s) + `Now alive: ${s.counts.map((n, k) => `${n} ${KINDS[k].plural.toLowerCase()}`).join(', ')}.`;
  if (s.missed) $('away-text').innerHTML += ` To keep the wait short on this device, Biosphere replayed ${days(s.ticks)} of the ${days(s.missed)} days you were away.`;
  $('away-list').innerHTML = s.news.map(t => `<li>${esc(t)}</li>`).join('');
  $('away-list').hidden = !s.news.length; $('away-progress').hidden = true;
  $('away-btn').textContent = 'Continue'; $('away-btn').onclick = () => { $('away').hidden = true; };
  requestSave('caughtup'); renderPanels();
}
function iqSentence(s) {
  if (!s.iqTo) return '';
  let best = -1, gain = 0;
  s.iqTo.forEach((v, k) => { const a = (s.iqFrom && s.iqFrom[k]) || 1; if (v && v / a > gain) { gain = v / a; best = k; } });
  if (best < 0 || gain < 1.15) return '';
  const a = s.iqFrom && s.iqFrom[best];
  return `In the intelligence test, ${KINDS[best].plural.toLowerCase()} went ${a ? `from ${a.toFixed(1)}× ` : ''}to <b>${s.iqTo[best].toFixed(1)}×</b> better than random brains. `;
}
function ask(title, text, yesLabel, onYes) {
  $('ask').hidden = false; $('ask-title').textContent = title; $('ask-text').textContent = text; $('ask-yes').textContent = yesLabel;
  $('ask-yes').onclick = () => { $('ask').hidden = true; onYes(); };
  $('ask-no').onclick = () => { $('ask').hidden = true; };
  $('ask-no').focus();
}
const worldSummary = () => `Your current world "${seed}" is on day ${frame ? fmt(frame.day) : 1}. It will be gone for good.`;
function newWorld(s) {
  showLoading('Growing a new world', `Shaping land, water and the first creatures of "${s}".`);
  diedNote = ''; family = null; follow = false; renderer.cam = { x: W / 2, y: H / 2, zoom: 2 };
  send({ type: 'new', seed: s });
}
function requestSave(reason) { if (canSave && ready && !catchingUp) send({ type: 'save', reason }); }

// ---------- panels ----------
function renderHud() {
  if (!frame) return;
  const hours = (frame.T % DAY) / DAY * 24, hh = Math.floor(hours), mm = Math.floor((hours - hh) * 6) * 10;
  $('clock').textContent = `Day ${fmt(frame.day)} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  $('season').textContent = `${SEASONS[frame.season]} · year ${frame.year}`;
  const ev = frame.ev;
  $('event').hidden = !ev; if (ev) $('event').textContent = `${ev.name} · ${days(Math.max(0, ev.left))}d left`;
  const want = 60 * speed, slow = speed > 1 && running && !catchingUp && frame.tps < want * 0.8;
  $('rate').hidden = !slow; if (slow) $('rate').textContent = `max speed ${Math.max(1, Math.round(frame.tps / 60))}×`;
}
function setGene(id, v) { $('g-' + id).style.width = ((v - 0.5) / 1.2 * 100).toFixed(1) + '%'; $('v-' + id).textContent = v.toFixed(2) + '×'; }
function renderCreature(withBrain) {
  const c = frame && frame.sel;
  $('c-died').hidden = !diedNote; $('c-died').textContent = diedNote;
  if (!c) { $('c-name').textContent = 'No creature selected'; return; }
  const K = KINDS[c.k];
  $('c-kind').textContent = K.name; $('c-kind').style.color = kindCss(c.k);
  $('c-lin').textContent = c.line ? `${c.line.name} line · ${c.line.count} alive` : 'founder';
  $('c-name').textContent = c.name;
  $('c-gen').textContent = c.gen; $('c-age').textContent = days(c.age) + 'd';
  $('c-score-l').textContent = K.score; $('c-score').textContent = c.score; $('c-kids').textContent = c.kids;
  $('c-energy').style.width = Math.max(0, Math.min(100, c.e * 100)).toFixed(0) + '%';
  setGene('size', c.size); setGene('spd', c.spd); setGene('sight', c.sight);
  $('follow').setAttribute('aria-pressed', follow); $('follow').textContent = follow ? 'Following' : 'Follow';
  if (withBrain) drawBrain($('brain'), c);
  if (c.id !== lastSelId) { lastSelId = c.id; $('champ-out').hidden = true; $('iq-result').hidden = true; send({ type: 'family' }); }
}
function renderFamily() {
  const f = family;
  if (!f) { $('tree').innerHTML = ''; $('fam-sum').textContent = 'Select a creature to see its family.'; return; }
  const node = (n, cls, meta) => {
    const col = lineCss(n.k, n.hue);
    const status = n.alive ? 'alive' : `died day ${fmt(Math.floor(n.died / DAY) + 1)}`;
    const inner = `<span class="dot" style="color:${col}"></span><span class="nm">${esc(n.name)}<small>gen ${n.g} · ${status}</small></span><span class="meta">${meta || ''}</span>`;
    return n.alive && cls !== 'self'
      ? `<button type="button" class="node alive ${cls}" data-id="${n.id}" aria-label="Follow ${esc(n.name)}">${inner}</button>`
      : `<div class="node ${n.alive ? 'alive' : ''} ${cls}">${inner}</div>`;
  };
  let html = '';
  const anc = f.ancestors.slice().reverse();
  if (anc.length && anc[0].missing) html += `<div class="more">Earlier ancestors are lost to time.</div>`;
  for (const a of anc) if (!a.missing) html += node(a, 'stem', `${a.kids} kids`);
  html += node(f.self, 'self', `${f.kidsTotal} kids`);
  if (f.children.length) {
    html += '<div class="kids">' + f.children.slice(0, 24).map(ch => node(ch, '', ch.grandkids ? `${ch.grandkids} kids · ${ch.grandAlive} alive` : '')).join('') + '</div>';
    if (f.children.length > 24) html += `<div class="more">and ${f.children.length - 24} more children</div>`;
  } else html += `<div class="more">No children yet.</div>`;
  $('tree').innerHTML = html;
  const line = f.line ? ` of the ${f.line.name} line, which has ${f.line.count} alive and began on day ${fmt(Math.floor(f.line.born / DAY) + 1)}` : '';
  $('fam-sum').textContent = `${f.self.name} is generation ${f.self.g}${line}. Living descendants: ${f.descAlive}.`;
}
function renderCounts() {
  const n = info.counts || [];
  $('counts').innerHTML = KINDS.map((K, k) => `<span style="color:${kindCss(k)}"><b>${n[k] ?? 0}</b>${K.plural.toLowerCase()}</span>`).join('') +
    `<span style="color:var(--plant)"><b>${fmt(info.plants || 0)}</b>plants</span>`;
}
function renderIQ() {
  const iq = info.iq || [];
  $('iq-rows').innerHTML = KINDS.map((K, k) => {
    const q = iq[k];
    if (!q) return `<div class="iq-row"><span style="color:${kindCss(k)}">${K.plural}</span><span class="track"></span><span class="v">—</span><small>Too few adults to test right now.</small></div>`;
    const w = Math.max(3, Math.min(100, Math.log(Math.max(1, q.ratio)) / Math.log(30) * 100));
    return `<div class="iq-row"><span style="color:${kindCss(k)}">${K.plural}</span><span class="track"><b style="width:${w.toFixed(1)}%;background:${kindCss(k)}"></b></span><span class="v">${q.ratio.toFixed(1)}×</span><small>${q.score.toFixed(1)} ${K.score.toLowerCase()} per test, random brains ${q.base.toFixed(1)}</small></div>`;
  }).join('');
  drawIQ($('iq-chart'), info.iqHistory);
}
function renderWorldTab() {
  renderIQ();
  renderCounts();
  drawPopulation($('pop'), info.history || []);
  drawTrait($('tr-spd'), info.history || [], 'spd');
  drawTrait($('tr-size'), info.history || [], 'size');
  drawTrait($('tr-sight'), info.history || [], 'sight');
  $('lines').innerHTML = (info.lines || []).map(l => `<li><i style="background:${lineCss(l.k, l.hue)}"></i><span>${esc(l.name)} · ${KINDS[l.k].plural.toLowerCase()}</span><span>${l.count} alive</span></li>`).join('')
    || '<li><i></i><span>No lines yet</span><span></span></li>';
  const R = info.records, S = info.stats, row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  if (R && S) $('records').innerHTML =
    row('Oldest ever', R.oldest ? `${esc(R.oldest.name)}, ${days(R.oldest.age)} days` : '—') +
    row('Most children', R.mostKids ? `${esc(R.mostKids.name)}, ${R.mostKids.kids}` : '—') +
    KINDS.map((K, k) => row(`Top generation, ${K.plural.toLowerCase()}`, R.maxGen[k])).join('') +
    row('Born so far', fmt(S.births)) + row('Climate events', fmt(S.events)) + row('Predator clashes', fmt(S.fights)) +
    row('World age', `${days(info.T || 0)} days`);
  if (!canSave) $('save-msg').textContent = "This browser can't save, so your world resets when you close it.";
  else $('save-msg').textContent = lastSave ? `Saved in this browser ${Math.max(0, Math.round((Date.now() - lastSave) / 1000))}s ago.` : 'Not saved yet.';
}
function renderJournal() {
  if (!info.log || info.log[0] === logHead) return;
  logHead = info.log[0];
  $('journal').innerHTML = info.log.map(l => `<li class="${l.kind || ''}"><time>day ${fmt(Math.floor(l.t / DAY) + 1)}</time><span>${esc(l.msg)}</span></li>`).join('');
}
function renderPanels() {
  renderHud(); renderCreature(true);
  if (tab === 'family') renderFamily();
  if (tab === 'world') renderWorldTab();
  if (tab === 'journal') { logHead = null; renderJournal(); }
}
function showPicked(name) {
  if (matchMedia('(max-width: 960px)').matches) $('hint').textContent = `Showing ${name} below.`;
  if (tab !== 'creature' && tab !== 'family') openTab('creature');
}
function openTab(t) {
  tab = t;
  document.querySelectorAll('[role=tab]').forEach(x => { const on = x.id === 't-' + t; x.setAttribute('aria-selected', on); $('p-' + x.id.slice(2)).hidden = !on; });
  if (t === 'family') send({ type: 'family' });
  renderPanels();
}

// legend under the stage
$('legend').innerHTML = KINDS.map((K, k) => `<span><i style="background:${kindCss(k)}"></i>${K.plural}</span>`).join('') + '<span><i style="background:var(--plant)"></i>Plants</span><span><i style="background:#e8485c"></i>Berries</span>';

// ---------- main loop ----------
let lastPanel = 0, lastSlow = 0, lastSound = 0;
function loop(now) {
  if (frame && renderer.terrain) {
    if (follow && frame.sel) {
      renderer.cam.x += tdelta(renderer.cam.x, frame.sel.x, W) * 0.15; renderer.cam.y += tdelta(renderer.cam.y, frame.sel.y, H) * 0.15;
      renderer.clampCam();
    }
    if (frameFresh && sound.on && frame.fx.some(e => e.type === 'meteor')) sound.boom();
    renderer.draw(frame);
    if (frameFresh) { frameFresh = false; send({ type: 'ack' }); }
    drawn++;
    if (now - lastPanel > 100) { lastPanel = now; renderHud(); if (tab === 'creature') renderCreature(drawn % 2 === 0 || !running); }
    if (now - lastSlow > 700) {
      lastSlow = now;
      if (tab === 'world') renderWorldTab();
      if (tab === 'journal') renderJournal();
      if (tab === 'family') renderFamily();
    }
    if (now - lastSound > 250) { lastSound = now; sound.update(frame, ((info.counts || [])[4] || 0) / 50); }
    if (canSave && ready && !catchingUp && Date.now() - lastSave > 10000) { lastSave = Date.now(); requestSave('timer'); }
  }
  requestAnimationFrame(loop);
}

// ---------- controls ----------
$('play').onclick = () => { running = !running; $('play').textContent = running ? 'Pause' : 'Play'; send({ type: 'run', running }); };
document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => {
  speed = +b.dataset.speed; send({ type: 'speed', speed });
  document.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', x === b));
});
$('sound').onclick = () => {
  if (sound.on) sound.stop(); else if (!sound.start()) { $('hint').textContent = "This browser can't play generated sound."; return; }
  $('sound').textContent = sound.on ? 'Sound on' : 'Sound off'; $('sound').setAttribute('aria-pressed', sound.on);
};
const HINTS = {
  inspect: 'Tap a creature to open its brain. Drag to look around, pinch or scroll to zoom.',
  plants: 'Tap the land to scatter a grove of plants.',
  release: 'Pick a species, then tap the land to release a few newcomers with fresh random brains.',
  meteor: 'Tap anywhere to call down a meteor. Its crater turns into fertile ash.',
};
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
  tool = b.dataset.tool;
  document.querySelectorAll('[data-tool]').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('view').classList.toggle('tool', tool !== 'inspect');
  $('species').hidden = tool !== 'release';
  $('hint').textContent = HINTS[tool];
});
document.querySelectorAll('[role=tab]').forEach(b => b.onclick = () => openTab(b.id.slice(2)));
$('follow').onclick = () => { follow = !follow; if (follow && renderer.cam.zoom < 4) renderer.cam.zoom = 4; renderCreature(false); };
$('best').onclick = () => { diedNote = ''; send({ type: 'best', k: frame && frame.sel ? frame.sel.k : 0 }); };
$('zin').onclick = () => { const r = $('view').getBoundingClientRect(); renderer.zoomAt(r.width / 2, r.height / 2, 1.5); };
$('zout').onclick = () => { const r = $('view').getBoundingClientRect(); renderer.zoomAt(r.width / 2, r.height / 2, 1 / 1.5); };
$('tree').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) { diedNote = ''; send({ type: 'select', id: +b.dataset.id }); setTimeout(() => send({ type: 'family' }), 60); } });

// champions
$('test').onclick = () => { if (frame && frame.sel) { $('iq-result').hidden = false; $('iq-result').textContent = 'Running the arenas…'; send({ type: 'testBrain', id: frame.sel.id }); } };
$('export').onclick = () => { if (frame && frame.sel) send({ type: 'export', id: frame.sel.id }); };
$('champ-copy').onclick = () => {
  const t = $('champ-code').value;
  const fail = () => { $('champ-code').focus(); $('champ-code').select(); $('champ-note').textContent = 'Copy the selected code and send it to a friend.'; };
  try { navigator.clipboard.writeText(t).then(() => { $('champ-note').textContent = 'Champion code copied. Paste it into a friend\'s world under World → Release a champion.'; }, fail); } catch (e) { fail(); }
};
$('champ-save').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([$('champ-code').value], { type: 'text/plain' }));
  a.download = `biosphere-champion-${(frame && frame.sel ? frame.sel.name : 'creature').toLowerCase()}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
};
$('champ-release').onclick = () => {
  const code = $('champ-in').value.trim();
  if (!code) { $('champ-msg').textContent = 'Paste a champion code first, or open a champion file.'; return; }
  send({ type: 'import', code });
};
$('champ-file').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => { $('champ-in').value = String(r.result).trim(); $('champ-msg').textContent = `Loaded ${file.name}. Press Release champion.`; };
  r.readAsText(file);
};

// world code
$('new').onclick = () => ask('Start a new world?', worldSummary(), 'Start new world', () => newWorld(randomSeed()));
$('load').onclick = () => {
  const s = cleanSeed($('seed').value);
  if (!s) { $('seed-msg').textContent = 'Type a world code first, for example quiet-swamp-37.'; return; }
  if (s === seed) { $('seed-msg').textContent = "That's the world you're already in."; return; }
  ask(`Open "${s}"?`, worldSummary(), 'Open this world', () => newWorld(s));
};
$('seed').addEventListener('keydown', e => { if (e.key === 'Enter') $('load').click(); });
$('copy').onclick = () => {
  const link = standalone && location.protocol !== 'file:';
  const text = link ? location.origin + location.pathname + '#' + seed : seed;
  const ok = () => { $('seed-msg').textContent = (link ? 'Link copied: ' : 'Code copied: ') + text; };
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
  if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: renderer.cam.zoom }; moved = true; }
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
    if (moved) {
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
  if (!ready) return;
  const [x, y] = renderer.toWorld(px, py);
  if (tool === 'inspect') { send({ type: 'pick', x, y, reach: 14 / renderer.cam.zoom + 2 }); return; }
  send({ type: 'tool', tool: tool === 'release' ? $('species').value : tool, x, y });
}

// ---------- first-visit guide ----------
const TOUR = [
  { title: 'This is your world', text: 'Five species live here, and every creature starts with a tiny random brain. Nobody tells them what to do. The ones that find food have children, and their brains are passed on with small changes.', target: '.stage' },
  { title: 'Look inside a brain', text: 'Tap any creature to see its genes and watch its brain fire as it thinks. Press Follow to stay with it, and open Family to see its ancestors and children.', target: '#t-creature' },
  { title: 'Watch them get smarter', text: 'Every day, the World tab runs an intelligence test: today’s creatures race random brains through the same arenas. In a few days they find many times more food.', target: '#t-world' },
  { title: 'Shape it, then come back', text: 'Scatter plants, release new creatures or call down a meteor. Your world is saved in this browser and keeps evolving while you’re away, so come back tomorrow and see what happened.', target: '[aria-label="Tool"]' },
];
let tourAt = -1;
const tourDone = () => { try { localStorage.setItem('biosphere:toured', '1'); } catch (e) {} };
const toured = () => { try { return localStorage.getItem('biosphere:toured') === '1'; } catch (e) { return false; } };
function showTour(i) {
  document.querySelectorAll('.spot').forEach(e => e.classList.remove('spot'));
  if (i < 0 || i >= TOUR.length) { $('tour').hidden = true; tourAt = -1; tourDone(); return; }
  tourAt = i; const st = TOUR[i];
  $('tour').hidden = false;
  $('tour-step').textContent = `${i + 1} of ${TOUR.length}`;
  $('tour-title').textContent = st.title; $('tour-text').textContent = st.text;
  $('tour-next').textContent = i === TOUR.length - 1 ? 'Start exploring' : 'Next';
  $('tour-back').hidden = i === 0;
  const el = document.querySelector(st.target);
  if (el && st.target !== '.stage') { el.classList.add('spot'); if (matchMedia('(max-width: 700px)').matches) el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); }
  $('tour-next').focus({ preventScroll: true });
}
$('tour-next').onclick = () => showTour(tourAt + 1);
$('tour-back').onclick = () => showTour(tourAt - 1);
$('tour-skip').onclick = () => showTour(-1);
$('help').onclick = () => showTour(0);

// ---------- postcard ----------
async function makePostcard() {
  try { await Promise.all([document.fonts.load('700 64px "Pixelify Sans"'), document.fonts.load('500 22px "IBM Plex Mono"'), document.fonts.load('400 24px "Atkinson Hyperlegible"')]); } catch (e) {}
  const cw = 1200, ch = 675, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
  const s = 2.4, ox = cw / 2 - renderer.cam.x * s, oy = ch * 0.42 - renderer.cam.y * s;
  for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) x.drawImage(renderer.off, Math.round(ox + kx * W * s), Math.round(oy + ky * H * s), Math.ceil(W * s), Math.ceil(H * s));
  const g = x.createLinearGradient(0, ch * 0.38, 0, ch); g.addColorStop(0, 'rgba(10,18,15,0)'); g.addColorStop(0.45, 'rgba(10,18,15,0.88)'); g.addColorStop(1, 'rgba(10,18,15,0.97)');
  x.fillStyle = g; x.fillRect(0, 0, cw, ch);
  const L = 48;
  x.textBaseline = 'alphabetic';
  x.font = '700 64px "Pixelify Sans", monospace'; x.fillStyle = '#ebe5d3'; x.fillText('Bio', L, 440);
  const wBio = x.measureText('Bio').width; x.fillStyle = '#c2d86b'; x.fillText('sphere', L + wBio, 440);
  x.font = '500 22px "IBM Plex Mono", monospace'; x.fillStyle = '#c2d86b';
  const when = frame ? `Day ${fmt(frame.day)} · ${SEASONS[frame.season]} · year ${frame.year}` : '';
  x.fillText(`"${seed}"   ${when}`, L, 482);
  // species counts
  const n = info.counts || []; let cx = L;
  x.font = '500 21px "IBM Plex Mono", monospace';
  KINDS.forEach((K, k) => {
    x.fillStyle = kindCss(k); x.fillRect(cx, 516, 14, 14);
    const t = `${n[k] ?? 0} ${K.plural.toLowerCase()}`; x.fillStyle = '#ebe5d3'; x.fillText(t, cx + 22, 530); cx += x.measureText(t).width + 50;
  });
  // headline facts
  const iq = info.iq || []; let best = -1; iq.forEach((q, k) => { if (q && (best < 0 || q.ratio > iq[best].ratio)) best = k; });
  const line = (info.lines || [])[0];
  x.font = '400 24px "Atkinson Hyperlegible", sans-serif'; x.fillStyle = '#ebe5d3';
  const facts = [];
  if (best >= 0) facts.push(`${KINDS[best].plural} ${best === 1 ? 'catch' : 'find'} ${iq[best].ratio.toFixed(1)}× more ${best === 1 ? 'prey' : 'food'} than random brains`);
  if (line) facts.push(`the ${line.name} line rules the ${KINDS[line.k].plural.toLowerCase()}`);
  if (info.records) facts.push(`top generation ${Math.max(...info.records.maxGen)}`);
  while (facts.length > 1 && x.measureText(facts.join('  ·  ')).width > cw - L * 2) facts.pop();
  x.fillText(facts.join('  ·  '), L, 580);
  x.font = '500 18px "IBM Plex Mono", monospace'; x.fillStyle = '#93a399';
  x.fillText('Grow your own world: riccdev06.github.io/biosphere', L, 630);
  return cv;
}
let pcCanvas = null;
async function openPostcard() {
  $('postcard').hidden = false; $('pc-note').textContent = 'Painting your postcard…';
  pcCanvas = await makePostcard();
  $('pc-img').src = pcCanvas.toDataURL('image/png');
  const hosted = standalone && location.protocol !== 'file:';
  $('pc-save').hidden = !standalone;
  $('pc-share').hidden = true;
  if (hosted && navigator.canShare) pcCanvas.toBlob(b => {
    try { const f = new File([b], `biosphere-${seed}.png`, { type: 'image/png' }); if (navigator.canShare({ files: [f] })) { $('pc-share').hidden = false; $('pc-share').onclick = () => navigator.share({ files: [f], title: 'My Biosphere world', text: `My world "${seed}" on day ${frame ? frame.day : 1}` }).catch(() => {}); } } catch (e) {}
  });
  $('pc-note').textContent = standalone ? 'Save it or share it. The picture shows the world exactly as it looks right now.' : 'Press and hold, or right-click, the picture to save it.';
  $('pc-close').focus();
}
$('postcard-btn').onclick = openPostcard;
$('pc-again').onclick = openPostcard;
$('pc-close').onclick = () => { $('postcard').hidden = true; };
$('postcard').addEventListener('click', e => { if (e.target === $('postcard')) $('postcard').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('postcard').hidden = true; if (tourAt >= 0) showTour(-1); } });
$('pc-save').onclick = () => { const a = document.createElement('a'); a.href = $('pc-img').src; a.download = `biosphere-${seed}-day-${frame ? frame.day : 1}.png`; document.body.appendChild(a); a.click(); a.remove(); };

// ---------- start ----------
window.addEventListener('resize', () => { renderer.resize(); renderPanels(); });
new ResizeObserver(() => renderer.resize()).observe(view);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') requestSave('hidden'); });
window.addEventListener('pagehide', () => requestSave('pagehide'));

function start() {
  if (!worker) return;
  send({ type: 'fx', on: renderer.effects });
  const fromLink = cleanSeed(decodeURIComponent((location.hash || '').slice(1)));
  const saved = canSave ? readSave() : null;
  if (saved) {
    showLoading('Waking your world', 'Loading where you left off.');
    send({ type: 'load', json: saved.json, savedAt: saved.savedAt });
    lastSave = saved.savedAt;
    if (fromLink) {
      // a shared link points at a different world: offer it once the saved world is up
      const check = setInterval(() => {
        if (!ready) return; clearInterval(check);
        if (fromLink !== seed) ask(`Open "${fromLink}"?`, `Someone shared the world "${fromLink}" with you. ${worldSummary()}`, 'Open shared world', () => newWorld(fromLink));
      }, 200);
    }
  } else {
    newWorld(fromLink || randomSeed());
    $('loading-title').textContent = 'Growing your world';
  }
  requestAnimationFrame(loop);
}
start();
