/* Saturday Gridiron - ui.js
   Every screen, the in-game HUD, play-call rail, cards, banners and the
   little chiptune sound kit. Screens are HTML strings; buttons carry
   data-a="action" data-v="value" and one delegated listener runs them.
   ASCII only: use HTML entities for symbols. */
(function () {
'use strict';
var SG = window.SG, L = SG.L, F = SG.F, M = SG.M;
var UI = SG.UI = {};
var esc = SG.esc;
function $(id) { return document.getElementById(id); }
function T(i) { return SG.TEAMS[i]; }

var app, scr, hudEl, ctlEl, ctlIn, bannerEl, toastEl, cardEl, pauseEl, hintEl, kickEl;
var acts = {}, cur = '', curArg = null, playCb = null;
var bannerT = 0, toastT = 0, hintT = 0, hintT2 = 0, revealT = [];
var pick = { conf: 0, sel: -1, name: '' };
var view = { standConf: 0, open: 0, delArm: false };

// =====================================================================
// Sound: tiny square-wave and noise blips, started after the first tap
// =====================================================================
var AC = null, master = null, noiseBuf = null;
function ac() {
  if (AC) return AC;
  try {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    AC = new C(); master = AC.createGain(); master.gain.value = 0.8; master.connect(AC.destination);
  } catch (e) { AC = null; }
  return AC;
}
function tone(a, f, d, type, v, f2, delay) {
  var t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.03);
}
function noise(a, d, v, freq, q, delay, attack) {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, Math.floor(a.sampleRate * 1.6), a.sampleRate);
    var ch = noiseBuf.getChannelData(0);
    for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  var t = a.currentTime + (delay || 0), s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + (attack || 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + d + 0.05);
}
function arp(a, notes, d, gap, v) { notes.forEach(function (n, i) { tone(a, n, d, 'square', v, null, i * gap); }); }
var SFX = {
  blip: function (a) { tone(a, 880, 0.05, 'square', 0.035); },
  hut: function (a) { tone(a, 170, 0.07, 'square', 0.07); tone(a, 170, 0.07, 'square', 0.07, null, 0.15); },
  throw: function (a) { noise(a, 0.2, 0.06, 1800, 1.2); },
  catch: function (a) { arp(a, [660, 990], 0.07, 0.06, 0.05); },
  hit: function (a) { noise(a, 0.14, 0.22, 500, 0.8); tone(a, 90, 0.12, 'triangle', 0.14, 50); },
  whistle: function (a) { tone(a, 2300, 0.3, 'sine', 0.05, 2550); },
  cheer: function (a) { noise(a, 1.4, 0.08, 1400, 0.5, 0, 0.3); },
  boo: function (a) { tone(a, 160, 0.5, 'sawtooth', 0.03, 105); noise(a, 0.8, 0.03, 400, 0.6, 0, 0.2); },
  first: function (a) { arp(a, [523, 659, 784], 0.1, 0.08, 0.045); },
  td: function (a) { arp(a, [523, 659, 784, 1047], 0.17, 0.11, 0.05); noise(a, 1.8, 0.08, 1400, 0.5, 0.2, 0.3); },
  kick: function (a) { noise(a, 0.08, 0.25, 300, 0.7); tone(a, 110, 0.1, 'triangle', 0.15, 60); },
  juke: function (a) { noise(a, 0.1, 0.07, 3000, 2); },
  good: function (a) { arp(a, [784, 988, 1175, 1568], 0.12, 0.09, 0.045); },
  miss: function (a) { tone(a, 300, 0.4, 'square', 0.045, 140); },
  cash: function (a) { arp(a, [988, 1319], 0.08, 0.07, 0.04); }
};
UI.sfx = function (n) {
  if (!L.settings.sound || !SFX[n]) return;
  var a = ac();
  if (!a) return;
  try { if (a.state === 'suspended') a.resume(); SFX[n](a); } catch (e) { /* audio is optional */ }
};

