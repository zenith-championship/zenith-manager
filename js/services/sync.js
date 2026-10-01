// ============================================================
// SYNC SERVICE — Auto-publicación con umbral doble + backups
// ============================================================
import { getSupabase, publishToSupabase } from './supabase.js';
import { getRawDB, exportBackup } from './storage.js';

const STORAGE_KEYS = {
  CHANGES_COUNT: 'ZENITH_CHANGES_COUNT',
  AUTO_SYNC_ENABLED: 'ZENITH_AUTO_SYNC_ENABLED',
  BACKUP_BEFORE: 'ZENITH_BACKUP_BEFORE_PUBLISH',
  LAST_PUBLISH: 'ZENITH_LAST_PUBLISH'
};

const DEFAULTS = {
  changesThreshold: 5,
  secondsThreshold: 60,
  enabled: false,
  backupBefore: true
};

let _changeCount = 0;
let _timer = null;
let _publishing = false;
let _lastFailureAt = 0;

// ============================================================
// ESTADO
// ============================================================
export function getSyncState() {
  return {
    changeCount: _changeCount,
    autoSyncEnabled: isAutoSyncEnabled(),
    backupBefore: isBackupEnabled(),
    lastPublish: getLastPublish(),
    publishing: _publishing
  };
}

export function isAutoSyncEnabled() {
  const v = localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED);
  if (v === null) return DEFAULTS.enabled;
  return v === 'true';
}

export function setAutoSyncEnabled(enabled) {
  localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED, enabled ? 'true' : 'false');
  if (enabled && _changeCount > 0) {
    schedulePublish();
  } else if (!enabled) {
    cancelTimer();
  }
}

export function isBackupEnabled() {
  const v = localStorage.getItem(STORAGE_KEYS.BACKUP_BEFORE);
  if (v === null) return DEFAULTS.backupBefore;
  return v === 'true';
}

export function setBackupEnabled(enabled) {
  localStorage.setItem(STORAGE_KEYS.BACKUP_BEFORE, enabled ? 'true' : 'false');
}

export function getLastPublish() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LAST_PUBLISH);
    return raw ? JSON.parse(raw) : null;
  } catch(_) { return null; }
}

function setLastPublish(info) {
  localStorage.setItem(STORAGE_KEYS.LAST_PUBLISH, JSON.stringify(info));
}

function loadChangeCount() {
  const v = parseInt(localStorage.getItem(STORAGE_KEYS.CHANGES_COUNT) || '0', 10);
  _changeCount = isNaN(v) ? 0 : v;
}

function saveChangeCount() {
  localStorage.setItem(STORAGE_KEYS.CHANGES_COUNT, String(_changeCount));
}

function resetChangeCount() {
  _changeCount = 0;
  saveChangeCount();
}

function cancelTimer() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

// ============================================================
// HOOK: llamado por storage.mutate()
// ============================================================
export function notifyChange() {
  loadChangeCount();
  _changeCount++;
  saveChangeCount();

  if (!isAutoSyncEnabled()) return;

  // Si el contador llegó al umbral → publicar YA
  if (_changeCount >= DEFAULTS.changesThreshold) {
    triggerPublish('threshold');
    return;
  }

  // Si no, programar por tiempo
  schedulePublish();
}

function schedulePublish() {
  cancelTimer();
  _timer = setTimeout(() => {
    if (_changeCount > 0) triggerPublish('time');
  }, DEFAULTS.secondsThreshold * 1000);
}

async function triggerPublish(reason) {
  if (_publishing) return;
  if (Date.now() - _lastFailureAt < 30000) return; // cooldown tras fallo

  cancelTimer();
  _publishing = true;

  try {
    // 1. ¿Autenticado?
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      console.warn('[SYNC] Auto-sync saltado: no autenticado');
      _publishing = false;
      return;
    }

    // 2. ¿Modo lectura?
    const db = getRawDB();
    if (db?.viewSeasonId) {
      console.warn('[SYNC] Auto-sync saltado: modo lectura activo');
      _publishing = false;
      return;
    }

    // 3. Backup automático
    if (isBackupEnabled()) {
      try {
        exportBackup();
        console.log('[SYNC] Backup automático descargado');
      } catch(e) {
        console.warn('[SYNC] No se pudo descargar backup:', e);
      }
    }

    // 4. Publicar
    const result = await publishToSupabase();
    resetChangeCount();
    setLastPublish({
      at: result.publishedAt,
      elapsed: result.elapsed,
      stats: result.stats,
      reason
    });
    console.log(`[SYNC] Auto-publicado (${reason}) en ${result.elapsed}s`, result.stats);
    window.dispatchEvent(new CustomEvent('zenith:published', { detail: result }));

  } catch(err) {
    console.error('[SYNC] Error en auto-publicación:', err);
    _lastFailureAt = Date.now();
    window.dispatchEvent(new CustomEvent('zenith:publish-failed', { detail: err }));
  } finally {
    _publishing = false;
  }
}

// ============================================================
// PUBLICACIÓN MANUAL (forzar)
// ============================================================
export async function publishNow() {
  cancelTimer();
  await triggerPublish('manual');
}

// ============================================================
// INIT
// ============================================================
export function initSync() {
  loadChangeCount();
  console.log('[SYNC] Inicializado. Cambios pendientes:', _changeCount);
}