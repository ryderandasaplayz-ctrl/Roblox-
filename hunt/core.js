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
  HG.on = function (evt, fn, opts) {
    if (typeof fn !== 'function') return function () {};
    var arr = listeners[evt] || (listeners[evt] = []);
    fn._hgPri = (opts && opts.priority) || 0;
    arr.push(fn);
    if (fn._hgPri) arr.sort(function (a, b) { return (b._hgPri || 0) - (a._hgPri || 0); });
    return function () { HG.off(evt, fn); };
  };
  HG.once = function (evt, fn) { var off = HG.on(evt, function () { off(); return fn.apply(this, arguments); }); return off; };
  HG.off = function (evt, fn) { var arr = listeners[evt]; if (!arr) return; var i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); };
  /** HG.emit(evt, ...args). Each handler is isolated with try/catch (errors are logged with console.error). */
  HG.emit = function (evt) {
    var arr = listeners[evt]; if (!arr || !arr.length) return;
    var args = Array.prototype.slice.call(arguments, 1);
    var list = arr.slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i].apply(HG, args); } catch (e) { console.error('[HG] handler for "' + evt + '" failed:', e); }
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
        sens: 1, invertY: false, graphics: touch ? 'low' : 'high', sound: true, music: true,
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
  /** Shared vertex-colour material for merged props/animals (never dispose it). */
  HG.vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  HG.vcMat.userData.shared = true;
  var matCache = {};
  /** HG.mat(color, opts) -> cached shared MeshLambertMaterial (opts: {emissive, transparent, opacity, side, basic:true for MeshBasicMaterial}) */
  HG.mat = function (color, opts) {
    var key = String(color) + (opts ? JSON.stringify(opts) : '');
    if (matCache[key]) return matCache[key];
    var o = { color: new THREE.Color(color) };
    var basic = false;
    if (opts) for (var k in opts) { if (k === 'basic') { basic = true; continue; } o[k] = (k === 'emissive') ? new THREE.Color(opts[k]) : opts[k]; }
    var m = basic ? new THREE.MeshBasicMaterial(o) : new THREE.MeshLambertMaterial(o);
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
    _c1.set(color == null ? 0xffffff : color);
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
  M.cone = function (r, h, seg, color, opts) { return M.prep(new THREE.ConeGeometry(r, h, seg || 6), color, opts); };
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

  /* ------------------------------------------------------------------
   * Renderer, scenes, cameras
   * ------------------------------------------------------------------ */
  var viewEl = document.getElementById('hg-view');
  var rootEl = document.getElementById('hg-root');
  HG.quality = { low: HG.settings.graphics === 'low' };
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
  renderer.shadowMap.type = THREE.PCFShadowMap;
  viewEl.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Wildwood Hunter game view');

  HG.scene = new THREE.Scene();
  HG.scene.fog = new THREE.Fog(0xcfe0dc, 60, 260);
  HG.camera = new THREE.PerspectiveCamera(HG.config.baseFov, 1, 0.1, 700);
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
    var low = HG.settings.graphics === 'low';
    HG.quality.low = low;
    var pr = Math.min(window.devicePixelRatio || 1, low ? 1 : 1.5);
    renderer.setPixelRatio(pr);
    var wantShadows = !low;
    if (renderer.shadowMap.enabled !== wantShadows) {
      renderer.shadowMap.enabled = wantShadows;
      HG.scene.traverse(function (o) { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; }); } });
    }
    if (HG.env && HG.env.sun) HG.env.sun.castShadow = wantShadows;
    HG.resize();
  };
  HG.resize = function () {
    var w = Math.max(1, viewEl.clientWidth || window.innerWidth), h = Math.max(1, viewEl.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    HG.camera.aspect = w / h; HG.camera.updateProjectionMatrix();
    HG.viewCamera.aspect = w / h;
    // keep the view model a consistent size in portrait
    HG.viewCamera.fov = w < h ? 72 : 58;
    HG.viewCamera.updateProjectionMatrix();
    HG.portrait = h > w;
    rootEl.classList.toggle('portrait', HG.portrait);
    HG.emit('resize', w, h);
  };
  window.addEventListener('resize', function () { HG.resize(); });
  window.addEventListener('orientationchange', function () { setTimeout(HG.resize, 200); });

  /* ------------------------------------------------------------------
   * Sky, lights, environment (day/night). worlds.js may upgrade this.
   * ------------------------------------------------------------------ */
  var skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(0x4f8fd0) }, bottom: { value: new THREE.Color(0xcfe0dc) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(0xfff0d0) }, sunVis: { value: 1 }
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunVis; varying vec3 vDir;',
      'void main(){ vec3 d = normalize(vDir); float h = d.y;',
      ' vec3 col = mix(bottom, top, pow(clamp(h * 1.25 + 0.015, 0.0, 1.0), 0.55));',
      ' float s = max(dot(d, normalize(sunDir)), 0.0);',
      ' col += sunColor * sunVis * (smoothstep(0.9993, 0.9997, s) * 1.4 + pow(s, 14.0) * 0.28);',
      ' gl_FragColor = vec4(col, 1.0); }'
    ].join('\n'),
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
  });
  var sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 12), skyMat);
  sky.renderOrder = -1000; sky.frustumCulled = false; sky.name = 'sky';
  HG.scene.add(sky);

  var hemi = new THREE.HemisphereLight(0xdfefff, 0x5a6b3a, 0.6);
  HG.scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xfff1d6, 1.0);
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45; sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 260; sun.shadow.bias = -0.0008;
  if ('normalBias' in sun.shadow) sun.shadow.normalBias = 0.03;
  HG.scene.add(sun); HG.scene.add(sun.target);

  // drifting low-poly clouds (persist across maps)
  var clouds = new THREE.Group(); clouds.name = 'clouds';
  (function () {
    var r = U.rng(7), cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.92 });
    cloudMat.userData.shared = true;
    for (var i = 0; i < 12; i++) {
      var parts = [], n = 3 + Math.floor(r() * 4);
      for (var j = 0; j < n; j++) parts.push(M.ico(8 + r() * 10, 0, 0xffffff, { pos: [j * 11 - n * 5, r() * 4, (r() - 0.5) * 10], scale: [1.4, 0.55, 1] }));
      var c = new THREE.Mesh(M.merge(parts), cloudMat);
      var a = r() * TAU, d = 180 + r() * 300;
      c.position.set(Math.cos(a) * d, 130 + r() * 50, Math.sin(a) * d); c.rotation.y = r() * TAU;
      clouds.add(c);
    }
    clouds.userData.mat = cloudMat;
  })();
  HG.scene.add(clouds);

  HG.wind = { dir: 0.6, speed: 2.5, vec: new THREE.Vector3(), target: 0.6, gust: 0 };
  function updateWindVec() { HG.wind.vec.set(-Math.sin(HG.wind.dir), 0, -Math.cos(HG.wind.dir)); }
  updateWindVec();

  HG.weatherTypes = {
    clear: { name: 'Clear', fogMult: 1, light: 1 }
  };
  var C_NIGHT_TOP = new THREE.Color(0x0a1330), C_NIGHT_BOT = new THREE.Color(0x1c2b45),
    C_DUSK_TOP = new THREE.Color(0x3c5b8c), C_DUSK_BOT = new THREE.Color(0xf0a066),
    C_SUN_DAY = new THREE.Color(0xfff2dc), C_SUN_DUSK = new THREE.Color(0xffa45c), C_MOON = new THREE.Color(0x8fa6d8);
  var dayTop = new THREE.Color(), dayBot = new THREE.Color();
  HG.env = {
    hour: HG.config.startHour, daySpeed: HG.config.daySpeed, weather: 'clear', frozen: false,
    sun: sun, hemi: hemi, sky: sky, skyMat: skyMat, clouds: clouds,
    sunDir: new THREE.Vector3(0, 1, 0),
    skyTop: new THREE.Color(), skyBottom: new THREE.Color(), fogColor: new THREE.Color(),
    fogNear: 60, fogFar: 260, lightScale: 1, fogScale: 1, daylight: 1,
    setHour: function (h) { HG.env.hour = ((h % 24) + 24) % 24; HG.env.apply(); HG.emit('hour', HG.env.hour); },
    isNight: function () { return HG.env.daylight < 0.25; },
    setWeather: function (id) {
      if (!HG.weatherTypes[id]) return false;
      var prev = HG.weatherTypes[HG.env.weather];
      if (prev && prev.stop) { try { prev.stop(); } catch (e) { console.error(e); } }
      HG.env.weather = id; var w = HG.weatherTypes[id];
      HG.env.lightScale = w.light == null ? 1 : w.light; HG.env.fogScale = w.fogMult == null ? 1 : w.fogMult;
      if (w.start) { try { w.start(); } catch (e) { console.error(e); } }
      HG.env.apply(); HG.emit('weather', id); return true;
    },
    /** Recompute sky/fog/lights for the current hour + map. worlds.js may replace this function. */
    apply: function () {
      var env = HG.env, map = HG.map, h = env.hour;
      var ang = (h - 6) / 12 * PI;               // 0 at 6:00, PI/2 at noon, PI at 18:00
      var elev = Math.sin(ang);
      env.sunDir.set(Math.cos(ang), Math.max(-1, elev) * 0.82, 0.38).normalize();
      dayTop.set(map && map.skyTop || 0x4f8fd0);
      dayBot.set(map && (map.fog && map.fog.color) || map && map.skyBottom || 0xcfe0dc);
      var day = U.smooth(-0.12, 0.35, elev);       // 0 night .. 1 full day
      var dusk = U.clamp(1 - Math.abs(elev - 0.05) / 0.3, 0, 1) * (elev > -0.2 ? 1 : 0);
      env.daylight = day;
      env.skyTop.copy(C_NIGHT_TOP).lerp(dayTop, day);
      env.skyBottom.copy(C_NIGHT_BOT).lerp(dayBot, day);
      env.skyTop.lerp(C_DUSK_TOP, dusk * 0.5); env.skyBottom.lerp(C_DUSK_BOT, dusk * 0.55);
      var ls = env.lightScale;
      env.fogColor.copy(env.skyBottom);
      if (ls < 1) { _c2.setRGB(0.55, 0.58, 0.6); env.fogColor.lerp(_c2, (1 - ls) * 0.6); env.skyBottom.lerp(_c2, (1 - ls) * 0.6); env.skyTop.lerp(_c2, (1 - ls) * 0.7); }
      skyMat.uniforms.top.value.copy(env.skyTop); skyMat.uniforms.bottom.value.copy(env.fogColor);
      skyMat.uniforms.sunDir.value.copy(env.sunDir);
      skyMat.uniforms.sunColor.value.copy(C_SUN_DAY).lerp(C_SUN_DUSK, dusk);
      skyMat.uniforms.sunVis.value = U.clamp(elev * 6 + 0.3, 0, 1) * ls;
      HG.scene.fog.color.copy(env.fogColor);
      var f = map && map.fog || {};
      env.fogNear = (f.near || 60) * env.fogScale; env.fogFar = (f.far || 260) * env.fogScale;
      var nightFog = 0.75 + 0.25 * day;
      HG.scene.fog.near = env.fogNear * nightFog; HG.scene.fog.far = env.fogFar * nightFog;
      HG.camera.far = Math.min(700, HG.scene.fog.far + 40); HG.camera.updateProjectionMatrix();
      // sun or moon
      if (elev > -0.05) {
        sun.color.copy(C_SUN_DAY).lerp(C_SUN_DUSK, dusk);
        sun.intensity = (0.25 + 0.85 * U.smooth(-0.05, 0.4, elev)) * ls;
      } else {
        env.sunDir.set(-env.sunDir.x, -env.sunDir.y, env.sunDir.z); // moon opposite
        sun.color.copy(C_MOON); sun.intensity = 0.32 * ls;
      }
      hemi.color.copy(env.skyTop).lerp(_c1.setRGB(1, 1, 1), 0.45);
      hemi.groundColor.setRGB(0.32, 0.36, 0.22).lerp(_c1.setRGB(0.1, 0.12, 0.18), 1 - day);
      hemi.intensity = (0.42 + 0.33 * day) * (0.6 + 0.4 * ls);
      clouds.userData.mat.color.copy(env.skyBottom).lerp(_c1.setRGB(1, 1, 1), 0.55 * day + 0.1);
      if (HG.mountains) HG.mountains.material.color.copy(HG.mountains.userData.base).lerp(env.fogColor, 0.62);
      if (HG.water) { HG.water.material.color.copy(HG.water.userData.base).lerp(env.skyTop, 0.35).multiplyScalar(0.55 + 0.45 * day); }
      vmHemi.color.copy(hemi.color); vmHemi.groundColor.copy(hemi.groundColor); vmHemi.intensity = hemi.intensity + 0.2;
      vmSun.color.copy(sun.color); vmSun.intensity = Math.max(0.35, sun.intensity * 0.8);
    },
    /** Called every frame by core (game dt). worlds.js may wrap/replace. */
    update: function (dt) {
      var env = HG.env;
      if (!env.frozen) { env.hour += dt * env.daySpeed; if (env.hour >= 24) env.hour -= 24; }
      // wind wanders slowly
      var w = HG.wind;
      if (Math.random() < dt * 0.05) w.target = w.dir + (Math.random() - 0.5) * 1.6;
      w.dir += U.angleDiff(w.dir, w.target) * Math.min(1, dt * 0.15);
      w.gust = U.damp(w.gust, Math.random() < dt * 0.3 ? Math.random() * 2 : 0, 0.6, dt);
      w.speed = U.clamp(2 + Math.sin(HG.time * 0.05) * 1.2 + w.gust, 0.3, 9);
      updateWindVec();
      envTick += dt; if (envTick > 0.5) { envTick = 0; env.apply(); }
      for (var i = 0; i < clouds.children.length; i++) {
        var c = clouds.children[i]; c.position.addScaledVector(w.vec, dt * w.speed * 0.8);
        if (c.position.x * c.position.x + c.position.z * c.position.z > 520 * 520) { c.position.x *= -0.9; c.position.z *= -0.9; }
      }
      var w2 = HG.weatherTypes[env.weather]; if (w2 && w2.update) w2.update(dt);
    }
  };
  var envTick = 0;
  /** Keep sky, clouds and the shadow camera centred on the camera. Called every frame. */
  function followEnv() {
    sky.position.copy(HG.camera.position);
    clouds.position.set(HG.camera.position.x, 0, HG.camera.position.z);
    var p = HG.player ? HG.player.pos : HG.camera.position;
    sun.target.position.set(Math.round(p.x / 4) * 4, p.y, Math.round(p.z / 4) * 4);
    sun.position.copy(sun.target.position).addScaledVector(HG.env.sunDir, 140);
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
  var screens = {}, showHooks = {};
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
  ui.banner = function (title, subtitle, opts) {
    opts = opts || {};
    var dur = opts.duration || 2.8;
    bannerEl.innerHTML = '<div class="b-in" style="animation-duration:' + dur + 's"><h2' + (opts.color ? ' style="color:' + opts.color + '"' : '') + '>' + U.esc(title) + '</h2>' + (subtitle ? '<p>' + U.esc(subtitle) + '</p>' : '') + '</div>';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { bannerEl.innerHTML = ''; }, dur * 1000);
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
   *         pos:{right, bottom} px from the bottom-right safe corner (core arc layout; omit to go into the extras column),
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
      b.style.right = 'calc(var(--sr) + ' + opts.pos.right + 'px)';
      b.style.bottom = 'calc(var(--sb) + ' + opts.pos.bottom + 'px)';
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
  function updateThreat(dt) {
    threatLevel = Math.max(0, threatLevel - dt * 1.8);
    var k = threatLevel, a = threatAng;
    var left = Math.max(0, Math.sin(a)), right = Math.max(0, -Math.sin(a)), front = Math.max(0, Math.cos(a)), back = Math.max(0, -Math.cos(a));
    edges.l.style.opacity = (k * left).toFixed(2); edges.r.style.opacity = (k * right).toFixed(2);
    edges.t.style.opacity = (k * front * 0.8).toFixed(2); edges.b.style.opacity = (k * back).toFixed(2);
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
  var rotateEl = document.getElementById('hg-rotate'), rotateShown = false;
  rotateEl.innerHTML = ui.icon('rotate') + '<span>Rotate your phone for the best view</span>';
  rotateEl.addEventListener('pointerdown', function (e) { e.stopPropagation(); rotateEl.hidden = true; });
  ui.rotateHint = function () {
    if (rotateShown || !HG.portrait || !rootEl.classList.contains('touch')) return;
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
    var size = map.size || 400, seg = map.segments || Math.min(128, Math.round(size / 3.4));
    var row = seg + 1, cell = size / seg, half = size / 2, grid = new Float32Array(row * row);
    for (var iz = 0; iz <= seg; iz++) for (var ix = 0; ix <= seg; ix++) {
      grid[iz * row + ix] = map.height(ix * cell - half, iz * cell - half);
    }
    terrain.size = size; terrain.seg = seg; terrain.cell = cell; terrain.grid = grid;
    terrain.waterLevel = map.water ? map.water.level : -1e9;
    terrain.ready = true;
    var tris = seg * seg * 2, pos = new Float32Array(tris * 9), col = new Float32Array(tris * 9), p = 0;
    var colorFn = map.groundColor || groundColorFn(map), c = new THREE.Color();
    var jit = U.rng(1234);
    function tri(ax, az, ah, bx, bz, bh, cx, cz, ch) {
      pos[p] = ax; pos[p + 1] = ah; pos[p + 2] = az; pos[p + 3] = bx; pos[p + 4] = bh; pos[p + 5] = bz; pos[p + 6] = cx; pos[p + 7] = ch; pos[p + 8] = cz;
      // face normal y for colouring
      var ux = bx - ax, uy = bh - ah, uz = bz - az, vx = cx - ax, vy = ch - ah, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      colorFn((ax + bx + cx) / 3, (az + bz + cz) / 3, (ah + bh + ch) / 3, ny / nl, c);
      var j = 1 + (jit() - 0.5) * 0.07;
      for (var k = 0; k < 3; k++) { col[p + k * 3] = c.r * j; col[p + k * 3 + 1] = c.g * j; col[p + k * 3 + 2] = c.b * j; }
      p += 9;
    }
    for (iz = 0; iz < seg; iz++) for (ix = 0; ix < seg; ix++) {
      var x0 = ix * cell - half, x1 = x0 + cell, z0 = iz * cell - half, z1 = z0 + cell, i0 = iz * row + ix;
      var h00 = grid[i0], h10 = grid[i0 + 1], h01 = grid[i0 + row], h11 = grid[i0 + row + 1];
      tri(x0, z0, h00, x0, z1, h01, x1, z0, h10);
      tri(x0, z1, h01, x1, z1, h11, x1, z0, h10);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    var mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    var mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true; mesh.name = 'terrain';
    terrain.mesh = mesh;
    return mesh;
  }
  function buildWater(map) {
    if (!map.water) return null;
    var w = map.water, s = (map.size || 400) * 1.6;
    var g = new THREE.PlaneGeometry(s, s, 1, 1); g.rotateX(-PI / 2);
    var m = new THREE.MeshPhongMaterial({ color: new THREE.Color(w.color || '#3d7f95'), transparent: true, opacity: w.opacity == null ? 0.82 : w.opacity, shininess: 90, specular: new THREE.Color(0x99aabb), depthWrite: false });
    var mesh = new THREE.Mesh(g, m); mesh.position.y = w.level; mesh.name = 'water'; mesh.renderOrder = 2;
    mesh.userData.base = new THREE.Color(w.color || '#3d7f95');
    return mesh;
  }
  function buildMountains(map) {
    if (map.horizon === false) return null;
    var r = U.rng(99), parts = [], size = map.size || 400, base = size * 0.62;
    var rock = new THREE.Color(map.mountainColor || '#5b7178'), snow = new THREE.Color('#eef3f5');
    for (var i = 0; i < 44; i++) {
      var a = i / 44 * TAU + r() * 0.1, d = base + r() * size * 0.35, rad = 45 + r() * 70, h = 40 + r() * 110;
      var g = M.cone(rad, h, 5 + Math.floor(r() * 3), rock, { pos: [Math.cos(a) * d, h / 2 - 12, Math.sin(a) * d], rot: [0, r() * 3, 0], jitter: 0.12, rng: r });
      // snow caps: tint top vertices
      var pa = g.attributes.position.array, ca = g.attributes.color.array;
      for (var v = 0; v < pa.length; v += 3) if (pa[v + 1] > h * 0.62 - 12 && h > 80) { ca[v] = snow.r; ca[v + 1] = snow.g; ca[v + 2] = snow.b; }
      parts.push(g);
    }
    var mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
    var mesh = new THREE.Mesh(M.merge(parts), mat);
    mesh.name = 'mountains'; mesh.userData.base = new THREE.Color(0xffffff);
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
       *         cover:bool, solid:true (false = cover only, walk-through), tag, yOffset, align:bool (tilt to slope), castShadow, chunk:100, allowWater, margin, lowMult:0.6 (count multiplier on Low)}
       *  -> {count, points:[{x,y,z,s,ry,v}], meshes:[InstancedMesh]} */
      scatter: function (factory, count, opts) {
        opts = opts || {};
        if (HG.quality.low) count = Math.round(count * (opts.lowMult == null ? 0.6 : opts.lowMult));
        var nv = opts.variants || 1, variants = [];
        for (var v = 0; v < nv; v++) {
          var r = factory(rng, v);
          if (r && r.isBufferGeometry) variants.push({ geometry: r, material: HG.vcMat });
          else if (r && r.geometry) variants.push({ geometry: r.geometry, material: r.material || HG.vcMat });
        }
        if (!variants.length) return { count: 0, points: [], meshes: [] };
        variants.forEach(function (vv) { if (!vv.geometry.boundingSphere) vv.geometry.computeBoundingSphere(); });
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
        var meshes = [];
        for (var k in buckets) {
          var b = buckets[k], vr = variants[b.v];
          var g = new THREE.BufferGeometry();
          for (var an in vr.geometry.attributes) g.setAttribute(an, vr.geometry.attributes[an]);
          var im = new THREE.InstancedMesh(g, vr.material, b.pts.length);
          var mx = 0, mz = 0;
          for (var j = 0; j < b.pts.length; j++) {
            var q = b.pts[j];
            _obj.position.set(q.x, q.y, q.z); _obj.scale.setScalar(q.s);
            if (opts.align) { terrain.normalAt(q.x, q.z, _v4); _q1.setFromUnitVectors(_v3.set(0, 1, 0), _v4); _obj.quaternion.setFromAxisAngle(_v3, q.ry).premultiply(_q1); }
            else _obj.quaternion.setFromAxisAngle(_v3.set(0, 1, 0), q.ry);
            _obj.updateMatrix(); im.setMatrixAt(j, _obj.matrix);
            mx += q.x; mz += q.z;
          }
          mx /= b.pts.length; mz /= b.pts.length;
          var rad = 0;
          for (j = 0; j < b.pts.length; j++) { var dd = U.dist2D(mx, mz, b.pts[j].x, b.pts[j].z) + vr.geometry.boundingSphere.radius * b.pts[j].s; if (dd > rad) rad = dd; }
          g.boundingSphere = new THREE.Sphere(new THREE.Vector3(mx, terrain.heightAt(mx, mz), mz), rad + 10);
          im.instanceMatrix.needsUpdate = true;
          im.castShadow = !!opts.castShadow; im.receiveShadow = !!opts.receiveShadow;
          im.userData.scatter = true;
          HG.mapRoot.add(im); meshes.push(im);
          scatterChunks.push({ mesh: im, cx: mx, cz: mz, r: rad });
        }
        // the template geometries are only referenced through shared attributes now
        return { count: points.length, points: points, meshes: meshes };
      }
    };
    return ctx;
  }
  function disposeTree(root) {
    var geos = new Set(), mats = new Set();
    root.traverse(function (o) {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (!m.userData || !m.userData.shared) mats.add(m); });
    });
    geos.forEach(function (g) { try { g.dispose(); } catch (e) {} });
    mats.forEach(function (m) { try { if (m.map) m.map.dispose(); m.dispose(); } catch (e) {} });
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
    terrain.ready = false; terrain.grid = null; terrain.mesh = null;
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
    HG.env.apply();
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
  function updateChunkCulling() {
    var cx = HG.camera.position.x, cz = HG.camera.position.z, far = HG.scene.fog.far + 8;
    for (var i = 0; i < scatterChunks.length; i++) {
      var c = scatterChunks[i], d = U.dist2D(cx, cz, c.cx, c.cz) - c.r;
      c.mesh.visible = d < far;
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
      perceptT: Math.random() * 0.25, distToPlayer: 999, dotDist: 0, deadT: 0, fadeT: -1, tipDir: 1, attackCD: 0,
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
  /** Make an animal react to a threat at position p (e.g. a gunshot). strength 0..2 adds awareness. */
  HG.alertAnimal = function (a, p, strength, cause) {
    if (!a || a.dead) return;
    a.threat.set(p.x, p.y || 0, p.z); a.threatType = cause || 'noise'; a.lastCause = cause || 'noise';
    a.awareness = Math.min(2, a.awareness + (strength == null ? 1 : strength));
    if (a.awareness >= 1) react(a, a.lastCause);
    else if (a.state === 'idle' || a.state === 'graze' || a.state === 'wander') setState(a, 'alert', a.lastCause);
  };
  function react(a, cause) {
    if (a.dead) return;
    var t = a.def.temperament || 'skittish';
    if (a.state === 'flee' || a.state === 'charge' || a.state === 'warn' || a.state === 'retreat') return;
    var d = a.distToPlayer;
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
      a.root.visible = U.dist2D(cam.x, cam.z, a.pos.x, a.pos.z) < far;
      if (a.dead) { updateDead(a, dt); continue; }
      a.stateTime += dt;
      a.perceptT -= dt;
      if (a.perceptT <= 0) { a.perceptT = 0.2; perceive(a, 0.2); }
      var override = false;
      if (a.def.update) { try { override = a.def.update(a, dt) === true; } catch (e) { console.error('[HG] animal update ' + a.type, e); } }
      if (a.removed) continue;
      if (!override) { updateAnimalAI(a, dt); moveAnimal(a, dt); }
      if (a.root.visible && (a.distToPlayer < 140 || (HG.frame + a.id) % 3 === 0)) animateAnimal(a, dt);
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
  var dotMat = new THREE.MeshBasicMaterial({ color: 0x5a1010, transparent: true, opacity: 0.85, depthWrite: false });
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
      _c2.set(o.color || 0x9a7b55);
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
    switchT: 0, model: null, flashT: 0, swayX: 0, swayY: 0, lastShot: -9, spreadNow: 0
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
    var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    m.visible = false; m.renderOrder = 10; return m;
  })();
  HG.viewModel.add(flashMesh);
  /** Switch the held weapon (must be a key of HG.weaponTypes). */
  HG.switchWeapon = function (id) {
    var def = HG.weaponTypes[id]; if (!def) return false;
    if (W.id === id && W.model) return true;
    if (W.model) { HG.viewModel.remove(W.model); disposeTree(W.model); W.model = null; }
    W.id = id; W.def = def; W.reloading = false; W.cooldown = 0.2; W.switchT = 0.35; W.aimT = 0;
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
    var p = { mesh: mesh, vel: dir.clone().multiplyScalar(HG.weaponStat(def, 'muzzleVelocity') || 60), def: def, life: 0, stuck: false, travelled: 0, start: origin.clone(), weaponId: W.id };
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
          applyShotHit({ animal: hitA.animal, zone: hitA.zone, zoneDef: hitA.zoneDef, point: p.mesh.position.clone(), distance: dist, surface: 'animal' }, p.def, p.weaponId);
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
      if (def.projectile === 'arrow') { HG.spawnProjectile(shotRay.origin, _v3, def); continue; }
      results.push(traceShot(shotRay.origin, _v3, range, mv, grav, !!opts.debug));
    }
    HG.emit('shoot', def, shotRay);
    // everything nearby hears the shot
    var loud = wstat('noise', 1);
    for (var k = 0; k < HG.animals.length; k++) {
      var a = HG.animals[k]; if (a.dead) continue;
      var hr = a.senses.hearing * 4 * loud;
      if (a.distToPlayer < hr) HG.alertAnimal(a, player.pos, 1.3 * (1 - a.distToPlayer / hr) + (a.def.temperament === 'skittish' ? 0.5 : 0.2), 'shot');
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
    var dmg = (HG.weaponStat(def, 'damage') || 50) * mult * fall;
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
  var trophyQueue = [], trophyOpen = false;
  function killAnimal(a, zone, info) {
    var def = a.def, rar = HG.RARITY[def.rarity] || HG.RARITY.common;
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
    if (HG.state !== 'hunt') { HG.fadeAnimal(a); return; }
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
      nextTrophy();
    });
  }
  HG.trophyPending = function () { return trophyOpen || trophyQueue.length > 0; };

  // ---- per-frame weapon update: aim, FOV, spread, recoil, view-model pose ----
  var hipPos = new THREE.Vector3(), aimPos = new THREE.Vector3(), vmPos = new THREE.Vector3();
  var lastFov = 0, lastLookYaw = 0, lastLookPitch = 0;
  function updateWeapon(dt, rdt) {
    if (!W.def) return;
    var def = W.def;
    if (W.cooldown > 0) W.cooldown -= dt;
    if (W.switchT > 0) W.switchT -= dt;
    if (W.reloading) { W.reloadT -= dt; if (W.reloadT <= 0) finishReload(); }
    // fire input
    var canAct = !HG.paused && HG.state === 'hunt';
    if (canAct && (input.firePressed || (input.fire && wstat('auto', false)))) {
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
    var hp = def.hipPos || [0.17, -0.2, -0.42], ap = def.aimPos || [0, -0.06, -0.3];
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
      if (err < tol && err < (best ? best.err : 1e9)) best = { a: a, err: err, yaw: Math.atan2(-_v2.x, -_v2.z), pitch: Math.asin(U.clamp(_v2.y, -1, 1)) };
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
    '.hg-bars{display:flex;flex-direction:column;gap:5px;min-width:118px}' +
    '.hg-bar{display:flex;align-items:center;gap:6px}.hg-bar svg{width:15px;height:15px;flex:none}' +
    '.hg-bar i{display:block;height:8px;flex:1;border-radius:6px;background:rgba(255,255,255,.14);overflow:hidden;position:relative}' +
    '.hg-bar i b{position:absolute;left:0;top:0;bottom:0;border-radius:6px;transition:width .2s}' +
    '.hg-hp b{background:linear-gradient(90deg,#d8433b,#ff7a5c)}.hg-hp svg{color:#ff6b5a}' +
    '.hg-st b{background:linear-gradient(90deg,var(--amber),var(--amber-2))}.hg-st svg{color:var(--amber-2)}' +
    '.hg-iconbtn{width:48px;height:48px;border-radius:14px;border:1.5px solid var(--panel-line);background:rgba(10,20,15,.66);color:var(--cream);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}' +
    '.hg-iconbtn svg{width:22px;height:22px}' +
    '#hg-compass{display:block;width:300px;height:38px;border-radius:12px;background:linear-gradient(180deg,rgba(10,20,15,.72),rgba(10,20,15,.5));border:1.5px solid var(--panel-line)}' +
    '.portrait #hg-compass{width:190px}' +
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
    ui.actionButton('fire', 'Fire', 'fire', function () { input.fire = true; input.firePressed = true; }, { hold: true, cls: 'fire', pos: { right: 14, bottom: 18 }, onRelease: function () { input.fire = false; } });
    ui.actionButton('aim', 'Aim', 'aim', function (on) { input.aim = on; input.aimToggle = on; }, { toggle: true, cls: 'aim', pos: { right: 118, bottom: 22 } });
    ui.actionButton('reload', 'Reload', 'reload', function () { HG.reload(); }, { pos: { right: 30, bottom: 124 } });
    ui.actionButton('weapon', 'Swap', 'swap', function () { HG.cycleWeapon(1); }, { pos: { right: 98, bottom: 106 } });
    ui.actionButton('crouch', 'Crouch', 'crouch', function () { HG.setCrouch(!player.crouch); }, { pos: { right: 200, bottom: 16 } });
    ui.actionButton('sprint', 'Sprint', 'sprint', function (on) { input.sprintToggle = on; if (on && player.crouch) HG.setCrouch(false); }, { toggle: true, pos: { right: 172, bottom: 88 } });
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
    function mark(bDeg, color, size) {
      var d = ((bDeg - bearing + 540) % 360) - 180;
      if (Math.abs(d) > span / 2) { // clamp to edges as hint
        d = d > 0 ? span / 2 - 2 : -span / 2 + 2; size *= 0.7;
      }
      var x = w / 2 + d * ppd;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, h - 6, size, 0, TAU); ctx.fill();
    }
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
    '.hg-menu{min-height:100%;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:8px 6px;background:linear-gradient(90deg,rgba(8,18,12,.82),rgba(8,18,12,.35) 55%,rgba(8,18,12,.1))}' +
    '#scr-menu{background:none}' +
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
    '@media (orientation:portrait){.hg-menu{flex-direction:column;justify-content:center;align-items:stretch;background:linear-gradient(180deg,rgba(8,18,12,.75),rgba(8,18,12,.35) 50%,rgba(8,18,12,.8))}.hg-menu-right{width:100%;max-width:none;min-width:0}.hg-logo{align-items:flex-start}}' +
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
      ui.hide('trophy'); HG.resume('trophy');
      onContinue && onContinue();
      HG.emit('trophyClosed', a, info);
    }, { primary: true });
    btn.style.width = '100%';
    el.querySelector('.act').appendChild(btn);
    HG.exitPointerLock();
    HG.pause('trophy');
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
    { key: 'graphics', label: 'Graphics', type: 'choice', options: [['low', 'Low'], ['high', 'High']] },
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
    trophyQueue.length = 0; trophyOpen = false;
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
    trophyQueue.length = 0; trophyOpen = false;
    for (var k in pauseReasons) delete pauseReasons[k];
    HG.paused = false; HG.timeScale = 1;
    HG.exitPointerLock(); HG.resetInput();
    ui.clearContext(); ui.setScope(false);
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
    var rdt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 0.016;
    last = now;
    HG.realDt = rdt; HG.realTime += rdt;
    fpsFrames++; fpsT += rdt;
    if (fpsT >= 0.5) { HG.fps = Math.round(fpsFrames / fpsT); fpsFrames = 0; fpsT = 0; }
    HG.frame++;
    var dt = HG.paused ? 0 : rdt * HG.timeScale;
    HG.dt = dt;
    try {
      if (!HG.paused) {
        HG.time += dt;
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
      followEnv();
      cullT -= rdt; if (cullT <= 0) { cullT = 0.25; updateChunkCulling(); }
    } catch (e) {
      console.error('[HG] frame error', e);
    }
    // while paused behind an opaque menu, render at a reduced rate
    if (HG.paused && (HG.frame % 3)) return;
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
    /** compact state snapshot for tests */
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
  HG.getOutfitColors = function () { return { sleeve: '#55613a', cuff: '#ff8a1f', glove: '#3b2a1e' }; };
  /** Build first-person arms for a view model. grip: {right:[x,y,z], left:[x,y,z]} in weapon space. Returns prepared geometries. */
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

  /* ---------- weapon: hunting rifle ---------- */
  HG.ammoTypes.rifle_ammo = { name: '.308 Rifle Rounds', price: 40, pack: 10, color: '#d9a441', desc: 'Soft-point rounds for medium and large game.' };
  HG.weaponTypes.hunting_rifle = {
    name: 'Hunting Rifle', desc: 'Reliable bolt-action with a 4x scope. Your first trophy-taker.',
    slot: 'primary', ammo: 'rifle_ammo', price: 0, levelReq: 1,
    damage: 95, pellets: 1, spread: 0.035, fireDelay: 1.15, magSize: 5, reloadTime: 2.4, range: 320,
    zoom: 22, scope: true, projectile: 'hitscan', muzzleVelocity: 820, gravity: 5, noise: 1, recoil: 0.07,
    sound: { type: 'rifle', freq: 1 },
    hipPos: [0.16, -0.17, -0.4], aimPos: [0, -0.012, -0.3],
    stats: { Damage: 0.7, Range: 0.75, Stability: 0.55, 'Fire rate': 0.2 },
    buildViewModel: function () {
      var wood = '#8a5a36', woodD = '#6b4428', metal = '#2b2e33', black = '#16181b';
      var g = [
        // scope (sight line at y=0)
        M.cyl(0.021, 0.021, 0.24, 10, black, { rot: [PI / 2, 0, 0], pos: [0, 0, -0.06] }),
        M.cyl(0.03, 0.022, 0.07, 10, black, { rot: [PI / 2, 0, 0], pos: [0, 0, -0.205] }),
        M.cyl(0.026, 0.021, 0.05, 10, black, { rot: [PI / 2, 0, 0], pos: [0, 0, 0.085] }),
        M.cyl(0.012, 0.012, 0.03, 6, metal, { pos: [0, 0.022, -0.06] }),
        M.box(0.016, 0.03, 0.02, metal, { pos: [0, -0.03, -0.12] }), M.box(0.016, 0.03, 0.02, metal, { pos: [0, -0.03, 0.02] }),
        // receiver + barrel
        M.box(0.044, 0.05, 0.26, metal, { pos: [0, -0.06, -0.04] }),
        M.cyl(0.011, 0.013, 0.56, 8, metal, { rot: [PI / 2, 0, 0], pos: [0, -0.052, -0.44] }),
        M.cyl(0.016, 0.016, 0.03, 8, black, { rot: [PI / 2, 0, 0], pos: [0, -0.052, -0.71] }),
        // bolt handle
        M.cyl(0.006, 0.006, 0.06, 5, metal, { rot: [0, 0, PI / 2], pos: [0.045, -0.055, 0.04] }),
        M.sphere(0.011, metal, { pos: [0.078, -0.055, 0.04] }),
        // stock + forend (wood)
        M.box(0.05, 0.05, 0.36, wood, { pos: [0, -0.095, -0.3], jitter: 0.05 }),
        M.box(0.048, 0.07, 0.2, wood, { pos: [0, -0.1, 0.12], jitter: 0.05 }),
        M.box(0.046, 0.06, 0.18, wood, { pos: [0, -0.13, 0.26], rot: [-0.22, 0, 0], jitter: 0.05 }),
        M.box(0.05, 0.13, 0.06, woodD, { pos: [0, -0.15, 0.38] }),
        M.box(0.03, 0.035, 0.06, metal, { pos: [0, -0.1, 0.02] }) // trigger guard
      ].concat(HG.model.arms({ right: [0.03, -0.135, 0.12], left: [0, -0.125, -0.3] }));
      var grp = new THREE.Group();
      grp.add(M.mesh(g));
      grp.userData.muzzle = { x: 0, y: -0.052, z: -0.73 };
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
    ctx.save(); ctx.translate(w / 2, h / 2 + 4); var s = Math.min(w / 120, h / 80); ctx.scale(s, s);
    ctx.fillStyle = '#c99566'; ctx.strokeStyle = '#efe2c6'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(0, 0, 32, 14, 0, 0, TAU); ctx.fill();
    [[-24, 6], [-14, 8], [16, 8], [26, 6]].forEach(function (p) { ctx.fillRect(p[0] - 3, p[1], 6, 26); });
    ctx.beginPath(); ctx.moveTo(-22, -6); ctx.lineTo(-34, -28); ctx.lineTo(-26, -32); ctx.lineTo(-14, -6); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-36, -30, 10, 6, 0.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-32, -36); ctx.lineTo(-28, -52); ctx.lineTo(-20, -60); ctx.moveTo(-29, -48); ctx.lineTo(-38, -56); ctx.moveTo(-36, -36); ctx.lineTo(-44, -50); ctx.lineTo(-52, -54); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(32, -6, 5, 7, 0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function rabbitIcon(ctx, w, h) {
    ctx.save(); ctx.translate(w / 2, h / 2 + 8); var s = Math.min(w / 100, h / 70); ctx.scale(s, s);
    ctx.fillStyle = '#b3a089';
    ctx.beginPath(); ctx.ellipse(6, 4, 22, 15, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-16, -8, 11, 9, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-14, -30, 4, 14, 0.15, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(-6, -28, 4, 14, 0.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(28, 0, 6, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function leg(unused, color, hoof, len, r0, r1) {
    // leg geometry hanging down from the pivot (y=0 .. -len)
    return [
      M.cyl(r0, r0 * 0.75, len * 0.55, 5, color, { pos: [0, -len * 0.27, 0] }),
      M.cyl(r1, r1, len * 0.45, 5, color, { pos: [0, -len * 0.75, 0.02] }),
      M.box(r1 * 2.2, len * 0.07, r1 * 2.6, hoof, { pos: [0, -len + 0.03, -0.01] })
    ];
  }
  HG.makeLeg = leg;
  HG.animalTypes.whitetail_deer = {
    name: 'Whitetail Deer', rarity: 'common', baseCash: 140, xp: 45, weightRange: [45, 110], size: 1, hp: 100,
    speed: { walk: 1.5, run: 9.5 }, senses: { sight: 75, hearing: 60, smell: 95 }, temperament: 'skittish', group: [1, 4],
    habitats: ['pine_valley'], activeAt: 'any', gait: 'walk', stride: 2.4, grazePitch: -1.35, alertPitch: 0.3, tailLift: -2.3, radius: 0.45,
    furColor: 0xa87445, sounds: { alert: 'deer_snort', flee: 'deer_snort' }, icon: deerIcon,
    hitZones: [
      { name: 'head', part: 'head', offset: new THREE.Vector3(0, 0.5, -0.42), radius: 0.15, mult: 3 },
      { name: 'vital', offset: new THREE.Vector3(0, 0.98, -0.4), radius: 0.2, mult: 2.5 },
      { name: 'body', offset: new THREE.Vector3(0, 1.0, 0.12), radius: 0.44, mult: 1 },
      { name: 'body', part: 'head', offset: new THREE.Vector3(0, 0.22, -0.16), radius: 0.15, mult: 1 },
      { name: 'leg', offset: new THREE.Vector3(0.17, 0.4, -0.46), radius: 0.11, mult: 0.5 },
      { name: 'leg', offset: new THREE.Vector3(-0.17, 0.4, -0.46), radius: 0.11, mult: 0.5 },
      { name: 'leg', offset: new THREE.Vector3(0.17, 0.42, 0.48), radius: 0.11, mult: 0.5 },
      { name: 'leg', offset: new THREE.Vector3(-0.17, 0.42, 0.48), radius: 0.11, mult: 0.5 }
    ],
    buildMesh: function (opts) {
      var tan = '#a87445', back = '#8a5b34', belly = '#eadcc2', white = '#f4efe4', dark = '#2a211c', antler = '#e3d3b0';
      var buck = (opts && opts.legendary) || Math.random() < 0.5;
      var root = new THREE.Group();
      var body = [
        M.sphere(0.5, tan, { scale: [0.6, 0.6, 1.42], pos: [0, 1.0, 0.06], wseg: 8, hseg: 6, jitter: 0.04 }),
        M.sphere(0.5, back, { scale: [0.5, 0.25, 1.2], pos: [0, 1.22, 0.06], wseg: 7, hseg: 4 }),
        M.sphere(0.45, belly, { scale: [0.5, 0.36, 1.12], pos: [0, 0.86, 0.05], wseg: 7, hseg: 4 }),
        M.sphere(0.3, tan, { scale: [0.95, 0.95, 1], pos: [0, 1.0, 0.52], wseg: 7, hseg: 5 })
      ];
      root.add(M.mesh(body));
      // neck + head on one pivot at the shoulders (rotation.x < 0 lowers the head)
      var head = new THREE.Group(); head.position.set(0, 1.12, -0.5);
      var hg = [
        M.cyl(0.12, 0.18, 0.62, 6, tan, { rot: [-0.55, 0, 0], pos: [0, 0.25, -0.15] }),
        M.box(0.13, 0.2, 0.1, white, { pos: [0, 0.18, -0.26], rot: [-0.55, 0, 0] }),
        M.box(0.2, 0.21, 0.3, tan, { pos: [0, 0.52, -0.38], jitter: 0.05 }),
        M.box(0.14, 0.13, 0.2, back, { pos: [0, 0.47, -0.58] }),
        M.box(0.08, 0.06, 0.05, dark, { pos: [0, 0.49, -0.69] }),
        M.box(0.03, 0.03, 0.03, dark, { pos: [0.1, 0.56, -0.44] }), M.box(0.03, 0.03, 0.03, dark, { pos: [-0.1, 0.56, -0.44] }),
        M.cone(0.06, 0.2, 4, tan, { pos: [0.13, 0.68, -0.3], rot: [0, 0, -0.75] }), M.cone(0.06, 0.2, 4, tan, { pos: [-0.13, 0.68, -0.3], rot: [0, 0, 0.75] })
      ];
      if (buck) {
        [1, -1].forEach(function (sd) {
          hg.push(M.cyl(0.016, 0.022, 0.3, 4, antler, { pos: [sd * 0.1, 0.76, -0.32], rot: [0.45, 0, -sd * 0.45] }));
          hg.push(M.cyl(0.014, 0.018, 0.26, 4, antler, { pos: [sd * 0.17, 0.92, -0.42], rot: [-0.7, 0, -sd * 0.2] }));
          var tines = opts && opts.legendary ? 4 : 2;
          for (var i = 0; i < tines; i++) hg.push(M.cyl(0.008, 0.013, 0.13, 4, antler, { pos: [sd * (0.13 + i * 0.015), 0.95 + i * 0.02, -0.36 - i * 0.07], rot: [0.1, 0, -sd * 0.1] }));
        });
      }
      head.add(M.mesh(hg));
      root.add(head);
      // legs: FL, FR, BL, BR (pivots at the hips)
      var legs = [];
      [[0.17, 0.92, -0.42], [-0.17, 0.92, -0.42], [0.17, 0.95, 0.48], [-0.17, 0.95, 0.48]].forEach(function (p) {
        var piv = new THREE.Group(); piv.position.set(p[0], p[1], p[2]);
        piv.add(M.mesh(leg(null, tan, dark, p[1], 0.075, 0.035)));
        root.add(piv); legs.push(piv);
      });
      var tail = new THREE.Group(); tail.position.set(0, 1.14, 0.78);
      tail.add(M.mesh([M.box(0.12, 0.22, 0.05, back, { pos: [0, -0.1, 0.02], rot: [0.25, 0, 0] }), M.box(0.1, 0.18, 0.04, white, { pos: [0, -0.1, 0.05], rot: [0.25, 0, 0] })]));
      root.add(tail);
      return { root: root, legs: legs, head: head, tail: tail };
    }
  };
  HG.animalTypes.rabbit = {
    name: 'Cottontail Rabbit', rarity: 'common', baseCash: 30, xp: 14, weightRange: [1.1, 2.4], size: 1, hp: 25,
    speed: { walk: 0.9, run: 7.5 }, senses: { sight: 32, hearing: 34, smell: 24 }, temperament: 'skittish', group: [1, 2],
    habitats: ['pine_valley'], activeAt: 'any', gait: 'hop', stride: 4.5, grazePitch: -0.5, alertPitch: 0.25, tailLift: -0.6, radius: 0.15,
    furColor: 0x9a8670, sounds: { alert: 'rabbit_squeak' }, icon: rabbitIcon,
    hitZones: [
      { name: 'head', part: 'head', offset: new THREE.Vector3(0, 0.05, -0.06), radius: 0.08, mult: 3 },
      { name: 'vital', offset: new THREE.Vector3(0, 0.21, -0.06), radius: 0.09, mult: 2 },
      { name: 'body', offset: new THREE.Vector3(0, 0.2, 0.06), radius: 0.15, mult: 1 },
      { name: 'leg', offset: new THREE.Vector3(0, 0.06, 0.1), radius: 0.06, mult: 0.6 }
    ],
    buildMesh: function () {
      var fur = '#8f7d69', belly = '#d9cfbf', white = '#f7f3ea', dark = '#2a211c', pink = '#d9a3a0';
      var root = new THREE.Group();
      root.add(M.mesh([
        M.sphere(0.16, fur, { scale: [0.85, 0.8, 1.2], pos: [0, 0.2, 0.03], jitter: 0.05 }),
        M.sphere(0.13, belly, { scale: [0.7, 0.6, 1], pos: [0, 0.16, 0.0] })
      ]));
      var head = new THREE.Group(); head.position.set(0, 0.28, -0.12);
      head.add(M.mesh([
        M.sphere(0.095, fur, { scale: [0.9, 0.9, 1.1], pos: [0, 0.04, -0.06] }),
        M.box(0.035, 0.2, 0.025, fur, { pos: [0.035, 0.2, 0.0], rot: [0.25, 0, -0.12] }), M.box(0.035, 0.2, 0.025, fur, { pos: [-0.035, 0.2, 0.0], rot: [0.25, 0, 0.12] }),
        M.box(0.02, 0.15, 0.01, pink, { pos: [0.035, 0.2, -0.014], rot: [0.25, 0, -0.12] }), M.box(0.02, 0.15, 0.01, pink, { pos: [-0.035, 0.2, -0.014], rot: [0.25, 0, 0.12] }),
        M.box(0.02, 0.02, 0.02, dark, { pos: [0.06, 0.07, -0.1] }), M.box(0.02, 0.02, 0.02, dark, { pos: [-0.06, 0.07, -0.1] }),
        M.box(0.025, 0.02, 0.02, pink, { pos: [0, 0.03, -0.16] })
      ]));
      root.add(head);
      var legs = [];
      [[0.06, 0.12, -0.1, 0.12], [-0.06, 0.12, -0.1, 0.12], [0.08, 0.16, 0.12, 0.16], [-0.08, 0.16, 0.12, 0.16]].forEach(function (p, i) {
        var piv = new THREE.Group(); piv.position.set(p[0], p[1], p[2]);
        piv.add(M.mesh([M.box(0.04, p[3], i < 2 ? 0.04 : 0.09, i < 2 ? belly : fur, { pos: [0, -p[3] / 2, i < 2 ? 0 : -0.02] })]));
        root.add(piv); legs.push(piv);
      });
      var tail = new THREE.Group(); tail.position.set(0, 0.24, 0.2);
      tail.add(M.mesh([M.sphere(0.05, white, { pos: [0, 0, 0.02] })]));
      root.add(tail);
      return { root: root, legs: legs, head: head, tail: tail };
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
  function pineGeo(rng, v) {
    var greens = [['#2c5631', '#356538', '#3f7340'], ['#3a6a38', '#447a3f', '#518a49'], ['#456f35', '#4f7d3c', '#5c8c45']][v % 3];
    var tiers = v === 0 ? 4 : v === 1 ? 3 : 3, H = v === 2 ? 5.5 : v === 1 ? 10 : 8.5, w = v === 1 ? 2.2 : 2.7;
    var g = [M.cyl(0.18, 0.3, H * 0.35, 5, '#5b3f2a', { pos: [0, H * 0.17, 0] })];
    for (var i = 0; i < tiers; i++) {
      var t = i / tiers, r = w * (1 - t * 0.62), hh = H * 0.42;
      g.push(M.cone(r, hh, 7, greens[i % 3], { pos: [0, H * 0.28 + i * H * 0.2 + hh / 2, 0], rot: [0, rng() * 3, 0], jitter: 0.1, rng: rng }));
    }
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
    var m = M.merge(g);
    // mossy tops
    var pa = m.attributes.position.array, ca = m.attributes.color.array;
    for (var i = 0; i < pa.length; i += 9) { if ((pa[i + 1] + pa[i + 4] + pa[i + 7]) / 3 > 0.35 && rng() < 0.5) for (var k = 0; k < 3; k++) { ca[i + k * 3] = 0.38; ca[i + k * 3 + 1] = 0.5; ca[i + k * 3 + 2] = 0.25; } }
    return m;
  }
  function grassGeo(rng, v) {
    var c = ['#7aa045', '#8db04f', '#6b9440'][v % 3], g = [];
    for (var i = 0; i < 5; i++) g.push(M.cone(0.05, 0.45 + rng() * 0.3, 3, c, { pos: [(rng() - 0.5) * 0.35, 0.22, (rng() - 0.5) * 0.35], rot: [(rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5] }));
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
  HG.maps.pine_valley = {
    name: 'Pine Valley', desc: 'Rolling hills, a quiet lake and plenty of whitetail. The perfect place to learn the wind.',
    tagline: 'Whitetail country. Stay downwind.',
    levelReq: 1, price: 0, size: 420, height: pvHeight,
    groundColors: { base: '#5b8a3a', alt: '#80a046', slope: '#7a6142', low: '#c4b27c', high: '#8b8f86', highLevel: 24 },
    fog: { color: '#d3e6df', near: 70, far: 275 }, skyTop: '#4b8fd6', skyBottom: '#d6ebe8', mountainColor: '#5f7a80', treeColor: '#2f5a32',
    water: { level: -1.2, color: '#3a7d93' },
    playerSpawn: { x: 0, z: 150, yaw: 0 },
    menuCamera: { x: 30, z: 40, r: 58, h: 15 },
    spawns: [{ type: 'whitetail_deer', weight: 6, max: 8 }, { type: 'rabbit', weight: 4, max: 6 }],
    maxAnimals: 14, startHour: 16.5,
    build: function (ctx) {
      var wl = ctx.waterLevel, rng = ctx.rng;
      var forest = function (x, z) { var n = U.noise2(x * 0.011 + 3, z * 0.011 - 1); return U.clamp(0.12 + U.smooth(-0.25, 0.45, n) * 0.9, 0, 1); };
      // cabin landmark near spawn
      var cx = 16, cz = 162, cy = ctx.heightAt(cx, cz);
      ctx.clearArea(cx, cz, 9);
      var cab = [
        M.box(6, 3, 4.5, '#7a5236', { pos: [cx, cy + 1.4, cz], jitter: 0.05 }),
        M.box(6.6, 0.25, 5.2, '#4a3324', { pos: [cx, cy - 0.05, cz] }),
        M.box(0.9, 1.9, 0.1, '#3d2a1d', { pos: [cx - 1, cy + 0.95, cz - 2.27] }),
        M.box(1.0, 0.8, 0.1, '#e6c27a', { pos: [cx + 1.6, cy + 1.7, cz - 2.27] }),
        M.box(0.5, 2.4, 0.5, '#8b8c86', { pos: [cx + 2.4, cy + 3.6, cz + 1.2] })
      ];
      var roof = M.prep(new THREE.CylinderGeometry(0.01, 3.9, 2.0, 4, 1), '#6b3a2a', { rot: [0, PI / 4, 0], scale: [1.15, 1, 0.85], pos: [cx, cy + 3.95, cz] });
      cab.push(roof);
      ctx.addStatic(cab, { castShadow: true });
      ctx.addCollider(cx, cz, 3.3, { h: 5, tag: 'cabin' });
      ctx.addCollider(cx - 2.2, cz, 2.6, { h: 5, tag: 'cabin' }); ctx.addCollider(cx + 2.2, cz, 2.6, { h: 5, tag: 'cabin' });
      // woodpile + campfire ring
      var wp = [];
      for (var i = 0; i < 6; i++) wp.push(M.cyl(0.18, 0.18, 1.4, 6, '#8a5a36', { rot: [0, 0, PI / 2], pos: [cx - 4, cy + 0.2 + (i % 3) * 0.32, cz + 1 + Math.floor(i / 3) * 0.36] }));
      for (var j = 0; j < 8; j++) { var a = j / 8 * TAU; wp.push(M.dodeca(0.2, '#7c7e78', { pos: [cx - 5 + Math.cos(a) * 0.7, ctx.heightAt(cx - 5, cz - 6) + 0.08, cz - 6 + Math.sin(a) * 0.7] })); }
      ctx.addStatic(wp);
      // fallen logs
      var logs = [];
      for (var l = 0; l < 22; l++) {
        var p = ctx.randomPoint({ slopeMax: 0.35, density: forest }); if (!p) continue;
        var ry = rng() * PI, len = 3 + rng() * 3;
        logs.push(M.cyl(0.25, 0.3, len, 7, '#6b4a30', { rot: [0, 0, PI / 2], pos: [0, 0.22, 0], jitter: 0.06, rng: rng }));
        M.transform(logs[logs.length - 1], p.x, p.y, p.z, ry, 1);
        var ex = Math.cos(ry) * len * 0.3, ez = -Math.sin(ry) * len * 0.3;
        ctx.addCollider(p.x + ex, p.z + ez, 0.4, { h: 0.6, tag: 'log', cover: true }); ctx.addCollider(p.x - ex, p.z - ez, 0.4, { h: 0.6, tag: 'log', cover: true });
      }
      ctx.addStatic(logs, { castShadow: true });
      // vegetation (instanced)
      ctx.scatter(pineGeo, 720, { variants: 3, scale: [0.75, 1.35], density: forest, slopeMax: 0.9, collider: 0.42, colliderHeight: 9, cover: true, tag: 'tree', castShadow: true, minH: wl + 1.2 });
      ctx.scatter(aspenGeo, 110, { scale: [0.8, 1.2], density: function (x, z) { return 1 - forest(x, z) * 0.8; }, slopeMax: 0.7, collider: 0.3, colliderHeight: 6, cover: true, tag: 'tree', castShadow: true, minH: wl + 1 });
      ctx.scatter(bushGeo, 300, { variants: 3, scale: [0.7, 1.5], slopeMax: 0.9, collider: 0.7, colliderHeight: 1.3, cover: true, solid: false, tag: 'bush', minH: wl + 0.6 });
      ctx.scatter(rockGeo, 130, { variants: 3, scale: [0.5, 1.9], align: true, collider: 0.9, colliderHeight: 1.2, tag: 'rock', yOffset: -0.1, castShadow: true });
      ctx.scatter(grassGeo, 1700, { variants: 3, scale: [0.7, 1.3], slopeMax: 0.7, minH: wl + 0.5, chunk: 70, lowMult: 0.45 });
      ctx.scatter(flowerGeo, 320, { variants: 3, scale: [0.8, 1.2], slopeMax: 0.5, minH: wl + 0.8, chunk: 70, lowMult: 0.4, density: function (x, z) { return 1 - forest(x, z); } });
      ctx.scatter(reedGeo, 160, { scale: [0.8, 1.3], minH: wl - 0.4, maxH: wl + 0.5, allowWater: true, chunk: 70 });
    }
  };

})();