// =====================================================================
// Small helpers
// =====================================================================
function lum(h) {
  var n = parseInt(h.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
function inkOn(h) { return lum(h) > 0.6 ? '#121212' : '#ffffff'; }
function helm(t, sz) {
  var c = T(t); sz = sz || 32;
  return '<svg class="helm" width="' + sz + '" height="' + Math.round(sz * 0.8) + '" viewBox="0 0 16 13" shape-rendering="crispEdges" aria-hidden="true">' +
    '<path fill="#000" d="M3 0h9v1h2v1h1v1h1v8h-5v2H2v-1H1v-1H0V2h1V1h2z"/>' +
    '<path fill="' + c.c1 + '" d="M4 1h7v1h2v1h1v6h-4v2H3v-1H2V3h1V2h1z"/>' +
    '<path fill="' + c.c2 + '" d="M5 4h3v3H5zM4 1h7v1H4z"/>' +
    '<path fill="#d2d6dd" d="M11 6h4v1h-4zM11 8h3v1h-3zM14 6h1v4h-1z"/></svg>';
}
function rk(t) { var r = L.rank(t); return r ? '<span class="led">#' + r + '</span> ' : ''; }
function rec(t) { var r = L.D.rec[t]; return r.w + '-' + r.l; }
function tn(t, opts) {
  opts = opts || {};
  return (opts.rank === false ? '' : rk(t)) + esc(opts.short ? T(t).city : T(t).name);
}
function header(title, back) {
  return '<header class="bar"><button class="btn ghost sm" data-a="' + (back || 'home') + '">Back</button><h2>' + title + '</h2></header>';
}
function btn(label, a, v, cls, dis) {
  return '<button class="btn ' + (cls || '') + '" data-a="' + a + '"' + (v != null ? ' data-v="' + esc(v) + '"' : '') + (dis ? ' disabled' : '') + '>' + label + '</button>';
}
function act(name, fn) { acts[name] = fn; }
function confName(t) { return SG.CONFS[T(t).conf].name; }

// =====================================================================
// Screen system
// =====================================================================
var SCREENS = {};
function show(name, arg) {
  if (!SCREENS[name]) name = 'title';
  acts = {};
  act('home', UI.home);
  cur = name; curArg = arg;
  var html;
  try { html = SCREENS[name](arg); }
  catch (e) { html = '<div class="page"><div class="panel">Something went wrong drawing this screen.</div>' + btn('Main menu', 'title') + '</div>'; act('title', function () { show('title'); }); if (window.console) console.error(e); }
  scr.innerHTML = html;
  scr.className = name === 'title' ? 'clear' : '';
  scr.hidden = false;
  scr.scrollTop = 0;
  hideGameUI();
  if (!M.active()) {
    var D = L.D;
    F.idle(D ? D.team : (pick.sel >= 0 ? pick.sel : SG.ri(0, SG.TEAMS.length - 1)));
  }
}
UI.show = show;
function rerender() { var y = scr.scrollTop; show(cur, curArg); scr.scrollTop = y; }

function hideGameUI() {
  hudEl.hidden = true; ctlEl.hidden = true; cardEl.hidden = true; pauseEl.hidden = true;
  kickEl.hidden = true; bannerEl.hidden = true; hintEl.hidden = true; toastEl.hidden = true;
  F.setInsets(0, 0);
}

UI.home = function () {
  var D = L.D;
  if (!D) { show('title'); return; }
  if (D.offStep === 'fired') { show('fired'); return; }
  if (D.offStep === 'grad') { show('grad'); return; }
  if (D.offStep === 'recruit') { show('recruit'); return; }
  if (D.offStep === 'progress') { show('progress'); return; }
  if (D.phase === 'recap') { show('recap', L.endSeason()); return; }
  show('hub');
};

// ---------------------------------------------------------------- title
SCREENS.title = function () {
  var has = L.hasSave() && (L.D || L.load());
  act('cont', UI.home);
  act('new', function () { pick.sel = -1; show('pick'); });
  act('how', function () { show('how', 'title'); });
  act('set', function () { show('settings', 'title'); });
  var save = '';
  if (has) {
    var D = L.D;
    save = '<span class="save-pill">' + esc(D.coach) + ' &middot; ' + esc(T(D.team).name) + ' &middot; ' + L.year() + '</span>';
  }
  return '<div class="title"><div class="logo"><span class="l1">Saturday</span><span class="l2">GRIDIRON</span></div>' +
    '<p class="tag">Pick a college, call the plays, sign the recruits and chase a national title.</p>' +
    '<div class="menu">' +
    (has ? btn('Continue', 'cont') + save : '') +
    btn('New Dynasty', 'new', null, has ? 'ghost' : '') +
    btn('How to Play', 'how', null, 'ghost') +
    btn('Settings', 'set', null, 'ghost') + '</div>' +
    '<p class="fine">The ' + SG.LEAGUE.name + ' and every school, mascot and player are made up. The towns are real.</p></div>';
};

// ---------------------------------------------------------------- pick a school
var EXPECT = ['', 'Long rebuild. Any bowl game is a win.', 'Rebuild. A winning season would turn heads.',
  'Bowl team. Eight wins keeps the boosters happy.', 'Contender. Win the league and push for the Final Eight.',
  'Blue blood. Anything short of the playoff is a bad year.'];
SCREENS.pick = function () {
  act('back', function () { show('title'); });
  act('conf', function (v) { pick.conf = +v; rerender(); });
  act('sel', function (v) { pick.sel = +v; show('pick'); });
  act('start', function () {
    var nameEl = $('coachName');
    var name = (nameEl && nameEl.value.trim()) || 'Coach';
    pick.name = name;
    L.newDynasty(pick.sel, name.slice(0, 24));
    UI.home();
    UI.toast('Welcome to ' + T(pick.sel).city + ', Coach ' + name.split(' ').pop());
  });
  var c = SG.CONFS[pick.conf];
  var h = '<div class="page">' + '<header class="bar"><button class="btn ghost sm" data-a="back">Back</button><h2>Choose your school</h2></header>';
  if (pick.sel >= 0) {
    var t = T(pick.sel);
    h += '<div class="panel pick-detail"><div class="row">' + helm(t.i, 64) + '<div class="col grow"><b class="num" style="font-size:20px">' + esc(t.name) + '</b>' +
      '<span class="muted">' + esc(t.city) + ', ' + t.st + ' &middot; ' + esc(confName(t.i)) + '</span>' +
      '<span class="stars" aria-label="Prestige ' + t.basePrestige + ' of 5">' + SG.stars(t.basePrestige) + '</span></div></div>' +
      '<div>' + EXPECT[t.basePrestige] + '</div>' +
      '<div class="muted">Rival: ' + esc(T(t.rival).name) + '</div>' +
      '<label class="field" for="coachName"><span class="lbl">Your name</span><input id="coachName" maxlength="24" autocomplete="off" value="' + esc(pick.name) + '" placeholder="Coach"></label>' +
      btn('Take the job', 'start', null, 'wide') + '</div>';
  } else {
    h += '<p class="muted" style="margin:0">Every school plays in a real college town. More prestige means better players and higher expectations.</p>';
  }
  h += '<div class="tabs" role="tablist">' + SG.CONFS.map(function (cf, i) {
    return '<button class="tab' + (i === pick.conf ? ' on' : '') + '" data-a="conf" data-v="' + i + '" role="tab">' + esc(cf.name) + '</button>';
  }).join('') + '</div>';
  h += '<div class="tlist">' + c.teams.slice().sort(function (a, b) { return T(b).basePrestige - T(a).basePrestige; }).map(function (ti) {
    var t = T(ti);
    return '<button class="trow' + (ti === pick.sel ? ' on' : '') + '" data-a="sel" data-v="' + ti + '">' + helm(ti, 40) +
      '<div class="col grow"><b>' + esc(t.name) + '</b><span>' + esc(t.city) + ', ' + t.st + '</span></div><span class="stars">' + SG.stars(t.basePrestige) + '</span></button>';
  }).join('') + '</div></div>';
  return h;
};

// ---------------------------------------------------------------- hub
SCREENS.hub = function () {
  var D = L.D, me = D.team, t = T(me), r = D.rec[me];
  var g = L.myGame();
  act('play', playGame);
  act('sim', simMine);
  act('simweek', simWeek);
  act('roster', function () { view.open = 0; show('roster'); });
  act('sched', function () { show('sched'); });
  act('stand', function () { view.standConf = t.conf; show('stand'); });
  act('top', function () { show('top'); });
  act('fac', function () { show('fac'); });
  act('bracket', function () { show('bracket'); });
  act('set', function () { show('settings', 'hub'); });
  act('how', function () { show('how', 'hub'); });
  act('menu', function () { show('title'); });
  var mr = L.myRatings();
  var h = '<div class="page">';
  h += '<div class="band" style="background:' + t.c1 + ';color:' + inkOn(t.c1) + ';--tc2:' + t.c2 + '">' + helm(me, 56) +
    '<div class="col"><h2>' + esc(t.name) + '</h2><span class="meta">' + L.year() + ' &middot; ' + esc(L.phaseLabel()) + ' &middot; ' + esc(SG.CONFS[t.conf].name) + '</span></div>' +
    '<div class="rk">' + (L.rank(me) ? '#' + L.rank(me) : 'NR') + '<small>AP-STYLE POLL</small></div></div>';
  h += '<div class="panel statline">' +
    '<div><span class="lbl">Record</span><b>' + rec(me) + '</b></div>' +
    '<div><span class="lbl">League</span><b>' + r.cw + '-' + r.cl + '</b></div>' +
    '<div><span class="lbl">Team OVR</span><b>' + mr.ovr + '</b></div>' +
    '<div><span class="lbl">Coach pts</span><b>' + D.cp + '</b></div>' +
    '<div style="flex:1;min-width:160px"><span class="lbl">Booster confidence</span><div class="meter" style="margin-top:8px"><i style="width:' + SG.clamp(D.job, 0, 100) + '%;background:' + (D.job > 55 ? 'var(--good)' : D.job > 25 ? 'var(--amber)' : 'var(--bad)') + '"></i></div></div>' +
    '</div>';
  if (g) {
    var opp = g.h === me ? g.a : g.h, home = g.h === me, or = L.ratings(opp);
    var where = g.neutral ? 'Neutral site' : home ? 'Home' : 'Away';
    var tag = g.kind === 'rival' ? 'Rivalry game' : g.kind === 'conf' ? 'League game' : g.kind === 'nc' ? 'Non-league' : 'Postseason';
    h += '<div class="panel next"><div class="row"><span class="lbl grow">' + esc(L.gameLabel(g)) + '</span><span class="lbl">' + tag + ' &middot; ' + where + '</span></div>' +
      '<div class="vs"><div class="side">' + helm(me, 48) + '<b>' + rk(me) + esc(t.city) + '</b><span class="muted">' + rec(me) + '</span></div>' +
      '<span class="at">' + (home || g.neutral ? 'VS' : 'AT') + '</span>' +
      '<div class="side">' + helm(opp, 48) + '<b>' + rk(opp) + esc(T(opp).city) + '</b><span class="muted">' + rec(opp) + '</span></div></div>' +
      '<div class="cmp"><span class="a">' + mr.off + '</span><span class="c">OFFENSE</span><span class="b">' + or.off + '</span>' +
      '<span class="a">' + mr.def + '</span><span class="c">DEFENSE</span><span class="b">' + or.def + '</span></div>' +
      '<div class="grid2">' + btn('Play game', 'play') + btn('Sim game', 'sim', null, 'ghost') + '</div></div>';
  } else {
    var why = D.phase === 'ccg' ? 'You did not make your league title game.' :
      D.phase === 'qf' ? (D.rec[me].w >= 6 ? 'No game this round.' : 'Fewer than six wins means no bowl this year.') :
        'Your season is over. The playoff goes on.';
    h += '<div class="panel next"><span class="lbl">' + esc(L.phaseLabel()) + '</span><div>' + why + '</div>' + btn('Sim to next round', 'simweek') + '</div>';
  }
  h += '<div class="navg">' + btn('Roster', 'roster', null, 'ghost') + btn('Schedule', 'sched', null, 'ghost') + btn('Standings', 'stand', null, 'ghost') +
    btn('Top 25', 'top', null, 'ghost') + btn('Facilities', 'fac', null, 'ghost') +
    (['qf', 'sf', 'final'].indexOf(D.phase) >= 0 ? btn('Playoff', 'bracket', null, 'ghost') : '') +
    btn('How to play', 'how', null, 'ghost') + btn('Settings', 'set', null, 'ghost') + btn('Main menu', 'menu', null, 'ghost') + '</div>';
  return h + '</div>';
};

function playGame() {
  var g = L.myGame();
  if (!g) return;
  var label = L.gameLabel(g), prev = L.D.phase;
  ac();
  M.start(g, function (sum) { show('post', { sum: sum, label: label, prev: prev }); });
}
function simMine() {
  var D = L.D, g = L.myGame();
  if (!g) return;
  var label = L.gameLabel(g), prev = D.phase;
  var r = L.simGame(g);
  L.record(g, r.hs, r.as, r.ot);
  var mine = g.h === D.team ? r.hs : r.as;
  var cp = L.awardGame(g, Math.floor(mine / 7));
  var played = L.advance();
  show('results', { label: label, played: played, prev: prev, mine: g, cp: cp });
}
function simWeek() {
  var label = L.phaseLabel(), prev = L.D.phase;
  var played = L.advance();
  show('results', { label: label, played: played, prev: prev, mine: null });
}

// ---------------------------------------------------------------- post game
SCREENS.post = function (a) {
  var s = a.sum, D = L.D, st = s.st;
  act('next', function () {
    var played = L.advance();
    show('results', { label: a.label, played: played, prev: a.prev, mine: s.g, cp: s.cp, skipMine: true });
  });
  var h = '<div class="page"><div class="lbl" style="text-align:center">' + esc(a.label) + '</div>';
  h += '<div class="panel final"><div class="tm">' + helm(s.me, 56) + '<b>' + esc(T(s.me).abbr) + '</b></div>' +
    '<span class="sc">' + s.sc[0] + ' - ' + s.sc[1] + '</span><div class="tm">' + helm(s.opp, 56) + '<b>' + esc(T(s.opp).abbr) + '</b></div></div>';
  h += '<div class="verdict ' + (s.won ? 'good' : 'bad') + '">' + (s.won ? 'Victory' : 'Defeat') + (s.ot ? ' in OT' : '') + '</div>';
  h += '<div class="panel statline"><div><span class="lbl">Coach pts</span><b>+' + s.cp + '</b></div>' +
    '<div><span class="lbl">Total yards</span><b>' + st.yds + '</b></div><div><span class="lbl">Opp yards</span><b>' + s.opst.yds + '</b></div>' +
    '<div><span class="lbl">Takeaways</span><b>' + s.opst.to + '</b></div><div><span class="lbl">Sacks taken</span><b>' + st.sk + '</b></div></div>';
  // leaders
  var pass = null, rush = null, recv = null;
  Object.keys(s.pst).forEach(function (k) {
    var o = s.pst[k];
    if (o.pa && (!pass || o.py > pass.py)) pass = o;
    if (o.ra && (!rush || o.ry > rush.ry)) rush = o;
    if (o.rec && (!recv || o.rcy > recv.rcy)) recv = o;
  });
  function who(o) { return esc(o.pl.fn[0] + '. ' + o.pl.ln) + ' <span class="muted">' + o.pl.pos + '</span>'; }
  var rows = '';
  if (pass) rows += '<tr><td>Passing</td><td>' + who(pass) + '</td><td class="r">' + (pass.pc || 0) + '/' + pass.pa + ', ' + (pass.py || 0) + ' yds, ' + (pass.ptd || 0) + ' TD' + (pass.int ? ', ' + pass.int + ' INT' : '') + '</td></tr>';
  if (rush) rows += '<tr><td>Rushing</td><td>' + who(rush) + '</td><td class="r">' + rush.ra + ' car, ' + (rush.ry || 0) + ' yds' + (rush.rtd ? ', ' + rush.rtd + ' TD' : '') + '</td></tr>';
  if (recv) rows += '<tr><td>Receiving</td><td>' + who(recv) + '</td><td class="r">' + recv.rec + ' rec, ' + (recv.rcy || 0) + ' yds' + (recv.rctd ? ', ' + recv.rctd + ' TD' : '') + '</td></tr>';
  if (rows) h += '<div class="panel"><div class="lbl">Leaders</div><div class="tbl-wrap"><table class="tbl"><tbody>' + rows + '</tbody></table></div></div>';
  if (s.log.length) {
    h += '<div class="panel"><div class="lbl">Scoring</div><div class="tbl-wrap"><table class="tbl"><tbody>' + s.log.map(function (e) {
      return '<tr><td>' + e.q + '</td><td>' + esc(T(e.side === 'me' ? s.me : s.opp).abbr) + '</td><td>' + esc(e.what) + '</td><td class="r num">' + e.sc[0] + '-' + e.sc[1] + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
  }
  h += btn('Continue', 'next', null, 'wide');
  return h + '</div>';
};

// ---------------------------------------------------------------- week results
function gameCard(g, mine) {
  var w = g.done ? L.winner(g) : -1;
  function line(t, s) {
    return '<div class="ln2 ' + (w === t ? 'w' : 'l') + '"><span class="row" style="gap:6px">' + helm(t, 18) + '<span class="ellip">' + rk(t) + esc(T(t).city) + '</span></span><b>' + (g.done ? s : '') + '</b></div>';
  }
  return '<div class="gm' + (mine ? ' mine' : '') + '">' + line(g.a, g.as) + line(g.h, g.hs) +
    (g.ot ? '<span class="lbl">' + (g.ot > 1 ? g.ot + 'OT' : 'OT') + '</span>' : '') + '</div>';
}
SCREENS.results = function (a) {
  var D = L.D, me = D.team;
  act('next', UI.home);
  var h = '<div class="page"><header class="bar"><h2>' + esc(a.label) + ' results</h2></header>';
  if (a.mine && !a.skipMine) {
    var g = a.mine, won = L.winner(g) === me, opp = g.h === me ? g.a : g.h;
    var my = g.h === me ? g.hs : g.as, their = g.h === me ? g.as : g.hs;
    h += '<div class="panel final"><div class="tm">' + helm(me, 48) + '<b>' + esc(T(me).abbr) + '</b></div><span class="sc">' + my + ' - ' + their + '</span>' +
      '<div class="tm">' + helm(opp, 48) + '<b>' + esc(T(opp).abbr) + '</b></div></div>' +
      '<div class="verdict ' + (won ? 'good' : 'bad') + '">' + (won ? 'Victory' : 'Defeat') + ' (simulated)' + (a.cp ? ' &middot; +' + a.cp + ' coach pts' : '') + '</div>';
  }
  // what changed
  h += phaseNews(a.prev);
  var list = a.played.slice().sort(function (x, y) {
    var mx = (x.h === me || x.a === me) ? -1 : Math.min(D.rank[x.h], D.rank[x.a]);
    var my2 = (y.h === me || y.a === me) ? -1 : Math.min(D.rank[y.h], D.rank[y.a]);
    return mx - my2;
  });
  h += '<div class="lbl">Around the ' + SG.LEAGUE.short + '</div><div class="games">' + list.map(function (g2) { return gameCard(g2, g2.h === me || g2.a === me); }).join('') + '</div>';
  h += btn('Continue', 'next', null, 'wide');
  return h + '</div>';
};

function phaseNews(prev) {
  var D = L.D, me = D.team, P = D.post, h = '';
  if (prev === 'reg' && D.phase === 'ccg') {
    var mine = L.myGame();
    h += '<div class="panel"><div class="lbl">Championship week is set</div><p style="margin:6px 0 0">' +
      (mine ? 'You play for the ' + esc(confName(me)) + ' title.' : 'You missed your league title game.') + '</p>' +
      '<div class="games" style="margin-top:8px">' + P.ccg.map(function (g) { return gameCard(g, g.h === me || g.a === me); }).join('') + '</div></div>';
  } else if (prev === 'ccg' && D.phase === 'qf') {
    var inField = P.seeds.indexOf(me) >= 0;
    h += '<div class="panel"><div class="lbl">' + SG.PLAYOFF_NAME + ' field</div><p style="margin:6px 0 0">' +
      (inField ? 'You are the No. ' + (P.seeds.indexOf(me) + 1) + ' seed.' : P.bowl ? 'You are headed to the ' + esc(P.bowl.name) + '.' : 'No postseason for you this year.') + '</p>' +
      '<div class="tbl-wrap"><table class="tbl"><tbody>' + P.seeds.map(function (t, i) {
        return '<tr class="' + (t === me ? 'me' : '') + '"><td class="num">' + (i + 1) + '</td><td><span class="tn">' + helm(t, 20) + esc(T(t).name) + '</span></td><td class="r">' + rec(t) + '</td><td>' + (P.champs.indexOf(t) >= 0 ? 'League champ' : 'At-large') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  } else if (prev === 'qf' && D.phase === 'sf') {
    h += '<div class="panel"><div class="lbl">Semifinals</div><div class="games" style="margin-top:8px">' + P.sf.map(function (g) { return gameCard(g, g.h === me || g.a === me); }).join('') + '</div></div>';
  } else if (prev === 'sf' && D.phase === 'final') {
    var f = P.final[0];
    h += '<div class="panel"><div class="lbl">' + SG.TITLE_GAME + '</div><p style="margin:6px 0 0">' + esc(T(f.h).name) + ' vs ' + esc(T(f.a).name) + ' for the national title.</p></div>';
  } else if (D.phase === 'recap' && P.champ >= 0) {
    h += '<div class="panel row">' + helm(P.champ, 56) + '<div class="col"><span class="lbl">National champion</span><b class="num" style="font-size:20px">' + esc(T(P.champ).name) + '</b><span class="muted">' + rec(P.champ) + '</span></div></div>';
  }
  return h;
}

// ---------------------------------------------------------------- roster
SCREENS.roster = function () {
  var D = L.D, d = L.depth(), inSeason = D.phase !== 'recap' && !D.offStep;
  act('open', function (v) { view.open = view.open === +v ? 0 : +v; rerender(); });
  act('train', function (v) {
    var p = null;
    D.roster.forEach(function (q) { if (q.id === +v) p = q; });
    if (!p) return;
    var r = L.train(p);
    if (r) { UI.toast(p.ln + ' +' + r.n + ' ' + statName(p, r.k)); UI.sfx('cash'); }
    rerender();
  });
  var h = '<div class="page">' + header('Roster') +
    '<div class="panel statline"><div><span class="lbl">Players</span><b>' + D.roster.length + '/' + SG.ROSTER_MAX + '</b></div>' +
    '<div><span class="lbl">Coach pts</span><b>' + D.cp + '</b></div><div class="muted" style="align-self:center;flex:1;min-width:200px">Tap a player to see ratings. Train each player once a week with coach points. Better players cost more.</div></div>';
  SG.POS.forEach(function (pos) {
    h += '<div class="lbl">' + SG.POS_NAME[pos] + '</div><div class="plist">';
    d[pos].forEach(function (p, i) {
      var open = view.open === p.id, starter = i < SG.STARTERS[pos];
      h += '<div class="prow" data-a="open" data-v="' + p.id + '" role="button" tabindex="0"><span class="pos">' + pos + '</span>' +
        '<span class="col"><span class="nm">#' + p.num + ' ' + esc(p.fn + ' ' + p.ln) + (starter ? '<span class="st-tag">START</span>' : '') + '</span>' +
        '<span class="sub">' + SG.YEARS[p.yr] + ' &middot; Potential <span class="stars">' + SG.stars(p.pot) + '</span></span></span>' +
        '<span class="ovr">' + p.ovr + '</span>';
      if (open) {
        h += '<div class="pdetail">' + attrBox('SPD', p.spd) + attrBox('STR', p.str) + attrBox(SG.SKILL_NAME[pos], p.skl) +
          (SG.ARM_NAME[pos] ? attrBox(SG.ARM_NAME[pos], p.arm) : '') + statsLine(p) +
          (inSeason ? '<button class="btn sm teal" data-a="train" data-v="' + p.id + '"' + (p.tw === L.stamp() || D.cp < L.trainCost(p) ? ' disabled' : '') + '>' +
            (p.tw === L.stamp() ? 'Trained this week' : 'Train &middot; ' + L.trainCost(p) + ' CP') + '</button>' : '') + '</div>';
      }
      h += '</div>';
    });
    h += '</div>';
  });
  return h + '</div>';
};
function statName(p, k) { return k === 'spd' ? 'SPD' : k === 'str' ? 'STR' : k === 'arm' ? SG.ARM_NAME[p.pos] || 'ARM' : SG.SKILL_NAME[p.pos]; }
function attrBox(n, v) { return '<span class="attr"><b>' + v + '</b><span>' + n + '</span></span>'; }
function statsLine(p) {
  var s = L.D.stats[p.id];
  if (!s) return '';
  var out = [];
  if (s.pa) out.push((s.pc || 0) + '/' + s.pa + ' ' + (s.py || 0) + ' yds ' + (s.ptd || 0) + ' TD ' + (s.int || 0) + ' INT');
  if (s.ra) out.push(s.ra + ' car ' + (s.ry || 0) + ' yds ' + (s.rtd || 0) + ' TD');
  if (s.rec) out.push(s.rec + ' rec ' + (s.rcy || 0) + ' yds ' + (s.rctd || 0) + ' TD');
  return out.length ? '<span class="muted" style="flex-basis:100%">Season: ' + out.join(' &middot; ') + '</span>' : '';
}

// ---------------------------------------------------------------- schedule
SCREENS.sched = function () {
  var D = L.D, me = D.team, rows = [];
  D.sched.forEach(function (wk, i) {
    wk.forEach(function (g) { if (g.h === me || g.a === me) rows.push({ g: g, lab: 'W' + (i + 1) }); });
  });
  ['ccg', 'qf', 'sf', 'final'].forEach(function (k) {
    D.post[k].forEach(function (g) { if (g.h === me || g.a === me) rows.push({ g: g, lab: k === 'ccg' ? 'CCG' : k.toUpperCase() }); });
  });
  if (D.post.bowl) rows.push({ g: D.post.bowl, lab: 'BOWL' });
  var h = '<div class="page">' + header('Schedule ' + L.year()) + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Wk</th><th>Opponent</th><th>Type</th><th class="r">Result</th></tr></thead><tbody>';
  rows.forEach(function (r) {
    var g = r.g, opp = g.h === me ? g.a : g.h, home = g.h === me;
    var res = '';
    if (g.done) {
      var won = L.winner(g) === me, my = home ? g.hs : g.as, th = home ? g.as : g.hs;
      res = '<span class="' + (won ? 'good' : 'bad') + '">' + (won ? 'W' : 'L') + ' ' + my + '-' + th + (g.ot ? ' OT' : '') + '</span>';
    }
    var kind = g.kind === 'rival' ? 'Rivalry' : g.kind === 'conf' ? 'League' : g.kind === 'nc' ? 'Non-league' : g.kind === 'bowl' ? esc(g.name) : 'Playoff';
    if (g.kind === 'ccg') kind = 'Title game';
    h += '<tr><td class="num">' + r.lab + '</td><td><span class="tn">' + (g.neutral ? 'vs ' : home ? 'vs ' : 'at ') + helm(opp, 20) + tn(opp) + '</span></td><td class="muted">' + kind + '</td><td class="r">' + res + '</td></tr>';
  });
  return h + '</tbody></table></div></div>';
};

// ---------------------------------------------------------------- standings
SCREENS.stand = function () {
  var D = L.D;
  act('conf', function (v) { view.standConf = +v; rerender(); });
  var h = '<div class="page">' + header('Standings') + '<div class="tabs">' + SG.CONFS.map(function (c, i) {
    return '<button class="tab' + (i === view.standConf ? ' on' : '') + '" data-a="conf" data-v="' + i + '">' + esc(c.name) + '</button>';
  }).join('') + '</div>';
  var order = L.confOrder(view.standConf);
  h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Team</th><th class="r">League</th><th class="r">Overall</th><th class="r">PF</th><th class="r">PA</th></tr></thead><tbody>';
  order.forEach(function (t) {
    var r = D.rec[t];
    h += '<tr class="' + (t === D.team ? 'me' : '') + '"><td><span class="tn">' + helm(t, 20) + tn(t) + '</span></td><td class="r">' + r.cw + '-' + r.cl + '</td><td class="r">' + r.w + '-' + r.l + '</td><td class="r">' + r.pf + '</td><td class="r">' + r.pa + '</td></tr>';
  });
  return h + '</tbody></table></div><p class="muted" style="margin:0">The top two in each league meet in the title game. The five league champions and three at-large teams make the ' + SG.PLAYOFF_NAME + '.</p></div>';
};

// ---------------------------------------------------------------- top 25
SCREENS.top = function () {
  var D = L.D;
  var h = '<div class="page">' + header('Top 25') + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Team</th><th class="r">Record</th><th>League</th></tr></thead><tbody>';
  D.poll.slice(0, 25).forEach(function (t, i) {
    h += '<tr class="' + (t === D.team ? 'me' : '') + '"><td class="num">' + (i + 1) + '</td><td><span class="tn">' + helm(t, 20) + esc(T(t).name) + '</span></td><td class="r">' + rec(t) + '</td><td class="muted">' + SG.CONFS[T(t).conf].short + '</td></tr>';
  });
  return h + '</tbody></table></div></div>';
};

// ---------------------------------------------------------------- facilities
SCREENS.fac = function () {
  var D = L.D;
  act('up', function (k) {
    if (L.upgrade(k)) { UI.toast(L.FAC[k].name + ' upgraded'); UI.sfx('cash'); }
    rerender();
  });
  var h = '<div class="page">' + header('Facilities') + '<div class="panel statline"><div><span class="lbl">Coach pts</span><b>' + D.cp + '</b></div>' +
    '<div class="muted" style="flex:1;min-width:200px;align-self:center">Earn coach points by winning, scoring and beating ranked teams.</div></div>';
  Object.keys(L.FAC).forEach(function (k) {
    var f = L.FAC[k], lvl = D.fac[k], cost = L.facCost(lvl), pips = '';
    for (var i = 1; i <= 5; i++) pips += '<span class="pip' + (i <= lvl ? ' on' : '') + '"></span>';
    h += '<div class="panel row" style="flex-wrap:wrap"><div class="col grow" style="min-width:200px"><b class="num">' + f.name + '</b><span class="muted">' + f.desc + '</span><span>' + pips + '</span></div>' +
      (lvl >= 5 ? '<span class="lbl">Maxed</span>' : '<button class="btn sm" data-a="up" data-v="' + k + '"' + (D.cp < cost ? ' disabled' : '') + '>Upgrade &middot; ' + cost + ' CP</button>') + '</div>';
  });
  return h + '</div>';
};

// ---------------------------------------------------------------- playoff bracket
SCREENS.bracket = function () {
  var D = L.D, P = D.post, me = D.team;
  function cardS(g) {
    var w = g.done ? L.winner(g) : -1;
    function line(t, seed, s) {
      return '<div class="ln2 ' + (w === t ? 'w' : w < 0 ? 'w' : 'l') + '"><span class="row" style="gap:6px"><span class="muted num">' + seed + '</span>' + helm(t, 18) + '<span class="ellip">' + esc(T(t).city) + '</span></span><b>' + (g.done ? s : '') + '</b></div>';
    }
    return '<div class="gm' + (g.h === me || g.a === me ? ' mine' : '') + '">' + line(g.h, g.seedH || '', g.hs) + line(g.a, g.seedA || '', g.as) + '</div>';
  }
  var h = '<div class="page">' + header(SG.PLAYOFF_NAME) + '<div class="bracket">' +
    '<div class="rnd"><span class="lbl">Quarterfinals</span>' + P.qf.map(cardS).join('') + '</div>' +
    '<div class="rnd"><span class="lbl">Semifinals</span>' + (P.sf.length ? P.sf.map(cardS).join('') : '<span class="muted">To be decided</span>') + '</div>' +
    '<div class="rnd"><span class="lbl">' + SG.TITLE_GAME + '</span>' + (P.final.length ? P.final.map(cardS).join('') : '<span class="muted">To be decided</span>') + '</div></div>';
  if (P.bowl) h += '<div class="lbl">' + esc(P.bowl.name) + '</div><div class="games">' + gameCard(P.bowl, true) + '</div>';
  return h + '</div>';
};

// ---------------------------------------------------------------- season recap
SCREENS.recap = function (o) {
  var D = L.D, me = D.team;
  act('next', UI.home);
  var h = '<div class="page"><header class="bar"><h2>' + (L.year()) + ' season recap</h2></header>';
  if (D.post.champ >= 0) {
    h += '<div class="panel row">' + helm(D.post.champ, 64) + '<div class="col"><span class="lbl">National champion</span><b class="num" style="font-size:22px">' + esc(T(D.post.champ).name) + '</b></div></div>';
  }
  var res = o.champ ? 'National champions!' : o.playoff === 3 ? 'Lost in the ' + SG.TITLE_GAME : o.playoff === 2 ? 'Lost in the semifinals' : o.playoff === 1 ? 'Lost in the quarterfinals' :
    o.bowl ? (o.bowl.won ? 'Won the ' : 'Lost the ') + o.bowl.name : 'No postseason';
  h += '<div class="panel statline"><div><span class="lbl">Record</span><b>' + o.rec + '</b></div><div><span class="lbl">Final rank</span><b>' + (o.rank <= 25 ? '#' + o.rank : 'NR') + '</b></div>' +
    '<div><span class="lbl">League title</span><b>' + (o.conf ? 'Yes' : 'No') + '</b></div><div><span class="lbl">Postseason</span><b style="font-size:14px">' + esc(res) + '</b></div></div>';
  h += '<div class="panel col"><span class="lbl">' + SG.AWARD + '</span><div class="row">' + helm(o.award.team, 32) + '<span>' + esc(o.award.name) + ', ' + o.award.pos + ', ' + esc(T(o.award.team).name) +
    (o.award.mine ? ' <b class="good">Your player!</b>' : '') + '</span></div></div>';
  h += '<div class="panel col"><span class="lbl">Boosters</span><span>' + (o.jobDelta >= 0 ? '<span class="good">Confidence up ' + o.jobDelta + '</span>' : '<span class="bad">Confidence down ' + Math.abs(o.jobDelta) + '</span>') +
    '. Prestige ' + SG.stars(o.prestigeAfter) + ' (' + o.prestigeAfter.toFixed(1) + ')</span>' +
    (o.fired ? '<b class="bad">The athletic director wants to talk.</b>' : '') + '</div>';
  h += btn(o.fired ? 'Meet the AD' : 'Start the offseason', 'next', null, 'wide');
  return h + '</div>';
};

// ---------------------------------------------------------------- offseason
SCREENS.grad = function () {
  var r = L.D.offStep === 'grad' ? L.graduate() : { gone: [], pro: [] };
  act('next', UI.home);
  var h = '<div class="page"><header class="bar"><h2>Graduation day</h2></header>';
  h += '<div class="panel col"><span class="lbl">Seniors moving on</span>' + (r.gone.length ? r.gone.map(function (p) {
    return '<span>' + p.pos + ' ' + esc(p.fn + ' ' + p.ln) + ' <span class="muted">OVR ' + p.ovr + '</span></span>';
  }).join('') : '<span class="muted">No seniors this year.</span>') + '</div>';
  if (r.pro.length) {
    h += '<div class="panel col"><span class="lbl">Leaving early for the pro draft</span>' + r.pro.map(function (p) {
      return '<span>' + p.pos + ' ' + esc(p.fn + ' ' + p.ln) + ' <span class="muted">OVR ' + p.ovr + '</span></span>';
    }).join('') + '</div>';
  }
  h += btn('Go recruiting', 'next', null, 'wide');
  return h + '</div>';
};

SCREENS.recruit = function () {
  var D = L.D, list = D.recruits || [], slots = L.scholarships(), cap = L.offerCap();
  var offered = list.filter(function (r) { return r.offered; }).length;
  act('offer', function (v) {
    var r = list[+v];
    if (!r) return;
    if (!r.offered && offered >= cap) { UI.toast('Offer limit reached'); return; }
    r.offered = !r.offered; L.save(); rerender();
  });
  act('visit', function (v) {
    var r = list[+v];
    if (r && L.visit(r)) { UI.sfx('cash'); UI.toast(r.ln + ' loved the visit'); }
    rerender();
  });
  act('sign', function () { var res = L.signingDay(); show('signed', res); });
  var need = L.needs(), needTxt = SG.POS.filter(function (p) { return need[p] > 0; }).map(function (p) { return p + (need[p] > 1 ? ' x' + need[p] : ''); }).join(', ');
  var h = '<div class="page"><header class="bar"><h2>Recruiting</h2></header>' +
    '<div class="panel statline"><div><span class="lbl">Open spots</span><b>' + slots + '</b></div><div><span class="lbl">Offers</span><b>' + offered + '/' + cap + '</b></div><div><span class="lbl">Roster</span><b>' + D.roster.length + '/' + SG.ROSTER_MAX + '</b></div>' +
    '<div><span class="lbl">Coach pts</span><b>' + D.cp + '</b></div><div class="col" style="flex:1;min-width:200px"><span class="lbl">Needs</span><span>' + (needTxt || 'None. Take the best players.') + '</span></div></div>' +
    '<p class="muted" style="margin:0">Offer scholarships, then hit Signing Day. Each prospect signs based on his interest, best prospects first, until your roster is full. You can offer a few more than you have spots. A campus visit costs ' + L.VISIT_COST + ' coach points and raises interest.</p><div class="plist">';
  list.forEach(function (r, i) {
    h += '<div class="prow recruit" style="grid-template-columns:42px 1fr auto"><span class="pos">' + r.pos + '</span><span class="col"><span class="nm">' + esc(r.fn + ' ' + r.ln) + ' <span class="stars">' + SG.stars(r.stars) + '</span></span>' +
      '<span class="sub">' + esc(r.home) + ' &middot; Potential ' + SG.stars(r.pot) + '</span>' +
      '<span class="row" style="gap:8px"><span class="interest"><i style="width:' + r.interest + '%"></i></span><span class="sub num">' + r.interest + '%</span></span></span>' +
      '<span class="ovr">' + r.ovr + '</span>' +
      '<div class="pdetail acts2"><button class="btn sm ' + (r.offered ? 'teal' : '') + '" data-a="offer" data-v="' + i + '">' + (r.offered ? 'Offered &#10003;' : 'Offer') + '</button>' +
      '<button class="btn sm ghost" data-a="visit" data-v="' + i + '"' + (r.visits >= 2 || D.cp < L.VISIT_COST ? ' disabled' : '') + '>Visit &middot; ' + L.VISIT_COST + ' CP' + (r.visits ? ' (' + r.visits + '/2)' : '') + '</button></div></div>';
  });
  h += '</div>' + btn('Signing Day (' + offered + ' offers)', 'sign', null, 'wide');
  return h + '</div>';
};

SCREENS.signed = function (r) {
  act('next', UI.home);
  function li(p, extra) { return '<span>' + p.pos + ' ' + esc(p.fn + ' ' + p.ln) + ' <span class="stars">' + SG.stars(p.stars || 1) + '</span> <span class="muted">OVR ' + p.ovr + (extra || '') + '</span></span>'; }
  var h = '<div class="page"><header class="bar"><h2>Signing Day</h2></header>';
  h += '<div class="panel col"><span class="lbl good">Signed</span>' + (r.signed.length ? r.signed.map(function (p) { return li(p); }).join('') : '<span class="muted">Nobody signed.</span>') + '</div>';
  if (r.lost.length) h += '<div class="panel col"><span class="lbl bad">Signed elsewhere</span>' + r.lost.map(function (p) { return li(p); }).join('') + '</div>';
  if (r.walk.length) h += '<div class="panel col"><span class="lbl">Walk-ons to fill the depth chart</span>' + r.walk.map(function (p) { return li(p); }).join('') + '</div>';
  h += btn('Start spring practice', 'next', null, 'wide');
  return h + '</div>';
};

SCREENS.progress = function () {
  var ups = L.D.offStep === 'progress' ? L.progress() : [];
  act('next', UI.home);
  var h = '<div class="page"><header class="bar"><h2>Spring practice</h2></header><div class="panel col"><span class="lbl">Biggest jumps</span>' +
    (ups.length ? ups.map(function (u) { return '<span>' + u.p.pos + ' ' + esc(u.p.fn + ' ' + u.p.ln) + ' <span class="good num">+' + u.d + '</span> <span class="muted">now ' + u.p.ovr + '</span></span>'; }).join('') : '<span class="muted">Everyone is ready.</span>') +
    '</div>' + btn('Kick off the ' + L.year() + ' season', 'next', null, 'wide') + '</div>';
  return h;
};

SCREENS.fired = function () {
  var D = L.D;
  if (!D.offers) { D.offers = L.jobOffers(); L.save(); }
  act('take', function (v) {
    var t = +v;
    D.offers = null;
    L.takeJob(t);
    UI.home();
    UI.toast('Welcome to ' + T(t).city + ', Coach');
  });
  var h = '<div class="page"><header class="bar"><h2>You have been let go</h2></header><p style="margin:0">' + esc(T(D.team).city) + ' wants a new direction. Three schools want to talk.</p><div class="tlist">';
  D.offers.forEach(function (t) {
    h += '<button class="trow" data-a="take" data-v="' + t + '">' + helm(t, 40) + '<div class="col grow"><b>' + esc(T(t).name) + '</b><span>' + esc(confName(t)) + '</span></div><span class="stars">' + SG.stars(D.teams[t].prestige) + '</span></button>';
  });
  return h + '</div></div>';
};

// ---------------------------------------------------------------- settings / help
SCREENS.settings = function (back) {
  var s = L.settings;
  act('back', function () { if (back === 'hub') UI.home(); else show('title'); });
  act('q', function (v) { s.qlen = +v; L.saveSettings(); rerender(); });
  act('d', function (v) { s.diff = +v; L.saveSettings(); rerender(); });
  act('snd', function () { s.sound = !s.sound; L.saveSettings(); if (s.sound) UI.sfx('blip'); rerender(); });
  act('del', function () {
    if (!view.delArm) { view.delArm = true; rerender(); return; }
    view.delArm = false; L.wipe(); show('title'); UI.toast('Dynasty deleted');
  });
  function seg(a, opts, val) {
    return '<div class="seg">' + opts.map(function (o) { return '<button class="tab' + (o[0] === val ? ' on' : '') + '" data-a="' + a + '" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>';
  }
  var h = '<div class="page">' + header('Settings', 'back') +
    '<div class="panel col"><span class="lbl">Quarter length</span>' + seg('q', [[6, '6 min'], [10, '10 min'], [15, '15 min']], s.qlen) + '<span class="muted">Longer quarters mean more drives each game.</span></div>' +
    '<div class="panel col"><span class="lbl">Difficulty</span>' + seg('d', [[0, 'Freshman'], [1, 'Varsity'], [2, 'All-American']], s.diff) + '</div>' +
    '<div class="panel col"><span class="lbl">Sound</span>' + seg('snd', [[1, s.sound ? 'On' : 'Off']], 1) + '</div>';
  if (L.D || L.hasSave()) h += '<div class="panel col"><span class="lbl">Dynasty</span>' + btn(view.delArm ? 'Tap again to delete for good' : 'Delete dynasty', 'del', null, 'danger') + '</div>';
  return h + '</div>';
};

SCREENS.how = function (back) {
  act('back', function () { if (back === 'hub') UI.home(); else show('title'); });
  function sec(t, b) { return '<div class="panel"><h3>' + t + '</h3>' + b + '</div>'; }
  return '<div class="page how">' + header('How to play', 'back') +
    sec('Calling plays', '<p>Before each snap, pick a play from the bar at the bottom. Pass plays show every route on the field. Tap the field or hit Snap to start the play.</p>') +
    sec('Passing', '<p>After the snap, press anywhere and pull back like a slingshot. The dotted arc shows where the ball will land. Release to throw. Lead your receiver: the ball lands where you aimed, so throw to where he is going.</p><p>The ring under the target turns green when he is open and red when he is covered. Hold the ball too long and the rush will get you. Push forward instead of pulling back to scramble with your quarterback.</p>') +
    sec('Running', '<p>The ball carrier runs forward on his own. Hold your finger above or below him to steer. Tap to juke, which makes the next tackle easier to break. Swipe forward to dive for extra yards and end the play.</p>') +
    sec('Kicking', '<p>On fourth down you can punt or try a field goal. To kick, swipe up toward the posts. A longer swipe kicks farther, and the angle of your swipe aims it. Watch the wind flags.</p>') +
    sec('Defense', '<p>Your defense plays itself. Its strength comes from your linemen, linebackers and defensive backs, so recruit them too.</p>') +
    sec('Your dynasty', '<p>Twelve regular season games, then league title games and an eight-team playoff. Win games to earn coach points for training and facilities. Seniors graduate every year, so recruit well on Signing Day. Keep the boosters happy or you will be looking for a new job.</p>') +
    '</div>';
};

// =====================================================================
// In-game HUD and overlays (called by match.js)
// =====================================================================
function insets() {
  var ar = app.getBoundingClientRect();
  var top = hudEl.hidden ? 0 : hudEl.getBoundingClientRect().bottom - ar.top;
  var bot = ctlEl.hidden ? 0 : ar.bottom - ctlEl.getBoundingClientRect().top;
  F.setInsets(top, bot);
}
UI.insets = insets;

function chip(el, t) {
  var c = T(t), ab = el.querySelector('.sb-ab');
  ab.textContent = c.abbr; ab.style.background = c.c1; ab.style.color = inkOn(c.c1); ab.style.borderColor = c.c2;
}
UI.gameShow = function (S) {
  scr.hidden = true; cardEl.hidden = true; pauseEl.hidden = true;
  hudEl.hidden = false;
  chip($('hudMe'), S.me); chip($('hudOpp'), S.opp);
  UI.hud(S);
  insets();
};
UI.hud = function (S) {
  if (!S) return;
  $('hudMe').querySelector('.sb-pts').textContent = S.sc[0];
  $('hudOpp').querySelector('.sb-pts').textContent = S.sc[1];
  $('hudQ').textContent = S.ot ? 'OT' + (S.ot > 1 ? S.ot : '') : 'Q' + S.q;
  $('hudClock').textContent = S.ot ? '--:--' : M.clockText(S.clock);
  $('hudMe').classList.toggle('has', S.poss === 'me');
  $('hudOpp').classList.toggle('has', S.poss === 'opp');
  $('hudDown').textContent = S.poss === 'me' ? M.downText() : T(S.opp).abbr + ' ball';
  $('hudSpot').textContent = S.poss === 'me' ? 'Ball on ' + M.spotText(S.los) : '';
};

UI.playCall = function (opts, sel, cb) {
  playCb = cb;
  ctlIn.innerHTML = opts.map(function (o) {
    return '<button class="play' + (o.special ? ' sp' : '') + (o.id === sel ? ' on' : '') + '" data-p="' + o.id + '">' + esc(o.label) + '<small>' + esc(o.sub) + '</small></button>';
  }).join('') + '<button class="play snap" data-p="snap">Snap<small>or tap the field</small></button>';
  ctlEl.hidden = false;
  insets();
};
UI.hidePlayCall = function () { if (!ctlEl.hidden) { ctlEl.hidden = true; insets(); } };

UI.banner = function (title, sub, kind, ms) {
  var b = bannerEl.querySelector('b'), s = bannerEl.querySelector('span');
  b.textContent = title; s.textContent = sub || ''; s.hidden = !sub;
  bannerEl.style.setProperty('--bk', kind === 'good' ? '#1f7a37' : kind === 'bad' ? '#a2282d' : '#22305a');
  bannerEl.hidden = false;
  bannerEl.classList.remove('pop'); void bannerEl.offsetWidth; bannerEl.classList.add('pop');
  if (title === 'TOUCHDOWN!') UI.sfx('td');
  clearTimeout(bannerT);
  bannerT = setTimeout(function () { bannerEl.hidden = true; }, ms || 1400);
};
UI.toast = function (text) {
  toastEl.textContent = text; toastEl.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(function () { toastEl.hidden = true; }, 1600);
};
UI.hint = function (text) {
  clearTimeout(hintT); clearTimeout(hintT2);
  if (!text) { hintEl.hidden = true; return; }
  hintEl.textContent = text; hintEl.hidden = false; hintEl.classList.remove('fade');
  hintT = setTimeout(function () { hintEl.classList.add('fade'); }, 3200);
  hintT2 = setTimeout(function () { hintEl.hidden = true; }, 4000);
};
UI.kickHud = function (o) {
  if (!o) { kickEl.hidden = true; return; }
  kickEl.innerHTML = '<b>' + (o.kind === 'PAT' ? 'Extra point' : 'Field goal') + ' &middot; ' + o.dist + ' yds</b>' +
    '<span>Wind ' + Math.abs(o.wind) + ' mph ' + (o.wind > 0 ? '&rarr;' : o.wind < 0 ? '&larr;' : '') + '</span>' +
    '<span id="kickTip">Swipe up toward the posts. A longer swipe kicks farther.</span>';
  kickEl.hidden = false;
  UI.hidePlayCall();
};

UI.card = function (o) {
  revealT.forEach(clearTimeout); revealT = [];
  var lines = o.lines || [];
  var buttons = o.buttons || [{ id: 'ok', label: o.button || 'Continue' }];
  cardEl.innerHTML = '<div class="cardbox" role="dialog" aria-live="polite">' + (o.title ? '<h3>' + esc(o.title) + '</h3>' : '') +
    (o.big ? '<div class="big">' + esc(o.big) + '</div>' : '') +
    lines.map(function (l, i) { return '<div class="ln' + (i === lines.length - 1 && o.kind ? ' k-' + o.kind : '') + '">' + esc(l) + '</div>'; }).join('') +
    '<div class="acts">' + buttons.map(function (b, i) {
      return '<button class="btn' + (i ? ' ghost' : '') + '" data-c="' + esc(b.id) + '">' + esc(b.label) + (b.sub ? ' <small style="font-family:var(--body);text-transform:none;opacity:.8">' + esc(b.sub) + '</small>' : '') + '</button>';
    }).join('') + '</div></div>';
  cardEl.hidden = false;
  UI.hidePlayCall();
  var lns = cardEl.querySelectorAll('.ln');
  for (var i = 0; i < lns.length; i++) {
    (function (el, k) { revealT.push(setTimeout(function () { el.classList.add('show'); }, 120 + k * 380)); })(lns[i], i);
  }
  cardEl.onclick = function (e) {
    var b = e.target.closest('[data-c]');
    if (!b) return;
    UI.sfx('blip');
    cardEl.hidden = true; cardEl.onclick = null;
    if (o.onDone) o.onDone(b.getAttribute('data-c'));
  };
};
UI.choice = function (title, sub, options, cb) {
  UI.card({ title: title, lines: [sub], buttons: options, onDone: cb });
};

function pause() {
  if (!M.active() || !pauseEl.hidden) return;
  F.paused = true;
  pauseEl.innerHTML = '<div class="cardbox" role="dialog"><h3>Paused</h3><div class="big">' + esc(T(M.state().me).abbr) + ' ' + M.state().sc[0] + ' - ' + M.state().sc[1] + ' ' + esc(T(M.state().opp).abbr) + '</div>' +
    '<div class="ln show">Sim to end plays out the rest of this game instantly.</div>' +
    '<div class="acts"><button class="btn" data-c="resume">Resume</button><button class="btn ghost" data-c="sim">Sim to end</button></div></div>';
  pauseEl.hidden = false;
}
function onPause(e) {
  var b = e.target.closest('[data-c]');
  if (!b) return;
  pauseEl.hidden = true;
  F.paused = false;
  if (b.getAttribute('data-c') === 'sim') { cardEl.hidden = true; kickEl.hidden = true; M.simRest(); }
}

// =====================================================================
// Field events -> sounds and pops
// =====================================================================
function onField(n, d) {
  switch (n) {
    case 'snap': UI.sfx('hut'); break;
    case 'throw': UI.sfx('throw'); break;
    case 'catch': UI.sfx('catch'); break;
    case 'int': UI.sfx('miss'); break;
    case 'broken': UI.toast('Broken tackle!'); UI.sfx('juke'); break;
    case 'juke': case 'dive': UI.sfx('juke'); break;
    case 'scramble': UI.toast('Scramble!'); break;
    case 'dead':
      if (d.kind === 'tackle' || d.kind === 'sack') UI.sfx('hit');
      else if (d.kind !== 'td') UI.sfx('whistle');
      break;
    case 'kick': UI.sfx('kick'); var tip = $('kickTip'); if (tip) tip.hidden = true; break;
    case 'kickDone': UI.banner(d.good ? 'IT\'S GOOD!' : 'NO GOOD', d.why || '', d.good ? 'good' : 'bad', 1300); UI.sfx(d.good ? 'good' : 'miss'); break;
  }
}

// =====================================================================
// Boot
// =====================================================================
UI.init = function () {
  app = $('app'); scr = $('scr'); hudEl = $('hud'); ctlEl = $('ctl'); ctlIn = $('ctlIn');
  bannerEl = $('banner'); toastEl = $('toast'); cardEl = $('card'); hintEl = $('hint'); kickEl = $('kickHud');
  pauseEl = document.createElement('div');
  pauseEl.id = 'pause'; pauseEl.hidden = true;
  pauseEl.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;background:#04070dcc;padding:16px max(16px,env(safe-area-inset-right,0px)) 16px max(16px,env(safe-area-inset-left,0px))';
  app.appendChild(pauseEl);
  pauseEl.addEventListener('click', onPause);
  scr.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    var f = acts[b.getAttribute('data-a')];
    if (f) { UI.sfx('blip'); f(b.getAttribute('data-v'), b); }
  });
  scr.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button') { e.preventDefault(); e.target.click(); }
  });
  scr.addEventListener('input', function (e) { if (e.target.id === 'coachName') pick.name = e.target.value; });
  ctlIn.addEventListener('click', function (e) {
    var b = e.target.closest('[data-p]');
    if (b && playCb) playCb(b.getAttribute('data-p'));
  });
  $('pauseBtn').addEventListener('click', pause);
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });
  window.addEventListener('pointerdown', function () { if (L.settings.sound) ac(); }, { once: true });
  window.addEventListener('resize', function () { setTimeout(insets, 50); });
  F.onEvent = onField;
};
})();
