// ==UserScript==
// @name         Narrow.one - Kill Feed
// @namespace    lumos.narrow-one
// @version      1.0
// @description  Kill feed in the top right: server-confirmed kills, fall and spike deaths, flag grabs/captures/drops/returns. Text size, font and display time are set from the Kill Feed button in the main menu.
// @author       Lumos
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiMxYjIyMzAiLz48cmVjdCB4PSIzMCIgeT0iMTMiIHdpZHRoPSIyNCIgaGVpZ2h0PSI3IiByeD0iMy41IiBmaWxsPSIjZmY1ZDU1Ii8+PHJlY3QgeD0iMzYiIHk9IjI4LjUiIHdpZHRoPSIxOCIgaGVpZ2h0PSI3IiByeD0iMy41IiBmaWxsPSIjZjJmMmYyIi8+PHJlY3QgeD0iMzAiIHk9IjQ0IiB3aWR0aD0iMjQiIGhlaWdodD0iNyIgcng9IjMuNSIgZmlsbD0iIzYyYWRmZiIvPjxwYXRoIGQ9Ik05IDMyaDE3IiBzdHJva2U9IiNmMmYyZjIiIHN0cm9rZS13aWR0aD0iNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PHBhdGggZD0iTTIxIDI1bDkgNy05IDd6IiBmaWxsPSIjZjJmMmYyIi8+PHBhdGggZD0iTTkgMzJsLTMtNU05IDMybC0zIDVNMTMgMzJsLTMtNU0xMyAzMmwtMyA1IiBzdHJva2U9IiNmZmQ1NGEiIHN0cm9rZS13aWR0aD0iMi42IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48L3N2Zz4=
// @match        https://narrow.one/*
// @run-at       document-end
// @grant        none
// @noframes
// ==/UserScript==

