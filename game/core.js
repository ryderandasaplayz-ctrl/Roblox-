/* =====================================================================
   Bounce Blast - core.js
   Engine + the global window.BB plugin API.
   Feature files (features/*.js) load after this file and register
   content into the registries; main.js calls BB.boot() last.
   The full contract lives in API.md - keep the two in sync.
   ===================================================================== */
(function () {
'use strict';

// The publish host wraps the page in a skeleton with its own viewport meta.
// When opened raw (file:// tests) there is none and phones lay out at 980px,
// so add one only if missing - never override the host's.
if (!document.querySelector('meta[name="viewport"]')) {
  const vm = document.createElement('meta');
  vm.name = 'viewport';
  vm.content = 'width=device-width,initial-scale=1,viewport-fit=cover';
  (document.head || document.documentElement).appendChild(vm);
}

const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const hudEl = $('hud'), hudRow = $('hudRow'), scoreEl = $('score'), coinsHudEl = $('coinsHud');
const hudBtns = $('hudBtns'), screensEl = $('screens'), toastEl = $('toast');
const overExtras = $('overExtras'), menuExtras = $('menuExtras');

const BB = window.BB = {};
BB.version = 2;

let W = 0, H = 0, DPR = 1, cvLeft = 0;
let G = null, running = false, paused = false, booted = false;
const TAU = Math.PI * 2;

// =====================================================================
// Hooks
// =====================================================================
const hooks = Object.create(null);
const errSeen = Object.create(null);
function report(where, err) {
  const n = errSeen[where] = (errSeen[where] || 0) + 1;
  if (n <= 3) console.error('[BB] ' + where + ' failed:', err);
}
function on(ev, fn, priority) {
  if (typeof fn !== 'function') throw new TypeError('BB.on("' + ev + '") needs a function');
  const list = (hooks[ev] || []).concat({ fn, p: +priority || 0 });
  list.sort((a, b) => b.p - a.p); // stable: equal priority keeps registration order
  hooks[ev] = list;
  return () => off(ev, fn);
}
function off(ev, fn) { const l = hooks[ev]; if (l) hooks[ev] = l.filter(h => h.fn !== fn); }
function emit(ev, a, b, c, d) {
  const l = hooks[ev];
  if (!l || !l.length) return false;
  let any = false;
  for (let i = 0; i < l.length; i++) {
    let r;
    try { r = l[i].fn(a, b, c, d); } catch (e) { report('hook "' + ev + '"', e); }
    if (r === true) any = true;
  }
  return any;
}
function emitUntil(ev, a, b, c, d) {
  const l = hooks[ev];
  if (!l || !l.length) return false;
  for (let i = 0; i < l.length; i++) {
    let r;
    try { r = l[i].fn(a, b, c, d); } catch (e) { report('hook "' + ev + '"', e); }
    if (r === true) return true;
  }
  return false;
}
BB.on = on;
BB.off = off;
BB.emit = emit;
BB.emitUntil = emitUntil;
BB.hasListeners = ev => !!(hooks[ev] && hooks[ev].length);

// =====================================================================
// Constants, mods, registries
// =====================================================================
BB.GRAV = 1500;
BB.JUMP = -780;
BB.PLAT_H = 12;
BB.MOD_DEFAULTS = Object.freeze({
  coinMult: 1, scoreMult: 1, jumpMult: 1, gravityMult: 1,
  timeScale: 1, magnetRange: 220, effectDuration: 1, steerMult: 1
});
const mods = BB.mods = {};
function resetMods() {
  for (const k in mods) delete mods[k];
  Object.assign(mods, BB.MOD_DEFAULTS);
}
resetMods();

BB.colors = { sky: '#140b2e', sky2: '#2a1260', ink: '#fff7e8', sun: '#ffcf3f', pop: '#ff4fa3', mint: '#3ff0c0', dim: '#a99bd6' };
BB.platformTypes = {};
BB.itemTypes = {};
BB.enemyTypes = {};
BB.effectTypes = {};
BB.cosmetics = { skins: [], trails: [], hats: [] };

// =====================================================================
// Save data (localStorage key 'bounceblast')
// =====================================================================
const SAVE_KEY = 'bounceblast';
const OLD_SKIN_IDS = ['sunny', 'bubblegum', 'mint', 'lava', 'ice', 'rainbow'];
const save = {
  v: 2, best: 0, coins: 0, owned: ['sunny'],
  equipped: { skin: 'sunny', trail: 'notrail', hat: 'nohat' }
};
let migrated = false;
(function loadSave() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { raw = null; }
  if (!raw || typeof raw !== 'object') return;
  for (const k in raw) if (k !== 'owned' && k !== 'equipped' && k !== 'skin') save[k] = raw[k];
  save.best = Math.max(0, +raw.best || 0);
  save.coins = Math.max(0, +raw.coins || 0);
  const owned = new Set(['sunny']);
  if (Array.isArray(raw.owned)) {
    for (const o of raw.owned) {
      if (typeof o === 'number') { if (OLD_SKIN_IDS[o]) { owned.add(OLD_SKIN_IDS[o]); migrated = true; } }
      else if (typeof o === 'string') owned.add(o);
    }
  }
  save.owned = Array.from(owned);
  const eq = raw.equipped && typeof raw.equipped === 'object' ? raw.equipped : null;
  if (!eq) migrated = true;
  save.equipped = {
    skin: eq && typeof eq.skin === 'string' ? eq.skin
      : (typeof raw.skin === 'number' && OLD_SKIN_IDS[raw.skin]) || 'sunny',
    trail: eq && typeof eq.trail === 'string' ? eq.trail : 'notrail',
    hat: eq && typeof eq.hat === 'string' ? eq.hat : 'nohat'
  };
  save.v = 2;
})();
function store() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage blocked: play on */ }
}
BB.store = store;

// =====================================================================
// Canvas sizing + layout measurements
// =====================================================================
const layout = BB.layout = {
  hudX: 16, effectsY: 50, hudBottom: 100,
  safeTop: 0, safeBottom: 0, safeLeft: 0, safeRight: 0
};
const probe = document.createElement('div');
probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:0;height:0;' +
  'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
document.body.appendChild(probe);

function measureHud() {
  try {
    const cs = getComputedStyle(probe);
    layout.safeTop = parseFloat(cs.paddingTop) || 0;
    layout.safeRight = parseFloat(cs.paddingRight) || 0;
    layout.safeBottom = parseFloat(cs.paddingBottom) || 0;
    layout.safeLeft = parseFloat(cs.paddingLeft) || 0;
    const cr = cv.getBoundingClientRect();
    cvLeft = cr.left;
    const rr = hudRow.getBoundingClientRect();
    if (rr.height > 0) {
      const sr = scoreEl.getBoundingClientRect();
      layout.hudX = Math.round(sr.left - cr.left);
      layout.effectsY = Math.round(rr.bottom - cr.top + 6);
    } else {
      layout.hudX = Math.max(16, layout.safeLeft);
      layout.effectsY = Math.round(10 + layout.safeTop + 30 + 6);
    }
    layout.hudBottom = layout.effectsY + 50;
  } catch (e) { /* layout not ready */ }
}
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = cv.clientWidth || window.innerWidth;
  H = cv.clientHeight || window.innerHeight;
  cv.width = Math.round(W * DPR);
  cv.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  skyGrad = null;
  measureHud();
}
window.addEventListener('resize', resize);

// =====================================================================
// Sound / vibration
// =====================================================================
let ac = null, master = null, soundOn = true;
function audio() {
  if (ac) return ac;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = soundOn ? 1 : 0;
    master.connect(ac.destination);
  } catch (e) { ac = null; master = null; }
  return ac;
}
function unlockAudio() {
  const a = audio();
  try { if (a && a.state === 'suspended') a.resume(); } catch (e) { /* ignore */ }
}
window.addEventListener('pointerdown', unlockAudio, true);
window.addEventListener('keydown', unlockAudio, true);

