/* =====================================================================
 * Wildwood Hunter — core.js
 * Engine + global window.HG API + base content (pine_valley, whitetail_deer,
 * rabbit, hunting_rifle + rifle_ammo).  See API.md for the full contract.
 *
 * Conventions: Y up, 1 unit = 1 meter. yaw 0 looks toward -Z (north),
 * positive yaw turns LEFT (counter-clockwise seen from above). East = +X.
 * Animals and the player share the same yaw convention:
 *   forward(yaw) = (-sin(yaw), 0, -cos(yaw)).
 * Requires THREE r128 (global). Classic script, no modules.
 * ===================================================================== */
(function () {
  'use strict';
  if (!window.THREE) { console.error('Wildwood Hunter: THREE missing'); return; }
  var HG = window.HG = window.HG || {};
  HG.version = '1.0.0';
  HG.booted = false;
  HG.debugEnabled = /(^|[#&])debug\b/.test(location.hash || '');

  var PI = Math.PI, TAU = Math.PI * 2, DEG = Math.PI / 180;

  /* ------------------------------------------------------------------
   * Utilities
   * ------------------------------------------------------------------ */
  var U = HG.util = {
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    smooth: function (e0, e1, x) { var t = U.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); },
    /** frame-rate independent exponential approach: damp(cur, target, lambda, dt) */
    damp: function (a, b, lambda, dt) { return b + (a - b) * Math.exp(-lambda * dt); },
    rand: function (a, b) { return a + Math.random() * (b - a); },
    randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    /** pick from array of objects by numeric key (default 'weight') */
    weighted: function (arr, key) {
      key = key || 'weight'; var tot = 0, i;
      for (i = 0; i < arr.length; i++) tot += Math.max(0, arr[i][key] || 0);
      if (tot <= 0) return arr[0];
      var r = Math.random() * tot;
      for (i = 0; i < arr.length; i++) { r -= Math.max(0, arr[i][key] || 0); if (r <= 0) return arr[i]; }
      return arr[arr.length - 1];
    },
    /** wrap angle to (-PI, PI] */
    wrap: function (a) { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; },
    angleDiff: function (a, b) { return U.wrap(b - a); },
    /** yaw (HG convention) that faces from (x0,z0) toward (x1,z1) */
    yawTo: function (x0, z0, x1, z1) { return Math.atan2(-(x1 - x0), -(z1 - z0)); },
    /** forward vector for a yaw (HG convention), written into out */
    forward: function (yaw, out) { out = out || new THREE.Vector3(); return out.set(-Math.sin(yaw), 0, -Math.cos(yaw)); },
    /** compass bearing in degrees (0 = N = -Z, 90 = E = +X) for a yaw */
    bearing: function (yaw) { var b = (-yaw / DEG) % 360; return b < 0 ? b + 360 : b; },
    dist2D: function (ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); },
    /** seeded PRNG (mulberry32) -> function() in [0,1) */
    rng: function (seed) {
      var s = (seed >>> 0) || 1;
      return function () { s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    },
    fmt: function (n) { n = Math.round(n || 0); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); },
    money: function (n) { return '$' + U.fmt(n); },
    esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
    /** deep-merge missing keys of defaults into target (arrays/values in target win) */
    defaults: function (target, defs) {
      for (var k in defs) {
        if (!Object.prototype.hasOwnProperty.call(defs, k)) continue;
        var d = defs[k];
        if (target[k] === undefined) target[k] = (d && typeof d === 'object') ? JSON.parse(JSON.stringify(d)) : d;
        else if (d && typeof d === 'object' && !Array.isArray(d) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) U.defaults(target[k], d);
      }
      return target;
    },
    isTouchDevice: function () {
      try { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || (window.matchMedia && matchMedia('(pointer:coarse)').matches); } catch (e) { return false; }
    },
    noise2: function (x, z) { // cheap smooth value-ish noise from sines, range ~[-1,1]
      return (Math.sin(x * 1.7 + Math.sin(z * 0.9) * 1.3) * Math.cos(z * 1.3 + Math.sin(x * 0.7)) + Math.sin((x + z) * 0.6 + 1.7) * 0.5) / 1.5;
    }
  };

  /** Reusable temporaries for FEATURE code. Use only inside one synchronous function; never store references.
   *  Core uses its own private temporaries, so features cannot clobber engine math. */
  HG.tmp = {
    v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), v4: new THREE.Vector3(),
    v5: new THREE.Vector3(), v6: new THREE.Vector3(), q1: new THREE.Quaternion(), q2: new THREE.Quaternion(),
    m1: new THREE.Matrix4(), e1: new THREE.Euler(), c1: new THREE.Color(), c2: new THREE.Color(),
    ray: new THREE.Ray(), box: new THREE.Box3(), sphere: new THREE.Sphere()
  };
  // private core temporaries
  var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(),
    _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3(), _c1 = new THREE.Color(), _c2 = new THREE.Color(),
    _m1 = new THREE.Matrix4(), _q1 = new THREE.Quaternion(), _e1 = new THREE.Euler(0, 0, 0, 'YXZ'), _obj = new THREE.Object3D();

  /* ------------------------------------------------------------------
   * Events
   * ------------------------------------------------------------------ */
  var listeners = {};
  /** HG.on(evt, fn) -> returns an off() function. Handlers run in registration order; {priority} sorts higher first. */
  // listener arrays are copy-on-write, so emit() never allocates (safe to on/off inside handlers)
  HG.on = function (evt, fn, opts) {
    if (typeof fn !== 'function') return function () {};
    fn._hgPri = (opts && opts.priority) || 0;
    var arr = (listeners[evt] || []).concat([fn]);
    arr.sort(function (a, b) { return (b._hgPri || 0) - (a._hgPri || 0); });
    listeners[evt] = arr;
    return function () { HG.off(evt, fn); };
  };
  HG.once = function (evt, fn) { var off = HG.on(evt, function () { off(); return fn.apply(this, arguments); }); return off; };
  HG.off = function (evt, fn) { var arr = listeners[evt]; if (!arr) return; listeners[evt] = arr.filter(function (f) { return f !== fn; }); };
  /** HG.emit(evt, a1..a6). Up to 6 arguments. Each handler is isolated with try/catch (errors are logged with console.error). */
  HG.emit = function (evt, a1, a2, a3, a4, a5, a6) {
    var arr = listeners[evt]; if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      try { arr[i].call(HG, a1, a2, a3, a4, a5, a6); } catch (e) { console.error('[HG] handler for "' + evt + '" failed:', e); }
    }
  };

  /* ------------------------------------------------------------------
   * Config (tunables features may change)
   * ------------------------------------------------------------------ */
  HG.config = {
    startCash: 500, startGold: 5, startAmmo: 40,
    levelUpGold: 2, maxLevel: 60,
    maxAnimals: 14,          // population cap per map (map.maxAnimals overrides)
    despawnDist: 240,        // animals farther than this are removed
    spawnMin: 70, spawnMax: 180,
    downedCashLoss: 0.25,
    baseFov: 70,
    daySpeed: 1 / 90,        // game hours per real second
    startHour: 16.5,
    legendaryChance: 0,      // chance a spawned group leader is a legendary variant (gear.js/animals.js may raise it)
    trackDotMax: 260,
    particleMax: 120,
    gravity: 9.81
  };

  /* ------------------------------------------------------------------
   * Save system
   * ------------------------------------------------------------------ */
  HG.SAVE_KEY = 'wildwood_hunter';
  HG.SAVE_VERSION = 1;
  HG.storageOK = true;
  var saveDefaultsExtra = {};
  /** first-run graphics level: Low on small touch screens or low-memory devices, High otherwise */
  function autoQuality(touch) {
    try {
      var mem = navigator.deviceMemory || 0, minDim = Math.min(screen.width || 9999, screen.height || 9999);
      if (mem && mem <= 3) return 'low';
      if (touch && minDim < 600) return 'low';
    } catch (e) {}
    return 'high';
  }
  HG.autoQuality = autoQuality;
  function defaultSave() {
    var touch = U.isTouchDevice();
    return {
      v: HG.SAVE_VERSION,
      cash: HG.config.startCash, gold: HG.config.startGold, xp: 0, level: 1,
      owned: ['hunting_rifle'],
      equipped: { weapon: 'hunting_rifle', sidearm: null, outfit: null, gear: [], companion: null, vehicle: null, extra: [] },
      ammo: { rifle_ammo: HG.config.startAmmo },
      trophies: [],
      stats: {
        hunts: 0, kills: 0, shots: 0, hits: 0, headshots: 0, heartShots: 0, longestShot: 0, heaviest: 0,
        bySpecies: {}, distanceWalked: 0, playTime: 0, cashEarned: 0, timesDowned: 0, legendaryKills: 0
      },
      settings: {
        sens: 1, invertY: false, graphics: autoQuality(touch), sound: true, music: true,
        aimAssist: touch, fov: 70, showFps: false, vibrate: true
      },
      unlockedMaps: ['pine_valley'],
      created: Date.now(), lastPlayed: Date.now()
    };
  }
  /** Migrations: HG.saveMigrations[n] upgrades a save from version n-1 to n. Features may add higher versions. */
  HG.saveMigrations = {
    1: function (s) { return s; }
  };
  function readStorage() {
    try { var raw = window.localStorage.getItem(HG.SAVE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { HG.storageOK = false; return null; }
  }
  function migrate(s) {
    if (!s || typeof s !== 'object') return defaultSave();
    var v = +s.v || 0;
    while (v < HG.SAVE_VERSION) {
      v++;
      var m = HG.saveMigrations[v];
      if (m) { try { s = m(s) || s; } catch (e) { console.error('[HG] save migration failed', e); } }
      s.v = v;
    }
    U.defaults(s, defaultSave());
    for (var ns in saveDefaultsExtra) { if (!s[ns] || typeof s[ns] !== 'object') s[ns] = {}; U.defaults(s[ns], saveDefaultsExtra[ns]); }
    if (!Array.isArray(s.owned)) s.owned = ['hunting_rifle'];
    if (!Array.isArray(s.trophies)) s.trophies = [];
    if (!Array.isArray(s.unlockedMaps)) s.unlockedMaps = ['pine_valley'];
    if (!Array.isArray(s.equipped.gear)) s.equipped.gear = [];
    if (!Array.isArray(s.equipped.extra)) s.equipped.extra = [];
    return s;
  }
  HG.save = migrate(readStorage());
  HG.settings = HG.save.settings;
  /** Register a feature namespace on the save with default values (deep-merged, safe to call at load time). */
  HG.registerSaveDefaults = function (ns, defs) {
    saveDefaultsExtra[ns] = defs;
    if (!HG.save[ns] || typeof HG.save[ns] !== 'object') HG.save[ns] = {};
    U.defaults(HG.save[ns], defs);
    return HG.save[ns];
  };
  var storeTimer = 0;
  /** Debounced save (400 ms). */
  HG.store = function () {
    if (storeTimer) return;
    storeTimer = setTimeout(function () { storeTimer = 0; HG.storeNow(); }, 400);
  };
  HG.storeNow = function () {
    if (storeTimer) { clearTimeout(storeTimer); storeTimer = 0; }
    HG.save.lastPlayed = Date.now();
    try { window.localStorage.setItem(HG.SAVE_KEY, JSON.stringify(HG.save)); HG.storageOK = true; }
    catch (e) { HG.storageOK = false; }
  };
  /** Wipe progress (keeps settings). */
  HG.resetSave = function () {
    var keep = HG.save.settings; HG.save = migrate(null); HG.save.settings = keep; HG.settings = keep; HG.storeNow(); HG.emit('saveReset');
  };
  window.addEventListener('pagehide', function () { HG.storeNow(); });

  /* ---------------- currencies & XP ---------------- */
  HG.addCash = function (n, reason, worldPos) {
    n = Math.round(n || 0); if (!n) return;
    HG.save.cash = Math.max(0, HG.save.cash + n);
    if (n > 0) {
      HG.save.stats.cashEarned += n;
      if (HG.session && HG.state === 'hunt') HG.session.cashEarned += n;
    }
    if (worldPos) HG.ui.floatText(worldPos, (n > 0 ? '+' : '') + U.money(n), 'var(--cash)');
    HG.store(); HG.emit('cash', n, reason || '');
  };
  HG.addGold = function (n, reason) {
    n = Math.round(n || 0); if (!n) return;
    HG.save.gold = Math.max(0, HG.save.gold + n);
    HG.store(); HG.emit('gold', n, reason || '');
  };
  /** total XP needed to reach level L (level 1 = 0) */
  HG.xpForLevel = function (L) {
    var t = 0; for (var i = 1; i < L; i++) t += Math.round(120 * Math.pow(i, 1.45)); return t;
  };
  HG.levelProgress = function () {
    var L = HG.save.level, a = HG.xpForLevel(L), b = HG.xpForLevel(L + 1);
    return { level: L, xp: HG.save.xp, cur: HG.save.xp - a, need: b - a, frac: U.clamp((HG.save.xp - a) / Math.max(1, b - a), 0, 1) };
  };
  HG.addXP = function (n) {
    n = Math.round(n || 0); if (n <= 0) return;
    HG.save.xp += n;
    if (HG.session && HG.state === 'hunt') HG.session.xpEarned += n;
    HG.emit('xp', n);
    while (HG.save.level < HG.config.maxLevel && HG.save.xp >= HG.xpForLevel(HG.save.level + 1)) {
      HG.save.level++;
      if (HG.config.levelUpGold) HG.addGold(HG.config.levelUpGold, 'levelUp');
      HG.sfx('levelup');
      HG.ui.banner('LEVEL ' + HG.save.level + '!', HG.config.levelUpGold ? ('+' + HG.config.levelUpGold + ' gold • new gear may be unlocked') : 'New gear may be unlocked');
      HG.emit('levelUp', HG.save.level);
    }
    HG.store();
  };

  /* ------------------------------------------------------------------
   * Audio (WebAudio, synthesized)
   * ------------------------------------------------------------------ */
  HG.sound = { enabled: HG.settings.sound !== false };
  HG.music = { enabled: HG.settings.music !== false, playing: false };
  HG.sounds = {};
  var audio = HG.audio = { ctx: null, master: null, sfx: null, musicGain: null, noise: null, ready: false };
  HG.audio.unlock = function () {
    if (audio.ready) { try { if (audio.ctx.state === 'suspended') audio.ctx.resume(); } catch (e) {} return; }
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain(); audio.master.gain.value = 0.9; audio.master.connect(audio.ctx.destination);
      audio.sfx = audio.ctx.createGain(); audio.sfx.gain.value = HG.sound.enabled ? 1 : 0; audio.sfx.connect(audio.master);
      audio.musicGain = audio.ctx.createGain(); audio.musicGain.gain.value = HG.music.enabled ? 0.32 : 0; audio.musicGain.connect(audio.master);
      var len = audio.ctx.sampleRate * 1.5, buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      audio.noise = buf;
      audio.ready = true;
      if (audio.ctx.state === 'suspended') audio.ctx.resume();
      HG.emit('audioReady', audio.ctx);
      if (HG.state === 'menu') HG.music.play();
    } catch (e) { audio.ready = false; }
  };
  /** Helper for sound fns: noise source node */
  HG.audio.noiseSource = function (ctx) { var s = ctx.createBufferSource(); s.buffer = audio.noise; s.loop = true; return s; };
  /** Helper: simple envelope on a gain node */
  HG.audio.env = function (g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  /** HG.sfx(name, opts{volume, pos:Vector3, rate, ...}) — plays HG.sounds[name](ctx, dest, opts) */
  HG.sfx = function (name, opts) {
    if (!HG.sound.enabled || !audio.ready) return;
    var fn = HG.sounds[name]; if (!fn) return;
    try {
      opts = opts || {};
      var ctx = audio.ctx, vol = opts.volume == null ? 1 : opts.volume, dest = audio.sfx, g = null, pan = null;
      if (opts.pos && HG.camera) {
        var d = HG.camera.position.distanceTo(opts.pos);
        vol *= U.clamp(1 / (1 + d * 0.035), 0.04, 1);
        if (ctx.createStereoPanner) {
          _v6.copy(opts.pos).sub(HG.camera.position);
          var right = _v5.set(1, 0, 0).applyQuaternion(HG.camera.quaternion);
          pan = ctx.createStereoPanner(); pan.pan.value = U.clamp(_v6.normalize().dot(right), -0.9, 0.9);
        }
      }
      if (vol !== 1 || pan) {
        g = ctx.createGain(); g.gain.value = vol;
        if (pan) { g.connect(pan); pan.connect(audio.sfx); } else g.connect(audio.sfx);
        dest = g;
      }
      fn(ctx, dest, opts, ctx.currentTime);
    } catch (e) { /* audio must never break the game */ }
  };
  HG.setSound = function (on) { HG.sound.enabled = HG.settings.sound = !!on; try { if (audio.sfx) audio.sfx.gain.value = on ? 1 : 0; } catch (e) {} HG.store(); };
  HG.setMusic = function (on) {
    HG.music.enabled = HG.settings.music = !!on;
    try { if (audio.musicGain) audio.musicGain.gain.value = on ? 0.32 : 0; } catch (e) {}
    if (on && HG.state === 'menu') HG.music.play(); else if (!on) HG.music.stop();
    HG.store();
  };
  // Gentle lodge music: slow warm pad + plucked notes. Features may replace HG.music.play/stop.
  var musicTimer = 0;
  HG.music.play = function () {
    if (!HG.music.enabled || !audio.ready || HG.music.playing) return;
    HG.music.playing = true;
    var chords = [[146.8, 220, 293.7], [130.8, 196, 261.6], [110, 164.8, 220], [123.5, 185, 246.9]], ci = 0;
    function step() {
      if (!HG.music.playing || !audio.ready) return;
      try {
        var ctx = audio.ctx, t = ctx.currentTime, ch = chords[ci++ % chords.length];
        ch.forEach(function (f, i) {
          var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
          o.type = i === 0 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 8;
          lp.type = 'lowpass'; lp.frequency.value = 900;
          g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 1.6); g.gain.linearRampToValueAtTime(0.0001, t + 4.4);
          o.connect(lp); lp.connect(g); g.connect(audio.musicGain); o.start(t); o.stop(t + 4.6);
        });
        for (var k = 0; k < 3; k++) {
          var tt = t + 0.6 + k * 1.1 + Math.random() * 0.3, o2 = ctx.createOscillator(), g2 = ctx.createGain();
          o2.type = 'triangle'; o2.frequency.value = ch[U.randInt(0, 2)] * (Math.random() < 0.5 ? 2 : 1.5);
          HG.audio.env(g2, tt, 0.01, 0.06, 1.2); o2.connect(g2); g2.connect(audio.musicGain); o2.start(tt); o2.stop(tt + 1.4);
        }
      } catch (e) {}
      musicTimer = setTimeout(step, 4000);
    }
    step();
  };
  HG.music.stop = function () { HG.music.playing = false; if (musicTimer) { clearTimeout(musicTimer); musicTimer = 0; } };
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function () { HG.audio.unlock(); }, { passive: true, capture: true });
  });
  /** Vibration (guarded). */
  HG.vibrate = function (ms) { try { if (HG.settings.vibrate && navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

  /* ------------------------------------------------------------------
   * Model helpers (low-poly, flat-shaded, vertex-coloured, mergeable)
   * ------------------------------------------------------------------ */
  /** Shared vertex-colour material for merged props (never dispose it). Quality aware: Standard on High/Ultra, Lambert on Low
   *  (HG.vcMat is a getter, so read it when you build). Vertex colours from HG.model are linearised automatically. */
  var vcMats = {};
  Object.defineProperty(HG, 'vcMat', { configurable: true, get: function () {
    var low = !!(HG.quality && HG.quality.low), k = low ? 'L' : 'H';
    if (!vcMats[k]) { vcMats[k] = low ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 }); vcMats[k].userData.shared = true; }
    return vcMats[k];
  } });
  var matCache = {};
  /** HG.mat(color, opts) -> cached shared material (Standard on High/Ultra, Lambert on Low). color is sRGB.
   *  opts: {emissive, transparent, opacity, side, roughness, metalness, basic:true for MeshBasicMaterial} */
  HG.mat = function (color, opts) {
    var low = !!(HG.quality && HG.quality.low);
    var key = String(color) + (opts ? JSON.stringify(opts) : '') + (low ? 'L' : 'H');
    if (matCache[key]) return matCache[key];
    var o = { color: new THREE.Color(color).convertSRGBToLinear() };
    var basic = false;
    if (opts) for (var k in opts) {
      if (k === 'basic') { basic = true; continue; }
      if ((k === 'roughness' || k === 'metalness') && (low || opts.basic)) continue;
      o[k] = (k === 'emissive') ? new THREE.Color(opts[k]).convertSRGBToLinear() : opts[k];
    }
    if (!basic && !low) { if (o.roughness == null) o.roughness = 0.85; if (o.metalness == null) o.metalness = 0; }
    var m = basic ? new THREE.MeshBasicMaterial(o) : low ? new THREE.MeshLambertMaterial(o) : new THREE.MeshStandardMaterial(o);
    m.userData.shared = true;
    return (matCache[key] = m);
  };

  var M = HG.model = {};
  /** Convert any BufferGeometry to non-indexed, transformed, with flat normals + colour attribute.
   *  opts: {pos:[x,y,z], rot:[x,y,z] (radians, XYZ order), scale:[x,y,z] or number, jitter:0..1 (per-face colour variation), rng} */
  M.prep = function (geo, color, opts) {
    opts = opts || {};
    var g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv2) g.deleteAttribute('uv2');
    if (opts.scale != null) { var s = opts.scale; if (typeof s === 'number') g.scale(s, s, s); else g.scale(s[0], s[1], s[2]); }
    if (opts.rot) { _e1.set(opts.rot[0] || 0, opts.rot[1] || 0, opts.rot[2] || 0, 'XYZ'); g.applyMatrix4(_m1.makeRotationFromEuler(_e1)); _e1.order = 'YXZ'; }
    if (opts.pos) g.translate(opts.pos[0] || 0, opts.pos[1] || 0, opts.pos[2] || 0);
    g.computeVertexNormals();
    M.colorize(g, color, opts.jitter || 0, opts.rng);
    return g;
  };
  /** (Re)colour a non-indexed geometry: one colour, optional per-triangle brightness jitter. */
  M.colorize = function (g, color, jitter, rng) {
    var n = g.attributes.position.count, arr = new Float32Array(n * 3);
    _c1.set(color == null ? 0xffffff : color).convertSRGBToLinear();
    rng = rng || Math.random;
    for (var i = 0; i < n; i += 3) {
      var j = jitter ? 1 + (rng() - 0.5) * 2 * jitter : 1;
      for (var k = 0; k < 3 && i + k < n; k++) {
        arr[(i + k) * 3] = Math.min(1, _c1.r * j); arr[(i + k) * 3 + 1] = Math.min(1, _c1.g * j); arr[(i + k) * 3 + 2] = Math.min(1, _c1.b * j);
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  M.box = function (w, h, d, color, opts) { return M.prep(new THREE.BoxGeometry(w, h, d), color, opts); };
  M.cyl = function (rt, rb, h, seg, color, opts) { return M.prep(new THREE.CylinderGeometry(rt, rb, h, seg || 6), color, opts); };
  M.cone = function (r, h, seg, color, opts) { return M.prep(new THREE.ConeGeometry(r, h, seg || 6, 1, !!(opts && opts.open)), color, opts); };
  M.sphere = function (r, color, opts) { opts = opts || {}; return M.prep(new THREE.SphereGeometry(r, opts.wseg || 7, opts.hseg || 5), color, opts); };
  M.ico = function (r, detail, color, opts) { return M.prep(new THREE.IcosahedronGeometry(r, detail || 0), color, opts); };
  M.dodeca = function (r, color, opts) { return M.prep(new THREE.DodecahedronGeometry(r, 0), color, opts); };
  /** Merge prepared (non-indexed, position+normal+color) geometries into one. Input geometries are disposed. */
  M.merge = function (geos) {
    var total = 0, i;
    for (i = 0; i < geos.length; i++) if (geos[i]) total += geos[i].attributes.position.count;
    var pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3), off = 0;
    for (i = 0; i < geos.length; i++) {
      var g = geos[i]; if (!g) continue;
      var c = g.attributes.position.count;
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      if (g.attributes.color) col.set(g.attributes.color.array, off * 3); else col.fill(1, off * 3, (off + c) * 3);
      off += c; g.dispose();
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  };
  /** Merge geometries into one Mesh using the shared vertex-colour material (or a given material). */
  M.mesh = function (geos, material) {
    var m = new THREE.Mesh(Array.isArray(geos) ? M.merge(geos) : geos, material || HG.vcMat);
    return m;
  };
  /** Transform a prepared geometry in place by an Object3D-like transform (pos, rotY, scale). */
  M.transform = function (g, x, y, z, ry, s) {
    _obj.position.set(x, y, z); _obj.rotation.set(0, ry || 0, 0); _obj.scale.setScalar(s || 1); _obj.updateMatrix();
    g.applyMatrix4(_obj.matrix); return g;
  };

  /* ==================================================================
   * HG.gfx — rendering + model toolkit (see API.md §6b)
   *   textures (procedural canvas, cached), materials (quality aware),
   *   organic geometry (loft / organicBody / limbs / antlers / horns ...),
   *   vertex paint + AO, LOD, skinned rigs with gaits.
   * Colours passed to HG.gfx are sRGB (CSS/hex) and converted to linear.
   * ================================================================== */
  var G = HG.gfx = {};
  var SRGB = THREE.sRGBEncoding;
  /** sRGB hex/CSS colour -> NEW linear THREE.Color */
  G.color = function (c) { return new THREE.Color(c).convertSRGBToLinear(); };
  G.level = function () { return HG.quality ? (HG.quality.level || (HG.quality.low ? 'low' : 'high')) : 'high'; };
  G.isLow = function () { return !!(HG.quality && HG.quality.low); };

  /* ---------------- noise (CPU) ---------------- */
  function hash2(ix, iy, seed) {
    var h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul((seed | 0) + 1013, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
  }
  function hash3(ix, iy, iz, seed) {
    var h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(iz | 0, 1440662683) ^ Math.imul((seed | 0) + 77, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
  }
  function sstep(t) { return t * t * (3 - 2 * t); }
  /** tileable 2D value noise with integer period p (lattice cells per tile) */
  function vnoise(x, y, p, seed) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = sstep(x - ix), fy = sstep(y - iy);
    var x0 = ((ix % p) + p) % p, y0 = ((iy % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    var a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  /** tileable fbm on the unit tile (u,v in 0..1) */
  function fbm(u, v, p, oct, seed) {
    var s = 0, amp = 0.5, tot = 0;
    for (var o = 0; o < oct; o++) { s += amp * vnoise(u * p, v * p, p, seed + o * 31); tot += amp; amp *= 0.5; p *= 2; }
    return s / tot;
  }
  /** smooth 3D value noise (not tiled), ~0..1 */
  function vnoise3(x, y, z, seed) {
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = sstep(x - ix), fy = sstep(y - iy), fz = sstep(z - iz);
    var a = hash3(ix, iy, iz, seed), b = hash3(ix + 1, iy, iz, seed), c = hash3(ix, iy + 1, iz, seed), d = hash3(ix + 1, iy + 1, iz, seed);
    var e = hash3(ix, iy, iz + 1, seed), f = hash3(ix + 1, iy, iz + 1, seed), g = hash3(ix, iy + 1, iz + 1, seed), h = hash3(ix + 1, iy + 1, iz + 1, seed);
    var l0 = a + (b - a) * fx, l1 = c + (d - c) * fx, l2 = e + (f - e) * fx, l3 = g + (h - g) * fx;
    var m0 = l0 + (l1 - l0) * fy, m1 = l2 + (l3 - l2) * fy;
    return m0 + (m1 - m0) * fz;
  }
  function fbm3(x, y, z, oct, seed) { var s = 0, amp = 0.5, tot = 0; for (var o = 0; o < oct; o++) { s += amp * vnoise3(x, y, z, seed + o * 17); tot += amp; amp *= 0.5; x *= 2.03; y *= 2.03; z *= 2.03; } return s / tot; }
  G.noise = { hash2: hash2, hash3: hash3, value2: vnoise, fbm2: fbm, value3: vnoise3, fbm3: fbm3 };

  /* ---------------- textures ---------------- */
  var texCache = {};
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
  G.canvas = mkCanvas;
  function maxAniso() { try { return Math.max(1, Math.min(G.isLow() ? 2 : 8, renderer.capabilities.getMaxAnisotropy() || 1)); } catch (e) { return 1; } }
  function texSize(n) { var l = G.level(); return l === 'low' ? Math.max(64, n >> 1) : l === 'ultra' ? Math.min(2048, n * 2) : n; }
  G.texSize = texSize;
  function finishTex(t, o) {
    o = o || {};
    if (!t.userData) t.userData = {};
    t.wrapS = t.wrapT = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    if (o.srgb !== false) t.encoding = SRGB;
    t.anisotropy = o.aniso || maxAniso();
    if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
    t.userData.shared = true;
    t.needsUpdate = true;
    return t;
  }
  /** cached(key, makeFn) -> value (textures, canvases, geometries shared across the game) */
  function cached(key, fn) { if (texCache[key]) return texCache[key]; var v = fn(); texCache[key] = v; return v; }
  G.cached = cached;
  /** G.texture(key, w, h, draw(ctx, w, h, rng), {srgb, repeat, clamp}) -> cached CanvasTexture */
  G.texture = function (key, w, h, draw, o) {
    return cached('tx:' + key + ':' + w + 'x' + h, function () {
      var c = mkCanvas(w, h), ctx = c.getContext('2d');
      try { draw(ctx, w, h, U.rng(hashStrG(key))); } catch (e) { console.error('[HG.gfx] texture ' + key, e); }
      return finishTex(new THREE.CanvasTexture(c), o);
    });
  };
  function hashStrG(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  G.hashStr = hashStrG;
  /** grayscale tileable fbm canvas (cached) */
  function noiseCanvas(size, period, oct, seed) {
    return cached('nc:' + size + ':' + period + ':' + oct + ':' + seed, function () {
      var c = mkCanvas(size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var v = fbm(x / size, y / size, period, oct, seed) * 255, i = (y * size + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0); return c;
    });
  }
  G.noiseCanvas = noiseCanvas;
  /** overlay tileable noise on a canvas region: amp 0..1 (soft-light) */
  function noiseOverlay(ctx, w, h, period, oct, amp, seed, mode) {
    var n = noiseCanvas(Math.min(512, Math.max(w, h)), period, oct, seed);
    ctx.save(); ctx.globalAlpha = amp; ctx.globalCompositeOperation = mode || 'overlay';
    ctx.drawImage(n, 0, 0, w, h); ctx.restore();
  }
  /** draw fn(x, y) at (x, y) and its wrapped copies so the tile stays seamless */
  function wrapDraw(w, h, x, y, r, fn) {
    fn(x, y);
    var ox = x < r ? w : x > w - r ? -w : 0, oy = y < r ? h : y > h - r ? -h : 0;
    if (ox) fn(x + ox, y); if (oy) fn(x, y + oy); if (ox && oy) fn(x + ox, y + oy);
  }
  G.wrapDraw = wrapDraw;
  function rgba(c, a) { var col = new THREE.Color(c); return 'rgba(' + Math.round(col.r * 255) + ',' + Math.round(col.g * 255) + ',' + Math.round(col.b * 255) + ',' + a + ')'; }
  function shade(c, k) { var col = new THREE.Color(c); col.r = Math.min(1, col.r * k); col.g = Math.min(1, col.g * k); col.b = Math.min(1, col.b * k); return '#' + col.getHexString(); }
  function mixHex(a, b, t) { var A = new THREE.Color(a), B = new THREE.Color(b); return '#' + A.lerp(B, t).getHexString(); }
  G.css = { rgba: rgba, shade: shade, mix: mixHex };

  /** height (luminance) canvas -> tangent-space normal map canvas (tileable) */
  G.normalFromCanvas = function (src, strength, invert) {
    var w = src.width, h = src.height, sd = src.getContext('2d').getImageData(0, 0, w, h).data;
    var c = mkCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data, s = (strength || 2) * (invert ? -1 : 1);
    function L(x, y) { x = (x + w) % w; y = (y + h) % h; var i = (y * w + x) * 4; return (sd[i] * 0.3 + sd[i + 1] * 0.59 + sd[i + 2] * 0.11) / 255; }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var nx = (L(x - 1, y) - L(x + 1, y)) * s, ny = (L(x, y + 1) - L(x, y - 1)) * s, nz = 1, l = Math.sqrt(nx * nx + ny * ny + 1), i = (y * w + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (nz / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); return c;
  };
  function normalTex(key, canvas, strength) {
    return cached('nm:' + key + ':' + canvas.width, function () { return finishTex(new THREE.CanvasTexture(G.normalFromCanvas(canvas, strength)), { srgb: false }); });
  }
  G.normalTexture = normalTex;

  /** Alpha-tested foliage/feather textures: canvas -> DataTexture with colour dilation (no dark fringes)
   *  and coverage-preserving mip levels (leaves do not vanish at distance). */
  G.alphaTexture = function (key, canvas, o) {
    return cached('at:' + key + ':' + canvas.width, function () {
      o = o || {};
      var w = canvas.width, h = canvas.height, src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
      var d0 = new Uint8Array(src.length); d0.set(src);
      // dilate rgb into transparent texels (4 passes), then fill the rest with the average opaque colour
      var ar = 0, ag = 0, ab = 0, an = 0, i, x, y;
      for (i = 0; i < d0.length; i += 4) if (d0[i + 3] > 128) { ar += d0[i]; ag += d0[i + 1]; ab += d0[i + 2]; an++; }
      if (an) { ar /= an; ag /= an; ab /= an; }
      var filled = new Uint8Array(w * h); for (i = 0; i < w * h; i++) filled[i] = d0[i * 4 + 3] > 20 ? 1 : 0;
      for (var pass = 0; pass < 6; pass++) {
        var nf = filled.slice();
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          var k = y * w + x; if (filled[k]) continue;
          var r = 0, g = 0, b = 0, c = 0;
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            var kk = yy * w + xx; if (!filled[kk]) continue; r += d0[kk * 4]; g += d0[kk * 4 + 1]; b += d0[kk * 4 + 2]; c++;
          }
          if (c) { d0[k * 4] = r / c; d0[k * 4 + 1] = g / c; d0[k * 4 + 2] = b / c; nf[k] = 1; }
        }
        filled = nf;
      }
      for (i = 0; i < w * h; i++) if (!filled[i]) { d0[i * 4] = ar; d0[i * 4 + 1] = ag; d0[i * 4 + 2] = ab; }
      var mips = [{ data: d0, width: w, height: h }], cw = w, ch = h, prev = d0, lvl = 0;
      while (cw > 1 || ch > 1) {
        var nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1), nd = new Uint8Array(nw * nh * 4); lvl++;
        var boost = 1 + 0.32 * lvl;
        for (y = 0; y < nh; y++) for (x = 0; x < nw; x++) {
          var x0 = Math.min(cw - 1, x * 2), y0 = Math.min(ch - 1, y * 2), x1 = Math.min(cw - 1, x0 + 1), y1 = Math.min(ch - 1, y0 + 1);
          var o0 = (y0 * cw + x0) * 4, o1 = (y0 * cw + x1) * 4, o2 = (y1 * cw + x0) * 4, o3 = (y1 * cw + x1) * 4, q = (y * nw + x) * 4;
          for (var cc = 0; cc < 3; cc++) nd[q + cc] = (prev[o0 + cc] + prev[o1 + cc] + prev[o2 + cc] + prev[o3 + cc]) >> 2;
          var a = (prev[o0 + 3] + prev[o1 + 3] + prev[o2 + 3] + prev[o3 + 3]) / 4;
          nd[q + 3] = o.noBoost ? a : Math.min(255, a * (a > 40 ? boost : 1));
        }
        // boost is applied on the averaged (un-boosted) chain to avoid compounding
        mips.push({ data: nd, width: nw, height: nh });
        var plain = new Uint8Array(nd.length);
        for (i = 0; i < nd.length; i += 4) { plain[i] = nd[i]; plain[i + 1] = nd[i + 1]; plain[i + 2] = nd[i + 2]; }
        for (y = 0; y < nh; y++) for (x = 0; x < nw; x++) {
          var x0b = Math.min(cw - 1, x * 2), y0b = Math.min(ch - 1, y * 2), x1b = Math.min(cw - 1, x0b + 1), y1b = Math.min(ch - 1, y0b + 1);
          plain[(y * nw + x) * 4 + 3] = (prev[(y0b * cw + x0b) * 4 + 3] + prev[(y0b * cw + x1b) * 4 + 3] + prev[(y1b * cw + x0b) * 4 + 3] + prev[(y1b * cw + x1b) * 4 + 3]) >> 2;
        }
        prev = plain; cw = nw; ch = nh;
      }
      var t = new THREE.DataTexture(d0, w, h, THREE.RGBAFormat);
      t.mipmaps = mips; t.generateMipmaps = false; t.flipY = false;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      return finishTex(t, { clamp: !!o.clamp, srgb: true });
    });
  };
  /** opaque per-pixel texture built in JS: fill(data Uint8Array, w, h) -> DataTexture (mipmapped) */
  G.dataTexture = function (key, w, h, fill, o) {
    return cached('dt:' + key + ':' + w, function () {
      var d = new Uint8Array(w * h * 4);
      try { fill(d, w, h); } catch (e) { console.error('[HG.gfx] dataTexture ' + key, e); }
      var t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat);
      t.generateMipmaps = true; t.flipY = false; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      return finishTex(t, o);
    });
  };

  var TX = G.tex = {};
  /** strands: batched short strokes along +y (canvas down) for fur / grass / grain */
  function strands(ctx, w, h, n, rng, o) {
    var buckets = 6, len0 = o.len[0], len1 = o.len[1];
    ctx.lineCap = 'round';
    for (var b = 0; b < buckets; b++) {
      var dark = b < buckets / 2, a = (o.alpha || 0.22) * (0.45 + 0.55 * ((b % 3) + 1) / 3);
      ctx.strokeStyle = dark ? (o.darkCol ? rgba(o.darkCol, a) : 'rgba(0,0,0,' + a + ')') : (o.lightCol ? rgba(o.lightCol, a) : 'rgba(255,255,255,' + a * 0.9 + ')');
      ctx.lineWidth = (o.width || 1.1) * (0.7 + (b % 3) * 0.35) * (w / 512);
      ctx.beginPath();
      for (var i = 0; i < n / buckets; i++) {
        var x = rng() * w, y = rng() * h, L = (len0 + rng() * (len1 - len0)) * (w / 512), ang = (rng() - 0.5) * (o.spread || 0.5) + (o.angle || 0);
        var dx = Math.sin(ang) * L, dy = Math.cos(ang) * L, bend = (rng() - 0.5) * L * 0.35;
        wrapDraw(w, h, x, y, L + 2, function (px, py) { ctx.moveTo(px, py); ctx.quadraticCurveTo(px + dx * 0.5 + bend, py + dy * 0.5, px + dx, py + dy); });
      }
      ctx.stroke();
    }
  }
  /** Fur: countershaded across x (around the body: back at the edges, belly in the middle), strands along y.
   *  o: {base, back, belly, strokes, length:[a,b], alpha, mottle, spots:{count,size,color}, stripes:{count,width,color}, size, seed} */
  TX.fur = function (o) {
    o = o || {};
    var size = texSize(o.size || 512), key = 'fur' + JSON.stringify(o);
    return cached(key + size, function () {
      var c = mkCanvas(size), ctx = c.getContext('2d'), rng = U.rng(o.seed || 11);
      var base = o.base || '#b48a5e', back = o.back || base, belly = o.belly || base;
      var g = ctx.createLinearGradient(0, 0, size, 0);
      g.addColorStop(0, back); g.addColorStop(0.16, base); g.addColorStop(0.32, base); g.addColorStop(0.5, belly);
      g.addColorStop(0.68, base); g.addColorStop(0.84, base); g.addColorStop(1, back);
      ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
      noiseOverlay(ctx, size, size, 5, 4, o.mottle == null ? 0.35 : o.mottle, (o.seed || 11) + 3, 'soft-light');
      if (o.stripes) {
        var sc = o.stripes.color || '#2a2016';
        for (var s = 0; s < (o.stripes.count || 8); s++) {
          var sx = rng() * size, sw = (o.stripes.width || 0.04) * size * (0.6 + rng() * 0.8);
          ctx.fillStyle = rgba(sc, 0.55);
          for (var yy = 0; yy < size; yy += 4) { var off = Math.sin(yy / size * Math.PI * 2 * 2 + s) * sw * 0.8; ctx.fillRect(sx + off - sw / 2, yy, sw * (0.7 + 0.3 * Math.sin(yy * 0.05 + s)), 4.5); }
        }
      }
      if (o.spots) {
        var spc = o.spots.color || '#f4efe4', ss = (o.spots.size || 0.025) * size;
        for (var p = 0; p < (o.spots.count || 40); p++) {
          var px = rng() * size, py = rng() * size, r = ss * (0.6 + rng() * 0.7);
          wrapDraw(size, size, px, py, r * 2, function (x, y) {
            var rg = ctx.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, rgba(spc, 0.95)); rg.addColorStop(0.65, rgba(spc, 0.7)); rg.addColorStop(1, rgba(spc, 0));
            ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(x, y, r * 0.8, r * 1.2, 0, 0, Math.PI * 2); ctx.fill();
          });
        }
      }
      strands(ctx, size, size, Math.round((o.strokes || 9000) * (size / 512) * (size / 512)), rng, { len: o.length || [6, 16], alpha: o.alpha || 0.2, spread: o.spread || 0.45, width: o.width || 1.1 });
      var t = finishTex(new THREE.CanvasTexture(c));
      t.userData.canvas = c;
      return t;
    });
  };
  /** normal map matching a fur/feather/scales texture (High quality only) */
  TX.normalOf = function (tex, strength) {
    if (!tex || !tex.userData || !tex.userData.canvas) return null;
    return normalTex(tex.uuid, tex.userData.canvas, strength || 2.5);
  };
  /** Neutral fur DETAIL texture (mean ~ white): tint it with vertex colours (coat painting) */
  TX.furDetail = function (o) {
    o = o || {};
    return TX.fur({ base: o.base || '#f3efe8', back: o.back || '#ece6dc', belly: o.belly || '#f7f4ee', strokes: o.strokes || 11000, length: o.length || [5, 13], alpha: o.alpha || 0.26, mottle: o.mottle == null ? 0.25 : o.mottle, seed: o.seed || 21, size: o.size || 512, spread: o.spread });
  };
  /** Plumage tile: overlapping feathers pointing +y. o: {base, tip, edge, barred, iridescent:[c1,c2], size, rows, seed} */
  TX.feathers = function (o) {
    o = o || {};
    var size = texSize(o.size || 512);
    return cached('feathers' + JSON.stringify(o) + size, function () {
      var c = mkCanvas(size), ctx = c.getContext('2d'), rng = U.rng(o.seed || 5);
      ctx.fillStyle = shade(o.base || '#6b5a44', 0.7); ctx.fillRect(0, 0, size, size);
      var rows = o.rows || 10, cols = o.cols || 8, fw = size / cols, fh = size / rows;
      for (var r = 0; r < rows + 1; r++) for (var q = 0; q < cols + 1; q++) {
        var x = (q + (r % 2) * 0.5) * fw + (rng() - 0.5) * fw * 0.15, y = r * fh;
        wrapDraw(size, size, x, y, fw * 1.4, function (px, py) {
          var g = ctx.createLinearGradient(px, py - fh * 1.3, px, py + fh * 0.2);
          var b0 = o.base || '#6b5a44', tip = o.tip || shade(b0, 1.25);
          if (o.iridescent) { g.addColorStop(0, o.iridescent[0]); g.addColorStop(0.55, o.iridescent[1] || b0); g.addColorStop(1, b0); }
          else { g.addColorStop(0, shade(b0, 0.8)); g.addColorStop(0.75, b0); g.addColorStop(1, tip); }
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(px - fw * 0.55, py - fh * 1.4); ctx.quadraticCurveTo(px - fw * 0.62, py, px, py + fh * 0.25); ctx.quadraticCurveTo(px + fw * 0.62, py, px + fw * 0.55, py - fh * 1.4); ctx.closePath(); ctx.fill();
          if (o.edge) { ctx.strokeStyle = rgba(o.edge, 0.85); ctx.lineWidth = fw * 0.07; ctx.beginPath(); ctx.moveTo(px - fw * 0.5, py - fh * 0.2); ctx.quadraticCurveTo(px, py + fh * 0.35, px + fw * 0.5, py - fh * 0.2); ctx.stroke(); }
          if (o.barred) { ctx.strokeStyle = rgba(o.barred, 0.55); ctx.lineWidth = fh * 0.12; for (var bb = 1; bb < 3; bb++) { ctx.beginPath(); ctx.moveTo(px - fw * 0.5, py - fh * 0.42 * bb); ctx.quadraticCurveTo(px, py - fh * 0.42 * bb + fh * 0.15, px + fw * 0.5, py - fh * 0.42 * bb); ctx.stroke(); } }
          ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py - fh * 1.2); ctx.lineTo(px, py + fh * 0.15); ctx.stroke();
        });
      }
      strands(ctx, size, size, 2500 * (size / 512), rng, { len: [3, 7], alpha: 0.12, spread: 1.2, width: 0.7 });
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  /** One feather on a transparent card (vane along +y toward the top). o: {base, tip, bands, bandColor, shaft, width, seed} -> alpha DataTexture */
  TX.feather = function (o) {
    o = o || {};
    var W = texSize(128), H = W * 4;
    return G.alphaTexture('feather' + JSON.stringify(o), cached('fc' + JSON.stringify(o) + W, function () {
      var c = mkCanvas(W, H), ctx = c.getContext('2d'), rng = U.rng(o.seed || 9), cx = W / 2, wd = W * 0.46 * (o.width || 1);
      var g = ctx.createLinearGradient(0, H, 0, 0); g.addColorStop(0, shade(o.base || '#5a4632', 0.75)); g.addColorStop(0.6, o.base || '#5a4632'); g.addColorStop(1, o.tip || shade(o.base || '#5a4632', 1.2));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(cx, H * 0.98); ctx.bezierCurveTo(cx - wd, H * 0.8, cx - wd, H * 0.15, cx - wd * 0.2, H * 0.02); ctx.lineTo(cx + wd * 0.15, H * 0.02); ctx.bezierCurveTo(cx + wd * 0.9, H * 0.2, cx + wd * 0.8, H * 0.8, cx, H * 0.98); ctx.fill();
      if (o.bands) { ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = rgba(o.bandColor || '#f2ead8', 0.85); for (var b = 0; b < o.bands; b++) { var y = H * (0.15 + 0.7 * b / o.bands); ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(cx, y - H * 0.03, W, y); ctx.lineTo(W, y + H * 0.035); ctx.quadraticCurveTo(cx, y, 0, y + H * 0.035); ctx.fill(); } ctx.restore(); }
      ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1;
      for (var i = 0; i < 70; i++) { var yy = H * (0.05 + 0.9 * i / 70); ctx.beginPath(); ctx.moveTo(cx, yy + 6); ctx.lineTo(cx - wd, yy - 4 + rng() * 3); ctx.moveTo(cx, yy + 6); ctx.lineTo(cx + wd, yy - 4 + rng() * 3); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = o.shaft || 'rgba(235,225,205,.9)'; ctx.lineWidth = W * 0.035; ctx.beginPath(); ctx.moveTo(cx, H); ctx.lineTo(cx, H * 0.04); ctx.stroke();
      return c;
    }), { clamp: true });
  };
  /** Reptile scales/scutes. o: {base, dark, light, rows, cols, scutes, size, seed} */
  TX.scales = function (o) {
    o = o || {};
    var size = texSize(o.size || 512);
    return cached('scales' + JSON.stringify(o) + size, function () {
      var c = mkCanvas(size), ctx = c.getContext('2d'), rng = U.rng(o.seed || 3), rows = o.rows || 12, cols = o.cols || 8;
      ctx.fillStyle = o.dark || '#262a1c'; ctx.fillRect(0, 0, size, size);
      var cw = size / cols, ch = size / rows;
      for (var r = 0; r < rows; r++) for (var q = 0; q < cols; q++) {
        var x = q * cw + (r % 2 ? cw * 0.5 : 0), y = r * ch, sh = 0.85 + rng() * 0.3;
        wrapDraw(size, size, x + cw / 2, y + ch / 2, cw, function (px, py) {
          var g = ctx.createRadialGradient(px - cw * 0.15, py - ch * 0.2, 1, px, py, cw * 0.6);
          g.addColorStop(0, shade(o.light || '#6d7450', sh)); g.addColorStop(1, shade(o.base || '#454b30', sh));
          ctx.fillStyle = g; var gap = cw * 0.08;
          if (o.scutes) { ctx.beginPath(); ctx.ellipse(px, py, cw / 2 - gap, ch / 2 - gap, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(px, py + ch * 0.1, cw * 0.12, ch * 0.18, 0, 0, Math.PI * 2); ctx.fill(); }
          else ctx.fillRect(px - cw / 2 + gap, py - ch / 2 + gap, cw - gap * 2, ch - gap * 2);
        });
      }
      noiseOverlay(ctx, size, size, 6, 4, 0.3, 4, 'soft-light');
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  /** Bark painter for a canvas region (used by TX.bark and the vegetation atlas). style: 'pine'|'oak'|'birch'|'dead'|'plate'|'smooth' */
  function paintBark(ctx, X, Y, w, h, style, rng, col) {
    col = col || {};
    var base = col.base || { pine: '#6e4a33', oak: '#5b5046', birch: '#e8e4da', dead: '#8d8679', plate: '#7a5a42', smooth: '#7d756a' }[style] || '#6b4a33';
    var dark = col.dark || shade(base, style === 'birch' ? 0.25 : 0.42), light = col.light || shade(base, 1.35);
    ctx.save(); ctx.beginPath(); ctx.rect(X, Y, w, h); ctx.clip();
    ctx.fillStyle = base; ctx.fillRect(X, Y, w, h);
    var i, x, y;
    if (style === 'birch') {
      for (i = 0; i < h / 7; i++) { ctx.fillStyle = rgba(dark, 0.45 + rng() * 0.4); x = X + rng() * w; y = Y + rng() * h; ctx.fillRect(x, y, w * (0.05 + rng() * 0.2), 1 + rng() * 2.5); }
      for (i = 0; i < h / 60; i++) { x = X + rng() * w; y = Y + rng() * h; ctx.fillStyle = rgba('#1c1a18', 0.85); ctx.beginPath(); ctx.ellipse(x, y, w * (0.08 + rng() * 0.18), 2 + rng() * 6, 0, 0, Math.PI * 2); ctx.fill(); }
      for (i = 0; i < h / 40; i++) { x = X + rng() * w; y = Y + rng() * h; ctx.fillStyle = rgba('#c9a77a', 0.35); ctx.fillRect(x, y, w * 0.2 * rng(), 3 + rng() * 6); }
      var gb = ctx.createLinearGradient(X, 0, X + w, 0); gb.addColorStop(0, 'rgba(0,0,0,.16)'); gb.addColorStop(0.5, 'rgba(0,0,0,0)'); gb.addColorStop(1, 'rgba(0,0,0,.16)');
      ctx.fillStyle = gb; ctx.fillRect(X, Y, w, h);
    } else {
      var furrows = style === 'oak' ? 9 : style === 'dead' ? 6 : style === 'smooth' ? 3 : 7;
      // plates
      for (i = 0; i < h * w / 300; i++) { x = X + rng() * w; y = Y + rng() * h; ctx.fillStyle = rgba(rng() < 0.5 ? light : dark, 0.08 + rng() * 0.12); ctx.fillRect(x, y, 2 + rng() * w / furrows, 4 + rng() * 26); }
      ctx.lineCap = 'round';
      for (var f = 0; f < furrows * 2; f++) {
        x = X + (f + rng() * 0.6) * w / (furrows * 2) * 2 % w; ctx.strokeStyle = rgba(dark, 0.55 + rng() * 0.35);
        ctx.lineWidth = (style === 'oak' ? 2.6 : 1.8) * (0.6 + rng()) * (w / 128); ctx.beginPath(); ctx.moveTo(x, Y - 5);
        for (y = Y; y < Y + h + 10; y += 10 + rng() * 14) { x += (rng() - 0.5) * (style === 'oak' ? 7 : 4) * (w / 128); ctx.lineTo(x, y); }
        ctx.stroke();
      }
      if (style === 'pine' || style === 'plate') for (i = 0; i < h / 9; i++) { x = X + rng() * w; y = Y + rng() * h; ctx.strokeStyle = rgba(dark, 0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w / furrows * (0.5 + rng()), y + (rng() - 0.5) * 3); ctx.stroke(); }
      if (style === 'pine') { for (i = 0; i < h / 10; i++) { x = X + rng() * w; y = Y + rng() * h; ctx.fillStyle = rgba('#a5653f', 0.25 + rng() * 0.25); ctx.fillRect(x, y, 3 + rng() * w / 9, 3 + rng() * 10); } }
      if (style === 'dead') { for (i = 0; i < 6; i++) { x = X + rng() * w; ctx.strokeStyle = rgba('#3d3832', 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, Y); ctx.lineTo(x + (rng() - 0.5) * 8, Y + h); ctx.stroke(); } }
      if (col.moss) for (i = 0; i < h / 12; i++) { x = X + rng() * w; y = Y + h * (0.6 + rng() * 0.4); ctx.fillStyle = rgba(col.moss, 0.2 + rng() * 0.3); ctx.beginPath(); ctx.arc(x, y, 2 + rng() * 6, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }
  G.paintBark = paintBark;
  /** Bark texture (tileable). o: {style, base, dark, light, moss, size:[w,h], seed} */
  TX.bark = function (o) {
    o = o || {};
    var w = texSize((o.size && o.size[0]) || 256), h = texSize((o.size && o.size[1]) || 512);
    return cached('bark' + JSON.stringify(o) + w, function () {
      var c = mkCanvas(w, h), ctx = c.getContext('2d'); paintBark(ctx, 0, 0, w, h, o.style || 'pine', U.rng(o.seed || 2), o);
      noiseOverlay(ctx, w, h, 4, 4, 0.25, 9, 'soft-light');
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  /** Wood grain along +y. o: {base, dark, light, figure 0..1, rings, size:[w,h], seed, checker:[{x,y,w,h}] (normalised rects with checkering)} */
  TX.woodGrain = function (o) {
    o = o || {};
    var w = texSize((o.size && o.size[0]) || 256), h = texSize((o.size && o.size[1]) || 1024);
    return cached('wood' + JSON.stringify(o) + w, function () {
      var c = mkCanvas(w, h), ctx = c.getContext('2d'), rng = U.rng(o.seed || 4);
      var base = o.base || '#8a5530', dark = o.dark || '#4a2814', light = o.light || '#b77b48';
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      var rings = o.rings || 26;
      for (var i = 0; i < rings; i++) {
        var x0 = rng() * w, amp = 6 + rng() * 18, fr = 1 + rng() * 2.5, ph = rng() * 6.28;
        ctx.strokeStyle = rgba(rng() < 0.65 ? dark : light, 0.18 + rng() * 0.3); ctx.lineWidth = (0.8 + rng() * 2.6) * (w / 256);
        ctx.beginPath();
        for (var y = -4; y <= h + 4; y += 8) { var x = x0 + Math.sin(y / h * 6.283 * fr + ph) * amp + Math.sin(y / h * 6.283 * 7 + ph * 2) * 2; if (y === -4) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
        ctx.beginPath(); for (y = -4; y <= h + 4; y += 8) { var x2 = x0 - w + Math.sin(y / h * 6.283 * fr + ph) * amp; if (y === -4) ctx.moveTo(x2, y); else ctx.lineTo(x2, y); } ctx.stroke();
        ctx.beginPath(); for (y = -4; y <= h + 4; y += 8) { var x3 = x0 + w + Math.sin(y / h * 6.283 * fr + ph) * amp; if (y === -4) ctx.moveTo(x3, y); else ctx.lineTo(x3, y); } ctx.stroke();
      }
      strands(ctx, w, h, 3000 * (w / 256), rng, { len: [8, 30], alpha: 0.12, spread: 0.08, width: 0.8, darkCol: dark });
      if (o.figure) { for (var k = 0; k < h; k += 6 + rng() * 10) { ctx.fillStyle = rgba(rng() < 0.5 ? light : dark, 0.05 * o.figure + rng() * 0.08 * o.figure); ctx.fillRect(0, k, w, 2 + rng() * 5); } }
      noiseOverlay(ctx, w, h, 3, 3, 0.3, 12, 'soft-light');
      (o.checker || []).forEach(function (r) {
        var rx = r.x * w, ry = r.y * h, rw = r.w * w, rh = r.h * h, s = Math.max(2, w / 96);
        ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
        ctx.fillStyle = 'rgba(30,15,6,.35)'; ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = 'rgba(20,10,4,.55)'; ctx.lineWidth = s * 0.45;
        for (var d = -rh; d < rw + rh; d += s) { ctx.beginPath(); ctx.moveTo(rx + d, ry); ctx.lineTo(rx + d + rh * 0.6, ry + rh); ctx.stroke(); ctx.beginPath(); ctx.moveTo(rx + d, ry + rh); ctx.lineTo(rx + d + rh * 0.6, ry); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(255,220,170,.12)'; ctx.lineWidth = 1; ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
        ctx.restore();
      });
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  /** Gun metal. o: {type:'blued'|'parkerized'|'brushed'|'stainless'|'black', size, seed} */
  TX.metal = function (o) {
    o = typeof o === 'string' ? { type: o } : (o || {});
    var size = texSize(o.size || 256), type = o.type || 'blued';
    return cached('metal' + type + size + (o.seed || 0), function () {
      var c = mkCanvas(size), ctx = c.getContext('2d'), rng = U.rng(o.seed || 8);
      var base = { blued: '#2b3240', parkerized: '#4a4d47', brushed: '#a3a8ad', stainless: '#c1c5c9', black: '#2a2b2d' }[type] || '#2b3240';
      ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
      if (type === 'parkerized') { for (var i = 0; i < size * size / 6; i++) { ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.08)'; ctx.fillRect(rng() * size, rng() * size, 1, 1); } }
      else {
        for (var j = 0; j < size * 1.5; j++) { var y = rng() * size; ctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,' + (0.02 + rng() * 0.05) + ')' : 'rgba(0,0,0,' + (0.03 + rng() * 0.06) + ')'; ctx.fillRect(0, y, size, 0.6 + rng()); }
        if (type === 'blued') { ctx.globalAlpha = 0.12; ctx.fillStyle = '#4a5f8a'; ctx.fillRect(0, 0, size, size); ctx.globalAlpha = 1; }
      }
      noiseOverlay(ctx, size, size, 3, 3, type === 'blued' ? 0.25 : 0.18, 21, 'soft-light');
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  /** Leather. o: {base, dark, size, seed, stitch} */
  TX.leather = function (o) {
    o = o || {};
    var size = texSize(o.size || 256);
    return cached('leather' + JSON.stringify(o) + size, function () {
      var c = mkCanvas(size), ctx = c.getContext('2d'), rng = U.rng(o.seed || 6), base = o.base || '#5a3b26', dark = o.dark || shade(base, 0.55);
      ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
      for (var i = 0; i < size * size / 14; i++) { var x = rng() * size, y = rng() * size, r = 1 + rng() * 2.2; ctx.fillStyle = rgba(rng() < 0.6 ? dark : shade(base, 1.3), 0.18); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
      ctx.lineCap = 'round';
      for (var k = 0; k < 26; k++) { ctx.strokeStyle = rgba(dark, 0.25 + rng() * 0.2); ctx.lineWidth = 0.8 + rng(); var x0 = rng() * size, y0 = rng() * size; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + (rng() - 0.5) * 40, y0 + (rng() - 0.5) * 40, x0 + (rng() - 0.5) * 70, y0 + (rng() - 0.5) * 30); ctx.stroke(); }
      noiseOverlay(ctx, size, size, 4, 4, 0.4, 13, 'soft-light');
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  /** Fabric (woven) with optional colour. o: {base, size, seed} */
  TX.fabric = function (o) {
    o = o || {};
    var size = texSize(o.size || 256);
    return cached('fabric' + JSON.stringify(o) + size, function () {
      var c = mkCanvas(size), ctx = c.getContext('2d'), rng = U.rng(o.seed || 14);
      ctx.fillStyle = o.base || '#ffffff'; ctx.fillRect(0, 0, size, size);
      for (var y = 0; y < size; y += 2) { ctx.fillStyle = 'rgba(0,0,0,' + (0.04 + rng() * 0.05) + ')'; ctx.fillRect(0, y, size, 1); }
      for (var x = 0; x < size; x += 2) { ctx.fillStyle = 'rgba(255,255,255,' + (0.03 + rng() * 0.04) + ')'; ctx.fillRect(x, 0, 1, size); }
      noiseOverlay(ctx, size, size, 4, 4, 0.3, 15, 'soft-light');
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  /** Camo. o: {pattern:'woodland'|'leafy'|'digital'|'blaze'|'marsh'|'snow', palette:[c0..c3], size, seed} */
  TX.camo = function (o) {
    o = typeof o === 'string' ? { pattern: o } : (o || {});
    var size = texSize(o.size || 512), pat = o.pattern || 'woodland';
    var pal = o.palette || {
      woodland: ['#5d5a3c', '#3b3a26', '#7a6a48', '#262418'], leafy: ['#6e6250', '#4b4233', '#8b7a5c', '#2f3b25'], digital: ['#6b6a52', '#4a4a38', '#8a8566', '#2e2e24'],
      blaze: ['#ff6a12', '#e05208', '#ff8a3a', '#c94a06'], marsh: ['#9a8a62', '#6f6142', '#b8a77a', '#4a4030'], snow: ['#eef1f2', '#c9cfd3', '#a8b0b6', '#ffffff']
    }[pat] || ['#5d5a3c', '#3b3a26', '#7a6a48', '#262418'];
    return cached('camo' + pat + JSON.stringify(pal) + size + (o.seed || 0), function () {
      var c = mkCanvas(size), ctx = c.getContext('2d'), rng = U.rng(o.seed || 31), i;
      ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, size, size);
      function blob(cx, cy, r, colr) {
        wrapDraw(size, size, cx, cy, r * 1.6, function (x, y) {
          ctx.fillStyle = colr; ctx.beginPath();
          var n = 9; for (var k = 0; k <= n; k++) { var a = k / n * 6.283, rr = r * (0.6 + 0.5 * hash2(k, Math.round(cx), Math.round(cy))); var px = x + Math.cos(a) * rr * 1.4, py = y + Math.sin(a) * rr; if (k === 0) ctx.moveTo(px, py); else ctx.quadraticCurveTo(x + Math.cos(a - 0.35) * rr * 1.9, y + Math.sin(a - 0.35) * rr * 1.3, px, py); }
          ctx.fill();
        });
      }
      if (pat === 'digital') {
        var px = size / 48;
        for (var l = 1; l < 4; l++) for (var y = 0; y < size; y += px) for (var x = 0; x < size; x += px) if (fbm(x / size, y / size, 4, 3, l * 7) > 0.55 + l * 0.02) { ctx.fillStyle = pal[l]; ctx.fillRect(x, y, px, px); }
      } else if (pat === 'blaze') {
        noiseOverlay(ctx, size, size, 6, 4, 0.35, 5, 'soft-light');
        for (var y2 = 0; y2 < size; y2 += 3) { ctx.fillStyle = 'rgba(0,0,0,.05)'; ctx.fillRect(0, y2, size, 1); }
      } else if (pat === 'marsh') {
        ctx.lineCap = 'round';
        for (i = 0; i < 600; i++) { ctx.strokeStyle = pal[1 + (i % 3)]; ctx.lineWidth = 2 + rng() * 5; var x0 = rng() * size, y0 = rng() * size, L = 40 + rng() * 120; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + (rng() - 0.5) * 30, y0 - L / 2, x0 + (rng() - 0.5) * 50, y0 - L); ctx.stroke(); }
      } else {
        for (var layer = 1; layer < 4; layer++) for (i = 0; i < (pat === 'leafy' ? 14 : 22); i++) blob(rng() * size, rng() * size, size * (0.04 + rng() * 0.07), pal[layer]);
        if (pat === 'leafy') {
          ctx.lineCap = 'round';
          for (i = 0; i < 60; i++) { ctx.strokeStyle = rgba(pal[3], 0.7); ctx.lineWidth = 2 + rng() * 3; var bx = rng() * size, by = rng() * size; ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + 30, by - 40, bx + (rng() - 0.5) * 90, by - 90); ctx.stroke(); }
          for (i = 0; i < 260; i++) { var lx = rng() * size, ly = rng() * size, lr = 6 + rng() * 14, la = rng() * 6.28, lc = pal[(i % 3) + 1]; wrapDraw(size, size, lx, ly, lr * 2, function (x, y) { ctx.save(); ctx.translate(x, y); ctx.rotate(la); ctx.fillStyle = lc; ctx.beginPath(); ctx.ellipse(0, 0, lr * 0.45, lr, 0, 0, 6.283); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -lr); ctx.lineTo(0, lr); ctx.stroke(); ctx.restore(); }); }
        }
      }
      noiseOverlay(ctx, size, size, 8, 3, 0.18, 2, 'soft-light');
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  /** Grayscale fbm noise texture. o: {size, period, octaves, seed, srgb:false} */
  TX.noise = function (o) {
    o = o || {};
    var size = o.size || 256;
    return cached('noise' + JSON.stringify(o), function () { return finishTex(new THREE.CanvasTexture(noiseCanvas(size, o.period || 4, o.octaves || 4, o.seed || 1)), { srgb: !!o.srgb }); });
  };
  /** Antler / horn surface: longitudinal grooves along +y, mean ~white (tint by vertex colour) */
  TX.antler = function () {
    var size = texSize(256);
    return cached('antlertex' + size, function () {
      var c = mkCanvas(size), ctx = c.getContext('2d'), rng = U.rng(77);
      ctx.fillStyle = '#efe9dd'; ctx.fillRect(0, 0, size, size);
      strands(ctx, size, size, 1600 * (size / 256), rng, { len: [20, 70], alpha: 0.28, spread: 0.06, width: 1.4 });
      noiseOverlay(ctx, size, size, 5, 4, 0.35, 41, 'soft-light');
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };

  /* ---------------- materials (quality aware, cached, shared) ---------------- */
  var gmatCache = {};
  var windUniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(1, 0, 0.5) }, uPlayer: { value: new THREE.Vector3() } };
  G.windUniforms = windUniforms;
  function matKey(o) {
    var k = [];
    for (var p in o) { var v = o[p]; if (v && v.isTexture) v = v.uuid; else if (v && typeof v === 'object') v = JSON.stringify(v); k.push(p + '=' + v); }
    return k.sort().join('|');
  }
  /** Wind sway + distance fade vertex patch (instanced vegetation). cfg: {amp, fade:[r0,r1] (grass), flutter} */
  function windPatch(shader, cfg) {
    shader.uniforms.uTime = windUniforms.uTime; shader.uniforms.uWind = windUniforms.uWind; shader.uniforms.uPlayer = windUniforms.uPlayer;
    shader.uniforms.uSway = { value: cfg.amp == null ? 0.02 : cfg.amp };
    shader.uniforms.uFade = { value: new THREE.Vector2(cfg.fade ? cfg.fade[0] : 1e6, cfg.fade ? cfg.fade[1] : 2e6) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uWind; uniform vec3 uPlayer; uniform float uSway; uniform vec2 uFade;')
      .replace('#include <project_vertex>', [
        'vec4 mvPosition = vec4( transformed, 1.0 );',
        '#ifdef USE_INSTANCING',
        ' mvPosition = instanceMatrix * mvPosition;',
        '#endif',
        '{ float hh = max(transformed.y, 0.0);',
        '  vec3 org = vec3(0.0);',
        '  #ifdef USE_INSTANCING',
        '  org = instanceMatrix[3].xyz;',
        '  #endif',
        '  float ph = dot(org.xz, vec2(0.37, 0.23));',
        '  float fd = 1.0 - smoothstep(uFade.x, uFade.y, distance(org.xz, uPlayer.xz));',
        '  mvPosition.y = mix(org.y - 0.05, mvPosition.y, fd);',
        '  float gust = 0.55 + 0.45 * sin(uTime * 1.3 + ph) + 0.25 * sin(uTime * 3.7 + ph * 2.3 + transformed.x * 1.7);',
        '  vec2 sw = uWind.xy * (uWind.z * uSway * hh * hh * gust);',
        '  mvPosition.xz += sw; mvPosition.y -= dot(sw, sw) * 0.5 / max(hh, 0.3); }',
        'mvPosition = modelViewMatrix * mvPosition;',
        'gl_Position = projectionMatrix * mvPosition;'
      ].join('\n'));
  }
  function applyWind(m, cfg) {
    m.onBeforeCompile = function (shader) { windPatch(shader, cfg); m.userData.shader = shader; };
    // distinct program key per cfg shape (uniform values differ only)
    m.customProgramCacheKey = function () { return 'hgwind'; };
  }
  G.applyWind = applyWind;
  /** Depth material for alpha-tested / wind-swayed meshes (shadow casters). */
  G.depthMaterial = function (m) {
    if (m.userData.depthMat) return m.userData.depthMat;
    var d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map || null, alphaTest: m.alphaTest || 0, side: m.side });
    if (m.userData.wind) applyWind(d, m.userData.wind);
    d.userData.shared = true;
    m.userData.depthMat = d;
    return d;
  };
  /** G.mat(opts) -> cached shared material. High/Ultra: MeshStandardMaterial; Low: Lambert (Phong for metal/gloss).
   *  opts: {color, map, normalMap, normalScale, roughness (0.8), metalness (0), vertexColors, skinning, side, alphaTest,
   *         transparent, opacity, depthWrite, emissive, emissiveIntensity, envMapIntensity, flat, fog, wind:{amp, fade}, key} */
  G.mat = function (o) {
    o = o || {};
    var low = G.isLow(), key = (o.key || matKey(o)) + (low ? '#L' : '#H');
    var m = gmatCache[key]; if (m) return m;
    var p = {};
    if (o.color != null) p.color = G.color(o.color);
    if (o.map) p.map = o.map;
    if (o.vertexColors) p.vertexColors = true;
    if (o.skinning) p.skinning = true;
    if (o.side != null) p.side = o.side;
    if (o.alphaTest) p.alphaTest = o.alphaTest;
    if (o.transparent) { p.transparent = true; p.opacity = o.opacity == null ? 1 : o.opacity; }
    if (o.depthWrite === false) p.depthWrite = false;
    if (o.emissive != null) p.emissive = G.color(o.emissive);
    if (o.fog === false) p.fog = false;
    var metal = o.metalness || 0, rough = o.roughness == null ? 0.8 : o.roughness;
    if (low) {
      if (metal > 0.4 || rough < 0.35) { p.shininess = Math.round(10 + (1 - rough) * 80); p.specular = new THREE.Color(metal > 0.4 ? 0x8a8a8a : 0x404040); m = new THREE.MeshPhongMaterial(p); }
      else m = new THREE.MeshLambertMaterial(p);
    } else {
      p.roughness = rough; p.metalness = metal;
      if (o.normalMap) { p.normalMap = o.normalMap; var ns = o.normalScale == null ? 1 : o.normalScale; p.normalScale = new THREE.Vector2(ns, ns); }
      if (o.roughnessMap) p.roughnessMap = o.roughnessMap;
      if (o.flat) p.flatShading = true;
      m = new THREE.MeshStandardMaterial(p);
      if (o.envMapIntensity != null) m.envMapIntensity = o.envMapIntensity;
    }
    if (o.emissiveIntensity != null && m.emissive) m.emissiveIntensity = o.emissiveIntensity;
    if (o.wind) { m.userData.wind = o.wind; applyWind(m, o.wind); }
    m.userData.shared = true; m.userData.gfx = true;
    gmatCache[key] = m;
    return m;
  };

  /* ---------------- geometry utilities ---------------- */
  var _gv = new THREE.Vector3(), _gv2 = new THREE.Vector3(), _gv3 = new THREE.Vector3(), _gv4 = new THREE.Vector3(), _gc = new THREE.Color();
  var _gm = new THREE.Matrix4(), _gq = new THREE.Quaternion(), _ge = new THREE.Euler(), _gs = new THREE.Vector3();
  /** Merge any BufferGeometries (indexed or not) into one indexed geometry. Missing attributes get defaults
   *  (color 1, skinWeight [1,0,0,0], others 0). opts {groups:true|[materialIndex...], keep:false} */
  G.merge = function (geos, opts) {
    opts = opts || {};
    var list = []; for (var i = 0; i < geos.length; i++) if (geos[i] && geos[i].attributes && geos[i].attributes.position) list.push(geos[i]);
    var out = new THREE.BufferGeometry();
    if (!list.length) return out;
    var names = {}, k;
    list.forEach(function (g) { for (k in g.attributes) if (!names[k]) names[k] = g.attributes[k].itemSize; });
    var vtot = 0, itot = 0;
    list.forEach(function (g) { var n = g.attributes.position.count; vtot += n; itot += g.index ? g.index.count : n; });
    var arrs = {}; for (k in names) arrs[k] = new Float32Array(vtot * names[k]);
    var idx = vtot > 65535 ? new Uint32Array(itot) : new Uint16Array(itot), vo = 0, io = 0;
    list.forEach(function (g, gi) {
      var n = g.attributes.position.count, j, c;
      for (k in names) {
        var a = g.attributes[k], sz = names[k], dst = arrs[k];
        if (a) { var src = a.array, isz = a.itemSize; for (j = 0; j < n; j++) for (c = 0; c < sz; c++) dst[(vo + j) * sz + c] = c < isz ? src[j * isz + c] : 0; }
        else { var dv = k === 'color' ? 1 : 0; for (j = 0; j < n; j++) for (c = 0; c < sz; c++) dst[(vo + j) * sz + c] = (k === 'skinWeight' ? (c === 0 ? 1 : 0) : dv); }
      }
      var cnt;
      if (g.index) { cnt = g.index.count; for (j = 0; j < cnt; j++) idx[io + j] = g.index.array[j] + vo; }
      else { cnt = n; for (j = 0; j < n; j++) idx[io + j] = vo + j; }
      if (opts.groups) out.addGroup(io, cnt, opts.groups === true ? gi : opts.groups[gi]);
      io += cnt; vo += n;
      if (!opts.keep && !(g.userData && g.userData.shared)) g.dispose();
    });
    for (k in names) out.setAttribute(k, new THREE.BufferAttribute(arrs[k], names[k]));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  };
  /** In-place transform: pos [x,y,z], rot [x,y,z] (Euler XYZ) or Quaternion, scale number|[x,y,z] */
  G.xform = function (g, pos, rot, scale) {
    _gs.set(1, 1, 1); if (scale != null) { if (typeof scale === 'number') _gs.set(scale, scale, scale); else _gs.set(scale[0], scale[1], scale[2]); }
    if (rot && rot.isQuaternion) _gq.copy(rot); else { _ge.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0, (rot && rot[3]) || 'XYZ'); _gq.setFromEuler(_ge); }
    _gv.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0);
    g.applyMatrix4(_gm.compose(_gv, _gq, _gs));
    return g;
  };
  /** Mirror across X (fixes winding + normals). */
  G.mirrorX = function (g) {
    g.scale(-1, 1, 1);
    if (g.index) { var a = g.index.array; for (var i = 0; i < a.length; i += 3) { var t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; }
    else { var names = Object.keys(g.attributes); names.forEach(function (n) { var at = g.attributes[n], s = at.itemSize, arr = at.array; for (var j = 0; j < at.count; j += 3) for (var c = 0; c < s; c++) { var t2 = arr[(j + 1) * s + c]; arr[(j + 1) * s + c] = arr[(j + 2) * s + c]; arr[(j + 2) * s + c] = t2; } at.needsUpdate = true; }); }
    if (g.attributes.normal) { var nm = g.attributes.normal; for (var q = 0; q < nm.count; q++) nm.setX(q, -nm.getX(q)); nm.needsUpdate = true; }
    return g;
  };
  function ensureColor(g) {
    var col = g.attributes.color;
    if (!col) { col = new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3); g.setAttribute('color', col); }
    return col;
  }
  G.ensureColor = ensureColor;
  /** Vertex paint: fn(c:Color, x,y,z, nx,ny,nz, u,v, i) sets c in sRGB (c.setRGB / c.set) or returns a colour.
   *  opts {multiply:true (multiply existing), gain:1} — colours are converted to linear. */
  G.paint = function (g, fn, opts) {
    opts = opts || {};
    var p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, cnt = p.count, col = ensureColor(g), gain = opts.gain || 1;
    for (var i = 0; i < cnt; i++) {
      _gc.setRGB(1, 1, 1);
      var r = fn(_gc, p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, i);
      if (r != null && r !== _gc && r !== false) _gc.set(r);
      _gc.convertSRGBToLinear();
      if (opts.multiply) col.setXYZ(i, col.getX(i) * _gc.r * gain, col.getY(i) * _gc.g * gain, col.getZ(i) * _gc.b * gain);
      else col.setXYZ(i, Math.min(1, _gc.r * gain), Math.min(1, _gc.g * gain), Math.min(1, _gc.b * gain));
    }
    col.needsUpdate = true;
    return g;
  };
  /** Solid colour helper (sRGB in) */
  G.tint = function (g, color) { _gc.set(color); var r = _gc.r, gg = _gc.g, b = _gc.b; return G.paint(g, function (c) { c.setRGB(r, gg, b); }); };
  function autoOccluders(g, cells) {
    g.computeBoundingBox();
    var bb = g.boundingBox, sx = (bb.max.x - bb.min.x) || 1e-3, sy = (bb.max.y - bb.min.y) || 1e-3, sz = (bb.max.z - bb.min.z) || 1e-3;
    var cs = Math.max(sx, sy, sz) / cells, map = {}, p = g.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), key = Math.floor((x - bb.min.x) / cs) + ',' + Math.floor((y - bb.min.y) / cs) + ',' + Math.floor((z - bb.min.z) / cs);
      var e = map[key] || (map[key] = [0, 0, 0, 0]); e[0] += x; e[1] += y; e[2] += z; e[3]++;
    }
    var out = []; for (var k in map) { var m = map[k]; out.push([m[0] / m[3], m[1] / m[3], m[2] / m[3], cs * 0.6]); }
    return out;
  }
  /** Vertex ambient occlusion (multiplies the colour attribute).
   *  opts {occluders:[[x,y,z,r]...]|'auto', cells:10, strength:1, ground:y|null, groundStrength:0.45, groundFalloff:0.35, under:0.25, min:0.35} */
  G.vertexAO = function (g, opts) {
    opts = opts || {};
    if (!g.attributes.normal) g.computeVertexNormals();
    var p = g.attributes.position, n = g.attributes.normal, cnt = p.count, col = ensureColor(g);
    var occ = (!opts.occluders || opts.occluders === 'auto') ? autoOccluders(g, opts.cells || 10) : opts.occluders;
    var st = opts.strength == null ? 1 : opts.strength, mn = opts.min == null ? 0.35 : opts.min, gy = opts.ground, gS = opts.groundStrength == null ? 0.45 : opts.groundStrength, gF = opts.groundFalloff || 0.35, under = opts.under == null ? 0.25 : opts.under;
    for (var i = 0; i < cnt; i++) {
      var px = p.getX(i), py = p.getY(i), pz = p.getZ(i), nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i), o = 0;
      for (var j = 0; j < occ.length; j++) {
        var s = occ[j], dx = s[0] - px, dy = s[1] - py, dz = s[2] - pz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-8) continue;
        var d = Math.sqrt(d2), cs = (dx * nx + dy * ny + dz * nz) / d; if (cs <= 0.05) continue;
        var rr = s[3] / d; if (rr > 1) rr = 1;
        o += rr * rr * cs;
      }
      var ao = 1 - Math.min(1, o * 0.75) * st;
      ao *= 1 - Math.max(0, -ny) * under;
      if (gy != null) { var hgt = py - gy; ao *= 1 - gS * (1 - Math.min(1, Math.max(0, hgt / gF))) * (0.4 + 0.6 * Math.max(0, -ny * 0.5 + 0.5)); }
      if (ao < mn) ao = mn;
      col.setXYZ(i, col.getX(i) * ao, col.getY(i) * ao, col.getZ(i) * ao);
    }
    col.needsUpdate = true;
    return g;
  };

  /* ---------------- loft: smooth tube through cross-sections ---------------- */
  function crs(a0, a1, a2, a3, t) { var t2 = t * t, t3 = t2 * t; return 0.5 * ((2 * a1) + (-a0 + a2) * t + (2 * a0 - 5 * a1 + 4 * a2 - a3) * t2 + (-a0 + 3 * a1 - 3 * a2 + a3) * t3); }
  /** G.loft(sections, opts) -> indexed BufferGeometry (position, normal, uv).
   *  section: {p:[x,y,z], rx, ry | ryUp & ryDown, sq (superellipse exponent, 2 = ellipse), n:[x,y,z] (optional 'up' override)}
   *  opts: {radial:16, steps:3, frame:'up'|'transport', up:[0,1,0], smooth:0 (frame smoothing rings), linear:false,
   *         capStart:true, capEnd:true, density:2.5 (texture repeats per metre), uRepeat, uRange:[u0,u1], vRange:[v0,v1],
   *         seam:0 (angle offset), displace:fn(out Vector3, ringT, theta, ringIndex)} */
  G.loft = function (secs, opts) {
    opts = opts || {};
    var R = opts.radial || 16, S = opts.steps || 3, n = secs.length, lin = !!opts.linear;
    if (n < 2) return new THREE.BufferGeometry();
    function sv(i, key) {
      i = i < 0 ? 0 : i > n - 1 ? n - 1 : i; var s = secs[i];
      switch (key) {
        case 0: return s.p[0]; case 1: return s.p[1]; case 2: return s.p[2];
        case 3: return s.rx != null ? s.rx : (s.r != null ? s.r : 0.1);
        case 4: return s.ryUp != null ? s.ryUp : s.ry != null ? s.ry : s.r != null ? s.r : (s.rx != null ? s.rx : 0.1);
        case 5: return s.ryDown != null ? s.ryDown : s.ry != null ? s.ry : s.r != null ? s.r : (s.rx != null ? s.rx : 0.1);
        case 6: return s.sq || 2;
      }
      return 0;
    }
    var rings = [];
    for (var i = 0; i < n - 1; i++) {
      var last = i === n - 2;
      for (var s = 0; s < (last ? S + 1 : S); s++) {
        var t = s / S, r = [];
        for (var k = 0; k < 7; k++) r.push(lin ? sv(i, k) + (sv(i + 1, k) - sv(i, k)) * t : crs(sv(i - 1, k), sv(i, k), sv(i + 1, k), sv(i + 2, k), t));
        r[3] = Math.max(0.0004, r[3]); r[4] = Math.max(0.0004, r[4]); r[5] = Math.max(0.0004, r[5]);
        var nn = secs[i].n && secs[i + 1].n ? [secs[i].n[0] + (secs[i + 1].n[0] - secs[i].n[0]) * t, secs[i].n[1] + (secs[i + 1].n[1] - secs[i].n[1]) * t, secs[i].n[2] + (secs[i + 1].n[2] - secs[i].n[2]) * t] : null;
        rings.push({ x: r[0], y: r[1], z: r[2], rx: r[3], ru: r[4], rd: r[5], sq: r[6], nn: nn });
      }
    }
    var NR = rings.length, T = [], N = [], B = [], arc = [0];
    for (i = 0; i < NR; i++) {
      var a = rings[Math.max(0, i - 1)], b = rings[Math.min(NR - 1, i + 1)];
      var tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z, tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      T.push([tx / tl, ty / tl, tz / tl]);
      if (i > 0) { var p0 = rings[i - 1], p1 = rings[i]; arc.push(arc[i - 1] + Math.sqrt((p1.x - p0.x) * (p1.x - p0.x) + (p1.y - p0.y) * (p1.y - p0.y) + (p1.z - p0.z) * (p1.z - p0.z))); }
    }
    var up = opts.up || [0, 1, 0], mode = opts.frame || 'up';
    function proj(v, t) { var d = v[0] * t[0] + v[1] * t[1] + v[2] * t[2], x = v[0] - t[0] * d, y = v[1] - t[1] * d, z = v[2] - t[2] * d, l = Math.sqrt(x * x + y * y + z * z); return l < 1e-4 ? null : [x / l, y / l, z / l]; }
    for (i = 0; i < NR; i++) {
      var nv = null;
      if (rings[i].nn) nv = proj(rings[i].nn, T[i]);
      if (!nv && mode === 'up') nv = proj(up, T[i]);
      if (!nv) nv = i > 0 ? proj(N[i - 1], T[i]) : (proj(up, T[i]) || proj([0, 0, -1], T[i]) || [1, 0, 0]);
      if (!nv) nv = [0, 1, 0];
      N.push(nv);
    }
    var sm = opts.smooth || 0;
    if (sm > 0) {
      var N2 = [];
      for (i = 0; i < NR; i++) { var sx = 0, sy = 0, sz = 0; for (var q = -sm; q <= sm; q++) { var nq = N[Math.max(0, Math.min(NR - 1, i + q))]; sx += nq[0]; sy += nq[1]; sz += nq[2]; } var l2 = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1; N2.push([sx / l2, sy / l2, sz / l2]); }
      N = N2;
    }
    for (i = 0; i < NR; i++) {
      var Tt = T[i], Nn = N[i], bx = Nn[1] * Tt[2] - Nn[2] * Tt[1], by = Nn[2] * Tt[0] - Nn[0] * Tt[2], bz = Nn[0] * Tt[1] - Nn[1] * Tt[0], bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      B.push([bx / bl, by / bl, bz / bl]);
    }
    var total = arc[NR - 1] || 1, dens = opts.density || 2.5;
    var circ = 0; for (i = 0; i < NR; i++) circ += Math.PI * (rings[i].rx + (rings[i].ru + rings[i].rd) / 2);
    circ /= NR;
    var uRep = opts.uRepeat || Math.max(1, Math.round(circ * dens));
    var capS = opts.capStart !== false, capE = opts.capEnd !== false;
    var vcount = NR * (R + 1) + (capS ? 1 : 0) + (capE ? 1 : 0);
    var pos = new Float32Array(vcount * 3), uvs = new Float32Array(vcount * 2), ind = [];
    var seam = opts.seam || 0, disp = opts.displace, dv = _gv3;
    for (i = 0; i < NR; i++) {
      var rg = rings[i], Nn2 = N[i], Bb = B[i], e = 2 / rg.sq;
      for (var j = 0; j <= R; j++) {
        var th = j / R * Math.PI * 2 + seam, c = Math.cos(th), sn = Math.sin(th);
        var cc = e === 1 ? c : (c < 0 ? -1 : 1) * Math.pow(Math.abs(c), e), ss = e === 1 ? sn : (sn < 0 ? -1 : 1) * Math.pow(Math.abs(sn), e);
        var ry = cc > 0 ? rg.ru : rg.rd;
        var vx = rg.x + Nn2[0] * cc * ry + Bb[0] * ss * rg.rx, vy = rg.y + Nn2[1] * cc * ry + Bb[1] * ss * rg.rx, vz = rg.z + Nn2[2] * cc * ry + Bb[2] * ss * rg.rx;
        if (disp) { dv.set(vx, vy, vz); disp(dv, arc[i] / total, th, i, rg); vx = dv.x; vy = dv.y; vz = dv.z; }
        var vi = i * (R + 1) + j;
        pos[vi * 3] = vx; pos[vi * 3 + 1] = vy; pos[vi * 3 + 2] = vz;
        var uu = j / R, vv = arc[i] / total;
        if (opts.uRange) uu = opts.uRange[0] + (opts.uRange[1] - opts.uRange[0]) * uu; else uu *= uRep;
        if (opts.vRange) vv = opts.vRange[0] + (opts.vRange[1] - opts.vRange[0]) * vv; else vv = arc[i] * dens;
        uvs[vi * 2] = uu; uvs[vi * 2 + 1] = vv;
      }
    }
    for (i = 0; i < NR - 1; i++) for (j = 0; j < R; j++) {
      var a0 = i * (R + 1) + j, a1 = a0 + 1, b0 = a0 + R + 1, b1 = b0 + 1;
      ind.push(a0, b0, a1, a1, b0, b1);
    }
    // winding check: outward = away from ring centre
    var mid = Math.floor(NR / 2), qa = mid * (R + 1), qb = qa + R + 1;
    if (NR > 1) {
      _gv.set(pos[qb * 3] - pos[qa * 3], pos[qb * 3 + 1] - pos[qa * 3 + 1], pos[qb * 3 + 2] - pos[qa * 3 + 2]);
      _gv2.set(pos[(qa + 1) * 3] - pos[qa * 3], pos[(qa + 1) * 3 + 1] - pos[qa * 3 + 1], pos[(qa + 1) * 3 + 2] - pos[qa * 3 + 2]);
      _gv.cross(_gv2);
      _gv4.set(pos[qa * 3] - rings[mid].x, pos[qa * 3 + 1] - rings[mid].y, pos[qa * 3 + 2] - rings[mid].z);
      if (_gv.dot(_gv4) < 0) for (i = 0; i < ind.length; i += 3) { var tmp = ind[i + 1]; ind[i + 1] = ind[i + 2]; ind[i + 2] = tmp; }
    }
    var flip = NR > 1 && _gv.dot(_gv4) < 0;
    var vbase = NR * (R + 1), bulge = opts.capBulge == null ? 0.25 : opts.capBulge;
    function cap(ri, dir, vidx) {
      var rg2 = rings[ri], rr = Math.min(rg2.rx, (rg2.ru + rg2.rd) / 2) * bulge, Tt2 = T[ri];
      pos[vidx * 3] = rg2.x + Tt2[0] * rr * dir; pos[vidx * 3 + 1] = rg2.y + Tt2[1] * rr * dir; pos[vidx * 3 + 2] = rg2.z + Tt2[2] * rr * dir;
      uvs[vidx * 2] = opts.uRange ? (opts.uRange[0] + opts.uRange[1]) / 2 : uRep / 2; uvs[vidx * 2 + 1] = uvs[(ri * (R + 1)) * 2 + 1];
      for (var jj = 0; jj < R; jj++) {
        var r0 = ri * (R + 1) + jj, r1 = r0 + 1;
        // start cap faces -T, end cap faces +T: orientation relative to ring winding
        if ((dir < 0) !== flip) ind.push(vidx, r0, r1); else ind.push(vidx, r1, r0);
      }
    }
    var vi2 = vbase;
    if (capS) { cap(0, -1, vi2); vi2++; }
    if (capE) { cap(NR - 1, 1, vi2); vi2++; }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(ind, 1) : new THREE.Uint16BufferAttribute(ind, 1));
    g.computeVertexNormals();
    // weld the seam normals
    var nm = g.attributes.normal;
    for (i = 0; i < NR; i++) {
      var s0 = i * (R + 1), s1 = s0 + R;
      var ax = nm.getX(s0) + nm.getX(s1), ay = nm.getY(s0) + nm.getY(s1), az = nm.getZ(s0) + nm.getZ(s1), al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      nm.setXYZ(s0, ax / al, ay / al, az / al); nm.setXYZ(s1, ax / al, ay / al, az / al);
    }
    g.userData.rings = rings; g.userData.radial = R;
    g.computeBoundingSphere();
    return g;
  };
  /** Organic body from a spine of ellipsoid sections. sections: [{p:[x,y,z] | z,y, w (width), h | hUp,hDown, sq}] -> loft geometry */
  G.organicBody = function (sections, opts) {
    opts = opts || {};
    var s = sections.map(function (q) {
      var p = q.p || [q.x || 0, q.y, q.z];
      var hu = q.hUp != null ? q.hUp : (q.h != null ? q.h / 2 : 0.1), hd = q.hDown != null ? q.hDown : (q.h != null ? q.h / 2 : hu);
      return { p: p, rx: (q.w != null ? q.w / 2 : q.rx), ryUp: hu, ryDown: hd, sq: q.sq, n: q.n };
    });
    var o = {}; for (var k in opts) o[k] = opts[k];
    if (o.radial == null) o.radial = 24; if (o.steps == null) o.steps = 4; if (o.smooth == null) o.smooth = 2; if (o.frame == null) o.frame = 'up';
    return G.loft(s, o);
  };
  /** Tapered limb through joints [{p:[x,y,z], r | rx,rz}] (rx = side radius, rz = front/back radius). opts: loft opts (+bulge at joints) */
  G.taperedLimb = function (joints, opts) {
    opts = opts || {};
    var s = joints.map(function (j) { return { p: j.p, rx: j.rx != null ? j.rx : j.r, ryUp: j.rz != null ? j.rz : j.r, ryDown: j.rzBack != null ? j.rzBack : (j.rz != null ? j.rz : j.r), sq: j.sq, n: j.n || opts.n || [0, 0, -1] }; });
    var o = {}; for (var k in opts) o[k] = opts[k];
    if (o.radial == null) o.radial = 12; if (o.steps == null) o.steps = 4; if (o.frame == null) o.frame = 'transport';
    return G.loft(s, o);
  };
  /** Tapered tube along points with radii (array or fn(t)). opts: loft opts */
  G.tube = function (points, radii, opts) {
    opts = opts || {};
    var s = points.map(function (p, i) { var t = points.length > 1 ? i / (points.length - 1) : 0, r = typeof radii === 'function' ? radii(t) : Array.isArray(radii) ? radii[Math.min(i, radii.length - 1)] : radii; return { p: p.isVector3 ? [p.x, p.y, p.z] : p, r: r, sq: opts.sq }; });
    var o = {}; for (var k in opts) o[k] = opts[k];
    if (o.radial == null) o.radial = 8; if (o.steps == null) o.steps = 3; if (o.frame == null) o.frame = 'transport';
    return G.loft(s, o);
  };
  function curvePts(ctrl, n) {
    var pts = ctrl.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); });
    if (pts.length < 2) return pts;
    var cv = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), out = [];
    for (var i = 0; i <= n; i++) out.push(cv.getPoint(i / n));
    return out;
  }
  G.curvePoints = curvePts;
  /** Antler (one side, +x). spec: {base:[x,y,z], beam:[[x,y,z]...] (model-space control points after base), r:[r0, rTip],
   *  tines:[{t (0..1 along beam), dir:[x,y,z], len, r, bend:[x,y,z]}], palm:{t0, t1, width, thick, points, pointLen}, burr:true, seg:16, radial:7}
   *  side -1 mirrors to the left. Returns geometry with uv (u around, v along) + attribute-free (paint it). */
  G.antler = function (spec, side) {
    var seg = spec.seg || 16, rad = spec.radial || 7, geos = [];
    var ctrl = [spec.base].concat(spec.beam), pts = curvePts(ctrl, seg), r0 = spec.r ? spec.r[0] : 0.022, r1 = spec.r ? spec.r[1] : 0.006;
    var beamR = function (t) { var r = r0 + (r1 - r0) * Math.pow(t, 0.85); if (spec.burr !== false && t < 0.05) r *= 1 + (1 - t / 0.05) * 0.45; return r; };
    geos.push(G.tube(pts, beamR, { radial: rad, steps: 2, density: 6, capStart: true, capEnd: true, capBulge: 0.6 }));
    var beamCurve = new THREE.CatmullRomCurve3(ctrl.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }), false, 'centripetal');
    (spec.tines || []).forEach(function (tn) {
      var st = beamCurve.getPoint(tn.t), d = new THREE.Vector3(tn.dir[0], tn.dir[1], tn.dir[2]).normalize(), L = tn.len || 0.15;
      var bend = tn.bend ? new THREE.Vector3(tn.bend[0], tn.bend[1], tn.bend[2]) : new THREE.Vector3();
      var p1 = st.clone().addScaledVector(d, L * 0.5).addScaledVector(bend, 0.5), p2 = st.clone().addScaledVector(d, L).add(bend);
      var p0 = st.clone().addScaledVector(d, -beamR(tn.t) * 0.6);
      var tr = tn.r || beamR(tn.t) * 0.75;
      geos.push(G.tube(curvePts([[p0.x, p0.y, p0.z], [st.x, st.y, st.z], [p1.x, p1.y, p1.z], [p2.x, p2.y, p2.z]], 8), function (t) { return tr * (1 - t * 0.88); }, { radial: Math.max(5, rad - 1), steps: 1, density: 6, capBulge: 0.9 }));
    });
    if (spec.palm) {
      var P = spec.palm, ps = [], np = 8;
      for (var i = 0; i <= np; i++) {
        var t = P.t0 + (P.t1 - P.t0) * i / np, q = beamCurve.getPoint(t), wv = Math.sin(Math.PI * Math.min(1, i / np * 1.15)) * P.width;
        ps.push({ p: [q.x, q.y, q.z], rx: Math.max(0.01, wv * 0.5), ry: P.thick || 0.02, n: P.normal || [0, 0, 1] });
      }
      var palm = G.loft(ps, { radial: 14, steps: 2, frame: 'up', up: P.normal || [0, 0, 1], density: 5 });
      geos.push(palm);
      var tipsN = P.points || 6;
      for (var k = 0; k < tipsN; k++) {
        var tt = P.t0 + (P.t1 - P.t0) * (0.1 + 0.85 * k / Math.max(1, tipsN - 1)), qq = beamCurve.getPoint(tt), tg = beamCurve.getTangent(tt);
        var outD = new THREE.Vector3().crossVectors(tg, new THREE.Vector3(P.normal ? P.normal[0] : 0, P.normal ? P.normal[1] : 0, P.normal ? P.normal[2] : 1)).normalize();
        if (outD.y < 0) outD.negate();
        var ww = Math.sin(Math.PI * Math.min(1, (tt - P.t0) / (P.t1 - P.t0) * 1.15)) * P.width * 0.45, a = qq.clone().addScaledVector(outD, ww * 0.8), b = qq.clone().addScaledVector(outD, ww + (P.pointLen || 0.08));
        geos.push(G.tube([[a.x, a.y, a.z], [b.x, b.y, b.z]], function (t) { return (P.thick || 0.02) * 1.1 * (1 - t * 0.85); }, { radial: 5, steps: 3, capBulge: 0.9 }));
      }
    }
    var g = G.merge(geos);
    if (side < 0) G.mirrorX(g);
    return g;
  };
  /** Horn along a curling path. spec: {base:[x,y,z], dir:[x,y,z], up:[x,y,z] (curl axis normal), len, r0, r1, curl (rad), twist, ridges, ridgeDepth, seg, radial} */
  G.horn = function (spec, side) {
    var seg = spec.seg || 14, len = spec.len || 0.3, pts = [], d = new THREE.Vector3().fromArray(spec.dir || [0, 1, 0]).normalize();
    var ax = new THREE.Vector3().fromArray(spec.axis || [0, 0, 1]).normalize(), p = new THREE.Vector3().fromArray(spec.base || [0, 0, 0]), q = new THREE.Quaternion();
    var step = len / seg, curl = spec.curl || 0;
    for (var i = 0; i <= seg; i++) { pts.push([p.x, p.y, p.z]); q.setFromAxisAngle(ax, curl / seg); d.applyQuaternion(q); if (spec.twist) { q.setFromAxisAngle(d, spec.twist / seg); ax.applyQuaternion(q); } p.addScaledVector(d, step); }
    var r0 = spec.r0 || 0.04, r1 = spec.r1 || 0.004, ridges = spec.ridges || 0, rd = spec.ridgeDepth || 0.08;
    var g = G.tube(pts, function (t) { var r = r0 + (r1 - r0) * Math.pow(t, spec.taper || 1); if (ridges) r *= 1 + Math.sin(t * ridges * Math.PI * 2) * rd * (1 - t); return r; }, { radial: spec.radial || 10, steps: 2, density: 5, capBulge: 0.9 });
    if (side < 0) G.mirrorX(g);
    return g;
  };
  /** Cloven hoof (sole at y=0, toe toward -z). o: {w, l, h, cloven:true} */
  G.hoof = function (o) {
    o = o || {};
    var w = o.w || 0.05, l = o.l || 0.065, h = o.h || 0.055, geos = [];
    var halves = o.cloven === false ? [0] : [-1, 1];
    halves.forEach(function (sd) {
      var hw = o.cloven === false ? w / 2 : w * 0.27, x = sd * w * 0.24;
      geos.push(G.loft([
        { p: [x, 0.002, 0], rx: hw * 1.02, ryUp: l * 0.5, ryDown: l * 0.5, sq: 2.6, n: [0, 0, -1] },
        { p: [x, h * 0.5, l * 0.08], rx: hw * 0.95, ryUp: l * 0.42, ryDown: l * 0.4, sq: 2.4, n: [0, 0, -1] },
        { p: [x * 0.8, h, l * 0.18], rx: hw * 0.8, ryUp: l * 0.3, ryDown: l * 0.32, sq: 2.2, n: [0, 0, -1] }
      ], { radial: 10, steps: 2, frame: 'up', up: [0, 0, -1], capStart: true, capEnd: true, capBulge: 0.05, density: 8 }));
    });
    return G.merge(geos);
  };
  /** Paw (pad + toes + claws), centred, sole at y=0, toes toward -z. o: {size, toes:4, claw:0.4} */
  G.paw = function (o) {
    o = o || {};
    var s = o.size || 0.06, geos = [], toes = o.toes || 4;
    geos.push(G.organicBody([{ p: [0, s * 0.25, s * 0.35], w: s * 0.5, h: s * 0.3 }, { p: [0, s * 0.35, 0], w: s * 1.0, h: s * 0.6 }, { p: [0, s * 0.3, -s * 0.35], w: s * 0.95, h: s * 0.5 }, { p: [0, s * 0.2, -s * 0.55], w: s * 0.4, h: s * 0.25 }], { radial: 12, steps: 2, density: 10 }));
    for (var i = 0; i < toes; i++) {
      var a = (i / (toes - 1) - 0.5) * 1.6, x = Math.sin(a) * s * 0.42, z = -s * 0.45 - Math.cos(a) * s * 0.18;
      var t = new THREE.SphereGeometry(s * 0.17, 8, 6); t.scale(1, 0.85, 1.2); t.translate(x, s * 0.16, z); geos.push(t);
      if (o.claw !== 0) { var c = new THREE.ConeGeometry(s * 0.05, s * (o.claw || 0.4), 6); c.rotateX(-Math.PI / 2 - 0.4); c.translate(x, s * 0.12, z - s * 0.22); geos.push(c); }
    }
    return G.merge(geos);
  };
  /** Ear: cupped leaf shell from origin along +y, opening toward -z. o: {len, width, cup, thick, tip (0 round .. 1 pointed), segs}
   *  vertices get uv.x = 0 back face / 1 front (inner) face (use it when painting). */
  G.ear = function (o) {
    o = o || {};
    var L = o.len || 0.18, W = o.width || 0.08, cup = o.cup == null ? 0.35 : o.cup, th = o.thick || 0.006, tip = o.tip == null ? 0.5 : o.tip;
    var nu = 8, nv = o.segs || 10, pos = [], uv = [], ind = [];
    for (var face = 0; face < 2; face++) {
      for (var j = 0; j <= nv; j++) {
        var v = j / nv, wv = W * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + v * 0.95)), 0.6 + tip) * (1 - v * 0.25);
        for (var i = 0; i <= nu; i++) {
          var u = i / nu * 2 - 1, x = u * wv, y = v * L, z = cup * wv * (1 - u * u) * 1.2;
          var off = face === 0 ? th * (1 - v * 0.7) : 0;
          pos.push(x, y, z + off); uv.push(face, v);
        }
      }
    }
    var row = nu + 1, half = (nv + 1) * row;
    for (j = 0; j < nv; j++) for (i = 0; i < nu; i++) {
      var a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      ind.push(a, c, b, b, c, d);
      ind.push(half + a, half + b, half + c, half + b, half + d, half + c);
    }
    for (j = 0; j < nv; j++) { var l0 = j * row, l1 = l0 + row, r0 = j * row + nu, r1 = r0 + row; ind.push(l0, half + l0, l1, l1, half + l0, half + l1); ind.push(r0, r1, half + r0, r1, half + r1, half + r0); }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind);
    g.computeVertexNormals();
    return g;
  };
  /** Tail: tapered loft along a drooping curve from origin toward +z. o: {len, w, h, droop (rad), tipR, bushy} */
  G.tail = function (o) {
    o = o || {};
    var L = o.len || 0.2, w = o.w || 0.06, h = o.h || 0.04, dr = o.droop == null ? 0.9 : o.droop, n = 6, s = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, a = dr * t, z = Math.sin(Math.PI / 2 - a * 0.5) * L * t, y = -Math.sin(a * 0.9) * L * t * 0.9;
      var k = o.bushy ? Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.85)) : (1 - t * 0.75);
      s.push({ p: [0, y, z], rx: Math.max(0.004, w / 2 * k), ryUp: Math.max(0.004, h / 2 * k), ryDown: Math.max(0.004, h / 2 * k) });
    }
    return G.loft(s, { radial: 10, steps: 2, frame: 'up', density: 6, capBulge: 0.8 });
  };
  /** Beak / bill toward -z from origin. o: {len, w, h, hook (0..1), flat (duck bill)} */
  G.beak = function (o) {
    o = o || {};
    var L = o.len || 0.05, w = o.w || 0.03, h = o.h || 0.025, hook = o.hook || 0, flat = !!o.flat, s = [];
    for (var i = 0; i <= 5; i++) {
      var t = i / 5, k = flat ? (1 - t * 0.25) : (1 - t * 0.92);
      s.push({ p: [0, -hook * L * 0.6 * t * t * t, -L * t], rx: Math.max(0.002, w / 2 * (flat ? (1 - t * 0.1) : k)), ryUp: Math.max(0.0015, h / 2 * k * (flat ? 0.45 : 1)), ryDown: Math.max(0.0015, h / 2 * k * (flat ? 0.35 : 0.8)), sq: flat ? 2.8 : 2 });
    }
    return G.loft(s, { radial: 10, steps: 2, frame: 'up', density: 20, capBulge: flat ? 0.6 : 0.3 });
  };
  /** Feathered wing (spread pose) from shoulder at origin toward +x (side 1) or -x (side -1); trailing edge toward +z.
   *  o: {span, chord, primaries:9, secondaries:8, arm:true} uv covers a feather card texture (TX.feather) per feather. */
  G.wing = function (o, side) {
    o = o || {};
    var span = o.span || 0.5, chord = o.chord || 0.18, np = o.primaries || 9, ns = o.secondaries || 8, geos = [];
    function feather(x0, z0, ang, len, wid, lift) {
      var g = new THREE.PlaneGeometry(wid, len, 1, 2); g.rotateX(-Math.PI / 2); g.translate(0, 0, len / 2);
      var p = g.attributes.position; for (var i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.pow(p.getZ(i) / len, 2) * (lift || 0));
      g.rotateY(-ang); g.translate(x0, 0, z0); geos.push(g);
    }
    for (var i = 0; i < ns; i++) { var t = i / ns; feather(span * (0.08 + t * 0.5), chord * 0.15, -0.05 - t * 0.15, chord * (0.95 - t * 0.1), chord * 0.32, -0.01); }
    for (var j = 0; j < np; j++) { var t2 = j / (np - 1); feather(span * (0.6 + t2 * 0.32), chord * 0.1, -0.25 - t2 * 1.0, chord * (1.1 + 0.4 * Math.sin(t2 * 2.6)), chord * 0.28, 0.01); }
    // coverts as a smooth leading arm
    if (o.arm !== false) geos.push(G.taperedLimb([{ p: [0, 0, 0.02], r: chord * 0.18 }, { p: [span * 0.35, 0.005, 0.0], r: chord * 0.2 }, { p: [span * 0.62, 0, 0.02], r: chord * 0.12 }, { p: [span * 0.75, 0, 0.04], r: chord * 0.05 }], { radial: 8, n: [0, 1, 0], density: 6 }));
    var g = G.merge(geos);
    if (side < 0) G.mirrorX(g);
    return g;
  };
  /** Tail fan (turkey display / grouse): feathers radiating up from origin in the XY plane, facing -z. o: {radius, feathers:16, spread (rad), width} */
  G.fan = function (o) {
    o = o || {};
    var R = o.radius || 0.45, n = o.feathers || 16, sp = o.spread || Math.PI * 0.95, wd = o.width || R * 0.22, geos = [];
    for (var i = 0; i < n; i++) {
      var a = -sp / 2 + sp * i / (n - 1), g = new THREE.PlaneGeometry(wd, R, 1, 2);
      g.translate(0, R / 2, 0); var p = g.attributes.position; for (var k = 0; k < p.count; k++) p.setZ(k, p.getZ(k) + Math.pow(p.getY(k) / R, 2) * R * 0.08 + i * 0.0006);
      g.rotateZ(-a); geos.push(g);
    }
    return G.merge(geos);
  };

  /* ---------------- mesh buffer (fast builders for cards / foliage) ---------------- */
  function MeshBuf() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  MeshBuf.prototype.v = function (x, y, z, nx, ny, nz, u, v, r, g, b) { this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); this.col.push(r, g, b); return this.n++; };
  MeshBuf.prototype.tri = function (a, b, c) { this.idx.push(a, b, c); };
  MeshBuf.prototype.geometry = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  };
  MeshBuf.prototype.add = function (geo, colorLin) {
    // append an indexed/non-indexed geometry (position/normal/uv[/color])
    var p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv, c = geo.attributes.color, base = this.n;
    for (var i = 0; i < p.count; i++) this.v(p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, c ? c.getX(i) : (colorLin ? colorLin.r : 1), c ? c.getY(i) : (colorLin ? colorLin.g : 1), c ? c.getZ(i) : (colorLin ? colorLin.b : 1));
    if (geo.index) for (var j = 0; j < geo.index.count; j++) this.idx.push(geo.index.array[j] + base); else for (var k = 0; k < p.count; k++) this.idx.push(base + k);
  };
  G.MeshBuf = MeshBuf;

  /* ---------------- LOD ---------------- */
  var lodList = [];
  /** THREE.LOD from builders: highFn() / lowFn() -> Object3D; dist = switch distance (m) */
  G.makeLOD = function (highFn, lowFn, dist) {
    var lod = new THREE.LOD();
    try { lod.addLevel(highFn(), 0); } catch (e) { console.error('[HG.gfx] makeLOD high', e); }
    if (lowFn) { try { lod.addLevel(lowFn(), dist || 60); } catch (e2) { console.error('[HG.gfx] makeLOD low', e2); } }
    return lod;
  };
  /** Geometry-swap LOD on ONE mesh (works for SkinnedMesh / InstancedMesh): geos [hi, lo, ...], dists [0, d1, ...] */
  G.lodSwap = function (mesh, geos, dists) {
    mesh.userData.lod = { geos: geos, dists: dists, cur: 0 };
    mesh.userData.lodGeos = geos;
    lodList.push(mesh);
    return mesh;
  };
  var _lodP = new THREE.Vector3();
  /** called by core ~5x per second */
  G.updateLODs = function (camPos) {
    for (var i = lodList.length - 1; i >= 0; i--) {
      var m = lodList[i], L = m.userData.lod;
      var o = m, attached = false; while (o) { if (o === HG.scene || o === HG.viewScene) { attached = true; break; } o = o.parent; }
      if (!attached) { if (m.userData.lodDetachedT == null) m.userData.lodDetachedT = 0; if (++m.userData.lodDetachedT > 10) lodList.splice(i, 1); continue; }
      m.userData.lodDetachedT = 0;
      m.getWorldPosition(_lodP);
      var d = _lodP.distanceTo(camPos), lvl = 0;
      for (var k = 1; k < L.dists.length; k++) if (d > L.dists[k] * (L.cur >= k ? 0.92 : 1)) lvl = k;
      if (lvl !== L.cur && L.geos[lvl]) { L.cur = lvl; m.geometry = L.geos[lvl]; }
    }
  };
  G._lodList = lodList;
  /* ---------------- rigs (bones) + skin binding ---------------- */
  var RIG = G.rig = {};
  /** Build a bone hierarchy. spec: {name, p:[x,y,z] MODEL-space joint position, children:[spec...]}
   *  -> {root, bones:{name: Bone}, list:[Bone], index:{name: i}}. Bind pose has no rotations. */
  RIG.build = function (spec) {
    var rig = { bones: {}, list: [], index: {} };
    (function mk(s, parent, pw) {
      var b = new THREE.Bone(); b.name = s.name;
      b.position.set(s.p[0] - pw[0], s.p[1] - pw[1], s.p[2] - pw[2]);
      b.userData.rest = b.position.clone(); b.userData.model = s.p.slice();
      if (parent) parent.add(b); else rig.root = b;
      rig.index[s.name] = rig.list.length; rig.bones[s.name] = b; rig.list.push(b);
      (s.children || []).forEach(function (c) { mk(c, b, s.p); });
    })(spec, null, [0, 0, 0]);
    return rig;
  };
  /** name -> bone index for a rig spec (same order as RIG.build) */
  RIG.indexOf = function (spec) { var m = {}, n = 0; (function w(s) { m[s.name] = n++; (s.children || []).forEach(w); })(spec); return m; };
  /** find a spec node by name */
  RIG.find = function (spec, name) { var r = null; (function w(s) { if (s.name === name) r = s; else (s.children || []).forEach(w); })(spec); return r; };
  var SK = G.skin = {};
  function ensureSkin(g) {
    var n = g.attributes.position.count;
    if (!g.attributes.skinIndex) g.setAttribute('skinIndex', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    if (!g.attributes.skinWeight) { var w = new Float32Array(n * 4); for (var i = 0; i < n; i++) w[i * 4] = 1; g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4)); }
    return g;
  }
  /** every vertex -> one bone */
  SK.rigid = function (g, bi) {
    ensureSkin(g); var si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array;
    for (var i = 0; i < si.length; i += 4) { si[i] = bi; si[i + 1] = si[i + 2] = si[i + 3] = 0; sw[i] = 1; sw[i + 1] = sw[i + 2] = sw[i + 3] = 0; }
    return g;
  };
  /** Chain binding: joints [[x,y,z]...] (n+1 points) define segments owned by bones [b0..bn-1] (indices).
   *  Vertices near a joint blend with the neighbour bone over `blend` metres. */
  SK.chain = function (g, joints, bones, blend) {
    ensureSkin(g); blend = blend || 0.05;
    var p = g.attributes.position, si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, segs = bones.length;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), best = 1e9, bk = 0, bt = 0, bl = 1;
      for (var k = 0; k < segs; k++) {
        var a = joints[k], b = joints[k + 1], abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], L2 = abx * abx + aby * aby + abz * abz || 1e-9;
        var t = ((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        var qx = a[0] + abx * t - x, qy = a[1] + aby * t - y, qz = a[2] + abz * t - z, d2 = qx * qx + qy * qy + qz * qz;
        if (d2 < best - 1e-9) { best = d2; bk = k; bt = t; bl = Math.sqrt(L2); }
      }
      var main = bones[bk], other = main, wo = 0, da = bt * bl, db = (1 - bt) * bl;
      if (bk > 0 && da < blend) { other = bones[bk - 1]; wo = 0.5 * sstep(1 - da / blend); }
      else if (bk < segs - 1 && db < blend) { other = bones[bk + 1]; wo = 0.5 * sstep(1 - db / blend); }
      if (other === main) wo = 0;
      si[i * 4] = main; si[i * 4 + 1] = other; si[i * 4 + 2] = 0; si[i * 4 + 3] = 0;
      sw[i * 4] = 1 - wo; sw[i * 4 + 1] = wo; sw[i * 4 + 2] = 0; sw[i * 4 + 3] = 0;
    }
    return g;
  };
  /** generic: fn(x,y,z, outIdx[4], outW[4]) */
  SK.fn = function (g, fn) {
    ensureSkin(g); var p = g.attributes.position, si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, oi = [0, 0, 0, 0], ow = [1, 0, 0, 0];
    for (var i = 0; i < p.count; i++) { oi[0] = oi[1] = oi[2] = oi[3] = 0; ow[0] = 1; ow[1] = ow[2] = ow[3] = 0; fn(p.getX(i), p.getY(i), p.getZ(i), oi, ow); for (var k = 0; k < 4; k++) { si[i * 4 + k] = oi[k]; sw[i * 4 + k] = ow[k]; } }
    return g;
  };
  /** SkinnedMesh from a geometry + rig (bind pose = rest). Root bone is added under the mesh. */
  RIG.skinnedMesh = function (geo, material, rig) {
    var m = new THREE.SkinnedMesh(geo, material);
    m.add(rig.root);
    m.bind(new THREE.Skeleton(rig.list));
    return m;
  };

  /* ---------------- gaits ---------------- */
  /** leg phase offsets [FL, FR, BL, BR] (fraction of a cycle), duty factor (stance fraction), stride (m per cycle at leg length 0.9 m) */
  var GAITS = G.gaits = {
    walk: { off: [0.25, 0.75, 0.0, 0.5], duty: 0.64, stride: 1.4, lift: 0.75, bob: 0.010, bobN: 2, pitch: 0.012, flex: 0.0, nod: 0.06 },
    trot: { off: [0.0, 0.5, 0.5, 0.0], duty: 0.46, stride: 2.3, lift: 0.95, bob: 0.024, bobN: 2, pitch: 0.012, flex: 0.02, nod: 0.03 },
    gallop: { off: [0.58, 0.68, 0.0, 0.1], duty: 0.34, stride: 4.4, lift: 1.15, bob: 0.055, bobN: 1, pitch: 0.075, flex: 0.13, nod: 0.08 },
    bound: { off: [0.5, 0.55, 0.0, 0.05], duty: 0.28, stride: 5.0, lift: 1.25, bob: 0.12, bobN: 1, pitch: 0.13, flex: 0.22, nod: 0.06 },
    hop: { off: [0.08, 0.14, 0.6, 0.6], duty: 0.4, stride: 1.0, lift: 1.0, bob: 0.11, bobN: 1, pitch: 0.2, flex: 0.18, nod: 0.05, hop: true },
    waddle: { off: [0, 0.5, 0, 0.5], duty: 0.6, stride: 0.5, lift: 0.8, bob: 0.01, bobN: 2, pitch: 0, flex: 0, nod: 0.12, roll: 0.07 },
    fly: { off: [0, 0, 0, 0], duty: 1, stride: 6, lift: 0, bob: 0, bobN: 1, pitch: 0, flex: 0, nod: 0, flap: true }
  };
  var ANIM = G.anim = {};
  var LEGS = ['FL', 'FR', 'BL', 'BR'], _lp = [0, 0, 0], TAU2 = Math.PI * 2;
  function dampV(a, b, l, dt) { return b + (a - b) * Math.exp(-l * dt); }
  /** unit leg cycle: out[0] hip (+1 forward .. -1 back), out[1] swing flex 0..1, out[2] stance load 0..1 */
  function legPose(p, duty, out) {
    if (p < duty) { var s = p / duty; out[0] = 1 - 2 * s; out[1] = 0; out[2] = Math.sin(Math.PI * s); }
    else { var s2 = (p - duty) / (1 - duty), e = s2 * s2 * (3 - 2 * s2); out[0] = -1 + 2 * e; out[1] = Math.sin(Math.PI * Math.min(1, s2 * 1.12)); out[2] = 0; }
    return out;
  }
  G.legPose = legPose;
  function newAnimState() {
    return { phase: Math.random(), w0: 1, w1: 0, w2: 0, n1: 0, n2: 0, h: 0, look: 0, lookT: Math.random() * 3, lookTarget: 0, earT: Math.random() * 3, earK: 0, earSide: 0, earA: 0,
      tail: 0, slope: 0, dead: false, dv: 0, swish: 0, swishT: 2 + Math.random() * 4, chew: 0, blinkT: 0 };
  }
  G.newAnimState = newAnimState;
  function terrainSlope(a, len) {
    if (!HG.terrain || !HG.terrain.ready) return 0;
    var fx = -Math.sin(a.yaw) * len * 0.5, fz = -Math.cos(a.yaw) * len * 0.5;
    var hf = HG.terrain.heightAt(a.pos.x + fx, a.pos.z + fz), hb = HG.terrain.heightAt(a.pos.x - fx, a.pos.z - fz);
    return U.clamp(Math.atan2(hf - hb, len), -0.45, 0.45);
  }
  /** Quadruped animator (a.parts.animate). Drives the named bones from a.speed + a.state:
   *  gait blend (cfg.gaits by cfg.speeds), leg cycles, body bob/pitch/spine flex, head pose (graze/alert/run), look-around,
   *  ear flicks, tail swish + flag, breathing, slope alignment. */
  ANIM.quadruped = function (a, dt) {
    var P = a.parts, B = P.rig.bones, C = P.cfg, S = P.state, t = HG.time + a.id * 1.37;
    var sp = a.speed / Math.max(0.2, a.scale);
    var s1 = C.speeds[0], s2 = C.speeds[1];
    var k1 = U.smooth(s1 - 0.45, s1 + 0.45, sp), k2 = U.smooth(s2 - 0.8, s2 + 0.8, sp);
    var g2 = k2, g1 = k1 * (1 - k2), g0 = 1 - g1 - g2;
    S.w0 = dampV(S.w0, g0, 7, dt); S.w1 = dampV(S.w1, g1, 7, dt); S.w2 = dampV(S.w2, g2, 7, dt);
    var tot = S.w0 + S.w1 + S.w2 || 1, W0 = S.w0 / tot, W1 = S.w1 / tot, W2 = S.w2 / tot;
    var GA0 = GAITS[C.gaits[0]], GA1 = GAITS[C.gaits[1]], GA2 = GAITS[C.gaits[2]];
    var stride = (W0 * GA0.stride + W1 * GA1.stride + W2 * GA2.stride) * C.strideK;
    S.phase = (S.phase + dt * sp / Math.max(0.12, stride)) % 1;
    var move = U.clamp(sp / 0.3, 0, 1), ph = S.phase;
    var FF = C.flexF, FH = C.flexH;
    for (var l = 0; l < 4; l++) {
      var hip = 0, flex = 0, load = 0, front = l < 2;
      for (var gi = 0; gi < 3; gi++) {
        var w = gi === 0 ? W0 : gi === 1 ? W1 : W2; if (w < 0.002) continue;
        var GG = gi === 0 ? GA0 : gi === 1 ? GA1 : GA2;
        legPose((ph + GG.off[l]) % 1, GG.duty, _lp);
        var A = Math.asin(Math.min(0.9, GG.duty * GG.stride * C.strideK / (2 * C.legLen))) * (front ? C.swingF : C.swingH);
        if (GG.hop && !front) { hip += w * (_lp[2] > 0 ? -_lp[2] * A * 1.3 : _lp[0] * A * 0.5); flex += w * (_lp[2] > 0 ? -_lp[2] * 0.9 : _lp[1] * 0.5); }
        else { hip += w * _lp[0] * A; flex += w * _lp[1] * GG.lift; }
        load += w * _lp[2];
      }
      hip *= move; flex *= move; load *= move;
      var id = LEGS[l], F = front ? FF : FH;
      B[id + '_hip'].rotation.x = hip;
      B[id + '_knee'].rotation.x = flex * F[0] + (front ? 0 : load * 0.12);
      B[id + '_hock'].rotation.x = flex * F[1] - (front ? 0 : load * 0.1);
      B[id + '_hoof'].rotation.x = flex * F[2] + load * (front ? 0.18 : 0.12);
    }
    // body motion
    var bob = 0, pitch = 0, flexS = 0, nod = 0, roll = 0;
    for (var g = 0; g < 3; g++) {
      var ww = g === 0 ? W0 : g === 1 ? W1 : W2; if (ww < 0.002) continue;
      var Gd = g === 0 ? GA0 : g === 1 ? GA1 : GA2, a2 = ph * TAU2;
      bob += ww * Gd.bob * Math.cos(a2 * Gd.bobN); pitch += ww * Gd.pitch * Math.sin(a2); flexS += ww * Gd.flex * Math.sin(a2 + 0.6);
      nod += ww * Gd.nod * Math.sin(a2 * 2 + 0.8); if (Gd.roll) roll += ww * Gd.roll * Math.sin(a2);
    }
    var breathe = Math.sin(t * (S.tail > 0.5 ? 4.5 : 1.6)) * (1 - move * 0.5);
    B.pelvis.position.y = B.pelvis.userData.rest.y + bob * move * C.legLen;
    S.slope = dampV(S.slope, terrainSlope(a, C.bodyLen), 5, dt);
    B.root.rotation.x = S.slope + pitch * move;
    B.root.rotation.z = roll * move;
    B.spine.rotation.x = flexS * move * 0.5 + breathe * 0.006;
    B.chest.rotation.x = -flexS * move * 0.6 - breathe * 0.004;
    // head & neck pose by state
    var st = a.state, pose;
    if (st === 'graze') pose = C.poses.graze;
    else if (st === 'alert' || st === 'warn') pose = C.poses.alert;
    else if (st === 'flee' || st === 'charge') pose = sp > s2 ? C.poses.run : C.poses.walk;
    else if (move > 0.3) pose = C.poses.walk;
    else pose = C.poses.idle;
    var hr = st === 'graze' ? 2.2 : 4;
    S.n1 = dampV(S.n1, pose[0], hr, dt); S.n2 = dampV(S.n2, pose[1], hr, dt); S.h = dampV(S.h, pose[2], hr, dt);
    S.lookT -= dt;
    if (st === 'alert' || st === 'warn') S.lookTarget = U.clamp(U.angleDiff(a.yaw, U.yawTo(a.pos.x, a.pos.z, a.threat.x, a.threat.z)), -1.1, 1.1);
    else if (move > 0.5 || st === 'graze') { S.lookTarget = st === 'graze' ? Math.sin(t * 0.3) * 0.25 : 0; }
    else if (S.lookT <= 0) { S.lookT = 1.2 + Math.random() * 4; S.lookTarget = Math.random() < 0.35 ? 0 : (Math.random() - 0.5) * 1.5; }
    S.look = dampV(S.look, S.lookTarget, 3, dt);
    var chew = st === 'graze' ? Math.sin(t * 5.5) * 0.035 + Math.max(0, Math.sin(t * 0.7)) * 0.12 : 0;
    B.neck1.rotation.x = S.n1 + nod * move + breathe * 0.004; B.neck1.rotation.y = S.look * 0.4;
    B.neck2.rotation.x = S.n2 + nod * move * 0.4; B.neck2.rotation.y = S.look * 0.35;
    B.head.rotation.x = S.h - nod * move * 0.7 + chew; B.head.rotation.y = S.look * 0.3; B.head.rotation.z = -S.look * 0.12;
    // ears: flicks + alert forward
    S.earT -= dt;
    if (S.earT < 0) { S.earT = 1 + Math.random() * 5; S.earSide = Math.random() < 0.5 ? 0 : 1; S.earK = 1; }
    S.earK = Math.max(0, S.earK - dt * 4.5);
    S.earA = dampV(S.earA, (st === 'alert' || st === 'warn') ? 1 : (st === 'flee' ? -0.6 : 0), 5, dt);
    var flick = Math.sin(S.earK * Math.PI) * 0.6;
    if (B.earR) { B.earR.rotation.x = -S.earA * C.earFwd; B.earR.rotation.z = (S.earSide === 0 ? flick : 0) - S.earA * 0.1; B.earR.rotation.y = S.earSide === 0 ? -flick * 0.4 : 0; }
    if (B.earL) { B.earL.rotation.x = -S.earA * C.earFwd; B.earL.rotation.z = -(S.earSide === 1 ? flick : 0) + S.earA * 0.1; B.earL.rotation.y = S.earSide === 1 ? flick * 0.4 : 0; }
    // tail: flag when fleeing/alarmed, swish when calm
    var flag = st === 'flee' ? 1 : ((st === 'alert' || st === 'warn') && a.awareness > 0.75 ? 0.55 : 0);
    S.tail = dampV(S.tail, flag * C.tailFlag, 7, dt);
    S.swishT -= dt; if (S.swishT < 0) { S.swishT = 2 + Math.random() * 6; S.swish = 1; }
    S.swish = Math.max(0, S.swish - dt * 1.6);
    if (B.tail1) {
      B.tail1.rotation.x = -S.tail * C.tailLift + Math.sin(t * 7) * 0.05 * S.tail;
      B.tail1.rotation.z = Math.sin(t * 9) * 0.35 * S.swish * (1 - S.tail) + Math.sin(t * 2) * 0.04;
      if (B.tail2) B.tail2.rotation.x = -S.tail * C.tailLift * 0.4;
    }
  };
  /** Natural collapse (no gore): stumble forward, front legs buckle, hind fold, roll onto the side, legs relax. */
  ANIM.collapse = function (a, dt) {
    var P = a.parts, B = P.rig.bones, C = P.cfg, S = P.state, t = a.deadT;
    if (!S.dead) { S.dead = true; S.dv = Math.min(9, a.deathSpeed || 0) * 0.6; S.y0 = a.pos.y; }
    if (S.dv > 0.03) { a.pos.x -= Math.sin(a.yaw) * S.dv * dt; a.pos.z -= Math.cos(a.yaw) * S.dv * dt; S.dv = dampV(S.dv, 0, 2.6, dt); }
    var k1 = U.smooth(0, 0.32, t), k2 = U.smooth(0.15, 0.75, t), k3 = U.smooth(0.45, 1.25, t), rl = U.smooth(0.9, 1.9, t);
    var fold = 1 - rl * 0.85;
    for (var l = 0; l < 4; l++) {
      var id = LEGS[l], front = l < 2, side = (l % 2 === 0) ? 1 : -1, k = front ? k1 : k2;
      B[id + '_hip'].rotation.x = front ? (0.35 * k * fold + 0.35 * rl) : (-0.25 * k * fold - 0.35 * rl);
      B[id + '_hip'].rotation.z = side * a.tipDir * 0.12 * rl;
      B[id + '_knee'].rotation.x = front ? 0.55 * k * fold + 0.1 * rl : -0.9 * k * fold - 0.15 * rl;
      B[id + '_hock'].rotation.x = front ? -1.7 * k * fold - 0.2 * rl : 1.5 * k * fold + 0.25 * rl;
      B[id + '_hoof'].rotation.x = front ? -0.5 * k : -0.4 * k;
    }
    var drop = C.bellyH * 0.82 * Math.max(k1 * 0.45, k2) * (1 - rl * 0.35);
    B.pelvis.position.y = B.pelvis.userData.rest.y - drop;
    B.root.rotation.x = -0.22 * k1 * (1 - k2 * 0.8);
    B.root.rotation.z = 0;
    B.spine.rotation.x = 0; B.chest.rotation.x = 0.05 * k2;
    S.n1 = dampV(S.n1, -0.55 * k1 - 0.15 * rl, 4, dt); S.n2 = dampV(S.n2, -0.25, 4, dt); S.h = dampV(S.h, 0.3 * rl, 3, dt);
    B.neck1.rotation.x = S.n1; B.neck1.rotation.y = 0.2 * rl * -a.tipDir; B.neck2.rotation.x = S.n2; B.head.rotation.x = S.h; B.head.rotation.y = 0;
    if (B.earR) { B.earR.rotation.set(0.3 * rl, 0, 0.25 * rl); } if (B.earL) { B.earL.rotation.set(0.3 * rl, 0, -0.25 * rl); }
    if (B.tail1) { B.tail1.rotation.x = dampV(B.tail1.rotation.x, 0, 3, dt); B.tail1.rotation.z = 0; }
    var phi = 1.38 * k3, bodyH = C.bodyY - drop;
    a.root.rotation.z = a.tipDir * phi;
    var ground = HG.terrain && HG.terrain.ready ? HG.terrain.heightAt(a.pos.x, a.pos.z) : 0;
    a.pos.y = ground + (C.halfW * a.scale - bodyH * a.scale * Math.cos(phi)) * Math.sin(phi);
    return true;
  };

  /* ---------------- quadruped assembler ---------------- */
  var tplCache = {};
  function mirrorPts(L) { return L.map(function (j) { var c = {}; for (var k in j) c[k] = j[k]; c.p = [-j.p[0], j.p[1], j.p[2]]; return c; }); }
  /** Build (and cache) a skinned quadruped template from a spec. See API.md §6b for the full spec format.
   *  spec: {key, spine:[{p,w,hUp,hDown,sq,bone}], head:[{p,w,hUp,hDown,sq}], legs:{FR:[6 joints], BR:[6 joints]},
   *         hoof:{w,l,h}|paw:{size}|feet:false, ears:{p,len,width,cup,tip,rot}, tail:{p,len,w,h,droop,bushy},
   *         eyes:{p,r,color}, nose:{p,r}, coat(c,x,y,z,nx,ny,nz,part,u,v), fur:{texture opts}, roughness,
   *         attach(spec)->[{bone, geometry (model space), material, lowGeometry}], gaits:['walk','trot','gallop'], speeds:[2,4.5],
   *         poses:{idle,walk,run,alert,graze:[neck1,neck2,head]}, earFwd, tailLift, tailFlag, flexF, flexH, swingF, swingH, lodDist, density, ao} */
  G.quadruped = function (spec) {
    var key = spec.key || ('q' + Math.random());
    if (tplCache[key]) return tplCache[key];
    var legs = { FR: spec.legs.FR, BR: spec.legs.BR, FL: spec.legs.FL || mirrorPts(spec.legs.FR), BL: spec.legs.BL || mirrorPts(spec.legs.BR) };
    // ---- rig spec ----
    var marks = {};
    spec.spine.forEach(function (s) { if (s.bone) marks[s.bone] = s.p; });
    var last = spec.spine[spec.spine.length - 1].p;
    if (!marks.head) marks.head = last;
    ['pelvis', 'spine', 'chest', 'neck1', 'neck2'].forEach(function (n, i) { if (!marks[n]) console.warn('[HG.gfx] quadruped ' + key + ' missing spine bone ' + n); });
    function mk(name, p, kids) { return { name: name, p: p, children: kids || [] }; }
    function legChain(id) { var L = legs[id]; return mk(id + '_hip', L[1].p, [mk(id + '_knee', L[2].p, [mk(id + '_hock', L[3].p, [mk(id + '_hoof', L[4].p)])])]); }
    var ears = spec.ears, earP = ears ? ears.p : null;
    var headKids = []; if (ears) { headKids.push(mk('earR', earP)); headKids.push(mk('earL', [-earP[0], earP[1], earP[2]])); }
    var head = mk('head', marks.head, headKids);
    var tl = spec.tail, tailKids = [];
    if (tl) { var tdr = tl.droop == null ? 0.9 : tl.droop, tL = tl.len || 0.2; tailKids.push(mk('tail1', tl.p, [mk('tail2', [tl.p[0], tl.p[1] - Math.sin(tdr * 0.5) * tL * 0.45, tl.p[2] + Math.cos(tdr * 0.5) * tL * 0.45])])); }
    var rigSpec = mk('root', [0, 0, 0], [mk('pelvis', marks.pelvis, [mk('spine', marks.spine, [mk('chest', marks.chest, [mk('neck1', marks.neck1, [mk('neck2', marks.neck2, [head])]), legChain('FL'), legChain('FR')])]), legChain('BL'), legChain('BR')].concat(tailKids))]);
    var BI = RIG.indexOf(rigSpec);
    // ---- materials ----
    var furTex = spec.texture || TX.furDetail(spec.fur || {});
    var hi = !G.isLow();
    var matOpts = { map: furTex, vertexColors: true, skinning: true, roughness: spec.roughness == null ? 0.88 : spec.roughness, key: 'q:' + key };
    if (hi && spec.normal !== false) { matOpts.normalMap = TX.normalOf(furTex, spec.normalStrength || 2.2); matOpts.normalScale = spec.normalScale || 0.6; }
    // ---- geometry at two resolutions ----
    function build(lo) {
      var R = function (n) { return Math.max(5, Math.round(n * (lo ? 0.42 : 1))); }, Sx = lo ? 2 : 4, parts = [], dens = spec.density || 2.4;
      function paint(g, part) { if (spec.coat) G.paint(g, function (c, x, y, z, nx, ny, nz, u, v) { return spec.coat(c, x, y, z, nx, ny, nz, part, u, v); }, { gain: spec.coatGain || 1.12 }); else ensureColor(g); return g; }
      // body + neck
      var body = G.organicBody(spec.spine, { radial: R(spec.radial || 28), steps: Sx, smooth: 2, density: dens });
      paint(body, 'body');
      var jp = [spec.spine[0].p], jb = [];
      var order = ['pelvis', 'spine', 'chest', 'neck1', 'neck2', 'head'];
      order.forEach(function (n) { jp.push(marks[n]); });
      var hp = marks.head, n2 = marks.neck2; jp.push([hp[0] + (hp[0] - n2[0]) * 0.4, hp[1] + (hp[1] - n2[1]) * 0.4, hp[2] + (hp[2] - n2[2]) * 0.4]);
      jb = [BI.pelvis, BI.pelvis, BI.spine, BI.chest, BI.neck1, BI.neck2, BI.head];
      SK.chain(body, jp, jb, spec.blend || 0.12);
      parts.push(body);
      // head
      if (spec.head) { var hd = G.organicBody(spec.head, { radial: R(22), steps: Sx, smooth: 1, density: dens * 1.4, capBulge: 0.5 }); paint(hd, 'head'); SK.rigid(hd, BI.head); parts.push(hd); }
      // legs
      LEGS.forEach(function (id) {
        var L = legs[id], front = id.charAt(0) === 'F';
        var lg = G.taperedLimb(L, { radial: R(12), steps: Sx, density: dens * 1.3, capStart: false, n: [0, 0, -1], capBulge: 0.3 });
        paint(lg, front ? 'legF' : 'legH');
        SK.chain(lg, L.map(function (j) { return j.p; }), [front ? BI.chest : BI.pelvis, BI[id + '_hip'], BI[id + '_knee'], BI[id + '_hock'], BI[id + '_hoof']], spec.legBlend || 0.05);
        parts.push(lg);
        var gp = L[L.length - 1].p;
        if (spec.hoof) { var hf = G.hoof(spec.hoof); G.xform(hf, [gp[0], 0, gp[2]], [0, 0, 0]); paint(hf, 'hoof'); SK.rigid(hf, BI[id + '_hoof']); parts.push(hf); }
        else if (spec.paw) { var pw = G.paw(spec.paw); G.xform(pw, [gp[0], 0, gp[2]]); paint(pw, 'paw'); SK.rigid(pw, BI[id + '_hoof']); parts.push(pw); }
      });
      // ears
      if (ears) [1, -1].forEach(function (sd) {
        var e = G.ear(ears); var r = ears.rot || [0.25, 0, -0.8];
        G.xform(e, [0, 0, 0], [r[0], sd * (r[1] || 0), sd * r[2]]); G.xform(e, [sd * earP[0], earP[1], earP[2]]);
        paint(e, 'ear'); SK.rigid(e, sd > 0 ? BI.earR : BI.earL); parts.push(e);
      });
      // tail
      if (tl) {
        var tg = G.tail(tl); G.xform(tg, tl.p); paint(tg, 'tail');
        var tdr2 = tl.droop == null ? 0.9 : tl.droop, tL2 = tl.len || 0.2, tm = [tl.p[0], tl.p[1] - Math.sin(tdr2 * 0.5) * tL2 * 0.45, tl.p[2] + Math.cos(tdr2 * 0.5) * tL2 * 0.45];
        SK.chain(tg, [tl.p, tm, [tl.p[0], tl.p[1] - Math.sin(tdr2) * tL2, tl.p[2] + Math.cos(tdr2) * tL2]], [BI.tail1, BI.tail2], 0.04);
        parts.push(tg);
      }
      var g = G.merge(parts);
      // ambient occlusion from body sections + limb joints + ground
      var occ = [];
      spec.spine.forEach(function (s) { occ.push([s.p[0], s.p[1], s.p[2], Math.min(s.w / 2, ((s.hUp || 0.1) + (s.hDown || 0.1)) / 2) * 0.95]); });
      LEGS.forEach(function (id) { legs[id].forEach(function (j, i) { if (i > 0) occ.push([j.p[0], j.p[1], j.p[2], (j.rx || j.r) * 0.9]); }); });
      G.vertexAO(g, { occluders: occ, ground: 0, groundStrength: 0.4, groundFalloff: 0.25, strength: spec.ao == null ? 0.9 : spec.ao, under: 0.3, min: 0.4 });
      g.computeBoundingSphere(); g.boundingSphere.radius *= 1.25;
      g.userData.shared = true;
      return g;
    }
    var geoHi = build(false), geoLo = build(true);
    // attachments (eyes, nose, antlers ...) rigid on bones; geometry given in model space
    var attach = [];
    function boneLocal(geo, bone) { var bp = RIG.find(rigSpec, bone).p; geo.translate(-bp[0], -bp[1], -bp[2]); geo.userData.shared = true; return geo; }
    var gloss = [];
    if (spec.eyes) [1, -1].forEach(function (sd) {
      var e = new THREE.SphereGeometry(spec.eyes.r || 0.015, 14, 10); e.scale(0.8, 0.85, 1);
      if (spec.eyes.rot) G.xform(e, null, [0, sd * spec.eyes.rot, 0]);
      G.xform(e, [sd * spec.eyes.p[0], spec.eyes.p[1], spec.eyes.p[2]]); G.tint(e, spec.eyes.color || '#140d08'); gloss.push(e);
    });
    if (spec.nose) { var nz = new THREE.SphereGeometry(spec.nose.r || 0.02, 14, 10); nz.scale(spec.nose.sx || 1.25, spec.nose.sy || 0.8, spec.nose.sz || 0.7); G.xform(nz, spec.nose.p); G.tint(nz, spec.nose.color || '#141010'); gloss.push(nz); }
    if (gloss.length) attach.push({ bone: 'head', geos: [boneLocal(G.merge(gloss), 'head')], material: G.mat({ vertexColors: true, roughness: 0.18, key: 'q:gloss' }), shadow: false, hideFar: 45 });
    if (spec.attach) (spec.attach(spec) || []).forEach(function (at) {
      var gs = [boneLocal(at.geometry, at.bone)]; if (at.lowGeometry) gs.push(boneLocal(at.lowGeometry, at.bone));
      attach.push({ bone: at.bone, geos: gs, material: at.material, shadow: at.shadow !== false, variant: at.variant });
    });
    var legLen = (legs.FR[1].p[1] + legs.BR[1].p[1]) / 2;
    var chestS = spec.spine.reduce(function (m, s) { return s.w > m.w ? s : m; }, spec.spine[0]);
    var cfg = {
      gaits: spec.gaits || ['walk', 'trot', 'gallop'], speeds: spec.speeds || [2.0, 4.6], strideK: spec.strideK || legLen / 0.9 * (spec.strideMul || 1), legLen: legLen,
      bodyLen: Math.abs(spec.spine[0].p[2] - marks.chest[2]) + 0.3, bodyY: marks.pelvis[1], halfW: chestS.w / 2, bellyH: chestS.p[1] - (chestS.hDown || 0.1),
      poses: spec.poses || { idle: [0, 0, 0], walk: [-0.15, 0, 0.05], run: [-0.35, 0.05, 0.2], alert: [0.2, 0.05, -0.1], graze: [-1.1, -0.3, 0.55] },
      earFwd: spec.earFwd == null ? 0.35 : spec.earFwd, tailLift: spec.tailLift == null ? 1.8 : spec.tailLift, tailFlag: spec.tailFlag == null ? 1 : spec.tailFlag,
      flexF: spec.flexF || [0.45, -1.5, -0.9], flexH: spec.flexH || [-0.6, 1.25, -0.8], swingF: spec.swingF || 0.85, swingH: spec.swingH || 1
    };
    var tpl = { key: key, rigSpec: rigSpec, boneIndex: BI, geos: [geoHi, geoLo], matOpts: matOpts, attach: attach, cfg: cfg, lodDist: spec.lodDist || 42, spec: spec };
    tplCache[key] = tpl;
    return tpl;
  };
  G.templates = tplCache;
  /** Instance a template -> parts for buildMesh: {root, mesh, rig, legs, head, tail, cfg, state, animate, die}.
   *  opts: {tint: '#ffffff' (coat multiplier), variant (attachment filter), noAttach:[bone names]} */
  G.spawnQuadruped = function (tpl, opts) {
    opts = opts || {};
    var root = new THREE.Group();
    var rig = RIG.build(tpl.rigSpec);
    var mo = {}; for (var k in tpl.matOpts) mo[k] = tpl.matOpts[k];
    if (opts.tint) { mo.color = opts.tint; mo.key = tpl.matOpts.key + ':' + opts.tint; }
    var mesh = RIG.skinnedMesh(tpl.geos[0], G.mat(mo), rig);
    mesh.name = tpl.key;
    root.add(mesh);
    var lodD = tpl.lodDist * (G.isLow() ? 0.7 : 1);
    G.lodSwap(mesh, tpl.geos, [0, lodD]);
    var extras = [];
    tpl.attach.forEach(function (at) {
      if (at.variant != null && opts.variant != null && at.variant !== opts.variant) return;
      if (at.variant != null && opts.variant == null) return;
      var m = new THREE.Mesh(at.geos[0], at.material); m.castShadow = at.shadow;
      rig.bones[at.bone].add(m); extras.push(m);
      if (at.geos[1]) G.lodSwap(m, at.geos, [0, lodD]);
      if (at.hideFar) { m.userData.hideFar = at.hideFar; }
    });
    var B = rig.bones;
    return {
      root: root, mesh: mesh, rig: rig, extras: extras, cfg: tpl.cfg, state: newAnimState(), template: tpl,
      legs: [B.FL_hip, B.FR_hip, B.BL_hip, B.BR_hip], head: B.head, tail: B.tail1 || null, neck: B.neck1,
      animate: ANIM.quadruped, die: ANIM.collapse
    };
  };
  /* ---------------- terrain: palette-driven layered material ---------------- */
  var PALETTES = G.terrainPalettes = {
    meadow: { grass: ['#57782f', '#6a8a36', '#47662a', '#7f9440'], dirt: ['#6b5a40', '#55452f', '#80694a'], rock: ['#86847c', '#66645e', '#a19e94'], extra: ['#bcaa7e', '#a69467', '#cfc095'], extraKind: 'sand' },
    snow: { grass: ['#e9eef2', '#d5dde4', '#f7f9fb', '#c9d3dc'], grassKind: 'snow', dirt: ['#7c7468', '#5d564c', '#968d7f'], rock: ['#6f727a', '#54575e', '#8c9099'], extra: ['#b9c6cf', '#a3b2bd', '#d0dbe2'], extraKind: 'snow' },
    sand: { grass: ['#cdb486', '#bba06e', '#dcc597', '#b3976a'], grassKind: 'sand', dirt: ['#a8865a', '#8e6f48', '#bf9c6c'], rock: ['#a2785a', '#86603f', '#b98e6d'], extra: ['#d8c49a', '#c7b285', '#e6d6af'], extraKind: 'sand' },
    mud: { grass: ['#4f6a2c', '#5f7a34', '#3f5826', '#6f8238'], dirt: ['#4a3b29', '#3a2e20', '#5c4a34'], rock: ['#6f6c62', '#57544c', '#86837a'], extra: ['#3d3326', '#2f271c', '#4d4131'], extraKind: 'mud' },
    autumn: { grass: ['#8a8a3c', '#a08a3e', '#6f7a34', '#b39a4a'], dirt: ['#6b5236', '#57432c', '#7f6544'], rock: ['#86847c', '#66645e', '#a19e94'], extra: ['#bcaa7e', '#a69467', '#cfc095'], extraKind: 'sand' }
  };
  function normPalette(p) {
    p = p || {};
    if (typeof p === 'string') p = { base: p };
    var base = PALETTES[p.base || 'meadow'] || PALETTES.meadow, o = {};
    o.grass = p.grass || base.grass; o.dirt = p.dirt || base.dirt; o.rock = p.rock || base.rock; o.extra = p.extra || base.extra;
    o.grassKind = p.grassKind || base.grassKind || 'grass'; o.extraKind = p.extraKind || base.extraKind || 'sand';
    o.scale = p.scale || [3.2, 3.6, 5.5, 3.0];
    var r = p.rules || {};
    o.rules = { slopeDirt: r.slopeDirt || [0.3, 0.6], slopeRock: r.slopeRock || [0.62, 1.05], shore: r.shore == null ? 1.5 : r.shore, extraMode: r.extraMode || 'shore',
      extraLevel: r.extraLevel == null ? 20 : r.extraLevel, rockLevel: r.rockLevel == null ? null : r.rockLevel, dirtNoise: r.dirtNoise == null ? 0.35 : r.dirtNoise, grassGrow: r.grassGrow == null ? 1 : r.grassGrow };
    o.tint = p.tint || ['#ffffff', '#f2f0d8'];
    o.weights = p.weights || null;   // optional fn(x, z, h, slope, wl, out4) -> custom weights
    o.mode = p.mode || 'albedo';     // 'tint': vertex colour is the albedo, layers give detail only
    return o;
  }
  G.normPalette = normPalette;
  function drawLayer(kind, cols, size, seed) {
    var c = mkCanvas(size), x = c.getContext('2d'), rng = U.rng(seed), i, px, py;
    x.fillStyle = cols[0]; x.fillRect(0, 0, size, size);
    noiseOverlay(x, size, size, 4, 5, 0.55, seed + 1, 'soft-light');
    noiseOverlay(x, size, size, 16, 3, 0.35, seed + 2, 'soft-light');
    var k = size / 512;
    if (kind === 'grass') {
      x.lineCap = 'round';
      for (var b = 0; b < 5; b++) {
        x.strokeStyle = rgba(cols[(b % (cols.length - 1)) + 1], 0.45 + b * 0.08); x.lineWidth = (1.1 + b * 0.25) * k; x.beginPath();
        for (i = 0; i < 2600 * k * k; i++) { px = rng() * size; py = rng() * size; var a = rng() * 6.283, L = (3 + rng() * 9) * k; wrapDraw(size, size, px, py, L + 2, function (X, Y) { x.moveTo(X, Y); x.lineTo(X + Math.cos(a) * L, Y + Math.sin(a) * L); }); }
        x.stroke();
      }
      for (i = 0; i < 220 * k * k; i++) { px = rng() * size; py = rng() * size; x.fillStyle = rgba(rng() < 0.5 ? '#2c3f1c' : '#a9a35c', 0.35); x.beginPath(); x.arc(px, py, (1 + rng() * 2.2) * k, 0, 6.283); x.fill(); }
    } else if (kind === 'dirt' || kind === 'mud') {
      for (i = 0; i < 900 * k * k; i++) { px = rng() * size; py = rng() * size; var r = (1 + rng() * 3.5) * k; x.fillStyle = rgba(cols[1 + (i % 2)], 0.55); x.beginPath(); x.ellipse(px, py, r, r * (0.6 + rng() * 0.5), rng() * 3, 0, 6.283); x.fill(); x.fillStyle = 'rgba(255,255,240,.14)'; x.beginPath(); x.arc(px - r * 0.3, py - r * 0.3, r * 0.4, 0, 6.283); x.fill(); }
      x.lineCap = 'round';
      for (i = 0; i < 420 * k * k; i++) { px = rng() * size; py = rng() * size; var a2 = rng() * 6.283, L2 = (4 + rng() * 12) * k; x.strokeStyle = rgba(kind === 'mud' ? '#2a2016' : (rng() < 0.5 ? '#3b2a1a' : '#8c6a3e'), 0.5); x.lineWidth = (0.8 + rng()) * k; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a2) * L2, py + Math.sin(a2) * L2); x.stroke(); }
      if (kind === 'mud') for (i = 0; i < 18; i++) { px = rng() * size; py = rng() * size; x.fillStyle = 'rgba(160,170,165,.18)'; x.beginPath(); x.ellipse(px, py, (10 + rng() * 30) * k, (5 + rng() * 12) * k, rng() * 3, 0, 6.283); x.fill(); }
      else for (i = 0; i < 160 * k * k; i++) { px = rng() * size; py = rng() * size; x.fillStyle = rgba(['#8a5a2a', '#a5743a', '#6b4a28'][i % 3], 0.5); x.beginPath(); x.ellipse(px, py, (2 + rng() * 3) * k, (1.2 + rng() * 1.5) * k, rng() * 3, 0, 6.283); x.fill(); }
    } else if (kind === 'rock') {
      x.lineCap = 'round'; x.lineJoin = 'round';
      for (i = 0; i < 40; i++) { px = rng() * size; py = rng() * size; x.strokeStyle = rgba('#2e2c28', 0.5 + rng() * 0.3); x.lineWidth = (1 + rng() * 2) * k; x.beginPath(); x.moveTo(px, py); for (var s = 0; s < 6; s++) { px += (rng() - 0.5) * 50 * k; py += (rng() - 0.5) * 50 * k; x.lineTo(px, py); } x.stroke(); }
      for (i = 0; i < 260 * k * k; i++) { px = rng() * size; py = rng() * size; x.fillStyle = rgba(rng() < 0.7 ? '#b8bba2' : '#c99a4a', 0.35); x.beginPath(); x.arc(px, py, (1.5 + rng() * 5) * k, 0, 6.283); x.fill(); }
    } else if (kind === 'sand') {
      for (i = 0; i < 6000 * k * k; i++) { x.fillStyle = rng() < 0.5 ? 'rgba(255,250,235,.25)' : 'rgba(80,60,30,.18)'; x.fillRect(rng() * size, rng() * size, k, k); }
      for (i = 0; i < 120 * k * k; i++) { px = rng() * size; py = rng() * size; var r3 = (1.5 + rng() * 3) * k; x.fillStyle = rgba(cols[1 + (i % 2)], 0.7); x.beginPath(); x.ellipse(px, py, r3, r3 * 0.7, rng() * 3, 0, 6.283); x.fill(); }
    } else if (kind === 'snow') {
      for (i = 0; i < 2500 * k * k; i++) { x.fillStyle = rng() < 0.6 ? 'rgba(255,255,255,.5)' : 'rgba(150,170,195,.18)'; x.fillRect(rng() * size, rng() * size, k * (1 + rng()), k * (1 + rng())); }
    }
    return c;
  }
  /** terrain layer: RGB albedo (sRGB) + A = height (for height blending) */
  function layerTex(kind, cols, seed) {
    var size = G.isLow() ? 256 : 512;
    return cached('layer:' + kind + cols.join(',') + size, function () {
      var c = drawLayer(kind, cols, size, seed), d = c.getContext('2d').getImageData(0, 0, size, size).data, out = new Uint8Array(d.length);
      for (var i = 0; i < d.length; i += 4) {
        var lum = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
        out[i] = d[i]; out[i + 1] = d[i + 1]; out[i + 2] = d[i + 2]; out[i + 3] = Math.max(0, Math.min(255, (lum * 1.6 - 0.15) * 255));
      }
      var t = new THREE.DataTexture(out, size, size, THREE.RGBAFormat);
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.flipY = false;
      return finishTex(t, { srgb: false });
    });
  }
  var TERRAIN_FRAG = [
    'vec2 wuv = vWP.xz;',
    'float mac = texture2D(tM, wuv * 0.0041).r;',
    'float mac2 = texture2D(tM, wuv * 0.0173 + vec2(0.31, 0.77)).r;',
    'vec4 cg = texture2D(tG, wuv * uScale.x);',
    'vec4 cd = texture2D(tD, wuv * uScale.y);',
    'vec4 ce = texture2D(tE, wuv * uScale.w);',
    '#ifdef HG_HIGH',
    ' cg = mix(cg, texture2D(tG, wuv * uScale.x * 0.23 + vec2(0.5, 0.21)), smoothstep(0.25, 0.75, mac2) * 0.65);',
    ' cd = mix(cd, texture2D(tD, wuv * uScale.y * 0.27 + vec2(0.13, 0.6)), smoothstep(0.3, 0.7, mac) * 0.55);',
    ' float steep = smoothstep(0.55, 0.9, 1.0 - abs(normalize(vWN).y));',
    ' vec4 cr = mix(texture2D(tR, wuv * uScale.z), texture2D(tR, vec2(vWP.x * 0.7 + vWP.z * 0.7, vWP.y) * uScale.z), steep);',
    '#else',
    ' vec4 cr = texture2D(tR, wuv * uScale.z);',
    '#endif',
    'vec4 w = vTW * (0.3 + vec4(cg.a, cd.a, cr.a, ce.a) * 1.4);',
    'float wm = max(max(w.x, w.y), max(w.z, w.w));',
    'w = max(w - wm * 0.5, 0.0); w /= max(w.x + w.y + w.z + w.w, 1e-4);',
    'vec3 alb = cg.rgb * w.x + cd.rgb * w.y + cr.rgb * w.z + ce.rgb * w.w;',
    'alb *= 0.8 + 0.38 * mac;',
    'diffuseColor.rgb *= sRGBToLinear(vec4(alb, 1.0)).rgb;'
  ].join('\n');
  /** HG.gfx.terrainMaterial(palette) -> material for terrain meshes (vertex attribute `tw` = layer weights, colour = macro tint).
   *  palette: 'meadow'|'snow'|'sand'|'mud'|'autumn' or {base, grass:[sRGB...], dirt, rock, extra, grassKind, extraKind:'sand'|'snow'|'mud'|'grass',
   *           scale:[m per tile x4], rules:{slopeDirt:[a,b], slopeRock:[a,b], shore, extraMode:'shore'|'high'|'low'|'noise'|'none', extraLevel, rockLevel, dirtNoise, grassGrow},
   *           tint:[base, alt] (macro variation), weights: fn(x,z,h,slope,waterLevel,out4), mode:'albedo'|'tint'} */
  G.terrainMaterial = function (palette) {
    var pal = normPalette(palette), low = G.isLow();
    var key = 'terrainMat:' + JSON.stringify([pal.grass, pal.dirt, pal.rock, pal.extra, pal.grassKind, pal.extraKind, pal.scale, pal.mode]) + low;
    var m = cached(key, function () {
      var t = [layerTex(pal.grassKind, pal.grass, 11), layerTex('dirt', pal.dirt, 12), layerTex('rock', pal.rock, 13), layerTex(pal.extraKind, pal.extra, 14)];
      var macro = TX.noise({ size: 256, period: 4, octaves: 6, seed: 17 });
      var mm = low ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, envMapIntensity: 0.8 });
      var uni = { tG: { value: t[0] }, tD: { value: t[1] }, tR: { value: t[2] }, tE: { value: t[3] }, tM: { value: macro }, uScale: { value: new THREE.Vector4(1 / pal.scale[0], 1 / pal.scale[1], 1 / pal.scale[2], 1 / pal.scale[3]) } };
      mm.userData.uniforms = uni; mm.userData.shared = true;
      mm.onBeforeCompile = function (sh) {
        for (var k in uni) sh.uniforms[k] = uni[k];
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 tw; varying vec4 vTW; varying vec3 vWP; varying vec3 vWN;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTW = tw; vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normal;');
        sh.fragmentShader = (low ? '' : '#define HG_HIGH\n') + sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tG; uniform sampler2D tD; uniform sampler2D tR; uniform sampler2D tE; uniform sampler2D tM; uniform vec4 uScale; varying vec4 vTW; varying vec3 vWP; varying vec3 vWN;')
          .replace('#include <map_fragment>', TERRAIN_FRAG);
        mm.userData.shader = sh;
      };
      mm.customProgramCacheKey = function () { return 'hgterrain' + (low ? 'L' : 'H'); };
      return mm;
    });
    m.userData.palette = pal;
    return m;
  };
  /** layer weights for one terrain vertex -> out[4] (grass, dirt, rock, extra) */
  G.terrainWeights = function (pal, x, z, h, slope, wl, out) {
    if (pal.weights) { pal.weights(x, z, h, slope, wl, out); return out; }
    var R = pal.rules, n1 = fbm(x * 0.006 + 0.37, z * 0.006 + 0.11, 4, 4, 5), n2 = fbm(x * 0.013 + 0.6, z * 0.013 + 0.2, 4, 3, 8);
    var rock = U.smooth(R.slopeRock[0], R.slopeRock[1], slope + (n2 - 0.5) * 0.15);
    if (R.rockLevel != null) rock = Math.max(rock, U.smooth(R.rockLevel, R.rockLevel + 8, h + (n2 - 0.5) * 6));
    var dirt = U.smooth(R.slopeDirt[0], R.slopeDirt[1], slope + (n1 - 0.5) * 0.2) * (1 - rock);
    dirt = Math.max(dirt, U.smooth(0.6, 0.78, n1) * R.dirtNoise);
    var extra = 0;
    if (R.extraMode === 'shore') extra = wl > -1e8 ? U.smooth(wl + R.shore + (n2 - 0.5), wl + R.shore * 0.25, h) : 0;
    else if (R.extraMode === 'high') extra = U.smooth(R.extraLevel, R.extraLevel + 6, h + (n1 - 0.5) * 5) * (1 - rock * 0.6);
    else if (R.extraMode === 'low') extra = U.smooth(R.extraLevel + 2, R.extraLevel - 1, h + (n1 - 0.5) * 2);
    else if (R.extraMode === 'noise') extra = U.smooth(0.55, 0.72, n2);
    dirt *= 1 - extra; rock *= 1 - extra * 0.5;
    var grass = Math.max(0, 1 - rock - dirt - extra) * R.grassGrow;
    var s = grass + dirt + rock + extra || 1;
    out[0] = grass / s; out[1] = dirt / s; out[2] = rock / s; out[3] = extra / s;
    return out;
  };
  G.paletteFromMap = function (map) {
    if (map.terrain) return map.terrain;
    var gc = map.groundColors || {}, p = { base: 'meadow' };
    if (gc.base) p.grass = [gc.base, gc.alt || shade(gc.base, 1.15), shade(gc.base, 0.82), mixHex(gc.base, '#a39a50', 0.35)];
    if (gc.slope) p.dirt = [gc.slope, shade(gc.slope, 0.8), shade(gc.slope, 1.18)];
    if (gc.high) p.rock = [gc.high, shade(gc.high, 0.78), shade(gc.high, 1.18)];
    if (gc.low) p.extra = [gc.low, shade(gc.low, 0.88), shade(gc.low, 1.1)];
    p.rules = { rockLevel: gc.highLevel == null ? null : gc.highLevel };
    if (gc.base) p.tint = ['#ffffff', mixHex('#ffffff', gc.alt ? '#f4f0c8' : '#ffffff', 1)];
    if (map.groundColor) p.mode = 'tint';
    return p;
  };

  /* ---------------- water ---------------- */
  function waterNormals() {
    var size = G.isLow() ? 128 : 256;
    return cached('waterN' + size, function () {
      var c = mkCanvas(size), x = c.getContext('2d'), img = x.createImageData(size, size), d = img.data;
      for (var j = 0; j < size; j++) for (var i = 0; i < size; i++) {
        var u = i / size, v = j / size, h = fbm(u, v, 6, 4, 3) * 0.7 + fbm(u * 1.0 + 0.3, v, 12, 3, 9) * 0.3;
        var q = (j * size + i) * 4; d[q] = d[q + 1] = d[q + 2] = h * 255; d[q + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      return finishTex(new THREE.CanvasTexture(G.normalFromCanvas(c, 5)), { srgb: false });
    });
  }
  /** HG.gfx.waterMaterial(opts) -> ShaderMaterial (fresnel sky reflection, ripples, sun glint, depth tint, shore fade + foam).
   *  opts: {shallow:'#5f9a8c', deep:'#1d4f63', opacity:0.86, ripple:1, speed:1, foam:0.35}. Needs a `depth` vertex attribute (metres below surface). */
  G.waterMaterial = function (o) {
    o = o || {};
    var m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        time: { value: 0 }, skyTop: { value: new THREE.Color(0x4f8fd0) }, skyHorizon: { value: new THREE.Color(0xcfe0dc) }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(0xffffff) }, sunVis: { value: 1 }, daylight: { value: 1 }, opacity: { value: o.opacity == null ? 0.86 : o.opacity },
        shallow: { value: new THREE.Color(o.shallow || '#5c8f84') }, deep: { value: new THREE.Color(o.deep || '#1c4a5c') }, ripple: { value: o.ripple == null ? 1 : o.ripple },
        foam: { value: o.foam == null ? 0.35 : o.foam }, tNormal: { value: null }
      }]),
      vertexShader: [
        'attribute float depth; varying vec3 vWP; varying float vDepth;',
        '#include <fog_pars_vertex>',
        'void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vDepth = depth; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;',
        '#include <fog_vertex>',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float time; uniform vec3 skyTop; uniform vec3 skyHorizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunVis; uniform float daylight;',
        'uniform float opacity; uniform vec3 shallow; uniform vec3 deep; uniform float ripple; uniform float foam; uniform sampler2D tNormal;',
        'varying vec3 vWP; varying float vDepth;',
        '#include <common>',
        '#include <fog_pars_fragment>',
        'void main(){',
        ' vec2 uv = vWP.xz;',
        ' vec3 n1 = texture2D(tNormal, uv * 0.061 + time * vec2(0.011, 0.007)).xyz * 2.0 - 1.0;',
        ' vec3 n2 = texture2D(tNormal, uv * 0.143 + time * vec2(-0.009, 0.013)).xyz * 2.0 - 1.0;',
        ' vec3 n3 = texture2D(tNormal, uv * 0.019 - time * vec2(0.004, 0.0025)).xyz * 2.0 - 1.0;',
        ' vec3 V = cameraPosition - vWP; float dist = length(V); V /= dist;',
        ' float rk = ripple * (1.0 - smoothstep(30.0, 200.0, dist) * 0.75);',
        ' vec3 N = normalize(vec3((n1.x + n2.x * 0.6 + n3.x * 0.9) * 0.22 * rk, 1.0, (n1.y + n2.y * 0.6 + n3.y * 0.9) * 0.22 * rk));',
        ' float NV = max(dot(N, V), 0.0);',
        ' float fres = 0.025 + 0.975 * pow(1.0 - NV, 5.0);',
        ' vec3 R = reflect(-V, N); R.y = abs(R.y);',
        ' vec3 sky = mix(skyHorizon, skyTop, pow(R.y, 0.55));',
        ' float d = max(vDepth, 0.0);',
        ' vec3 body = mix(shallow, deep, smoothstep(0.0, 3.2, d)) * daylight;',
        ' vec3 col = mix(body, sky * mix(0.82, 1.0, daylight), clamp(fres * 1.15 + 0.06, 0.0, 1.0));',
        ' float sr = max(dot(R, sunDir), 0.0);',
        ' col += sunColor * sunVis * (pow(sr, 420.0) * 2.6 + pow(sr, 48.0) * 0.16);',
        ' float a = opacity * smoothstep(0.0, 0.45, d); a = max(a, fres * smoothstep(0.0, 0.2, d) * 0.9);',
        ' float fm = smoothstep(0.32, 0.03, d) * smoothstep(0.0, 0.05, d) * (0.55 + 0.45 * sin(time * 1.4 + (uv.x + uv.y) * 0.7 + n1.x * 3.0));',
        ' col = mix(col, vec3(0.93, 0.95, 0.94) * daylight, fm * foam);',
        ' a = max(a, fm * foam * 1.2);',
        ' gl_FragColor = vec4(col, a);',
        '#include <fog_fragment>',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, fog: true
    });
    m.uniforms.tNormal.value = waterNormals();
    m.userData.water = true;
    return m;
  };

  /* ---------------- vegetation atlas (alpha-tested cards + bark strips) ---------------- */
  var ATLAS_R = G.atlasRegions = {
    pine: [0, 0, 0.5, 0.25], pine2: [0.5, 0, 1, 0.25], oak: [0, 0.25, 0.25, 0.5], birch: [0.25, 0.25, 0.5, 0.5], bush: [0.5, 0.25, 0.75, 0.5], grass: [0.75, 0.25, 1, 0.5],
    barkPine: [0, 0.5, 0.125, 1], barkOak: [0.125, 0.5, 0.25, 1], barkBirch: [0.25, 0.5, 0.375, 1], barkDead: [0.375, 0.5, 0.5, 1],
    fern: [0.5, 0.5, 0.75, 0.75], twigs: [0.5, 0.75, 0.75, 1], flowers: [0.75, 0.5, 1, 0.625], reeds: [0.75, 0.625, 0.875, 1], dry: [0.875, 0.625, 1, 1]
  };
  function drawNeedleSpray(x, X, Y, W, H, rng, cols, tipCol) {
    // twig from the left (base) to the right (tip); dense needles on both sides, spray tapering to the tip
    var cy = Y + H * 0.5, i, j;
    x.lineCap = 'round';
    var mainPts = []; for (i = 0; i <= 20; i++) { var t = i / 20; mainPts.push([X + W * (0.02 + 0.95 * t), cy + Math.sin(t * 3.1) * H * 0.04]); }
    function onMain(t) { var k = Math.min(19, Math.floor(t * 20)), f = t * 20 - k, a = mainPts[k], b = mainPts[k + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
    var twigs = [];
    for (i = 0; i < 13; i++) {
      var t0 = 0.06 + i * 0.07 + rng() * 0.02; if (t0 > 0.9) break;
      var p0 = onMain(t0), side = i % 2 ? 1 : -1, len = W * (0.2 + 0.14 * Math.sin(Math.PI * Math.min(1, t0 * 1.2))) * (1 - t0 * 0.45), ang = side * (0.55 + rng() * 0.25);
      twigs.push([p0[0], p0[1], Math.cos(ang) * len, Math.sin(ang) * len * 0.62]);
    }
    // needles
    function needles(x0, y0, dx, dy, dens, width) {
      var L = Math.sqrt(dx * dx + dy * dy), n = Math.round(L / 1.6 * dens), ux = dx / L, uy = dy / L;
      for (var k = 0; k < n; k++) {
        var t = k / n, px = x0 + dx * t, py = y0 + dy * t, nl = H * (0.12 + 0.05 * rng()) * (1 - t * 0.35) * width;
        for (var sd = -1; sd <= 1; sd += 2) {
          var a = Math.atan2(uy, ux) + sd * (0.75 + rng() * 0.45);
          x.strokeStyle = cols[Math.floor(rng() * cols.length)]; x.lineWidth = 1.1 + rng() * 0.9;
          x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl); x.stroke();
        }
      }
    }
    // underlayer for density
    x.fillStyle = cols[0];
    for (i = 0; i < twigs.length; i++) { var tw = twigs[i]; x.globalAlpha = 0.9; x.beginPath(); x.ellipse(tw[0] + tw[2] * 0.5, tw[1] + tw[3] * 0.5, Math.abs(tw[2]) * 0.5 + 6, H * 0.07, Math.atan2(tw[3], tw[2]), 0, 6.283); x.fill(); }
    x.globalAlpha = 1;
    for (i = 0; i < twigs.length; i++) needles(twigs[i][0], twigs[i][1], twigs[i][2], twigs[i][3], 1.3, 0.9);
    needles(mainPts[0][0], mainPts[0][1], mainPts[20][0] - mainPts[0][0], mainPts[20][1] - mainPts[0][1], 1.6, 1.15);
    x.strokeStyle = '#4a3322'; x.lineWidth = Math.max(1.5, H * 0.025); x.beginPath(); x.moveTo(mainPts[0][0], mainPts[0][1]); for (i = 1; i <= 14; i++) x.lineTo(mainPts[i][0], mainPts[i][1]); x.stroke();
    // fresh tips
    for (i = 0; i < twigs.length; i++) { var tp = twigs[i]; x.strokeStyle = tipCol; x.lineWidth = 1.2; for (j = 0; j < 7; j++) { var a2 = Math.atan2(tp[3], tp[2]) + (rng() - 0.5) * 1.8, nl2 = H * 0.08; x.beginPath(); x.moveTo(tp[0] + tp[2] * 0.95, tp[1] + tp[3] * 0.95); x.lineTo(tp[0] + tp[2] * 0.95 + Math.cos(a2) * nl2, tp[1] + tp[3] * 0.95 + Math.sin(a2) * nl2); x.stroke(); } }
  }
  function leafPath(x, len, wid, lobes) {
    x.beginPath(); x.moveTo(0, 0);
    if (!lobes) { x.quadraticCurveTo(wid, -len * 0.45, 0, -len); x.quadraticCurveTo(-wid, -len * 0.45, 0, 0); }
    else {
      var n = lobes, i;
      for (i = 0; i < n; i++) { var y0 = -len * (i + 0.2) / n, y1 = -len * (i + 0.8) / n, w = wid * (0.7 + 0.3 * Math.sin(Math.PI * (i + 0.5) / n)); x.quadraticCurveTo(w * 1.25, y0, w * 0.55, y1); }
      x.lineTo(0, -len);
      for (i = n - 1; i >= 0; i--) { var y2 = -len * (i + 0.8) / n, y3 = -len * (i + 0.2) / n, w2 = wid * (0.7 + 0.3 * Math.sin(Math.PI * (i + 0.5) / n)); x.lineTo(-w2 * 0.55, y2); x.quadraticCurveTo(-w2 * 1.25, y3, 0, 0); }
    }
    x.closePath();
  }
  function drawLeafCluster(x, X, Y, W, H, rng, cols, opt) {
    var cx = X + W / 2, cy = Y + H / 2, i;
    x.lineCap = 'round';
    // twigs
    x.strokeStyle = opt.twig || '#4d3a28'; x.lineWidth = Math.max(1.2, W * 0.012);
    for (i = 0; i < 6; i++) { var a = i / 6 * 6.283 + rng() * 0.5; x.beginPath(); x.moveTo(cx, cy + H * 0.15); x.quadraticCurveTo(cx + Math.cos(a) * W * 0.18, cy + Math.sin(a) * H * 0.18, cx + Math.cos(a) * W * 0.36, cy + Math.sin(a) * H * 0.34); x.stroke(); }
    var n = opt.count || 70;
    for (i = 0; i < n; i++) {
      var r = Math.sqrt(rng()) * W * 0.4, a2 = rng() * 6.283, px = cx + Math.cos(a2) * r, py = cy + Math.sin(a2) * r * (opt.flat || 0.95);
      var len = W * (opt.size || 0.12) * (0.7 + rng() * 0.5), wid = len * (opt.aspect || 0.42);
      x.save(); x.translate(px, py); x.rotate(a2 + Math.PI / 2 + (rng() - 0.5) * 1.2 + (opt.droop ? 0.8 : 0));
      var col = cols[Math.floor(rng() * cols.length)];
      var g = x.createLinearGradient(-wid, 0, wid, 0); g.addColorStop(0, shade(col, 0.82)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, 1.12));
      x.fillStyle = g; leafPath(x, len, wid, opt.lobes || 0); x.fill();
      x.strokeStyle = 'rgba(30,40,15,.35)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -len * 0.9); x.stroke();
      x.restore();
    }
    if (opt.berries) for (i = 0; i < opt.berries; i++) { var br = Math.sqrt(rng()) * W * 0.3, ba = rng() * 6.283; x.fillStyle = rng() < 0.5 ? '#9e1f2a' : '#c43d3d'; x.beginPath(); x.arc(cx + Math.cos(ba) * br, cy + Math.sin(ba) * br, W * 0.018, 0, 6.283); x.fill(); x.fillStyle = 'rgba(255,255,255,.5)'; x.beginPath(); x.arc(cx + Math.cos(ba) * br - 1, cy + Math.sin(ba) * br - 1, W * 0.005, 0, 6.283); x.fill(); }
  }
  function drawGrassBlades(x, X, Y, W, H, rng, cols, opt) {
    x.lineCap = 'round';
    var n = opt.count || 46;
    for (var i = 0; i < n; i++) {
      var bx = X + W * (0.06 + 0.88 * rng()), h = H * (opt.minH || 0.45) + H * (1 - (opt.minH || 0.45)) * rng() * 0.95, lean = (rng() - 0.5) * W * 0.35;
      var base = cols[Math.floor(rng() * 2)], tip = cols[2 + Math.floor(rng() * (cols.length - 2))];
      var g = x.createLinearGradient(0, Y + H, 0, Y + H - h); g.addColorStop(0, base); g.addColorStop(1, tip);
      x.fillStyle = g; var w0 = W * (opt.width || 0.022) * (0.7 + rng() * 0.6);
      x.beginPath(); x.moveTo(bx - w0, Y + H); x.quadraticCurveTo(bx - w0 * 0.6 + lean * 0.3, Y + H - h * 0.5, bx + lean, Y + H - h); x.quadraticCurveTo(bx + w0 * 0.6 + lean * 0.3, Y + H - h * 0.5, bx + w0, Y + H); x.fill();
      if (opt.seeds && rng() < opt.seeds) { x.fillStyle = opt.seedCol || '#c8b27a'; for (var s = 0; s < 6; s++) { x.beginPath(); x.ellipse(bx + lean + (rng() - 0.5) * 3, Y + H - h + s * 3.2, 1.6, 3, lean * 0.01, 0, 6.283); x.fill(); } }
    }
  }
  function drawFern(x, X, Y, W, H, rng) {
    var cx = X + W / 2, by = Y + H * 0.98, cols = ['#3d6a2a', '#4b7a30', '#5a8a36', '#335a24'];
    x.lineCap = 'round';
    for (var f = 0; f < 9; f++) {
      var a = -Math.PI / 2 + (f / 8 - 0.5) * 2.4, L = H * (0.55 + rng() * 0.4), bend = (f / 8 - 0.5) * 0.9;
      var pts = []; for (var i = 0; i <= 12; i++) { var t = i / 12, aa = a + bend * t * t; pts.push([cx + Math.cos(aa) * L * t, by + Math.sin(aa) * L * t + t * t * H * 0.18]); }
      x.strokeStyle = '#3b5a22'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (i = 1; i <= 12; i++) x.lineTo(pts[i][0], pts[i][1]); x.stroke();
      for (i = 2; i < 12; i++) {
        var p = pts[i], q = pts[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], dl = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / dl, ny = dx / dl, ll = W * 0.12 * Math.sin(Math.PI * i / 12) + 3;
        for (var sd = -1; sd <= 1; sd += 2) { x.fillStyle = cols[(i + f) % 4]; x.save(); x.translate(p[0], p[1]); x.rotate(Math.atan2(ny * sd + dy / dl * 0.5, nx * sd + dx / dl * 0.5) + Math.PI / 2); leafPath(x, ll, ll * 0.22, 0); x.fill(); x.restore(); }
      }
    }
  }
  function drawTwigs(x, X, Y, W, H, rng, col) {
    x.lineCap = 'round'; x.strokeStyle = col;
    function br(px, py, a, len, w, d) {
      if (d > 4 || len < 3) return;
      var ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len;
      x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a + 0.2) * len * 0.5, py + Math.sin(a + 0.2) * len * 0.5, ex, ey); x.stroke();
      var n = 2 + Math.floor(rng() * 2);
      for (var i = 0; i < n; i++) br(px + (ex - px) * (0.4 + rng() * 0.6), py + (ey - py) * (0.4 + rng() * 0.6), a + (rng() - 0.5) * 1.4, len * (0.45 + rng() * 0.25), w * 0.65, d + 1);
    }
    for (var k = 0; k < 3; k++) br(X + W * 0.05, Y + H * (0.3 + k * 0.2), (rng() - 0.5) * 0.4, W * 0.45, Math.max(2, W * 0.025), 0);
  }
  function drawFlowers(x, X, Y, W, H, rng) {
    var cols = ['#f4d24a', '#f6f2ea', '#b48ad6', '#e9894a', '#f2f2ff'];
    x.lineCap = 'round';
    for (var i = 0; i < 14; i++) {
      var bx = X + W * (0.05 + 0.9 * rng()), h = H * (0.45 + rng() * 0.5), top = Y + H - h, lean = (rng() - 0.5) * 10;
      x.strokeStyle = '#4f7a2e'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(bx, Y + H); x.quadraticCurveTo(bx + lean, Y + H - h * 0.5, bx + lean, top); x.stroke();
      x.fillStyle = '#5f8a36'; x.save(); x.translate(bx + lean * 0.4, Y + H - h * 0.35); x.rotate(0.8); leafPath(x, h * 0.25, 3, 0); x.fill(); x.restore();
      var c = cols[i % cols.length], pr = 3 + rng() * 3;
      for (var p = 0; p < 6; p++) { var a = p / 6 * 6.283; x.fillStyle = c; x.beginPath(); x.ellipse(bx + lean + Math.cos(a) * pr, top + Math.sin(a) * pr * 0.7, pr * 0.75, pr * 0.45, a, 0, 6.283); x.fill(); }
      x.fillStyle = '#c99a2e'; x.beginPath(); x.arc(bx + lean, top, pr * 0.45, 0, 6.283); x.fill();
    }
    drawGrassBlades(x, X, Y, W, H, rng, ['#3f6a26', '#4f7a2e', '#7a9a40', '#8fae4a'], { count: 16, minH: 0.25, width: 0.02 });
  }
  function drawReeds(x, X, Y, W, H, rng) {
    drawGrassBlades(x, X, Y, W, H, rng, ['#4f6a2a', '#5f7a30', '#8a9a4a', '#a5a85a'], { count: 22, minH: 0.55, width: 0.05 });
    for (var i = 0; i < 4; i++) { var bx = X + W * (0.2 + 0.6 * rng()), top = Y + H * (0.04 + rng() * 0.12); x.strokeStyle = '#6b7a3a'; x.lineWidth = 2; x.beginPath(); x.moveTo(bx, Y + H); x.lineTo(bx, top); x.stroke(); x.fillStyle = '#5a3a22'; x.beginPath(); x.ellipse(bx, top + H * 0.08, W * 0.045, H * 0.07, 0, 0, 6.283); x.fill(); }
  }
  /** Build (once) the shared vegetation atlas -> {texture, regions} */
  G.vegAtlas = function () {
    var S = G.level() === 'ultra' ? 2048 : 1024;
    return cached('vegAtlas' + S, function () {
      var c = mkCanvas(S), x = c.getContext('2d'), R = ATLAS_R, rng = U.rng(4242), pad = 3;
      function rect(r) { return [r[0] * S + pad, r[1] * S + pad, (r[2] - r[0]) * S - pad * 2, (r[3] - r[1]) * S - pad * 2]; }
      var q;
      q = rect(R.pine); drawNeedleSpray(x, q[0], q[1], q[2], q[3], rng, ['#1d3a1e', '#24452a', '#2c5530', '#355f32', '#1a3320'], '#6f9a45');
      q = rect(R.pine2); drawNeedleSpray(x, q[0], q[1], q[2], q[3], rng, ['#223e2c', '#2a4d38', '#355c3e', '#3f6a44', '#1d3426'], '#7fa858');
      q = rect(R.oak); drawLeafCluster(x, q[0], q[1], q[2], q[3], rng, ['#3e5f26', '#4d702e', '#5d7f33', '#344f20', '#6b8a3a'], { count: 64, size: 0.16, aspect: 0.5, lobes: 3 });
      q = rect(R.birch); drawLeafCluster(x, q[0], q[1], q[2], q[3], rng, ['#7f9a36', '#9aae44', '#6b8a30', '#b5b84e', '#8fa83e'], { count: 90, size: 0.1, aspect: 0.55, droop: true, flat: 0.8 });
      q = rect(R.bush); drawLeafCluster(x, q[0], q[1], q[2], q[3], rng, ['#3f6228', '#4f742e', '#5c8236', '#36552a'], { count: 95, size: 0.11, aspect: 0.6, berries: 10 });
      q = rect(R.grass); drawGrassBlades(x, q[0], q[1], q[2], q[3], rng, ['#3d5a22', '#4a6a28', '#7a9a40', '#93ad52', '#a9b45e'], { count: 60, minH: 0.4, seeds: 0.12 });
      q = rect(R.fern); drawFern(x, q[0], q[1], q[2], q[3], rng);
      q = rect(R.twigs); drawTwigs(x, q[0], q[1], q[2], q[3], rng, '#5a4a3a');
      q = rect(R.flowers); drawFlowers(x, q[0], q[1], q[2], q[3], rng);
      q = rect(R.reeds); drawReeds(x, q[0], q[1], q[2], q[3], rng);
      q = rect(R.dry); drawGrassBlades(x, q[0], q[1], q[2], q[3], rng, ['#8a7a42', '#9a884a', '#c9b06a', '#d8c27a', '#bfa75e'], { count: 34, minH: 0.5, seeds: 0.4, seedCol: '#d8c48a' });
      // bark strips (opaque)
      paintBark(x, R.barkPine[0] * S, R.barkPine[1] * S, (R.barkPine[2] - R.barkPine[0]) * S, (R.barkPine[3] - R.barkPine[1]) * S, 'pine', rng, { base: '#5e4130', moss: null });
      paintBark(x, R.barkOak[0] * S, R.barkOak[1] * S, (R.barkOak[2] - R.barkOak[0]) * S, (R.barkOak[3] - R.barkOak[1]) * S, 'oak', rng, { base: '#5d544a', moss: '#5a7a34' });
      paintBark(x, R.barkBirch[0] * S, R.barkBirch[1] * S, (R.barkBirch[2] - R.barkBirch[0]) * S, (R.barkBirch[3] - R.barkBirch[1]) * S, 'birch', rng, { base: '#e6e2d6' });
      paintBark(x, R.barkDead[0] * S, R.barkDead[1] * S, (R.barkDead[2] - R.barkDead[0]) * S, (R.barkDead[3] - R.barkDead[1]) * S, 'dead', rng, { base: '#8b8478' });
      var tex = G.alphaTexture('vegAtlas', c, { clamp: true });
      return { texture: tex, regions: R, canvas: c, size: S };
    });
  };
  function foliagePatch(shader, low) {
    if (low) shader.fragmentShader = shader.fragmentShader.replace(/\( gl_FrontFacing \) \? (v\w+)Front : v\w+Back/g, '$1Front');
    else shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal = normal * faceDirection;', ''));
  }
  /** shared vegetation materials: kind 'tree' | 'grass' | 'plant' (atlas, alpha test, double sided, wind, foliage normals) */
  G.vegMaterial = function (kind) {
    var atlas = G.vegAtlas(), low = G.isLow();
    var amp = kind === 'grass' ? 0.42 : kind === 'plant' ? 0.12 : 0.0016;
    var key = 'veg:' + kind + ':' + atlas.size;
    var m = G.mat({ map: atlas.texture, alphaTest: kind === 'tree' ? 0.42 : 0.38, side: THREE.DoubleSide, vertexColors: true, roughness: 0.82, key: key, envMapIntensity: 0.75 });
    if (!m.userData.vegReady) {
      var cfg = { amp: amp, fade: kind === 'grass' ? [1e6, 2e6] : null };
      m.userData.wind = cfg;
      m.onBeforeCompile = function (sh) { windPatch(sh, cfg); foliagePatch(sh, low); m.userData.shader = sh; };
      m.customProgramCacheKey = function () { return 'hgveg' + (low ? 'L' : 'H'); };
      m.userData.vegReady = true;
    }
    return m;
  };
  /** set the grass fade radius (instanced near-player grass) */
  G.setGrassFade = function (r0, r1) { var m = G.vegMaterial('grass'); m.userData.wind.fade = [r0, r1]; if (m.userData.shader) m.userData.shader.uniforms.uFade.value.set(r0, r1); };

  /* ---------------- tree / plant builders (instancing friendly: origin at the base, y up) ---------------- */
  function uvR(r, s, t) { return [r[0] + (r[2] - r[0]) * s, r[1] + (r[3] - r[1]) * t]; }
  var _cn = new THREE.Vector3(), _cx = new THREE.Vector3(), _cy = new THREE.Vector3(), _cp = new THREE.Vector3();
  /** bent card strip: base P, length axis X, width axis Y (unit), len, wid, segs, droop (m at tip), region, normal centre C, colour fn(s)->k */
  function cardStrip(buf, P, X, Y, len, wid, segs, droop, reg, C, k0, k1, normalUp) {
    var base = buf.n;
    for (var i = 0; i <= segs; i++) {
      var s = i / segs, py = -droop * s * s;
      for (var j = 0; j < 2; j++) {
        var w = (j - 0.5) * wid;
        var x = P.x + X.x * len * s + Y.x * w, y = P.y + X.y * len * s + Y.y * w + py, z = P.z + X.z * len * s + Y.z * w;
        _cn.set(x - C.x, (y - C.y) * 0.6 + (normalUp || 0.35) * len, z - C.z).normalize();
        var uv = uvR(reg, s, j), kk = k0 + (k1 - k0) * s;
        buf.v(x, y, z, _cn.x, _cn.y, _cn.z, uv[0], uv[1], kk, kk, kk);
      }
    }
    for (i = 0; i < segs; i++) { var a = base + i * 2; buf.tri(a, a + 2, a + 1); buf.tri(a + 1, a + 2, a + 3); }
  }
  function addTrunk(buf, pts, radii, reg, radial, k0, k1, stepsPerSeg) {
    var g = G.tube(pts, radii, { radial: radial, steps: stepsPerSeg || 2, uRange: [reg[0] + 0.003, reg[2] - 0.003], vRange: [reg[3] - 0.003, reg[1] + 0.003], capStart: false, capEnd: true, capBulge: 0.2 });
    var p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, base = buf.n, ymax = 0, i;
    for (i = 0; i < p.count; i++) ymax = Math.max(ymax, p.getY(i));
    for (i = 0; i < p.count; i++) { var kk = k0 + (k1 - k0) * Math.min(1, p.getY(i) / Math.max(1, ymax)); buf.v(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), uv.getX(i), uv.getY(i), kk, kk, kk); }
    for (i = 0; i < g.index.count; i++) buf.idx.push(g.index.array[i] + base);
    g.dispose();
  }
  function finishVeg(buf, kind) { var g = buf.geometry(); g.userData.shared = true; return g; }
  var TREES = G.trees = {};
  /** Conifer (spruce/fir-like). o: {height:12, seed, spread:0.24 (radius/height), whorls, low:bool} -> {geometry, material, lod:{geometry, dist}, height, radius} */
  TREES.pine = function (o) {
    o = o || {};
    var key = 'pine:' + JSON.stringify(o);
    return cached(key, function () {
      function build(lo) {
        var rng = U.rng(o.seed || 1), H = o.height || 12, buf = new MeshBuf(), R = ATLAS_R, spread = o.spread || 0.23;
        var r0 = H * 0.022 + 0.08;
        var tp = [], tr = [];
        for (var i = 0; i <= 6; i++) { var t = i / 6; tp.push([(rng() - 0.5) * 0.08 * t, t * H * 0.99, (rng() - 0.5) * 0.08 * t]); tr.push(i === 0 ? r0 * 1.35 : Math.max(0.03, r0 * Math.pow(1 - t, 1.05))); }
        addTrunk(buf, tp, tr, R.barkPine, lo ? 5 : 8, 0.55, 0.9, lo ? 1 : 2);
        var y0 = H * (o.clear || 0.16), nW = lo ? 6 : (o.whorls || 13), C = new THREE.Vector3(0, 0, 0);
        for (var w = 0; w < nW; w++) {
          var tf = Math.pow(w / (nW - 1), 0.92), y = y0 + (H * 0.95 - y0) * tf, L = (H * spread * Math.pow(1 - tf, 0.8) + 0.35) * (0.86 + rng() * 0.26);
          var nb = lo ? 3 : (tf > 0.8 ? 4 : 5 + (rng() < 0.5 ? 1 : 0)), rot = rng() * 6.283, kIn = 0.42 + 0.3 * tf, kOut = 0.85 + 0.15 * tf;
          C.set(0, y + L * 0.1, 0);
          for (var b = 0; b < nb; b++) {
            var a = rot + b / nb * 6.283 + (rng() - 0.5) * 0.5, up = 0.12 - 0.35 * (1 - tf) + (rng() - 0.5) * 0.1;
            _cx.set(Math.cos(a), up, Math.sin(a)).normalize();
            var droop = L * (0.12 + 0.3 * (1 - tf)), reg = rng() < 0.3 ? R.pine2 : R.pine;
            _cp.set(Math.cos(a) * r0 * 0.5, y, Math.sin(a) * r0 * 0.5);
            var cards = 2;
            for (var c = 0; c < cards; c++) {
              var tilt = (c === 0 ? 1 : -1) * (lo ? 0.75 : 0.6);
              // width axis: horizontal perpendicular, tilted around the branch axis
              _cy.set(-Math.sin(a), 0, Math.cos(a));
              var cosT = Math.cos(tilt), sinT = Math.sin(tilt);
              var vx = _cy.x * cosT, vy = sinT, vz = _cy.z * cosT;
              _cy.set(vx, vy, vz).normalize();
              cardStrip(buf, _cp, _cx, _cy, L, L * 0.56, lo ? 1 : 3, droop, reg, C, kIn * (0.9 + rng() * 0.2), kOut, 0.4);
            }
          }
        }
        // leader / top tuft
        C.set(0, H * 0.9, 0);
        for (var t2 = 0; t2 < (lo ? 1 : 3); t2++) { var aa = t2 / 3 * 3.14; _cp.set(0, H * 0.86, 0); _cx.set(0, 1, 0); _cy.set(Math.cos(aa), 0, Math.sin(aa)); cardStrip(buf, _cp, _cx, _cy, H * 0.16, H * 0.07, 1, 0, R.pine2, C, 0.8, 1, 0.2); }
        return finishVeg(buf);
      }
      var H = o.height || 12;
      return { geometry: build(false), material: G.vegMaterial('tree'), lod: { geometry: build(true), dist: o.lodDist || 60 }, height: H, radius: H * (o.spread || 0.23), castShadow: true };
    });
  };
  function broadleaf(o, kind) {
    o = o || {};
    var key = kind + ':' + JSON.stringify(o);
    return cached(key, function () {
      var H = o.height || (kind === 'birch' ? 9 : 8);
      function build(lo) {
        var rng = U.rng(o.seed || 3), buf = new MeshBuf(), R = ATLAS_R, birch = kind === 'birch', dead = kind === 'dead';
        var bark = birch ? R.barkBirch : dead ? R.barkDead : R.barkOak, leaf = birch ? R.birch : R.oak;
        var r0 = H * (birch ? 0.017 : 0.035) + 0.05, hb = H * (birch ? 0.25 : dead ? 0.45 : 0.38), C = new THREE.Vector3(0, H * (birch ? 0.6 : 0.62), 0);
        var tp = [], tr = [], topH = dead ? H * 0.82 : (birch ? H * 0.96 : hb * 1.15);
        for (var i = 0; i <= 5; i++) { var t = i / 5; tp.push([(rng() - 0.5) * 0.18 * t, t * topH, (rng() - 0.5) * 0.18 * t]); tr.push(i === 0 ? r0 * 1.3 : r0 * (1 - t * (dead ? 0.55 : birch ? 0.85 : 0.35))); }
        addTrunk(buf, tp, tr, bark, lo ? 5 : 8, 0.6, 0.95, lo ? 1 : 2);
        var clusters = [];
        var limbs = lo ? 3 : (birch ? 7 : dead ? 4 : 5);
        for (var l = 0; l < limbs; l++) {
          var a = l / limbs * 6.283 + rng() * 0.6, sy = birch ? hb + (H * 0.7 - hb) * (l / limbs) : hb * (0.85 + rng() * 0.3);
          var len = birch ? H * (0.22 - 0.1 * l / limbs) : H * (0.38 + rng() * 0.12) * (dead ? 0.7 : 1), rise = birch ? 0.75 : 0.85 + rng() * 0.3;
          var p0 = [Math.cos(a) * r0 * 0.3, sy, Math.sin(a) * r0 * 0.3], p1 = [Math.cos(a) * len * 0.5, sy + len * rise * 0.55, Math.sin(a) * len * 0.5], p2 = [Math.cos(a) * len * 0.85, sy + len * rise * (birch ? 0.75 : 0.9), Math.sin(a) * len * 0.85];
          if (!lo || !birch) addTrunk(buf, [p0, p1, p2], [r0 * (birch ? 0.35 : 0.55), r0 * 0.3, r0 * 0.12], bark, lo ? 4 : 6, 0.7, 0.95, 1);
          if (!dead) { clusters.push(p1, p2); if (!lo) for (var sb = 0; sb < 2; sb++) { var sa = a + (sb ? 0.7 : -0.7); clusters.push([p1[0] + Math.cos(sa) * len * 0.35, p1[1] + len * 0.2 + rng() * len * 0.2, p1[2] + Math.sin(sa) * len * 0.35]); } }
          else if (!lo) { var tw = { x: p2[0], y: p2[1], z: p2[2] }; _cp.set(tw.x, tw.y, tw.z); _cx.set(Math.cos(a), 0.6, Math.sin(a)).normalize(); _cy.set(-Math.sin(a), 0, Math.cos(a)); cardStrip(buf, _cp, _cx, _cy, len * 0.5, len * 0.35, 1, 0, R.twigs, C, 0.8, 0.9, 0.3); }
        }
        if (!dead) {
          // fill the crown
          var extra = lo ? 4 : (birch ? 10 : 12);
          for (var e = 0; e < extra; e++) { var ea = rng() * 6.283, er = Math.sqrt(rng()) * H * (birch ? 0.2 : 0.32); clusters.push([Math.cos(ea) * er, C.y + (rng() - 0.35) * H * (birch ? 0.45 : 0.32), Math.sin(ea) * er]); }
          var cs = H * (birch ? 0.13 : 0.18) * (lo ? 1.7 : 1);
          clusters.forEach(function (p) {
            var nq = lo ? 2 : 3, ro = rng() * 3.14;
            for (var q = 0; q < nq; q++) {
              var qa = ro + q / nq * 3.14, tilt = (rng() - 0.5) * 0.8;
              _cx.set(Math.cos(qa), tilt, Math.sin(qa)).normalize(); _cy.set(-Math.sin(qa) * 0.3, 1, Math.cos(qa) * 0.3).normalize();
              _cp.set(p[0] - _cx.x * cs * 0.5, p[1] - _cy.y * 0, p[2] - _cx.z * cs * 0.5);
              var k = 0.62 + 0.38 * U.clamp((p[1] - C.y) / (H * 0.4) + 0.5, 0, 1);
              cardStrip(buf, _cp, _cx, _cy, cs, cs, 1, birch ? cs * 0.18 : 0, leaf, C, k, k * 1.05, 0.3);
            }
          });
        }
        return finishVeg(buf);
      }
      return { geometry: build(false), material: G.vegMaterial('tree'), lod: { geometry: build(true), dist: o.lodDist || 55 }, height: H, radius: H * 0.3, castShadow: true };
    });
  }
  /** Broadleaf oak. o: {height:8, seed} */
  TREES.oak = function (o) { return broadleaf(o, 'oak'); };
  /** Birch / aspen (white bark). o: {height:9, seed} */
  TREES.birch = function (o) { return broadleaf(o, 'birch'); };
  /** Dead snag (bare branches). o: {height:8, seed} */
  TREES.dead = function (o) { return broadleaf(o, 'dead'); };
  /** Bush. o: {size:1.2, seed, berries:false} */
  TREES.bush = function (o) {
    o = o || {};
    return cached('bush:' + JSON.stringify(o), function () {
      function build(lo) {
        var rng = U.rng(o.seed || 5), buf = new MeshBuf(), s = o.size || 1.2, C = new THREE.Vector3(0, s * 0.25, 0), n = lo ? 5 : 14, reg = ATLAS_R.bush;
        for (var i = 0; i < n; i++) {
          var a = rng() * 6.283, el = rng() * 1.1, r = s * (0.3 + rng() * 0.35);
          var px = Math.cos(a) * Math.cos(el) * r, py = s * 0.18 + Math.sin(el) * r * 0.8, pz = Math.sin(a) * Math.cos(el) * r, cs = s * (0.65 + rng() * 0.3) * (lo ? 1.3 : 1);
          _cx.set(Math.cos(a + 1.3), (rng() - 0.5) * 0.6, Math.sin(a + 1.3)).normalize(); _cy.set(0, 1, 0);
          _cp.set(px - _cx.x * cs / 2, py - cs / 2, pz - _cx.z * cs / 2);
          var k = 0.55 + 0.45 * U.clamp(py / s, 0, 1);
          cardStrip(buf, _cp, _cx, _cy, cs, cs, 1, 0, reg, C, k, k, 0.5);
        }
        if (!lo) for (var t = 0; t < 3; t++) { var ta = rng() * 6.283; _cp.set(0, 0.05, 0); _cx.set(Math.cos(ta), 0.8, Math.sin(ta)).normalize(); _cy.set(-Math.sin(ta), 0, Math.cos(ta)); cardStrip(buf, _cp, _cx, _cy, s * 0.8, s * 0.6, 1, 0, ATLAS_R.twigs, C, 0.6, 0.8, 0.3); }
        return finishVeg(buf);
      }
      return { geometry: build(false), material: G.vegMaterial('plant'), lod: { geometry: build(true), dist: o.lodDist || 45 }, height: (o.size || 1.2) * 0.9, radius: (o.size || 1.2) * 0.6 };
    });
  };
  /** Ground plants from crossed cards: kind 'grass'|'fern'|'flowers'|'reeds'|'dry'. o: {size, seed, cards:3} */
  G.plant = function (kind, o) {
    o = o || {};
    return cached('plant:' + kind + JSON.stringify(o), function () {
      var rng = U.rng(o.seed || 9), buf = new MeshBuf(), reg = ATLAS_R[kind] || ATLAS_R.grass, s = o.size || 1;
      var dims = { grass: [0.75, 0.5], fern: [1.1, 0.8], flowers: [0.8, 0.45], reeds: [0.7, 1.6], dry: [0.6, 1.0] }[kind] || [0.8, 0.5];
      var W = dims[0] * s, Hh = dims[1] * s, n = o.cards || (kind === 'fern' ? 4 : 3), C = new THREE.Vector3(0, -Hh, 0);
      for (var i = 0; i < n; i++) {
        var a = i / n * 3.14159 + rng() * 0.4, lean = kind === 'fern' ? 0.55 : 0.12;
        _cx.set(Math.cos(a), 0, Math.sin(a)); _cy.set(-Math.sin(a) * lean, 1, Math.cos(a) * lean).normalize();
        if (kind === 'fern') { // fronds splay outward: two half cards
          for (var sd = -1; sd <= 1; sd += 2) { _cp.set(0, 0, 0); var dx = _cx.x * sd, dz = _cx.z * sd; _cy.set(dx * 0.9, 0.6, dz * 0.9).normalize(); var X = new THREE.Vector3(-dz, 0, dx); var bb = buf.n;
            // quad: bottom edge at centre, top outward
            var reg2 = [reg[0] + (reg[2] - reg[0]) * (sd < 0 ? 0 : 0.5), reg[1], reg[0] + (reg[2] - reg[0]) * (sd < 0 ? 0.5 : 1), reg[3]];
            var corners = [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]];
            corners.forEach(function (cc) { var px = X.x * cc[0] * W * 0.5 + _cy.x * cc[1] * Hh, py = _cy.y * cc[1] * Hh, pz = X.z * cc[0] * W * 0.5 + _cy.z * cc[1] * Hh; _cn.set(px, py + 0.5, pz).normalize(); var uv = uvR(reg2, sd < 0 ? 1 - (cc[0] + 0.5) : cc[0] + 0.5, 1 - cc[1]); var k = 0.55 + 0.45 * cc[1]; buf.v(px, py, pz, _cn.x, _cn.y, _cn.z, uv[0], uv[1], k, k, k); });
            buf.tri(bb, bb + 1, bb + 2); buf.tri(bb + 1, bb + 3, bb + 2); }
          continue;
        }
        var b0 = buf.n;
        for (var r = 0; r <= 2; r++) for (var c = 0; c < 2; c++) {
          var t = r / 2, w = (c - 0.5) * W, bend = t * t * Hh * 0.12;
          var px2 = _cx.x * w + _cy.x * t * Hh + Math.cos(a + 1.57) * bend, py2 = _cy.y * t * Hh, pz2 = _cx.z * w + _cy.z * t * Hh + Math.sin(a + 1.57) * bend;
          _cn.set(px2 * 0.4, 1, pz2 * 0.4).normalize();
          var uv2 = uvR(reg, c, 1 - t), kk = 0.5 + 0.5 * t;
          buf.v(px2, py2, pz2, _cn.x, _cn.y, _cn.z, uv2[0], uv2[1], kk, kk, kk);
        }
        for (r = 0; r < 2; r++) { var q = b0 + r * 2; buf.tri(q, q + 1, q + 2); buf.tri(q + 1, q + 3, q + 2); }
      }
      return { geometry: finishVeg(buf), material: G.vegMaterial(kind === 'grass' ? 'grass' : 'plant'), height: Hh };
    });
  };
  /** Rock texture (lichen) */
  TX.rock = function (o) {
    o = o || {};
    var size = texSize(512);
    return cached('rocktex' + JSON.stringify(o) + size, function () {
      var c = drawLayer('rock', [o.base || '#8a877e', '#5f5d57', '#a39f95'], size, o.seed || 31);
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  var ROCK_FRAG = [
    '#ifdef USE_MAP',
    ' vec3 bw = pow(abs(vON), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);',
    ' vec4 tx = texture2D(map, vOP.yz * uTri) * bw.x + texture2D(map, vOP.xz * uTri + 0.37) * bw.y + texture2D(map, vOP.xy * uTri + 0.71) * bw.z;',
    ' diffuseColor *= mapTexelToLinear(tx);',
    '#endif'
  ].join('\n');
  /** rock material (triplanar lichen texture in object space) */
  G.rockMaterial = function (o) {
    o = o || {};
    var low = G.isLow(), tex = TX.rock(o);
    var m = G.mat({ map: tex, vertexColors: true, roughness: 0.92, normalMap: low ? null : TX.normalOf(tex, 3), normalScale: 0.8, key: 'rock:' + JSON.stringify(o) });
    if (!m.userData.rockReady) {
      m.onBeforeCompile = function (sh) {
        sh.uniforms.uTri = { value: o.scale || 0.55 };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTri; varying vec3 vOP; varying vec3 vON;').replace('#include <map_fragment>', ROCK_FRAG);
      };
      m.customProgramCacheKey = function () { return 'hgrock' + (low ? 'L' : 'H'); };
      m.userData.rockReady = true;
    }
    return m;
  };
  /** Natural rock: displaced icosahedron, flattened base, moss on top, crevice AO. o: {size:1, seed, flat:0.65, moss:'#5d7a35'} */
  G.rock = function (o) {
    o = o || {};
    return cached('rock:' + JSON.stringify(o), function () {
      function build(detail) {
        var s = o.size || 1, seed = o.seed || 1, g = new THREE.IcosahedronGeometry(s, detail), p = g.attributes.position;
        // weld (Icosahedron is non-indexed in r128): build an indexed copy
        var map = {}, verts = [], idx = [];
        for (var i = 0; i < p.count; i++) { var x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4); if (map[k] == null) { map[k] = verts.length / 3; verts.push(x, y, z); } idx.push(map[k]); }
        g.dispose();
        var ng = new THREE.BufferGeometry(), dsp = [];
        for (i = 0; i < verts.length; i += 3) {
          var vx = verts[i] / s, vy = verts[i + 1] / s, vz = verts[i + 2] / s;
          var n = fbm3(vx * 1.3 + seed, vy * 1.3, vz * 1.3, 4, seed) - 0.5, ridge = Math.abs(fbm3(vx * 3 + 9, vy * 3, vz * 3, 3, seed + 5) - 0.5);
          var r = s * (1 + n * 0.7 - ridge * 0.25);
          var fx = vx * r * (o.stretch || 1.25), fy = vy * r * (o.flat || 0.62), fz = vz * r;
          if (fy < -s * 0.15) fy = -s * 0.15 + (fy + s * 0.15) * 0.2;
          verts[i] = fx; verts[i + 1] = fy; verts[i + 2] = fz; dsp.push(n - ridge * 0.5);
        }
        ng.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); ng.setIndex(idx); ng.computeVertexNormals();
        var moss = new THREE.Color(o.moss || '#5d7a35'), base = new THREE.Color('#ffffff');
        G.paint(ng, function (c, x, y, z, nx, ny, nz, u, v, i) {
          var k = 0.78 + dsp[i] * 0.9; k = U.clamp(k, 0.45, 1.15);
          c.copy(base).multiplyScalar(k);
          var m = U.smooth(0.55, 0.85, ny) * U.smooth(-0.1, 0.25, fbm3(x * 1.5, y * 1.5, z * 1.5, 3, 77) - 0.35) * (o.mossAmount == null ? 1 : o.mossAmount);
          c.lerp(moss, m * 0.85);
        });
        G.vertexAO(ng, { ground: -s * 0.15, groundStrength: 0.5, groundFalloff: s * 0.3, strength: 0, under: 0.2 });
        ng.computeBoundingSphere(); ng.userData.shared = true;
        return ng;
      }
      return { geometry: build(G.isLow() ? 2 : 3), material: G.rockMaterial(o.texture), lod: { geometry: build(1), dist: o.lodDist || 70 }, castShadow: true };
    });
  };

  /* ---------------- dynamic grass around the player ---------------- */
  var grassSys = G.grass = { mesh: null, radius: 26, spacing: 0.8, cx: 1e9, cz: 1e9, enabled: true, density: 1 };
  function grassClumpGeo() {
    return cached('grassClump', function () {
      var buf = new MeshBuf(), reg = ATLAS_R.grass, W = 0.78, Hh = 0.52, n = 3, C = new THREE.Vector3(0, -0.6, 0);
      for (var i = 0; i < n; i++) {
        var a = i / n * Math.PI + 0.3, b0 = buf.n;
        for (var r = 0; r <= 2; r++) for (var c = 0; c < 2; c++) {
          var t = r / 2, w = (c - 0.5) * W, px = Math.cos(a) * w + Math.cos(a + 1.57) * t * t * 0.08, pz = Math.sin(a) * w + Math.sin(a + 1.57) * t * t * 0.08, py = t * Hh;
          _cn.set(px * 0.5, 1, pz * 0.5).normalize();
          var uv = uvR(reg, c, 1 - t), k = 0.45 + 0.55 * t;
          buf.v(px, py, pz, _cn.x, _cn.y, _cn.z, uv[0], uv[1], k, k, k);
        }
        for (r = 0; r < 2; r++) { var q = b0 + r * 2; buf.tri(q, q + 1, q + 2); buf.tri(q + 1, q + 3, q + 2); }
      }
      return finishVeg(buf);
    });
  }
  /** (re)create the near-player grass for the current map (called by core after the terrain is built) */
  G.initGrass = function (map) {
    grassSys.mesh = null; grassSys.cx = grassSys.cz = 1e9;
    if (!map || map.grass === false || !HG.terrain.grassW) return;
    var lvl = G.level(), dens = map.grassDensity == null ? 1 : map.grassDensity;
    grassSys.radius = lvl === 'low' ? 16 : lvl === 'ultra' ? 38 : 27;
    grassSys.spacing = (lvl === 'low' ? 1.05 : lvl === 'ultra' ? 0.62 : 0.78) / Math.sqrt(Math.max(0.2, dens));
    var R = grassSys.radius + 3, cap = Math.ceil(Math.PI * R * R / (grassSys.spacing * grassSys.spacing) * 1.05) + 16;
    var im = new THREE.InstancedMesh(grassClumpGeo(), G.vegMaterial('grass'), cap);
    im.count = 0; im.frustumCulled = false; im.receiveShadow = !G.isLow(); im.castShadow = false; im.name = 'grass';
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    grassSys.mesh = im; grassSys.cap = cap;
    HG.mapRoot.add(im);
    G.setGrassFade(grassSys.radius - 5, grassSys.radius);
    if (map.grassColor) grassSys.tint = G.color(map.grassColor); else grassSys.tint = null;
  };
  /** per frame (cheap): rebuild instances when the player moved ~2.5 m */
  G.updateGrass = function (px, pz) {
    var gs = grassSys, im = gs.mesh; if (!im || !HG.terrain.ready) return;
    if ((px - gs.cx) * (px - gs.cx) + (pz - gs.cz) * (pz - gs.cz) < 6.25) return;
    gs.cx = px; gs.cz = pz;
    var T = HG.terrain, sp = gs.spacing, R = gs.radius + 3, R2 = R * R, n = 0, arr = im.instanceMatrix.array, col = im.instanceColor.array;
    var i0 = Math.floor((px - R) / sp), i1 = Math.ceil((px + R) / sp), j0 = Math.floor((pz - R) / sp), j1 = Math.ceil((pz + R) / sp);
    var half = T.size / 2, seg = T.seg, cell = T.cell, row = seg + 1, gw = T.grassW, tint = T.tint, wl = T.waterLevel;
    for (var j = j0; j <= j1 && n < gs.cap; j++) for (var i = i0; i <= i1 && n < gs.cap; i++) {
      var h1 = hash2(i, j, 71), h2 = hash2(i, j, 72);
      var x = (i + h1) * sp, z = (j + h2) * sp, dx = x - px, dz = z - pz;
      if (dx * dx + dz * dz > R2) continue;
      var gx = (x + half) / cell, gz = (z + half) / cell; if (gx < 0 || gz < 0 || gx >= seg || gz >= seg) continue;
      var vi = Math.round(gz) * row + Math.round(gx), w = gw[vi];
      var h3 = hash2(i, j, 73);
      if (w < 0.35 + h3 * 0.3) continue;
      var y = T.heightAt(x, z); if (y < wl + 0.25) continue;
      var s = (0.65 + hash2(i, j, 74) * 0.6) * U.smooth(0.35, 0.8, w), rot = h3 * 6.283, cs = Math.cos(rot) * s, sn = Math.sin(rot) * s, sy = s * (0.8 + h1 * 0.5);
      var o = n * 16;
      arr[o] = cs; arr[o + 1] = 0; arr[o + 2] = -sn; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = sn; arr[o + 9] = 0; arr[o + 10] = cs; arr[o + 11] = 0;
      arr[o + 12] = x; arr[o + 13] = y - 0.03; arr[o + 14] = z; arr[o + 15] = 1;
      var k = 0.8 + hash2(i, j, 75) * 0.35, c3 = vi * 3;
      if (gs.tint) { col[n * 3] = gs.tint.r * k; col[n * 3 + 1] = gs.tint.g * k; col[n * 3 + 2] = gs.tint.b * k; }
      else { col[n * 3] = tint[c3] * k; col[n * 3 + 1] = tint[c3 + 1] * k; col[n * 3 + 2] = tint[c3 + 2] * k; }
      n++;
    }
    im.count = n; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
  };
  /* ---------------- first-person hands (gloves + sleeves) ---------------- */
  var HAND_POSES = G.handPoses = {
    open: { curl: [0.1, 0.1, 0.12, 0.15], thumb: 0.15, spread: 0.12 },
    grip: { curl: [0.82, 0.86, 0.88, 0.9], thumb: 0.75, spread: 0.02 },
    trigger: { curl: [0.38, 0.86, 0.88, 0.9], thumb: 0.75, spread: 0.03, index: [0.55, 0.45, 0.2] },
    support: { curl: [0.55, 0.6, 0.62, 0.66], thumb: 0.35, spread: 0.06 },
    fist: { curl: [1, 1, 1, 1], thumb: 0.9, spread: 0 },
    pinch: { curl: [0.62, 0.7, 0.8, 0.85], thumb: 0.62, spread: 0.02 }
  };
  var _hq = new THREE.Quaternion(), _hv = new THREE.Vector3(), _hax = new THREE.Vector3(1, 0, 0);
  /** Right-hand geometry: wrist at origin, fingers toward -z, palm facing -y, thumb on -x. pose: name or {curl:[i,m,r,p], thumb, spread, index:[mcp,pip,dip]} */
  G.handGeometry = function (pose, opts) {
    opts = opts || {};
    var P = typeof pose === 'string' ? (HAND_POSES[pose] || HAND_POSES.grip) : (pose || HAND_POSES.grip);
    var lo = !!opts.low, R = lo ? 6 : 10, parts = [], g = opts.glove == null ? 0.0016 : opts.glove;
    var palmL = 0.088;
    parts.push(G.organicBody([
      { p: [0, 0.002, 0.012], w: 0.056, hUp: 0.02, hDown: 0.02, sq: 2.4 },
      { p: [0, 0.003, -0.02], w: 0.074, hUp: 0.018, hDown: 0.017, sq: 2.8 },
      { p: [0.002, 0.002, -0.055], w: 0.084, hUp: 0.015, hDown: 0.016, sq: 3.0 },
      { p: [0.002, 0.0, -palmL + 0.006], w: 0.084, hUp: 0.013, hDown: 0.014, sq: 2.6 },
      { p: [0.002, -0.001, -palmL - 0.004], w: 0.07, hUp: 0.008, hDown: 0.009, sq: 2.2 }
    ], { radial: lo ? 10 : 18, steps: lo ? 2 : 3, density: 18, smooth: 1 }));
    var fingers = [
      { x: -0.028, L: [0.042, 0.025, 0.02], r: 0.0088, k: 0 }, { x: -0.009, L: [0.047, 0.029, 0.021], r: 0.009, k: 1 },
      { x: 0.01, L: [0.044, 0.027, 0.02], r: 0.0086, k: 2 }, { x: 0.028, L: [0.035, 0.021, 0.018], r: 0.0076, k: 3 }
    ];
    var maxB = [1.45, 1.65, 1.15];
    fingers.forEach(function (f) {
      var c = P.curl[f.k], bends = (f.k === 0 && P.index) ? [P.index[0] * maxB[0], P.index[1] * maxB[1], P.index[2] * maxB[2]] : [c * maxB[0], c * maxB[1] * 1.02, c * maxB[2]];
      var spread = (f.k - 1.5) * (P.spread || 0) * 0.6;
      var pts = [[f.x * 0.95, 0.001, -palmL + 0.016]], cur = new THREE.Vector3(f.x, 0, -palmL), ang = 0;
      pts.push([cur.x, cur.y, cur.z]);
      for (var s = 0; s < 3; s++) {
        ang += bends[s];
        _hv.set(Math.sin(spread) , -Math.sin(ang), -Math.cos(ang)).normalize();
        cur.addScaledVector(_hv, f.L[s]); pts.push([cur.x, cur.y, cur.z]);
      }
      var rr = f.r + g;
      parts.push(G.tube(pts, [rr * 1.08, rr * 1.05, rr * 0.98, rr * 0.92, rr * 0.82], { radial: R, steps: lo ? 2 : 3, density: 30, capBulge: 0.9, capStart: false }));
    });
    // thumb: from the base of the palm (index side), opposes with curl
    var tc = P.thumb, tb = new THREE.Vector3(-0.026, -0.009, -0.012), td = new THREE.Vector3(-0.62, -0.32, -0.72).normalize(), ax = new THREE.Vector3(0.35, -0.35, -0.87).normalize();
    var tpts = [[tb.x * 0.6, -0.004, tb.z + 0.012], [tb.x, tb.y, tb.z]], tl = [0.04, 0.034, 0.028];
    for (var j = 0; j < 3; j++) { _hq.setFromAxisAngle(ax, -tc * (j === 0 ? 0.7 : 0.6)); td.applyQuaternion(_hq); tb.addScaledVector(td, tl[j]); tpts.push([tb.x, tb.y, tb.z]); }
    parts.push(G.tube(tpts, [0.014 + g, 0.0125 + g, 0.0108 + g, 0.0098 + g, 0.0088 + g], { radial: R, steps: lo ? 2 : 3, density: 30, capBulge: 0.9, capStart: false }));
    // glove cuff
    parts.push(G.tube([[0, 0.002, 0.03], [0, 0.002, 0.0], [0, 0.002, -0.015]], [0.036, 0.034, 0.03], { radial: lo ? 10 : 16, steps: 2, density: 16, capStart: false, capEnd: false, sq: 2.3 }));
    var geo = G.merge(parts);
    G.vertexAO(geo, { cells: 9, strength: 0.7, min: 0.55, under: 0.1 });
    if (opts.left) G.mirrorX(geo);
    return geo;
  };
  /** Sleeve from the wrist back along dir (forearm) */
  G.sleeveGeometry = function (len, dir, opts) {
    opts = opts || {};
    var d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize(), pts = [], radii = [];
    for (var i = 0; i <= 6; i++) { var t = i / 6; pts.push([d.x * len * t, d.y * len * t, d.z * len * t]); radii.push(0.039 + t * 0.016 + (i === 1 ? 0.004 : 0)); }
    var g = G.tube(pts, radii, { radial: 16, steps: 3, density: 9, capStart: false, capEnd: false, sq: 2.2, displace: function (v, t, th) { var k = Math.sin(th * 3 + t * 9) * 0.0025 + Math.sin(th * 5 - t * 14) * 0.0018; v.x += Math.cos(th) * k; v.y += Math.sin(th) * k; } });
    G.vertexAO(g, { cells: 6, strength: 0.4, min: 0.6 });
    return g;
  };
  function gloveMats() {
    var oc = HG.getOutfitColors ? HG.getOutfitColors() : { sleeve: '#55613a', cuff: '#ff8a1f', glove: '#3b2a1e' };
    var gl = TX.leather({ base: oc.glove || '#3b2a1e' });
    var sleeveTex = oc.pattern ? TX.camo({ pattern: oc.pattern, palette: oc.palette }) : TX.fabric({ base: '#ffffff' });
    return {
      glove: G.mat({ map: gl, normalMap: G.isLow() ? null : TX.normalOf(gl, 2), normalScale: 0.7, roughness: 0.62, vertexColors: true, key: 'glove:' + oc.glove }),
      sleeve: G.mat({ map: sleeveTex, color: oc.pattern ? '#ffffff' : (oc.sleeve || '#55613a'), roughness: 0.9, vertexColors: true, key: 'sleeve:' + oc.sleeve + ':' + oc.pattern }),
      cuff: oc.cuff
    };
  }
  /** First-person arms for a view model. cfg: {right:{pos:[x,y,z], basis:[[xAxis],[yAxis]] or rot:[x,y,z], pose, arm:[dx,dy,dz], armLen}, left:{...}} -> Group (weapon space) */
  G.fpArms = function (cfg) {
    var grp = new THREE.Group(), M2 = gloveMats();
    ['right', 'left'].forEach(function (side) {
      var c = cfg && cfg[side]; if (!c) return;
      var hand = new THREE.Group();
      var hg = G.handGeometry(c.pose || 'grip', { left: side === 'left' });
      var hm = new THREE.Mesh(hg, M2.glove); hand.add(hm);
      if (c.basis) { var bx = new THREE.Vector3().fromArray(c.basis[0]).normalize(), by = new THREE.Vector3().fromArray(c.basis[1]).normalize(); var bz = new THREE.Vector3().crossVectors(bx, by).normalize(); by.crossVectors(bz, bx); hand.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(bx, by, bz)); }
      else if (c.rot) hand.rotation.set(c.rot[0], c.rot[1], c.rot[2]);
      hand.position.fromArray(c.pos);
      grp.add(hand);
      if (c.arm) {
        var sg = G.sleeveGeometry(c.armLen || 0.34, c.arm);
        G.paint(sg, function (col, x, y, z) { var t = Math.sqrt(x * x + y * y + z * z); col.set(t < 0.035 && !M2.sleeve.map.userData.camo ? (M2.cuff || '#ff8a1f') : '#ffffff'); }, { multiply: true });
        var sm = new THREE.Mesh(sg, M2.sleeve); sm.position.fromArray(c.pos); sm.position.add(new THREE.Vector3(0, 0.002, 0.018).applyQuaternion(hand.quaternion)); grp.add(sm);
      }
      grp.userData[side] = hand;
    });
    return grp;
  };

  /* ---------------- extra textures for props ---------------- */
  TX.planks = function (o) {
    o = o || {};
    var size = texSize(512);
    return cached('planks' + JSON.stringify(o) + size, function () {
      var c = mkCanvas(size), x = c.getContext('2d'), rng = U.rng(o.seed || 19), n = o.boards || 6, bw = size / n, base = o.base || '#7a5a3c';
      var wood = TX.woodGrain({ base: base, dark: shade(base, 0.55), light: shade(base, 1.3), size: [256, 1024], seed: 3 }).image;
      for (var i = 0; i < n; i++) { var off = rng() * size; x.drawImage(wood, 0, 0, wood.width, wood.height, i * bw, -off, bw, size * 1.6); x.drawImage(wood, 0, 0, wood.width, wood.height, i * bw, size * 1.6 - off, bw, size * 1.6); x.fillStyle = 'rgba(0,0,0,' + (0.05 + rng() * 0.12) + ')'; x.fillRect(i * bw, 0, bw, size); x.fillStyle = 'rgba(20,12,6,.75)'; x.fillRect(i * bw, 0, Math.max(2, bw * 0.04), size); }
      noiseOverlay(x, size, size, 4, 4, 0.35, 23, 'soft-light');
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  TX.shingles = function (o) {
    o = o || {};
    var size = texSize(512);
    return cached('shingles' + JSON.stringify(o) + size, function () {
      var c = mkCanvas(size), x = c.getContext('2d'), rng = U.rng(7), rows = 10, rh = size / rows, base = o.base || '#5e4636';
      x.fillStyle = shade(base, 0.4); x.fillRect(0, 0, size, size);
      for (var r = 0; r < rows; r++) { var xx = (r % 2) * -rh * 0.6; while (xx < size) { var w = rh * (0.8 + rng() * 0.9); var g = x.createLinearGradient(0, r * rh, 0, r * rh + rh); var cc = shade(base, 0.75 + rng() * 0.5); g.addColorStop(0, shade(cc, 0.7)); g.addColorStop(1, cc); x.fillStyle = g; x.fillRect(xx + 1, r * rh, w - 2, rh * 1.05); x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(xx + 1, r * rh + rh - 3, w - 2, 3); xx += w; } }
      strands(x, size, size, 2500, rng, { len: [6, 20], alpha: 0.15, spread: 0.1 });
      noiseOverlay(x, size, size, 4, 4, 0.4, 5, 'soft-light');
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  TX.stone = function (o) {
    o = o || {};
    var size = texSize(512);
    return cached('stone' + JSON.stringify(o) + size, function () {
      var c = mkCanvas(size), x = c.getContext('2d'), rng = U.rng(17);
      x.fillStyle = '#4a4740'; x.fillRect(0, 0, size, size);
      var rows = 8, rh = size / rows;
      for (var r = 0; r < rows; r++) { var xx = (r % 2) * rh * 0.5 - rh; while (xx < size) { var w = rh * (1 + rng() * 0.9), cc = ['#8a867c', '#7a756b', '#9a958a', '#6f6a62'][Math.floor(rng() * 4)]; x.fillStyle = cc; x.beginPath(); x.ellipse(xx + w / 2, r * rh + rh / 2, w / 2 - 2, rh / 2 - 2, (rng() - 0.5) * 0.2, 0, 6.283); x.fill(); x.fillStyle = 'rgba(255,255,255,.08)'; x.beginPath(); x.ellipse(xx + w / 2 - 3, r * rh + rh / 2 - 3, w / 3, rh / 4, 0, 0, 6.283); x.fill(); xx += w; } }
      noiseOverlay(x, size, size, 6, 4, 0.45, 9, 'soft-light');
      var t = finishTex(new THREE.CanvasTexture(c)); t.userData.canvas = c; return t;
    });
  };
  /** Fallen log / stump builder using the vegetation atlas bark. o: {len:4, r:0.28, seed, stump:false} */
  TREES.log = function (o) {
    o = o || {};
    return cached('log:' + JSON.stringify(o), function () {
      var rng = U.rng(o.seed || 2), buf = new MeshBuf(), R = ATLAS_R.barkPine, C = new THREE.Vector3(0, 2, 0);
      if (o.stump) { addTrunk(buf, [[0, -0.1, 0], [0, (o.h || 0.5) * 0.5, 0], [0, o.h || 0.5, 0]], [(o.r || 0.3) * 1.3, o.r || 0.3, (o.r || 0.3) * 0.96], R, 9, 0.6, 0.9, 2); }
      else {
        var L = o.len || 4, r = o.r || 0.28, pts = [], rad = [];
        for (var i = 0; i <= 4; i++) { var t = i / 4; pts.push([-L / 2 + L * t, r * 0.85 + (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.06]); rad.push(r * (1.08 - t * 0.25)); }
        addTrunk(buf, pts, rad, R, 9, 0.62, 0.85, 2);
        _cp.set(L * 0.1, r * 1.4, 0); _cx.set(0.3, 0.9, 0.2).normalize(); _cy.set(1, 0, 0);
        cardStrip(buf, _cp, _cx, _cy, 0.9, 0.6, 1, 0, ATLAS_R.twigs, C, 0.7, 0.85, 0.3);
      }
      return { geometry: finishVeg(buf), material: G.vegMaterial('tree'), castShadow: true };
    });
  };

  /* ---------------- whitetail deer + cottontail templates ---------------- */
  function cl(c, hex) { return c.set(hex); }
  function deerSpec(buck) {
    var k = buck ? 1 : 0.93, L = function (v) { return v * k; };
    var poll = [0, L(1.34), L(-0.78)];
    var hd = new THREE.Vector3(0, -0.62, -0.785).normalize(); // head axis (forward/down)
    function hp(t, up) { return [0, poll[1] + hd.y * t * k + (up || 0) * k, poll[2] + hd.z * t * k]; }
    var spine = [
      { p: [0, L(0.84), L(0.67)], w: L(0.13), hUp: L(0.07), hDown: L(0.1) },
      { p: [0, L(0.83), L(0.56)], w: L(0.27), hUp: L(0.12), hDown: L(0.19), bone: 'pelvis' },
      { p: [0, L(0.81), L(0.36)], w: L(0.3), hUp: L(0.14), hDown: L(0.19) },
      { p: [0, L(0.79), L(0.12)], w: L(0.31), hUp: L(0.155), hDown: L(0.195), bone: 'spine' },
      { p: [0, L(0.795), L(-0.12)], w: L(0.31), hUp: L(0.18), hDown: L(0.235) },
      { p: [0, L(0.81), L(-0.3)], w: L(0.29), hUp: L(0.19), hDown: L(0.245), bone: 'chest' },
      { p: [0, L(0.85), L(-0.44)], w: L(0.23), hUp: L(0.15), hDown: L(0.22) },
      { p: [0, L(0.95), L(-0.54)], w: L(buck ? 0.18 : 0.155), hUp: L(0.1), hDown: L(0.15), bone: 'neck1' },
      { p: [0, L(1.08), L(-0.62)], w: L(buck ? 0.145 : 0.12), hUp: L(0.075), hDown: L(0.105) },
      { p: [0, L(1.2), L(-0.7)], w: L(buck ? 0.125 : 0.105), hUp: L(0.065), hDown: L(0.085), bone: 'neck2' },
      { p: [0, L(1.3), L(-0.76)], w: L(0.11), hUp: L(0.06), hDown: L(0.072) },
      { p: poll, w: L(0.1), hUp: L(0.055), hDown: L(0.06) }
    ];
    var head = [
      { p: hp(-0.045, 0.01), w: L(0.085), hUp: L(0.05), hDown: L(0.05) },
      { p: hp(0.01, 0.012), w: L(0.12), hUp: L(0.062), hDown: L(0.07) },
      { p: hp(0.07, 0.008), w: L(0.13), hUp: L(0.06), hDown: L(0.068) },
      { p: hp(0.13, 0.0), w: L(0.1), hUp: L(0.047), hDown: L(0.06) },
      { p: hp(0.19, -0.006), w: L(0.074), hUp: L(0.038), hDown: L(0.05) },
      { p: hp(0.245, -0.01), w: L(0.062), hUp: L(0.033), hDown: L(0.043) },
      { p: hp(0.285, -0.012), w: L(0.058), hUp: L(0.03), hDown: L(0.037) },
      { p: hp(0.305, -0.012), w: L(0.04), hUp: L(0.02), hDown: L(0.025) }
    ];
    var FR = [
      { p: [L(0.1), L(0.86), L(-0.34)], r: L(0.06) },
      { p: [L(0.115), L(0.72), L(-0.4)], rx: L(0.062), rz: L(0.085) },
      { p: [L(0.112), L(0.55), L(-0.34)], rx: L(0.045), rz: L(0.055) },
      { p: [L(0.1), L(0.3), L(-0.355)], rx: L(0.026), rz: L(0.034) },
      { p: [L(0.1), L(0.085), L(-0.37)], rx: L(0.02), rz: L(0.025) },
      { p: [L(0.1), L(0.02), L(-0.395)], rx: L(0.019), rz: L(0.024) }
    ];
    var BR = [
      { p: [L(0.09), L(0.86), L(0.48)], r: L(0.08) },
      { p: [L(0.115), L(0.76), L(0.47)], rx: L(0.085), rz: L(0.125) },
      { p: [L(0.12), L(0.55), L(0.33)], rx: L(0.06), rz: L(0.085) },
      { p: [L(0.1), L(0.38), L(0.5)], rx: L(0.03), rz: L(0.048) },
      { p: [L(0.1), L(0.095), L(0.45)], rx: L(0.02), rz: L(0.026) },
      { p: [L(0.1), L(0.02), L(0.425)], rx: L(0.019), rz: L(0.024) }
    ];
    var COAT = buck ? '#86684b' : '#8f7255', BACK = buck ? '#62492f' : '#6d5439', LEGC = '#9c7f60', WHITE = '#f1ece3', NOSE = '#161212', FACE = buck ? '#59432f' : '#6d543c';
    var A = new THREE.Color(), B = new THREE.Color();
    function coat(c, x, y, z, nx, ny, nz, part, u, v) {
      if (part === 'hoof') return cl(c, '#1c1713');
      if (part === 'ear') { if (u > 0.5) { A.set('#efe6da'); B.set('#4a3a2c'); return c.copy(A).lerp(B, U.smooth(0.55, 0.95, Math.abs(x) > 0 ? 0 : 0)); } A.set('#7e6650'); return c.copy(A).lerp(B.set('#3c2e22'), U.smooth(0.82, 1, v)); }
      if (part === 'tail') { A.set(BACK); if (ny < -0.1 || nz > 0.6 && ny < 0.3) A.lerp(B.set(WHITE), U.smooth(-0.1, -0.5, ny) + (nz > 0.6 ? 0.2 : 0)); if (Math.abs(nx) > 0.75) A.lerp(B.set('#3d2b1c'), 0.5); return c.copy(A); }
      A.set(COAT).lerp(B.set(BACK), U.smooth(0.35, 0.95, ny));
      if (part === 'body') {
        A.lerp(B.set(WHITE), U.smooth(-0.35, -0.75, ny) * U.smooth(0.62, 0.5, z) * U.smooth(-0.62, -0.5, z));
        A.lerp(B.set('#a58665'), U.smooth(0.0, -0.35, ny) * 0.35);
        // white throat patch high on the neck, under the jaw
        if (y > L(1.12)) A.lerp(B.set(WHITE), U.smooth(-0.15, -0.6, ny + nz * 0.6) * U.smooth(L(1.12), L(1.25), y));
        // white under the tail / inner rump
        if (z > L(0.6)) A.lerp(B.set(WHITE), U.smooth(0.2, 0.75, Math.abs(nz)) * U.smooth(L(0.88), L(0.78), y) * 0.7);
        if (z > L(0.58) && y > L(0.8)) A.lerp(B.set('#5a4330'), 0.2);
      } else if (part === 'head') {
        var t = ((y - poll[1]) * hd.y + (z - poll[2]) * hd.z) / k;
        A.lerp(B.set(FACE), U.smooth(0.3, 0.85, ny) * U.smooth(-0.02, 0.12, t) * 0.75);
        A.lerp(B.set('#9a826a'), U.smooth(0.17, 0.25, t) * 0.5);
        var band = U.smooth(0.235, 0.25, t) * U.smooth(0.29, 0.272, t);
        A.lerp(B.set(WHITE), band * 0.92 + U.smooth(0.0, -0.7, ny) * U.smooth(0.17, 0.26, t) * 0.9);
        if (t > 0.276) A.lerp(B.set(NOSE), U.smooth(0.276, 0.29, t) * U.smooth(-0.5, 0.2, ny + 0.4));
        var ex = Math.abs(x) - L(0.057), ey = y - (poll[1] + hd.y * 0.07 * k + 0.03 * k), ez = z - (poll[2] + hd.z * 0.07 * k);
        var ed = Math.sqrt(ex * ex * 2 + ey * ey + ez * ez); A.lerp(B.set('#e9e2d4'), U.smooth(0.03, 0.018, ed) * 0.8);
      } else {
        var front = part === 'legF';
        A.lerp(B.set(LEGC), U.smooth(L(0.5), L(0.3), y) * 0.8);
        A.lerp(B.set(WHITE), U.smooth(0.2, 0.8, -nx * (x > 0 ? 1 : -1)) * U.smooth(L(0.7), L(0.45), y) * 0.65);
        if (!front) A.lerp(B.set('#4a3626'), U.smooth(0.03, 0.0, Math.abs(y - L(0.37))) * U.smooth(0.3, 0.8, nz) * 0.6);
        A.lerp(B.set('#3a2b20'), U.smooth(L(0.14), L(0.05), y) * 0.55);
      }
      return c.copy(A);
    }
    var spec = {
      key: buck ? 'whitetail_buck' : 'whitetail_doe', spine: spine, head: head, legs: { FR: FR, BR: BR },
      hoof: { w: L(0.046), l: L(0.062), h: L(0.05) },
      ears: { p: [L(0.05), poll[1] + L(0.035), poll[2] + L(0.01)], len: L(0.16), width: L(0.085), cup: 0.42, tip: 0.55, rot: [0.25, 0.25, -0.95] },
      tail: { p: [0, L(0.88), L(0.66)], len: L(0.24), w: L(0.105), h: L(0.04), droop: 1.3 },
      eyes: { p: [L(0.058), poll[1] + hd.y * 0.07 * k + L(0.028), poll[2] + hd.z * 0.07 * k], r: L(0.017), rot: 0.5, color: '#120c08' },
      nose: { p: [0, poll[1] + hd.y * 0.302 * k - L(0.006), poll[2] + hd.z * 0.302 * k], r: L(0.022), sx: 1.2, sy: 0.75, sz: 0.65 },
      coat: coat, fur: { strokes: 13000, length: [5, 12], alpha: 0.28 }, roughness: 0.86, density: 2.6,
      gaits: ['walk', 'trot', 'gallop'], speeds: [2.1, 4.8],
      poses: { idle: [0, 0, 0], walk: [-0.2, -0.02, 0.1], run: [-0.42, -0.05, 0.28], alert: [0.18, 0.08, -0.12], graze: [-1.22, -0.42, 0.62] },
      tailLift: 2.0, earFwd: 0.4, lodDist: 46,
      attach: buck ? function () {
        var out = [], base = [L(0.042), poll[1] + L(0.062), poll[2] + L(0.03)];
        [2, 3, 4].forEach(function (tines) {
          var s = 0.85 + tines * 0.08, geos = [];
          [1, -1].forEach(function (sd) {
            var b = [base[0] * sd, base[1], base[2]];
            function P(x, y, z) { return [b[0] + sd * x * s, b[1] + y * s, b[2] + z * s]; }
            var spec2 = { base: b, beam: [P(0.05, 0.07, 0.05), P(0.14, 0.13, 0.04), P(0.19, 0.15, -0.06), P(0.16, 0.14, -0.18), P(0.08, 0.13, -0.25)], r: [0.021 * s, 0.006], seg: 18, radial: 7,
              tines: [{ t: 0.08, dir: [sd * 0.15, 1, -0.35], len: 0.07 * s, r: 0.009 }] };
            if (tines >= 2) spec2.tines.push({ t: 0.4, dir: [-sd * 0.05, 1, 0.08], len: 0.2 * s, r: 0.011, bend: [-sd * 0.02, 0, -0.02] });
            if (tines >= 3) spec2.tines.push({ t: 0.62, dir: [-sd * 0.12, 1, 0.05], len: 0.16 * s, r: 0.01, bend: [-sd * 0.02, 0, -0.02] });
            if (tines >= 4) spec2.tines.push({ t: 0.8, dir: [-sd * 0.2, 1, 0.0], len: 0.11 * s, r: 0.008 });
            var gg = G.antler(spec2, 1); geos.push(gg);
          });
          var ag = G.merge(geos);
          G.paint(ag, function (c, x, y, z) { var hgt = (y - base[1]) / (0.3 * s); c.set('#5d4630').lerp(A.set('#ede4cf'), U.smooth(0.0, 0.75, hgt)); });
          out.push({ bone: 'head', geometry: ag, material: G.mat({ map: TX.antler(), vertexColors: true, roughness: 0.55, key: 'antler' }), variant: tines });
        });
        return out;
      } : null
    };
    return spec;
  }
  G.deerSpec = deerSpec;
  function rabbitSpec() {
    var poll = [0, 0.205, -0.17], hd = new THREE.Vector3(0, -0.42, -0.9).normalize();
    function hp(t, up) { return [0, poll[1] + hd.y * t + (up || 0), poll[2] + hd.z * t]; }
    var FUR = '#8c7a64', BACK = '#6d5e4c', BELLY = '#ece6da', WHITE = '#f7f4ee', A = new THREE.Color(), B = new THREE.Color();
    return {
      key: 'cottontail',
      spine: [
        { p: [0, 0.12, 0.14], w: 0.09, hUp: 0.05, hDown: 0.06 },
        { p: [0, 0.135, 0.09], w: 0.16, hUp: 0.085, hDown: 0.08, bone: 'pelvis' },
        { p: [0, 0.145, 0.02], w: 0.165, hUp: 0.09, hDown: 0.085, bone: 'spine' },
        { p: [0, 0.14, -0.06], w: 0.14, hUp: 0.08, hDown: 0.08, bone: 'chest' },
        { p: [0, 0.145, -0.12], w: 0.11, hUp: 0.06, hDown: 0.065 },
        { p: [0, 0.165, -0.15], w: 0.085, hUp: 0.045, hDown: 0.05, bone: 'neck1' },
        { p: [0, 0.188, -0.163], w: 0.075, hUp: 0.04, hDown: 0.042, bone: 'neck2' },
        { p: poll, w: 0.07, hUp: 0.037, hDown: 0.038 }
      ],
      head: [
        { p: hp(-0.015, 0.004), w: 0.066, hUp: 0.038, hDown: 0.038 },
        { p: hp(0.02, 0.006), w: 0.084, hUp: 0.047, hDown: 0.048 },
        { p: hp(0.05, 0.003), w: 0.074, hUp: 0.04, hDown: 0.045 },
        { p: hp(0.075, -0.002), w: 0.052, hUp: 0.03, hDown: 0.033 },
        { p: hp(0.092, -0.004), w: 0.032, hUp: 0.018, hDown: 0.02 },
        { p: hp(0.1, -0.005), w: 0.016, hUp: 0.008, hDown: 0.01 }
      ],
      legs: {
        FR: [{ p: [0.03, 0.12, -0.09], r: 0.022 }, { p: [0.036, 0.095, -0.105], r: 0.02 }, { p: [0.036, 0.06, -0.1], r: 0.015 }, { p: [0.034, 0.03, -0.115], r: 0.011 }, { p: [0.034, 0.012, -0.13], r: 0.01 }, { p: [0.034, 0.008, -0.15], r: 0.009 }],
        BR: [{ p: [0.045, 0.14, 0.09], r: 0.04 }, { p: [0.058, 0.12, 0.07], rx: 0.042, rz: 0.055 }, { p: [0.066, 0.06, 0.01], rx: 0.03, rz: 0.035 }, { p: [0.062, 0.022, 0.1], rx: 0.016, rz: 0.02 }, { p: [0.058, 0.012, 0.02], rx: 0.015, rz: 0.012 }, { p: [0.056, 0.01, -0.035], rx: 0.013, rz: 0.01 }]
      },
      feet: false,
      ears: { p: [0.022, poll[1] + 0.03, poll[2] + 0.012], len: 0.085, width: 0.038, cup: 0.55, tip: 0.1, rot: [0.25, 0.15, -0.2] },
      tail: { p: [0, 0.135, 0.14], len: 0.06, w: 0.06, h: 0.055, droop: -0.4, bushy: true },
      eyes: { p: [0.031, poll[1] + hd.y * 0.035 + 0.012, poll[2] + hd.z * 0.035], r: 0.0105, rot: 0.6, color: '#0e0906' },
      nose: { p: [0, poll[1] + hd.y * 0.098 - 0.002, poll[2] + hd.z * 0.098], r: 0.008, color: '#c99a95', sx: 1.1, sy: 0.7, sz: 0.6 },
      coat: function (c, x, y, z, nx, ny, nz, part, u) {
        if (part === 'tail') return cl(c, WHITE);
        if (part === 'ear') { if (u > 0.5) return cl(c, '#d7b3a5'); A.set(BACK); return c.copy(A); }
        A.set(FUR).lerp(B.set(BACK), U.smooth(0.4, 0.95, ny));
        A.lerp(B.set(BELLY), U.smooth(-0.3, -0.75, ny));
        if (part === 'head') { var t = (y - poll[1]) * hd.y + (z - poll[2]) * hd.z; A.lerp(B.set('#b5a089'), U.smooth(0.05, 0.09, t) * 0.4); var ex = Math.abs(x) - 0.031, ey = y - (poll[1] + hd.y * 0.035 + 0.012), ez = z - (poll[2] + hd.z * 0.035); A.lerp(B.set('#e8dfd0'), U.smooth(0.017, 0.01, Math.sqrt(ex * ex * 2 + ey * ey + ez * ez)) * 0.7); }
        if (part === 'legF' || part === 'legH') A.lerp(B.set('#c9b8a0'), U.smooth(0.05, 0.015, y) * 0.6);
        if (part === 'body' && z < -0.12 && y > 0.15) A.lerp(B.set('#a56a3e'), 0.25 * U.smooth(0.0, 0.6, ny));
        return c.copy(A);
      },
      fur: { strokes: 16000, length: [4, 9], alpha: 0.3, seed: 33 }, roughness: 0.9, density: 9,
      gaits: ['hop', 'hop', 'hop'], speeds: [50, 60], strideMul: 6.5, swingF: 0.5, swingH: 0.55,
      flexF: [0.3, -0.9, -0.4], flexH: [-0.4, 0.9, -0.5],
      poses: { idle: [0, 0, 0], walk: [-0.1, 0, 0.05], run: [-0.25, 0, 0.15], alert: [0.25, 0.15, -0.15], graze: [-0.55, -0.2, 0.35] },
      tailLift: 0.6, tailFlag: 1, earFwd: -0.15, lodDist: 22, ao: 0.8
    };
  }
  G.rabbitSpec = rabbitSpec;

  /* ------------------------------------------------------------------
   * Renderer, scenes, cameras
   * ------------------------------------------------------------------ */
  var viewEl = document.getElementById('hg-view');
  var rootEl = document.getElementById('hg-root');
  /** Graphics level: 'low' (phones: Lambert, no shadows, LOD, fewer instances) | 'high' (Standard + IBL, soft shadows) | 'ultra' (desktop: 2048 shadows, more grass, longer view) */
  function qualityLevel(g) { return g === 'low' ? 'low' : g === 'ultra' ? 'ultra' : 'high'; }
  HG.quality = { low: HG.settings.graphics === 'low', level: qualityLevel(HG.settings.graphics), high: HG.settings.graphics !== 'low', ultra: HG.settings.graphics === 'ultra' };
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    try { renderer = new THREE.WebGLRenderer({ antialias: false }); } catch (e2) { renderer = null; }
  }
  HG.renderer = renderer;
  if (!renderer) {
    rootEl.insertAdjacentHTML('beforeend', '<div class="hg-screen" style="display:flex;align-items:center;justify-content:center;text-align:center"><div class="hg-panel" style="padding:24px;max-width:420px"><h2 class="hg-title">WebGL unavailable</h2><p>Wildwood Hunter needs WebGL. Try another browser or enable hardware acceleration.</p></div></div>');
    return;
  }
  renderer.autoClear = false;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.info.autoReset = false;
  G.exposure = 0.8;
  // subtle colour grade applied after ACES (cool shadows, warm highlights, +8% saturation)
  (function () {
    var ch = THREE.ShaderChunk.tonemapping_pars_fragment, re = /(vec3 ACESFilmicToneMapping\( vec3 color \) \{[\s\S]*?)return saturate\( color \);/;
    if (re.test(ch)) {
      THREE.ShaderChunk.tonemapping_pars_fragment = ch.replace(re, '$1return hgGrade( saturate( color ) );').replace('vec3 ACESFilmicToneMapping( vec3 color ) {',
        'vec3 hgGrade( vec3 c ) { float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); c = mix( vec3( l ), c, 1.08 ); c *= mix( vec3( 0.97, 0.99, 1.03 ), vec3( 1.03, 1.0, 0.965 ), smoothstep( 0.08, 0.75, l ) ); return clamp( c, 0.0, 1.0 ); }\nvec3 ACESFilmicToneMapping( vec3 color ) {');
    }
  })();
  viewEl.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Wildwood Hunter game view');

  HG.scene = new THREE.Scene();
  HG.scene.fog = new THREE.Fog(0xcfe0dc, 60, 260);
  HG.camera = new THREE.PerspectiveCamera(HG.config.baseFov, 1, 0.1, 1400);
  HG.camera.rotation.order = 'YXZ';
  HG.scene.add(HG.camera);
  /** View-model pass: a separate scene rendered after a depth clear so weapons never clip into terrain. */
  HG.viewScene = new THREE.Scene();
  HG.viewCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 20);
  HG.viewModel = new THREE.Group();
  HG.viewModel.name = 'viewModel';
  HG.viewScene.add(HG.viewModel);
  var vmHemi = new THREE.HemisphereLight(0xfff4e0, 0x4a5a3a, 0.75); HG.viewScene.add(vmHemi);
  var vmSun = new THREE.DirectionalLight(0xffffff, 0.8); vmSun.position.set(0.6, 1, 0.4); HG.viewScene.add(vmSun);
  HG.viewLights = { hemi: vmHemi, sun: vmSun };

  HG.applyGraphics = function () {
    var lvl = qualityLevel(HG.settings.graphics), low = lvl === 'low', prev = HG.quality.level;
    var changed = lvl !== prev;
    if (HG.booted && changed) HG._mapDirty = true; // materials + vegetation density are decided at build time
    HG.quality.low = low; HG.quality.level = lvl; HG.quality.high = !low; HG.quality.ultra = lvl === 'ultra';
    var pr = Math.min(window.devicePixelRatio || 1, low ? 1 : lvl === 'ultra' ? 2 : 1.5);
    renderer.setPixelRatio(pr);
    var wantShadows = !low;
    if (renderer.shadowMap.enabled !== wantShadows) {
      renderer.shadowMap.enabled = wantShadows;
      HG.scene.traverse(function (o) { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; }); } });
    }
    if (G.configureShadows) G.configureShadows(lvl);
    if (HG.env && HG.env.sun) HG.env.sun.castShadow = wantShadows;
    if (G.sky) { var oct = low ? 3 : 5; if (G.sky.material.defines.CLOUD_OCT !== oct) { G.sky.material.defines.CLOUD_OCT = oct; G.sky.material.needsUpdate = true; } }
    if (G.markEnvDirty) { G.markEnvDirty(); if (HG.booted) G.updateEnvMap(true); }
    HG.resize();
    if (HG.booted && changed && HG.state !== 'hunt' && HG.mapId) {
      // rebuild the backdrop with the new quality right away
      HG.loadMap(HG.mapId); HG._mapDirty = false;
      if (HG.state === 'menu') menuAnimals();
      if (HG.env) HG.env.apply();
    }
  };
  HG.resize = function () {
    var w = Math.max(1, viewEl.clientWidth || window.innerWidth), h = Math.max(1, viewEl.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    HG.camera.aspect = w / h; HG.camera.updateProjectionMatrix();
    HG.viewCamera.aspect = w / h;
    // keep the view model a consistent size in portrait
    HG.viewCamera.fov = w < h ? 80 : 58;
    HG.viewCamera.updateProjectionMatrix();
    HG.portrait = h > w;
    rootEl.classList.toggle('portrait', HG.portrait);
    HG.emit('resize', w, h);
  };
  window.addEventListener('resize', function () { HG.resize(); });
  window.addEventListener('orientationchange', function () { setTimeout(HG.resize, 200); });

  /* ------------------------------------------------------------------
   * Sky, lights, environment (day/night). Shader sky (HG.gfx.sky), sun + hemisphere,
   * soft shadows that follow the player (High/Ultra), PMREM sky environment (IBL).
   * worlds.js may tune HG.gfx.sky.params per map/weather or wrap HG.env.apply.
   * ------------------------------------------------------------------ */
  var skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(0x4f8fd0) }, bottom: { value: new THREE.Color(0xcfe0dc) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(0xfff0d0) }, sunVis: { value: 1 },
      moonDir: { value: new THREE.Vector3(0, -1, 0) }, moonVis: { value: 0 }, starVis: { value: 0 }, time: { value: 0 },
      cloudCover: { value: 0.45 }, cloudScale: { value: 0.85 }, cloudWind: { value: new THREE.Vector2(0.004, 0.0025) },
      cloudColor: { value: new THREE.Color(0xffffff) }, cloudShade: { value: new THREE.Color(0x9aa6b4) }, cloudSharp: { value: 0.3 },
      haze: { value: 0.55 }, glow: { value: 1 }, groundColor: { value: new THREE.Color(0x3c4636) }, sunSize: { value: 0.99965 }
    },
    defines: { CLOUD_OCT: 5 },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunVis;',
      'uniform vec3 moonDir; uniform float moonVis; uniform float starVis; uniform float time;',
      'uniform float cloudCover; uniform float cloudScale; uniform vec2 cloudWind; uniform vec3 cloudColor; uniform vec3 cloudShade; uniform float cloudSharp;',
      'uniform float haze; uniform float glow; uniform vec3 groundColor; uniform float sunSize; varying vec3 vDir;',
      'float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
      'float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
      ' return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }',
      'float fbm(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < CLOUD_OCT; i++) { s += a * vn(p); p = p * 2.07 + vec2(1.7, 9.2); a *= 0.5; } return s; }',
      'void main(){',
      ' vec3 d = normalize(vDir); float h = d.y; float hp = max(h, 0.0);',
      ' vec3 col = mix(bottom, top, pow(hp, 0.48));',
      ' col = mix(col, bottom, haze * exp(-hp * 14.0));',
      ' float sd = dot(d, sunDir); float sdp = max(sd, 0.0);',
      ' float horizonK = 0.55 + 0.45 * (1.0 - hp);',
      ' col += sunColor * sunVis * (pow(sdp, 5.0) * 0.16 * glow + pow(sdp, 42.0) * 0.32 + pow(sdp, 600.0) * 0.8) * horizonK;',
      ' col += sunColor * sunVis * smoothstep(sunSize - 0.00012, sunSize, sd) * 1.6;',
      ' if (starVis > 0.01 && h > 0.0) {',
      '  vec2 g = vec2(atan(d.z, d.x) * 95.0, asin(h) * 95.0); vec2 c = floor(g); float r = h21(c);',
      '  if (r > 0.986) { vec2 f = fract(g) - 0.5 - (vec2(h21(c + 7.1), h21(c + 3.3)) - 0.5) * 0.6;',
      '   float s = smoothstep(0.16, 0.0, length(f)) * (r - 0.986) / 0.014 * (0.65 + 0.35 * sin(time * 2.7 + r * 300.0));',
      '   col += vec3(0.9, 0.95, 1.0) * s * starVis * smoothstep(0.0, 0.25, h); }',
      ' }',
      ' float md = dot(d, moonDir);',
      ' col += vec3(0.32, 0.38, 0.5) * pow(max(md, 0.0), 120.0) * 0.35 * moonVis;',
      ' col = mix(col, vec3(0.93, 0.93, 0.88), smoothstep(0.99935, 0.99952, md) * moonVis);',
      ' if (h > 0.0 && cloudCover > 0.01) {',
      '  vec2 uv = d.xz / (h + 0.09) * cloudScale + cloudWind * time;',
      '  float n = fbm(uv);',
      '  #if CLOUD_OCT > 3',
      '  n = n * 0.72 + fbm(uv * 2.6 + 3.1) * 0.28;',
      '  #endif',
      '  float cov = smoothstep(1.0 - cloudCover - cloudSharp * 0.4, 1.0 - cloudCover + cloudSharp, n);',
      '  cov *= smoothstep(0.0, 0.14, h);',
      '  float ns = fbm(uv + sunDir.xz * 0.16);',
      '  float lit = clamp(0.58 + (n - ns) * 2.6, 0.0, 1.0);',
      '  vec3 cc = mix(cloudShade, cloudColor, lit);',
      '  cc += sunColor * sunVis * pow(sdp, 9.0) * 0.55 * (1.0 - cov * 0.7);',
      '  cc = mix(cc, bottom, (1.0 - smoothstep(0.0, 0.35, h)) * 0.55);',
      '  col = mix(col, cc, cov * 0.94);',
      ' }',
      ' if (h < 0.0) col = mix(bottom, groundColor, smoothstep(0.0, -0.2, h));',
      ' float mxc = max(col.r, max(col.g, col.b)); if (mxc > 1.0) col /= mxc;',
      ' col += (h21(gl_FragCoord.xy + fract(time)) - 0.5) / 255.0;',
      ' gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n'),
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
  });
  skyMat.userData.shared = true;
  var sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
  sky.renderOrder = -1000; sky.frustumCulled = false; sky.name = 'sky';
  HG.scene.add(sky);
  /** HG.gfx.sky: the sky dome. params are applied by HG.env.apply (worlds.js may change them per map/weather):
   *  cloudCover 0..1, cloudScale, cloudSpeed (multiplier), cloudSharp, haze 0..1, glow, starBrightness, tint (sRGB colour mixed into the sky) + tintAmount */
  G.sky = { mesh: sky, material: skyMat, uniforms: skyMat.uniforms,
    params: { cloudCover: 0.42, cloudScale: 0.85, cloudSpeed: 1, cloudSharp: 0.3, haze: 0.55, glow: 1, starBrightness: 1, tint: null, tintAmount: 0 } };

  var hemi = new THREE.HemisphereLight(0xdfefff, 0x5a6b3a, 0.6);
  HG.scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xfff1d6, 1.0);
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -34; sun.shadow.camera.right = 34; sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 20; sun.shadow.camera.far = 320; sun.shadow.bias = -0.0006;
  if ('normalBias' in sun.shadow) sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2;
  HG.scene.add(sun); HG.scene.add(sun.target);
  G.sun = sun; G.hemi = hemi;
  /** shadow tuning per quality (called by applyGraphics) */
  G.configureShadows = function (level) {
    var size = level === 'ultra' ? 2048 : 1024, ext = level === 'ultra' ? 46 : 32;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    sun.shadow.camera.left = -ext; sun.shadow.camera.right = ext; sun.shadow.camera.top = ext; sun.shadow.camera.bottom = -ext;
    sun.shadow.camera.updateProjectionMatrix();
    G.shadowExtent = ext;
  };
  G.shadowExtent = 32;

  // legacy cloud group (kept for API compatibility; clouds are drawn by the sky shader now)
  var clouds = new THREE.Group(); clouds.name = 'clouds';
  clouds.userData.mat = new THREE.MeshBasicMaterial({ color: 0xffffff }); clouds.userData.mat.userData.shared = true;
  HG.scene.add(clouds);

  /* ---- PMREM sky environment (image based lighting for Standard materials) ---- */
  var envScene = new THREE.Scene();
  var envMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, ground: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, sunVis: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 bottom; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunVis; varying vec3 vDir;',
      'vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }',
      'void main(){ vec3 d = normalize(vDir); float h = d.y;',
      ' vec3 col = mix(lin(bottom), lin(top), pow(max(h, 0.0), 0.5));',
      ' float s = max(dot(d, sunDir), 0.0); col += lin(sunColor) * sunVis * (pow(s, 6.0) * 0.5 + pow(s, 60.0) * 2.0);',
      ' col = mix(col, lin(ground), smoothstep(0.02, -0.12, h));',
      ' gl_FragColor = linearToOutputTexel(vec4(col, 1.0)); }'
    ].join('\n'), side: THREE.BackSide, depthWrite: false, depthTest: false
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 24, 12), envMat));
  var pmrem = null, envRT = null, envDirty = true, envLastHour = -99, envT = 0;
  G.envMaterial = envMat;
  G.markEnvDirty = function () { envDirty = true; };
  function updateEnvMap(force) {
    if (G.isLow()) { if (HG.scene.environment) { HG.scene.environment = null; HG.viewScene.environment = null; } return; }
    if (!force && !envDirty && Math.abs(HG.env.hour - envLastHour) < 0.25) return;
    try {
      if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
      var rt = pmrem.fromScene(envScene, 0, 0.1, 100);
      if (envRT) envRT.dispose();
      envRT = rt;
      HG.scene.environment = rt.texture; HG.viewScene.environment = rt.texture;
      envDirty = false; envLastHour = HG.env.hour;
    } catch (e) { console.error('[HG] env map', e); HG.scene.environment = null; }
  }
  G.updateEnvMap = updateEnvMap;

  HG.wind = { dir: 0.6, speed: 2.5, vec: new THREE.Vector3(), target: 0.6, gust: 0 };
  function updateWindVec() { HG.wind.vec.set(-Math.sin(HG.wind.dir), 0, -Math.cos(HG.wind.dir)); }
  updateWindVec();

  HG.weatherTypes = {
    clear: { name: 'Clear', fogMult: 1, light: 1 }
  };
  // palette (sRGB) for the time of day
  var C_NIGHT_TOP = new THREE.Color('#050b1d'), C_NIGHT_BOT = new THREE.Color('#121c33'),
    C_DUSK_TOP = new THREE.Color('#3a5d98'), C_DUSK_BOT = new THREE.Color('#e9b089'), C_DAWN_BOT = new THREE.Color('#f0c4a2'),
    C_SUN_DAY = new THREE.Color('#fff3e0'), C_SUN_GOLD = new THREE.Color('#ffc27a'), C_SUN_SET = new THREE.Color('#ff8a4a'), C_MOON = new THREE.Color('#9fb4e6'),
    C_GREY = new THREE.Color('#8d969c');
  var dayTop = new THREE.Color(), dayBot = new THREE.Color(), _sc = new THREE.Color(), _sc2 = new THREE.Color();
  HG.env = {
    hour: HG.config.startHour, daySpeed: HG.config.daySpeed, weather: 'clear', frozen: false,
    sun: sun, hemi: hemi, sky: sky, skyMat: skyMat, clouds: clouds,
    sunDir: new THREE.Vector3(0, 1, 0), moonDir: new THREE.Vector3(0, -1, 0),
    skyTop: new THREE.Color(), skyBottom: new THREE.Color(), fogColor: new THREE.Color(), sunColor: new THREE.Color(),
    fogNear: 60, fogFar: 260, lightScale: 1, fogScale: 1, daylight: 1, dusk: 0,
    setHour: function (h) { HG.env.hour = ((h % 24) + 24) % 24; HG.env.apply(); HG.emit('hour', HG.env.hour); },
    isNight: function () { return HG.env.daylight < 0.25; },
    setWeather: function (id) {
      if (!HG.weatherTypes[id]) return false;
      var prev = HG.weatherTypes[HG.env.weather];
      if (prev && prev.stop) { try { prev.stop(); } catch (e) { console.error(e); } }
      HG.env.weather = id; var w = HG.weatherTypes[id];
      HG.env.lightScale = w.light == null ? 1 : w.light; HG.env.fogScale = w.fogMult == null ? 1 : w.fogMult;
      if (w.start) { try { w.start(); } catch (e) { console.error(e); } }
      envDirty = true;
      HG.env.apply(); HG.emit('weather', id); return true;
    },
    /** Recompute sky/fog/lights for the current hour + map + weather. worlds.js may wrap or replace this function. */
    apply: function () {
      var env = HG.env, map = HG.map, h = env.hour, P = G.sky.params, U2 = skyMat.uniforms;
      var ang = (h - 6) / 12 * PI, elevS = Math.sin(ang);
      var e = Math.asin(U.clamp(elevS * 0.9, -1, 1)), ce = Math.cos(e);
      env.sunDir.set(Math.cos(ang) * ce, Math.sin(e), (0.3 + 0.45 * Math.sin(Math.max(0, Math.min(PI, ang)))) * ce).normalize();
      env.moonDir.set(-env.sunDir.x, -env.sunDir.y * 0.9 + 0.1, -env.sunDir.z * 0.6 + 0.2).normalize();
      dayTop.set(map && map.skyTop || 0x4f8fd0);
      dayBot.set(map && (map.fog && map.fog.color) || map && map.skyBottom || 0xcfe0dc);
      var day = U.smooth(-0.1, 0.3, elevS);
      var dusk = elevS > -0.25 ? U.clamp(1 - Math.abs(elevS - 0.04) / 0.32, 0, 1) : 0;
      env.daylight = day; env.dusk = dusk;
      var ls = env.lightScale;
      // sky colours (sRGB)
      env.skyTop.copy(C_NIGHT_TOP).lerp(dayTop, day).lerp(C_DUSK_TOP, dusk * 0.45);
      env.skyBottom.copy(C_NIGHT_BOT).lerp(dayBot, day).lerp(h < 12 ? C_DAWN_BOT : C_DUSK_BOT, dusk * 0.6 * U.smooth(-0.2, 0.05, elevS));
      if (P.tint && P.tintAmount) { _sc.set(P.tint); env.skyTop.lerp(_sc, P.tintAmount); env.skyBottom.lerp(_sc, P.tintAmount * 0.8); }
      if (ls < 1) { _sc.copy(C_GREY).multiplyScalar(0.4 + 0.6 * day); env.skyBottom.lerp(_sc, (1 - ls) * 0.75); env.skyTop.lerp(_sc, (1 - ls) * 0.85); }
      env.fogColor.copy(env.skyBottom);
      // sun / moon light
      var sunUp = U.smooth(-0.06, 0.08, elevS);
      env.sunColor.copy(C_SUN_DAY).lerp(C_SUN_GOLD, U.smooth(0.45, 0.12, elevS)).lerp(C_SUN_SET, U.smooth(0.16, -0.02, elevS));
      U2.top.value.copy(env.skyTop); U2.bottom.value.copy(env.skyBottom);
      U2.sunDir.value.copy(env.sunDir); U2.sunColor.value.copy(env.sunColor).multiplyScalar(0.9 + 0.3 * dusk);
      U2.sunVis.value = sunUp * (0.25 + 0.75 * ls);
      U2.moonDir.value.copy(env.moonDir); U2.moonVis.value = (1 - day) * ls;
      U2.starVis.value = U.smooth(0.3, 0.0, day) * P.starBrightness * U.clamp(ls * 1.3 - 0.3, 0, 1);
      var cover = U.clamp(P.cloudCover + (1 - ls) * 0.6, 0, 1);
      U2.cloudCover.value = cover; U2.cloudScale.value = P.cloudScale; U2.cloudSharp.value = P.cloudSharp; U2.haze.value = P.haze; U2.glow.value = P.glow;
      U2.cloudColor.value.setRGB(1, 1, 1).lerp(env.sunColor, 0.25 + dusk * 0.45).multiplyScalar(0.18 + 0.82 * day).lerp(C_GREY, (1 - ls) * 0.5);
      U2.cloudShade.value.copy(env.skyBottom).lerp(env.skyTop, 0.35).multiplyScalar(0.72 + 0.1 * dusk);
      U2.groundColor.value.copy(env.skyBottom).multiplyScalar(0.55);
      HG.scene.fog.color.copy(env.fogColor);
      var f = map && map.fog || {}, ultra = HG.quality && HG.quality.level === 'ultra' ? 1.2 : 1;
      env.fogNear = (f.near || 60) * env.fogScale; env.fogFar = (f.far || 260) * env.fogScale * ultra;
      var nightFog = 0.72 + 0.28 * day;
      HG.scene.fog.near = env.fogNear * nightFog; HG.scene.fog.far = env.fogFar * nightFog;
      var low = G.isLow();
      if (elevS > -0.06) {
        sun.color.copy(env.sunColor).convertSRGBToLinear();
        sun.intensity = (0.15 + 1.85 * U.smooth(-0.04, 0.42, elevS)) * (0.3 + 0.7 * ls * ls) * (low ? 1.0 : 1);
        sun.position.copy(env.sunDir);
      } else {
        sun.color.copy(C_MOON).convertSRGBToLinear(); sun.intensity = 0.42 * ls;
        env.sunDir.copy(env.moonDir);
      }
      // ambient: hemisphere (all qualities) + sky IBL (High/Ultra)
      _sc.copy(env.skyTop).lerp(_sc2.setRGB(1, 1, 1), 0.3).convertSRGBToLinear();
      hemi.color.copy(_sc);
      hemi.groundColor.setRGB(0.36, 0.33, 0.22).lerp(_sc2.setRGB(0.05, 0.06, 0.1), 1 - day).convertSRGBToLinear();
      hemi.intensity = (low ? (0.5 + 0.45 * day) : (0.2 + 0.15 * day)) * (0.65 + 0.35 * ls) + (1 - day) * 0.25;
      renderer.toneMappingExposure = (G.exposure || 1.0) * (1 + (1 - day) * 0.35);
      // env map (sky IBL) source
      envMat.uniforms.top.value.copy(env.skyTop); envMat.uniforms.bottom.value.copy(env.skyBottom);
      envMat.uniforms.ground.value.setRGB(0.25, 0.24, 0.17).lerp(_sc2.setRGB(0.04, 0.05, 0.08), 1 - day).multiplyScalar(0.5 + 0.5 * ls);
      envMat.uniforms.sunDir.value.copy(env.sunDir); envMat.uniforms.sunColor.value.copy(env.sunColor); envMat.uniforms.sunVis.value = sunUp * ls;
      if (HG.mountains && HG.mountains.material.uniforms) { var mu = HG.mountains.material.uniforms; mu.haze.value.copy(env.fogColor); mu.sunDir.value.copy(env.sunDir); mu.sunColor.value.copy(env.sunColor).multiplyScalar(sunUp * ls * 0.9 + 0.1); mu.ambient.value.copy(env.skyTop).lerp(env.skyBottom, 0.5).multiplyScalar(0.25 + 0.55 * day); }
      if (HG.water && HG.water.material.uniforms && HG.water.material.uniforms.skyTop) {
        var wu = HG.water.material.uniforms; wu.skyTop.value.copy(env.skyTop); wu.skyHorizon.value.copy(env.skyBottom);
        wu.sunDir.value.copy(env.sunDir); wu.sunColor.value.copy(env.sunColor); wu.sunVis.value = sunUp * ls; wu.daylight.value = 0.12 + 0.88 * day;
      }
      if (G.nightGlow) for (var gi = 0; gi < G.nightGlow.length; gi++) G.nightGlow[gi].emissiveIntensity = U.smooth(0.55, 0.05, day) * 1.6;
      vmHemi.color.copy(hemi.color); vmHemi.groundColor.copy(hemi.groundColor); vmHemi.intensity = hemi.intensity * (low ? 1.05 : 1.2) + 0.08;
      vmSun.color.copy(sun.color); vmSun.intensity = Math.max(0.35, sun.intensity * 0.85);
      if (Math.abs(env.hour - envLastHour) > 0.25) envDirty = true;
    },
    /** Called every frame by core (game dt). worlds.js may wrap/replace. */
    update: function (dt) {
      var env = HG.env;
      if (!env.frozen) { env.hour += dt * env.daySpeed; if (env.hour >= 24) env.hour -= 24; }
      var w = HG.wind;
      if (Math.random() < dt * 0.05) w.target = w.dir + (Math.random() - 0.5) * 1.6;
      w.dir += U.angleDiff(w.dir, w.target) * Math.min(1, dt * 0.15);
      w.gust = U.damp(w.gust, Math.random() < dt * 0.3 ? Math.random() * 2 : 0, 0.6, dt);
      w.speed = U.clamp(2 + Math.sin(HG.time * 0.05) * 1.2 + w.gust, 0.3, 9);
      updateWindVec();
      envTick += dt; if (envTick > 0.5) { envTick = 0; env.apply(); }
      var w2 = HG.weatherTypes[env.weather]; if (w2 && w2.update) w2.update(dt);
    }
  };
  var envTick = 0;
  var _lsR = new THREE.Vector3(), _lsU = new THREE.Vector3(), _lsF = new THREE.Vector3(), _lsUp = new THREE.Vector3(0, 1, 0);
  /** Keep sky centred on the camera, the shadow frustum on the player (texel-snapped), animate sky/wind uniforms. Called every frame. */
  function followEnv(rdt) {
    sky.position.copy(HG.camera.position);
    skyMat.uniforms.time.value += rdt * G.sky.params.cloudSpeed * (0.4 + HG.wind.speed * 0.25);
    var wu = windUniforms; wu.uTime.value += rdt; wu.uWind.value.set(HG.wind.vec.x, HG.wind.vec.z, 0.35 + HG.wind.speed * 0.22);
    var pp = HG.state === 'hunt' ? player.pos : HG.camera.position;
    wu.uPlayer.value.copy(HG.state === 'hunt' ? player.pos : HG.camera.position);
    // shadow camera: centre ahead of the player, snapped to shadow-map texels to avoid shimmering
    _lsF.copy(HG.env.sunDir).negate();
    _lsR.crossVectors(_lsUp, _lsF); if (_lsR.lengthSq() < 1e-6) _lsR.set(1, 0, 0); _lsR.normalize();
    _lsU.crossVectors(_lsF, _lsR).normalize();
    var fx = -Math.sin(player.yaw) * (HG.state === 'hunt' ? G.shadowExtent * 0.35 : 0), fz = -Math.cos(player.yaw) * (HG.state === 'hunt' ? G.shadowExtent * 0.35 : 0);
    _v6.set(pp.x + fx, pp.y, pp.z + fz);
    var texel = (G.shadowExtent * 2) / sun.shadow.mapSize.x;
    var a = Math.round(_v6.dot(_lsR) / texel) * texel, b = Math.round(_v6.dot(_lsU) / texel) * texel, c = _v6.dot(_lsF);
    sun.target.position.set(0, 0, 0).addScaledVector(_lsR, a).addScaledVector(_lsU, b).addScaledVector(_lsF, c);
    sun.position.copy(sun.target.position).addScaledVector(HG.env.sunDir, 160);
    sun.target.updateMatrixWorld();
    // view-model sun follows the world sun direction (camera space)
    _q1.copy(HG.camera.quaternion).invert();
    vmSun.position.copy(HG.env.sunDir).applyQuaternion(_q1);
    envT -= rdt; if (envT <= 0) { envT = 1.0; updateEnvMap(false); }
  }

  /* ------------------------------------------------------------------
   * UI system (DOM overlays)
   * ------------------------------------------------------------------ */
  var ui = HG.ui = {};
  function svg(inner, opts) {
    return '<svg viewBox="0 0 24 24" fill="' + (opts && opts.fill ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="' + ((opts && opts.sw) || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  ui.svg = svg;
  /** Inline SVG icons (stroke = currentColor). Features may add more: HG.ui.icons.myIcon = HG.ui.svg('<path .../>') */
  ui.icons = {
    fire: svg('<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>', { sw: 2.4 }),
    aim: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>'),
    reload: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.5 3.5v5h-5"/>', { sw: 2.4 }),
    crouch: svg('<circle cx="13" cy="4.5" r="2.2"/><path d="M12.5 8l-2.5 5.5 4.5 1.8V21M10 13.5l-4 2.5M14.5 15.3l4.5-.8"/><path d="M12.5 8.3l3.5 3"/>'),
    sprint: svg('<circle cx="15.5" cy="4.2" r="2"/><path d="M6 21l3.5-5.5 3 2V22M9.5 15.5l2-6 4 3.5 3.5-1.2M11.5 9.5l-4.5.8-2 3"/>'),
    swap: svg('<path d="M4 8h15l-4-4M20 16H5l4 4"/>', { sw: 2.4 }),
    binoculars: svg('<circle cx="6.5" cy="15.5" r="4"/><circle cx="17.5" cy="15.5" r="4"/><path d="M5 11.5L7 5h3v7M19 11.5L17 5h-3v7M10 14h4"/>'),
    hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7s-5-1.5-6.5-4L3 13.5a1.5 1.5 0 0 1 2.5-1.6L8 15"/>'),
    pause: svg('<path d="M8.5 5v14M15.5 5v14"/>', { sw: 3.2 }),
    play: svg('<path d="M7 4.5l12.5 7.5L7 19.5z" />', { fill: true, sw: 1.5 }),
    cart: svg('<path d="M2.5 3.5h2.6l2.4 11.5h10.2l2.3-8H6.2"/><circle cx="9.5" cy="19.5" r="1.6"/><circle cx="16.5" cy="19.5" r="1.6"/>'),
    gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
    trophy: svg('<path d="M8 3.5h8v6a4 4 0 0 1-8 0z"/><path d="M8 5.5H4.5a3.5 3.5 0 0 0 3.8 4.4M16 5.5h3.5a3.5 3.5 0 0 1-3.8 4.4M12 13.5v4M8 21h8M9 17.5h6"/>'),
    antlers: svg('<path d="M12 21v-6M12 15c-3 0-5-2-6-5M6 10L3 7M6 10l-1-5M6 10l3-4M12 15c3 0 5-2 6-5M18 10l3-3M18 10l1-5M18 10l-3-4"/>'),
    paw: svg('<ellipse cx="12" cy="16" rx="4.5" ry="3.5" fill="currentColor"/><circle cx="6" cy="10" r="1.8" fill="currentColor"/><circle cx="9.5" cy="6.5" r="1.8" fill="currentColor"/><circle cx="14.5" cy="6.5" r="1.8" fill="currentColor"/><circle cx="18" cy="10" r="1.8" fill="currentColor"/>', { sw: 0 }),
    cash: svg('<rect x="2.5" y="6" width="19" height="12" rx="2.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="3" stroke="#14110d" stroke-width="2"/><path d="M5.5 9.5v5M18.5 9.5v5" stroke="#14110d"/>', { sw: 1.6 }),
    gold: svg('<path d="M6 4.5h12l3.5 5.5L12 20.5 2.5 10z" fill="currentColor" stroke="none"/><path d="M2.5 10h19M9 4.5l3 5.5 3-5.5M12 20.5L9 10M12 20.5L15 10" stroke="#7a5a10" stroke-width="1.3"/>', { sw: 1.3 }),
    lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
    back: svg('<path d="M15 4.5L7.5 12l7.5 7.5"/>', { sw: 2.8 }),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>', { sw: 2.8 }),
    check: svg('<path d="M4.5 12.5l5 5L19.5 7"/>', { sw: 2.8 }),
    foot: svg('<path d="M8.5 3c2 0 3 2.2 3 5s-.8 5-3 5-3-2.5-3-5 1-5 3-5z" fill="currentColor"/><path d="M15.5 10c1.8 0 2.8 2 2.8 4.5s-.8 4.5-2.8 4.5-2.8-2-2.8-4.5S13.7 10 15.5 10z" fill="currentColor"/>', { sw: 0 }),
    eye: svg('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    wind: svg('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>'),
    arrow: svg('<path d="M12 3l6 9h-4v9h-4v-9H6z" fill="currentColor"/>', { sw: 1 }),
    heart: svg('<path d="M12 20.5s-8-4.8-8-11A4.5 4.5 0 0 1 12 6.6 4.5 4.5 0 0 1 20 9.5c0 6.2-8 11-8 11z" fill="currentColor"/>', { sw: 1 }),
    bolt: svg('<path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z" fill="currentColor"/>', { sw: 1 }),
    pin: svg('<path d="M12 21.5s7-6.6 7-12a7 7 0 0 0-14 0c0 5.4 7 12 7 12z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>', { sw: 1 }),
    sound: svg('<path d="M4 9.5h3.5L12.5 5v14l-5-4.5H4z" fill="currentColor"/><path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>'),
    rotate: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M2.5 15a9 9 0 0 0 5 5.5M21.5 9a9 9 0 0 0-5-5.5M2 12.5l.5 2.6 2.6-.6M22 11.5l-.5-2.6-2.6.6"/>'),
    map: svg('<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
    rifle: svg('<path d="M2 13.5h3l1.5-2H21v2h-5.5l-1 2H10l-2 4H4.5l1.5-4H2z" fill="currentColor"/><path d="M11 9.5h6" />', { sw: 1.6 }),
    ammo: svg('<path d="M6 21V10l2-6 2 6v11zM14 21V10l2-6 2 6v11z" fill="currentColor"/>', { sw: 1 }),
    xp: svg('<path d="M12 2.5l2.4 6.6 7 .3-5.5 4.4 1.9 6.8L12 16.7l-5.8 3.9 1.9-6.8-5.5-4.4 7-.3z" fill="currentColor"/>', { sw: 1 })
  };
  ui.icon = function (name) { return ui.icons[name] || ''; };
  ui.css = function (text) { var s = document.createElement('style'); s.textContent = text; (document.head || document.documentElement).appendChild(s); return s; };
  ui.root = rootEl;
  ui.hud = document.getElementById('hg-hud');
  var screensEl = document.getElementById('hg-screens');
  var screens = {}, showHooks = {}, rotateEl = null;
  ui.current = null;
  ui.previous = null;
  /** HG.ui.screen(id, html?) -> <section class="hg-screen" id="scr-ID">, hidden by default. Same id returns the same element (html replaces content if given). */
  ui.screen = function (id, html) {
    var el = screens[id] || document.getElementById('scr-' + id);
    if (!el) {
      el = document.createElement('section'); el.className = 'hg-screen'; el.id = 'scr-' + id; el.hidden = true;
      el.setAttribute('data-screen', id);
      screensEl.appendChild(el);
    }
    screens[id] = el;
    if (html != null) el.innerHTML = html;
    return el;
  };
  ui.getScreen = function (id) { return screens[id] || null; };
  /** Register fn(el) to run every time screen id is shown (use it to (re)build dynamic content). */
  ui.onShow = function (id, fn) { (showHooks[id] || (showHooks[id] = [])).push(fn); };
  /** Show one screen, hiding all others. opts.keep=true keeps others visible (stacked overlay). */
  ui.show = function (id, opts) {
    var el = ui.screen(id);
    if (!(opts && opts.keep)) for (var k in screens) if (k !== id && !screens[k].hidden) { screens[k].hidden = true; HG.emit('screenHide', k); }
    if (ui.current !== id) ui.previous = ui.current;
    ui.current = id;
    if (rotateEl) rotateEl.hidden = true;
    (showHooks[id] || []).forEach(function (fn) { try { fn(el); } catch (e) { console.error('[HG] onShow ' + id, e); } });
    el.hidden = false;
    el.scrollTop = 0;
    HG.emit('screen', id, el);
    return el;
  };
  ui.hide = function (id) {
    var el = screens[id]; if (!el) return;
    if (!el.hidden) { el.hidden = true; HG.emit('screenHide', id); }
    if (ui.current === id) { ui.current = null; for (var k in screens) if (!screens[k].hidden) ui.current = k; }
  };
  ui.hideAll = function () { for (var k in screens) ui.hide(k); ui.current = null; };
  ui.isOpen = function (id) { return !!(screens[id] && !screens[id].hidden); };

  /** Generic chunky button. opts: {primary, green, ghost, small, icon:'iconName'|svgString, id, title, cls} */
  ui.button = function (label, fn, opts) {
    opts = opts || {};
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'hg-btn' + (opts.primary ? ' primary' : '') + (opts.green ? ' green' : '') + (opts.ghost ? ' ghost' : '') + (opts.small ? ' small' : '') + (opts.cls ? ' ' + opts.cls : '');
    var ic = opts.icon ? (opts.icon.charAt(0) === '<' ? opts.icon : ui.icon(opts.icon)) : '';
    b.innerHTML = ic + (label ? '<span>' + U.esc(label) + '</span>' : '');
    if (opts.id) b.id = opts.id;
    if (opts.title) b.title = opts.title;
    if (!label && opts.title) b.setAttribute('aria-label', opts.title);
    b.addEventListener('click', function (e) {
      e.stopPropagation(); HG.sfx('ui');
      try { fn && fn(e); } catch (err) { console.error('[HG] button', err); }
    });
    return b;
  };
  var menuExtra = null;
  /** Add a button to the main menu (feature area). opts: {primary, icon, id, container, order, small}. Same id replaces. */
  ui.menuButton = function (label, fn, opts) {
    opts = opts || {};
    var cont = opts.container || menuExtra || ui.screen('menu');
    if (opts.id) { var old = document.getElementById(opts.id); if (old && old.parentNode) old.parentNode.removeChild(old); }
    var b = ui.button(label, fn, opts);
    b.style.order = opts.order || 0;
    b.dataset.order = opts.order || 0;
    cont.appendChild(b);
    return b;
  };
  ui.removeMenuButton = function (id) { var el = document.getElementById(id); if (el && el.parentNode) el.parentNode.removeChild(el); };

  var toastsEl = document.getElementById('hg-toasts');
  /** HG.ui.toast(text, {color, big, duration (s), html}) */
  ui.toast = function (text, opts) {
    opts = opts || {};
    var t = document.createElement('div');
    t.className = 'hg-toast' + (opts.big ? ' big' : '');
    if (opts.html) t.innerHTML = text; else t.textContent = text;
    if (opts.color) t.style.color = opts.color;
    var dur = opts.duration || (opts.big ? 1.8 : 2.4);
    t.style.animationDuration = dur + 's';
    toastsEl.appendChild(t);
    while (toastsEl.children.length > 4) toastsEl.removeChild(toastsEl.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, dur * 1000 + 50);
    return t;
  };
  var bannerEl = document.getElementById('hg-banner'), bannerTimer = 0;
  /** HG.ui.banner(title, subtitle, {duration (s), color}) — big centred announcement */
  var bannerQueue = [];
  ui.banner = function (title, subtitle, opts) {
    opts = opts || {};
    // never cover an open trophy card: queue until it closes
    if (!opts.force && HG.trophyPending && HG.trophyPending()) { bannerQueue.push([title, subtitle, opts]); return; }
    var dur = opts.duration || 2.8;
    bannerEl.innerHTML = '<div class="b-in" style="animation-duration:' + dur + 's"><h2' + (opts.color ? ' style="color:' + opts.color + '"' : '') + '>' + U.esc(title) + '</h2>' + (subtitle ? '<p>' + U.esc(subtitle) + '</p>' : '') + '</div>';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { bannerEl.innerHTML = ''; ui.flushBanners(); }, dur * 1000);
  };
  /** show the next queued banner (called automatically when a trophy card closes) */
  ui.flushBanners = function () {
    if (!bannerQueue.length || (HG.trophyPending && HG.trophyPending())) return;
    var b = bannerQueue.shift(); ui.banner(b[0], b[1], b[2]);
  };
  var slotNames = ['topLeft', 'topCenter', 'topRight', 'bottomCenter', 'left', 'minimap'];
  var slots = {};
  slotNames.forEach(function (n) { slots[n] = document.getElementById('hg-slot-' + n); });
  /** HG.ui.hudSlot(name) -> positioned flex container in the HUD (visible only during a hunt). */
  ui.hudSlot = function (name) {
    if (!slots[name]) {
      var d = document.createElement('div'); d.className = 'hg-slot'; d.id = 'hg-slot-' + name; ui.hud.appendChild(d); slots[name] = d;
    }
    return slots[name];
  };
  ui.slots = slots;

  var floatEl = document.getElementById('hg-float');
  /** Floating world-space text (e.g. +$120) projected at worldPos. */
  ui.floatText = function (worldPos, text, color, opts) {
    if (!HG.camera || !worldPos) return;
    _v6.copy(worldPos); _v6.y += 1.2;
    _v6.project(HG.camera);
    if (_v6.z > 1 || _v6.z < -1) { ui.toast(text, { color: color }); return; }
    var d = document.createElement('div');
    d.className = 'hg-floattext'; d.textContent = text; d.style.color = color || 'var(--cream)';
    d.style.left = ((_v6.x * 0.5 + 0.5) * 100) + '%'; d.style.top = ((-_v6.y * 0.5 + 0.5) * 100) + '%';
    if (opts && opts.size) d.style.fontSize = opts.size + 'px';
    floatEl.appendChild(d);
    while (floatEl.children.length > 10) floatEl.removeChild(floatEl.firstChild);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1700);
  };
  /** A canvas sized for crisp icons: drawFn(ctx, w, h) in CSS pixels. */
  ui.iconCanvas = function (drawFn, w, h) {
    w = w || 96; h = h || 64;
    var c = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px';
    var ctx = c.getContext('2d');
    if (ctx) { ctx.scale(dpr, dpr); try { drawFn && drawFn(ctx, w, h); } catch (e) { console.error('[HG] icon draw', e); } }
    return c;
  };
  /** Modal confirm (never use window.confirm). onYes/onNo optional. opts: {title, yes, no, html} */
  ui.confirm = function (text, onYes, opts) {
    opts = opts || {};
    var ov = document.createElement('div');
    ov.className = 'hg-screen dim';
    ov.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:50';
    ov.innerHTML = '<div class="hg-panel" style="padding:20px 22px;max-width:420px;width:100%;text-align:center">' +
      (opts.title ? '<h2 class="hg-title" style="font-size:24px;margin-bottom:10px;color:var(--amber-2)">' + U.esc(opts.title) + '</h2>' : '') +
      '<p style="margin:0 0 16px;font-size:16px;line-height:1.4">' + (opts.html ? text : U.esc(text)) + '</p><div class="hg-row" style="justify-content:center;flex-wrap:wrap"></div></div>';
    var row = ov.querySelector('.hg-row');
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    if (opts.no !== false) row.appendChild(ui.button(opts.no || 'Cancel', function () { close(); opts.onNo && opts.onNo(); }, { ghost: true }));
    row.appendChild(ui.button(opts.yes || 'OK', function () { close(); onYes && onYes(); }, { primary: true }));
    screensEl.appendChild(ov);
    return ov;
  };

  /* ---------- action buttons (mobile cluster) ---------- */
  var actionsEl = document.getElementById('hg-actions');
  var actionsExtraEl = document.getElementById('hg-actions-extra');
  var actionBtns = {};
  ui.actions = actionBtns;
  /** HG.ui.actionButton(id, label, svgIcon, onPress, opts) -> element
   *  opts: {hold:true (onPress on down, onRelease on up; HG.input.buttons[id] true while held),
   *         onRelease, toggle:true (adds/removes .on each press; onPress(isOn)), cls:'fire'|'aim'|...,
   *         pos:{right, bottom, portrait:{right, bottom}} px from the bottom-right safe corner (core arc layout; omit to go into the extras column),
   *         order (extras column order), hidden:true, key:'KeyB' (desktop hint only)} */
  ui.actionButton = function (id, label, svgIcon, onPress, opts) {
    opts = opts || {};
    if (actionBtns[id]) { var o = actionBtns[id]; if (o.parentNode) o.parentNode.removeChild(o); }
    var b = document.createElement('div');
    b.className = 'hg-act' + (opts.cls ? ' ' + opts.cls : '');
    b.setAttribute('role', 'button'); b.setAttribute('aria-label', label || id);
    b.dataset.id = id;
    var ic = svgIcon ? (svgIcon.charAt(0) === '<' ? svgIcon : ui.icon(svgIcon)) : '';
    b.innerHTML = ic + (label ? '<span>' + U.esc(label) + '</span>' : '');
    var held = null;
    function down(e) {
      e.preventDefault(); e.stopPropagation();
      if (held !== null) return;
      held = e.pointerId;
      try { b.setPointerCapture && b.setPointerCapture(e.pointerId); } catch (err) {}
      b.classList.add('down');
      HG.input.buttons[id] = true;
      HG.audio.unlock();
      try {
        if (opts.toggle) { var on = !b.classList.contains('on'); b.classList.toggle('on', on); onPress && onPress(on); }
        else onPress && onPress(true);
      } catch (err) { console.error('[HG] action ' + id, err); }
    }
    function up(e) {
      if (held === null || (e && e.pointerId !== held)) return;
      held = null;
      b.classList.remove('down');
      HG.input.buttons[id] = false;
      if (opts.onRelease) { try { opts.onRelease(); } catch (err) { console.error('[HG] action ' + id, err); } }
    }
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    b._release = function () { if (held !== null) up({ pointerId: held }); };
    if (opts.pos) {
      var pp = opts.pos.portrait || opts.pos;
      b.classList.add('arc');
      b.style.setProperty('--r', opts.pos.right + 'px'); b.style.setProperty('--b', opts.pos.bottom + 'px');
      b.style.setProperty('--rp', pp.right + 'px'); b.style.setProperty('--bp', pp.bottom + 'px');
      actionsEl.appendChild(b);
    } else {
      b.style.order = opts.order || 0;
      actionsExtraEl.appendChild(b);
    }
    if (opts.hidden) b.hidden = true;
    actionBtns[id] = b;
    return b;
  };
  ui.setActionVisible = function (id, vis) { var b = actionBtns[id]; if (!b) return; b.hidden = !vis; if (!vis && b._release) b._release(); };
  ui.setActionActive = function (id, on) { var b = actionBtns[id]; if (b) b.classList.toggle('on', !!on); };
  ui.actionEl = function (id) { return actionBtns[id] || null; };

  /* ---------- context button (single interaction: CLIMB / ENTER / PICK UP ...) ---------- */
  var ctxEl = document.getElementById('hg-context'), ctxFn = null, ctxId = null, ctxLabel = '';
  /** HG.ui.contextButton(label, fn, {icon, id}) — shows one context action (mobile button; desktop [E]). Re-calling with the same label is cheap. */
  ui.contextButton = function (label, fn, opts) {
    opts = opts || {};
    ctxFn = fn; ctxId = opts.id || label;
    if (ctxLabel !== label || ctxEl.hidden) {
      ctxLabel = label;
      ctxEl.innerHTML = '';
      var b = ui.button(label, function () { ui.triggerContext(); }, { primary: true, icon: opts.icon || 'hand' });
      b.insertAdjacentHTML('afterbegin', '<kbd>E</kbd>');
      b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      ctxEl.appendChild(b);
      ctxEl.hidden = false;
    }
  };
  /** Clear the context action. If id is given, only clears when that id owns it. */
  ui.clearContext = function (id) {
    if (id && ctxId !== id) return;
    ctxFn = null; ctxId = null; ctxLabel = ''; ctxEl.hidden = true; ctxEl.innerHTML = '';
  };
  ui.triggerContext = function () { if (ctxFn) { var f = ctxFn; try { f(); } catch (e) { console.error('[HG] context', e); } return true; } return false; };
  ui.contextActive = function () { return !!ctxFn; };

  /* ---------- crosshair, hit marker, hurt flash, threat edges ---------- */
  var xhair = document.getElementById('hg-crosshair');
  var xParts = { l: xhair.querySelector('.c-l'), r: xhair.querySelector('.c-r'), t: xhair.querySelector('.c-t'), b: xhair.querySelector('.c-b') };
  var hitEl = document.getElementById('hg-hitmarker');
  var lastGap = -1, lastXVis = null;
  ui.setCrosshair = function (gapPx, visible) {
    if (visible !== lastXVis) { xhair.style.display = visible ? '' : 'none'; lastXVis = visible; }
    gapPx = Math.round(gapPx);
    if (gapPx === lastGap) return; lastGap = gapPx;
    xParts.l.style.left = (-gapPx - 10) + 'px'; xParts.r.style.left = gapPx + 'px';
    xParts.t.style.top = (-gapPx - 10) + 'px'; xParts.b.style.top = gapPx + 'px';
  };
  ui.hitMarker = function (kill) {
    hitEl.style.color = kill ? 'var(--danger)' : '#fff';
    hitEl.classList.remove('show'); void hitEl.offsetWidth; hitEl.classList.add('show');
  };
  var hurtEl = document.getElementById('hg-hurt'), hurtT = 0;
  ui.hurtFlash = function (k) { hurtEl.style.opacity = U.clamp(k || 0.8, 0, 1); clearTimeout(hurtT); hurtT = setTimeout(function () { hurtEl.style.opacity = 0; }, 260); };
  var edges = { l: ui.hud.querySelector('.hg-edge.l'), r: ui.hud.querySelector('.hg-edge.r'), t: ui.hud.querySelector('.hg-edge.t'), b: ui.hud.querySelector('.hg-edge.b') };
  var threatLevel = 0, threatAng = 0;
  /** Red edge indicator: relAngle = direction of the threat relative to view (0 ahead, +PI/2 left, -PI/2 right, PI behind); intensity 0..1. Decays automatically. */
  ui.threat = function (relAngle, intensity) { if (intensity >= threatLevel * 0.8) { threatAng = relAngle; } threatLevel = Math.max(threatLevel, intensity); };
  var lastThreatK = -1, edgeOp = [-1, -1, -1, -1];
  function setOp(el, i, v) { v = Math.round(v * 50) / 50; if (edgeOp[i] !== v) { edgeOp[i] = v; el.style.opacity = v; } }
  function updateThreat(dt) {
    threatLevel = Math.max(0, threatLevel - dt * 1.8);
    var k = threatLevel, a = threatAng;
    var left = Math.max(0, Math.sin(a)), right = Math.max(0, -Math.sin(a)), front = Math.max(0, Math.cos(a)), back = Math.max(0, -Math.cos(a));
    if (k === 0 && lastThreatK === 0) return;
    lastThreatK = k;
    setOp(edges.l, 0, k * left); setOp(edges.r, 1, k * right); setOp(edges.t, 2, k * front * 0.8); setOp(edges.b, 3, k * back);
  }
  var scopeEl = document.getElementById('hg-scope');
  scopeEl.innerHTML = '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice" viewBox="-50 -50 100 100" style="position:absolute;inset:0">' +
    '<defs><mask id="hgScopeMask"><rect x="-100" y="-100" width="200" height="200" fill="#fff"/><circle r="40" fill="#000"/></mask>' +
    '<radialGradient id="hgScopeVig"><stop offset="78%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".75"/></radialGradient></defs>' +
    '<rect x="-100" y="-100" width="200" height="200" fill="#070807" mask="url(#hgScopeMask)"/>' +
    '<circle r="40" fill="url(#hgScopeVig)"/><circle r="40" fill="none" stroke="#1c1c1a" stroke-width="1.6"/>' +
    '<path d="M-40 0H-3M3 0H40M0 -40V-3M0 3V40" stroke="#111" stroke-width=".35"/>' +
    '<path d="M-40 0H-14M14 0H40M0 14V40" stroke="#111" stroke-width="1.3"/>' +
    '<path d="M-1.5 6h3M-1 9h2M-1.5 12h3" stroke="#111" stroke-width=".3"/>' +
    '<circle r=".45" fill="#d22"/></svg>';
  ui.setScope = function (on) { scopeEl.classList.toggle('on', !!on); };
  ui.scopeEl = scopeEl;

  /* ---------- rotate hint ---------- */
  rotateEl = document.getElementById('hg-rotate');
  var rotateShown = false;
  rotateEl.innerHTML = ui.icon('rotate') + '<span>Rotate your phone for the best view</span>';
  rotateEl.addEventListener('pointerdown', function (e) { e.stopPropagation(); rotateEl.hidden = true; });
  ui.rotateHint = function () {
    if (rotateShown || !HG.portrait || !rootEl.classList.contains('touch') || ui.current || HG.paused || HG.state !== 'hunt') return;
    rotateShown = true; rotateEl.hidden = false;
    setTimeout(function () { rotateEl.hidden = true; }, 5000);
  };

  /* ------------------------------------------------------------------
   * Input
   * ------------------------------------------------------------------ */
  var input = HG.input = {
    move: { x: 0, y: 0 },      // x = strafe right, y = forward, -1..1 (joystick or keys)
    lookX: 0, lookY: 0,        // accumulated look deltas in RADIANS since last frame (consumed by core each frame)
    fire: false,               // fire held
    firePressed: false,        // fire went down this frame (edge)
    aim: false,                // aim held / toggled
    sprint: false, crouch: false,
    buttons: {},               // action button id -> held
    keys: {},                  // KeyboardEvent.code -> held
    isTouch: U.isTouchDevice(),
    pointerLocked: false, lockFailed: false,
    joystick: { active: false, x: 0, y: 0, sprint: false },
    enabled: true              // false = ignore gameplay input (menus)
  };
  if (input.isTouch) rootEl.classList.add('touch');
  var keyBinds = {};
  /** HG.bindKey(code, fn(e), desc) — gameplay keybinding (KeyboardEvent.code, e.g. 'KeyB'). Fires on keydown (no repeats) during a hunt. Returns unbind fn. */
  HG.bindKey = function (code, fn, desc) {
    (keyBinds[code] || (keyBinds[code] = [])).push({ fn: fn, desc: desc || '' });
    return function () { var a = keyBinds[code]; if (!a) return; for (var i = a.length - 1; i >= 0; i--) if (a[i].fn === fn) a.splice(i, 1); };
  };
  HG.keyBindings = keyBinds;
  function setTouchMode(on) {
    if (input.isTouch === on) return;
    input.isTouch = on; rootEl.classList.toggle('touch', on);
    HG.emit('inputMode', on ? 'touch' : 'mouse');
  }
  function inField(e) { var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'); }
  window.addEventListener('keydown', function (e) {
    if (inField(e)) return;
    input.keys[e.code] = true;
    if (HG.state === 'hunt' && /^(Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Tab)$/.test(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (input.isTouch && !/^(Escape)$/.test(e.code)) setTouchMode(false);
    HG.emit('key', e.code, e);
    if (HG.state !== 'hunt') return;
    if (e.code === 'Escape' || e.code === 'KeyP') { if (HG.paused) { if (ui.current === 'pause') HG.resume('user'); } else HG.pause('user'); return; }
    if (HG.paused) return;
    var binds = keyBinds[e.code];
    if (binds) binds.slice().forEach(function (b) { try { b.fn(e); } catch (err) { console.error('[HG] key ' + e.code, err); } });
  });
  window.addEventListener('keyup', function (e) { input.keys[e.code] = false; HG.emit('keyup', e.code, e); });
  window.addEventListener('blur', function () { input.keys = {}; input.fire = false; if (!input.aimToggle) input.aim = false; });

  // ---- pointer (mouse + touch) on the game view ----
  var joy = { id: null, ox: 0, oy: 0, el: document.getElementById('hg-joy'), knob: null, R: 56 };
  joy.knob = joy.el.querySelector('b');
  var look = { id: null, x: 0, y: 0 };
  var mouseDrag = { down: false, x: 0, y: 0, moved: 0, t: 0, btn: 0 };
  function placeJoyIdle() {
    joy.el.classList.remove('active', 'sprint');
    joy.el.style.left = 'calc(var(--sl) + 92px)'; joy.el.style.top = 'calc(100% - var(--sb) - 96px)';
    joy.knob.style.transform = '';
  }
  placeJoyIdle();
  function canGameInput() { return HG.state === 'hunt' && !HG.paused && input.enabled; }
  HG.requestPointerLock = function () {
    var c = renderer.domElement;
    if (!c.requestPointerLock || input.lockFailed) return;
    try {
      var p = c.requestPointerLock();
      if (p && p.catch) p.catch(function () { input.lockFailed = true; });
    } catch (e) { input.lockFailed = true; }
  };
  document.addEventListener('pointerlockerror', function () { input.lockFailed = true; });
  document.addEventListener('pointerlockchange', function () {
    var locked = document.pointerLockElement === renderer.domElement;
    var was = input.pointerLocked; input.pointerLocked = locked;
    if (!locked) { input.fire = false; }
    if (was && !locked && HG.state === 'hunt' && !HG.paused && !HG._unlockingIntent) HG.pause('user');
    HG._unlockingIntent = false;
  });
  HG.exitPointerLock = function () { try { if (document.pointerLockElement) { HG._unlockingIntent = true; document.exitPointerLock(); } } catch (e) {} };

  var view = viewEl;
  view.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  view.addEventListener('pointerdown', function (e) {
    HG.audio.unlock();
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      setTouchMode(true);
      if (!canGameInput()) return;
      e.preventDefault();
      var w = view.clientWidth;
      if (e.clientX < w * 0.42 && joy.id === null) {
        joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY;
        joy.el.style.left = joy.ox + 'px'; joy.el.style.top = joy.oy + 'px'; joy.el.classList.add('active');
        input.joystick.active = true;
      } else if (look.id === null) {
        look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY;
      }
      try { view.setPointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    // mouse
    if (input.isTouch) setTouchMode(false);
    if (!canGameInput()) return;
    if (e.button === 2) { input.aim = true; return; }
    if (e.button !== 0) return;
    if (!input.pointerLocked && !input.lockFailed && renderer.domElement.requestPointerLock) {
      HG.requestPointerLock();
      // first click only captures the mouse (unless lock is refused -> drag mode)
      mouseDrag.down = true; mouseDrag.x = e.clientX; mouseDrag.y = e.clientY; mouseDrag.moved = 0; mouseDrag.t = performance.now(); mouseDrag.btn = 0;
      return;
    }
    if (input.pointerLocked) { input.fire = true; input.firePressed = true; return; }
    mouseDrag.down = true; mouseDrag.x = e.clientX; mouseDrag.y = e.clientY; mouseDrag.moved = 0; mouseDrag.t = performance.now(); mouseDrag.btn = 0;
    try { view.setPointerCapture(e.pointerId); } catch (err) {}
  });
  view.addEventListener('pointermove', function (e) {
    var sens = HG.settings.sens || 1, inv = HG.settings.invertY ? -1 : 1;
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (!canGameInput()) return;
      if (e.pointerId === joy.id) {
        var dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, d = Math.sqrt(dx * dx + dy * dy), R = joy.R;
        var k = d > R ? R / d : 1;
        input.joystick.x = U.clamp(dx / R, -1, 1); input.joystick.y = U.clamp(-dy / R, -1, 1);
        var mag = Math.min(1, d / R);
        if (mag > 0) { input.joystick.x = dx / d * mag; input.joystick.y = -dy / d * mag; }
        input.joystick.sprint = d > R * 1.25 && -dy > Math.abs(dx) * 0.5;
        joy.el.classList.toggle('sprint', input.joystick.sprint);
        joy.knob.style.transform = 'translate(' + (dx * k).toFixed(1) + 'px,' + (dy * k).toFixed(1) + 'px)';
      } else if (e.pointerId === look.id) {
        var ldx = e.clientX - look.x, ldy = e.clientY - look.y;
        look.x = e.clientX; look.y = e.clientY;
        input.lookX += ldx * 0.0052 * sens; input.lookY += ldy * 0.0052 * sens * inv;
      }
      return;
    }
    if (!canGameInput()) return;
    if (input.pointerLocked) {
      input.lookX += (e.movementX || 0) * 0.0022 * sens; input.lookY += (e.movementY || 0) * 0.0022 * sens * inv;
    } else if (mouseDrag.down) {
      var mdx = e.clientX - mouseDrag.x, mdy = e.clientY - mouseDrag.y;
      mouseDrag.x = e.clientX; mouseDrag.y = e.clientY; mouseDrag.moved += Math.abs(mdx) + Math.abs(mdy);
      input.lookX += mdx * 0.0045 * sens; input.lookY += mdy * 0.0045 * sens * inv;
    }
  });
  function pointerEnd(e) {
    if (e.pointerId === joy.id) { joy.id = null; input.joystick.active = false; input.joystick.x = input.joystick.y = 0; input.joystick.sprint = false; placeJoyIdle(); }
    if (e.pointerId === look.id) look.id = null;
    if (e.pointerType === 'mouse') {
      if (e.button === 2 && !input.aimToggle) input.aim = false;
      if (e.button === 0) {
        input.fire = false;
        if (mouseDrag.down && !input.pointerLocked && input.lockFailed && mouseDrag.moved < 6 && performance.now() - mouseDrag.t < 350 && canGameInput()) {
          input.firePressed = true; // quick click fires in drag-look fallback mode
        }
        mouseDrag.down = false;
      }
    }
  }
  view.addEventListener('pointerup', pointerEnd);
  view.addEventListener('pointercancel', pointerEnd);
  view.addEventListener('wheel', function (e) {
    if (!canGameInput()) return;
    e.preventDefault();
    var now = performance.now(); if (now - (input._wheelT || 0) < 160) return; input._wheelT = now;
    HG.cycleWeapon(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  /** Release every held input (used on pause / screen changes). */
  HG.resetInput = function () {
    input.fire = false; input.firePressed = false; if (!input.aimToggle) input.aim = false;
    input.lookX = input.lookY = 0; input.joystick.active = false; input.joystick.x = input.joystick.y = 0; input.joystick.sprint = false;
    joy.id = null; look.id = null; mouseDrag.down = false; placeJoyIdle();
    for (var id in actionBtns) if (actionBtns[id]._release) actionBtns[id]._release();
  };
  // core gameplay keys (features add their own with HG.bindKey)
  HG.bindKey('KeyR', function () { HG.reload(); }, 'Reload');
  HG.bindKey('KeyC', function () { HG.setCrouch(!HG.player.crouch); }, 'Crouch');
  HG.bindKey('KeyE', function () { if (!ui.triggerContext()) HG.emit('interact'); }, 'Interact');
  HG.bindKey('KeyQ', function () { HG.cycleWeapon(1); }, 'Next weapon');
  [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (n) {
    HG.bindKey('Digit' + n, function () { var lo = HG.getLoadout(); if (lo[n - 1] && lo[n - 1] !== HG.weapon.id) { HG.switchWeapon(lo[n - 1]); ui.toast(HG.weaponTypes[lo[n - 1]].name, { duration: 1.2 }); } }, 'Weapon ' + n);
  });
  /** Per-frame: compose move vector from keys/joystick. */
  function pollInput() {
    var k = input.keys, kx = 0, ky = 0;
    if (k.KeyW || k.ArrowUp) ky += 1; if (k.KeyS || k.ArrowDown) ky -= 1;
    if (k.KeyD || k.ArrowRight) kx += 1; if (k.KeyA || k.ArrowLeft) kx -= 1;
    if (input.joystick.active) { input.move.x = input.joystick.x; input.move.y = input.joystick.y; }
    else { var l = Math.sqrt(kx * kx + ky * ky) || 1; input.move.x = kx / l; input.move.y = ky / l; }
    input.sprint = !!(k.ShiftLeft || k.ShiftRight || input.joystick.sprint || input.sprintToggle);
  }

  /* ------------------------------------------------------------------
   * Colliders (circle / vertical cylinder obstacles, spatial hash)
   * ------------------------------------------------------------------ */
  var COL_CELL = 8;
  var colGrid = new Map(), colList = [], colStamp = 1, colId = 1;
  function colKey(ix, iz) { return (ix + 4096) * 8192 + (iz + 4096); }
  var colliders = HG.colliders = {
    list: colList,
    /** add(x, z, r, opts{h:height (default 6), y0:base y (default terrain), tag, cover:bool (gives hiding cover), solid:true}) -> collider */
    add: function (x, z, r, opts) {
      opts = opts || {};
      var c = { id: colId++, x: x, z: z, r: r, h: opts.h == null ? 6 : opts.h, y0: opts.y0 == null ? (HG.terrain.ready ? HG.terrain.heightAt(x, z) - 0.5 : -1e4) : opts.y0,
        tag: opts.tag || '', cover: !!opts.cover, solid: opts.solid !== false, data: opts.data || null, _s: 0, _cells: [] };
      var x0 = Math.floor((x - r) / COL_CELL), x1 = Math.floor((x + r) / COL_CELL), z0 = Math.floor((z - r) / COL_CELL), z1 = Math.floor((z + r) / COL_CELL);
      for (var ix = x0; ix <= x1; ix++) for (var iz = z0; iz <= z1; iz++) {
        var k = colKey(ix, iz), a = colGrid.get(k); if (!a) { a = []; colGrid.set(k, a); } a.push(c); c._cells.push(k);
      }
      colList.push(c);
      return c;
    },
    remove: function (c) {
      if (!c) return;
      for (var i = 0; i < c._cells.length; i++) { var a = colGrid.get(c._cells[i]); if (a) { var j = a.indexOf(c); if (j >= 0) a.splice(j, 1); } }
      var k = colList.indexOf(c); if (k >= 0) colList.splice(k, 1);
    },
    clear: function () { colGrid.clear(); colList.length = 0; },
    /** query(x, z, r, fn(c)) — calls fn for each collider whose circle may touch the query circle. Return true from fn to stop. */
    query: function (x, z, r, fn) {
      colStamp++;
      var x0 = Math.floor((x - r) / COL_CELL), x1 = Math.floor((x + r) / COL_CELL), z0 = Math.floor((z - r) / COL_CELL), z1 = Math.floor((z + r) / COL_CELL);
      for (var ix = x0; ix <= x1; ix++) for (var iz = z0; iz <= z1; iz++) {
        var a = colGrid.get(colKey(ix, iz)); if (!a) continue;
        for (var i = 0; i < a.length; i++) {
          var c = a[i]; if (c._s === colStamp) continue; c._s = colStamp;
          var dx = c.x - x, dz = c.z - z, rr = c.r + r;
          if (dx * dx + dz * dz <= rr * rr) { if (fn(c) === true) return; }
        }
      }
    },
    /** Push a position (Vector3, uses x/z) out of solid colliders. Returns true if it moved. */
    resolve: function (pos, radius, y) {
      var moved = false;
      colliders.query(pos.x, pos.z, radius, function (c) {
        if (!c.solid) return;
        if (y != null && (y > c.y0 + c.h + 0.3)) return; // above it (e.g. on a stand)
        var dx = pos.x - c.x, dz = pos.z - c.z, d = Math.sqrt(dx * dx + dz * dz), min = c.r + radius;
        if (d < min) {
          if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
          pos.x = c.x + dx / d * min; pos.z = c.z + dz / d * min; moved = true;
        }
      });
      return moved;
    },
    /** Nearest distance along a ray (origin o, unit dir d) to a solid collider cylinder, or Infinity. Max dist maxD. */
    raycast: function (o, d, maxD, ignore) {
      var best = Infinity, step = COL_CELL * 0.5, n = Math.ceil(maxD / step);
      colStamp++;
      var stamp = colStamp;
      for (var s = 0; s <= n; s++) {
        var t = s * step;
        if (t > best) break;
        var px = o.x + d.x * t, pz = o.z + d.z * t;
        var a = colGrid.get(colKey(Math.floor(px / COL_CELL), Math.floor(pz / COL_CELL)));
        if (!a) continue;
        for (var i = 0; i < a.length; i++) {
          var c = a[i]; if (c._s === stamp || !c.solid || c === ignore) continue; c._s = stamp;
          // 2D ray-circle
          var fx = o.x - c.x, fz = o.z - c.z, A = d.x * d.x + d.z * d.z; if (A < 1e-8) continue;
          var B = 2 * (fx * d.x + fz * d.z), Cc = fx * fx + fz * fz - c.r * c.r, disc = B * B - 4 * A * Cc;
          if (disc < 0) continue;
          var sq = Math.sqrt(disc), t0 = (-B - sq) / (2 * A);
          if (t0 < 0) t0 = (-B + sq) / (2 * A); // started inside
          if (t0 < 0 || t0 > maxD || t0 >= best) continue;
          var y = o.y + d.y * t0;
          if (y < c.y0 || y > c.y0 + c.h) continue;
          best = t0;
        }
      }
      return best;
    },
    /** true if any cover collider is within dist of (x,z) */
    coverNear: function (x, z, dist) {
      var found = false;
      colliders.query(x, z, dist, function (c) { if (c.cover) { found = true; return true; } });
      return found;
    }
  };

  /* ------------------------------------------------------------------
   * Terrain + maps
   * ------------------------------------------------------------------ */
  HG.maps = HG.maps || {};
  HG.map = null; HG.mapId = null; HG.mapRoot = null;
  var terrain = HG.terrain = {
    ready: false, mesh: null, size: 0, seg: 0, cell: 1, grid: null, waterLevel: -1e9,
    /** exact height of the rendered terrain surface at (x, z) (clamped to map edges) */
    heightAt: function (x, z) {
      if (!terrain.grid) return 0;
      var half = terrain.size / 2, seg = terrain.seg, cell = terrain.cell, row = seg + 1;
      var gx = (x + half) / cell, gz = (z + half) / cell;
      if (gx < 0) gx = 0; else if (gx > seg - 1e-4) gx = seg - 1e-4;
      if (gz < 0) gz = 0; else if (gz > seg - 1e-4) gz = seg - 1e-4;
      var ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz, g = terrain.grid;
      var i00 = iz * row + ix;
      if (fx + fz <= 1) { var h00 = g[i00]; return h00 + (g[i00 + 1] - h00) * fx + (g[i00 + row] - h00) * fz; }
      var h11 = g[i00 + row + 1]; return h11 + (g[i00 + row] - h11) * (1 - fx) + (g[i00 + 1] - h11) * (1 - fz);
    },
    /** surface normal at (x, z) written into out (Vector3) */
    normalAt: function (x, z, out) {
      out = out || new THREE.Vector3();
      var e = 0.75;
      out.set(terrain.heightAt(x - e, z) - terrain.heightAt(x + e, z), 2 * e, terrain.heightAt(x, z - e) - terrain.heightAt(x, z + e));
      return out.normalize();
    },
    /** slope as rise/run at (x,z) */
    slopeAt: function (x, z) { var n = terrain.normalAt(x, z, _v5); return Math.sqrt(Math.max(0, 1 - n.y * n.y)) / Math.max(0.05, n.y); },
    isWater: function (x, z) { return terrain.heightAt(x, z) < terrain.waterLevel + 0.15; },
    inBounds: function (x, z, margin) { var h = terrain.size / 2 - (margin || 0); return x > -h && x < h && z > -h && z < h; }
  };

  /** default ground colouring (map.groundColors = {base, alt, slope, low, high, highLevel}) */
  function groundColorFn(map) {
    var gc = map.groundColors || {};
    var cBase = new THREE.Color(gc.base || '#5f8c3c'), cAlt = new THREE.Color(gc.alt || '#7a9c45'), cSlope = new THREE.Color(gc.slope || '#7a5f3e'),
      cLow = new THREE.Color(gc.low || '#c9b57d'), cHigh = new THREE.Color(gc.high || '#8a8c86');
    var wl = map.water ? map.water.level : -1e9, highLevel = gc.highLevel == null ? 1e9 : gc.highLevel;
    return function (x, z, h, ny, out) {
      var n = U.noise2(x * 0.045, z * 0.045) * 0.5 + 0.5;
      out.copy(cBase).lerp(cAlt, U.clamp(n * 1.2 - 0.1, 0, 1));
      var slope = Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(0.05, ny);
      out.lerp(cSlope, U.smooth(0.35, 0.75, slope));
      if (h > highLevel) out.lerp(cHigh, U.smooth(highLevel, highLevel + 6, h));
      if (h < wl + 1.6) out.lerp(cLow, U.smooth(wl + 1.6, wl + 0.4, h));
      return out;
    };
  }
  function buildTerrain(map) {
    var size = map.size || 400, seg = map.segments || Math.min(160, Math.round(size / 2.7));
    var row = seg + 1, cell = size / seg, half = size / 2, grid = new Float32Array(row * row);
    for (var iz = 0; iz <= seg; iz++) for (var ix = 0; ix <= seg; ix++) {
      grid[iz * row + ix] = map.height(ix * cell - half, iz * cell - half);
    }
    terrain.size = size; terrain.seg = seg; terrain.cell = cell; terrain.grid = grid;
    terrain.waterLevel = map.water ? map.water.level : -1e9;
    terrain.ready = true;
    var vc = row * row, pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), col = new Float32Array(vc * 3), tw = new Float32Array(vc * 4);
    var mat = map.terrainMaterial || G.terrainMaterial(G.paletteFromMap(map)), pal = mat.userData.palette || G.normPalette('meadow');
    var tint0 = G.color(pal.tint[0]), tint1 = G.color(pal.tint[1]), tr = [tint1.r / Math.max(0.01, tint0.r), tint1.g / Math.max(0.01, tint0.g), tint1.b / Math.max(0.01, tint0.b)];
    var colorFn = pal.mode === 'tint' ? (map.groundColor || groundColorFn(map)) : null, c = new THREE.Color(), w4 = [0, 0, 0, 0], wl = terrain.waterLevel;
    var grassW = new Float32Array(vc), tintArr = new Float32Array(vc * 3);
    for (iz = 0; iz <= seg; iz++) for (ix = 0; ix <= seg; ix++) {
      var i = iz * row + ix, x = ix * cell - half, z = iz * cell - half, h = grid[i];
      var hl = grid[iz * row + Math.max(0, ix - 1)], hr = grid[iz * row + Math.min(seg, ix + 1)], hd = grid[Math.max(0, iz - 1) * row + ix], hu = grid[Math.min(seg, iz + 1) * row + ix];
      var nx = (hl - hr) / (2 * cell), nz = (hd - hu) / (2 * cell), nl = Math.sqrt(nx * nx + 1 + nz * nz);
      pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
      nor[i * 3] = nx / nl; nor[i * 3 + 1] = 1 / nl; nor[i * 3 + 2] = nz / nl;
      var slope = Math.sqrt(nx * nx + nz * nz);
      G.terrainWeights(pal, x, z, h, slope, wl, w4);
      tw[i * 4] = w4[0]; tw[i * 4 + 1] = w4[1]; tw[i * 4 + 2] = w4[2]; tw[i * 4 + 3] = w4[3];
      grassW[i] = pal.grassKind === 'grass' ? w4[0] : 0;
      if (colorFn) { colorFn(x, z, h, 1 / nl, c); c.convertSRGBToLinear(); c.multiplyScalar(1.25); }
      else {
        var n = G.noise.fbm2(x * 0.0045 + 0.5, z * 0.0045 + 0.5, 4, 4, 21), k = U.smooth(0.3, 0.75, n);
        c.setRGB(1 + (tr[0] - 1) * k, 1 + (tr[1] - 1) * k, 1 + (tr[2] - 1) * k).multiplyScalar(0.94 + 0.12 * G.noise.fbm2(x * 0.02, z * 0.02, 4, 3, 22));
      }
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      tintArr[i * 3] = c.r; tintArr[i * 3 + 1] = c.g; tintArr[i * 3 + 2] = c.b;
    }
    var idx = new (vc > 65535 ? Uint32Array : Uint16Array)(seg * seg * 6), p = 0;
    for (iz = 0; iz < seg; iz++) for (ix = 0; ix < seg; ix++) {
      var i00 = iz * row + ix, i10 = i00 + 1, i01 = i00 + row, i11 = i01 + 1;
      idx[p++] = i00; idx[p++] = i01; idx[p++] = i10;   // same diagonal split as terrain.heightAt
      idx[p++] = i01; idx[p++] = i11; idx[p++] = i10;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('tw', new THREE.BufferAttribute(tw, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    var mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true; mesh.name = 'terrain';
    terrain.mesh = mesh; terrain.grassW = grassW; terrain.tint = tintArr; terrain.palette = pal;
    G.terrainMat = mat;
    return mesh;
  }
  function buildWater(map) {
    if (!map.water) return null;
    var w = map.water, wl = w.level, size = terrain.size, seg = terrain.seg, cell = terrain.cell, row = seg + 1, half = size / 2, grid = terrain.grid;
    // bounding box of the cells that are (nearly) under water
    var x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (var iz = 0; iz <= seg; iz++) for (var ix = 0; ix <= seg; ix++) if (grid[iz * row + ix] < wl + 0.3) { x0 = Math.min(x0, ix); x1 = Math.max(x1, ix); z0 = Math.min(z0, iz); z1 = Math.max(z1, iz); }
    if (x0 > x1) return null;
    x0 = Math.max(0, x0 - 2); z0 = Math.max(0, z0 - 2); x1 = Math.min(seg, x1 + 2); z1 = Math.min(seg, z1 + 2);
    var step = 1, nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step), pos = [], dep = [], ind = [], vmap = {};
    function vert(ix, iz) {
      var key = ix + ',' + iz; if (vmap[key] != null) return vmap[key];
      var x = ix * cell - half, z = iz * cell - half; vmap[key] = pos.length / 3;
      pos.push(x, 0, z); dep.push(wl - grid[Math.min(seg, iz) * row + Math.min(seg, ix)]); return vmap[key];
    }
    for (var j = 0; j < nz; j++) for (var i = 0; i < nx; i++) {
      var ax = x0 + i * step, az = z0 + j * step, bx = Math.min(x1, ax + step), bz = Math.min(z1, az + step);
      var d = Math.max(wl - grid[az * row + ax], wl - grid[az * row + bx], wl - grid[bz * row + ax], wl - grid[bz * row + bx]);
      if (d < -0.4) continue;
      var a = vert(ax, az), b = vert(bx, az), c = vert(ax, bz), e = vert(bx, bz);
      ind.push(a, c, b, b, c, e);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(dep, 1));
    g.setIndex(ind); g.computeBoundingSphere();
    var m = map.waterMaterial || G.waterMaterial({ shallow: w.shallow || '#5c8f84', deep: w.deep || w.color || '#1c4a5c', opacity: w.opacity == null ? 0.86 : Math.max(0.6, w.opacity), ripple: w.ripple, foam: w.foam });
    var mesh = new THREE.Mesh(g, m); mesh.position.y = wl; mesh.name = 'water'; mesh.renderOrder = 2;
    mesh.userData.base = new THREE.Color(w.color || '#3d7f95');
    return mesh;
  }
  /** layered mountain ring with atmospheric haze (custom shader, not fogged) */
  function buildMountains(map) {
    if (map.horizon === false) return null;
    var size = map.size || 400, base = new THREE.Color(map.mountainColor || '#5b7178'), forestC = new THREE.Color(map.treeColor || '#2f5a32').lerp(base, 0.35), snow = new THREE.Color('#eef3f6');
    var pos = [], col = [], hz = [], ind = [], layers = [[0.78, 55, 0.35, 0.55], [1.02, 95, 0.55, 0.42], [1.35, 150, 0.72, 0.3]], segs = 220, rows = 7;
    layers.forEach(function (L, li) {
      var dist = size * L[0], Hm = L[1], vb = pos.length / 3;
      for (var s = 0; s <= segs; s++) {
        var a = s / segs * Math.PI * 2, u = s / segs;
        var ridge = 0.25 + 0.75 * Math.pow(G.noise.fbm2(u, li * 0.37, 6, 5, 31 + li), 1.6) * 1.6;
        var peak = Math.min(1.25, ridge);
        for (var r = 0; r <= rows; r++) {
          var t = r / rows, rr = dist + (1 - t) * Hm * 0.9 * (0.6 + 0.4 * Math.sin(a * 7 + li));
          var jit = (G.noise.fbm2(u * 3 + t * 0.2, t + li, 12, 3, 47) - 0.5) * Hm * 0.25 * t;
          var y = -25 + t * (Hm * peak + 25) + jit, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
          pos.push(x, y, z);
          var hgt = y / (Hm * 1.1), c = new THREE.Color().copy(forestC).lerp(base, U.smooth(0.15, 0.55, hgt));
          if (li < 2 || hgt > 0.6) c.lerp(snow, U.smooth(0.72, 0.9, hgt + (G.noise.fbm2(u * 4, t, 8, 3, 9) - 0.5) * 0.25) * (Hm > 80 ? 1 : 0.4));
          c.multiplyScalar(0.92 + 0.16 * G.noise.fbm2(u * 9, t * 2, 16, 2, 5));
          col.push(c.r, c.g, c.b); hz.push(L[2] + (1 - t) * 0.25);
        }
      }
      for (s = 0; s < segs; s++) for (var q = 0; q < rows; q++) { var i0 = vb + s * (rows + 1) + q, i1 = i0 + rows + 1; ind.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1); }
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('haze', new THREE.Float32BufferAttribute(hz, 1));
    g.setIndex(ind); g.computeVertexNormals();
    // outward-facing check: normals should point toward the centre (we look at the ring from inside)
    var mat = new THREE.ShaderMaterial({
      uniforms: { haze: { value: new THREE.Color(0xcfe0dc) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(1, 1, 1) }, ambient: { value: new THREE.Color(0.5, 0.55, 0.6) } },
      vertexShader: 'attribute float haze; attribute vec3 color; varying vec3 vC; varying vec3 vN; varying float vH; varying float vY; void main(){ vC = color; vN = normalize(normal); vH = haze; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 haze; uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 ambient; varying vec3 vC; varying vec3 vN; varying float vH; varying float vY;' +
        'void main(){ vec3 n = normalize(vN); float l = max(dot(n, sunDir), 0.0); vec3 c = vC * (ambient + sunColor * l * 0.85); float h = clamp(vH + (1.0 - smoothstep(-10.0, 45.0, vY)) * 0.45, 0.0, 0.97); gl_FragColor = vec4(mix(c, haze, h), 1.0); }',
      side: THREE.DoubleSide, fog: false
    });
    var mesh = new THREE.Mesh(g, mat);
    mesh.name = 'mountains'; mesh.userData.base = new THREE.Color(0xffffff); mesh.frustumCulled = false; mesh.renderOrder = -10;
    return mesh;
  }

  var scatterChunks = []; // {mesh, cx, cz, r} for distance culling
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var clearZones = [];
  function makeBuildCtx(map, id) {
    var rng = U.rng(hashStr(id));
    var half = terrain.size / 2;
    var ctx = {
      map: map, id: id, root: HG.mapRoot, scene: HG.scene, rng: rng, size: terrain.size, half: half,
      waterLevel: terrain.waterLevel, quality: HG.quality, model: M, merge: M.merge,
      heightAt: terrain.heightAt, normalAt: terrain.normalAt, slopeAt: terrain.slopeAt,
      add: function (o) { HG.mapRoot.add(o); return o; },
      addCollider: function (x, z, r, opts) { return colliders.add(x, z, r, opts); },
      /** keep scatter() away from a circle (spawn clearings, buildings) */
      clearArea: function (x, z, r) { clearZones.push({ x: x, z: z, r: r }); },
      /** random valid point: opts {minH, maxH, slopeMax, margin, area:{x,z,r}, allowWater, avoidClear:true} -> {x,y,z} or null */
      randomPoint: function (opts) {
        opts = opts || {};
        for (var t = 0; t < 30; t++) {
          var x, z;
          if (opts.area) { var a = rng() * TAU, d = Math.sqrt(rng()) * opts.area.r; x = opts.area.x + Math.cos(a) * d; z = opts.area.z + Math.sin(a) * d; }
          else { var m = opts.margin == null ? 6 : opts.margin; x = (rng() * 2 - 1) * (half - m); z = (rng() * 2 - 1) * (half - m); }
          if (!terrain.inBounds(x, z, 2)) continue;
          var y = terrain.heightAt(x, z);
          if (!opts.allowWater && y < terrain.waterLevel + 0.4) continue;
          if (opts.minH != null && y < opts.minH) continue;
          if (opts.maxH != null && y > opts.maxH) continue;
          if (opts.slopeMax != null && terrain.slopeAt(x, z) > opts.slopeMax) continue;
          if (opts.density && rng() > opts.density(x, z)) continue;
          if (opts.avoidClear !== false) {
            var bad = false;
            for (var i = 0; i < clearZones.length; i++) { var cz = clearZones[i], dx = x - cz.x, dz = z - cz.z; if (dx * dx + dz * dz < cz.r * cz.r) { bad = true; break; } }
            if (bad) continue;
          }
          return { x: x, y: y, z: z };
        }
        return null;
      },
      /** Merge prepared geometries into one static mesh added to the map. opts {castShadow, receiveShadow, material} */
      addStatic: function (geos, opts) {
        opts = opts || {};
        if (!geos.length) return null;
        var mesh = new THREE.Mesh(M.merge(geos), opts.material || HG.vcMat);
        mesh.castShadow = !!opts.castShadow; mesh.receiveShadow = opts.receiveShadow !== false;
        HG.mapRoot.add(mesh); return mesh;
      },
      /** Instanced scatter. factory(rng, variantIndex) -> prepared BufferGeometry (vertex colours) or {geometry, material}.
       *  opts: {variants:1, minH, maxH, slopeMax, area, density(x,z)->0..1, scale:[min,max], collider:r (scaled), colliderHeight,
       *         cover:bool, solid:true (false = cover only, walk-through), tag, yOffset, align:bool (tilt to slope), castShadow, chunk:100 (m),
       *         viewDist (m; chunks farther than this are hidden — use ~70 for grass/flowers), allowWater, margin, lowMult:0.6 (count multiplier on Low)}
       *  -> {count, points:[{x,y,z,s,ry,v}], meshes:[InstancedMesh]} */
      scatter: function (factory, count, opts) {
        opts = opts || {};
        if (HG.quality.low) count = Math.round(count * (opts.lowMult == null ? 0.6 : opts.lowMult));
        var nv = opts.variants || 1, variants = [];
        for (var v = 0; v < nv; v++) {
          var r = factory(rng, v);
          if (r && r.isBufferGeometry) variants.push({ geometry: r, material: HG.vcMat });
          else if (r && r.geometry) variants.push({ geometry: r.geometry, material: r.material || HG.vcMat, lod: r.lod || null, castShadow: r.castShadow });
        }
        if (!variants.length) return { count: 0, points: [], meshes: [] };
        variants.forEach(function (vv) { if (!vv.geometry.boundingSphere) vv.geometry.computeBoundingSphere(); if (vv.lod && !vv.lod.geometry.boundingSphere) vv.lod.geometry.computeBoundingSphere(); });
        var chunkSize = opts.chunk || 100, nC = Math.max(1, Math.ceil(terrain.size / chunkSize));
        var buckets = {}, points = [], sc = opts.scale || [1, 1];
        for (var i = 0; i < count; i++) {
          var pt = ctx.randomPoint(opts); if (!pt) continue;
          var s = sc[0] + rng() * (sc[1] - sc[0]), ry = rng() * TAU, vi = Math.floor(rng() * variants.length);
          var p2 = { x: pt.x, y: pt.y + (opts.yOffset || 0) * s, z: pt.z, s: s, ry: ry, v: vi };
          points.push(p2);
          var cx = U.clamp(Math.floor((pt.x + half) / chunkSize), 0, nC - 1), cz = U.clamp(Math.floor((pt.z + half) / chunkSize), 0, nC - 1);
          var key = vi + ':' + cx + ':' + cz;
          (buckets[key] || (buckets[key] = { v: vi, cx: cx, cz: cz, pts: [] })).pts.push(p2);
          if (opts.collider) colliders.add(pt.x, pt.z, opts.collider * s, { h: (opts.colliderHeight || 6) * s, tag: opts.tag || '', cover: !!opts.cover, solid: opts.solid !== false });
        }
        var tints = opts.tint ? opts.tint.map(function (c) { return G.color(c); }) : null;
        var lodK = HG.quality.low ? 0.65 : HG.quality.level === 'ultra' ? 1.4 : 1;
        var meshes = [];
        for (var k in buckets) {
          var b = buckets[k], vr = variants[b.v], n = b.pts.length;
          var mats = new Float32Array(n * 16), cols = tints ? new Float32Array(n * 3) : null;
          var mx = 0, mz = 0;
          for (var j = 0; j < n; j++) {
            var q = b.pts[j];
            _obj.position.set(q.x, q.y, q.z); _obj.scale.setScalar(q.s);
            if (opts.align) { terrain.normalAt(q.x, q.z, _v4); _q1.setFromUnitVectors(_v3.set(0, 1, 0), _v4); _obj.quaternion.setFromAxisAngle(_v3, q.ry).premultiply(_q1); }
            else _obj.quaternion.setFromAxisAngle(_v3.set(0, 1, 0), q.ry);
            _obj.updateMatrix(); _obj.matrix.toArray(mats, j * 16);
            if (cols) { var tc = tints[Math.floor(rng() * tints.length)], kk = 0.88 + rng() * 0.24; cols[j * 3] = tc.r * kk; cols[j * 3 + 1] = tc.g * kk; cols[j * 3 + 2] = tc.b * kk; }
            mx += q.x; mz += q.z;
          }
          mx /= n; mz /= n;
          var rad = 0, gr = Math.max(vr.geometry.boundingSphere.radius, vr.lod ? vr.lod.geometry.boundingSphere.radius : 0);
          for (j = 0; j < n; j++) { var dd = U.dist2D(mx, mz, b.pts[j].x, b.pts[j].z) + gr * b.pts[j].s; if (dd > rad) rad = dd; }
          var sphere = new THREE.Sphere(new THREE.Vector3(mx, terrain.heightAt(mx, mz), mz), rad + 10);
          var shadow = opts.castShadow != null ? !!opts.castShadow : !!vr.castShadow;
          var im = scatterIM(vr.geometry, vr.material, n, mats, cols, sphere);
          im.castShadow = shadow; im.receiveShadow = opts.receiveShadow !== false;
          HG.mapRoot.add(im); meshes.push(im);
          var lo = null;
          if (vr.lod) {
            lo = scatterIM(vr.lod.geometry, vr.lod.material || vr.material, n, mats, cols, sphere);
            lo.castShadow = shadow; lo.receiveShadow = opts.receiveShadow !== false; lo.count = 0; lo.visible = false;
            HG.mapRoot.add(lo); meshes.push(lo);
          }
          scatterChunks.push({ mesh: im, lo: lo, cx: mx, cz: mz, r: rad, view: opts.viewDist || 0, mats: mats, cols: cols, n: n, lodDist: vr.lod ? (vr.lod.dist || 60) * lodK : 0, state: '', lx: 1e9, lz: 1e9 });
        }
        return { count: points.length, points: points, meshes: meshes };
      }
    };
    return ctx;
  }
  function disposeTree(root) {
    var geos = new Set(), mats = new Set();
    root.traverse(function (o) {
      if (o.geometry && !(o.geometry.userData && o.geometry.userData.shared)) geos.add(o.geometry);
      if (o.userData && o.userData.lodGeos) o.userData.lodGeos.forEach(function (g) { if (g && !(g.userData && g.userData.shared)) geos.add(g); });
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (!m.userData || !m.userData.shared) mats.add(m); });
      if (o.isSkinnedMesh && o.skeleton && o.skeleton.dispose) { try { o.skeleton.dispose(); } catch (e) {} }
    });
    geos.forEach(function (g) { try { g.dispose(); } catch (e) {} });
    mats.forEach(function (m) { try { if (m.map && !(m.map.userData && m.map.userData.shared)) m.map.dispose(); m.dispose(); } catch (e) {} });
  }
  HG.disposeObject = function (o) { if (!o) return; if (o.parent) o.parent.remove(o); disposeTree(o); };
  function unloadMap() {
    if (!HG.mapRoot) return;
    var old = HG.map;
    HG.emit('mapUnload', old);
    HG.clearAnimals();
    clearTrackDots();
    clearProjectiles();
    HG.scene.remove(HG.mapRoot);
    disposeTree(HG.mapRoot);
    HG.mapRoot = null; HG.map = null; HG.mapId = null; HG.water = null; HG.mountains = null;
    terrain.ready = false; terrain.grid = null; terrain.mesh = null; terrain.grassW = null; G.grass.mesh = null;
    colliders.clear(); scatterChunks.length = 0; clearZones.length = 0;
    ui.clearContext();
  }
  /** Dispose the current map and build map id. Returns true on success. */
  HG.loadMap = function (id) {
    var map = HG.maps[id];
    if (!map) { console.error('[HG] unknown map ' + id); return false; }
    unloadMap();
    HG.map = map; HG.mapId = id; map.id = id;
    HG.mapRoot = new THREE.Group(); HG.mapRoot.name = 'map:' + id;
    HG.scene.add(HG.mapRoot);
    HG.mapRoot.add(buildTerrain(map));
    var water = buildWater(map); if (water) { HG.mapRoot.add(water); HG.water = water; }
    var mts = buildMountains(map); if (mts) { HG.mapRoot.add(mts); HG.mountains = mts; }
    var sp = map.playerSpawn || { x: 0, z: terrain.size * 0.3 };
    clearZones.push({ x: sp.x, z: sp.z, r: 14 });
    var ctx = makeBuildCtx(map, id);
    HG.mapCtx = ctx;
    try { if (map.build) map.build(ctx); } catch (e) { console.error('[HG] map build failed', e); }
    try { G.initGrass(map); } catch (e) { console.error('[HG] grass', e); }
    HG.env.apply();
    G.markEnvDirty(); if (HG.booted || HG.state !== 'boot') G.updateEnvMap(true);
    HG.emit('mapLoaded', map, ctx);
    return true;
  };
  HG.isMapUnlocked = function (id) {
    var m = HG.maps[id]; if (!m) return false;
    if (HG.save.unlockedMaps.indexOf(id) >= 0) return true;
    return !m.price && HG.save.level >= (m.levelReq || 1);
  };
  /** Unlock a map with in-game currency (map.price cash or map.currency 'gold'). Returns true if unlocked now or already. */
  HG.unlockMap = function (id) {
    var m = HG.maps[id]; if (!m) return false;
    if (HG.save.unlockedMaps.indexOf(id) >= 0) return true;
    if (HG.save.level < (m.levelReq || 1)) { ui.toast('Reach level ' + m.levelReq + ' to unlock ' + m.name, { color: 'var(--amber-2)' }); return false; }
    var cur = m.currency === 'gold' ? 'gold' : 'cash', price = m.price || 0;
    if (HG.save[cur] < price) { ui.toast('Not enough ' + (cur === 'gold' ? 'gold' : 'cash'), { color: 'var(--danger)' }); HG.sfx('deny'); return false; }
    HG.save[cur] -= price;
    HG.save.unlockedMaps.push(id);
    HG.sfx('buy'); HG.store();
    HG.emit('purchase', { id: 'map_' + id, category: 'maps', name: m.name, price: price, currency: cur, mapId: id });
    HG.emit('mapUnlocked', id);
    return true;
  };
  function scatterIM(geo, mat, n, mats, cols, sphere) {
    var g = new THREE.BufferGeometry();
    for (var an in geo.attributes) g.setAttribute(an, geo.attributes[an]);
    if (geo.index) g.setIndex(geo.index);
    g.boundingSphere = sphere;
    var im = new THREE.InstancedMesh(g, mat, n);
    im.instanceMatrix.array.set(mats);
    // always attach instance colours: r128 shares one program per material, so every instanced user of a material must agree
    im.instanceColor = new THREE.InstancedBufferAttribute(cols ? new Float32Array(cols) : new Float32Array(n * 3).fill(1), 3);
    if (mat.alphaTest > 0 || (mat.userData && mat.userData.wind)) im.customDepthMaterial = G.depthMaterial(mat);
    im.instanceMatrix.needsUpdate = true;
    im.userData.scatter = true;
    return im;
  }
  function fillIM(im, mats, cols) {
    im.instanceMatrix.array.set(mats); im.count = mats.length / 16; im.instanceMatrix.needsUpdate = true;
    if (cols && im.instanceColor) { im.instanceColor.array.set(cols); im.instanceColor.needsUpdate = true; }
  }
  function partitionChunk(c, px, pz) {
    var hi = c.mesh, lo = c.lo, ha = hi.instanceMatrix.array, la = lo.instanceMatrix.array, m = c.mats, cols = c.cols;
    var hc = cols && hi.instanceColor ? hi.instanceColor.array : null, lc = cols && lo.instanceColor ? lo.instanceColor.array : null;
    var nh = 0, nl = 0, d2 = c.lodDist * c.lodDist, k;
    for (var j = 0; j < c.n; j++) {
      var o = j * 16, dx = m[o + 12] - px, dz = m[o + 14] - pz;
      if (dx * dx + dz * dz < d2) { for (k = 0; k < 16; k++) ha[nh * 16 + k] = m[o + k]; if (hc) { hc[nh * 3] = cols[j * 3]; hc[nh * 3 + 1] = cols[j * 3 + 1]; hc[nh * 3 + 2] = cols[j * 3 + 2]; } nh++; }
      else { for (k = 0; k < 16; k++) la[nl * 16 + k] = m[o + k]; if (lc) { lc[nl * 3] = cols[j * 3]; lc[nl * 3 + 1] = cols[j * 3 + 1]; lc[nl * 3 + 2] = cols[j * 3 + 2]; } nl++; }
    }
    hi.count = nh; lo.count = nl; hi.instanceMatrix.needsUpdate = true; lo.instanceMatrix.needsUpdate = true;
    if (hc) hi.instanceColor.needsUpdate = true; if (lc) lo.instanceColor.needsUpdate = true;
  }
  /** distance culling + per-instance LOD partition of scatter chunks (every 0.25 s) */
  function updateChunkCulling() {
    var cx = HG.camera.position.x, cz = HG.camera.position.z, far = HG.scene.fog.far + 8;
    for (var i = 0; i < scatterChunks.length; i++) {
      var c = scatterChunks[i], dc = U.dist2D(cx, cz, c.cx, c.cz), d = dc - c.r;
      var vis = d < (c.view ? Math.min(far, c.view) : far);
      if (!c.lo) { c.mesh.visible = vis; continue; }
      if (!vis) { c.mesh.visible = c.lo.visible = false; continue; }
      var st = dc + c.r < c.lodDist ? 'near' : (d > c.lodDist ? 'far' : 'mixed');
      if (st === 'near') { if (c.state !== 'near') { fillIM(c.mesh, c.mats, c.cols); c.lo.count = 0; } }
      else if (st === 'far') { if (c.state !== 'far') { fillIM(c.lo, c.mats, c.cols); c.mesh.count = 0; } }
      else if (c.state !== 'mixed' || (cx - c.lx) * (cx - c.lx) + (cz - c.lz) * (cz - c.lz) > 9) { partitionChunk(c, cx, cz); c.lx = cx; c.lz = cz; }
      c.state = st;
      c.mesh.visible = c.mesh.count > 0; c.lo.visible = c.lo.count > 0;
    }
  }

  /* ------------------------------------------------------------------
   * Player
   * ------------------------------------------------------------------ */
  var player = HG.player = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
    height: 1.65, standHeight: 1.65, crouchHeight: 1.0,
    crouch: false, sprint: false, stamina: 1, health: 100, maxHealth: 100,
    noise: 0, visibility: 1, scentMult: 1,
    inVehicle: null, onStand: null, frozen: false,
    speedMult: 1, noiseMult: 1, visibilityMult: 1, staminaMult: 1,
    walkSpeed: 3.3, sprintSpeed: 6.4, crouchSpeed: 1.6, radius: 0.4,
    speed: 0, moving: false, shotNoise: 0, lastHurt: -99, recoilPitch: 0, recoilYaw: 0,
    fovOverride: null, inCover: false, bobPhase: 0, roll: 0
  };
  var stepDist = 0;
  /** Damage the player (aggressive animals). source = animal or string. */
  HG.hurtPlayer = function (amount, source) {
    if (HG.state !== 'hunt' || player.health <= 0) return;
    if (HG.debug && HG.debug.god) return;
    amount = Math.max(0, amount * (player.damageMult == null ? 1 : player.damageMult));
    player.health = Math.max(0, player.health - amount);
    player.lastHurt = HG.time;
    ui.hurtFlash(0.5 + amount / 60);
    HG.sfx('hurt'); HG.vibrate(120);
    player.recoilPitch += 0.06; player.roll = (Math.random() - 0.5) * 0.2;
    HG.emit('playerHurt', amount, source);
    if (player.health <= 0) {
      HG.emit('playerDown');
      HG.save.stats.timesDowned++;
      setTimeout(function () { if (HG.state === 'hunt') HG.endHunt({ downed: true }); }, 700);
    }
  };
  HG.healPlayer = function (n) { player.health = Math.min(player.maxHealth, player.health + n); };
  /** Place the player (feet) at x,z on the terrain, facing yaw. */
  HG.placePlayer = function (x, z, yaw) {
    player.pos.set(x, terrain.heightAt(x, z), z); player.vel.set(0, 0, 0);
    if (yaw != null) player.yaw = yaw;
    player.pitch = 0;
  };
  HG.setCrouch = function (on) {
    player.crouch = !!on; ui.setActionActive('crouch', player.crouch);
    HG.emit('crouch', player.crouch);
  };
  var aimAssist = { target: null, zone: null, err: 0 };
  function updatePlayer(dt) {
    // --- look ---
    var fovRatio = HG.camera.fov / (HG.settings.fov || HG.config.baseFov);
    var lx = input.lookX, ly = input.lookY;
    input.lookX = 0; input.lookY = 0;
    if (player.frozen) { lx = ly = 0; }
    if (aimAssist.target) { lx *= 0.6; ly *= 0.6; }
    player.yaw -= lx * fovRatio;
    player.pitch -= ly * fovRatio;
    if (aimAssist.target && (Math.abs(lx) > 0.0005 || Math.abs(ly) > 0.0005 || player.moving)) {
      // gentle magnetism toward the assisted zone
      var at = aimAssist.target;
      var dyaw = U.angleDiff(player.yaw, aimAssist.yaw), dp = aimAssist.pitch - player.pitch;
      player.yaw += dyaw * Math.min(1, dt * 4); player.pitch += dp * Math.min(1, dt * 4);
    }
    player.pitch = U.clamp(player.pitch, -1.45, 1.45);
    player.yaw = U.wrap(player.yaw);

    // --- movement ---
    var mx = input.move.x, my = input.move.y, mag = Math.min(1, Math.sqrt(mx * mx + my * my));
    if (player.frozen) { mx = my = mag = 0; }
    var aiming = HG.weapon && HG.weapon.aimT > 0.3;
    if (input.sprintToggle && (player.stamina <= 0.02 || (input.isTouch && !input.joystick.active))) { input.sprintToggle = false; ui.setActionActive('sprint', false); }
    var wantSprint = input.sprint && my > 0.3 && !player.crouch && !aiming && player.stamina > 0.04;
    if (wantSprint && player.crouch) HG.setCrouch(false);
    player.sprint = wantSprint && mag > 0.2;
    if (!player.inVehicle && !player.onStand) {
      var base = player.sprint ? player.sprintSpeed : player.crouch ? player.crouchSpeed : player.walkSpeed;
      if (aiming) base *= 0.55;
      base *= player.speedMult;
      var fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
      var tvx = (fx * my + rx * mx) * base, tvz = (fz * my + rz * mx) * base;
      if (mag > 1e-3 && mag < 1) { /* analog already scales */ }
      player.vel.x = U.damp(player.vel.x, tvx, 12, dt); player.vel.z = U.damp(player.vel.z, tvz, 12, dt);
      var ox = player.pos.x, oz = player.pos.z;
      // uphill slows a little
      var nx = ox + player.vel.x * dt, nz = oz + player.vel.z * dt;
      var h0 = terrain.heightAt(ox, oz), h1 = terrain.heightAt(nx, nz);
      var run = Math.sqrt((nx - ox) * (nx - ox) + (nz - oz) * (nz - oz));
      if (run > 1e-5) {
        var grade = (h1 - h0) / run;
        if (grade > 0.25) { var k = U.clamp(1 - (grade - 0.25) * 1.2, 0.25, 1); nx = ox + (nx - ox) * k; nz = oz + (nz - oz) * k; }
      }
      player.pos.x = nx; player.pos.z = nz;
      colliders.resolve(player.pos, player.radius, null);
      var half = terrain.size / 2 - 3;
      player.pos.x = U.clamp(player.pos.x, -half, half); player.pos.z = U.clamp(player.pos.z, -half, half);
      if (terrain.heightAt(player.pos.x, player.pos.z) < terrain.waterLevel - 0.55) { player.pos.x = ox; player.pos.z = oz; player.vel.multiplyScalar(0.2); }
      player.pos.y = terrain.heightAt(player.pos.x, player.pos.z);
      var moved = U.dist2D(ox, oz, player.pos.x, player.pos.z);
      player.speed = moved / Math.max(dt, 1e-4);
      stepDist += moved;
      HG.save.stats.distanceWalked += moved;
      var stride = player.sprint ? 2.1 : player.crouch ? 1.0 : 1.6;
      if (stepDist > stride) {
        stepDist = 0;
        var inWater = terrain.heightAt(player.pos.x, player.pos.z) < terrain.waterLevel;
        HG.sfx(inWater ? 'splash' : 'step', { volume: player.crouch ? 0.35 : player.sprint ? 1 : 0.7 });
        HG.emit('step', player.sprint, player.crouch);
      }
    } else {
      player.speed = player.inVehicle ? player.vel.length() : 0;
    }
    player.moving = player.speed > 0.3;
    // --- stamina ---
    if (player.sprint && player.moving) player.stamina = Math.max(0, player.stamina - dt * 0.16 / player.staminaMult);
    else player.stamina = Math.min(1, player.stamina + dt * (player.moving ? 0.08 : 0.16) * player.staminaMult);
    // --- noise & visibility ---
    var moveNoise = 0;
    if (player.inVehicle) moveNoise = player.inVehicle.noise == null ? 0.7 : player.inVehicle.noise;
    else if (player.moving) moveNoise = player.sprint ? 0.85 : player.crouch ? 0.12 : 0.35 * U.clamp(player.speed / player.walkSpeed, 0.3, 1);
    player.shotNoise = Math.max(0, player.shotNoise - dt * 0.9);
    player.noise = U.clamp(Math.max(moveNoise * player.noiseMult, player.shotNoise), 0, 1);
    player._coverT = (player._coverT || 0) - dt;
    if (player._coverT <= 0) { player._coverT = 0.3; player.inCover = colliders.coverNear(player.pos.x, player.pos.z, 2.6); }
    var vis = player.crouch ? 0.55 : 1;
    if (!player.moving) vis *= 0.75;
    if (player.inCover) vis *= 0.7;
    if (player.onStand) vis *= 0.6;
    vis *= player.visibilityMult * (0.45 + 0.55 * HG.env.daylight);
    player.visibility = U.clamp(vis, 0.05, 1);
    // --- health regen ---
    if (HG.time - player.lastHurt > 6 && player.health < player.maxHealth) player.health = Math.min(player.maxHealth, player.health + dt * 5);
    // --- camera ---
    var targetH = player.crouch ? player.crouchHeight : player.standHeight;
    if (player.inVehicle && player.inVehicle.eyeHeight != null) targetH = player.inVehicle.eyeHeight;
    player.height = U.damp(player.height, targetH, 10, dt);
    var bobK = player.inVehicle || player.onStand ? 0 : U.clamp(player.speed / player.walkSpeed, 0, 1.6);
    player.bobPhase += dt * (player.sprint ? 11 : 7.5) * (bobK > 0.05 ? 1 : 0);
    var bob = Math.sin(player.bobPhase * 2) * 0.035 * bobK;
    player.recoilPitch = U.damp(player.recoilPitch, 0, 7, dt);
    player.recoilYaw = U.damp(player.recoilYaw, 0, 7, dt);
    player.roll = U.damp(player.roll, 0, 5, dt);
    HG.camera.position.set(player.pos.x, player.pos.y + player.height + bob, player.pos.z);
    HG.camera.rotation.set(player.pitch + player.recoilPitch, player.yaw + player.recoilYaw, player.roll + Math.sin(player.bobPhase) * 0.004 * bobK);
  }

  /* ------------------------------------------------------------------
   * Animals: registry, spawning, AI state machine, population
   * ------------------------------------------------------------------ */
  HG.animalTypes = HG.animalTypes || {};
  HG.animals = [];
  HG.RARITY = {
    common: { mult: 1, color: '#d9ccb0', label: 'Common' },
    uncommon: { mult: 1.6, color: '#8fd16a', label: 'Uncommon' },
    rare: { mult: 2.6, color: '#5fb8ff', label: 'Rare' },
    legendary: { mult: 5, color: '#ffb54d', label: 'Legendary' }
  };
  var animalRoot = new THREE.Group(); animalRoot.name = 'animals';
  HG.scene.add(animalRoot);
  HG.animalRoot = animalRoot;
  var animalSeq = 1, groupSeq = 1;
  var LEG_OFFS = [0, PI, PI, 0, PI * 0.5, PI * 1.5];
  function defaultSenses(def) { var s = def.senses || {}; return { sight: s.sight || 60, hearing: s.hearing || 50, smell: s.smell || 70 }; }

  /** HG.spawnAnimal(type, pos{x,z}|Vector3, opts) -> animal or null.
   *  opts: {yaw, legendary:bool, weight, group, leader, state, scale, noCount:bool (ignored by population cap), data:{}} */
  HG.spawnAnimal = function (type, pos, opts) {
    var def = HG.animalTypes[type];
    if (!def || !terrain.ready) return null;
    opts = opts || {};
    var built;
    try { built = def.buildMesh(opts); } catch (e) { console.error('[HG] buildMesh failed for ' + type, e); return null; }
    if (!built) return null;
    var root = built.isObject3D ? built : built.root;
    if (!built.isObject3D) built.root = root;
    var wr = def.weightRange || [10, 20];
    var legendary = !!opts.legendary || def.rarity === 'legendary';
    var wf = opts.weight != null ? U.clamp((opts.weight - wr[0]) / Math.max(1e-3, wr[1] - wr[0]), 0, 1) : Math.pow(Math.random(), 1.7);
    if (legendary && opts.weight == null) wf = 0.85 + Math.random() * 0.15;
    var weight = opts.weight != null ? opts.weight : (wr[0] + (wr[1] - wr[0]) * wf) * (legendary && def.rarity !== 'legendary' ? 1.35 : 1);
    var scale = (opts.scale || 1) * (def.size || 1) * (0.86 + 0.28 * wf) * (legendary && def.rarity !== 'legendary' ? 1.18 : 1);
    var x = pos.x, z = pos.z;
    var a = {
      id: animalSeq++, type: type, def: def, root: root, parts: built,
      legs: built.legs || [], head: built.head || null, tail: built.tail || null, wings: built.wings || null,
      pos: root.position, yaw: opts.yaw != null ? opts.yaw : Math.random() * TAU, goalYaw: 0,
      scale: scale, weight: Math.round(weight * 10) / 10, weightFrac: wf, legendary: legendary,
      hp: (def.hp || 100) * (legendary ? 1.5 : 1), maxHp: (def.hp || 100) * (legendary ? 1.5 : 1),
      alive: true, dead: false, wounded: false, hits: 0,
      state: 'idle', stateTime: 0, stateDur: 2 + Math.random() * 4, prevState: null,
      speed: 0, moveSpeed: 0, target: new THREE.Vector3(x, 0, z), threat: new THREE.Vector3(), threatType: '',
      awareness: 0, lastCause: '', group: opts.group || groupSeq++, leader: opts.leader || null,
      phase: Math.random() * TAU, bob: 0, alt: 0, headPitch: 0, tailLift: 0,
      perceptT: Math.random() * 0.25, distToPlayer: U.dist2D(x, z, player.pos.x, player.pos.z), dotDist: 0, deadT: 0, fadeT: -1, tipDir: 1, attackCD: 0,
      noCount: !!opts.noCount, seenByPlayer: false, data: opts.data || {}, senses: defaultSenses(def)
    };
    a.goalYaw = a.yaw;
    root.position.set(x, terrain.heightAt(x, z), z);
    root.rotation.set(0, a.yaw, 0);
    root.scale.setScalar(scale);
    root.userData.animal = a;
    var shadows = !HG.quality.low;
    root.traverse(function (o) { if (o.isMesh) { o.castShadow = shadows; o.userData.animal = a; } });
    if (built.head) a.headBase = built.head.rotation.x;
    if (def.fly && opts.state !== 'idle') a.alt = 0;
    animalRoot.add(root);
    HG.animals.push(a);
    if (opts.state) setState(a, opts.state);
    if (def.init) { try { def.init(a); } catch (e) { console.error('[HG] animal init ' + type, e); } }
    HG.emit('animalSpawn', a);
    return a;
  };
  /** Spawn a herd/group around (x,z). Returns array (first = leader). */
  HG.spawnGroup = function (type, x, z, count, opts) {
    var out = [], gid = groupSeq++, leader = null;
    opts = opts || {};
    for (var i = 0; i < count; i++) {
      var px = x, pz = z;
      if (i > 0) {
        for (var t = 0; t < 6; t++) {
          var ang = Math.random() * TAU, d = 2 + Math.random() * 6;
          px = x + Math.cos(ang) * d; pz = z + Math.sin(ang) * d;
          if (!terrain.isWater(px, pz) && terrain.inBounds(px, pz, 4)) break;
        }
      }
      var o = {}; for (var k in opts) o[k] = opts[k];
      o.group = gid; o.leader = leader; if (i > 0) o.legendary = false;
      var a = HG.spawnAnimal(type, { x: px, z: pz }, o);
      if (a) { if (!leader) leader = a; out.push(a); }
    }
    return out;
  };
  HG.removeAnimal = function (a) {
    var i = HG.animals.indexOf(a); if (i < 0) return;
    HG.animals.splice(i, 1);
    a.alive = false; a.removed = true;
    HG.emit('animalRemove', a);
    if (a.def.dispose) { try { a.def.dispose(a); } catch (e) { console.error(e); } }
    HG.disposeObject(a.root);
    for (var j = 0; j < HG.animals.length; j++) if (HG.animals[j].leader === a) HG.animals[j].leader = null;
  };
  HG.clearAnimals = function () { while (HG.animals.length) HG.removeAnimal(HG.animals[HG.animals.length - 1]); };

  function setState(a, s, cause) {
    if (a.dead && s !== 'dead') return;
    a.prevState = a.state; a.state = s; a.stateTime = 0;
    var def = a.def;
    switch (s) {
      case 'idle': a.stateDur = 2 + Math.random() * 5; break;
      case 'graze': a.stateDur = 4 + Math.random() * 8; break;
      case 'wander': a.stateDur = 8 + Math.random() * 14; pickWanderTarget(a); break;
      case 'alert': a.stateDur = 2.5 + Math.random() * 3; break;
      case 'flee': a.stateDur = (a.wounded ? 9 : 6) + Math.random() * 6; a.fleeYaw = U.yawTo(a.threat.x, a.threat.z, a.pos.x, a.pos.z) + (Math.random() - 0.5) * 0.6; break;
      case 'warn': a.stateDur = def.warnTime || 1.7; break;
      case 'charge': a.stateDur = 25; break;
      case 'retreat': a.stateDur = 1.1 + Math.random() * 0.8; break;
      case 'wounded': a.stateDur = 8 + Math.random() * 8; break;
      case 'dead': break;
    }
    if (s === 'alert') {
      if (def.onAlert) { try { def.onAlert(a, cause); } catch (e) { console.error(e); } }
      HG.emit('animalAlert', a, cause || a.lastCause || 'unknown');
      if (def.sounds && def.sounds.alert && Math.random() < 0.6) HG.sfx(def.sounds.alert, { pos: a.pos });
    }
    if (s === 'warn') {
      if (def.sounds && def.sounds.warn) HG.sfx(def.sounds.warn, { pos: a.pos }); else HG.sfx('growl', { pos: a.pos });
      HG.emit('animalWarn', a);
      if (!a._warnedToast) { a._warnedToast = true; ui.toast((def.name || 'Animal') + ' is about to charge!', { color: 'var(--danger)' }); }
    }
    if (s === 'flee' && def.sounds && def.sounds.flee && Math.random() < 0.7) HG.sfx(def.sounds.flee, { pos: a.pos });
    HG.emit('animalState', a, s, a.prevState);
  }
  HG.setAnimalState = setState;
  function goodGround(x, z) { return terrain.inBounds(x, z, 6) && !terrain.isWater(x, z) && terrain.slopeAt(x, z) < 1.1; }
  function pickWanderTarget(a) {
    var L = a.leader && !a.leader.dead && !a.leader.removed ? a.leader : null;
    for (var t = 0; t < 8; t++) {
      var x, z;
      if (L) { var ang = Math.random() * TAU, d = 3 + Math.random() * 7; x = L.target.x + Math.cos(ang) * d; z = L.target.z + Math.sin(ang) * d; }
      else { var ang2 = a.yaw + (Math.random() - 0.5) * 2.4, d2 = 10 + Math.random() * 28; x = a.pos.x - Math.sin(ang2) * d2; z = a.pos.z - Math.cos(ang2) * d2; }
      if (goodGround(x, z)) { a.target.set(x, 0, z); return; }
    }
    a.target.set(a.pos.x * 0.9, 0, a.pos.z * 0.9);
  }
  /** Make an animal react to a threat at position p (e.g. a gunshot). strength 0..2 adds awareness. delay (s) = reaction time. */
  HG.alertAnimal = function (a, p, strength, cause, delay) {
    if (!a || a.dead) return;
    if (delay > 0) {
      if (!a._pendingAlert || a._pendingAlert.t > delay) a._pendingAlert = { t: delay, x: p.x, y: p.y || 0, z: p.z, s: strength, c: cause };
      return;
    }
    a.threat.set(p.x, p.y || 0, p.z); a.threatType = cause || 'noise'; a.lastCause = cause || 'noise';
    a.awareness = Math.min(2, a.awareness + (strength == null ? 1 : strength));
    if (a.awareness >= 1) react(a, a.lastCause);
    else if (a.state === 'idle' || a.state === 'graze' || a.state === 'wander') setState(a, 'alert', a.lastCause);
  };
  function react(a, cause) {
    if (a.dead) return;
    var t = a.def.temperament || 'skittish';
    if (a.state === 'flee' || a.state === 'charge' || a.state === 'warn' || a.state === 'retreat') return;
    var d = a.distToPlayer = U.dist2D(a.pos.x, a.pos.z, player.pos.x, player.pos.z);
    var threatIsPlayer = a.threatType === 'player' || a.threatType === 'shot' || a.threatType === 'hit';
    if (threatIsPlayer && (t === 'aggressive' && d < Math.max(30, a.senses.sight * 0.7) || t === 'territorial' && d < (a.def.territory || 22)) && a.hp > a.maxHp * 0.3) {
      if (a.state !== 'warn') setState(a, 'warn');
      return;
    }
    setState(a, 'flee');
    // herd follows
    for (var i = 0; i < HG.animals.length; i++) {
      var b = HG.animals[i];
      if (b === a || b.dead || b.group !== a.group) continue;
      if (U.dist2D(a.pos.x, a.pos.z, b.pos.x, b.pos.z) < 60 && b.state !== 'flee') {
        b.threat.copy(a.threat); b.threatType = a.threatType; b.awareness = Math.max(b.awareness, 1);
        b._fleeDelay = 0.15 + Math.random() * 0.5;
      }
    }
  }
  function lineOfSight(a, eyeY) {
    var cam = HG.camera.position;
    var ax = a.pos.x, az = a.pos.z, ay = a.pos.y + eyeY;
    for (var i = 1; i < 6; i++) {
      var t = i / 6, x = ax + (cam.x - ax) * t, z = az + (cam.z - az) * t, y = ay + (cam.y - ay) * t;
      if (terrain.heightAt(x, z) > y + 0.1) return false;
    }
    _v1.set(ax, ay, az); _v2.set(cam.x - ax, cam.y - ay, cam.z - az);
    var len = _v2.length(); if (len < 1e-3) return true;
    _v2.multiplyScalar(1 / len);
    return colliders.raycast(_v1, _v2, len - 1) === Infinity;
  }
  function perceive(a, pdt) {
    var s = a.senses, def = a.def, dist = a.distToPlayer;
    if (HG.state !== 'hunt' || player.health <= 0) { a.awareness = Math.max(0, a.awareness - pdt * 0.2); return; }
    var stim = 0, cause = '';
    var night = HG.env.daylight < 0.3 && def.activeAt !== 'night' ? 0.55 : 1;
    var grazing = a.state === 'graze' ? 0.55 : 1;
    var sightR = s.sight * player.visibility * night * grazing;
    var dx = player.pos.x - a.pos.x, dz = player.pos.z - a.pos.z;
    if (dist < sightR) {
      var fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), dot = (dx * fx + dz * fz) / Math.max(dist, 0.01);
      if ((dot > -0.45 || a.state === 'alert') && lineOfSight(a, 1.1 * a.scale)) {
        var k = 1 - dist / sightR, mv = player.moving ? (player.sprint ? 2.2 : 1.4) : 0.45;
        stim += k * mv * 2.0; cause = 'sight';
      }
    }
    var hearR = s.hearing * player.noise;
    if (dist < hearR) { stim += (1 - dist / hearR) * 2.2; cause = cause || 'sound'; }
    var smellR = s.smell * player.scentMult * (0.55 + Math.min(HG.wind.speed, 8) / 9);
    if (dist < smellR && dist > 0.1) {
      var wx = -dx / dist, wz = -dz / dist, wd = wx * HG.wind.vec.x + wz * HG.wind.vec.z;
      if (wd > 0.72) { stim += 2.8 * (1 - dist / smellR) + 0.6; cause = 'scent'; }
    }
    if (dist < 4 && !player.onStand) { stim += 3; cause = cause || 'close'; }
    if (stim > 0) {
      a.awareness = Math.min(2, a.awareness + stim * pdt);
      a.threat.copy(player.pos); a.threatType = 'player'; a.lastCause = cause;
    } else a.awareness = Math.max(0, a.awareness - pdt * 0.12);
    a.sensing = stim > 0;
    var calm = a.state === 'idle' || a.state === 'graze' || a.state === 'wander';
    var thr = def.temperament === 'calm' ? 1.3 : 1;
    if (calm && a.awareness > 0.35 * thr) setState(a, 'alert', cause);
    if ((calm || a.state === 'alert' || a.state === 'wounded') && a.awareness >= thr) react(a, cause);
  }
  var _fwd = new THREE.Vector3();
  function steerYaw(a, goal, rate, dt) { a.yaw += U.clamp(U.angleDiff(a.yaw, goal), -rate * dt, rate * dt); }
  function updateAnimalAI(a, dt) {
    var def = a.def, spd = def.speed || { walk: 1.4, run: 8 };
    var woundK = a.wounded ? 0.68 : 1;
    if (a._fleeDelay != null) { a._fleeDelay -= dt; if (a._fleeDelay <= 0) { a._fleeDelay = null; if (!a.dead && a.state !== 'flee') react(a, 'herd'); } }
    var L = a.leader && !a.leader.dead && !a.leader.removed ? a.leader : null;
    switch (a.state) {
      case 'idle':
      case 'graze':
        a.moveSpeed = 0;
        if (a.stateTime > a.stateDur) {
          if (L && U.dist2D(a.pos.x, a.pos.z, L.pos.x, L.pos.z) > 10) setState(a, 'wander');
          else setState(a, Math.random() < 0.55 ? 'wander' : (a.state === 'idle' ? 'graze' : 'idle'));
        }
        break;
      case 'wander':
        if (L && L.state === 'wander' && a.stateTime > 1 && Math.random() < dt * 0.5) a.target.set(L.target.x + (Math.random() - 0.5) * 10, 0, L.target.z + (Math.random() - 0.5) * 10);
        var dtx = a.target.x - a.pos.x, dtz = a.target.z - a.pos.z, dd = Math.sqrt(dtx * dtx + dtz * dtz);
        a.goalYaw = U.yawTo(a.pos.x, a.pos.z, a.target.x, a.target.z);
        a.moveSpeed = spd.walk * woundK * (dd < 3 ? dd / 3 : 1);
        if (dd < 1.2 || a.stateTime > a.stateDur) setState(a, Math.random() < 0.6 ? 'graze' : 'idle');
        steerYaw(a, a.goalYaw, 1.8, dt);
        break;
      case 'alert':
        a.moveSpeed = 0;
        steerYaw(a, U.yawTo(a.pos.x, a.pos.z, a.threat.x, a.threat.z), 2.5, dt);
        if (a.stateTime > a.stateDur) {
          if (a.awareness < 0.3) setState(a, 'idle');
          else if (a.awareness > 0.75) react(a, a.lastCause);
          else { a.stateDur += 1.5; a.awareness -= 0.1; }
        }
        break;
      case 'flee':
        var fy = a.fleeYaw;
        if (L && L.state === 'flee' && L.fleeYaw != null) fy = L.fleeYaw + (a.id % 3 - 1) * 0.25;
        // keep running away from the threat, zig-zag a little
        var away = U.yawTo(a.threat.x, a.threat.z, a.pos.x, a.pos.z);
        fy += U.angleDiff(fy, away) * 0.3;
        fy += Math.sin(a.stateTime * 1.7 + a.id) * 0.35;
        // obstacle / water / edge avoidance by probing ahead
        for (var tries = 0; tries < 4; tries++) {
          var px = a.pos.x - Math.sin(fy) * 7, pz = a.pos.z - Math.cos(fy) * 7;
          if (goodGround(px, pz)) break;
          fy += (a.id % 2 ? 1 : -1) * 0.9;
        }
        a.fleeYaw = U.wrap(fy - Math.sin(a.stateTime * 1.7 + a.id) * 0.35);
        a.goalYaw = fy;
        a.moveSpeed = spd.run * woundK * (a.stateTime < 0.4 ? 0.6 : 1);
        steerYaw(a, a.goalYaw, 3.5, dt);
        if (a.stateTime > a.stateDur) {
          var far = U.dist2D(a.pos.x, a.pos.z, a.threat.x, a.threat.z) > 70;
          if (far || a.stateTime > a.stateDur + 8) { a.awareness = 0.5; setState(a, a.wounded ? 'wounded' : 'wander'); }
        }
        break;
      case 'warn':
        a.moveSpeed = 0;
        steerYaw(a, U.yawTo(a.pos.x, a.pos.z, player.pos.x, player.pos.z), 3, dt);
        threatIndicator(a, 0.75);
        if (a.stateTime > a.stateDur) setState(a, 'charge');
        break;
      case 'charge':
        a.goalYaw = U.yawTo(a.pos.x, a.pos.z, player.pos.x, player.pos.z);
        steerYaw(a, a.goalYaw, 4, dt);
        a.moveSpeed = spd.run * 1.05 * woundK;
        threatIndicator(a, 1);
        var reach = def.attackRange || (1.2 + a.scale * 0.9);
        if (a.distToPlayer < reach && a.attackCD <= 0 && !player.onStand) {
          a.attackCD = def.attackCooldown || 1.4;
          HG.hurtPlayer(def.damage || 20, a);
          if (def.sounds && def.sounds.attack) HG.sfx(def.sounds.attack, { pos: a.pos }); else HG.sfx('growl', { pos: a.pos, volume: 1.2 });
          setState(a, 'retreat');
        }
        if (a.distToPlayer > 75 || a.stateTime > a.stateDur || HG.state !== 'hunt') { a.awareness = 0.4; setState(a, 'wander'); }
        if (a.hp < a.maxHp * 0.3) setState(a, 'flee');
        break;
      case 'retreat':
        a.goalYaw = U.yawTo(player.pos.x, player.pos.z, a.pos.x, a.pos.z);
        steerYaw(a, a.goalYaw, 5, dt);
        a.moveSpeed = spd.walk * 1.6;
        threatIndicator(a, 0.6);
        if (a.stateTime > a.stateDur) setState(a, player.health > 0 ? 'charge' : 'wander');
        break;
      case 'wounded':
        a.goalYaw = U.yawTo(a.threat.x, a.threat.z, a.pos.x, a.pos.z) + Math.sin(a.stateTime * 0.5) * 0.6;
        steerYaw(a, a.goalYaw, 1.2, dt);
        a.moveSpeed = a.stateTime < a.stateDur * 0.6 ? spd.walk * 0.7 : 0;
        if (a.stateTime > a.stateDur) setState(a, 'idle');
        break;
    }
    if (a.attackCD > 0) a.attackCD -= dt;
  }
  function threatIndicator(a, k) {
    if (HG.state !== 'hunt') return;
    var ang = U.angleDiff(player.yaw, U.yawTo(player.pos.x, player.pos.z, a.pos.x, a.pos.z));
    ui.threat(ang, k * U.clamp(1.4 - a.distToPlayer / 60, 0.25, 1));
  }
  function moveAnimal(a, dt) {
    var def = a.def;
    a.speed = U.damp(a.speed, a.moveSpeed, a.moveSpeed > a.speed ? 3.5 : 5, dt);
    if (a.speed > 0.02) {
      var nx = a.pos.x - Math.sin(a.yaw) * a.speed * dt, nz = a.pos.z - Math.cos(a.yaw) * a.speed * dt;
      var flying = def.fly && a.alt > 1;
      if (!flying && (terrain.isWater(nx, nz) || !terrain.inBounds(nx, nz, 4))) {
        a.yaw += (a.id % 2 ? 1 : -1) * 2.5 * dt; a.speed *= 0.5;
        if (a.state === 'wander') pickWanderTarget(a);
        if (!terrain.inBounds(nx, nz, 4)) { a.goalYaw = U.yawTo(a.pos.x, a.pos.z, 0, 0); a.yaw += U.angleDiff(a.yaw, a.goalYaw) * Math.min(1, dt * 3); a.fleeYaw = a.goalYaw; }
      } else {
        a.pos.x = nx; a.pos.z = nz;
        if (!flying) colliders.resolve(a.pos, (def.radius || 0.45) * a.scale, null);
      }
    }
    var gy = terrain.heightAt(a.pos.x, a.pos.z);
    if (def.fly) {
      var wantAlt = (a.state === 'flee' || a.state === 'wander' || a.state === 'charge') ? (def.flyHeight || 14) : 0;
      a.alt = U.damp(a.alt, wantAlt, wantAlt > a.alt ? 0.9 : 0.6, dt);
      gy = Math.max(gy, terrain.waterLevel) + a.alt;
    }
    a.pos.y = gy + a.bob;
    a.root.rotation.y = a.yaw;
  }
  function animateAnimal(a, dt) {
    if (a.parts && a.parts.animate) { try { a.parts.animate(a, dt); } catch (e) { console.error('[HG] animate ' + a.type, e); a.parts.animate = null; } return; }
    var def = a.def, sp = a.speed, sc = a.scale;
    a.phase += dt * sp * (def.stride || 2.6) / Math.max(0.3, sc);
    var gait = def.gait || (def.fly ? 'fly' : 'walk');
    a.bob = 0;
    if (gait === 'walk') {
      var running = sp > (def.speed ? def.speed.walk * 1.6 : 3);
      var amp = Math.min(running ? 0.95 : 0.55, sp * 0.22);
      for (var i = 0; i < a.legs.length; i++) a.legs[i].rotation.x = Math.sin(a.phase + LEG_OFFS[i % LEG_OFFS.length] + (running && i >= 2 ? 0.6 : 0)) * amp;
      if (running) a.bob = Math.abs(Math.sin(a.phase)) * 0.06 * sc;
    } else if (gait === 'hop') {
      if (sp > 0.15) {
        var hop = Math.abs(Math.sin(a.phase * 0.5));
        a.bob = hop * Math.min(0.35, 0.1 + sp * 0.04) * sc;
        for (var j = 0; j < a.legs.length; j++) a.legs[j].rotation.x = (j < 2 ? -1 : 1) * (hop - 0.5) * 0.9;
      } else for (var j2 = 0; j2 < a.legs.length; j2++) a.legs[j2].rotation.x *= 0.8;
    } else if (gait === 'fly' && a.wings) {
      var flap = a.alt > 0.5 ? Math.sin(a.phase * 2.2 + HG.time * 10) * 0.9 : 0.05;
      if (a.wings[0]) a.wings[0].rotation.z = flap;
      if (a.wings[1]) a.wings[1].rotation.z = -flap;
    }
    if (a.head) {
      var hp = 0;
      if (a.state === 'graze') hp = def.grazePitch != null ? def.grazePitch : -0.95;
      else if (a.state === 'alert' || a.state === 'warn') hp = def.alertPitch != null ? def.alertPitch : 0.25;
      else if (a.state === 'idle') hp = Math.sin(HG.time * 0.7 + a.id) * 0.08;
      a.headPitch = U.damp(a.headPitch, hp, 5, dt);
      a.head.rotation.x = (a.headBase || 0) + a.headPitch;
    }
    if (a.tail) {
      var tl = (a.state === 'flee' || a.state === 'alert') ? (def.tailLift != null ? def.tailLift : -1.1) : 0;
      a.tailLift = U.damp(a.tailLift, tl, 8, dt);
      a.tail.rotation.x = a.tailLift;
    }
  }
  function updateDead(a, dt) {
    a.deadT += dt;
    if (a.parts && a.parts.die) {
      try { a.parts.die(a, dt); } catch (e) { console.error('[HG] die ' + a.type, e); a.parts.die = null; }
      if (a.fadeT < 0 && a.deadT > 40) startFade(a);
      if (a.fadeT >= 0) {
        a.fadeT += dt;
        var of = 1 - U.clamp(a.fadeT / 1.4, 0, 1);
        if (a.fadeMats) a.fadeMats.forEach(function (m) { m.opacity = of; });
        a.root.position.y -= a.fadeT * 0.15;
        if (of <= 0) HG.removeAnimal(a);
      }
      return;
    }
    var k = U.smooth(0, 0.7, a.deadT);
    a.root.rotation.z = a.tipDir * k * PI * 0.5;
    a.alt = U.damp(a.alt, 0, 3, dt);
    a.pos.y = terrain.heightAt(a.pos.x, a.pos.z) + a.alt + 0.08 * a.scale * k;
    for (var i = 0; i < a.legs.length; i++) a.legs[i].rotation.x *= 0.9;
    if (a.fadeT < 0 && a.deadT > 40) startFade(a);
    if (a.fadeT >= 0) {
      a.fadeT += dt;
      var o = 1 - U.clamp(a.fadeT / 1.4, 0, 1);
      if (a.fadeMats) a.fadeMats.forEach(function (m) { m.opacity = o; });
      a.root.position.y -= a.fadeT * 0.15;
      if (o <= 0) HG.removeAnimal(a);
    }
  }
  function startFade(a) {
    if (a.fadeT >= 0) return;
    a.fadeT = 0; a.fadeMats = [];
    var map = new Map();
    a.root.traverse(function (o) {
      if (!o.isMesh) return;
      var m = o.material;
      if (!map.has(m)) { var c = m.clone(); c.transparent = true; c.depthWrite = false; c.userData = {}; map.set(m, c); a.fadeMats.push(c); }
      o.material = map.get(m);
      o.castShadow = false;
    });
  }
  HG.fadeAnimal = startFade;
  function updateAnimals(dt) {
    var cam = HG.camera.position, far = HG.scene.fog.far + 10;
    for (var i = HG.animals.length - 1; i >= 0; i--) {
      var a = HG.animals[i];
      var dx = player.pos.x - a.pos.x, dz = player.pos.z - a.pos.z;
      a.distToPlayer = Math.sqrt(dx * dx + dz * dz);
      var camD = U.dist2D(cam.x, cam.z, a.pos.x, a.pos.z);
      a.root.visible = camD < far;
      if (a.dead) { updateDead(a, dt); continue; }
      a.stateTime += dt;
      if (a._pendingAlert) { var pa = a._pendingAlert; pa.t -= dt; if (pa.t <= 0) { a._pendingAlert = null; _v6.set(pa.x, pa.y, pa.z); HG.alertAnimal(a, _v6, pa.s, pa.c); } }
      a.perceptT -= dt;
      if (a.perceptT <= 0) { a.perceptT = 0.2; perceive(a, 0.2); }
      var override = false;
      if (a.def.update) { try { override = a.def.update(a, dt) === true; } catch (e) { console.error('[HG] animal update ' + a.type, e); } }
      if (a.removed) continue;
      if (!override) { updateAnimalAI(a, dt); moveAnimal(a, dt); }
      if (a.root.visible && (camD < 140 || (HG.frame + a.id) % 3 === 0)) animateAnimal(a, (camD < 140 ? 1 : 3) * dt);
      if (a.wounded && a.speed > 0.3) {
        a.dotDist += a.speed * dt;
        if (a.dotDist > 1.6) { a.dotDist = 0; HG.addTrackDot(a.pos.x + (Math.random() - 0.5) * 0.4, a.pos.z + (Math.random() - 0.5) * 0.4); }
      }
    }
  }

  /* ---------- population manager ---------- */
  var popT = 0;
  function spawnTable() {
    var map = HG.map; if (!map) return [];
    var list = (map.spawns || []).slice();
    for (var id in HG.animalTypes) {
      var d = HG.animalTypes[id];
      if (d.habitats && d.habitats.indexOf(HG.mapId) >= 0 && !list.some(function (s) { return s.type === id; })) list.push({ type: id, weight: d.rarity === 'common' ? 3 : d.rarity === 'uncommon' ? 2 : d.rarity === 'rare' ? 0.8 : 0.25, max: d.rarity === 'common' ? 5 : 2 });
    }
    var night = HG.env.daylight < 0.3;
    return list.filter(function (s) {
      var d = HG.animalTypes[s.type]; if (!d) return false;
      if (d.activeAt === 'night' && !night) return false;
      if (d.activeAt === 'day' && night) return false;
      return true;
    });
  }
  /** Spawn one group from the map's spawn table at distance [min,max] from the player. Returns group array. */
  HG.spawnFromTable = function (minD, maxD, preferAhead) {
    var table = spawnTable(); if (!table.length) return [];
    var counts = {};
    HG.animals.forEach(function (a) { if (!a.dead && !a.noCount) counts[a.type] = (counts[a.type] || 0) + 1; });
    var avail = table.filter(function (s) { return (counts[s.type] || 0) < (s.max || 4); });
    if (!avail.length) return [];
    var entry = U.weighted(avail), def = HG.animalTypes[entry.type];
    for (var t = 0; t < 14; t++) {
      var base = preferAhead ? player.yaw + (Math.random() - 0.5) * 1.2 : Math.random() * TAU;
      var d = minD + Math.random() * (maxD - minD);
      var x = player.pos.x - Math.sin(base) * d, z = player.pos.z - Math.cos(base) * d;
      if (!goodGround(x, z)) continue;
      if (!preferAhead && t < 8) { // avoid popping in right in front of the player
        var ang = Math.abs(U.angleDiff(player.yaw, U.yawTo(player.pos.x, player.pos.z, x, z)));
        if (ang < 0.7 && d < 140) continue;
      }
      var g = def.group || [1, 1], n = U.randInt(g[0], g[1]);
      n = Math.min(n, (entry.max || 4) - (counts[entry.type] || 0));
      var leg = def.rarity !== 'legendary' && Math.random() < (HG.config.legendaryChance || 0);
      return HG.spawnGroup(entry.type, x, z, Math.max(1, n), { legendary: leg });
    }
    return [];
  };
  function updatePopulation(dt) {
    popT -= dt; if (popT > 0) return; popT = 1.5;
    var alive = 0;
    for (var i = HG.animals.length - 1; i >= 0; i--) {
      var a = HG.animals[i];
      if (a.dead) continue;
      var lim = a.wounded ? HG.config.despawnDist * 1.4 : HG.config.despawnDist;
      if (a.distToPlayer > lim && !a.keep) { HG.removeAnimal(a); continue; }
      if (!a.noCount) alive++;
    }
    var cap = (HG.map && HG.map.maxAnimals) || HG.config.maxAnimals;
    if (alive < cap) HG.spawnFromTable(HG.config.spawnMin, HG.config.spawnMax, false);
  }

  /* ---------- tracking dots (subtle dark-red, instanced ring buffer) ---------- */
  var dotGeo = new THREE.CircleGeometry(0.055, 6); dotGeo.rotateX(-PI / 2);
  var dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5a1010).convertSRGBToLinear(), transparent: true, opacity: 0.85, depthWrite: false });
  var dotMesh = new THREE.InstancedMesh(dotGeo, dotMat, HG.config.trackDotMax);
  dotMesh.count = 0; dotMesh.frustumCulled = false; dotMesh.renderOrder = 1; dotMesh.name = 'trackDots';
  HG.scene.add(dotMesh);
  var dotIdx = 0;
  /** Drop a small tracking dot on the ground at (x, z). */
  HG.addTrackDot = function (x, z, size) {
    var y = Math.max(terrain.heightAt(x, z), terrain.waterLevel) + 0.03;
    _obj.position.set(x, y, z); _obj.rotation.set(0, Math.random() * TAU, 0); _obj.scale.setScalar((size || 1) * (0.7 + Math.random() * 0.6)); _obj.updateMatrix();
    dotMesh.setMatrixAt(dotIdx, _obj.matrix);
    dotIdx = (dotIdx + 1) % HG.config.trackDotMax;
    dotMesh.count = Math.min(HG.config.trackDotMax, Math.max(dotMesh.count, dotIdx === 0 ? HG.config.trackDotMax : dotIdx));
    dotMesh.instanceMatrix.needsUpdate = true;
  };
  function clearTrackDots() { dotMesh.count = 0; dotIdx = 0; }
  HG.clearTrackDots = clearTrackDots;

  /* ------------------------------------------------------------------
   * Particles (cheap pooled points: dust, fur puffs, splashes)
   * ------------------------------------------------------------------ */
  var PMAX = HG.config.particleMax;
  var pGeo = new THREE.BufferGeometry();
  var pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  var pMat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
  var pPoints = new THREE.Points(pGeo, pMat); pPoints.frustumCulled = false; pPoints.name = 'particles';
  HG.scene.add(pPoints);
  var parts = []; for (var pi = 0; pi < PMAX; pi++) parts.push({ life: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0 });
  var pNext = 0;
  /** HG.particles.emit(pos, count, {color, speed, up, life, gravity, spread, drag}) */
  HG.particles = {
    emit: function (pos, count, o) {
      o = o || {};
      _c2.set(o.color || 0x9a7b55).convertSRGBToLinear();
      for (var i = 0; i < count; i++) {
        var p = parts[pNext], k = pNext * 3;
        var sp = (o.speed == null ? 2 : o.speed) * (0.4 + Math.random() * 0.8), spr = o.spread == null ? 1 : o.spread;
        p.vx = (Math.random() - 0.5) * 2 * sp * spr; p.vz = (Math.random() - 0.5) * 2 * sp * spr; p.vy = (o.up == null ? 1.5 : o.up) * (0.5 + Math.random());
        if (o.dir) { p.vx += o.dir.x * sp; p.vy += o.dir.y * sp; p.vz += o.dir.z * sp; }
        p.life = (o.life || 0.8) * (0.6 + Math.random() * 0.6); p.g = o.gravity == null ? 6 : o.gravity; p.drag = o.drag == null ? 1.5 : o.drag;
        pPos[k] = pos.x; pPos[k + 1] = pos.y; pPos[k + 2] = pos.z;
        var j = 0.85 + Math.random() * 0.3;
        pCol[k] = _c2.r * j; pCol[k + 1] = _c2.g * j; pCol[k + 2] = _c2.b * j;
        pNext = (pNext + 1) % PMAX;
      }
      pGeo.attributes.color.needsUpdate = true;
    },
    clear: function () { for (var i = 0; i < PMAX; i++) { parts[i].life = 0; pPos[i * 3 + 1] = -1e4; } pGeo.attributes.position.needsUpdate = true; }
  };
  HG.particles.clear();
  function updateParticles(dt) {
    var any = false;
    for (var i = 0; i < PMAX; i++) {
      var p = parts[i]; if (p.life <= 0) continue;
      any = true; var k = i * 3;
      p.life -= dt;
      if (p.life <= 0) { pPos[k + 1] = -1e4; continue; }
      var dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.g * dt;
      pPos[k] += p.vx * dt; pPos[k + 1] += p.vy * dt; pPos[k + 2] += p.vz * dt;
    }
    if (any) pGeo.attributes.position.needsUpdate = true;
  }

  /* ------------------------------------------------------------------
   * Weapons
   * ------------------------------------------------------------------ */
  HG.weaponTypes = HG.weaponTypes || {};
  HG.ammoTypes = HG.ammoTypes || {};
  HG.weaponState = {}; // id -> {mag}
  var W = HG.weapon = {
    id: null, def: null, cooldown: 0, reloading: false, reloadT: 0, reloadDur: 1, aimT: 0, kick: 0, bloom: 0,
    switchT: 0, model: null, flashT: 0, swayX: 0, swayY: 0, lastShot: -9, spreadNow: 0, charging: false, charge: 0
  };
  /** Stat lookup used by the engine for every weapon stat (weapons.js may wrap this to apply attachments/upgrades). */
  HG.weaponStat = function (def, key) { return def ? def[key] : undefined; };
  function wstat(key, dflt) { var v = HG.weaponStat(W.def, key); return v == null ? dflt : v; }
  function weaponMag(id) {
    var st = HG.weaponState[id];
    if (!st) {
      var def = HG.weaponTypes[id];
      st = HG.weaponState[id] = { mag: 0 };
      if (def) { var have = HG.save.ammo[def.ammo] || 0, take = Math.min(have, HG.weaponStat(def, 'magSize') || 1); st.mag = take; HG.save.ammo[def.ammo] = have - take; }
    }
    return st;
  }
  HG.weaponMag = weaponMag;
  /** Owned weapons currently carried: [primary, sidearm, ...equipped.extra] */
  HG.getLoadout = function () {
    var e = HG.save.equipped, out = [];
    [e.weapon, e.sidearm].concat(e.extra || []).forEach(function (id) {
      if (id && HG.weaponTypes[id] && out.indexOf(id) < 0 && (HG.save.owned.indexOf(id) >= 0 || HG.debugUnlockAll)) out.push(id);
    });
    if (!out.length) { for (var id in HG.weaponTypes) { if (HG.save.owned.indexOf(id) >= 0) { out.push(id); break; } } }
    return out;
  };
  /** Equip an item into a slot: 'weapon'|'primary'|'sidearm'|'extra'|'outfit'|'companion'|'vehicle'|'gear'. */
  HG.equip = function (slot, id) {
    var e = HG.save.equipped;
    if (slot === 'primary') slot = 'weapon';
    if (slot === 'gear') { if (id && e.gear.indexOf(id) < 0) e.gear.push(id); }
    else if (slot === 'extra') { if (id && e.extra.indexOf(id) < 0) e.extra.push(id); }
    else e[slot] = id || null;
    HG.store();
    HG.emit('equip', slot, id);
    if (HG.state === 'hunt' && (slot === 'weapon' || slot === 'sidearm' || slot === 'extra') && id) HG.switchWeapon(id);
    return true;
  };
  HG.unequip = function (slot, id) {
    var e = HG.save.equipped;
    if (slot === 'gear' || slot === 'extra') { var i = e[slot].indexOf(id); if (i >= 0) e[slot].splice(i, 1); }
    else e[slot === 'primary' ? 'weapon' : slot] = null;
    HG.store(); HG.emit('equip', slot, null);
  };
  HG.isEquipped = function (slot, id) {
    var e = HG.save.equipped; if (slot === 'primary') slot = 'weapon';
    if (slot === 'gear' || slot === 'extra') return e[slot].indexOf(id) >= 0;
    return e[slot] === id;
  };
  var flashMesh = (function () {
    var g = new THREE.BufferGeometry();
    var v = [], n = 7;
    for (var i = 0; i < n; i++) {
      var a0 = i / n * TAU, a1 = (i + 0.5) / n * TAU, a2 = (i + 1) / n * TAU;
      v.push(0, 0, 0, Math.cos(a0) * 0.05, Math.sin(a0) * 0.05, 0, Math.cos(a1) * 0.13, Math.sin(a1) * 0.13, -0.02);
      v.push(0, 0, 0, Math.cos(a1) * 0.13, Math.sin(a1) * 0.13, -0.02, Math.cos(a2) * 0.05, Math.sin(a2) * 0.05, 0);
    }
    v.push(0, 0, 0, 0.03, 0, -0.25, -0.03, 0, -0.25);
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd27a).convertSRGBToLinear(), transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    m.visible = false; m.renderOrder = 10; return m;
  })();
  HG.viewModel.add(flashMesh);
  /** Switch the held weapon (must be a key of HG.weaponTypes). */
  HG.switchWeapon = function (id) {
    var def = HG.weaponTypes[id]; if (!def) return false;
    if (W.id === id && W.model) return true;
    if (W.model) { HG.viewModel.remove(W.model); disposeTree(W.model); W.model = null; }
    W.id = id; W.def = def; W.reloading = false; W.cooldown = 0.2; W.switchT = 0.35; W.aimT = 0; W.charging = false; W.charge = 0;
    weaponMag(id);
    try { W.model = def.buildViewModel ? def.buildViewModel() : new THREE.Group(); } catch (e) { console.error('[HG] buildViewModel ' + id, e); W.model = new THREE.Group(); }
    HG.viewModel.add(W.model);
    var muz = W.model.userData.muzzle;
    flashMesh.userData.muzzle = muz ? new THREE.Vector3(muz.x, muz.y, muz.z) : new THREE.Vector3(0, -0.02, -0.75);
    HG.sfx('equip');
    HG.emit('weaponSwitch', id, def);
    return true;
  };
  HG.cycleWeapon = function (dir) {
    var lo = HG.getLoadout(); if (lo.length < 2) return;
    var i = lo.indexOf(W.id); i = (i + (dir || 1) + lo.length) % lo.length;
    HG.switchWeapon(lo[i]);
    ui.toast(HG.weaponTypes[lo[i]].name, { duration: 1.2 });
  };
  HG.reload = function () {
    if (!W.def || W.reloading) return false;
    var st = weaponMag(W.id), size = wstat('magSize', 1), have = HG.save.ammo[W.def.ammo] || 0;
    if (st.mag >= size) return false;
    if (have <= 0) { ui.toast('Out of ' + ((HG.ammoTypes[W.def.ammo] || {}).name || 'ammo') + ' — buy more in the shop', { color: 'var(--amber-2)' }); HG.sfx('empty'); return false; }
    W.reloading = true; W.reloadDur = W.reloadT = wstat('reloadTime', 2); W.aimT = Math.min(W.aimT, 0.3);
    HG.sfx(W.def.reloadSound || 'reload');
    HG.emit('reload', W.def);
    return true;
  };
  function finishReload() {
    var st = weaponMag(W.id), size = wstat('magSize', 1), have = HG.save.ammo[W.def.ammo] || 0;
    var take = Math.min(size - st.mag, have);
    st.mag += take; HG.save.ammo[W.def.ammo] = have - take;
    W.reloading = false; HG.store();
  }
  HG.totalAmmo = function (ammoId) { return HG.save.ammo[ammoId] || 0; };
  HG.addAmmo = function (ammoId, n) { HG.save.ammo[ammoId] = Math.max(0, (HG.save.ammo[ammoId] || 0) + n); HG.store(); HG.emit('ammo', ammoId, n); };

  // ---- shot tracing ----
  var shotRay = { origin: new THREE.Vector3(), dir: new THREE.Vector3() };
  HG.shootRay = shotRay;
  var _rs = new THREE.Vector3(), _hitC = new THREE.Vector3();
  function raySphere(o, d, c, r, maxT) {
    var ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    var b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
    if (cc > 0 && b > 0) return -1;
    var disc = b * b - cc; if (disc < 0) return -1;
    var t = -b - Math.sqrt(disc); if (t < 0) t = 0;
    return t <= maxT ? t : -1;
  }
  var _zc = new THREE.Vector3();
  /** World-space centre of hit zone z of animal a (zone.part names a key of the buildMesh result, e.g. 'head', whose local space the offset is in). */
  HG.zoneWorld = function (a, z, out) {
    out = out || new THREE.Vector3();
    var part = z.part && a.parts && a.parts[z.part];
    if (part && part.isObject3D) { part.updateMatrixWorld(true); return out.copy(z.offset).applyMatrix4(part.matrixWorld); }
    return out.copy(z.offset).applyMatrix4(a.root.matrixWorld);
  };
  /** Ray (origin o, unit dir d, length maxT) vs animal hit zones. Returns {animal, zone, t, point} or null. Highest-mult zone wins within the nearest animal. */
  HG.raycastAnimals = function (o, d, maxT, opts) {
    var best = null, bestT = Infinity;
    for (var i = 0; i < HG.animals.length; i++) {
      var a = HG.animals[i];
      if (a.dead && !(opts && opts.includeDead)) continue;
      var zones = a.def.hitZones; if (!zones || !zones.length) continue;
      _hitC.set(a.pos.x, a.pos.y + a.scale * 0.9, a.pos.z);
      if (raySphere(o, d, _hitC, a.scale * 2.6 + 0.5, maxT) < 0) continue;
      a.root.updateMatrixWorld(true);
      var zBest = null, zT = Infinity, zMult = -1, nearT = Infinity;
      for (var j = 0; j < zones.length; j++) {
        var z = zones[j];
        HG.zoneWorld(a, z, _zc);
        var t = raySphere(o, d, _zc, z.radius * a.scale, maxT);
        if (t < 0) continue;
        if (t < nearT) nearT = t;
        var m = z.mult == null ? 1 : z.mult;
        if (m > zMult) { zMult = m; zBest = z; zT = t; }
      }
      if (zBest && nearT < bestT) { bestT = nearT; best = { animal: a, zone: zBest.name, zoneDef: zBest, t: zT, point: new THREE.Vector3().copy(o).addScaledVector(d, zT) }; }
    }
    return best;
  };
  /** Terrain ray march. Returns distance or Infinity. */
  HG.raycastTerrain = function (o, d, maxT) {
    var step = 1.5, prevT = 0;
    for (var t = step; t <= maxT + step; t += step) {
      var tt = Math.min(t, maxT);
      var x = o.x + d.x * tt, y = o.y + d.y * tt, z = o.z + d.z * tt;
      if (y < terrain.heightAt(x, z)) {
        var lo = prevT, hi = tt;
        for (var k = 0; k < 6; k++) { var mid = (lo + hi) / 2; if (o.y + d.y * mid < terrain.heightAt(o.x + d.x * mid, o.z + d.z * mid)) hi = mid; else lo = mid; }
        return hi;
      }
      prevT = tt;
      if (tt >= maxT) break;
    }
    return Infinity;
  };
  var _seg0 = new THREE.Vector3(), _segD = new THREE.Vector3(), _vel = new THREE.Vector3();
  /** Trace a ballistic hitscan shot. Returns {animal, zone, point, distance, surface:'animal'|'terrain'|'obstacle'|null} */
  function traceShot(o, dir, range, speed, grav, ignoreCover) {
    _seg0.copy(o); _vel.copy(dir).multiplyScalar(speed);
    var travelled = 0, segLen = 30;
    while (travelled < range) {
      var dtSeg = segLen / speed;
      _segD.copy(_vel).normalize();
      var len = Math.min(segLen, range - travelled);
      var hitA = HG.raycastAnimals(_seg0, _segD, len);
      var tT = ignoreCover ? Infinity : HG.raycastTerrain(_seg0, _segD, len);
      var tC = ignoreCover ? Infinity : colliders.raycast(_seg0, _segD, len);
      var tA = hitA ? hitA.t : Infinity, tMin = Math.min(tA, tT, tC);
      if (tMin < Infinity) {
        var res = { distance: travelled + tMin, point: new THREE.Vector3().copy(_seg0).addScaledVector(_segD, tMin), animal: null, zone: null, surface: null, dir: _segD.clone() };
        if (tMin === tA) { res.animal = hitA.animal; res.zone = hitA.zone; res.zoneDef = hitA.zoneDef; res.surface = 'animal'; }
        else res.surface = tMin === tT ? 'terrain' : 'obstacle';
        return res;
      }
      _seg0.addScaledVector(_segD, len);
      _vel.y -= grav * dtSeg;
      travelled += len;
    }
    return { distance: range, point: _seg0.clone(), animal: null, zone: null, surface: null, dir: _segD.clone() };
  }
  HG.traceShot = function (o, dir, range, speed, grav, ignoreCover) { return traceShot(o, dir, range || 300, speed || 800, grav || 0, ignoreCover); };

  // ---- arrows / projectiles ----
  var projectiles = [];
  var arrowGeo = null;
  function getArrowGeo() {
    if (arrowGeo) return arrowGeo;
    arrowGeo = M.merge([
      M.cyl(0.008, 0.008, 0.75, 4, 0x8a6a3e, { rot: [PI / 2, 0, 0] }),
      M.cone(0.02, 0.07, 4, 0x3a3a3a, { rot: [-PI / 2, 0, 0], pos: [0, 0, -0.41] }),
      M.box(0.002, 0.04, 0.11, 0xff8a1f, { pos: [0, 0.02, 0.32] }),
      M.box(0.04, 0.002, 0.11, 0xfbf1dc, { pos: [0, 0, 0.32] })
    ]);
    arrowGeo.userData.shared = true;
    return arrowGeo;
  }
  /** Launch a visible projectile (arrows). def supplies muzzleVelocity, gravity, damage, range. */
  HG.spawnProjectile = function (origin, dir, def, opts) {
    var mesh = new THREE.Mesh((opts && opts.geometry) || def.projectileGeometry || getArrowGeo(), HG.vcMat);
    mesh.position.copy(origin);
    HG.scene.add(mesh);
    var charge = opts && opts.charge != null ? opts.charge : 1;
    var p = { mesh: mesh, vel: dir.clone().multiplyScalar((HG.weaponStat(def, 'muzzleVelocity') || 60) * (0.45 + 0.55 * charge)), def: def, life: 0, stuck: false, travelled: 0, start: origin.clone(), weaponId: W.id, charge: charge };
    projectiles.push(p);
    if (projectiles.length > 24) removeProjectile(projectiles[0]);
    return p;
  };
  function removeProjectile(p) { var i = projectiles.indexOf(p); if (i >= 0) projectiles.splice(i, 1); HG.scene.remove(p.mesh); }
  function clearProjectiles() { while (projectiles.length) removeProjectile(projectiles[0]); }
  var _pd = new THREE.Vector3(), _look = new THREE.Vector3();
  function updateProjectiles(dt) {
    for (var i = projectiles.length - 1; i >= 0; i--) {
      var p = projectiles[i];
      p.life += dt;
      if (p.stuck) { if (p.life > 8) removeProjectile(p); continue; }
      var grav = HG.weaponStat(p.def, 'gravity'); if (grav == null) grav = HG.config.gravity;
      p.vel.y -= grav * dt;
      var stepLen = p.vel.length() * dt;
      _pd.copy(p.vel).normalize();
      var hitA = HG.raycastAnimals(p.mesh.position, _pd, stepLen);
      var tT = HG.raycastTerrain(p.mesh.position, _pd, stepLen), tC = colliders.raycast(p.mesh.position, _pd, stepLen);
      var tA = hitA ? hitA.t : Infinity, tMin = Math.min(tA, tT, tC);
      _look.copy(p.mesh.position).add(_pd); p.mesh.lookAt(_look);
      if (tMin < Infinity) {
        p.mesh.position.addScaledVector(_pd, tMin);
        p.travelled += tMin;
        var dist = p.start.distanceTo(p.mesh.position);
        if (tMin === tA) {
          applyShotHit({ animal: hitA.animal, zone: hitA.zone, zoneDef: hitA.zoneDef, point: p.mesh.position.clone(), distance: dist, surface: 'animal', charge: p.charge }, p.def, p.weaponId);
          removeProjectile(p);
        } else {
          p.stuck = true; p.life = 0;
          HG.particles.emit(p.mesh.position, 5, { color: tMin === tT ? 0x8a7350 : 0x6b4f33, speed: 1.2, up: 1.2, life: 0.5 });
          HG.emit('miss', { point: p.mesh.position, weapon: p.def, projectile: true });
          startleNear(p.mesh.position, 18);
        }
        continue;
      }
      p.mesh.position.addScaledVector(_pd, stepLen);
      p.travelled += stepLen;
      if (p.travelled > (HG.weaponStat(p.def, 'range') || 120) * 1.5 || p.life > 6) removeProjectile(p);
    }
  }
  function startleNear(pt, r) {
    for (var i = 0; i < HG.animals.length; i++) {
      var a = HG.animals[i]; if (a.dead) continue;
      var d = U.dist2D(a.pos.x, a.pos.z, pt.x, pt.z);
      if (d < r) HG.alertAnimal(a, pt, 1.2 * (1 - d / r) + 0.3, 'impact');
    }
  }

  /** Fire the held weapon. opts {debug:true ignores spread + cover, force:true ignores cooldown}. Returns {hits:[...]} or null if it could not fire. */
  HG.fire = function (opts) {
    opts = opts || {};
    if (HG.state !== 'hunt' || !W.def || (HG.paused && !opts.force)) return null;
    if (!opts.force && (W.cooldown > 0 || W.reloading || W.switchT > 0)) return null;
    if (player.inVehicle && !player.inVehicle.canShoot) return null;
    var def = W.def, st = weaponMag(W.id);
    if (st.mag <= 0) {
      HG.sfx('empty'); W.cooldown = 0.35;
      if (!HG.reload() && !(HG.save.ammo[def.ammo] > 0)) {/* toast shown by reload */}
      return null;
    }
    st.mag--;
    W.cooldown = wstat('fireDelay', 0.5);
    W.lastShot = HG.time;
    HG.save.stats.shots++;
    HG.camera.updateMatrixWorld();
    HG.camera.getWorldPosition(shotRay.origin);
    HG.camera.getWorldDirection(shotRay.dir);
    if (opts.dir) shotRay.dir.copy(opts.dir).normalize();
    // noise + recoil + fx
    player.shotNoise = Math.max(player.shotNoise, wstat('noise', 1));
    var rec = wstat('recoil', 0.05) * (1 - 0.35 * W.aimT) * (player.crouch ? 0.75 : 1);
    player.recoilPitch += rec; player.recoilYaw += (Math.random() - 0.5) * rec * 0.6;
    W.kick = 1; W.bloom = Math.min(1.5, W.bloom + 0.6); W.flashT = 0.06;
    var snd = def.sound || {};
    HG.sfx(snd.name || ('shot_' + (snd.type || 'rifle')), { freq: snd.freq, volume: snd.volume });
    if (!HG.sounds[snd.name || ('shot_' + (snd.type || 'rifle'))]) HG.sfx('shot_rifle', { freq: snd.freq });
    HG.vibrate(25);
    var pellets = wstat('pellets', 1), spread = opts.debug ? 0 : W.spreadNow, results = [];
    var range = wstat('range', 250), mv = wstat('muzzleVelocity', 800), grav = wstat('gravity', 0);
    for (var i = 0; i < pellets; i++) {
      _v3.copy(shotRay.dir);
      if (spread > 0) {
        // random cone
        var r = Math.sqrt(Math.random()) * spread, th = Math.random() * TAU;
        _v4.set(1, 0, 0).applyQuaternion(HG.camera.quaternion); _v5.set(0, 1, 0).applyQuaternion(HG.camera.quaternion);
        _v3.addScaledVector(_v4, Math.cos(th) * r).addScaledVector(_v5, Math.sin(th) * r).normalize();
      }
      if (def.projectile === 'arrow') { HG.spawnProjectile(shotRay.origin, _v3, def, { charge: opts.charge }); continue; }
      results.push(traceShot(shotRay.origin, _v3, range, mv, grav, !!opts.debug));
    }
    HG.emit('shoot', def, shotRay);
    // everything nearby hears the shot
    var loud = wstat('noise', 1);
    for (var k = 0; k < HG.animals.length; k++) {
      var a = HG.animals[k]; if (a.dead) continue;
      var hr = a.senses.hearing * 4 * loud;
      // animals react after a short, natural reaction time (lets arrows and follow-up shots land)
      if (a.distToPlayer < hr) HG.alertAnimal(a, player.pos, 1.3 * (1 - a.distToPlayer / hr) + (a.def.temperament === 'skittish' ? 0.5 : 0.2), 'shot', 0.25 + Math.random() * 0.35 + a.distToPlayer / 340);
    }
    var anyHit = false;
    for (var j = 0; j < results.length; j++) {
      var res = results[j];
      if (res.animal) { anyHit = true; applyShotHit(res, def, W.id); }
      else if (res.surface) {
        HG.particles.emit(res.point, 6, { color: res.surface === 'terrain' ? 0x8a7350 : 0x6b4f33, speed: 1.5, up: 1.6, life: 0.6 });
        startleNear(res.point, 14);
      }
    }
    if (def.projectile !== 'arrow' && !anyHit) HG.emit('miss', { point: results[0] && results[0].point, weapon: def });
    return { hits: results };
  };
  var ZONE_SCORE = { head: 1.4, vital: 1.6, body: 1, leg: 0.7 };
  var ZONE_CASH = { head: 1.2, vital: 1.25, body: 1, leg: 0.8 };
  function applyShotHit(res, def, weaponId) {
    var a = res.animal; if (!a || a.dead) return;
    var zd = res.zoneDef || {}, mult = zd.mult == null ? 1 : zd.mult;
    var range = HG.weaponStat(def, 'range') || 250, dist = res.distance;
    var fall = dist > range ? Math.max(0.3, 1 - (dist - range) / range) : 1;
    var dmg = (HG.weaponStat(def, 'damage') || 50) * mult * fall * (res.charge != null ? 0.4 + 0.6 * res.charge : 1);
    HG.save.stats.hits++;
    HG.particles.emit(res.point, 5, { color: a.def.furColor || 0xa58460, speed: 1, up: 1, life: 0.5, gravity: 3 });
    HG.sfx('hit', { pos: res.point });
    HG.damageAnimal(a, dmg, res.zone, { distance: dist, weapon: weaponId, point: res.point });
  }
  /** Apply damage to an animal (zone: 'head'|'vital'|'body'|'leg'). info {distance, weapon (id), point}. */
  HG.damageAnimal = function (a, dmg, zone, info) {
    if (!a || a.dead) return;
    info = info || {};
    if (info.distance == null) info.distance = a.distToPlayer;
    if (!info.weapon) info.weapon = W.id;
    a.hits++;
    a.hp -= dmg;
    HG.emit('hit', a, zone, dmg, info);
    if (a.def.onHit) { try { a.def.onHit(a, zone, dmg, info); } catch (e) { console.error(e); } }
    if (a.hp <= 0) { killAnimal(a, zone, info); return; }
    ui.hitMarker(false);
    a.wounded = true;
    for (var i = 0; i < 4; i++) HG.addTrackDot(a.pos.x + (Math.random() - 0.5), a.pos.z + (Math.random() - 0.5));
    a.threat.copy(player.pos); a.threatType = 'hit'; a.awareness = 2;
    if ((a.def.temperament === 'aggressive' || a.def.temperament === 'territorial') && a.hp > a.maxHp * 0.3) {
      if (a.state !== 'charge') setState(a, 'charge');
    } else if (a.state !== 'flee') { react(a, 'hit'); }
    else a.stateDur += 3;
    if (zone === 'leg') ui.toast('Leg hit — follow the tracks!', { color: 'var(--cream-2)', duration: 1.6 });
  };
  /** Default kill-cam: no-op. weapons.js may replace: HG.killCam = function(animal, info){ ...; return promiseOrUndefined; } */
  HG.killCam = function (animal, info) { };
  var trophyQueue = [], trophyOpen = false, cardsPending = 0;
  function killAnimal(a, zone, info) {
    var def = a.def, rar = HG.RARITY[def.rarity] || HG.RARITY.common;
    cardsPending++;
    a.deathSpeed = a.speed;
    a.dead = true; a.alive = false; a.state = 'dead'; a.deadT = 0; a.speed = 0; a.moveSpeed = 0;
    a.tipDir = Math.random() < 0.5 ? 1 : -1;
    var dist = Math.round((info.distance || a.distToPlayer) * 10) / 10;
    var wr = def.weightRange || [10, 20];
    var weight = a.weight;
    var zs = ZONE_SCORE[zone] || 1, distBonus = 1 + Math.min(dist, 400) / 200;
    var rarityMult = rar.mult * (a.legendary && def.rarity !== 'legendary' ? 2.5 : 1);
    var score = Math.round(weight * 10 * zs * distBonus * rarityMult);
    var wf = U.clamp((weight - wr[0]) / Math.max(1e-3, wr[1] - wr[0]), 0, 1.4);
    var cash = Math.round((def.baseCash || 50) * (0.75 + 0.5 * wf) * (ZONE_CASH[zone] || 1) * (1 + Math.min(dist, 300) / 300) * (a.legendary ? 4 : 1) * (a.hits === 1 ? 1.1 : 1));
    var xp = Math.round((def.xp || 20) * zs * (1 + Math.min(dist, 300) / 300) * (a.legendary ? 4 : 1));
    var wdef = HG.weaponTypes[info.weapon] || W.def || {};
    var kinfo = {
      zone: zone, distance: dist, weapon: info.weapon, weaponName: wdef.name || '', score: score, cash: cash, xp: xp, weight: weight,
      legendary: a.legendary, species: def.name, type: a.type, rarity: def.rarity || 'common', oneShot: a.hits === 1,
      map: HG.mapId, mapName: HG.map ? HG.map.name : '', time: Date.now(), hour: HG.env.hour, newRecord: false, bonuses: []
    };
    // records
    var s = HG.save.stats, bs = s.bySpecies[a.type] || (s.bySpecies[a.type] = { kills: 0, bestScore: 0, bestWeight: 0 });
    kinfo.newRecord = score > bs.bestScore;
    bs.kills++; bs.bestScore = Math.max(bs.bestScore, score); bs.bestWeight = Math.max(bs.bestWeight, weight);
    s.kills++; if (zone === 'head') s.headshots++; if (zone === 'vital') s.heartShots++;
    s.longestShot = Math.max(s.longestShot, dist); s.heaviest = Math.max(s.heaviest, weight);
    if (a.legendary) s.legendaryKills++;
    HG.emit('killScore', a, kinfo); // features may add kinfo.bonuses [{label, cash, xp}] and adjust cash/xp before payout
    kinfo.bonuses.forEach(function (b) { kinfo.cash += b.cash || 0; kinfo.xp += b.xp || 0; });
    HG.save.trophies.push({ species: a.type, name: def.name, weight: weight, score: score, zone: zone, distance: dist, weapon: info.weapon, map: HG.mapId, date: kinfo.time, legendary: a.legendary });
    if (HG.session) HG.session.kills.push(kinfo);
    HG.addCash(kinfo.cash, 'kill', a.pos);
    HG.addXP(kinfo.xp);
    ui.hitMarker(true);
    HG.sfx('kill');
    if (zone === 'head') ui.toast('HEADSHOT!', { big: true, color: 'var(--amber-2)' });
    else if (zone === 'vital') ui.toast('HEART SHOT!', { big: true, color: 'var(--amber-2)' });
    else if (dist >= 150) ui.toast('LONG SHOT! ' + Math.round(dist) + ' m', { big: true, color: 'var(--sky)' });
    // the herd bolts
    for (var i = 0; i < HG.animals.length; i++) { var b = HG.animals[i]; if (!b.dead && b.group === a.group) HG.alertAnimal(b, player.pos, 2, 'shot'); }
    HG.emit('kill', a, kinfo);
    if (def.onKill) { try { def.onKill(a, kinfo); } catch (e) { console.error(e); } }
    HG.store();
    var r;
    try { r = HG.killCam(a, kinfo); } catch (e) { console.error('[HG] killCam', e); }
    var after = function () { setTimeout(function () { queueTrophy(a, kinfo); }, 900); };
    if (r && typeof r.then === 'function') r.then(after, after); else after();
  }
  HG.killAnimal = function (a, zone) { if (a && !a.dead) killAnimal(a, zone || 'vital', { distance: a.distToPlayer, weapon: W.id }); };
  function queueTrophy(a, info) {
    if (HG.state !== 'hunt') { cardsPending = Math.max(0, cardsPending - 1); HG.fadeAnimal(a); ui.flushBanners(); return; }
    trophyQueue.push({ a: a, info: info });
    if (!trophyOpen) nextTrophy();
  }
  function nextTrophy() {
    var t = trophyQueue.shift();
    if (!t) { trophyOpen = false; return; }
    if (HG.state !== 'hunt') { trophyQueue.length = 0; trophyOpen = false; return; }
    trophyOpen = true;
    HG.showTrophyCard(t.a, t.info, function () {
      HG.fadeAnimal(t.a);
      trophyOpen = false;
      cardsPending = Math.max(0, cardsPending - 1);
      nextTrophy();
      setTimeout(ui.flushBanners, 250);
    });
  }
  HG.trophyPending = function () { return trophyOpen || trophyQueue.length > 0 || cardsPending > 0; };

  // ---- per-frame weapon update: aim, FOV, spread, recoil, view-model pose ----
  var hipPos = new THREE.Vector3(), aimPos = new THREE.Vector3(), vmPos = new THREE.Vector3();
  var DEF_HIP = [0.2, -0.215, -0.5], DEF_AIM = [0, -0.06, -0.3];
  var lastFov = 0, lastLookYaw = 0, lastLookPitch = 0;
  function updateWeapon(dt, rdt) {
    if (!W.def) return;
    var def = W.def;
    if (W.cooldown > 0) W.cooldown -= dt;
    if (W.switchT > 0) W.switchT -= dt;
    if (W.reloading) { W.reloadT -= dt; if (W.reloadT <= 0) finishReload(); }
    // fire input: fireMode 'press' (default) | 'auto' (hold = full auto) | 'release' (hold to draw/charge, release fires)
    var canAct = !HG.paused && HG.state === 'hunt';
    var mode = wstat('fireMode', wstat('auto', false) ? 'auto' : 'press');
    if (mode === 'release') {
      if (input.fire && canAct && !W.reloading && W.switchT <= 0 && W.cooldown <= 0 && weaponMag(W.id).mag > 0) {
        if (!W.charging) { W.charging = true; W.charge = 0; HG.emit('drawStart', W.def); }
        W.charge = Math.min(1, W.charge + rdt / wstat('drawTime', 0.8));
      } else if (W.charging && !input.fire) {
        W.charging = false;
        if (canAct) HG.fire({ charge: Math.max(0.15, W.charge) });
        W.charge = 0;
      }
    } else if (canAct && (input.firePressed || (input.fire && mode === 'auto'))) {
      if (player.sprint) { player.sprint = false; }
      HG.fire();
    }
    input.firePressed = false;
    // auto reload when empty
    if (canAct && !W.reloading && weaponMag(W.id).mag <= 0 && W.cooldown <= 0 && (HG.save.ammo[def.ammo] || 0) > 0 && HG.time - W.lastShot > 0.25) HG.reload();
    // aim
    var wantAim = input.aim && !W.reloading && W.switchT <= 0 && !player.sprint && canAct;
    W.aimT = U.damp(W.aimT, wantAim ? 1 : 0, wantAim ? 11 : 14, rdt);
    if (W.aimT < 0.001) W.aimT = 0;
    var baseFov = HG.settings.fov || HG.config.baseFov;
    var zoomFov = wstat('zoom', baseFov * 0.75);
    var fov = U.lerp(baseFov, zoomFov, W.aimT * W.aimT);
    if (player.fovOverride) fov = player.fovOverride;
    if (Math.abs(fov - lastFov) > 0.01) { HG.camera.fov = fov; HG.camera.updateProjectionMatrix(); lastFov = fov; }
    var scoped = !!wstat('scope', false) && W.aimT > 0.88 && !player.fovOverride;
    ui.setScope(scoped);
    HG.viewModel.visible = !scoped && !player.hideViewModel;
    // spread
    W.bloom = U.damp(W.bloom, 0, 3, dt);
    var spread = wstat('spread', 0.02) * (1 - 0.88 * W.aimT);
    spread *= 1 + Math.min(1.5, player.speed * 0.25) + (player.sprint ? 1.5 : 0);
    if (player.crouch) spread *= 0.7;
    spread += W.bloom * wstat('spread', 0.02) * 0.5;
    W.spreadNow = spread;
    var h = viewEl.clientHeight || 400;
    var gap = 5 + Math.tan(spread) / Math.tan(HG.camera.fov * DEG / 2) * h / 2;
    ui.setCrosshair(Math.min(60, gap), HG.state === 'hunt' && W.aimT < 0.55 && !scoped && !player.hideCrosshair);
    // aim assist (touch only): find a zone near the crosshair
    aimAssist.target = null;
    if (HG.settings.aimAssist && input.isTouch && canAct) findAssist();
    // view model pose
    var hp = def.hipPos || DEF_HIP, ap = def.aimPos || DEF_AIM;
    hipPos.set(hp[0], hp[1], hp[2]); aimPos.set(ap[0], ap[1], ap[2]);
    vmPos.copy(hipPos).lerp(aimPos, W.aimT);
    var bk = (1 - W.aimT * 0.85) * U.clamp(player.speed / player.walkSpeed, 0, 1.6);
    vmPos.x += Math.sin(player.bobPhase) * 0.012 * bk;
    vmPos.y += Math.abs(Math.cos(player.bobPhase)) * 0.012 * bk - (player.sprint ? 0.05 : 0);
    // sway from look
    var dyaw = U.angleDiff(lastLookYaw, player.yaw), dpitch = player.pitch - lastLookPitch;
    lastLookYaw = player.yaw; lastLookPitch = player.pitch;
    W.swayX = U.damp(W.swayX, U.clamp(dyaw / Math.max(rdt, 1e-3) * 0.012, -0.05, 0.05), 10, rdt);
    W.swayY = U.damp(W.swayY, U.clamp(dpitch / Math.max(rdt, 1e-3) * 0.012, -0.05, 0.05), 10, rdt);
    var swayK = 1 - W.aimT * 0.8;
    vmPos.x += W.swayX * swayK; vmPos.y -= W.swayY * swayK;
    W.kick = U.damp(W.kick, 0, 12, rdt);
    vmPos.z += W.kick * 0.07 * (def.kickBack || 1);
    var rotX = W.kick * 0.12 * (def.kickBack || 1), rotZ = 0;
    if (W.reloading) {
      var rp = 1 - W.reloadT / W.reloadDur, dip = Math.sin(U.clamp(rp, 0, 1) * PI);
      vmPos.y -= dip * 0.12; rotX -= dip * 0.5; rotZ += dip * 0.35;
    }
    if (W.switchT > 0) vmPos.y -= W.switchT * 0.6;
    if (player.sprint) { rotZ += 0.35; rotX -= 0.15; }
    if (W.model) {
      W.model.position.copy(vmPos);
      W.model.rotation.set(rotX, (1 - W.aimT) * 0.04 + W.swayX * 0.5 * swayK, rotZ + W.swayX * 0.6 * swayK);
      // per-weapon moving parts (bolt / lever / slide / bow string / hands): group.userData.animate(W, dt, realDt)
      if (W.model.userData.animate) { try { W.model.userData.animate(W, dt, rdt); } catch (e) { console.error('[HG] view model animate', e); W.model.userData.animate = null; } }
    }
    // muzzle flash
    if (W.flashT > 0) {
      W.flashT -= rdt;
      flashMesh.visible = !!W.model && !scoped;
      if (W.model) {
        W.model.updateMatrix();
        flashMesh.position.copy(flashMesh.userData.muzzle).applyMatrix4(W.model.matrix);
        flashMesh.rotation.set(W.model.rotation.x, W.model.rotation.y, Math.random() * TAU);
        flashMesh.scale.setScalar(0.8 + Math.random() * 0.5);
      }
    } else flashMesh.visible = false;
  }
  var assistBest = { a: null, err: 0, yaw: 0, pitch: 0 };
  function findAssist() {
    var best = null, bestErr = (W.aimT > 0.5 ? 2.2 : 4.5) * DEG * (HG.camera.fov / 70), range = wstat('range', 250);
    var cam = HG.camera.position;
    HG.camera.getWorldDirection(_v1);
    for (var i = 0; i < HG.animals.length; i++) {
      var a = HG.animals[i]; if (a.dead || a.distToPlayer > range || !a.root.visible) continue;
      var zones = a.def.hitZones; if (!zones) continue;
      var z = null;
      for (var j = 0; j < zones.length; j++) if (zones[j].name === 'vital') { z = zones[j]; break; }
      z = z || zones[0];
      a.root.updateMatrixWorld();
      HG.zoneWorld(a, z, _v2).sub(cam);
      var d = _v2.length(); _v2.multiplyScalar(1 / d);
      var err = Math.acos(U.clamp(_v2.dot(_v1), -1, 1));
      var tol = bestErr + Math.atan(z.radius * a.scale / d);
      if (err < tol && err < (best ? best.err : 1e9)) { best = assistBest; best.a = a; best.err = err; best.yaw = Math.atan2(-_v2.x, -_v2.z); best.pitch = Math.asin(U.clamp(_v2.y, -1, 1)); }
    }
    if (best) { aimAssist.target = best.a; aimAssist.yaw = best.yaw; aimAssist.pitch = best.pitch - player.recoilPitch; aimAssist.err = best.err; }
  }

  /* ------------------------------------------------------------------
   * HUD (compass, bars, ammo, cash, meters)
   * ------------------------------------------------------------------ */
  var hud = {};
  HG.compass = {
    markers: {},
    /** addMarker(id, {pos:Vector3 | bearing:deg, color, size}) — shows a dot on the compass strip */
    addMarker: function (id, m) { HG.compass.markers[id] = m; },
    removeMarker: function (id) { delete HG.compass.markers[id]; }
  };
  ui.css(
    '.hg-hudbox{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:14px;background:rgba(10,20,15,.66);border:1.5px solid var(--panel-line)}' +
    '.hg-bars{flex-direction:column;align-items:stretch!important;gap:5px;min-width:128px}' +
    '.hg-bar{display:flex;align-items:center;gap:6px}.hg-bar svg{width:15px;height:15px;flex:none}' +
    '.hg-bar i{display:block;height:8px;flex:1;border-radius:6px;background:rgba(255,255,255,.14);overflow:hidden;position:relative}' +
    '.hg-bar i b{position:absolute;left:0;top:0;bottom:0;border-radius:6px;transition:width .2s}' +
    '.hg-hp b{background:linear-gradient(90deg,#d8433b,#ff7a5c)}.hg-hp svg{color:#ff6b5a}' +
    '.hg-st b{background:linear-gradient(90deg,var(--amber),var(--amber-2))}.hg-st svg{color:var(--amber-2)}' +
    '.hg-iconbtn{width:48px;height:48px;border-radius:14px;border:1.5px solid var(--panel-line);background:rgba(10,20,15,.66);color:var(--cream);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}' +
    '.hg-iconbtn svg{width:22px;height:22px}' +
    '#hg-compass{display:block;width:300px;height:38px;border-radius:12px;background:linear-gradient(180deg,rgba(10,20,15,.72),rgba(10,20,15,.5));border:1.5px solid var(--panel-line)}' +
    '.portrait #hg-compass{width:180px}' +
    '.portrait .hg-meters{flex-direction:column;align-items:flex-end}' +
    '.hg-meters{display:flex;gap:6px}' +
    '.hg-meter{display:flex;align-items:center;gap:5px;padding:4px 8px;border-radius:10px;background:rgba(10,20,15,.66);border:1.5px solid var(--panel-line);font:700 12px var(--num);color:var(--cream-2)}' +
    '.hg-meter svg{width:16px;height:16px}' +
    '.hg-segs{display:flex;gap:2px}.hg-segs u{display:block;width:5px;height:12px;border-radius:2px;background:rgba(255,255,255,.15)}' +
    '.hg-wind svg{transition:transform .3s;color:var(--sky)}' +
    '.hg-weapon{display:flex;align-items:baseline;gap:10px;padding:6px 14px;border-radius:14px;background:rgba(10,20,15,.66);border:1.5px solid var(--panel-line)}' +
    '.hg-weapon .wn{font:700 13px var(--num);letter-spacing:.08em;text-transform:uppercase;color:var(--cream-2)}' +
    '.hg-weapon .am{font:700 24px var(--num);color:var(--cream)}.hg-weapon .am small{font-size:15px;color:var(--cream-2)}' +
    '.hg-weapon .am.low{color:var(--danger)}' +
    '.hg-reloadbar{height:3px;border-radius:2px;background:var(--amber);width:0}' +
    '.portrait .hg-meter span{display:none}'
  );
  function buildHUD() {
    var tl = ui.hudSlot('topLeft'), tc = ui.hudSlot('topCenter'), tr = ui.hudSlot('topRight'), bc = ui.hudSlot('bottomCenter');
    var row = document.createElement('div'); row.className = 'hg-row';
    var pauseBtn = document.createElement('button'); pauseBtn.className = 'hg-iconbtn'; pauseBtn.setAttribute('aria-label', 'Pause');
    pauseBtn.innerHTML = ui.icon('pause');
    pauseBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    pauseBtn.addEventListener('click', function (e) { e.stopPropagation(); HG.pause('user'); });
    var bars = document.createElement('div'); bars.className = 'hg-hudbox hg-bars';
    bars.innerHTML = '<div class="hg-bar hg-hp">' + ui.icon('heart') + '<i><b></b></i></div><div class="hg-bar hg-st">' + ui.icon('bolt') + '<i><b></b></i></div>';
    row.appendChild(pauseBtn); row.appendChild(bars); tl.appendChild(row);
    hud.hp = bars.querySelector('.hg-hp b'); hud.st = bars.querySelector('.hg-st b');
    var cv = document.createElement('canvas'); cv.id = 'hg-compass'; tc.appendChild(cv); hud.compass = cv;
    var cash = document.createElement('div'); cash.className = 'hg-pill hg-cash';
    cash.innerHTML = '<span class="ico">' + ui.icon('cash') + '</span><span class="v">$0</span>';
    tr.appendChild(cash); hud.cash = cash.querySelector('.v');
    var meters = document.createElement('div'); meters.className = 'hg-meters';
    meters.innerHTML = '<div class="hg-meter" title="Noise">' + ui.icon('foot') + '<div class="hg-segs n">' + '<u></u><u></u><u></u><u></u><u></u>' + '</div></div>' +
      '<div class="hg-meter" title="Visibility">' + ui.icon('eye') + '<div class="hg-segs v">' + '<u></u><u></u><u></u><u></u><u></u>' + '</div></div>' +
      '<div class="hg-meter hg-wind" title="Wind">' + ui.icon('arrow') + '<span class="ws">0</span></div>';
    tr.appendChild(meters);
    hud.noise = meters.querySelectorAll('.n u'); hud.vis = meters.querySelectorAll('.v u');
    hud.windArrow = meters.querySelector('.hg-wind svg'); hud.windSpeed = meters.querySelector('.ws');
    var wpn = document.createElement('div'); wpn.className = 'hg-weapon';
    wpn.innerHTML = '<div><div class="wn"></div><div class="hg-reloadbar"></div></div><div class="am"></div>';
    bc.appendChild(wpn); hud.wn = wpn.querySelector('.wn'); hud.am = wpn.querySelector('.am'); hud.rb = wpn.querySelector('.hg-reloadbar');
    // mobile action cluster (arc around FIRE)
    ui.actionButton('fire', 'Fire', 'fire', function () { input.fire = true; input.firePressed = true; }, { hold: true, cls: 'fire', pos: { right: 14, bottom: 18, portrait: { right: 12, bottom: 20 } }, onRelease: function () { input.fire = false; } });
    ui.actionButton('aim', 'Aim', 'aim', function (on) { input.aim = on; input.aimToggle = on; }, { toggle: true, cls: 'aim', pos: { right: 118, bottom: 22, portrait: { right: 22, bottom: 116 } } });
    ui.actionButton('reload', 'Reload', 'reload', function () { HG.reload(); }, { pos: { right: 30, bottom: 124, portrait: { right: 106, bottom: 26 } } });
    ui.actionButton('weapon', 'Swap', 'swap', function () { HG.cycleWeapon(1); }, { pos: { right: 98, bottom: 106, portrait: { right: 100, bottom: 92 } } });
    ui.actionButton('crouch', 'Crouch', 'crouch', function () { HG.setCrouch(!player.crouch); }, { pos: { right: 200, bottom: 16, portrait: { right: 28, bottom: 192 } } });
    ui.actionButton('sprint', 'Sprint', 'sprint', function (on) { input.sprintToggle = on; if (on && player.crouch) HG.setCrouch(false); }, { toggle: true, pos: { right: 172, bottom: 88, portrait: { right: 94, bottom: 158 } } });
  }
  var hudT = 0, compassT = 0, lastHud = {};
  function setText(el, key, v) { if (lastHud[key] !== v) { lastHud[key] = v; el.textContent = v; } }
  function setSegs(list, k, key) {
    var n = Math.round(k * list.length);
    if (lastHud[key] === n) return; lastHud[key] = n;
    for (var i = 0; i < list.length; i++) list[i].style.background = i < n ? (key === 'noise' ? (i >= 3 ? 'var(--danger)' : 'var(--amber-2)') : (i >= 3 ? 'var(--danger)' : 'var(--moss)')) : '';
  }
  function updateHUD(rdt) {
    hudT -= rdt; compassT -= rdt;
    if (compassT <= 0) { compassT = 1 / 30; drawCompass(); }
    if (hudT > 0) return; hudT = 0.1;
    hud.hp.style.width = (player.health / player.maxHealth * 100).toFixed(0) + '%';
    hud.st.style.width = (player.stamina * 100).toFixed(0) + '%';
    setText(hud.cash, 'cash', U.money(HG.session ? HG.session.cashEarned : 0));
    setSegs(hud.noise, player.noise, 'noise');
    setSegs(hud.vis, player.visibility, 'vis');
    var rel = U.wrap(HG.wind.dir - player.yaw);
    var deg = Math.round(-rel / DEG);
    if (lastHud.wd !== deg) { lastHud.wd = deg; hud.windArrow.style.transform = 'rotate(' + deg + 'deg)'; }
    setText(hud.windSpeed, 'ws', HG.wind.speed.toFixed(0) + ' m/s');
    if (W.def) {
      setText(hud.wn, 'wn', W.def.name);
      var st = weaponMag(W.id), res = HG.save.ammo[W.def.ammo] || 0;
      var amTxt = st.mag + '|' + res;
      if (lastHud.am !== amTxt) { lastHud.am = amTxt; hud.am.innerHTML = st.mag + ' <small>/ ' + res + '</small>'; hud.am.classList.toggle('low', st.mag === 0); }
      hud.rb.style.width = W.reloading ? ((1 - W.reloadT / W.reloadDur) * 100).toFixed(0) + '%' : '0';
    }
    ui.setActionActive('crouch', player.crouch);
    ui.setActionVisible('weapon', HG.getLoadout().length > 1);
    if (HG.fpsEl) HG.fpsEl.textContent = HG.fps + ' fps';
  }
  var cmp = { ctx: null, bearing: 0, span: 150, w: 300, h: 38, ppd: 2 };
  function mark(bDeg, color, size) {
    var d = ((bDeg - cmp.bearing + 540) % 360) - 180;
    if (Math.abs(d) > cmp.span / 2) { d = d > 0 ? cmp.span / 2 - 2 : -cmp.span / 2 + 2; size *= 0.7; } // clamp to edges as a hint
    var x = cmp.w / 2 + d * cmp.ppd, ctx = cmp.ctx;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, cmp.h - 6, size, 0, TAU); ctx.fill();
  }
  var COMPASS_LABELS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  function drawCompass() {
    var cv = hud.compass; if (!cv) return;
    var w = cv.clientWidth || 300, h = cv.clientHeight || 38, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var bearing = U.bearing(player.yaw + player.recoilYaw), span = w < 220 ? 110 : 150, ppd = w / span;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var start = Math.floor((bearing - span / 2) / 15) * 15;
    for (var b = start; b <= bearing + span / 2; b += 15) {
      var x = w / 2 + (b - bearing) * ppd, bb = ((b % 360) + 360) % 360;
      var lab = COMPASS_LABELS[bb];
      var edge = 1 - Math.abs(x - w / 2) / (w / 2);
      ctx.globalAlpha = U.clamp(edge * 1.6, 0, 1);
      if (lab) {
        ctx.fillStyle = bb === 0 ? '#ff8a1f' : '#fbf1dc';
        ctx.font = (lab.length === 1 ? '800 16px ' : '700 12px ') + 'Barlow, system-ui, sans-serif';
        ctx.fillText(lab, x, h / 2 + 1);
      } else {
        ctx.fillStyle = 'rgba(251,241,220,.5)'; ctx.fillRect(x - 0.75, 5, 1.5, 5);
        ctx.font = '600 10px Barlow, system-ui, sans-serif'; ctx.fillText(String(bb), x, h / 2 + 4);
      }
    }
    ctx.globalAlpha = 1;
    // markers: alerted / fleeing / charging animals (within 200 m) + feature markers
    cmp.ctx = ctx; cmp.bearing = bearing; cmp.span = span; cmp.w = w; cmp.h = h; cmp.ppd = ppd;
    for (var i = 0; i < HG.animals.length; i++) {
      var a = HG.animals[i];
      if (a.dead || a.distToPlayer > 200) continue;
      var st = a.state;
      if (st === 'alert' || st === 'flee' || st === 'warn' || st === 'charge' || st === 'retreat') {
        var by = U.bearing(U.yawTo(player.pos.x, player.pos.z, a.pos.x, a.pos.z));
        mark(by, st === 'warn' || st === 'charge' || st === 'retreat' ? '#ef4b43' : '#ffb54d', 3.5);
      }
    }
    for (var id in HG.compass.markers) {
      var m = HG.compass.markers[id], bd;
      if (m.pos) bd = U.bearing(U.yawTo(player.pos.x, player.pos.z, m.pos.x, m.pos.z)); else bd = m.bearing || 0;
      mark(bd, m.color || '#9fd3e6', m.size || 4);
    }
    // centre marker
    ctx.fillStyle = '#ff8a1f';
    ctx.beginPath(); ctx.moveTo(w / 2 - 6, 0); ctx.lineTo(w / 2 + 6, 0); ctx.lineTo(w / 2, 7); ctx.closePath(); ctx.fill();
  }

  /* ------------------------------------------------------------------
   * Shop
   * ------------------------------------------------------------------ */
  HG.shop = {
    items: [],
    categories: [
      { id: 'weapons', name: 'Weapons', icon: 'rifle' }, { id: 'ammo', name: 'Ammo', icon: 'ammo' },
      { id: 'scopes', name: 'Scopes', icon: 'aim' }, { id: 'gear', name: 'Gear', icon: 'binoculars' },
      { id: 'outfits', name: 'Outfits', icon: 'eye' }, { id: 'companions', name: 'Companions', icon: 'paw' },
      { id: 'vehicles', name: 'Vehicles', icon: 'map' }, { id: 'maps', name: 'Maps', icon: 'pin' },
      { id: 'upgrades', name: 'Upgrades', icon: 'star' }
    ],
    tab: 'weapons',
    /** Register (or replace by id) a shop item. Returns the item. */
    add: function (item) {
      if (!item || !item.id) { console.error('[HG] shop item needs an id', item); return null; }
      item.category = item.category || 'upgrades';
      item.currency = item.currency === 'gold' ? 'gold' : 'cash';
      item.price = item.price || 0; item.levelReq = item.levelReq || 1;
      var i = HG.shop.items.findIndex(function (x) { return x.id === item.id; });
      if (i >= 0) HG.shop.items[i] = item; else HG.shop.items.push(item);
      return item;
    },
    remove: function (id) { var i = HG.shop.items.findIndex(function (x) { return x.id === id; }); if (i >= 0) HG.shop.items.splice(i, 1); },
    get: function (id) { for (var i = 0; i < HG.shop.items.length; i++) if (HG.shop.items[i].id === id) return HG.shop.items[i]; return null; },
    owns: function (id) {
      var it = HG.shop.get(id);
      if (it && it.owned) { try { return !!it.owned(); } catch (e) { return false; } }
      return HG.save.owned.indexOf(id) >= 0;
    },
    /** -> {ok:bool, reason:'owned'|'level'|'funds'|'missing'|''} */
    canBuy: function (id) {
      var it = HG.shop.get(id); if (!it) return { ok: false, reason: 'missing' };
      if (!it.consumable && HG.shop.owns(id)) return { ok: false, reason: 'owned' };
      if (HG.save.level < (it.levelReq || 1)) return { ok: false, reason: 'level' };
      if ((HG.save[it.currency] || 0) < it.price) return { ok: false, reason: 'funds' };
      if (it.canBuy) { var r = it.canBuy(); if (r !== true && r) return { ok: false, reason: String(r) }; }
      return { ok: true, reason: '' };
    },
    /** Buy with in-game currency. Emits 'purchase'(item). Returns true on success. */
    buy: function (id) {
      var it = HG.shop.get(id), c = HG.shop.canBuy(id);
      if (!c.ok) {
        HG.sfx('deny');
        var msg = c.reason === 'owned' ? 'Already owned' : c.reason === 'level' ? 'Requires level ' + (it && it.levelReq) : c.reason === 'funds' ? 'Not enough ' + (it && it.currency === 'gold' ? 'gold' : 'cash') : c.reason === 'missing' ? 'Unknown item' : c.reason;
        ui.toast(msg, { color: 'var(--danger)' });
        return false;
      }
      HG.save[it.currency] -= it.price;
      if (!it.consumable && HG.save.owned.indexOf(id) < 0) HG.save.owned.push(id);
      if (it.onBuy) { try { it.onBuy(it); } catch (e) { console.error('[HG] onBuy ' + id, e); } }
      HG.sfx('buy');
      ui.toast((it.consumable ? 'Bought ' : 'Unlocked ') + it.name, { color: 'var(--cash)' });
      HG.store();
      HG.emit('purchase', it);
      return true;
    },
    /** Which equip slot an item uses (or null). */
    equipSlot: function (it) {
      if (!it) return null;
      if (it.equipSlot !== undefined) return it.equipSlot;
      if (it.category === 'weapons') { var w = HG.weaponTypes[it.weapon || it.id]; return w ? (w.slot === 'sidearm' ? 'sidearm' : 'weapon') : null; }
      return { outfits: 'outfit', companions: 'companion', vehicles: 'vehicle', gear: 'gear' }[it.category] || null;
    },
    /** Create a shop item from a registered weapon type. extra overrides fields. */
    addWeapon: function (weaponId, extra) {
      var w = HG.weaponTypes[weaponId]; if (!w) { console.error('[HG] addWeapon: unknown ' + weaponId); return null; }
      var it = { id: weaponId, weapon: weaponId, category: 'weapons', name: w.name, desc: w.desc || '', price: w.price || 0, currency: w.currency || 'cash', levelReq: w.levelReq || 1,
        icon: w.icon || function (ctx, cw, ch) { HG.ui.draw.rifle(ctx, cw, ch, w.iconColors); }, stats: w.stats || null };
      if (extra) for (var k in extra) it[k] = extra[k];
      return HG.shop.add(it);
    },
    /** Create an ammo pack item: buys `packs` x ammo.pack rounds. */
    addAmmo: function (ammoId, packs, extra) {
      var a = HG.ammoTypes[ammoId]; if (!a) { console.error('[HG] addAmmo: unknown ' + ammoId); return null; }
      packs = packs || 1;
      var qty = a.pack * packs;
      var it = { id: ammoId + (packs > 1 ? '_x' + packs : ''), category: 'ammo', name: a.name + ' ×' + qty, desc: a.desc || ('Box of ' + qty + ' rounds.'),
        price: Math.round(a.price * packs * (packs > 1 ? 0.85 : 1)), currency: 'cash', levelReq: a.levelReq || 1, consumable: true, qty: qty, ammo: ammoId,
        icon: a.icon || function (ctx, cw, ch) { HG.ui.draw.ammo(ctx, cw, ch, a.color); },
        onBuy: function () { HG.addAmmo(ammoId, qty); } };
      if (extra) for (var k in extra) it[k] = extra[k];
      return HG.shop.add(it);
    },
    open: function (tab) { if (tab) HG.shop.tab = tab; ui.show('shop'); }
  };
  function syncMapItems() {
    Object.keys(HG.maps).forEach(function (id) {
      var m = HG.maps[id];
      if (!m.price || HG.shop.get('map_' + id)) return;
      HG.shop.add({ id: 'map_' + id, category: 'maps', name: m.name, desc: m.desc || '', price: m.price, currency: m.currency || 'cash', levelReq: m.levelReq || 1, mapId: id,
        icon: function (ctx, w, h) { HG.ui.draw.mapPreview(ctx, w, h, m); },
        owned: function () { return HG.save.unlockedMaps.indexOf(id) >= 0; },
        onBuy: function () { if (HG.save.unlockedMaps.indexOf(id) < 0) HG.save.unlockedMaps.push(id); HG.emit('mapUnlocked', id); } });
    });
  }
  HG.syncMapItems = syncMapItems;

  /* ---------- canvas icon drawing helpers (for shop items & cards) ---------- */
  ui.draw = {
    rifle: function (ctx, w, h, colors) {
      colors = colors || {};
      ctx.save(); ctx.translate(w / 2, h / 2); var s = Math.min(w / 100, h / 50); ctx.scale(s, s); ctx.rotate(-0.12);
      ctx.fillStyle = colors.wood || '#8a5a36';
      ctx.beginPath(); ctx.moveTo(-46, 4); ctx.lineTo(-20, 0); ctx.lineTo(4, 0); ctx.lineTo(8, 6); ctx.lineTo(-8, 7); ctx.lineTo(-22, 12); ctx.lineTo(-46, 14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = colors.metal || '#2c2f33';
      ctx.fillRect(-10, -3, 56, 4); ctx.fillRect(-6, -4, 22, 7);
      if (colors.scope !== false) { ctx.fillStyle = colors.scope || '#1b1d20'; ctx.fillRect(-4, -12, 26, 6); ctx.fillRect(-8, -13, 6, 8); ctx.fillRect(20, -13, 5, 8); ctx.fillRect(4, -7, 3, 4); ctx.fillRect(13, -7, 3, 4); }
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-10, -3, 56, 1);
      ctx.restore();
    },
    ammo: function (ctx, w, h, color) {
      ctx.save(); ctx.translate(w / 2, h / 2); var s = Math.min(w / 80, h / 50); ctx.scale(s, s);
      for (var i = -2; i <= 2; i++) {
        var x = i * 11;
        ctx.fillStyle = color || '#d9a441'; ctx.fillRect(x - 4, -6, 8, 22);
        ctx.fillStyle = '#b7843a'; ctx.fillRect(x - 4, 12, 8, 4);
        ctx.fillStyle = '#9c6a3c'; ctx.beginPath(); ctx.moveTo(x - 4, -6); ctx.quadraticCurveTo(x, -22, x + 4, -6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x - 3, -5, 2, 18);
      }
      ctx.restore();
    },
    box: function (ctx, w, h, color, label) {
      ctx.save(); ctx.translate(w / 2, h / 2); var s = Math.min(w / 80, h / 56); ctx.scale(s, s);
      ctx.fillStyle = color || '#6b4630'; ctx.fillRect(-28, -18, 56, 36);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-28, 10, 56, 8);
      ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 2; ctx.strokeRect(-28, -18, 56, 36);
      if (label) { ctx.fillStyle = '#fbf1dc'; ctx.font = '700 14px Barlow, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 0, -3); }
      ctx.restore();
    },
    coin: function (ctx, w, h, gold) {
      var r = Math.min(w, h) * 0.32; ctx.save(); ctx.translate(w / 2, h / 2);
      ctx.fillStyle = gold ? '#ffd24a' : '#9fe07a'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = gold ? '#b8860b' : '#4f8a2e'; ctx.lineWidth = r * 0.15; ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, TAU); ctx.stroke();
      ctx.restore();
    },
    mapPreview: function (ctx, w, h, m) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, m.skyTop || '#4f8fd0'); g.addColorStop(0.7, (m.fog && m.fog.color) || m.skyBottom || '#cfe0dc');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      var gc = m.groundColors || {}, r = U.rng(hashStr(m.name || 'm'));
      ctx.fillStyle = m.mountainColor || '#6f8a8f'; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.moveTo(0, h * 0.62);
      for (var x = 0; x <= w; x += w / 7) ctx.lineTo(x, h * (0.32 + r() * 0.25)); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = gc.base || '#5f8c3c'; ctx.beginPath(); ctx.moveTo(0, h * 0.75);
      for (x = 0; x <= w; x += w / 10) ctx.lineTo(x, h * (0.66 + r() * 0.1)); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
      ctx.fillStyle = m.treeColor || '#2f5a32';
      for (var i = 0; i < 9; i++) { var tx = r() * w, ty = h * (0.7 + r() * 0.2), th = h * (0.14 + r() * 0.12); ctx.beginPath(); ctx.moveTo(tx, ty - th); ctx.lineTo(tx + th * 0.32, ty); ctx.lineTo(tx - th * 0.32, ty); ctx.fill(); }
    },
    /** generic quadruped silhouette (used when an animal type has no icon) */
    quadruped: function (ctx, w, h, color) {
      ctx.save(); ctx.translate(w / 2, h / 2); var s = Math.min(w / 100, h / 70); ctx.scale(s, s);
      ctx.fillStyle = color || '#fbf1dc';
      ctx.beginPath(); ctx.ellipse(0, 0, 30, 13, 0, 0, TAU); ctx.fill();
      ctx.fillRect(-26, 4, 6, 26); ctx.fillRect(-14, 4, 6, 26); ctx.fillRect(14, 4, 6, 26); ctx.fillRect(22, 4, 6, 26);
      ctx.beginPath(); ctx.moveTo(22, -6); ctx.lineTo(34, -26); ctx.lineTo(44, -24); ctx.lineTo(32, -2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(42, -26, 9, 6, -0.3, 0, TAU); ctx.fill();
      ctx.restore();
    }
  };

  /* ------------------------------------------------------------------
   * Screens: menu, maps, shop, trophy card, summary, pause, settings
   * ------------------------------------------------------------------ */
  ui.css(
    '.hg-menu{min-height:100%;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:8px 6px}' +
    '#scr-menu{background:linear-gradient(90deg,rgba(8,18,12,.82),rgba(8,18,12,.35) 55%,rgba(8,18,12,.08))}' +
    '.hg-logo{display:flex;flex-direction:column;gap:6px}' +
    '.hg-logo .mark{width:54px;height:54px;color:var(--amber);filter:drop-shadow(0 3px 0 rgba(0,0,0,.4))}.hg-logo .mark svg{width:100%;height:100%}' +
    '.hg-logo h1{font-family:var(--display);font-weight:400;font-size:clamp(34px,8.5vmin,68px);line-height:.92;margin:0;color:var(--cream);text-shadow:0 4px 0 rgba(0,0,0,.35),0 10px 30px rgba(0,0,0,.4)}' +
    '.hg-logo h1 span{color:var(--amber);display:block}' +
    '.hg-logo p{margin:2px 0 0;font-weight:700;letter-spacing:.18em;text-transform:uppercase;font-size:12px;color:var(--cream-2)}' +
    '.hg-profile{display:flex;align-items:center;gap:12px;padding:10px 14px;margin-top:14px;max-width:360px}' +
    '.hg-lvl{width:48px;height:48px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:20px;color:var(--ink);background:radial-gradient(circle at 35% 30%,var(--amber-2),var(--amber));box-shadow:0 3px 0 var(--amber-3)}' +
    '.hg-xp{flex:1;min-width:110px}.hg-xp small{display:block;font:700 12px var(--num);color:var(--cream-2);letter-spacing:.06em;margin-bottom:4px}' +
    '.hg-xpbar{height:9px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden}.hg-xpbar b{display:block;height:100%;background:linear-gradient(90deg,var(--moss),#b5d36a);border-radius:6px}' +
    '.hg-wallet{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}' +
    '.hg-menu-right{display:flex;flex-direction:column;gap:12px;align-items:stretch;min-width:220px;max-width:300px;width:34%}' +
    '.hg-menu-right .hg-btn{width:100%}' +
    '.hg-play{min-height:64px!important;font-size:24px!important}' +
    '#hg-menu-buttons{display:flex;flex-direction:column;gap:10px}' +
    '@media (orientation:portrait){#scr-menu{background:linear-gradient(180deg,rgba(8,18,12,.75),rgba(8,18,12,.3) 45%,rgba(8,18,12,.85))}.hg-menu{flex-direction:column;justify-content:center;align-items:stretch}.hg-menu-right{width:100%;max-width:none;min-width:0}.hg-logo{align-items:flex-start}}' +
    '@media (max-height:420px) and (orientation:landscape){.hg-menu-right{gap:8px}#hg-menu-buttons{gap:8px}.hg-menu-right .hg-btn{min-height:48px}.hg-play{min-height:56px!important}.hg-profile{margin-top:8px}}' +
    '.hg-wrap{max-width:1100px;margin:0 auto;padding-bottom:16px}' +
    '.hg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}' +
    '.hg-card{position:relative;display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:var(--radius);background:linear-gradient(180deg,rgba(42,81,57,.55),rgba(18,36,27,.92));border:2px solid var(--panel-line);box-shadow:0 8px 22px rgba(0,0,0,.3)}' +
    '.hg-card h3{margin:0;font-family:var(--display);font-weight:400;font-size:18px;letter-spacing:.02em}' +
    '.hg-card p{margin:0;font-size:13.5px;line-height:1.35;color:var(--cream-2);flex:1}' +
    '.hg-card .ic{height:64px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:radial-gradient(ellipse at center,rgba(255,255,255,.08),transparent 70%)}' +
    '.hg-card .foot{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:4px}' +
    '.hg-card .foot .hg-btn{flex:1}' +
    '.hg-card.locked{opacity:.78}.hg-card.owned{border-color:rgba(127,160,69,.55)}' +
    '.hg-tag{display:inline-flex;align-items:center;gap:4px;font:700 11px var(--num);letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:999px;background:rgba(0,0,0,.3);color:var(--cream-2)}' +
    '.hg-tag svg{width:13px;height:13px}' +
    '.hg-stats{display:flex;flex-direction:column;gap:3px}.hg-stat{display:flex;align-items:center;gap:6px;font:600 11px var(--num);color:var(--cream-2);text-transform:uppercase;letter-spacing:.05em}' +
    '.hg-stat span{width:66px}.hg-stat i{flex:1;height:6px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}.hg-stat i b{display:block;height:100%;background:var(--amber-2);border-radius:4px}' +
    '.hg-tabs{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 10px;margin-bottom:6px;scrollbar-width:none;touch-action:pan-x}' +
    '.hg-tabs::-webkit-scrollbar{display:none}' +
    '.hg-tab{flex:none;min-height:44px;padding:6px 14px;border-radius:999px;border:1.5px solid var(--panel-line);background:rgba(10,20,15,.6);color:var(--cream-2);font:700 14px var(--body);display:flex;align-items:center;gap:6px;cursor:pointer}' +
    '.hg-tab svg{width:18px;height:18px}.hg-tab.on{background:var(--amber);color:var(--ink);border-color:var(--amber-2)}' +
    '.hg-price svg{width:18px;height:18px}' +
    '.hg-mapcard canvas{width:100%!important;height:110px!important;border-radius:12px;display:block}' +
    '.hg-trophy{max-width:460px;width:100%;margin:auto;padding:0;overflow:hidden;text-align:center}' +
    '#scr-trophy{display:flex;padding-top:max(14px,env(safe-area-inset-top));padding-bottom:max(14px,env(safe-area-inset-bottom))}' +
    '.hg-trophy .top{position:relative;padding:16px 16px 10px;background:radial-gradient(ellipse at 50% 0%,rgba(255,181,77,.35),transparent 70%),repeating-linear-gradient(90deg,rgba(107,70,48,.35) 0 14px,rgba(90,58,40,.35) 14px 28px)}' +
    '.hg-trophy .rar{display:inline-block;font:800 11px var(--num);letter-spacing:.2em;text-transform:uppercase;padding:3px 10px;border-radius:999px;background:rgba(0,0,0,.35)}' +
    '.hg-trophy h2{font-family:var(--display);font-weight:400;font-size:clamp(24px,6vmin,34px);margin:6px 0 0}' +
    '.hg-trophy .rec{display:inline-block;margin-top:6px;padding:3px 12px;border-radius:8px;background:var(--gold);color:var(--ink);font:800 13px var(--num);letter-spacing:.1em;animation:hgPulse 1s ease-in-out infinite alternate}' +
    '@keyframes hgPulse{from{transform:scale(1)}to{transform:scale(1.08)}}' +
    '.hg-trophy .facts{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--panel-line)}' +
    '.hg-trophy .facts div{background:var(--pine);padding:8px 4px}.hg-trophy .facts b{display:block;font:700 20px var(--num)}.hg-trophy .facts small{font:700 10px var(--num);letter-spacing:.12em;text-transform:uppercase;color:var(--cream-2)}' +
    '.hg-trophy .rew{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;padding:12px}' +
    '.hg-trophy .bon{font:600 13px var(--body);color:var(--cream-2);padding:0 12px}' +
    '.hg-trophy .act{padding:0 16px 16px}' +
    '.hg-sum{max-width:620px;margin:0 auto;padding:16px}' +
    '.hg-killrow{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:rgba(0,0,0,.22);margin-bottom:6px}' +
    '.hg-killrow b{flex:1;font-weight:700}.hg-killrow span{font:700 14px var(--num);color:var(--cream-2)}' +
    '.hg-totals{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:12px 0}' +
    '.hg-set{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.2);margin-bottom:8px;min-height:56px}' +
    '.hg-set label{font-weight:700;font-size:15px}' +
    '.hg-set input[type=range]{width:min(46vw,240px);accent-color:var(--amber);height:32px}' +
    '.hg-switch{width:58px;height:32px;border-radius:999px;border:0;background:rgba(255,255,255,.18);position:relative;cursor:pointer;flex:none}' +
    '.hg-switch::after{content:"";position:absolute;left:4px;top:4px;width:24px;height:24px;border-radius:50%;background:var(--cream);transition:left .15s}' +
    '.hg-switch.on{background:var(--amber)}.hg-switch.on::after{left:30px}' +
    '.hg-seg{display:flex;border-radius:12px;overflow:hidden;border:1.5px solid var(--panel-line)}' +
    '.hg-seg button{border:0;background:transparent;color:var(--cream-2);font:700 14px var(--body);padding:8px 14px;min-height:44px;cursor:pointer}.hg-seg button.on{background:var(--amber);color:var(--ink)}' +
    '.hg-center{min-height:100%;display:flex;align-items:center;justify-content:center}' +
    '.hg-pause{width:100%;max-width:400px;padding:18px;display:flex;flex-direction:column;gap:10px;text-align:center}' +
    '.hg-keys{font:600 12.5px var(--num);color:var(--cream-2);line-height:1.6;letter-spacing:.03em}' +
    '#hg-root.touch .hg-keys{display:none}'
  );
  // compact layouts for short landscape phones (e.g. 640x360, 844x390) and narrow portrait
  ui.css(
    '@media (orientation:landscape) and (max-height:500px){' +
    '.hg-trophy{max-width:700px;display:grid;grid-template-columns:40% 60%;grid-template-rows:auto auto auto 1fr}' +
    '.hg-trophy .top{grid-column:1;grid-row:1 / span 4;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px}' +
    '.hg-trophy .facts,.hg-trophy .rew,.hg-trophy .bon,.hg-trophy .act{grid-column:2}' +
    '.hg-trophy .act{align-self:end;padding:0 14px 14px}.hg-trophy .rew{padding:10px}' +
    '.hg-trophy .facts div{padding:7px 4px}' +
    '}' +
    '@media (max-height:430px){' +
    '.hg-card{padding:10px;gap:4px}.hg-card .ic{height:48px}.hg-card .ic canvas{width:90px!important;height:48px!important}' +
    '.hg-mapcard canvas{height:78px!important}' +
    '.hg-screen-head{margin:0 0 6px}.hg-tabs{padding-bottom:6px;margin-bottom:2px}' +
    '.hg-sum{padding:8px}' +
    '}' +
    '#hg-root.card-open .hg-toast.big,#hg-root.card-open #hg-banner{display:none}' +
    '@media (max-width:480px){.hg-killrow{flex-wrap:wrap;row-gap:2px}.hg-killrow b{flex-basis:70%}.hg-killrow span{font-size:13px}}'
  );
  // ---- main menu ----
  var menuEl = ui.screen('menu',
    '<div class="hg-menu"><div class="hg-menu-left"><div class="hg-logo"><div class="mark">' + ui.icon('antlers') + '</div>' +
    '<h1>Wildwood<span>Hunter</span></h1><p>Track • Stalk • Trophy</p></div>' +
    '<div class="hg-profile hg-panel"><div class="hg-lvl">1</div><div class="hg-xp"><small class="xpt">LEVEL 1</small><div class="hg-xpbar"><b style="width:0"></b></div>' +
    '<div class="hg-wallet"><span class="hg-pill hg-cash"><span class="ico">' + ui.icon('cash') + '</span><span class="cv">$0</span></span>' +
    '<span class="hg-pill hg-gold"><span class="ico">' + ui.icon('gold') + '</span><span class="gv">0</span></span></div></div></div></div>' +
    '<div class="hg-menu-right"><div id="hg-menu-buttons"></div></div></div>');
  menuEl.classList.add('clear');
  menuExtra = menuEl.querySelector('#hg-menu-buttons');
  ui.menuButton('Play', function () { ui.show('maps'); }, { primary: true, icon: 'play', id: 'hg-btn-play', order: -10, cls: 'hg-play' });
  ui.menuButton('Shop', function () { HG.shop.open(); }, { icon: 'cart', id: 'hg-btn-shop', order: 0 });
  ui.menuButton('Settings', function () { HG.openSettings('menu'); }, { icon: 'gear', id: 'hg-btn-settings', order: 50, ghost: true });
  /** refresh the wallet / level widgets on any screen ( elements with .cv .gv .hg-lvl .xpt .hg-xpbar b ) */
  HG.refreshWallet = function (root) {
    root = root || document;
    var lp = HG.levelProgress();
    root.querySelectorAll('.cv').forEach(function (e) { e.textContent = U.money(HG.save.cash); });
    root.querySelectorAll('.gv').forEach(function (e) { e.textContent = U.fmt(HG.save.gold); });
    root.querySelectorAll('.hg-lvl').forEach(function (e) { e.textContent = lp.level; });
    root.querySelectorAll('.xpt').forEach(function (e) { e.textContent = 'LEVEL ' + lp.level + ' • ' + U.fmt(lp.cur) + ' / ' + U.fmt(lp.need) + ' XP'; });
    root.querySelectorAll('.hg-xpbar b').forEach(function (e) { e.style.width = (lp.frac * 100).toFixed(1) + '%'; });
  };
  ui.onShow('menu', function (el) {
    HG.refreshWallet(el);
    // keep feature buttons sorted by order
    var kids = Array.prototype.slice.call(menuExtra.children);
    kids.sort(function (a, b) { return (+a.dataset.order || 0) - (+b.dataset.order || 0); }).forEach(function (k) { menuExtra.appendChild(k); });
  });
  HG.on('cash', function () { if (ui.isOpen('menu')) HG.refreshWallet(menuEl); });
  HG.on('gold', function () { if (ui.isOpen('menu')) HG.refreshWallet(menuEl); });
  function walletHTML() {
    return '<span class="hg-pill hg-cash"><span class="ico">' + ui.icon('cash') + '</span><span class="cv">' + U.money(HG.save.cash) + '</span></span>' +
      '<span class="hg-pill hg-gold"><span class="ico">' + ui.icon('gold') + '</span><span class="gv">' + U.fmt(HG.save.gold) + '</span></span>';
  }
  HG.walletHTML = walletHTML;
  function backBtn(fn) { var b = ui.button('', fn, { ghost: true, icon: 'back', title: 'Back', small: false }); b.style.padding = '8px 12px'; return b; }
  ui.backButton = backBtn;
  // ---- map select ----
  ui.screen('maps');
  ui.onShow('maps', function (el) {
    el.innerHTML = '<div class="hg-wrap"><div class="hg-screen-head"><span class="bk"></span><h2 class="hg-title">Choose your grounds</h2><div class="hg-row">' + walletHTML() + '</div></div><div class="hg-grid"></div></div>';
    el.querySelector('.bk').appendChild(backBtn(function () { HG.toMenu(); }));
    var grid = el.querySelector('.hg-grid');
    Object.keys(HG.maps).sort(function (a, b) { return (HG.maps[a].levelReq || 1) - (HG.maps[b].levelReq || 1) || (HG.maps[a].price || 0) - (HG.maps[b].price || 0); }).forEach(function (id) {
      var m = HG.maps[id], unlocked = HG.isMapUnlocked(id);
      var card = document.createElement('div'); card.className = 'hg-card hg-mapcard' + (unlocked ? '' : ' locked');
      card.appendChild(ui.iconCanvas(function (ctx, w, h) { ui.draw.mapPreview(ctx, w, h, m); }, 220, 110));
      var species = (m.spawns || []).map(function (s) { var d = HG.animalTypes[s.type]; return d ? d.name : null; }).filter(Boolean);
      Object.keys(HG.animalTypes).forEach(function (t) { var d = HG.animalTypes[t]; if (d.habitats && d.habitats.indexOf(id) >= 0 && species.indexOf(d.name) < 0) species.push(d.name); });
      var info = document.createElement('div');
      info.innerHTML = '<h3>' + U.esc(m.name) + '</h3><p style="margin:4px 0">' + U.esc(m.desc || '') + '</p>' +
        '<div class="hg-row" style="flex-wrap:wrap;gap:6px">' + species.slice(0, 5).map(function (s) { return '<span class="hg-tag">' + ui.icon('paw') + U.esc(s) + '</span>'; }).join('') + '</div>';
      card.appendChild(info);
      var foot = document.createElement('div'); foot.className = 'foot';
      if (unlocked) foot.appendChild(ui.button('Hunt', function () { HG.startHunt(id); }, { primary: true, icon: 'play' }));
      else if (HG.save.level < (m.levelReq || 1)) { var lb = ui.button('Level ' + m.levelReq, function () { ui.toast('Reach level ' + m.levelReq + ' to unlock ' + m.name); }, { icon: 'lock' }); lb.disabled = true; foot.appendChild(lb); }
      else foot.appendChild(ui.button((m.currency === 'gold' ? '' : '$') + U.fmt(m.price) + (m.currency === 'gold' ? ' gold' : ''), function () { if (HG.unlockMap(id)) { ui.toast(m.name + ' unlocked!', { color: 'var(--cash)' }); ui.show('maps'); } }, { green: true, icon: 'lock' }));
      card.appendChild(foot);
      grid.appendChild(card);
    });
  });
  // ---- shop ----
  ui.screen('shop');
  function priceHTML(it) { return (it.currency === 'gold' ? ui.icon('gold') : ui.icon('cash')) + '<span>' + (it.currency === 'gold' ? U.fmt(it.price) : U.money(it.price)) + '</span>'; }
  function buildShop(el) {
    syncMapItems();
    var cats = HG.shop.categories.filter(function (c) { return HG.shop.items.some(function (it) { return it.category === c.id && !it.hidden; }); });
    if (!cats.length) cats = [HG.shop.categories[0]];
    if (!cats.some(function (c) { return c.id === HG.shop.tab; })) HG.shop.tab = cats[0].id;
    el.innerHTML = '<div class="hg-wrap"><div class="hg-screen-head"><span class="bk"></span><h2 class="hg-title">Outfitters</h2><div class="hg-row">' + walletHTML() + '</div></div>' +
      '<div class="hg-tabs"></div><div class="hg-grid"></div></div>';
    el.querySelector('.bk').appendChild(backBtn(function () { if (HG.state === 'hunt') ui.hide('shop'); else HG.toMenu(); }));
    var tabs = el.querySelector('.hg-tabs');
    cats.forEach(function (c) {
      var t = document.createElement('button'); t.type = 'button'; t.className = 'hg-tab' + (c.id === HG.shop.tab ? ' on' : '');
      t.innerHTML = ui.icon(c.icon) + U.esc(c.name);
      t.addEventListener('click', function () { HG.sfx('ui'); HG.shop.tab = c.id; buildShop(el); });
      tabs.appendChild(t);
    });
    var grid = el.querySelector('.hg-grid');
    HG.shop.items.filter(function (it) { return it.category === HG.shop.tab && !it.hidden; }).sort(function (a, b) { return (a.levelReq || 1) - (b.levelReq || 1) || (a.currency === b.currency ? a.price - b.price : a.currency === 'gold' ? 1 : -1); }).forEach(function (it) {
      grid.appendChild(HG.shop.card(it, function () { buildShop(el); }));
    });
    HG.emit('shopBuilt', el, HG.shop.tab);
  }
  /** Build one item card element (progression.js may reuse or replace). refresh() is called after buy/equip. */
  HG.shop.card = function (it, refresh) {
    var owned = HG.shop.owns(it.id), slot = HG.shop.equipSlot(it), lockedLvl = HG.save.level < (it.levelReq || 1);
    var card = document.createElement('div');
    card.className = 'hg-card' + (owned && !it.consumable ? ' owned' : '') + (lockedLvl ? ' locked' : '');
    card.dataset.item = it.id;
    var ic = document.createElement('div'); ic.className = 'ic';
    ic.appendChild(ui.iconCanvas(it.icon || function (ctx, w, h) { ui.draw.box(ctx, w, h, '#6b4630', (it.name || '?').charAt(0)); }, 120, 64));
    card.appendChild(ic);
    var body = document.createElement('div');
    var tags = '';
    if (it.consumable && it.ammo) tags += '<span class="hg-tag">' + ui.icon('ammo') + 'You have ' + (HG.save.ammo[it.ammo] || 0) + '</span>';
    if (lockedLvl) tags += '<span class="hg-tag" style="color:var(--amber-2)">' + ui.icon('lock') + 'Level ' + it.levelReq + '</span>';
    body.innerHTML = '<h3>' + U.esc(it.name) + '</h3><p>' + U.esc(it.desc || '') + '</p>' + (tags ? '<div class="hg-row" style="flex-wrap:wrap;gap:6px;margin-top:6px">' + tags + '</div>' : '');
    card.appendChild(body);
    if (it.stats) {
      var sd = document.createElement('div'); sd.className = 'hg-stats';
      Object.keys(it.stats).forEach(function (k) { var v = U.clamp(+it.stats[k] || 0, 0, 1); sd.insertAdjacentHTML('beforeend', '<div class="hg-stat"><span>' + U.esc(k) + '</span><i><b style="width:' + (v * 100).toFixed(0) + '%"></b></i></div>'); });
      card.appendChild(sd);
    }
    var foot = document.createElement('div'); foot.className = 'foot';
    if (owned && !it.consumable) {
      if (slot) {
        var eq = HG.isEquipped(slot, it.weapon || it.id);
        if (slot === 'gear') foot.appendChild(ui.button(eq ? 'Unequip' : 'Equip', function () { if (eq) HG.unequip('gear', it.id); else HG.equip('gear', it.id); refresh && refresh(); }, { small: true, green: !eq, ghost: eq }));
        else if (eq) { var b = ui.button('Equipped', function () { if (slot !== 'weapon') { HG.unequip(slot, it.id); refresh && refresh(); } }, { small: true, ghost: true, icon: 'check' }); foot.appendChild(b); }
        else foot.appendChild(ui.button('Equip', function () { HG.equip(slot, it.weapon || it.id); refresh && refresh(); }, { small: true, green: true }));
      } else foot.appendChild(Object.assign(ui.button('Owned', null, { small: true, ghost: true, icon: 'check' }), { disabled: true }));
    } else {
      var can = HG.shop.canBuy(it.id);
      var pb = ui.button('', function () { if (HG.shop.buy(it.id)) { if (slot && !it.consumable && slot !== 'gear' && !HG.save.equipped[slot === 'weapon' ? 'weapon' : slot]) HG.equip(slot, it.weapon || it.id); refresh && refresh(); } }, { small: true, primary: can.ok, cls: 'hg-price' });
      pb.innerHTML = priceHTML(it);
      if (!can.ok) pb.style.filter = 'grayscale(.5) brightness(.8)';
      foot.appendChild(pb);
    }
    card.appendChild(foot);
    return card;
  };
  ui.onShow('shop', buildShop);
  HG.on('purchase', function () { if (ui.isOpen('shop')) HG.refreshWallet(ui.getScreen('shop')); });

  // ---- trophy card ----
  ui.screen('trophy').classList.add('dim');
  /** Show the trophy card for a kill. onContinue runs when the player taps Continue. Pauses the sim while open. */
  HG.showTrophyCard = function (a, info, onContinue) {
    var def = a.def, rar = HG.RARITY[info.legendary ? 'legendary' : (def.rarity || 'common')] || HG.RARITY.common;
    var zoneLabel = { head: 'Head', vital: 'Heart / lungs', body: 'Body', leg: 'Leg' }[info.zone] || info.zone;
    var el = ui.screen('trophy');
    el.innerHTML = '<div class="hg-panel hg-trophy"><div class="top"><span class="rar" style="color:' + rar.color + '">' + (info.legendary ? 'Legendary ' : '') + U.esc(rar.label === 'Legendary' && info.legendary ? 'Trophy' : rar.label) + '</span>' +
      '<div class="pic" style="height:84px;display:flex;align-items:center;justify-content:center;margin-top:6px"></div>' +
      '<h2>' + U.esc(def.name) + '</h2>' + (info.newRecord ? '<div class="rec">NEW RECORD!</div>' : '') + '</div>' +
      '<div class="facts"><div><b>' + info.weight.toFixed(1) + '<small> kg</small></b><small>Weight</small></div><div><b>' + U.fmt(info.score) + '</b><small>Score</small></div><div><b>' + Math.round(info.distance) + '<small> m</small></b><small>Distance</small></div>' +
      '<div><b style="font-size:16px">' + U.esc(zoneLabel) + '</b><small>Shot</small></div><div style="grid-column:span 2"><b style="font-size:16px">' + U.esc(info.weaponName || '') + '</b><small>Weapon</small></div></div>' +
      '<div class="rew"><span class="hg-pill hg-cash"><span class="ico">' + ui.icon('cash') + '</span>+' + U.money(info.cash) + '</span><span class="hg-pill" style="color:#b5d36a"><span class="ico">' + ui.icon('xp') + '</span>+' + U.fmt(info.xp) + ' XP</span></div>' +
      (info.bonuses.length ? '<div class="bon">' + info.bonuses.map(function (b) { return U.esc(b.label); }).join(' • ') + '</div>' : '') +
      '<div class="act"></div></div>';
    el.querySelector('.pic').appendChild(ui.iconCanvas(function (ctx, w, h) { if (def.icon) def.icon(ctx, w, h); else ui.draw.quadruped(ctx, w, h, rar.color); }, 150, 84));
    var done = false;
    var btn = ui.button('Continue', function () {
      if (done) return; done = true;
      rootEl.classList.remove('card-open');
      ui.hide('trophy'); HG.resume('trophy');
      onContinue && onContinue();
      HG.emit('trophyClosed', a, info);
    }, { primary: true });
    btn.style.width = '100%';
    el.querySelector('.act').appendChild(btn);
    HG.exitPointerLock();
    HG.pause('trophy');
    rootEl.classList.add('card-open');
    ui.show('trophy');
    HG.sfx('trophy');
    HG.emit('trophyCard', a, info, el);
    return el;
  };

  // ---- summary ----
  ui.screen('summary');
  function showSummary(sum) {
    var el = ui.screen('summary');
    var mins = Math.floor(sum.duration / 60), secs = Math.floor(sum.duration % 60);
    el.innerHTML = '<div class="hg-sum"><div class="hg-panel" style="padding:16px">' +
      '<h2 class="hg-title" style="font-size:clamp(26px,6vmin,38px);color:' + (sum.downed ? 'var(--danger)' : 'var(--amber-2)') + '">' + (sum.downed ? 'You were knocked down' : 'Hunt complete') + '</h2>' +
      '<p style="margin:6px 0 12px;color:var(--cream-2);font-weight:600">' + U.esc(sum.mapName) + ' • ' + mins + 'm ' + (secs < 10 ? '0' : '') + secs + 's' + (sum.downed ? ' • lost ' + U.money(sum.lostCash) + ' of this hunt’s cash' : '') + '</p>' +
      '<div class="kills">' + (sum.kills.length ? sum.kills.map(function (k) {
        return '<div class="hg-killrow"><span class="ico" style="width:22px;color:' + ((HG.RARITY[k.legendary ? 'legendary' : k.rarity] || HG.RARITY.common).color) + '">' + ui.icon('antlers') + '</span><b>' + U.esc(k.species) + (k.legendary ? ' ★' : '') + '</b><span>' + k.weight.toFixed(1) + ' kg</span><span>' + U.fmt(k.score) + ' pts</span><span class="hg-cash">+' + U.money(k.cash) + '</span></div>';
      }).join('') : '<p style="color:var(--cream-2);text-align:center;margin:14px 0">No trophies this time. Move slowly, stay downwind, and crouch near cover.</p>') + '</div>' +
      '<div class="hg-totals"><span class="hg-pill hg-cash"><span class="ico">' + ui.icon('cash') + '</span>+' + U.money(sum.cashEarned - (sum.lostCash || 0)) + '</span><span class="hg-pill" style="color:#b5d36a"><span class="ico">' + ui.icon('xp') + '</span>+' + U.fmt(sum.xpEarned) + ' XP</span><span class="hg-pill"><span class="ico">' + ui.icon('trophy') + '</span>' + sum.kills.length + ' trophies</span></div>' +
      '<div class="hg-row btns" style="justify-content:center;flex-wrap:wrap"></div></div></div>';
    var row = el.querySelector('.btns');
    row.appendChild(ui.button('Lodge', function () { HG.toMenu(); }, { ghost: true, icon: 'back' }));
    row.appendChild(ui.button('Shop', function () { HG.shop.open(); }, { icon: 'cart' }));
    row.appendChild(ui.button('Hunt again', function () { HG.startHunt(sum.map); }, { primary: true, icon: 'play' }));
    ui.show('summary');
    HG.emit('summary', sum, el);
  }
  HG.showSummary = showSummary;

  // ---- pause ----
  var pauseEl = ui.screen('pause'); pauseEl.classList.add('dim');
  ui.onShow('pause', function (el) {
    el.innerHTML = '<div class="hg-center"><div class="hg-panel hg-pause"><h2 class="hg-title" style="font-size:34px;color:var(--amber-2)">Paused</h2>' +
      '<p style="margin:0 0 6px;color:var(--cream-2);font-weight:600">' + U.esc(HG.map ? HG.map.name : '') + ' • ' + (HG.session ? HG.session.kills.length : 0) + ' trophies • ' + U.money(HG.session ? HG.session.cashEarned : 0) + '</p>' +
      '<div class="pbtns" style="display:flex;flex-direction:column;gap:10px"></div>' +
      '<div class="hg-keys">WASD move • Mouse look • Click fire • Right-click aim<br>R reload • C crouch • Shift sprint • 1-9 / wheel weapons • E interact • Esc pause</div></div></div>';
    var b = el.querySelector('.pbtns');
    b.appendChild(ui.button('Resume', function () { HG.resume('user'); }, { primary: true, icon: 'play' }));
    b.appendChild(ui.button('Settings', function () { HG.openSettings('pause'); }, { icon: 'gear' }));
    b.appendChild(ui.button('End hunt', function () {
      ui.confirm('End this hunt and collect your rewards?', function () { HG.endHunt(); }, { title: 'Head back to the lodge?', yes: 'End hunt' });
    }, { ghost: true, icon: 'close' }));
    HG.emit('pauseMenu', el, b);
  });

  // ---- settings ----
  HG.settingsDefs = [
    { key: 'sens', label: 'Look sensitivity', type: 'range', min: 0.3, max: 2.5, step: 0.05 },
    { key: 'invertY', label: 'Invert look (Y)', type: 'toggle' },
    { key: 'fov', label: 'Field of view', type: 'range', min: 60, max: 90, step: 1 },
    { key: 'graphics', label: 'Graphics', type: 'choice', options: U.isTouchDevice() && HG.settings.graphics !== 'ultra' ? [['low', 'Low'], ['high', 'High']] : [['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']] },
    { key: 'aimAssist', label: 'Aim assist (touch)', type: 'toggle' },
    { key: 'sound', label: 'Sound effects', type: 'toggle' },
    { key: 'music', label: 'Music', type: 'toggle' },
    { key: 'vibrate', label: 'Vibration', type: 'toggle' },
    { key: 'showFps', label: 'Show FPS', type: 'toggle' }
  ];
  /** Add a settings row: {key, label, type:'toggle'|'range'|'choice', min, max, step, options:[[value,label]], onChange(v)} */
  HG.addSetting = function (def) {
    var i = HG.settingsDefs.findIndex(function (d) { return d.key === def.key; });
    if (i >= 0) HG.settingsDefs[i] = def; else HG.settingsDefs.push(def);
    if (HG.settings[def.key] === undefined && def.default !== undefined) HG.settings[def.key] = def.default;
  };
  /** Change a setting, apply side effects, persist, emit 'settings'. */
  HG.setSetting = function (key, val) {
    HG.settings[key] = val;
    if (key === 'sound') HG.setSound(val);
    if (key === 'music') HG.setMusic(val);
    if (key === 'graphics') HG.applyGraphics();
    if (key === 'showFps') toggleFps();
    var d = HG.settingsDefs.find(function (x) { return x.key === key; });
    if (d && d.onChange) { try { d.onChange(val); } catch (e) { console.error(e); } }
    HG.store();
    HG.emit('settings', HG.settings, key);
  };
  var settingsReturn = 'menu';
  HG.openSettings = function (from) { settingsReturn = from || (HG.state === 'hunt' ? 'pause' : 'menu'); ui.show('settings'); };
  ui.screen('settings');
  ui.onShow('settings', function (el) {
    el.innerHTML = '<div class="hg-wrap" style="max-width:620px"><div class="hg-screen-head"><span class="bk"></span><h2 class="hg-title">Settings</h2></div><div class="rows"></div>' +
      '<p style="color:var(--cream-2);font-size:12px;text-align:center;margin-top:14px">' + (HG.storageOK ? 'Progress is saved on this device.' : 'Storage is unavailable — progress will not be saved this session.') + '</p></div>';
    el.querySelector('.bk').appendChild(backBtn(function () { if (settingsReturn === 'pause' && HG.state === 'hunt') ui.show('pause'); else HG.toMenu(); }));
    var rows = el.querySelector('.rows');
    HG.settingsDefs.forEach(function (d) {
      var row = document.createElement('div'); row.className = 'hg-set';
      row.innerHTML = '<label>' + U.esc(d.label) + '</label>';
      var v = HG.settings[d.key];
      if (d.type === 'toggle') {
        var sw = document.createElement('button'); sw.type = 'button'; sw.className = 'hg-switch' + (v ? ' on' : ''); sw.setAttribute('aria-label', d.label); sw.setAttribute('aria-pressed', !!v);
        sw.addEventListener('click', function () { var nv = !HG.settings[d.key]; sw.classList.toggle('on', nv); sw.setAttribute('aria-pressed', nv); HG.setSetting(d.key, nv); HG.sfx('ui'); });
        row.appendChild(sw);
      } else if (d.type === 'range') {
        var r = document.createElement('input'); r.type = 'range'; r.min = d.min; r.max = d.max; r.step = d.step || 0.1; r.value = v; r.setAttribute('aria-label', d.label);
        r.addEventListener('input', function () { HG.setSetting(d.key, parseFloat(r.value)); });
        row.appendChild(r);
      } else if (d.type === 'choice') {
        var seg = document.createElement('div'); seg.className = 'hg-seg';
        d.options.forEach(function (o) {
          var b = document.createElement('button'); b.type = 'button'; b.textContent = o[1]; if (v === o[0]) b.className = 'on';
          b.addEventListener('click', function () { seg.querySelectorAll('button').forEach(function (x) { x.className = ''; }); b.className = 'on'; HG.setSetting(d.key, o[0]); HG.sfx('ui'); });
          seg.appendChild(b);
        });
        row.appendChild(seg);
      }
      rows.appendChild(row);
    });
  });
  function toggleFps() {
    if (HG.settings.showFps || HG.debugEnabled) {
      if (!HG.fpsEl) { HG.fpsEl = document.createElement('div'); HG.fpsEl.id = 'hg-fps'; rootEl.appendChild(HG.fpsEl); }
    } else if (HG.fpsEl) { HG.fpsEl.remove(); HG.fpsEl = null; }
  }

  /* ------------------------------------------------------------------
   * Hunt session, pause, menu backdrop
   * ------------------------------------------------------------------ */
  HG.state = 'boot';
  HG.session = null;
  HG.paused = false;
  HG.timeScale = 1;
  HG.time = 0; HG.realTime = 0; HG.dt = 0; HG.realDt = 0; HG.frame = 0; HG.fps = 60;
  var pauseReasons = {};
  /** Pause the simulation. reason 'user' | 'visibility' show the pause menu; others ('trophy', 'cutscene', ...) just freeze. */
  HG.pause = function (reason) {
    reason = reason || 'user';
    if (HG.state !== 'hunt') return;
    var was = HG.paused;
    pauseReasons[reason] = true; HG.paused = true;
    HG.resetInput();
    if (reason === 'user' || reason === 'visibility') { HG.exitPointerLock(); if (!ui.isOpen('settings')) ui.show('pause'); }
    if (!was) HG.emit('pause', reason);
  };
  HG.resume = function (reason) {
    reason = reason || 'user';
    delete pauseReasons[reason];
    if (reason === 'user') delete pauseReasons.visibility;
    if (reason === 'user') { ui.hide('pause'); ui.hide('settings'); }
    if (Object.keys(pauseReasons).length) return;
    if (!HG.paused) return;
    HG.paused = false;
    ui.hide('pause');
    HG.emit('resume');
  };
  HG.pauseReasons = pauseReasons;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (HG.state === 'hunt') HG.pause('visibility'); HG.storeNow(); try { if (audio.ctx) audio.ctx.suspend(); } catch (e) {} }
    else { try { if (audio.ctx) audio.ctx.resume(); } catch (e) {} }
  });

  /** Start a hunt on mapId. Returns the session or null. */
  HG.startHunt = function (mapId) {
    mapId = mapId || HG.mapId || 'pine_valley';
    var map = HG.maps[mapId];
    if (!map) { ui.toast('Unknown map'); return null; }
    if (!HG.isMapUnlocked(mapId)) { ui.toast(map.name + ' is locked', { color: 'var(--danger)' }); return null; }
    ui.hideAll();
    HG.music.stop();
    trophyQueue.length = 0; trophyOpen = false; cardsPending = 0;
    for (var k in pauseReasons) delete pauseReasons[k];
    HG.paused = false; HG.timeScale = 1;
    if (HG.mapId !== mapId || HG._mapDirty) { HG.loadMap(mapId); HG._mapDirty = false; }
    else { HG.clearAnimals(); clearTrackDots(); clearProjectiles(); HG.particles.clear(); }
    HG.env.setHour(map.startHour != null ? map.startHour : HG.config.startHour);
    if (map.weather && HG.weatherTypes[map.weather]) HG.env.setWeather(map.weather);
    var sp = map.playerSpawn || { x: 0, z: terrain.size * 0.3, yaw: 0 };
    HG.placePlayer(sp.x, sp.z, sp.yaw || 0);
    player.health = player.maxHealth; player.stamina = 1; player.inVehicle = null; player.onStand = null; player.frozen = false;
    player.fovOverride = null; player.hideViewModel = false; player.hideCrosshair = false;
    HG.setCrouch(false); input.sprintToggle = false; input.aim = false; input.aimToggle = false;
    ui.setActionActive('aim', false); ui.setActionActive('sprint', false);
    HG.resetInput();
    // weapons: mags are filled from reserves at hunt start
    HG.weaponState = {};
    W.id = null; W.def = null;
    var lo = HG.getLoadout();
    if (lo.length) HG.switchWeapon(lo[0]);
    HG.session = { map: mapId, mapName: map.name, startTime: Date.now(), startGameTime: HG.time, kills: [], cashEarned: 0, xpEarned: 0 };
    HG.state = 'hunt';
    rootEl.classList.add('in-hunt');
    HG.save.stats.hunts++;
    HG.camera.fov = HG.settings.fov || HG.config.baseFov; HG.camera.updateProjectionMatrix(); lastFov = 0;
    // opening population: one group ahead so there is always something to stalk, then fill
    HG.spawnFromTable(70, 110, true);
    var cap = (map.maxAnimals || HG.config.maxAnimals);
    for (var i = 0; i < 12 && HG.animals.filter(function (a) { return !a.dead; }).length < cap * 0.7; i++) HG.spawnFromTable(60, 200, false);
    updatePlayer(0.016);
    HG.emit('huntStart', HG.session);
    ui.banner(map.name, map.tagline || 'Stay downwind. Move slow. Take the shot.');
    setTimeout(ui.rotateHint, 1200);
    HG.store();
    return HG.session;
  };
  /** End the current hunt. opts {downed:true} applies the knock-down penalty. Shows the summary screen. */
  HG.endHunt = function (opts) {
    if (HG.state !== 'hunt' || !HG.session) return null;
    opts = opts || {};
    var s = HG.session;
    var sum = { map: s.map, mapName: s.mapName, duration: Math.max(0, (Date.now() - s.startTime) / 1000), kills: s.kills.slice(), cashEarned: s.cashEarned, xpEarned: s.xpEarned, downed: !!opts.downed, lostCash: 0 };
    if (sum.downed) {
      sum.lostCash = Math.min(HG.save.cash, Math.round(s.cashEarned * HG.config.downedCashLoss));
      HG.save.cash -= sum.lostCash;
    }
    // unspent rounds go back into the reserve
    for (var id in HG.weaponState) { var def = HG.weaponTypes[id]; if (def && HG.weaponState[id].mag > 0) { HG.save.ammo[def.ammo] = (HG.save.ammo[def.ammo] || 0) + HG.weaponState[id].mag; HG.weaponState[id].mag = 0; } }
    HG.weaponState = {};
    trophyQueue.length = 0; trophyOpen = false; cardsPending = 0;
    setTimeout(ui.flushBanners, 400);
    for (var k in pauseReasons) delete pauseReasons[k];
    HG.paused = false; HG.timeScale = 1;
    HG.exitPointerLock(); HG.resetInput();
    ui.clearContext(); ui.setScope(false); rootEl.classList.remove('card-open');
    player.inVehicle = null; player.onStand = null; player.fovOverride = null;
    HG.state = 'summary';
    rootEl.classList.remove('in-hunt');
    HG.lastSummary = sum;
    HG.emit('huntEnd', sum);
    HG.session = null;
    HG.storeNow();
    showSummary(sum);
    return sum;
  };
  /** Go to the main menu (lodge). */
  HG.toMenu = function () {
    if (HG.state === 'hunt') { HG.endHunt(); }
    HG.state = 'menu';
    rootEl.classList.remove('in-hunt');
    ui.show('menu');
    if (!HG.mapId || !HG.maps[HG.mapId]) HG.loadMap(HG.maps.pine_valley ? 'pine_valley' : Object.keys(HG.maps)[0]);
    if (!HG.animals.some(function (a) { return !a.dead; })) menuAnimals();
    HG.music.play();
    HG.emit('menu');
  };
  function menuAnimals() {
    var map = HG.map; if (!map || !terrain.ready) return;
    var c = map.menuCamera || { x: 0, z: 0 };
    var types = (map.spawns || []).map(function (s) { return s.type; }).filter(function (t) { return HG.animalTypes[t]; });
    if (!types.length) return;
    for (var t = 0; t < 10; t++) {
      var x = c.x + (Math.random() - 0.5) * 30, z = c.z + (Math.random() - 0.5) * 30;
      if (goodGround(x, z)) { HG.spawnGroup(types[0], x, z, 3, {}); break; }
    }
  }
  var menuAng = 0;
  function updateMenuCamera(rdt) {
    if (!terrain.ready) return;
    var c = (HG.map && HG.map.menuCamera) || { x: 0, z: 0, r: 55, h: 16 };
    menuAng += rdt * 0.03;
    var r = c.r || 55, x = c.x + Math.cos(menuAng) * r, z = c.z + Math.sin(menuAng) * r;
    var y = Math.max(terrain.heightAt(x, z), terrain.waterLevel) + (c.h || 16);
    HG.camera.position.set(x, y, z);
    _v1.set(c.x, terrain.heightAt(c.x, c.z) + 3, c.z);
    HG.camera.lookAt(_v1);
    player.pos.set(c.x, terrain.heightAt(c.x, c.z), c.z + 200); // far from menu animals
    if (Math.abs(HG.camera.fov - 62) > 0.01) { HG.camera.fov = 62; HG.camera.updateProjectionMatrix(); }
  }

  /* ------------------------------------------------------------------
   * Main loop
   * ------------------------------------------------------------------ */
  var last = 0, fpsFrames = 0, fpsT = 0, cullT = 0, running = false;
  function frame(now) {
    requestAnimationFrame(frame);
    var raw = last ? Math.max(0, (now - last) / 1000) : 0.016;
    var rdt = Math.min(0.05, raw);
    last = now;
    fpsFrames++; fpsT += raw;
    if (fpsT >= 0.5) { HG.fps = Math.round(fpsFrames / fpsT); fpsFrames = 0; fpsT = 0; }
    simulate(rdt);
    // while paused behind an opaque menu, render at a reduced rate
    if (HG.paused && (HG.frame % 3)) return;
    render(rdt);
  }
  /** One simulation step (no rendering). rdt = real seconds (clamped 0.05). */
  function simulate(rdt) {
    HG.realDt = rdt; HG.realTime += rdt;
    HG.frame++;
    var dt = HG.paused ? 0 : rdt * HG.timeScale;
    HG.dt = dt;
    try {
      if (!HG.paused) {
        HG.time += dt;
        if (HG.state === 'hunt') HG.save.stats.playTime += rdt;
        pollInput();
        HG.emit('preUpdate', dt);
        if (HG.state === 'hunt') updatePlayer(dt); else updateMenuCamera(rdt);
        HG.env.update(dt);
        if (terrain.ready) {
          updateAnimals(dt);
          if (HG.state === 'hunt') updatePopulation(dt);
        }
        updateProjectiles(dt);
        updateParticles(dt);
        if (HG.state === 'hunt') updateWeapon(dt, rdt);
        HG.emit('update', dt);
      } else {
        input.lookX = input.lookY = 0; input.firePressed = false;
        HG.emit('pausedUpdate', rdt);
      }
      updateThreat(rdt);
      if (HG.state === 'hunt') updateHUD(rdt);
      followEnv(rdt);
      if (HG.state === 'hunt') G.updateGrass(player.pos.x, player.pos.z); else G.updateGrass(HG.camera.position.x, HG.camera.position.z);
      lodT -= rdt; if (lodT <= 0) { lodT = 0.2; G.updateLODs(HG.camera.position); }
      cullT -= rdt; if (cullT <= 0) { cullT = 0.25; updateChunkCulling(); }
    } catch (e) {
      console.error('[HG] frame error', e);
    }
  }
  var lodT = 0;
  function render(rdt) {
    renderer.info.reset();
    renderer.clear();
    renderer.render(HG.scene, HG.camera);
    if (HG.state === 'hunt' && HG.viewModel.visible && HG.viewModel.children.length > 1) {
      renderer.clearDepth();
      renderer.render(HG.viewScene, HG.viewCamera);
    }
    HG.emit('postRender', rdt);
  }

  /* ------------------------------------------------------------------
   * Debug API (automated tests). '#debug' in the URL sets HG.debugEnabled.
   * ------------------------------------------------------------------ */
  HG.debug = {
    god: false,
    /** spawn in front of the view: distance (m), angleDeg relative to view (+ = left). Returns the animal (stands broadside, idle). */
    spawnAnimal: function (type, distance, angleDeg, opts) {
      distance = distance == null ? 30 : distance; angleDeg = angleDeg || 0;
      var yaw = player.yaw + angleDeg * DEG, x = player.pos.x - Math.sin(yaw) * distance, z = player.pos.z - Math.cos(yaw) * distance;
      var half = terrain.size / 2 - 6; x = U.clamp(x, -half, half); z = U.clamp(z, -half, half);
      var o = { yaw: yaw + PI / 2, noCount: true, state: 'idle' };
      if (opts) for (var k in opts) o[k] = opts[k];
      var a = HG.spawnAnimal(type, { x: x, z: z }, o);
      if (a) { a.stateDur = 12; a.keep = true; }
      return a;
    },
    /** withRewards=false despawns every animal; true kills each (rewards + trophy cards). */
    killAll: function (withRewards) {
      if (withRewards) HG.animals.slice().forEach(function (a) { if (!a.dead) HG.killAnimal(a, 'vital'); });
      else HG.clearAnimals();
    },
    teleport: function (x, z, yaw) { HG.placePlayer(x, z, yaw == null ? player.yaw : yaw); updatePlayer(0.001); },
    setTime: function (h) { HG.env.setHour(h); },
    setWeather: function (id) { return HG.env.setWeather(id); },
    giveCash: function (n) { HG.addCash(n == null ? 10000 : n, 'debug'); },
    giveGold: function (n) { HG.addGold(n == null ? 100 : n, 'debug'); },
    setLevel: function (n) { n = U.clamp(Math.round(n), 1, HG.config.maxLevel); HG.save.level = n; HG.save.xp = HG.xpForLevel(n); HG.store(); HG.emit('levelUp', n); },
    unlockAll: function () {
      HG.debugUnlockAll = true;
      syncMapItems();
      HG.shop.items.forEach(function (it) { if (!it.consumable && HG.save.owned.indexOf(it.id) < 0) HG.save.owned.push(it.id); });
      Object.keys(HG.weaponTypes).forEach(function (id) { if (HG.save.owned.indexOf(id) < 0) HG.save.owned.push(id); });
      Object.keys(HG.maps).forEach(function (id) { if (HG.save.unlockedMaps.indexOf(id) < 0) HG.save.unlockedMaps.push(id); });
      HG.store(); HG.emit('unlockAll');
    },
    /** own + equip a weapon (by its slot) and switch to it if hunting */
    equip: function (id) {
      var w = HG.weaponTypes[id];
      if (HG.save.owned.indexOf(id) < 0) HG.save.owned.push(id);
      if (w) {
        HG.equip(w.slot === 'sidearm' ? 'sidearm' : 'weapon', id);
        if (HG.state === 'hunt') HG.switchWeapon(id);
        if ((HG.save.ammo[w.ammo] || 0) < 20) HG.save.ammo[w.ammo] = 50;
      } else { var it = HG.shop.get(id); if (it) HG.equip(HG.shop.equipSlot(it) || 'gear', id); }
      return !!w;
    },
    /** aim the camera at an animal's zone (default vital), compensating bullet drop for the held weapon */
    lookAt: function (a, zone) {
      if (!a) return false;
      var z = null, zones = a.def.hitZones || [];
      for (var i = 0; i < zones.length; i++) if (zones[i].name === (zone || 'vital')) { z = zones[i]; break; }
      a.root.updateMatrixWorld(true);
      if (z) HG.zoneWorld(a, z, _v1); else _v1.set(a.pos.x, a.pos.y + a.scale, a.pos.z);
      var cam = _v2.set(player.pos.x, player.pos.y + player.height, player.pos.z);
      var d = _v1.distanceTo(cam);
      var grav = W.def ? (wstat('gravity', 0) || 0) : 0, mv = W.def ? wstat('muzzleVelocity', 800) : 800;
      if (W.def && W.def.projectile === 'arrow' && wstat('gravity', null) == null) grav = HG.config.gravity;
      var tt = d / mv, drop = 0.5 * grav * tt * tt;
      _v1.y += drop;
      _v3.copy(_v1).sub(cam).normalize();
      player.yaw = Math.atan2(-_v3.x, -_v3.z); player.pitch = Math.asin(U.clamp(_v3.y, -1, 1));
      player.recoilPitch = 0; player.recoilYaw = 0;
      HG.camera.position.copy(cam); HG.camera.rotation.set(player.pitch, player.yaw, 0); HG.camera.updateMatrixWorld();
      return true;
    },
    /** aim at the zone and fire immediately (no spread, ignores cover). Returns HG.fire() result. */
    fireAt: function (a, zone) {
      if (!a || HG.state !== 'hunt') return null;
      if (!W.def) { var lo = HG.getLoadout(); if (lo.length) HG.switchWeapon(lo[0]); }
      HG.debug.lookAt(a, zone || 'vital');
      var st = weaponMag(W.id); if (st.mag <= 0) st.mag = 1;
      W.cooldown = 0; W.reloading = false; W.switchT = 0;
      HG.camera.getWorldDirection(_v4);
      return HG.fire({ debug: true, force: true, dir: _v4 });
    },
    listTypes: function () {
      return { animals: Object.keys(HG.animalTypes), weapons: Object.keys(HG.weaponTypes), ammo: Object.keys(HG.ammoTypes), maps: Object.keys(HG.maps),
        weather: Object.keys(HG.weatherTypes), sounds: Object.keys(HG.sounds), shop: HG.shop.items.map(function (i) { return i.id; }) };
    },
    fps: function () { return HG.fps; },
    /** Run the simulation synchronously for `seconds` of game time in steps of `step` (default 1/30 s), without rendering.
     *  Lets slow headless tests advance AI/physics deterministically. Renders one frame at the end. */
    advance: function (seconds, step) {
      step = step || 1 / 30;
      var n = Math.max(1, Math.round(seconds / step));
      for (var i = 0; i < n; i++) simulate(Math.min(0.05, step));
      render(step);
      return n;
    },
    /** compact state snapshot for tests */
    /** renderer stats for the last frame (draw calls incl. shadow + view-model passes) */
    renderInfo: function () { var i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, points: i.render.points, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : 0, pixelRatio: renderer.getPixelRatio(), level: HG.quality.level }; },
    snapshot: function () {
      return { state: HG.state, paused: HG.paused, screen: ui.current, map: HG.mapId, animals: HG.animals.length, alive: HG.animals.filter(function (a) { return !a.dead; }).length,
        player: { x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3), health: player.health },
        weapon: W.id, mag: W.id ? weaponMag(W.id).mag : 0, cash: HG.save.cash, gold: HG.save.gold, level: HG.save.level, xp: HG.save.xp, fps: HG.fps,
        kills: HG.session ? HG.session.kills.length : 0 };
    }
  };

  /* ------------------------------------------------------------------
   * Boot
   * ------------------------------------------------------------------ */
  /** Called once by main.js after all feature packs loaded. */
  HG.boot = function () {
    if (HG.booted) return;
    try {
      buildHUD();
      HG.applyGraphics();
      toggleFps();
      if (HG.debugEnabled) console.log('[HG] debug enabled');
      HG.state = 'menu';
      var first = HG.maps.pine_valley ? 'pine_valley' : Object.keys(HG.maps)[0];
      if (first) HG.loadMap(first);
      HG.env.apply();
      HG.emit('boot');
      HG.booted = true;
      HG.toMenu();
    } catch (e) {
      console.error('[HG] boot failed', e);
      HG.booted = true;
    }
    if (!running) { running = true; requestAnimationFrame(frame); }
  };

  /* =====================================================================
   * BASE CONTENT
   * ===================================================================== */

  /* ---------- sounds (synthesized) ---------- */
  function noiseBurst(ctx, dest, t, dur, type, f0, f1, peak, q) {
    var n = HG.audio.noiseSource(ctx), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type || 'lowpass'; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (q) f.Q.value = q;
    g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    n.connect(f); f.connect(g); g.connect(dest);
    n.start(t, Math.random() * 1); n.stop(t + dur + 0.02);
  }
  function tone(ctx, dest, t, type, f0, f1, dur, peak, attack) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + (attack || 0.005)); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  HG.audio.noiseBurst = noiseBurst; HG.audio.tone = tone;
  HG.sounds.shot_rifle = function (ctx, dest, o, t) {
    var k = o.freq || 1;
    noiseBurst(ctx, dest, t, 0.09, 'lowpass', 6000 * k, 900, 1.1);
    noiseBurst(ctx, dest, t + 0.01, 0.9, 'lowpass', 1400 * k, 120, 0.45);
    tone(ctx, dest, t, 'sine', 110 * k, 38, 0.35, 0.9);
    noiseBurst(ctx, dest, t + 0.18, 1.4, 'bandpass', 500 * k, 200, 0.12, 0.7); // valley echo
  };
  HG.sounds.reload = function (ctx, dest, o, t) {
    noiseBurst(ctx, dest, t + 0.05, 0.05, 'highpass', 2500, null, 0.35);
    tone(ctx, dest, t + 0.06, 'square', 900, 700, 0.05, 0.05);
    noiseBurst(ctx, dest, t + 0.45, 0.06, 'highpass', 1800, null, 0.4);
    noiseBurst(ctx, dest, t + 0.75, 0.05, 'highpass', 3000, null, 0.35);
    tone(ctx, dest, t + 0.76, 'square', 1300, 1100, 0.04, 0.04);
  };
  HG.sounds.equip = function (ctx, dest, o, t) { noiseBurst(ctx, dest, t, 0.05, 'highpass', 2200, null, 0.25); noiseBurst(ctx, dest, t + 0.12, 0.05, 'highpass', 3200, null, 0.2); };
  HG.sounds.empty = function (ctx, dest, o, t) { noiseBurst(ctx, dest, t, 0.03, 'highpass', 4000, null, 0.3); tone(ctx, dest, t, 'square', 1500, 1400, 0.03, 0.04); };
  HG.sounds.step = function (ctx, dest, o, t) { noiseBurst(ctx, dest, t, 0.09, 'lowpass', 700 + Math.random() * 500, 200, 0.22); noiseBurst(ctx, dest, t + 0.02, 0.06, 'bandpass', 2600 + Math.random() * 1500, null, 0.05, 1.2); };
  HG.sounds.splash = function (ctx, dest, o, t) { noiseBurst(ctx, dest, t, 0.25, 'bandpass', 1400, 500, 0.3, 0.8); };
  HG.sounds.hit = function (ctx, dest, o, t) { tone(ctx, dest, t, 'sine', 160, 55, 0.14, 0.6); noiseBurst(ctx, dest, t, 0.08, 'lowpass', 1200, 300, 0.3); };
  HG.sounds.rustle = function (ctx, dest, o, t) {
    var n = HG.audio.noiseSource(ctx), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = 2800; f.Q.value = 0.6;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.05); g.gain.linearRampToValueAtTime(0.0001, t + 0.5);
    lfo.frequency.value = 14; lg.gain.value = 0.06; lfo.connect(lg); lg.connect(g.gain);
    n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.55); lfo.start(t); lfo.stop(t + 0.55);
  };
  HG.sounds.deer_call = function (ctx, dest, o, t) {
    var osc = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(420, t); osc.frequency.linearRampToValueAtTime(340, t + 0.45);
    vib.frequency.value = 18; vg.gain.value = 9; vib.connect(vg); vg.connect(osc.frequency);
    f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 2.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.32, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(f); f.connect(g); g.connect(dest); osc.start(t); osc.stop(t + 0.52); vib.start(t); vib.stop(t + 0.52);
  };
  HG.sounds.deer_snort = function (ctx, dest, o, t) { noiseBurst(ctx, dest, t, 0.22, 'bandpass', 900, 500, 0.5, 1.4); noiseBurst(ctx, dest, t + 0.28, 0.16, 'bandpass', 800, 500, 0.3, 1.4); };
  HG.sounds.rabbit_squeak = function (ctx, dest, o, t) { tone(ctx, dest, t, 'sine', 2400, 1800, 0.08, 0.12); };
  HG.sounds.growl = function (ctx, dest, o, t) {
    var osc = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), am = ctx.createOscillator(), ag = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(o.freq || 78, t); osc.frequency.linearRampToValueAtTime((o.freq || 78) * 1.25, t + 0.5); osc.frequency.linearRampToValueAtTime((o.freq || 78) * 0.9, t + 1.1);
    f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 4;
    am.frequency.value = 22; ag.gain.value = 0.25; am.connect(ag); ag.connect(g.gain);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.12); g.gain.linearRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(f); f.connect(g); g.connect(dest); osc.start(t); osc.stop(t + 1.25); am.start(t); am.stop(t + 1.25);
    noiseBurst(ctx, dest, t, 1.0, 'lowpass', 400, 200, 0.15);
  };
  HG.sounds.hurt = function (ctx, dest, o, t) { tone(ctx, dest, t, 'sine', 90, 45, 0.3, 0.8); noiseBurst(ctx, dest, t, 0.2, 'lowpass', 900, 200, 0.5); };
  HG.sounds.ui = function (ctx, dest, o, t) { tone(ctx, dest, t, 'sine', 880, 700, 0.06, 0.08); };
  HG.sounds.deny = function (ctx, dest, o, t) { tone(ctx, dest, t, 'square', 180, 150, 0.16, 0.08); };
  HG.sounds.buy = function (ctx, dest, o, t) { tone(ctx, dest, t, 'triangle', 988, null, 0.12, 0.2); tone(ctx, dest, t + 0.09, 'triangle', 1319, null, 0.25, 0.2); noiseBurst(ctx, dest, t, 0.05, 'highpass', 6000, null, 0.08); };
  HG.sounds.kill = function (ctx, dest, o, t) { tone(ctx, dest, t + 0.05, 'triangle', 660, null, 0.3, 0.18); tone(ctx, dest, t + 0.15, 'triangle', 990, null, 0.45, 0.16); };
  HG.sounds.trophy = function (ctx, dest, o, t) { [523, 659, 784, 1047].forEach(function (f, i) { tone(ctx, dest, t + i * 0.09, 'triangle', f, null, 0.5, 0.16); }); };
  HG.sounds.levelup = function (ctx, dest, o, t) { [392, 523, 659, 784, 1047].forEach(function (f, i) { tone(ctx, dest, t + i * 0.08, 'square', f, null, 0.3, 0.06); tone(ctx, dest, t + i * 0.08, 'triangle', f, null, 0.4, 0.12); }); };

  /* ---------- outfit colours for first-person arms (gear/outfits may override) ---------- */
  /** {sleeve, cuff, glove} CSS colours (+ optional pattern:'woodland'|'leafy'|'digital'|'blaze'|..., palette:[...]) */
  HG.getOutfitColors = function () { return { sleeve: '#55613a', cuff: '#ff8a1f', glove: '#4a3424' }; };
  /** LEGACY low-poly arms (prepared geometries for HG.model.mesh). New view models should use HG.gfx.fpArms. */
  HG.model.arms = function (grip) {
    var c = HG.getOutfitColors(), g = [];
    var R = grip && grip.right || [0.035, -0.12, 0.1], L = grip && grip.left || [0, -0.1, -0.28];
    g.push(M.box(0.06, 0.08, 0.1, c.glove, { pos: R, rot: [0.2, 0, 0] }));
    g.push(M.box(0.085, 0.085, 0.3, c.sleeve, { pos: [R[0] + 0.07, R[1] - 0.08, R[2] + 0.18], rot: [0.5, 0.35, 0] }));
    g.push(M.box(0.09, 0.09, 0.04, c.cuff, { pos: [R[0] + 0.035, R[1] - 0.035, R[2] + 0.06], rot: [0.5, 0.35, 0] }));
    g.push(M.box(0.065, 0.06, 0.12, c.glove, { pos: L, rot: [0.1, 0, 0] }));
    g.push(M.box(0.085, 0.085, 0.36, c.sleeve, { pos: [L[0] + 0.06, L[1] - 0.12, L[2] + 0.2], rot: [0.75, 0.25, 0] }));
    g.push(M.box(0.09, 0.09, 0.04, c.cuff, { pos: [L[0] + 0.02, L[1] - 0.05, L[2] + 0.06], rot: [0.75, 0.25, 0] }));
    return g;
  };

  /* ---------- weapon: hunting rifle (bolt action, walnut + blued steel, 4x scope) ---------- */
  HG.ammoTypes.rifle_ammo = { name: '.308 Rifle Rounds', price: 40, pack: 10, color: '#d9a441', desc: 'Soft-point rounds for medium and large game.' };
  function sec(z, y, w, hu, hd, sq) { return { p: [0, y, z], w: w, hUp: hu, hDown: hd, sq: sq || 2.4 }; }
  function lathe(prof, y, radial, linear) { return G.loft(prof.map(function (q) { return { p: [0, y, q[0]], r: q[1] }; }), { radial: radial || 24, steps: linear ? 1 : 2, linear: !!linear, frame: 'up', capStart: false, capEnd: false, density: 40 }); }
  var rifleCache = {};
  function buildRifleParts() {
    var lowQ = G.isLow(), key = lowQ ? 'L' : 'H';
    if (rifleCache[key]) return rifleCache[key];
    var BORE = -0.05, out = {};
    // ---- wood: butt stock + wrist + forend (one loft), pistol grip (checkered) ----
    var stock = G.organicBody([
      sec(0.432, -0.101, 0.04, 0.036, 0.07, 3), sec(0.425, -0.1, 0.043, 0.038, 0.072, 3.2), sec(0.37, -0.096, 0.044, 0.037, 0.066, 3), sec(0.27, -0.089, 0.043, 0.033, 0.05, 2.8),
      sec(0.175, -0.079, 0.036, 0.025, 0.034, 2.5), sec(0.1, -0.071, 0.034, 0.022, 0.03, 2.5), sec(0.04, -0.065, 0.042, 0.022, 0.031, 2.8),
      sec(-0.06, -0.066, 0.045, 0.021, 0.034, 3), sec(-0.17, -0.064, 0.044, 0.019, 0.028, 2.8), sec(-0.29, -0.062, 0.041, 0.018, 0.024, 2.6), sec(-0.37, -0.062, 0.035, 0.016, 0.02, 2.4), sec(-0.385, -0.062, 0.022, 0.01, 0.012, 2.2)
    ], { radial: lowQ ? 16 : 30, steps: lowQ ? 2 : 4, smooth: 1, density: 1, uRepeat: 1, capBulge: 0.1 });
    // uv.v along the stock (1 repeat per metre) -> remap to texture length
    var grip = G.taperedLimb([{ p: [0, -0.078, 0.082], rx: 0.0165, rz: 0.022 }, { p: [0, -0.103, 0.101], rx: 0.016, rz: 0.023 }, { p: [0, -0.13, 0.12], rx: 0.0158, rz: 0.0235 }, { p: [0, -0.155, 0.137], rx: 0.0162, rz: 0.024 }, { p: [0, -0.163, 0.142], rx: 0.012, rz: 0.018 }],
      { radial: lowQ ? 12 : 20, steps: lowQ ? 2 : 3, n: [0, 0.6, -1], density: 6, capStart: false, capBulge: 0.3 });
    var wood = TX.woodGrain({ base: '#7a4524', dark: '#3a1d0d', light: '#a8653a', figure: 0.6, rings: 30, seed: 5 });
    var gripTex = TX.woodGrain({ base: '#7a4524', dark: '#3a1d0d', light: '#a8653a', figure: 0.6, rings: 30, seed: 6, checker: [{ x: 0.08, y: 0.12, w: 0.34, h: 0.72 }, { x: 0.58, y: 0.12, w: 0.34, h: 0.72 }] });
    G.vertexAO(stock, { cells: 12, strength: 0.4, min: 0.7 });
    var recoilPad = G.organicBody([sec(0.445, -0.101, 0.04, 0.036, 0.07, 3.2), sec(0.452, -0.1, 0.039, 0.035, 0.069, 3.2), sec(0.46, -0.1, 0.034, 0.03, 0.063, 3)], { radial: 24, steps: 2, density: 20, capBulge: 0.05 });
    G.tint(recoilPad, '#1d1c1a');
    out.wood = { geo: stock, mat: G.mat({ map: wood, normalMap: lowQ ? null : TX.normalOf(wood, 1.2), normalScale: 0.4, roughness: 0.42, vertexColors: true, key: 'rifleWood' }) };
    out.grip = { geo: grip, mat: G.mat({ map: gripTex, normalMap: lowQ ? null : TX.normalOf(gripTex, 3), normalScale: 0.9, roughness: 0.55, key: 'rifleGrip' }) };
    // ---- blued steel: receiver, barrel, bolt shroud, trigger guard, floorplate, scope bases, sling studs ----
    var steel = [];
    steel.push(lathe([[0.108, 0.0], [0.104, 0.009], [0.098, 0.0125], [0.075, 0.0128], [0.073, 0.0166], [-0.11, 0.0166], [-0.116, 0.0158], [-0.122, 0.0138]], BORE, lowQ ? 14 : 24, true));
    steel.push(lathe([[-0.12, 0.0138], [-0.2, 0.0128], [-0.45, 0.0112], [-0.69, 0.0093], [-0.715, 0.0093], [-0.72, 0.0084], [-0.7205, 0.0035]], BORE, lowQ ? 12 : 20, true));
    steel.push(G.tube([[0, -0.072, 0.012], [0, -0.108, 0.014], [0, -0.115, 0.046], [0, -0.104, 0.077], [0, -0.079, 0.08]], 0.0034, { radial: 8, steps: 4, sq: 3 }));
    steel.push(G.tube([[0, -0.074, 0.04], [0, -0.09, 0.041], [0, -0.1, 0.047]], [0.0034, 0.0028, 0.0024], { radial: 8, steps: 3 }));
    steel.push(G.organicBody([sec(0.01, -0.0995, 0.026, 0.004, 0.0035, 4), sec(-0.04, -0.1015, 0.028, 0.004, 0.004, 4), sec(-0.085, -0.0985, 0.024, 0.004, 0.0035, 4)], { radial: 12, steps: 2, density: 30 }));
    [-0.095, 0.03].forEach(function (z) {
      steel.push(lathe([[z + 0.007, 0.0128], [z + 0.006, 0.0152], [z - 0.006, 0.0152], [z - 0.007, 0.0128]], 0, lowQ ? 14 : 24, true));
      steel.push(G.organicBody([sec(z + 0.006, -0.026, 0.016, 0.01, 0.01, 6), sec(z - 0.006, -0.026, 0.016, 0.01, 0.01, 6)], { radial: 12, steps: 1, density: 30 }));
    });
    steel.push(G.tube([[0, -0.098, -0.3], [0, -0.087, -0.3]], 0.004, { radial: 8 })); steel.push(G.tube([[0, -0.165, 0.4], [0, -0.17, 0.39]], 0.004, { radial: 8 }));
    // ejection port (dark recess)
    var port = G.organicBody([sec(-0.005, BORE + 0.004, 0.034, 0.0095, 0.0095, 5), sec(-0.07, BORE + 0.004, 0.034, 0.0095, 0.0095, 5)], { radial: 16, steps: 1, density: 30 });
    G.paint(port, function (c, x) { c.set(x > 0.005 ? '#0d0e10' : '#30353f'); });
    steel.push(port);
    var steelGeo = G.merge(steel); G.ensureColor(steelGeo);
    G.vertexAO(steelGeo, { cells: 14, strength: 0.35, min: 0.7 });
    var blued = TX.metal('blued');
    out.steel = { geo: steelGeo, mat: G.mat({ map: blued, normalMap: null, roughness: 0.32, metalness: 0.88, vertexColors: true, envMapIntensity: 1.3, key: 'blued' }) };
    // ---- scope: matte black anodised tube, turrets, lenses ----
    var scope = [lathe([[0.121, 0.0188], [0.118, 0.0207], [0.09, 0.0207], [0.084, 0.0196], [0.07, 0.0192], [0.048, 0.0136], [0.035, 0.0127], [-0.025, 0.0127], [-0.028, 0.0158], [-0.078, 0.0158], [-0.081, 0.0127], [-0.132, 0.0127], [-0.168, 0.0195], [-0.196, 0.0242], [-0.234, 0.0242], [-0.238, 0.0228]], 0, lowQ ? 16 : 32, true)];
    scope.push(lathe([[0.121, 0.0188], [0.119, 0.0172], [0.11, 0.016]], 0, 24, true));
    scope.push(lathe([[-0.238, 0.0228], [-0.236, 0.021], [-0.229, 0.0205]], 0, 24, true));
    scope.push(G.tube([[0, 0.0145, -0.053], [0, 0.0235, -0.053], [0, 0.0315, -0.053]], [0.0105, 0.0112, 0.0112], { radial: lowQ ? 12 : 22, steps: 1, linear: true, capEnd: true, capBulge: 0.05 }));
    scope.push(G.tube([[0.0145, 0, -0.053], [0.0235, 0, -0.053], [0.0315, 0, -0.053]], [0.0105, 0.0112, 0.0112], { radial: lowQ ? 12 : 22, steps: 1, linear: true, capEnd: true, capBulge: 0.05 }));
    scope.push(G.tube([[-0.0145, 0.003, -0.05], [-0.022, 0.003, -0.05]], [0.0072, 0.0072], { radial: 14, steps: 1, linear: true, capEnd: true, capBulge: 0.05 }));
    var scopeGeo = G.merge(scope); G.ensureColor(scopeGeo);
    G.paint(scopeGeo, function (c, x, y, z) { c.set(z < -0.227 || z > 0.112 ? '#b0a58a' : '#ffffff'); if (z > 0.088 && z < 0.12 && Math.sqrt(x * x + y * y) > 0.0195) c.set('#5a5a5a'); });
    var blk = TX.metal('black');
    out.scope = { geo: scopeGeo, mat: G.mat({ map: blk, roughness: 0.48, metalness: 0.5, vertexColors: true, envMapIntensity: 1.1, key: 'scopeBlack' }) };
    var lens = G.merge([(function () { var d = new THREE.CircleGeometry(0.0176, 24); d.rotateY(0); d.translate(0, 0, 0.113); return d; })(), (function () { var d = new THREE.CircleGeometry(0.0206, 24); d.rotateY(Math.PI); d.translate(0, 0, -0.229); return d; })()]);
    out.lens = { geo: lens, mat: G.mat({ color: '#1d3340', roughness: 0.04, metalness: 0.95, emissive: '#081218', envMapIntensity: 2.2, key: 'scopeLens' }) };
    // ---- bolt (moves): body + handle + knob, origin on the bore axis ----
    var bolt = [lathe([[0.12, 0.0], [0.116, 0.0098], [0.07, 0.0098], [-0.06, 0.0092]], 0, lowQ ? 12 : 20, true)];
    bolt.push(G.tube([[0.008, 0, 0.062], [0.03, -0.005, 0.066], [0.043, -0.017, 0.07], [0.047, -0.022, 0.071]], [0.0042, 0.004, 0.0037, 0.0036], { radial: 10, steps: 3 }));
    var knob = new THREE.SphereGeometry(0.0088, 18, 14); knob.scale(1, 1.05, 1.15); knob.translate(0.049, -0.026, 0.072); bolt.push(knob);
    var boltGeo = G.merge(bolt); G.ensureColor(boltGeo);
    out.bolt = { geo: boltGeo, mat: out.steel.mat, matBright: G.mat({ map: TX.metal('stainless'), roughness: 0.25, metalness: 0.95, envMapIntensity: 1.4, key: 'boltSteel' }) };
    var brass = new THREE.CylinderGeometry(0.0059, 0.006, 0.07, 12); brass.rotateX(Math.PI / 2);
    out.brass = { geo: brass, mat: G.mat({ color: '#c9a04e', roughness: 0.3, metalness: 1, envMapIntensity: 1.5, key: 'brass' }) };
    for (var k in out) out[k].geo.userData.shared = true;
    rifleCache[key] = out;
    return out;
  }
  HG.weaponTypes.hunting_rifle = {
    name: 'Hunting Rifle', desc: 'Reliable bolt-action with a 4x scope. Your first trophy-taker.',
    slot: 'primary', ammo: 'rifle_ammo', price: 0, levelReq: 1,
    damage: 95, pellets: 1, spread: 0.035, fireDelay: 1.15, magSize: 5, reloadTime: 2.4, range: 320,
    zoom: 22, scope: true, projectile: 'hitscan', muzzleVelocity: 820, gravity: 5, noise: 1, recoil: 0.07,
    sound: { type: 'rifle', freq: 1 },
    hipPos: [0.19, -0.2, -0.46], aimPos: [0, -0.002, -0.3],
    iconColors: { wood: '#7a4524', metal: '#2b3240', scope: '#1b1d20' },
    stats: { Damage: 0.7, Range: 0.75, Stability: 0.55, 'Fire rate': 0.2 },
    buildViewModel: function () {
      var P = buildRifleParts(), grp = new THREE.Group();
      ['wood', 'grip', 'steel', 'scope', 'lens'].forEach(function (k) { var m = new THREE.Mesh(P[k].geo, P[k].mat); grp.add(m); });
      var bolt = new THREE.Group(); bolt.position.set(0, -0.05, 0);
      var bm = new THREE.Mesh(P.bolt.geo, P.bolt.matBright); bolt.add(bm); grp.add(bolt);
      var shell = new THREE.Mesh(P.brass.geo, P.brass.mat); shell.visible = false; grp.add(shell);
      var arms = G.fpArms({
        right: { pos: [0.033, -0.107, 0.152], basis: [[0, -0.84, 0.54], [1, 0, 0]], pose: 'trigger', arm: [0.32, -0.42, 0.85], armLen: 0.36 },
        left: { pos: [-0.058, -0.103, -0.215], basis: [[0, 0.08, -1], [-0.1, -1, 0]], pose: 'support', arm: [-0.42, -0.5, 0.76], armLen: 0.42 }
      });
      grp.add(arms);
      grp.userData.muzzle = { x: 0, y: -0.05, z: -0.735 };
      var leftHand = arms.userData.left, lh0 = leftHand ? leftHand.position.clone() : null, lq0 = leftHand ? leftHand.quaternion.clone() : null;
      var sh = { t: -1, v: new THREE.Vector3(), lastShot: -9 }, tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
      // bolt cycle after a shot + reload: open bolt, feed rounds, close
      grp.userData.animate = function (w, dt) {
        var since = HG.time - w.lastShot, cyc = Math.min(1.05, HG.weaponStat(w.def, 'fireDelay') || 1.15), lift = 0, pull = 0;
        if (since >= 0 && since < cyc) {
          var t = since / cyc;
          lift = U.smooth(0.18, 0.32, t) * (1 - U.smooth(0.78, 0.92, t));
          pull = U.smooth(0.34, 0.5, t) * (1 - U.smooth(0.56, 0.74, t));
          if (t > 0.45 && sh.lastShot !== w.lastShot) { sh.lastShot = w.lastShot; sh.t = 0; shell.position.set(0.015, -0.045, -0.04); sh.v.set(0.9 + Math.random() * 0.3, 0.7, 0.15); shell.visible = true; }
        }
        if (w.reloading) {
          var rp = 1 - w.reloadT / w.reloadDur;
          lift = Math.max(lift, U.smooth(0.0, 0.12, rp) * (1 - U.smooth(0.86, 0.96, rp)));
          pull = Math.max(pull, U.smooth(0.1, 0.2, rp) * (1 - U.smooth(0.76, 0.86, rp)));
          if (leftHand) {
            var feed = U.smooth(0.18, 0.3, rp) * (1 - U.smooth(0.66, 0.78, rp)), bob = Math.sin(rp * Math.PI * 8) * 0.012 * feed;
            leftHand.position.set(lh0.x + (0.06 - lh0.x) * feed, lh0.y + (-0.03 - lh0.y) * feed + bob, lh0.z + (0.0 - lh0.z) * feed);
            tmpE.set(-0.6 * feed, 0.4 * feed, 0.9 * feed); tmpQ.setFromEuler(tmpE); leftHand.quaternion.copy(lq0).multiply(tmpQ);
          }
        } else if (leftHand) { leftHand.position.copy(lh0); leftHand.quaternion.copy(lq0); }
        bolt.rotation.z = lift * 1.05;
        bolt.position.z = pull * 0.085;
        if (sh.t >= 0) {
          sh.t += dt; sh.v.y -= 6 * dt; shell.position.addScaledVector(sh.v, dt); shell.rotation.x += dt * 14; shell.rotation.y += dt * 9;
          if (sh.t > 0.6) { sh.t = -1; shell.visible = false; }
        }
      };
      return grp;
    }
  };
  HG.shop.addWeapon('hunting_rifle');
  HG.shop.addAmmo('rifle_ammo', 1);
  HG.shop.addAmmo('rifle_ammo', 3, { desc: 'Bulk box of 30 rounds — 15% cheaper.' });
  HG.shop.add({ id: 'gold_exchange', category: 'upgrades', name: 'Gold to Cash', desc: 'Trade 5 gold for $750 at the trading post.', price: 5, currency: 'gold', consumable: true,
    icon: function (ctx, w, h) { ui.draw.coin(ctx, w * 0.6, h, true); ctx.translate(w * 0.4, 0); ui.draw.coin(ctx, w * 0.6, h, false); },
    onBuy: function () { HG.addCash(750, 'exchange'); } });

  /* ---------- animals ---------- */
  function deerIcon(ctx, w, h) {
    ctx.save(); ctx.translate(w / 2, h / 2 + 6); var s = Math.min(w / 120, h / 84); ctx.scale(s, s);
    var g = ctx.createLinearGradient(0, -40, 0, 30); g.addColorStop(0, '#9a7656'); g.addColorStop(1, '#c9a882');
    ctx.fillStyle = g; ctx.strokeStyle = '#efe2c6'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(34, -6); ctx.bezierCurveTo(30, -16, 0, -16, -20, -14); ctx.bezierCurveTo(-26, -20, -30, -34, -34, -42); ctx.lineTo(-44, -42); ctx.lineTo(-52, -36); ctx.lineTo(-46, -32);
    ctx.bezierCurveTo(-42, -28, -40, -16, -34, -2); ctx.lineTo(-30, 10); ctx.lineTo(-29, 30); ctx.lineTo(-26, 30); ctx.lineTo(-24, 10); ctx.lineTo(-18, 6); ctx.lineTo(-16, 30); ctx.lineTo(-13, 30); ctx.lineTo(-12, 6);
    ctx.bezierCurveTo(0, 8, 14, 8, 20, 4); ctx.lineTo(22, 30); ctx.lineTo(25, 30); ctx.lineTo(27, 8); ctx.lineTo(30, 30); ctx.lineTo(33, 30); ctx.lineTo(34, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(36, -8, 4, 7, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ede0c4'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-38, -42); ctx.quadraticCurveTo(-28, -62, -14, -58); ctx.moveTo(-31, -54); ctx.lineTo(-30, -64); ctx.moveTo(-22, -58); ctx.lineTo(-21, -68); ctx.stroke();
    ctx.restore();
  }
  function rabbitIcon(ctx, w, h) {
    ctx.save(); ctx.translate(w / 2, h / 2 + 8); var s = Math.min(w / 100, h / 70); ctx.scale(s, s);
    ctx.fillStyle = '#a8957c';
    ctx.beginPath(); ctx.ellipse(6, 4, 22, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-16, -8, 11, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-14, -30, 4, 14, 0.15, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(-6, -28, 4, 14, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(28, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function leg(unused, color, hoof, len, r0, r1) {
    // LEGACY: low-poly leg hanging down from the pivot (y=0 .. -len)
    return [
      M.cyl(r0, r0 * 0.75, len * 0.55, 5, color, { pos: [0, -len * 0.27, 0] }),
      M.cyl(r1, r1, len * 0.45, 5, color, { pos: [0, -len * 0.75, 0.02] }),
      M.box(r1 * 2.2, len * 0.07, r1 * 2.6, hoof, { pos: [0, -len + 0.03, -0.01] })
    ];
  }
  HG.makeLeg = leg;
  var COAT_TINTS = ['#ffffff', '#f1ebe3', '#fff6ea', '#e8e4e0'];
  HG.animalTypes.whitetail_deer = {
    name: 'Whitetail Deer', rarity: 'common', baseCash: 140, xp: 45, weightRange: [45, 110], size: 1, hp: 100,
    speed: { walk: 1.5, run: 9.5 }, senses: { sight: 75, hearing: 60, smell: 95 }, temperament: 'skittish', group: [1, 4],
    habitats: ['pine_valley'], activeAt: 'any', gait: 'walk', stride: 2.4, grazePitch: -1.35, alertPitch: 0.3, tailLift: -2.3, radius: 0.45,
    furColor: 0x8a6a4c, sounds: { alert: 'deer_snort', flee: 'deer_snort' }, icon: deerIcon,
    hitZones: [
      { name: 'head', part: 'head', offset: new THREE.Vector3(0, -0.05, -0.12), radius: 0.12, mult: 3 },
      { name: 'vital', offset: new THREE.Vector3(0, 0.74, -0.3), radius: 0.18, mult: 2.5 },
      { name: 'body', offset: new THREE.Vector3(0, 0.8, 0.12), radius: 0.4, mult: 1 },
      { name: 'body', part: 'neck', offset: new THREE.Vector3(0, 0.18, -0.12), radius: 0.14, mult: 1 },
      { name: 'leg', offset: new THREE.Vector3(0.11, 0.35, -0.36), radius: 0.09, mult: 0.5 },
      { name: 'leg', offset: new THREE.Vector3(-0.11, 0.35, -0.36), radius: 0.09, mult: 0.5 },
      { name: 'leg', offset: new THREE.Vector3(0.11, 0.38, 0.45), radius: 0.1, mult: 0.5 },
      { name: 'leg', offset: new THREE.Vector3(-0.11, 0.38, 0.45), radius: 0.1, mult: 0.5 }
    ],
    buildMesh: function (opts) {
      var buck = (opts && opts.legendary) || (opts && opts.buck) || (!(opts && opts.doe) && Math.random() < 0.5);
      var tpl = G.quadruped(deerSpec(buck));
      var tines = opts && opts.legendary ? 4 : 2 + Math.floor(Math.random() * 2.2);
      var parts = G.spawnQuadruped(tpl, { tint: COAT_TINTS[Math.floor(Math.random() * COAT_TINTS.length)], variant: buck ? Math.min(4, tines) : null });
      parts.buck = buck;
      return parts;
    }
  };
  HG.animalTypes.rabbit = {
    name: 'Cottontail Rabbit', rarity: 'common', baseCash: 30, xp: 14, weightRange: [1.1, 2.4], size: 1, hp: 25,
    speed: { walk: 0.9, run: 7.5 }, senses: { sight: 32, hearing: 34, smell: 24 }, temperament: 'skittish', group: [1, 2],
    habitats: ['pine_valley'], activeAt: 'any', gait: 'hop', stride: 4.5, grazePitch: -0.5, alertPitch: 0.25, tailLift: -0.6, radius: 0.15,
    furColor: 0x9a8670, sounds: { alert: 'rabbit_squeak' }, icon: rabbitIcon,
    hitZones: [
      { name: 'head', part: 'head', offset: new THREE.Vector3(0, -0.005, -0.04), radius: 0.05, mult: 3 },
      { name: 'vital', offset: new THREE.Vector3(0, 0.13, -0.06), radius: 0.07, mult: 2 },
      { name: 'body', offset: new THREE.Vector3(0, 0.14, 0.04), radius: 0.11, mult: 1 },
      { name: 'leg', offset: new THREE.Vector3(0, 0.05, 0.06), radius: 0.05, mult: 0.6 }
    ],
    buildMesh: function () {
      return G.spawnQuadruped(G.quadruped(rabbitSpec()), { tint: COAT_TINTS[Math.floor(Math.random() * 3)] });
    }
  };

  /* ---------- map: Pine Valley ---------- */
  function pvHeight(x, z) {
    var h = 7 * Math.sin(x * 0.011 + 0.5) * Math.cos(z * 0.013 + 1.1) + 3.2 * Math.sin(x * 0.029 + z * 0.017) +
      1.4 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.064) + 0.45 * U.noise2(x * 0.15, z * 0.15);
    var dx = x - 60, dz = z + 45, d = Math.sqrt(dx * dx * 0.6 + dz * dz);
    var k = U.smooth(72, 20, d);
    h = h * (1 - k) + (-5 - (1 - d / 72) * 2) * k;
    var r = Math.max(Math.abs(x), Math.abs(z));
    h += Math.pow(Math.max(0, r - 150) / 60, 2) * 16;
    var ds = U.dist2D(x, z, 0, 150); h = U.lerp(h, 3, U.smooth(40, 8, ds) * 0.6); // gentle spawn meadow
    return h + 2;
  }
  // LEGACY low-poly flora factories (prepared vertex-coloured geometry). New content: HG.gfx.trees / HG.gfx.plant / HG.gfx.rock
  function pineGeo(rng, v) {
    var greens = [['#2c5631', '#356538', '#3f7340'], ['#3a6a38', '#447a3f', '#518a49'], ['#456f35', '#4f7d3c', '#5c8c45']][v % 3];
    var tiers = v === 0 ? 4 : 3, H = v === 2 ? 5.5 : v === 1 ? 10 : 8.5, w = v === 1 ? 2.2 : 2.7;
    var g = [M.cyl(0.18, 0.3, H * 0.35, 5, '#5b3f2a', { pos: [0, H * 0.17, 0] })];
    for (var i = 0; i < tiers; i++) { var t = i / tiers, r = w * (1 - t * 0.62), hh = H * 0.42; g.push(M.cone(r, hh, 7, greens[i % 3], { pos: [0, H * 0.28 + i * H * 0.2 + hh / 2, 0], rot: [0, rng() * 3, 0], jitter: 0.1, rng: rng })); }
    return M.merge(g);
  }
  function aspenGeo(rng) {
    var g = [M.cyl(0.12, 0.18, 4.2, 5, '#e9e4d6', { pos: [0, 2.1, 0] }), M.box(0.25, 0.1, 0.02, '#3d3a34', { pos: [0, 1.4, 0.15] }), M.box(0.2, 0.08, 0.02, '#3d3a34', { pos: [0.1, 2.5, -0.14], rot: [0, 1.2, 0] })];
    var cols = ['#b9c45a', '#9fb84c', '#d5b544'];
    for (var i = 0; i < 4; i++) g.push(M.ico(1.0 + rng() * 0.5, 0, cols[i % 3], { pos: [(rng() - 0.5) * 1.2, 4.3 + rng() * 1.6, (rng() - 0.5) * 1.2], jitter: 0.12, rng: rng }));
    return M.merge(g);
  }
  function bushGeo(rng, v) {
    var c = ['#4b7a33', '#5a8a3a', '#6d8f3d'][v % 3], g = [];
    for (var i = 0; i < 4; i++) g.push(M.ico(0.45 + rng() * 0.3, 0, c, { pos: [(rng() - 0.5) * 0.9, 0.35 + rng() * 0.25, (rng() - 0.5) * 0.9], jitter: 0.15, rng: rng }));
    if (v === 2) for (var j = 0; j < 5; j++) g.push(M.ico(0.07, 0, '#c43d3d', { pos: [(rng() - 0.5) * 1.0, 0.5 + rng() * 0.4, (rng() - 0.5) * 1.0] }));
    return M.merge(g);
  }
  function rockGeo(rng, v) {
    var c = ['#8b8c86', '#7c7e78', '#9a978c'][v % 3];
    var g = [M.dodeca(0.9, c, { scale: [1.2, 0.65, 1], jitter: 0.12, rng: rng })];
    if (v === 1) g.push(M.dodeca(0.5, c, { pos: [0.8, -0.05, 0.3], scale: [1, 0.7, 1], jitter: 0.12, rng: rng }));
    return M.merge(g);
  }
  function grassGeo(rng, v) {
    var c = ['#7aa045', '#8db04f', '#6b9440'][v % 3], g = [];
    for (var i = 0; i < 5; i++) g.push(M.cone(0.05, 0.45 + rng() * 0.3, 3, c, { open: true, pos: [(rng() - 0.5) * 0.35, 0.22, (rng() - 0.5) * 0.35], rot: [(rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5] }));
    return M.merge(g);
  }
  function flowerGeo(rng, v) {
    var c = ['#f2d45c', '#f4f1ea', '#b48ad6'][v % 3], g = [];
    for (var i = 0; i < 4; i++) { var x = (rng() - 0.5) * 0.5, z = (rng() - 0.5) * 0.5; g.push(M.cyl(0.008, 0.008, 0.3, 3, '#5f8a3a', { pos: [x, 0.15, z] })); g.push(M.ico(0.045, 0, c, { pos: [x, 0.31, z] })); }
    return M.merge(g);
  }
  function reedGeo(rng) {
    var g = [];
    for (var i = 0; i < 6; i++) { var x = (rng() - 0.5) * 0.6, z = (rng() - 0.5) * 0.6, h = 0.9 + rng() * 0.7; g.push(M.cyl(0.012, 0.02, h, 3, '#7d8c45', { pos: [x, h / 2, z] })); if (rng() < 0.5) g.push(M.cyl(0.03, 0.03, 0.18, 4, '#6b4630', { pos: [x, h + 0.05, z] })); }
    return M.merge(g);
  }
  HG.flora = { pine: pineGeo, aspen: aspenGeo, bush: bushGeo, rock: rockGeo, grass: grassGeo, flower: flowerGeo, reed: reedGeo };

  /** Log cabin landmark (textured logs, shingle roof, stone chimney, porch, glowing window at night). */
  G.buildCabin = function (ctx, cx, cz, rotY) {
    var cy = ctx.heightAt(cx, cz), W = 6.2, D = 4.6, logR = 0.15, courses = 9, logs = [], planks = [], stone = [], roof = [], glass = [];
    function log(x0, z0, x1, z1, y, r) {
      var g = G.tube([[x0, y, z0], [(x0 + x1) / 2, y + 0.01, (z0 + z1) / 2], [x1, y, z1]], [r, r * 1.02, r * 0.98], { radial: 9, steps: 1, density: 1.2, capStart: true, capEnd: true, capBulge: 0.1 });
      G.paint(g, function (c, x, yy, z, nx, ny, nz) { c.setRGB(1, 1, 1).multiplyScalar(0.85 + 0.15 * ny); }); logs.push(g);
    }
    for (var i = 0; i < courses; i++) {
      var y = 0.12 + i * logR * 1.75, ext = 0.35;
      if (i % 2 === 0) {
        if (i < 6) { log(-W / 2 - ext, -D / 2, -0.55, -D / 2, y, logR); log(0.45, -D / 2, W / 2 + ext, -D / 2, y, logR); } else log(-W / 2 - ext, -D / 2, W / 2 + ext, -D / 2, y, logR);
        log(-W / 2 - ext, D / 2, W / 2 + ext, D / 2, y, logR);
      } else {
        if (i >= 2 && i <= 5) { log(-W / 2, -D / 2 - ext, -W / 2, -0.5, y, logR); log(-W / 2, 0.5, -W / 2, D / 2 + ext, y, logR); } else log(-W / 2, -D / 2 - ext, -W / 2, D / 2 + ext, y, logR);
        log(W / 2, -D / 2 - ext, W / 2, D / 2 + ext, y, logR);
      }
    }
    var wallTop = 0.12 + courses * logR * 1.75, ridge = wallTop + 1.9;
    // gables (planks) + door + shutters
    [-1, 1].forEach(function (sd) {
      var g = new THREE.BufferGeometry(), x = sd * W / 2;
      g.setAttribute('position', new THREE.Float32BufferAttribute([x, wallTop - 0.1, -D / 2 - 0.05, x, wallTop - 0.1, D / 2 + 0.05, x, ridge, 0], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2.4, 0, 1.2, 1], 2)); g.computeVertexNormals();
      planks.push(g);
    });
    var dg = new THREE.PlaneGeometry(0.95, 2.0); dg.rotateY(Math.PI); dg.translate(-0.05, 1.1, -D / 2 - 0.12); planks.push(dg);
    var g2 = new THREE.PlaneGeometry(0.9, 0.7); g2.rotateY(-Math.PI / 2); g2.translate(-W / 2 - 0.13, 1.5, 0); glass.push(g2);
    var frame = new THREE.PlaneGeometry(1.1, 0.85); frame.rotateY(-Math.PI / 2); frame.translate(-W / 2 - 0.125, 1.5, 0); planks.push(frame);
    // roof slabs
    [-1, 1].forEach(function (sd) {
      var rw = Math.sqrt((D / 2 + 0.6) * (D / 2 + 0.6) + 1.9 * 1.9);
      var g = new THREE.BoxGeometry(W + 1.2, 0.12, rw); var a = Math.atan2(1.9, D / 2 + 0.6);
      g.translate(0, 0, sd * rw / 2); g.rotateX(sd * a); g.translate(0, ridge + 0.08, 0);
      var uv = g.attributes.uv; for (var q = 0; q < uv.count; q++) uv.setXY(q, uv.getX(q) * 3, uv.getY(q) * 2);
      roof.push(g);
    });
    var rc = G.tube([[-W / 2 - 0.6, ridge + 0.14, 0], [W / 2 + 0.6, ridge + 0.14, 0]], 0.1, { radial: 8, steps: 1, density: 1 }); logs.push(rc);
    // chimney
    var ch = new THREE.BoxGeometry(0.7, ridge + 1.2, 0.7); ch.translate(W / 2 - 1.2, (ridge + 1.2) / 2, D / 4);
    var uvc = ch.attributes.uv; for (var u2 = 0; u2 < uvc.count; u2++) uvc.setXY(u2, uvc.getX(u2) * 0.7, uvc.getY(u2) * (ridge + 1.2) / 1.2);
    stone.push(ch);
    var cap = new THREE.BoxGeometry(0.85, 0.12, 0.85); cap.translate(W / 2 - 1.2, ridge + 1.25, D / 4); stone.push(cap);
    // porch floor + posts
    var porch = new THREE.BoxGeometry(W + 0.4, 0.1, 1.6); porch.translate(0, 0.08, -D / 2 - 0.85); planks.push(porch);
    [-W / 2, W / 2].forEach(function (x) { logs.push(G.tube([[x, 0.1, -D / 2 - 1.5], [x, wallTop, -D / 2 - 1.5]], 0.09, { radial: 8, steps: 1, density: 1 })); });
    var porchRoof = new THREE.BoxGeometry(W + 0.6, 0.08, 1.9); porchRoof.rotateX(-0.18); porchRoof.translate(0, wallTop + 0.15, -D / 2 - 0.9); roof.push(porchRoof);
    // foundation stones
    for (var f = 0; f < 10; f++) { var fx = -W / 2 + f * W / 9; var fs = new THREE.BoxGeometry(0.45, 0.3, 0.45); fs.translate(fx, -0.02, -D / 2); stone.push(fs); var fs2 = fs.clone(); fs2.translate(0, 0, D); stone.push(fs2); }
    var root = new THREE.Group(); root.position.set(cx, cy, cz); root.rotation.y = rotY || 0;
    function addM(list, mat, shadow) { if (!list.length) return; var m = new THREE.Mesh(G.merge(list), mat); m.castShadow = !!shadow; m.receiveShadow = true; root.add(m); return m; }
    var logTex = TX.woodGrain({ base: '#8a6844', dark: '#4e3720', light: '#b08a5e', rings: 14, seed: 9 });
    addM(logs, G.mat({ map: logTex, normalMap: G.isLow() ? null : TX.normalOf(logTex, 2), normalScale: 0.8, roughness: 0.85, vertexColors: true, key: 'cabinLogs' }), true);
    addM(planks, G.mat({ map: TX.planks({ base: '#6e5236' }), roughness: 0.85, side: THREE.DoubleSide, key: 'cabinPlanks' }), true);
    addM(roof, G.mat({ map: TX.shingles({ base: '#5b4434' }), roughness: 0.9, key: 'cabinRoof' }), true);
    addM(stone, G.mat({ map: TX.stone(), normalMap: G.isLow() ? null : TX.normalOf(TX.stone(), 3), roughness: 0.92, key: 'cabinStone' }), true);
    var gm = G.mat({ color: '#2a2418', emissive: '#ffb45a', emissiveIntensity: 0, roughness: 0.15, metalness: 0.3, key: 'cabinGlass' });
    G.nightGlow.push(gm);
    addM(glass, gm, false);
    ctx.add(root);
    return root;
  };
  G.nightGlow = [];
  HG.maps.pine_valley = {
    name: 'Pine Valley', desc: 'Rolling hills, a quiet lake and plenty of whitetail. The perfect place to learn the wind.',
    tagline: 'Whitetail country. Stay downwind.',
    levelReq: 1, price: 0, size: 420, height: pvHeight,
    groundColors: { base: '#5b8a3a', alt: '#80a046', slope: '#7a6142', low: '#c4b27c', high: '#8b8f86', highLevel: 24 },
    terrain: { base: 'meadow', rules: { rockLevel: 22, dirtNoise: 0.3 } },
    fog: { color: '#cfe0e2', near: 70, far: 290 }, skyTop: '#3f86d4', skyBottom: '#d6ebe8', mountainColor: '#5a7380', treeColor: '#2f5a32',
    water: { level: -1.2, color: '#3a7d93', shallow: '#5d8f80', deep: '#1b4658' },
    playerSpawn: { x: 0, z: 150, yaw: 0 },
    menuCamera: { x: 30, z: 40, r: 58, h: 15 },
    spawns: [{ type: 'whitetail_deer', weight: 6, max: 8 }, { type: 'rabbit', weight: 4, max: 6 }],
    maxAnimals: 14, startHour: 16.5,
    build: function (ctx) {
      var wl = ctx.waterLevel, rng = ctx.rng;
      var forest = function (x, z) { var n = U.noise2(x * 0.011 + 3, z * 0.011 - 1); return U.clamp(0.1 + U.smooth(-0.25, 0.45, n) * 0.95, 0, 1); };
      var open = function (x, z) { return 1 - forest(x, z) * 0.85; };
      // cabin landmark near spawn
      var cx = 16, cz = 162;
      ctx.clearArea(cx, cz, 10);
      G.buildCabin(ctx, cx, cz, 0);
      ctx.addCollider(cx, cz, 3.3, { h: 5, tag: 'cabin' });
      ctx.addCollider(cx - 2.2, cz, 2.6, { h: 5, tag: 'cabin' }); ctx.addCollider(cx + 2.2, cz, 2.6, { h: 5, tag: 'cabin' });
      // woodpile + campfire ring
      var cy = ctx.heightAt(cx - 4.6, cz + 1.2), pile = [];
      for (var i = 0; i < 9; i++) { var lg = G.tube([[-0.6, 0, 0], [0.6, 0, 0]], 0.13 + (i % 3) * 0.015, { radial: 8, steps: 1, density: 1.5 }); G.xform(lg, [cx - 4.6, cy + 0.15 + Math.floor(i / 4) * 0.25, cz + 0.6 + (i % 4) * 0.27], [0, 0.04 * (i % 3), 0]); pile.push(lg); }
      var pm = new THREE.Mesh(G.merge(pile), G.mat({ map: TX.bark({ style: 'pine', base: '#6b4a33' }), roughness: 0.9, key: 'woodpile' })); pm.castShadow = true; pm.receiveShadow = true; ctx.add(pm);
      var ring = [], fy = ctx.heightAt(cx - 5, cz - 6);
      for (var j = 0; j < 9; j++) { var a = j / 9 * Math.PI * 2, rg = G.rock({ size: 0.22, seed: 40 + j, mossAmount: 0 }).lod.geometry.clone(); G.xform(rg, [cx - 5 + Math.cos(a) * 0.75, fy + 0.06, cz - 6 + Math.sin(a) * 0.75], [0, a, 0]); ring.push(rg); }
      var rm = new THREE.Mesh(G.merge(ring), G.rockMaterial()); rm.receiveShadow = true; ctx.add(rm);
      // vegetation (instanced, LOD'd, wind)
      var pines = [G.trees.pine({ height: 13, seed: 11, spread: 0.21 }), G.trees.pine({ height: 16, seed: 12, spread: 0.19 }), G.trees.pine({ height: 9, seed: 13, spread: 0.25 })];
      ctx.scatter(function (r, v) { return pines[v]; }, 760, { variants: 3, chunk: 105, scale: [0.72, 1.3], density: forest, slopeMax: 0.9, collider: 0.4, colliderHeight: 9, cover: true, tag: 'tree', castShadow: true, minH: wl + 1.2, tint: ['#ffffff', '#e8f0de', '#f4efd8', '#dfe8e4'] });
      var birches = [G.trees.birch({ height: 9.5, seed: 21 }), G.trees.birch({ height: 7.5, seed: 22 })];
      ctx.scatter(function (r, v) { return birches[v]; }, 120, { variants: 2, chunk: 140, scale: [0.8, 1.2], density: function (x, z) { var f = forest(x, z); return f > 0.2 && f < 0.75 ? 0.9 : 0.25; }, slopeMax: 0.7, collider: 0.25, colliderHeight: 6, cover: true, tag: 'tree', castShadow: true, minH: wl + 1, tint: ['#ffffff', '#f6f0c8', '#e9f2d8'] });
      ctx.scatter(function () { return G.trees.dead({ height: 8, seed: 31 }); }, 26, { chunk: 140, scale: [0.8, 1.3], density: forest, slopeMax: 0.8, collider: 0.3, colliderHeight: 6, cover: true, tag: 'tree', castShadow: true, minH: wl + 1 });
      var bushes = [G.trees.bush({ size: 1.3, seed: 41 }), G.trees.bush({ size: 1.0, seed: 42 })];
      ctx.scatter(function (r, v) { return bushes[v]; }, 340, { variants: 2, scale: [0.7, 1.5], slopeMax: 0.9, collider: 0.7, colliderHeight: 1.3, cover: true, solid: false, tag: 'bush', minH: wl + 0.6, chunk: 80, viewDist: 170, tint: ['#ffffff', '#f0f4d8', '#e4ecd8'] });
      var rocks = [G.rock({ size: 1, seed: 51 }), G.rock({ size: 1, seed: 52, flat: 0.5, stretch: 1.5 }), G.rock({ size: 1, seed: 53, flat: 0.8 })];
      ctx.scatter(function (r, v) { return rocks[v]; }, 130, { variants: 3, scale: [0.45, 1.6], align: true, collider: 0.9, colliderHeight: 1.2, tag: 'rock', yOffset: -0.12, castShadow: true, chunk: 105, viewDist: 220 });
      ctx.scatter(function (r, v) { return rocks[v]; }, 16, { variants: 3, scale: [2.2, 3.4], align: true, collider: 2.2, colliderHeight: 2.5, cover: true, tag: 'rock', yOffset: -0.3, castShadow: true, chunk: 140, slopeMax: 0.6 });
      var logs = [G.trees.log({ len: 4.5, r: 0.28, seed: 61 }), G.trees.log({ len: 3.2, r: 0.22, seed: 62 }), G.trees.log({ stump: true, r: 0.32, h: 0.55, seed: 63 })];
      var lp = ctx.scatter(function (r, v) { return logs[v]; }, 60, { variants: 3, chunk: 140, scale: [0.8, 1.2], density: forest, slopeMax: 0.35, align: true, castShadow: true, viewDist: 160, tag: 'log' });
      lp.points.forEach(function (p) { if (p.v === 2) ctx.addCollider(p.x, p.z, 0.35 * p.s, { h: 0.6, tag: 'stump', cover: true }); else { var ex = Math.cos(p.ry) * 1.3 * p.s, ez = -Math.sin(p.ry) * 1.3 * p.s; ctx.addCollider(p.x + ex, p.z + ez, 0.35, { h: 0.6, tag: 'log', cover: true }); ctx.addCollider(p.x - ex, p.z - ez, 0.35, { h: 0.6, tag: 'log', cover: true }); } });
      ctx.scatter(function () { return G.plant('fern', { seed: 71 }); }, 650, { scale: [0.7, 1.3], density: forest, slopeMax: 0.8, minH: wl + 0.8, chunk: 70, viewDist: 62, lowMult: 0.4 });
      ctx.scatter(function (r, v) { return G.plant(v ? 'dry' : 'flowers', { seed: 72 + v }); }, 520, { variants: 2, scale: [0.7, 1.2], slopeMax: 0.5, minH: wl + 0.8, chunk: 70, viewDist: 58, lowMult: 0.4, density: open });
      ctx.scatter(function () { return G.plant('reeds', { seed: 74 }); }, 240, { scale: [0.8, 1.3], minH: wl - 0.45, maxH: wl + 0.45, allowWater: true, chunk: 70, viewDist: 95 });
    }
  };

})();
