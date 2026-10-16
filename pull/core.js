/* =============================================================================
 * FULL PULL — core.js
 * County-fair truck & tractor pulling. Engine + global window.TP API + base content.
 *
 * Load order: three.min.js (r128) -> core.js -> features/*.js -> main.js (TP.boot()).
 * Everything at LOAD time is pure data/registries (no DOM, no WebGL) so features
 * can register content before boot, and the simulation can run headless (Node).
 * DOM / renderer / input / audio are created in TP.boot().
 *
 * Coordinates: Y up, metres internally. The pull lane runs along +X from the
 * start line (x = 0). +Z is the driver's RIGHT. Distances shown to players in feet.
 * See API.md for the full, exact API.
 * ========================================================================== */
(function () {
'use strict';
var W = (typeof window !== 'undefined') ? window : globalThis;
var TP = W.TP = W.TP || {};
var HAS_DOM = typeof document !== 'undefined';
TP.version = '1.0.0';
TP.booted = false;

/* ---------------------------------------------------------------------------
 * 1. UTILITIES
 * ------------------------------------------------------------------------- */
var C = TP.C = {
  G: 9.81,            // m/s^2
  LB: 0.45359237,     // kg per lb
  FT: 0.3048,         // m per ft
  LBFT: 1.3558179,    // N*m per lb-ft
  MPH: 2.2369363,     // mph per m/s
  RPM: 9.5492966      // rpm per rad/s
};
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function approach(cur, target, maxDelta) { return cur < target ? Math.min(target, cur + maxDelta) : Math.max(target, cur - maxDelta); }
function damp(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }
function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  var r = mulberry32(seed == null ? (Math.random() * 4294967296) >>> 0 : seed);
  r.range = function (a, b) { return a + (b - a) * r(); };
  r.int = function (a, b) { return a + Math.floor(r() * (b - a + 1)); };
  r.pick = function (arr) { return arr[Math.floor(r() * arr.length)]; };
  r.gauss = function () { return (r() + r() + r() + r() - 2) * 0.866; };
  return r;
}
function hashStr(s) {
  s = String(s); var h = 2166136261 >>> 0;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function fmtFt(m) { return (Math.max(0, m) / C.FT).toFixed(2); }
function fmtCash(n) { n = Math.round(n); return (n < 0 ? '-$' : '$') + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtNum(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function deepFill(target, defs) {
  for (var k in defs) {
    if (!Object.prototype.hasOwnProperty.call(defs, k)) continue;
    var d = defs[k];
    if (target[k] === undefined) target[k] = (d && typeof d === 'object') ? JSON.parse(JSON.stringify(d)) : d;
    else if (d && typeof d === 'object' && !Array.isArray(d) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepFill(target[k], d);
  }
  return target;
}
function shallow(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

TP.util = {
  clamp: clamp, lerp: lerp, smoothstep: smoothstep, approach: approach, damp: damp,
  rng: makeRng, hash: hashStr, fmtFt: fmtFt, fmtCash: fmtCash, fmtNum: fmtNum, esc: esc,
  deepFill: deepFill,
  ft: function (m) { return m / C.FT; },
  m: function (ft) { return ft * C.FT; },
  mph: function (ms) { return ms * C.MPH; },
  el: function (tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  }
};
TP.ft = TP.util.ft; TP.m = TP.util.m; TP.fmtFt = fmtFt; TP.fmtCash = fmtCash;

/* ---------------------------------------------------------------------------
 * 2. EVENTS  TP.on / TP.off / TP.once / TP.emit
 * Listener errors are caught and logged (console.error) so one bad feature
 * can't break the game loop.
 * ------------------------------------------------------------------------- */
var listeners = {};
TP.on = function (name, fn) {
  var arr = listeners[name] ? listeners[name].slice() : [];
  arr.push(fn); listeners[name] = arr;
  return function () { TP.off(name, fn); };
};
TP.off = function (name, fn) {
  var arr = listeners[name]; if (!arr) return;
  listeners[name] = arr.filter(function (f) { return f !== fn && f._orig !== fn; });
};
TP.once = function (name, fn) {
  var w = function (a, b, c, d) { TP.off(name, w); return fn(a, b, c, d); };
  w._orig = fn; return TP.on(name, w);
};
TP.emit = function (name, a, b, c, d) {
  var arr = listeners[name]; if (!arr) return;
  for (var i = 0; i < arr.length; i++) {
    try { arr[i](a, b, c, d); } catch (e) { console.error('[TP] "' + name + '" listener failed:', e); }
  }
};

/* ---------------------------------------------------------------------------
 * 3. STATIC DATA: palette, tires, engine types, classes, skills
 * ------------------------------------------------------------------------- */
TP.palette = {
  dirt: 0x7a4d2a, dirtLight: 0xa0703f, dirtDark: 0x4e3019, dirtWet: 0x3e2614,
  diesel: 0x17140f, flame: 0xff6a1a, fair: 0xffd23f, sky: 0x6cc0ee, cream: 0xfff4dc,
  barnRed: 0xb8322a, grass: 0x6e9e3e, grassDark: 0x4d7a2c, grassLight: 0x8cb850,
  steel: 0x8e979f, steelDark: 0x4b5157, chrome: 0xdfe4e8, rubber: 0x1d1b19, rim: 0xc8ccd0,
  wood: 0x8a5a2b, woodDark: 0x5c3a1b, hay: 0xd8b25a, hayDark: 0xb08a3a,
  white: 0xf3efe6, black: 0x121212, yellow: 0xffc61a, orange: 0xff7a1a, red: 0xd23a2a,
  green: 0x2e8b3d, blue: 0x2565ae, navy: 0x1b2f55, glass: 0x22313b, concrete: 0xb9b4aa,
  skin: [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xa0662f],
  shirts: [0xd23a2a, 0x2565ae, 0xffc61a, 0x2e8b3d, 0xf3efe6, 0xff7a1a, 0x7a3fa0, 0x1b2f55, 0xe85d9a, 0x5fb6e8, 0x9a6a3e, 0x333333]
};

// Tire types: mu = peak grip coefficient on a prepped dirt track, idealSlip = slip at peak
// grip (wheel speed over ground speed - 1), fall = width of the over-spin falloff (x idealSlip),
// floor = grip fraction left at huge wheel speed.
TP.tires = {
  dot:    { name: 'DOT street tires', mu: 0.82, idealSlip: 0.9, fall: 1.3, floor: 0.62, hopGain: 1.0 },
  bigrig: { name: 'Steer & drive tires', mu: 0.80, idealSlip: 0.8, fall: 1.25, floor: 0.6, hopGain: 1.1 },
  ag:     { name: 'Ag bar tires', mu: 0.94, idealSlip: 1.0, fall: 1.3, floor: 0.6, hopGain: 1.35 },
  cut:    { name: 'Cut pulling tires', mu: 1.06, idealSlip: 1.25, fall: 1.45, floor: 0.66, hopGain: 1.15 }
};

// Engine types: torque curve over x = rpm / redline. Peaked parabola (xp, a1 below, a2 above),
// or linear for turbines. lowBoost = torque fraction with the turbo unspooled; spool = spool rate /s.
TP.engineTypes = {
  diesel:   { name: 'Turbo diesel', xp: 0.58, a1: 2.0, a2: 0.85, lowBoost: 0.6, spool: 1.7, idle: 800, stall: 0.45, inertia: 1.3, heat: 1.0, smoke: 1.0, flame: 0.15 },
  gas:      { name: 'Gas V8', xp: 0.70, a1: 1.5, a2: 1.4, lowBoost: 1.0, spool: 6, idle: 950, stall: 0.48, inertia: 0.45, heat: 0.95, smoke: 0.22, flame: 0.35 },
  methanol: { name: 'Methanol multi-turbo', xp: 0.72, a1: 2.3, a2: 1.0, lowBoost: 0.5, spool: 1.3, idle: 1300, stall: 0.5, inertia: 0.7, heat: 0.85, smoke: 0.4, flame: 1.0 },
  turbine:  { name: 'Turbine', linear: true, a: 0.55, lowBoost: 0.4, spool: 0.9, idle: 1500, stall: 0.3, inertia: 0.9, heat: 0.7, smoke: 0.45, flame: 0.7 },
  multi:    { name: 'Multi-engine V8s', xp: 0.66, a1: 1.3, a2: 1.0, lowBoost: 0.85, spool: 3.0, idle: 1100, stall: 0.48, inertia: 1.2, heat: 1.1, smoke: 0.6, flame: 0.85 }
};
function torqueCurve(et, x) {
  if (et.linear) return Math.max(0.35, 1.2 - et.a * x);
  var d = x - et.xp, a = d < 0 ? et.a1 : et.a2;
  return Math.max(0.15, 1 - a * d * d);
}
TP.torqueCurve = torqueCurve;

// Sled model constants: sled-wheel rolling coefficient and pan friction coefficient.
var SLED_RS = 0.11, SLED_MP = 0.62;
/** Effective pulling capacity (lbf) of a vehicle at peak grip on a prepped track: the sled force it
 *  can hold once weight transfer and the chain's down-pull settle. o = {mu, weight (lb), drive '2wd'|'4wd',
 *  frontBias, hitchHeight (m), wheelbase (m)}. */
TP.effTraction = function (o) {
  var mu = o.mu, Wt = o.weight, cd = 0.12, k = (o.hitchHeight || 0.6) / (o.wheelbase || 3);
  if (o.drive === '4wd') return mu * Wt / (1 - mu * cd);
  var fb = o.frontBias != null ? o.frontBias : 0.32;
  var Rr = mu * Wt * (1 - fb) / Math.max(0.2, 1 - mu * (k + cd));
  if (fb * Wt - Rr * k < 0) Rr = mu * Wt / (1 - mu * cd);   // front is up: everything on the rear
  return Rr;
};
/** TP.makeSled(weightLimitLb, tireId, opts) -> sled setup in lb, sized from the class's effective traction
 *  T (TP.effTraction with opts.drive/frontBias/hitchHeight/wheelbase): resistance starts at opts.start x T
 *  (box over the sled wheels) and reaches opts.end x T (box on the pan). */
TP.makeSled = function (weightLimit, tireId, o) {
  o = o || {};
  var mu = (TP.tires[tireId] || TP.tires.dot).mu;
  var T = TP.effTraction({ mu: mu, weight: weightLimit, drive: o.drive || '4wd', frontBias: o.frontBias, hitchHeight: o.hitchHeight, wheelbase: o.wheelbase });
  var start = o.start != null ? o.start : SLED_START, end = o.end != null ? o.end : SLED_END;
  var box = (end - start) * T / (SLED_MP - SLED_RS);
  var base = (start * T - box * SLED_RS) / (0.6 * SLED_RS + 0.4 * SLED_MP);
  var speedRef = o.speedRef || 6;
  var plowK = o.plow != null ? o.plow : SLED_PLOW;
  return { baseWeight: Math.max(500, Math.round(base / 100) * 100), boxWeight: Math.max(500, Math.round(box / 100) * 100),
    boxTravel: o.boxTravel || o.trackLength || 300, panGrow: o.panGrow != null ? o.panGrow : 0.65, digSpeed: o.digSpeed || speedRef * 0.3,
    plow: Math.round(plowK * (1 - start) * T / speedRef), speedRef: speedRef };
};
var SLED_START = 0.2, SLED_END = 0.8, SLED_PLOW = 0.55;

TP.classes = {};
/** Register a class. Fills defaults. */
TP.addClass = function (id, def) {
  def.id = id;
  def.group = def.group || 'truck';
  def.trackLength = def.trackLength || 300;
  def.boostShots = def.boostShots || 0;
  def.difficulty = def.difficulty || 1;
  def.tire = def.tire || 'dot';
  def.drive = def.drive || (def.group === 'truck' ? '4wd' : '2wd');
  var ref = def.ref || (def.group === 'truck' ? { frontBias: 0.56, hitchHeight: 0.62, wheelbase: 3.8 } : { frontBias: 0.32, hitchHeight: 0.55, wheelbase: 2.8 });
  def.ref = ref;
  def.speedRef = def.speedRef || 6;
  def.sled = def.sled || TP.makeSled(def.weightLimit || 8000, def.tire, { drive: def.drive, end: def.sledEnd, start: def.sledStart, speedRef: def.speedRef, trackLength: def.trackLength,
    frontBias: ref.frontBias, hitchHeight: ref.hitchHeight, wheelbase: ref.wheelbase });
  def.payPerFt = def.payPerFt || (4 + def.difficulty * 3);
  def.order = def.order != null ? def.order : Object.keys(TP.classes).length;
  TP.classes[id] = def;
  return def;
};
(function baseClasses() {
  var A = TP.addClass;
  // ---- TRUCKS ----
  A('street_diesel', { speedRef: 5.5, name: 'Street Diesel', group: 'truck', short: 'STREET', order: 0,
    desc: 'Licensed, insured 4x4 diesel pickups on DOT tires. One turbo, big stacks, a whole lot of black smoke.',
    weightLimit: 8000, hpRange: [550, 900], tire: 'dot', drive: '4wd', boostShots: 0, difficulty: 1, sledEnd: 0.78,
    ref: { frontBias: 0.57, hitchHeight: 0.62, wheelbase: 3.9 } });
  A('work_stock', { speedRef: 6, name: 'Work Stock Diesel', group: 'truck', short: 'WORK STOCK', order: 1,
    desc: 'Daily-driver frames with built engines and bigger turbos. Still on DOT rubber, still street legal-ish.',
    weightLimit: 8000, hpRange: [900, 1300], tire: 'dot', drive: '4wd', boostShots: 0, difficulty: 2 });
  A('pro_stock_diesel', { speedRef: 7, name: 'Pro Stock Diesel', group: 'truck', short: 'PRO STOCK', order: 2,
    desc: 'Stock-look bodies over race chassis. Cut tires, compound turbos and a shot of water-meth.',
    weightLimit: 7800, hpRange: [1500, 2000], tire: 'cut', drive: '4wd', boostShots: 1, difficulty: 3 });
  A('super_stock_diesel', { speedRef: 8, name: 'Super Stock Diesel 4x4', group: 'truck', short: 'SUPER STOCK 4x4', order: 3,
    desc: 'Huge single and triple-compound turbos, 3,000+ hp, flames off the stacks and the front end in the air.',
    weightLimit: 7500, hpRange: [2500, 3500], tire: 'cut', drive: '4wd', boostShots: 2, difficulty: 4 });
  A('modified_2wd', { speedRef: 8, name: '2WD Modified Gas', group: 'truck', short: '2WD MOD GAS', order: 4,
    desc: 'Big-block gas trucks with blowers and nitrous, power to the rear wheels only. Loud and twitchy.',
    weightLimit: 6200, hpRange: [1800, 2600], tire: 'cut', drive: '2wd', boostShots: 2, difficulty: 4 });
  A('big_rig', { speedRef: 4.5, name: 'Big Rig Semi', group: 'truck', short: 'BIG RIG', order: 5,
    desc: 'Working semi tractors on drive tires. Twenty thousand pounds of chrome, a jake brake and attitude.',
    weightLimit: 20000, hpRange: [600, 1100], tire: 'bigrig', drive: '4wd', boostShots: 0, difficulty: 2 });
  // ---- TRACTORS ----
  A('mini_rod', { speedRef: 7.5, name: 'Mini Rods', group: 'tractor', short: 'MINI ROD', order: 6,
    desc: 'Tiny chassis, giant engines. Two thousand pounds and over a thousand horsepower. Pure chaos on wheels.',
    weightLimit: 2050, hpRange: [800, 1600], tire: 'cut', drive: '2wd', boostShots: 2, difficulty: 3, sledEnd: 0.83,
    ref: { frontBias: 0.24, hitchHeight: 0.5, wheelbase: 2.3 } });
  A('farm_stock', { speedRef: 3.4, name: 'Farm Stock', group: 'tractor', short: 'FARM STOCK', order: 7,
    desc: 'Field tractors straight off the farm, with ballast hung on the front. Slow, heavy, and honest.',
    weightLimit: 11000, hpRange: [300, 550], tire: 'ag', drive: '2wd', boostShots: 0, difficulty: 1, sledEnd: 0.72,
    ref: { frontBias: 0.36, hitchHeight: 0.55, wheelbase: 2.9 } });
  A('hot_farm', { speedRef: 4.5, name: 'Hot Farm', group: 'tractor', short: 'HOT FARM', order: 8,
    desc: 'Farm tractors with turned-up pumps and bigger turbos. Ag tires, real smoke, serious pulls.',
    weightLimit: 12000, hpRange: [600, 950], tire: 'ag', drive: '2wd', boostShots: 1, difficulty: 2 });
  A('pro_stock_tractor', { speedRef: 6.5, name: 'Pro Stock Tractor', group: 'tractor', short: 'PRO STOCK', order: 9,
    desc: 'Purpose-built pullers with stock-appearing tins, three diesel turbos and cut tires.',
    weightLimit: 10000, hpRange: [2000, 2700], tire: 'cut', drive: '2wd', boostShots: 1, difficulty: 3 });
  A('light_super_stock', { speedRef: 7.5, name: 'Light Super Stock', group: 'tractor', short: 'LIGHT SUPER', order: 10,
    desc: 'Methanol-burning multi-turbo engines in a lighter chassis. Flames on every shift.',
    weightLimit: 6200, hpRange: [3000, 3600], tire: 'cut', drive: '2wd', boostShots: 2, difficulty: 4 });
  A('super_stock_tractor', { speedRef: 8.5, name: 'Super Stock Tractor', group: 'tractor', short: 'SUPER STOCK', order: 11,
    desc: 'Four turbos, methanol, 4,500 horsepower. Fire-breathing kings of the county fair.',
    weightLimit: 8000, hpRange: [4000, 5000], tire: 'cut', drive: '2wd', boostShots: 2, difficulty: 5 });
  A('unlimited_modified', { speedRef: 9, name: 'Unlimited Modified', group: 'tractor', short: 'UNLIMITED', order: 12,
    desc: 'Anything goes: stacked V8s, helicopter turbines, 10,000 horsepower. The craziest machines on dirt.',
    weightLimit: 7500, hpRange: [6000, 10000], tire: 'cut', drive: '2wd', boostShots: 3, difficulty: 5 });
})();
TP.classList = function (group) {
  return Object.keys(TP.classes).map(function (k) { return TP.classes[k]; })
    .filter(function (c) { return !group || c.group === group; })
    .sort(function (a, b) { return a.order - b.order; });
};

// AI skill presets (all 0..1, 1 = best; aggression = how hard they push wheel speed)
TP.skills = {
  rookie: { reaction: 0.15, throttleFeel: 0.12, shiftTiming: 0.15, steering: 0.3, aggression: 0.7, consistency: 0.2 },
  novice: { reaction: 0.3, throttleFeel: 0.28, shiftTiming: 0.3, steering: 0.45, aggression: 0.6, consistency: 0.35 },
  good:   { reaction: 0.6, throttleFeel: 0.6, shiftTiming: 0.6, steering: 0.7, aggression: 0.55, consistency: 0.6 },
  pro:    { reaction: 0.85, throttleFeel: 0.86, shiftTiming: 0.85, steering: 0.88, aggression: 0.55, consistency: 0.82 },
  legend: { reaction: 0.96, throttleFeel: 0.96, shiftTiming: 0.95, steering: 0.95, aggression: 0.6, consistency: 0.94 }
};
TP.resolveSkill = function (s) {
  var base = TP.skills.good;
  if (typeof s === 'string') s = TP.skills[s] || base;
  s = s || base;
  var o = {};
  for (var k in base) o[k] = clamp(s[k] != null ? +s[k] : base[k], 0, 1);
  return o;
};

/* ---------------------------------------------------------------------------
 * 4. REGISTRIES (filled by base content below and by features/*.js)
 * ------------------------------------------------------------------------- */
TP.vehicles = {};
TP.venues = {};
TP.drivers = {};
TP.upgrades = {};
TP.screens = {};
TP.controllers = {};

TP.addVehicle = function (id, def) {
  def.id = id;
  def.price = def.price || 0;
  def.levelReq = def.levelReq || 1;
  def.liveries = def.liveries && def.liveries.length ? def.liveries : [{ name: 'Factory', base: '#c8342b', accent: '#f3efe6', trim: '#17140f', number: '1' }];
  def.engine = def.engine || { type: 'diesel', count: 1 };
  def.specs = def.specs || {};
  TP.vehicles[id] = def;
  return def;
};
TP.vehiclesInClass = function (classId) {
  return Object.keys(TP.vehicles).map(function (k) { return TP.vehicles[k]; })
    .filter(function (v) { return v.class === classId && !v.hidden; })
    .sort(function (a, b) { return (a.price - b.price) || (a.name < b.name ? -1 : 1); });
};
TP.addVenue = function (id, def) { def.id = id; def.levelReq = def.levelReq || 1; TP.venues[id] = def; return def; };
TP.addDriver = function (id, def) { def.id = id; def.skill = TP.resolveSkill(def.skill); def.lines = def.lines || {}; TP.drivers[id] = def; return def; };
TP.addUpgrade = function (id, def) { def.id = id; def.levels = def.levels || []; TP.upgrades[id] = def; return def; };
/** Effective livery for a vehicle: vehicle's first livery, overridden by livery fields. */
TP.liveryFor = function (vehicleId, livery) {
  var v = TP.vehicles[vehicleId]; var base = (v && v.liveries[0]) || {};
  var out = shallow(base);
  if (typeof livery === 'number' && v) out = shallow(v.liveries[livery] || base);
  else if (livery) for (var k in livery) if (livery[k] != null && livery[k] !== '') out[k] = livery[k];
  return out;
};

/* ---------------------------------------------------------------------------
 * 5. PULL SIMULATION  TP.sim  (pure, deterministic for a given seed + inputs + dt sequence)
 * ------------------------------------------------------------------------- */
var SIM_H = 1 / 240;   // fixed physics substep
/** Global sim tuning constants (documented in API.md). Change with care: affects every class. */
var TUNE = {
  sledMass: 0.6,       // fraction of sled weight that acts as inertia
  boxCurve: 1.0,       // resistance vs box position: P = 1 - (1 - bp)^boxCurve (concave = loads up early)
  chainDown: 0.12,     // fraction of sled force pressing the drive tires down
  heatRate: 0.022, cooling: 0.035, limiterHeat: 2.5,
  driftAmp: 0.016, hopOnset: 1.45, hopFull: 2.7,
  rollRes: 0.015,
  powerGrip: 0.12      // +10% hp over the class midpoint = +1.2% grip
};
var EFFECT_DEFAULTS = {
  hpMult: 1, torqueMult: 1, tractionAdd: 0, heatMult: 1, coolingAdd: 0, weightAdd: 0, frontWeightAdd: 0,
  gearMult: 1, shiftTimeMult: 1, boostShotsAdd: 0, boostMult: 1, durabilityMult: 1, hopDampMult: 1,
  idealSlipMult: 1, spoolMult: 1, launchAdd: 0, redlineAdd: 0, hitchHeightAdd: 0, steerMult: 1, inertiaMult: 1
};
TP.effectKeys = Object.keys(EFFECT_DEFAULTS);
/** Combine upgrade effects. upgrades = {upgradeId: level (1..n)}; the effect of the owned
 *  level is ABSOLUTE (level 3 = levels[2].effect, not cumulative). extra = additional effect object(s). */
function combineEffects(upgrades, extra) {
  var e = shallow(EFFECT_DEFAULTS);
  function apply(fx) {
    if (!fx) return;
    for (var k in fx) {
      var v = +fx[k]; if (!isFinite(v)) continue;
      if (/Mult$/.test(k)) e[k] = (e[k] != null ? e[k] : 1) * v; else e[k] = (e[k] || 0) + v;
    }
  }
  if (upgrades) for (var id in upgrades) {
    var def = TP.upgrades[id], lvl = upgrades[id] | 0;
    if (!def || lvl <= 0 || !def.levels.length) continue;
    var L = def.levels[Math.min(lvl, def.levels.length) - 1];
    apply(L && L.effect);
  }
  if (Array.isArray(extra)) extra.forEach(apply); else apply(extra);
  return e;
}
TP.combineEffects = combineEffects;

/** Effective (upgraded) vehicle stats used by the simulation. */
function vehicleStats(vehicleId, upgrades, extra) {
  var veh = TP.vehicles[vehicleId];
  if (!veh) throw new Error('TP.sim: unknown vehicle "' + vehicleId + '"');
  var cls = TP.classes[veh.class] || TP.classes.street_diesel;
  var s = veh.specs || {}, fx = combineEffects(upgrades, extra);
  var tire = TP.tires[s.tire || cls.tire] || TP.tires.dot;
  var etype = (veh.engine && veh.engine.type) || 'diesel';
  var et = TP.engineTypes[etype] || TP.engineTypes.diesel;
  var tractor = cls.group === 'tractor';
  var weightLb = (s.weight || cls.weightLimit || 8000) + fx.weightAdd + fx.frontWeightAdd;
  var baseW = (s.weight || cls.weightLimit || 8000) + fx.weightAdd;
  var fb0 = s.frontBias != null ? s.frontBias : (tractor ? 0.32 : 0.56);
  var frontBias = clamp((baseW * fb0 + fx.frontWeightAdd * 1.25) / weightLb, 0.05, 0.8);
  var redline = (s.redline || (etype === 'gas' ? 7000 : etype === 'methanol' ? 6500 : 3600)) + fx.redlineAdd;
  // hp drives the simulation: peak torque is derived so the dyno's peak power equals specs.hp
  var kx = 0; for (var xi = 0.3; xi <= 1.0001; xi += 0.02) kx = Math.max(kx, xi * torqueCurve(et, xi));
  var hpBase = s.hp || 600;
  var torqueNmBase = hpBase * 745.7 / (kx * redline / C.RPM);
  var gears = (s.gears && s.gears.length ? s.gears : [30, 22, 16]).map(function (g) { return g * fx.gearMult; });
  var st = {
    vehicleId: vehicleId, classId: cls.id, group: cls.group,
    name: veh.name, engineType: etype, et: et,
    hp: hpBase * fx.hpMult * fx.torqueMult,
    torqueNm: torqueNmBase * fx.hpMult * fx.torqueMult,
    torqueLbft: Math.round(torqueNmBase * fx.hpMult * fx.torqueMult / C.LBFT),
    weightLb: weightLb, massKg: weightLb * C.LB,
    redline: redline, idle: s.idle || et.idle,
    stallRpm: s.stallRpm || redline * (et.stall || 0.45),
    converter: s.converter || (tractor ? 1.0 : 1.25),
    shiftRpm: (s.shiftRpm || redline * 0.9) + fx.redlineAdd * 0.9,
    gears: gears, driveEff: 0.88,
    wheelRadius: s.wheelRadius || (tractor ? 0.9 : 0.56),
    wheelbase: s.wheelbase || (tractor ? 2.8 : 3.8),
    cgHeight: s.cgHeight || (tractor ? 1.0 : 0.9),
    hitchHeight: (s.hitchHeight || (tractor ? 0.55 : 0.62)) + fx.hitchHeightAdd,
    frontBias: frontBias,
    halfWidth: s.halfWidth || (tractor ? 1.3 : 1.05),
    drive: s.drive || cls.drive || (tractor ? '2wd' : '4wd'),
    tire: tire,
    // horsepower = wheel speed = bite: grip scales gently with power relative to the class's typical hp
    powerGrip: 1 + TUNE.powerGrip * clamp(hpBase * fx.hpMult * fx.torqueMult / (cls.hpRange ? (cls.hpRange[0] + cls.hpRange[1]) / 2 : hpBase) - 1, -0.4, 0.8),
    mu: tire.mu * (s.traction || 1) + fx.tractionAdd,
    idealSlip: (s.idealSlip || tire.idealSlip) * fx.idealSlipMult,
    inertia: (s.inertia || et.inertia) * fx.inertiaMult,
    wheelInertia: s.wheelInertia || (tractor ? 70 : 16),
    spool: et.spool * fx.spoolMult, lowBoost: et.lowBoost,
    durability: (s.durability || 1) * fx.durabilityMult,
    heatMult: (et.heat || 1) * fx.heatMult * (s.heat || 1),
    heatRate: TUNE.heatRate, cooling: TUNE.cooling * (1 + fx.coolingAdd),
    boostShots: Math.max(0, (s.boostShots != null ? s.boostShots : cls.boostShots) + fx.boostShotsAdd),
    boost: {
      mult: ((s.boost && s.boost.mult) || 1.3) * fx.boostMult,
      duration: (s.boost && s.boost.duration) || 2.2,
      heat: (s.boost && s.boost.heat) || 0.07
    },
    shiftTime: (s.shiftTime || (tractor ? 0.42 : 0.3)) * fx.shiftTimeMult,
    hopFreq: s.hopFreq || (tractor ? 3.4 : 4.6),
    hopDamp: 1.5 * fx.hopDampMult,
    hopGain: 1.25 * tire.hopGain * (s.hopGain || 1),
    liftGain: s.liftGain || 2.6,
    maxLift: s.maxLift || (tractor ? 0.2 : 0.12),
    steerRate: 0.26 * (s.steerRate || 1) * fx.steerMult,
    launchAdd: fx.launchAdd,
    effects: fx
  };
  if (st.gears.length < 1) st.gears = [20];
  // Pedal map: pedal^gamma so the useful pedal range stays wide on monster-torque vehicles.
  var topDrive = st.torqueNm * st.gears[st.gears.length - 1] * st.driveEff / st.wheelRadius;
  var trac = st.mu * st.massKg * C.G;
  st.throttleGamma = s.throttleGamma || clamp(Math.log(clamp(trac * 1.1 / topDrive, 0.05, 1)) / Math.log(0.85), 1, 2.2);
  st.tractionRatio = st.gears.map(function (g) { return Math.round(st.torqueNm * g * st.driveEff / st.wheelRadius / trac * 100) / 100; });
  return st;
}

function slipCurve(s, ideal, tire, out) {
  if (s <= 0) { out.f = Math.max(-1, s / ideal); out.d = 1 / ideal; return out; }
  if (s <= ideal) { var u = s / ideal; out.f = u * (2 - u); out.d = (2 - 2 * u) / ideal; return out; }
  var z = (s - ideal) / (ideal * tire.fall);
  var g = Math.exp(-z * z);
  out.f = tire.floor + (1 - tire.floor) * g;
  out.d = 0;
  return out;
}
var _sc = { f: 0, d: 0 };

function newEvent(p, type, data) { p.events.push({ t: +p.t.toFixed(3), type: type, data: data }); }

TP.sim = {
  H: SIM_H,
  tune: TUNE,
  vehicleStats: vehicleStats,
  slipCurve: function (s, ideal, tireId) { return slipCurve(s, ideal, TP.tires[tireId] || TP.tires.dot, { f: 0, d: 0 }).f; },
  /** Create a pull state. See API.md for fields. */
  createPull: function (o) {
    o = o || {};
    var st = vehicleStats(o.vehicleId, o.upgrades, o.extra);
    var cls = TP.classes[o.classId || st.classId] || TP.classes[st.classId];
    var seed = (o.seed != null ? o.seed : (Math.random() * 4294967296)) >>> 0;
    var rng = makeRng(seed);
    var venue = o.venue && TP.venues[o.venue];
    var tc = clamp(o.trackCondition != null ? +o.trackCondition : (venue && venue.trackCondition != null ? venue.trackCondition : 0.2), 0, 1);
    var sled = shallow(cls.sled);
    if (o.sled) for (var k in o.sled) sled[k] = o.sled[k];
    if (o.sledMult) sled.boxWeight = Math.round(sled.boxWeight * o.sledMult);
    var trackFt = o.trackLength || cls.trackLength || 300;
    var laneHalf = o.laneHalf || (venue && venue.laneHalf) || 4.6;
    // seeded bumps / soft spots along the lane
    var bumps = [], x = rng.range(4, 9);
    while (x < trackFt * C.FT + 10) {
      bumps.push({ x: x, mag: rng.range(0.25, 1) * (0.55 + tc), side: rng() < 0.5 ? -1 : 1 });
      x += rng.range(5, 13) * (1.1 - tc * 0.4);
    }
    var tGreen = 2.2 + rng.range(0, 1.3);
    var p = {
      seed: seed, vehicleId: o.vehicleId, classId: cls.id, driverId: o.driver || o.driverId || null,
      stats: st, sled: sled, trackLength: trackFt * C.FT, trackLengthFt: trackFt, laneHalf: laneHalf, halfWidth: st.halfWidth,
      trackCondition: tc, idealSlip: st.idealSlip * (1 + 0.35 * tc),
      cond: { mu: 1 - 0.14 * tc, drift: 0.7 + 0.9 * tc },
      t: 0, status: 'staged', done: false, light: 'red', tYellow: tGreen - 1.1, tGreen: tGreen,
      launch: null, launchReact: null, launchT: -1, launchBonus: 1,
      dist: 0, travel: 0, slack: 0.45, chainTaut: false,
      speed: 0, accel: 0, w: 0, rpm: st.idle, freeRpm: st.idle, gear: 0, shiftTimer: 0, lastShift: null,
      throttle: 0, steer: 0, heading: 0, lateral: 0, yawKick: 0,
      slip: 0, grip: 0, hop: 0, hopPhase: 0, frontLift: 0, frontLiftVel: 0, frontLoad: 1,
      sledBoxPos: 0, sledForce: 0, dig: 0, temp: 0.3, damage: { engine: 0, driveline: 0 },
      boostLeft: st.boostShots, boostTimer: 0, spool: 0, limiter: false,
      driveForce: 0, fullDrive: 0, tireForce: 0, normalDrive: 0, shiftPen: 1, shiftPenT: 0,
      topSpeed: 0, maxHop: 0, broken: null, reason: '', result: null,
      bumps: bumps, bumpIdx: 0, ph: [rng() * 6.283, rng() * 6.283, rng() * 6.283],
      events: [], rng: rng, _acc: 0, _pShift: false, _pBoost: false, _qShift: false, _qBoost: false,
      _pressT: -1, _pressed: false, _stopT: 0, _hopWarn: false, _limT: 0
    };
    p.sledMassEff = (sled.baseWeight + sled.boxWeight) * C.LB * TUNE.sledMass;
    return p;
  },
  /** Advance the pull by dt seconds with input {throttle 0..1, steer -1..1, shift, boost}. */
  step: function (p, dt, inp) {
    if (p.done) return p;
    inp = inp || ZERO_INPUT;
    var sh = !!inp.shift, bo = !!inp.boost;
    if (sh && !p._pShift) p._qShift = true;
    if (bo && !p._pBoost) p._qBoost = true;
    p._pShift = sh; p._pBoost = bo;
    p._acc += clamp(+dt || 0, 0, 0.5);
    while (p._acc >= SIM_H && !p.done) { p._acc -= SIM_H; substep(p, SIM_H, inp); }
    return p;
  },
  /** Visual-only post-roll after a pull is done (vehicle coasts to a stop). Does not change the result. */
  coast: function (p, dt) {
    p.speed = Math.max(0, p.speed - dt * (p.status === 'fullPull' ? 2.2 : 5));
    p.w = approach(p.w, p.speed, dt * 6);
    p.travel += p.speed * dt;
    p.visDist = (p.visDist || p.dist) + p.speed * dt;
    p.throttle = approach(p.throttle, 0, dt * 3);
    p.rpm = approach(p.rpm, p.stats.idle, dt * p.stats.redline * 0.8);
    p.hop = approach(p.hop, 0, dt * 2);
    p.boostTimer = 0;
    p.frontLift = approach(p.frontLift, 0, dt * 0.4);
    return p;
  },
  /** Finish a pull instantly with a controller (used by Skip). Returns the result. */
  finish: function (p, controller, dt) {
    dt = dt || 1 / 60;
    var inp = { throttle: 0, steer: 0, shift: false, boost: false };
    var guard = 0;
    while (!p.done && guard++ < 20000) { if (controller) controller.update(p, dt, inp); TP.sim.step(p, dt, inp); }
    if (!p.done) endPull(p, 'stopped', 'Time');
    return p.result;
  },
  /** Run a whole pull headless. opts = createPull opts + {controller | skill, dt}. Returns result. */
  simulate: function (o) {
    var p = TP.sim.createPull(o);
    var ctrl = o.controller || TP.controllers.ai(o.skill || 'good');
    return TP.sim.finish(p, ctrl, o.dt || 1 / 60);
  },
  result: function (p) { return p.result || makeResult(p); },
  /** Pedal (0..1) that would hold wheel slip at slipTarget in the current state (AI feed-forward, assists). */
  pedalFor: function (p, slipTarget) {
    var st = p.stats, sc = slipCurve(slipTarget, p.idealSlip, st.tire, { f: 0, d: 0 });
    var Nd = p.normalDrive || st.massKg * C.G;
    var need = st.mu * st.powerGrip * p.cond.mu * Nd * sc.f * (p.hopMod || 1);
    if (!(p.fullDrive > 1)) return 0.6;
    return clamp(Math.pow(need / p.fullDrive, 1 / st.throttleGamma), 0, 1);
  },
  /** Dyno sheet: [{rpm, torque (lb-ft), hp}] for the upgraded vehicle at full boost. */
  dyno: function (vehicleId, upgrades, steps) {
    var st = vehicleStats(vehicleId, upgrades); steps = steps || 24; var out = [];
    for (var i = 0; i <= steps; i++) {
      var rpm = st.idle + (st.redline - st.idle) * i / steps, x = rpm / st.redline;
      var tq = st.torqueNm * torqueCurve(st.et, x);
      out.push({ rpm: Math.round(rpm), torque: Math.round(tq / C.LBFT), hp: Math.round(tq * rpm / C.RPM / 745.7) });
    }
    return out;
  }
};
var ZERO_INPUT = { throttle: 0, steer: 0, shift: false, boost: false };

function endPull(p, status, reason) {
  if (p.done) return;
  p.status = status; p.done = true; p.reason = reason;
  if (status === 'fullPull') p.dist = p.trackLength;
  p.result = makeResult(p);
  newEvent(p, 'end', status);
}
function makeResult(p) {
  var full = p.status === 'fullPull';
  var dq = p.status === 'out';
  var d = full ? p.trackLength : p.dist;
  return {
    vehicleId: p.vehicleId, classId: p.classId, driverId: p.driverId, seed: p.seed,
    status: p.status, reason: p.reason,
    distance: d, distanceFt: Math.round(d / C.FT * 100) / 100, distanceText: fmtFt(d),
    trackLengthFt: p.trackLengthFt, fullPull: full, dq: dq, broken: p.broken,
    launch: p.launch, launchReact: p.launchReact != null ? Math.round(p.launchReact * 1000) / 1000 : null,
    topSpeed: Math.round(p.topSpeed * C.MPH * 10) / 10, maxHop: Math.round(p.maxHop * 100) / 100,
    time: Math.round((p.launchT >= 0 ? p.t - p.launchT : 0) * 100) / 100,
    score: dq ? 0 : Math.round(d / C.FT * 100) / 100
  };
}

function substep(p, h, inp) {
  var st = p.stats, et = st.et;
  p.t += h;
  // --- actuators (pedal / wheel can't teleport) ---
  var thIn = clamp(+inp.throttle || 0, 0, 1);
  p.throttle = approach(p.throttle, thIn, h * 7);
  p.steer = approach(p.steer, clamp(+inp.steer || 0, -1, 1), h * 5);
  if (p.boostTimer > 0) p.boostTimer = Math.max(0, p.boostTimer - h);

  // --- staging / lights / launch ---
  if (p.status === 'staged') {
    p.light = p.t < p.tYellow ? 'red' : (p.t < p.tGreen ? 'yellow' : 'green');
    var pressed = thIn > 0.3;
    if (pressed && !p._pressed) p._pressT = p.t;
    p._pressed = pressed;
    var revTarget = st.idle + p.throttle * (st.redline * 0.72 - st.idle);
    p.freeRpm = damp(p.freeRpm, revTarget, 6, h);
    p.rpm = p.freeRpm;
    p.spool = damp(p.spool, p.throttle * 0.5, st.spool, h);
    p._qShift = false; p._qBoost = false;
    if (p.t >= p.tGreen && pressed) {
      var react = p._pressT - p.tGreen;
      var q = react < -0.1 ? 'early' : react < 0.2 ? 'perfect' : react < 0.5 ? 'good' : 'late';
      p.launch = q; p.launchReact = react; p.status = 'launch'; p.launchT = p.t;
      p.launchBonus = ({ perfect: 1.1, good: 1.05, late: 1.0, early: 0.97 })[q] + st.launchAdd;
      if (q === 'early') p.hop = 0.75;
      p.w = 0.6 * clamp(p.freeRpm / st.redline, 0, 1);
      newEvent(p, 'launch', q);
    } else if (p.t > p.tGreen + 10) {
      endPull(p, 'stopped', 'No-go');
    }
    return;
  }

  // --- shifting ---
  var gearN = st.gears.length;
  if (p._qShift) {
    p._qShift = false;
    if (p.gear < gearN - 1 && p.shiftTimer <= 0) {
      var rr = p.rpm / st.shiftRpm;
      var sq = rr >= 0.95 && rr <= 1.08 ? 'perfect' : (rr < 0.8 ? 'early' : (rr > 1.08 ? 'late' : 'good'));
      p.gear++; p.lastShift = sq; p.freeRpm = p.rpm;
      p.shiftTimer = st.shiftTime * (sq === 'perfect' ? 0.55 : sq === 'early' ? 1.4 : 1);
      // perfect shift = a little kick; early shift = the engine falls out of its powerband for a moment
      p.shiftPen = sq === 'perfect' ? 1.08 : sq === 'early' ? 0.72 : sq === 'good' ? 0.97 : 0.9;
      p.shiftPenT = p.shiftTimer + (sq === 'early' ? 1.2 : 0.7);
      if (sq === 'late' && p.slip > p.idealSlip * 2) p.damage.driveline += 0.05 / st.durability;
      newEvent(p, 'shift', { gear: p.gear, quality: sq });
    }
  }
  if (p._qBoost) {
    p._qBoost = false;
    if (p.boostLeft > 0 && p.boostTimer <= 0 && !p.broken) {
      p.boostLeft--; p.boostTimer = st.boost.duration;
      newEvent(p, 'boost', p.boostLeft);
    }
  }
  var ratio = st.gears[p.gear], r = st.wheelRadius;
  var shifting = p.shiftTimer > 0;
  var rpmPerW = ratio / r * C.RPM;
  var rpm, wheelRpm = p.w * rpmPerW, tm = 1;
  if (shifting) {
    p.shiftTimer -= h;
    p.freeRpm = damp(p.freeRpm, wheelRpm, 10, h);
    rpm = p.freeRpm;
  } else {
    // launch device (converter / slipping clutch): engine can't be dragged below its stall rpm under throttle
    var floor = Math.max(st.idle * 0.95, st.idle + (st.stallRpm - st.idle) * p.throttle);
    rpm = Math.max(wheelRpm, floor);
    if (wheelRpm < floor) tm = 1 + (st.converter - 1) * clamp(1 - wheelRpm / floor, 0, 1);
  }
  p.rpm = rpm;
  if (p.shiftPenT > 0) p.shiftPenT -= h;

  // --- engine torque ---
  var x = rpm / st.redline;
  var spoolTarget = st.lowBoost >= 1 ? 1 : p.throttle * clamp((x - 0.12) / 0.35, 0.2, 1);
  p.spool = damp(p.spool, spoolTarget, spoolTarget > p.spool ? st.spool : st.spool * 2.5, h);
  var boostF = st.lowBoost + (1 - st.lowBoost) * p.spool;
  var pedal = Math.pow(p.throttle, st.throttleGamma);
  var Tfull = st.torqueNm * torqueCurve(et, x) * boostF * tm;
  if (p.boostTimer > 0) Tfull *= st.boost.mult;
  if (p.shiftPenT > 0) Tfull *= p.shiftPen;
  p.limiter = rpm > st.redline;
  if (p.limiter) Tfull *= Math.max(0, 1 - (rpm - st.redline) / (st.redline * 0.025));
  if (p.temp > 0.9) Tfull *= 1 - (p.temp - 0.9) * 0.8;
  if (p.broken) Tfull = 0;
  var Te = Tfull * pedal - st.torqueNm * 0.05 * x * (1 - p.throttle);
  var Fdrive = shifting ? 0 : Te * ratio * st.driveEff / r;
  p.driveForce = Fdrive;
  p.fullDrive = shifting ? 0 : Tfull * ratio * st.driveEff / r;

  // --- weight transfer / front lift ---
  var m = st.massKg, Wn = m * C.G, R = p.sledForce;
  var transfer = (R * st.hitchHeight + m * p.accel * st.cgHeight) / st.wheelbase;
  var Nf0 = Wn * st.frontBias;
  var Nf = Nf0 - transfer;
  var Nr = Wn - Nf + R * TUNE.chainDown;
  var excess = 0;
  if (Nf < 0) { excess = -Nf; Nf = 0; }
  p.frontLoad = Nf / Nf0;
  var Nd = st.drive === '4wd' ? Nr + Nf : Nr;
  p.normalDrive = Nd;
  var liftTarget = clamp(excess / Wn * st.liftGain, 0, st.maxLift) + clamp(0.35 - p.frontLoad, 0, 0.35) * 0.06;
  liftTarget += p.hop * 0.012 * Math.sin(p.hopPhase + 1.2);
  p.frontLiftVel += ((liftTarget - p.frontLift) * 60 - p.frontLiftVel * 10) * h;
  p.frontLift = clamp(p.frontLift + p.frontLiftVel * h, 0, st.maxLift + 0.03);

  // --- hop (wheel hop oscillation) ---
  p.hopPhase += h * st.hopFreq * 6.2832;
  var ideal = p.idealSlip;
  var sr = p.slip / ideal;
  var load = clamp(p.tireForce / (st.mu * Nd + 1), 0, 1.2);
  var grow = st.hopGain * smoothstep(TUNE.hopOnset, TUNE.hopFull, sr) * (0.4 + 0.6 * load);
  var dampK = st.hopDamp * (sr < 1.3 ? 2.6 : 0.8) * (p.throttle < 0.45 ? 1.5 : 1);
  p.hop += h * (grow - dampK * p.hop);
  if (p.bumpIdx < p.bumps.length && p.travel >= p.bumps[p.bumpIdx].x) {
    var b = p.bumps[p.bumpIdx++];
    p.hop += b.mag * 0.22 * clamp(sr, 0.4, 2.2);
    p.yawKick += b.side * b.mag * 0.035;
    newEvent(p, 'bump', b.mag);
  }
  p.hop = clamp(p.hop, 0, 1.6);
  if (p.hop > p.maxHop) p.maxHop = p.hop;
  if (p.hop > 0.6 && !p._hopWarn) { p._hopWarn = true; newEvent(p, 'hop', p.hop); }
  if (p.hop < 0.3) p._hopWarn = false;
  var hopMod = 1 - 0.26 * p.hop * (0.5 + 0.5 * Math.sin(p.hopPhase)) - 0.04 * p.hop;
  p.hopMod = 1 - 0.17 * p.hop;

  // --- tire force (semi-implicit wheel speed) ---
  var vref = Math.max(p.speed, 1.2);
  var s = (p.w - p.speed) / vref;
  slipCurve(s, ideal, st.tire, _sc);
  var launchF = 1;
  if (p.launchT >= 0) { var lt = p.t - p.launchT; launchF = lt < 3 ? lerp(p.launchBonus, 1, lt / 3) : 1; }
  var muEff = st.mu * st.powerGrip * p.cond.mu * hopMod * launchF;
  var Ft = muEff * Nd * _sc.f;
  var kImp = Math.max(0, muEff * Nd * _sc.d / vref);
  var mrot = ((shifting ? 0 : st.inertia * ratio * ratio) + st.wheelInertia) / (r * r);
  p.w += h * (Fdrive - Ft) / (mrot + h * kImp);
  if (p.w < 0) p.w = 0;
  s = (p.w - p.speed) / vref;
  p.slip = s; p.grip = _sc.f; p.tireForce = Ft;

  // --- chain + sled ---
  if (!p.chainTaut) {
    R = 0;
    if (p.travel >= p.slack) {
      p.chainTaut = true;
      p.speed = p.speed * m / (m + p.sledMassEff);
      newEvent(p, 'hook', p.speed);
    }
  } else {
    var sl = p.sled;
    var bp = clamp(p.dist / (sl.boxTravel * C.FT), 0, 1);
    p.sledBoxPos = bp;
    var P = 1 - Math.pow(1 - bp, TUNE.boxCurve);
    var digT = clamp((sl.digSpeed - p.speed) / sl.digSpeed, 0, 1) * smoothstep(0.15, 0.6, bp);
    p.dig = damp(p.dig, digT, digT > p.dig ? 0.9 : 1.2, h);
    var lbf = sl.baseWeight * (0.6 * SLED_RS + 0.4 * SLED_MP) + sl.boxWeight * ((1 - P) * SLED_RS + P * SLED_MP * (1 + sl.panGrow * p.dig));
    lbf += (sl.plow || 0) * p.speed;
    R = lbf * C.LB * C.G;
  }
  p.sledForce = R;

  // --- longitudinal motion ---
  var mEff = m + (p.chainTaut ? p.sledMassEff : 0);
  var net = Ft - R - Wn * TUNE.rollRes;
  if (p.speed <= 0 && net < 0) net = 0;
  var a = net / mEff;
  p.speed += a * h;
  if (p.speed < 0) p.speed = 0;
  p.accel = damp(p.accel, a, 8, h);
  var adv = p.speed * Math.cos(p.heading) * h;
  p.travel += adv;
  if (p.chainTaut) p.dist += adv;
  if (p.speed > p.topSpeed) p.topSpeed = p.speed;

  // --- steering / lateral drift ---
  var tr = p.travel, ph = p.ph;
  var field = Math.sin(tr * 0.071 + ph[0]) * 0.6 + Math.sin(tr * 0.029 + ph[1]) + Math.sin(tr * 0.157 + ph[2]) * 0.35;
  var drift = field * TUNE.driftAmp * p.cond.drift * (1 + 1.4 * Math.max(0, sr - 1.4) + 1.6 * p.hop);
  var steerEff = clamp(0.3 + 0.75 * p.frontLoad, st.drive === '4wd' ? 0.22 : 0.32, 1);
  var spd = clamp(p.speed / 1.5, 0, 1);
  p.heading += h * spd * (p.steer * st.steerRate * steerEff + drift + p.yawKick);
  p.yawKick = damp(p.yawKick, 0, 3, h);
  p.heading = clamp(p.heading * (1 - h * 0.12), -0.6, 0.6);
  p.lateral += p.speed * Math.sin(p.heading) * h;

  // --- heat & damage ---
  var limEx = clamp((rpm - st.redline * 0.995) / (st.redline * 0.02), 0, 1);
  var heatIn = st.heatRate * p.throttle * x * x * x * (1 + TUNE.limiterHeat * limEx) * st.heatMult + (p.boostTimer > 0 ? st.boost.heat : 0);
  p.temp += h * (heatIn - st.cooling * (p.temp - 0.25));
  if (p.temp > 0.92) p.damage.engine += h * (p.temp - 0.92) * 2.5 / st.durability;
  if (p.temp > 0.98 && p.rng() < h * 0.25 / st.durability) p.damage.engine = 1;
  if (p.hop > 0.9) p.damage.driveline += h * (p.hop - 0.9) * 0.22 / st.durability;
  if (!p.broken && (p.damage.engine >= 1 || p.damage.driveline >= 1)) {
    p.broken = p.damage.engine >= 1 ? 'engine' : 'driveline';
    newEvent(p, 'breakdown', p.broken);
  }

  // --- end conditions ---
  if (p.status === 'launch' && p.t - p.launchT > 1.6) p.status = 'pulling';
  if (p.dist >= p.trackLength) { endPull(p, 'fullPull', 'Full pull!'); return; }
  if (Math.abs(p.lateral) + p.halfWidth > p.laneHalf) {
    newEvent(p, 'outOfBounds', p.lateral);
    endPull(p, 'out', 'Out of bounds'); return;
  }
  var since = p.t - p.launchT;
  if (p.chainTaut && since > 1.2 && p.speed < 0.12) p._stopT += h; else p._stopT = 0;
  if (p._stopT > 0.7) {
    if (p.broken) endPull(p, 'broken', p.broken === 'engine' ? 'Blown engine' : 'Broken driveline');
    else endPull(p, 'stopped', p.throttle < 0.15 && p.slip < p.idealSlip * 0.5 ? 'Lifted' : 'Sled stopped');
    return;
  }
  if (!p.chainTaut && since > 8) { endPull(p, 'stopped', 'No pull'); return; }
  if (p.t > 150) endPull(p, 'stopped', 'Time');
}

/* ---------------------------------------------------------------------------
 * 6. CONTROLLERS  — objects {kind, name, update(pull, dt, out)} that write
 *    out.throttle/steer/shift/boost. AI uses the same physics as the player.
 * ------------------------------------------------------------------------- */
TP.controllers.ai = function (skill, opts) {
  var sk = TP.resolveSkill(skill);
  opts = opts || {};
  var c = { kind: 'ai', name: opts.name || 'ai', skill: sk, rng: null };
  var trim = 0, obsSlip = 0, obsHop = 0, obsLat = 0, obsHead = 0, steer = 0, bias = 0;
  var noise = 0, noiseT = 0, noiseTarget = 0, mashT = 0, liftT = 0, liftAmt = 0, limT = 0, limTrim = 0, react = null;
  var shiftAt = 0, shiftGear = -1, shiftOutPrev = false, boostCd = 0, steerNoise = 0, steerNoiseT = 0;
  var prevSpeed = 0, peakSpeed = 0, initd = false, ff = null;
  c.update = function (p, dt, out) {
    var R = c.rng;
    if (!initd) {
      initd = true;
      R = c.rng = makeRng((p.seed ^ hashStr(opts.salt || c.name)) >>> 0);
      react = 0.03 + (1 - sk.reaction) * 0.42 + (R() - 0.5) * 0.24 * (1 - sk.consistency);
      if (R() < (1 - sk.consistency) * 0.1) react = -0.22 - R() * 0.2;   // jumped the light
      // pedal estimation error: novices tend to have a heavy right foot
      bias = (1 - sk.throttleFeel) * (R() * 0.5 - 0.1);
    }
    out.shift = false; out.boost = false;
    var ideal = p.idealSlip;
    var target = ideal * (1.05 + (sk.aggression - 0.5) * 0.4);
    if (p.status === 'staged') {
      out.steer = 0;
      out.throttle = (p.t >= p.tGreen + react) ? clamp(0.55 + 0.35 * sk.aggression + bias, 0.4, 1) : (p.light === 'yellow' ? 0.18 : 0.06);
      return out;
    }
    if (p.done) { out.throttle = 0; return out; }
    var tau = 0.04 + (1 - sk.throttleFeel) * 0.3;
    obsSlip = damp(obsSlip, p.slip, 1 / tau, dt);
    obsHop = damp(obsHop, p.hop, 1 / tau, dt);
    noiseT -= dt;
    if (noiseT <= 0) { noiseT = 0.5 + R() * 1.2; noiseTarget = R() * 2 - 1; }
    noise = damp(noise, noiseTarget, 2.5, dt);
    // feed-forward: the pedal a driver "feels" will hold the target wheel speed, plus a learned trim
    var ffRaw = TP.sim.pedalFor(p, target);
    ff = ff == null ? ffRaw : damp(ff, ffRaw, 1 / (0.12 + 0.3 * (1 - sk.throttleFeel)), dt);
    var thFF = ff * (1 + bias + noise * (1 - sk.consistency) * 0.45);
    var err = (target - obsSlip) / ideal;
    trim = clamp(trim + dt * (0.1 + 0.6 * sk.throttleFeel) * clamp(err, -1.5, 1), -0.3, 0.3);
    var th = thFF + trim;
    // hop: pros feather off a touch right away, novices react late and big
    var hopLimit = 0.25 + 0.45 * (1 - sk.throttleFeel);
    if (obsHop > hopLimit && liftT <= 0) { liftT = 0.35; liftAmt = 0.1 + 0.25 * (1 - sk.throttleFeel); }
    if (liftT > 0) { liftT -= dt; th -= liftAmt; }
    // on the limiter: shift if we can, otherwise ease off (heat)
    if (p.limiter) { limT += dt; if (p.gear < p.stats.gears.length - 1 && limT > 0.5 - 0.4 * sk.shiftTiming) shiftAt = 0; } else limT = 0;
    if (p.gear >= p.stats.gears.length - 1 && p.rpm > p.stats.redline * 0.97) limTrim = Math.max(-0.3, limTrim - dt * (0.5 + 0.8 * sk.throttleFeel));
    else limTrim = Math.min(0, limTrim + dt * 1.2);
    th += limTrim;
    // late in the pull: bury the pedal when it's bogging (everyone does)
    if (p.sledBoxPos > 0.85 && p.speed < 1.6) th = Math.max(th, 0.9);
    th = clamp(th, 0.22, 1);
    if (mashT > 0) { mashT -= dt; th = 1; }
    else if (R() < dt * (1 - sk.throttleFeel) * 0.25) mashT = 0.3 + R() * 0.9;
    out.throttle = th;
    // shifting
    if (p.gear !== shiftGear) {
      shiftGear = p.gear;
      shiftAt = p.stats.shiftRpm * (1 + R.gauss() * (1 - sk.shiftTiming) * 0.14);
      if (R() < (1 - sk.shiftTiming) * 0.25) shiftAt *= 0.8;
    }
    var wantShift = p.gear < p.stats.gears.length - 1 && p.shiftTimer <= 0 && p.rpm >= shiftAt;
    out.shift = wantShift && !shiftOutPrev;
    shiftOutPrev = out.shift;
    // steering (PD with perception lag + noise)
    var tauS = 0.06 + (1 - sk.steering) * 0.5;
    obsLat = damp(obsLat, p.lateral, 1 / tauS, dt);
    obsHead = damp(obsHead, p.heading, 1 / tauS, dt);
    steerNoiseT -= dt;
    if (steerNoiseT <= 0) { steerNoiseT = 0.4 + R() * 1.2; steerNoise = (R() * 2 - 1) * (1 - sk.steering); }
    var want = -(obsLat * (0.35 + 0.45 * sk.steering) + obsHead * (3 + 6 * sk.steering)) + steerNoise * 0.6;
    steer = damp(steer, clamp(want, -1, 1), 2 + 6 * sk.steering, dt);
    out.steer = steer;
    // boost: save it for when the sled starts winning
    boostCd -= dt;
    if (p.boostLeft > 0 && boostCd <= 0 && p.chainTaut) {
      var late = p.sledBoxPos > 0.55 + 0.25 * (1 - sk.aggression);
      if ((late && p.speed < prevSpeed && p.speed < peakSpeed * 0.75) || (p.speed < 2.2 && p.sledBoxPos > 0.5)) {
        out.boost = true; boostCd = p.stats.boost.duration + 0.8 + R() * 1.5;
      }
    }
    if (p.speed > peakSpeed) peakSpeed = p.speed;
    prevSpeed = p.speed;
    return out;
  };
  return c;
};

/* ---------------------------------------------------------------------------
 * 7. SAVE / ECONOMY
 * ------------------------------------------------------------------------- */
var SAVE_KEY = 'full_pull', SAVE_V = 1;
var saveExtensions = [];
function defaultSave() {
  return {
    v: SAVE_V, cash: 6000, xp: 0, level: 1,
    garage: [
      { uid: 'g1', vehicleId: 'sd_thunderbolt', upgrades: {}, livery: {} },
      { uid: 'g2', vehicleId: 'fs_prairie', upgrades: {}, livery: {} }
    ],
    selected: 'g1', nextUid: 3, owned: {},
    career: {},
    stats: { pulls: 0, fullPulls: 0, wins: 0, events: 0, breakdowns: 0, outs: 0, totalFt: 0, watched: 0, bestByClass: {}, bestByVehicle: {}, perfectLaunches: 0 },
    settings: { quality: 'auto', sound: true, volume: 0.8, assistTraction: false, autoShift: false, shake: true, showFps: false, camera: 'side', haptics: true, units: 'ft' },
    trophies: []
  };
}
TP.migrations = {};   // TP.migrations[fromVersion] = function(save) -> save at version+1
function loadSave() {
  var s = null;
  try { var raw = W.localStorage && W.localStorage.getItem(SAVE_KEY); if (raw) s = JSON.parse(raw); } catch (e) { s = null; }
  if (!s || typeof s !== 'object') s = defaultSave();
  var guard = 0;
  while ((s.v || 0) < SAVE_V && guard++ < 50) {
    var fn = TP.migrations[s.v || 0];
    if (fn) { try { s = fn(s) || s; } catch (e) { console.error('[TP] save migration failed', e); } }
    s.v = (s.v || 0) + 1;
  }
  deepFill(s, defaultSave());
  if (!Array.isArray(s.garage)) s.garage = defaultSave().garage;
  if (!Array.isArray(s.trophies)) s.trophies = [];
  saveExtensions.forEach(function (d) { deepFill(s, d); });
  return s;
}
TP.save = loadSave();
TP.store = function () {
  try { if (W.localStorage) W.localStorage.setItem(SAVE_KEY, JSON.stringify(TP.save)); return true; } catch (e) { return false; }
};
/** Add default fields to the save (deep-filled, never overwrites). Call at load time from features. */
TP.extendSave = function (defaults) { saveExtensions.push(defaults); deepFill(TP.save, defaults); };
TP.resetSave = function () {
  TP.save = defaultSave(); saveExtensions.forEach(function (d) { deepFill(TP.save, d); });
  TP.store(); TP.emit('settings', TP.save.settings); TP.emit('saveReset');
};
TP.xpForLevel = function (level) { level = Math.max(1, level | 0); return 250 * (level - 1) * level; };
TP.addCash = function (n, reason) {
  n = Math.round(+n || 0); TP.save.cash = Math.max(0, TP.save.cash + n);
  TP.emit('cash', n, reason, TP.save.cash); TP.store(); return TP.save.cash;
};
TP.addXP = function (n) {
  n = Math.round(+n || 0); if (n <= 0) return TP.save.level;
  TP.save.xp += n;
  while (TP.save.xp >= TP.xpForLevel(TP.save.level + 1) && TP.save.level < 99) {
    TP.save.level++; TP.emit('levelUp', TP.save.level);
  }
  TP.emit('xp', n, TP.save.xp); TP.store(); return TP.save.level;
};
TP.garage = {
  list: function () { return TP.save.garage; },
  get: function (uid) { for (var i = 0; i < TP.save.garage.length; i++) if (TP.save.garage[i].uid === uid) return TP.save.garage[i]; return null; },
  selected: function () { return TP.garage.get(TP.save.selected) || TP.save.garage[0] || null; },
  select: function (uid) { if (TP.garage.get(uid)) { TP.save.selected = uid; TP.store(); TP.emit('garageSelect', uid); } },
  owns: function (vehicleId) { return TP.save.garage.some(function (g) { return g.vehicleId === vehicleId; }); },
  findByVehicle: function (vehicleId) { for (var i = 0; i < TP.save.garage.length; i++) if (TP.save.garage[i].vehicleId === vehicleId) return TP.save.garage[i]; return null; },
  add: function (vehicleId, livery) {
    var item = { uid: 'g' + (TP.save.nextUid++), vehicleId: vehicleId, upgrades: {}, livery: livery || {} };
    TP.save.garage.push(item); TP.store(); TP.emit('garageAdd', item); return item;
  },
  remove: function (uid) {
    TP.save.garage = TP.save.garage.filter(function (g) { return g.uid !== uid; });
    if (TP.save.selected === uid && TP.save.garage[0]) TP.save.selected = TP.save.garage[0].uid;
    TP.store();
  },
  upgradeLevel: function (uid, upgradeId) { var g = TP.garage.get(uid); return g ? (g.upgrades[upgradeId] | 0) : 0; },
  /** Buy the next level of an upgrade for a garage vehicle. Returns true on success. */
  buyUpgrade: function (uid, upgradeId) {
    var g = TP.garage.get(uid), def = TP.upgrades[upgradeId];
    if (!g || !def) return false;
    var lvl = g.upgrades[upgradeId] | 0, next = def.levels[lvl];
    if (!next) return false;
    if (!TP.upgradeApplies(def, g.vehicleId)) return false;
    if (TP.save.cash < next.price) return false;
    if (next.levelReq && TP.save.level < next.levelReq) return false;
    TP.addCash(-next.price, 'upgrade');
    g.upgrades[upgradeId] = lvl + 1; TP.store();
    TP.emit('purchase', { id: upgradeId, category: 'upgrades', level: lvl + 1, uid: uid, price: next.price, upgrade: def });
    return true;
  }
};
/** Does upgrade def apply to a vehicle? def.appliesTo: undefined (all) | {classes:[..], groups:[..], vehicles:[..], engines:[..]} | function(vehicle) */
TP.upgradeApplies = function (def, vehicleId) {
  var v = TP.vehicles[vehicleId]; if (!v) return false;
  var a = def.appliesTo; if (!a) return true;
  if (typeof a === 'function') return !!a(v);
  var cls = TP.classes[v.class] || {};
  if (a.classes && a.classes.indexOf(v.class) < 0) return false;
  if (a.groups && a.groups.indexOf(cls.group) < 0) return false;
  if (a.vehicles && a.vehicles.indexOf(v.id) < 0) return false;
  if (a.engines && a.engines.indexOf(v.engine.type) < 0) return false;
  if (a.boostOnly && !(cls.boostShots > 0)) return false;
  return true;
};

/* ---------------------------------------------------------------------------
 * 8. SHOP
 * ------------------------------------------------------------------------- */
TP.shop = {
  items: [],
  categories: ['vehicles', 'upgrades', 'paint', 'stacks', 'tires', 'weights', 'boost', 'cosmetic'],
  get: function (id) { for (var i = 0; i < TP.shop.items.length; i++) if (TP.shop.items[i].id === id) return TP.shop.items[i]; return null; },
  /** Add (or replace by id) a shop item. */
  add: function (item) {
    if (!item || !item.id) throw new Error('TP.shop.add: item.id required');
    item.category = item.category || 'cosmetic'; item.price = item.price || 0; item.levelReq = item.levelReq || 1;
    var i = TP.shop.items.findIndex(function (x) { return x.id === item.id; });
    if (i >= 0) TP.shop.items[i] = item; else TP.shop.items.push(item);
    return item;
  },
  owns: function (id) {
    var it = TP.shop.get(id);
    if (it && it.category === 'vehicles' && it.vehicleId) return TP.garage.owns(it.vehicleId);
    return !!TP.save.owned[id];
  },
  /** Why an item can't be bought right now ('' if it can). */
  blocker: function (id) {
    var it = TP.shop.get(id); if (!it) return 'Unknown item';
    if (!it.consumable && TP.shop.owns(id)) return 'Owned';
    if (TP.save.level < it.levelReq) return 'Level ' + it.levelReq;
    if (TP.save.cash < it.price) return 'Need ' + fmtCash(it.price - TP.save.cash);
    return '';
  },
  /** Buy an item: checks cash/level/ownership, charges, marks owned, runs item.onBuy(ctx), emits 'purchase'. */
  buy: function (id, ctx) {
    var it = TP.shop.get(id); if (!it || TP.shop.blocker(id)) return false;
    TP.addCash(-it.price, 'shop:' + id);
    if (!it.consumable) TP.save.owned[id] = true;
    try { if (it.onBuy) it.onBuy(ctx || {}); } catch (e) { console.error('[TP] shop onBuy failed', e); }
    TP.store(); TP.emit('purchase', it);
    return true;
  }
};
/** Shop item for a vehicle (auto-created at boot for every vehicle with price > 0 that has none). */
TP.shop.vehicleItem = function (vehicleId) {
  var v = TP.vehicles[vehicleId];
  return {
    id: 'veh:' + vehicleId, category: 'vehicles', vehicleId: vehicleId, name: v.name, desc: (v.brand ? v.brand + ' — ' : '') + (TP.classes[v.class] ? TP.classes[v.class].name : ''),
    price: v.price, levelReq: v.levelReq, appliesTo: { classes: [v.class] },
    onBuy: function () { var g = TP.garage.add(vehicleId); TP.garage.select(g.uid); }
  };
};

/* ---------------------------------------------------------------------------
 * 9. BASE CONTENT: 3 vehicles, 4 AI drivers, base upgrades
 *    (models are built by TP.models.* defined in the rendering section)
 * ------------------------------------------------------------------------- */
TP.addVehicle('sd_thunderbolt', {
  name: 'TD-2500 Hauler', brand: 'Thunderbolt Diesel', class: 'street_diesel', price: 18000, levelReq: 1,
  desc: 'A crew-cab 4x4 on 35s with a single turbo and a stack through the bed. The truck everybody starts with.',
  specs: { hp: 760, torque: 1450, weight: 7950, gears: [24, 19.5, 16], redline: 3800, shiftRpm: 3450, idle: 750,
    traction: 1.0, durability: 1.0, wheelRadius: 0.56, wheelbase: 3.9, cgHeight: 0.95, hitchHeight: 0.62,
    frontBias: 0.57, halfWidth: 1.05, drive: '4wd' },
  engine: { type: 'diesel', count: 1, cyl: 6, turbo: 1, pitch: 1.0, rough: 0.55, whistle: 0.8, volume: 1 },
  liveries: [
    { name: 'Storm Blue', base: '#2459a8', accent: '#f3efe6', trim: '#17140f', number: '27', pattern: 'stripe' },
    { name: 'Barn Red', base: '#b8322a', accent: '#ffd23f', trim: '#17140f', number: '8', pattern: 'flames' },
    { name: 'Midnight', base: '#1d1f24', accent: '#ff7a1a', trim: '#9aa3ab', number: '13', pattern: 'stripe' },
    { name: 'Cream Classic', base: '#efe3c4', accent: '#2e8b3d', trim: '#3a2a1a', number: '3', pattern: 'twoTone' }
  ],
  build: function (livery) { return TP.models.pickup(livery, this); }
});
TP.addVehicle('fs_prairie', {
  name: '4650 Row Crop', brand: 'Prairie King', class: 'farm_stock', price: 15000, levelReq: 1,
  desc: 'A big-tired row-crop tractor straight off the farm, with a suitcase-weight bracket and one tall stack.',
  specs: { hp: 480, torque: 1200, weight: 10950, gears: [56, 45, 35], redline: 2600, shiftRpm: 2400, idle: 800,
    traction: 1.0, wheelRadius: 0.92, wheelbase: 2.9, cgHeight: 1.1, hitchHeight: 0.55,
    frontBias: 0.36, halfWidth: 1.35, drive: '2wd', maxLift: 0.16, durability: 1.2 },
  engine: { type: 'diesel', count: 1, cyl: 6, turbo: 1, pitch: 0.78, rough: 0.7, whistle: 0.5, volume: 1 },
  liveries: [
    { name: 'Prairie Green', base: '#2e7d32', accent: '#ffd23f', trim: '#1a1a1a', number: '46', pattern: 'farm' },
    { name: 'Harvest Red', base: '#b8322a', accent: '#f3efe6', trim: '#1a1a1a', number: '12', pattern: 'farm' },
    { name: 'Field Orange', base: '#e8731f', accent: '#1a1a1a', trim: '#f3efe6', number: '77', pattern: 'farm' }
  ],
  build: function (livery) { return TP.models.tractor(livery, this); }
});
TP.addVehicle('mr_pocket_rocket', {
  name: 'Pocket Rocket', brand: 'Wildfire Speed Shop', class: 'mini_rod', price: 26000, levelReq: 2,
  desc: 'A 2,000 lb chassis with a blown big-block, wheelie bars and a short temper. Feather it or it bites.',
  specs: { hp: 1150, torque: 950, weight: 2030, gears: [26, 20], redline: 7800, shiftRpm: 7200, idle: 1100,
    traction: 1.0, durability: 0.9, wheelRadius: 0.62, wheelbase: 2.3, cgHeight: 0.6, hitchHeight: 0.5,
    frontBias: 0.24, halfWidth: 0.95, drive: '2wd', maxLift: 0.3, wheelInertia: 12, hopFreq: 5.2 },
  engine: { type: 'gas', count: 1, cyl: 8, blower: true, pitch: 1.1, rough: 0.4, volume: 1 },
  liveries: [
    { name: 'Hot Lava', base: '#ff6a1a', accent: '#ffd23f', trim: '#17140f', number: '7', pattern: 'flames' },
    { name: 'Grape Soda', base: '#7a3fa0', accent: '#5fd4e8', trim: '#17140f', number: '99', pattern: 'stripe' },
    { name: 'Lime Light', base: '#8cc63f', accent: '#17140f', trim: '#f3efe6', number: '1', pattern: 'checker' }
  ],
  build: function (livery) { return TP.models.miniRod(livery, this); }
});

TP.addDriver('wade', { name: 'Wade Kessler', nickname: 'Smokestack', hometown: 'Cedar Fork, IA', vehicleId: 'sd_thunderbolt',
  livery: { base: '#b8322a', accent: '#ffd23f', number: '8', pattern: 'flames' }, skill: 'good', color: '#b8322a',
  lines: { intro: ['Wade Kessler, the Smokestack himself, rolling in from Cedar Fork!', 'Here comes Smokestack Wade. You will smell him before you see him!'],
    good: ['Smokestack Wade is putting on a show!'], full: ['FULL PULL for Smokestack! Cedar Fork is going nuts!'], bad: ['Tough break for Wade. He will be back.'] } });
TP.addDriver('tammy', { name: 'Tammy Lindqvist', nickname: 'Tailgate', hometown: 'Pine Bluff Junction, MN', vehicleId: 'sd_thunderbolt',
  livery: { base: '#efe3c4', accent: '#2e8b3d', trim: '#3a2a1a', number: '3', pattern: 'twoTone' }, skill: 'pro', color: '#2e8b3d',
  lines: { intro: ['Tammy "Tailgate" Lindqvist, last year\'s points champ!', 'From Pine Bluff Junction, the one to beat: Tailgate Tammy!'],
    good: ['Smooth as butter, that is how Tammy does it!'], full: ['Tailgate Tammy goes ALL THE WAY!'], bad: ['Even champs have off nights, folks.'] } });
TP.addDriver('bo', { name: 'Bo Pruitt', nickname: 'Big Bend', hometown: 'Big Bend, NE', vehicleId: 'sd_thunderbolt',
  livery: { base: '#1d1f24', accent: '#ff7a1a', trim: '#9aa3ab', number: '13', pattern: 'stripe' }, skill: 'novice', color: '#ff7a1a',
  lines: { intro: ['First season on the circuit, give it up for Bo Pruitt!', 'Bo "Big Bend" Pruitt, all heart and a heavy right foot!'],
    good: ['Look at the rookie go!'], full: ['The ROOKIE got a full pull! Unbelievable!'], bad: ['Lot of right foot, not a lot of finesse, Bo.'] } });
TP.addDriver('earl', { name: 'Earl Haskins', nickname: 'Rooster', hometown: 'Millersburg Flats, OH', vehicleId: 'fs_prairie',
  livery: { base: '#b8322a', accent: '#f3efe6', number: '12', pattern: 'farm' }, skill: 'pro', color: '#ffd23f',
  lines: { intro: ['Seventy-one years young, Earl "Rooster" Haskins!', 'Rooster Earl has pulled at this fair since before the grandstand had a roof!'],
    good: ['Old Rooster still knows every trick!'], full: ['Rooster Earl, FULL PULL! Somebody get that man a pie!'], bad: ['Earl just shakes his head and smiles.'] } });

// Base upgrades (garage.js adds more). Each level's effect is absolute, not cumulative.
TP.addUpgrade('engine_tune', { name: 'Engine Tune', slot: 'engine', desc: 'Injector, pump and timing work. More horsepower, a bit more heat.',
  levels: [{ price: 2500, effect: { hpMult: 1.06, heatMult: 1.04 } }, { price: 6000, effect: { hpMult: 1.12, heatMult: 1.08 } }, { price: 14000, levelReq: 4, effect: { hpMult: 1.2, heatMult: 1.12 } }] });
TP.addUpgrade('turbo', { name: 'Turbo Upgrade', slot: 'turbo', desc: 'Bigger compressor wheel, quicker spool.', appliesTo: { engines: ['diesel', 'methanol', 'turbine'] },
  levels: [{ price: 3000, effect: { spoolMult: 1.2, hpMult: 1.04 } }, { price: 8000, effect: { spoolMult: 1.45, hpMult: 1.08 } }] });
TP.addUpgrade('tires', { name: 'Tire Prep', slot: 'tires', desc: 'Fresh rubber, siped and trued. More bite in the dirt.',
  levels: [{ price: 2000, effect: { tractionAdd: 0.012 } }, { price: 5500, effect: { tractionAdd: 0.025 } }, { price: 12000, levelReq: 3, effect: { tractionAdd: 0.04 } }] });
TP.addUpgrade('cooling', { name: 'Cooling Package', slot: 'cooling', desc: 'Bigger radiator and intercooler. Run hotter, longer.',
  levels: [{ price: 1500, effect: { coolingAdd: 0.3 } }, { price: 4000, effect: { coolingAdd: 0.7, heatMult: 0.92 } }] });
TP.addUpgrade('front_weights', { name: 'Front Weights', slot: 'weights', desc: 'Suitcase weights on the front bracket keep the nose down and steering alive.',
  levels: [{ price: 800, effect: { frontWeightAdd: 150 } }, { price: 1800, effect: { frontWeightAdd: 300 } }] });
TP.addUpgrade('driveline', { name: 'Driveline Armor', slot: 'driveline', desc: 'Chromoly shafts and billet yokes. Survives hop that would snap stock parts.',
  levels: [{ price: 2500, effect: { durabilityMult: 1.3, hopDampMult: 1.08 } }, { price: 6500, effect: { durabilityMult: 1.7, hopDampMult: 1.15 } }] });
TP.addUpgrade('boost_kit', { name: 'Boost Kit', slot: 'boost', desc: 'An extra water-meth or nitrous shot per pull.', appliesTo: { boostOnly: true },
  levels: [{ price: 5000, effect: { boostShotsAdd: 1 } }, { price: 12000, levelReq: 5, effect: { boostShotsAdd: 1, boostMult: 1.08 } }] });

/* ---------------------------------------------------------------------------
 * 10. LOW-POLY TOOLKIT  TP.lowpoly   (requires THREE at call time)
 *   Builders return NON-INDEXED BufferGeometry with flat normals and a per-vertex
 *   'color' attribute (sRGB hex converted to linear), already transformed by
 *   o = {x,y,z, rx,ry,rz, sx,sy,sz}. Merge many into ONE mesh with TP.lowpoly.builder().
 * ------------------------------------------------------------------------- */
var LP = TP.lowpoly = {};
var _colCache = {};
LP.color = function (c) {
  if (c && c.isColor) return c;
  var key = String(c);
  var col = _colCache[key];
  if (!col) { col = new THREE.Color(c == null ? 0xffffff : c); col.convertSRGBToLinear(); _colCache[key] = col; }
  return col;
};
var _m4 = null, _eul = null, _q = null, _sv = null, _pv = null;
function xform(g, o) {
  if (!o) return g;
  if (!_m4) { _m4 = new THREE.Matrix4(); _eul = new THREE.Euler(); _q = new THREE.Quaternion(); _sv = new THREE.Vector3(); _pv = new THREE.Vector3(); }
  if (o.rx || o.ry || o.rz || o.sx || o.sy || o.sz || o.x || o.y || o.z) {
    _eul.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ'); _q.setFromEuler(_eul);
    _sv.set(o.sx || 1, o.sy || 1, o.sz || 1); _pv.set(o.x || 0, o.y || 0, o.z || 0);
    _m4.compose(_pv, _q, _sv); g.applyMatrix4(_m4);
  }
  return g;
}
function finishGeo(g, color, o) {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('normal');
  xform(g, o);
  g.computeVertexNormals();
  LP.paint(g, color);
  return g;
}
/** Set (or replace) the whole geometry's vertex color. */
LP.paint = function (g, color) {
  var c = LP.color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (var i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
};
LP.box = function (w, h, d, color, o) { return finishGeo(new THREE.BoxGeometry(w, h, d), color, o); };
/** Cylinder: axis Y by default, o.axis = 'x' | 'z' to lay it down. */
LP.cyl = function (rTop, rBot, h, seg, color, o) {
  var g = new THREE.CylinderGeometry(rTop, rBot, h, seg || 8, 1);
  o = o || {};
  if (o.axis === 'x') g.rotateZ(Math.PI / 2); else if (o.axis === 'z') g.rotateX(Math.PI / 2);
  return finishGeo(g, color, o);
};
LP.cone = function (r, h, seg, color, o) { return LP.cyl(0.0001, r, h, seg, color, o); };
LP.sphere = function (r, color, o) { return finishGeo(new THREE.IcosahedronGeometry(r, (o && o.detail) || 0), color, o); };
/** Wedge: box whose top slopes down toward +X. slope 0..1 = how much of the height is cut at the +X end. */
LP.wedge = function (w, h, d, color, o) {
  var g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position, slope = (o && o.slope != null) ? o.slope : 0.7;
  for (var i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getX(i) > 0) p.setY(i, h / 2 - h * slope);
  return finishGeo(g, color, o);
};
/** Tapered box: top face scaled by (tx, tz) and shifted by o.shift (x) — cabs, hoods, roofs. */
LP.taper = function (w, h, d, tx, tz, color, o) {
  var g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position, sh = (o && o.shift) || 0;
  for (var i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * tx + sh); p.setZ(i, p.getZ(i) * tz); }
  return finishGeo(g, color, o);
};
/** Truck cab: tapered greenhouse with a dark window band. Returns merged geometry. o.glass color. */
LP.cab = function (w, h, d, color, o) {
  o = o || {};
  var lower = h * 0.45, upper = h - lower;
  var parts = [
    LP.box(w, lower, d, color, { x: o.x || 0, y: (o.y || 0) + lower / 2, z: o.z || 0 }),
    LP.taper(w * 0.98, upper, d * 0.98, o.taperX || 0.78, o.taperZ || 0.9, o.glass || TP.palette.glass, { x: (o.x || 0) - w * 0.04, y: (o.y || 0) + lower + upper / 2, z: o.z || 0, shift: -w * 0.04 }),
    LP.taper(w * 0.8, upper * 0.18, d * 0.9, 0.98, 0.98, color, { x: (o.x || 0) - w * 0.08, y: (o.y || 0) + h - upper * 0.05, z: o.z || 0 }),
    LP.box(w * 0.06, upper * 0.9, d * 0.99, color, { x: (o.x || 0) - w * 0.05, y: (o.y || 0) + lower + upper * 0.45, z: o.z || 0 })
  ];
  return LP.merge(parts);
};
/** Tire with lugs, axis along Z (rolls about Z). o = {lugs, lugDepth, chevron, rim, rimColor, color, seg, hub}. */
LP.tire = function (radius, width, o) {
  o = o || {};
  var seg = o.seg || 18, col = o.color || TP.palette.rubber, parts = [];
  var core = radius - (o.lugDepth || radius * 0.06);
  parts.push(LP.cyl(core, core, width, seg, col, { axis: 'z' }));
  var lugs = o.lugs || seg, ld = o.lugDepth || radius * 0.06;
  for (var i = 0; i < lugs; i++) {
    var a = i / lugs * Math.PI * 2;
    if (o.chevron) {
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        parts.push(LP.box(ld * 2.2, ld * 1.6, width * 0.5, col, { x: Math.cos(a) * (core + ld * 0.3), y: Math.sin(a) * (core + ld * 0.3), z: sgn * width * 0.24, rz: a, ry: sgn * 0.5 }));
      }
    } else {
      parts.push(LP.box(ld * 1.8, ld * 2, width * (i % 2 ? 0.92 : 0.7), col, { x: Math.cos(a) * (core + ld * 0.4), y: Math.sin(a) * (core + ld * 0.4), z: (i % 2 ? 0 : width * 0.12), rz: a }));
    }
  }
  var rimR = o.rim || radius * 0.55, rc = o.rimColor || TP.palette.rim;
  parts.push(LP.cyl(rimR, rimR, width * 1.02, Math.max(8, seg - 4), rc, { axis: 'z' }));
  parts.push(LP.cyl(rimR * 0.35, rimR * 0.35, width * 1.08, 6, o.hub || TP.palette.steelDark, { axis: 'z' }));
  for (var k = 0; k < 5; k++) { var b = k / 5 * Math.PI * 2; parts.push(LP.box(rimR * 0.12, rimR * 0.12, width * 1.06, TP.palette.chrome, { x: Math.cos(b) * rimR * 0.62, y: Math.sin(b) * rimR * 0.62 })); }
  return LP.merge(parts);
};
/** Merge geometries (own implementation): position + normal + color (+ uv, filled with 0 if missing). */
LP.merge = LP.mergeGeometries = function (geoms) {
  var list = [], total = 0, hasUV = false, i;
  for (i = 0; i < geoms.length; i++) {
    var g = geoms[i]; if (!g) continue;
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.color) LP.paint(g, 0xffffff);
    if (g.attributes.uv) hasUV = true;
    list.push(g); total += g.attributes.position.count;
  }
  var pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3), uv = hasUV ? new Float32Array(total * 2) : null;
  var off = 0;
  for (i = 0; i < list.length; i++) {
    var a = list[i].attributes, n = a.position.count;
    pos.set(a.position.array.subarray ? a.position.array.subarray(0, n * 3) : a.position.array, off * 3);
    nor.set(a.normal.array, off * 3);
    col.set(a.color.array, off * 3);
    if (uv && a.uv) uv.set(a.uv.array, off * 2);
    off += n;
    list[i].dispose();
  }
  var out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
};
var _matCache = {};
/** Shared materials. LP.mat('vc') = flat vertex-color standard material. LP.mat(hex|css, {rough, metal, emissive}). */
LP.mat = function (c, o) {
  o = o || {};
  var key = String(c) + '|' + JSON.stringify(o);
  if (_matCache[key]) return _matCache[key];
  var m;
  if (c === 'vc') m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: o.rough != null ? o.rough : 0.82, metalness: o.metal || 0 });
  else m = new THREE.MeshStandardMaterial({ color: LP.color(c), flatShading: true, roughness: o.rough != null ? o.rough : 0.8, metalness: o.metal || 0 });
  if (o.emissive != null) { m.emissive = LP.color(o.emissive); m.emissiveIntensity = o.emissiveIntensity || 1; }
  if (o.transparent) { m.transparent = true; m.opacity = o.opacity != null ? o.opacity : 0.6; m.depthWrite = false; }
  if (o.side === 'double') m.side = THREE.DoubleSide;
  _matCache[key] = m;
  return m;
};
/** Mesh from a geometry with the shared vertex-color material. o = {shadow (cast), receive, mat}. */
LP.mesh = function (geo, o) {
  o = o || {};
  var m = new THREE.Mesh(geo, o.mat || LP.mat('vc', o.matOpts));
  m.castShadow = !!o.shadow; m.receiveShadow = !!o.receive;
  return m;
};
/** Accumulating builder: b.box(...).cyl(...).add(geo); b.mesh(opts) / b.geometry(). Chainable. */
LP.builder = function () {
  var parts = [];
  var b = {
    parts: parts,
    add: function (g) { if (g) parts.push(g); return b; },
    box: function () { parts.push(LP.box.apply(null, arguments)); return b; },
    cyl: function () { parts.push(LP.cyl.apply(null, arguments)); return b; },
    cone: function () { parts.push(LP.cone.apply(null, arguments)); return b; },
    sphere: function () { parts.push(LP.sphere.apply(null, arguments)); return b; },
    wedge: function () { parts.push(LP.wedge.apply(null, arguments)); return b; },
    taper: function () { parts.push(LP.taper.apply(null, arguments)); return b; },
    cab: function () { parts.push(LP.cab.apply(null, arguments)); return b; },
    geometry: function () { return LP.merge(parts); },
    mesh: function (o) { return LP.mesh(LP.merge(parts), o); }
  };
  return b;
};
/** Canvas texture. draw(ctx, w, h). o = {repeat:[x,y], nearest, anisotropy}. */
LP.canvasTexture = function (w, h, draw, o) {
  o = o || {};
  var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  var ctx = cv.getContext('2d');
  draw(ctx, w, h);
  var t = new THREE.CanvasTexture(cv);
  t.encoding = THREE.sRGBEncoding;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
  t.anisotropy = o.anisotropy || 4;
  if (o.nearest) t.magFilter = THREE.NearestFilter;
  if (!t.userData) t.userData = {};
  t.userData.canvas = cv; t.userData.ctx = ctx;
  return t;
};
/** Textured plane (decal) facing +Z (or o.face 'x'/'-x'/'-z'/'up'). Transparent, polygon-offset to sit on surfaces. */
LP.decal = function (tex, w, h, o) {
  o = o || {};
  var m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: o.rough != null ? o.rough : 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, alphaTest: o.alphaTest || 0.02 });
  if (o.emissive) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = tex; m.emissiveIntensity = o.emissive; }
  var g = new THREE.PlaneGeometry(w, h);
  var mesh = new THREE.Mesh(g, m);
  if (o.face === 'x') mesh.rotation.y = Math.PI / 2;
  else if (o.face === '-x') mesh.rotation.y = -Math.PI / 2;
  else if (o.face === '-z') mesh.rotation.y = Math.PI;
  else if (o.face === 'up') mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(o.x || 0, o.y || 0, o.z || 0);
  mesh.receiveShadow = !!o.receive;
  return mesh;
};
/** Racing number roundel / panel texture. o = {fg, bg, outline, shape:'circle'|'square'|'plain', font}. */
LP.numberTexture = function (num, o) {
  o = o || {};
  return LP.canvasTexture(128, 128, function (c, w, h) {
    c.clearRect(0, 0, w, h);
    if (o.shape !== 'plain') {
      c.fillStyle = o.bg || '#f3efe6';
      c.beginPath();
      if (o.shape === 'square') c.rect(6, 6, w - 12, h - 12); else c.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 6; c.strokeStyle = o.ring || '#17140f'; c.stroke();
    }
    c.font = '900 ' + (String(num).length > 2 ? 54 : 72) + 'px ' + (o.font || '"Saira Condensed", "Arial Narrow", Impact, sans-serif');
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (o.outline) { c.lineWidth = 8; c.strokeStyle = o.outline; c.strokeText(String(num), w / 2, h / 2 + 4); }
    c.fillStyle = o.fg || '#17140f'; c.fillText(String(num), w / 2, h / 2 + 4);
  });
};
/** Text texture for signs/banners. o = {w,h, bg, fg, font, size, stroke, align}. */
LP.textTexture = function (text, o) {
  o = o || {};
  var W2 = o.w || 512, H2 = o.h || 128;
  return LP.canvasTexture(W2, H2, function (c, w, h) {
    if (o.bg) { c.fillStyle = o.bg; c.fillRect(0, 0, w, h); } else c.clearRect(0, 0, w, h);
    if (o.border) { c.lineWidth = o.borderWidth || 8; c.strokeStyle = o.border; c.strokeRect(4, 4, w - 8, h - 8); }
    c.font = (o.weight || '900') + ' ' + (o.size || Math.round(h * 0.62)) + 'px ' + (o.font || '"Saira Condensed", "Arial Narrow", Impact, sans-serif');
    c.textAlign = o.align || 'center'; c.textBaseline = 'middle';
    var x = o.align === 'left' ? h * 0.2 : w / 2;
    if (o.stroke) { c.lineWidth = o.strokeWidth || 6; c.strokeStyle = o.stroke; c.strokeText(text, x, h / 2 + 2); }
    c.fillStyle = o.fg || '#17140f'; c.fillText(text, x, h / 2 + 2);
  }, o);
};
/** Draw a livery side panel: base, pattern (stripe|flames|twoTone|checker|farm|plain), number, brand. Returns texture. */
LP.liveryTexture = function (lv, o) {
  o = o || {};
  var W2 = o.w || 512, H2 = o.h || 160;
  return LP.canvasTexture(W2, H2, function (c, w, h) {
    c.clearRect(0, 0, w, h);
    var acc = lv.accent || '#ffd23f', trim = lv.trim || '#17140f', pat = lv.pattern || 'stripe';
    if (o.fill) { c.fillStyle = lv.base || '#c8342b'; c.fillRect(0, 0, w, h); }
    c.save();
    if (o.mirror) { c.translate(w, 0); c.scale(-1, 1); }
    if (pat === 'stripe') {
      c.fillStyle = acc; c.fillRect(0, h * 0.52, w, h * 0.16);
      c.fillStyle = trim; c.fillRect(0, h * 0.7, w, h * 0.05);
    } else if (pat === 'twoTone') {
      c.fillStyle = acc; c.fillRect(0, h * 0.58, w, h * 0.42);
      c.fillStyle = trim; c.fillRect(0, h * 0.55, w, h * 0.04);
    } else if (pat === 'checker') {
      var s = h / 6;
      for (var cx = 0; cx < w * 0.45; cx += s) for (var cy = h * 0.5; cy < h; cy += s) if (((cx + cy) / s | 0) % 2 === 0) { c.fillStyle = acc; c.fillRect(w - cx - s, cy, s, s); }
    } else if (pat === 'flames') {
      // licks of flame from the front (+x = right side of the texture)
      for (var layer = 0; layer < 2; layer++) {
        c.fillStyle = layer === 0 ? acc : (lv.flame2 || '#ff6a1a');
        c.beginPath(); c.moveTo(w, h * 0.35);
        var tips = 6, sc = layer === 0 ? 1 : 0.7;
        for (var k = 0; k <= tips; k++) {
          var ty = h * (0.3 + 0.6 * k / tips);
          var len = w * (0.35 + 0.35 * Math.abs(Math.sin(k * 1.7 + 0.5))) * sc;
          c.quadraticCurveTo(w - len * 0.5, ty - h * 0.08, w - len, ty);
          c.quadraticCurveTo(w - len * 0.55, ty + h * 0.02, w - len * 0.2, ty + h * 0.07);
        }
        c.lineTo(w, h * 0.95); c.closePath(); c.fill();
      }
    } else if (pat === 'farm') {
      c.fillStyle = acc; c.fillRect(0, h * 0.62, w, h * 0.1);
    }
    c.restore();
    // brand
    if (lv.brandText !== false && (lv.brandText || o.brand)) {
      c.font = '800 ' + Math.round(h * 0.2) + 'px "Saira Condensed", "Arial Narrow", Impact, sans-serif';
      c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillStyle = trim === '#17140f' && pat !== 'twoTone' ? acc : trim;
      if (o.mirror) { c.textAlign = 'right'; c.fillText(String(lv.brandText || o.brand).toUpperCase(), w * 0.95, h * 0.3); }
      else c.fillText(String(lv.brandText || o.brand).toUpperCase(), w * 0.05, h * 0.3);
    }
    // number roundel
    if (lv.number != null && lv.number !== '' && o.number !== false) {
      var r = h * 0.3, nx = o.numberX != null ? o.numberX * w : w * 0.62, ny = h * 0.36;
      if (o.mirror) nx = w - nx;
      c.fillStyle = lv.numberBg || '#f3efe6'; c.beginPath(); c.arc(nx, ny, r, 0, Math.PI * 2); c.fill();
      c.lineWidth = h * 0.03; c.strokeStyle = trim; c.stroke();
      c.font = '900 ' + Math.round(r * (String(lv.number).length > 2 ? 0.95 : 1.35)) + 'px "Saira Condensed", "Arial Narrow", Impact, sans-serif';
      c.textAlign = 'center'; c.fillStyle = lv.numberFg || '#17140f'; c.fillText(String(lv.number), nx, ny + r * 0.08);
    }
  });
};
LP.palette = TP.palette;