BB.sound = {
  get enabled() { return soundOn; },
  set enabled(v) {
    soundOn = !!v;
    try { if (master) master.gain.setValueAtTime(soundOn ? 1 : 0, ac.currentTime); } catch (e) { /* ignore */ }
  },
  ctx() { return audio(); },
  out() { audio(); return master; }
};
function beep(f, d, type, v, slide) {
  if (!soundOn) return;
  d = d || 0.08; type = type || 'square'; v = v == null ? 0.06 : v;
  try {
    const a = audio();
    if (!a || !master) return;
    if (a.state === 'suspended') a.resume();
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.value = f;
    if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, a.currentTime + d);
    g.gain.setValueAtTime(v, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + d);
    o.connect(g).connect(master);
    o.start();
    o.stop(a.currentTime + d);
  } catch (e) { /* audio unavailable */ }
}
BB.beep = beep;

BB.vibration = { enabled: true };
BB.vibrate = function (ms) {
  if (!BB.vibration.enabled) return false;
  try {
    if (navigator && typeof navigator.vibrate === 'function') return navigator.vibrate(ms);
  } catch (e) { /* blocked */ }
  return false;
};

// =====================================================================
// Input
// =====================================================================
const touches = new Map();
let tLeft = false, tRight = false;
const keys = Object.create(null);
const input = BB.input = { left: false, right: false };
function updTouch() {
  tLeft = tRight = false;
  for (const x of touches.values()) { if (x - cvLeft < W / 2) tLeft = true; else tRight = true; }
}
function clearInput() {
  touches.clear(); tLeft = tRight = false;
  for (const k in keys) keys[k] = 0;
}
BB.clearInput = clearInput;
cv.addEventListener('pointerdown', e => {
  if (paused && !BB.hasListeners('pause')) { BB.resume(); return; }
  touches.set(e.pointerId, e.clientX); updTouch();
});
cv.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) { touches.set(e.pointerId, e.clientX); updTouch(); }
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(t => cv.addEventListener(t, e => {
  touches.delete(e.pointerId); updTouch();
}));
cv.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  const k = (e.key || '').toLowerCase();
  if (paused && !BB.hasListeners('pause') && (k === ' ' || k === 'enter' || k === 'escape' || k === 'p')) { BB.resume(); return; }
  keys[k] = 1;
  if (k === 'arrowleft' || k === 'arrowright') e.preventDefault();
});
window.addEventListener('keyup', e => { keys[(e.key || '').toLowerCase()] = 0; });
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (running && !paused) BB.pause(); clearInput(); }
  last = performance.now();
});

// =====================================================================
// Helpers (drawing + math)
// =====================================================================
function rr(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
  c.fill();
}
function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
const badgeFonts = {};
function drawBadge(c, x, y, r, color, icon) {
  c.fillStyle = color || '#fff7e8';
  circle(c, x, y, r);
  if (icon) {
    const fs = Math.round(r);
    c.fillStyle = '#140b2e';
    c.font = badgeFonts[fs] || (badgeFonts[fs] = '900 ' + fs + 'px Nunito, system-ui, sans-serif');
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(icon, x, y + 1);
  }
}
function paint(color, t) {
  return color === 'rainbow' ? 'hsl(' + ((t * 200) % 360 | 0) + ',90%,60%)' : color;
}
function wrapDx(dx) {
  if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
  return dx;
}
function drawPlatformBase(c, pl, color) {
  c.fillStyle = color || '#3ff0c0';
  rr(c, pl.x, pl.y, pl.w, pl.h || BB.PLAT_H, 6);
}
BB.util = {
  rr, circle, paint, wrapDx,
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  rand: (a, b) => a + Math.random() * (b - a),
  pick: arr => arr[(Math.random() * arr.length) | 0]
};
BB.rr = rr;
BB.wrapDx = wrapDx;
BB.drawBadge = drawBadge;
BB.drawPlatformBase = drawPlatformBase;

// =====================================================================
// Juice: particles, float text, shake, flash
// =====================================================================
const MAX_PARTS = 320, MAX_FLOATS = 24;
const parts = [], partPool = [];
const floats = [], floatPool = [];
let flashCol = '#fff', flashA = 0, flashT = 0;

function emitParticle(x, y, vx, vy, life, color, size, grav) {
  if (parts.length >= MAX_PARTS) return null;
  const q = partPool.pop() || {};
  q.x = x; q.y = y; q.vx = vx; q.vy = vy;
  q.life = q.max = life || 0.6;
  q.col = color || '#fff7e8';
  q.size = size || 4;
  q.g = grav == null ? 600 : grav;
  parts.push(q);
  return q;
}
BB.emitParticle = emitParticle;
BB.burst = function (x, y, color, n, speed) {
  n = n == null ? 12 : n; speed = speed == null ? 220 : speed;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = Math.random() * speed;
    emitParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.6, color, 4, 600);
  }
};
BB.shake = function (amount) { if (G) G.shake = Math.max(G.shake, amount || 8); };
BB.flash = function (color, alpha) { flashCol = color || '#fff'; flashA = alpha == null ? 0.5 : alpha; flashT = 0.25; };
BB.floatText = function (text, x, y, color) {
  if (floats.length >= MAX_FLOATS) { floatPool.push(floats.shift()); }
  const f = floatPool.pop() || {};
  f.text = String(text); f.x = x; f.y = y; f.col = color || '#fff7e8'; f.life = 0.9;
  floats.push(f);
};
function updateJuice(dt, rdt) {
  let j = 0;
  for (let i = 0; i < parts.length; i++) {
    const q = parts[i];
    q.x += q.vx * dt; q.y += q.vy * dt; q.vy += q.g * dt; q.life -= dt;
    if (q.life > 0) parts[j++] = q; else partPool.push(q);
  }
  parts.length = j;
  j = 0;
  for (let i = 0; i < floats.length; i++) {
    const f = floats[i];
    f.y -= 40 * rdt; f.life -= rdt;
    if (f.life > 0) floats[j++] = f; else floatPool.push(f);
  }
  floats.length = j;
  if (flashT > 0) flashT = Math.max(0, flashT - rdt);
}
function clearJuice() {
  for (const q of parts) partPool.push(q);
  parts.length = 0;
  for (const f of floats) floatPool.push(f);
  floats.length = 0;
  flashT = 0;
}

// =====================================================================
// UI helpers
// =====================================================================
let toastTimer = 0;
let currentScreen = null;
const ui = BB.ui = {
  root: screensEl,
  overExtras,
  menuExtras,
  hud: hudEl,
  hudButtons: hudBtns,
  css(text) {
    const s = document.createElement('style');
    s.textContent = text;
    (document.head || document.documentElement).appendChild(s);
    return s;
  },
  screen(id, html) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'screen';
      el.id = id;
      el.hidden = true;
      screensEl.appendChild(el);
    }
    if (html != null) el.innerHTML = html;
    return el;
  },
  show(id) {
    const list = screensEl.children;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.classList.contains('screen')) s.hidden = s.id !== id;
    }
    currentScreen = id;
    emit('screen', id);
  },
  hide(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
    if (currentScreen === id) currentScreen = null;
  },
  hideAll() {
    const list = screensEl.children;
    for (let i = 0; i < list.length; i++) if (list[i].classList.contains('screen')) list[i].hidden = true;
    currentScreen = null;
  },
  current() { return currentScreen; },
  button(label, onClick, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    if (cls) b.className = cls;
    b.innerHTML = label;
    if (onClick) b.addEventListener('click', ev => { try { onClick(ev, b); } catch (e) { report('button "' + b.textContent + '"', e); } });
    return b;
  },
  menuButton(label, onClick, opts) {
    opts = opts || {};
    const b = ui.button(label, onClick, opts.alt === false ? '' : 'alt');
    if (opts.id) b.id = opts.id;
    menuExtras.appendChild(b);
    return b;
  },
  hudButton(label, onClick, ariaLabel) {
    const b = ui.button(label, onClick, 'hbtn');
    b.setAttribute('aria-label', ariaLabel || String(label).replace(/<[^>]*>/g, ''));
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.addEventListener('click', () => b.blur());
    hudBtns.appendChild(b);
    return b;
  },
  overButton(label, onClick, opts) {
    opts = opts || {};
    const b = ui.button(label, onClick, opts.alt === false ? '' : 'alt');
    if (opts.id) b.id = opts.id;
    overExtras.appendChild(b);
    return b;
  },
  toast(text, color) {
    toastEl.textContent = text;
    toastEl.style.color = color || '';
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 1100);
  }
};
const toast = ui.toast;

