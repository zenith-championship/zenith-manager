import { loadDB, getDB, setViewSeasonId } from './services/storage.js';
import { registerRoute, startRouter, navigate } from './router.js';
import { initEmoji } from './services/emoji.js';
import { state, loadActiveDivision, saveActiveDivision } from './state.js';

import { dashboardView, bindDashboardEvents } from './views/dashboard.js';
import { teamsView, bindTeamsEvents } from './views/teams.js';
import { matchesView, bindMatchesEvents } from './views/matches.js';
import { statsView, bindStatsEvents } from './views/stats.js';
import { rostersView, bindRostersEvents } from './views/rosters.js';
import { playersView, bindPlayersEvents } from './views/players.js';
import { newsView, bindNewsEvents } from './views/news.js';
import { playoffsView, bindPlayoffsEvents } from './views/playoffs.js';
import { configView, bindConfigEvents } from './views/config.js';
import { ballonDorView, bindBallonDorEvents } from './views/ballonDor.js';
import { marketView, bindMarketEvents } from './views/market.js';

window.addEventListener('error', e => console.error('[ZENITH] error:', e.error || e.message));
window.addEventListener('unhandledrejection', e => console.error('[ZENITH] promise rejected:', e.reason));

// ---------- BOOT ----------
try{
  loadDB();
  loadActiveDivision();
  const db = getDB();
  const visible = db.divisions.filter(d => d.visible !== false);
  if(!state.divisionId || !db.divisions.find(d => d.id === state.divisionId)){
    state.divisionId = visible[0]?.id || db.divisions[0]?.id || null;
    if(state.divisionId) saveActiveDivision(state.divisionId);
  }
}catch(err){
  console.error('[ZENITH] Boot error:', err);
}

// ---------- RUTAS ----------
registerRoute('dashboard', dashboardView);
registerRoute('teams',     teamsView);
registerRoute('players',   playersView);
registerRoute('matches',   matchesView);
registerRoute('stats',     statsView);
registerRoute('rosters',   rostersView);
registerRoute('news',      newsView);
registerRoute('playoffs',  playoffsView);
registerRoute('config',    configView);
registerRoute('ballonDor', ballonDorView);
registerRoute('market',    marketView);

// ---------- RENDER ----------
let _currentViewFn = null;
let _currentParams = [];

function renderView(viewFn, params){
  const view = document.getElementById('view');
  try{
    view.innerHTML = viewFn(params);

    safeBind(bindDashboardEvents);
    safeBind(bindTeamsEvents);
    safeBind(bindMatchesEvents);
    safeBind(bindStatsEvents);
    safeBind(bindNewsEvents);
    safeBind(bindConfigEvents);
    safeBind(bindPlayoffsEvents);
    safeBind(bindRostersEvents);
    safeBind(bindPlayersEvents);
    safeBind(bindBallonDorEvents);
    safeBind(bindMarketEvents);

    updateActiveNav();
    updateDivisionHeader();
    window.scrollTo(0, 0);
  }catch(err){
    console.error('[ZENITH] Render error:', err);
    view.innerHTML = `
      <div class="card" style="border-left:3px solid var(--danger)">
        <div class="card-title" style="color:var(--danger)">◆ ERROR AL RENDERIZAR</div>
        <div style="margin-top:12px;font-size:13px;color:var(--silver)">${err.message}</div>
        <pre style="margin-top:12px;font-size:11px;color:var(--muted);white-space:pre-wrap;overflow:auto;max-height:400px">${(err.stack||'').replace(/</g,'&lt;')}</pre>
      </div>`;
  }
}

function safeBind(fn){
  try{ fn?.(); }
  catch(e){ console.error('[ZENITH] bind error en', fn?.name, e); }
}

export function refreshView(){
  if(_currentViewFn) renderView(_currentViewFn, _currentParams);
}

startRouter((viewFn, params) => {
  _currentViewFn = viewFn;
  _currentParams = params;
  renderView(viewFn, params);
});

function updateActiveNav(){
  const current = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/')[0];
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.route === current);
  });
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-route]');
  if(!el) return;
  const route = el.dataset.route;
  if(!route) return;
  e.preventDefault();
  navigate(route);
  document.getElementById('sidebar')?.classList.remove('open');
});

document.getElementById('menuToggle')?.addEventListener('click', () => {
  document.getElementById('sidebar')?.classList.toggle('open');
});

// ---------- HEADER ----------
function updateDivisionHeader(){
  const db = getDB();
  const active = db.divisions.find(d => d.id === state.divisionId) || db.divisions[0];
  const nameEl = document.getElementById('currentDivisionName');
  if(nameEl && active) nameEl.textContent = active.name;

  // Chip de temporada
  const viewingId = db.viewSeasonId;
  let season;
  if(viewingId){
    season = (db.archivedSeasons || []).find(s => s.id === viewingId) || null;
  } else {
    season = db.seasons.find(s => s.active) || db.seasons[0] || null;
  }
  const chipSeason = document.getElementById('currentSeasonName');
  if(chipSeason && season) chipSeason.textContent = season.name;

  // Chip MODO LECTURA
  const roChip = document.getElementById('readOnlyChip');
  if(roChip){
    roChip.style.display = viewingId ? '' : 'none';
  }
}