/* ---------------------------------------------------------------------------
 * 11. RENDERER, SKY, LOOP, QUALITY
 * ------------------------------------------------------------------------- */
TP.time = 0; TP.dt = 0; TP.realDt = 0; TP.timeScale = 1; TP.paused = false; TP.frameCount = 0;
TP.quality = 'high';
TP.tmp = {};   // reusable vectors etc. (filled at boot) — never keep references across frames
var R3 = TP.r3 = { updaters: [], fpsSamples: [], lowFpsT: 0 };
/** Run fn(dt, realDt) every frame (after the pull, before render). Returns an unsubscribe function. */
TP.onFrame = function (fn) { R3.updaters.push(fn); return function () { var i = R3.updaters.indexOf(fn); if (i >= 0) R3.updaters.splice(i, 1); }; };

function pickQuality() {
  var s = TP.save.settings.quality;
  if (s === 'high' || s === 'low') return s;
  var mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '') || (W.matchMedia && W.matchMedia('(pointer: coarse)').matches);
  var cores = navigator.hardwareConcurrency || 4;
  return (mobile && cores <= 4) ? 'low' : 'high';
}
TP.setQuality = function (q) {
  TP.quality = q === 'low' ? 'low' : 'high';
  if (!TP.renderer) return;
  TP.renderer.setPixelRatio(Math.min(W.devicePixelRatio || 1, TP.quality === 'high' ? 1.5 : 1));
  TP.renderer.shadowMap.enabled = TP.quality === 'high';
  if (TP.lights && TP.lights.sun) TP.lights.sun.castShadow = TP.quality === 'high';
  TP.scene && TP.scene.traverse(function (o) { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
  onResize();
  TP.emit('quality', TP.quality);
};

var SKY_VS = 'varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position,1.0)).xyz - cameraPosition); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }';
var SKY_FS = [
  'uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize; uniform float haze;',
  'varying vec3 vDir;',
  'void main(){',
  '  vec3 d = normalize(vDir); float h = d.y;',
  '  vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-h * 3.0, 0.0, 1.0), 0.7));',
  '  float s = max(dot(d, normalize(sunDir)), 0.0);',
  '  col += sunColor * (pow(s, 900.0 / sunSize) * 2.2 + pow(s, 12.0) * 0.25 * haze);',
  '  col = mix(col, horizon, (1.0 - smoothstep(0.0, 0.18, abs(h))) * 0.35 * haze);',
  '  gl_FragColor = vec4(col, 1.0);',
  '  #include <tonemapping_fragment>',
  '  #include <encodings_fragment>',
  '}'].join('\n');

function initRenderer() {
  var host = document.getElementById('game');
  TP.quality = pickQuality();
  var renderer;
  renderer = new THREE.WebGLRenderer({ antialias: TP.quality === 'high', powerPreference: 'high-performance', alpha: false, stencil: false });
  renderer.setPixelRatio(Math.min(W.devicePixelRatio || 1, TP.quality === 'high' ? 1.5 : 1));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = TP.quality === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  renderer.domElement.id = 'gl';
  TP.renderer = renderer;
  var scene = TP.scene = new THREE.Scene();
  var cam = TP.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 1500);
  cam.position.set(10, 3, 14); cam.lookAt(0, 1, 0);
  var hemi = new THREE.HemisphereLight(0xdcefff, 0x8a6a48, 0.85);
  var sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.castShadow = TP.quality === 'high';
  sun.shadow.mapSize.set(1024, 1024);
  var sc = sun.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);
  TP.lights = { sun: sun, hemi: hemi, sunDir: new THREE.Vector3(-0.45, 0.62, 0.64).normalize() };
  // sky dome
  var skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
      sunDir: { value: TP.lights.sunDir.clone() }, sunColor: { value: new THREE.Color(1, 0.9, 0.7) }, sunSize: { value: 1 }, haze: { value: 1 } },
    vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false
  });
  var sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  scene.add(sky);
  TP.sky = { mesh: sky, mat: skyMat };
  TP.setSky({});
  var T = TP.tmp;
  T.v1 = new THREE.Vector3(); T.v2 = new THREE.Vector3(); T.v3 = new THREE.Vector3(); T.v4 = new THREE.Vector3();
  T.q1 = new THREE.Quaternion(); T.m1 = new THREE.Matrix4(); T.e1 = new THREE.Euler(); T.c1 = new THREE.Color(); T.s1 = new THREE.Vector3(1, 1, 1);
  W.addEventListener('resize', onResize);
  W.addEventListener('orientationchange', function () { setTimeout(onResize, 120); });
  if (W.visualViewport) W.visualViewport.addEventListener('resize', onResize);
  onResize();
}
/** Sky & light setup. o = {top, horizon, bottom, sun (0xhex light color), sunIntensity, hemiSky, hemiGround, hemiIntensity,
 *  fogNear, fogFar, sunDir:[x,y,z], haze, exposure}. Colors are sRGB hex. */
