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

/*__PART_C__*/
})();