// =====================================================================
// Cosmetics
// =====================================================================
const KIND_LIST = { skin: 'skins', trail: 'trails', hat: 'hats' };
function findCosmetic(id) {
  for (const k in KIND_LIST) {
    const list = BB.cosmetics[KIND_LIST[k]];
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  }
  return null;
}
BB.findCosmetic = findCosmetic;
BB.owns = function (id) {
  if (save.owned.indexOf(id) >= 0) return true;
  const it = findCosmetic(id);
  return !!(it && !it.price);
};
BB.grant = function (id) {
  if (save.owned.indexOf(id) < 0) { save.owned.push(id); store(); }
};
const eqCache = { skin: null, trail: null, hat: null };
BB.equipped = function (kind) {
  const list = BB.cosmetics[KIND_LIST[kind]];
  if (!list || !list.length) return null;
  const id = save.equipped[kind];
  const c = eqCache[kind];
  if (c && c.id === id && list.indexOf(c) >= 0) return c;
  let found = null;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) { found = list[i]; break; }
  eqCache[kind] = found || list[0];
  return eqCache[kind];
};
BB.equip = function (kind, id) {
  if (!KIND_LIST[kind] || !BB.owns(id)) return false;
  save.equipped[kind] = id;
  store();
  emit('equip', kind, id);
  return true;
};

// =====================================================================
// Coins, score, difficulty
// =====================================================================
function difficulty() { return G ? Math.min(1, G.maxH / 12000) : 0; }
BB.difficulty = difficulty;
BB.score = () => (G ? Math.floor(G.maxH + G.bonus) : 0);
BB.maxJump = () => {
  const v = BB.JUMP * mods.jumpMult;
  return (v * v) / (2 * BB.GRAV * Math.max(0.05, mods.gravityMult));
};
BB.maxGap = () => 0.7 * BB.maxJump();
BB.addCoins = function (n, x, y) {
  if (!G || !(n > 0)) return 0;
  G.coinAcc += n * mods.coinMult;
  const whole = Math.floor(G.coinAcc + 1e-9);
  G.coinAcc -= whole;
  if (whole > 0) {
    G.coins += whole;
    G.stats.coins += whole;
    if (x != null && y != null) BB.floatText('+' + whole, x, y, '#ffcf3f');
    emit('coins', whole, G);
  }
  return whole;
};
BB.addScore = function (n) {
  if (!G || !n) return 0;
  const v = n * mods.scoreMult;
  G.bonus += v;
  return v;
};
BB.bankCoins = function (n) {
  save.coins = Math.max(0, save.coins + Math.round(n));
  store();
  refreshMenu();
  return save.coins;
};
BB.spendCoins = function (n) {
  if (!(n >= 0) || save.coins < n) return false;
  save.coins -= n;
  store();
  refreshMenu();
  return true;
};

// =====================================================================
// Effects
// =====================================================================
function setEffect(name, secs) {
  if (!G) return 0;
  const t = BB.effectTypes[name];
  if (!t) { console.warn('[BB] unknown effect "' + name + '"'); return 0; }
  const p = G.p;
  const was = p.effects[name] > 0;
  const cur = was ? p.effects[name] : 0;
  if (secs >= cur) { p.effects[name] = secs; p.effectMax[name] = secs; }
  if (!was) {
    try { if (t.onStart) t.onStart(p, G); } catch (e) { report('effect "' + name + '" onStart', e); }
    emit('effectStart', name, G);
  }
  return p.effects[name];
}
BB.addEffect = (name, secs) => setEffect(name, (secs || 0) * mods.effectDuration);
BB.setEffect = setEffect;
BB.hasEffect = name => !!(G && G.p.effects[name] > 0);
BB.endEffect = function (name) {
  if (!G || !(name in G.p.effects)) return;
  const p = G.p, t = BB.effectTypes[name];
  delete p.effects[name];
  delete p.effectMax[name];
  try { if (t && t.onEnd) t.onEnd(p, G); } catch (e) { report('effect "' + name + '" onEnd', e); }
  emit('effectEnd', name, G);
};
function effectFlag(flag) {
  if (!G) return false;
  const fx = G.p.effects;
  for (const name in fx) { const t = BB.effectTypes[name]; if (t && t[flag]) return true; }
  return false;
}
BB.effectFlag = effectFlag;
BB.isInvincible = () => !!(BB.debug.god || effectFlag('invincible'));

// =====================================================================
// Spawning
// =====================================================================
function defaultW(d) { return Math.max(50, 80 - d * 25); }
function widthFor(t, d) {
  if (typeof t.w === 'function') return t.w(d, G);
  return t.w || defaultW(d);
}
BB.spawnPlatform = function (name, x, y, w) {
  if (!G) return null;
  const t = BB.platformTypes[name];
  if (!t) { console.warn('[BB] unknown platform type "' + name + '"'); return null; }
  const d = difficulty();
  if (w == null) w = widthFor(t, d);
  if (x == null) x = Math.random() * Math.max(0, W - w);
  const pl = { type: name, x, y, w, h: BB.PLAT_H, age: 0, falling: false, vy: 0, dead: false };
  if (t.init) { try { t.init(pl, G, d); } catch (e) { report('platform "' + name + '" init', e); } }
  G.plats.push(pl);
  return pl;
};
BB.spawnItem = function (name, x, y) {
  if (!G) return null;
  const t = BB.itemTypes[name];
  if (!t) { console.warn('[BB] unknown item type "' + name + '"'); return null; }
  const it = { type: name, x, y, age: 0, got: false };
  if (t.init) { try { t.init(it, G); } catch (e) { report('item "' + name + '" init', e); } }
  G.items.push(it);
  return it;
};
BB.spawnEnemy = function (name, x, y) {
  if (!G) return null;
  const t = BB.enemyTypes[name];
  if (!t) { console.warn('[BB] unknown enemy type "' + name + '"'); return null; }
  const e = { type: name, x, y, r: t.r || 18, age: 0, dead: false, remove: false };
  if (t.create) {
    try { const props = t.create(x, y, G); if (props) Object.assign(e, props); }
    catch (err) { report('enemy "' + name + '" create', err); }
  }
  G.enemies.push(e);
  return e;
};

const pickNames = [], pickWeights = [];
function weightOf(t, d, name) {
  let w = 0;
  try { w = typeof t.weight === 'function' ? +t.weight(d, G) : +(t.weight || 0); }
  catch (e) { report('weight of "' + name + '"', e); }
  return w > 0 ? w : 0;
}
// Relative weights: always returns a name (platforms).
function pickRelative(reg, d, fallback) {
  pickNames.length = 0; pickWeights.length = 0;
  let total = 0;
  for (const name in reg) {
    const w = weightOf(reg[name], d, name);
    if (w > 0) { pickNames.push(name); pickWeights.push(w); total += w; }
  }
  if (total <= 0) return fallback;
  let r = Math.random() * total;
  for (let i = 0; i < pickNames.length; i++) { if (r < pickWeights[i]) return pickNames[i]; r -= pickWeights[i]; }
  return pickNames[pickNames.length - 1];
}
// Absolute per-row probabilities (items, enemies); returns null for "nothing".
function pickAbsolute(reg, d) {
  pickNames.length = 0; pickWeights.length = 0;
  let total = 0;
  for (const name in reg) {
    const t = reg[name];
    if (t.minHeight && G.maxH < t.minHeight) continue;
    const w = weightOf(t, d, name);
    if (w > 0) { pickNames.push(name); pickWeights.push(w); total += w; }
  }
  if (total <= 0) return null;
  let r = Math.random() * Math.max(1, total);
  for (let i = 0; i < pickNames.length; i++) { if (r < pickWeights[i]) return pickNames[i]; r -= pickWeights[i]; }
  return null;
}