// 동작 근거 (정찰 v1·v2, 2026-10-30, index-CGd_1Yik.js 에서 확인)
//  - 킬 판정: game.verifiedKillByServer(victimId, killerId).
//    마지막 피격자 킬(피격 후 낙사·가시)도 서버가 이 함수로 알려 준다.
//    내 죽음은 die → (100~200ms) → 킬 판정, 남의 킬은 킬 판정 → (~10ms) → die 순서로 온다.
//  - 사망: player.die(). 죽은 뒤에도 반복 호출될 수 있으므로 "살아 있다가 죽는 순간"만 센다.
//  - 낙사: die 직후 player.deadFromFall === true.
//  - 가시 등 맵 피해: 죽기 직전 player.applyDamage(amount, dir, 'environment').
//    (낙사·가시 신호는 게임이 그 플레이어에 대해 계산할 때만 존재한다. 확인된 것은 내 플레이어.
//     신호가 없으면 원인을 추측하지 않고 "died"로 표시한다.)
//  - 깃발: game.playerChangeFlag(playerId, flagId, op). op 0 잡기, 1 캡처, 2 떨어뜨림, 3 리턴.
//    떨어뜨릴 때 같은 op 2가 두 번 오는데, 두 번째는 들고 있던 사람이 없는 상태라 무시한다.
//  - 팀 1 = 빨강, 팀 2 = 파랑 (게임 아이콘 경로 flag/red 가 팀 1 깃발에서 쓰임).
(() => {
  'use strict';

  const BOOT = Symbol.for('n1kf.boot');
  if (window[BOOT]) return;
  Object.defineProperty(window, BOOT, { value: true });

  const VERSION = '1.0';

  // ───────── 고정 설정 ─────────
  const CFG = {
    maxLines: 6,        // 동시에 보이는 줄 수
    fadeMs: 350,        // 사라지는 애니메이션 시간
    pendingMs: 700,     // 킬러 없는 죽음은 이만큼 킬 판정을 기다렸다가 표시
    mergeMs: 3000,      // 같은 피해자의 죽음·킬 판정을 한 사건으로 묶는 시간
    envWindowMs: 500,   // 죽기 직전 이 시간 안의 맵 피해만 사망 원인으로 인정
    flagDedupeMs: 300,  // 같은 깃발·같은 op 중복 무시 시간
    pollMs: 100,        // 상태 점검 주기
    pushWindowMs: 150,  // 매치를 찾는 push 훅을 한 번에 켜 두는 시간
    pushPeriodMs: 600,  // 매치가 없을 때 push 훅을 다시 켜는 주기 (나머지 시간엔 꺼 둠)
  };
  // 글자 안쪽은 흰색, 테두리를 아래 색으로 그린다 (게임 자체 킬피드 스타일).
  // 빛 번짐은 같은 색을 반투명(GLOW_ALPHA)으로 작게만 깐다.
  const TEAM = {
    1: { name: 'Red', color: '#e8364a' },
    2: { name: 'Blue', color: '#2a7fe0' },
  };
  const NEUTRAL = '#6670c4';   // 일반 문구·팀 모를 때의 테두리 색 (보라)
  const TAG_COLOR = '#787878'; // (fell) 같은 괄호 문구
  const GLOW_ALPHA = '66';     // 빛 번짐 불투명도 (16진수, 66 ≈ 40%)
  const KILL_ICON = '🏹';
  const CAUSE = {
    fall: { alone: 'fell to their death', tag: 'fell' },
    spikes: { alone: 'was impaled by spikes', tag: 'spikes' },
  };
  const FLAG_OP = { 0: 'Grabbed', 1: 'Captured', 2: 'Dropped', 3: 'Returned' };
  const FLAG_OP_COLOR = { 0: NEUTRAL, 1: '#e09a00', 2: '#e2611b', 3: '#25a656' };

  // ───────── 사용자 설정 (메인 메뉴 → Kill Feed) ─────────
  // 한글 닉네임은 고른 글꼴에 한글이 없으면 아래 글꼴로 대신 그려진다
  // textCase: BlueNight 는 대문자 글자가 없고 소문자 자리에 대문자 모양 글자가 들어 있다.
  //   그래서 게임도 BlueNight 글자에 text-transform: lowercase 를 건다. 같은 처리를 해야 전부 대문자 모양으로 보인다.
  //   (uppercase 로 바꾸면 글꼴에 없는 글자가 되어 다음 후보인 고딕 글꼴로 그려진다. 한글은 영향 없음)
  const CJK_FALLBACK = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  const FONTS = [
    { id: 'game',      label: 'Narrow One',      css: 'BlueNight, Ubuntu',                                    weight: 400, strong: 400, textCase: 'lowercase' },
    { id: 'chat',      label: 'Game chat font',  css: 'Ubuntu',                                               weight: 700, strong: 800 },
    { id: 'sans',      label: 'Sans-serif',      css: 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial', weight: 700, strong: 800 },
    { id: 'serif',     label: 'Serif',           css: 'Georgia, "Times New Roman", Times, serif',             weight: 700, strong: 700 },
    { id: 'arial',     label: 'Arial',           css: 'Arial, Helvetica',                                     weight: 700, strong: 700 },
    { id: 'verdana',   label: 'Verdana',         css: 'Verdana, Geneva',                                      weight: 700, strong: 700 },
    { id: 'tahoma',    label: 'Tahoma',          css: 'Tahoma, Geneva',                                       weight: 700, strong: 700 },
    { id: 'trebuchet', label: 'Trebuchet MS',    css: '"Trebuchet MS", Helvetica',                            weight: 700, strong: 700 },
    { id: 'times',     label: 'Times New Roman', css: '"Times New Roman", Times, serif',                      weight: 700, strong: 700 },
    { id: 'mono',      label: 'Monospace',       css: 'Consolas, Menlo, "Courier New", monospace',            weight: 700, strong: 700 },
    { id: 'impact',    label: 'Impact',          css: 'Impact, "Arial Black", Haettenschweiler',              weight: 400, strong: 400 },
    { id: 'comic',     label: 'Comic Sans',      css: '"Comic Sans MS", "Comic Sans", "Chalkboard SE"',       weight: 700, strong: 700 },
  ];
  const SETTING_DEFS = {
    enabled:  { def: true },                                          // 킬피드 켜기/끄기
    size:     { min: 60, max: 200, step: 5,   def: 100, unit: '%' },   // 글씨 크기 배율
    duration: { min: 2,  max: 20,  step: 0.5, def: 6,   unit: 's' },   // 한 줄이 떠 있는 시간(초)
    font:     { def: 'game' },
  };
  const STORE_KEY = 'n1kf.settings.v1';

  function snap(def, v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def.def;
    const clamped = Math.min(def.max, Math.max(def.min, n));
    const stepped = def.min + Math.round((clamped - def.min) / def.step) * def.step;
    return +stepped.toFixed(3);
  }
  const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS.find((f) => f.id === SETTING_DEFS.font.def);

  const settings = { enabled: SETTING_DEFS.enabled.def, size: SETTING_DEFS.size.def, duration: SETTING_DEFS.duration.def, font: SETTING_DEFS.font.def };
  (function loadSettings() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch {}
    if (!raw || typeof raw !== 'object') return;
    if (typeof raw.enabled === 'boolean') settings.enabled = raw.enabled;
    if ('size' in raw) settings.size = snap(SETTING_DEFS.size, raw.size);
    if ('duration' in raw) settings.duration = snap(SETTING_DEFS.duration, raw.duration);
    if (typeof raw.font === 'string' && FONTS.some((f) => f.id === raw.font)) settings.font = raw.font;
  })();

  let saveTimer = 0;
  function saveSettings(now) {
    clearTimeout(saveTimer);
    const write = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch {} };
    if (now) write(); else saveTimer = setTimeout(write, 300);   // 슬라이더를 끄는 동안 매번 쓰지 않는다
  }

  const lifetimeMs = () => Math.round(settings.duration * 1000);

  const now = () => performance.now();

  // ───────── 상태 ─────────
  const S = {
    game: null,                // 지금 표시 중인 매치
    ended: new WeakSet(),      // 끝난 매치 (다시 잡지 않음)
    pushDisarm: null,
    lastArm: -Infinity,        // push 훅을 마지막으로 켠 시각
    pollTimer: 0,
    hookedGame: false,
    hookedPlayer: false,
    missing: [],
    incidents: new Map(),      // 피해자 id → 사건 (죽음·킬 판정 묶음)
    deadSeen: new Set(),       // 이미 죽음을 처리한 플레이어 id
    names: new Map(),          // id → { name, team } (나간 플레이어도 표시하기 위한 캐시)
    lastDmg: new Map(),        // id → { type, t }
    flagSeen: new Map(),       // 'flagId:op' → t
    lines: new Set(),
    visible: false,
    reported: new Set(),
  };

  function report(e) {
    const key = String(e && e.message || e);
    if (S.reported.has(key)) return;
    S.reported.add(key);
    console.warn('[n1kf] 내부 오류 (게임 동작에는 영향 없음):', e);
  }

  // ───────── 게임 객체 판별 ─────────
  const isPlayer = (v) => { try { return !!v && typeof v === 'object' && 'hasOwnership' in v && 'teamId' in v && 'id' in v; } catch { return false; } };
  const isGame = (g) => {
    try {
      return !!g && typeof g === 'object' && Array.isArray(g.flags) &&
        typeof g.createFlag === 'function' && g.players instanceof Map;
    } catch { return false; }
  };
  const isLiveGame = (g) => isGame(g) && !S.ended.has(g) && !g.destructed && !g.gameEnded;

  // 이벤트를 보낸 game 이 표시 대상인지 확인하고, 새 매치면 전환한다
  function accept(g) {
    if (!settings.enabled) return false;
    if (g && g === S.game) return !g.destructed && !g.gameEnded;
    if (!isLiveGame(g) || g.isForegroundGame === false) return false;
    S.game = g;
    resetMatch();
    if (S.pushDisarm) S.pushDisarm();
    installHooks(g);
    return true;
  }

  function resetMatch() {
    for (const inc of S.incidents.values()) { clearTimeout(inc.pendingTimer); clearTimeout(inc.closeTimer); }
    S.incidents.clear();
    S.deadSeen.clear();
    S.names.clear();
    S.lastDmg.clear();
    S.flagSeen.clear();
    for (const line of [...S.lines]) removeLine(line);
    // 들어온 시점에 이미 죽어 있는 플레이어는 알리지 않는다
    try {
      if (S.game) for (const p of S.game.players.values()) { if (p && p.dead) S.deadSeen.add(p.id); }
    } catch {}
  }

  // ───────── game 찾기: 충돌 기록 push 에서 game 을 찾으면 즉시 원래대로 ─────────
  function peekGame(item) {
    try {
      if (!item || typeof item !== 'object') return null;
      const pc = item.playerCollider;
      if (!pc) return null;
      const g = pc.rigidBody && pc.rigidBody.player && pc.rigidBody.player.game;
      return isLiveGame(g) && g.isForegroundGame !== false ? g : null;
    } catch { return null; }
  }

  // push 는 페이지의 모든 배열 추가가 거치는 함수라, 감싸 두는 시간을 최소로 한다.
  // 매치가 없을 때 pushPeriodMs 마다 pushWindowMs 동안만 켠다. 물리 엔진은 매 프레임 push 하므로 이 시간이면 충분히 잡힌다.
  function armPush() {
    if (S.pushDisarm || !settings.enabled) return;
    S.lastArm = now();
    const origPush = Array.prototype.push;
    let done = false;
    let timer = 0;
    const hook = function () {
      if (!done) {
        for (let i = 0; i < arguments.length; i++) {
          const g = peekGame(arguments[i]);
          if (g) {
            disarm();
            setTimeout(() => { try { accept(g); } catch (e) { report(e); } }, 0);
            break;
          }
        }
      }
      return origPush.apply(this, arguments);
    };
    const disarm = () => {
      done = true;
      clearTimeout(timer);
      if (Array.prototype.push === hook) Array.prototype.push = origPush;
      if (S.pushDisarm === disarm) S.pushDisarm = null;
    };
    Array.prototype.push = hook;
    S.pushDisarm = disarm;
    timer = setTimeout(disarm, CFG.pushWindowMs);
  }

  // ───────── 메서드 감싸기 ─────────
  // before/after 쪽 오류는 삼키고, 원래 함수의 this·인자·반환값·예외는 그대로 둔다.
  const hooks = [];   // { owner, name, desc, orig, wrapped }

  function hookMethod(start, name, hook) {
    let owner = start;
    while (owner && owner !== Object.prototype && !Object.prototype.hasOwnProperty.call(owner, name)) {
      owner = Object.getPrototypeOf(owner);
    }
    const desc = owner && owner !== Object.prototype ? Object.getOwnPropertyDescriptor(owner, name) : null;
    if (!desc || typeof desc.value !== 'function') { S.missing.push(name); return false; }
    const orig = desc.value;
    const wrapped = function () {
      // 끈 뒤에도 다른 스크립트가 우리 위에 덮어써서 원래대로 못 돌린 경우: 그냥 통과
      if (!settings.enabled) return orig.apply(this, arguments);
      let ctx;
      if (hook.before) { try { ctx = hook.before(this, arguments); } catch (e) { report(e); } }
      const ret = orig.apply(this, arguments);
      if (hook.after) { try { hook.after(this, arguments, ctx); } catch (e) { report(e); } }
      return ret;
    };
    const h = { owner, name, desc, orig, wrapped };
    if (!setHook(h, true)) { S.missing.push(name); return false; }
    hooks.push(h);
    return true;
  }

  // on=true 면 우리 함수로, false 면 원래 함수로 바꾼다.
  // 다른 스크립트가 그 사이 덮어썼으면 그쪽 연결을 끊지 않도록 건드리지 않는다.
  function setHook(h, on) {
    const from = on ? h.orig : h.wrapped;
    const to = on ? h.wrapped : h.orig;
    const cur = Object.getOwnPropertyDescriptor(h.owner, h.name);
    if (!cur) return false;
    if (cur.value === to) return true;
    if (cur.value !== from) return false;
    try {
      if (h.desc.configurable) Object.defineProperty(h.owner, h.name, { ...h.desc, value: to });
      else if (h.desc.writable) h.owner[h.name] = to;
      else return false;
    } catch (e) { report(e); return false; }
    const after = Object.getOwnPropertyDescriptor(h.owner, h.name);
    return !!after && after.value === to;
  }

  function installHooks(g) {
    if (!S.hookedGame) {
      S.hookedGame = true;
      const proto = Object.getPrototypeOf(g);
      hookMethod(proto, 'verifiedKillByServer', { after: onKillHook });
      hookMethod(proto, 'playerChangeFlag', { before: flagBefore, after: onFlagHook });
    }
    if (!S.hookedPlayer) {
      let first = null;
      try { for (const p of g.players.values()) { if (isPlayer(p)) { first = p; break; } } } catch {}
      if (!first) return; // 플레이어가 생기면 poll 이 다시 시도
      S.hookedPlayer = true;
      const proto = Object.getPrototypeOf(first);
      hookMethod(proto, 'die', { before: (p) => ({ wasDead: !!p.dead }), after: onDieHook });
      hookMethod(proto, 'applyDamage', { after: onDamageHook });
    }
    if (S.missing.length) {
      console.warn('[n1kf] 게임 업데이트로 찾지 못한 함수:', S.missing.join(', '), '— 해당 기능은 표시되지 않습니다.');
      S.missing = [];
    }
  }

  // ───────── 이벤트 처리 ─────────
  function remember(p) {
    if (!p || p.id == null) return;
    const name = String(p.playerName == null ? '' : p.playerName).trim();
    S.names.set(p.id, { name: name || 'Player ' + p.id, team: p.teamId });
  }
  function playerOf(g, id) { try { return g.players.get(id) || null; } catch { return null; } }
  function infoOf(id) { return S.names.get(id) || { name: 'Player ' + id, team: null }; }

  function onKillHook(g, args) {
    if (!accept(g)) return;
    const victimId = args[0];
    const killerId = args[1];
    const victim = playerOf(g, victimId);
    const killer = playerOf(g, killerId);
    remember(victim);
    remember(killer);
    // 킬러가 없거나 자기 자신이면 킬로 표시하지 않는다 (사망 경로에서 처리)
    if (killerId == null || killerId === victimId || (!killer && !S.names.has(killerId))) return;
    let inc = S.incidents.get(victimId);
    // 이미 끝난 죽음(그 사이 리스폰해서 살아 있음)에는 새 킬을 붙이지 않는다.
    // 내 죽음은 die 가 먼저 와서 킬 판정 때 아직 죽어 있고, 남의 킬은 킬 판정이 먼저라 inc.died 가 false 다.
    const respawned = inc && inc.died && victim && !victim.dead;
    if (inc && (inc.killer != null || respawned || now() - inc.t > CFG.mergeMs)) inc = null;
    if (!inc) inc = openIncident(victimId);
    inc.killer = killerId;
    render(inc);
  }

  function onDieHook(p, args, ctx) {
    if (!ctx || ctx.wasDead || !p.dead) return;      // 이미 죽은 상태의 반복 호출
    if (!accept(p.game)) return;
    // dieFromFall 안에서 die 가 불리므로, 낙사 표시는 그 함수가 끝난 뒤에 읽는다
    queueMicrotask(() => { try { onDeath(p); } catch (e) { report(e); } });
  }

  function onDamageHook(p, args) {
    if (p && p.id != null && typeof args[2] === 'string') S.lastDmg.set(p.id, { type: args[2], t: now() });
  }

  function causeOf(p) {
    try { if (p.deadFromFall === true) return 'fall'; } catch {}
    const d = S.lastDmg.get(p.id);
    if (d && d.type === 'environment' && now() - d.t <= CFG.envWindowMs) return 'spikes';
    return null;
  }

  function onDeath(p) {
    if (!p || p.id == null || S.deadSeen.has(p.id)) return;
    if (!S.game || p.game !== S.game) return;
    S.deadSeen.add(p.id);
    remember(p);
    let inc = S.incidents.get(p.id);
    if (inc && (inc.died || now() - inc.t > CFG.mergeMs)) inc = null; // 빠른 리스폰 후 또 죽음 → 새 사건
    if (!inc) inc = openIncident(p.id);
    inc.died = true;
    const cause = causeOf(p);
    if (cause) inc.cause = cause;
    if (inc.killer != null || inc.line) render(inc);
    else if (!inc.pendingTimer) inc.pendingTimer = setTimeout(() => { inc.pendingTimer = 0; render(inc); }, CFG.pendingMs);
  }

  function openIncident(victimId) {
    const prev = S.incidents.get(victimId);
    if (prev) { clearTimeout(prev.pendingTimer); clearTimeout(prev.closeTimer); }
    const inc = { victimId, t: now(), killer: null, cause: null, died: false, line: null, pendingTimer: 0, closeTimer: 0 };
    inc.closeTimer = setTimeout(() => {
      if (S.incidents.get(victimId) === inc) S.incidents.delete(victimId);
    }, CFG.mergeMs);
    S.incidents.set(victimId, inc);
    return inc;
  }

  function closeIncident(victimId) {
    const inc = S.incidents.get(victimId);
    if (!inc || !inc.died) return;
    if (inc.pendingTimer) render(inc);   // 아직 그리지 못한 죽음은 지금 그린다
    clearTimeout(inc.closeTimer);
    S.incidents.delete(victimId);
  }

  function flagBefore(g, args) {
    try {
      const flag = g.flags.find((f) => f && f.id === args[1]);
      return { hadHolder: !!(flag && flag.currentHoldingPlayer), team: flag ? flag.teamId : null };
    } catch { return { hadHolder: false, team: null }; }
  }

  function onFlagHook(g, args, ctx) {
    if (!accept(g)) return;
    const flagId = args[1];
    const op = args[2];
    if (!(op in FLAG_OP)) return;
    if (op === 2 && !(ctx && ctx.hadHolder)) return;   // 두 번째 떨어뜨림 메시지
    const key = flagId + ':' + op;
    const t = now();
    if (t - (S.flagSeen.get(key) || -Infinity) < CFG.flagDedupeMs) return;
    S.flagSeen.set(key, t);
    let team = ctx ? ctx.team : null;
    if (team == null) { try { const f = g.flags.find((x) => x && x.id === flagId); team = f ? f.teamId : null; } catch {} }
    const line = addLine();
    if (line) fillFlagLine(line.el, team, op);
  }

  // ───────── 상태 점검 ─────────
  function poll() {
    try {
      const g = S.game;
      if (g && (g.destructed || g.gameEnded)) {
        S.ended.add(g);
        S.game = null;
        resetMatch();
      }
      if (!S.game) {
        setVisible(false);
        if (now() - S.lastArm >= CFG.pushPeriodMs) armPush();
        return;
      }
      setVisible(g.uiVisible !== false && g.isForegroundGame !== false);
      if (!S.hookedPlayer) installHooks(g);
      for (const p of g.players.values()) {
        if (!p || p.id == null) continue;
        if (p.dead) {
          // die 를 거치지 않은 죽음이 있어도 놓치지 않도록 하는 보조 경로
          if (!S.deadSeen.has(p.id)) onDeath(p);
        } else if (S.deadSeen.delete(p.id)) {
          closeIncident(p.id);   // 리스폰: 이전 죽음 사건을 닫아 다음 죽음과 섞이지 않게
        }
      }
    } catch (e) { report(e); }
  }

  // ───────── 켜기 / 끄기 ─────────
  // 끄면: 상태 점검 중지, push 훅 해제, 게임 함수 4개를 원래대로 되돌림, 표시 중인 줄 삭제.
  // 남는 것은 메인 메뉴 버튼(1초에 한 번 있는지 확인)과 Esc 키 확인뿐이다.
  function startFeed() {
    for (const h of hooks) setHook(h, true);
    S.game = null;
    resetMatch();
    S.lastArm = -Infinity;
    if (!S.pollTimer) S.pollTimer = setInterval(poll, CFG.pollMs);
    poll();
  }

  function stopFeed() {
    clearInterval(S.pollTimer);
    S.pollTimer = 0;
    if (S.pushDisarm) S.pushDisarm();
    for (const h of hooks) setHook(h, false);
    S.game = null;
    resetMatch();
    setVisible(false);
  }

  function setEnabled(on) {
    on = !!on;
    if (settings.enabled !== on) {
      settings.enabled = on;
      saveSettings(true);
      if (on) startFeed(); else stopFeed();
    }
    updateMenuLabel();
    syncDialog();
  }

  // ───────── 스타일 ─────────
  // 피드 글자 모양은 .n1kf-feed 에 있어서 실제 피드와 설정창 미리보기가 똑같이 그려진다.
  // 설정창은 게임 클래스(dialog, wrinkledPaper …)를 빌려 쓰고 색은 정하지 않는다 → 게임·테마 스크립트를 따라감.
  // CSS 문자열 안에는 블록 주석(슬래시+별표)을 두지 않는다. 메신저로 코드를 붙여 보내면 * 가 서식 기호로 지워져
  // 주석이 안 닫히고 뒤의 규칙들까지 주석으로 먹히는 일이 실제로 있었다. 설명은 아래 // 주석에 둔다.
  //  - .n1kf-line 과 그 안의 모든 요소에 text-shadow 를 선언: 요소마다 자기 --c(테두리 색)·--g(번짐 색)로 계산되게 하려고
  //  - 깃발 줄은 크게·굵게, 슬라이더·스위치·점선은 글자색(currentColor)을 따라가 테마에 맞춘다
  //  - 기본값 눈금 위치는 슬라이더 엄지(18px) 중심과 같은 식으로 계산
  //  - 메인 메뉴 버튼은 게임 버튼을 복제하고 그림만 바꾼다
  const CSS = `
.n1kf-feed {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  pointer-events: none;
  user-select: none;
  font-family: var(--n1kf-font);
  font-size: calc(clamp(12px, 1.05vw, 18px) * var(--n1kf-scale, 1));
  font-weight: var(--n1kf-weight, 700);
  font-style: normal;
  letter-spacing: normal;
  line-height: 1.3;
  color: #fff;
  text-transform: var(--n1kf-case, none);
  text-align: right;
  --c: ${NEUTRAL};
  --g: ${NEUTRAL}${GLOW_ALPHA};
  --o: max(1px, .06em);
}
.n1kf-feed .n1kf-line,
.n1kf-feed .n1kf-line * {
  text-shadow:
    calc(-1 * var(--o)) calc(-1 * var(--o)) 0 var(--c),
    0 calc(-1 * var(--o)) 0 var(--c),
    var(--o) calc(-1 * var(--o)) 0 var(--c),
    calc(-1 * var(--o)) 0 0 var(--c),
    var(--o) 0 0 var(--c),
    calc(-1 * var(--o)) var(--o) 0 var(--c),
    0 var(--o) 0 var(--c),
    var(--o) var(--o) 0 var(--c),
    0 0 .2em var(--g),
    0 .06em .12em rgba(0, 0, 0, .6);
}
#n1kf-root {
  position: fixed;
  top: 19%;
  right: max(14px, env(safe-area-inset-right));
  z-index: 50;
  max-width: min(46vw, 560px);
}
#n1kf-root.n1kf-hidden { display: none; }
.n1kf-feed .n1kf-line {
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  animation: n1kf-in .2s ease-out;
}
.n1kf-feed .n1kf-line.n1kf-out { animation: n1kf-out ${CFG.fadeMs}ms ease-in forwards; }
.n1kf-feed .n1kf-name {
  display: inline-block;
  max-width: 14em;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}
.n1kf-feed .n1kf-line .n1kf-icon { margin: 0 .35em; text-shadow: none; }
.n1kf-feed .n1kf-flag {
  font-size: 1.22em;
  font-weight: var(--n1kf-weight-strong, 800);
  margin: 2px 0;
}
.n1kf-feed .n1kf-flag svg {
  width: .95em;
  height: .95em;
  margin-right: .3em;
  vertical-align: -.1em;
  filter: drop-shadow(0 0 1px var(--c)) drop-shadow(0 0 2px var(--g)) drop-shadow(0 1px 1px rgba(0,0,0,.5));
}
@keyframes n1kf-in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
@keyframes n1kf-out { to { opacity: 0; transform: translateX(10px); } }

#n1kf-curtain {
  position: fixed; inset: 0; z-index: 99998;
  transition: opacity .2s ease, visibility .2s ease;
}
#n1kf-curtain.n1kf-closed { opacity: 0; visibility: hidden; pointer-events: none; }
#n1kf-dialog {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 520px; max-width: calc(100% - 20px);
  max-height: calc(100vh - 40px); overflow-y: auto;
  box-sizing: border-box; padding: 30px;
  z-index: 99999;
  transition: transform .2s cubic-bezier(0.3,-0.8,0.7,1.8),
              opacity .2s cubic-bezier(0.3,-0.8,0.7,1.8),
              visibility .2s cubic-bezier(0.3,-0.8,0.7,1.8);
}
#n1kf-dialog.n1kf-closed {
  transform: translate(-50%, -50%) scale(.6);
  opacity: 0; visibility: hidden; pointer-events: none;
}
#n1kf-dialog .dialogTitle { margin: 0 0 14px; }
#n1kf-dialog .n1kf-version { font-size: 14px; opacity: .5; }
#n1kf-dialog .n1kf-preview {
  position: static;
  max-width: none;
  min-height: 5.2em;
  justify-content: center;
  padding: 12px 16px;
  border-radius: 10px;
  overflow: hidden;
  background: linear-gradient(135deg, #4a5a6e, #26323f);
  box-shadow: inset 0 0 0 2px rgba(0,0,0,.25);
}
#n1kf-dialog .n1kf-preview .n1kf-line { animation: none; }
#n1kf-dialog .n1kf-section { margin-top: 20px; }
#n1kf-dialog .n1kf-power { margin: 0 0 14px; }
#n1kf-dialog .n1kf-note { margin: 4px 0 0; font-size: 14px; opacity: .7; }
#n1kf-dialog .n1kf-switchwrap { display: flex; align-items: center; gap: 10px; }
#n1kf-dialog .n1kf-switch {
  position: relative; flex: none; box-sizing: border-box;
  width: 58px; height: 30px; margin: 0; padding: 0; min-width: 0;
  -webkit-appearance: none; appearance: none;
  border: 2px solid currentColor; border-radius: 15px;
  background: transparent; box-shadow: none; color: inherit; font: inherit;
  cursor: pointer;
  transition: background-color .15s ease;
}
#n1kf-dialog .n1kf-switch::after {
  content: ''; position: absolute; top: 3px; left: 3px;
  width: 20px; height: 20px; border-radius: 50%;
  background: currentColor; opacity: .45;
  transition: transform .15s ease, opacity .15s ease;
}
#n1kf-dialog .n1kf-switch[aria-checked="true"] { background: rgba(128,128,128,.2); background: color-mix(in srgb, currentColor 18%, transparent); }
#n1kf-dialog .n1kf-switch[aria-checked="true"]::after { transform: translateX(28px); opacity: 1; }
#n1kf-dialog .n1kf-switch:focus-visible { outline: 2px dashed currentColor; outline-offset: 3px; }
#n1kf-dialog .n1kf-preview { transition: opacity .2s ease, filter .2s ease; }
#n1kf-dialog.n1kf-off .n1kf-preview { opacity: .35; filter: grayscale(1); }
#n1kf-dialog .n1kf-section + .n1kf-section {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 2px dashed rgba(128, 128, 128, .35);
  border-top: 2px dashed color-mix(in srgb, currentColor 28%, transparent);
}
#n1kf-dialog .n1kf-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
#n1kf-dialog .n1kf-head .settings-group-header { margin: 0; }
#n1kf-dialog .n1kf-value { font-weight: 700; font-variant-numeric: tabular-nums; }
#n1kf-dialog .n1kf-actions { display: flex; justify-content: flex-end; margin-top: 6px; }
#n1kf-dialog .n1kf-reset { font-size: 15px !important; padding: 4px 16px !important; min-width: 0 !important; margin: 0 !important; }
#n1kf-dialog .n1kf-reset:disabled { opacity: .4; cursor: default; }

#n1kf-dialog .n1kf-range { position: relative; margin-top: 8px; padding-bottom: 24px; color: inherit; }
#n1kf-dialog .n1kf-range input[type=range] {
  -webkit-appearance: none; appearance: none;
  display: block; width: 100%; height: 22px; margin: 0;
  background: transparent; color: inherit; cursor: pointer;
}
#n1kf-dialog .n1kf-range input[type=range]:focus-visible { outline: 2px dashed currentColor; outline-offset: 4px; }
#n1kf-dialog .n1kf-range input[type=range]::-webkit-slider-runnable-track {
  height: 6px; border-radius: 3px;
  background: linear-gradient(to right, currentColor 0 var(--fill, 50%), color-mix(in srgb, currentColor 25%, transparent) var(--fill, 50%) 100%);
}
#n1kf-dialog .n1kf-range input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 18px; height: 18px; margin-top: -6px; border-radius: 50%;
  background: currentColor; border: none;
}
#n1kf-dialog .n1kf-range input[type=range]::-moz-range-track {
  height: 6px; border-radius: 3px; background: color-mix(in srgb, currentColor 25%, transparent);
}
#n1kf-dialog .n1kf-range input[type=range]::-moz-range-progress { height: 6px; border-radius: 3px; background: currentColor; }
#n1kf-dialog .n1kf-range input[type=range]::-moz-range-thumb {
  width: 18px; height: 18px; border-radius: 50%; background: currentColor; border: none;
}
#n1kf-dialog .n1kf-mark {
  position: absolute; top: 22px;
  left: calc(9px + var(--p) * (100% - 18px));
  transform: translateX(-50%);
  font-size: 11px; line-height: 1; white-space: nowrap;
  opacity: .7; pointer-events: none; text-align: center;
}
#n1kf-dialog .n1kf-mark::before {
  content: ''; display: block; width: 2px; height: 7px; margin: 0 auto 3px;
  background: currentColor;
}

#n1kf-dialog .n1kf-fonts {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px;
  padding: 8px; border: 2px solid currentColor; border-radius: 10px;
}
#n1kf-dialog .n1kf-font {
  position: relative; display: flex; align-items: baseline; gap: 6px;
  padding: 6px 10px; border: 2px solid transparent; border-radius: 8px;
  cursor: pointer; font-size: 17px; line-height: 1.25; min-width: 0;
}
#n1kf-dialog .n1kf-font:hover { border-color: color-mix(in srgb, currentColor 30%, transparent); }
#n1kf-dialog .n1kf-font.n1kf-on { border-color: currentColor; }
#n1kf-dialog .n1kf-font:has(input:focus-visible) { outline: 2px dashed currentColor; outline-offset: 2px; }
#n1kf-dialog .n1kf-font input {
  position: absolute !important; top: 0 !important; left: 0 !important;
  width: 1px !important; height: 1px !important; margin: 0 !important; padding: 0 !important;
  border: 0 !important; opacity: 0 !important; pointer-events: none !important;
  -webkit-appearance: none !important; appearance: none !important;
  clip-path: inset(50%) !important; overflow: hidden !important;
}
#n1kf-dialog .n1kf-font .n1kf-fontname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#n1kf-dialog .n1kf-font .n1kf-default { font-size: 11px; opacity: .6; white-space: nowrap; font-family: Ubuntu, system-ui, sans-serif; }
#n1kf-dialog .dialogButtonsContainer { display: flex; justify-content: center; gap: 10px; margin-top: 24px; }
@media (prefers-reduced-motion: reduce) {
  #n1kf-curtain, #n1kf-dialog, #n1kf-dialog .n1kf-switch, #n1kf-dialog .n1kf-switch::after { transition: none; }
}

#n1kf-menu-btn .buttonImage {
  background-image: var(--n1kf-icon) !important;
  background-size: 66% !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
}
`;

  function ensureStyles() {
    if (!document.getElementById('n1kf-style')) {
      const st = document.createElement('style');
      st.id = 'n1kf-style';
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    applySettings();
  }

  // 설정값을 CSS 변수로 반영 (피드와 미리보기 모두에 적용)
  function applySettings() {
    let st = document.getElementById('n1kf-vars');
    if (!st) {
      st = document.createElement('style');
      st.id = 'n1kf-vars';
      (document.head || document.documentElement).appendChild(st);
    }
    const f = fontById(settings.font);
    st.textContent = `.n1kf-feed {
  --n1kf-scale: ${settings.size / 100};
  --n1kf-font: ${f.css}, ${CJK_FALLBACK};
  --n1kf-weight: ${f.weight};
  --n1kf-weight-strong: ${f.strong};
  --n1kf-case: ${f.textCase || 'none'};
}`;
  }

  // ───────── 피드 그리기 ─────────
  let root = null;

  function mountTarget() {
    const fs = document.fullscreenElement;
    return fs && fs !== document.documentElement && fs !== document.body ? fs : document.body;
  }

  function ensureRoot() {
    if (!document.body) return null;
    ensureStyles();
    if (!root) {
      root = document.createElement('div');
      root.id = 'n1kf-root';
      root.className = 'n1kf-feed';
      root.classList.toggle('n1kf-hidden', !S.visible);
    }
    const target = mountTarget();
    if (root.parentNode !== target) target.appendChild(root);
    return root;
  }

  function setVisible(v) {
    if (S.visible === v) return;
    S.visible = v;
    if (root) root.classList.toggle('n1kf-hidden', !v);
  }

  function text(s) { return document.createTextNode(s); }

  // 테두리 색과 반투명 번짐 색을 함께 지정 (색은 모두 #rrggbb 형식)
  function setColor(el, color) {
    el.style.setProperty('--c', color);
    el.style.setProperty('--g', color + GLOW_ALPHA);
  }

  function nameSpan(info) {
    const el = document.createElement('span');
    el.className = 'n1kf-name';
    el.textContent = info.name;
    setColor(el, (TEAM[info.team] && TEAM[info.team].color) || NEUTRAL);
    return el;
  }

  // 팀 색 깃발 아이콘 (이모지는 색을 바꿀 수 없어 SVG 사용)
  function flagIcon(color) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const pole = document.createElementNS(NS, 'rect');
    pole.setAttribute('x', '2'); pole.setAttribute('y', '1'); pole.setAttribute('width', '2'); pole.setAttribute('height', '14');
    pole.setAttribute('rx', '1'); pole.setAttribute('fill', '#f2f2f2');
    const cloth = document.createElementNS(NS, 'path');
    cloth.setAttribute('d', 'M4 2h10l-3 4 3 4H4z');
    cloth.setAttribute('fill', color);
    svg.append(pole, cloth);
    return svg;
  }

  // 킬/사망 줄 내용 (실제 피드와 미리보기 공용)
  function fillDeathLine(el, killerInfo, victimInfo, cause) {
    const nodes = [];
    if (killerInfo) {
      const icon = document.createElement('span');
      icon.className = 'n1kf-icon';
      icon.textContent = KILL_ICON;
      nodes.push(nameSpan(killerInfo), icon, nameSpan(victimInfo));
      if (cause) {
        const tag = document.createElement('span');
        tag.className = 'n1kf-tag';
        setColor(tag, TAG_COLOR);
        tag.textContent = ' (' + CAUSE[cause].tag + ')';
        nodes.push(tag);
      }
    } else {
      nodes.push(nameSpan(victimInfo), text(' ' + (cause ? CAUSE[cause].alone : 'died')));
    }
    el.replaceChildren(...nodes);
  }

  // 깃발 줄 내용 (실제 피드와 미리보기 공용)
  function fillFlagLine(el, team, op) {
    const tm = TEAM[team];
    const teamColor = tm ? tm.color : NEUTRAL;
    el.classList.add('n1kf-flag');
    const name = document.createElement('span');
    name.className = 'n1kf-flagname';
    name.textContent = (tm ? tm.name : 'Team ' + (team == null ? '?' : team)) + ' Flag';
    setColor(name, teamColor);
    const opEl = document.createElement('span');
    opEl.textContent = ' ' + FLAG_OP[op];
    setColor(opEl, FLAG_OP_COLOR[op]);
    const icon = flagIcon(teamColor);
    setColor(icon, teamColor);
    el.replaceChildren(icon, name, opEl);
  }

  function addLine() {
    const r = ensureRoot();
    if (!r) return null;
    const el = document.createElement('div');
    el.className = 'n1kf-line';
    r.appendChild(el);
    const line = { el, timer: 0, fadeTimer: 0 };
    S.lines.add(line);
    while (S.lines.size > CFG.maxLines) removeLine(S.lines.values().next().value);
    armLifetime(line);
    return line;
  }

  function armLifetime(line) {
    clearTimeout(line.timer);
    clearTimeout(line.fadeTimer);
    line.el.classList.remove('n1kf-out');
    line.timer = setTimeout(() => {
      line.el.classList.add('n1kf-out');
      line.fadeTimer = setTimeout(() => removeLine(line), CFG.fadeMs);
    }, lifetimeMs());
  }

  function removeLine(line) {
    clearTimeout(line.timer);
    clearTimeout(line.fadeTimer);
    line.el.remove();
    S.lines.delete(line);
  }

  function render(inc) {
    clearTimeout(inc.pendingTimer);
    inc.pendingTimer = 0;
    if (S.incidents.get(inc.victimId) !== inc && !inc.line) return; // 이미 정리된 사건
    let line = inc.line && S.lines.has(inc.line) ? inc.line : null;
    if (!line) {
      line = addLine();
      if (!line) return;
      inc.line = line;
    } else {
      armLifetime(line);
    }
    fillDeathLine(line.el, inc.killer != null ? infoOf(inc.killer) : null, infoOf(inc.victimId), inc.cause);
  }

  // ───────── 설정창 ─────────
  const CLOSED = 'n1kf-closed';
  let ui = null;
  let dialogOpen = false;
  const randomSeed = () => String(Math.floor(Math.random() * 99999) + 1);   // 종이 질감은 요소마다 seed 가 필요

  const fmt = {
    size: (v) => Math.round(v) + '%',
    duration: (v) => (Number.isInteger(v) ? v : v.toFixed(1)) + 's',
  };

  function sliderSection(key, title, aria) {
    const d = SETTING_DEFS[key];
    const p = (d.def - d.min) / (d.max - d.min);
    return `
      <div class="n1kf-section" data-key="${key}">
        <div class="n1kf-head">
          <h3 class="settings-group-header">${title}</h3>
          <span class="settings-item-text n1kf-value" id="n1kf-${key}-value"></span>
        </div>
        <div class="n1kf-range">
          <input type="range" id="n1kf-${key}" min="${d.min}" max="${d.max}" step="${d.step}" aria-label="${aria}">
          <div class="n1kf-mark" style="--p:${p}">default ${fmt[key](d.def)}</div>
        </div>
        <div class="n1kf-actions">
          <button type="button" class="dialog-button blueNight wrinkledPaper n1kf-reset" data-reset="${key}">Reset</button>
        </div>
      </div>`;
  }

  function buildDialog() {
    ensureStyles();
    const curtain = document.createElement('div');
    curtain.id = 'n1kf-curtain';
    curtain.className = 'dialogCurtain fullScreen ' + CLOSED;
    curtain.addEventListener('click', closeDialog);

    const dialog = document.createElement('div');
    dialog.id = 'n1kf-dialog';
    dialog.className = 'dialog wrinkledPaper ' + CLOSED;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'n1kf-title');

    const fontOptions = FONTS.map((f) => `
          <label class="n1kf-font" data-font="${f.id}">
            <input type="radio" name="n1kf-font" value="${f.id}">
            <span class="n1kf-fontname" style="font-family:${f.css.replace(/"/g, '&quot;')}, ${CJK_FALLBACK.replace(/"/g, '&quot;')}; font-weight:${f.weight}${f.textCase ? '; text-transform:' + f.textCase : ''}">${f.label}</span>
            ${f.id === SETTING_DEFS.font.def ? '<span class="n1kf-default">default</span>' : ''}
          </label>`).join('');

    dialog.innerHTML = `
      <h2 id="n1kf-title" class="dialogTitle blueNight">Kill Feed <span class="n1kf-version">v${VERSION}</span></h2>

      <div class="n1kf-power">
        <div class="n1kf-head">
          <h3 class="settings-group-header" id="n1kf-enabled-label">Show kill feed</h3>
          <div class="n1kf-switchwrap">
            <span class="settings-item-text n1kf-value" id="n1kf-enabled-value" aria-hidden="true"></span>
            <button type="button" role="switch" id="n1kf-enabled" class="n1kf-switch" aria-labelledby="n1kf-enabled-label"></button>
          </div>
        </div>
        <p class="settings-item-text n1kf-note" id="n1kf-enabled-note"></p>
      </div>

      <div class="n1kf-feed n1kf-preview" id="n1kf-preview" aria-hidden="true"></div>

      ${sliderSection('size', 'Text size', 'Text size in percent')}

      <div class="n1kf-section" data-key="font">
        <div class="n1kf-head">
          <h3 class="settings-group-header">Font</h3>
          <span class="settings-item-text n1kf-value" id="n1kf-font-value"></span>
        </div>
        <div class="n1kf-fonts" role="radiogroup" aria-label="Font">${fontOptions}
        </div>
        <div class="n1kf-actions">
          <button type="button" class="dialog-button blueNight wrinkledPaper n1kf-reset" data-reset="font">Reset</button>
        </div>
      </div>

      ${sliderSection('duration', 'Display time', 'How long each line stays, in seconds')}

      <div class="dialogButtonsContainer">
        <button type="button" id="n1kf-close" class="dialog-button blueNight wrinkledPaper">Close</button>
      </div>
    `;
    dialog.querySelectorAll('.wrinkledPaper').forEach((el) => el.style.setProperty('--wrinkled-paper-seed', randomSeed()));
    document.body.append(curtain, dialog);

    ui = {
      curtain,
      dialog,
      preview: dialog.querySelector('#n1kf-preview'),
      enabled: dialog.querySelector('#n1kf-enabled'),
      size: dialog.querySelector('#n1kf-size'),
      duration: dialog.querySelector('#n1kf-duration'),
    };

    // 미리보기: 실제 피드와 같은 클래스·같은 그리기 함수
    const sample = [
      (el) => fillDeathLine(el, { name: 'Lumos', team: 2 }, { name: 'Guest 2549', team: 1 }, null),
      (el) => fillDeathLine(el, { name: 'Guest 2549', team: 1 }, { name: 'Lumos', team: 2 }, 'fall'),
      (el) => fillDeathLine(el, null, { name: 'Guest 4802', team: 1 }, 'spikes'),
      (el) => fillFlagLine(el, 1, 1),
    ];
    for (const fill of sample) {
      const el = document.createElement('div');
      el.className = 'n1kf-line';
      fill(el);
      ui.preview.appendChild(el);
    }

    for (const key of ['size', 'duration']) {
      ui[key].addEventListener('input', () => setSetting(key, ui[key].value, false));
      ui[key].addEventListener('change', () => setSetting(key, ui[key].value, true));
    }
    dialog.querySelectorAll('input[name="n1kf-font"]').forEach((input) => {
      input.addEventListener('change', () => { if (input.checked) setSetting('font', input.value, true); });
    });
    dialog.querySelectorAll('[data-reset]').forEach((btn) => {
      btn.addEventListener('click', () => setSetting(btn.dataset.reset, SETTING_DEFS[btn.dataset.reset].def, true));
    });
    ui.enabled.addEventListener('click', () => setEnabled(!settings.enabled));
    dialog.querySelector('#n1kf-close').addEventListener('click', closeDialog);

    // 설정창 안에서 누른 키가 게임 단축키로 넘어가지 않게 한다 (Esc 는 아래 전역 처리)
    dialog.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    dialog.addEventListener('keyup', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  }

  function setSetting(key, value, commit) {
    if (key === 'font') {
      settings.font = fontById(String(value)).id;
    } else {
      settings[key] = snap(SETTING_DEFS[key], value);
    }
    applySettings();
    syncDialog();
    saveSettings(commit);
  }

  // 설정창 표시를 현재 값에 맞춘다
  function syncDialog() {
    if (!ui) return;
    ui.enabled.setAttribute('aria-checked', String(settings.enabled));
    ui.dialog.querySelector('#n1kf-enabled-value').textContent = settings.enabled ? 'On' : 'Off';
    ui.dialog.querySelector('#n1kf-enabled-note').textContent = settings.enabled
      ? 'Turning it off stops the feed right away. No reload needed.'
      : 'Off: the feed is not running and the game is left untouched.';
    ui.dialog.classList.toggle('n1kf-off', !settings.enabled);
    for (const key of ['size', 'duration']) {
      const d = SETTING_DEFS[key];
      const v = settings[key];
      if (String(ui[key].value) !== String(v)) ui[key].value = v;
      ui[key].style.setProperty('--fill', ((v - d.min) / (d.max - d.min)) * 100 + '%');
      ui[key].setAttribute('aria-valuetext', fmt[key](v));
      ui.dialog.querySelector('#n1kf-' + key + '-value').textContent = fmt[key](v);
    }
    ui.dialog.querySelectorAll('.n1kf-font').forEach((label) => {
      const on = label.dataset.font === settings.font;
      label.classList.toggle('n1kf-on', on);
      const input = label.querySelector('input');
      if (input.checked !== on) input.checked = on;
    });
    ui.dialog.querySelector('#n1kf-font-value').textContent = fontById(settings.font).label;
    ui.dialog.querySelectorAll('[data-reset]').forEach((btn) => {
      btn.disabled = settings[btn.dataset.reset] === SETTING_DEFS[btn.dataset.reset].def;
    });
  }

  function openDialog() {
    if (!ui) buildDialog();
    dialogOpen = true;
    ui.dialog.style.setProperty('--wrinkled-paper-seed', randomSeed());   // 게임처럼 열 때마다 종이 모양이 조금씩 다름
    syncDialog();
    void ui.dialog.offsetWidth;   // 닫힌 상태를 먼저 적용해야 여는 애니메이션이 재생된다
    ui.curtain.classList.remove(CLOSED);
    ui.dialog.classList.remove(CLOSED);
    try { ui.enabled.focus({ preventScroll: true }); } catch {}
  }

  function closeDialog() {
    if (!ui || !dialogOpen) return;
    dialogOpen = false;
    saveSettings(true);
    ui.curtain.classList.add(CLOSED);
    ui.dialog.classList.add(CLOSED);
    const focused = document.activeElement;
    if (focused && ui.dialog.contains(focused)) focused.blur();   // 숨긴 컨트롤에 포커스를 남기지 않는다
  }

  // Esc 는 게임보다 먼저 받아서 설정창만 닫는다
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialogOpen) { e.preventDefault(); e.stopPropagation(); closeDialog(); }
  }, true);

  // ───────── 메인 메뉴 버튼 ─────────
  // .menu-buttons-container 안에 항목마다 .main-menu-button-container 가 하나씩 있다.
  // 게임은 매치에 들어가면 메뉴 전체를 숨기므로, 여기에 넣은 버튼도 같이 숨었다가 같이 돌아온다.
  const MENU_BUTTON_ID = 'n1kf-menu-btn';
  const MENU_LABEL = 'Kill Feed';
  // 게임 아이콘처럼 검은 선화 (게임이 어두운 테마에서 아이콘 색을 바꿔 준다)
  const MENU_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" ' +
    'stroke="#000000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M50 24h38M58 50h30M50 76h38"/>' +
    '<path d="M10 50h30"/><path d="M30 39l11 11-11 11"/>' +
    '<path d="M10 50l-3-8M10 50l-3 8M18 50l-3-8M18 50l-3 8"/>' +
    '</svg>'
  );

  function findFullScreenEntry() {
    for (const entry of document.querySelectorAll('.main-menu-button-container')) {
      const button = entry.querySelector('button.main-menu-button');
      if (button && (button.getAttribute('aria-label') || '').trim().toLowerCase() === 'full screen') return entry;
    }
    return null;
  }

  // 꺼져 있으면 메뉴에서 바로 보이게 "(off)" 를 붙인다
  function updateMenuLabel() {
    const label = document.querySelector('#' + MENU_BUTTON_ID + ' .main-menu-button-text');
    if (label) label.textContent = settings.enabled ? MENU_LABEL : MENU_LABEL + ' (off)';
  }

  function injectMenuButton() {
    if (document.getElementById(MENU_BUTTON_ID)) return;
    // 게임 항목을 복제해서 모양을 똑같이 맞춘다. Full Screen 이 없으면 아무 항목이나 쓰고 맨 끝에 둔다.
    const fullScreen = findFullScreenEntry();
    const template = fullScreen || document.querySelector('.menu-buttons-container .main-menu-button-container');
    if (!template || !template.parentElement) return;           // 메인 메뉴가 아직 없음

    ensureStyles();
    const entry = template.cloneNode(true);                     // 모양만 복제, 게임의 클릭 처리는 복제되지 않는다
    entry.id = MENU_BUTTON_ID;
    entry.style.display = '';                                   // 전체화면 중 게임이 숨기는 항목을 복제해도 우리 것은 보이게
    entry.style.setProperty('--n1kf-icon', 'url("' + MENU_ICON + '")');
    const button = entry.querySelector('button.main-menu-button');
    if (button) {
      button.setAttribute('aria-label', MENU_LABEL);
      button.style.setProperty('--wrinkled-paper-seed', randomSeed());
      const image = button.querySelector('.buttonImage');
      if (image) { image.style.backgroundImage = ''; image.style.backgroundSize = ''; }
    }
    const label = entry.querySelector('.main-menu-button-text');
    if (label) label.textContent = MENU_LABEL;
    entry.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (dialogOpen) closeDialog(); else openDialog();
    }, true);

    if (fullScreen) {
      // Full Screen 아래, 같은 계열 스크립트(n1ct, n1ck, n1nf …) 버튼들 다음에 붙인다
      let anchor = fullScreen;
      while (anchor.nextElementSibling && /^n1[a-z]+-menu-btn$/.test(anchor.nextElementSibling.id)) {
        anchor = anchor.nextElementSibling;
      }
      anchor.after(entry);
    } else {
      template.parentElement.appendChild(entry);
    }
    updateMenuLabel();
  }

  // ───────── 시작 ─────────
  function start() {
    ensureStyles();
    injectMenuButton();
    setInterval(injectMenuButton, 1000);   // 게임이 메뉴를 다시 그리면 버튼이 사라지므로 다시 넣는다
    document.addEventListener('fullscreenchange', () => { if (root) ensureRoot(); });
    if (settings.enabled) startFeed();
    console.log('[n1kf] Kill Feed ' + VERSION + ' (Lumos) 준비됨' + (settings.enabled ? '' : ' (꺼짐)'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();