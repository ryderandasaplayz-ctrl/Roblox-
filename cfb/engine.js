// Gridiron Glory - on-field match engine (canvas). GG.Match.start(cfg, onDone)
(function (GG) {
  'use strict';
  var W = 960, H = 540, S = 10, FW = 53.3, OY = (H - FW * S) / 2;
  var rand = GG.rand, clamp = GG.clamp, pick = GG.pick;

  var ROUTES = {
    go: [[22, 0], [45, 0]], slant: [[3, 0], [14, 9]], out: [[9, 0], [9, -9]], dig: [[11, 0], [11, 14]],
    post: [[11, 0], [30, 9]], corner: [[11, 0], [24, -10]], curl: [[10, 0], [8, 1]], comeback: [[14, 0], [11, -4]],
    seam: [[30, 0], [45, 1]], drag: [[2, 0], [5, 20]], flat: [[1, -5], [3, -14]], wheel: [[1, -6], [12, -10], [35, -10]],
    hitch: [[6, 0], [5, 0]], cross: [[5, 0], [12, 22]]
  };
  var WR_R = ['go', 'slant', 'out', 'dig', 'post', 'corner', 'curl', 'comeback', 'hitch'];
  var SLOT_R = ['slant', 'seam', 'out', 'drag', 'cross', 'post', 'hitch', 'curl'];
  var RB_R = ['flat', 'wheel', 'hitch', 'drag'];
  var STOP_ROUTES = { curl: 1, comeback: 1, hitch: 1 };

  var M = null, cv, ctx, hud, loopOn = false, lastT = 0, keys = {};

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  // ---------------- audio ----------------
  var AC = null;
  function beep(f, d, type, vol) {
    try {
      if (GG.muted) return;
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      var o = AC.createOscillator(), g = AC.createGain();
      o.type = type || 'square'; o.frequency.value = f; g.gain.value = vol || 0.05;
      o.connect(g); g.connect(AC.destination); o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + d); o.stop(AC.currentTime + d);
    } catch (e) { }
  }
  GG.sfx = {
    whistle: function () { beep(2200, .25, 'sine', .04); setTimeout(function () { beep(2200, .3, 'sine', .04); }, 120); },
    throw: function () { beep(500, .08); }, catch: function () { beep(880, .1); },
    hit: function () { beep(90, .18, 'sawtooth', .08); }, td: function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { beep(f, .18); }, i * 110); }); },
    bad: function () { beep(160, .3, 'triangle', .07); }, click: function () { beep(660, .04, 'square', .03); }
  };

  // ---------------- setup ----------------
  function start(cfg, onDone) {
    cv = document.getElementById('gg-canvas'); ctx = cv.getContext('2d');
    hud = document.getElementById('gg-hud'); hud.innerHTML = ''; hud.hidden = false;
    cv.hidden = false;
    var me = cfg.me || null;
    M = {
      cfg: cfg, onDone: onDone, me: me,
      user: cfg.user, opp: cfg.opp, // {name, ab, c1, c2, off, def}
      score: (cfg.startScore || [0, 0]).slice(), drivesLeft: [cfg.drives || 6, cfg.drives || 6], driveNo: 0,
      state: 'idle', t: 0, ents: [], ball: null, msgs: [], flash: 0,
      stats: { comp: 0, att: 0, passYds: 0, passTD: 0, int: 0, car: 0, rushYds: 0, rushTD: 0, rec: 0, recYds: 0, recTD: 0, sacks: 0, fumbles: 0 },
      my: { comp: 0, att: 0, passYds: 0, passTD: 0, int: 0, car: 0, rushYds: 0, rushTD: 0, rec: 0, recYds: 0, recTD: 0 },
      camX: 35, ot: false, particles: []
    };
    buildHud();
    if (!loopOn) { loopOn = true; lastT = performance.now(); requestAnimationFrame(loop); }
    // Coin toss: user gets ball first or second
    var userFirst = Math.random() < 0.5;
    banner((userFirst ? 'You receive' : M.opp.ab + ' receives') + ' the opening kickoff', 1600, function () {
      if (userFirst) startUserDrive(35); else oppDrive(function () { startUserDrive(35); });
    });
  }

  function stop() {
    M = null; hud.hidden = true; hud.innerHTML = ''; cv.hidden = true;
  }

  // ---------------- HUD ----------------
  function buildHud() {
    var u = M.user, o = M.opp;
    hud.innerHTML =
      '<div class="sb">' +
      '<div class="sbt" style="background:' + u.c1 + ';color:' + u.c2 + '"><b>' + u.ab + '</b><span id="sb-u">0</span></div>' +
      '<div class="sbm"><div id="sb-down">--</div><div id="sb-drive" class="dim">--</div></div>' +
      '<div class="sbt" style="background:' + o.c1 + ';color:' + o.c2 + '"><span id="sb-o">0</span><b>' + o.ab + '</b></div>' +
      '</div>' +
      '<div id="sb-ctrl" class="ctrl"></div>' +
      '<div id="sb-ban" class="ban" hidden></div>' +
      '<div id="sb-tip" class="tip"></div>' +
      '<button id="sb-quit" class="mini quit">II</button>';
    document.getElementById('sb-quit').onclick = pauseMenu;
    updHud();
  }
  function updHud() {
    if (!M) return;
    document.getElementById('sb-u').textContent = M.score[0];
    document.getElementById('sb-o').textContent = M.score[1];
    var d = M.drive;
    var dn = document.getElementById('sb-down');
    if (d && M.state !== 'opp') {
      var togo = d.first >= 110 ? 'Goal' : Math.round(d.first - d.los);
      dn.textContent = ['1st', '2nd', '3rd', '4th'][d.down - 1] + ' & ' + togo + ' | ' + spotStr(d.los);
    } else dn.textContent = M.ot ? 'OVERTIME' : '';
    var left = Math.max(M.drivesLeft[0], 0);
    document.getElementById('sb-drive').textContent = M.ot ? 'Sudden death drives' : 'Your drives left: ' + left + ' | Opp: ' + Math.max(M.drivesLeft[1], 0);
  }
  function spotStr(x) { var y = Math.round(x - 10); return y < 50 ? 'Own ' + y : y === 50 ? '50' : 'Opp ' + (100 - y); }
  function ctrl(html) { var c = document.getElementById('sb-ctrl'); c.innerHTML = html || ''; return c; }
  function tip(t) { var e = document.getElementById('sb-tip'); if (e) e.textContent = t || ''; }
  function banner(text, ms, cb, big) {
    var b = document.getElementById('sb-ban'); if (!b) return;
    b.innerHTML = text; b.hidden = false; b.className = 'ban' + (big ? ' big' : '');
    setTimeout(function () { if (!M) return; b.hidden = true; if (cb) cb(); }, ms);
  }
  function pauseMenu() {
    if (!M || M.paused) return;
    M.paused = true;
    var c = el('div', 'pause');
    c.innerHTML = '<h2>Paused</h2><button id="pz-r">Resume</button><button id="pz-s" class="alt">Sim rest of game</button><button id="pz-m" class="alt">' + (GG.muted ? 'Sound: Off' : 'Sound: On') + '</button>';
    hud.appendChild(c);
    c.querySelector('#pz-r').onclick = function () { c.remove(); M.paused = false; lastT = performance.now(); };
    c.querySelector('#pz-m').onclick = function () { GG.muted = !GG.muted; this.textContent = GG.muted ? 'Sound: Off' : 'Sound: On'; };
    c.querySelector('#pz-s').onclick = function () { c.remove(); M.paused = false; simRest(); };
  }

  // ---------------- drives ----------------
  function startUserDrive(los) {
    if (!M) return;
    if (checkEnd()) return;
    M.drivesLeft[0]--;
    M.drive = { los: los, first: Math.min(los + 10, 110), down: 1, plays: 0 };
    updHud();
    callPlay();
  }

  function offR() { return M.user.off; }
  function defR() { return M.opp.def; }

  function oppDrive(cb) {
    if (!M) return;
    if (checkEnd()) return;
    M.drivesLeft[1]--;
    M.state = 'opp'; M.drive = null; updHud(); ctrl('');
    var r = simDriveResult(M.opp.off, M.user.def + (M.cfg.defBoost || 0));
    var txt = M.opp.ab + ' ball... ';
    if (r === 'TD') { M.score[1] += 7; txt += '<b>TOUCHDOWN ' + M.opp.ab + '</b>'; GG.sfx.bad(); }
    else if (r === 'FG') { M.score[1] += 3; txt += 'Field goal is good. +3'; }
    else if (r === 'INT') txt += '<b>INTERCEPTED by your defense!</b>';
    else if (r === 'FUM') txt += '<b>FUMBLE recovered by your defense!</b>';
    else if (r === 'MISS') txt += 'Field goal is NO GOOD!';
    else txt += 'Your defense forces a punt.';
    updHud();
    var startLos = r === 'INT' || r === 'FUM' ? GG.ri(35, 60) : r === 'MISS' ? GG.ri(35, 45) : r === 'PUNT' ? GG.ri(25, 42) : 35;
    banner(txt, 2200, function () { if (cb) cb(startLos); else startUserDrive(startLos); });
  }
  function simDriveResult(off, def) {
    var d = off - def;
    var pTD = clamp(0.30 + d * 0.013, 0.08, 0.7), pFG = 0.17, pTO = clamp(0.12 - d * 0.004, 0.04, 0.25), pMiss = 0.04;
    var x = Math.random();
    if (x < pTD) return 'TD'; x -= pTD;
    if (x < pFG) return 'FG'; x -= pFG;
    if (x < pMiss) return 'MISS'; x -= pMiss;
    if (x < pTO) return Math.random() < 0.6 ? 'INT' : 'FUM';
    return 'PUNT';
  }

  function endUserDrive(reason, nextLosForOpp) {
    if (!M) return;
    M.drive = null; ctrl(''); tip('');
    setTimeout(function () { if (!M) return; oppDrive(function (los) { startUserDrive(los); }); }, 300);
  }

  function checkEnd() {
    if (M.drivesLeft[0] > 0 || M.drivesLeft[1] > 0) return false;
    if (M.score[0] === M.score[1]) {
      M.ot = true; M.drivesLeft = [1, 1];
      banner('OVERTIME!', 1500, function () { startUserDrive(75); }, true);
      return true;
    }
    finish();
    return true;
  }

  function finish() {
    var won = M.score[0] > M.score[1];
    var res = { us: M.score[0], them: M.score[1], won: won, stats: M.stats, my: M.my };
    var cb = M.onDone;
    GG.sfx.whistle();
    ctrl('');
    banner('<div>FINAL</div><div class="fs">' + M.user.ab + ' ' + M.score[0] + ' - ' + M.score[1] + ' ' + M.opp.ab + '</div>' + (won ? '<div class="good">VICTORY</div>' : '<div class="badc">DEFEAT</div>'), 2600, function () {
      stop(); cb(res);
    }, true);
  }

  function simRest() {
    // Finish remaining drives instantly
    M.state = 'opp'; M.ents = []; M.ball = null; ctrl('');
    var guard = 0;
    while ((M.drivesLeft[0] > 0 || M.drivesLeft[1] > 0 || M.score[0] === M.score[1]) && guard++ < 40) {
      if (M.drivesLeft[0] <= 0 && M.drivesLeft[1] <= 0) M.drivesLeft = [1, 1];
      if (M.drivesLeft[0] > 0) {
        M.drivesLeft[0]--;
        var r = simDriveResult(M.user.off, M.opp.def);
        if (r === 'TD') { M.score[0] += 7; addSimStats(1); } else if (r === 'FG') { M.score[0] += 3; addSimStats(0.5); } else addSimStats(0.2);
      }
      if (M.drivesLeft[1] > 0) {
        M.drivesLeft[1]--;
        var r2 = simDriveResult(M.opp.off, M.user.def);
        if (r2 === 'TD') M.score[1] += 7; else if (r2 === 'FG') M.score[1] += 3;
      }
    }
    finish();
  }
  function addSimStats(q) {
    var s = M.stats, my = M.my, pos = M.me && M.me.pos;
    var py = Math.round(rand(20, 60) * (0.5 + q)), ry = Math.round(rand(5, 35) * (0.5 + q)), td = q >= 1 ? 1 : 0;
    var passTD = td && Math.random() < 0.6;
    s.att += 5; s.comp += 3; s.passYds += py; s.car += 3; s.rushYds += ry; if (passTD) s.passTD++; else if (td) s.rushTD++;
    if (pos === 'QB') { my.att += 5; my.comp += 3; my.passYds += py; if (passTD) my.passTD++; }
    if (pos === 'RB') { my.car += 3; my.rushYds += ry; if (td && !passTD) my.rushTD++; }
    if (pos === 'WR') { var c = Math.random() < .5 ? 1 : 2; my.rec += c; my.recYds += Math.round(py * 0.4); if (passTD && Math.random() < .4) my.recTD++; }
  }

  // ---------------- play calling ----------------
  function callPlay() {
    if (!M) return;
    M.state = 'call'; M.ball = null;
    var d = M.drive;
    setupFormation(d.los);
    var h = '<button data-p="pass">PASS</button><button data-p="run">RUN</button><button data-p="pa" class="alt">PLAY ACTION</button>';
    if (d.down === 4) {
      h = '<button data-p="pass">GO: PASS</button><button data-p="run">GO: RUN</button><button data-p="punt" class="alt">PUNT</button>';
      var dist = 110 - d.los + 17;
      if (dist <= 62) h += '<button data-p="fg" class="alt">FG (' + dist + ' yd)</button>';
    }
    var c = ctrl(h);
    Array.prototype.forEach.call(c.querySelectorAll('button'), function (b) {
      b.onclick = function () { GG.sfx.click(); choose(b.getAttribute('data-p')); };
    });
    tip(isTouch() ? 'Call a play' : 'Call a play  [P] pass  [R] run  [A] play action');
    updHud();
  }
  function choose(p) {
    if (!M || M.state !== 'call') return;
    ctrl('');
    if (p === 'punt') { banner('You punt it away.', 1200, function () { endUserDrive('punt'); }); return; }
    if (p === 'fg') { fieldGoal(110 - M.drive.los + 17, false); return; }
    setupFormation(M.drive.los, p);
    M.play = p; M.state = 'pre'; M.t = 0;
    tip(p === 'run' ? 'Hold/drag to steer the runner. Tap = juke. (Arrows + Space)' : 'Drag/hold on field to aim, release to throw. Keys 1-5 throw to receivers. [S] scramble');
    ctrl('<button id="snap" class="snap">SNAP</button>' + (p !== 'run' ? '' : ''));
    document.getElementById('snap').onclick = snap;
  }
  function isTouch() { return 'ontouchstart' in window; }

  function ent(o) {
    o.vx = 0; o.vy = 0; o.hist = []; o.stun = 0; o.anim = Math.random() * 6; o.tried = false;
    M.ents.push(o); return o;
  }
  function setupFormation(L, play) {
    M.ents = []; var mid = FW / 2, O = offR(), D = defR(), me = M.me;
    var u = M.user, o = M.opp;
    function rate(base) { return clamp(base + rand(-6, 6), 40, 99); }
    var qb = ent({ side: 'O', role: 'QB', x: L - 5, y: mid, num: 7, spd: rate(O - 8), c1: u.c1, c2: u.c2 });
    var rb = ent({ side: 'O', role: 'RB', x: L - 6, y: mid + 2.2, num: 22, spd: rate(O), str: rate(O), agi: rate(O), hnd: rate(O - 10), c1: u.c1, c2: u.c2 });
    var w1 = ent({ side: 'O', role: 'WR', key: 1, x: L - 1, y: 4, num: 1, spd: rate(O + 2), hnd: rate(O), rte: rate(O), agi: rate(O), c1: u.c1, c2: u.c2 });
    var w2 = ent({ side: 'O', role: 'WR', key: 2, x: L - 1, y: FW - 4, num: 11, spd: rate(O), hnd: rate(O), rte: rate(O), agi: rate(O), c1: u.c1, c2: u.c2 });
    var w3 = ent({ side: 'O', role: 'WR', key: 3, x: L - 1.5, y: 14, num: 84, spd: rate(O - 2), hnd: rate(O), rte: rate(O), agi: rate(O), c1: u.c1, c2: u.c2 });
    var te = ent({ side: 'O', role: 'TE', key: 4, x: L - 1, y: mid + 6, num: 88, spd: rate(O - 10), hnd: rate(O - 3), rte: rate(O - 6), agi: rate(O - 10), str: rate(O), c1: u.c1, c2: u.c2 });
    rb.key = 5;
    for (var i = 0; i < 5; i++) ent({ side: 'O', role: 'OL', x: L - 0.8, y: mid - 4 + i * 2, num: 70 + i, spd: 40, c1: u.c1, c2: u.c2, big: 1 });
    // Career player overrides
    if (me) {
      var at = me.at, tgt = me.pos === 'QB' ? qb : me.pos === 'RB' ? rb : w1;
      tgt.me = true; tgt.num = me.num;
      for (var k in at) tgt[k] = at[k];
      if (me.pos === 'QB') { qb.arm = at.arm; qb.acc = at.acc; qb.awr = at.awr; }
    }
    if (!qb.arm) { qb.arm = rate(O); qb.acc = rate(O); qb.awr = rate(O); }
    M.qb = qb; M.rb = rb; M.recv = [w1, w2, w3, te, rb];
    // Routes
    function setRoute(r, name) {
      var side = r.y < mid ? 1 : -1; // +1 means "toward middle" is +y
      r.routeName = name; r.route = ROUTES[name].map(function (p) { return { x: r.x + p[0], y: clamp(r.y + p[1] * side, 1, FW - 1) }; }); r.wp = 0;
    }
    setRoute(w1, pick(WR_R)); setRoute(w2, pick(WR_R)); setRoute(w3, pick(SLOT_R)); setRoute(te, pick(SLOT_R));
    setRoute(rb, pick(RB_R));
    if (play === 'run' || play === 'pa') { rb.route = null; }
    // Defense
    function drate() { return clamp(D + rand(-7, 7), 40, 99); }
    var dc = '#f2f2f2', dc2 = o.c1; // defense wears road whites so jerseys never clash
    [-5, -1.7, 1.7, 5].forEach(function (dy, i) { ent({ side: 'D', role: 'DL', x: L + 1, y: mid + dy, num: 90 + i, r: drate(), c1: dc, c2: dc2, big: 1 }); });
    var lb1 = ent({ side: 'D', role: 'LB', x: L + 5, y: mid - 7, num: 50, r: drate(), c1: dc, c2: dc2 });
    var lb2 = ent({ side: 'D', role: 'LB', x: L + 5, y: mid + 1, num: 54, r: drate(), c1: dc, c2: dc2 });
    var lb3 = ent({ side: 'D', role: 'LB', x: L + 5.5, y: mid + 7, num: 58, r: drate(), c1: dc, c2: dc2 });
    var cb1 = ent({ side: 'D', role: 'CB', x: L + 6, y: w1.y, num: 21, r: drate(), c1: dc, c2: dc2 });
    var cb2 = ent({ side: 'D', role: 'CB', x: L + 6, y: w2.y, num: 24, r: drate(), c1: dc, c2: dc2 });
    var nb = ent({ side: 'D', role: 'CB', x: L + 5, y: w3.y, num: 31, r: drate(), c1: dc, c2: dc2 });
    var s1 = ent({ side: 'D', role: 'S', x: L + 13, y: 16, num: 33, r: drate(), c1: dc, c2: dc2 });
    var s2 = ent({ side: 'D', role: 'S', x: L + 13, y: FW - 16, num: 36, r: drate(), c1: dc, c2: dc2 });
    cb1.man = w1; cb2.man = w2; nb.man = w3; lb3.man = te; lb2.man = rb; lb1.zone = { x: L + 7, y: mid - 6 };
    if (Math.random() < 0.25 && play !== 'run') { lb1.blitz = true; } // occasional blitz
    M.camX = L + 10;
  }

  // ---------------- snap / live play ----------------
  function snap() {
    if (!M || M.state !== 'pre') return;
    GG.sfx.click();
    M.state = 'live'; M.t = 0; M.carrier = null; M.ball = { x: M.qb.x, y: M.qb.y, h: 0, holder: M.qb };
    M.phase = M.play === 'run' ? 'hand' : 'drop';
    M.aim = null; M.juke = 0; M.jukeCd = 0; M.steer = null;
    var c = M.play === 'run' ? '' : '<button id="scr" class="alt">SCRAMBLE</button>';
    ctrl(c);
    var s = document.getElementById('scr'); if (s) s.onclick = scramble;
    // OL block time depends on offense rating and QB awareness
    M.blockT = 2.6 + (offR() - 70) * 0.03 + ((M.qb.awr || 70) - 70) * 0.02 + rand(-0.4, 0.5);
    if (M.play === 'pa') M.blockT += 0.4;
    M.ents.forEach(function (e) { if (e.side === 'D' && e.role === 'DL') e.rushDelay = M.blockT * rand(0.85, 1.15); });
  }

  function scramble() {
    if (!M || M.phase !== 'drop') return;
    M.phase = 'run'; M.carrier = M.qb; M.scrambled = true; ctrl(''); tip('Scramble! Steer with drag / arrows');
  }

  function throwTo(tx, ty) {
    if (!M || M.phase !== 'drop') return;
    var qb = M.qb;
    tx = clamp(tx, qb.x - 5, qb.x + 70); ty = clamp(ty, -2, FW + 2);
    var dx = tx - qb.x, dy = ty - qb.y, dist = Math.sqrt(dx * dx + dy * dy);
    var maxR = 38 + (qb.arm - 60) * 0.6;
    if (dist > maxR) { tx = qb.x + dx / dist * maxR; ty = qb.y + dy / dist * maxR; dist = maxR; }
    // Accuracy error grows with distance and pressure
    var pressure = 0;
    M.ents.forEach(function (e) { if (e.side === 'D' && d2(e, qb) < 9) pressure = 1; });
    var err = (100 - qb.acc) / 100 * dist * 0.09 * (1 + pressure);
    tx += rand(-err, err); ty += rand(-err, err);
    var spd = 20 + qb.arm * 0.12;
    var T = Math.max(0.35, dist / spd);
    M.ball = { x: qb.x, y: qb.y, h: 1.8, sx: qb.x, sy: qb.y, tx: tx, ty: ty, T: T, t: 0, air: true, dist: dist };
    M.phase = 'air'; M.stats.att++; if (M.me && M.me.pos === 'QB') M.my.att++;
    // Intended receiver adjusts
    var best = null, bd = 1e9;
    M.recv.forEach(function (r) { if (!r.route && r.role === 'RB' && M.play !== 'pass') return; var dd = Math.hypot(r.x + r.vx * T - tx, r.y + r.vy * T - ty); if (dd < bd) { bd = dd; best = r; } });
    if (best && bd < 9) M.intended = best; else M.intended = null;
    ctrl(''); GG.sfx.throw();
  }
  function autoThrow(key) {
    if (!M || M.phase !== 'drop') return;
    var r = M.recv.filter(function (x) { return x.key === key; })[0]; if (!r) return;
    var spd = 20 + M.qb.arm * 0.12, T = Math.hypot(r.x - M.qb.x, r.y - M.qb.y) / spd;
    for (var i = 0; i < 3; i++) { T = Math.hypot(r.x + r.vx * T - M.qb.x, r.y + r.vy * T - M.qb.y) / spd; }
    throwTo(r.x + r.vx * T, r.y + r.vy * T);
  }

  function d2(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
  function moveTo(e, tx, ty, spd, dt) {
    var dx = tx - e.x, dy = ty - e.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.05) { e.vx = 0; e.vy = 0; return; }
    var s = Math.min(spd, d / dt);
    e.vx = dx / d * s; e.vy = dy / d * s; e.x += e.vx * dt; e.y += e.vy * dt;
  }
  function speedOf(e) {
    if (e.side === 'D') return 5.6 + (e.r || 70) * 0.036;
    if (e.role === 'OL') return 3;
    return 5.9 + (e.spd || 70) * 0.037;
  }

  function updateLive(dt) {
    var L = M.drive.los, qb = M.qb, t = M.t;
    // record history for defender reaction delay
    M.ents.forEach(function (e) { e.hist.push([e.x, e.y, t]); if (e.hist.length > 40) e.hist.shift(); e.anim += dt * (Math.abs(e.vx) + Math.abs(e.vy)) * 1.2; if (e.stun > 0) e.stun -= dt; });
    if (M.juke > 0) M.juke -= dt; if (M.jukeCd > 0) M.jukeCd -= dt;

    // Offense movement
    M.ents.forEach(function (e) {
      if (e.side !== 'O' || e === M.carrier) return;
      var sp = speedOf(e);
      if (e.role === 'OL') {
        // block nearest DL
        var tg = nearest(e, 'D', ['DL', 'LB']);
        if (tg && M.phase !== 'run') moveTo(e, Math.max(L - 2.5, tg.x - 1.1), tg.y, 2.5, dt);
        else if (tg) moveTo(e, tg.x - 1, tg.y, 4, dt);
        return;
      }
      if (e === qb) {
        if (M.phase === 'drop') moveTo(e, L - 7.5, FW / 2 + (M.qbDrift || 0), 4.5, dt);
        else if (M.phase === 'hand') moveTo(e, L - 4.2, FW / 2 + 0.5, 4, dt);
        else { e.vx *= 0.9; e.vy *= 0.9; }
        return;
      }
      if (M.phase === 'air' && e === M.intended) {
        var b = M.ball, rem = b.T - b.t;
        moveTo(e, b.tx, b.ty, sp * 1.02, dt); return;
      }
      if (M.phase === 'run' && M.carrier) {
        // lead block for carrier: chase nearest defender to carrier
        var tgd = nearestTo(M.carrier, 'D', e);
        if (tgd && d2(e, M.carrier) < 225) moveTo(e, tgd.x, tgd.y, sp * 0.85, dt);
        else { e.vx *= 0.9; e.vy *= 0.9; }
        return;
      }
      if (e.role === 'RB' && M.phase === 'hand') { moveTo(e, L - 4, FW / 2 + 0.5, sp * 0.8, dt); return; }
      if (e.route && t > 0.05) {
        var wp = e.route[e.wp];
        if (wp) {
          var rs = sp * (e.role === 'TE' ? 0.9 : 1);
          if (d2(e, wp) < 0.4) { e.wp++; }
          else moveTo(e, wp.x, wp.y, rs, dt);
        } else if (STOP_ROUTES[e.routeName]) { e.vx *= 0.8; e.vy *= 0.8; }
        else { e.x += e.vx * dt; e.y += e.vy * dt; if (e.y < 1 || e.y > FW - 1) { e.vy = 0; e.y = clamp(e.y, 1, FW - 1); } }
      } else if (e.role === 'TE' || e.role === 'RB') {
        // block
        var t2 = nearest(e, 'D', ['DL', 'LB']); if (t2 && M.phase === 'drop') moveTo(e, t2.x - 1, t2.y, 3, dt);
      }
    });

    // handoff
    if (M.phase === 'hand' && t > 0.45) {
      M.phase = 'run'; M.carrier = M.rb; M.ball.holder = M.rb; M.stats.car++; if (M.rb.me) M.my.car++;
      tip('Steer: drag/hold or arrows. Tap / Space = juke');
    }

    // Carrier control
    var c = M.carrier;
    if (c && M.phase === 'run') {
      var sp2 = speedOf(c) * (M.juke > 0 ? 1.35 : 1);
      var dir = null;
      var kx = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
      var ky = (keys.ArrowDown || keys.s ? 1 : 0) - (keys.ArrowUp || keys.w ? 1 : 0);
      if (kx || ky) dir = [kx, ky];
      else if (M.steer) dir = [M.steer.x - c.x, M.steer.y - c.y];
      else dir = [1, 0];
      var dl = Math.hypot(dir[0], dir[1]) || 1;
      if (M.steer && !(kx || ky) && dl < 0.5) { c.vx *= 0.8; c.vy *= 0.8; }
      else {
        // smooth turning (agility)
        var ag = 0.12 + ((c.agi || 70) - 60) * 0.004;
        var tvx = dir[0] / dl * sp2, tvy = dir[1] / dl * sp2;
        c.vx += (tvx - c.vx) * clamp(ag * 60 * dt, 0, 1); c.vy += (tvy - c.vy) * clamp(ag * 60 * dt, 0, 1);
        c.x += c.vx * dt; c.y += c.vy * dt;
      }
      M.ball.x = c.x; M.ball.y = c.y;
      if (c.y < 0.2 || c.y > FW - 0.2) { endPlay('oob', c.x); return; }
      if (c.x >= 110) { touchdown(c); return; }
      if (c.x <= 10 && c !== qb) { endPlay('safety', c.x); return; }
      if (c === qb && !M.crossed && c.x > L) M.crossed = true;
    }

    // Defense movement
    M.ents.forEach(function (e) {
      if (e.side !== 'D') return;
      var sp = speedOf(e);
      if (e.stun > 0) { e.vx *= 0.85; e.vy *= 0.85; e.x += e.vx * dt; e.y += e.vy * dt; return; }
      if (M.phase === 'run' && c) {
        // pursuit with lead
        var react = e.role === 'DL' && t < (e.rushDelay || 0) * 0.5 ? 0.4 : 1;
        var lead = Math.sqrt(d2(e, c)) / sp * 0.6;
        moveTo(e, c.x + c.vx * lead, c.y + c.vy * lead, sp * react * (M.play === 'run' && t < 0.9 && e.role !== 'S' ? 0.5 : 1), dt);
        return;
      }
      if (M.phase === 'air') {
        var b = M.ball;
        if (Math.hypot(e.x - b.tx, e.y - b.ty) < 14 && b.t > 0.2) { moveTo(e, b.tx, b.ty, sp, dt); return; }
      }
      if (e.role === 'DL' || e.blitz) {
        var target = M.phase === 'hand' ? M.rb : qb;
        var delay = e.blitz ? 1.1 : e.rushDelay;
        if (t < delay) {
          moveTo(e, Math.max(L - 1.5, e.x - 0.2), e.y + (target.y - e.y) * 0.02, 1.2, dt);
        } else moveTo(e, target.x, target.y, sp * 0.95, dt);
        return;
      }
      if (e.man) {
        var r = e.man;
        // Reaction delay depends on route running vs coverage
        var delay2 = clamp(0.18 + ((r.rte || 70) - (e.r || 70)) * 0.008 + (M.play === 'pa' ? 0.1 : 0), 0.05, 0.5);
        var h = r.hist, ref = null;
        for (var i = h.length - 1; i >= 0; i--) { if (t - h[i][2] >= delay2) { ref = h[i]; break; } }
        var tx = ref ? ref[0] : r.x, ty = ref ? ref[1] : r.y;
        var cushion = e.role === 'CB' ? 1.2 : 0.6;
        moveTo(e, tx + cushion, ty, sp * 0.98, dt);
        return;
      }
      if (e.role === 'S') {
        // deep zone: shade toward deepest receiver on own half
        var deep = null;
        M.recv.forEach(function (rr) { if ((rr.y < FW / 2) === (e.y < FW / 2) && (!deep || rr.x > deep.x)) deep = rr; });
        var tx2 = Math.max(L + 12, deep ? deep.x + 5 : L + 12), ty2 = deep ? (e.y * 0.6 + deep.y * 0.4) : e.y;
        moveTo(e, tx2, ty2, sp * 0.8, dt); return;
      }
      if (e.zone) { var nr = null, nd = 1e9; M.recv.forEach(function (rr) { var q = d2(rr, e.zone); if (q < nd) { nd = q; nr = rr; } }); if (nr && nd < 64) moveTo(e, nr.x + 1, nr.y, sp * .8, dt); else moveTo(e, e.zone.x, e.zone.y, sp * .6, dt); }
    });

    // Sack check
    if ((M.phase === 'drop') ) {
      for (var i2 = 0; i2 < M.ents.length; i2++) {
        var e2 = M.ents[i2];
        if (e2.side === 'D' && d2(e2, qb) < 1.0) { M.stats.sacks++; GG.sfx.hit(); endPlay('sack', qb.x); return; }
      }
    }
    // Ball flight
    if (M.phase === 'air') {
      var b2 = M.ball; b2.t += dt;
      var k = Math.min(1, b2.t / b2.T);
      b2.x = b2.sx + (b2.tx - b2.sx) * k; b2.y = b2.sy + (b2.ty - b2.sy) * k; b2.h = 1.8 + Math.sin(Math.PI * k) * b2.dist * 0.12;
      if (k >= 1) resolveCatch();
    }
    // Tackles
    if (M.phase === 'run' && c) {
      for (var j = 0; j < M.ents.length; j++) {
        var e3 = M.ents[j];
        if (e3.side !== 'D' || e3.stun > 0) continue;
        if (d2(e3, c) < 0.95) {
          if (M.juke > 0) { e3.stun = 0.8; addFx(c.x, c.y, 'JUKE!'); continue; }
          var br = 0.07 + ((c.str || 65) - 60) * 0.006 - ((e3.r || 70) - 70) * 0.004 + (e3.tried ? -0.05 : 0);
          if (c === qb) br -= 0.03;
          e3.tried = true;
          if (Math.random() < br) { e3.stun = 1.0; addFx(c.x, c.y, 'BROKEN TACKLE!'); GG.sfx.hit(); continue; }
          // fumble small chance
          GG.sfx.hit();
          if (Math.random() < 0.012) { endPlay('fumble', c.x); return; }
          endPlay('tackle', c.x + (c.vx > 0 ? 0.6 : 0)); return;
        }
      }
    }
    // Camera
    var focus = M.phase === 'air' ? M.ball.x : c ? c.x : qb.x + 10;
    M.camX += (focus - M.camX) * Math.min(1, dt * 4);
  }

  function nearest(e, side, roles) {
    var best = null, bd = 1e9;
    M.ents.forEach(function (o) { if (o.side === side && roles.indexOf(o.role) >= 0) { var q = d2(o, e); if (q < bd) { bd = q; best = o; } } });
    return best;
  }
  function nearestTo(c, side, me) {
    var best = null, bd = 1e9;
    M.ents.forEach(function (o) { if (o.side === side && o.stun <= 0) { var q = d2(o, c) + d2(o, me) * 0.5; if (q < bd) { bd = q; best = o; } } });
    return best;
  }

  function resolveCatch() {
    var b = M.ball, bx = b.tx, by = b.ty;
    var rec = null, rd = 1e9, def = null, dd = 1e9;
    M.ents.forEach(function (e) {
      var q = Math.hypot(e.x - bx, e.y - by);
      if (e.side === 'O' && e.role !== 'OL' && e !== M.qb && q < rd) { rd = q; rec = e; }
      if (e.side === 'D' && q < dd) { dd = q; def = e; }
    });
    var catchR = 1.9, dR = 1.5;
    if (by < 0 || by > FW) { incomplete('Overthrown out of bounds'); return; }
    if (def && dd < dR && (!rec || dd < rd - 0.3)) {
      var pInt = 0.22 + ((def.r || 70) - 70) * 0.01;
      if (Math.random() < pInt) { interception(def); return; }
      incomplete('Pass broken up!'); return;
    }
    if (rec && rd < catchR) {
      var p = 0.62 + ((rec.hnd || 70) - 60) * 0.009 - (rd / catchR) * 0.15;
      if (def && dd < 2.5) p -= (2.5 - dd) * 0.18;
      if (b.dist > 30) p -= 0.05;
      if (Math.random() < clamp(p, 0.15, 0.97)) {
        M.phase = 'run'; M.carrier = rec; M.catchX = rec.x; M.ball.holder = rec; M.ball.air = false;
        rec.caught = true; M.stats.comp++; M.stats.rec++;
        if (M.me && M.me.pos === 'QB') M.my.comp++;
        if (rec.me) M.my.rec++;
        addFx(rec.x, rec.y, 'CATCH'); GG.sfx.catch();
        tip('Steer: drag/hold or arrows. Tap / Space = juke');
        return;
      }
      incomplete('Dropped!'); return;
    }
    incomplete('Incomplete');
  }
  function incomplete(why) { GG.sfx.bad(); endPlay('inc', M.drive.los, why); }
  function interception(def) {
    M.stats.int++; if (M.me && M.me.pos === 'QB') M.my.int++;
    GG.sfx.bad(); addFx(def.x, def.y, 'INTERCEPTED');
    endPlay('int', M.drive.los);
  }
  function addFx(x, y, txt) { M.particles.push({ x: x, y: y, txt: txt, t: 1.2 }); }

  function credit(gain, isTD) {
    var c = M.carrier, my = M.my, s = M.stats;
    if (!c) return;
    var passPlay = c.caught;
    if (passPlay) {
      s.passYds += gain; s.recYds += gain;
      if (M.me && M.me.pos === 'QB') { my.passYds += gain; if (isTD) my.passTD++; }
      if (c.me) { my.recYds += gain; if (isTD) my.recTD++; }
      if (isTD) { s.passTD++; s.recTD++; }
    } else {
      if (c === M.qb && M.scrambled) { s.car++; if (c.me) my.car++; }
      s.rushYds += gain; if (isTD) s.rushTD++;
      if (c.me) { my.rushYds += gain; if (isTD) my.rushTD++; }
    }
  }

  function touchdown(c) {
    var gain = Math.round(110 - M.drive.los);
    credit(gain, true);
    M.state = 'dead'; M.score[0] += 6; updHud(); GG.sfx.td(); M.flash = 1.2;
    var who = c.me ? M.me.name.split(' ').pop().toUpperCase() + ' ' : '';
    banner(who + 'TOUCHDOWN!', 1700, function () { extraPoint(); }, true);
  }
  function extraPoint() {
    if (!M) return;
    ctrl('<button id="xp1">KICK PAT</button><button id="xp2" class="alt">GO FOR 2</button>');
    tip('Extra point or two-point try?');
    document.getElementById('xp1').onclick = function () { ctrl(''); fieldGoal(20, true); };
    document.getElementById('xp2').onclick = function () {
      ctrl('');
      var ok = Math.random() < clamp(0.45 + (offR() - defR()) * 0.012, 0.25, 0.7);
      if (ok) M.score[0] += 2; updHud();
      banner(ok ? 'Two-point conversion GOOD!' : 'Two-point try fails.', 1400, function () { if (M.ot) checkOT(); else endUserDrive('td'); });
    };
  }
  function checkOT() {
    // In OT each side gets one drive; checkEnd handles ties
    endUserDrive('ot');
  }

  function endPlay(kind, spot, why) {
    if (M.state !== 'live') return;
    M.state = 'dead';
    var d = M.drive, L = d.los, gain = Math.round(spot - L), msg = '';
    if (kind === 'sack') { gain = Math.round(spot - L); msg = 'SACKED! ' + gain + ' yds'; }
    else if (kind === 'inc') { gain = 0; msg = why || 'Incomplete'; }
    else if (kind === 'int') { msg = 'INTERCEPTED!'; }
    else if (kind === 'fumble') { credit(gain, false); msg = 'FUMBLE! Defense recovers'; }
    else if (kind === 'safety') { M.score[1] += 2; msg = 'SAFETY!'; updHud(); }
    else { credit(gain, false); msg = (gain >= 0 ? '+' : '') + gain + ' yards' + (kind === 'oob' ? ' (out of bounds)' : ''); }
    d.plays++;
    var next = function () {
      if (!M) return;
      if (kind === 'int' || kind === 'fumble' || kind === 'safety') { endUserDrive(kind); return; }
      d.los = clamp(L + gain, 11, 109);
      if (d.los >= d.first) { d.down = 1; d.first = Math.min(d.los + 10, 110); msg = 'FIRST DOWN'; }
      else if (d.down >= 4) { banner('Turnover on downs', 1300, function () { endUserDrive('downs'); }); return; }
      else d.down++;
      callPlay();
    };
    if (gain >= 15 && kind !== 'int') { msg += ' BIG PLAY!'; }
    banner(msg, kind === 'tackle' || kind === 'oob' ? 900 : 1300, next);
  }

  // ---------------- field goal ----------------
  function fieldGoal(dist, isPat) {
    M.state = 'fg';
    var fg = M.fg = { dist: dist, pos: 0, dir: 1, spd: 1.2 + dist * 0.025, win: clamp(0.34 - dist * 0.0042, 0.08, 0.3), done: false, pat: isPat };
    ctrl('<button id="kick" class="snap">KICK!</button>');
    tip('Stop the needle in the green zone  [Space]');
    document.getElementById('kick').onclick = kick;
  }
  function kick() {
    var fg = M.fg; if (!fg || fg.done) return;
    fg.done = true; ctrl('');
    var good = Math.abs(fg.pos) < fg.win;
    if (good) { M.score[0] += fg.pat ? 1 : 3; GG.sfx.catch(); } else GG.sfx.bad();
    updHud();
    banner(good ? (fg.pat ? 'PAT good' : fg.dist + ' yd FIELD GOAL IS GOOD!') : (fg.pat ? 'PAT no good' : 'Field goal is NO GOOD'), 1400, function () { M.fg = null; endUserDrive('fg'); });
  }

  // ---------------- input ----------------
  function toWorld(ev) {
    var r = cv.getBoundingClientRect();
    var sc = Math.min(r.width / W, r.height / H), ox = (r.width - W * sc) / 2, oy = (r.height - H * sc) / 2;
    var px = (ev.clientX - r.left - ox) / sc, py = (ev.clientY - r.top - oy) / sc;
    return { x: (px - W / 2) / S + M.camX, y: (py - OY) / S };
  }
  var downAt = 0, downPos = null;
  function pdown(ev) {
    if (!M || M.paused) return;
    var w = toWorld(ev); downAt = performance.now(); downPos = w;
    if (M.state === 'pre') { snap(); return; }
    if (M.state !== 'live') return;
    if (M.phase === 'drop') M.aim = w;
    else if (M.phase === 'run') M.steer = w;
  }
  function pmove(ev) {
    if (!M || M.state !== 'live') return;
    var w = toWorld(ev);
    if (M.aim && M.phase === 'drop') M.aim = w;
    if (M.steer && M.phase === 'run') M.steer = w;
  }
  function pup(ev) {
    if (!M) return;
    var w = toWorld(ev), quick = performance.now() - downAt < 220 && downPos && Math.hypot(w.x - downPos.x, w.y - downPos.y) < 2;
    if (M.state === 'live' && M.phase === 'drop' && M.aim) { var a = M.aim; M.aim = null; throwTo(a.x, a.y); }
    else if (M.state === 'live' && M.phase === 'run') { if (quick) doJuke(); M.steer = null; }
  }
  function doJuke() {
    if (!M || M.jukeCd > 0 || !M.carrier) return;
    var c = M.carrier; M.juke = 0.3 + ((c.agi || 70) - 60) * 0.004; M.jukeCd = 1.4;
    c.y += (Math.random() < 0.5 ? -1 : 1) * 0.8; GG.sfx.click();
  }
  function kdown(ev) {
    keys[ev.key] = true;
    if (!M || M.paused) return;
    var k = ev.key.toLowerCase();
    if (M.state === 'call') { if (k === 'p') choose('pass'); if (k === 'r') choose('run'); if (k === 'a') choose('pa'); return; }
    if (M.state === 'pre' && (k === ' ' || k === 'enter')) { snap(); ev.preventDefault(); return; }
    if (M.state === 'fg' && (k === ' ' || k === 'enter')) { kick(); ev.preventDefault(); return; }
    if (M.state === 'live') {
      if (M.phase === 'drop') { if ('12345'.indexOf(k) >= 0) autoThrow(+k); if (k === 's' || k.indexOf('arrow') === 0) scramble(); }
      else if (M.phase === 'run' && k === ' ') { doJuke(); ev.preventDefault(); }
    }
    if (k === 'escape') pauseMenu();
  }
  function kup(ev) { keys[ev.key] = false; }

  // ---------------- render ----------------
  function wx(x) { return (x - M.camX) * S + W / 2; }
  function wy(y) { return y * S + OY; }

  function drawField() {
    ctx.fillStyle = '#2f7d32'; ctx.fillRect(0, 0, W, H);
    var x0 = Math.floor(M.camX - W / 2 / S) - 1, x1 = x0 + W / S + 3;
    for (var x = Math.max(0, x0 - x0 % 5); x <= Math.min(120, x1); x += 5) {
      ctx.fillStyle = (x / 5) % 2 ? '#358a38' : '#2f7d32';
      ctx.fillRect(wx(x), wy(0), 5 * S + 1, FW * S);
    }
    // endzones
    var u = M.user, o = M.opp;
    ctx.fillStyle = u.c1; ctx.fillRect(wx(0), wy(0), 10 * S, FW * S);
    ctx.fillStyle = o.c1; ctx.fillRect(wx(110), wy(0), 10 * S, FW * S);
    ctx.save(); ctx.font = 'bold 40px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = u.c2; ctx.translate(wx(5), wy(FW / 2)); ctx.rotate(-Math.PI / 2); ctx.fillText(u.ab, 0, 0); ctx.restore();
    ctx.save(); ctx.font = 'bold 40px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = o.c2; ctx.translate(wx(115), wy(FW / 2)); ctx.rotate(Math.PI / 2); ctx.fillText(o.ab, 0, 0); ctx.restore();
    // lines
    ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 2;
    for (x = 10; x <= 110; x += 5) { ctx.beginPath(); ctx.moveTo(wx(x), wy(0)); ctx.lineTo(wx(x), wy(FW)); ctx.stroke(); }
    ctx.lineWidth = 3; ctx.strokeRect(wx(0), wy(0), 120 * S, FW * S);
    ctx.fillStyle = '#ffffffcc';
    for (x = 11; x < 110; x++) { ctx.fillRect(wx(x), wy(17.8), 1, 6); ctx.fillRect(wx(x), wy(35.5) - 6, 1, 6); ctx.fillRect(wx(x), wy(0) + 2, 1, 5); ctx.fillRect(wx(x), wy(FW) - 7, 1, 5); }
    ctx.font = '14px "Press Start 2P", monospace'; ctx.textAlign = 'center';
    for (x = 20; x <= 100; x += 10) { var n = x <= 60 ? x - 10 : 110 - x; ctx.fillText(n, wx(x), wy(8)); ctx.fillText(n, wx(x), wy(FW - 6)); }
    // midfield logo
    ctx.globalAlpha = 0.25; ctx.fillStyle = u.c1; ctx.beginPath(); ctx.arc(wx(60), wy(FW / 2), 50, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    // LOS & first-down
    if (M.drive) {
      ctx.fillStyle = '#3aa0ff'; ctx.fillRect(wx(M.drive.los) - 1.5, wy(0), 3, FW * S);
      if (M.drive.first < 110) { ctx.fillStyle = '#ffd400'; ctx.fillRect(wx(M.drive.first) - 1.5, wy(0), 3, FW * S); }
    }
  }

  function drawPlayer(e) {
    var x = wx(e.x), y = wy(e.y);
    if (x < -30 || x > W + 30) return;
    var big = e.big ? 1.2 : 1, bob = Math.sin(e.anim) * 2;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y + 8, 7 * big, 3, 0, 0, 7); ctx.fill();
    // legs
    ctx.fillStyle = '#eee'; ctx.fillRect(x - 4 * big, y + 2, 3, 6 + bob); ctx.fillRect(x + 1 * big, y + 2, 3, 6 - bob);
    // body
    ctx.fillStyle = e.c1; ctx.fillRect(x - 6 * big, y - 7, 12 * big, 11);
    ctx.fillStyle = e.c2; ctx.fillRect(x - 6 * big, y - 7, 12 * big, 2);
    // helmet
    ctx.fillStyle = e.c2; ctx.beginPath(); ctx.arc(x, y - 11, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#222'; var fdir = e.side === 'O' ? 1 : -1; ctx.fillRect(x + fdir * 2, y - 12, fdir * 4, 2);
    // number
    ctx.fillStyle = e.c2; ctx.font = '6px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.fillText(e.num, x, y + 1);
    if (e.me) { ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y + 8, 11, 5, 0, 0, 7); ctx.stroke(); ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.moveTo(x - 5, y - 25); ctx.lineTo(x + 5, y - 25); ctx.lineTo(x, y - 19); ctx.fill(); }
    if (e === M.carrier) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y - 2, 12, 0, 7); ctx.stroke(); }
    if (e.stun > 0) { ctx.fillStyle = '#ffd400'; ctx.fillText('*', x + 7, y - 16); }
  }

  function drawRoutes() {
    if (!(M.state === 'pre' || (M.state === 'live' && M.phase === 'drop'))) return;
    if (M.play === 'run' && M.state === 'live') return;
    ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    M.recv.forEach(function (r) {
      if (!r.route) return;
      ctx.strokeStyle = r.me ? '#ffd400cc' : '#ffffff66';
      ctx.beginPath(); ctx.moveTo(wx(r.x), wy(r.y));
      for (var i = r.wp || 0; i < r.route.length; i++) ctx.lineTo(wx(r.route[i].x), wy(r.route[i].y));
      ctx.stroke();
      if (M.state === 'live') {
        // open indicator
        var cov = 99; M.ents.forEach(function (d) { if (d.side === 'D') cov = Math.min(cov, Math.hypot(d.x - r.x, d.y - r.y)); });
        var col = cov > 3 ? '#4cff6a' : cov > 1.7 ? '#ffd400' : '#ff4b4b';
        ctx.setLineDash([]); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(wx(r.x), wy(r.y) - 30, 8, 0, 7); ctx.fill();
        ctx.fillStyle = '#000'; ctx.font = '8px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.fillText(r.key, wx(r.x), wy(r.y) - 26); ctx.setLineDash([4, 4]);
      }
    });
    ctx.setLineDash([]);
  }

  function drawBall() {
    var b = M.ball; if (!b) return;
    var x = wx(b.x), y = wy(b.y);
    if (b.air) {
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x, y + 6, 4, 2, 0, 0, 7); ctx.fill();
      y -= b.h * 4;
      // target marker
      ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(wx(b.tx), wy(b.ty), 7, 0, 7); ctx.stroke();
    } else if (b.holder) return;
    ctx.fillStyle = '#7a3e12'; ctx.beginPath(); ctx.ellipse(x, y, 5, 3, Math.atan2(b.ty - b.sy || 0, b.tx - b.sx || 1), 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y - 0.5, 2, 1);
  }

  function drawAim() {
    if (!M.aim || M.phase !== 'drop') return;
    var qb = M.qb, a = M.aim;
    ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(wx(qb.x), wy(qb.y));
    var mx = (qb.x + a.x) / 2, my = (qb.y + a.y) / 2;
    ctx.quadraticCurveTo(wx(mx), wy(my) - Math.hypot(a.x - qb.x, a.y - qb.y) * 2.5, wx(a.x), wy(a.y)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#ffd400'; ctx.beginPath(); ctx.arc(wx(a.x), wy(a.y), 10, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wx(a.x) - 14, wy(a.y)); ctx.lineTo(wx(a.x) + 14, wy(a.y)); ctx.moveTo(wx(a.x), wy(a.y) - 14); ctx.lineTo(wx(a.x), wy(a.y) + 14); ctx.stroke();
  }

  function drawFG(dt) {
    var fg = M.fg; if (!fg) return;
    if (!fg.done) { fg.pos += fg.dir * fg.spd * dt; if (fg.pos > 1) { fg.pos = 1; fg.dir = -1; } if (fg.pos < -1) { fg.pos = -1; fg.dir = 1; } }
    var cx = W / 2, cy = 130, w = 360;
    ctx.fillStyle = '#000a'; ctx.fillRect(cx - w / 2 - 10, cy - 40, w + 20, 80);
    ctx.fillStyle = '#c33'; ctx.fillRect(cx - w / 2, cy - 10, w, 20);
    ctx.fillStyle = '#3c3'; ctx.fillRect(cx - fg.win * w / 2, cy - 10, fg.win * w, 20);
    ctx.fillStyle = '#fff'; ctx.fillRect(cx + fg.pos * w / 2 - 2, cy - 18, 4, 36);
    ctx.font = '12px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.fillText((fg.pat ? 'PAT' : fg.dist + ' YD FIELD GOAL'), cx, cy - 22);
    // posts
    ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 4; var px = wx(120), py = wy(FW / 2);
    ctx.beginPath(); ctx.moveTo(px, py - 30); ctx.lineTo(px, py + 30); ctx.stroke();
  }

  function render(dt) {
    if (!M) return;
    if (M.state === 'fg') M.camX += (105 - M.camX) * Math.min(1, dt * 3);
    if (M.state === 'opp') M.camX += (60 - M.camX) * Math.min(1, dt * 2);
    drawField();
    drawRoutes();
    var list = M.ents.slice().sort(function (a, b) { return a.y - b.y; });
    list.forEach(drawPlayer);
    drawBall(); drawAim(); drawFG(dt);
    M.particles = M.particles.filter(function (p) { p.t -= dt; return p.t > 0; });
    ctx.font = '12px "Press Start 2P", monospace'; ctx.textAlign = 'center';
    M.particles.forEach(function (p) { ctx.fillStyle = 'rgba(255,230,0,' + Math.min(1, p.t) + ')'; ctx.fillText(p.txt, wx(p.x), wy(p.y) - 34 - (1.2 - p.t) * 30); });
    if (M.flash > 0) { M.flash -= dt; ctx.fillStyle = 'rgba(255,255,255,' + (M.flash * 0.25) + ')'; ctx.fillRect(0, 0, W, H); }
    if (M.state === 'opp') {
      ctx.fillStyle = '#0008'; ctx.fillRect(0, 0, W, H);
    }
  }

  function resize() {
    var r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    var sc = Math.min(r.width / W, r.height / H);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    M.dpr = dpr; M.sc = sc; M.ox = (r.width - W * sc) / 2; M.oy = (r.height - H * sc) / 2;
  }

  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (!M) return;
    if (!M.dpr || cv.width !== Math.round(cv.getBoundingClientRect().width * (M.dpr || 1))) resize();
    if (!M.paused) {
      M.t += dt;
      if (M.state === 'live') updateLive(dt);
      else if (M.state === 'pre' || M.state === 'call') { M.camX += ((M.drive ? M.drive.los + 8 : 60) - M.camX) * Math.min(1, dt * 3); M.ents.forEach(function (e) { e.anim += dt * 0.5; }); }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#16351a'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(M.dpr * M.sc, 0, 0, M.dpr * M.sc, M.dpr * M.ox, M.dpr * M.oy);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    render(dt);
    ctx.restore();
  }

  function init() {
    cv = document.getElementById('gg-canvas'); ctx = cv.getContext('2d');
    cv.addEventListener('pointerdown', pdown); window.addEventListener('pointermove', pmove); window.addEventListener('pointerup', pup);
    window.addEventListener('keydown', kdown); window.addEventListener('keyup', kup);
    window.addEventListener('resize', function () { if (M) resize(); });
  }

  // Quick sim of a whole game without the engine
  GG.simGame = function (off, def, oppOff, oppDef, me, drives) {
    var fake = { score: [0, 0], stats: { comp: 0, att: 0, passYds: 0, passTD: 0, int: 0, car: 0, rushYds: 0, rushTD: 0, rec: 0, recYds: 0, recTD: 0 }, my: { comp: 0, att: 0, passYds: 0, passTD: 0, int: 0, car: 0, rushYds: 0, rushTD: 0, rec: 0, recYds: 0, recTD: 0 }, me: me };
    var keep = M; M = fake;
    var n = drives || 6, guard = 0;
    for (var i = 0; i < n || (fake.score[0] === fake.score[1] && guard++ < 10); i++) {
      var r = simDriveResult(off, oppDef);
      if (r === 'TD') { fake.score[0] += 7; addSimStats(1); } else if (r === 'FG') { fake.score[0] += 3; addSimStats(0.5); } else { addSimStats(0.2); if (r === 'INT' && me && me.pos === 'QB' && Math.random() < .7) fake.my.int++; }
      var r2 = simDriveResult(oppOff, def);
      if (r2 === 'TD') fake.score[1] += 7; else if (r2 === 'FG') fake.score[1] += 3;
    }
    M = keep;
    return { us: fake.score[0], them: fake.score[1], won: fake.score[0] > fake.score[1], stats: fake.stats, my: fake.my };
  };

  GG.Match = { start: start, init: init, active: function () { return !!M; } };
})(window.GG);