TP.setSky = function (o) {
  o = o || {};
  var u = TP.sky.mat.uniforms;
  u.top.value.copy(LP.color(o.top != null ? o.top : 0x3d8fd8));
  u.horizon.value.copy(LP.color(o.horizon != null ? o.horizon : 0xcfe6f2));
  u.bottom.value.copy(LP.color(o.bottom != null ? o.bottom : 0x9fb5a0));
  u.sunColor.value.copy(LP.color(o.sunGlow != null ? o.sunGlow : 0xfff1d0));
  u.haze.value = o.haze != null ? o.haze : 1;
  u.sunSize.value = o.sunSize || 1;
  if (o.sunDir) TP.lights.sunDir.set(o.sunDir[0], o.sunDir[1], o.sunDir[2]).normalize();
  u.sunDir.value.copy(TP.lights.sunDir);
  TP.lights.sun.color.copy(LP.color(o.sun != null ? o.sun : 0xfff0d8));
  TP.lights.sun.intensity = o.sunIntensity != null ? o.sunIntensity : 2.4;
  TP.lights.hemi.color.copy(LP.color(o.hemiSky != null ? o.hemiSky : 0xdcefff));
  TP.lights.hemi.groundColor.copy(LP.color(o.hemiGround != null ? o.hemiGround : 0x8a6a48));
  TP.lights.hemi.intensity = o.hemiIntensity != null ? o.hemiIntensity : 0.85;
  TP.scene.fog = new THREE.Fog(LP.color(o.fog != null ? o.fog : (o.horizon != null ? o.horizon : 0xcfe6f2)).clone(), o.fogNear || 140, o.fogFar || 700);
  TP.renderer.toneMappingExposure = o.exposure || 1.12;
  TP.scene.background = null;
};
function onResize() {
  if (!TP.renderer) return;
  var host = document.getElementById('game');
  var w = host.clientWidth || W.innerWidth, h = host.clientHeight || W.innerHeight;
  TP.renderer.setSize(w, h, false);
  TP.renderer.domElement.style.width = w + 'px'; TP.renderer.domElement.style.height = h + 'px';
  TP.camera.aspect = w / Math.max(1, h);
  TP.portrait = h > w * 1.05;
  TP.camera.updateProjectionMatrix();
  TP.viewW = w; TP.viewH = h;
  if (TP.fx && TP.fx._resize) TP.fx._resize();
  document.documentElement.classList.toggle('portrait', !!TP.portrait);
  TP.emit('resize', w, h);
}
TP.resize = onResize;

var lastT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  var raw = lastT ? (now - lastT) / 1000 : 0.016;
  lastT = now;
  stepFrame(Math.min(Math.max(raw, 0), 0.05), raw);
  if (TP.renderer) TP.renderer.render(TP.scene, TP.camera);
}
function stepFrame(realDt, rawDt) {
  TP.realDt = realDt;
  TP.dt = TP.paused ? 0 : realDt * TP.timeScale;
  TP.time += TP.dt;
  TP.frameCount++;
  // fps meter (real frames)
  var fs = R3.fpsSamples; fs.push(rawDt || realDt); if (fs.length > 60) fs.shift();
  try { pollInput(realDt); } catch (e) { console.error(e); }
  if (R3.pullUpdate) { try { R3.pullUpdate(TP.dt, realDt); } catch (e) { console.error('[TP] pull update failed', e); R3.pullUpdate = null; } }
  for (var i = 0; i < R3.updaters.length; i++) { try { R3.updaters[i](TP.dt, realDt); } catch (e) { console.error('[TP] frame updater failed', e); } }
  TP.emit('frame', TP.dt, realDt);
  if (TP.fx) TP.fx.update(TP.dt);
  if (TP.cam) TP.cam.update(realDt, TP.dt);
  if (TP.audio) TP.audio.update(realDt);
  autoQuality(realDt);
}
function autoQuality(dt) {
  if (TP.save.settings.quality !== 'auto' || TP.quality === 'low' || !R3.pullUpdate) { R3.lowFpsT = 0; return; }
  var fs = R3.fpsSamples; if (fs.length < 60) return;
  var avg = 0; for (var i = 0; i < fs.length; i++) avg += fs[i]; avg /= fs.length;
  if (avg > 1 / 26) R3.lowFpsT += dt; else R3.lowFpsT = Math.max(0, R3.lowFpsT - dt);
  if (R3.lowFpsT > 4) { R3.lowFpsT = 0; TP.setQuality('low'); TP.ui && TP.ui.toast('Switched to Low graphics for smoother pulls'); }
}
TP.fps = function () { var fs = R3.fpsSamples; if (!fs.length) return 0; var a = 0; for (var i = 0; i < fs.length; i++) a += fs[i]; return Math.round(fs.length / a); };

/* ---------------------------------------------------------------------------
 * 12. PARTICLES  TP.fx  — pooled THREE.Points per type, one draw call each
 * ------------------------------------------------------------------------- */
var FX_VS = [
  'attribute float size; attribute float alpha; attribute vec3 pcolor; attribute float spin;',
  'uniform float scale; varying float vA; varying vec3 vC; varying float vS;',
  'void main(){ vA = alpha; vC = pcolor; vS = spin; vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  gl_PointSize = size * scale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }'].join('\n');
var FX_FS = [
  'uniform sampler2D map; varying float vA; varying vec3 vC; varying float vS;',
  'void main(){ vec2 uv = gl_PointCoord - 0.5; float c = cos(vS), s = sin(vS); uv = vec2(c*uv.x - s*uv.y, s*uv.x + c*uv.y) + 0.5;',
  '  vec4 t = texture2D(map, uv); gl_FragColor = vec4(vC * t.rgb, t.a * vA); if (gl_FragColor.a < 0.004) discard;',
  '  #include <tonemapping_fragment>',
  '  #include <encodings_fragment>',
  '}'].join('\n');
