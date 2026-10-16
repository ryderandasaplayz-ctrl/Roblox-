/* =============================================================================
 * FULL PULL — features/vehicles.js
 * The stars of the show: 46 trucks & tractors across all 13 classes.
 *  - Realistic procedural models (rounded extruded panels, crease-smoothed normals,
 *    metallic paint + chrome + glass on a generated environment map, real tread on
 *    cut / ag / mud tires, engines, turbos, blowers, stacks, weight brackets, wheelie bars).
 *  - Specs per class, auto-geared for FAST pulls (8-12 s for a full 300 ft pull).
 *  - Liveries with fictional sponsors, stripes and race numbers drawn on canvas.
 *  - Shop items (with silhouette icons), upgrade-slot compatibility, personality blurbs.
 * Edits ONLY this file. Fictional brands only.
 * ========================================================================== */
(function () {
  'use strict';
  var TP = window.TP;
  if (!TP || !TP.addVehicle) return;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hashStr(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* ---------------------------------------------------------------------------
   * 1. SPEED TUNING — "make the pulling faster"
   *    A 300 ft pull should take ~8-12 s. Every class gets a target top speed (v, m/s
   *    of ground speed at redline in top gear with ideal slip), a lighter sled inertia,
   *    a late-loading weight box (the sled bites hard only near the end) and less plow.
   *    Vehicle gears are generated from these targets (see autoGears).
   * ------------------------------------------------------------------------- */
  var SPEED = {
    street_diesel:      { v: 15, step: 1.30, start: 0.16, end: 0.86, plow: 0.16 },
    work_stock:         { v: 16, step: 1.30, start: 0.16, end: 0.86, plow: 0.16 },
    pro_stock_diesel:   { v: 17.5, step: 1.30, start: 0.16, end: 0.88, plow: 0.15 },
    super_stock_diesel: { v: 19, step: 1.30, start: 0.16, end: 0.9, plow: 0.14 },
    modified_2wd:       { v: 19.5, step: 1.32, start: 0.16, end: 0.9, plow: 0.14 },
    big_rig:            { v: 14.5, step: 1.28, start: 0.16, end: 0.84, plow: 0.16 },
    mini_rod:           { v: 19.5, step: 1.34, start: 0.15, end: 0.92, plow: 0.13 },
    farm_stock:         { v: 13.5, step: 1.26, start: 0.16, end: 0.8, plow: 0.17 },
    hot_farm:           { v: 15, step: 1.28, start: 0.16, end: 0.84, plow: 0.16 },
    pro_stock_tractor:  { v: 17.5, step: 1.30, start: 0.16, end: 0.88, plow: 0.15 },
    light_super_stock:  { v: 19, step: 1.32, start: 0.15, end: 0.9, plow: 0.14 },
    super_stock_tractor:{ v: 20, step: 1.32, start: 0.15, end: 0.9, plow: 0.14 },
    unlimited_modified: { v: 21, step: 1.34, start: 0.15, end: 0.92, plow: 0.13 }
  };
  var TUNE_GLOBAL = { sledMass: 0.3, boxCurve: 0.62, dig: 0.6, panGrow: 1.5 };
  function applySpeedTuning() {
    try {
      var T = TP.sim && TP.sim.tune;
      if (T) { T.sledMass = TUNE_GLOBAL.sledMass; T.boxCurve = TUNE_GLOBAL.boxCurve; }
      for (var id in SPEED) {
        var c = TP.classes[id], S = SPEED[id]; if (!c) continue;
        c.speedRef = S.v * 0.8;
        c.sledStart = S.start; c.sledEnd = S.end;
        c.sled = TP.makeSled(c.weightLimit, c.tire, { drive: c.drive, start: S.start, end: S.end, speedRef: c.speedRef, trackLength: c.trackLength,
          plow: S.plow, panGrow: TUNE_GLOBAL.panGrow, frontBias: c.ref.frontBias, hitchHeight: c.ref.hitchHeight, wheelbase: c.ref.wheelbase });
        c.sled.digSpeed = c.speedRef * TUNE_GLOBAL.dig;
        c.fastTuned = true;
      }
    } catch (e) { try { console.error('[vehicles] speed tuning failed', e); } catch (e2) {} }
  }
  applySpeedTuning();
  TP.vehicleTuning = { speed: SPEED, global: TUNE_GLOBAL, apply: applySpeedTuning };

  /** Gear set for a vehicle so the top gear reaches the class's target speed at redline. */
  function autoGears(classId, s, n) {
    var S = SPEED[classId] || { v: 12, step: 1.3 }, cls = TP.classes[classId] || {};
    var tire = TP.tires[s.tire || cls.tire] || TP.tires.dot;
    var v = S.v * (s.speedMult || 1);
    var slip = (s.idealSlip || tire.idealSlip) * 1.05;
    var w = v * (1 + slip);
    var top = (s.redline * 0.985) * s.wheelRadius / (w * 9.5492966);
    var g = [], step = s.gearStep || S.step;
    for (var i = 0; i < n; i++) g.push(Math.round(top * Math.pow(step, n - 1 - i) * 100) / 100);
    return g;
  }

  /* ---------------------------------------------------------------------------
   * 2. LIVERIES + SPONSORS (all fictional)
   * ------------------------------------------------------------------------- */
  var SPONSORS = ['BALES & BOLTS FEED', 'HOT SHOT INJECTION', 'GRIT TIRE CO.', 'PRAIRIE CO-OP', "DIESEL DAN'S", 'RED BARN SEED',
    'BIG IRON PARTS', 'CRANKSHAFT CAFE', 'THUNDER OIL', 'HAYMAKER HYDRAULICS', 'DIRT ROAD DINER', 'CORNBELT CRANK',
    'SUNDOWN AG SUPPLY', "TURBO TOM'S", 'GRAVEL PIT GRILL', 'MUDHOLE TOWING', 'SILO SIGNS', 'LUG NUT LOUNGE', 'COUNTY LINE GAS', 'HOOT OWL BBQ'];
  function L(name, base, accent, trim, number, pattern, extra) {
    var o = { name: name, base: base, accent: accent, trim: trim, number: String(number), pattern: pattern || 'stripe' };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }

  /* ---------------------------------------------------------------------------
   * 3. VEHICLE DEFINITIONS
   * ------------------------------------------------------------------------- */
  var SLOTS = {
    street:  ['engine', 'turbo', 'tires', 'cooling', 'weights', 'driveline', 'gearing', 'hitch', 'fuel'],
    farm:    ['engine', 'turbo', 'tires', 'cooling', 'weights', 'driveline', 'gearing', 'hitch', 'fuel'],
    race:    ['engine', 'turbo', 'tires', 'cooling', 'weights', 'driveline', 'gearing', 'hitch', 'fuel', 'boost'],
    gas:     ['engine', 'tires', 'cooling', 'weights', 'driveline', 'gearing', 'hitch', 'fuel', 'boost']
  };
  var ENGINES = {
    cummins6: function (o) { return mix({ type: 'diesel', count: 1, cyl: 6, turbo: 1, whistle: 0.8, pitch: 1.0, rough: 0.55, volume: 1 }, o); },
    v8diesel: function (o) { return mix({ type: 'diesel', count: 1, cyl: 8, turbo: 1, whistle: 0.7, pitch: 1.08, rough: 0.5, volume: 1 }, o); },
    bigblock: function (o) { return mix({ type: 'gas', count: 1, cyl: 8, blower: true, pitch: 1.0, rough: 0.45, volume: 1 }, o); },
    ag6: function (o) { return mix({ type: 'diesel', count: 1, cyl: 6, turbo: 1, whistle: 0.5, pitch: 0.78, rough: 0.7, volume: 1 }, o); },
    meth: function (o) { return mix({ type: 'methanol', count: 1, cyl: 6, turbo: 3, whistle: 1.0, pitch: 1.0, rough: 0.5, volume: 1 }, o); },
    semi: function (o) { return mix({ type: 'diesel', count: 1, cyl: 6, turbo: 1, whistle: 0.6, pitch: 0.7, rough: 0.65, volume: 1.05 }, o); }
  };
  function mix(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; if (b) for (k in b) o[k] = b[k]; return o; }

  // Pickup wheelbase from its layout so the rear axle sits mid-bed.
  var CABL = { reg: 1.62, ext: 2.12, crew: 2.55 }, BEDL = { short: 2.0, long: 2.45, none: 1.6 };
  function pickupWB(cab, bed, hood) { var bl = BEDL[bed || 'short']; return Math.round((bl / 2 + 0.07 + CABL[cab || 'crew'] + (hood || 1.75) - 1.02) * 100) / 100; }

  var DEFS = [];
  function V(id, d) { DEFS.push([id, d]); }

  /* ======== TRUCKS ======== */
  // ---- Street Diesel (8,000 lb, 550-900 hp, DOT tires, 4x4) ----
  V('sd_thunderbolt', { name: 'TD-2500 Hauler', brand: 'Thunderbolt Diesel', class: 'street_diesel', price: 18000, levelReq: 1, family: 'pickup',
    desc: 'A crew-cab 4x4 on 37s with a single turbo and twin stacks through the bed. The truck everybody starts with.',
    blurb: 'Bought it for hauling hay. Kept it for this.',
    model: { cab: 'crew', bed: 'short', style: 'modern', lift: 0.12, stacks: { n: 2, at: 'bed', h: 1.55 } },
    specs: { hp: 760, weight: 7950, nGears: 3, redline: 3800, idle: 750, wheelRadius: 0.47, frontBias: 0.57, halfWidth: 1.05, drive: '4wd' },
    engine: ENGINES.cummins6(), slots: SLOTS.street,
    liveries: [L('Storm Blue', '#2459a8', '#f3efe6', '#17140f', 27, 'stripe'), L('Barn Red', '#b8322a', '#ffd23f', '#17140f', 8, 'flames'),
      L('Midnight', '#1d1f24', '#ff7a1a', '#9aa3ab', 13, 'swoosh'), L('Cream Classic', '#efe3c4', '#2e8b3d', '#3a2a1a', 3, 'twoTone')] });
  V('sd_bigsky_reg', { name: 'Trailhead 2500 Regular Cab', brand: 'Big Sky Trucks', class: 'street_diesel', price: 14000, levelReq: 1, family: 'pickup',
    desc: 'Regular cab, long bed, the lightest frame in the class. Less truck, more bite per pound.',
    blurb: 'Farm plates, mud flaps and a cassette deck that only plays one song.',
    model: { cab: 'reg', bed: 'long', style: 'modern', lift: 0.04, stacks: { n: 1, at: 'bed', h: 1.4 }, mudflaps: true },
    specs: { hp: 640, weight: 7900, nGears: 3, redline: 3700, idle: 760, wheelRadius: 0.45, frontBias: 0.58, halfWidth: 1.02, drive: '4wd' },
    engine: ENGINES.cummins6({ pitch: 1.04, whistle: 0.6 }), slots: SLOTS.street,
    liveries: [L('Glacier White', '#e9ecef', '#2565ae', '#17140f', 11, 'stripe'), L('Copper Canyon', '#9a4a22', '#f3d9a4', '#17140f', 4, 'twoTone'),
      L('Sage', '#6b7f5e', '#f3efe6', '#22261c', 21, 'retro')] });
  V('sd_ironhorse_dually', { name: 'Ironhorse 3500 Dually', brand: 'Ironhorse', class: 'street_diesel', price: 23000, levelReq: 2, family: 'pickup',
    desc: 'Crew cab dually with a gooseneck hitch and a V8 diesel. Six rear tires worth of footprint.',
    blurb: 'Tows the camper all summer and the sled all fair season.',
    model: { cab: 'crew', bed: 'long', style: 'modern', dually: true, lift: 0.04, stacks: { n: 2, at: 'bed', h: 1.6 }, lightbar: true, chromeBumper: true },
    specs: { hp: 830, weight: 8000, nGears: 3, redline: 3600, idle: 700, wheelRadius: 0.45, frontBias: 0.56, halfWidth: 1.2, drive: '4wd' },
    engine: ENGINES.v8diesel(), slots: SLOTS.street,
    liveries: [L('Black Gold', '#141518', '#d9a441', '#d9a441', 33, 'swoosh'), L('Ranch Red', '#8e1f1b', '#f3efe6', '#17140f', 7, 'stripe'),
      L('Pewter', '#80878e', '#17140f', '#ff6a1a', 50, 'retro'), L('Rodeo White', '#f1f0ea', '#8a5a2b', '#3a2a1a', 1, 'twoTone')] });
  V('sd_granite_lifted', { name: 'Summit HD Lifted', brand: 'Granite Peak Motors', class: 'street_diesel', price: 26000, levelReq: 3, family: 'pickup',
    desc: 'Eight-inch lift on 42-inch mud tires. Tall, loud and a little tippy. The crowd loves it.',
    blurb: 'Needs a ladder to get in. Worth it.',
    model: { cab: 'crew', bed: 'short', style: 'modern', lift: 0.36, stacks: { n: 2, at: 'bed', h: 1.8 }, lightbar: true, flares: 'wide' },
    specs: { hp: 880, weight: 7980, nGears: 3, redline: 3800, idle: 760, wheelRadius: 0.53, cgHeight: 1.15, frontBias: 0.57, halfWidth: 1.14, drive: '4wd', steerRate: 0.95 },
    engine: ENGINES.cummins6({ whistle: 0.95, pitch: 1.02 }), slots: SLOTS.street,
    liveries: [L('Toxic Green', '#5aa02c', '#17140f', '#17140f', 42, 'tribal'), L('Lava Orange', '#e8641e', '#17140f', '#17140f', 88, 'stripe'),
      L('Stealth', '#2a2d31', '#e8e8e8', '#5fd4e8', 6, 'swoosh')] });
  V('sd_cedar_square', { name: "Cedar '86 Square Body", brand: 'Cedar Motor Co.', class: 'street_diesel', price: 9000, levelReq: 1, family: 'pickup',
    desc: 'A boxy eighties extended cab with a swapped-in diesel. Cheap, rusty in places, and unkillable.',
    blurb: "Grandpa's old truck. Still has his toolbox in the bed.",
    model: { cab: 'ext', bed: 'long', style: 'square', lift: 0.08, stacks: { n: 1, at: 'bed', h: 1.3 }, chromeBumper: true },
    specs: { hp: 580, weight: 7600, nGears: 3, redline: 3500, idle: 720, wheelRadius: 0.45, frontBias: 0.56, halfWidth: 1.0, drive: '4wd', durability: 1.25 },
    engine: ENGINES.cummins6({ pitch: 0.94, rough: 0.7, whistle: 0.55 }), slots: SLOTS.street,
    liveries: [L('Two-Tone Tan', '#c9a76b', '#f3efe6', '#5a3a1a', 86, 'twoTone'), L('Faded Red', '#a6392d', '#f3efe6', '#17140f', 19, 'retro'),
      L('Forest', '#2f5233', '#d8c08a', '#17140f', 2, 'stripe')] });
  V('sd_bigsky_trail', { name: 'Trailhead 1500 Diesel', brand: 'Big Sky Trucks', class: 'street_diesel', price: 11000, levelReq: 1, family: 'pickup',
    desc: 'A half-ton crew cab with a small diesel and a big attitude. Light on its feet, short on power.',
    blurb: 'Gets 30 mpg on the highway. Gets zero respect at the fair. Yet.',
    model: { cab: 'crew', bed: 'short', style: 'aero', lift: 0.06, stacks: { n: 1, at: 'bed', h: 1.25 } },
    specs: { hp: 560, weight: 7400, nGears: 3, redline: 4200, idle: 780, wheelRadius: 0.44, frontBias: 0.55, halfWidth: 1.0, drive: '4wd' },
    engine: ENGINES.v8diesel({ pitch: 1.15, whistle: 0.65 }), slots: SLOTS.street,
    liveries: [L('Electric Blue', '#1f6fd1', '#e8e8e8', '#17140f', 15, 'swoosh'), L('Sunburst', '#f2b705', '#17140f', '#17140f', 5, 'stripe'),
      L('Silver Fox', '#b9bec4', '#c8342b', '#17140f', 77, 'checker')] });

  // ---- Work Stock Diesel (8,000 lb, 900-1300 hp, DOT) ----
  V('ws_thunderbolt', { name: 'TD-3500 Work Stock', brand: 'Thunderbolt Diesel', class: 'work_stock', price: 32000, levelReq: 3, family: 'pickup',
    desc: 'Built injectors, a 72 mm turbo and a stack through the hood. Still has the cup holders.',
    blurb: 'Drove it to the fair, will drive it home. Probably.',
    model: { cab: 'crew', bed: 'short', style: 'modern', lift: 0.1, stacks: { n: 1, at: 'hood', h: 1.0 }, weights: 0.6, hitchBar: true },
    specs: { hp: 1150, weight: 8000, nGears: 3, redline: 4000, idle: 780, wheelRadius: 0.47, frontBias: 0.58, halfWidth: 1.05, drive: '4wd' },
    engine: ENGINES.cummins6({ turbo: 1, whistle: 1.0 }), slots: SLOTS.street,
    liveries: [L('Hot Rod Red', '#c0201a', '#f3efe6', '#17140f', 99, 'flames'), L('Gunmetal', '#4a5058', '#ffd23f', '#17140f', 31, 'stripe'),
      L('Prairie Gold', '#d6a62a', '#17140f', '#17140f', 12, 'retro')] });
  V('ws_bigsky_dually', { name: 'Ranch Hand Dually', brand: 'Big Sky Trucks', class: 'work_stock', price: 29000, levelReq: 3, family: 'pickup',
    desc: 'Regular cab dually with a flatbed-strong frame and twin stacks. Wide stance, wide grin.',
    blurb: 'Pulled a calf out of the ditch Tuesday. Pulling the sled Saturday.',
    model: { cab: 'reg', bed: 'long', style: 'modern', dually: true, lift: 0.08, stacks: { n: 2, at: 'bed', h: 1.7 }, weights: 0.5, chromeBumper: true },
    specs: { hp: 1050, weight: 8000, nGears: 3, redline: 3800, idle: 760, wheelRadius: 0.46, frontBias: 0.6, halfWidth: 1.2, drive: '4wd' },
    engine: ENGINES.cummins6({ pitch: 0.96 }), slots: SLOTS.street,
    liveries: [L('John Brown', '#5a3a22', '#f3d9a4', '#17140f', 18, 'twoTone'), L('Arctic', '#eef1f4', '#1b2f55', '#c8342b', 24, 'stripe'),
      L('Hunter Orange', '#ff6a1a', '#17140f', '#17140f', 66, 'swoosh')] });
  V('ws_redline_ext', { name: 'Stomper Extended Cab', brand: 'Redline Diesel Works', class: 'work_stock', price: 36000, levelReq: 4, family: 'pickup',
    desc: 'An extended cab V8 diesel on a shop-built frame. The most horsepower you can still register.',
    blurb: 'The neighbors know when Gus is warming it up. So does the next county.',
    model: { cab: 'ext', bed: 'short', style: 'aero', lift: 0.14, stacks: { n: 2, at: 'bed', h: 1.6 }, weights: 0.7, lightbar: true, hitchBar: true },
    specs: { hp: 1280, weight: 8000, nGears: 3, redline: 4100, idle: 780, wheelRadius: 0.48, frontBias: 0.57, halfWidth: 1.06, drive: '4wd', durability: 0.92 },
    engine: ENGINES.v8diesel({ turbo: 2, whistle: 0.95 }), slots: SLOTS.street,
    liveries: [L('Grape Ape', '#5b2a86', '#a6e22e', '#17140f', 69, 'tribal'), L('Candy Apple', '#b3121b', '#f3efe6', '#17140f', 10, 'stripe'),
      L('Desert Storm', '#c2a878', '#5a3a1a', '#17140f', 37, 'checker')] });
  V('ws_granite_mud', { name: 'Mudslinger 2500', brand: 'Granite Peak Motors', class: 'work_stock', price: 34000, levelReq: 4, family: 'pickup',
    desc: 'Lifted work truck on 40-inch mud terrains, a cowl-induction hood and a stack through the bed.',
    blurb: 'Washed it once in 2019. Never again.',
    model: { cab: 'crew', bed: 'short', style: 'square', lift: 0.3, stacks: { n: 1, at: 'bed', h: 1.9 }, flares: 'wide', lightbar: true, weights: 0.5 },
    specs: { hp: 1200, weight: 8000, nGears: 3, redline: 3900, idle: 760, wheelRadius: 0.51, cgHeight: 1.1, frontBias: 0.57, halfWidth: 1.12, drive: '4wd' },
    engine: ENGINES.cummins6({ whistle: 0.9, rough: 0.6 }), slots: SLOTS.street,
    liveries: [L('Mud Brown', '#6b4a2b', '#e8d8b0', '#17140f', 40, 'tribal'), L('Army Drab', '#4b5320', '#17140f', '#e8e0c0', 44, 'stripe'),
      L('Safety Yellow', '#f4c20d', '#17140f', '#17140f', 3, 'checker')] });

  // ---- Pro Stock Diesel (7,800 lb, 1,500-2,000 hp, cut tires) ----
  V('ps_bigsky', { name: 'Ridgeline 3500 Pro', brand: 'Big Sky Trucks', class: 'pro_stock_diesel', price: 52000, levelReq: 5, family: 'pickup',
    desc: 'Lowered on a race chassis with a big single turbo poking through the hood, wheelie bars and a nose full of weights.',
    blurb: 'Factory body, nothing factory underneath.',
    model: { cab: 'reg', bed: 'short', style: 'modern', lift: -0.04, stacks: { n: 1, at: 'hood', h: 0.9, r: 0.13 }, hoodTurbo: 1, wheelieBars: true, weights: 1.0, hitchBar: true, race: true },
    specs: { hp: 1750, weight: 7780, nGears: 3, redline: 4400, idle: 850, wheelRadius: 0.55, frontBias: 0.55, halfWidth: 1.05, drive: '4wd', maxLift: 0.14, tire: 'cut' },
    engine: ENGINES.cummins6({ turbo: 2, whistle: 1.1, pitch: 1.05 }), slots: SLOTS.race,
    liveries: [L('Sky Blue', '#2565ae', '#fff4dc', '#17140f', 42, 'stripe', { brandText: 'BIG SKY' }), L('Firebird', '#d12a1b', '#ffcc00', '#17140f', 14, 'flames'),
      L('Black Ice', '#0f1115', '#5fd4e8', '#5fd4e8', 9, 'tribal')] });
  V('ps_thunderbolt', { name: 'Thunder Road Pro Stock', brand: 'Thunderbolt Diesel', class: 'pro_stock_diesel', price: 58000, levelReq: 6, family: 'pickup',
    desc: 'Crew-cab shell over a tube frame. Compound turbos, water-meth and a hair-trigger temper.',
    blurb: "Built in a pole barn by three brothers and their mom. Mom's the crew chief.",
    model: { cab: 'crew', bed: 'short', style: 'modern', lift: -0.02, stacks: { n: 2, at: 'hood', h: 0.85, r: 0.11 }, hoodTurbo: 2, wheelieBars: true, weights: 1.1, hitchBar: true, race: true },
    specs: { hp: 1950, weight: 7800, nGears: 3, redline: 4500, idle: 850, wheelRadius: 0.56, frontBias: 0.56, halfWidth: 1.05, drive: '4wd', maxLift: 0.15, tire: 'cut', durability: 0.92 },
    engine: ENGINES.cummins6({ turbo: 2, whistle: 1.2 }), slots: SLOTS.race,
    liveries: [L('Thunder Yellow', '#ffcc00', '#17140f', '#17140f', 1, 'checker'), L('Navy Lightning', '#1b2f55', '#ffd23f', '#f3efe6', 22, 'swoosh'),
      L('Pearl', '#f2efe8', '#c8342b', '#1b2f55', 76, 'stripe')] });
  V('ps_cedar', { name: 'Old Yeller Square Body', brand: 'Cedar Motor Co.', class: 'pro_stock_diesel', price: 47000, levelReq: 5, family: 'pickup',
    desc: 'A 1979 square-body shell on a modern pulling chassis. Retro on the outside, 1,700 hp on the inside.',
    blurb: 'Looks like the hay truck. Pulls like a freight train.',
    model: { cab: 'reg', bed: 'short', style: 'square', lift: -0.02, stacks: { n: 2, at: 'bed', h: 1.5 }, hoodTurbo: 1, wheelieBars: true, weights: 0.9, chromeBumper: true, hitchBar: true, race: true },
    specs: { hp: 1680, weight: 7750, nGears: 3, redline: 4300, idle: 820, wheelRadius: 0.54, frontBias: 0.56, halfWidth: 1.02, drive: '4wd', maxLift: 0.14, tire: 'cut', durability: 1.1 },
    engine: ENGINES.cummins6({ turbo: 1, pitch: 0.97, rough: 0.6 }), slots: SLOTS.race,
    liveries: [L('Old Yeller', '#f0b323', '#17140f', '#17140f', 79, 'retro'), L('Root Beer', '#5b2c17', '#e8b04a', '#17140f', 5, 'twoTone'),
      L('Seafoam', '#7fc8b8', '#f3efe6', '#17140f', 17, 'stripe')] });
  V('ps_granite', { name: 'Granite Peak Avalanche', brand: 'Granite Peak Motors', class: 'pro_stock_diesel', price: 61000, levelReq: 7, family: 'pickup',
    desc: 'Extended cab, a mile of weight bracket and the biggest single turbo the rules allow.',
    blurb: 'Snow-white paint, coal-black smoke.',
    model: { cab: 'ext', bed: 'short', style: 'aero', lift: -0.03, stacks: { n: 2, at: 'hood', h: 0.95, r: 0.12 }, hoodTurbo: 1, wheelieBars: true, weights: 1.25, hitchBar: true, race: true },
    specs: { hp: 2000, weight: 7800, nGears: 3, redline: 4600, idle: 860, wheelRadius: 0.56, frontBias: 0.57, halfWidth: 1.05, drive: '4wd', maxLift: 0.15, tire: 'cut', durability: 0.95 },
    engine: ENGINES.v8diesel({ turbo: 1, whistle: 1.15, pitch: 1.1 }), slots: SLOTS.race,
    liveries: [L('Avalanche', '#f4f6f8', '#1f6fd1', '#17140f', 2, 'swoosh'), L('Ember', '#e8461e', '#17140f', '#ffd23f', 60, 'flames'),
      L('Graphite', '#33373c', '#a6e22e', '#a6e22e', 25, 'tribal')] });

  // ---- Super Stock Diesel 4x4 (7,500 lb, 2,500-3,500 hp) ----
  V('ss_ironhorse', { name: 'Iron Maiden', brand: 'Ironhorse', class: 'super_stock_diesel', price: 92000, levelReq: 8, family: 'pickup',
    desc: 'Fiberglass pickup body on a full tube chassis, triple-compound turbos and four stacks breathing fire.',
    blurb: 'Two thousand pounds of chromoly and a bad attitude.',
    model: { cab: 'reg', bed: 'short', style: 'modern', lift: 0.16, stacks: { n: 4, at: 'hood', h: 0.75, r: 0.1 }, hoodTurbo: 3, wheelieBars: true, weights: 1.5, cage: true, hitchBar: true, race: true },
    specs: { hp: 3100, weight: 7480, nGears: 3, redline: 5000, idle: 900, wheelRadius: 0.66, frontBias: 0.55, halfWidth: 1.12, drive: '4wd', maxLift: 0.2, tire: 'cut', durability: 0.88 },
    engine: ENGINES.cummins6({ turbo: 3, whistle: 1.3, pitch: 1.1, rough: 0.45 }), slots: SLOTS.race,
    liveries: [L('Iron Maiden', '#2a2a2e', '#d12a1b', '#d12a1b', 666, 'tribal'), L('Sapphire', '#1340a8', '#f3efe6', '#17140f', 38, 'stripe'),
      L('Neon Lime', '#a6e22e', '#17140f', '#17140f', 4, 'checker')] });
  V('ss_thunderbolt', { name: 'Widowmaker', brand: 'Thunderbolt Diesel', class: 'super_stock_diesel', price: 105000, levelReq: 9, family: 'pickup',
    desc: '3,400 hp, four stacks, a nose of suitcase weights and the front wheels up before the first marker.',
    blurb: 'The sled operator asks for hazard pay when this one hooks.',
    model: { cab: 'crew', bed: 'short', style: 'modern', lift: 0.18, stacks: { n: 4, at: 'hood', h: 0.8, r: 0.1 }, hoodTurbo: 3, wheelieBars: true, weights: 1.6, cage: true, hitchBar: true, race: true },
    specs: { hp: 3400, weight: 7500, nGears: 3, redline: 5200, idle: 900, wheelRadius: 0.67, frontBias: 0.56, halfWidth: 1.12, drive: '4wd', maxLift: 0.2, tire: 'cut', durability: 0.82 },
    engine: ENGINES.cummins6({ turbo: 3, whistle: 1.35, pitch: 1.12 }), slots: SLOTS.race,
    liveries: [L('Black Widow', '#0d0d0f', '#e0202a', '#e0202a', 13, 'swoosh'), L('Chrome Yellow', '#ffd400', '#17140f', '#17140f', 3, 'flames'),
      L('Patriot', '#1b2f55', '#f3efe6', '#c8342b', 76, 'stripe')] });
  V('ss_bigsky', { name: 'Big Sky Outlaw', brand: 'Big Sky Trucks', class: 'super_stock_diesel', price: 86000, levelReq: 8, family: 'pickup',
    desc: 'Square-body Super Stock with a huge single turbo and twin stacks. Old-school, all-business.',
    blurb: 'No sponsor stickers. Just a name and a reputation.',
    model: { cab: 'reg', bed: 'short', style: 'square', lift: 0.14, stacks: { n: 2, at: 'hood', h: 1.0, r: 0.13 }, hoodTurbo: 1, wheelieBars: true, weights: 1.4, cage: true, hitchBar: true, race: true },
    specs: { hp: 2750, weight: 7450, nGears: 3, redline: 4900, idle: 880, wheelRadius: 0.64, frontBias: 0.55, halfWidth: 1.1, drive: '4wd', maxLift: 0.19, tire: 'cut', durability: 1.0 },
    engine: ENGINES.cummins6({ turbo: 1, whistle: 1.4, pitch: 1.0 }), slots: SLOTS.race,
    liveries: [L('Outlaw Black', '#121212', '#c0c0c0', '#c0c0c0', 0, 'retro'), L('Big Sky', '#3a86d1', '#fff4dc', '#17140f', 7, 'stripe'),
      L('Sundown', '#e86a1f', '#7a1f12', '#17140f', 19, 'twoTone')] });
  V('ss_redline', { name: 'Night Train', brand: 'Redline Diesel Works', class: 'super_stock_diesel', price: 112000, levelReq: 10, family: 'pickup',
    desc: 'Extended-cab Super Stock with a billet V8 diesel and compound turbos. Only runs after dark, they say.',
    blurb: 'Four stacks, four wheels in the air (almost).',
    model: { cab: 'ext', bed: 'short', style: 'aero', lift: 0.18, stacks: { n: 4, at: 'hood', h: 0.85, r: 0.1 }, hoodTurbo: 2, wheelieBars: true, weights: 1.6, cage: true, hitchBar: true, race: true },
    specs: { hp: 3500, weight: 7500, nGears: 3, redline: 5300, idle: 920, wheelRadius: 0.67, frontBias: 0.56, halfWidth: 1.12, drive: '4wd', maxLift: 0.21, tire: 'cut', durability: 0.8 },
    engine: ENGINES.v8diesel({ turbo: 3, whistle: 1.3, pitch: 1.18 }), slots: SLOTS.race,
    liveries: [L('Night Train', '#101828', '#ff9f1a', '#ff9f1a', 1, 'flames'), L('Ghost', '#d8dde3', '#6a6f75', '#17140f', 8, 'tribal'),
      L('Blood Orange', '#d4371c', '#17140f', '#17140f', 55, 'checker')] });

  // ---- 2WD Modified Gas (6,200 lb, 1,800-2,600 hp) ----
  V('mg_wildfire', { name: 'Blown Away', brand: 'Wildfire Speed Shop', class: 'modified_2wd', price: 64000, levelReq: 6, family: 'pickup',
    desc: 'A late-model shell with a blown big-block sticking through the hood and zoomie headers out the fenders.',
    blurb: 'The blower whine alone sells funnel cakes.',
    model: { cab: 'reg', bed: 'short', style: 'modern', lift: -0.05, blower: true, zoomies: true, wheelieBars: true, weights: 1.2, hitchBar: true, race: true, rwd: true },
    specs: { hp: 2200, weight: 6200, nGears: 2, redline: 8000, idle: 1100, wheelRadius: 0.57, frontBias: 0.42, halfWidth: 1.05, drive: '2wd', maxLift: 0.22, tire: 'cut', wheelInertia: 14 },
    engine: ENGINES.bigblock(), slots: SLOTS.gas,
    liveries: [L('Wildfire', '#ff5a14', '#ffd23f', '#17140f', 7, 'flames'), L('Cobalt', '#0047ab', '#f3efe6', '#17140f', 28, 'stripe'),
      L('Bubblegum', '#ee6aa7', '#17140f', '#f3efe6', 69, 'checker')] });
  V('mg_stepside', { name: "'56 Stepside Fury", brand: 'Cedar Motor Co.', class: 'modified_2wd', price: 58000, levelReq: 6, family: 'pickup',
    desc: 'A fifties stepside body with round fenders over a 2,000 hp blown big-block. Hot rod meets hay field.',
    blurb: 'Restored by Grandma Edna. Raced by Grandma Edna.',
    model: { cab: 'reg', bed: 'short', style: 'classic', lift: -0.02, blower: true, zoomies: true, wheelieBars: true, weights: 1.0, hitchBar: true, race: true, rwd: true },
    specs: { hp: 2000, weight: 6150, nGears: 2, redline: 7800, idle: 1050, wheelRadius: 0.56, frontBias: 0.42, halfWidth: 1.0, drive: '2wd', maxLift: 0.22, tire: 'cut', wheelInertia: 14 },
    engine: ENGINES.bigblock({ pitch: 0.95, rough: 0.55 }), slots: SLOTS.gas,
    liveries: [L('Turquoise', '#3fb5a8', '#f3efe6', '#17140f', 56, 'twoTone'), L('Cherry', '#b0101c', '#f3efe6', '#17140f', 9, 'flames'),
      L('Butterscotch', '#e0a33a', '#5b2c17', '#17140f', 23, 'retro')] });
  V('mg_nitro', { name: 'Nitro Nellie', brand: 'Hammerhead Racing', class: 'modified_2wd', price: 72000, levelReq: 7, family: 'pickup',
    desc: 'Twin nitrous bottles in the bed, a huge blower and two gears. Fastest truck on the grounds.',
    blurb: 'Named after the owner\'s mule. The mule is also fast.',
    model: { cab: 'reg', bed: 'short', style: 'aero', lift: -0.05, blower: true, zoomies: true, wheelieBars: true, weights: 1.3, hitchBar: true, race: true, rwd: true, nitrous: true },
    specs: { hp: 2550, weight: 6200, nGears: 2, redline: 8400, idle: 1150, wheelRadius: 0.58, frontBias: 0.41, halfWidth: 1.05, drive: '2wd', maxLift: 0.24, tire: 'cut', wheelInertia: 14, durability: 0.85, boost: { mult: 1.4, duration: 2.0, heat: 0.08 } },
    engine: ENGINES.bigblock({ pitch: 1.1 }), slots: SLOTS.gas,
    liveries: [L('Nitro Purple', '#6a2bbd', '#5fd4e8', '#17140f', 2, 'swoosh'), L('Hammerhead Gray', '#6d747b', '#ff3b1a', '#17140f', 11, 'tribal'),
      L('Lemon Drop', '#f6e33b', '#17140f', '#17140f', 99, 'flames')] });
  V('mg_gasser', { name: 'Gasser Gus', brand: 'Wildfire Speed Shop', class: 'modified_2wd', price: 54000, levelReq: 6, family: 'pickup',
    desc: 'An eighties square-body with a tunnel-rammed small block and a big set of wheelie bars.',
    blurb: 'Gus built it, Gus drives it, Gus will tell you all about it.',
    model: { cab: 'reg', bed: 'short', style: 'square', lift: -0.04, blower: true, zoomies: true, wheelieBars: true, weights: 1.0, hitchBar: true, race: true, rwd: true },
    specs: { hp: 1850, weight: 6100, nGears: 2, redline: 7600, idle: 1000, wheelRadius: 0.55, frontBias: 0.43, halfWidth: 1.02, drive: '2wd', maxLift: 0.2, tire: 'cut', wheelInertia: 14, durability: 1.1 },
    engine: ENGINES.bigblock({ pitch: 0.92 }), slots: SLOTS.gas,
    liveries: [L('Gus Green', '#2f8f3a', '#f3efe6', '#17140f', 14, 'retro'), L('Pumpkin', '#ef7d1a', '#17140f', '#17140f', 31, 'stripe'),
      L('Baby Blue', '#8cc8f0', '#f3efe6', '#1b2f55', 6, 'twoTone')] });

  // ---- Big Rig Semi (20,000 lb, 600-1,100 hp) ----
  V('br_roadmaster', { name: 'Roadmaster 389 Longhood', brand: 'Atlas Heavy Haul', class: 'big_rig', price: 44000, levelReq: 4, family: 'semi',
    desc: 'A long-hood conventional with a stand-up sleeper, seven-inch chrome stacks and air cleaners like trash cans.',
    blurb: 'Two million miles and every one of them shiny.',
    model: { style: 'long', sleeper: true },
    specs: { hp: 850, weight: 19900, nGears: 3, redline: 2300, idle: 620, wheelRadius: 0.52, wheelbase: 5.9, cgHeight: 1.2, hitchHeight: 0.85, frontBias: 0.42, halfWidth: 1.27, drive: '4wd', tire: 'bigrig', durability: 1.2 },
    engine: ENGINES.semi(), slots: SLOTS.street,
    liveries: [L('Candy Red', '#a5141c', '#f3efe6', '#17140f', 18, 'stripe'), L('Midnight Blue', '#141f3c', '#c9a14a', '#c9a14a', 44, 'swoosh'),
      L('Cream & Green', '#efe3c4', '#1f5a32', '#17140f', 9, 'twoTone')] });
  V('br_cabover', { name: 'Hi-Rise Cabover', brand: 'Atlas Heavy Haul', class: 'big_rig', price: 36000, levelReq: 3, family: 'semi',
    desc: 'A flat-nosed seventies cabover with the engine right under the driver. Short wheelbase, big lean.',
    blurb: 'Smokey never caught her. The sled might.',
    model: { style: 'cabover', sleeper: true },
    specs: { hp: 700, weight: 19500, nGears: 3, redline: 2300, idle: 620, wheelRadius: 0.52, wheelbase: 4.4, cgHeight: 1.35, hitchHeight: 0.85, frontBias: 0.46, halfWidth: 1.25, drive: '4wd', tire: 'bigrig', durability: 1.25 },
    engine: ENGINES.semi({ pitch: 0.75, rough: 0.7 }), slots: SLOTS.street,
    liveries: [L('Banana', '#f2c230', '#5b2c17', '#17140f', 10, 'retro'), L('Rubber Duck', '#c8c8c0', '#1b2f55', '#17140f', 1, 'stripe'),
      L('Sunset', '#d4542a', '#f3d9a4', '#17140f', 75, 'twoTone')] });
  V('br_aero', { name: 'Skyline Aero Sleeper', brand: 'Northstar Trucks', class: 'big_rig', price: 40000, levelReq: 4, family: 'semi',
    desc: 'A modern aero highway tractor with a sloped hood and a full sleeper. Quietest truck in the pits.',
    blurb: 'Has a microwave, a TV and an attitude.',
    model: { style: 'aero', sleeper: true },
    specs: { hp: 760, weight: 19800, nGears: 3, redline: 2200, idle: 600, wheelRadius: 0.52, wheelbase: 5.6, cgHeight: 1.2, hitchHeight: 0.85, frontBias: 0.43, halfWidth: 1.27, drive: '4wd', tire: 'bigrig' },
    engine: ENGINES.semi({ pitch: 0.72, whistle: 0.8 }), slots: SLOTS.street,
    liveries: [L('Fleet White', '#f2f4f6', '#1f6fd1', '#17140f', 52, 'swoosh'), L('Charcoal', '#2b2e33', '#ff6a1a', '#ff6a1a', 7, 'stripe'),
      L('Forest Green', '#1d4a2c', '#d8c08a', '#17140f', 33, 'twoTone')] });
  V('br_ironmule', { name: 'Iron Mule Heavy Haul', brand: 'Ironhorse', class: 'big_rig', price: 52000, levelReq: 5, family: 'semi',
    desc: 'A day-cab heavy hauler turned up to 1,100 hp. Four stacks, a bumper full of weights and no shame.',
    blurb: 'Hauls bulldozers on weekdays. Hauls the sled on Saturdays.',
    model: { style: 'long', sleeper: false, stacks4: true, weights: true },
    specs: { hp: 1100, weight: 20000, nGears: 3, redline: 2500, idle: 650, wheelRadius: 0.53, wheelbase: 5.3, cgHeight: 1.15, hitchHeight: 0.85, frontBias: 0.45, halfWidth: 1.28, drive: '4wd', tire: 'bigrig', durability: 1.05 },
    engine: ENGINES.semi({ pitch: 0.78, whistle: 1.0, turbo: 2 }), slots: SLOTS.street,
    liveries: [L('Hi-Vis', '#ffc61a', '#17140f', '#17140f', 1, 'checker'), L('Iron Black', '#151515', '#c8342b', '#c0c0c0', 13, 'flames'),
      L('Purple Haze', '#4a2a7a', '#e0c0ff', '#17140f', 21, 'stripe')] });

  /* ======== TRACTORS ======== */
  // ---- Mini Rods (2,050 lb, 800-1,600 hp) ----
  V('mr_pocket_rocket', { name: 'Pocket Rocket', brand: 'Wildfire Speed Shop', class: 'mini_rod', price: 26000, levelReq: 2, family: 'mini',
    desc: 'A 2,000 lb chassis with a blown big-block, wheelie bars and a short temper. Feather it or it bites.',
    blurb: 'Small, angry and on fire. Like a hornet with a blower.',
    model: { engines: 1, blower: true },
    specs: { hp: 1150, weight: 2030, nGears: 2, redline: 7800, idle: 1100, wheelRadius: 0.62, wheelbase: 2.3, cgHeight: 0.6, hitchHeight: 0.5, frontBias: 0.24, halfWidth: 0.95, drive: '2wd', maxLift: 0.3, wheelInertia: 12, hopFreq: 5.2 },
    engine: ENGINES.bigblock({ pitch: 1.1, rough: 0.4 }), slots: SLOTS.gas,
    liveries: [L('Hot Lava', '#ff6a1a', '#ffd23f', '#17140f', 7, 'flames'), L('Grape Soda', '#7a3fa0', '#5fd4e8', '#17140f', 99, 'stripe'),
      L('Lime Light', '#8cc63f', '#17140f', '#f3efe6', 1, 'checker')] });
  V('mr_twin_terror', { name: 'Twin Terror', brand: 'Hammerhead Racing', class: 'mini_rod', price: 38000, levelReq: 4, family: 'mini',
    desc: 'Two small-block V8s side by side in a chassis the size of a riding mower. Pure chaos.',
    blurb: 'Two engines, one brain cell, zero regrets.',
    model: { engines: 2, blower: false },
    specs: { hp: 1550, weight: 2050, nGears: 2, redline: 8200, idle: 1150, wheelRadius: 0.63, wheelbase: 2.4, cgHeight: 0.62, hitchHeight: 0.5, frontBias: 0.25, halfWidth: 0.98, drive: '2wd', maxLift: 0.32, wheelInertia: 12, hopFreq: 5.3, durability: 0.85 },
    engine: { type: 'multi', count: 2, cyl: 8, blower: false, pitch: 1.15, rough: 0.45, volume: 1 }, slots: SLOTS.gas,
    liveries: [L('Hammerhead', '#5d6770', '#ff3b1a', '#17140f', 2, 'tribal'), L('Bumble', '#ffcc00', '#17140f', '#17140f', 22, 'checker'),
      L('Ocean', '#0f7fa8', '#f3efe6', '#17140f', 8, 'swoosh')] });
  V('mr_bumblebee', { name: 'Bumble Bee', brand: 'Little Giant Customs', class: 'mini_rod', price: 18000, levelReq: 1, family: 'mini',
    desc: 'A naturally aspirated small block with a shot of nitrous. The friendliest way into the mini rods.',
    blurb: 'Buzzes. Stings sometimes.',
    model: { engines: 1, blower: false, nitrous: true },
    specs: { hp: 880, weight: 2000, nGears: 2, redline: 7400, idle: 1000, wheelRadius: 0.6, wheelbase: 2.25, cgHeight: 0.58, hitchHeight: 0.5, frontBias: 0.26, halfWidth: 0.93, drive: '2wd', maxLift: 0.28, wheelInertia: 12, hopFreq: 5.0, durability: 1.15 },
    engine: ENGINES.bigblock({ blower: false, pitch: 1.2, rough: 0.35 }), slots: SLOTS.gas,
    liveries: [L('Bumble Bee', '#ffc61a', '#17140f', '#17140f', 5, 'stripe'), L('Ladybug', '#d12a1b', '#17140f', '#17140f', 3, 'checker'),
      L('Mint', '#7fd8b0', '#17140f', '#f3efe6', 12, 'swoosh')] });

  // ---- Farm Stock (11,000 lb, 300-550 hp, ag tires) ----
  V('fs_prairie', { name: '4650 Row Crop', brand: 'Prairie King', class: 'farm_stock', price: 15000, levelReq: 1, family: 'tractor',
    desc: 'A big-tired row-crop tractor straight off the farm, with a cab, a suitcase-weight bracket and one tall stack.',
    blurb: 'Planted 600 acres in May. Pulling for bragging rights in July.',
    model: { style: 'cab', stackH: 1.25 },
    specs: { hp: 480, weight: 10950, nGears: 3, redline: 2600, idle: 800, wheelRadius: 0.92, wheelbase: 2.9, cgHeight: 1.1, hitchHeight: 0.55, frontBias: 0.36, halfWidth: 1.35, drive: '2wd', maxLift: 0.16, durability: 1.2 },
    engine: ENGINES.ag6(), slots: SLOTS.farm,
    liveries: [L('Prairie Green', '#2e7d32', '#ffd23f', '#1a1a1a', 46, 'farm', { rim: '#ffd23f' }), L('Harvest Red', '#b8322a', '#f3efe6', '#1a1a1a', 12, 'farm', { rim: '#e8e4dc' }),
      L('Field Orange', '#e8731f', '#1a1a1a', '#f3efe6', 77, 'farm', { rim: '#1a1a1a' })] });
  V('fs_grandpa', { name: "Grandpa's 1968 Prairie King", brand: 'Prairie King', class: 'farm_stock', price: 8000, levelReq: 1, family: 'tractor',
    desc: 'An open-station sixties classic with a rounded hood, no cab and a seat polished by fifty years of overalls.',
    blurb: "Grandpa's 1968 Prairie King — slow but never quits.",
    model: { style: 'classic', stackH: 0.9 },
    specs: { hp: 320, weight: 10400, nGears: 3, redline: 2300, idle: 700, wheelRadius: 0.86, wheelbase: 2.6, cgHeight: 1.0, hitchHeight: 0.52, frontBias: 0.37, halfWidth: 1.25, drive: '2wd', maxLift: 0.15, durability: 1.45, heat: 0.9 },
    engine: ENGINES.ag6({ pitch: 0.7, rough: 0.85, whistle: 0.2 }), slots: SLOTS.farm,
    liveries: [L('Original Green', '#3a7a2a', '#f2c230', '#1a1a1a', 68, 'farm', { rim: '#f2c230' }), L('Barn Find', '#6f7d4e', '#c9a14a', '#1a1a1a', 1, 'farm', { rim: '#c9a14a' }),
      L('Sunday Best', '#2f8f3a', '#ffe36a', '#1a1a1a', 6, 'farm', { rim: '#ffe36a' })] });
  V('fs_redrooster', { name: 'Red Rooster 1468', brand: 'Red Rooster Ag', class: 'farm_stock', price: 13000, levelReq: 1, family: 'tractor',
    desc: 'The classic red row-crop with a V8 diesel and a wide front. Red paint is worth five horsepower, they say.',
    blurb: 'Cock-a-doodle-DIESEL.',
    model: { style: 'rowcrop', stackH: 1.15 },
    specs: { hp: 450, weight: 10900, nGears: 3, redline: 2600, idle: 760, wheelRadius: 0.9, wheelbase: 2.8, cgHeight: 1.05, hitchHeight: 0.55, frontBias: 0.36, halfWidth: 1.32, drive: '2wd', maxLift: 0.16, durability: 1.2 },
    engine: ENGINES.ag6({ cyl: 8, pitch: 0.86, rough: 0.65 }), slots: SLOTS.farm,
    liveries: [L('Rooster Red', '#c0231b', '#f3efe6', '#1a1a1a', 14, 'farm', { rim: '#e8e4dc' }), L('Dealer Demo', '#a51c16', '#ffd23f', '#1a1a1a', 68, 'farm', { rim: '#ffd23f' }),
      L('White Demo', '#efeae0', '#c0231b', '#1a1a1a', 2, 'farm', { rim: '#c0231b' })] });
  V('fs_oakfield', { name: 'Oakfield 7080', brand: 'Oakfield Implement', class: 'farm_stock', price: 16000, levelReq: 2, family: 'tractor',
    desc: 'Persian-orange two-wheel-drive with a turbo six and a cab full of dials. Heavy, smooth and steady.',
    blurb: 'Orange you glad you came to the fair?',
    model: { style: 'cab', stackH: 1.2, cabRound: true },
    specs: { hp: 520, weight: 11000, nGears: 3, redline: 2650, idle: 780, wheelRadius: 0.93, wheelbase: 2.95, cgHeight: 1.12, hitchHeight: 0.55, frontBias: 0.37, halfWidth: 1.36, drive: '2wd', maxLift: 0.16, durability: 1.15 },
    engine: ENGINES.ag6({ pitch: 0.82 }), slots: SLOTS.farm,
    liveries: [L('Persian Orange', '#e8731f', '#1a1a1a', '#f3efe6', 70, 'farm', { rim: '#1a1a1a' }), L('Cream Special', '#efe3c4', '#e8731f', '#1a1a1a', 80, 'farm', { rim: '#e8731f' }),
      L('Rust Bucket', '#a5532a', '#2a2a2a', '#f3efe6', 7, 'farm', { rim: '#2a2a2a' })] });
  V('fs_bluestar', { name: 'Bluestar 8800 Countryman', brand: 'Bluestar Tractor Works', class: 'farm_stock', price: 14000, levelReq: 2, family: 'tractor',
    desc: 'A blue-and-white open-station with a flat-top fender, a big canopy and a sneaky good turbo.',
    blurb: 'Bought new by Aunt Ruth in 1979. She still beats her nephews with it.',
    model: { style: 'rowcrop', stackH: 1.1, canopy: true },
    specs: { hp: 470, weight: 10800, nGears: 3, redline: 2550, idle: 760, wheelRadius: 0.9, wheelbase: 2.75, cgHeight: 1.05, hitchHeight: 0.55, frontBias: 0.37, halfWidth: 1.32, drive: '2wd', maxLift: 0.16, durability: 1.25 },
    engine: ENGINES.ag6({ pitch: 0.8, whistle: 0.6 }), slots: SLOTS.farm,
    liveries: [L('Bluestar', '#1f5aa6', '#f3efe6', '#1a1a1a', 88, 'farm', { rim: '#f3efe6' }), L('Silver Star', '#a9b0b8', '#1f5aa6', '#1a1a1a', 8, 'farm', { rim: '#1f5aa6' }),
      L('Navy', '#1b2f55', '#ffd23f', '#1a1a1a', 15, 'farm', { rim: '#ffd23f' })] });

  // ---- Hot Farm (12,000 lb, 600-950 hp, ag) ----
  V('hf_redrooster', { name: 'Rooster Rampage', brand: 'Red Rooster Ag', class: 'hot_farm', price: 30000, levelReq: 3, family: 'tractor',
    desc: 'A red classic with the pump turned way up, a bigger turbo and twin stacks blowing black clouds.',
    blurb: 'Still plows the garden. Very, very quickly.',
    model: { style: 'rowcrop', stackH: 1.15, twinStacks: true, bigTurbo: true, weights: 1.2 },
    specs: { hp: 820, weight: 11950, nGears: 3, redline: 2900, idle: 800, wheelRadius: 0.93, wheelbase: 2.85, cgHeight: 1.05, hitchHeight: 0.55, frontBias: 0.36, halfWidth: 1.35, drive: '2wd', maxLift: 0.17 },
    engine: ENGINES.ag6({ cyl: 8, pitch: 0.9, whistle: 0.9 }), slots: SLOTS.race,
    liveries: [L('Rampage Red', '#c0231b', '#f3efe6', '#1a1a1a', 15, 'farm', { rim: '#e8e4dc' }), L('Black Rooster', '#1a1a1a', '#c0231b', '#c0231b', 1, 'farm', { rim: '#c0231b' }),
      L('Gold Rush', '#c9a14a', '#1a1a1a', '#1a1a1a', 39, 'farm', { rim: '#1a1a1a' })] });
  V('hf_prairie', { name: 'Big Green Machine', brand: 'Prairie King', class: 'hot_farm', price: 34000, levelReq: 4, family: 'tractor',
    desc: 'Modern cab tractor, cranked pump, compound turbos and a full front weight bracket. Farm look, race heart.',
    blurb: 'Nothing runs like it. Nothing pulls like it, either.',
    model: { style: 'cab', stackH: 1.25, bigTurbo: true, weights: 1.3 },
    specs: { hp: 920, weight: 12000, nGears: 3, redline: 3000, idle: 800, wheelRadius: 0.94, wheelbase: 3.0, cgHeight: 1.12, hitchHeight: 0.55, frontBias: 0.37, halfWidth: 1.38, drive: '2wd', maxLift: 0.17 },
    engine: ENGINES.ag6({ turbo: 2, pitch: 0.84, whistle: 1.0 }), slots: SLOTS.race,
    liveries: [L('Big Green', '#2e7d32', '#ffd23f', '#1a1a1a', 40, 'farm', { rim: '#ffd23f' }), L('Dark Green', '#1d4a2c', '#ffd23f', '#1a1a1a', 4, 'farm', { rim: '#ffd23f' }),
      L('Chrome Green', '#3aa04a', '#e8e8e8', '#1a1a1a', 27, 'farm', { rim: '#e8e8e8' })] });
  V('hf_oakfield', { name: 'Orange Crush', brand: 'Oakfield Implement', class: 'hot_farm', price: 31000, levelReq: 3, family: 'tractor',
    desc: 'An open-station Oakfield with a hot cam, a straight pipe and enough front weights to anchor a boat.',
    blurb: 'Squeezes every drop out of the sled.',
    model: { style: 'classic', stackH: 1.1, twinStacks: true, bigTurbo: true, weights: 1.4 },
    specs: { hp: 760, weight: 11900, nGears: 3, redline: 2850, idle: 780, wheelRadius: 0.92, wheelbase: 2.75, cgHeight: 1.02, hitchHeight: 0.55, frontBias: 0.37, halfWidth: 1.33, drive: '2wd', maxLift: 0.17, durability: 1.15 },
    engine: ENGINES.ag6({ pitch: 0.88, whistle: 0.85 }), slots: SLOTS.race,
    liveries: [L('Crush Orange', '#ef7d1a', '#1a1a1a', '#f3efe6', 18, 'farm', { rim: '#1a1a1a' }), L('Cream Crush', '#efe3c4', '#ef7d1a', '#1a1a1a', 81, 'farm', { rim: '#ef7d1a' }),
      L('Midnight Orange', '#1a1a1a', '#ef7d1a', '#ef7d1a', 0, 'farm', { rim: '#ef7d1a' })] });

  // ---- Pro Stock Tractor (10,000 lb, 2,000-2,700 hp, cut) ----
  V('pt_prairie', { name: 'Green Thunder', brand: 'Prairie King', class: 'pro_stock_tractor', price: 68000, levelReq: 6, family: 'tractor',
    desc: 'Stock-appearing tins over a race block with one enormous turbo through the hood and a nose of suitcase weights.',
    blurb: 'Looks like it came from a field. It came from a machine shop.',
    model: { style: 'prostock', stackH: 0.7, turbos: 1, weights: 1.8, wheelieBars: true },
    specs: { hp: 2400, weight: 9980, nGears: 3, redline: 3800, idle: 850, wheelRadius: 0.98, wheelbase: 3.0, cgHeight: 1.0, hitchHeight: 0.5, frontBias: 0.34, halfWidth: 1.4, drive: '2wd', maxLift: 0.2, tire: 'cut', durability: 0.95 },
    engine: ENGINES.ag6({ turbo: 3, pitch: 0.95, whistle: 1.2, rough: 0.5 }), slots: SLOTS.race,
    liveries: [L('Thunder Green', '#2e7d32', '#ffd23f', '#1a1a1a', 4, 'farm', { rim: '#ffd23f' }), L('Lightning Yellow', '#ffd23f', '#2e7d32', '#1a1a1a', 44, 'farm', { rim: '#2e7d32' }),
      L('Night Green', '#13311b', '#a6e22e', '#a6e22e', 9, 'tribal', { rim: '#a6e22e' })] });
  V('pt_redrooster', { name: 'Rooster Booster', brand: 'Red Rooster Ag', class: 'pro_stock_tractor', price: 64000, levelReq: 6, family: 'tractor',
    desc: 'Classic red sheet metal, a chrome single turbo the size of a bucket and a 30-foot cloud behind it.',
    blurb: 'The rooster crows at 3,800 rpm.',
    model: { style: 'prostock', stackH: 0.75, turbos: 1, weights: 1.7, wheelieBars: true },
    specs: { hp: 2250, weight: 10000, nGears: 3, redline: 3700, idle: 840, wheelRadius: 0.97, wheelbase: 2.95, cgHeight: 1.0, hitchHeight: 0.5, frontBias: 0.34, halfWidth: 1.4, drive: '2wd', maxLift: 0.2, tire: 'cut', durability: 1.0 },
    engine: ENGINES.ag6({ turbo: 3, pitch: 0.92, whistle: 1.15 }), slots: SLOTS.race,
    liveries: [L('Booster Red', '#c0231b', '#f3efe6', '#1a1a1a', 21, 'farm', { rim: '#e8e4dc' }), L('Flame Job', '#1a1a1a', '#ff6a1a', '#ffd23f', 66, 'flames', { rim: '#ff6a1a' }),
      L('Silver Rooster', '#b8bec4', '#c0231b', '#1a1a1a', 3, 'farm', { rim: '#c0231b' })] });
  V('pt_bluestar', { name: 'Blue Collar', brand: 'Bluestar Tractor Works', class: 'pro_stock_tractor', price: 71000, levelReq: 7, family: 'tractor',
    desc: 'The top-dog Pro Stock: billet block, 2,700 hp, and a hood scoop you could sleep in.',
    blurb: 'Clocks in, pulls hard, clocks out.',
    model: { style: 'prostock', stackH: 0.8, turbos: 1, weights: 1.9, wheelieBars: true },
    specs: { hp: 2650, weight: 10000, nGears: 3, redline: 3900, idle: 860, wheelRadius: 0.99, wheelbase: 3.05, cgHeight: 1.0, hitchHeight: 0.5, frontBias: 0.34, halfWidth: 1.42, drive: '2wd', maxLift: 0.21, tire: 'cut', durability: 0.9 },
    engine: ENGINES.ag6({ turbo: 3, pitch: 0.98, whistle: 1.25 }), slots: SLOTS.race,
    liveries: [L('Collar Blue', '#1f5aa6', '#f3efe6', '#1a1a1a', 10, 'farm', { rim: '#f3efe6' }), L('Overtime', '#ff9f1a', '#1f5aa6', '#1a1a1a', 40, 'stripe', { rim: '#1f5aa6' }),
      L('Steel Blue', '#4a6a8a', '#f3efe6', '#1a1a1a', 7, 'swoosh', { rim: '#f3efe6' })] });

  // ---- Light Super Stock (6,200 lb, 3,000-3,600 hp, methanol) ----
  V('ls_oakfield', { name: 'Fire Ant', brand: 'Oakfield Implement', class: 'light_super_stock', price: 84000, levelReq: 8, family: 'tractor',
    desc: 'A lightweight methanol burner with three turbos stacked up the side and flames on every gear change.',
    blurb: 'Tiny. Orange. Bites.',
    model: { style: 'superstock', stackH: 0.55, turbos: 3, weights: 1.5, wheelieBars: true },
    specs: { hp: 3300, weight: 6200, nGears: 3, redline: 6200, idle: 1300, wheelRadius: 0.95, wheelbase: 2.9, cgHeight: 0.95, hitchHeight: 0.48, frontBias: 0.3, halfWidth: 1.38, drive: '2wd', maxLift: 0.22, tire: 'cut', durability: 0.9 },
    engine: ENGINES.meth({ turbo: 3, pitch: 1.0 }), slots: SLOTS.race,
    liveries: [L('Fire Ant', '#ef7d1a', '#1a1a1a', '#f3efe6', 3, 'flames', { rim: '#1a1a1a' }), L('Carbon', '#222428', '#ef7d1a', '#ef7d1a', 33, 'tribal', { rim: '#ef7d1a' }),
      L('Sherbet', '#ffb07a', '#f3efe6', '#1a1a1a', 8, 'swoosh', { rim: '#f3efe6' })] });
  V('ls_bluestar', { name: 'Blue Lightning', brand: 'Bluestar Tractor Works', class: 'light_super_stock', price: 88000, levelReq: 8, family: 'tractor',
    desc: 'Three-turbo alcohol motor in a featherweight frame. Nervous, quick and loud enough to rattle the bleachers.',
    blurb: 'Strikes the same place twice. Usually the 300-foot line.',
    model: { style: 'superstock', stackH: 0.55, turbos: 3, weights: 1.6, wheelieBars: true },
    specs: { hp: 3550, weight: 6200, nGears: 3, redline: 6400, idle: 1320, wheelRadius: 0.96, wheelbase: 2.95, cgHeight: 0.95, hitchHeight: 0.48, frontBias: 0.3, halfWidth: 1.38, drive: '2wd', maxLift: 0.23, tire: 'cut', durability: 0.85 },
    engine: ENGINES.meth({ turbo: 3, pitch: 1.05 }), slots: SLOTS.race,
    liveries: [L('Lightning', '#1f5aa6', '#ffd23f', '#1a1a1a', 11, 'swoosh', { rim: '#ffd23f' }), L('Storm', '#2b2f36', '#5fd4e8', '#5fd4e8', 5, 'tribal', { rim: '#5fd4e8' }),
      L('Sky', '#7fb8e8', '#f3efe6', '#1b2f55', 71, 'stripe', { rim: '#f3efe6' })] });

  // ---- Super Stock Tractor (8,000 lb, 4,000-5,000 hp, methanol) ----
  V('st_prairie', { name: 'Quad Squad', brand: 'Prairie King', class: 'super_stock_tractor', price: 125000, levelReq: 10, family: 'tractor',
    desc: 'Four turbos, methanol, 4,800 hp and a wing of front weights. Fire-breathing king of the county fair.',
    blurb: 'You do not drive it. You hold on and negotiate.',
    model: { style: 'superstock', stackH: 0.6, turbos: 4, weights: 2.0, wheelieBars: true, big: true },
    specs: { hp: 4800, weight: 8000, nGears: 3, redline: 6600, idle: 1350, wheelRadius: 1.0, wheelbase: 3.1, cgHeight: 1.0, hitchHeight: 0.48, frontBias: 0.32, halfWidth: 1.45, drive: '2wd', maxLift: 0.24, tire: 'cut', durability: 0.85 },
    engine: ENGINES.meth({ turbo: 4, pitch: 1.0, whistle: 1.2 }), slots: SLOTS.race,
    liveries: [L('Quad Green', '#2e7d32', '#ffd23f', '#1a1a1a', 1, 'flames', { rim: '#ffd23f' }), L('Black Gold', '#141414', '#ffd23f', '#ffd23f', 4, 'tribal', { rim: '#ffd23f' }),
      L('Mint Julep', '#9ad8b0', '#2e7d32', '#1a1a1a', 44, 'swoosh', { rim: '#2e7d32' })] });
  V('st_redrooster', { name: 'Inferno', brand: 'Red Rooster Ag', class: 'super_stock_tractor', price: 118000, levelReq: 9, family: 'tractor',
    desc: 'Four chrome turbos, flames out of every stack and a cloud of alcohol vapor you can smell from the parking lot.',
    blurb: 'Hottest act at the fair. Literally.',
    model: { style: 'superstock', stackH: 0.6, turbos: 4, weights: 1.9, wheelieBars: true, big: true },
    specs: { hp: 4400, weight: 8000, nGears: 3, redline: 6400, idle: 1330, wheelRadius: 0.99, wheelbase: 3.05, cgHeight: 1.0, hitchHeight: 0.48, frontBias: 0.32, halfWidth: 1.45, drive: '2wd', maxLift: 0.24, tire: 'cut', durability: 0.9 },
    engine: ENGINES.meth({ turbo: 4, pitch: 0.96 }), slots: SLOTS.race,
    liveries: [L('Inferno', '#c0231b', '#ffd23f', '#1a1a1a', 13, 'flames', { rim: '#ffd23f' }), L('White Heat', '#f2efe8', '#c0231b', '#1a1a1a', 6, 'swoosh', { rim: '#c0231b' }),
      L('Ember', '#3a1410', '#ff6a1a', '#ff6a1a', 9, 'tribal', { rim: '#ff6a1a' })] });
  V('st_bluestar', { name: 'Big Blue Bully', brand: 'Bluestar Tractor Works', class: 'super_stock_tractor', price: 132000, levelReq: 11, family: 'tractor',
    desc: 'The heaviest-hitting Super Stock in the pits: 5,000 hp, four turbos and a wheelie bar like a drawbridge.',
    blurb: 'Lunch money, please.',
    model: { style: 'superstock', stackH: 0.65, turbos: 4, weights: 2.1, wheelieBars: true, big: true },
    specs: { hp: 5000, weight: 8000, nGears: 3, redline: 6800, idle: 1380, wheelRadius: 1.01, wheelbase: 3.15, cgHeight: 1.0, hitchHeight: 0.48, frontBias: 0.32, halfWidth: 1.46, drive: '2wd', maxLift: 0.25, tire: 'cut', durability: 0.8 },
    engine: ENGINES.meth({ turbo: 4, pitch: 1.04, whistle: 1.3 }), slots: SLOTS.race,
    liveries: [L('Bully Blue', '#1f5aa6', '#f3efe6', '#1a1a1a', 5, 'stripe', { rim: '#f3efe6' }), L('Bruiser', '#2a2a6a', '#ff3b1a', '#ff3b1a', 55, 'flames', { rim: '#ff3b1a' }),
      L('Ice', '#d8e8f4', '#1f5aa6', '#1a1a1a', 0, 'swoosh', { rim: '#1f5aa6' })] });

  // ---- Unlimited Modified (7,500 lb, 6,000-10,000 hp) ----
  V('um_quad_v8', { name: 'Four Horsemen', brand: 'Hammerhead Racing', class: 'unlimited_modified', price: 160000, levelReq: 11, family: 'modified',
    desc: 'Four supercharged big-block V8s in a row, 32 zoomie pipes and 8,000 horsepower. The ground shakes.',
    blurb: 'Apocalypse, now with a wheelie bar.',
    model: { engines: 4, layout: 'inline' },
    specs: { hp: 8200, weight: 7500, nGears: 3, redline: 7400, idle: 1100, wheelRadius: 1.0, wheelbase: 5.4, cgHeight: 0.95, hitchHeight: 0.48, frontBias: 0.36, halfWidth: 1.45, drive: '2wd', maxLift: 0.18, tire: 'cut', durability: 0.85 },
    engine: { type: 'multi', count: 4, cyl: 8, blower: true, pitch: 0.95, rough: 0.5, volume: 1.15 }, slots: SLOTS.gas,
    liveries: [L('Horsemen', '#1a1a1a', '#d12a1b', '#d12a1b', 4, 'flames', { rim: '#d12a1b' }), L('Pale Horse', '#d8dccd', '#4a5a3a', '#1a1a1a', 44, 'tribal', { rim: '#4a5a3a' }),
      L('Gold Horse', '#c9a14a', '#1a1a1a', '#1a1a1a', 1, 'swoosh', { rim: '#1a1a1a' })] });
  V('um_turbine', { name: 'Jet Set', brand: 'Skyhook Aero Pulling', class: 'unlimited_modified', price: 175000, levelReq: 12, family: 'modified',
    desc: 'A surplus helicopter turbine bolted to a pulling chassis. It whistles, it glows and it does not care.',
    blurb: 'Cleared for takeoff. Pulling the sled is just a side effect.',
    model: { engines: 0, turbine: true },
    specs: { hp: 7600, weight: 7500, nGears: 3, redline: 7200, idle: 2200, wheelRadius: 1.0, wheelbase: 5.0, cgHeight: 0.95, hitchHeight: 0.48, frontBias: 0.35, halfWidth: 1.45, drive: '2wd', maxLift: 0.18, tire: 'cut', durability: 0.95 },
    engine: { type: 'turbine', count: 1, whistle: 1.4, pitch: 1.0, rough: 0.1, volume: 1.1 }, slots: SLOTS.race,
    liveries: [L('Afterburner', '#e8e8e8', '#ff6a1a', '#1a1a1a', 1, 'swoosh', { rim: '#ff6a1a' }), L('Navy Jet', '#1b2f55', '#ffd23f', '#ffd23f', 52, 'stripe', { rim: '#ffd23f' }),
      L('Stealth Jet', '#2a2d31', '#5fd4e8', '#5fd4e8', 0, 'tribal', { rim: '#5fd4e8' })] });
  V('um_double', { name: 'Double Trouble', brand: 'Wildfire Speed Shop', class: 'unlimited_modified', price: 140000, levelReq: 10, family: 'modified',
    desc: 'Two blown hemis side by side, 6,400 horsepower and enough fire to roast a hog. The entry ticket to the craziest class.',
    blurb: 'Twice the engines, twice the trouble, twice the fun.',
    model: { engines: 2, layout: 'side' },
    specs: { hp: 6400, weight: 7400, nGears: 3, redline: 7600, idle: 1100, wheelRadius: 0.98, wheelbase: 4.4, cgHeight: 0.92, hitchHeight: 0.48, frontBias: 0.34, halfWidth: 1.42, drive: '2wd', maxLift: 0.2, tire: 'cut', durability: 0.92 },
    engine: { type: 'multi', count: 2, cyl: 8, blower: true, pitch: 1.0, rough: 0.5, volume: 1.1 }, slots: SLOTS.gas,
    liveries: [L('Trouble Red', '#c0231b', '#ffd23f', '#1a1a1a', 2, 'flames', { rim: '#ffd23f' }), L('Teal Trouble', '#118a8a', '#f3efe6', '#1a1a1a', 22, 'swoosh', { rim: '#f3efe6' }),
      L('Black Cherry', '#3a0d16', '#e85d9a', '#e85d9a', 6, 'tribal', { rim: '#e85d9a' })] });
  V('um_triple', { name: 'Triple Threat', brand: 'Ironhorse', class: 'unlimited_modified', price: 168000, levelReq: 12, family: 'modified',
    desc: 'Three injected V8s staggered down a seven-meter frame. 9,500 hp of pure county-fair thunder.',
    blurb: 'Three engines. One sled. No chance.',
    model: { engines: 3, layout: 'inline' },
    specs: { hp: 9500, weight: 7500, nGears: 3, redline: 7600, idle: 1120, wheelRadius: 1.01, wheelbase: 5.2, cgHeight: 0.95, hitchHeight: 0.48, frontBias: 0.36, halfWidth: 1.46, drive: '2wd', maxLift: 0.18, tire: 'cut', durability: 0.8 },
    engine: { type: 'multi', count: 3, cyl: 8, blower: true, pitch: 0.98, rough: 0.55, volume: 1.15 }, slots: SLOTS.gas,
    liveries: [L('Ironhorse Silver', '#aab2ba', '#c0231b', '#1a1a1a', 3, 'stripe', { rim: '#c0231b' }), L('Threat Level', '#ffc61a', '#1a1a1a', '#1a1a1a', 333, 'checker', { rim: '#1a1a1a' }),
      L('Copperhead', '#9a4a22', '#f3d9a4', '#1a1a1a', 13, 'flames', { rim: '#f3d9a4' })] });

  /* ---------------------------------------------------------------------------
   * 4. SPEC DEFAULTS + REGISTRATION
   * ------------------------------------------------------------------------- */
  var FAMILY_BUILD = { pickup: 'pickup', semi: 'semi', tractor: 'tractor', mini: 'miniRod', modified: 'modified' };
  function finishSpecs(id, d) {
    var s = d.specs, cls = TP.classes[d.class] || {}, mo = d.model || {};
    var tractor = cls.group === 'tractor';
    if (d.family === 'pickup') {
      s.wheelbase = s.wheelbase || pickupWB(mo.cab, mo.bed);
      s.cgHeight = s.cgHeight || (0.85 + (mo.lift || 0) * 0.6 + (s.wheelRadius - 0.45) * 0.5);
      s.hitchHeight = s.hitchHeight || (mo.race ? 0.6 : 0.62);
      if (mo.race && s.maxLift == null) s.maxLift = 0.14;
    }
    s.tire = s.tire || cls.tire;
    s.traction = s.traction || 1;
    s.durability = s.durability || 1;
    s.shiftRpm = s.shiftRpm || Math.round(s.redline * 0.92);
    s.gears = autoGears(d.class, s, s.nGears || 3);
    s.torque = s.torque || Math.round(s.hp * 5252 / (s.redline * 0.6));
    s.boostShots = s.boostShots != null ? s.boostShots : cls.boostShots;
    if (!s.halfWidth) s.halfWidth = tractor ? 1.3 : 1.05;
    d.seatX = d.seatX != null ? d.seatX : (d.family === 'pickup' ? s.wheelbase - 2.1 : d.family === 'semi' ? s.wheelbase - 1.9 : d.family === 'modified' ? 0.25 : -0.35);
    d.seatY = d.seatY || (d.family === 'pickup' ? s.wheelRadius + (mo.lift || 0) + 1.55 : d.family === 'semi' ? 2.9 : s.wheelRadius * 2 + 0.55);
  }
  DEFS.forEach(function (e) {
    var id = e[0], d = e[1];
    try {
      finishSpecs(id, d);
      var fam = FAMILY_BUILD[d.family] || 'pickup';
      d.modelFamily = fam;
      d.build = function (livery) { return TP.vehicleModels[fam](livery, this); };
      TP.addVehicle(id, d);
    } catch (err) { try { console.error('[vehicles] could not register', id, err); } catch (e2) {} }
  });
  TP.vehicleModels = TP.vehicleModels || {};

  /*__MODELS__*/
})();