function spawnRow() {
  const d = difficulty();
  const maxGap = BB.maxGap();
  let rowY = G.topY - (60 + Math.random() * (40 + d * 60));
  const name = pickRelative(BB.platformTypes, d, 'normal');
  const t = BB.platformTypes[name] || BB.platformTypes.normal;
  const w = widthFor(t, d);
  let host;
  if (t.solid) {
    rowY = Math.min(G.topY - 20, Math.max(rowY, G.lastSolidY - maxGap));
    host = BB.spawnPlatform(name, Math.random() * Math.max(0, W - w), rowY, w);
    G.lastSolidY = Math.min(G.lastSolidY, rowY);
  } else {
    host = BB.spawnPlatform(name, Math.random() * Math.max(0, W - w), rowY, w);
    // fragile / hazardous rows always get a real platform in the same band
    const cw = defaultW(d);
    const cy = Math.max(rowY - 30, G.lastSolidY - maxGap);
    const comp = BB.spawnPlatform('normal', Math.random() * Math.max(0, W - cw), cy, cw);
    if (comp) comp.companion = true;
    G.lastSolidY = Math.min(G.lastSolidY, cy);
    if (t.noItems && comp) host = comp;
  }
  G.topY = rowY;
  if (host) {
    const iname = pickAbsolute(BB.itemTypes, d);
    if (iname) {
      const it = BB.itemTypes[iname];
      BB.spawnItem(iname, host.x + host.w / 2, host.y - (it.lift == null ? 30 : it.lift));
    }
  }
  const ename = pickAbsolute(BB.enemyTypes, d);
  if (ename) BB.spawnEnemy(ename, Math.random() * W, rowY - 40);
  emit('spawnRow', rowY, G);
}
BB.spawnRow = () => { if (G) spawnRow(); };

// =====================================================================
// Run lifecycle
// =====================================================================
const TRAIL_N = 14;
function newGame(demo) {
  resetMods();
  clearJuice();
  const p = { x: W / 2, y: H - 120, vx: 0, vy: BB.JUMP, r: 16, squash: 1, effects: {}, effectMax: {}, grace: 0 };
  G = {
    p, cam: 0, maxH: 0, bonus: 0, coins: 0, coinAcc: 0, banked: 0,
    plats: [], items: [], enemies: [], parts, stars: [],
    topY: H, lastSolidY: H - 60, y0: H - 120, hOff: 0,
    combo: 0, shake: 0, t: 0, realT: 0,
    demo: !!demo, dead: false, killer: null, revives: 0, result: null, lastLand: null,
    stats: { jumps: 0, stomps: 0, coins: 0, powerups: 0, springs: 0, maxCombo: 0 },
    trail: []
  };
  for (let i = 0; i < 60; i++) {
    const s = Math.random() * 2 + 0.5;
    G.stars.push({ x: Math.random(), y: Math.random(), s, col: 'rgba(255,247,232,' + (0.3 + s * 0.2).toFixed(2) + ')' });
  }
  for (let i = 0; i < TRAIL_N; i++) G.trail.push({ x: p.x, y: p.y });
  emit('newGame', G);
  p.vy = BB.JUMP * mods.jumpMult;
  BB.spawnPlatform('normal', W / 2 - 40, H - 60, 80);
  while (G.topY > -H) spawnRow();
  lastScoreShown = lastCoinsShown = -1;
}

function endRun(reason, showOver) {
  running = false;
  paused = false;
  G.dead = true;
  G.shake = 0;
  clearInput();
  if (reason !== 'quit') beep(400, 0.6, 'sawtooth', 0.08, 0.2);
  const score = BB.score();
  const gained = G.coins - G.banked;
  G.banked = G.coins;
  save.coins += gained;
  const prevBest = save.best;
  const nb = score > save.best;
  if (nb) save.best = score;
  store();
  if (G.combo > G.stats.maxCombo) G.stats.maxCombo = G.combo;
  const result = {
    score, height: G.maxH, coins: G.coins, reason,
    durationSec: Math.round(G.realT * 10) / 10,
    stats: G.stats, newBest: nb, prevBest, killer: G.killer, revives: G.revives
  };
  G.result = result;
  overExtras.innerHTML = '';
  $('final').textContent = score;
  $('overMsg').textContent = (nb ? 'NEW BEST! ' : 'Best ' + save.best + '. ') + 'You grabbed ' + G.coins + ' coins.';
  hudEl.hidden = true;
  emit('die', result);
  if (showOver && G.dead && !running) ui.show('over');
  return result;
}

BB.kill = function (reason) {
  if (!G || G.dead || G.demo || !running) return false;
  reason = reason || 'unknown';
  let cancel = !!(BB.debug.god && reason !== 'debug');
  if (!cancel) cancel = emitUntil('beforeDie', reason, G);
  if (cancel) {
    if (G.dead || !running) return false; // a handler ended things itself
    const p = G.p;
    if (p.y - G.cam > H - p.r) { // still below the screen: rescue bounce
      p.y = G.cam + H - p.r;
      p.vy = BB.JUMP * 1.5 * mods.jumpMult;
      p.squash = 0.6;
      BB.burst(p.x, p.y + p.r, '#3ff0c0', 14);
      beep(300, 0.25, 'sine', 0.07, 3);
    }
    p.grace = Math.max(p.grace, 1);
    return false;
  }
  endRun(reason, true);
  return true;
};

BB.start = function () {
  if (G && running && !G.dead && !G.demo) endRun('quit', false);
  newGame(false);
  running = true;
  paused = false;
  clearInput();
  ui.hideAll();
  scoreEl.textContent = lastScoreShown = BB.score();
  coinsHudEl.textContent = lastCoinsShown = G.coins;
  hudEl.hidden = false;
  measureHud();
  last = performance.now();
  beep(523, 0.1);
  setTimeout(() => beep(784, 0.15), 100);
  emit('start', G);
};

BB.pause = function () {
  if (!running || paused || !G || G.dead) return false;
  paused = true;
  clearInput();
  emit('pause');
  return true;
};
BB.resume = function () {
  if (!paused) return false;
  paused = false;
  clearInput();
  last = performance.now();
  emit('resume');
  return true;
};

BB.toMenu = function () {
  if (G && running && !G.dead && !G.demo) endRun('quit', false);
  running = false;
  paused = false;
  hudEl.hidden = true;
  ui.show('menu');
  refreshMenu();
  emit('menu');
};

BB.revive = function () {
  if (!G || !G.dead || G.demo || running) return false;
  if (G.result && G.result.reason === 'quit') return false;
  const p = G.p;
  for (const name in p.effects) BB.endEffect(name);
  const y = G.cam + H * 0.72;
  const pl = BB.spawnPlatform('normal', W / 2 - 45, y, 90);
  if (pl) pl.revive = true;
  p.x = W / 2; p.y = y - p.r - 1; p.vx = 0;
  p.vy = BB.JUMP * mods.jumpMult;
  p.squash = 0.6;
  p.grace = 1;
  setEffect('shield', 2);
  for (let i = 0; i < G.trail.length; i++) { G.trail[i].x = p.x; G.trail[i].y = p.y; }
  G.dead = false;
  G.killer = null;
  G.revives++;
  running = true;
  paused = false;
  clearInput();
  ui.hideAll();
  hudEl.hidden = false;
  measureHud();
  last = performance.now();
  beep(660, 0.2, 'sine', 0.08, 2);
  emit('revive', G);
  return true;
};

// =====================================================================
// Update
// =====================================================================
let lastScoreShown = -1, lastCoinsShown = -1;

function autopilotDir(p) {
  const g = BB.GRAV * mods.gravityMult;
  const feet = p.y + p.r;
  const minY = p.vy < 0 ? feet - (p.vy * p.vy) / (2 * g) + 8 : feet - 2;
  const vmax = 380 * Math.max(0.5, Math.abs(mods.steerMult));
  let best = null, bestY = Infinity;
  for (let i = 0; i < G.plats.length; i++) {
    const pl = G.plats[i];
    if (pl.dead || pl.falling || pl.y < minY || pl.y > feet + H) continue;
    const t = BB.platformTypes[pl.type];
    if (!t || !t.solid) continue;
    const disc = p.vy * p.vy + 2 * g * (pl.y - feet);
    if (disc < 0) continue;
    const time = (-p.vy + Math.sqrt(disc)) / g;
    const dx = Math.abs(wrapDx(pl.x + pl.w / 2 - p.x));
    if (dx > vmax * time + pl.w / 2) continue;
    if (pl.y < bestY) { bestY = pl.y; best = pl; }
  }
  if (!best) return 0;
  const dx = wrapDx(best.x + best.w / 2 - p.x);
  const s = mods.steerMult < 0 ? -1 : 1;
  return dx > 10 ? s : dx < -10 ? -s : 0;
}

