import { getDB, mutate, exportJSON, exportBackup, importJSON, resetDB } from '../services/storage.js';
import { toast, openModal, closeTopModal } from '../services/ui.js';
import { logChange } from '../services/history.js';
import { AIService, DEFAULT_SYSTEM_PROMPT } from '../services/aiService.js';
import { ZONE_TYPES, getZoneColor } from '../data/nations.js';
import { computeStandings } from '../services/standings.js';
import { createDivision, deleteDivision, updateDivision, setDivisionVisibility, queueTeamMovement, swapTeams } from '../services/divisions.js';
import {
  TROPHY_TYPES, saveTrophyConfig, assignTrophyToTeam, assignTrophyToPlayer,
  listExistingTrophies, removeTrophyFromTeam, removeTrophyFromPlayer
} from '../services/trophies.js';
import { canFinishSeason, finishSeason, resetDivisions } from '../services/seasons.js';
import { uid, getDefaultWidgets, getWidgetType } from '../data/database.js';
import { state } from '../state.js';

let configTab = 'general';

export function configView(){
  const db = getDB();

  if(db.viewSeasonId){
    const arch = (db.archivedSeasons || []).find(s => s.id === db.viewSeasonId);
    return `
      <h1 class="page-title" style="margin-bottom:20px">CONFIGURACIÓN</h1>
      <div class="card" style="border-left:4px solid var(--gold)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <div>
            <div style="color:var(--gold);font-family:var(--font-display);letter-spacing:.14em;font-size:15px;margin-bottom:6px">
              📖 MODO LECTURA · ${esc(arch?.name || 'Temporada archivada')}
            </div>
            <div style="font-size:12px;color:var(--muted);line-height:1.6">
              La configuración no está disponible mientras ves una temporada archivada.
            </div>
          </div>
          <button class="btn btn-primary" id="btnExitViewFromConfig">← VOLVER A TEMPORADA ACTIVA</button>
        </div>
      </div>
    `;
  }

  const ai = db.config.ai || {};
  return `
    <h1 class="page-title" style="margin-bottom:20px">CONFIGURACIÓN</h1>

    <div class="config-tabs">
      <button class="config-tab ${configTab==='general'?'active':''}" data-config-tab="general">⚙ General</button>
      <button class="config-tab ${configTab==='zones'?'active':''}" data-config-tab="zones">🎨 Clasificaciones</button>
      <button class="config-tab ${configTab==='divisions'?'active':''}" data-config-tab="divisions">🏆 Divisiones</button>
      <button class="config-tab ${configTab==='movements'?'active':''}" data-config-tab="movements">🔀 Movimientos</button>
      <button class="config-tab ${configTab==='trophies'?'active':''}" data-config-tab="trophies">🏆 Trofeos</button>
      <button class="config-tab ${configTab==='ai'?'active':''}" data-config-tab="ai">🤖 IA</button>
      <button class="config-tab ${configTab==='data'?'active':''}" data-config-tab="data">💾 Datos</button>
    </div>

    <div id="configContent">${renderConfigTab(configTab, db, ai)}</div>
  `;
}

function renderConfigTab(tab, db, ai){
  switch(tab){
    case 'general': return renderGeneral(db);
    case 'zones': return renderZones(db);
    case 'divisions': return renderDivisions(db);
    case 'movements': return renderMovements(db);
    case 'trophies': return renderTrophiesConfig(db);
    case 'ai': return renderAI(ai);
    case 'data': return renderData();
    default: return '';
  }
}

