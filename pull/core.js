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
  ag:     { name: 'Ag bar tires', mu: 0.94, idealSlip: 1.0, fall: 1.35, floor: 0.64, hopGain: 1.0 },
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
      c.fillText(String(lv.brandText || o.brand).toUpperCase(), w * 0.05, h * 0.3);
    }
    // number roundel
    if (lv.number != null && lv.number !== '' && o.number !== false) {
      var r = h * 0.3, nx = o.numberX != null ? o.numberX * w : w * 0.62, ny = h * 0.36;
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
  smoke:    { max: 650, tex: 'puff', blend: 'normal', life: [1.6, 3.0], size: [0.9, 4.2], c0: 0x1a1714, c1: 0x5a5550, alpha: 0.75, drag: 1.1, gravity: -0.9, spin: 0.6 },
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
  if (up) IN.kbThrottle = Math.min(1, IN.kbThrottle + dt * 1.5);
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

/*__PART_E__*/
})();
