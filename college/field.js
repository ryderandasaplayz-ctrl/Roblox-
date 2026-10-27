/* Saturday Gridiron - field.js
   The on-field engine: a low-res pixel renderer, 11-on-11 player AI,
   passing, running, blocking, tackling and the field-goal kicking view.

   World units are yards. x runs along the field: 0 = our goal line,
   100 = the goal line we attack (end zones run -10..0 and 100..110).
   y runs across: 0..53.33 sideline to sideline. We always attack +x.
   Landscape screens show +x to the right; portrait screens show +x up.
   ASCII only. */
(function () {
'use strict';
var SG = window.SG;
var F = SG.F = {};
var clamp = SG.clamp;

var FW = 53.333, MIDY = FW / 2;
var STEP = 1 / 60;
var HIST = 48;

// ---------------------------------------------------------------- canvas
var cv, ctx, low, lx;
var W = 1, H = 1, DPR = 1, S = 1, LW = 1, LH = 1;
var P = 7;                      // art pixels per yard
var portrait = false;
var insetTop = 0, insetBot = 0; // css px covered by HUD bars
var vTop = 0, vBot = 1, cx0 = 0, cy0 = 0;
var MX = 9, MY = 8;             // field canvas margins (yards)
var FX0 = -10 - MX, FY0 = -MY;
var fc = null;                  // pre-rendered field
var cam = { x: 50, y: MIDY };
var mode = 'idle';
var idleT = 0;

// ---------------------------------------------------------------- state
var TEAM = [null, null];        // 0 = our offense, 1 = their defense
var ents = [], OFF = [], DEF = [], order = [];
var ball = { st: 'dead', x: 0, y: 0, z: 0, holder: null, sx: 0, sy: 0, tx: 0, ty: 0, t: 0, T: 1, h: 1, vx: 0, vy: 0 };
var G = null;
var parts = [];
var ptr = { id: -1, on: false, x0: 0, y0: 0, x: 0, y: 0, t0: 0, kind: '' };
var aim = { on: false, x: 0, y: 0, dist: 0, scramble: false, valid: false, rec: null, open: 0 };
var K = null;                   // kick scene state
var tmp = { x: 0, y: 0 };

F.onResult = null;   // (result) after every play
F.onEvent = null;    // (name, data) for banners and sounds
F.onSnapTap = null;  // tap on the field before the snap
F.paused = false;
F.difficulty = 1;    // 0 easy, 1 normal, 2 hard

function emit(n, d) { if (F.onEvent) { try { F.onEvent(n, d); } catch (e) { /* ignore */ } } }

// =====================================================================
// Setup and sizing
// =====================================================================
F.init = function (canvas) {
  cv = canvas; ctx = cv.getContext('2d');
  low = document.createElement('canvas'); lx = low.getContext('2d');
  F.resize();
  window.addEventListener('resize', F.resize);
  cv.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  for (var i = 0; i < 160; i++) parts.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, col: '#fff', s: 1 });
  requestAnimationFrame(frame);
};

F.resize = function () {
  var r = cv.parentNode.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  portrait = H > W * 1.05;
  var dw = W * DPR, dh = H * DPR;
  S = Math.max(1, Math.round(portrait ? dw / 322 : dh / 280));
  LW = Math.ceil(dw / S); LH = Math.ceil(dh / S);
  low.width = LW; low.height = LH;
  cv.width = LW * S; cv.height = LH * S;
  cv.style.width = (LW * S / DPR) + 'px';
  cv.style.height = (LH * S / DPR) + 'px';
  lx.imageSmoothingEnabled = false;
  ctx.imageSmoothingEnabled = false;
  updView();
};
function updView() {
  vTop = Math.round(insetTop * DPR / S);
  vBot = Math.round(LH - insetBot * DPR / S);
  if (vBot - vTop < LH * 0.45) { vTop = 0; vBot = LH; }
  cx0 = Math.round(LW / 2);
  cy0 = Math.round((vTop + vBot) / 2);
}
F.setInsets = function (t, b) { insetTop = t; insetBot = b; updView(); };
F.isPortrait = function () { return portrait; };

// world -> low-res screen
function wx(x, y) { return portrait ? (y - cam.y) * P + cx0 : (x - cam.x) * P + cx0; }
function wy(x, y) { return portrait ? -(x - cam.x) * P + cy0 : (y - cam.y) * P + cy0; }
// low-res screen -> world (into tmp)
function s2w(sx, sy) {
  if (portrait) { tmp.x = -(sy - cy0) / P + cam.x; tmp.y = (sx - cx0) / P + cam.y; }
  else { tmp.x = (sx - cx0) / P + cam.x; tmp.y = (sy - cy0) / P + cam.y; }
  return tmp;
}
function halfAlong() { return (portrait ? (vBot - vTop) : LW) / P / 2; }
function halfAcross() { return (portrait ? LW : (vBot - vTop)) / P / 2; }

// =====================================================================
// Colors and sprites
// =====================================================================
function hexRgb(h) {
  var n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(h) { var c = hexRgb(h); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; }
function shade(h, f) {
  var c = hexRgb(h);
  return 'rgb(' + Math.round(clamp(c[0] * f, 0, 255)) + ',' + Math.round(clamp(c[1] * f, 0, 255)) + ',' + Math.round(clamp(c[2] * f, 0, 255)) + ')';
}

var SKINS = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69', '#5c3a1e'];
var BODY = [
  '...HHH...', '..HSSSH..', '.HHHHHMM.', '.HHHHHHM.', '..HHHHH..', '...KKK...',
  '.NJJJJJN.', 'KJJJJJJJK', 'KJJJJJJJK', '.JJJJJJJ.'
];
var THROW = [
  'K..HHH...', 'K.HSSSH..', 'KHHHHHMM.', 'KHHHHHHM.', 'K.HHHHH..', 'J..KKK...',
  'JNJJJJJN.', '.JJJJJJJK', '.JJJJJJJK', '.JJJJJJJ.'
];
var LEGS = {
  stand: ['..PPPPP..', '..PP.PP..', '..PP.PP..', '..LL.LL..', '..BB.BB..'],
  runA: ['..PPPPP..', '.PPP.PP..', 'PP....PP.', 'LL.....LL', 'B.......B'],
  runB: ['..PPPPP..', '...PPP...', '...PPP...', '...LLL...', '...BBB...']
};
var DOWN = ['...............', 'BLLPPJJJJJHHH..', 'BLLPPJJJJJHHHM.', '...PPJJJJKHHH..', '...............'];
var FRAMES = ['stand', 'runA', 'runB', 'thr', 'down'];

function frameRows(f) {
  if (f === 'down') return DOWN;
  if (f === 'thr') return THROW.concat(LEGS.stand);
  return BODY.concat(LEGS[f]);
}

function makeSprite(rows, pal, flip) {
  var w = rows[0].length, h = rows.length;
  var c = document.createElement('canvas');
  c.width = w + 2; c.height = h + 2;
  var g = c.getContext('2d');
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var ch = rows[y][flip ? w - 1 - x : x];
    if (ch === '.') continue;
    g.fillStyle = pal[ch];
    g.fillRect(x + 1, y + 1, 1, 1);
  }
  // 1px dark outline so players pop off the grass
  var id = g.getImageData(0, 0, w + 2, h + 2), d = id.data, out = new Uint8Array((w + 2) * (h + 2));
  for (y = 0; y < h + 2; y++) for (x = 0; x < w + 2; x++) {
    if (d[(y * (w + 2) + x) * 4 + 3]) continue;
    var near = false;
    for (var oy = -1; oy <= 1 && !near; oy++) for (var ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      var xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= w + 2 || yy >= h + 2) continue;
      if (d[(yy * (w + 2) + xx) * 4 + 3]) { near = true; break; }
    }
    if (near) out[y * (w + 2) + x] = 1;
  }
  for (var i = 0; i < out.length; i++) if (out[i]) { d[i * 4] = 10; d[i * 4 + 1] = 14; d[i * 4 + 2] = 20; d[i * 4 + 3] = 170; }
  g.putImageData(id, 0, 0);
  return c;
}

function buildTeam(t, home, otherLight) {
  var T = SG.TEAMS[t];
  var whiteJersey = !home && !otherLight;
  if (home && lum(T.c1) > 0.8) whiteJersey = true;
  var jersey = whiteJersey ? '#f4f4f2' : T.c1;
  var trim = whiteJersey ? T.c1 : T.c2;
  var pants = whiteJersey ? T.c1 : T.c2;
  if (Math.abs(lum(pants) - lum(jersey)) < 0.08) pants = lum(jersey) > 0.5 ? '#3a3a3a' : '#e8e8e8';
  var sp = [];
  for (var s = 0; s < SKINS.length; s++) {
    var pal = { H: T.c1, S: T.c2, M: '#c9ccd1', K: SKINS[s], N: trim, J: jersey, P: pants, L: whiteJersey ? T.c1 : T.c2, B: '#141414' };
    if (lum(T.c1) > 0.8) pal.S = T.c2;
    var bySkin = {};
    FRAMES.forEach(function (f) {
      var rows = frameRows(f);
      bySkin[f] = [makeSprite(rows, pal, false), makeSprite(rows, pal, true)];
    });
    sp.push(bySkin);
  }
  return { t: t, c1: T.c1, c2: T.c2, jersey: jersey, abbr: T.abbr, sp: sp, home: home };
}

// =====================================================================
// Field painting
// =====================================================================
function px(x) { return Math.round((x - FX0) * P); }
function py(y) { return Math.round((y - FY0) * P); }

function glyphs(g, text, x, y, k, rot, col) {
  // rot: 0 normal, 1 = 90deg clockwise, 2 = 180, 3 = 270
  g.fillStyle = col;
  var cx = 0;
  for (var i = 0; i < text.length; i++) {
    var gl = SG.FONT3[text[i]] || SG.FONT3[' '];
    for (var r = 0; r < 5; r++) for (var c = 0; c < 3; c++) {
      if (gl[r][c] !== '1') continue;
      var lx2 = cx + c, ly2 = r, X, Y;
      if (rot === 0) { X = x + lx2 * k; Y = y + ly2 * k; }
      else if (rot === 2) { X = x - (lx2 + 1) * k; Y = y - (ly2 + 1) * k; }
      else if (rot === 1) { X = x - (ly2 + 1) * k; Y = y + lx2 * k; }
      else { X = x + ly2 * k; Y = y - (lx2 + 1) * k; }
      g.fillRect(X, Y, k, k);
    }
    cx += 4;
  }
}
function textW(text) { return text.length * 4 - 1; }

