// Keeps your world in this browser's localStorage. The simulation itself runs in a worker,
// so the page only ever stores and hands over the saved text.
const KEY = 'biosphere:world:v3';

export function writeSave(json) {
  try {
    localStorage.setItem(KEY, json);
    localStorage.setItem(KEY + ':at', String(Date.now()));
    localStorage.removeItem('biosphere:world:v2');   // older, smaller worlds can't be loaded any more
    return Date.now();
  } catch (e) { return 0; }
}

export function readSave() {
  try {
    const json = localStorage.getItem(KEY);
    if (!json) return null;
    return { json, savedAt: Number(localStorage.getItem(KEY + ':at')) || Date.now() };
  } catch (e) { return null; }
}

export function storageWorks() {
  try { localStorage.setItem(KEY + ':probe', '1'); localStorage.removeItem(KEY + ':probe'); return true; } catch (e) { return false; }
}
