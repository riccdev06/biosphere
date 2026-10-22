// Keeps your world in this browser's localStorage.
import { World } from './sim.js';

const KEY = 'biosphere:world:v2';

export function saveWorld(world) {
  try {
    const data = world.toJSON();
    data.savedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(data));
    return data.savedAt;
  } catch (e) { return 0; }
}

export function loadWorld() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return { world: World.fromJSON(data), savedAt: data.savedAt || Date.now() };
  } catch (e) { return null; }
}

export function storageWorks() {
  try { localStorage.setItem(KEY + ':probe', '1'); localStorage.removeItem(KEY + ':probe'); return true; } catch (e) { return false; }
}