function paintField(homeT, awayT) {
  var H0 = SG.TEAMS[homeT], A0 = SG.TEAMS[awayT];
  var wpx = Math.round((120 + MX * 2) * P), hpx = Math.round((FW + MY * 2) * P);
  fc = document.createElement('canvas');
  fc.width = wpx; fc.height = hpx;
  var g = fc.getContext('2d');
  var rnd = mulberry(homeT * 97 + 13);
  // stadium bowl
  g.fillStyle = '#121a28'; g.fillRect(0, 0, wpx, hpx);
  var crowdCols = [H0.c1, H0.c2, H0.c1, H0.c2, H0.c1, '#d9d4c7', '#8b93a7', A0.c1, A0.c2, '#3b4256'];
  for (var yy = 0; yy < hpx; yy += 3) {
    for (var xx = 0; xx < wpx; xx += 3) {
      var wxp = xx / P + FX0, wyp = yy / P + FY0;
      if (wxp > -15.5 && wxp < 115.5 && wyp > -5.5 && wyp < FW + 5.5) continue;
      if (rnd() < 0.72) {
        g.fillStyle = crowdCols[Math.floor(rnd() * crowdCols.length)];
        g.fillRect(xx, yy + 1, 2, 2);
        g.fillStyle = SKINS[Math.floor(rnd() * SKINS.length)];
        g.fillRect(xx, yy, 2, 1);
      }
    }
  }
  // wall and apron
  g.fillStyle = shade(H0.c1, 0.55);
  g.fillRect(px(-16), py(-6), px(116) - px(-16), py(FW + 6) - py(-6));
  g.fillStyle = '#2b7a33';
  g.fillRect(px(-15.5), py(-5.5), px(115.5) - px(-15.5), py(FW + 5.5) - py(-5.5));
  // turf stripes
  for (var s = -10; s < 110; s += 5) {
    g.fillStyle = (Math.floor((s + 10) / 5) % 2) ? '#3b9b41' : '#358f3b';
    g.fillRect(px(s), py(0), px(s + 5) - px(s), py(FW) - py(0));
  }
  // turf grain
  for (var n = 0; n < 2600; n++) {
    var gx = px(rnd() * 120 - 10), gy = py(rnd() * FW);
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
    g.fillRect(gx, gy, 1, 1);
  }
  // end zones
  var ez = shade(H0.c1, lum(H0.c1) > 0.8 ? 0.7 : 0.95);
  g.fillStyle = ez;
  g.fillRect(px(-10), py(0), px(0) - px(-10), py(FW) - py(0));
  g.fillRect(px(100), py(0), px(110) - px(100), py(FW) - py(0));
  var ezLum = lum(H0.c1) * (lum(H0.c1) > 0.8 ? 0.7 : 0.95);
  var ezText = Math.abs(lum(H0.c2) - ezLum) > 0.28 ? H0.c2 : (ezLum > 0.5 ? '#1a1a1a' : '#f4f4ee');
  [[-5, H0.city.toUpperCase(), 3], [105, H0.mascot.toUpperCase(), 1]].forEach(function (e) {
    var t = e[1], k = Math.max(3, Math.min(7, Math.floor((FW * P - 30) / (textW(t) + 1))));
    var len = textW(t) * k;
    var cxp = px(e[0]);
    if (e[2] === 1) glyphs(g, t, cxp + Math.round(2.5 * k), py(MIDY) - Math.round(len / 2), k, 1, ezText);
    else glyphs(g, t, cxp - Math.round(2.5 * k), py(MIDY) + Math.round(len / 2), k, 3, ezText);
  });
  // lines
  g.fillStyle = '#f4f4ee';
  g.fillRect(px(-10), py(0) - 1, px(110) - px(-10), 2);
  g.fillRect(px(-10), py(FW) - 1, px(110) - px(-10), 2);
  g.fillRect(px(-10) - 1, py(0), 2, py(FW) - py(0));
  g.fillRect(px(110) - 1, py(0), 2, py(FW) - py(0));
  for (var yl = 0; yl <= 100; yl += 5) {
    g.fillStyle = (yl === 0 || yl === 100) ? '#ffffff' : 'rgba(244,244,238,0.85)';
    g.fillRect(px(yl), py(0), (yl === 0 || yl === 100) ? 2 : 1, py(FW) - py(0));
  }
  // hashes (college: 20 yards in from each sideline)
  g.fillStyle = 'rgba(244,244,238,0.85)';
  for (var hx = 1; hx < 100; hx++) {
    if (hx % 5 === 0) continue;
    g.fillRect(px(hx), py(20) - 1, 1, 3);
    g.fillRect(px(hx), py(FW - 20) - 1, 1, 3);
    g.fillRect(px(hx), py(0.6), 1, 2);
    g.fillRect(px(hx), py(FW - 0.6) - 2, 1, 2);
  }
  // yard numbers face their own sideline
  for (var yn = 10; yn <= 90; yn += 10) {
    var lab = String(yn <= 50 ? yn : 100 - yn), k2 = 3, tw = textW(lab) * k2 + 2;
    glyphs(g, lab, px(yn) - Math.round(tw / 2) + 1, py(FW - 12) - 5 * k2, k2, 0, 'rgba(244,244,238,0.9)');
    glyphs(g, lab, px(yn) + Math.round(tw / 2), py(12) + 5 * k2, k2, 2, 'rgba(244,244,238,0.9)');
  }
  // midfield logo
  var mx = px(50), my = py(MIDY), R = Math.round(4.6 * P);
  g.fillStyle = H0.c2;
  disc(g, mx, my, R + 2);
  g.fillStyle = H0.c1;
  disc(g, mx, my, R);
  var ab = H0.abbr, k3 = 3;
  glyphs(g, ab, mx - Math.round(textW(ab) * k3 / 2), my - Math.round(5 * k3 / 2), k3, 0, lum(H0.c1) > 0.6 ? '#222' : H0.c2);
  // team benches along each sideline
  for (var b = 0; b < 28; b++) {
    var bx = 30 + b * 1.45 + rnd() * 0.4;
    bench(g, px(bx), py(-2.4), H0.c1, H0.c2, rnd);
    bench(g, px(bx), py(FW + 3.4), A0.c1, A0.c2, rnd);
  }
}
function disc(g, cx, cy, r) {
  for (var y = -r; y <= r; y++) {
    var w = Math.round(Math.sqrt(r * r - y * y));
    g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
  }
}
function bench(g, x, y, c1, c2, rnd) {
  g.fillStyle = c1; g.fillRect(x, y - 6, 3, 2);
  g.fillStyle = SKINS[Math.floor(rnd() * SKINS.length)]; g.fillRect(x + 1, y - 4, 1, 1);
  g.fillStyle = rnd() < 0.5 ? c1 : c2; g.fillRect(x, y - 3, 3, 3);
}
function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// =====================================================================
// Loading a game
// =====================================================================
F.loadGame = function (o) {
  // o = { home, away, us, offense: {QB:[..],..}, defense: [11 players] }
  var usHome = o.us === o.home;
  var themT = usHome ? o.away : o.home;
  var usT = o.us;
  var usLight = lum(SG.TEAMS[usT].c1) > 0.8, themLight = lum(SG.TEAMS[themT].c1) > 0.8;
  TEAM[0] = buildTeam(usT, usHome, usHome ? false : themLight);
  TEAM[1] = buildTeam(themT, !usHome, usHome ? usLight : false);
  paintField(o.home, o.away);
  F.lineup = o.offense;
  F.defense = o.defense;
  mode = 'field';
  G = null;
  ents.length = 0; OFF.length = 0; DEF.length = 0;
};

F.clear = function () {
  mode = 'field'; G = null;
  ents.length = 0; OFF.length = 0; DEF.length = 0;
  ball.st = 'dead'; aim.on = false; ptr.on = false;
};

F.idle = function (home, away) {
  if (home != null && (!fc || F.idleHome !== home)) { paintField(home, away != null ? away : home); F.idleHome = home; }
  if (!fc) { paintField(0, 1); F.idleHome = 0; }
  mode = 'idle'; G = null;
  ents.length = 0;
  ball.st = 'dead';
};

// =====================================================================
// Entities
// =====================================================================
function topSpeed(pl, side) {
  var v = clamp(4.6 + (pl.spd - 40) * 0.062, 4.2, 8.6);
  if (side === 1) v *= [0.92, 0.97, 1.0][F.difficulty];
  return v;
}

function mkEnt(side, role, pl, x, y) {
  var e = {
    side: side, role: role, pl: pl, x: x, y: y, vx: 0, vy: 0,
    top: topSpeed(pl, side), face: side === 0 ? 1 : -1, step: 0,
    skin: (pl.id || pl.num || 0) % SKINS.length,
    route: null, wi: 0, rstop: false, dirX: 1, dirY: 0, done: false,
    assign: null, zone: null, rush: false, spy: false,
    blk: null, eng: false, by: null, shedT: 99, cool: 0,
    react: 0, whiff: 0, down: false, thr: 0,
    juke: 0, jukeCd: 0, jukeDir: 0, dive: 0,
    hx: new Float32Array(HIST), hy: new Float32Array(HIST),
    elig: false, path: null, pi: 0, tx: x, ty: y
  };
  for (var i = 0; i < HIST; i++) { e.hx[i] = x; e.hy[i] = y; }
  ents.push(e);
  (side === 0 ? OFF : DEF).push(e);
  return e;
}

function filler(pos) { return { pos: pos, spd: 60, str: 60, skl: 60, arm: 60, num: 0, id: 0, fn: 'Walk', ln: 'On' }; }

// Route shapes: [forward yards, yards toward the middle of the field]
var ROUTES = {
  go: { p: [[40, 0]] }, slant: { p: [[2.5, 0], [12, 7]] }, out: { p: [[7, 0], [7.5, -10]] },
  dig: { p: [[11, 0], [11.5, 14]] }, post: { p: [[11, 0], [30, 9]] }, corner: { p: [[11, 0], [25, -9]] },
  curl: { p: [[8.5, 0], [7, 1]], stop: true }, comeback: { p: [[15, 0], [13, -3]], stop: true },
  hitch: { p: [[5.5, 0], [4.6, 0.5]], stop: true }, drag: { p: [[2, 1], [4, 22]] },
  seam: { p: [[3, 0.5], [36, 2]] }, flat: { p: [[1.5, -3], [3, -12]] },
  stick: { p: [[5.5, 0], [6, -1.5]], stop: true }, check: { p: [[1, -3.5], [4, -6]], stop: true },
  wheel: { p: [[1, -5], [4, -9], [32, -10]] }, swing: { p: [[0, -5], [2.5, -10]] }
};
var CALLS = {
  short: { wr: ['slant', 'out', 'curl', 'hitch', 'drag', 'dig', 'slant'], te: ['stick', 'flat', 'drag'], rb: ['check', 'flat', 'swing'] },
  deep: { wr: ['go', 'post', 'corner', 'comeback', 'seam', 'dig', 'go'], te: ['seam', 'dig', 'stick'], rb: ['check', 'wheel', 'swing'] }
};