function landOn(pl, t, p) {
  let res;
  if (t && t.onLand) {
    try { res = t.onLand(pl, p, G); } catch (e) { report('platform "' + pl.type + '" onLand', e); }
  }
  if (res === 'pass') return;
  p.y = pl.y - p.r;
  if (typeof res === 'number') p.vy = res * mods.jumpMult;
  else {
    p.vy = BB.JUMP * mods.jumpMult;
    beep(420 + Math.min(G.combo, 10) * 30, 0.08, 'square', 0.04, 1.6);
  }
  p.squash = 0.6;
  G.stats.jumps++;
  G.lastLand = pl;
  emit('land', pl, p, G);
}

BB.bounce = function (vy) {
  if (!G) return;
  G.p.vy = (vy == null ? BB.JUMP : vy) * mods.jumpMult;
  G.p.squash = 0.6;
};

BB.defeatEnemy = function (e, opts) {
  if (!G || e.dead) return 0;
  opts = opts || {};
  const t = BB.enemyTypes[e.type] || {};
  e.dead = true;
  BB.shake(opts.shake == null ? 8 : opts.shake);
  const coins = BB.addCoins(opts.coins == null ? 3 : opts.coins);
  BB.burst(e.x, e.y, opts.color || t.color || '#ff4fa3', 20);
  beep(120, 0.25, 'square', 0.08, 0.3);
  if (opts.toast !== false) toast((opts.toast || 'STOMP!') + (coins ? ' +' + coins : ''));
  G.stats.stomps++;
  emit('stomp', e, G);
  return coins;
};

function enemyContact(e, t, p) {
  const inv = BB.isInvincible();
  const fromAbove = p.vy > 0 && p.y < e.y - 4;
  if ((fromAbove && t.stompable !== false) || inv) {
    const how = fromAbove && t.stompable !== false ? 'stomp' : 'invincible';
    if (t.onStomp) {
      let r;
      try { r = t.onStomp(e, p, G, how); } catch (err) { report('enemy "' + e.type + '" onStomp', err); }
      if (r === true) return;
    }
    BB.defeatEnemy(e);
    BB.bounce(BB.JUMP * 1.1);
    return;
  }
  if (p.grace > 0) return;
  if (t.onHit) {
    let r;
    try { r = t.onHit(e, p, G); } catch (err) { report('enemy "' + e.type + '" onHit', err); }
    if (r === true) return;
  }
  G.killer = e.type;
  BB.kill('enemy');
}

function update(dt, rdt) {
  const p = G.p;
  G.t += dt;
  G.realT += rdt;
  BB.dt = dt;
  BB.rawDt = rdt;
  emit('preUpdate', dt, G);
  if (!running || paused) return;

  // ---- steering
  let L = tLeft || !!keys.arrowleft || !!keys.a;
  let R = tRight || !!keys.arrowright || !!keys.d;
  if (BB.debug.autopilot) { const dir = autopilotDir(p); L = dir < 0; R = dir > 0; }
  input.left = L; input.right = R;
  const acc = 2400 * mods.steerMult;
  if (L) p.vx -= acc * dt;
  if (R) p.vx += acc * dt;
  if (!L && !R) p.vx *= Math.pow(0.02, dt);
  const vmax = 420 * Math.max(0.5, Math.abs(mods.steerMult));
  if (p.vx > vmax) p.vx = vmax; else if (p.vx < -vmax) p.vx = -vmax;

  // ---- gravity, then effects (which may override velocity, e.g. jetpack)
  p.vy += BB.GRAV * mods.gravityMult * dt;
  const fx = p.effects;
  for (const name in fx) {
    fx[name] -= rdt;
    if (fx[name] <= 0) { BB.endEffect(name); continue; }
    const et = BB.effectTypes[name];
    if (et && et.update) { try { et.update(p, dt, G); } catch (e) { report('effect "' + name + '" update', e); } }
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  let wrapped = false;
  if (p.x < -p.r) { p.x = W + p.r; wrapped = true; }
  else if (p.x > W + p.r) { p.x = -p.r; wrapped = true; }
  p.squash += (1 - p.squash) * Math.min(1, dt * 12);
  if (p.grace > 0) p.grace = Math.max(0, p.grace - rdt);

  // ---- platforms
  const noLand = effectFlag('noLand');
  const plats = G.plats;
  for (let i = 0; i < plats.length; i++) {
    const pl = plats[i];
    if (pl.dead) continue;
    const t = BB.platformTypes[pl.type];
    pl.age += dt;
    if (t && t.update) {
      try { t.update(pl, dt, G); } catch (e) { pl.dead = true; report('platform "' + pl.type + '" update', e); continue; }
    }
    if (pl.falling) { pl.vy += BB.GRAV * dt; pl.y += pl.vy * dt; continue; }
    if (pl.dead || noLand || p.vy <= 0) continue;
    if (p.x > pl.x - p.r * 0.6 && p.x < pl.x + pl.w + p.r * 0.6 &&
        p.y + p.r > pl.y && p.y + p.r - p.vy * dt <= pl.y + 6) {
      landOn(pl, t, p);
    }
  }

  // ---- items
  const items = G.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.got) continue;
    const t = BB.itemTypes[it.type];
    if (!t) { it.got = true; continue; }
    it.age += dt;
    if (t.update) { try { t.update(it, dt, G); } catch (e) { it.got = true; report('item "' + it.type + '" update', e); continue; } }
    const reach = p.r + (t.radius || 14);
    const dx = p.x - it.x, dy = p.y - it.y;
    if (dx * dx + dy * dy < reach * reach) {
      it.got = true;
      if (t.powerup) G.stats.powerups++;
      try { if (t.onCollect) t.onCollect(it, p, G); } catch (e) { report('item "' + it.type + '" onCollect', e); }
      emit('collect', it, G);
      if (!running) return;
    }
  }

  // ---- enemies
  const ens = G.enemies;
  for (let i = 0; i < ens.length; i++) {
    const e = ens[i];
    if (e.remove) continue;
    if (e.dead) { e.y += 400 * dt; continue; }
    const t = BB.enemyTypes[e.type];
    if (!t) { e.remove = true; continue; }
    e.age += dt;
    if (t.update) { try { t.update(e, dt, G); } catch (err) { e.remove = true; report('enemy "' + e.type + '" update', err); continue; } }
    if (e.dead || e.remove) continue;
    const reach = p.r + e.r;
    const dx = p.x - e.x, dy = p.y - e.y;
    if (dx * dx + dy * dy < reach * reach) {
      enemyContact(e, t, p);
      if (!running) return;
    }
  }

  updateJuice(dt, rdt);

  // ---- camera, progression, spawning, culling
  const target = p.y - H * 0.42;
  if (target < G.cam) G.cam = target;
  const h = Math.floor(-(p.y - G.y0) / 10) + G.hOff;
  if (h > G.maxH) {
    const gain = h - G.maxH;
    G.maxH = h;
    if (mods.scoreMult !== 1) G.bonus += gain * (mods.scoreMult - 1);
  }
  while (G.topY > G.cam - 200) spawnRow();
  const cut = G.cam + H + 100;
  let j = 0;
  for (let i = 0; i < plats.length; i++) { const o = plats[i]; if (!o.dead && o.y < cut) plats[j++] = o; }
  plats.length = j;
  j = 0;
  for (let i = 0; i < items.length; i++) { const o = items[i]; if (!o.got && o.y < cut) items[j++] = o; }
  items.length = j;
  j = 0;
  for (let i = 0; i < ens.length; i++) { const o = ens[i]; if (!o.remove && o.y < cut) ens[j++] = o; }
  ens.length = j;
  G.shake *= 0.9;
  if (G.combo > G.stats.maxCombo) G.stats.maxCombo = G.combo;

  // ---- trail ring buffer (world coords, oldest first)
  const tr = G.trail;
  if (wrapped) { for (let i = 0; i < tr.length; i++) { tr[i].x = p.x; tr[i].y = p.y; } }
  else { const q = tr.shift(); q.x = p.x; q.y = p.y; tr.push(q); }

  emit('update', dt, G);
  if (!running) return;

  if (p.y - G.cam > H + 60) { BB.kill('fall'); if (!running) return; }

  const s = BB.score();
  if (s !== lastScoreShown) { scoreEl.textContent = s; lastScoreShown = s; }
  if (G.coins !== lastCoinsShown) { coinsHudEl.textContent = G.coins; lastCoinsShown = G.coins; }
}