function fxTexture(kind) {
  return LP.canvasTexture(64, 64, function (c, w, h) {
    c.clearRect(0, 0, w, h);
    if (kind === 'puff') {
      for (var i = 0; i < 7; i++) {
        var x = w / 2 + Math.cos(i * 2.4) * w * 0.14 * (i ? 1 : 0), y = h / 2 + Math.sin(i * 2.4) * h * 0.14 * (i ? 1 : 0), r = w * (i ? 0.26 : 0.34);
        var g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      }
    } else if (kind === 'flame') {
      var g2 = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g2.addColorStop(0, 'rgba(255,255,255,1)'); g2.addColorStop(0.35, 'rgba(255,230,160,0.9)'); g2.addColorStop(1, 'rgba(255,120,20,0)');
      c.fillStyle = g2; c.fillRect(0, 0, w, h);
    } else if (kind === 'chunk') {
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(w * 0.2, h * 0.3); c.lineTo(w * 0.7, h * 0.15); c.lineTo(w * 0.85, h * 0.6); c.lineTo(w * 0.45, h * 0.85); c.lineTo(w * 0.15, h * 0.65); c.closePath(); c.fill();
    } else {
      c.fillStyle = '#fff'; c.fillRect(w * 0.18, h * 0.3, w * 0.64, h * 0.4);
    }
  });
}
var FX_TYPES = {
  smoke:    { max: 650, tex: 'puff', blend: 'normal', life: [1.4, 2.8], size: [0.7, 3.4], c0: 0x1a1714, c1: 0x5a5550, alpha: 0.68, drag: 1.1, gravity: -0.9, spin: 0.6 },
  steam:    { max: 160, tex: 'puff', blend: 'normal', life: [0.8, 1.6], size: [0.6, 2.4], c0: 0xffffff, c1: 0xd8d8d8, alpha: 0.45, drag: 1.4, gravity: -0.6, spin: 0.5 },
  dust:     { max: 420, tex: 'puff', blend: 'normal', life: [1.2, 2.6], size: [0.8, 3.6], c0: 0xa9825a, c1: 0xc9ab85, alpha: 0.55, drag: 1.6, gravity: -0.15, spin: 0.4 },
  dirt:     { max: 700, tex: 'chunk', blend: 'normal', life: [0.6, 1.3], size: [0.16, 0.12], c0: 0x5e3b1f, c1: 0x7a5230, alpha: 1, drag: 0.25, gravity: 9.8, spin: 6 },
  flame:    { max: 320, tex: 'flame', blend: 'add', life: [0.12, 0.32], size: [0.7, 1.5], c0: 0xfff2b0, c1: 0xff4a10, alpha: 1, drag: 2, gravity: -2, spin: 2 },
  spark:    { max: 240, tex: 'flame', blend: 'add', life: [0.3, 0.8], size: [0.18, 0.05], c0: 0xffe9a0, c1: 0xff6a1a, alpha: 1, drag: 0.6, gravity: 6, spin: 0 },
  confetti: { max: 420, tex: 'square', blend: 'normal', life: [2.5, 4.5], size: [0.3, 0.3], c0: 0xffffff, c1: 0xffffff, alpha: 1, drag: 1.8, gravity: 2.2, spin: 8, keepColor: true }
};
function FxPool(name, cfg) {
  var low = TP.quality === 'low';
  var n = Math.max(16, Math.round(cfg.max * (low ? 0.5 : 1)));
  this.name = name; this.cfg = cfg; this.n = n; this.head = 0; this.alive = 0;
  var g = new THREE.BufferGeometry();
  this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.spin = new Float32Array(n);
  this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
  this.spinV = new Float32Array(n); this.base = new Float32Array(n * 3);
  g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('spin', new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  this.geo = g;
  this.mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: fxTexture(cfg.tex) }, scale: { value: 400 } },
    vertexShader: FX_VS, fragmentShader: FX_FS, transparent: true, depthWrite: false,
    blending: cfg.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  this.points = new THREE.Points(g, this.mat);
  this.points.frustumCulled = false;
  this.points.renderOrder = cfg.blend === 'add' ? 5 : 4;
  this.c0 = LP.color(cfg.c0).clone(); this.c1 = LP.color(cfg.c1).clone();
}
FxPool.prototype.emit = function (x, y, z, vx, vy, vz, sizeMul, lifeMul, color) {
  var i = this.head; this.head = (this.head + 1) % this.n;
  var c = this.cfg, r = Math.random();
  this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
  this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
  var L = (c.life[0] + (c.life[1] - c.life[0]) * r) * (lifeMul || 1);
  this.life[i] = L; this.max[i] = L;
  var sm = sizeMul || 1;
  this.s0[i] = c.size[0] * sm * (0.8 + Math.random() * 0.4); this.s1[i] = c.size[1] * sm * (0.8 + Math.random() * 0.4);
  this.spin[i] = Math.random() * 6.28; this.spinV[i] = (Math.random() - 0.5) * c.spin;
  if (color != null) { var cc = LP.color(color); this.base[i * 3] = cc.r; this.base[i * 3 + 1] = cc.g; this.base[i * 3 + 2] = cc.b; }
  else this.base[i * 3] = -1;
};
FxPool.prototype.update = function (dt) {
  var c = this.cfg, n = this.n, drag = Math.exp(-c.drag * dt), g = c.gravity * dt;
  var c0 = this.c0, c1 = this.c1, alive = 0;
  for (var i = 0; i < n; i++) {
    var L = this.life[i];
    if (L <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
    alive++;
    L -= dt; this.life[i] = L;
    var t = 1 - Math.max(L, 0) / this.max[i];
    var i3 = i * 3;
    this.vel[i3] *= drag; this.vel[i3 + 1] = this.vel[i3 + 1] * drag - g; this.vel[i3 + 2] *= drag;
    this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
    if (c.gravity > 0 && this.pos[i3 + 1] < 0.03) { this.pos[i3 + 1] = 0.03; this.vel[i3] *= 0.5; this.vel[i3 + 1] *= -0.25; this.vel[i3 + 2] *= 0.5; }
    this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
    var fadeIn = t < 0.08 ? t / 0.08 : 1;
    this.alpha[i] = c.alpha * fadeIn * (1 - t) * (1 - t * 0.3);
    this.spin[i] += this.spinV[i] * dt;
    if (this.base[i3] >= 0) { this.col[i3] = this.base[i3]; this.col[i3 + 1] = this.base[i3 + 1]; this.col[i3 + 2] = this.base[i3 + 2]; }
    else { this.col[i3] = c0.r + (c1.r - c0.r) * t; this.col[i3 + 1] = c0.g + (c1.g - c0.g) * t; this.col[i3 + 2] = c0.b + (c1.b - c0.b) * t; }
    if (L <= 0) { this.alpha[i] = 0; this.size[i] = 0; }
  }
  this.alive = alive;
  var a = this.geo.attributes;
  a.position.needsUpdate = true; a.pcolor.needsUpdate = true; a.size.needsUpdate = true; a.alpha.needsUpdate = true; a.spin.needsUpdate = true;
};
FxPool.prototype.clear = function () { for (var i = 0; i < this.n; i++) { this.life[i] = 0; this.alpha[i] = 0; this.size[i] = 0; } };
TP.fx = {
  types: FX_TYPES, pools: {},
  /** Register a particle type (call at load time or before first use). cfg like FX_TYPES entries. */
  addType: function (name, cfg) { FX_TYPES[name] = cfg; },
  pool: function (name) {
    var p = TP.fx.pools[name];
    if (!p) { var cfg = FX_TYPES[name]; if (!cfg) return null; p = TP.fx.pools[name] = new FxPool(name, cfg); TP.scene.add(p.points); TP.fx._resize(); }
    return p;
  },
  /** Emit one particle: emit(type, x,y,z, vx,vy,vz, sizeMul?, lifeMul?, colorHex?) — allocation free. */
  emit: function (type, x, y, z, vx, vy, vz, sizeMul, lifeMul, color) { var p = TP.fx.pool(type); if (p) p.emit(x, y, z, vx || 0, vy || 0, vz || 0, sizeMul, lifeMul, color); },
  /** Emit n particles around a point with random spread. o = {spread, speed, up, sizeMul, lifeMul, color, colors:[...]} */
  burst: function (type, x, y, z, n, o) {
    o = o || {}; var p = TP.fx.pool(type); if (!p) return;
    var sp = o.spread || 0.3, v = o.speed || 2, up = o.up != null ? o.up : 1;
    for (var i = 0; i < n; i++) {
      var col = o.colors ? o.colors[(Math.random() * o.colors.length) | 0] : o.color;
      p.emit(x + (Math.random() - 0.5) * sp, y + (Math.random() - 0.5) * sp, z + (Math.random() - 0.5) * sp,
        (Math.random() - 0.5) * v * 2 + (o.vx || 0), Math.random() * v * up + (o.vy || 0), (Math.random() - 0.5) * v * 2 + (o.vz || 0), o.sizeMul, o.lifeMul, col);
    }
  },
  update: function (dt) { for (var k in TP.fx.pools) TP.fx.pools[k].update(dt); },
  clear: function () { for (var k in TP.fx.pools) TP.fx.pools[k].clear(); },
  count: function () { var n = 0; for (var k in TP.fx.pools) n += TP.fx.pools[k].alive; return n; },
  _resize: function () {
    if (!TP.renderer) return;
    var h = TP.renderer.domElement.height;
    var s = h / (2 * Math.tan(TP.camera.fov * Math.PI / 360));
    for (var k in TP.fx.pools) TP.fx.pools[k].mat.uniforms.scale.value = s;
  }
};

/* ---------------------------------------------------------------------------
 * 13. AUDIO  TP.audio — WebAudio synthesis; starts only after a user gesture
 * ------------------------------------------------------------------------- */
var AU = TP.audio = { ctx: null, ready: false, master: null, voices: [], crowdLevel: 0.25, _crowd: null };
AU.init = function () {
  if (AU.ctx) { if (AU.ctx.state === 'suspended') { try { AU.ctx.resume(); } catch (e) {} } return true; }
  try {
    var AC = W.AudioContext || W.webkitAudioContext; if (!AC) return false;
    var ctx = AU.ctx = new AC();
    AU.master = ctx.createGain(); AU.master.gain.value = TP.save.settings.sound ? TP.save.settings.volume : 0;
    var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    AU.master.connect(comp); comp.connect(ctx.destination);
    // shared noise buffer
    var len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    AU.noise = buf;
    AU.ready = true;
    AU.startCrowd();
    TP.emit('audioReady');
    return true;
  } catch (e) { console.warn('[TP] audio unavailable', e); AU.ready = false; return false; }
};
AU.setMuted = function (m) { if (AU.master) AU.master.gain.setTargetAtTime(m ? 0 : TP.save.settings.volume, AU.ctx.currentTime, 0.05); };
function noiseSrc() { var s = AU.ctx.createBufferSource(); s.buffer = AU.noise; s.loop = true; return s; }
AU.startCrowd = function () {
  if (!AU.ready || AU._crowd) return;
  try {
    var ctx = AU.ctx, n = noiseSrc(), bp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.5; lp.type = 'lowpass'; lp.frequency.value = 2400;
    g.gain.value = 0;
    n.connect(bp); bp.connect(lp); lp.connect(g); g.connect(AU.master); n.start();
    // a second, lower murmur band
    var n2 = noiseSrc(), bp2 = ctx.createBiquadFilter(), g2 = ctx.createGain();
    bp2.type = 'bandpass'; bp2.frequency.value = 380; bp2.Q.value = 0.8; g2.gain.value = 0;
    n2.connect(bp2); bp2.connect(g2); g2.connect(AU.master); n2.start();
    AU._crowd = { g: g, g2: g2, bp: bp, cheer: 0 };
  } catch (e) { console.warn(e); }
};
/** Crowd base level 0..1 */
AU.crowd = function (level) { AU.crowdLevel = clamp(level, 0, 1); };
/** Cheer swell 0..1 (decays) */
AU.cheer = function (amount) { if (AU._crowd) AU._crowd.cheer = Math.min(1.5, AU._crowd.cheer + (amount == null ? 1 : amount)); };
AU.update = function (dt) {
  if (!AU.ready || !AU._crowd) return;
  var c = AU._crowd, t = AU.ctx.currentTime;
  c.cheer = Math.max(0, c.cheer - dt * 0.35);
  var lvl = AU.crowdLevel * 0.05 + c.cheer * 0.13;
  c.g.gain.setTargetAtTime(lvl, t, 0.15);
  c.g2.gain.setTargetAtTime(AU.crowdLevel * 0.06 + c.cheer * 0.05, t, 0.2);
  c.bp.frequency.setTargetAtTime(800 + c.cheer * 500, t, 0.2);
};
/** Engine voice for a vehicle. Returns {update(rpmNorm 0..1, throttle, load 0..1, boost 0..1, extra), stop()}.
 *  engine = vehicle.engine: {type, count, cyl, turbo, whistle, pitch, rough, blower, volume}. */
AU.engine = function (engine) {
  var dummy = { update: function () {}, stop: function () {}, pop: function () {} };
  if (!AU.ready) return dummy;
  try {
    var ctx = AU.ctx, e = engine || {}, type = e.type || 'diesel', count = Math.max(1, Math.min(4, e.count || 1));
    var out = ctx.createGain(); out.gain.value = 0; out.connect(AU.master);
    var shaper = ctx.createWaveShaper(), curve = new Float32Array(256);
    var drive = type === 'gas' || type === 'multi' ? 3.2 : 2.2;
    for (var i = 0; i < 256; i++) { var x = i / 128 - 1; curve[i] = Math.tanh(x * drive); }
    shaper.curve = curve;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 1.2;
    shaper.connect(lp); lp.connect(out);
    var oscs = [];
    var cyl = e.cyl || (type === 'diesel' ? 6 : 8);
    for (var k = 0; k < count; k++) {
      var o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      var o2 = ctx.createOscillator(); o2.type = 'square';
      var g1 = ctx.createGain(); g1.gain.value = 0.32 / Math.sqrt(count);
      var g2 = ctx.createGain(); g2.gain.value = (type === 'gas' || type === 'multi' ? 0.22 : 0.12) / Math.sqrt(count);
      o1.connect(g1); o2.connect(g2); g1.connect(shaper); g2.connect(shaper);
      o1.start(); o2.start();
      oscs.push({ o1: o1, o2: o2, detune: 1 + (k - (count - 1) / 2) * 0.013 });
    }
    // diesel clatter: band-passed noise gated at firing frequency
    var clat = null;
    if (type === 'diesel') {
      var ns = noiseSrc(), bp = ctx.createBiquadFilter(), cg = ctx.createGain(), lfo = ctx.createOscillator(), lfoG = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.4; cg.gain.value = 0;
      lfo.type = 'square'; lfoG.gain.value = 0.5; lfo.connect(lfoG); lfoG.connect(cg.gain);
      ns.connect(bp); bp.connect(cg); cg.connect(out); ns.start(); lfo.start();
      clat = { lfo: lfo, cg: cg, lfoG: lfoG };
    }
    // turbo whistle / blower whine / turbine scream
    var wh = null;
    if (e.turbo || type === 'methanol' || type === 'turbine' || e.blower || type === 'diesel') {
      var wo = ctx.createOscillator(); wo.type = type === 'turbine' ? 'triangle' : 'sine';
      var wg = ctx.createGain(); wg.gain.value = 0; wo.connect(wg); wg.connect(out); wo.start();
      var wn = noiseSrc(), wbp = ctx.createBiquadFilter(), wng = ctx.createGain(); wbp.type = 'bandpass'; wbp.frequency.value = 3500; wbp.Q.value = 2; wng.gain.value = 0;
      wn.connect(wbp); wbp.connect(wng); wng.connect(out); wn.start();
      wh = { o: wo, g: wg, ng: wng, bp: wbp, base: type === 'turbine' ? 2800 : (e.blower ? 900 : 1600), amt: (e.whistle != null ? e.whistle : 0.7) };
    }
    var pitch = e.pitch || 1, vol = (e.volume || 1) * 0.9, rough = e.rough != null ? e.rough : 0.5;
    var lastRpm = 0;
    var v = {
      update: function (rpmN, throttle, load, boost, extra) {
        var t = ctx.currentTime;
        rpmN = clamp(rpmN, 0, 1.15);
        var idleHz = type === 'turbine' ? 60 : (type === 'diesel' ? 26 : 34);
        var topHz = type === 'turbine' ? 160 : (type === 'diesel' ? 115 : (type === 'gas' || type === 'multi' ? 230 : 190));
        var f = (idleHz + (topHz - idleHz) * rpmN) * pitch * (cyl / 8);
        if (type === 'turbine') f *= 0.5;
        for (var j = 0; j < oscs.length; j++) {
          var od = oscs[j], jitter = 1 + (Math.random() - 0.5) * 0.02 * rough;
          od.o1.frequency.setTargetAtTime(f * od.detune * jitter, t, 0.03);
          od.o2.frequency.setTargetAtTime(f * 0.5 * od.detune, t, 0.03);
        }
        lp.frequency.setTargetAtTime(380 + 2600 * clamp(throttle * 0.7 + rpmN * 0.5, 0, 1.3), t, 0.05);
        var g = vol * (0.18 + 0.5 * throttle + 0.25 * rpmN) * (extra && extra.limiter ? (Math.random() < 0.5 ? 0.6 : 1) : 1);
        out.gain.setTargetAtTime(g, t, 0.04);
        if (clat) { clat.lfo.frequency.setTargetAtTime(f * 0.5, t, 0.03); clat.cg.gain.setTargetAtTime(0.12 * (0.5 + throttle) * rough, t, 0.05); clat.lfoG.gain.setTargetAtTime(0.12 * (0.5 + throttle) * rough, t, 0.05); }
        if (wh) {
          var b = clamp(boost, 0, 1.4);
          wh.o.frequency.setTargetAtTime(wh.base + (type === 'turbine' ? 5200 : 4200) * b * (0.6 + 0.4 * rpmN), t, 0.08);
          wh.g.gain.setTargetAtTime(0.045 * wh.amt * b * b, t, 0.08);
          wh.ng.gain.setTargetAtTime(0.05 * wh.amt * b, t, 0.1);
          wh.bp.frequency.setTargetAtTime(2500 + 3000 * b, t, 0.1);
        }
        lastRpm = rpmN;
      },
      stop: function () {
        try {
          out.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
          setTimeout(function () { try { oscs.forEach(function (o) { o.o1.stop(); o.o2.stop(); }); if (clat) clat.lfo.stop(); if (wh) wh.o.stop(); out.disconnect(); } catch (e) {} }, 400);
        } catch (e) {}
      }
    };
    AU.voices.push(v);
    return v;
  } catch (err) { console.warn('[TP] engine audio failed', err); return dummy; }
};
/** One-shot effects: 'hook','shift','bang','horn','chime','click','pop','light','go','whoosh','coin','thud'. */
AU.sfx = function (name, o) {
  if (!AU.ready) return;
  o = o || {};
  try {
    var ctx = AU.ctx, t = ctx.currentTime, g = ctx.createGain(); g.connect(AU.master);
    var vol = o.volume != null ? o.volume : 1;
    var tone = function (type, f0, f1, dur, v, delay) {
      var os = ctx.createOscillator(), gg = ctx.createGain(); os.type = type;
      var st = t + (delay || 0);
      os.frequency.setValueAtTime(f0, st); if (f1) os.frequency.exponentialRampToValueAtTime(Math.max(1, f1), st + dur);
      gg.gain.setValueAtTime(0.0001, st); gg.gain.exponentialRampToValueAtTime(v * vol, st + 0.01); gg.gain.exponentialRampToValueAtTime(0.0001, st + dur);
      os.connect(gg); gg.connect(g); os.start(st); os.stop(st + dur + 0.05);
    };
    var noise = function (dur, v, ftype, freq, q, delay) {
      var s = noiseSrc(), f = ctx.createBiquadFilter(), gg = ctx.createGain(), st = t + (delay || 0);
      f.type = ftype || 'lowpass'; f.frequency.value = freq || 800; f.Q.value = q || 0.7;
      gg.gain.setValueAtTime(v * vol, st); gg.gain.exponentialRampToValueAtTime(0.0001, st + dur);
      s.connect(f); f.connect(gg); gg.connect(g); s.start(st); s.stop(st + dur + 0.05);
    };
    switch (name) {
      case 'hook': tone('square', 900, 700, 0.12, 0.08); tone('triangle', 1800, 1500, 0.2, 0.06, 0.02); noise(0.15, 0.25, 'highpass', 2500, 1); break;
      case 'shift': noise(0.18, 0.35, 'bandpass', 1800, 0.8); tone('square', 120, 60, 0.12, 0.12); break;
      case 'bang': noise(0.9, 1.0, 'lowpass', 600, 0.5); tone('sine', 90, 30, 0.6, 0.9); noise(0.4, 0.5, 'highpass', 1500, 0.5, 0.05); break;
      case 'pop': noise(0.12, 0.6, 'lowpass', 1200, 1); tone('sine', 160, 50, 0.1, 0.3); break;
      case 'horn': [233, 294, 349].forEach(function (f) { tone('sawtooth', f, f * 0.995, 1.3, 0.09); }); break;
      case 'chime': tone('sine', 988, 0, 0.5, 0.18); tone('sine', 740, 0, 0.7, 0.18, 0.22); break;
      case 'click': tone('square', 1400, 900, 0.04, 0.05); break;
      case 'light': tone('square', 660, 0, 0.14, 0.07); break;
      case 'go': tone('square', 1320, 0, 0.35, 0.08); break;
      case 'whoosh': noise(0.6, 0.25, 'bandpass', 900, 0.6); break;
      case 'coin': tone('square', 988, 0, 0.08, 0.07); tone('square', 1319, 0, 0.25, 0.07, 0.08); break;
      case 'thud': tone('sine', 70, 40, 0.3, 0.5); noise(0.2, 0.3, 'lowpass', 300); break;
      default: tone('sine', 600, 300, 0.2, 0.1);
    }
    setTimeout(function () { try { g.disconnect(); } catch (e) {} }, 2500);
  } catch (e) { /* audio is optional */ }
};

/* ---------------------------------------------------------------------------
 * 14. INPUT  TP.input — keyboard + multi-touch pointer controls (bound at boot)
 * ------------------------------------------------------------------------- */
var IN = TP.input = { throttle: 0, steer: 0, shiftHeld: false, boostHeld: false, _shiftTap: false, _boostTap: false, keys: {},
  pedal: 0, steerL: false, steerR: false, usingTouch: false, enabled: false };
IN.consumeShift = function () { var s = IN.shiftHeld || IN._shiftTap; IN._shiftTap = false; return s; };
IN.consumeBoost = function () { var b = IN.boostHeld || IN._boostTap; IN._boostTap = false; return b; };
IN.reset = function () { IN.throttle = 0; IN.steer = 0; IN.pedal = 0; IN.steerL = IN.steerR = false; IN.shiftHeld = IN.boostHeld = false; IN._shiftTap = IN._boostTap = false; IN.keys = {}; IN.kbThrottle = 0; };
IN.kbThrottle = 0;
function pollInput(dt) {
  var k = IN.keys;
  var up = k.KeyW || k.ArrowUp, dn = k.KeyS || k.ArrowDown;
  if (up) IN.kbThrottle = Math.min(1, IN.kbThrottle + dt * 3.2);
  else IN.kbThrottle = Math.max(0, IN.kbThrottle - dt * (dn ? 4 : 2.4));
  IN.throttle = Math.max(IN.kbThrottle, IN.pedal);
  var l = k.KeyA || k.ArrowLeft || IN.steerL, r = k.KeyD || k.ArrowRight || IN.steerR;
  IN.steer = (r ? 1 : 0) - (l ? 1 : 0);
}
function bindInput() {
  W.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    var code = e.code;
    if (!IN.keys[code]) {
      if (code === 'Space') { IN._shiftTap = true; IN.shiftHeld = true; }
      if (code === 'ShiftLeft' || code === 'ShiftRight') { IN._boostTap = true; IN.boostHeld = true; }
      if (code === 'Escape' || code === 'KeyP') TP.emit('pauseKey');
      if (code === 'KeyC') TP.emit('cameraKey');
    }
    IN.keys[code] = true;
    if (R3.pullUpdate && /Space|Arrow/.test(code)) e.preventDefault();
    AU.init();
  });
  W.addEventListener('keyup', function (e) {
    var code = e.code; IN.keys[code] = false;
    if (code === 'Space') IN.shiftHeld = false;
    if (code === 'ShiftLeft' || code === 'ShiftRight') IN.boostHeld = false;
  });
  W.addEventListener('blur', function () { IN.keys = {}; IN.pedal = 0; IN.steerL = IN.steerR = false; IN.shiftHeld = IN.boostHeld = false; });
  // first gesture starts audio
  var unlock = function () { AU.init(); };
  W.addEventListener('pointerdown', unlock, { passive: true });
  W.addEventListener('touchstart', function () { if (!IN.usingTouch) { IN.usingTouch = true; document.documentElement.classList.add('touch'); } }, { passive: true });
  // on-screen controls (multi-touch via pointer capture: each control tracks its own pointers)
  var pedal = document.getElementById('pedal');
  if (pedal) {
    var pedalPtrs = {};
    var setPedal = function (e) {
      var r = pedal.getBoundingClientRect();
      IN.pedal = clamp(1 - (e.clientY - r.top - r.height * 0.06) / (r.height * 0.88), 0, 1);
    };
    pedal.addEventListener('pointerdown', function (e) { e.preventDefault(); pedalPtrs[e.pointerId] = true; try { pedal.setPointerCapture(e.pointerId); } catch (x) {} setPedal(e); pedal.classList.add('on'); });
    pedal.addEventListener('pointermove', function (e) { if (pedalPtrs[e.pointerId]) setPedal(e); });
    var pedalUp = function (e) { if (!pedalPtrs[e.pointerId]) return; delete pedalPtrs[e.pointerId]; if (!Object.keys(pedalPtrs).length) { IN.pedal = 0; pedal.classList.remove('on'); } };
    pedal.addEventListener('pointerup', pedalUp); pedal.addEventListener('pointercancel', pedalUp); pedal.addEventListener('lostpointercapture', pedalUp);
  }
  var hold = function (id, on, off) {
    var el = document.getElementById(id); if (!el) return;
    var ptrs = {};
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); ptrs[e.pointerId] = 1; try { el.setPointerCapture(e.pointerId); } catch (x) {} el.classList.add('on'); on(); });
    var up = function (e) { if (!ptrs[e.pointerId]) return; delete ptrs[e.pointerId]; if (!Object.keys(ptrs).length) { el.classList.remove('on'); off(); } };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };
  hold('btnLeft', function () { IN.steerL = true; }, function () { IN.steerL = false; });
  hold('btnRight', function () { IN.steerR = true; }, function () { IN.steerR = false; });
  hold('btnShift', function () { IN._shiftTap = true; IN.shiftHeld = true; }, function () { IN.shiftHeld = false; });
  hold('btnBoost', function () { IN._boostTap = true; IN.boostHeld = true; }, function () { IN.boostHeld = false; });
  var game = document.getElementById('game');
  ['touchstart', 'touchmove'].forEach(function (ev) { (document.getElementById('controls') || game).addEventListener(ev, function (e) { if (R3.pullUpdate) e.preventDefault(); }, { passive: false }); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { TP.emit('hidden'); if (AU.ctx && AU.ready) { try { AU.ctx.suspend(); } catch (e) {} } }
    else if (AU.ctx && AU.ready) { try { AU.ctx.resume(); } catch (e) {} }
  });
  IN.enabled = true;
}


/* ---------------------------------------------------------------------------
 * 15. MODELS  TP.models — base low-poly vehicles + the weight-transfer sled.
 *   Vehicle convention: root origin on the ground under the REAR axle, facing +X,
 *   +Z = driver's right. build() returns {root, wheels:{front,rear}, stacks, hitch,
 *   body, frontEnd, radius:{front,rear}}. Wheels are Object3Ds whose rotation.z the
 *   renderer spins (rolling forward = negative z rotation).
 * ------------------------------------------------------------------------- */
var MD = TP.models = {};
function hexNum(c, d) { if (typeof c === 'number') return c; if (!c) return d; try { return new THREE.Color(c).getHex(); } catch (e) { return d; } }
MD.hex = hexNum;
/** Shade a hex color: f < 1 darker, > 1 lighter. */
MD.shade = function (c, f) { var col = new THREE.Color(hexNum(c, 0x888888)); if (f < 1) col.multiplyScalar(f); else col.lerp(new THREE.Color(1, 1, 1), f - 1); return col.getHex(); };
/** A wheel pivot group with a lugged tire. side = -1 (left, -Z) | 1 (right). Returns the pivot (spin it on Z). */
MD.wheel = function (radius, width, o) {
  o = o || {};
  var piv = new THREE.Group();
  var m = LP.mesh(LP.tire(radius, width, o), { shadow: true });
  piv.add(m);
  piv.userData.radius = radius;
  return piv;
};
/** Vertical exhaust stack with a bevel-cut tip. Returns {geo, tip:Object3D(position at the outlet)}. */
MD.stack = function (parent, x, y, z, h, r, color, o) {
  o = o || {};
  var b = LP.builder();
  b.cyl(r, r, h, 8, color, { y: h / 2 });
  b.cyl(r * 1.25, r * 1.25, h * 0.08, 8, color, { y: h * 0.12 });
  b.cyl(r * 1.08, r, h * 0.06, 8, MD.shade(color, 0.6), { y: h - h * 0.03 });
  var m = b.mesh({ shadow: true });
  m.position.set(x, y, z); if (o.rz) m.rotation.z = o.rz; if (o.rx) m.rotation.x = o.rx;
  parent.add(m);
  var tip = new THREE.Object3D(); tip.position.set(0, h, 0); m.add(tip);
  return tip;
};
function sideDecals(parent, lv, texOpts, w, h, x, y, zHalf) {
  var a = LP.decal(LP.liveryTexture(lv, texOpts), w, h, { x: x, y: y, z: zHalf + 0.012 });
  var o2 = shallow(texOpts); o2.mirror = true;
  var b = LP.decal(LP.liveryTexture(lv, o2), w, h, { x: x, y: y, z: -zHalf - 0.012, face: '-z' });
  parent.add(a, b);
  return [a, b];
}
MD.sideDecals = sideDecals;

/** Stock-look 4x4 diesel pickup (Street / Work / Pro Stock base). veh.modelOpts can tweak {stacks, flares, lift}. */
MD.pickup = function (livery, veh) {
  var lv = TP.liveryFor(veh && veh.id, livery), P = TP.palette, mo = (veh && veh.modelOpts) || {};
  var base = hexNum(lv.base, 0x2459a8), acc = hexNum(lv.accent, 0xf3efe6), trim = hexNum(lv.trim, 0x17140f);
  var wb = (veh && veh.specs && veh.specs.wheelbase) || 3.9, R = (veh && veh.specs && veh.specs.wheelRadius) || 0.56;
  var root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  var lift = mo.lift != null ? mo.lift : 0.28, fy = R + lift;    // frame height
  var b = LP.builder();
  // frame + bumpers + hitch receiver
  b.box(wb + 2.4, 0.18, 0.9, P.steelDark, { x: wb / 2 - 0.2, y: fy - 0.05 });
  b.box(0.25, 0.28, 2.0, P.chrome, { x: wb + 1.2, y: fy + 0.05 });
  b.box(0.2, 0.25, 1.9, trim, { x: -1.55, y: fy + 0.05 });
  // bed
  var bedL = 2.3, bedX = -0.45;
  b.box(bedL, 0.62, 2.0, base, { x: bedX, y: fy + 0.5 });
  b.box(bedL, 0.08, 1.96, MD.shade(base, 1.12), { x: bedX, y: fy + 0.84 });
  b.box(0.1, 0.62, 2.0, base, { x: bedX - bedL / 2 + 0.05, y: fy + 0.5 });
  // cab
  b.cab(1.9, 1.3, 2.0, base, { x: 1.62, y: fy + 0.2, taperX: 0.72, taperZ: 0.9 });
  // hood + fenders + grille
  b.taper(1.6, 0.6, 2.0, 1.0, 0.94, base, { x: 3.35, y: fy + 0.55 });
  b.box(0.18, 0.66, 1.95, MD.shade(trim, 1.15), { x: 4.2, y: fy + 0.52 });
  for (var gy = 0; gy < 3; gy++) b.box(0.05, 0.08, 1.5, P.chrome, { x: 4.3, y: fy + 0.35 + gy * 0.17 });
  b.box(0.06, 0.16, 0.36, 0xfff6c8, { x: 4.3, y: fy + 0.68, z: 0.78 }).box(0.06, 0.16, 0.36, 0xfff6c8, { x: 4.3, y: fy + 0.68, z: -0.78 });
  b.box(0.24, 0.7, 0.18, P.chrome, { x: 4.28, y: fy + 0.5 });
  // flares + running boards + mirrors + light bar
  [0, wb].forEach(function (ax) { [-1, 1].forEach(function (s) { b.taper(1.5, 0.28, 0.22, 0.75, 1, trim, { x: ax, y: fy + 0.25, z: s * 1.06 }); }); });
  [-1, 1].forEach(function (s) { b.box(1.7, 0.06, 0.24, P.steelDark, { x: 1.7, y: fy + 0.05, z: s * 1.06 }); b.box(0.1, 0.3, 0.26, trim, { x: 2.2, y: fy + 1.1, z: s * 1.14 }); });
  b.box(0.2, 0.12, 1.5, trim, { x: 1.9, y: fy + 1.55 });
  for (var l = 0; l < 5; l++) b.box(0.05, 0.08, 0.2, 0xfff2b0, { x: 2.0, y: fy + 1.55, z: -0.6 + l * 0.3 });
  // tail lights
  b.box(0.04, 0.3, 0.12, 0xd23a2a, { x: -1.62, y: fy + 0.55, z: 0.92 }).box(0.04, 0.3, 0.12, 0xd23a2a, { x: -1.62, y: fy + 0.55, z: -0.92 });
  // front weight bracket with suitcase weights (pulling truck)
  b.box(0.5, 0.12, 0.9, P.steelDark, { x: wb + 1.5, y: fy - 0.05 });
  for (var wgt = 0; wgt < 4; wgt++) b.box(0.12, 0.42, 0.85, wgt % 2 ? acc : P.steel, { x: wb + 1.42 + wgt * 0.14, y: fy + 0.18 });
  // axles / diffs
  b.cyl(0.08, 0.08, 1.9, 6, P.steelDark, { axis: 'z', y: R }).cyl(0.08, 0.08, 1.9, 6, P.steelDark, { axis: 'z', x: wb, y: R });
  b.sphere(0.2, P.steelDark, { y: R }).sphere(0.18, P.steelDark, { x: wb, y: R });
  body.add(b.mesh({ shadow: true }));
  // livery decals
  sideDecals(body, lv, { brand: veh && veh.brand, w: 512, h: 128, numberX: 0.42 }, 4.4, 1.1, 1.3, fy + 0.62, 1.0);
  var hood = LP.decal(LP.numberTexture(lv.number || '1', { bg: lv.numberBg || '#f3efe6' }), 0.7, 0.7, { face: 'up', x: 3.4, y: fy + 0.86 });
  body.add(hood);
  // stacks through the bed
  var stacks = [], sc = mo.stacks || 2;
  for (var i = 0; i < sc; i++) {
    var z = sc === 1 ? 0 : (i / (sc - 1) - 0.5) * 1.1;
    stacks.push(MD.stack(body, 0.05, fy + 0.3, z, 2.2, 0.1, P.chrome));
  }
  // turbo behind the hood (stock look) — a hint of chrome
  var tb = LP.builder().cyl(0.16, 0.16, 0.2, 8, P.chrome, { axis: 'z' }).mesh(); tb.position.set(3.8, fy + 0.95, 0.3); body.add(tb);
  // hitch
  var hitch = new THREE.Object3D(); hitch.position.set(-1.75, (veh && veh.specs && veh.specs.hitchHeight) || 0.62, 0); root.add(hitch);
  var hb = LP.builder().box(0.5, 0.12, 0.12, P.steelDark, { x: -1.55, y: hitch.position.y }).cyl(0.06, 0.06, 0.04, 8, P.steel, { x: -1.78, y: hitch.position.y, axis: 'x' }).mesh();
  body.add(hb);
  var wheels = { front: [], rear: [] };
  [-1, 1].forEach(function (s) {
    var o = { lugs: 16, lugDepth: 0.07, seg: 16, rimColor: lv.rim || P.chrome };
    var r1 = MD.wheel(R, 0.42, o); r1.position.set(0, R, s * 0.92); root.add(r1); wheels.rear.push(r1);
    var f1 = MD.wheel(R, 0.42, o); f1.position.set(wb, R, s * 0.92); root.add(f1); wheels.front.push(f1);
  });
  return { root: root, body: body, wheels: wheels, stacks: stacks, hitch: hitch, frontEnd: null, radius: { front: R, rear: R }, length: wb + 3.4 };
};