// ============================================================
// GENERAL
// ============================================================
function renderGeneral(db){
  const widgets = [...db.widgets].sort((a, b) => a.order - b.order);
  const activeSeason = db.seasons.find(s => s.active);
  const totalMatches = db.matches.length;
  const totalFinished = db.matches.filter(m => m.status === 'finished').length;

  return `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>REGLAS DE ROSTER</div></div>
        <div class="row-3">
          <div class="field"><label>Titulares</label><input class="input" type="number" id="cfgStarters" value="${db.config.rosterRules.starters}"></div>
          <div class="field"><label>Suplentes</label><input class="input" type="number" id="cfgSubs" value="${db.config.rosterRules.substitutes}"></div>
          <div class="field"><label>Máx.</label><input class="input" type="number" id="cfgMax" value="${db.config.rosterRules.max}"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>MALAS RACHAS</div></div>
        <div class="field"><label><input type="checkbox" id="bsEnabled" ${db.config.badStreak.enabled?'checked':''}> Activado</label></div>
        <div class="row-3">
          <div class="field"><label>Partidos mín.</label><input class="input" type="number" id="bsMin" value="${db.config.badStreak.minGames}"></div>
          <div class="field"><label>Derrotas cons.</label><input class="input" type="number" id="bsLosses" value="${db.config.badStreak.consecutiveLosses}"></div>
          <div class="field"><label>Penalización</label><input class="input" type="number" step="0.01" id="bsPen" value="${db.config.badStreak.penalty}"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>FÓRMULA PIG</div></div>
        <div class="row-3">
          <div class="field"><label>Gol ×</label><input class="input" type="number" step="0.1" id="pwGoal" value="${db.config.pigWeights.goal}"></div>
          <div class="field"><label>Asist ×</label><input class="input" type="number" step="0.1" id="pwAssist" value="${db.config.pigWeights.assist}"></div>
          <div class="field"><label>Salv ×</label><input class="input" type="number" step="0.1" id="pwSave" value="${db.config.pigWeights.save}"></div>
        </div>
        <div class="field"><label>Divisor tiros fallados</label><input class="input" type="number" id="pwMiss" value="${db.config.pigWeights.missDivisor}"></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="dot">◆</span>WIDGETS DEL HOME</div>
          <button class="btn btn-sm" id="resetWidgetsBtn" type="button">↺ RESTAURAR</button>
        </div>
        <p class="field-hint" style="margin-bottom:10px">Los widgets con 📋 pueden duplicarse en la Home (Modo Edición). Los ⚙ tienen configuración propia.</p>
        ${widgets.map(w => {
          const t = getWidgetType(w.id);
          const canConfig = t?.configurable;
          const isCustom = !w.instanceId.endsWith('_default');
          return `
            <div class="widget-toggle-row" data-instance-row="${w.instanceId}">
              <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
                <span style="color:var(--silver-light);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(w.name)}</span>
                ${isCustom ? `<span class="chip" style="font-size:9px;padding:2px 6px">COPIA</span>` : ''}
                ${canConfig ? `<span class="chip chip-accent" style="font-size:9px;padding:2px 6px">⚙ CONFIG</span>` : ''}
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
                <label style="font-size:11px;color:var(--muted);display:flex;gap:4px;align-items:center">
                  <input type="checkbox" data-widget-toggle="${w.instanceId}" ${w.enabled?'checked':''}> Activo
                </label>
                ${isCustom ? `<button class="btn btn-sm btn-danger" data-widget-remove="${w.instanceId}" type="button" title="Eliminar">✕</button>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>
    <div style="margin-top:20px">
      <button class="btn btn-primary" id="saveCfgGeneral">GUARDAR CAMBIOS GENERALES</button>
    </div>

    <div class="card" style="margin-top:26px;border-left:4px solid var(--gold)">
      <div class="card-header">
        <div class="card-title" style="color:var(--gold)"><span class="dot" style="color:var(--gold)">◆</span>FIN DE TEMPORADA</div>
        <span class="card-sub">${esc(activeSeason?.name || '—')}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
        <div class="kpi"><div class="kpi-val">${db.divisions.length}</div><div class="kpi-lab">DIVISIONES</div></div>
        <div class="kpi"><div class="kpi-val">${totalMatches}</div><div class="kpi-lab">PARTIDOS</div></div>
        <div class="kpi"><div class="kpi-val">${totalFinished}</div><div class="kpi-lab">FINALIZADOS</div></div>
      </div>
      <ul style="font-size:12px;color:var(--muted);line-height:1.8;padding-left:20px;margin:0 0 16px">
        <li>Se detecta el <strong style="color:var(--silver-light)">campeón de cada división</strong>.</li>
        <li>Se archiva un <strong style="color:var(--silver-light)">snapshot completo</strong>.</li>
        <li>Se crea una <strong style="color:var(--silver-light)">nueva temporada</strong>.</li>
        <li>Se aplican <strong style="color:var(--silver-light)">ascensos y descensos</strong>.</li>
        <li>Se asignan <strong style="color:var(--silver-light)">trofeos</strong> (equipos + jugadores).</li>
      </ul>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--silver-light);cursor:pointer;margin-bottom:14px">
        <input type="checkbox" id="seasonEndAutoTrophiesToggle" ${db.config.seasonEnd?.autoAssignTrophies !== false ? 'checked' : ''}>
        Asignar trofeos automáticamente
      </label>
      <button class="btn btn-primary" id="btnFinishSeason" style="background:var(--gold);color:#04101F;border-color:var(--gold);font-weight:700">
        🏆 TERMINAR TEMPORADA
      </button>
    </div>

    <div class="card" style="margin-top:18px;border-left:4px solid var(--danger)">
      <div class="card-header"><div class="card-title" style="color:var(--danger)"><span class="dot" style="color:var(--danger)">◆</span>RESETEAR DIVISIONES</div></div>
      <p style="font-size:12px;color:var(--muted);line-height:1.7;margin-bottom:14px">
        Quita todos los equipos de sus divisiones. Los equipos y jugadores <strong style="color:var(--silver-light)">se mantienen intactos</strong>.
      </p>
      <button class="btn btn-danger" id="btnResetDivisions">🔀 RESETEAR DIVISIONES</button>
    </div>
  `;
}

// ============================================================
// ZONES
// ============================================================
function renderZones(db){
  const activeDivisionId = state.divisionId || db.divisions[0]?.id;
  const division = db.divisions.find(d => d.id === activeDivisionId);
  if(!division) return `<div class="card">Sin divisiones activas.</div>`;
  const seasonId = db.seasons.find(s => s.active)?.id || db.seasons[0]?.id;
  const standings = computeStandings(activeDivisionId, seasonId);
  const zones = division.config.zones || { zones:[] };

  return `
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>EDITOR DE CLASIFICACIONES · ${esc(division.name)}</div></div>
      <div class="field"><label><input type="checkbox" id="zoneShowTop1" ${zones.hasTop1Highlight ? 'checked' : ''}> Resaltar 1º con dorado</label></div>
      <div class="zones-editor">
        <div class="zones-editor-head"><div>#</div><div>EQUIPO</div><div class="num">PTS</div><div>ZONA</div></div>
        ${standings.map(row => {
          const currentZone = zones.zones.find(z => row.pos >= z.from && row.pos <= z.to);
          const currentType = currentZone?.type || 'none';
          const color = currentZone?.color || getZoneColor(currentType);
          return `
            <div class="zones-editor-row" style="border-left:4px solid ${color}">
              <div class="zones-pos">${row.pos}</div>
              <div class="zones-team">${row.logo ? `<img src="${row.logo}" class="zones-team-logo">` : ''}<span>${esc(row.name)}</span></div>
              <div class="num">${row.PTS}</div>
              <div>
                <select class="select zone-select" data-zone-pos="${row.pos}">
                  ${ZONE_TYPES.map(z => `<option value="${z.id}" ${currentType===z.id?'selected':''}>${z.label}</option>`).join('')}
                </select>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" id="saveZones">GUARDAR CLASIFICACIONES</button>
        <button class="btn" id="resetZones">RESTAURAR DEFAULT</button>
      </div>
    </div>
  `;
}

// ============================================================
// DIVISIONS
// ============================================================
function renderDivisions(db){
  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot">◆</span>DIVISIONES</div>
        <button class="btn btn-sm btn-primary" id="btnNewDivision">+ CREAR DIVISIÓN</button>
      </div>
      <div class="divisions-list">
        ${db.divisions.map(d => {
          const teams = db.teams.filter(t => t.divisionId === d.id);
          return `
            <div class="division-row">
              <div class="division-row-tier">${d.tier}ª</div>
              <div class="division-row-info">
                <div class="division-row-name">${esc(d.name)}</div>
                <div class="division-row-meta">${teams.length} equipos · ${d.visible ? 'Visible' : 'Oculta'}</div>
              </div>
              <label class="division-row-toggle"><input type="checkbox" ${d.visible !== false ? 'checked' : ''} data-div-visibility="${d.id}"><span>Visible</span></label>
              <button class="btn btn-sm" data-div-edit="${d.id}">EDITAR</button>
              <button class="btn btn-sm btn-danger" data-div-del="${d.id}">✕</button>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ============================================================
// MOVEMENTS
// ============================================================
function renderMovements(db){
  const teams = db.teams;
  const divisions = db.divisions;
  const queue = (db.transferQueue || []).filter(m => m.status === 'pending');
  return `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>NUEVO MOVIMIENTO</div></div>
        <div class="field"><label>Tipo</label>
          <select class="select" id="movType">
            <option value="promote">⬆ Ascenso</option>
            <option value="relegate">⬇ Descenso</option>
            <option value="swap">🔀 Intercambio</option>
          </select>
        </div>
        <div class="field"><label>Equipo A</label>
          <select class="select" id="movTeamA">${teams.map(t => `<option value="${t.id}">${esc(t.name)} — ${esc(divisions.find(d=>d.id===t.divisionId)?.name || 'Sin división')}</option>`).join('')}</select>
        </div>
        <div class="field" id="movSwapWrap" style="display:none"><label>Equipo B</label>
          <select class="select" id="movTeamB">${teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>División destino</label>
          <select class="select" id="movTargetDiv">${divisions.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Aplicar</label>
          <select class="select" id="movApplyAt">
            <option value="immediate">🔴 Inmediato</option>
            <option value="endRegular">⏸ Fin fase regular</option>
            <option value="endSeason">🏁 Fin temporada</option>
            <option value="roundN">📅 Jornada específica</option>
          </select>
        </div>
        <div class="field" id="movRoundWrap" style="display:none"><label>Jornada</label><input class="input" type="number" min="1" id="movRound" value="1"></div>
        <div class="field"><label>Motivo</label><input class="input" id="movReason" placeholder="Sanción, compra de plaza..."></div>
        <button class="btn btn-primary" id="btnQueueMovement" style="width:100%">APLICAR MOVIMIENTO</button>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>COLA PENDIENTE</div><span class="card-sub">${queue.length}</span></div>
        ${queue.length === 0 ? '<div style="color:var(--muted);font-size:12px">Sin movimientos pendientes</div>' : queue.map(m => `
          <div class="movement-row">
            <div><strong>${esc(m.teamName || '?')}</strong><span style="color:var(--muted);font-size:11px"> · ${m.type} → ${esc(divisions.find(d=>d.id===m.targetDivisionId)?.name || '?')}</span></div>
            <div style="font-size:11px;color:var(--muted)">${m.applyAt === 'immediate' ? 'inmediato' : m.applyAt === 'endSeason' ? 'fin temporada' : m.applyAt === 'endRegular' ? 'fin fase regular' : `Jornada ${m.roundNumber}`}</div>
          </div>`).join('')}
      </div>
    </div>
  `;
}

// ============================================================
// TROPHIES
// ============================================================
function renderTrophiesConfig(db){
  const existing = listExistingTrophies();
  return `
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>CONFIGURACIÓN DE TROFEOS</div></div>
      <p class="field-hint">Define un trofeo (imagen + nombre) por indicador de cada división.</p>

      <div class="trophy-config-grid">
        ${db.divisions.map(div => {
          const cfg = (db.trophies || {})[div.id] || {};
          return `
            <div class="trophy-config-card">
              <h5>${div.tier || '?'}ª · ${esc(div.name)}</h5>
              ${TROPHY_TYPES.map(tt => {
                const t = cfg[tt.id] || {};
                const key = div.id + '::' + tt.id;
                return `
                  <div class="trophy-row" data-key="${key}">
                    <div class="trophy-preview" data-preview="${key}">${t.image ? `<img src="${t.image}" style="width:100%;height:100%;object-fit:contain">` : '🏆'}</div>
                    <div class="trophy-info">
                      <div style="font-size:10px;color:var(--muted)">${tt.label}</div>
                      <input class="input" data-trophy-name="${key}" value="${esc(t.name || '')}" placeholder="${tt.label}">
                      <input type="file" accept="image/*" hidden data-trophy-file="${key}">
                      <input type="hidden" data-trophy-image="${key}" value="${t.image || ''}">
                      <button type="button" class="btn" data-trophy-upload="${key}">📤 Imagen</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>`;
        }).join('')}
      </div>

      <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border-soft)">
        <h4 style="font-size:11px;letter-spacing:.16em;color:var(--accent);text-transform:uppercase;margin-bottom:10px">🎨 Banner por defecto de traspasos</h4>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          ${db.transferBannerBg ? `<img src="${db.transferBannerBg}" style="width:200px;border-radius:8px;border:1px solid var(--border-soft)">` : '<div style="color:var(--muted);font-size:12px">Sin imagen</div>'}
          <input type="file" id="banner-upload" accept="image/*" hidden>
          <input type="hidden" id="banner-data" value="${db.transferBannerBg || ''}">
          <button type="button" class="btn" id="banner-btn">📤 SUBIR BANNER</button>
        </div>
      </div>

      <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border-soft)">
        <h4 style="font-size:11px;letter-spacing:.16em;color:var(--accent);text-transform:uppercase;margin-bottom:10px">🎁 Asignar trofeo manual</h4>
        <div style="display:flex;flex-direction:column;gap:10px;padding:14px;background:var(--bg-graphite);border:1px solid var(--border-soft);border-radius:8px">
          <div class="field" style="margin:0"><label>Destino</label>
            <select class="select" id="manual-target">
              <option value="">— Seleccionar equipo o jugador —</option>
              <optgroup label="EQUIPOS">${db.teams.map(t => `<option value="team:${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>
              <optgroup label="JUGADORES">${db.players.map(p => `<option value="player:${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>
            </select>
          </div>
          <div class="field" style="margin:0"><label>Trofeo</label>
            <select class="select" id="manual-trophy">
              <option value="__custom">✨ Personalizado</option>
              ${existing.length > 0 ? existing.map(t => `<option value="existing:${t.key}">${esc(t.label)}</option>`).join('') : ''}
            </select>
          </div>
          <div id="manualCustomFields" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
            <div class="field" style="flex:1;min-width:180px;margin:0"><label>Nombre</label><input class="input" id="manual-trophy-name" placeholder="Nombre del trofeo"></div>
            <div class="field" style="margin:0"><label>Imagen</label>
              <input type="file" id="manual-trophy-file" accept="image/*" hidden>
              <input type="hidden" id="manual-trophy-image" value="">
              <button type="button" class="btn" id="manual-trophy-upload">📤 Subir</button>
            </div>
          </div>
          <div id="manualTrophyPreview" style="display:none;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-elev);border:1px solid var(--border-soft);border-radius:6px">
            <div style="width:36px;height:36px;background:var(--bg-graphite);border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0" id="manualTrophyPreviewImg">🏆</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;color:var(--silver-light)" id="manualTrophyPreviewName">—</div>
              <div style="font-size:10px;color:var(--muted)">Trofeo seleccionado</div>
            </div>
          </div>
          <button type="button" class="btn btn-primary" id="manual-give" style="align-self:flex-start">🎁 ASIGNAR TROFEO</button>
        </div>
      </div>

      <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border-soft)">
        <h4 style="font-size:11px;letter-spacing:.16em;color:var(--danger);text-transform:uppercase;margin-bottom:10px">🗑 QUITAR TROFEO</h4>
        <p class="field-hint" style="margin-bottom:12px">Selecciona un equipo o jugador y quita un trofeo específico de su vitrina.</p>
        <div style="display:flex;flex-direction:column;gap:10px;padding:14px;background:var(--bg-graphite);border:1px solid var(--border-soft);border-radius:8px">
          <div class="field" style="margin:0"><label>Destino</label>
            <select class="select" id="remove-target">
              <option value="">— Seleccionar equipo o jugador —</option>
              <optgroup label="EQUIPOS">${db.teams.map(t => `<option value="team:${t.id}">${esc(t.name)} (${(t.trophies||[]).length} trofeos)</option>`).join('')}</optgroup>
              <optgroup label="JUGADORES">${db.players.map(p => `<option value="player:${p.id}">${esc(p.name)} (${(p.trophies||[]).length} trofeos)</option>`).join('')}</optgroup>
            </select>
          </div>
          <div class="field" style="margin:0"><label>Trofeo a quitar</label>
            <select class="select" id="remove-trophy"><option value="">— Sin trofeos —</option></select>
          </div>
          <button type="button" class="btn btn-danger" id="remove-trophy-btn" style="align-self:flex-start" disabled>🗑 QUITAR TROFEO</button>
        </div>
      </div>

      <div style="margin-top:18px">
        <button type="button" class="btn btn-primary" id="save-trophies">GUARDAR CONFIGURACIÓN</button>
      </div>
    </div>
  `;
}

function bindTrophiesConfig(){
  document.querySelectorAll('[data-trophy-upload]').forEach(btn => {
    if(btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => document.querySelector(`[data-trophy-file="${btn.dataset.trophyUpload}"]`)?.click());
  });
  document.querySelectorAll('[data-trophy-file]').forEach(input => {
    if(input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('change', async () => {
      const f = input.files[0]; if(!f) return;
      const key = input.dataset.trophyFile;
      try {
        const dataUrl = await compressImage(f, 128, 128);
        document.querySelector(`[data-trophy-image="${key}"]`).value = dataUrl;
        document.querySelector(`[data-preview="${key}"]`).innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain">`;
        toast('Imagen cargada (guarda para confirmar)', 'success');
      } catch(e){ toast('Error procesando imagen', 'error'); }
    });
  });

  const bannerUpload = document.getElementById('banner-upload');
  const bannerBtn = document.getElementById('banner-btn');
  if(bannerBtn && !bannerBtn.dataset.bound){
    bannerBtn.dataset.bound = '1';
    bannerBtn.addEventListener('click', () => bannerUpload?.click());
  }
  if(bannerUpload && !bannerUpload.dataset.bound){
    bannerUpload.dataset.bound = '1';
    bannerUpload.addEventListener('change', async () => {
      const f = bannerUpload.files[0]; if(!f) return;
      try {
        const dataUrl = await compressImage(f, 1200, 500);
        document.getElementById('banner-data').value = dataUrl;
        toast('Banner cargado (guarda para confirmar)', 'success');
      } catch(e){ toast('Error procesando banner', 'error'); }
    });
  }

  const targetSel = document.getElementById('manual-target');
  const trophySel = document.getElementById('manual-trophy');
  const customFields = document.getElementById('manualCustomFields');
  const customName = document.getElementById('manual-trophy-name');
  const customImgInput = document.getElementById('manual-trophy-image');
  const customFile = document.getElementById('manual-trophy-file');
  const customUpload = document.getElementById('manual-trophy-upload');
  const previewBox = document.getElementById('manualTrophyPreview');
  const previewImg = document.getElementById('manualTrophyPreviewImg');
  const previewName = document.getElementById('manualTrophyPreviewName');

  let currentCustomImage = '';

  function updatePreview(){
    const val = trophySel?.value;
    if(val === '__custom'){
      if(customFields) customFields.style.display = 'flex';
      if(previewBox) previewBox.style.display = customName.value.trim() ? 'flex' : 'none';
      if(previewName) previewName.textContent = customName.value.trim() || '—';
      if(previewImg) previewImg.innerHTML = currentCustomImage ? `<img src="${currentCustomImage}" style="width:100%;height:100%;object-fit:contain">` : '🏆';
    } else {
      if(customFields) customFields.style.display = 'none';
      const opt = trophySel?.selectedOptions[0];
      if(opt && opt.value){
        if(previewBox) previewBox.style.display = 'flex';
        if(previewName) previewName.textContent = opt.textContent;
        const existing = listExistingTrophies().find(t => `existing:${t.key}` === val);
        if(previewImg) previewImg.innerHTML = existing?.image ? `<img src="${existing.image}" style="width:100%;height:100%;object-fit:contain">` : '🏆';
      } else {
        if(previewBox) previewBox.style.display = 'none';
      }
    }
  }

  trophySel?.addEventListener('change', updatePreview);
  customName?.addEventListener('input', updatePreview);
  updatePreview();

  customUpload?.addEventListener('click', () => customFile?.click());
  customFile?.addEventListener('change', async () => {
    const f = customFile.files[0]; if(!f) return;
    try {
      const res = await compressImage(f, 128, 128);
      currentCustomImage = res;
      customImgInput.value = res;
      updatePreview();
    } catch(e){ toast('Error procesando imagen', 'error'); }
  });

  const giveBtn = document.getElementById('manual-give');
  if(giveBtn && !giveBtn.dataset.bound){
    giveBtn.dataset.bound = '1';
    giveBtn.addEventListener('click', () => {
      try {
        const target = targetSel.value;
        if(!target) return toast('Selecciona un destino', 'error');

        const trophyVal = trophySel.value;
        let trophyData;

        if(trophyVal === '__custom'){
          const name = customName.value.trim();
          if(!name) return toast('Falta el nombre del trofeo', 'error');
          trophyData = { name, image: currentCustomImage || '', manual: true };
        } else {
          const existing = listExistingTrophies().find(t => `existing:${t.key}` === trophyVal);
          if(!existing) return toast('Trofeo no encontrado', 'error');
          trophyData = {
            name: existing.name, image: existing.image, manual: true,
            divisionId: existing.divisionId, divisionName: existing.divisionName, type: existing.type
          };
        }
        trophyData.date = Date.now();

        const [kind, id] = target.split(':');
        if(kind === 'team'){
          assignTrophyToTeam(id, trophyData);
          toast(`Trofeo "${trophyData.name}" asignado al equipo`, 'success');
        } else {
          assignTrophyToPlayer(id, trophyData);
          toast(`Trofeo "${trophyData.name}" asignado al jugador`, 'success');
        }
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch(e){
        console.error(e);
        toast('Error: ' + e.message, 'error');
      }
    });
  }

  const remTarget = document.getElementById('remove-target');
  const remSelect = document.getElementById('remove-trophy');
  const remBtn = document.getElementById('remove-trophy-btn');

  function refreshRemoveList(){
    if(!remTarget || !remSelect || !remBtn) return;
    const val = remTarget.value;
    if(!val){
      remSelect.innerHTML = '<option value="">— Selecciona un destino —</option>';
      remBtn.disabled = true;
      return;
    }
    const [kind, id] = val.split(':');
    const db = getDB();
    let list = [];
    if(kind === 'team'){
      const t = db.teams.find(x => x.id === id);
      list = t?.trophies || [];
    } else {
      const p = db.players.find(x => x.id === id);
      list = p?.trophies || [];
    }
    if(list.length === 0){
      remSelect.innerHTML = '<option value="">— Sin trofeos —</option>';
      remBtn.disabled = true;
      return;
    }
    remSelect.innerHTML = '<option value="">— Selecciona un trofeo —</option>' +
      list.map(tr => `<option value="${tr.id}">${esc(tr.name)}${tr.wonWith ? ' · ' + esc(tr.wonWith) : ''}</option>`).join('');
    remBtn.disabled = true;
  }
  remTarget?.addEventListener('change', refreshRemoveList);
  remSelect?.addEventListener('change', () => { remBtn.disabled = !remSelect.value; });
  remBtn?.addEventListener('click', () => {
    const val = remTarget.value;
    const trophyId = remSelect.value;
    if(!val || !trophyId) return;
    if(!confirm('¿Quitar este trofeo?')) return;
    try {
      const [kind, id] = val.split(':');
      if(kind === 'team') removeTrophyFromTeam(id, trophyId);
      else removeTrophyFromPlayer(id, trophyId);
      toast('Trofeo eliminado', 'success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(e){ toast('Error: ' + e.message, 'error'); }
  });
  refreshRemoveList();

  const saveBtn = document.getElementById('save-trophies');
  if(saveBtn && !saveBtn.dataset.bound){
    saveBtn.dataset.bound = '1';
    saveBtn.addEventListener('click', () => {
      try {
        const names = {}; const images = {};
        document.querySelectorAll('[data-trophy-name]').forEach(inp => { names[inp.dataset.trophyName] = inp.value.trim(); });
        document.querySelectorAll('[data-trophy-image]').forEach(inp => { images[inp.dataset.trophyImage] = inp.value; });
        const banner = document.getElementById('banner-data')?.value || '';

        mutate(d => {
          d.trophies ||= {};
          Object.keys(names).forEach(key => {
            const [divId, type] = key.split('::');
            if(!divId || !type) return;
            d.trophies[divId] ||= {};
            d.trophies[divId][type] ||= {};
            d.trophies[divId][type].name = names[key] || '';
            d.trophies[divId][type].image = images[key] || '';
          });
          d.transferBannerBg = banner;
        });
        toast('Configuración de trofeos guardada', 'success');
      } catch(e){
        console.error(e);
        toast('Error: ' + e.message, 'error');
      }
    });
  }
}

// ============================================================
// AI
// ============================================================
function renderAI(ai){
  const thresholds = ai.matchThresholds || { high: 0.9, low: 0.5 };
  return `
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>INTELIGENCIA ARTIFICIAL</div></div>
      <div class="row">
        <div class="field"><label>Proveedor</label>
          <select class="select" id="aiProvider"><option value="gemini" ${ai.provider==='gemini'?'selected':''}>Google Gemini</option></select>
        </div>
        <div class="field"><label>Modelo</label>
          <div style="display:flex;gap:8px">
            <select class="select" id="aiModel" style="flex:1">
              ${ai.model ? `<option value="${ai.model}" selected>${ai.model}</option>` : '<option value="gemini-2.0-flash" selected>gemini-2.0-flash</option>'}
            </select>
            <button class="btn" id="aiListModels" type="button">LISTAR</button>
          </div>
        </div>
      </div>
      <div class="field"><label>API Key</label>
        <div style="display:flex;gap:8px">
          <input class="input" id="aiKey" type="password" value="${ai.apiKey||''}" placeholder="Tu clave de Gemini">
          <button class="btn" id="aiToggleKey" type="button">👁</button>
        </div>
      </div>
      <div class="divider"></div>
      <div class="row">
        <div class="field"><label>Umbral alto (%)</label><input class="input" type="number" id="aiThresholdHigh" min="50" max="100" step="1" value="${Math.round((thresholds.high || 0.9) * 100)}"></div>
        <div class="field"><label>Umbral bajo (%)</label><input class="input" type="number" id="aiThresholdLow" min="0" max="100" step="1" value="${Math.round((thresholds.low || 0.5) * 100)}"></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-bottom:6px">
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600">Prompt del sistema</label>
        <button type="button" class="btn btn-sm" id="aiResetPrompt">↩ Restaurar prompt por defecto</button>
      </div>
      <div class="field"><textarea class="textarea" id="aiPrompt" rows="14">${ai.systemPrompt||''}</textarea></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn" id="aiTest">PROBAR CONEXIÓN</button>
        <button class="btn btn-primary" id="aiSave">GUARDAR IA</button>
      </div>
      <div id="aiStatus" style="margin-top:12px"></div>
    </div>
  `;
}

function renderData(){
  return `
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>GESTIÓN DE DATOS</div></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn" id="btnExport">EXPORTAR ZENITH_DATABASE.json</button>
        <button class="btn" id="btnBackup">EXPORTAR BACKUP CON TIMESTAMP</button>
        <label class="btn" style="cursor:pointer">IMPORTAR DATOS<input type="file" id="btnImport" accept="application/json" hidden></label>
        <button class="btn btn-danger" id="btnReset">RESTAURAR BASE DE DATOS</button>
      </div>
    </div>
  `;
}

// ============================================================
// BIND
// ============================================================
export function bindConfigEvents(){
  const exitBtn = document.getElementById('btnExitViewFromConfig');
  if(exitBtn){
    exitBtn.addEventListener('click', () => {
      import('../services/seasons.js').then(({ switchToSeason }) => {
        switchToSeason(null);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    });
    return;
  }

  document.querySelectorAll('[data-config-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      configTab = btn.dataset.configTab;
      document.querySelectorAll('[data-config-tab]').forEach(b => b.classList.toggle('active', b===btn));
      const db = getDB();
      const ai = db.config.ai || {};
      document.getElementById('configContent').innerHTML = renderConfigTab(configTab, db, ai);
      bindConfigEvents();
    });
  });

  const db = getDB();

  document.getElementById('saveCfgGeneral')?.addEventListener('click', () => {
    const q = id => document.getElementById(id);
    mutate(d => {
      d.config.rosterRules = { starters: +q('cfgStarters').value, substitutes: +q('cfgSubs').value, max: +q('cfgMax').value };
      d.config.badStreak = { enabled: q('bsEnabled').checked, minGames: +q('bsMin').value, consecutiveLosses: +q('bsLosses').value, penalty: +q('bsPen').value };
      d.config.pigWeights = { goal: +q('pwGoal').value, assist: +q('pwAssist').value, save: +q('pwSave').value, missDivisor: +q('pwMiss').value };
    });
    logChange('update','config', null, 'Configuración general actualizada');
    toast('Configuración guardada','success');
  });

  document.querySelectorAll('[data-widget-toggle]').forEach(cb =>
    cb.addEventListener('change', () => {
      mutate(d => {
        const w = d.widgets.find(x => x.instanceId === cb.dataset.widgetToggle);
        if(w) w.enabled = cb.checked;
      });
      toast('Widget actualizado','success');
    }));

  document.querySelectorAll('[data-widget-remove]').forEach(btn =>
    btn.addEventListener('click', () => {
      if(!confirm('¿Eliminar esta instancia del widget?')) return;
      mutate(d => { d.widgets = d.widgets.filter(w => w.instanceId !== btn.dataset.widgetRemove); });
      toast('Widget eliminado','success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }));

  document.getElementById('resetWidgetsBtn')?.addEventListener('click', () => {
    if(!confirm('¿Restaurar la lista de widgets a los valores por defecto? Se perderán las copias.')) return;
    mutate(d => { d.widgets = getDefaultWidgets(); });
    toast('Widgets restaurados','success');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  document.getElementById('btnFinishSeason')?.addEventListener('click', () => {
    const currentDB = getDB();
    if(currentDB.viewSeasonId) return toast('📖 Estás en modo lectura.', 'error');
    openSeasonEndWarning();
  });

  document.getElementById('btnResetDivisions')?.addEventListener('click', () => {
    const currentDB = getDB();
    if(currentDB.viewSeasonId) return toast('📖 Estás en modo lectura.', 'error');
    if(!confirm('⚠️ ¿Resetear todas las divisiones?')) return;
    try {
      resetDivisions();
      toast('Divisiones reseteadas', 'success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(e){ toast('Error: ' + e.message, 'error'); }
  });

  document.getElementById('saveZones')?.addEventListener('click', () => {
    saveZonesConfig(db);
    logChange('update','zones', null, 'Clasificaciones actualizadas');
    toast('Clasificaciones guardadas','success');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  document.getElementById('resetZones')?.addEventListener('click', () => {
    if(!confirm('¿Restaurar clasificaciones por defecto?')) return;
    import('../data/database.js').then(({DEFAULT_ZONES}) => {
      mutate(d => {
        const div = d.divisions.find(x => x.id === (state.divisionId || d.divisions[0].id));
        if(div) div.config.zones = JSON.parse(JSON.stringify(DEFAULT_ZONES));
      });
      toast('Zonas restauradas','success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  });

  document.getElementById('btnNewDivision')?.addEventListener('click', () => {
    openModal({
      id: 'new-division', title: 'CREAR DIVISIÓN',
      body: `
        <div class="field"><label>Nombre</label><input class="input" id="newDivName" placeholder="Ej: ZENITH II"></div>
        <div class="field"><label>Tier</label><input class="input" type="number" id="newDivTier" value="${db.divisions.length + 1}"></div>
      `,
      footer: `<button class="btn btn-ghost" data-close>CANCELAR</button><button class="btn btn-primary" id="confirmNewDiv">CREAR</button>`,
      onMount: root => {
        root.querySelector('#confirmNewDiv').addEventListener('click', () => {
          try {
            const name = root.querySelector('#newDivName').value.trim();
            const tier = +root.querySelector('#newDivTier').value || 2;
            createDivision({ name, tier, visible: true });
            toast('División creada','success');
            closeTopModal();
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          } catch(e){ toast(e.message,'error'); }
        });
      }
    });
  });

  document.querySelectorAll('[data-div-visibility]').forEach(cb => {
    cb.addEventListener('change', () => {
      setDivisionVisibility(cb.dataset.divVisibility, cb.checked);
      toast('Visibilidad actualizada','success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  });
  document.querySelectorAll('[data-div-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if(!confirm('¿Eliminar esta división? Debe estar vacía.')) return;
      try {
        deleteDivision(btn.dataset.divDel);
        toast('División eliminada','success');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch(e){ toast(e.message,'error'); }
    });
  });
  document.querySelectorAll('[data-div-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const div = db.divisions.find(d => d.id === btn.dataset.divEdit);
      if(!div) return;
      openModal({
        id: 'edit-division-' + div.id, title: 'EDITAR DIVISIÓN',
        body: `
          <div class="field"><label>Nombre</label><input class="input" id="editDivName" value="${esc(div.name)}"></div>
          <div class="field"><label>Tier</label><input class="input" type="number" id="editDivTier" value="${div.tier}"></div>
        `,
        footer: `<button class="btn btn-ghost" data-close>CANCELAR</button><button class="btn btn-primary" id="confirmEditDiv">GUARDAR</button>`,
        onMount: root => {
          root.querySelector('#confirmEditDiv').addEventListener('click', () => {
            updateDivision(div.id, {
              name: root.querySelector('#editDivName').value.trim(),
              tier: +root.querySelector('#editDivTier').value
            });
            toast('División actualizada','success');
            closeTopModal();
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          });
        }
      });
    });
  });

  document.getElementById('movType')?.addEventListener('change', e => {
    const wrap = document.getElementById('movSwapWrap');
    if(wrap) wrap.style.display = e.target.value === 'swap' ? '' : 'none';
  });
  document.getElementById('movApplyAt')?.addEventListener('change', e => {
    const wrap = document.getElementById('movRoundWrap');
    if(wrap) wrap.style.display = e.target.value === 'roundN' ? '' : 'none';
  });
  document.getElementById('btnQueueMovement')?.addEventListener('click', () => {
    const type = document.getElementById('movType').value;
    const teamA = document.getElementById('movTeamA').value;
    const teamB = document.getElementById('movTeamB')?.value;
    const targetDiv = document.getElementById('movTargetDiv').value;
    const applyAt = document.getElementById('movApplyAt').value;
    const round = applyAt === 'roundN' ? +document.getElementById('movRound').value : null;
    const reason = document.getElementById('movReason').value.trim();
    try {
      if(type === 'swap'){
        if(!teamB) throw new Error('Selecciona ambos equipos');
        swapTeams(teamA, teamB, applyAt, round);
      } else {
        queueTeamMovement({ teamId: teamA, targetDivisionId: targetDiv, type, applyAt, roundNumber: round, reason });
      }
      toast('Movimiento aplicado','success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(e){ toast(e.message,'error'); }
  });

  if(configTab === 'trophies') bindTrophiesConfig();

  document.getElementById('aiToggleKey')?.addEventListener('click', () => {
    const el = document.getElementById('aiKey');
    el.type = el.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('aiListModels')?.addEventListener('click', async () => {
    const key = document.getElementById('aiKey').value.trim();
    if(!key) return toast('Introduce la API key primero','error');
    const status = document.getElementById('aiStatus');
    status.innerHTML = '<div class="card" style="padding:12px;font-size:12px">Consultando modelos…</div>';
    try {
      mutate(d => { d.config.ai.apiKey = key; });
      const models = await AIService.listModels();
      const select = document.getElementById('aiModel');
      const current = select.value;
      select.innerHTML = models.map(m => `<option value="${m}" ${m===current?'selected':''}>${m}</option>`).join('');
      status.innerHTML = `<div class="card" style="padding:12px;font-size:12px;color:var(--success)">✅ ${models.length} modelos disponibles.</div>`;
    } catch(e){
      status.innerHTML = `<div class="card" style="padding:12px;font-size:12px;color:var(--danger)">❌ ${e.message}</div>`;
    }
  });
  document.getElementById('aiResetPrompt')?.addEventListener('click', () => {
    if(!confirm('¿Restaurar el prompt por defecto?')) return;
    const ta = document.getElementById('aiPrompt');
    if(ta) ta.value = DEFAULT_SYSTEM_PROMPT;
    toast('Prompt restaurado','success');
  });
  document.getElementById('aiSave')?.addEventListener('click', () => {
    try {
      const high = (+document.getElementById('aiThresholdHigh').value || 90) / 100;
      const low = (+document.getElementById('aiThresholdLow').value || 50) / 100;
      const safeHigh = Math.max(0, Math.min(1, high));
      const safeLow = Math.max(0, Math.min(safeHigh, low));
      mutate(d => {
        d.config.ai = {
          provider: document.getElementById('aiProvider').value,
          model: document.getElementById('aiModel').value,
          apiKey: document.getElementById('aiKey').value.trim(),
          systemPrompt: document.getElementById('aiPrompt').value,
          matchThresholds: { high: safeHigh, low: safeLow }
        };
      });
      toast('Configuración IA guardada','success');
    } catch(e){ toast('Error: ' + e.message, 'error'); }
  });
  document.getElementById('aiTest')?.addEventListener('click', async () => {
    document.getElementById('aiSave').click();
    const status = document.getElementById('aiStatus');
    const btn = document.getElementById('aiTest');
    btn.disabled = true; btn.textContent = 'PROBANDO...';
    try {
      const res = await AIService.testConnection();
      status.innerHTML = `<div class="card" style="padding:12px;font-size:12px;color:var(--success)">✅ Conexión OK · ${res.models.length} modelos disponibles</div>`;
    } catch(e){
      status.innerHTML = `<div class="card" style="padding:12px;font-size:12px;color:var(--danger)">❌ ${e.message}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = 'PROBAR CONEXIÓN';
    }
  });

  document.getElementById('btnExport')?.addEventListener('click', () => { exportJSON(); toast('Base de datos exportada','success'); });
  document.getElementById('btnBackup')?.addEventListener('click', () => { exportBackup(); toast('Backup exportado','success'); });
  document.getElementById('btnImport')?.addEventListener('change', async e => {
    const f = e.target.files[0]; if(!f) return;
    try {
      await importJSON(f);
      toast('Datos importados','success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(err){ toast('Error al importar: '+err.message,'error'); }
  });
  document.getElementById('btnReset')?.addEventListener('click', () => {
    if(!confirm('¿Restaurar base de datos a valores por defecto?')) return;
    resetDB();
    toast('Base restaurada','success');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

// ============================================================
// FLUJO FIN DE TEMPORADA
// ============================================================
function openSeasonEndWarning(){
  let countdown = 5;
  let intervalId = null;

  openModal({
    id: 'season-end-warning',
    title: '⚠ TERMINAR TEMPORADA',
    body: `
      <div style="text-align:center;padding:8px 0 16px">
        <div style="font-size:52px;margin-bottom:12px">🏆</div>
        <h3 style="font-family:var(--font-display);letter-spacing:.14em;color:var(--silver-light);font-size:18px;margin-bottom:12px">¿TERMINAR LA TEMPORADA ACTUAL?</h3>
        <p style="color:var(--silver);font-size:13px;line-height:1.7;margin-bottom:16px">
          Esta acción archivará la temporada actual y creará una nueva.<br>
          <strong style="color:var(--gold)">No se puede deshacer.</strong>
        </p>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="seasonEndConfirm" disabled style="background:var(--gold);color:#04101F;border-color:var(--gold);font-weight:700;min-width:160px">ESPERA (5s)</button>
    `,
    onMount: root => {
      const btn = root.querySelector('#seasonEndConfirm');
      intervalId = setInterval(() => {
        countdown--;
        if(countdown <= 0){
          clearInterval(intervalId); intervalId = null;
          btn.disabled = false;
          btn.textContent = 'CONFIRMAR';
        } else {
          btn.textContent = `ESPERA (${countdown}s)`;
        }
      }, 1000);
      btn.addEventListener('click', () => {
        if(intervalId){ clearInterval(intervalId); intervalId = null; }
        closeTopModal();
        setTimeout(() => openSeasonEndCheck(), 180);
      });
    },
    onClose: () => { if(intervalId){ clearInterval(intervalId); intervalId = null; } }
  });
}

function openSeasonEndCheck(){
  let check;
  try { check = canFinishSeason(); }
  catch(e){ toast('Error: ' + e.message, 'error'); return; }

  if(!check.ok){
    openModal({
      id: 'season-end-errors',
      title: '❌ NO SE PUEDE TERMINAR',
      body: `
        <div style="text-align:center;padding:8px 0 16px">
          <div style="font-size:48px;margin-bottom:12px">⚠</div>
          <p style="color:var(--silver);font-size:13px;line-height:1.7;margin-bottom:14px">
            <strong style="color:var(--danger)">Faltan divisiones por terminar.</strong>
          </p>
          <div style="background:var(--bg-graphite);border:1px solid var(--border-soft);border-radius:8px;padding:14px;text-align:left;font-size:12.5px;color:var(--silver)">
            ${check.errors.map(e => `<div style="margin-bottom:4px">• ${esc(e)}</div>`).join('')}
          </div>
        </div>
      `,
      footer: `<button class="btn btn-primary" data-close>ENTENDIDO</button>`
    });
    return;
  }

  const db = getDB();
  const movementsPreview = [];
  check.divisionStatus.forEach(status => {
    const div = db.divisions.find(d => d.id === status.divisionId);
    if(!div) return;
    const cfg = div.config || {};
    if(cfg.promotion?.enabled && cfg.promotion.spots > 0){
      const superior = db.divisions.find(d => d.tier === div.tier - 1);
      if(superior){
        const st = computeStandings(div.id, check.seasonId);
        st.slice(0, cfg.promotion.spots).forEach(t => movementsPreview.push({ team: t.name, from: div.name, to: superior.name, type: 'ASCENSO' }));
      }
    }
    if(cfg.relegation?.enabled && cfg.relegation.spots > 0){
      const inferior = db.divisions.find(d => d.tier === div.tier + 1);
      if(inferior){
        const st = computeStandings(div.id, check.seasonId);
        st.slice(-cfg.relegation.spots).forEach(t => movementsPreview.push({ team: t.name, from: div.name, to: inferior.name, type: 'DESCENSO' }));
      }
    }
  });

  const autoTrophies = db.config.seasonEnd?.autoAssignTrophies !== false;

  openModal({
    id: 'season-end-final',
    title: '🏆 CONFIRMACIÓN FINAL',
    wide: true,
    body: `
      <h3 style="font-family:var(--font-display);letter-spacing:.12em;color:var(--silver-light);font-size:14px;margin-bottom:10px">CAMPEONES POR DIVISIÓN</h3>
      <div class="table-wrap" style="margin-bottom:20px">
        <table class="ztable">
          <thead><tr><th>DIVISIÓN</th><th>CAMPEÓN</th><th>FUENTE</th></tr></thead>
          <tbody>${check.divisionStatus.map(d => `<tr><td>${esc(d.divisionName)}</td><td>${d.champion ? `<strong style="color:var(--gold)">${esc(d.champion.teamName)}</strong>` : '—'}</td><td><span class="chip" style="font-size:9.5px">${d.championType === 'playoffs' ? 'Playoffs' : 'Tabla'}</span></td></tr>`).join('')}</tbody>
        </table>
      </div>
      ${movementsPreview.length > 0 ? `
        <h3 style="font-family:var(--font-display);letter-spacing:.12em;color:var(--silver-light);font-size:14px;margin-bottom:10px">MOVIMIENTOS A APLICAR</h3>
        <div class="table-wrap" style="margin-bottom:20px">
          <table class="ztable">
            <thead><tr><th>EQUIPO</th><th>DESDE</th><th>HASTA</th><th>TIPO</th></tr></thead>
            <tbody>${movementsPreview.map(mv => `<tr><td>${esc(mv.team)}</td><td style="color:var(--muted)">${esc(mv.from)}</td><td style="color:var(--accent)">${esc(mv.to)}</td><td><span class="chip" style="font-size:9.5px;${mv.type === 'ASCENSO' ? 'color:var(--success)' : 'color:var(--danger)'}">${mv.type}</span></td></tr>`).join('')}</tbody>
          </table>
        </div>
      ` : ''}
      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--silver-light);cursor:pointer;padding:12px;background:var(--bg-graphite);border:1px solid var(--border-soft);border-radius:8px">
        <input type="checkbox" id="seasonEndAutoTrophies" ${autoTrophies ? 'checked' : ''}>
        🏆 Asignar trofeos automáticamente a campeones, ascendidos y sus jugadores
      </label>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="seasonEndExecute" style="background:var(--gold);color:#04101F;border-color:var(--gold);font-weight:700">✅ CONFIRMAR Y TERMINAR</button>
    `,
    onMount: root => {
      root.querySelector('#seasonEndExecute').addEventListener('click', () => {
        try {
          const autoT = root.querySelector('#seasonEndAutoTrophies').checked;
          const result = finishSeason({ autoAssignTrophies: autoT });
          closeTopModal();
          toast(`✅ ${result.archivedSeasonName} archivada. Ahora estás en ${result.newSeasonName}.`, 'success');
          setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 300);
        } catch(e){ toast('Error: ' + e.message, 'error'); }
      });
    }
  });
}

// ============================================================
// HELPERS
// ============================================================
function saveZonesConfig(db){
  const activeDivisionId = state.divisionId || db.divisions[0].id;
  const selects = document.querySelectorAll('[data-zone-pos]');
  const assignments = [];
  selects.forEach(sel => assignments.push({ pos: +sel.dataset.zonePos, type: sel.value }));

  const ranges = [];
  let current = null;
  const defaultColors = Object.fromEntries(ZONE_TYPES.map(z => [z.id, z.color]));
  assignments.forEach(a => {
    if(!current || current.type !== a.type){
      if(current) ranges.push(current);
      current = { from: a.pos, to: a.pos, type: a.type, color: defaultColors[a.type] || 'transparent' };
    } else {
      current.to = a.pos;
    }
  });
  if(current) ranges.push(current);

  const hasTop1Highlight = document.getElementById('zoneShowTop1').checked;

  mutate(d => {
    const div = d.divisions.find(x => x.id === activeDivisionId);
    if(!div) return;
    div.config.zones = { hasTop1Highlight, zones: ranges };

    const playoffZone    = ranges.find(z => z.type === 'playoff');
    const playInZone     = ranges.find(z => z.type === 'playin');
    const promotionZone  = ranges.find(z => z.type === 'promotion');
    const relegationZone = ranges.find(z => z.type === 'relegation');

    // ✅ FIX: cantidad de equipos (to - from + 1), y 0 si no existe la zona
    div.config.playoffSpots = playoffZone ? (playoffZone.to - playoffZone.from + 1) : 0;
    div.config.playInSpots  = playInZone  ? (playInZone.to  - playInZone.from  + 1) : 0;

    div.config.promotion = {
      ...(div.config.promotion || {}),
      enabled: !!promotionZone,
      spots: promotionZone ? (promotionZone.to - promotionZone.from + 1) : 0
    };
    div.config.relegation = {
      ...(div.config.relegation || {}),
      enabled: !!relegationZone,
      spots: relegationZone ? (relegationZone.to - relegationZone.from + 1) : 0
    };
  });
}

function compressImage(file, maxW, maxH){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(maxW / width, maxH / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/webp', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}