// =====================================================================
// Draw
// =====================================================================
let skyGrad = null, skyK = -1, skyOwned = false;
function drawSky() {
  const k = G ? Math.min(1, G.maxH / 8000) : 0;
  const kq = Math.round(k * 200) / 200;
  if (!skyGrad || kq !== skyK) {
    skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, 'hsl(' + (260 - kq * 60) + ',60%,' + (8 + kq * 4) + '%)');
    skyGrad.addColorStop(1, 'hsl(' + (280 - kq * 80) + ',55%,' + (20 - kq * 6) + '%)');
    skyK = kq;
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);
  if (!G) return;
  const st = G.stars;
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    const y = ((s.y * H - G.cam * 0.1 * s.s) % H + H) % H;
    ctx.fillStyle = s.col;
    ctx.fillRect(s.x * W, y, s.s, s.s);
  }
}

function drawTrail(p) {
  const tr = BB.equipped('trail');
  if (!tr || (!tr.draw && !tr.color)) return;
  const pts = G.trail;
  if (tr.draw) { tr.draw(ctx, pts, p, G); ctx.globalAlpha = 1; return; }
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const q = pts[i], k = (i + 1) / n;
    ctx.globalAlpha = k * 0.45;
    ctx.fillStyle = paint(tr.color, G.t - (n - i) * 0.03);
    circle(ctx, q.x, q.y, p.r * (0.3 + 0.6 * k));
  }
  ctx.globalAlpha = 1;
}

function drawPlayer(p) {
  ctx.save();
  ctx.translate(p.x, p.y + p.r);
  ctx.scale(2 - p.squash, p.squash);
  ctx.translate(0, -p.r);
  const sk = BB.equipped('skin');
  if (sk && sk.draw) sk.draw(ctx, p, G.t);
  else { ctx.fillStyle = paint(sk ? sk.color : '#ffcf3f', G.t); circle(ctx, 0, 0, p.r); }
  const look = Math.max(-4, Math.min(4, p.vx / 80));
  const py = p.vy > 0 ? 1.5 : -1.5;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-6 + look, -3, 5, 0, TAU); ctx.arc(6 + look, -3, 5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#140b2e';
  ctx.beginPath(); ctx.arc(-6 + look * 1.4, -3 + py, 2.5, 0, TAU); ctx.arc(6 + look * 1.4, -3 + py, 2.5, 0, TAU); ctx.fill();
  const hat = BB.equipped('hat');
  if (hat && hat.draw) hat.draw(ctx, p, G.t);
  emit('drawPlayer', ctx, p, G);
  ctx.restore();
}

const FLOAT_FONT = '20px Bungee, Impact, sans-serif';
function drawWorld() {
  const sh = !paused && G.shake > 0.3 ? G.shake : 0;
  ctx.save();
  ctx.translate(sh ? (Math.random() - 0.5) * sh : 0, -G.cam + (sh ? (Math.random() - 0.5) * sh : 0));
  emit('drawBehind', ctx, G);
  const top = G.cam - 80, bot = G.cam + H + 80;
  try {
    const plats = G.plats;
    for (let i = 0; i < plats.length; i++) {
      const pl = plats[i];
      if (pl.dead || pl.y < top || pl.y > bot) continue;
      const t = BB.platformTypes[pl.type];
      if (t && t.draw) t.draw(ctx, pl, G); else drawPlatformBase(ctx, pl, t && t.color);
    }
  } catch (e) { report('platform draw', e); }
  ctx.globalAlpha = 1;
  try {
    const items = G.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.got || it.y < top || it.y > bot) continue;
      const t = BB.itemTypes[it.type];
      if (!t) continue;
      if (t.draw) t.draw(ctx, it, G);
      else drawBadge(ctx, it.x, it.y + Math.sin(G.t * 4 + it.x) * 3, 14, t.color, t.icon);
    }
  } catch (e) { report('item draw', e); }
  ctx.globalAlpha = 1;
  try {
    const ens = G.enemies;
    for (let i = 0; i < ens.length; i++) {
      const e = ens[i];
      if (e.remove || e.y < top - 100 || e.y > bot + 100) continue;
      const t = BB.enemyTypes[e.type];
      if (!t) continue;
      if (t.draw) t.draw(ctx, e, G); else { ctx.fillStyle = t.color || '#ff4fa3'; circle(ctx, e.x, e.y, e.r); }
    }
  } catch (e) { report('enemy draw', e); }
  ctx.globalAlpha = 1;
  for (let i = 0; i < parts.length; i++) {
    const q = parts[i];
    ctx.globalAlpha = q.life / q.max;
    ctx.fillStyle = q.col;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
  const p = G.p;
  try {
    for (const name in p.effects) { const et = BB.effectTypes[name]; if (et && et.draw) et.draw(ctx, p, G); }
  } catch (e) { report('effect draw', e); }
  ctx.globalAlpha = 1;
  try { drawTrail(p); } catch (e) { report('trail draw', e); ctx.globalAlpha = 1; }
  drawPlayer(p);
  if (floats.length) {
    ctx.font = FLOAT_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < floats.length; i++) {
      const f = floats[i];
      ctx.globalAlpha = Math.min(1, f.life / 0.4);
      ctx.fillStyle = '#140b2e';
      ctx.fillText(f.text, f.x, f.y + 3);
      ctx.fillStyle = f.col;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }
  emit('drawWorld', ctx, G);
  ctx.restore();
}