/** Farm tractor (Farm Stock / Hot Farm base): huge ag tires, long hood, ROPS, suitcase weights. */
MD.tractor = function (livery, veh) {
  var lv = TP.liveryFor(veh && veh.id, livery), P = TP.palette, mo = (veh && veh.modelOpts) || {};
  var base = hexNum(lv.base, 0x2e7d32), acc = hexNum(lv.accent, 0xffd23f), trim = hexNum(lv.trim, 0x1a1a1a);
  var s = (veh && veh.specs) || {}, wb = s.wheelbase || 2.9, R = s.wheelRadius || 0.92, Rf = mo.frontRadius || 0.46;
  var root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  var b = LP.builder();
  // transmission / rear housing
  b.box(1.2, 0.9, 1.0, MD.shade(base, 0.8), { x: 0.1, y: R + 0.1 });
  b.cyl(0.12, 0.12, 2.3, 8, P.steelDark, { axis: 'z', y: R });
  // engine block + hood
  b.box(2.4, 0.7, 0.8, P.steelDark, { x: 1.6, y: R + 0.15 });
  b.taper(2.6, 0.75, 1.0, 1.0, 0.86, base, { x: 1.75, y: R + 0.75 });
  b.box(0.2, 0.85, 1.0, trim, { x: 3.1, y: R + 0.55 });
  for (var gy = 0; gy < 4; gy++) b.box(0.04, 0.06, 0.8, P.steel, { x: 3.21, y: R + 0.25 + gy * 0.17 });
  b.box(2.5, 0.1, 0.12, acc, { x: 1.8, y: R + 0.85, z: 0.5 }).box(2.5, 0.1, 0.12, acc, { x: 1.8, y: R + 0.85, z: -0.5 });
  // front axle + bolster
  b.box(0.3, 0.3, 1.8, P.steelDark, { x: wb, y: Rf + 0.05 });
  b.box(0.6, 0.45, 0.5, P.steelDark, { x: wb, y: Rf + 0.35 });
  // weight bracket with suitcase weights
  b.box(0.6, 0.2, 1.0, P.steelDark, { x: wb + 0.55, y: R * 0.85 });
  for (var w = 0; w < 6; w++) b.box(0.1, 0.55, 0.95, w % 2 ? acc : MD.shade(base, 0.9), { x: wb + 0.32 + w * 0.12, y: R * 0.85 + 0.35 });
  // operator platform, seat, steering wheel, fenders
  b.box(1.0, 0.08, 1.4, P.steelDark, { x: -0.45, y: R + 0.55 });
  b.box(0.45, 0.12, 0.5, 0x2a2a2a, { x: -0.5, y: R + 0.85 }).box(0.1, 0.55, 0.5, 0x2a2a2a, { x: -0.75, y: R + 1.1 });
  b.cyl(0.04, 0.04, 0.7, 6, P.steelDark, { x: 0.1, y: R + 1.0, rz: 0.6 });
  b.cyl(0.22, 0.22, 0.04, 10, 0x1a1a1a, { x: -0.12, y: R + 1.32, rz: 0.6 });
  [-1, 1].forEach(function (sd) {
    b.taper(1.9, 0.12, 0.7, 0.9, 1, base, { x: 0, y: R * 2 + 0.06, z: sd * 1.0 });
    b.box(1.9, 0.5, 0.08, base, { x: 0, y: R * 1.8 + 0.06, z: sd * 0.66, rx: 0 });
    b.box(0.08, 0.5, 0.7, base, { x: 0.92, y: R * 1.75, z: sd * 1.0 });
  });
  // ROPS (roll bar) with canopy
  [-1, 1].forEach(function (sd) { b.box(0.1, 1.6, 0.1, P.steelDark, { x: -0.95, y: R + 1.2, z: sd * 0.62 }); b.box(0.1, 1.5, 0.1, P.steelDark, { x: 0.15, y: R + 1.25, z: sd * 0.62 }); });
  b.box(1.4, 0.1, 1.5, base, { x: -0.4, y: R + 2.05 });
  b.box(1.2, 0.08, 0.1, P.steelDark, { x: -0.4, y: R + 1.97, z: 0.62 });
  // drawbar
  b.box(1.0, 0.1, 0.18, P.steel, { x: -0.65, y: (s.hitchHeight || 0.55) });
  body.add(b.mesh({ shadow: true }));
  sideDecals(body, lv, { brand: veh && veh.brand, w: 512, h: 128, numberX: 0.72 }, 2.6, 0.65, 1.75, R + 0.78, 0.47);
  var stacks = [MD.stack(body, 1.25, R + 1.0, 0, mo.stackH || 1.6, 0.09, P.chrome)];
  if (mo.twinStacks) stacks.push(MD.stack(body, 1.25, R + 1.0, 0.25, mo.stackH || 1.6, 0.09, P.chrome));
  var hitch = new THREE.Object3D(); hitch.position.set(-1.15, s.hitchHeight || 0.55, 0); root.add(hitch);
  var wheels = { front: [], rear: [] };
  [-1, 1].forEach(function (sd) {
    var r1 = MD.wheel(R, 0.62, { lugs: 14, lugDepth: 0.1, seg: 18, chevron: true, rimColor: lv.rim || acc, rim: R * 0.6 }); r1.position.set(0, R, sd * 1.0); root.add(r1); wheels.rear.push(r1);
    var f1 = MD.wheel(Rf, 0.28, { lugs: 10, lugDepth: 0.04, seg: 14, rimColor: lv.rim || acc }); f1.position.set(wb, Rf, sd * 0.8); root.add(f1); wheels.front.push(f1);
  });
  return { root: root, body: body, wheels: wheels, stacks: stacks, hitch: hitch, frontEnd: null, radius: { front: Rf, rear: R }, length: wb + 2 };
};

/** Mini rod: tiny tube chassis, blown V8 with zoomie stacks, wheelie bars. */
MD.miniRod = function (livery, veh) {
  var lv = TP.liveryFor(veh && veh.id, livery), P = TP.palette;
  var base = hexNum(lv.base, 0xff6a1a), acc = hexNum(lv.accent, 0xffd23f), trim = hexNum(lv.trim, 0x17140f);
  var s = (veh && veh.specs) || {}, wb = s.wheelbase || 2.3, R = s.wheelRadius || 0.62, Rf = 0.3;
  var root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  var b = LP.builder();
  // chassis rails
  [-1, 1].forEach(function (sd) { b.box(wb + 1.2, 0.1, 0.1, P.steelDark, { x: wb / 2 - 0.1, y: 0.45, z: sd * 0.32 }); });
  b.box(0.3, 0.3, 1.5, P.steelDark, { x: 0, y: R });
  // body tub + nose
  b.taper(1.6, 0.45, 0.8, 0.85, 0.85, base, { x: 1.35, y: 0.72 });
  b.wedge(0.8, 0.4, 0.75, base, { x: 2.5, y: 0.6, slope: 0.6 });
  b.box(0.2, 0.18, 1.2, trim, { x: wb + 0.35, y: Rf + 0.05 });
  // blown big block
  b.box(0.9, 0.55, 0.6, P.chrome, { x: 1.2, y: 1.15 });
  b.box(0.75, 0.32, 0.45, base, { x: 1.2, y: 1.58 });          // blower case
  b.box(0.5, 0.2, 0.55, P.chrome, { x: 1.2, y: 1.85 });         // hat
  for (var i = 0; i < 6; i++) b.box(0.03, 0.3, 0.42, P.steelDark, { x: 0.98 + i * 0.09, y: 1.58 });
  // seat + cage
  b.box(0.5, 0.14, 0.5, 0x222222, { x: 0.15, y: 0.75 }).box(0.12, 0.6, 0.5, 0x222222, { x: -0.12, y: 1.0 });
  [-1, 1].forEach(function (sd) {
    b.box(0.06, 1.0, 0.06, acc, { x: -0.2, y: 1.15, z: sd * 0.35 });
    b.box(0.06, 0.9, 0.06, acc, { x: 0.55, y: 1.1, z: sd * 0.35, rz: 0.35 });
    // wheelie bars
    b.box(1.6, 0.05, 0.05, P.steel, { x: -1.15, y: 0.42, z: sd * 0.3, rz: 0.08 });
  });
  b.box(0.8, 0.06, 0.76, acc, { x: 0.15, y: 1.66 });
  b.box(0.08, 0.08, 0.8, P.steel, { x: -1.9, y: 0.32 });
  // fenders
  [-1, 1].forEach(function (sd) { b.taper(1.3, 0.1, 0.55, 0.8, 1, base, { x: 0, y: R * 2 + 0.06, z: sd * 0.82 }); });
  body.add(b.mesh({ shadow: true }));
  // wheelie bar wheels
  [-1, 1].forEach(function (sd) { var ww = LP.mesh(LP.tire(0.1, 0.06, { lugs: 6, seg: 8 })); ww.position.set(-1.95, 0.1, sd * 0.3); body.add(ww); });
  sideDecals(body, lv, { brand: veh && veh.brand, w: 512, h: 128, numberX: 0.4 }, 1.9, 0.48, 1.6, 0.74, 0.37);
  var stacks = [];
  [-1, 1].forEach(function (sd) { for (var k = 0; k < 4; k++) stacks.push(MD.stack(body, 0.95 + k * 0.17, 1.15, sd * 0.33, 0.45, 0.05, P.chrome, { rx: sd * 0.7 })); });
  var hitch = new THREE.Object3D(); hitch.position.set(-0.85, s.hitchHeight || 0.5, 0); root.add(hitch);
  var wheels = { front: [], rear: [] };
  [-1, 1].forEach(function (sd) {
    var r1 = MD.wheel(R, 0.5, { lugs: 20, lugDepth: 0.06, seg: 18, chevron: true, rimColor: lv.rim || P.chrome }); r1.position.set(0, R, sd * 0.82); root.add(r1); wheels.rear.push(r1);
    var f1 = MD.wheel(Rf, 0.14, { lugs: 8, lugDepth: 0.02, seg: 12, rimColor: P.chrome }); f1.position.set(wb, Rf, sd * 0.55); root.add(f1); wheels.front.push(f1);
  });
  return { root: root, body: body, wheels: wheels, stacks: stacks, hitch: hitch, frontEnd: null, radius: { front: Rf, rear: R }, length: wb + 2.3 };
};

/** The weight-transfer sled. Origin = the hook at the FRONT of the sled; the sled extends toward -X.
 *  Returns {root, box (slides), boxFront, boxRear, pan, wheels:[...], hook, cab}. */
MD.sled = function (o) {
  o = o || {};
  var P = TP.palette, root = new THREE.Group();
  var col = hexNum(o.color, 0xffc61a), dark = 0x2b2b2b;
  var b = LP.builder();
  // frame rails
  [-1, 1].forEach(function (sd) { b.box(8.6, 0.28, 0.22, dark, { x: -4.6, y: 0.95, z: sd * 1.05 }); b.box(8.0, 0.08, 0.3, col, { x: -4.6, y: 1.13, z: sd * 1.05 }); });
  for (var c = 0; c < 6; c++) b.box(0.15, 0.15, 2.2, dark, { x: -1 - c * 1.5, y: 0.9 });
  // pan (front skid plate) + hook arm
  b.taper(1.5, 0.3, 2.6, 1.15, 1, P.steel, { x: -1.0, y: 0.18 });
  b.box(1.2, 0.18, 0.22, dark, { x: -0.55, y: 0.6, rz: -0.3 });
  b.box(0.3, 0.3, 0.3, dark, { x: -0.1, y: 0.5 });
  // rear axle housing + operator cab tower
  b.box(0.4, 0.4, 2.8, dark, { x: -8.0, y: 0.8 });
  b.box(1.5, 0.15, 2.4, dark, { x: -8.6, y: 1.25 });
  b.box(1.2, 1.4, 1.2, col, { x: -8.7, y: 2.0, z: 0.5 });
  b.box(1.0, 0.6, 1.24, P.glass, { x: -8.65, y: 2.35, z: 0.5 });
  b.box(1.4, 0.1, 1.4, dark, { x: -8.7, y: 2.75, z: 0.5 });
  b.cyl(0.05, 0.05, 1.2, 6, P.steelDark, { x: -8.2, y: 3.3, z: -0.8 });
  b.box(0.12, 0.12, 0.12, 0xff3b1a, { x: -8.2, y: 3.95, z: -0.8 });
  root.add(b.mesh({ shadow: true }));
  var sign = LP.decal(LP.textTexture(o.label || 'FULL PULL SLED CO.', { w: 512, h: 96, bg: '#17140f', fg: '#ffd23f' }), 4.8, 0.55, { x: -4.6, y: 0.95, z: 1.17 });
  root.add(sign);
  var sign2 = sign.clone(); sign2.position.z = -1.17; sign2.rotation.y = Math.PI; root.add(sign2);
  // weight box (stack of plates)
  var box = new THREE.Group();
  var bb = LP.builder();
  bb.box(1.7, 0.2, 2.3, dark, { y: 1.3 });
  for (var k = 0; k < 4; k++) bb.box(1.5, 0.32, 2.1, k % 2 ? col : 0xd23a2a, { y: 1.58 + k * 0.33 });
  bb.box(1.0, 0.25, 0.8, dark, { y: 2.98 });
  box.add(bb.mesh({ shadow: true }));
  root.add(box);
  var wheels = [];
  [-1, 1].forEach(function (sd) {
    var w = MD.wheel(0.62, 0.45, { lugs: 14, lugDepth: 0.06, seg: 14, rimColor: col }); w.position.set(-8.0, 0.62, sd * 1.35); root.add(w); wheels.push(w);
  });
  var hook = new THREE.Object3D(); hook.position.set(0.05, 0.5, 0); root.add(hook);
  var pan = new THREE.Object3D(); pan.position.set(-1.0, 0.05, 0); root.add(pan);
  return { root: root, box: box, boxFront: -2.2, boxRear: -7.2, pan: pan, wheels: wheels, hook: hook, length: 9.4 };
};

/* ---------------------------------------------------------------------------
 * 16. VENUES  TP.venueKit (helpers) + TP.loadVenue(id)
 *   Core builds the standard pulling pad for every venue (dirt track, boundary
 *   lines, start/finish lines, 50 ft markers, distance board) unless the venue
 *   sets customTrack:true. venue.build(ctx) adds everything else.
 * ------------------------------------------------------------------------- */
var VK = TP.venueKit = {};
/** Dirt texture. o = {base, light, dark, grooves:bool, wet 0..1} */
VK.dirtTexture = function (o) {
  o = o || {};
  return LP.canvasTexture(256, 256, function (c, w, h) {
    var wet = o.wet || 0;
    c.fillStyle = o.base || (wet > 0.5 ? '#5a3a20' : '#8a5a32'); c.fillRect(0, 0, w, h);
    var rng = makeRng(o.seed || 7);
    for (var i = 0; i < 1400; i++) {
      var v = rng(); c.fillStyle = v < 0.5 ? (o.dark || 'rgba(60,35,15,0.35)') : (o.light || 'rgba(190,140,90,0.3)');
      var s = 1 + rng() * 4; c.fillRect(rng() * w, rng() * h, s, s);
    }
    if (o.grooves) {
      c.strokeStyle = 'rgba(50,28,12,0.28)';
      for (var g = 0; g < 26; g++) { c.lineWidth = 1 + rng() * 2; var y = rng() * h; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y + (rng() - 0.5) * 6); c.stroke(); }
    }
  }, { repeat: o.repeat || [1, 1] });
};
VK.grassTexture = function (o) {
  o = o || {};
  return LP.canvasTexture(256, 256, function (c, w, h) {
    c.fillStyle = o.base || '#6e9e3e'; c.fillRect(0, 0, w, h);
    var rng = makeRng(11);
    for (var i = 0; i < 2200; i++) { c.fillStyle = rng() < 0.5 ? 'rgba(60,100,30,0.35)' : 'rgba(150,190,90,0.3)'; c.fillRect(rng() * w, rng() * h, 2, 2 + rng() * 4); }
  }, { repeat: o.repeat || [40, 40] });
};
/** Flat textured ground plane. */
VK.plane = function (ctx, w, d, tex, o) {
  o = o || {};
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, color: o.color != null ? o.color : 0xffffff }));
  m.rotation.x = -Math.PI / 2; m.position.set(o.x || 0, o.y || 0, o.z || 0); m.receiveShadow = true;
  ctx.group.add(m); return m;
};
/** Bleacher section: rows stepping up away from the track (toward +Z if side=1). Returns seat positions. */
VK.bleachers = function (b, x0, x1, z0, rows, side, o) {
  o = o || {}; side = side || 1;
  var seats = [], P = TP.palette, len = x1 - x0, cx = (x0 + x1) / 2;
  for (var r = 0; r < rows; r++) {
    var y = 0.5 + r * 0.45, z = z0 + side * r * 0.8;
    b.box(len, 0.08, 0.5, o.seat || 0xc9ccd1, { x: cx, y: y, z: z });
    b.box(len, 0.45, 0.06, o.riser || 0x8e979f, { x: cx, y: y - 0.25, z: z - side * 0.3 });
    for (var s = x0 + 0.4; s < x1 - 0.3; s += 0.62) seats.push({ x: s + (Math.random() - 0.5) * 0.15, y: y + 0.05, z: z, ry: side > 0 ? 0 : Math.PI });
  }
  for (var p = x0; p <= x1 + 0.01; p += len / Math.max(1, Math.round(len / 6))) b.box(0.15, 0.5 + rows * 0.45, 0.15, P.steelDark, { x: p, y: (0.5 + rows * 0.45) / 2, z: z0 + side * (rows - 1) * 0.8 });
  if (o.roof) {
    var top = 1.6 + rows * 0.45 + 1.8, zb = z0 + side * (rows - 1) * 0.8;
    b.box(len + 1, 0.15, rows * 0.8 + 1.4, o.roof, { x: cx, y: top, z: z0 + side * (rows - 1) * 0.4, rx: -side * 0.08 });
    for (var q = x0; q <= x1 + 0.01; q += len / Math.max(1, Math.round(len / 8))) b.box(0.18, top, 0.18, P.steelDark, { x: q, y: top / 2, z: zb + side * 0.3 });
  }
  return seats;
};
/** Instanced crowd from seat positions. Returns {meshes, update(dt)}; cheer level from TP.audio crowd + TP.venueState.cheer. */
VK.crowd = function (ctx, seats, o) {
  o = o || {};
  var max = TP.quality === 'low' ? Math.min(seats.length, o.maxLow || 260) : Math.min(seats.length, o.max || 700);
  if (seats.length > max) { var step = seats.length / max, sel = []; for (var i = 0; i < max; i++) sel.push(seats[Math.floor(i * step)]); seats = sel; }
  var groups = 4, P = TP.palette, rng = makeRng(o.seed || 5);
  var bodyGeo = LP.merge([LP.box(0.42, 0.55, 0.28, 0xffffff, { y: 0.32 }), LP.box(0.44, 0.12, 0.3, 0xdddddd, { y: 0.02 })]);
  var headGeo = LP.merge([LP.box(0.24, 0.26, 0.24, 0xffffff, { y: 0.74 })]);
  var hatGeo = LP.merge([LP.box(0.3, 0.06, 0.32, 0xffffff, { y: 0.88, x: 0.02 }), LP.box(0.26, 0.1, 0.26, 0xffffff, { y: 0.93 })]);
  var mat = LP.mat('vc', { rough: 0.85, instColor: true });   // separate material: instanceColor programs must not be shared
  var out = { meshes: [], phase: [] };
  var dummy = new THREE.Object3D(), col = new THREE.Color();
  for (var g = 0; g < groups; g++) {
    var list = seats.filter(function (s, k) { return k % groups === g; });
    if (!list.length) continue;
    var mb = new THREE.InstancedMesh(bodyGeo, mat, list.length), mh = new THREE.InstancedMesh(headGeo, mat, list.length), mt = new THREE.InstancedMesh(hatGeo, mat, list.length);
    for (var k = 0; k < list.length; k++) {
      var s = list[k];
      dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, s.ry || 0, 0); dummy.scale.setScalar(0.92 + rng() * 0.2); dummy.updateMatrix();
      mb.setMatrixAt(k, dummy.matrix); mh.setMatrixAt(k, dummy.matrix);
      col.set(P.shirts[(rng() * P.shirts.length) | 0]).convertSRGBToLinear(); mb.setColorAt(k, col);
      col.set(P.skin[(rng() * P.skin.length) | 0]).convertSRGBToLinear(); mh.setColorAt(k, col);
      if (rng() < 0.45) { col.set([0xd23a2a, 0xf3efe6, 0x2565ae, 0x1b1b1b, 0xd8b25a][(rng() * 5) | 0]).convertSRGBToLinear(); dummy.scale.multiplyScalar(1); dummy.updateMatrix(); mt.setMatrixAt(k, dummy.matrix); mt.setColorAt(k, col); }
      else { dummy.scale.setScalar(0.0001); dummy.updateMatrix(); mt.setMatrixAt(k, dummy.matrix); mt.setColorAt(k, col.set(0)); }
    }
    var grp = new THREE.Group(); grp.add(mb, mh, mt);
    [mb, mh, mt].forEach(function (m) { m.castShadow = false; m.receiveShadow = false; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    ctx.group.add(grp); out.meshes.push(grp); out.phase.push(g * 1.7);
  }
  out.update = function (dt) {
    var ch = TP.venueState ? TP.venueState.cheer : 0, t = TP.time;
    for (var i = 0; i < out.meshes.length; i++) {
      var j = Math.max(0, Math.sin(t * (7 + i) + out.phase[i]));
      out.meshes[i].position.y = (0.03 + 0.22 * ch) * j;
    }
  };
  ctx.addUpdate(out.update);
  return out;
};
/** Instanced low-poly trees at positions [{x,z,s}]. */
VK.trees = function (ctx, pts) {
  var geo = LP.merge([LP.cyl(0.18, 0.25, 1.6, 6, 0x6b4a2a, { y: 0.8 }), LP.cone(1.5, 2.6, 7, 0x3f7a2e, { y: 2.6 }), LP.cone(1.15, 2.0, 7, 0x4d8f36, { y: 3.7 }), LP.cone(0.7, 1.4, 7, 0x5fa040, { y: 4.6 })]);
  var m = new THREE.InstancedMesh(geo, LP.mat('vc', { instanced: true }), pts.length), d = new THREE.Object3D();
  pts.forEach(function (p, i) { d.position.set(p.x, 0, p.z); d.rotation.set(0, p.x * 1.3, 0); d.scale.setScalar(p.s || 1); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
  m.castShadow = false; ctx.group.add(m); return m;
};
/** Round hay bales [{x,z,ry}] (instanced). */
VK.hay = function (ctx, pts) {
  var geo = LP.merge([LP.cyl(0.62, 0.62, 1.1, 10, TP.palette.hay, { axis: 'z', y: 0.62 }), LP.cyl(0.4, 0.4, 1.12, 10, TP.palette.hayDark, { axis: 'z', y: 0.62 })]);
  var m = new THREE.InstancedMesh(geo, LP.mat('vc', { instanced: true }), pts.length), d = new THREE.Object3D();
  pts.forEach(function (p, i) { d.position.set(p.x, 0, p.z); d.rotation.set(0, p.ry || 0, 0); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
  m.castShadow = TP.quality === 'high'; m.receiveShadow = true; ctx.group.add(m); return m;
};
/** Pennant string between two points. */
VK.pennants = function (b, x0, x1, y, z, colors) {
  var n = Math.round((x1 - x0) / 0.8);
  for (var i = 0; i < n; i++) { var x = x0 + i * 0.8 + 0.4, sag = Math.sin(i / n * Math.PI) * 0.6; b.wedge(0.5, 0.45, 0.02, colors[i % colors.length], { x: x, y: y - sag - 0.2, z: z, rz: -Math.PI / 2, slope: 1 }); }
};
/** Sponsor banner on the fence (fictional names only). */
VK.banner = function (ctx, text, x, y, z, w, h, o) {
  o = o || {};
  var t = LP.textTexture(text, { w: 512, h: 128, bg: o.bg || '#17140f', fg: o.fg || '#ffd23f', border: o.border || '#fff4dc', borderWidth: 6, size: o.size });
  var m = LP.decal(t, w, h, { x: x, y: y, z: z, face: o.face });
  ctx.group.add(m); return m;
};
/** Live distance board: returns {mesh, set(text, sub)} — redraws only when text changes. */
VK.board = function (ctx, x, y, z, o) {
  o = o || {};
  var b = LP.builder();
  b.box(5.4, 2.4, 0.3, 0x17140f, { y: y }).box(0.3, y, 0.3, TP.palette.steelDark, { x: -2, y: y / 2 - 0.6 }).box(0.3, y, 0.3, TP.palette.steelDark, { x: 2, y: y / 2 - 0.6 });
  var grp = new THREE.Group(); grp.add(b.mesh({ shadow: true }));
  var last = '';
  var tex = LP.canvasTexture(512, 224, function () {});
  var draw = function (txt, sub) {
    var c = tex.userData.ctx, w = 512, h = 224;
    c.fillStyle = '#100d0a'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ffd23f'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#ff7a1a'; c.font = '800 34px "Saira Condensed", "Arial Narrow", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(sub || 'DISTANCE', w / 2, 38);
    c.fillStyle = '#ffd23f'; c.font = '900 112px "Saira Condensed", "Arial Narrow", Impact, sans-serif';
    c.fillText(txt, w / 2, 136);
    tex.needsUpdate = true;
  };
  draw('0.00', o.sub);
  var face = LP.decal(tex, 5.0, 2.2, { z: o.face === '-z' ? -0.17 : 0.17, y: y, face: o.face, emissive: 0.6 });
  grp.add(face);
  grp.position.set(x, 0, z); if (o.ry) grp.rotation.y = o.ry;
  ctx.group.add(grp);
  return { mesh: grp, set: function (txt, sub) { var k = txt + '|' + (sub || ''); if (k === last) return; last = k; draw(txt, sub); } };
};

/** Standard pulling pad: track, lines, markers. ctx.track = {length, laneHalf, width}. */
VK.standardTrack = function (ctx, o) {
  o = o || {};
  var L = ctx.track.length, lh = ctx.track.laneHalf, P = TP.palette, wet = ctx.trackCondition || 0;
  var trackW = o.width || 29, x0 = -30, x1 = L + 40;
  var dirt = VK.dirtTexture({ grooves: true, wet: wet, repeat: [(x1 - x0) / 8, trackW / 8], base: o.dirtBase });
  var pad = VK.plane(ctx, x1 - x0, trackW, dirt, { x: (x0 + x1) / 2, y: 0.005 });
  var b = LP.builder();
  // berms along the pad edge
  [-1, 1].forEach(function (s) { b.taper(x1 - x0, 0.35, 1.6, 1, 0.5, P.dirtDark, { x: (x0 + x1) / 2, y: 0.17, z: s * (trackW / 2 + 0.6) }); });
  // boundary lines (chalk) + start/finish
  [-1, 1].forEach(function (s) { b.box(x1 - x0 - 10, 0.02, 0.14, 0xf3efe6, { x: (x0 + x1) / 2 - 5, y: 0.02, z: s * lh }); });
  b.box(0.3, 0.025, lh * 2, 0xf3efe6, { x: 0, y: 0.022 });
  for (var k = 0; k < 10; k++) b.box(0.3, 0.026, lh * 2 / 10, k % 2 ? 0x121212 : 0xf3efe6, { x: L, y: 0.024, z: -lh + lh * 2 * (k + 0.5) / 10 });
  // 50 ft markers: cones + ticks
  for (var ft = 50; ft <= ctx.track.lengthFt; ft += 50) {
    var x = ft * C.FT;
    b.box(0.12, 0.022, 0.8, 0xf3efe6, { x: x, y: 0.021, z: -lh + 0.4 }).box(0.12, 0.022, 0.8, 0xf3efe6, { x: x, y: 0.021, z: lh - 0.4 });
    [-1, 1].forEach(function (s) { b.cone(0.22, 0.6, 6, P.orange, { x: x, y: 0.3, z: s * (lh + 0.9) }); b.box(0.36, 0.05, 0.36, P.orange, { x: x, y: 0.03, z: s * (lh + 0.9) }); });
    var sign = LP.decal(LP.textTexture(String(ft), { w: 256, h: 128, bg: '#fff4dc', fg: '#17140f', border: '#ff7a1a' }), 1.4, 0.7, { x: x, y: 1.2, z: -(lh + 1.6) });
    ctx.group.add(sign);
    b.box(0.08, 1.0, 0.08, P.steelDark, { x: x, y: 0.5, z: -(lh + 1.65) });
  }
  ctx.group.add(b.mesh({ receive: true }));
  // finish flag poles + start tree (lights tower)
  var fb = LP.builder();
  [-1, 1].forEach(function (s) { fb.cyl(0.07, 0.07, 4, 6, P.steel, { x: L, y: 2, z: s * (lh + 2.2) }); fb.box(0.04, 0.8, 1.2, s > 0 ? 0x121212 : 0xf3efe6, { x: L, y: 3.5, z: s * (lh + 2.2) + 0.6 * s }); });
  fb.box(0.3, 2.2, 0.3, 0x17140f, { x: -1.5, y: 1.1, z: -(lh + 2.8) }).box(0.08, 1.2, 0.08, 0x17140f, { x: -1.5, y: 2.8, z: -(lh + 2.8) });
  ctx.group.add(fb.mesh({ shadow: true }));
  // start tree lights (emissive spheres, recolored at runtime)
  var lights = [];
  ['red', 'yellow', 'green'].forEach(function (c, i) {
    var m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x000000, flatShading: true }));
    m.position.set(-1.33, 2.0 - i * 0.32, -(lh + 2.8)); ctx.group.add(m); lights.push(m);
  });
  ctx.startLights = lights;
  ctx.board = VK.board(ctx, L * 0.55, 4.6, -(lh + 9.2), { sub: 'DISTANCE' });
  return pad;
};

/** Build (or reuse) a venue. Returns the venue state; emits 'venueLoaded'(venue). */
TP.venueState = null;
TP.loadVenue = function (id, o) {
  o = o || {};
  var def = TP.venues[id] || TP.venues.county_fair;
  var tc = o.trackCondition != null ? o.trackCondition : (def.trackCondition != null ? def.trackCondition : 0.2);
  var vs = TP.venueState;
  if (vs && vs.id === def.id && !o.force) { vs.trackCondition = tc; return vs; }
  if (vs) {
    TP.scene.remove(vs.group);
    vs.group.traverse(function (ob) { if (ob.geometry) ob.geometry.dispose(); if (ob.material && ob.material.map && !ob.material._shared) ob.material.map.dispose(); });
    vs.updaters.length = 0;
  }
  var group = new THREE.Group(); group.name = 'venue:' + def.id;
  TP.scene.add(group);
  var maxFt = 0; for (var k in TP.classes) maxFt = Math.max(maxFt, TP.classes[k].trackLength || 300);
  var ctx = {
    id: def.id, def: def, group: group, updaters: [], trackCondition: tc, quality: TP.quality, lp: LP, kit: VK, palette: TP.palette,
    rng: makeRng(hashStr(def.id)),
    track: { lengthFt: maxFt, length: maxFt * C.FT, laneHalf: def.laneHalf || 4.6 },
    addUpdate: function (fn) { ctx.updaters.push(fn); }, cheer: 0, startLights: null, board: null
  };
  TP.setSky(def.sky || {});
  if (!def.customTrack) VK.standardTrack(ctx, def.trackOpts);
  try { if (def.build) def.build(ctx); } catch (e) { console.error('[TP] venue build failed', def.id, e); }
  TP.venueState = ctx;
  TP.emit('venueLoaded', ctx);
  return ctx;
};
TP.onFrame(function (dt) { var vs = TP.venueState; if (!vs) return; vs.cheer = Math.max(0, vs.cheer - dt * 0.4); for (var i = 0; i < vs.updaters.length; i++) vs.updaters[i](dt); });
/** Make the crowd jump/roar. amount 0..1. */
TP.cheer = function (amount) { if (TP.venueState) TP.venueState.cheer = Math.min(1.3, TP.venueState.cheer + (amount == null ? 1 : amount)); AU.cheer(amount); };

TP.addVenue('county_fair', {
  name: 'County Fairgrounds', desc: 'Saturday afternoon at the fair: bleachers packed, funnel cakes frying, and a freshly worked dirt track.',
  levelReq: 1, timeOfDay: 'day', trackCondition: 0.2, crowdSize: 0.8,
  sky: { top: 0x3d8fd8, horizon: 0xd6ebf2, sun: 0xfff0d8, sunIntensity: 2.4, hemiIntensity: 0.85, sunDir: [-0.45, 0.62, 0.64], fogNear: 160, fogFar: 650 },
  build: function (ctx) {
    var K = ctx.kit, P = ctx.palette, L = ctx.track.length, lh = ctx.track.laneHalf, g = ctx.group;
    K.plane(ctx, 900, 900, K.grassTexture({ repeat: [90, 90] }), { x: 50, y: -0.01 });
    var b = LP.builder(), seats = [];
    // grandstand (+Z side, behind the track as seen from the side camera)
    seats = seats.concat(K.bleachers(b, -6, 30, -(lh + 12), 9, -1, { roof: 0xb8322a }));
    seats = seats.concat(K.bleachers(b, 32, 62, -(lh + 12), 8, -1, { roof: 0x2565ae }));
    seats = seats.concat(K.bleachers(b, 64, 100, -(lh + 12), 7, -1, { roof: 0xb8322a }));
    // small bleachers on the near side, far back
    seats = seats.concat(K.bleachers(b, 20, 34, lh + 16, 4, 1, {}));
    seats = seats.concat(K.bleachers(b, 60, 74, lh + 16, 4, 1, {}));
    // fence (both sides): posts + 2 rails
    [-1, 1].forEach(function (s) {
      var z = s * (lh + 10.6);
      b.box(L + 60, 0.08, 0.06, 0xf3efe6, { x: L / 2, y: 0.6, z: z }).box(L + 60, 0.08, 0.06, 0xf3efe6, { x: L / 2, y: 1.1, z: z });
      for (var x = -30; x <= L + 30; x += 3) b.box(0.1, 1.2, 0.1, 0xe8e0d0, { x: x, y: 0.6, z: z });
    });
    // pennants over the grandstand
    K.pennants(b, -6, 100, 6.2, -(lh + 11.2), [P.red, P.yellow, P.blue, P.cream, P.orange]);
    // announcer booth + light poles + food stand + barn
    b.box(4, 3, 3, P.cream, { x: 31, y: 7.5, z: -(lh + 17) }).box(4.4, 0.3, 3.4, P.red, { x: 31, y: 9.1, z: -(lh + 17) }).box(3.6, 1.0, 0.05, P.glass, { x: 31, y: 7.8, z: -(lh + 15.48) });
    [-10, 40, 95].forEach(function (x) { b.cyl(0.18, 0.22, 16, 6, P.steel, { x: x, y: 8, z: -(lh + 26) }); b.box(3, 1.2, 0.4, P.steelDark, { x: x, y: 16, z: -(lh + 26) }); for (var i = 0; i < 4; i++) b.box(0.55, 0.45, 0.06, 0xfff6d0, { x: x - 1.1 + i * 0.73, y: 16, z: -(lh + 25.78) }); });
    b.box(6, 3.2, 4, P.white, { x: 110, y: 1.6, z: -(lh + 22) }).taper(6.6, 1.2, 4.6, 1, 0.1, P.red, { x: 110, y: 3.8, z: -(lh + 22) });
    b.box(10, 6, 8, P.barnRed, { x: -40, y: 3, z: -(lh + 30) }).taper(10.5, 3.5, 8.6, 1, 0.08, 0x5a2a20, { x: -40, y: 7.7, z: -(lh + 30) }).box(3, 4, 0.1, P.white, { x: -40, y: 2, z: -(lh + 25.95) });
    // ferris wheel in the distance
    var fx = 150, fz = -(lh + 60), fr = 14;
    b.box(1, fr + 2, 1, P.steel, { x: fx - 3, y: (fr + 2) / 2, z: fz, rz: 0.2 }).box(1, fr + 2, 1, P.steel, { x: fx + 3, y: (fr + 2) / 2, z: fz, rz: -0.2 });
    for (var sp = 0; sp < 12; sp++) {
      var a = sp / 12 * Math.PI * 2;
      b.box(0.25, fr, 0.25, P.white, { x: fx + Math.cos(a) * fr / 2, y: fr + 2 + Math.sin(a) * fr / 2, z: fz, rz: a + Math.PI / 2 });
      b.box(1.4, 1.2, 1.2, [P.red, P.yellow, P.blue, P.green][sp % 4], { x: fx + Math.cos(a) * fr, y: fr + 1.4 + Math.sin(a) * fr, z: fz });
    }
    g.add(b.mesh({ shadow: false, receive: true }));
    ctx.crowd = K.crowd(ctx, seats, { max: 720, maxLow: 280 });
    // banners on the far fence
    var names = ['IRONHORSE TRACTOR CO.', 'BIG SKY TRUCKS', 'RED ROOSTER AG', 'THUNDERBOLT DIESEL', 'PRAIRIE KING', 'COUNTY CO-OP FEED'];
    for (var n = 0; n < 6; n++) K.banner(ctx, names[n], -8 + n * 20, 0.85, -(lh + 10.55), 5.5, 0.9, { bg: ['#b8322a', '#17140f', '#2565ae', '#17140f', '#2e7d32', '#ff7a1a'][n], fg: n % 2 ? '#ffd23f' : '#fff4dc' });
    // hay bales by the start & finish, trees all around
    var hay = [];
    for (var hb = 0; hb < 8; hb++) hay.push({ x: -14 + (hb % 4) * 1.3, z: -(lh + 4) - Math.floor(hb / 4) * 1.4, ry: 0 });
    for (var hb2 = 0; hb2 < 6; hb2++) hay.push({ x: L + 12 + hb2 * 1.3, z: (hb2 % 2 ? 1 : -1) * (lh + 3.5), ry: 0 });
    K.hay(ctx, hay);
    var trees = [], rng = ctx.rng;
    for (var t = 0; t < 70; t++) { var tx = rng.range(-120, 230), side = rng() < 0.5 ? -1 : 1, tz = side * rng.range(lh + 34, lh + 120); trees.push({ x: tx, z: tz, s: rng.range(1.2, 2.4) }); }
    K.trees(ctx, trees);
  }
});

/* ---------------------------------------------------------------------------
 * 17. CAMERA  TP.cam — presets + spectate director + full-pull orbit
 * ------------------------------------------------------------------------- */
var CAM = TP.cam = {
  mode: 'side', director: false, rig: null, shake: 0, _dirT: 0, _cut: true, orbitT: 0, fovBase: 46,
  order: ['side', 'chase', 'front', 'sled', 'onboard', 'crowd'],
  names: { side: 'Side', chase: 'Chase', front: 'Front low', sled: 'Sled cam', onboard: 'Onboard', crowd: 'Crowd', orbit: 'Orbit', menu: 'Showcase' },
  pos: null, look: null, _p: null, _l: null,
  /** Preset functions: presets[name](rig, outPos, outLook). Add your own; they appear in the camera cycle if pushed to TP.cam.order. */
  presets: {
    side: function (r, P, L) { var por = TP.portrait, cx = r.x - (por ? 4.2 : 2.6), far = por ? 23 : 13.5; P.set(cx - 1.5, por ? 5.5 : 2.9, far); L.set(cx, por ? 2.2 : 1.3, 0); },
    chase: function (r, P, L) { P.set(r.sledX - 15, 7.5, 3.5 + r.z * 0.5); L.set(r.x + 6, 0.6, r.z); },
    front: function (r, P, L) { P.set(r.x + r.len + 5.5, 0.55, 3.6 + r.z); L.set(r.x + 0.5, 1.5 + r.lift * 3, r.z); },
    sled: function (r, P, L) { P.set(r.sledX - 1.0, 2.5, 1.5 + r.sledZ); L.set(r.x + 2.5, 1.1, r.z); },
    onboard: function (r, P, L) { P.set(r.x + r.seatX, r.seatY + 0.35 + r.lift * 2, r.z - 0.35); L.set(r.x + 25, 0.9, r.z * 0.3); },
    crowd: function (r, P, L) { var lh = TP.venueState ? TP.venueState.track.laneHalf : 4.6; P.set(r.x - 6, 8.5, -(lh + 17)); L.set(r.x - 2, 1, 0); },
    orbit: function (r, P, L) { var a = CAM.orbitT * 0.45 + 1.2, R = 11; P.set(r.x + Math.cos(a) * R, 2.6 + Math.sin(CAM.orbitT * 0.3) * 0.8, r.z + Math.sin(a) * R - 1); L.set(r.x + 1, 1.4, r.z); },
    menu: function (r, P, L) {
      var a = TP.time * 0.1 + 0.9, R = TP.portrait ? 13 : 10.5, cx = r.x + 1.4;
      P.set(cx + Math.cos(a) * R, TP.portrait ? 3.6 : 2.4, Math.sin(a) * R);
      // look a little to the camera's left so the rig sits right of the menu column (landscape) / above it (portrait)
      var fx = -Math.cos(a), fz = -Math.sin(a), k = TP.portrait ? 0 : 3.4;
      L.set(cx + fz * k, TP.portrait ? -2.6 : 1.1, -fx * k);
    }
  },
  set: function (mode, cut) { if (!CAM.presets[mode]) return; if (mode !== CAM.mode) { CAM.mode = mode; CAM._cut = cut !== false; TP.emit('camera', mode); } },
  cycle: function () { var i = CAM.order.indexOf(CAM.mode); CAM.set(CAM.order[(i + 1) % CAM.order.length]); return CAM.mode; },
  follow: function (rig) { CAM.rig = rig; CAM._cut = true; },
  update: function (realDt, dt) {
    var r = CAM.rig; if (!r || !TP.camera) return;
    if (!CAM.pos) { CAM.pos = new THREE.Vector3(); CAM.look = new THREE.Vector3(); CAM._p = new THREE.Vector3(); CAM._l = new THREE.Vector3(); }
    if (CAM.mode === 'orbit') CAM.orbitT += realDt;
    if (CAM.director && CAM.mode !== 'orbit') {
      CAM._dirT -= dt;
      if (CAM._dirT <= 0) {
        var pool = ['side', 'side', 'front', 'chase', 'sled', 'crowd', 'onboard'];
        var next = pool[(Math.random() * pool.length) | 0];
        if (next === CAM.mode) next = 'side';
        CAM.set(next); CAM._dirT = 2.8 + Math.random() * 2.6;
      }
    }
    CAM.presets[CAM.mode](r, CAM._p, CAM._l);
    if (CAM._cut) { CAM.pos.copy(CAM._p); CAM.look.copy(CAM._l); CAM._cut = false; }
    else {
      var k = 1 - Math.exp(-(CAM.mode === 'onboard' ? 30 : 7) * realDt);
      CAM.pos.lerp(CAM._p, k); CAM.look.lerp(CAM._l, Math.min(1, k * 1.4));
    }
    var cam = TP.camera; cam.position.copy(CAM.pos);
    var sh = TP.save.settings.shake === false ? 0 : CAM.shake;
    if (sh > 0.001) { var t = TP.time * 31; cam.position.x += Math.sin(t) * sh * 0.06; cam.position.y += Math.sin(t * 1.37 + 1) * sh * 0.05; cam.position.z += Math.sin(t * 0.83 + 2) * sh * 0.04; }
    cam.lookAt(CAM.look);
    var fov = CAM.mode === 'onboard' ? 62 : (TP.portrait ? 58 : CAM.fovBase);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); if (TP.fx) TP.fx._resize(); }
    CAM.shake = Math.max(0, CAM.shake - realDt * 2);
    // keep the sun's shadow box on the action
    var sun = TP.lights && TP.lights.sun;
    if (sun) { var sd = TP.lights.sunDir; sun.target.position.set(r.x - 3, 0, r.z); sun.position.set(r.x - 3 + sd.x * 60, sd.y * 60, r.z + sd.z * 60); }
  }
};

