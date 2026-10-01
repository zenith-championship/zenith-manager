// ============================================================
// SUPABASE SERVICE — Cliente + Publicación al visualizador
// ============================================================
import { getRawDB, exportBackup } from './storage.js';

let _client = null;

export function getSupabase() {
  if (!_client) {
    const cfg = window.ZENITH_SUPABASE_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      throw new Error('Falta configuración de Supabase en config.supabase.js');
    }
    if (!window.supabase) {
      throw new Error('SDK de Supabase no cargado. Revisa index.html.');
    }
    _client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        storageKey: 'ZENITH_AUTH_SESSION',
        persistSession: true,
        autoRefreshToken: true
      }
    });
  }
  return _client;
}

// ============================================================
// PUBLICAR — Sube toda la DB local a Supabase
// ============================================================
export async function publishToSupabase(onProgress) {
  const sb = getSupabase();

  // Verificar autenticación
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) {
    throw new Error('Debes iniciar sesión para publicar.');
  }

  const db = getRawDB();
  if (!db) throw new Error('No hay datos para publicar.');

  const stats = {
    seasons: 0, divisions: 0, teams: 0, players: 0,
    matches: 0, playoffs: 0, news: 0, archived_seasons: 0, config: 0
  };

  const startedAt = Date.now();

  // 1. seasons
  onProgress?.('Publicando temporadas...');
  await replaceTable(sb, 'seasons', db.seasons || [], s => ({
    id: s.id,
    name: s.name || '',
    year: s.year || new Date().getFullYear(),
    active: !!s.active,
    data: {}
  }));
  stats.seasons = (db.seasons || []).length;

  // 2. divisions
  onProgress?.('Publicando divisiones...');
  await replaceTable(sb, 'divisions', db.divisions || [], d => ({
    id: d.id,
    season_id: d.seasonId || null,
    name: d.name || '',
    tier: d.tier || 1,
    visible: d.visible !== false,
    data: { config: d.config || {} }
  }));
  stats.divisions = (db.divisions || []).length;

  // 3. teams
  onProgress?.('Publicando equipos...');
  await replaceTable(sb, 'teams', db.teams || [], t => ({
    id: t.id,
    division_id: t.divisionId || null,
    season_id: t.seasonId || null,
    name: t.name || '',
    data: {
      tag: t.tag || '',
      logo: t.logo || '',
      coach: t.coach || '',
      roster: t.roster || [],
      trophies: t.trophies || []
    }
  }));
  stats.teams = (db.teams || []).length;

  // 4. players — reconstruir divisionId desde el equipo si falta
  onProgress?.('Publicando jugadores...');
  const teamByPlayerId = new Map();
  (db.teams || []).forEach(t => {
    (t.roster || []).forEach(r => {
      teamByPlayerId.set(r.playerId, t.divisionId || null);
    });
  });

  await replaceTable(sb, 'players', db.players || [], p => {
    const realDivId = p.divisionId || teamByPlayerId.get(p.id) || null;
    return {
      id: p.id,
      division_id: realDivId,
      name: p.name || '',
      data: {
        platform: p.platform || 'Steam',
        nationalityCode: p.nationalityCode || '',
        rank: p.rank || '',
        rankLevel: p.rankLevel ?? 2,
        rankDivision: p.rankDivision || 'II',
        rlTracker: p.rlTracker || '',
        profilePicture: p.profilePicture || '',
        history: p.history || [],
        sanctions: p.sanctions || [],
        pigHistory: p.pigHistory || [],
        pigTrend: p.pigTrend || '—',
        careerSnapshots: p.careerSnapshots || [],
        trophies: p.trophies || [],
        status: p.status || 'owned',
        pendingTeamId: p.pendingTeamId || null,
        seasonStats: p.seasonStats || {}
      }
    };
  });
  stats.players = (db.players || []).length;

  // 5. matches
  onProgress?.('Publicando partidos...');
  await replaceTable(sb, 'matches', db.matches || [], m => ({
    id: m.id,
    division_id: m.divisionId || null,
    season_id: m.seasonId || null,
    matchday: m.matchday || 0,
    status: m.status || 'pending',
    data: {
      teamAId: m.teamAId || null,
      teamBId: m.teamBId || null,
      format: m.format || 'BO3',
      date: m.date || '',
      time: m.time || '',
      locked: !!m.locked,
      games: m.games || []
    }
  }));
  stats.matches = (db.matches || []).length;

  // 6. playoffs
  onProgress?.('Publicando playoffs...');
  const playoffRows = (db.playoffs || []).map((p, i) => ({
    id: `playoff_${p.divisionId || i}`,
    division_id: p.divisionId || null,
    season_id: p.seasonId || null,
    data: {
      status: p.status || 'pending',
      bracket: p.bracket || null,
      championId: p.championId || null
    }
  }));
  await replaceTable(sb, 'playoffs', playoffRows, r => r);
  stats.playoffs = playoffRows.length;

  // 7. news
  onProgress?.('Publicando noticias...');
  await replaceTable(sb, 'news', db.news || [], n => ({
    id: n.id,
    date: n.date || '',
    published: n.published !== false,
    pinned: !!n.pinned,
    data: {
      title: n.title || '',
      body: n.body || '',
      category: n.category || 'GENERAL',
      customCategory: n.customCategory || '',
      banner: n.banner || '',
      featured: !!n.featured,
      goldenFrame: !!n.goldenFrame,
      blocks: n.blocks || []
    }
  }));
  stats.news = (db.news || []).length;

  // 8. archived_seasons
  onProgress?.('Publicando temporadas archivadas...');
  await replaceTable(sb, 'archived_seasons', db.archivedSeasons || [], a => ({
    id: a.id,
    name: a.name || '',
    year: a.year || new Date().getFullYear(),
    archived_at: a.archivedAt || new Date().toISOString(),
    data: {
      championByDivision: a.championByDivision || {},
      movements: a.movements || [],
      snapshot: a.snapshot || null
    }
  }));
  stats.archived_seasons = (db.archivedSeasons || []).length;

  // 9. config (fila única)
  onProgress?.('Publicando configuración...');
  const cfgData = {
    rosterRules: db.config?.rosterRules || {},
    pigWeights: db.config?.pigWeights || {},
    badStreak: db.config?.badStreak || {},
    seasonEnd: db.config?.seasonEnd || {},
    widgets: db.widgets || [],
    trophies: db.trophies || {},
    transferLog: db.transferLog || [],
    transferBannerBg: db.transferBannerBg || ''
  };
  const { error: cfgErr } = await sb.from('config').upsert({ id: 1, data: cfgData });
  if (cfgErr) throw new Error('Config: ' + cfgErr.message);
  stats.config = 1;

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

  return {
    ok: true,
    stats,
    elapsed,
    publishedAt: new Date().toISOString()
  };
}

// Reemplaza todas las filas de una tabla (delete + insert)
async function replaceTable(sb, tableName, rows, mapFn) {
  // 1. Borrar todas las filas existentes
  const { error: delErr } = await sb.from(tableName).delete().neq('id', '__never__');
  if (delErr) throw new Error(`${tableName} (delete): ${delErr.message}`);

  // 2. Insertar las nuevas
  if (rows.length === 0) return;
  const mapped = rows.map(mapFn);
  const { error: insErr } = await sb.from(tableName).insert(mapped);
  if (insErr) throw new Error(`${tableName} (insert): ${insErr.message}`);
}

// ============================================================
// TEST DE CONEXIÓN
// ============================================================
export async function testConnection() {
  const sb = getSupabase();
  const { error } = await sb.from('seasons').select('id').limit(1);
  if (error) throw new Error(error.message);
  return true;
}