function buildDivisionDropdown(){
  const db = getDB();
  const dropdown = document.getElementById('divisionDropdown');
  if(!dropdown) return;
  const visible = db.divisions.filter(d => d.visible !== false);
  if(visible.length === 0){
    dropdown.innerHTML = `<div class="division-dropdown-empty">Sin divisiones</div>`;
    return;
  }
  // Activa: el state.divisionId si existe en la DB actual, si no, la primera
  const activeId = visible.find(d => d.id === state.divisionId)?.id || visible[0].id;
  dropdown.innerHTML = visible.map(d => `
    <button class="division-dropdown-item ${d.id===activeId?'active':''}" data-division-id="${d.id}">
      <span class="division-dropdown-tier">${d.tier}ª</span>
      <span class="division-dropdown-name">${esc(d.name)}</span>
    </button>
  `).join('') + `<div class="division-dropdown-sep"></div>
    <button class="division-dropdown-manage" data-route="config">⚙ Gestionar divisiones</button>`;

  dropdown.querySelectorAll('[data-division-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      saveActiveDivision(btn.dataset.divisionId);
      dropdown.classList.add('hidden');
      refreshView();
    });
  });
  dropdown.querySelector('.division-dropdown-manage')?.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    navigate('config');
  });
}

document.getElementById('divisionBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById('divisionDropdown');
  if(!dropdown) return;
  if(dropdown.classList.contains('hidden')){
    buildDivisionDropdown();
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
});

// ---------- SEASON DROPDOWN (Fase 4) ----------
function buildSeasonDropdown(){
  const db = getDB();
  const dropdown = document.getElementById('seasonDropdown');
  if(!dropdown) return;

  const viewingId = db.viewSeasonId;
  const activeSeason = db.seasons.find(s => s.active);

  const archived = [...(db.archivedSeasons || [])].sort((a,b) =>
    (b.archivedAt || '').localeCompare(a.archivedAt || '')
  );

  const activeHTML = activeSeason ? `
    <button class="season-dropdown-item ${!viewingId ? 'active' : ''}" data-season-id="">
      <span class="season-dropdown-name">
        <span>🟢 ${esc(activeSeason.name)}</span>
        <span class="season-dropdown-meta">TEMPORADA ACTIVA</span>
      </span>
    </button>
  ` : '';

  const archivedHTML = archived.map(arch => {
    const isCurrent = viewingId === arch.id;
    const champs = arch.championByDivision || {};
    const firstChamp = Object.values(champs)[0];
    return `
      <button class="season-dropdown-item ${isCurrent ? 'active' : ''}" data-season-id="${arch.id}">
        <span class="season-dropdown-name">
          <span>📦 ${esc(arch.name)}</span>
          <span class="season-dropdown-meta">${arch.year || ''}${firstChamp ? ' · 🏆 ' + esc(firstChamp.teamName) : ''}</span>
        </span>
        <span class="season-export-btn" data-export-season="${arch.id}" title="Exportar JSON">⬇</span>
      </button>
    `;
  }).join('');

  dropdown.innerHTML = `
    ${activeHTML}
    ${archived.length > 0 ? '<div class="season-dropdown-sep"></div>' : ''}
    ${archivedHTML || (activeSeason ? '' : '<div class="season-dropdown-empty">Sin temporadas</div>')}
  `;

  // Handler: seleccionar temporada
  dropdown.querySelectorAll('[data-season-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if(e.target.closest('[data-export-season]')) return;
      const id = btn.dataset.seasonId || null;
      switchToSeason(id);
      dropdown.classList.add('hidden');
      refreshView();
    });
  });

  // Handler: exportar temporada
  dropdown.querySelectorAll('[data-export-season]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      import('./services/seasons.js').then(({ exportSeason }) => exportSeason(btn.dataset.exportSeason));
    });
  });
}

function switchToSeason(seasonId){
  setViewSeasonId(seasonId || null);
  state.viewSeasonId = seasonId || null;

  // Asegurar que state.divisionId apunte a algo válido en la nueva vista
  const db = getDB();
  const visible = db.divisions.filter(d => d.visible !== false);
  if(!db.divisions.find(d => d.id === state.divisionId)){
    state.divisionId = visible[0]?.id || db.divisions[0]?.id || null;
    if(state.divisionId) saveActiveDivision(state.divisionId);
  }
}

document.getElementById('seasonBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById('seasonDropdown');
  if(!dropdown) return;
  if(dropdown.classList.contains('hidden')){
    buildSeasonDropdown();
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
});

// Cerrar dropdowns al click afuera
document.addEventListener('click', (e) => {
  const dd = document.getElementById('divisionDropdown');
  if(dd && !dd.classList.contains('hidden')){
    if(!e.target.closest('#divisionSelector')) dd.classList.add('hidden');
  }
  const sd = document.getElementById('seasonDropdown');
  if(sd && !sd.classList.contains('hidden')){
    if(!e.target.closest('#seasonSelector')) sd.classList.add('hidden');
  }
});

// ---------- Emoji ----------
initEmoji();

// ---------- UTILS ----------
function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}