function setRoute(e, name, C) {
  var r = ROUTES[name];
  var inS = Math.abs(C - e.y) < 0.8 ? (e.y < C ? 1 : -1) : (e.y < C ? 1 : -1);
  e.route = name; e.wi = 0; e.rstop = !!r.stop; e.done = false;
  e.path = r.p.map(function (q) {
    return [Math.min(109, e.x + q[0]), clamp(e.y + q[1] * inS, 1.2, FW - 1.2)];
  });
}

// =====================================================================
// Play setup
// =====================================================================
// o = { los, spotY, togo, down, call: 'short'|'deep'|'inside'|'outside', conv }
F.setupPlay = function (o) {
  ents.length = 0; OFF.length = 0; DEF.length = 0;
  var Lx = o.los, C = clamp(o.spotY, 20, FW - 20);
  var lu = F.lineup || {}, dfn = F.defense || [];
  function pl(pos, i) { return (lu[pos] && lu[pos][i]) || (lu[pos] && lu[pos][0]) || filler(pos); }
  var call = o.call;
  var run = call === 'inside' || call === 'outside';
  var dir = Math.abs(C - MIDY) < 1 ? (SG.rand() < 0.5 ? 1 : -1) : (C < MIDY ? 1 : -1);
  var teSide = call === 'outside' ? dir : (SG.rand() < 0.5 ? 1 : -1);
  var rbSide = run ? -dir : (SG.rand() < 0.5 ? 1 : -1);

  G = {
    phase: 'pre', call: call, run: run, dir: dir, los: Lx, spotY: C, togo: o.togo, down: o.down, conv: !!o.conv,
    t: 0, hi: 0, thrown: false, thrownT: 0, intended: null, ctl: null, steerY: null, scramble: false,
    result: null, deadT: 0, handed: false, crossed: false, defCall: 'man', pressure: false,
    passer: null, catchX: 0, msgShown: false, tackler: null, ballSide: 0
  };

  // ----- offense
  var ol = [];
  for (var k = -2; k <= 2; k++) {
    var e = mkEnt(0, 'OL', pl('OL', k + 2), Lx - 0.7, C + k * 1.25);
    ol.push(e);
  }
  var qb = mkEnt(0, 'QB', pl('QB', 0), Lx - 4.5, C);
  var rb = mkEnt(0, 'RB', pl('RB', 0), Lx - 4.6, C + rbSide * 1.7);
  var te = mkEnt(0, 'TE', pl('TE', 0), Lx - 0.9, C + teSide * 3.9);
  var yL = clamp(Math.min(9, C - 8), 2.5, FW - 2.5), yR = clamp(Math.max(FW - 9, C + 8), 2.5, FW - 2.5);
  var w1 = mkEnt(0, 'WR', pl('WR', 0), Lx - 0.6, yL);
  var w2 = mkEnt(0, 'WR', pl('WR', 1), Lx - 0.6, yR);
  var slotY = teSide > 0 ? (C + yL) / 2 : (C + yR) / 2;
  var w3 = mkEnt(0, 'WR', pl('WR', 2), Lx - 1.3, slotY);
  G.qb = qb; G.rb = rb; G.te = te; G.wr = [w1, w2, w3]; G.ol = ol;
  [w1, w2, w3, te, rb].forEach(function (r) { r.elig = true; });

  if (!run) {
    var fam = CALLS[call] || CALLS.short, pool = fam.wr.slice();
    SG.shuffle(pool);
    setRoute(w1, pool[0], C); setRoute(w2, pool[1], C); setRoute(w3, pool[2], C);
    setRoute(te, SG.pick(fam.te), C);
    setRoute(rb, SG.pick(fam.rb), C);
  } else {
    if (call === 'inside') rb.path = [[Lx - 4.1, C + dir * 0.2], [Lx + 0.6, C + dir * 1.4], [Lx + 7, C + dir * 1.8]];
    else rb.path = [[Lx - 4.4, C + dir * 2.2], [Lx - 2.4, C + dir * 7.5], [Lx + 3, C + dir * 10.5], [Lx + 12, C + dir * 11]];
    rb.path.forEach(function (q) { q[1] = clamp(q[1], 1.5, FW - 1.5); });
  }

  // ----- defense
  function dp(i, pos) { return dfn[i] || filler(pos); }
  var dl = [], lb = [], db = [];
  [-3.4, -1.1, 1.1, 3.4].forEach(function (dy, i) { dl.push(mkEnt(1, 'DL', dp(i, 'DL'), Lx + 1.0, C + dy)); });
  var lbShift = teSide * 0.8;
  [-4, 0, 4].forEach(function (dy, i) { lb.push(mkEnt(1, 'LB', dp(4 + i, 'LB'), Lx + 4.8, C + dy + lbShift)); });
  var press = SG.rand() < 0.3;
  var cb1 = mkEnt(1, 'CB', dp(7, 'DB'), Lx + (press ? 1.5 : 5.5), w1.y + 0.8);
  var cb2 = mkEnt(1, 'CB', dp(8, 'DB'), Lx + (press ? 1.5 : 5.5), w2.y - 0.8);
  var s1 = mkEnt(1, 'S', dp(9, 'DB'), Lx + 6.5, slotY + (slotY < C ? 0.8 : -0.8));
  var s2 = mkEnt(1, 'S', dp(10, 'DB'), Lx + 13, clamp((C + MIDY) / 2, 14, FW - 14));
  db.push(cb1, cb2, s1, s2);
  G.dl = dl; G.lb = lb; G.db = db;

  // defensive call
  var r = SG.rand(), longYds = o.togo >= 8 && o.down >= 3;
  G.defCall = r < (longYds ? 0.3 : 0.45) ? 'man' : r < (longYds ? 0.75 : 0.8) ? 'zone' : 'blitz';
  if (o.conv || Lx > 90) G.defCall = SG.rand() < 0.6 ? 'man' : 'blitz';
  dl.forEach(function (d) { d.rush = true; });
  var lbTE = teSide > 0 ? lb[2] : lb[0], lbOther = teSide > 0 ? lb[0] : lb[2];
  if (G.defCall === 'zone') {
    var leftCB = cb1.y < cb2.y ? cb1 : cb2, rightCB = leftCB === cb1 ? cb2 : cb1;
    leftCB.zone = { x: 16, y: 9, r: 11, deep: true };
    rightCB.zone = { x: 16, y: FW - 9, r: 11, deep: true };
    s2.zone = { x: 17, y: MIDY, r: 12, deep: true };
    s1.zone = { x: 5, y: slotY < C ? 8 : FW - 8, r: 8 };
    lb[1].zone = { x: 7, y: C - 5, r: 6.5 };
    lbTE.zone = { x: 7, y: C + 5 * teSide, r: 6.5 };
    lbOther.zone = { x: 5, y: lbOther === lb[0] ? Math.min(C - 10, 9) : Math.max(C + 10, FW - 9), r: 8 };
    if (lbOther.zone.y === s1.zone.y) lbOther.zone = { x: 7, y: C - 5 * teSide, r: 6.5 };
  } else {
    cb1.assign = w1; cb2.assign = w2; s1.assign = w3; lbTE.assign = te;
    s2.zone = { x: 14, y: MIDY, r: 18, deep: true };
    lb[1].assign = rb;
    lbOther.zone = { x: 6, y: lbOther.y, r: 7 };
    if (G.defCall === 'blitz') {
      lbOther.rush = true; lbOther.zone = null;
      if (SG.rand() < 0.5) { lb[1].rush = true; lb[1].assign = null; }
    }
  }
  if (run) { DEF.forEach(function (d) { d.runReact = 0.18 + (1 - clamp((d.pl.skl - 40) / 60, 0, 1)) * 0.35; }); }

  ball.st = 'held'; ball.holder = null; ball.x = Lx; ball.y = C; ball.z = 0.3;
  aim.on = false;
  // camera
  cam.x = clampCamX(Lx + halfAlong() * 0.45);
  cam.y = clampCamY(C);
  mode = 'field';
};

F.snap = function () {
  if (!G || G.phase !== 'pre') return;
  G.phase = 'live'; G.t = 0;
  ball.st = 'snap'; ball.t = 0; ball.holder = null;
  emit('snap');
  // pass protection / run blocking assignments
  var dl = G.dl.slice(), ol = G.ol, used = [];
  dl.forEach(function (d) {
    var best = null, bd = 99;
    ol.forEach(function (o) { if (used.indexOf(o) < 0) { var dd = Math.abs(o.y - d.y); if (dd < bd) { bd = dd; best = o; } } });
    if (best) { used.push(best); best.blk = d; }
  });
  var spare = ol.filter(function (o) { return used.indexOf(o) < 0; })[0];
  var dpen = [0.6, 0, -0.45][F.difficulty];
  DEF.forEach(function (d) {
    if (!d.rush) return;
    var blocker = null;
    OFF.forEach(function (o) { if (o.blk === d) blocker = o; });
    if (!blocker) { d.shedT = 0; return; }
    var bl = blocker.pl.str * 0.6 + blocker.pl.skl * 0.4, rs = d.pl.str * 0.5 + d.pl.skl * 0.5;
    d.shedT = G.run ? clamp(1.0 + (bl - rs) * 0.03 + SG.rf(-0.4, 1.3) + dpen * 0.5, 0.5, 3.6)
      : clamp(2.6 + (bl - rs) * 0.045 + SG.rf(-0.6, 1.4) + dpen, 1.1, 6.5);
  });
  if (spare) {
    if (G.run) {
      var lbt = nearest(spare, G.lb, null);
      if (lbt) { spare.blk = lbt; lbt.shedT = SG.rf(0.9, 2.2); }
    } else {
      var hard = G.dl.slice().sort(function (a, b) { return (b.pl.str + b.pl.skl) - (a.pl.str + a.pl.skl); })[0];
      spare.blk = hard; hard.shedT += 1.6;
    }
  }
  if (G.run) {
    // receivers and tight end seal the edge
    [G.wr[0], G.wr[1], G.wr[2], G.te].forEach(function (o) {
      var t = nearest(o, G.db.concat(G.lb), 'unblocked');
      if (t) { o.blk = t; t.shedT = SG.rf(1.0, 2.6); }
    });
    G.lb.forEach(function (l) { if (l.shedT === 99) l.shedT = 0; });
  } else if (G.defCall === 'blitz') {
    var bz = DEF.filter(function (d) { return d.rush && d.role !== 'DL'; })[0];
    if (bz) { G.rb.blk = bz; G.rb.route = null; G.rb.path = null; bz.shedT = SG.rf(0.8, 2.0); }
  }
};