/* ---------------------------------------------------------------------------
 * 18. PULL RENDERING  TP.runPull(opts) -> Promise<result>
 * ------------------------------------------------------------------------- */
TP.controllers.player = {
  kind: 'player', name: 'player',
  update: function (p, dt, out) {
    out.throttle = IN.throttle; out.steer = IN.steer; out.shift = IN.consumeShift(); out.boost = IN.consumeBoost();
    var st = TP.save.settings;
    if (st.autoShift && p.status !== 'staged' && p.gear < p.stats.gears.length - 1 && p.shiftTimer <= 0 && p.rpm >= p.stats.shiftRpm) out.shift = !this._as;
    this._as = !!(st.autoShift && out.shift);
    if (st.assistTraction && p.status !== 'staged' && p.chainTaut) out.throttle = Math.min(out.throttle, TP.sim.pedalFor(p, p.idealSlip * 1.2) + 0.08);
    return out;
  }
};
/** Resolve a controller: 'player' | 'ai' (uses opts.skill) | skill name | controller object. */
TP.controllers.resolve = function (c, skill, name) {
  if (c && typeof c === 'object' && c.update) return c;
  if (c === 'player') return TP.controllers.player;
  if (c === 'autoplay') { var a = TP.controllers.ai(skill || 'pro', { name: 'autoplay' }); a.kind = 'player'; return a; }
  return TP.controllers.ai(skill || (typeof c === 'string' && TP.skills[c] ? c : 'good'), { name: name || 'ai' });
};

/** Build a renderable vehicle rig (no sim). Returns {group, pitch, model, ...}. */
TP.buildRig = function (vehicleId, livery) {
  var veh = TP.vehicles[vehicleId];
  var model;
  try { model = veh.build.call(veh, livery || {}); } catch (e) { console.error('[TP] vehicle build failed', vehicleId, e); model = MD.pickup(livery, veh); }
  var Rr = (model.radius && model.radius.rear) || (model.wheels.rear[0] && model.wheels.rear[0].position.y) || 0.6;
  var Rf = (model.radius && model.radius.front) || (model.wheels.front[0] && model.wheels.front[0].position.y) || Rr;
  var group = new THREE.Group(), pitch = new THREE.Group();
  pitch.position.y = Rr; model.root.position.y = -Rr; pitch.add(model.root); group.add(pitch);
  group.traverse(function (o) { if (o.isMesh && TP.quality === 'high' && !o.material.transparent) o.castShadow = true; });
  var hitchX = model.hitch ? model.hitch.position.x : -1.5;
  var frontX = 0; model.wheels.front.forEach(function (w) { frontX = Math.max(frontX, w.position.x); });
  var rig = {
    group: group, pitch: pitch, model: model, vehicleId: vehicleId, veh: veh, Rr: Rr, Rf: Rf, hitchX: hitchX, frontX: frontX,
    len: model.length || (frontX + 2), seatX: veh.seatX != null ? veh.seatX : (TP.classes[veh.class] && TP.classes[veh.class].group === 'tractor' ? -0.4 : 1.6), seatY: veh.seatY || (Rr * 2 + 0.6),
    x: 0, z: 0, sledX: 0, sledZ: 0, lift: 0, rotF: 0, rotR: 0, smokeAcc: [], flameAcc: 0, dirtAcc: 0, dustAcc: 0
  };
  model.stacks.forEach(function () { rig.smokeAcc.push(0); });
  return rig;
};
TP.disposeRig = function (rig) {
  if (!rig) return;
  if (rig.group.parent) rig.group.parent.remove(rig.group);
  rig.group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); });
};
var PR = TP.r3.pull = null;   // active pull render state
function getSled() {
  if (!R3.sled) {
    R3.sled = MD.sled({});
    R3.chain = [];
    var cg = new THREE.CylinderGeometry(0.035, 0.035, 1, 5); cg.translate(0, 0.5, 0);
    for (var i = 0; i < 2; i++) { var cm = new THREE.Mesh(cg, LP.mat(0x9aa0a6, { metal: 0.6, rough: 0.4 })); cm.castShadow = true; R3.chain.push(cm); }
    R3.debris = [];
    for (var d = 0; d < 6; d++) { var dm = LP.mesh(LP.box(0.25 + d * 0.04, 0.12, 0.2, d % 2 ? 0x8e979f : 0x2b2b2b)); dm.visible = false; R3.debris.push({ m: dm, v: new THREE.Vector3(), life: 0 }); }
  }
  [R3.sled.root].concat(R3.chain).forEach(function (o) { if (o.parent !== TP.scene) TP.scene.add(o); });
  R3.debris.forEach(function (d) { if (d.m.parent !== TP.scene) TP.scene.add(d.m); });
  return R3.sled;
}
TP.getSled = getSled;
var _up = null;
function placeChain(ax, ay, az, bx, by, bz, sag) {
  var mx = (ax + bx) / 2, my = (ay + by) / 2 - sag, mz = (az + bz) / 2;
  seg(R3.chain[0], ax, ay, az, mx, my, mz); seg(R3.chain[1], mx, my, mz, bx, by, bz);
  function seg(m, x0, y0, z0, x1, y1, z1) {
    var T = TP.tmp.v4; T.set(x1 - x0, y1 - y0, z1 - z0); var len = T.length() || 0.001;
    m.position.set(x0, y0, z0); m.scale.set(1, len, 1);
    if (!_up) _up = new THREE.Vector3(0, 1, 0);
    m.quaternion.setFromUnitVectors(_up, T.multiplyScalar(1 / len));
  }
}
/** Position the rig + sled from a pull state (also used for skip/snap and the menu showcase). */
function poseRig(rig, p, dt) {
  var st = p.stats;
  var dist = p.visDist != null ? p.visDist : p.dist;
  var hitchWorldX = p.travel - p.slack + 1.6;     // chain ~1.6 m when taut
  rig.x = hitchWorldX - rig.hitchX;
  rig.z = p.lateral;
  rig.group.position.set(rig.x, 0, rig.z);
  rig.group.rotation.y = -p.heading;
  // front lift (wheelie) + hop bounce
  var hopOsc = p.hop * Math.sin(p.hopPhase);
  rig.lift = p.frontLift * 1.25 + clamp(1 - p.frontLoad, 0, 1) * 0.035 + Math.max(0, hopOsc) * 0.012;
  rig.pitch.rotation.z = rig.lift;
  rig.pitch.position.y = rig.Rr + Math.abs(hopOsc) * 0.05;
  var body = rig.model.body;
  if (body) { body.position.y = hopOsc * 0.03 + Math.sin(TP.time * 40) * 0.004 * p.throttle; body.rotation.x = Math.sin(p.hopPhase * 0.5) * p.hop * 0.012; }
  // wheels
  rig.rotR -= p.w * dt / rig.Rr;
  rig.rotF -= (st.drive === '4wd' ? p.w : p.speed) * dt / rig.Rf;
  var wr = rig.model.wheels;
  for (var i = 0; i < wr.rear.length; i++) wr.rear[i].rotation.z = rig.rotR;
  for (var j = 0; j < wr.front.length; j++) { wr.front[j].rotation.z = rig.rotF; wr.front[j].rotation.y = p.steer * 0.32; }
  // sled
  var S = R3.sled;
  if (S) {
    rig.sledX = dist; rig.sledZ = damp(rig.sledZ, p.lateral * 0.8, 1.5, dt);
    S.root.position.set(dist, 0, rig.sledZ);
    S.root.rotation.y = Math.atan2(-(rig.z - rig.sledZ), Math.max(1, rig.x - dist)) * 0.5;
    S.box.position.x = lerp(S.boxRear, S.boxFront, p.sledBoxPos);
    S.root.rotation.z = -0.012 * p.dig;
    var sw = (p.chainTaut ? p.speed : 0) * dt / 0.62;
    for (var k = 0; k < S.wheels.length; k++) S.wheels[k].rotation.z -= sw;
    // chain from the hitch to the sled hook
    var hx = rig.x + rig.hitchX * Math.cos(p.heading), hz = rig.z - rig.hitchX * Math.sin(p.heading);
    var hy = rig.model.hitch ? rig.model.hitch.position.y + Math.sin(rig.lift) * -rig.hitchX * 0 : 0.6;
    var slackLeft = p.chainTaut ? 0 : Math.max(0, p.slack - p.travel);
    placeChain(hx, hy, hz, dist + 0.05, 0.5, rig.sledZ, 0.05 + slackLeft * 0.9);
  }
}
TP.poseRig = poseRig;

var QF = function () { return TP.quality === 'low' ? 0.5 : 1; };
function rigEffects(rig, p, dt) {
  if (dt <= 0) return;
  var st = p.stats, et = st.et, FX = TP.fx, v = TP.tmp.v1, q = QF();
  var rpmN = clamp(p.rpm / st.redline, 0, 1.1);
  var load = clamp(p.driveForce / (p.fullDrive || 1), 0, 1);
  var running = !p.broken;
  // stack smoke + flames
  var stacks = rig.model.stacks, n = stacks.length || 1;
  for (var i = 0; i < stacks.length; i++) {
    stacks[i].getWorldPosition(v);
    var rate = running ? (5 + 70 * p.throttle * (0.3 + load) * (0.4 + rpmN)) * (et.smoke || 0.5) * q / Math.sqrt(n) : 3;
    if (p.boostTimer > 0) rate *= 1.6;
    rig.smokeAcc[i] += rate * dt;
    while (rig.smokeAcc[i] >= 1) {
      rig.smokeAcc[i] -= 1;
      var up = 3 + 6 * p.throttle;
      FX.emit('smoke', v.x, v.y, v.z, -p.speed * 0.4 + (Math.random() - 0.5) * 0.8, up * (0.7 + Math.random() * 0.5), (Math.random() - 0.5) * 0.8, (0.6 + 0.9 * p.throttle) / Math.sqrt(n) * (et.smoke < 0.5 ? 0.7 : 1), 1);
    }
    var flameOn = running && ((rpmN > 0.86 && p.throttle > 0.85 && Math.random() < et.flame) || p.boostTimer > 0 && Math.random() < 0.7 || (p._popT > 0));
    if (flameOn) {
      for (var f = 0; f < 2; f++) FX.emit('flame', v.x, v.y + 0.05, v.z, (Math.random() - 0.5) * 0.6, 4 + Math.random() * 4, (Math.random() - 0.5) * 0.6, 0.7 + (et.flame || 0.3) * 0.8, 1);
    }
  }
  if (p._popT > 0) p._popT -= dt;
  // roost: dirt off the drive tires
  var slipV = Math.max(0, p.w - p.speed);
  var wheels = rig.model.wheels.rear;
  rig.dirtAcc += (slipV * 26 + p.speed * 4) * q * dt * (p.status === 'staged' ? 0 : 1);
  while (rig.dirtAcc >= 1) {
    rig.dirtAcc -= 1;
    var wh = wheels[(Math.random() * wheels.length) | 0];
    if (!wh) break;
    wh.getWorldPosition(v);
    var sp = 2 + slipV * 1.2;
    FX.emit('dirt', v.x - rig.Rr * 0.7, 0.15, v.z + (Math.random() - 0.5) * 0.4, -sp * (0.6 + Math.random() * 0.6), sp * (0.4 + Math.random() * 0.8), (Math.random() - 0.5) * 2.4, 1 + Math.random(), 1);
    if (Math.random() < 0.35) FX.emit('dust', v.x - rig.Rr, 0.3, v.z, -sp * 0.3, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5, 0.8 + slipV * 0.1, 1);
  }
  // sled pan: dust + dirt pile as it digs
  if (p.chainTaut && R3.sled) {
    rig.dustAcc += (p.speed * 3 + p.dig * 10) * q * dt;
    while (rig.dustAcc >= 1) {
      rig.dustAcc -= 1;
      var px = rig.sledX - 0.3, pz = rig.sledZ + (Math.random() - 0.5) * 2.4;
      FX.emit('dust', px, 0.3, pz, p.speed * 0.6, 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * 2, 0.9 + p.dig * 0.6, 1);
      if (Math.random() < 0.3 + p.dig) FX.emit('dirt', px + 0.3, 0.2, pz, p.speed * 0.8 + 0.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.9, 0.8);
    }
  }
  // overheating: steam from the grille
  if (p.temp > 0.85 && Math.random() < (p.temp - 0.85) * 8 * dt * 30 * q) {
    rig.group.getWorldPosition(v);
    FX.emit('steam', v.x + rig.frontX * 0.9, 1.6, v.z, 0.5, 1.5, (Math.random() - 0.5), 1, 1);
  }
}
TP.rigEffects = rigEffects;
function blowUp(rig, p) {
  var v = TP.tmp.v2; rig.group.getWorldPosition(v);
  var x = v.x + (p.broken === 'engine' ? rig.frontX * 0.6 : 0), y = 1.4, z = v.z;
  TP.fx.burst('flame', x, y, z, 40, { spread: 0.8, speed: 4, up: 1.5, sizeMul: 2 });
  TP.fx.burst('smoke', x, y + 0.5, z, 40, { spread: 1, speed: 2.5, up: 2, sizeMul: 1.8 });
  TP.fx.burst('spark', x, y, z, 50, { spread: 0.4, speed: 7, up: 1.2 });
  R3.debris.forEach(function (d, i) { d.m.visible = true; d.m.position.set(x, y, z); d.v.set((Math.random() - 0.3) * 5, 5 + Math.random() * 4, (Math.random() - 0.5) * 6); d.life = 3; });
  AU.sfx('bang'); CAM.shake = 2.5; TP.cheer(0.6);
}
TP.onFrame(function (dt) {
  if (!R3.debris) return;
  for (var i = 0; i < R3.debris.length; i++) {
    var d = R3.debris[i]; if (d.life <= 0) continue;
    d.life -= dt; d.v.y -= 9.8 * dt; d.m.position.addScaledVector(d.v, dt);
    if (d.m.position.y < 0.08) { d.m.position.y = 0.08; d.v.y *= -0.45; d.v.x *= 0.6; d.v.z *= 0.6; }
    d.m.rotation.x += dt * 8; d.m.rotation.z += dt * 6;
    if (d.life <= 0) d.m.visible = false;
  }
});

/** Announcer line for a driver: TP.driverLine(driverId, kind) kind = intro|good|full|bad */
TP.driverLine = function (driverId, kind) {
  var d = TP.drivers[driverId]; if (!d || !d.lines || !d.lines[kind] || !d.lines[kind].length) return '';
  var a = d.lines[kind]; return a[(Math.random() * a.length) | 0];
};

/**
 * Render a pull in the current venue. opts:
 *  {vehicleId, upgrades, livery, driverId, name, controller:'player'|'ai'|'autoplay'|controllerObj, skill,
 *   venue, trackCondition, seed, sledMult, sled, spectate:bool, best (ft to beat), label, classId, extra}
 * Resolves with the result (+ {player, driverId, name, vehicleId}).
 */
TP.runPull = function (opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    if (PR) endActive(true);
    var veh = TP.vehicles[opts.vehicleId];
    if (!veh) { console.error('[TP] runPull: unknown vehicle', opts.vehicleId); resolve(null); return; }
    var venueId = opts.venue || (TP.venueState && TP.venueState.id) || 'county_fair';
    var vs = TP.loadVenue(venueId, { trackCondition: opts.trackCondition });
    var isPlayer = opts.controller === 'player' || opts.controller === 'autoplay' || (opts.controller && opts.controller.kind === 'player') || (!opts.controller && !opts.spectate);
    var ctrl = TP.controllers.resolve(opts.controller || (isPlayer ? 'player' : 'ai'), opts.skill || (opts.driverId && TP.drivers[opts.driverId] && TP.drivers[opts.driverId].skill), opts.driverId);
    var p = TP.sim.createPull({ vehicleId: opts.vehicleId, upgrades: opts.upgrades, driver: opts.driverId, venue: venueId, trackCondition: vs.trackCondition,
      seed: opts.seed, sledMult: opts.sledMult, sled: opts.sled, extra: opts.extra, classId: opts.classId });
    p.player = isPlayer; p.name = opts.name || (opts.driverId && TP.drivers[opts.driverId] ? TP.drivers[opts.driverId].name : 'You'); p.label = opts.label || '';
    hideMenuShowcase();
    var sled = getSled();
    var rig = TP.buildRig(opts.vehicleId, opts.livery);
    TP.scene.add(rig.group);
    TP.fx.clear();
    IN.reset();
    var state = PR = TP.r3.pull = {
      p: p, rig: rig, ctrl: ctrl, input: { throttle: 0, steer: 0, shift: false, boost: false }, opts: opts, resolve: resolve,
      ff: 1, evIdx: 0, endT: -1, voice: AU.engine(veh.engine), player: isPlayer, spectate: !isPlayer, slowT: 0, lastBoard: -1, milestone: 0,
      best: opts.best != null ? opts.best : (TP.save.stats.bestByClass[p.classId] || 0)
    };
    poseRig(rig, p, 0);
    CAM.follow(rig); CAM.director = !isPlayer; CAM.set(isPlayer ? (TP.save.settings.camera || 'side') : 'side'); CAM._dirT = 3; CAM.orbitT = 0;
    TP.timeScale = 1; TP.paused = false;
    AU.crowd(0.35);
    TP.ui.hud.show(state);
    var intro = opts.driverId ? TP.driverLine(opts.driverId, 'intro') : '';
    TP.ui.announcer(intro || ('Next up, ' + p.name + ' in the ' + veh.name + '!'), { priority: 2 });
    TP.emit('pullStart', p);
    R3.pullUpdate = function (dt, realDt) { pullFrame(state, dt, realDt); };
  });
};
function pullFrame(S, dt, realDt) {
  var p = S.p, rig = S.rig;
  if (S.slowT > 0) { S.slowT -= realDt; if (S.slowT <= 0) TP.timeScale = 1; }
  var simDt = dt * S.ff;
  if (!p.done) {
    if (simDt > 0) {
      S.ctrl.update(p, simDt, S.input);
      TP.sim.step(p, simDt, S.input);
    }
  } else if (simDt > 0) TP.sim.coast(p, simDt);
  processEvents(S);
  if (p.done && S.endT < 0) onDone(S);
  poseRig(rig, p, simDt);
  rigEffects(rig, p, simDt);
  // audio
  var st = p.stats;
  S.voice.update(clamp((p.rpm - st.idle * 0.6) / (st.redline - st.idle * 0.6), 0, 1.1), p.broken ? 0 : p.throttle, 0, p.spool + (p.boostTimer > 0 ? 0.4 : 0), { limiter: p.limiter });
  AU.crowd(0.3 + 0.4 * p.sledBoxPos);
  CAM.shake = Math.max(CAM.shake, p.throttle * 0.25 * clamp(p.rpm / st.redline, 0, 1) + p.hop * 0.6);
  // live board + milestones
  var ft = (p.visDist != null ? p.visDist : p.dist) / C.FT;
  if (Math.abs(ft - S.lastBoard) >= 0.25 || (p.done && S.lastBoard !== ft)) { S.lastBoard = ft; if (TP.venueState && TP.venueState.board) TP.venueState.board.set(ft.toFixed(2), p.name.toUpperCase()); }
  if (!p.done && ft >= S.milestone + 50) { S.milestone += 50; if (S.milestone >= 150) { TP.ui.announcer(S.milestone + ' feet and still going!', { priority: 0 }); TP.cheer(0.25 + S.milestone / 600); } }
  // start tree
  var L = TP.venueState && TP.venueState.startLights;
  if (L) { var lt = p.status === 'staged' ? p.light : 'green'; for (var i = 0; i < 3; i++) { var on = ['red', 'yellow', 'green'][i] === lt; L[i].material.emissive.setHex(on ? [0xff2010, 0xffc000, 0x20ff40][i] : 0); L[i].material.color.setHex(on ? 0xffffff : 0x222222); } }
  TP.ui.hud.update(S, dt);
  TP.emit('pullUpdate', p, simDt);
  if (S.endT >= 0) {
    S.endT -= realDt * (S.ff > 1 ? 2 : 1);
    if (S.endT <= 0) finishPull(S);
  }
}
function processEvents(S) {
  var p = S.p, ev = p.events;
  while (S.evIdx < ev.length) {
    var e = ev[S.evIdx++];
    switch (e.type) {
      case 'launch':
        TP.emit('launch', p, e.data);
        AU.sfx('go');
        if (S.player) TP.ui.numberPop(({ perfect: 'PERFECT LAUNCH!', good: 'GOOD LAUNCH', late: 'LATE LAUNCH', early: 'JUMPED IT!' })[e.data], e.data === 'perfect' ? 'good' : (e.data === 'good' ? '' : 'bad'));
        if (e.data === 'perfect') TP.cheer(0.4);
        break;
      case 'shift': TP.emit('shift', p, e.data.gear); AU.sfx('shift'); p._popT = 0.18; if (S.player && e.data.quality === 'perfect') TP.ui.numberPop('PERFECT SHIFT', 'good'); if (S.player && e.data.quality === 'early') TP.ui.numberPop('EARLY SHIFT', 'bad'); break;
      case 'boost': TP.emit('boost', p); AU.sfx('whoosh'); CAM.shake = 1.2; if (S.player) TP.ui.numberPop('BOOST!', 'good'); break;
      case 'hop': TP.emit('hop', p); if (p.hop > 0.75) TP.ui.announcer(['She\'s HOPPING!', 'Wheel hop! Ease off!', 'Bouncing like a bronco!'][(Math.random() * 3) | 0], { priority: 1 }); break;
      case 'hook': AU.sfx('hook'); break;
      case 'breakdown': TP.emit('breakdown', p, e.data); blowUp(S.rig, p); TP.ui.announcer(e.data === 'engine' ? 'KABOOM! That engine is done for the day!' : 'Something in the driveline let go!', { priority: 3 }); break;
      case 'outOfBounds': TP.emit('outOfBounds', p); AU.sfx('horn'); TP.ui.announcer('Over the line! That is a disqualification.', { priority: 3 }); break;
    }
  }
}
function onDone(S) {
  var p = S.p, r = p.result;
  S.endT = p.status === 'fullPull' ? 4.5 : 2.6;
  if (p.status === 'fullPull') {
    TP.emit('fullPull', p);
    TP.timeScale = 0.35; S.slowT = 1.6; CAM.set('orbit'); CAM.orbitT = 0;
    TP.cheer(1.3); AU.sfx('horn');
    var v = TP.tmp.v3; S.rig.group.getWorldPosition(v);
    TP.fx.burst('confetti', v.x, 6, v.z, 120, { spread: 8, speed: 2, up: 0.3, colors: [0xffd23f, 0xff6a1a, 0x2565ae, 0xd23a2a, 0xf3efe6, 0x2e8b3d] });
    TP.ui.banner('FULL PULL!', p.name + ' — ' + p.trackLengthFt + ' ft', { kind: 'full' });
    TP.ui.announcer((p.driverId && TP.driverLine(p.driverId, 'full')) || 'FULL PULL! Listen to this crowd!', { priority: 3 });
  } else {
    var good = r.distanceFt >= S.best && S.best > 0 && !r.dq;
    if (r.dq) TP.ui.banner('DISQUALIFIED', 'Out of bounds', { kind: 'bad' });
    else TP.ui.banner(r.distanceText + ' ft', r.reason + (good ? ' — NEW BEST!' : ''), { kind: good ? 'good' : '' });
    if (!r.dq) TP.cheer(clamp(r.distanceFt / p.trackLengthFt, 0.1, 1) * 0.8);
    var line = p.driverId ? TP.driverLine(p.driverId, r.distanceFt / p.trackLengthFt > 0.85 ? 'good' : 'bad') : '';
    TP.ui.announcer(line || (r.distanceText + ' feet for ' + p.name + '!'), { priority: 2 });
  }
}
function finishPull(S) {
  var p = S.p, res = shallow(p.result);
  res.player = S.player; res.name = p.name; res.vehicleId = p.vehicleId; res.driverId = p.driverId; res.label = p.label;
  endActive(false);
  TP.emit('pullEnd', res);
  S.resolve(res);
}
function endActive(aborted) {
  var S = PR; if (!S) return;
  R3.pullUpdate = null; PR = TP.r3.pull = null;
  try { S.voice.stop(); } catch (e) {}
  TP.timeScale = 1; TP.paused = false; CAM.director = false;
  TP.ui.hud.hide();
  TP.disposeRig(S.rig);
  IN.reset();
  if (aborted && S.resolve) { var r = S.p.result || makeResult(S.p); r = shallow(r); r.aborted = true; r.player = S.player; r.name = S.p.name; S.resolve(r); }
}
/** Abort the active pull (resolves its promise with {aborted:true}). */
TP.abortPull = function () { endActive(true); };
TP.activePull = function () { return PR ? PR.p : null; };
/** Spectate fast-forward factor (1, 2, 4). */
TP.setFastForward = function (x) { if (PR) PR.ff = clamp(+x || 1, 0.25, 8); return PR ? PR.ff : 1; };
/** Skip: finish the active pull instantly via TP.sim and show the end. */
TP.skipPull = function () {
  if (!PR) return;
  var p = PR.p;
  if (!p.done) TP.sim.finish(p, PR.ctrl);
  p.visDist = p.dist;
  processEvents(PR);
  if (PR.endT < 0) { onDone(PR); }
  PR.endT = Math.min(PR.endT, 1.2); TP.timeScale = 1; PR.slowT = 0;
};

/* Menu showcase: a parked vehicle + sled in the venue behind the menus */
var SHOW = null;
TP.menuShowcase = function (vehicleId, livery) {
  hideMenuShowcase();
  if (!TP.venueState) TP.loadVenue('county_fair');
  vehicleId = vehicleId || (TP.garage.selected() && TP.garage.selected().vehicleId) || 'sd_thunderbolt';
  if (!TP.vehicles[vehicleId]) return;
  getSled();
  var rig = TP.buildRig(vehicleId, livery);
  TP.scene.add(rig.group);
  var fake = TP.sim.createPull({ vehicleId: vehicleId, seed: 1 });
  fake.travel = fake.slack; fake.dist = 0; fake.chainTaut = true;
  poseRig(rig, fake, 0);
  SHOW = { rig: rig, p: fake, acc: [] };
  CAM.follow(rig); CAM.set('menu');
  SHOW.voiceT = 0;
};
function hideMenuShowcase() { if (SHOW) { TP.disposeRig(SHOW.rig); SHOW = null; } }
TP.hideMenuShowcase = hideMenuShowcase;
TP.onFrame(function (dt) {
  if (!SHOW || R3.pullUpdate) return;
  var p = SHOW.p; p.throttle = 0.12 + 0.1 * Math.max(0, Math.sin(TP.time * 1.3)); p.rpm = p.stats.idle * (1 + p.throttle);
  rigEffects(SHOW.rig, p, dt * 0.6);
});

/* ---------------------------------------------------------------------------
 * 19. UI  TP.ui — screens, toasts, banners, announcer, HUD, menu buttons
 * ------------------------------------------------------------------------- */
