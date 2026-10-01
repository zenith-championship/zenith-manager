// ============================================================
// SYNC SERVICE — Sincronización en tiempo real con Supabase
// ============================================================
import { downloadAll, pushTables, subscribeRealtime, unsubscribeRealtime } from './supabase.js';

// Tablas que se sincronizan en tiempo real (cambios frecuentes)
const REALTIME_TABLES = new Set(['teams', 'players', 'matches', 'news']);

// Mapeo de tabla → key en la DB local
const TABLE_TO_KEY = {
  seasons: 'seasons',
  divisions: 'divisions',
  teams: 'teams',
  players: 'players',
  matches: 'matches',
  playoffs: 'playoffs',
  news: 'news',
  archived_seasons: 'archivedSeasons',
  config: 'config'
};

const PUSH_DEBOUNCE_MS = 2000;
const REALTIME_COOLDOWN_MS = 3000;

let _dirtyTables = new Set();
let _pushTimer = null;
let _isPushing = false;
let _lastPushAt = 0;
let _realtimeCooldownUntil = 0;
let _initialized = false;

// ============================================================
// HELPERS
// ============================================================
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h = h & h; // 32-bit
  }
  return (h >>> 0).toString(36);
}

function hashTable(data) {
  try {
    return hashString(JSON.stringify(data ?? null));
  } catch(_) {
    return 'err';
  }
}

// ============================================================
// DETECCIÓN DE CAMBIOS
// ============================================================
const _lastHashes = {};

export function captureHashes(db) {
  const newHashes = {};
  Object.entries(TABLE_TO_KEY).forEach(([table, key]) => {
    if (key === 'config') {
      const cfg = {
        config: db.config,
        widgets: db.widgets,
        trophies: db.trophies,
        transferLog: db.transferLog,
        transferBannerBg: db.transferBannerBg
      };
      newHashes[table] = hashTable(cfg);
    } else {
      newHashes[table] = hashTable(db[key]);
    }
  });
  return newHashes;
}

function detectDirtyTables(oldHashes, newHashes) {
  const dirty = [];
  for (const table of Object.keys(newHashes)) {
    if (oldHashes[table] !== newHashes[table]) {
      dirty.push(table);
    }
  }
  return dirty;
}

// ============================================================
// HOOK: Llamado por storage.mutate()
// ============================================================
export function notifyChange(oldHashes, newHashes) {
  const dirty = detectDirtyTables(oldHashes, newHashes);
  dirty.forEach(t => _dirtyTables.add(t));

  if (dirty.length > 0) {
    updateSyncChip('pending');
    schedulePush();
  }
}

function schedulePush() {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    doPush().catch(err => console.error('[SYNC] push error:', err));
  }, PUSH_DEBOUNCE_MS);
}

async function doPush() {
  if (_isPushing) return;
  if (_dirtyTables.size === 0) return;
  if (Date.now() < _realtimeCooldownUntil) {
    // Esperar un poco más para no chocar con realtime
    schedulePush();
    return;
  }

  _isPushing = true;
  updateSyncChip('syncing');

  const tablesToPush = [..._dirtyTables];
  _dirtyTables.clear();

  try {
    const result = await pushTables(tablesToPush);
    if (!result.ok) throw new Error(result.error || 'Push failed');

    _lastPushAt = Date.now();
    _realtimeCooldownUntil = Date.now() + REALTIME_COOLDOWN_MS;

    updateSyncChip('synced');
    console.log('[SYNC] Push OK:', result.stats);
    window.dispatchEvent(new CustomEvent('zenith:sync-pushed', { detail: result }));

  } catch(err) {
    console.error('[SYNC] Push failed:', err);
    // Re-marcar tablas como sucias para reintentar
    tablesToPush.forEach(t => _dirtyTables.add(t));
    updateSyncChip('error');
    setTimeout(() => schedulePush(), 5000);
  } finally {
    _isPushing = false;
  }
}

// ============================================================
// REALTIME: Cambios remotos
// ============================================================
let _realtimeDebounce = null;

function onRemoteChange(table) {
  // Ignorar si estamos en cooldown post-push (podría ser nuestro propio cambio)
  if (Date.now() < _realtimeCooldownUntil) {
    return;
  }
  // Ignorar si estamos en medio de un push
  if (_isPushing) return;

  console.log('[SYNC] Cambio remoto detectado en:', table);

  // Debounce para agrupar cambios
  if (_realtimeDebounce) clearTimeout(_realtimeDebounce);
  _realtimeDebounce = setTimeout(() => {
    pullFromRemote().catch(err => console.error('[SYNC] pull error:', err));
  }, 800);
}

async function pullFromRemote() {
  try {
    updateSyncChip('pulling');
    const remoteDB = await downloadAll();

    // Preservar preferencias locales (widgets por instancia, etc.)
    const localRaw = window.__zenithGetRawDB ? window.__zenithGetRawDB() : null;

    // Merge inteligente:
    // - Tablas de tiempo real: reemplazar
    // - Config: preservar widgets locales si existen
    const merged = {
      ...remoteDB,
      widgets: localRaw?.widgets || remoteDB.widgets,
      viewSeasonId: localRaw?.viewSeasonId || null
    };

    if (window.__zenithSetRawDB) {
      window.__zenithSetRawDB(merged);
    }

    // Resetear hashes (para no marcar como dirty)
    Object.assign(_lastHashes, captureHashes(merged));

    updateSyncChip('synced');
    window.dispatchEvent(new CustomEvent('zenith:sync-pulled'));

  } catch(err) {
    console.error('[SYNC] Pull failed:', err);
    updateSyncChip('error');
  }
}

// ============================================================
// CHIP DE ESTADO
// ============================================================
function updateSyncChip(state) {
  window.dispatchEvent(new CustomEvent('zenith:sync-chip', { detail: state }));
}

// ============================================================
// INIT
// ============================================================
export async function initRealtimeSync() {
  if (_initialized) return;
  _initialized = true;

  subscribeRealtime(onRemoteChange);

  // Resetear cooldown al boot
  _realtimeCooldownUntil = Date.now() + 1000;
  updateSyncChip('synced');

  // Actualizar chip cuando cambie la conexión
  window.addEventListener('online', () => updateSyncChip('online'));
  window.addEventListener('offline', () => updateSyncChip('offline'));
}

export function destroySync() {
  unsubscribeRealtime();
  _initialized = false;
}

// ============================================================
// FORZAR SYNC MANUAL (para debug/uso)
// ============================================================
export async function forcePull() {
  await pullFromRemote();
}

export async function forcePush() {
  Object.keys(TABLE_TO_KEY).forEach(t => _dirtyTables.add(t));
  await doPush();
}

// ============================================================
// STATE
// ============================================================
export function getSyncState() {
  return {
    dirtyCount: _dirtyTables.size,
    lastPushAt: _lastPushAt,
    isPushing: _isPushing,
    isOnline: navigator.onLine
  };
}

export function captureCurrentHashes() {
  const db = window.__zenithGetRawDB ? window.__zenithGetRawDB() : null;
  if (!db) return {};
  return captureHashes(db);
}