function nearest(e, list, filter) {
  var best = null, bd = 1e9;
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (d.down) continue;
    if (filter === 'unblocked') {
      var taken = false;
      for (var j = 0; j < OFF.length; j++) if (OFF[j].blk === d) { taken = true; break; }
      if (taken) continue;
    }
    var dd = (d.x - e.x) * (d.x - e.x) + (d.y - e.y) * (d.y - e.y);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}
function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

// =====================================================================
// Movement
// =====================================================================
function steer(e, tx, ty, sp, dt, hard) {
  var dx = tx - e.x, dy = ty - e.y, d = Math.sqrt(dx * dx + dy * dy);
  var dvx, dvy;
  if (d < 0.05) { dvx = 0; dvy = 0; }
  else {
    var s = sp;
    if (d < 1.2 && !hard) s = sp * (d / 1.2);
    dvx = dx / d * s; dvy = dy / d * s;
  }
  accel(e, dvx, dvy, dt);
}
function accel(e, dvx, dvy, dt) {
  var ax = dvx - e.vx, ay = dvy - e.vy, a = Math.sqrt(ax * ax + ay * ay), lim = 18 * dt;
  if (a > lim) { ax = ax / a * lim; ay = ay / a * lim; }
  e.vx += ax; e.vy += ay;
}

// =====================================================================
// Live play update
// =====================================================================
function carrier() { return ball.st === 'held' ? ball.holder : null; }
function protPoint() {
  var c = carrier();
  if (c) return c;
  return G.qb;
}

function update(dt) {
  if (!G) return;
  if (G.phase === 'pre') return;
  if (G.phase === 'live') G.t += dt;
  G.hi = (G.hi + 1) % HIST;
  var i, e;
  for (i = 0; i < ents.length; i++) { e = ents[i]; e.hx[G.hi] = e.x; e.hy[G.hi] = e.y; }

  if (G.phase === 'live') {
    updateBall(dt);
    for (i = 0; i < OFF.length; i++) offThink(OFF[i], dt);
    for (i = 0; i < DEF.length; i++) defThink(DEF[i], dt);
    blocking(dt);
  } else {
    for (i = 0; i < ents.length; i++) { e = ents[i]; accel(e, 0, 0, dt * 0.5); }
    if (ball.st === 'loose') updateBall(dt);
  }
  // integrate
  for (i = 0; i < ents.length; i++) {
    e = ents[i];
    if (e.down) { e.vx *= 0.85; e.vy *= 0.85; }
    e.x += e.vx * dt; e.y += e.vy * dt;
    e.step += Math.sqrt(e.vx * e.vx + e.vy * e.vy) * dt;
    var vsx = portrait ? e.vy : e.vx;
    if (Math.abs(vsx) > 0.6) e.face = vsx > 0 ? 1 : -1;
    if (e.whiff > 0) e.whiff -= dt;
    if (e.cool > 0) e.cool -= dt;
    if (e.thr > 0) e.thr -= dt;
    if (e.juke > 0) e.juke -= dt;
    if (e.jukeCd > 0) e.jukeCd -= dt;
  }
  separate();
  if (ball.st === 'held' && ball.holder) { ball.x = ball.holder.x; ball.y = ball.holder.y; }
  if (G.phase === 'live') rules(dt);
  else {
    G.deadT += dt;
    if (G.deadT > 1.35 && G.result && !G.reported) {
      G.reported = true;
      if (F.onResult) F.onResult(G.result);
    }
  }
}

function updateBall(dt) {
  if (ball.st === 'snap') {
    ball.t += dt;
    var u = Math.min(1, ball.t / 0.2);
    ball.x = G.los + (G.qb.x - G.los) * u; ball.y = G.spotY + (G.qb.y - G.spotY) * u; ball.z = 0.4 + u * 0.9;
    if (u >= 1) { ball.st = 'held'; ball.holder = G.qb; }
  } else if (ball.st === 'air') {
    ball.t += dt;
    var k = Math.min(1, ball.t / ball.T);
    ball.x = ball.sx + (ball.tx - ball.sx) * k;
    ball.y = ball.sy + (ball.ty - ball.sy) * k;
    ball.z = 4 * ball.h * k * (1 - k) + 1.8 * (1 - k) + 0.6 * k;
    if (k >= 1) resolvePass();
  } else if (ball.st === 'loose') {
    ball.t += dt;
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    ball.vx *= 0.94; ball.vy *= 0.94;
    ball.z = Math.abs(Math.sin(ball.t * 9)) * Math.max(0, 0.8 - ball.t);
  }
}

function offThink(o, dt) {
  if (o.down) return;
  var c = carrier();
  if (o === G.ctl && c === o) { controlCarrier(o, dt); return; }
  if (G.ballSide === 1) { pursue(o, c, dt); return; }
  if (o.blk) return;                      // handled in blocking()
  if (o.role === 'QB') {
    if (!G.run && !G.thrown && !G.scramble) {
      var dropX = G.los - 7;
      var tx = o.x > dropX + 0.3 ? dropX : o.x, ty = G.spotY;
      // slide away from the closest free rusher
      var thr = null, td = 3.2;
      DEF.forEach(function (d) { if (!d.by && !d.down) { var dd = dist(d, o); if (dd < td) { td = dd; thr = d; } } });
      if (thr && G.t > 0.6) ty = o.y + (o.y > thr.y ? 1.6 : -1.6);
      steer(o, tx, clamp(ty, 3, FW - 3), o.top * 0.7, dt);
      return;
    }
    if (G.run && !G.handed) { steer(o, G.los - 4.5, G.spotY, 2, dt); return; }
    steer(o, G.los - 6, G.spotY - G.dir * 4, o.top * 0.5, dt);
    return;
  }
  if (G.run && o === G.rb && !G.handed) {
    followPath(o, dt, o.top * 0.9);
    if (dist(o, G.qb) < 1.15 || G.t > 0.75) handoff();
    return;
  }
  if (ball.st === 'air' && o === G.intended) { steer(o, ball.tx, ball.ty, o.top, dt); return; }
  if (c && c !== o && c.side === 0 && (G.thrown || G.scramble || G.handed)) { leadBlock(o, c, dt); return; }
  if (o.path && !G.thrown) { followRoute(o, dt); return; }
  accel(o, 0, 0, dt);
}

function followPath(o, dt, sp) {
  if (!o.path) return;
  var q = o.path[Math.min(o.pi, o.path.length - 1)];
  if (Math.abs(q[0] - o.x) + Math.abs(q[1] - o.y) < 0.7 && o.pi < o.path.length - 1) o.pi++;
  q = o.path[Math.min(o.pi, o.path.length - 1)];
  steer(o, q[0], q[1], sp, dt);
}

function followRoute(o, dt) {
  if (o.done) {
    if (o.rstop) { accel(o, 0, 0, dt); return; }
    var nx = o.x + o.dirX * 10, ny = clamp(o.y + o.dirY * 10, 1.0, FW - 1.0);
    if (o.y < 1.6 || o.y > FW - 1.6) { nx = o.x + 10; ny = o.y; }
    if (nx > 109) nx = 109;
    steer(o, nx, ny, o.top, dt);
    return;
  }
  var q = o.path[o.wi];
  var dx = q[0] - o.x, dy = q[1] - o.y;
  if (dx * dx + dy * dy < 0.5) {
    if (o.wi < o.path.length - 1) o.wi++;
    else {
      o.done = true;
      var prev = o.wi > 0 ? o.path[o.wi - 1] : [o.hx[0], o.hy[0]];
      var lx2 = q[0] - prev[0], ly2 = q[1] - prev[1], l = Math.sqrt(lx2 * lx2 + ly2 * ly2) || 1;
      o.dirX = lx2 / l; o.dirY = ly2 / l;
    }
  }
  steer(o, q[0], q[1], o.top, dt);
}

function handoff() {
  G.handed = true;
  ball.holder = G.rb; ball.st = 'held';
  G.ctl = G.rb; G.steerY = null; G.ctlFree = false;
  emit('handoff');
}

function leadBlock(o, c, dt) {
  if (o.cool > 0) { steer(o, c.x + 2, o.y, o.top * 0.6, dt); return; }
  var best = null, bd = 1e9;
  for (var i = 0; i < DEF.length; i++) {
    var d = DEF[i];
    if (d.down || d.by) continue;
    var dc = dist(d, c);
    if (dc > 11) continue;
    var dd = dist(d, o) + dc * 0.6;
    if (dd < bd) { bd = dd; best = d; }
  }
  if (best && dist(best, o) < 9) { o.blk = best; best.shedT = G.t + SG.rf(0.5, 1.5); return; }
  steer(o, c.x + 3, c.y + (o.y > c.y ? 2 : -2), o.top * 0.8, dt);
}

function blocking(dt) {
  var p = protPoint();
  for (var i = 0; i < OFF.length; i++) {
    var o = OFF[i], d = o.blk;
    if (!d) continue;
    if (o.down || d.down || (d.by && G.t >= d.shedT) || (!d.by && G.t >= d.shedT && o.eng)) {
      if (d.by === o || d.by === null) d.by = null;
      o.blk = null; o.eng = false; o.cool = 0.8;
      continue;
    }
    var ux = p.x - d.x, uy = p.y - d.y, ul = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= ul; uy /= ul;
    var ax = d.x + ux * 0.85, ay = d.y + uy * 0.85;
    if (!o.eng) {
      steer(o, ax, ay, o.top, dt);
      if (dist(o, d) < 1.1) { o.eng = true; if (!d.by) d.by = o; }
      else if (dist(o, d) > 12) { o.blk = null; }
    } else {
      o.vx = d.vx; o.vy = d.vy;
      o.x += (ax - o.x) * Math.min(1, dt * 10);
      o.y += (ay - o.y) * Math.min(1, dt * 10);
      // drive the defender back on runs, let the pocket sag on passes
      var push = (o.pl.str - d.pl.str) / 30;
      if (G.run || G.handed) { d.x += clamp(push + 0.4, -0.3, 1.1) * dt; }
      else if (push < 0) { d.x -= ux * push * 0.35 * dt; d.y -= uy * push * 0.35 * dt; }
    }
  }
  // free blockers pick up loose rushers near the pocket
  if (!G.thrown && !G.run && ball.holder === G.qb) {
    for (var j = 0; j < G.ol.length; j++) {
      var b = G.ol[j];
      if (b.blk || b.cool > 0) continue;
      var t = null, td = 3.2;
      for (var k = 0; k < DEF.length; k++) {
        var dd = DEF[k];
        if (dd.down || dd.by || !dd.rush) continue;
        var q = dist(b, dd);
        if (q < td) { td = q; t = dd; }
      }
      if (t) { b.blk = t; t.shedT = G.t + SG.rf(0.6, 1.6); }
      else steer(b, G.qb.x + 2.2, b.y, b.top * 0.5, dt);
    }
  }
}