var UI = TP.ui = { current: null, stack: [], menuItems: [], icons: {} };
function $(id) { return document.getElementById(id); }
UI.$ = $;
/** Inject CSS text (features use this for their own styles). Returns the <style>. */
UI.css = function (text) { var s = document.createElement('style'); s.textContent = text; document.head.appendChild(s); return s; };
/** Inline SVG icons (24x24, currentColor). Add with TP.ui.icons.name = '<path .../>'. */
UI.icons = {
  play: '<path d="M7 4l13 8-13 8z"/>',
  trophy: '<path d="M7 3h10v3h3v3a5 5 0 0 1-5 5 5 5 0 0 1-2 1.6V18h3v3H8v-3h3v-2.4A5 5 0 0 1 9 14a5 5 0 0 1-5-5V6h3zm-1 5v1a3 3 0 0 0 1.5 2.6V8zm11 0v3.6A3 3 0 0 0 18.5 9V8z"/>',
  eye: '<path d="M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z"/>',
  wrench: '<path d="M21 6.5a5.5 5.5 0 0 1-7.4 5.2L6.4 19a2 2 0 0 1-2.8-2.8l7.3-7.2A5.5 5.5 0 0 1 17.5 1.5L14 5l1 3 3 1z"/>',
  cart: '<path d="M3 3h3l2.5 11h10l2-8H7.2M9 21a1.6 1.6 0 1 0 0-.1zm9 0a1.6 1.6 0 1 0 0-.1z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
  gear: '<path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM10.5 2h3l.5 2.6 2 .9 2.2-1.5 2.1 2.1-1.5 2.2.9 2 2.6.5v3l-2.6.5-.9 2 1.5 2.2-2.1 2.1-2.2-1.5-2 .9-.5 2.6h-3l-.5-2.6-2-.9-2.2 1.5-2.1-2.1 1.5-2.2-.9-2L2 13.5v-3l2.6-.5.9-2L4 5.8 6.1 3.7l2.2 1.5 2-.9z"/>',
  back: '<path d="M15 4l-8 8 8 8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  pause: '<path d="M6 4h4v16H6zm8 0h4v16h-4z"/>',
  cam: '<path d="M4 7h3l2-2h6l2 2h3v12H4zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/>',
  ff: '<path d="M3 5l9 7-9 7zm9 0l9 7-9 7z"/>',
  skip: '<path d="M4 5l10 7-10 7zm12 0h3v14h-3z"/>',
  flag: '<path d="M5 3v18H3V3zm2 0h13l-3 4.5L20 12H7z"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  lock: '<path d="M7 10V7a5 5 0 0 1 10 0v3h2v11H5V10zm2 0h6V7a3 3 0 0 0-6 0z"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zm12.5-1.5a6 6 0 0 1 0 9M15 10a2.5 2.5 0 0 1 0 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  tractor: '<path d="M6 10h5V6h4l1 4h3a2 2 0 0 1 2 2v3h-2.2a3 3 0 0 0-5.6 0H10a4.5 4.5 0 0 0-8.6-1.5L3 10zm11.5 4.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM6 13a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z"/>',
  truck: '<path d="M2 7h11v8h1V9h4l4 4v4h-2a2.5 2.5 0 0 0-5 0H9a2.5 2.5 0 0 0-5 0H2zm4.5 8.5a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm11 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z"/>'
};
/** <svg> markup for an icon name. */
UI.icon = function (name, cls) { return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' + (UI.icons[name] || UI.icons.flag) + '</svg>'; };
/** Get/create a screen element <section class="screen" id="scr-ID">. If html is given, it replaces the content. */
UI.screen = function (id, html) {
  var el = $('scr-' + id);
  if (!el) { el = document.createElement('section'); el.className = 'screen'; el.id = 'scr-' + id; el.setAttribute('data-screen', id); $('screens').appendChild(el); }
  if (html != null) el.innerHTML = html;
  return el;
};
/** Register a renderable screen: TP.ui.register(id, {render(el, args), onShow?, onHide?, back?:'menu'}). */
UI.register = function (id, def) { TP.screens[id] = def; return def; };
/** Show a screen (renders it if registered). Hides other screens. */
UI.show = function (id, args) {
  var def = TP.screens[id];
  var el = UI.screen(id);
  if (def && def.render) { try { def.render(el, args || {}); } catch (e) { console.error('[TP] screen render failed', id, e); } }
  var all = document.querySelectorAll('#screens .screen');
  for (var i = 0; i < all.length; i++) if (all[i] !== el) { if (all[i].classList.contains('on')) { var pid = all[i].getAttribute('data-screen'); if (TP.screens[pid] && TP.screens[pid].onHide) TP.screens[pid].onHide(); } all[i].classList.remove('on'); }
  el.classList.add('on'); el.scrollTop = 0;
  if (id !== 'menu') { UI._ann.q.length = 0; UI._ann.cur = null; var an = $('announcer'); if (an) an.classList.remove('on'); }
  $('screens').classList.add('on');
  if (UI.current && UI.current !== id) UI.stack.push(UI.current);
  if (UI.stack.length > 20) UI.stack.shift();
  UI.current = id;
  if (def && def.onShow) def.onShow(el, args || {});
  TP.emit('screen', id, args);
  if (id === 'menu') TP.emit('menu');
  return el;
};
UI.go = UI.show;
/** Hide all screens (e.g. while pulling). */
UI.hide = function (id) {
  var all = document.querySelectorAll('#screens .screen.on');
  for (var i = 0; i < all.length; i++) { var sid = all[i].getAttribute('data-screen'); if (id && sid !== id) continue; all[i].classList.remove('on'); if (TP.screens[sid] && TP.screens[sid].onHide) TP.screens[sid].onHide(); }
  if (!document.querySelector('#screens .screen.on')) { $('screens').classList.remove('on'); UI.current = null; }
};
UI.back = function () { var prev = UI.stack.pop() || 'menu'; UI.current = null; UI.show(prev); };
/** Chunky button element. o = {primary, icon, small, cls, disabled, sub} */
UI.menuButton = function (label, fn, o) {
  o = o || {};
  var b = document.createElement('button');
  b.className = 'btn' + (o.primary ? ' primary' : '') + (o.small ? ' small' : '') + (o.cls ? ' ' + o.cls : '');
  b.innerHTML = (o.icon ? UI.icon(o.icon) : '') + '<span class="bl">' + esc(label) + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</span>';
  if (o.disabled) b.disabled = true;
  b.addEventListener('click', function (e) { AU.init(); AU.sfx('click'); try { fn && fn(e); } catch (err) { console.error(err); } });
  return b;
};
/** Standard screen header html: title + back button + cash/level chips. */
UI.header = function (title, o) {
  o = o || {};
  return '<header class="scr-head">' + (o.back === false ? '' : '<button class="btn icon back" data-back aria-label="Back">' + UI.icon('back') + '</button>') +
    '<h2>' + esc(title) + '</h2><div class="chips"><span class="chip cash">' + fmtCash(TP.save.cash) + '</span><span class="chip lvl">LVL ' + TP.save.level + '</span></div></header>';
};
/** Wire [data-back] and [data-go="screen"] inside a screen element. */
UI.wire = function (el, handlers) {
  el.onclick = function (e) {
    var t = e.target.closest('[data-back],[data-go],[data-act]');
    if (!t || !el.contains(t)) return;
    AU.init();
    if (t.hasAttribute('data-back')) { AU.sfx('click'); (handlers && handlers.back) ? handlers.back() : UI.back(); return; }
    if (t.hasAttribute('data-go')) { AU.sfx('click'); UI.show(t.getAttribute('data-go')); return; }
    var act = t.getAttribute('data-act');
    if (handlers && handlers[act]) { AU.sfx('click'); handlers[act](t.getAttribute('data-id'), t, e); }
  };
};
/** Small toast (bottom). kind: '' | 'good' | 'bad' */
UI.toast = function (text, kind, ms) {
  var host = $('toasts'); if (!host) return;
  var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = text;
  host.appendChild(t);
  setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, ms || 2400);
};
/** Big center banner. o = {kind:'full'|'good'|'bad', ms} */
UI.banner = function (title, sub, o) {
  o = o || {};
  var b = $('banner'); if (!b) return;
  b.className = 'on ' + (o.kind || '');
  b.innerHTML = '<div class="bt">' + esc(title) + '</div>' + (sub ? '<div class="bs">' + esc(sub) + '</div>' : '');
  clearTimeout(UI._bt); UI._bt = setTimeout(function () { b.className = ''; }, o.ms || 2600);
};
/** Announcer ticker (speech bubble). Higher priority replaces lower; equal queues. */
UI._ann = { q: [], cur: null, t: 0 };
UI.announcer = function (text, o) {
  if (!text) return;
  o = o || {}; var pr = o.priority || 0, A = UI._ann;
  if (A.cur && pr > A.cur.pr) { A.q.length = 0; showAnn({ text: text, pr: pr }); return; }
  if (!A.cur) { showAnn({ text: text, pr: pr }); return; }
  if (A.q.length < 3) A.q.push({ text: text, pr: pr });
  function showAnn(item) {
    A.cur = item; A.t = clamp(1.6 + item.text.length * 0.045, 2, 4.5);
    var el = $('announcer'); if (!el) return;
    el.innerHTML = '<b>' + UI.icon('sound') + '</b><span>' + esc(item.text) + '</span>';
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    if (item.pr >= 2) AU.sfx('chime', { volume: 0.5 });
    TP.emit('announce', item.text, item.pr);
  }
  UI._showAnn = showAnn;
};
TP.onFrame(function (dt, realDt) {
  var A = UI._ann; if (!A.cur) return;
  A.t -= realDt;
  if (A.t <= 0) { A.cur = null; if (A.q.length) UI._showAnn(A.q.shift()); else { var el = $('announcer'); if (el) el.classList.remove('on'); } }
});
/** Floating text pop near the center ("PERFECT SHIFT"). kind '' | 'good' | 'bad' */
UI.numberPop = function (text, kind) {
  var host = $('pops'); if (!host) return;
  var d = document.createElement('div'); d.className = 'pop ' + (kind || ''); d.textContent = text;
  host.appendChild(d); setTimeout(function () { d.remove(); }, 1300);
};
/** Main menu entries: {id, label, icon, primary, order, action()} — features may push/replace by id. */
UI.addMenuItem = function (item) {
  var i = UI.menuItems.findIndex(function (m) { return m.id === item.id; });
  if (i >= 0) UI.menuItems[i] = item; else UI.menuItems.push(item);
  UI.menuItems.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
};
UI.addMenuItem({ id: 'play', label: 'Quick Pull', sub: 'Pick a class, hook up, go', icon: 'play', primary: true, order: 10, action: function () { UI.show('quick'); } });
UI.addMenuItem({ id: 'career', label: 'Career', sub: 'Fair season & points', icon: 'trophy', order: 20, action: function () { UI.show('career'); } });
UI.addMenuItem({ id: 'watch', label: 'Watch', sub: 'Spectate AI pulls', icon: 'eye', order: 30, action: function () { UI.show('watch'); } });
UI.addMenuItem({ id: 'garage', label: 'Garage', sub: 'Upgrades & paint', icon: 'wrench', order: 40, action: function () { UI.show('garage'); } });
UI.addMenuItem({ id: 'shop', label: 'Shop', icon: 'cart', order: 50, action: function () { UI.show('shop'); } });
UI.addMenuItem({ id: 'settings', label: 'Settings', icon: 'gear', order: 60, action: function () { UI.show('settings'); } });

/* ---- HUD ---- */
var HUD = UI.hud = {
  el: null, on: false, _c: {}, _tachCtx: null,
  /** Show the HUD for a pull render state (called by runPull). */
  show: function (S) {
    HUD.el = $('hud'); if (!HUD.el) return;
    HUD.on = true; HUD._c = {};
    HUD.el.classList.remove('hidden');
    HUD.el.classList.toggle('spectate', !S.player);
    var ctr = $('controls'); if (ctr) ctr.classList.toggle('hidden', !S.player);
    $('btnPause').classList.remove('hidden'); $('btnCam').classList.remove('hidden');
    var p = S.p, veh = TP.vehicles[p.vehicleId], cls = TP.classes[p.classId];
    setTxt('h-name', p.name + ' · ' + veh.name);
    setTxt('h-class', cls.name.toUpperCase());
    $('h-best').style.left = clamp(S.best / p.trackLengthFt * 100, 0, 100) + '%';
    $('h-best').style.display = S.best > 0 ? '' : 'none';
    setTxt('h-besttxt', S.best > 0 ? 'TO BEAT ' + S.best.toFixed(2) : '');
    var pips = $('h-boost'); pips.innerHTML = '';
    for (var i = 0; i < p.stats.boostShots; i++) pips.appendChild(UI.$el('i'));
    pips.parentNode.style.display = p.stats.boostShots ? '' : 'none';
    var bb = $('btnBoost'); if (bb) bb.style.display = p.stats.boostShots ? '' : 'none';
    var tc = $('tach'); HUD._tachCtx = tc ? tc.getContext('2d') : null;
    HUD.setFF(1);
    TP.emit('hudShow', S);
  },
  hide: function () { HUD.on = false; var h = $('hud'); if (h) h.classList.add('hidden'); var c = $('controls'); if (c) c.classList.add('hidden'); var bp = $('btnPause'); if (bp) bp.classList.add('hidden'); var bc = $('btnCam'); if (bc) bc.classList.add('hidden'); },
  setFF: function (x) { var b = document.querySelectorAll('#h-spec [data-ff]'); for (var i = 0; i < b.length; i++) b[i].classList.toggle('on', +b[i].getAttribute('data-ff') === x); },
  update: function (S, dt) {
    if (!HUD.on) return;
    var p = S.p, st = p.stats, c = HUD._c;
    var ft = (p.visDist != null ? p.visDist : p.dist) / C.FT;
    setTxtC('h-ft', ft.toFixed(2));
    var prog = clamp(ft / p.trackLengthFt, 0, 1);
    if (Math.abs((c.prog || 0) - prog) > 0.002) { c.prog = prog; $('h-prog').style.width = (prog * 100).toFixed(1) + '%'; }
    setTxtC('h-gear', p.status === 'staged' ? 'N' : String(p.gear + 1));
    setTxtC('h-mph', (p.speed * C.MPH).toFixed(1));
    var shiftOn = p.gear < st.gears.length - 1 && p.rpm >= st.shiftRpm * 0.97 && p.status !== 'staged';
    toggleC('h-shiftl', 'on', shiftOn); toggleC('btnShift', 'lit', shiftOn);
    toggleC('h-shiftl', 'over', p.limiter);
    // slip meter
    var sr = p.status === 'staged' ? 0 : clamp(p.slip / (p.idealSlip * 2.6), 0, 1);
    if (Math.abs((c.sr || 0) - sr) > 0.004) { c.sr = sr; $('h-slipm').style.left = (sr * 100).toFixed(1) + '%'; }
    var zone = p.slip < p.idealSlip * 0.55 ? 'low' : (p.slip > p.idealSlip * 1.45 ? 'high' : 'ok');
    if (p.status === 'staged') zone = 'idle';
    if (c.zone !== zone) { c.zone = zone; $('h-slip').setAttribute('data-zone', zone); setTxt('h-sliptxt', ({ low: 'BOGGING', high: 'SPINNING', ok: 'HOOKED UP', idle: 'TRACTION' })[zone]); }
    toggleC('h-hop', 'on', p.hop > 0.45);
    // temp
    var tp = clamp((p.temp - 0.2) / 0.8, 0, 1);
    if (Math.abs((c.tp || 0) - tp) > 0.005) { c.tp = tp; $('h-tempf').style.width = (tp * 100).toFixed(0) + '%'; }
    toggleC('h-temp', 'hot', p.temp > 0.88);
    // boost pips
    if (c.boost !== p.boostLeft + (p.boostTimer > 0 ? 100 : 0)) {
      c.boost = p.boostLeft + (p.boostTimer > 0 ? 100 : 0);
      var pp = $('h-boost').children; for (var i = 0; i < pp.length; i++) pp[i].className = i < p.boostLeft ? 'full' : '';
      toggleC('h-boostw', 'live', p.boostTimer > 0); toggleC('btnBoost', 'empty', p.boostLeft <= 0);
    }
    // lane
    var room = Math.max(0.3, p.laneHalf - p.halfWidth);
    var ln = clamp(p.lateral / room, -1, 1);
    if (Math.abs((c.ln || 0) - ln) > 0.005) { c.ln = ln; $('h-lanem').style.left = (50 + ln * 46).toFixed(1) + '%'; }
    toggleC('h-lane', 'warn', Math.abs(ln) > 0.7);
    // start tree
    var tree = p.status === 'staged' ? p.light : (p.t - p.launchT < 1.2 && p.launchT >= 0 ? 'go' : 'off');
    if (c.tree !== tree) {
      c.tree = tree; var tr = $('h-tree'); tr.setAttribute('data-light', tree);
      setTxt('h-treetxt', tree === 'red' ? 'STAGED' : tree === 'yellow' ? 'GET READY...' : tree === 'green' ? 'GO GO GO!' : tree === 'go' ? (p.launch ? p.launch.toUpperCase() : 'GO!') : '');
      if (tree === 'yellow' || tree === 'red') AU.sfx('light');
    }
    if (!p.done && p.status === 'staged' && S.player) setTxtC('h-hint', p.light === 'green' ? 'HIT THE THROTTLE!' : ((IN.usingTouch || (W.matchMedia && W.matchMedia('(pointer: coarse)').matches)) ? 'Hold THROTTLE on GREEN' : 'Press W / ↑ on GREEN'));
    else setTxtC('h-hint', '');
    if (S.player) { var pf = Math.round(IN.pedal * 100); if (c.pf !== pf) { c.pf = pf; $('pfill').style.height = pf + '%'; } }
    HUD.drawTach(p);
  },
  drawTach: function (p) {
    var g = HUD._tachCtx; if (!g) return;
    var st = p.stats, w = g.canvas.width, h = g.canvas.height, cx = w / 2, cy = h / 2, R = w * 0.44;
    var maxR = st.redline * 1.1, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.clearRect(0, 0, w, h);
    g.lineCap = 'butt';
    g.lineWidth = w * 0.07; g.strokeStyle = 'rgba(255,244,220,0.18)'; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
    var ar = a0 + (a1 - a0) * (st.redline / maxR);
    g.strokeStyle = '#d23a2a'; g.beginPath(); g.arc(cx, cy, R, ar, a1); g.stroke();
    var as = a0 + (a1 - a0) * (st.shiftRpm / maxR);
    g.strokeStyle = '#3fbf5a'; g.beginPath(); g.arc(cx, cy, R, as - 0.08, as + 0.08); g.stroke();
    var rn = clamp(p.rpm / maxR, 0, 1), an = a0 + (a1 - a0) * rn;
    g.strokeStyle = p.limiter ? '#ff3b1a' : '#ffd23f'; g.lineWidth = w * 0.07; g.beginPath(); g.arc(cx, cy, R, a0, an); g.stroke();
    g.strokeStyle = '#fff4dc'; g.lineWidth = w * 0.025; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(an) * R * 0.92, cy + Math.sin(an) * R * 0.92); g.stroke();
    g.fillStyle = '#fff4dc'; g.font = '700 ' + Math.round(w * 0.085) + 'px "Saira Condensed", sans-serif'; g.textAlign = 'center';
    g.fillText(Math.round(p.rpm / 10) * 10 + ' RPM', cx, cy + R * 0.78);
  }
};
function setTxt(id, t) { var e = $(id); if (e && e.textContent !== t) e.textContent = t; }
function setTxtC(id, t) { var c = HUD._c; if (c['t' + id] === t) return; c['t' + id] = t; var e = $(id); if (e) e.textContent = t; }
function toggleC(id, cls, on) { var c = HUD._c, k = 'c' + id + cls; if (c[k] === on) return; c[k] = on; var e = $(id); if (e) e.classList.toggle(cls, on); }
UI.$el = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
/** A named HUD slot element (existing [data-slot=name] in #hud, or a new div in #hud-extra). */
UI.hudSlot = function (name) {
  var e = document.querySelector('#hud [data-slot="' + name + '"]');
  if (e) return e;
  e = document.createElement('div'); e.className = 'hud-slot slot-' + name; e.setAttribute('data-slot', name);
  $('hud-extra').appendChild(e); return e;
};

/* ---- Pause ---- */
TP.pause = function () {
  if (!R3.pullUpdate || TP.paused) return;
  TP.paused = true; if (AU.ctx && AU.ready) { try { AU.ctx.suspend(); } catch (e) {} }
  UI.show('pause'); TP.emit('pause');
};
TP.resume = function () {
  if (!TP.paused) return;
  TP.paused = false; if (AU.ctx && AU.ready) { try { AU.ctx.resume(); } catch (e) {} }
  UI.hide('pause'); IN.reset(); TP.emit('resume');
};
TP.on('pauseKey', function () { if (TP.paused) TP.resume(); else if (R3.pullUpdate) TP.pause(); else if (UI.current && UI.current !== 'menu') UI.back(); });
TP.on('hidden', function () { if (R3.pullUpdate && PR && PR.player && !PR.p.done) TP.pause(); });
TP.on('cameraKey', function () { if (R3.pullUpdate) { CAM.director = false; var m = CAM.cycle(); UI.toast('Camera: ' + CAM.names[m]); } });
UI.register('pause', {
  render: function (el) {
    el.innerHTML = '<div class="panel narrow center"><h2 class="big">PAUSED</h2><div class="stackb"></div></div>';
    var s = el.querySelector('.stackb');
    s.appendChild(UI.menuButton('Resume', TP.resume, { primary: true, icon: 'play' }));
    s.appendChild(UI.menuButton('Camera: ' + CAM.names[CAM.mode], function (e) { CAM.director = false; var m = CAM.cycle(); e.currentTarget.querySelector('.bl').textContent = 'Camera: ' + CAM.names[m]; if (PR && PR.player) { TP.save.settings.camera = m; TP.store(); } }, { icon: 'cam' }));
    s.appendChild(UI.menuButton('Sound: ' + (TP.save.settings.sound ? 'ON' : 'OFF'), function (e) { TP.save.settings.sound = !TP.save.settings.sound; TP.store(); AU.setMuted(!TP.save.settings.sound); e.currentTarget.querySelector('.bl').textContent = 'Sound: ' + (TP.save.settings.sound ? 'ON' : 'OFF'); }, { icon: 'sound' }));
    s.appendChild(UI.menuButton('Quit to menu', function () { TP.paused = false; if (AU.ctx) try { AU.ctx.resume(); } catch (e) {} UI.hide('pause'); TP.abortPull(); setTimeout(function () { if (!UI.current && !R3.pullUpdate) TP.toMenu(); }, 0); }, { icon: 'back' }));
  }
});

/* ---------------------------------------------------------------------------
 * 20. SCREENS: menu, quick pull, results, watch, garage, shop, settings, career
 *   (features replace/extend these via TP.ui.register(id, def) and TP.ui.addMenuItem)
 * ------------------------------------------------------------------------- */
TP.toMenu = function () {
  if (R3.pullUpdate) TP.abortPull();
  TP.paused = false; TP.timeScale = 1;
  UI.stack.length = 0; UI.current = null;
  TP.loadVenue((TP.venueState && TP.venueState.id) || 'county_fair');
  var g = TP.garage.selected();
  TP.menuShowcase(g ? g.vehicleId : null, g ? g.livery : null);
  UI.show('menu');
};
UI.register('menu', {
  render: function (el) {
    var cls = TP.classList().length, veh = Object.keys(TP.vehicles).length;
    el.innerHTML = '<div class="menu-wrap"><div class="menu-col">' +
      '<div class="logo"><div class="logo-top">COUNTY FAIR</div><div class="logo-main">FULL<span>PULL</span></div><div class="logo-sub">Truck &amp; Tractor Pulling</div></div>' +
      '<div class="menu-btns"></div>' +
      '<div class="menu-foot"><span class="chip cash">' + fmtCash(TP.save.cash) + '</span><span class="chip lvl">LVL ' + TP.save.level + '</span><span class="chip">' + cls + ' classes · ' + veh + ' rigs</span></div>' +
      '</div><div class="menu-right"><div class="rotate-tip">' + UI.icon('play') + ' Best played in landscape</div></div></div>';
    var host = el.querySelector('.menu-btns');
    UI.menuItems.forEach(function (m) { if (m.hidden) return; host.appendChild(UI.menuButton(m.label, m.action, { primary: m.primary, icon: m.icon, sub: m.sub })); });
  },
  onShow: function () { if (!SHOW && !R3.pullUpdate) { var g = TP.garage.selected(); TP.menuShowcase(g ? g.vehicleId : null, g ? g.livery : null); } }
});

/** Vehicle card html. */
UI.vehicleCard = function (v, o) {
  o = o || {};
  var s = v.specs || {}, locked = TP.save.level < v.levelReq;
  return '<button class="card veh' + (o.sel ? ' sel' : '') + (locked && !o.allowLocked ? ' locked' : '') + '" data-act="' + (o.act || 'veh') + '" data-id="' + esc(o.id || v.id) + '">' +
    '<div class="swatch" style="background:' + esc((v.liveries[0] && v.liveries[0].base) || '#888') + '"><span>' + esc((v.liveries[0] && v.liveries[0].number) || '') + '</span></div>' +
    '<div class="ct"><b>' + esc(v.name) + '</b><small>' + esc(v.brand || '') + '</small>' +
    '<div class="specs"><span>' + fmtNum(s.hp || 0) + ' hp</span><span>' + fmtNum(s.weight || 0) + ' lb</span><span>' + (s.gears ? s.gears.length : 0) + ' gears</span></div>' +
    (o.tag ? '<em class="tag">' + esc(o.tag) + '</em>' : '') + (locked && !o.allowLocked ? '<em class="tag lock">' + UI.icon('lock') + ' LVL ' + v.levelReq + '</em>' : '') + '</div></button>';
};
/** Class card html. */
UI.classCard = function (c, o) {
  o = o || {};
  var n = TP.vehiclesInClass(c.id).length, best = TP.save.stats.bestByClass[c.id];
  return '<button class="card cls' + (o.sel ? ' sel' : '') + (n ? '' : ' empty') + '" data-act="' + (o.act || 'cls') + '" data-id="' + c.id + '">' +
    UI.icon(c.group === 'tractor' ? 'tractor' : 'truck', 'cico') + '<div class="ct"><b>' + esc(c.name) + '</b>' +
    '<small>' + fmtNum(c.weightLimit) + ' lb · ' + fmtNum(c.hpRange[0]) + '–' + fmtNum(c.hpRange[1]) + ' hp</small>' +
    '<div class="diff">' + '<i class="on"></i>'.repeat(c.difficulty) + '<i></i>'.repeat(Math.max(0, 5 - c.difficulty)) + '</div>' +
    (n ? (best ? '<em class="tag">BEST ' + best.toFixed(2) + ' ft</em>' : '') : '<em class="tag">NO RIGS YET</em>') + '</div></button>';
};

/* Quick Pull: class -> vehicle -> venue -> go */
var QP = { group: 'truck', cls: 'street_diesel', veh: null, venue: 'county_fair' };
TP.quick = QP;
/** Player garage entry for a vehicle (or a loaner {uid:null, vehicleId, upgrades:{}, livery:{}}). */
TP.playerEntry = function (vehicleId) { return TP.garage.findByVehicle(vehicleId) || { uid: null, vehicleId: vehicleId, upgrades: {}, livery: {}, loaner: true }; };
UI.register('quick', {
  render: function (el) {
    if (!TP.classes[QP.cls]) QP.cls = 'street_diesel';
    QP.group = TP.classes[QP.cls].group;
    var vehs = TP.vehiclesInClass(QP.cls);
    if (!QP.veh || !TP.vehicles[QP.veh] || TP.vehicles[QP.veh].class !== QP.cls) {
      var own = vehs.filter(function (v) { return TP.garage.owns(v.id); })[0];
      QP.veh = own ? own.id : (vehs[0] ? vehs[0].id : null);
    }
    var venues = Object.keys(TP.venues).map(function (k) { return TP.venues[k]; });
    var h = UI.header('Quick Pull') + '<div class="scr-body">' +
      '<div class="tabs"><button class="tab' + (QP.group === 'truck' ? ' on' : '') + '" data-act="grp" data-id="truck">' + UI.icon('truck') + ' Trucks</button><button class="tab' + (QP.group === 'tractor' ? ' on' : '') + '" data-act="grp" data-id="tractor">' + UI.icon('tractor') + ' Tractors</button></div>' +
      '<h3>Class</h3><div class="grid cls-grid">' + TP.classList(QP.group).map(function (c) { return UI.classCard(c, { sel: c.id === QP.cls }); }).join('') + '</div>' +
      '<p class="desc">' + esc(TP.classes[QP.cls].desc) + '</p>' +
      '<h3>Vehicle</h3><div class="grid veh-grid">' + (vehs.length ? vehs.map(function (v) { return UI.vehicleCard(v, { sel: v.id === QP.veh, tag: TP.garage.owns(v.id) ? 'OWNED' : 'TEST RIDE' }); }).join('') : '<p class="muted">No vehicles in this class yet.</p>') + '</div>' +
      '<h3>Venue</h3><div class="row wrap">' + venues.map(function (v) { var lk = TP.save.level < (v.levelReq || 1); return '<button class="chipbtn' + (v.id === QP.venue ? ' on' : '') + (lk ? ' locked' : '') + '" data-act="ven" data-id="' + v.id + '">' + esc(v.name) + (lk ? ' · LVL ' + v.levelReq : '') + '</button>'; }).join('') + '</div>' +
      '<div class="sticky-go"><button class="btn primary go" data-act="go"' + (QP.veh ? '' : ' disabled') + '>' + UI.icon('flag') + '<span class="bl">HOOK UP &amp; PULL</span></button></div></div>';
    el.innerHTML = h;
    UI.wire(el, {
      grp: function (id) { QP.group = id; var first = TP.classList(id).filter(function (c) { return TP.vehiclesInClass(c.id).length; })[0] || TP.classList(id)[0]; QP.cls = first.id; QP.veh = null; UI.screens_rerender('quick'); },
      cls: function (id) { QP.cls = id; QP.veh = null; UI.screens_rerender('quick'); },
      veh: function (id) { if (TP.save.level < TP.vehicles[id].levelReq) { UI.toast('Reach level ' + TP.vehicles[id].levelReq + ' to drive this one', 'bad'); return; } QP.veh = id; UI.screens_rerender('quick'); var e = TP.playerEntry(id); TP.menuShowcase(id, e.livery); },
      ven: function (id) { if (TP.save.level < (TP.venues[id].levelReq || 1)) { UI.toast('Venue unlocks at level ' + TP.venues[id].levelReq, 'bad'); return; } QP.venue = id; TP.loadVenue(id); var e = TP.playerEntry(QP.veh); TP.menuShowcase(QP.veh, e.livery); UI.screens_rerender('quick'); },
      go: function () { if (QP.veh) TP.startQuickPull(QP.veh, QP.venue); }
    });
  }
});
/** Re-render a screen in place (keeps scroll). */
UI.screens_rerender = function (id) { var el = UI.screen(id), sc = el.scrollTop; var b = el.querySelector('.scr-body'), bs = b ? b.scrollTop : 0; TP.screens[id].render(el, {}); el.scrollTop = sc; b = el.querySelector('.scr-body'); if (b) b.scrollTop = bs; };
UI.rerender = UI.screens_rerender;

/** Start a player quick pull. Resolves with the result after the results screen is shown. */
TP.startQuickPull = function (vehicleId, venueId, o) {
  o = o || {};
  vehicleId = vehicleId || QP.veh || 'sd_thunderbolt';
  var e = TP.playerEntry(vehicleId);
  UI.hide();
  return TP.runPull({ vehicleId: vehicleId, upgrades: e.upgrades, livery: e.livery, controller: o.controller || 'player', venue: venueId || QP.venue, name: o.name || 'You', trackCondition: o.trackCondition, seed: o.seed, label: 'quick' })
    .then(function (res) {
      if (!res || res.aborted) { if (!UI.current) TP.toMenu(); return res; }
      var rew = TP.rewardFor(res, { mult: 0.35 });
      TP.addCash(rew.cash, 'quickPull'); TP.addXP(rew.xp);
      UI.show('results', { result: res, reward: rew, again: function () { TP.startQuickPull(vehicleId, venueId, o); } });
      return res;
    });
};
/** Cash/XP for a result. o.mult scales cash (quick pull 0.35, events use purse instead). */
TP.rewardFor = function (res, o) {
  o = o || {};
  var cls = TP.classes[res.classId] || {};
  if (res.dq) return { cash: 0, xp: 10 };
  var cash = Math.round(res.distanceFt * (cls.payPerFt || 7) * (o.mult != null ? o.mult : 0.35) + (res.fullPull ? 400 * (cls.difficulty || 1) : 0));
  var xp = Math.round(res.distanceFt / 3 + (res.fullPull ? 60 : 0) + (res.launch === 'perfect' ? 15 : 0));
  return { cash: cash, xp: xp };
};
/* Record player stats on every pull end */
TP.on('pullEnd', function (r) {
  if (!r || !r.player || r.aborted) return;
  var s = TP.save.stats;
  s.pulls++; s.totalFt += r.distanceFt;
  if (r.fullPull) s.fullPulls++;
  if (r.broken) s.breakdowns++;
  if (r.dq) s.outs++;
  if (r.launch === 'perfect') s.perfectLaunches++;
  if (!r.dq) {
    r.newBest = r.distanceFt > (s.bestByClass[r.classId] || 0);
    if (r.newBest) s.bestByClass[r.classId] = r.distanceFt;
    if (r.distanceFt > (s.bestByVehicle[r.vehicleId] || 0)) s.bestByVehicle[r.vehicleId] = r.distanceFt;
  }
  TP.store();
});
TP.on('pullEnd', function (r) { if (r && !r.player && !r.aborted) { TP.save.stats.watched++; } });

UI.register('results', {
  render: function (el, a) {
    var r = a.result || {}, rew = a.reward || { cash: 0, xp: 0 }, cls = TP.classes[r.classId] || {}, veh = TP.vehicles[r.vehicleId] || {};
    el.innerHTML = '<div class="panel results ' + (r.fullPull ? 'full' : '') + '"><div class="res-top"><small>' + esc(cls.name || '') + ' · ' + esc(veh.name || '') + '</small>' +
      '<div class="res-dist">' + (r.dq ? 'DQ' : r.distanceText) + (r.dq ? '' : '<span> ft</span>') + '</div>' +
      '<div class="res-reason">' + (r.fullPull ? 'FULL PULL!' : esc(r.reason || '')) + (r.newBest ? ' · <b>NEW BEST</b>' : '') + '</div></div>' +
      '<div class="statgrid"><div><small>Launch</small><b>' + esc((r.launch || '-').toUpperCase()) + '</b></div><div><small>Top speed</small><b>' + (r.topSpeed || 0).toFixed(1) + ' mph</b></div>' +
      '<div><small>Max hop</small><b>' + Math.round((r.maxHop || 0) * 100) + '%</b></div><div><small>Pull time</small><b>' + (r.time || 0).toFixed(2) + ' s</b></div></div>' +
      '<div class="rewards"><span class="chip cash">+' + fmtCash(rew.cash) + '</span><span class="chip lvl">+' + rew.xp + ' XP</span></div>' +
      '<div class="row center btnrow"></div></div>';
    var row = el.querySelector('.btnrow');
    if (a.again) row.appendChild(UI.menuButton('Pull again', a.again, { primary: true, icon: 'flag' }));
    if (a.next) row.appendChild(UI.menuButton(a.nextLabel || 'Continue', a.next, { primary: !a.again, icon: 'play' }));
    if (!a.next) row.appendChild(UI.menuButton('Change rig', function () { TP.toMenu(); UI.show('quick'); }, { icon: 'wrench' }));
    if (!a.next) row.appendChild(UI.menuButton('Menu', TP.toMenu, { icon: 'back' }));
    if (r.fullPull) AU.sfx('coin');
  }
});

/* Watch: spectate AI pulls of any class */
var WT = { group: 'truck', cls: 'street_diesel', last: null };
UI.register('watch', {
  render: function (el) {
    if (!TP.classes[WT.cls]) WT.cls = 'street_diesel';
    var field = TP.event.fieldFor(WT.cls, 5);
    var h = UI.header('Watch') + '<div class="scr-body">' +
      '<div class="tabs"><button class="tab' + (WT.group === 'truck' ? ' on' : '') + '" data-act="grp" data-id="truck">' + UI.icon('truck') + ' Trucks</button><button class="tab' + (WT.group === 'tractor' ? ' on' : '') + '" data-act="grp" data-id="tractor">' + UI.icon('tractor') + ' Tractors</button></div>' +
      '<div class="grid cls-grid">' + TP.classList(WT.group).map(function (c) { return UI.classCard(c, { sel: c.id === WT.cls }); }).join('') + '</div>' +
      (WT.last ? '<p class="lastres">Last pull: <b>' + esc(WT.last.name) + '</b> — ' + (WT.last.dq ? 'DQ' : WT.last.distanceText + ' ft') + (WT.last.fullPull ? ' · FULL PULL' : '') + '</p>' : '') +
      '<h3>Drivers in ' + esc(TP.classes[WT.cls].name) + '</h3>' +
      (field.length ? '<div class="list">' + field.map(function (d) {
        var v = TP.vehicles[d.vehicleId] || {};
        return '<div class="lrow"><span class="dot" style="background:' + esc(d.color || (d.livery && d.livery.base) || '#ffd23f') + '"></span><div class="lt"><b>' + esc(d.name) + (d.nickname ? ' “' + esc(d.nickname) + '”' : '') + '</b><small>' + esc(d.hometown || '') + ' · ' + esc(v.name || '') + ' · ' + esc(skillName(d.skill)) + '</small></div>' +
          '<button class="btn small" data-act="one" data-id="' + esc(d.id) + '">' + UI.icon('eye') + '<span class="bl">Watch</span></button></div>';
      }).join('') + '</div><div class="sticky-go"><button class="btn primary go" data-act="heat">' + UI.icon('play') + '<span class="bl">WATCH A FULL HEAT</span></button></div>' : '<p class="muted">No rigs in this class yet.</p>') + '</div>';
    el.innerHTML = h;
    UI.wire(el, {
      grp: function (id) { WT.group = id; WT.cls = (TP.classList(id).filter(function (c) { return TP.vehiclesInClass(c.id).length; })[0] || TP.classList(id)[0]).id; UI.rerender('watch'); },
      cls: function (id) { WT.cls = id; UI.rerender('watch'); },
      one: function (id) { TP.watchPulls([id]); },
      heat: function () { TP.watchPulls(field.map(function (d) { return d.id; }), { heat: true }); }
    });
  }
});
function skillName(s) {
  if (!s) return 'Good';
  var v = (s.reaction + s.throttleFeel + s.shiftTiming + s.steering + s.consistency) / 5;
  return v > 0.9 ? 'Legend' : v > 0.75 ? 'Pro' : v > 0.5 ? 'Veteran' : v > 0.3 ? 'Novice' : 'Rookie';
}
TP.skillName = skillName;
/** Spectate a list of driver ids in sequence (fast-forward/skip available). Resolves with results[]. */
TP.watchPulls = function (driverIds, o) {
  o = o || {};
  var results = [], i = 0, venue = o.venue || (TP.venueState && TP.venueState.id) || 'county_fair';
  UI.hide();
  var tc0 = TP.venues[venue] && TP.venues[venue].trackCondition != null ? TP.venues[venue].trackCondition : 0.2;
  function next() {
    if (i >= driverIds.length) {
      if (o.heat && results.length > 1) { UI.show('standings', { title: 'Heat results', rows: TP.event.rank(results), done: function () { TP.toMenu(); UI.show('watch'); } }); }
      else { TP.toMenu(); UI.show('watch'); }
      return Promise.resolve(results);
    }
    var d = TP.drivers[driverIds[i]];
    var tc = clamp(tc0 + i * 0.04, 0, 1); i++;
    return TP.runPull({ vehicleId: d.vehicleId, livery: d.livery, upgrades: d.upgrades, driverId: d.id, controller: 'ai', skill: d.skill, spectate: true, venue: venue, trackCondition: tc, label: 'watch' })
      .then(function (r) { if (!r || r.aborted) { results.aborted = true; return results; } r.entrant = d; results.push(r); WT.last = r; return next(); });
  }
  return next();
};