function drawEffectsHud() {
  const fx = G.p.effects, mx = G.p.effectMax;
  let x = layout.hudX + 20;
  const y = layout.effectsY + 22;
  for (const name in fx) {
    const t = BB.effectTypes[name] || {};
    const rem = fx[name];
    const max = mx[name] || rem || 1;
    const frac = Math.max(0, Math.min(1, rem / max));
    ctx.fillStyle = 'rgba(20,11,46,.75)';
    circle(ctx, x, y, 21);
    drawBadge(ctx, x, y, 15, t.color || '#fff7e8', t.icon || '?');
    ctx.strokeStyle = rem < 2 && ((G.realT * 8) | 0) % 2 ? 'rgba(255,247,232,.3)' : '#fff7e8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 19, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
    ctx.stroke();
    x += 48;
  }
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 1;
  if (!skyOwned) drawSky();
  skyOwned = G ? emit('drawBackground', ctx, G) : false;
  if (!G) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 1;
  drawWorld();
  if (flashT > 0) {
    ctx.globalAlpha = flashA * (flashT / 0.25);
    ctx.fillStyle = flashCol;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  if ((running || paused) && !G.demo && !G.dead) {
    drawEffectsHud();
    emit('drawHUD', ctx, G);
    ctx.globalAlpha = 1;
  }
  if (paused && !BB.hasListeners('pause')) {
    ctx.fillStyle = 'rgba(20,11,46,.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffcf3f';
    ctx.font = '40px Bungee, Impact, sans-serif';
    ctx.fillText('PAUSED', W / 2, H / 2 - 20);
    ctx.fillStyle = '#fff7e8';
    ctx.font = '900 18px Nunito, system-ui, sans-serif';
    ctx.fillText('Tap to keep going', W / 2, H / 2 + 24);
  }
}

// =====================================================================
// Main loop
// =====================================================================
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let rdt = (now - last) / 1000;
  last = now;
  if (!(rdt > 0)) rdt = 0;
  if (rdt > 0.033) rdt = 0.033;
  if (running && !paused && G) {
    try { update(rdt * mods.timeScale, rdt); } catch (e) { report('update', e); }
  }
  try { draw(); }
  catch (e) {
    report('draw', e);
    try { if (ctx.reset) ctx.reset(); else cv.width = cv.width; } catch (e2) { /* ignore */ }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
}

// =====================================================================
// Menus + shop
// =====================================================================
function refreshMenu() {
  $('best').textContent = save.best;
  $('coins').textContent = save.coins;
}
BB.refreshMenu = refreshMenu;

let shopTab = 'skins';
const TAB_KIND = { skins: 'skin', trails: 'trail', hats: 'hat' };
const PREVIEW_P = { x: 0, y: 0, vx: 0, vy: 0, r: 15, squash: 1, effects: {}, effectMax: {}, grace: 0 };
const PREVIEW_PTS = [];
for (let i = 0; i < TRAIL_N; i++) PREVIEW_PTS.push({ x: 0, y: 0 });

function previewEl(item, kind) {
  if (item.preview) {
    const d = document.createElement('div');
    d.className = 'dot';
    if (item.preview === 'none') d.classList.add('none');
    else d.style.background = item.preview;
    return d;
  }
  if (kind === 'skin' && !item.draw) {
    const d = document.createElement('div');
    d.className = 'dot';
    d.style.background = item.color === 'rainbow'
      ? 'conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)' : (item.color || '#ffcf3f');
    return d;
  }
  const c = document.createElement('canvas');
  c.className = 'dot pv';
  c.width = 88; c.height = 88;
  const x = c.getContext('2d');
  x.scale(2, 2);
  try {
    if (kind === 'skin') {
      x.translate(22, 22);
      item.draw(x, PREVIEW_P, 0);
    } else if (kind === 'trail') {
      const base = BB.equipped('skin');
      const n = PREVIEW_PTS.length;
      for (let i = 0; i < n; i++) { PREVIEW_PTS[i].x = 4 + i * 2.6; PREVIEW_PTS[i].y = 40 - i * 2.6; }
      const pp = Object.assign({}, PREVIEW_P, { x: PREVIEW_PTS[n - 1].x, y: PREVIEW_PTS[n - 1].y, r: 9 });
      if (item.draw) item.draw(x, PREVIEW_PTS, pp, G || { t: 0 });
      else if (item.color) {
        for (let i = 0; i < n - 1; i++) {
          const k = (i + 1) / n;
          x.globalAlpha = 0.25 + k * 0.6;
          x.fillStyle = paint(item.color, i * 0.05);
          circle(x, PREVIEW_PTS[i].x, PREVIEW_PTS[i].y, 9 * (0.3 + 0.6 * k));
        }
        x.globalAlpha = 1;
      }
      x.fillStyle = paint(base && base.color ? base.color : '#ffcf3f', 0);
      circle(x, pp.x, pp.y, 9);
    } else {
      x.translate(22, 27);
      const base = BB.equipped('skin');
      if (base && base.draw) base.draw(x, PREVIEW_P, 0);
      else { x.fillStyle = paint(base ? base.color : '#ffcf3f', 0); circle(x, 0, 0, 15); }
      if (item.draw) item.draw(x, PREVIEW_P, 0);
    }
  } catch (e) { report('shop preview "' + item.id + '"', e); }
  return c;
}

function renderShop() {
  const tabs = $('shopTabs').children;
  for (let i = 0; i < tabs.length; i++) {
    const on = tabs[i].dataset.tab === shopTab;
    tabs[i].classList.toggle('on', on);
    tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
  }
  const kind = TAB_KIND[shopTab];
  const list = BB.cosmetics[shopTab] || [];
  const box = $('skins');
  box.innerHTML = '';
  const eq = BB.equipped(kind);
  list.forEach(item => {
    const b = document.createElement('button');
    b.type = 'button';
    const isOn = eq && eq.id === item.id;
    b.className = 'skin' + (isOn ? ' on' : '');
    const own = BB.owns(item.id);
    let lock = null;
    if (!own && item.locked) { try { lock = item.locked(); } catch (e) { lock = null; } }
    b.appendChild(previewEl(item, kind));
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = item.name;
    b.appendChild(nm);
    const st = document.createElement('span');
    st.className = 'st';
    st.textContent = own ? (isOn ? 'Equipped' : 'Equip') : lock ? String(lock) : '\u25CF ' + item.price;
    b.appendChild(st);
    b.onclick = () => {
      if (own) { BB.equip(kind, item.id); beep(660, 0.08, 'square', 0.04); }
      else if (!lock && save.coins >= item.price) {
        save.coins -= item.price;
        BB.grant(item.id);
        BB.equip(kind, item.id);
        beep(880, 0.2, 'sine', 0.08, 2);
        emit('buy', item, kind);
      } else {
        beep(150, 0.15, 'square', 0.05);
        try { b.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], 200); } catch (e) { /* no WAAPI */ }
        return;
      }
      store();
      renderShop();
    };
    box.appendChild(b);
  });
  $('shopMsg').textContent = 'You have ' + save.coins + ' coins. Collect more while you play!';
}
BB.openShop = function (tab) {
  if (tab && BB.cosmetics[tab]) shopTab = tab;
  ui.show('shop');
  renderShop();
  emit('shopOpen', shopTab);
};
BB.renderShop = renderShop;

Array.prototype.forEach.call($('shopTabs').children, t => {
  t.addEventListener('click', () => { shopTab = t.dataset.tab; renderShop(); beep(520, 0.05, 'square', 0.03); });
});
$('play').onclick = () => BB.start();
$('again').onclick = () => BB.start();
$('home').onclick = () => BB.toMenu();
$('shopBtn').onclick = () => BB.openShop();
$('back').onclick = () => BB.toMenu();

// =====================================================================
// Base content (exactly the original game)
// =====================================================================
// ---- platforms: weights reproduce the original roll
//      r<.12+.15d moving, r<.22+.2d break, r<.28 spring, else normal
BB.platformTypes.normal = {
  color: '#3ff0c0', solid: true,
  weight: d => 1 - Math.max(0.28, 0.22 + 0.2 * d)
};
BB.platformTypes.moving = {
  color: '#8fd8ff', solid: true,
  weight: d => 0.12 + 0.15 * d,
  init(pl, G, d) { pl.dir = Math.random() < 0.5 ? 1 : -1; pl.speed = 60 + d * 120; },
  update(pl, dt) {
    pl.x += pl.dir * pl.speed * dt;
    if (pl.x < 0) { pl.x = 0; pl.dir = 1; }
    else if (pl.x + pl.w > W) { pl.x = W - pl.w; pl.dir = -1; }
  }
};
BB.platformTypes.break = {
  color: '#c58b5a', solid: false,
  weight: d => 0.10 + 0.05 * d,
  onLand(pl) {
    pl.falling = true;
    BB.burst(pl.x + pl.w / 2, pl.y, '#c58b5a', 8);
    beep(160, 0.12, 'sawtooth', 0.05, 0.5);
    return 'pass';
  },
  draw(c, pl) {
    drawPlatformBase(c, pl, '#c58b5a');
    c.strokeStyle = '#5a3a20';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(pl.x + pl.w * 0.4, pl.y);
    c.lineTo(pl.x + pl.w * 0.5, pl.y + 12);
    c.lineTo(pl.x + pl.w * 0.6, pl.y);
    c.stroke();
  }
};
BB.platformTypes.spring = {
  color: '#3ff0c0', solid: true,
  weight: d => Math.max(0, 0.06 - 0.2 * d),
  onLand(pl, p, G) {
    beep(300, 0.3, 'sine', 0.08, 3);
    BB.burst(p.x, pl.y, '#3ff0c0', 14);
    toast('BOING!');
    G.stats.springs++;
    return BB.JUMP * 1.7;
  },
  draw(c, pl) {
    drawPlatformBase(c, pl, '#3ff0c0');
    c.fillStyle = '#ff4fa3';
    rr(c, pl.x + pl.w / 2 - 10, pl.y - 10, 20, 10, 3);
  }
};