// ------------------------------------------------------------- defense
function defThink(d, dt) {
  if (d.down) return;
  var sp = d.top * (d.whiff > 0 ? 0.3 : 1);
  if (d.by) sp *= 0.12;
  var c = carrier();
  if (G.ballSide === 1) {
    // we threw a pick: everyone else escorts the returner
    if (d === c) { aiReturn(d, dt); return; }
    var near = nearest(c, OFF, null);
    if (near && dist(d, near) < 6) steer(d, near.x, near.y, sp, dt);
    else steer(d, c.x - 3, c.y + (d.y > c.y ? 3 : -3), sp, dt);
    return;
  }
  if (ball.st === 'air') {
    if (G.t - G.thrownT > d.react) {
      var tdist = Math.sqrt((d.x - ball.tx) * (d.x - ball.tx) + (d.y - ball.ty) * (d.y - ball.ty));
      if (tdist < 11 || d.assign === G.intended) { steer(d, ball.tx, ball.ty, sp, dt); return; }
      if (G.intended) { pursue(d, G.intended, dt, sp); return; }
    }
    coverage(d, dt, sp);
    return;
  }
  if (c && c.side === 0) {
    if (c === G.qb && !G.scramble && !G.run) {
      if (d.rush) { steer(d, c.x, c.y, sp, dt, true); return; }
      coverage(d, dt, sp);
      return;
    }
    if (G.run && G.t < d.runReact) { steer(d, d.x - 0.3, d.y, sp * 0.4, dt); return; }
    if (d.role === 'S' && c.x < G.los + 2 && dist(d, c) > 9) {
      steer(d, Math.max(c.x + 6, G.los + 5), c.y, sp * 0.8, dt);
      return;
    }
    pursue(d, c, dt, sp);
    return;
  }
  coverage(d, dt, sp);
}

function pursue(d, c, dt, sp) {
  if (!c) { accel(d, 0, 0, dt); return; }
  sp = sp || d.top * (d.whiff > 0 ? 0.3 : 1);
  var dd = dist(d, c), lead = clamp(dd / (sp + 0.01) * 0.65, 0, 0.9);
  steer(d, c.x + c.vx * lead, c.y + c.vy * lead, sp, dt, true);
}

function coverage(d, dt, sp) {
  if (d.rush) { steer(d, G.qb.x, G.qb.y, sp, dt, true); return; }
  if (d.assign && !d.assign.down) {
    var r = d.assign;
    var lag = Math.round((0.14 + (1 - clamp((d.pl.skl - 40) / 60, 0, 1)) * 0.3 + [0.08, 0, -0.05][F.difficulty]) * 60);
    var idx = (G.hi - lag + HIST * 4) % HIST;
    var cush = Math.max(0.7, 2.2 - G.t * 0.6);
    var inside = r.y < MIDY ? 0.6 : -0.6;
    steer(d, r.hx[idx] + cush, r.hy[idx] + inside, sp, dt);
    return;
  }
  if (d.zone) {
    var z = d.zone, zx = G.los + z.x, zy = z.y, best = null, bd = 1e9;
    for (var i = 0; i < OFF.length; i++) {
      var o = OFF[i];
      if (!o.elig) continue;
      var dz = Math.sqrt((o.x - zx) * (o.x - zx) + (o.y - zy) * (o.y - zy));
      if (dz < z.r + 1.5 && dz < bd) { bd = dz; best = o; }
    }
    if (z.deep) {
      var deepest = null;
      for (var j = 0; j < OFF.length; j++) {
        var q = OFF[j];
        if (q.elig && q.x > G.los + 8 && Math.abs(q.y - zy) < z.r + 4 && (!deepest || q.x > deepest.x)) deepest = q;
      }
      if (deepest) { steer(d, Math.max(deepest.x + 2.2, G.los + 9), deepest.y * 0.7 + zy * 0.3, sp, dt); return; }
      steer(d, Math.max(zx, d.x - 0.5), zy, sp * 0.6, dt);
      return;
    }
    if (best) steer(d, best.x + 0.9, best.y + (zy - best.y) * 0.3, sp, dt);
    else steer(d, zx, zy, sp * 0.7, dt);
    return;
  }
  // spy
  steer(d, G.los + 4, G.qb.y, sp * 0.6, dt);
}

function aiReturn(d, dt) {
  var threat = nearest(d, OFF, null), ty = d.y;
  if (threat && dist(threat, d) < 7) ty = d.y + (d.y > threat.y ? 4 : -4);
  if (ty < 3) ty = 3; if (ty > FW - 3) ty = FW - 3;
  steer(d, d.x - 10, ty, d.top * 0.97, dt);
}

// ------------------------------------------------------------- control
function controlCarrier(o, dt) {
  var sp = o.top * 0.97;
  if (o.dive > 0) {
    o.dive -= dt;
    accel(o, sp * 1.25, 0, dt * 2);
    if (o.dive <= 0) endPlay('tackle', o, null, 'dive');
    return;
  }
  // designed run path until the player takes over
  if (G.run && !G.ctlFree && o.path && o.pi < o.path.length - 1 && G.steerY === null) {
    followPath(o, dt, sp);
    return;
  }
  G.ctlFree = true;
  var vy = 0;
  if (G.steerY !== null) vy = clamp((G.steerY - o.y) * 2.6, -sp * 0.88, sp * 0.88);
  if (o.juke > 0) vy += o.jukeDir * 5.5 * (o.juke / 0.45);
  vy = clamp(vy, -sp, sp);
  var vx = Math.sqrt(Math.max(0, sp * sp - vy * vy));
  if (G.scramble && o.x < G.los - 1 && G.t < 0.9) vx *= 0.6;
  accel(o, vx, vy, dt);
}

F.juke = function () {
  var c = G && G.ctl;
  if (!c || c !== carrier() || c.jukeCd > 0 || c.dive > 0) return;
  var thr = null, td = 6;
  for (var i = 0; i < DEF.length; i++) {
    var d = DEF[i];
    if (d.down || d.x < c.x - 1) continue;
    var q = dist(d, c);
    if (q < td) { td = q; thr = d; }
  }
  c.jukeDir = thr ? (c.y >= thr.y ? 1 : -1) : (c.y < MIDY ? 1 : -1);
  if (c.y < 3) c.jukeDir = 1; if (c.y > FW - 3) c.jukeDir = -1;
  c.juke = 0.45; c.jukeCd = 1.15;
  puff(c.x, c.y, 6, '#e8f5d0');
  emit('juke');
};
F.dive = function () {
  var c = G && G.ctl;
  if (!c || c !== carrier() || c.dive > 0) return;
  c.dive = 0.32;
  emit('dive');
};

// ------------------------------------------------------------- passing
function qbMaxDist() { var a = G.qb.pl.arm; return 36 + (a - 40) * 0.45; }

function throwBall(tx, ty) {
  var qb = G.qb, dx = tx - qb.x, dy = ty - qb.y, d = Math.sqrt(dx * dx + dy * dy);
  var acc = qb.pl.skl;
  var press = false;
  for (var i = 0; i < DEF.length; i++) if (!DEF[i].by && !DEF[i].down && dist(DEF[i], qb) < 2.6) press = true;
  var sig = (0.25 + d * 0.028) * (1.32 - acc / 100) * (press ? 1.8 : 1) * [0.75, 1, 1.15][F.difficulty];
  tx += SG.gauss() * sig; ty += SG.gauss() * sig;
  ball.st = 'air'; ball.holder = null; ball.t = 0;
  ball.sx = qb.x; ball.sy = qb.y; ball.tx = tx; ball.ty = ty;
  ball.T = 0.32 + d / 24; ball.h = 0.6 + d * 0.11;
  G.thrown = true; G.thrownT = G.t; G.passer = qb; G.pressure = press;
  qb.thr = 0.35;
  // the receiver who will be closest when it lands
  var best = null, bd = 1e9;
  OFF.forEach(function (o) {
    if (!o.elig || o.down) return;
    var fx = o.x + o.vx * ball.T * 0.8, fy = o.y + o.vy * ball.T * 0.8;
    var q = (fx - tx) * (fx - tx) + (fy - ty) * (fy - ty);
    if (q < bd) { bd = q; best = o; }
  });
  G.intended = bd < 64 ? best : null;
  DEF.forEach(function (df) {
    df.react = 0.12 + (1 - clamp((df.pl.skl - 40) / 60, 0, 1)) * 0.45 + [0.12, 0, -0.06][F.difficulty];
  });
  emit('throw', { dist: d });
}

function resolvePass() {
  var bx = ball.tx, by = ball.ty;
  if (by < 0 || by > FW || bx > 110 || bx < -10) { incomplete('Out of bounds'); return; }
  var rec = null, dr = 1e9, dfn = null, dd = 1e9, i;
  for (i = 0; i < OFF.length; i++) {
    var o = OFF[i];
    if (!o.elig || o.down) continue;
    var q = Math.sqrt((o.x - bx) * (o.x - bx) + (o.y - by) * (o.y - by));
    if (q < dr) { dr = q; rec = o; }
  }
  for (i = 0; i < DEF.length; i++) {
    var d = DEF[i];
    if (d.down) continue;
    var w = Math.sqrt((d.x - bx) * (d.x - bx) + (d.y - by) * (d.y - by));
    if (w < dd) { dd = w; dfn = d; }
  }
  var pInt = dfn ? clamp(0.24 + (dfn.pl.skl - 70) * 0.006, 0.08, 0.5) * [0.7, 1, 1.15][F.difficulty] : 0;
  var defFirst = dfn && dd < 1.1 && dd < dr - 0.25;
  if (defFirst) {
    if (SG.rand() < pInt) { intercept(dfn); return; }
    if (rec && dr < 1.5 && SG.rand() < 0.2) { caught(rec); return; }
    incomplete('Broken up', dfn);
    return;
  }
  if (rec && dr <= 1.5) {
    var contest = dd < 1.4 ? (1.4 - dd) / 1.4 : 0;
    var hands = rec.pl.skl;
    var pc = 0.93 + (hands - 70) * 0.004 - dr * 0.11 - contest * (0.46 - (hands - 70) * 0.003);
    if (SG.rand() < pc) { caught(rec); return; }
    if (contest > 0.5 && SG.rand() < 0.16) { intercept(dfn); return; }
    incomplete(contest > 0.2 ? 'Broken up' : 'Dropped', contest > 0.2 ? dfn : null);
    return;
  }
  if (dfn && dd < 0.9 && SG.rand() < pInt * 0.8) { intercept(dfn); return; }
  incomplete('Incomplete');
}