/* Garage */
var GA = { uid: null };
UI.register('garage', {
  render: function (el) {
    var list = TP.garage.list();
    if (!GA.uid || !TP.garage.get(GA.uid)) GA.uid = TP.save.selected;
    var g = TP.garage.get(GA.uid) || list[0];
    var h = UI.header('Garage') + '<div class="scr-body">';
    h += '<div class="grid veh-grid">' + list.map(function (e) { var v = TP.vehicles[e.vehicleId]; if (!v) return ''; return UI.vehicleCard(v, { id: e.uid, sel: g && e.uid === g.uid, tag: e.uid === TP.save.selected ? 'ACTIVE' : (TP.classes[v.class] || {}).name, allowLocked: true }); }).join('') + '</div>';
    if (g && TP.vehicles[g.vehicleId]) {
      var v = TP.vehicles[g.vehicleId], st = TP.sim.vehicleStats(g.vehicleId, g.upgrades);
      h += '<div class="garage-detail"><div class="gd-head"><h3>' + esc(v.brand || '') + ' ' + esc(v.name) + '</h3>' +
        (g.uid === TP.save.selected ? '<span class="chip">ACTIVE</span>' : '<button class="btn small" data-act="sel">Make active</button>') +
        '<button class="btn small primary" data-act="pull">' + UI.icon('flag') + '<span class="bl">Pull</span></button></div>' +
        '<div class="statgrid"><div><small>Power</small><b>' + fmtNum(st.hp) + ' hp</b></div><div><small>Torque</small><b>' + fmtNum(st.torqueLbft) + ' lb-ft</b></div><div><small>Weight</small><b>' + fmtNum(st.weightLb) + ' lb</b></div><div><small>Grip</small><b>' + st.mu.toFixed(3) + '</b></div></div>' +
        '<h3>Paint</h3><div class="row wrap">' + v.liveries.map(function (lv, i) { var on = (g.livery && g.livery.name === lv.name) || (!g.livery.name && i === 0); return '<button class="chipbtn livery' + (on ? ' on' : '') + '" data-act="liv" data-id="' + i + '"><i style="background:' + esc(lv.base) + ';border-color:' + esc(lv.accent) + '"></i>' + esc(lv.name || ('Livery ' + (i + 1))) + '</button>'; }).join('') + '</div>' +
        '<h3>Upgrades</h3><div class="list">' + Object.keys(TP.upgrades).map(function (uid) {
          var u = TP.upgrades[uid]; if (!TP.upgradeApplies(u, g.vehicleId)) return '';
          var lvl = g.upgrades[uid] | 0, next = u.levels[lvl];
          return '<div class="lrow"><div class="lt"><b>' + esc(u.name) + '</b><small>' + esc(u.desc || u.slot) + '</small><div class="lvl">' + u.levels.map(function (x, k) { return '<i class="' + (k < lvl ? 'on' : '') + '"></i>'; }).join('') + '</div></div>' +
            (next ? '<button class="btn small' + (TP.save.cash >= next.price ? ' primary' : '') + '" data-act="up" data-id="' + uid + '"' + (next.levelReq && TP.save.level < next.levelReq ? ' disabled' : '') + '><span class="bl">' + (next.levelReq && TP.save.level < next.levelReq ? 'LVL ' + next.levelReq : fmtCash(next.price)) + '</span></button>' : '<span class="chip">MAX</span>') + '</div>';
        }).join('') + '</div></div>';
    }
    h += '</div>';
    el.innerHTML = h;
    UI.wire(el, {
      veh: function (uid) { GA.uid = uid; var e = TP.garage.get(uid); TP.menuShowcase(e.vehicleId, e.livery); UI.rerender('garage'); },
      sel: function () { TP.garage.select(g.uid); UI.rerender('garage'); },
      liv: function (i) { var lv = v.liveries[+i]; g.livery = shallow(lv); TP.store(); TP.menuShowcase(g.vehicleId, g.livery); UI.rerender('garage'); },
      up: function (uid) { if (TP.garage.buyUpgrade(g.uid, uid)) { AU.sfx('coin'); UI.toast(TP.upgrades[uid].name + ' installed!', 'good'); } else UI.toast('Not enough cash', 'bad'); UI.rerender('garage'); },
      pull: function () { TP.garage.select(g.uid); QP.cls = v.class; QP.veh = v.id; TP.startQuickPull(v.id, QP.venue); }
    });
  }
});

/* Shop */
var SH = { cat: 'vehicles' };
UI.register('shop', {
  render: function (el) {
    var cats = TP.shop.categories.filter(function (c) { return TP.shop.items.some(function (i) { return i.category === c; }); });
    if (cats.indexOf(SH.cat) < 0) SH.cat = cats[0] || 'vehicles';
    var items = TP.shop.items.filter(function (i) { return i.category === SH.cat && !i.hidden; }).sort(function (a, b) { return (a.levelReq - b.levelReq) || (a.price - b.price); });
    el.innerHTML = UI.header('Shop') + '<div class="scr-body"><div class="tabs scroll">' + cats.map(function (c) { return '<button class="tab' + (c === SH.cat ? ' on' : '') + '" data-act="cat" data-id="' + c + '">' + esc(c.toUpperCase()) + '</button>'; }).join('') + '</div>' +
      '<div class="grid shop-grid">' + items.map(function (it) {
        var bl = TP.shop.blocker(it.id);
        return '<div class="card shop"><canvas class="sicon" width="96" height="64" data-icon="' + esc(it.id) + '"></canvas><div class="ct"><b>' + esc(it.name) + '</b><small>' + esc(it.desc || '') + '</small></div>' +
          '<button class="btn small' + (bl ? '' : ' primary') + '" data-act="buy" data-id="' + esc(it.id) + '"' + (bl ? ' disabled' : '') + '><span class="bl">' + (bl ? esc(bl) : fmtCash(it.price)) + '</span></button></div>';
      }).join('') + (items.length ? '' : '<p class="muted">Nothing here yet.</p>') + '</div></div>';
    var cvs = el.querySelectorAll('canvas[data-icon]');
    for (var i = 0; i < cvs.length; i++) { var it = TP.shop.get(cvs[i].getAttribute('data-icon')); var c2 = cvs[i].getContext('2d'); try { (it.icon || UI.defaultShopIcon)(c2, 96, 64, it); } catch (e) { UI.defaultShopIcon(c2, 96, 64, it); } }
    UI.wire(el, {
      cat: function (c) { SH.cat = c; UI.rerender('shop'); },
      buy: function (id) { if (TP.shop.buy(id)) { AU.sfx('coin'); UI.toast('Purchased: ' + TP.shop.get(id).name, 'good'); } UI.rerender('shop'); }
    });
  }
});
/** Default shop icon painter (ctx, w, h, item). */
UI.defaultShopIcon = function (c, w, h, it) {
  var g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#3b2414'); g.addColorStop(1, '#17140f'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  if (it && it.vehicleId && TP.vehicles[it.vehicleId]) {
    var v = TP.vehicles[it.vehicleId], lv = v.liveries[0] || {}, tr = (TP.classes[v.class] || {}).group === 'tractor';
    c.fillStyle = lv.base || '#c33'; c.fillRect(w * 0.18, h * (tr ? 0.3 : 0.38), w * 0.62, h * (tr ? 0.22 : 0.22));
    c.fillRect(w * (tr ? 0.22 : 0.42), h * 0.18, w * 0.2, h * 0.22);
    c.fillStyle = '#121212'; c.beginPath(); c.arc(w * 0.28, h * 0.68, h * (tr ? 0.22 : 0.15), 0, 7); c.arc(w * 0.74, h * 0.7, h * (tr ? 0.11 : 0.15), 0, 7); c.fill();
    c.fillStyle = '#ccc'; c.fillRect(w * 0.38, h * 0.05, w * 0.04, h * 0.3);
    return;
  }
  c.fillStyle = '#ffd23f'; c.font = '900 30px "Saira Condensed", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String((it && it.category) || '?').slice(0, 1).toUpperCase(), w / 2, h / 2 + 2);
};

/* Settings */
UI.register('settings', {
  render: function (el) {
    var s = TP.save.settings;
    function tog(k, label) { return '<div class="lrow"><div class="lt"><b>' + label + '</b></div><button class="toggle' + (s[k] ? ' on' : '') + '" data-act="tog" data-id="' + k + '" aria-pressed="' + !!s[k] + '"><i></i></button></div>'; }
    el.innerHTML = UI.header('Settings') + '<div class="scr-body"><div class="list">' +
      '<div class="lrow"><div class="lt"><b>Graphics</b><small>Auto picks Low on slower phones</small></div><div class="seg">' + ['auto', 'high', 'low'].map(function (q) { return '<button class="' + (s.quality === q ? 'on' : '') + '" data-act="q" data-id="' + q + '">' + q.toUpperCase() + '</button>'; }).join('') + '</div></div>' +
      tog('sound', 'Sound') +
      '<div class="lrow"><div class="lt"><b>Volume</b></div><input type="range" min="0" max="1" step="0.05" value="' + s.volume + '" id="set-vol"></div>' +
      tog('shake', 'Camera shake') + tog('autoShift', 'Auto shift (easier, no perfect-shift bonus)') + tog('assistTraction', 'Traction assist (limits wheel spin)') + tog('showFps', 'Show FPS') +
      '<div class="lrow"><div class="lt"><b>Reset progress</b><small>Erase cash, garage and career</small></div><button class="btn small danger" data-act="reset"><span class="bl">Reset</span></button></div>' +
      '</div><p class="muted small">Desktop: W/↑ throttle · A/D steer · Space shift · Shift boost · C camera · Esc pause</p></div>';
    UI.wire(el, {
      tog: function (k) { s[k] = !s[k]; TP.store(); if (k === 'sound') AU.setMuted(!s.sound); TP.emit('settings', s); UI.rerender('settings'); },
      q: function (q) { s.quality = q; TP.store(); TP.setQuality(q === 'auto' ? pickQuality() : q); TP.emit('settings', s); UI.rerender('settings'); },
      reset: function (id, btn) { if (!btn.classList.contains('confirm')) { btn.classList.add('confirm'); btn.querySelector('.bl').textContent = 'Tap again'; return; } TP.resetSave(); UI.toast('Progress reset'); TP.toMenu(); }
    });
    var vol = el.querySelector('#set-vol');
    vol.addEventListener('input', function () { s.volume = +vol.value; AU.setMuted(!s.sound); TP.store(); });
  }
});

/* ---------------------------------------------------------------------------
 * 21. EVENTS  TP.event — minimal pulling event (events.js expands)
 * ------------------------------------------------------------------------- */
var FIRST = ['Dale', 'Cody', 'Rusty', 'Jolene', 'Hank', 'Luann', 'Travis', 'Darla', 'Clint', 'Wyatt', 'Becky', 'Merle', 'Shane', 'Tess', 'Duke', 'Ruby', 'Colt', 'June'];
var LAST = ['Hollister', 'Pruett', 'McCall', 'Sorensen', 'Vance', 'Brandt', 'Tillman', 'Oakes', 'Rasmussen', 'Kincaid', 'Dvorak', 'Lund', 'Garber', 'Whitfield'];
var TOWNS = ['Elk Ridge, KS', 'Corn City, IA', 'Sweetwater, NE', 'Muddy Creek, IN', 'Harlan Flats, OH', 'Prairie Rose, SD', 'Bucksnort, TN', 'Two Forks, WI'];
var NICK = ['Dirt Devil', 'Big Iron', 'Thunder', 'Smokey', 'Hammer', 'Gopher', 'Sparky', 'Torque', 'Mudcat', 'Diesel'];
var SKILLS_POOL = ['novice', 'good', 'good', 'pro', 'good', 'pro', 'novice'];
TP.event = {
  /** Field of AI drivers for a class: registered drivers whose vehicle is in the class, then generated
   *  (deterministic, registered with generated:true) up to n. Returns driver defs. */
  fieldFor: function (classId, n) {
    n = n || 4;
    var out = Object.keys(TP.drivers).map(function (k) { return TP.drivers[k]; }).filter(function (d) { return !d.generated && TP.vehicles[d.vehicleId] && TP.vehicles[d.vehicleId].class === classId; });
    var vehs = TP.vehiclesInClass(classId);
    if (!vehs.length) return out;
    var rng = makeRng(hashStr(classId));
    for (var i = 0; out.length < n; i++) {
      var id = 'gen_' + classId + '_' + i;
      if (!TP.drivers[id]) {
        var v = vehs[i % vehs.length], li = v.liveries[(i + 1) % v.liveries.length] || {};
        var fn = FIRST[(rng() * FIRST.length) | 0], ln = LAST[(rng() * LAST.length) | 0];
        TP.addDriver(id, { name: fn + ' ' + ln, nickname: NICK[(rng() * NICK.length) | 0], hometown: TOWNS[(rng() * TOWNS.length) | 0], vehicleId: v.id,
          livery: { base: li.base, accent: li.accent, trim: li.trim, pattern: li.pattern, number: String(10 + ((rng() * 89) | 0)) }, skill: SKILLS_POOL[i % SKILLS_POOL.length], generated: true, color: li.base,
          lines: { intro: ['From ' + TOWNS[i % TOWNS.length].split(',')[0] + ', here is ' + fn + ' ' + ln + '!'], good: ['Nice hook from ' + fn + '!'], full: [fn + ' ' + ln + ' goes the distance!'], bad: ['Not ' + fn + '\'s night.'] } });
      }
      out.push(TP.drivers[id]);
      if (i > 40) break;
    }
    return out.slice(0, Math.max(n, out.length));
  },
  /** Sort results: full pulls first (pull-off rank), then distance; DQ last. Returns new array. */
  rank: function (results) {
    return results.slice().sort(function (a, b) {
      if (a.dq !== b.dq) return a.dq ? 1 : -1;
      if ((b.pullOffRank != null || a.pullOffRank != null) && a.fullPull && b.fullPull) return (a.pullOffRank != null ? a.pullOffRank : 99) - (b.pullOffRank != null ? b.pullOffRank : 99);
      return b.distanceFt - a.distanceFt;
    });
  },
  /** The player's vehicle entry for a class (selected if it matches, owned, or a loaner). */
  playerEntryFor: function (classId) {
    var sel = TP.garage.selected();
    if (sel && TP.vehicles[sel.vehicleId] && TP.vehicles[sel.vehicleId].class === classId) return sel;
    var own = TP.save.garage.filter(function (g) { return TP.vehicles[g.vehicleId] && TP.vehicles[g.vehicleId].class === classId; })[0];
    if (own) return own;
    var v = TP.vehiclesInClass(classId)[0];
    return v ? { uid: null, vehicleId: v.id, upgrades: {}, livery: {}, loaner: true } : null;
  },
  active: null,
  /**
   * Run an event: def = {id?, name, venue, classes:[classId], entrants?:[driverId|'player'], fieldSize?, purse (per class),
   *   payout?:[0.5,0.3,0.2], pointsTable?:[...], trackCondition?, pullOffMult?:1.08, xp?}
   * Returns Promise<results> where results = {event, classes:{classId:[ranked results]}, player:{place, cash, points, xp}}.
   */
  run: function (def) {
    def = shallow(def || {});
    def.classes = def.classes && def.classes.length ? def.classes : ['street_diesel'];
    def.venue = def.venue || 'county_fair';
    def.purse = def.purse != null ? def.purse : 3000;
    def.payout = def.payout || [0.5, 0.3, 0.2];
    def.pointsTable = def.pointsTable || [20, 17, 15, 13, 11, 10, 9, 8, 7, 6];
    var out = { event: def, classes: {}, player: { place: 0, cash: 0, points: 0, xp: 0 } };
    TP.event.active = { def: def, out: out };
    TP.emit('eventStart', def);
    TP.loadVenue(def.venue, { trackCondition: def.trackCondition });
    var chain = Promise.resolve(), aborted = false;
    def.classes.forEach(function (classId) {
      chain = chain.then(function () { if (aborted) return; return runClass(def, classId, out).then(function (r) { if (r === 'abort') aborted = true; }); });
    });
    return chain.then(function () {
      TP.event.active = null;
      if (aborted) { TP.toMenu(); out.aborted = true; return out; }
      if (out.player.cash) TP.addCash(out.player.cash, 'event');
      TP.addXP(out.player.xp);
      TP.save.stats.events++; if (out.player.place === 1) TP.save.stats.wins++;
      TP.store();
      TP.emit('eventEnd', out);
      return new Promise(function (res) { UI.show('podium', { out: out, done: function () { res(out); if (def.onDone) def.onDone(out); else TP.toMenu(); } }); });
    });
  }
};
function runClass(def, classId, out) {
  var cls = TP.classes[classId];
  var ents = def.entrants && def.entrants.length ? def.entrants.slice() : TP.event.fieldFor(classId, def.fieldSize || 3).map(function (d) { return d.id; }).concat(['player']);
  ents = ents.filter(function (e) { return e === 'player' || TP.drivers[e]; });
  // order: AI shuffled; player somewhere after the first AI
  var ai = ents.filter(function (e) { return e !== 'player'; }), hasPlayer = ents.indexOf('player') >= 0;
  var rng = makeRng((Date.now() ^ hashStr(classId)) >>> 0);
  for (var i = ai.length - 1; i > 0; i--) { var j = (rng() * (i + 1)) | 0, t = ai[i]; ai[i] = ai[j]; ai[j] = t; }
  var order = ai.slice();
  if (hasPlayer) order.splice(Math.min(order.length, 1 + ((rng() * order.length) | 0)), 0, 'player');
  var pe = hasPlayer ? TP.event.playerEntryFor(classId) : null;
  if (hasPlayer && !pe) order = order.filter(function (e) { return e !== 'player'; });
  var results = [], idx = 0, skipAll = false;
  var tc0 = def.trackCondition != null ? def.trackCondition : (TP.venues[def.venue] && TP.venues[def.venue].trackCondition != null ? TP.venues[def.venue].trackCondition : 0.2);
  function pullOne(entrant, opts) {
    opts = opts || {};
    var tc = clamp(tc0 + results.length * 0.035, 0, 1);  // ruts build up
    if (entrant === 'player') {
      UI.hide();
      return TP.runPull({ vehicleId: pe.vehicleId, upgrades: pe.upgrades, livery: pe.livery, controller: 'player', name: 'You', venue: def.venue, trackCondition: tc, sledMult: opts.sledMult, best: results.length ? TP.event.rank(results)[0].distanceFt : 0, label: 'event', classId: classId });
    }
    var d = TP.drivers[entrant];
    var o = { vehicleId: d.vehicleId, livery: d.livery, upgrades: d.upgrades, driverId: d.id, controller: 'ai', skill: d.skill, spectate: true, venue: def.venue, trackCondition: tc, sledMult: opts.sledMult, label: 'event', classId: classId };
    if (opts.skip) {
      var r = TP.sim.simulate({ vehicleId: o.vehicleId, upgrades: o.upgrades, driver: d.id, venue: def.venue, trackCondition: tc, sledMult: o.sledMult, skill: d.skill, classId: classId });
      r = shallow(r); r.name = d.name; r.driverId = d.id; r.player = false; TP.emit('pullEnd', r);
      return Promise.resolve(r);
    }
    UI.hide();
    return TP.runPull(o);
  }
  function step() {
    if (idx >= order.length) return pullOffs();
    var e = order[idx];
    var isP = e === 'player';
    if (!isP && skipAll) { return pullOne(e, { skip: true }).then(function (r) { record(e, r); idx++; return step(); }); }
    return new Promise(function (res) {
      UI.show('eventNext', { def: def, cls: cls, entrant: e, pe: pe, idx: idx, total: order.length, standings: TP.event.rank(results),
        go: function (mode) { if (mode === 'skipAll') { skipAll = true; mode = 'skip'; } pullOne(e, { skip: mode === 'skip' }).then(function (r) {
          if (!r || r.aborted) { res('abort'); return; }
          record(e, r); idx++; res(step());
        }); },
        quit: function () { res('abort'); } });
    });
  }
  function record(e, r) { r.entrant = e; r.name = e === 'player' ? 'You' : TP.drivers[e].name; r.player = e === 'player'; results.push(r); }
  function pullOffs(round) {
    round = round || 1;
    var ranked = TP.event.rank(results);
    var tied = ranked.filter(function (r) { return r.fullPull && r.pullOffRank == null; });
    if (tied.length < 2 || round > 3) { tied.forEach(function (r, i) { r.pullOffRank = i; }); return finishClass(); }
    var mult = Math.pow(def.pullOffMult || 1.08, round);
    UI.banner('PULL-OFF!', tied.length + ' full pulls — adding weight', { kind: 'full', ms: 2600 });
    TP.ui.announcer('We have a PULL-OFF, folks! They are adding weight to the box!', { priority: 3 });
    var po = [], k = 0;
    function nextPO() {
      if (k >= tied.length) {
        var pr = TP.event.rank(po), stillFull = pr.filter(function (r) { return r.fullPull; }).length;
        pr.forEach(function (r, i) {
          var orig = tied.filter(function (t) { return t.entrant === r.entrant; })[0];
          orig.pullOff = r.distanceFt;
          orig.pullOffRank = (stillFull > 1 && r.fullPull && round < 3) ? null : i;
        });
        if (tied.some(function (t) { return t.pullOffRank == null; })) return pullOffs(round + 1);
        return finishClass();
      }
      var t = tied[k++];
      return new Promise(function (res) {
        UI.show('eventNext', { def: def, cls: cls, entrant: t.entrant, pe: pe, pullOff: round, idx: k - 1, total: tied.length, standings: TP.event.rank(results),
          go: function (mode) { pullOne(t.entrant, { sledMult: mult, skip: mode === 'skip' || mode === 'skipAll' }).then(function (r) { if (!r || r.aborted) { res('abort'); return; } r.entrant = t.entrant; po.push(r); res(nextPO()); }); },
          quit: function () { res('abort'); } });
      });
    }
    return nextPO();
  }
  function finishClass() {
    var ranked = TP.event.rank(results);
    ranked.forEach(function (r, i) {
      r.place = i + 1;
      r.points = r.dq ? 0 : (def.pointsTable[i] || 0);
      r.cash = Math.round(def.purse * (def.payout[i] || 0));
      if (r.player) { out.player.place = r.place; out.player.cash += r.cash; out.player.points += r.points; out.player.xp += Math.round(r.distanceFt / 2 + (r.place === 1 ? 150 : 40)); }
    });
    out.classes[classId] = ranked;
    return new Promise(function (res) { UI.show('standings', { title: cls.name + ' — Final', rows: ranked, final: true, done: function () { res(); } }); });
  }
  return step();
}
UI.register('eventNext', {
  render: function (el, a) {
    var isP = a.entrant === 'player', d = isP ? null : TP.drivers[a.entrant], v = TP.vehicles[isP ? a.pe.vehicleId : d.vehicleId];
    el.innerHTML = '<div class="panel event-next"><div class="en-top"><small>' + esc(a.def.name || 'Pulling Event') + ' · ' + esc(a.cls.name) + (a.pullOff ? ' · PULL-OFF ' + a.pullOff : ' · Hook ' + (a.idx + 1) + ' of ' + a.total) + '</small>' +
      '<h2 class="big">' + (isP ? 'YOUR PULL' : 'UP NEXT') + '</h2>' +
      '<div class="en-who"><span class="dot" style="background:' + esc(isP ? '#ffd23f' : (d.color || '#ff7a1a')) + '"></span><div><b>' + esc(isP ? 'You' : d.name + (d.nickname ? ' “' + d.nickname + '”' : '')) + '</b><small>' + esc(v ? (v.brand + ' ' + v.name) : '') + (d && d.hometown ? ' · ' + esc(d.hometown) : '') + '</small></div></div></div>' +
      '<div class="mini-stand">' + standingsHtml(a.standings.slice(0, 5)) + '</div><div class="row center btnrow"></div></div>';
    var row = el.querySelector('.btnrow');
    if (isP) row.appendChild(UI.menuButton('HOOK UP & PULL', function () { a.go('pull'); }, { primary: true, icon: 'flag' }));
    else {
      row.appendChild(UI.menuButton('Watch', function () { a.go('watch'); }, { primary: true, icon: 'eye' }));
      row.appendChild(UI.menuButton('Skip', function () { a.go('skip'); }, { icon: 'skip' }));
      row.appendChild(UI.menuButton('Skip all AI', function () { a.go('skipAll'); }, { icon: 'ff', small: true }));
    }
    row.appendChild(UI.menuButton('Quit', a.quit, { small: true, icon: 'back' }));
  }
});
function standingsHtml(rows) {
  if (!rows.length) return '<p class="muted">No pulls yet — the track is fresh.</p>';
  return '<ol class="stand">' + rows.map(function (r, i) {
    return '<li class="' + (r.player ? 'me' : '') + '"><span class="pos">' + (i + 1) + '</span><span class="nm">' + esc(r.name) + '</span><span class="ds">' + (r.dq ? 'DQ' : r.distanceText + ' ft') + (r.fullPull ? ' <em>FULL</em>' : '') + (r.pullOff != null ? ' <em>PO ' + r.pullOff.toFixed(2) + '</em>' : '') + '</span>' + (r.cash ? '<span class="pay">' + fmtCash(r.cash) + '</span>' : '') + '</li>';
  }).join('') + '</ol>';
}
UI.standingsHtml = standingsHtml;
UI.register('standings', {
  render: function (el, a) {
    el.innerHTML = '<div class="panel"><h2 class="big">' + esc(a.title || 'Standings') + '</h2>' + standingsHtml(a.rows || []) + '<div class="row center btnrow"></div></div>';
    el.querySelector('.btnrow').appendChild(UI.menuButton('Continue', a.done, { primary: true, icon: 'play' }));
  }
});
UI.register('podium', {
  render: function (el, a) {
    var out = a.out, h = '<div class="panel podium"><h2 class="big">' + esc(out.event.name || 'Results') + '</h2>';
    Object.keys(out.classes).forEach(function (cid) {
      var r = out.classes[cid];
      h += '<h3>' + esc(TP.classes[cid].name) + '</h3><div class="pod">' + [1, 0, 2].map(function (i) { var x = r[i]; if (!x) return '<div class="step s' + (i + 1) + ' empty"></div>'; return '<div class="step s' + (i + 1) + (x.player ? ' me' : '') + '"><b>' + esc(x.name) + '</b><small>' + (x.dq ? 'DQ' : x.distanceText + ' ft') + '</small><div class="blk">' + (i + 1) + '</div></div>'; }).join('') + '</div>';
    });
    h += '<div class="rewards">' + (out.player.place ? '<span class="chip">You placed #' + out.player.place + '</span>' : '') + '<span class="chip cash">+' + fmtCash(out.player.cash) + '</span><span class="chip lvl">+' + out.player.xp + ' XP</span>' + (out.player.points ? '<span class="chip">+' + out.player.points + ' pts</span>' : '') + '</div><div class="row center btnrow"></div></div>';
    el.innerHTML = h;
    el.querySelector('.btnrow').appendChild(UI.menuButton('Continue', a.done, { primary: true, icon: 'play' }));
    if (out.player.place === 1) { TP.cheer(1); AU.sfx('horn'); }
  }
});

/* Career (minimal core version — career.js replaces TP.screens.career) */
TP.career = { events: [] };
TP.career.events.push({ id: 'county_open', name: 'County Fair Open', venue: 'county_fair', classes: ['street_diesel'], purse: 4000, levelReq: 1, desc: 'Street Diesels on a Saturday afternoon. Three locals and you.' });
TP.career.events.push({ id: 'farm_night', name: 'Farm Stock Showdown', venue: 'county_fair', classes: ['farm_stock'], purse: 3500, levelReq: 1, desc: 'Field tractors, suitcase weights and a lot of pride.' });
TP.career.events.push({ id: 'mini_madness', name: 'Mini Rod Madness', venue: 'county_fair', classes: ['mini_rod'], purse: 6000, levelReq: 2, desc: 'Two thousand pounds, a thousand horsepower. Hold on.' });
UI.register('career', {
  render: function (el) {
    el.innerHTML = UI.header('Career') + '<div class="scr-body"><div class="list">' + TP.career.events.map(function (ev) {
      var lk = TP.save.level < (ev.levelReq || 1);
      return '<div class="lrow"><div class="lt"><b>' + esc(ev.name) + '</b><small>' + esc(ev.desc || '') + ' · Purse ' + fmtCash(ev.purse) + '</small></div><button class="btn small' + (lk ? '' : ' primary') + '" data-act="ev" data-id="' + ev.id + '"' + (lk ? ' disabled' : '') + '><span class="bl">' + (lk ? 'LVL ' + ev.levelReq : 'Enter') + '</span></button></div>';
    }).join('') + '</div></div>';
    UI.wire(el, { ev: function (id) { var ev = TP.career.events.filter(function (e) { return e.id === id; })[0]; if (ev) TP.event.run(ev); } });
  }
});

/* ---------------------------------------------------------------------------
 * 22. DEBUG  TP.debug (also: URL hash #debug shows FPS + logs helpers)
 * ------------------------------------------------------------------------- */
TP.debug = {
  /** Headless pull: TP.debug.simulate('sd_thunderbolt', 'pro', {seed, upgrades, trackCondition}) -> result */
  simulate: function (vehicleId, skill, opts) {
    var o = shallow(opts || {}); o.vehicleId = vehicleId || 'sd_thunderbolt'; o.skill = skill || 'pro';
    return TP.sim.simulate(o);
  },
  /** Distribution helper: n runs -> {avgFt, avgPct, min, max, fullPulls, dq, broken, results} */
  batch: function (vehicleId, skill, n, opts) {
    n = n || 20; var res = [], sum = 0, mn = 1e9, mx = 0, full = 0, dq = 0, br = 0, L = 300;
    for (var i = 0; i < n; i++) {
      var o = shallow(opts || {}); o.seed = (o.seed || 1000) + i * 77;
      var r = TP.debug.simulate(vehicleId, skill, o); res.push(r); L = r.trackLengthFt;
      sum += r.distanceFt; mn = Math.min(mn, r.distanceFt); mx = Math.max(mx, r.distanceFt);
      if (r.fullPull) full++; if (r.dq) dq++; if (r.broken) br++;
    }
    return { avgFt: +(sum / n).toFixed(2), avgPct: +(sum / n / L * 100).toFixed(1), min: mn, max: mx, fullPulls: full, dq: dq, broken: br, results: res };
  },
  giveCash: function (n) { return TP.addCash(n == null ? 100000 : n, 'debug'); },
  setLevel: function (l) { TP.save.level = Math.max(1, l | 0); TP.save.xp = TP.xpForLevel(TP.save.level); TP.store(); TP.emit('levelUp', TP.save.level); return TP.save.level; },
  unlockAll: function () {
    TP.debug.setLevel(99); TP.save.cash = Math.max(TP.save.cash, 10000000);
    Object.keys(TP.vehicles).forEach(function (id) { if (!TP.garage.owns(id) && !TP.vehicles[id].hidden) TP.garage.add(id); });
    TP.store(); TP.emit('cash', 0, 'debug', TP.save.cash); return true;
  },
  startQuickPull: function (vehicleId, venueId) { return TP.startQuickPull(vehicleId || 'sd_thunderbolt', venueId || 'county_fair'); },
  /** Player pull driven by the AI (exercise the player path hands-free). */
  autoplay: function (vehicleId, skill, venueId) { return TP.startQuickPull(vehicleId || 'sd_thunderbolt', venueId || 'county_fair', { controller: TP.controllers.resolve('autoplay', skill || 'pro') }); },
  fastForward: function (x) { return TP.setFastForward(x); },
  listTypes: function () {
    return { classes: Object.keys(TP.classes), vehicles: Object.keys(TP.vehicles), venues: Object.keys(TP.venues), drivers: Object.keys(TP.drivers).filter(function (k) { return !TP.drivers[k].generated; }),
      upgrades: Object.keys(TP.upgrades), shop: TP.shop.items.map(function (i) { return i.id; }), screens: Object.keys(TP.screens), fx: Object.keys(TP.fx.types), cameras: Object.keys(CAM.presets), menu: UI.menuItems.map(function (m) { return m.id; }) };
  },
  fps: function () { return TP.fps(); },
  info: function () { var i = TP.renderer ? TP.renderer.info : null; return i ? { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, particles: TP.fx.count(), fps: TP.fps(), quality: TP.quality } : null; }
};

/* ---------------------------------------------------------------------------
 * 23. BOOT
 * ------------------------------------------------------------------------- */
function bindUiChrome() {
  var bp = $('btnPause');
  if (bp) bp.addEventListener('click', function () { AU.init(); if (TP.paused) TP.resume(); else TP.pause(); });
  var spec = $('h-spec');
  if (spec) spec.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    AU.init();
    if (t.hasAttribute('data-ff')) { var x = +t.getAttribute('data-ff'); TP.setFastForward(x); HUD.setFF(x); }
    else if (t.hasAttribute('data-skip')) TP.skipPull();
    else if (t.hasAttribute('data-cam')) { CAM.director = false; var m = CAM.cycle(); UI.toast('Camera: ' + CAM.names[m]); }
    else if (t.hasAttribute('data-dir')) { CAM.director = true; UI.toast('Camera: Director'); }
  });
  var camb = $('btnCam');
  if (camb) camb.addEventListener('click', function () { AU.init(); TP.emit('cameraKey'); });
  // FPS meter
  var fpsEl = $('fps'), fpsT = 0;
  TP.onFrame(function (dt, realDt) {
    fpsT -= realDt; if (fpsT > 0 || !fpsEl) return; fpsT = 0.5;
    var on = TP.save.settings.showFps || TP.debugMode;
    fpsEl.style.display = on ? '' : 'none';
    if (on) { var i = TP.renderer.info.render; fpsEl.textContent = TP.fps() + ' fps · ' + i.calls + ' calls · ' + (i.triangles / 1000).toFixed(0) + 'k tris · ' + TP.quality; }
  });
  TP.on('cash', function () { var c = document.querySelectorAll('.chip.cash'); for (var i = 0; i < c.length; i++) if (!c[i].closest('.rewards')) c[i].textContent = fmtCash(TP.save.cash); });
  TP.on('levelUp', function (l) { UI.banner('LEVEL ' + l + '!', 'New rigs and venues may be unlocked', { kind: 'good', ms: 2200 }); AU.sfx('coin'); });
}
/** Boot the game (main.js calls this). Safe to call once; returns a Promise resolved when the menu is up. */
TP.boot = function () {
  if (TP.booted) return Promise.resolve();
  TP.booted = true;
  if (typeof THREE === 'undefined') {
    var l = $('loading'); if (l) l.innerHTML = '<div class="load-msg">Could not load the 3D engine. Check your connection and reload.</div>';
    return Promise.reject(new Error('THREE missing'));
  }
  TP.debugMode = /debug/.test(location.hash || '');
  initRenderer();
  bindInput();
  bindUiChrome();
  // shop items for every buyable vehicle
  Object.keys(TP.vehicles).forEach(function (id) { var v = TP.vehicles[id]; if (v.price > 0 && !v.hidden && !TP.shop.get('veh:' + id)) TP.shop.add(TP.shop.vehicleItem(id)); });
  // upgrades as shop items too (category 'upgrades'), applied to the active vehicle
  Object.keys(TP.upgrades).forEach(function (uid) {
    if (TP.shop.get('upg:' + uid)) return;
    var u = TP.upgrades[uid];
    TP.shop.add({ id: 'upg:' + uid, category: 'upgrades', name: u.name, desc: (u.desc || '') + ' (for your active rig — see Garage)', price: u.levels[0] ? u.levels[0].price : 0, levelReq: 1, consumable: true, hidden: true });
  });
  var fontsReady = (document.fonts && document.fonts.ready) ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1500); })]) : Promise.resolve();
  return fontsReady.then(function () {
    TP.loadVenue('county_fair');
    requestAnimationFrame(frame);
    TP.toMenu();
    var l = $('loading'); if (l) { l.classList.add('done'); setTimeout(function () { l.remove(); }, 600); }
    if (TP.debugMode) { W.TPDEBUG = TP.debug; console.log('[TP] debug mode: TP.debug', TP.debug.listTypes()); }
    TP.emit('boot');
  }).catch(function (e) { console.error('[TP] boot failed', e); });
};
})();