// ---- effects
BB.effectTypes.jet = {
  icon: 'J', color: '#ff8a3d', label: 'Jetpack', noLand: true, invincible: true,
  update(p) {
    p.vy = -950;
    if (Math.random() < 0.8) emitParticle(p.x, p.y + p.r, (Math.random() - 0.5) * 80, 300, 0.4, '#ff8a3d', 4, 600);
  }
};
BB.effectTypes.shield = {
  icon: 'S', color: '#8fd8ff', label: 'Shield', invincible: true,
  draw(c, p, G) {
    const s = p.effects.shield || 0;
    c.strokeStyle = s < 2 ? (Math.sin(G.t * 20) > 0 ? 'rgba(143,216,255,.9)' : 'rgba(143,216,255,.2)') : 'rgba(143,216,255,.8)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(p.x, p.y, p.r + 8, 0, TAU);
    c.stroke();
  }
};
BB.effectTypes.magnet = {
  icon: 'M', color: '#ff4fa3', label: 'Magnet',
  update(p, dt, G) {
    const range = mods.magnetRange, items = G.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.got) continue;
      const t = BB.itemTypes[it.type];
      if (!t || !t.magnetic) continue;
      const dx = p.x - it.x, dy = p.y - it.y, dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < range && dd > 1) { it.x += dx / dd * 600 * dt; it.y += dy / dd * 600 * dt; }
    }
  }
};

// ---- items: weights are absolute per-row chances (coin .35, each power-up .03)
BB.itemTypes.coin = {
  weight: () => 0.35, lift: 30, radius: 14, magnetic: true, color: '#ffcf3f',
  draw(c, it, G) {
    const ph = G.t * 4 + it.x;
    const bob = Math.sin(ph) * 3, sx = Math.abs(Math.cos(ph));
    c.fillStyle = '#ffcf3f';
    c.beginPath();
    c.ellipse(it.x, it.y + bob, 9 * sx + 1, 9, 0, 0, TAU);
    c.fill();
  },
  onCollect(it) {
    BB.addCoins(1);
    beep(988, 0.06, 'square', 0.04);
    setTimeout(() => beep(1318, 0.1, 'square', 0.04), 60);
    BB.burst(it.x, it.y, '#ffcf3f', 6, 120);
  }
};
BB.itemTypes.jet = {
  weight: () => 0.03, lift: 34, powerup: true, color: '#ff8a3d', icon: 'J',
  onCollect() { BB.addEffect('jet', 2.5); toast('JETPACK!'); beep(200, 0.5, 'sawtooth', 0.06, 4); }
};
BB.itemTypes.shield = {
  weight: () => 0.03, lift: 34, powerup: true, color: '#8fd8ff', icon: 'S',
  onCollect() { BB.addEffect('shield', 8); toast('SHIELD!'); beep(600, 0.3, 'sine', 0.08, 2); }
};
BB.itemTypes.magnet = {
  weight: () => 0.03, lift: 34, powerup: true, color: '#ff4fa3', icon: 'M',
  onCollect() { BB.addEffect('magnet', 8); toast('COIN MAGNET!'); beep(500, 0.3, 'triangle', 0.08, 2); }
};

// ---- enemies
BB.enemyTypes.bat = {
  r: 18, minHeight: 1500, stompable: true, color: '#ff4fa3',
  weight: d => 0.04 + d * 0.08,
  create() { return { t: Math.random() * 6 }; },
  update(e, dt) { e.t += dt; e.x += Math.sin(e.t * 2) * 90 * dt; },
  draw(c, e, G) {
    c.fillStyle = '#ff4fa3';
    circle(c, e.x, e.y, e.r);
    const f = Math.sin(G.t * 20) * 8;
    c.beginPath();
    c.moveTo(e.x - e.r, e.y); c.lineTo(e.x - e.r - 14, e.y - 6 + f); c.lineTo(e.x - e.r + 2, e.y + 8);
    c.moveTo(e.x + e.r, e.y); c.lineTo(e.x + e.r + 14, e.y - 6 + f); c.lineTo(e.x + e.r - 2, e.y + 8);
    c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(e.x - 6, e.y - 3, 5, 0, TAU); c.arc(e.x + 6, e.y - 3, 5, 0, TAU); c.fill();
    c.fillStyle = '#140b2e';
    c.beginPath(); c.arc(e.x - 6, e.y - 2, 2.5, 0, TAU); c.arc(e.x + 6, e.y - 2, 2.5, 0, TAU); c.fill();
  }
};

// ---- cosmetics (ids for the 6 original skins are fixed: old saves map to them)
BB.cosmetics.skins.push(
  { id: 'sunny', name: 'Sunny', color: '#ffcf3f', price: 0 },
  { id: 'bubblegum', name: 'Bubblegum', color: '#ff4fa3', price: 50 },
  { id: 'mint', name: 'Mint', color: '#3ff0c0', price: 100 },
  { id: 'lava', name: 'Lava', color: '#ff5a1f', price: 200 },
  { id: 'ice', name: 'Ice', color: '#8fd8ff', price: 300 },
  { id: 'rainbow', name: 'Rainbow', color: 'rainbow', price: 600 }
);
BB.cosmetics.trails.push({ id: 'notrail', name: 'None', price: 0, preview: 'none' });
BB.cosmetics.hats.push({ id: 'nohat', name: 'None', price: 0, preview: 'none' });

// =====================================================================
// Debug (for automated tests). '#debug' in the URL sets BB.debugEnabled.
// =====================================================================
BB.debugEnabled = /debug/i.test(location.hash || '');
function needRun() { return G && !G.dead; }
BB.debug = {
  god: false,
  autopilot: false,
  spawnPlatform(type) {
    if (!needRun()) return null;
    const t = BB.platformTypes[type];
    if (!t) return null;
    const w = widthFor(t, difficulty());
    return BB.spawnPlatform(type, Math.max(0, Math.min(W - w, G.p.x - w / 2)), G.p.y - 90, w);
  },
  spawnItem(type) { return needRun() ? BB.spawnItem(type, G.p.x, G.p.y - 70) : null; },
  spawnEnemy(type) { return needRun() ? BB.spawnEnemy(type, G.p.x, G.p.y - 180) : null; },
  effect(name, secs) { return needRun() ? BB.addEffect(name, secs == null ? 5 : secs) : 0; },
  setHeight(h) {
    if (!G) return;
    const phys = Math.floor(-(G.p.y - G.y0) / 10);
    G.hOff = Math.round(h) - phys;
    G.maxH = Math.round(h);
  },
  addCoins(n) { return BB.bankCoins(n); },
  kill() { const g = BB.debug.god; BB.debug.god = false; const r = BB.kill('debug'); BB.debug.god = g; return r; },
  listTypes() {
    return {
      platforms: Object.keys(BB.platformTypes),
      items: Object.keys(BB.itemTypes),
      enemies: Object.keys(BB.enemyTypes),
      effects: Object.keys(BB.effectTypes),
      skins: BB.cosmetics.skins.map(s => s.id),
      trails: BB.cosmetics.trails.map(s => s.id),
      hats: BB.cosmetics.hats.map(s => s.id)
    };
  }
};

// =====================================================================
// Live state accessors
// =====================================================================
Object.defineProperties(BB, {
  G: { get: () => G, enumerable: true },
  save: { get: () => save, enumerable: true },
  W: { get: () => W, enumerable: true },
  H: { get: () => H, enumerable: true },
  DPR: { get: () => DPR, enumerable: true },
  ctx: { value: ctx, enumerable: true },
  canvas: { value: cv, enumerable: true },
  running: { get: () => running, enumerable: true },
  paused: { get: () => paused, enumerable: true },
  booted: { get: () => booted, enumerable: true },
  t: { get: () => (G ? G.t : 0), enumerable: true }
});
BB.dt = 0;
BB.rawDt = 0;

// =====================================================================
// Boot (called by main.js after every feature file has registered)
// =====================================================================
BB.boot = function () {
  if (booted) return;
  booted = true;
  resize();
  // validate equipped cosmetics now that features have added theirs
  for (const kind in KIND_LIST) {
    const list = BB.cosmetics[KIND_LIST[kind]];
    if (!list.some(i => i.id === save.equipped[kind])) save.equipped[kind] = list.length ? list[0].id : null;
  }
  if (migrated) store();
  emit('boot');
  newGame(true); // demo world behind the menu
  ui.show('menu');
  refreshMenu();
  emit('menu');
  last = performance.now();
  requestAnimationFrame(loop);
};

resize();
})();