function caught(r) {
  ball.st = 'held'; ball.holder = r;
  G.ctl = r; G.steerY = null; G.ctlFree = true; G.catchX = r.x;
  r.blk = null; r.eng = false;
  emit('catch', { pl: r.pl });
}

function incomplete(why, d) {
  ball.st = 'loose'; ball.t = 0; ball.holder = null;
  ball.vx = (ball.tx - ball.sx) * 0.15; ball.vy = (ball.ty - ball.sy) * 0.15;
  endPlay('inc', null, d, why);
}

function intercept(d) {
  if (!d) { incomplete('Incomplete'); return; }
  ball.st = 'held'; ball.holder = d;
  G.ballSide = 1; G.ctl = null;
  OFF.forEach(function (o) { o.blk = null; o.eng = false; });
  DEF.forEach(function (x) { x.by = null; });
  emit('int', { pl: d.pl });
  if (d.x >= 100) { endPlay('touchback', d, null, 'Touchback'); }
}

// ------------------------------------------------------------- rules
function rules(dt) {
  var c = carrier();
  if (!c) return;
  if (c.side === 0) {
    if (c === G.qb && !G.thrown && !G.scramble && !G.run) {
      for (var i = 0; i < DEF.length; i++) {
        var d = DEF[i];
        if (d.down || d.by || d.whiff > 0) continue;
        if (dist(d, c) < 0.95) {
          if (SG.rand() < 0.9 - (c.pl.spd - 60) * 0.004) { endPlay('sack', c, d); return; }
          d.whiff = 0.8; emit('broken');
        }
      }
      return;
    }
    if (c.x >= 100) { endPlay('td', c); return; }
    if (c.y <= 0 || c.y >= FW) { endPlay('oob', c); return; }
    if (c.x > G.los && !G.crossed) G.crossed = true;
    tackles(c, DEF);
  } else {
    if (c.x <= 0) { endPlay('pick6', c); return; }
    if (c.y <= 0 || c.y >= FW) { endPlay('oob', c); return; }
    tackles(c, OFF);
  }
}

function tackles(c, list) {
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (d === c || d.down || d.by || d.whiff > 0 || d.blk && d.eng) continue;
    if (dist(d, c) > 0.95) continue;
    var tk = d.role === 'DL' ? d.pl.str : d.role === 'LB' ? d.pl.skl * 0.6 + d.pl.str * 0.4 : d.side === 0 ? d.pl.str * 0.7 : d.pl.skl * 0.4 + d.pl.str * 0.6;
    var pb = 0.1 + (c.pl.str - tk) * 0.004 + (c.juke > 0 ? 0.45 : 0) + (c.side === 0 ? [0.06, 0, -0.03][F.difficulty] : -0.05);
    if (c.dive > 0) pb = 0;
    pb = clamp(pb, 0.03, 0.78);
    if (SG.rand() < pb) {
      d.whiff = 0.9; d.vx *= 0.3; d.vy *= 0.3;
      puff(d.x, d.y, 5, '#dfe9c8');
      emit('broken');
      continue;
    }
    endPlay('tackle', c, d);
    return;
  }
}

function endPlay(kind, c, d, why) {
  if (G.phase !== 'live') return;
  G.phase = 'dead'; G.deadT = 0;
  var x = c ? c.x : ball.x, y = c ? c.y : ball.y;
  if (c) { c.down = kind !== 'td' && kind !== 'pick6' && kind !== 'oob' && kind !== 'touchback'; }
  if (d && kind !== 'inc') { d.down = true; puff(c.x, c.y, 8, '#e3edd0'); }
  if (kind === 'oob') y = clamp(y, 0, FW);
  var r = {
    kind: kind, x: x, y: clamp(y, 0, FW), gain: x - G.los, why: why || '', t: G.t,
    call: G.call, thrown: G.thrown, passer: G.passer ? G.passer.pl : null,
    carrier: c ? c.pl : null, carrierRole: c ? c.role : null, side: c ? c.side : 0,
    scramble: G.scramble, handed: G.handed, defender: d ? d.pl : null, fumble: false, recovered: false
  };
  // a rare fumble on a hit
  if (kind === 'tackle' && c && c.side === 0 && why !== 'dive' && d) {
    if (SG.rand() < 0.012 + Math.max(0, d.pl.str - c.pl.str) * 0.0004) {
      r.fumble = true;
      r.recovered = SG.rand() < 0.5;
    }
  }
  if (kind === 'td') confetti(x, y);
  G.result = r;
  ptr.on = false; aim.on = false;
  emit('dead', r);
}

function separate() {
  for (var i = 0; i < ents.length; i++) {
    var a = ents[i];
    if (a.down) continue;
    for (var j = i + 1; j < ents.length; j++) {
      var b = ents[j];
      if (b.down) continue;
      if (a.blk === b || b.blk === a) continue;
      var dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 > 0.5 || d2 < 1e-6) continue;
      var d = Math.sqrt(d2), push = (0.71 - d) * 0.5;
      if (push <= 0) continue;
      dx /= d; dy /= d;
      var ca = ball.holder === a ? 0.2 : 1, cb = ball.holder === b ? 0.2 : 1;
      a.x -= dx * push * ca; a.y -= dy * push * ca;
      b.x += dx * push * cb; b.y += dy * push * cb;
    }
  }
}

// =====================================================================
// Particles
// =====================================================================
function spawnPart(x, y, z, vx, vy, vz, life, col, s) {
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p.on) continue;
    p.on = true; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.col = col; p.s = s;
    return;
  }
}
function puff(x, y, n, col) {
  for (var i = 0; i < n; i++) spawnPart(x, y, 0.2, SG.rf(-2, 2), SG.rf(-2, 2), SG.rf(1, 3), SG.rf(0.25, 0.5), col, 1);
}
function confetti(x, y) {
  var cols = [TEAM[0].c1, TEAM[0].c2, '#ffffff', '#ffd23f'];
  for (var i = 0; i < 70; i++) spawnPart(x + SG.rf(-3, 3), y + SG.rf(-3, 3), SG.rf(1, 3), SG.rf(-3, 3), SG.rf(-3, 3), SG.rf(3, 8), SG.rf(0.8, 1.6), cols[i % 4], 1);
}
function updateParts(dt) {
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p.on) continue;
    p.life -= dt;
    if (p.life <= 0) { p.on = false; continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= 14 * dt;
    if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; }
  }
}

// =====================================================================
// Input
// =====================================================================
function lowXY(ev) {
  var r = cv.getBoundingClientRect();
  return [(ev.clientX - r.left) * (LW / r.width), (ev.clientY - r.top) * (LH / r.height)];
}

function onDown(ev) {
  if (F.paused) return;
  if (ptr.on) return;
  var p = lowXY(ev);
  ptr.on = true; ptr.id = ev.pointerId; ptr.x0 = ptr.x = p[0]; ptr.y0 = ptr.y = p[1]; ptr.t0 = performance.now();
  ptr.kind = '';
  try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  if (mode === 'kick') { ptr.kind = 'kick'; return; }
  if (mode !== 'field' || !G) { ptr.on = false; return; }
  if (G.phase === 'pre') { ptr.kind = 'pre'; return; }
  if (G.phase !== 'live') { ptr.on = false; return; }
  var c = carrier();
  if (c === G.qb && !G.run && !G.thrown && !G.scramble) { ptr.kind = 'aim'; aim.on = true; aim.valid = false; updAim(); return; }
  if (c && c === G.ctl && c.side === 0) {
    ptr.kind = 'run';
    G.steerY = s2w(ptr.x, ptr.y).y;
    G.ctlFree = true;
    return;
  }
  ptr.on = false;
}

function onMove(ev) {
  if (!ptr.on || ev.pointerId !== ptr.id) return;
  var p = lowXY(ev);
  ptr.x = p[0]; ptr.y = p[1];
  if (ptr.kind === 'aim') {
    if (carrier() !== G.qb || G.thrown) { ptr.kind = ''; aim.on = false; return; }
    updAim();
  } else if (ptr.kind === 'run') {
    G.steerY = s2w(ptr.x, ptr.y).y;
    var dtm = performance.now() - ptr.t0;
    var dsx = ptr.x - ptr.x0, dsy = ptr.y - ptr.y0;
    var fwd = portrait ? -dsy : dsx;
    if (dtm < 320 && fwd > 14 && Math.abs(fwd) > Math.abs(portrait ? dsx : dsy) * 1.6) { F.dive(); ptr.kind = 'done'; }
  }
}

function onUp(ev) {
  if (!ptr.on || (ev.pointerId !== ptr.id && ev.type !== 'pointercancel')) return;
  ptr.on = false;
  var dtm = performance.now() - ptr.t0, moved = Math.abs(ptr.x - ptr.x0) + Math.abs(ptr.y - ptr.y0);
  if (ptr.kind === 'kick') { kickSwipe(ptr.x - ptr.x0, ptr.y - ptr.y0); return; }
  if (ptr.kind === 'pre') { if (moved < 16 && F.onSnapTap) F.onSnapTap(); return; }
  if (ptr.kind === 'aim') {
    aim.on = false;
    if (ev.type === 'pointercancel' || !G || G.phase !== 'live' || carrier() !== G.qb || G.thrown) return;
    if (aim.scramble) { startScramble(); return; }
    if (aim.valid) throwBall(aim.x, aim.y);
    return;
  }
  if (ptr.kind === 'run') {
    G.steerY = null;
    if (dtm < 220 && moved < 8) F.juke();
  }
}

function updAim() {
  var qb = G.qb;
  var dsx = ptr.x - ptr.x0, dsy = ptr.y - ptr.y0;
  var dxw, dyw;
  if (portrait) { dxw = -dsy; dyw = dsx; } else { dxw = dsx; dyw = dsy; }
  var len = Math.sqrt(dxw * dxw + dyw * dyw);
  var full = 0.36 * Math.min(LW, LH);
  var frac = len / full;
  if (len < 1) { aim.valid = false; aim.scramble = false; return; }
  var ux = -dxw / len, uy = -dyw / len;     // pull back to throw forward
  aim.scramble = ux < -0.45 && frac > 0.18;
  var dmax = qbMaxDist();
  var d = Math.min(1, frac) * dmax;
  aim.dist = d;
  aim.x = qb.x + ux * d; aim.y = qb.y + uy * d;
  aim.valid = frac > 0.07 && !aim.scramble;
  // who would be the target, and how open
  var best = null, bd = 1e9;
  OFF.forEach(function (o) {
    if (!o.elig || o.down) return;
    var q = (o.x - aim.x) * (o.x - aim.x) + (o.y - aim.y) * (o.y - aim.y);
    if (q < bd) { bd = q; best = o; }
  });
  aim.rec = bd < 49 ? best : null;
  if (aim.rec) {
    var nd = 99;
    DEF.forEach(function (df) { var q = dist(df, aim.rec); if (q < nd) nd = q; });
    aim.open = nd;
  }
}

function startScramble() {
  G.scramble = true;
  G.ctl = G.qb; G.steerY = null; G.ctlFree = true;
  DEF.forEach(function (d) { d.rush = true; d.assign = null; d.zone = null; d.runReact = 0; });
  emit('scramble');
}

// =====================================================================
// Kicking view
// =====================================================================
// o = { dist, leg, acc, wind (mph, + blows right), kind }
F.startKick = function (o, cb) {
  K = { o: o, cb: cb, st: 'aim', t: 0, u: 0, d: 0, h: 0, res: null, path: null };
  mode = 'kick';
  emit('kickAim', o);
};

function kickSwipe(dx, dy) {
  if (!K || K.st !== 'aim') return;
  if (-dy < 10) return;
  var o = K.o;
  var power = clamp(-dy / (LH * 0.5), 0.05, 1.4);
  var ang = Math.atan2(dx, -dy);
  var D = o.dist;
  var maxR = 37 + o.leg * 0.24;
  var R = power * maxR, Rl = R * 1.2, apex = Math.max(7, R * 0.33);
  var wob = SG.gauss() * (1.6 - o.acc / 100) * 0.55 * (D / 30) * (power > 1.08 ? 2.2 : 1);
  var aimU = Math.tan(clamp(ang, -0.6, 0.6) * 0.55) * D;
  var windU = o.wind * 0.075 * (D / 30);
  var uPost = aimU + windU + wob;
  var hPost = D < Rl ? 4 * apex * (D / Rl) * (1 - D / Rl) : -1;
  var res;
  if (hPost < 3.6) res = { good: false, why: 'Short' };
  else if (Math.abs(uPost) <= 2.95) res = { good: true, why: Math.abs(uPost) > 2.6 ? 'Off the upright... and in!' : '' };
  else if (Math.abs(uPost) <= 3.3) res = { good: false, why: 'Off the upright' };
  else res = { good: false, why: uPost < 0 ? 'Wide left' : 'Wide right' };
  K.st = 'fly'; K.t = 0; K.res = res;
  K.path = { aimU: aimU + wob, windU: windU, D: D, Rl: Rl, apex: apex, end: Math.min(Rl, D + 10) };
  emit('kick', res);
}

function updateKick(dt) {
  if (!K) return;
  K.t += dt;
  if (K.st === 'fly') {
    var p = K.path, k = Math.min(1, K.t / 1.45);
    var d = p.end * k;
    K.d = d; K.u = p.aimU * (d / p.D) + p.windU * (d / p.D) * (d / p.D);
    K.h = Math.max(0, 4 * p.apex * (d / p.Rl) * (1 - d / p.Rl));
    if (k >= 1) { K.st = 'done'; K.t = 0; emit('kickDone', K.res); }
  } else if (K.st === 'done' && K.t > 1.2) {
    K.st = 'over';
    var cb = K.cb, res = K.res;
    if (cb) cb(res);
  }
}

function renderKick() {
  var o = K.o, D = o.dist;
  var hy = Math.round(LH * 0.36), cx = Math.round(LW / 2);
  var Fk = (LH * 0.86 - hy) * 7 / 2.2;
  function X(u, d) { return cx + u / (d + 7) * Fk; }
  function Y(h, d) { return hy + (2.2 - h) / (d + 7) * Fk; }
  // night sky and stands
  lx.fillStyle = '#0b1324'; lx.fillRect(0, 0, LW, hy);
  var rnd = mulberry(7);
  var T0 = TEAM[0] || { c1: '#888', c2: '#ccc' };
  for (var y = Math.round(hy * 0.35); y < hy; y += 3) for (var x = 0; x < LW; x += 3) {
    if (rnd() < 0.6) { lx.fillStyle = rnd() < 0.5 ? T0.c1 : rnd() < 0.5 ? T0.c2 : '#5b6478'; lx.fillRect(x, y, 2, 2); }
  }
  lx.fillStyle = '#ffffff';
  for (var s = 0; s < 4; s++) { var lxp = Math.round(LW * (0.12 + s * 0.25)); lx.fillRect(lxp - 6, 4, 12, 3); lx.fillRect(lxp - 1, 7, 2, hy * 0.25); }
  // turf bands, far to near
  var far = D + 30;
  for (var d0 = Math.ceil(far / 5) * 5; d0 > -6; d0 -= 5) {
    var y0 = Math.round(Y(0, d0)), y1 = Math.round(Y(0, Math.max(-6.5, d0 - 5)));
    var inEZ = d0 > D - 10 && d0 <= D;
    lx.fillStyle = inEZ ? shade(T0.c1, 0.9) : (Math.round(d0 / 5) % 2 ? '#3b9b41' : '#358f3b');
    lx.fillRect(0, y0, LW, Math.max(1, y1 - y0));
    if (!inEZ && d0 < D - 10) { lx.fillStyle = 'rgba(244,244,238,0.8)'; lx.fillRect(0, y0, LW, 1); }
  }
  lx.fillStyle = '#ffffff'; lx.fillRect(0, Math.round(Y(0, D - 10)), LW, 1); lx.fillRect(0, Math.round(Y(0, D)), LW, 1);
  // sidelines
  lx.fillStyle = '#1d5e25';
  for (var yy = hy; yy < LH; yy++) {
    var dd = Fk * 2.2 / (yy - hy + 0.001) - 7;
    var xl = X(-FW / 2 - 4, dd), xr = X(FW / 2 + 4, dd);
    if (xl > 0) lx.fillRect(0, yy, Math.round(xl), 1);
    if (xr < LW) lx.fillRect(Math.round(xr), yy, LW - Math.round(xr), 1);
  }
  // goal posts
  var gx = X(0, D), base = Y(0, D), bar = Y(3.33, D);
  lx.fillStyle = '#ffd400';
  var pw = Math.max(1, Math.round(0.35 / (D + 7) * Fk));
  lx.fillRect(Math.round(gx - pw / 2), Math.round(bar), pw, Math.round(base - bar));
  var xl2 = Math.round(X(-3.08, D)), xr2 = Math.round(X(3.08, D)), top = Math.round(Y(13.5, D));
  lx.fillRect(xl2, Math.round(bar), xr2 - xl2 + pw, pw);
  lx.fillRect(xl2, top, pw, Math.round(bar) - top);
  lx.fillRect(xr2, top, pw, Math.round(bar) - top);
  // wind flags
  var fl = o.wind > 0 ? 1 : -1, fw = Math.min(6, 1 + Math.abs(o.wind) / 3);
  lx.fillStyle = '#ff5a3d';
  if (Math.abs(o.wind) >= 1) {
    lx.fillRect(fl > 0 ? xl2 + pw : xl2 - Math.round(fw), top, Math.round(fw), 2);
    lx.fillRect(fl > 0 ? xr2 + pw : xr2 - Math.round(fw), top, Math.round(fw), 2);
  }
  // holder and kicker
  if (TEAM[0]) {
    var sp = TEAM[0].sp[1];
    var hx = Math.round(X(-0.6, 0)), hyy = Math.round(Y(0, 0));
    var img = sp.down[0];
    lx.drawImage(img, hx - img.width + 4, hyy - img.height + 1);
    var kimg = (K.st === 'aim' ? sp.stand : sp.runA)[0];
    var kd = K.st === 'aim' ? -2.2 : -0.6;
    lx.drawImage(kimg, Math.round(X(-1.4, kd)) - 5, Math.round(Y(0, kd)) - kimg.height + 1);
  }
  // ball
  var bd = K.st === 'aim' ? 0 : K.d, bu = K.st === 'aim' ? 0 : K.u, bh = K.st === 'aim' ? 0.25 : K.h + 0.25;
  var bxp = Math.round(X(bu, bd)), byp = Math.round(Y(bh, bd));
  var shy = Math.round(Y(0, bd));
  var r = Math.max(1, Math.round(0.45 / (bd + 7) * Fk));
  lx.fillStyle = 'rgba(0,0,0,0.35)'; lx.fillRect(bxp - r, shy, r * 2, 1);
  lx.fillStyle = '#7a3e12'; lx.fillRect(bxp - r, byp - r, r * 2, Math.max(1, Math.round(r * 1.4)));
  if (r >= 2) { lx.fillStyle = '#f2f2f2'; lx.fillRect(bxp - 1, byp - r + 1, 2, 1); }
  // aim guide while waiting for the swipe
  if (K.st === 'aim') {
    lx.fillStyle = 'rgba(255,214,0,0.8)';
    for (var g2 = 1; g2 < 12; g2++) {
      var dg = D * g2 / 12, hg = 4 * Math.max(7, D * 0.33) * (dg / (D * 1.25)) * (1 - dg / (D * 1.25));
      lx.fillRect(Math.round(X(0, dg)), Math.round(Y(hg, dg)), 1, 1);
    }
  }
}

// =====================================================================
// Camera
// =====================================================================
function clampCamX(x) {
  var h = halfAlong(), lo = -14 + h, hi = 114 - h;
  return lo > hi ? 50 : clamp(x, lo, hi);
}
function clampCamY(y) {
  var h = halfAcross(), lo = -5 + h, hi = FW + 5 - h;
  return lo > hi ? MIDY : clamp(y, lo, hi);
}
function updateCam(dt) {
  if (mode === 'idle') {
    idleT += dt;
    cam.x = clampCamX(50 + Math.sin(idleT * 0.05) * 45);
    cam.y = clampCamY(MIDY + Math.sin(idleT * 0.11) * 6);
    return;
  }
  if (!G) return;
  var fx, fy;
  if (G.phase === 'pre') { fx = G.los + halfAlong() * 0.45; fy = G.spotY; }
  else {
    var bx = ball.x, by = ball.y;
    if (ball.st === 'air') { bx = ball.x * 0.6 + ball.tx * 0.4; by = ball.y * 0.6 + ball.ty * 0.4; }
    if (aim.on && aim.valid) { bx = G.qb.x * 0.5 + aim.x * 0.5; by = G.qb.y * 0.5 + aim.y * 0.5; }
    var lead = G.ballSide === 1 ? -halfAlong() * 0.25 : halfAlong() * 0.3;
    if (!G.thrown && !G.handed && !G.scramble && !G.run) lead = halfAlong() * 0.45;
    fx = bx + lead; fy = by;
  }
  var k = Math.min(1, dt * 3.2);
  cam.x += (clampCamX(fx) - cam.x) * k;
  cam.y += (clampCamY(fy) - cam.y) * k;
}

// =====================================================================
// Rendering
// =====================================================================
function render() {
  lx.setTransform(1, 0, 0, 1, 0, 0);
  lx.fillStyle = '#121a28';
  lx.fillRect(0, 0, LW, LH);
  if (mode === 'kick' && K) { renderKick(); blit(); return; }
  if (fc) {
    var e, f;
    if (portrait) {
      e = Math.round((FY0 - cam.y) * P + cx0);
      f = Math.round((cam.x - FX0) * P + cy0);
      lx.setTransform(0, -1, 1, 0, e, f);
    } else {
      e = Math.round((FX0 - cam.x) * P + cx0);
      f = Math.round((FY0 - cam.y) * P + cy0);
      lx.setTransform(1, 0, 0, 1, e, f);
    }
    lx.drawImage(fc, 0, 0);
    lx.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (mode === 'field' && G) {
    lineAcross(G.los, '#3f7bff');
    if (!G.conv && G.los + G.togo < 100) lineAcross(G.los + G.togo, '#ffd400');
    if (G.phase === 'pre') drawRoutes();
    drawPlayers();
    drawBall();
    if (aim.on) drawAim();
  }
  drawParts();
  blit();
}
function blit() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(low, 0, 0, LW * S, LH * S);
}

function lineAcross(x, col) {
  lx.fillStyle = col;
  var a = wx(x, 0), b = wy(x, 0), c = wx(x, FW), d = wy(x, FW);
  if (portrait) lx.fillRect(Math.round(Math.min(a, c)), Math.round(b), Math.round(Math.abs(c - a)), 1);
  else lx.fillRect(Math.round(a), Math.round(Math.min(b, d)), 1, Math.round(Math.abs(d - b)));
}

function dots(x0, y0, x1, y1, col, gap) {
  var dx = x1 - x0, dy = y1 - y0, l = Math.sqrt(dx * dx + dy * dy), n = Math.floor(l / gap);
  lx.fillStyle = col;
  for (var i = 0; i <= n; i++) {
    var t = n ? i / n : 0, x = x0 + dx * t, y = y0 + dy * t;
    lx.fillRect(Math.round(wx(x, y)), Math.round(wy(x, y)), 1, 1);
  }
}

function drawRoutes() {
  for (var i = 0; i < OFF.length; i++) {
    var o = OFF[i];
    if (!o.path) continue;
    var px0 = o.x, py0 = o.y, col = o.role === 'RB' && G.run ? '#ffd400' : 'rgba(255,255,255,0.85)';
    for (var k = 0; k < o.path.length; k++) {
      dots(px0, py0, o.path[k][0], o.path[k][1], col, 0.8);
      px0 = o.path[k][0]; py0 = o.path[k][1];
    }
    if (!ROUTES[o.route] || !ROUTES[o.route].stop) {
      var a = o.path.length > 1 ? o.path[o.path.length - 2] : [o.x, o.y];
      var b = o.path[o.path.length - 1];
      var lx2 = b[0] - a[0], ly2 = b[1] - a[1], l = Math.sqrt(lx2 * lx2 + ly2 * ly2) || 1;
      arrowHead(b[0], b[1], lx2 / l, ly2 / l, col);
    } else {
      var e2 = o.path[o.path.length - 1];
      lx.fillStyle = col;
      lx.fillRect(Math.round(wx(e2[0], e2[1])) - 1, Math.round(wy(e2[0], e2[1])) - 1, 3, 1);
    }
  }
}
function arrowHead(x, y, ux, uy, col) {
  lx.fillStyle = col;
  var sx = Math.round(wx(x, y)), sy = Math.round(wy(x, y));
  var dxs = portrait ? uy : ux, dys = portrait ? -ux : uy;
  for (var i = 1; i <= 2; i++) {
    lx.fillRect(Math.round(sx - dxs * i - dys * i), Math.round(sy - dys * i + dxs * i), 1, 1);
    lx.fillRect(Math.round(sx - dxs * i + dys * i), Math.round(sy - dys * i - dxs * i), 1, 1);
  }
}

function drawPlayers() {
  order.length = 0;
  for (var i = 0; i < ents.length; i++) order.push(ents[i]);
  for (i = 1; i < order.length; i++) {
    var e = order[i], k = i - 1, ey = wy(e.x, e.y);
    while (k >= 0 && wy(order[k].x, order[k].y) > ey) { order[k + 1] = order[k]; k--; }
    order[k + 1] = e;
  }
  var c = carrier();
  // highlight the aim target
  if (aim.on && aim.valid && aim.rec) {
    var col = aim.open > 2.5 ? '#53d06a' : aim.open > 1.3 ? '#ffd400' : '#ff5a5f';
    ring(wx(aim.rec.x, aim.rec.y), wy(aim.rec.x, aim.rec.y), 5, col);
  }
  for (i = 0; i < order.length; i++) {
    var p = order[i];
    var sx = Math.round(wx(p.x, p.y)), sy = Math.round(wy(p.x, p.y));
    if (sx < -20 || sx > LW + 20 || sy < -24 || sy > LH + 20) continue;
    lx.fillStyle = 'rgba(0,0,0,0.3)';
    lx.fillRect(sx - 4, sy - 1, 8, 2);
    var T = TEAM[p.side];
    if (!T) continue;
    var fr;
    if (p.down) fr = 'down';
    else if (p.thr > 0) fr = 'thr';
    else if (p.vx * p.vx + p.vy * p.vy > 0.4) fr = Math.floor(p.step / 0.55) % 2 ? 'runA' : 'runB';
    else fr = 'stand';
    var img = T.sp[p.skin][fr][p.face > 0 ? 0 : 1];
    lx.drawImage(img, sx - (img.width >> 1), sy - img.height + 2);
    if (p === c && ball.st === 'held' && !p.down) {
      lx.fillStyle = '#7a3e12';
      lx.fillRect(sx + (p.face > 0 ? 2 : -4), sy - 8, 3, 2);
    }
    if (p === G.ctl && p === c && p.side === 0 && !p.down) {
      lx.fillStyle = '#ffd400';
      lx.fillRect(sx - 2, sy - 21, 5, 1); lx.fillRect(sx - 1, sy - 20, 3, 1); lx.fillRect(sx, sy - 19, 1, 1);
    }
  }
}
function ring(cx, cy, r, col) {
  lx.fillStyle = col;
  cx = Math.round(cx); cy = Math.round(cy);
  for (var a = 0; a < 16; a++) {
    var t = a / 16 * 6.2832;
    lx.fillRect(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r * 0.5), 1, 1);
  }
}

function drawBall() {
  if (ball.st === 'held' && ball.holder) return;
  if (ball.st === 'dead') return;
  var sx = Math.round(wx(ball.x, ball.y)), sy = Math.round(wy(ball.x, ball.y));
  lx.fillStyle = 'rgba(0,0,0,0.35)';
  lx.fillRect(sx - 1, sy, 3, 1);
  var by = Math.round(sy - ball.z * P * 0.8);
  lx.fillStyle = '#7a3e12';
  lx.fillRect(sx - 1, by - 1, 3, 2);
  lx.fillStyle = '#f2f2f2';
  lx.fillRect(sx, by - 1, 1, 1);
}

function drawAim() {
  if (!aim.valid && !aim.scramble) return;
  var qb = G.qb;
  if (aim.scramble) {
    lx.fillStyle = '#ffd400';
    var sx = Math.round(wx(qb.x, qb.y)), sy = Math.round(wy(qb.x, qb.y));
    for (var i = 0; i < 3; i++) {
      var ax = portrait ? 0 : 1, ay = portrait ? -1 : 0;
      var cxp = sx + ax * (8 + i * 4), cyp = sy - 8 + ay * (8 + i * 4);
      lx.fillRect(cxp - 1, cyp - 1, 3, 3);
    }
    return;
  }
  var n = 22, h = 0.6 + aim.dist * 0.11;
  lx.fillStyle = '#ffd400';
  for (var k = 1; k < n; k++) {
    var t = k / n, x = qb.x + (aim.x - qb.x) * t, y = qb.y + (aim.y - qb.y) * t;
    var z = 4 * h * t * (1 - t) + 1.8 * (1 - t);
    lx.fillRect(Math.round(wx(x, y)), Math.round(wy(x, y) - z * P * 0.8), 1, 1);
  }
  var tx = Math.round(wx(aim.x, aim.y)), ty = Math.round(wy(aim.x, aim.y));
  lx.fillRect(tx - 3, ty, 2, 1); lx.fillRect(tx + 2, ty, 2, 1);
  lx.fillRect(tx, ty - 2, 1, 1); lx.fillRect(tx, ty + 2, 1, 1);
}

function drawParts() {
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p.on) continue;
    var sx = Math.round(wx(p.x, p.y)), sy = Math.round(wy(p.x, p.y) - p.z * P * 0.8);
    lx.fillStyle = p.col;
    lx.fillRect(sx, sy, p.s, p.s);
  }
}

// =====================================================================
// Frame loop
// =====================================================================
var last = 0, accT = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
  last = ts;
  if (!F.paused) {
    accT += dt;
    var n = 0;
    while (accT >= STEP && n < 4) {
      if (mode === 'field') update(STEP);
      else if (mode === 'kick') updateKick(STEP);
      updateParts(STEP);
      accT -= STEP; n++;
    }
    if (n >= 4) accT = 0;
    updateCam(dt);
  }
  try { render(); } catch (e) { /* keep the loop alive */ }
}

// Small read-only view for the HUD, plus hooks for the headless balance test.
F.state = function () { return G; };
F.debug = {
  step: function (dt) { update(dt || STEP); },
  throwTo: function (x, y) { throwBall(x, y); },
  ents: function () { return { off: OFF, def: DEF }; },
  ball: function () { return ball; },
  carrier: carrier,
  scramble: startScramble
};
F.mode = function () { return mode; };
F.ballOn = function () { return ball; };
})();
