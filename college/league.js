/* Saturday Gridiron - league.js
   Dynasty state (SG.L.D), players, schedules, the drive-by-drive game
   sim, rankings, postseason, offseason and recruiting. No DOM here
   except localStorage, which is always wrapped in try/catch. */
(function () {
'use strict';
var SG = window.SG;
var L = SG.L = {};
var SAVE_KEY = 'satgrid_dynasty_v1';
var SET_KEY = 'satgrid_settings_v1';
var NT = SG.TEAMS.length;

L.D = null;
L.settings = { qlen: 10, diff: 1, sound: true };

// =====================================================================
// Players
// =====================================================================
var OFFS = {
  QB: { spd: -6, str: -10, skl: 2, arm: 2 },
  RB: { spd: 3, str: 0, skl: -3, arm: -40 },
  WR: { spd: 3, str: -12, skl: 2, arm: -40 },
  TE: { spd: -4, str: 2, skl: 0, arm: -40 },
  OL: { spd: -25, str: 3, skl: -3, arm: -40 },
  K: { spd: -20, str: -25, skl: 1, arm: 1 },
  DL: { spd: -8, str: 4, skl: 1, arm: -40 },
  LB: { spd: -1, str: 0, skl: 1, arm: -40 },
  DB: { spd: 3, str: -12, skl: 2, arm: -40 }
};
var NUMS = {
  QB: [1, 19], RB: [1, 49], WR: [1, 19, 80, 89], TE: [80, 89, 40, 49], OL: [50, 79],
  K: [1, 49, 90, 99], DL: [90, 99, 50, 79], LB: [1, 59], DB: [1, 49]
};

L.ovr = function (p) {
  var s = p.spd, t = p.str, k = p.skl, a = p.arm;
  switch (p.pos) {
    case 'QB': return Math.round(k * 0.45 + a * 0.35 + s * 0.2);
    case 'RB': return Math.round(s * 0.45 + t * 0.3 + k * 0.25);
    case 'WR': return Math.round(s * 0.5 + k * 0.45 + t * 0.05);
    case 'TE': return Math.round(k * 0.35 + t * 0.35 + s * 0.3);
    case 'OL': return Math.round(t * 0.6 + k * 0.4);
    case 'K': return Math.round(a * 0.5 + k * 0.5);
    case 'DL': return Math.round(t * 0.5 + k * 0.3 + s * 0.2);
    case 'LB': return Math.round(k * 0.4 + s * 0.3 + t * 0.3);
    default: return Math.round(s * 0.45 + k * 0.45 + t * 0.1);
  }
};

function attr(v) { return Math.round(SG.clamp(v, 25, 99)); }

L.makePlayer = function (pos, target, yr, pot, used) {
  var o = OFFS[pos];
  var p = {
    id: 0, fn: SG.pick(SG.FIRST), ln: SG.pick(SG.LAST), pos: pos, yr: yr,
    spd: attr(target + o.spd + SG.gauss() * 4),
    str: attr(target + o.str + SG.gauss() * 4),
    skl: attr(target + o.skl + SG.gauss() * 4),
    arm: attr(target + o.arm + SG.gauss() * 4),
    pot: pot, num: 0, tw: -1
  };
  p.ovr = L.ovr(p);
  p.num = pickNum(pos, used);
  return p;
};

function pickNum(pos, used) {
  var r = NUMS[pos], n, tries = 0;
  do {
    var lo = r[0], hi = r[1];
    if (r.length > 2 && SG.rand() < 0.4) { lo = r[2]; hi = r[3]; }
    n = SG.ri(lo, hi);
  } while (used && used[n] && ++tries < 40);
  if (used) used[n] = 1;
  return n;
}

function usedNums(roster) {
  var u = {};
  roster.forEach(function (p) { u[p.num] = 1; });
  return u;
}

function newId() { return ++L.D.pid; }

L.makeRoster = function (prestige) {
  var roster = [], used = {};
  var counts = { QB: 2, RB: 3, WR: 5, TE: 2, OL: 7, K: 1, DL: 5, LB: 4, DB: 5 };
  Object.keys(counts).forEach(function (pos) {
    for (var i = 0; i < counts[pos]; i++) {
      var yr = SG.ri(0, 3);
      var target = 52 + prestige * 5 + yr * 3 + SG.gauss() * 4 - (i >= SG.STARTERS[pos] ? 4 : 0);
      var pot = SG.clamp(Math.round(prestige * 0.6 + SG.rf(0, 2.6)), 1, 5);
      var p = L.makePlayer(pos, target, yr, pot, used);
      p.id = newId();
      roster.push(p);
    }
  });
  return roster;
};

// Best N at each position, sorted by OVR.
L.depth = function (roster) {
  var d = {};
  SG.POS.forEach(function (pos) { d[pos] = []; });
  (roster || L.D.roster).forEach(function (p) { d[p.pos].push(p); });
  SG.POS.forEach(function (pos) { d[pos].sort(function (a, b) { return b.ovr - a.ovr; }); });
  return d;
};
L.starters = function () {
  var d = L.depth(), s = {};
  SG.POS.forEach(function (pos) { s[pos] = d[pos].slice(0, SG.STARTERS[pos]); });
  return s;
};

function avg(list, n) {
  if (!list.length) return 45;
  var t = 0, i;
  for (i = 0; i < n; i++) t += list[Math.min(i, list.length - 1)].ovr;
  return t / n;
}

// Team ratings. AI teams store theirs; ours come from the roster.
L.myRatings = function () {
  var d = L.depth();
  var off = avg(d.QB, 1) * 0.3 + avg(d.RB, 1) * 0.1 + avg(d.WR, 3) * 0.2 + avg(d.TE, 1) * 0.07 + avg(d.OL, 5) * 0.33;
  var def = avg(d.DL, 4) * 0.35 + avg(d.LB, 3) * 0.3 + avg(d.DB, 4) * 0.35;
  return { off: Math.round(off), def: Math.round(def), ovr: Math.round((off + def) / 2) };
};
L.ratings = function (i) {
  if (L.D && i === L.D.team) return L.myRatings();
  var t = L.D.teams[i];
  return { off: t.off, def: t.def, ovr: Math.round((t.off + t.def) / 2) };
};

// Eleven made-up defenders for the on-field game, built from a team's defense rating.
L.genDefense = function (i) {
  var def = L.ratings(i).def, out = [], used = {};
  var shape = [['DL', 4], ['LB', 3], ['DB', 4]];
  shape.forEach(function (s) {
    for (var k = 0; k < s[1]; k++) {
      var p = L.makePlayer(s[0], def + SG.gauss() * 3, SG.ri(0, 3), 3, used);
      out.push(p);
    }
  });
  return out;
};

// =====================================================================
// Dynasty lifecycle
// =====================================================================
L.newDynasty = function (team, coach) {
  L.D = {
    v: 1, pid: 0, season: 1, phase: 'reg', week: 0,
    team: team, coach: coach || 'Coach',
    cp: 10, job: 60, fac: { train: 1, recruit: 1, stadium: 1 },
    teams: SG.TEAMS.map(function (t) { return { prestige: t.basePrestige, off: 0, def: 0 }; }),
    history: [], roster: [], recruits: null, offStep: null, last: null, titles: 0, careerW: 0, careerL: 0
  };
  L.D.roster = L.makeRoster(SG.TEAMS[team].basePrestige);
  L.newSeason(true);
};

L.year = function () { return SG.START_YEAR + L.D.season - 1; };

L.newSeason = function (first) {
  var D = L.D;
  if (!first) D.season++;
  D.phase = 'reg'; D.week = 0; D.offStep = null; D.recruits = null;
  D.teams.forEach(function (t, i) {
    var base = 50 + t.prestige * 6;
    t.off = Math.round(SG.clamp(base + SG.gauss() * 4.5, 48, 94));
    t.def = Math.round(SG.clamp(base + SG.gauss() * 4.5, 48, 94));
  });
  D.rec = [];
  for (var i = 0; i < NT; i++) D.rec.push({ w: 0, l: 0, cw: 0, cl: 0, pf: 0, pa: 0 });
  D.sched = buildSchedule();
  D.post = { ccg: [], qf: [], sf: [], final: [], bowl: null, seeds: [], champ: -1 };
  D.stats = {};
  D.roster.forEach(function (p) { p.tw = -1; });
  L.rankAll();
  L.save();
};

// =====================================================================
// Schedule: weeks 1-5 non-conference, 6-11 conference, 12 rivalry week
// =====================================================================
function mkGame(h, a, kind, wk) {
  return { h: h, a: a, hs: 0, as: 0, done: false, ot: 0, kind: kind, wk: wk };
}

function buildSchedule() {
  var weeks = [], w, played = {};
  for (w = 0; w < 12; w++) weeks.push([]);
  SG.CONFS.forEach(function (c) {
    var t = c.teams;
    var seat = [t[0], t[2], t[4], t[6], t[7], t[5], t[3], t[1]];
    for (var r = 0; r < 7; r++) {
      var wk = r === 0 ? 11 : 4 + r;
      for (var i = 0; i < 4; i++) {
        var a = seat[i], b = seat[7 - i];
        var flip = (r + i + c.teams[0]) % 2;
        weeks[wk].push(mkGame(flip ? a : b, flip ? b : a, r === 0 ? 'rival' : 'conf', wk));
        played[a + '-' + b] = played[b + '-' + a] = 1;
      }
      seat.splice(1, 0, seat.pop());
    }
  });
  for (w = 0; w < 5; w++) {
    var pairs = null;
    for (var attempt = 0; attempt < 300 && !pairs; attempt++) pairs = matchWeek(played, attempt > 250);
    pairs.forEach(function (pr) {
      played[pr[0] + '-' + pr[1]] = played[pr[1] + '-' + pr[0]] = 1;
      var hf = SG.rand() < 0.5;
      weeks[w].push(mkGame(hf ? pr[0] : pr[1], hf ? pr[1] : pr[0], 'nc', w));
    });
  }
  return weeks;
}

function matchWeek(played, allowRepeat) {
  var pool = [], i, pairs = [];
  for (i = 0; i < NT; i++) pool.push(i);
  SG.shuffle(pool);
  while (pool.length) {
    var a = pool.pop(), found = -1;
    for (var k = pool.length - 1; k >= 0; k--) {
      var b = pool[k];
      if (SG.TEAMS[a].conf !== SG.TEAMS[b].conf && (allowRepeat || !played[a + '-' + b])) { found = k; break; }
    }
    if (found < 0) return null;
    pairs.push([a, pool.splice(found, 1)[0]]);
  }
  return pairs;
}

// =====================================================================
// Simulation
// =====================================================================
// One possession. startX = yards from the offense's own goal line.
L.simDrive = function (off, def, startX) {
  var diff = off - def;
  var fp = SG.clamp((startX - 25) / 75, -0.3, 1);
  var pTD = SG.clamp(0.24 + diff * 0.011 + fp * 0.34, 0.04, 0.9);
  var pFG = SG.clamp(0.15 + fp * 0.08 + diff * 0.002, 0.05, 0.3);
  var pTO = SG.clamp(0.11 - diff * 0.003 - fp * 0.03, 0.03, 0.22);
  var r = SG.rand(), kind;
  if (r < pTD) kind = 'TD';
  else if ((r -= pTD) < pFG) kind = 'FG';
  else if ((r -= pFG) < pTO) kind = SG.rand() < 0.6 ? 'INT' : 'FUM';
  else if ((r -= pTO) < 0.04) kind = 'DOWNS';
  else kind = fp > 0.5 ? (SG.rand() < 0.55 ? 'MISS' : 'DOWNS') : 'PUNT';
  var endX, plays, pts = 0;
  switch (kind) {
    case 'TD': endX = 100; plays = SG.ri(4, 12); pts = SG.rand() < 0.96 ? 7 : 6; break;
    case 'FG': endX = SG.clamp(startX + SG.ri(15, 55), 58, 96); plays = SG.ri(5, 11); pts = 3; break;
    case 'MISS': endX = SG.clamp(startX + SG.ri(10, 40), 55, 92); plays = SG.ri(5, 10); break;
    case 'PUNT': endX = SG.clamp(startX + SG.ri(0, 32), startX, 62); plays = SG.ri(3, 7); break;
    case 'DOWNS': endX = SG.clamp(startX + SG.ri(5, 45), 20, 97); plays = SG.ri(4, 9); break;
    default: endX = SG.clamp(startX + SG.ri(-4, 45), 2, 97); plays = SG.ri(2, 8);
  }
  if (endX < startX && kind !== 'INT' && kind !== 'FUM') endX = startX;
  return { kind: kind, pts: pts, endX: endX, plays: plays, yards: Math.max(0, Math.round(endX - startX)),
    secs: plays * SG.ri(23, 33), startX: startX };
};

// Where the other team starts after a drive ends (their own yard line).
L.nextStart = function (dr) {
  switch (dr.kind) {
    case 'TD': case 'FG': case 'SAFETY':
      return SG.rand() < 0.6 ? 25 : SG.ri(14, 40);
    case 'PUNT': {
      var land = dr.endX + SG.ri(34, 48);
      if (land >= 100) return 20;
      return SG.clamp(100 - land + SG.ri(0, 9), 3, 60);
    }
    case 'INT': case 'FUM':
      return SG.clamp(100 - dr.endX + SG.ri(0, 22), 3, 98);
    case 'MISS':
      return SG.clamp(100 - dr.endX + 7, 20, 60);
    default:
      return SG.clamp(100 - dr.endX, 3, 97);
  }
};

L.simGame = function (g) {
  var A = L.ratings(g.h), B = L.ratings(g.a);
  var hfa = g.neutral ? 0 : 2.5;
  if (!g.neutral && g.h === L.D.team) hfa += (L.D.fac.stadium - 1) * 0.8;
  var hs = 0, as = 0, n = SG.ri(10, 12), sh = 25, sa = 25, i, d;
  for (i = 0; i < n; i++) {
    d = L.simDrive(A.off + hfa, B.def, sh); hs += d.pts; sa = L.nextStart(d);
    d = L.simDrive(B.off, A.def + hfa, sa); as += d.pts; sh = L.nextStart(d);
  }
  var ot = 0;
  while (hs === as && ot < 9) {
    ot++;
    if (ot >= 3) {
      hs += SG.rand() < 0.45 + (A.off - B.def) * 0.006 ? 2 : 0;
      as += SG.rand() < 0.45 + (B.off - A.def) * 0.006 ? 2 : 0;
      continue;
    }
    d = L.simDrive(A.off, B.def, 75); hs += d.pts;
    d = L.simDrive(B.off, A.def, 75); as += d.pts;
  }
  if (hs === as) hs += 2;
  return { hs: hs, as: as, ot: ot };
};

L.record = function (g, hs, as, ot) {
  var D = L.D;
  g.hs = hs; g.as = as; g.ot = ot || 0; g.done = true;
  var H = D.rec[g.h], A = D.rec[g.a], conf = g.kind === 'conf' || g.kind === 'rival';
  H.pf += hs; H.pa += as; A.pf += as; A.pa += hs;
  if (hs > as) { H.w++; A.l++; if (conf) { H.cw++; A.cl++; } }
  else { A.w++; H.l++; if (conf) { A.cw++; H.cl++; } }
  if (g.h === D.team || g.a === D.team) {
    if ((g.h === D.team) === (hs > as)) D.careerW++; else D.careerL++;
  }
};

L.winner = function (g) { return g.hs > g.as ? g.h : g.a; };
L.loser = function (g) { return g.hs > g.as ? g.a : g.h; };

// =====================================================================
// Rankings: preseason strength blended with results (margin-capped SRS + win%)
// =====================================================================
L.allDone = function () {
  var D = L.D, out = [];
  D.sched.forEach(function (wk) { wk.forEach(function (g) { if (g.done) out.push(g); }); });
  ['ccg', 'qf', 'sf', 'final'].forEach(function (k) { D.post[k].forEach(function (g) { if (g.done) out.push(g); }); });
  if (D.post.bowl && D.post.bowl.done) out.push(D.post.bowl);
  return out;
};

L.rankAll = function () {
  var D = L.D, games = L.allDone(), r = [], nr = [], cnt = [], i, it;
  for (i = 0; i < NT; i++) r.push(0);
  for (it = 0; it < 24; it++) {
    for (i = 0; i < NT; i++) { nr[i] = 0; cnt[i] = 0; }
    games.forEach(function (g) {
      var m = SG.clamp(g.hs - g.as, -24, 24);
      nr[g.h] += m + r[g.a]; cnt[g.h]++;
      nr[g.a] += -m + r[g.h]; cnt[g.a]++;
    });
    var mean = 0;
    for (i = 0; i < NT; i++) { r[i] = 0.5 * r[i] + 0.5 * (cnt[i] ? nr[i] / cnt[i] : 0); mean += r[i]; }
    mean /= NT;
    for (i = 0; i < NT; i++) r[i] -= mean;
  }
  var score = [];
  for (i = 0; i < NT; i++) {
    var rt = L.ratings(i), rec = D.rec[i], gp = rec.w + rec.l;
    var pre = (rt.ovr - 70) * 1.3 + D.teams[i].prestige * 2.2;
    var res = r[i] * 0.55 + (gp ? rec.w / gp - 0.5 : 0) * 56;
    var w = Math.min(1, gp / 6);
    score.push({ i: i, s: pre * (1 - w) + res * w + SG.rand() * 0.01 });
  }
  score.sort(function (a, b) { return b.s - a.s; });
  D.rank = [];
  score.forEach(function (o, k) { D.rank[o.i] = k + 1; });
  D.poll = score.map(function (o) { return o.i; });
};
L.rank = function (i) { var r = L.D.rank[i]; return r <= 25 ? r : 0; };

// =====================================================================
// Phases
// =====================================================================
L.PHASES = ['reg', 'ccg', 'qf', 'sf', 'final', 'recap'];

L.phaseGames = function () {
  var D = L.D;
  if (D.phase === 'reg') return D.sched[D.week];
  if (D.phase === 'ccg') return D.post.ccg;
  if (D.phase === 'qf') return D.post.bowl ? D.post.qf.concat([D.post.bowl]) : D.post.qf;
  if (D.phase === 'sf') return D.post.sf;
  if (D.phase === 'final') return D.post.final;
  return [];
};

L.myGame = function () {
  var t = L.D.team, gs = L.phaseGames();
  for (var i = 0; i < gs.length; i++) if (gs[i].h === t || gs[i].a === t) return gs[i];
  return null;
};

L.gameLabel = function (g) {
  var D = L.D;
  if (!g) return '';
  if (g.kind === 'ccg') return SG.CONFS[SG.TEAMS[g.h].conf].name + ' Championship';
  if (g.kind === 'qf') return SG.PLAYOFF_NAME + ' Quarterfinal';
  if (g.kind === 'sf') return SG.PLAYOFF_NAME + ' Semifinal';
  if (g.kind === 'final') return SG.TITLE_GAME + ' (National Title)';
  if (g.kind === 'bowl') return g.name;
  return 'Week ' + (g.wk + 1) + (g.kind === 'rival' ? ' - Rivalry Week' : '');
};

L.phaseLabel = function () {
  var D = L.D;
  switch (D.phase) {
    case 'reg': return 'Week ' + (D.week + 1);
    case 'ccg': return 'Championship Week';
    case 'qf': return 'Bowl Season & Quarterfinals';
    case 'sf': return SG.PLAYOFF_NAME + ' Semifinals';
    case 'final': return SG.TITLE_GAME;
    default: return 'Season Over';
  }
};

function confOrder(ci) {
  var D = L.D;
  return SG.CONFS[ci].teams.slice().sort(function (a, b) {
    var A = D.rec[a], B = D.rec[b];
    return (B.cw - B.cl) - (A.cw - A.cl) || (B.w - B.l) - (A.w - A.l) ||
      ((B.pf - B.pa) - (A.pf - A.pa)) || D.rank[a] - D.rank[b];
  });
}
L.confOrder = confOrder;

function setupCCG() {
  var D = L.D;
  D.post.ccg = SG.CONFS.map(function (c, ci) {
    var o = confOrder(ci), g = mkGame(o[0], o[1], 'ccg', 12);
    g.neutral = true;
    return g;
  });
}

function setupPlayoff() {
  var D = L.D;
  var champs = D.post.ccg.map(L.winner);
  var field = champs.slice();
  D.poll.forEach(function (t) { if (field.length < 8 && field.indexOf(t) < 0) field.push(t); });
  field.sort(function (a, b) { return D.rank[a] - D.rank[b]; });
  D.post.seeds = field;
  D.post.champs = champs;
  var s = field;
  D.post.qf = [[0, 7], [3, 4], [1, 6], [2, 5]].map(function (p) {
    var g = mkGame(s[p[0]], s[p[1]], 'qf', 13);
    g.seedH = p[0] + 1; g.seedA = p[1] + 1;
    return g;
  });
  // A bowl for us when we miss the field but won at least six.
  D.post.bowl = null;
  if (field.indexOf(D.team) < 0 && D.rec[D.team].w >= 6) {
    var opp = -1;
    D.poll.forEach(function (t) {
      if (opp < 0 && t !== D.team && field.indexOf(t) < 0 && D.rec[t].w >= 6 &&
        SG.TEAMS[t].conf !== SG.TEAMS[D.team].conf && Math.abs(D.rank[t] - D.rank[D.team]) < 14) opp = t;
    });
    if (opp < 0) D.poll.forEach(function (t) { if (opp < 0 && t !== D.team && field.indexOf(t) < 0) opp = t; });
    var b = mkGame(D.team, opp, 'bowl', 13);
    b.neutral = true; b.name = SG.pick(SG.BOWLS);
    if (D.rank[opp] < D.rank[D.team]) { b.h = opp; b.a = D.team; }
    D.post.bowl = b;
  }
}

function seedOf(t) { return L.D.post.seeds.indexOf(t) + 1; }

function setupNext(prev, kind) {
  var out = [];
  for (var i = 0; i < prev.length; i += 2) {
    var a = L.winner(prev[i]), b = L.winner(prev[i + 1]);
    if (seedOf(b) < seedOf(a)) { var t = a; a = b; b = t; }
    var g = mkGame(a, b, kind, 14);
    g.seedH = seedOf(a); g.seedA = seedOf(b);
    if (kind === 'final') g.neutral = true;
    out.push(g);
  }
  return out;
}

// Sims every unplayed game in the current phase, then moves on.
L.advance = function () {
  var D = L.D, gs = L.phaseGames(), simmed = [];
  gs.forEach(function (g) {
    if (g.done) return;
    var r = L.simGame(g);
    L.record(g, r.hs, r.as, r.ot);
    simmed.push(g);
  });
  var played = gs.slice();
  if (D.phase === 'reg') {
    D.week++;
    if (D.week >= 12) { D.phase = 'ccg'; L.rankAll(); setupCCG(); }
  } else if (D.phase === 'ccg') { D.phase = 'qf'; L.rankAll(); setupPlayoff(); }
  else if (D.phase === 'qf') { D.phase = 'sf'; D.post.sf = setupNext(D.post.qf, 'sf'); }
  else if (D.phase === 'sf') { D.phase = 'final'; D.post.final = setupNext(D.post.sf, 'final'); }
  else if (D.phase === 'final') { D.post.champ = L.winner(D.post.final[0]); D.phase = 'recap'; }
  L.rankAll();
  L.save();
  return played;
};

// =====================================================================
// Coach points, facilities, training
// =====================================================================
L.FAC = {
  train: { name: 'Training Center', desc: 'Players improve more every offseason.' },
  recruit: { name: 'Recruiting Office', desc: 'Prospects are more interested in your school.' },
  stadium: { name: 'Stadium', desc: 'Louder home crowd and more coach points from home wins.' }
};
L.facCost = function (lvl) { return [0, 12, 22, 36, 55][lvl] || 0; };
L.upgrade = function (k) {
  var D = L.D, lvl = D.fac[k], c = L.facCost(lvl);
  if (lvl >= 5 || D.cp < c) return false;
  D.cp -= c; D.fac[k]++; L.save();
  return true;
};

L.stamp = function () { var D = L.D; return D.season * 100 + L.PHASES.indexOf(D.phase) * 20 + D.week; };
L.trainCost = function (p) { return Math.max(2, Math.round((p.ovr - 50) / 8)); };
L.train = function (p) {
  var D = L.D, c = L.trainCost(p);
  if (D.cp < c || p.tw === L.stamp()) return null;
  D.cp -= c; p.tw = L.stamp();
  var keys = p.pos === 'QB' || p.pos === 'K' ? ['skl', 'arm', 'skl'] : ['spd', 'str', 'skl', 'skl'];
  var k = SG.pick(keys), n = SG.ri(1, 3);
  if (p.ovr >= 90) n = 1;
  p[k] = attr(p[k] + n);
  p.ovr = L.ovr(p);
  L.save();
  return { k: k, n: n };
};

// Coach points for a finished game of ours.
L.awardGame = function (g, myTD) {
  var D = L.D, won = L.winner(g) === D.team, opp = g.h === D.team ? g.a : g.h;
  var cp = won ? 4 : 1;
  if (won && L.rank(opp)) cp += 2;
  if (won && g.kind !== 'nc' && g.kind !== 'conf') cp += 3;
  if (won && g.h === D.team && !g.neutral) cp += D.fac.stadium - 1;
  cp += Math.min(4, myTD || 0);
  D.cp += cp;
  return cp;
};

// Season stats for our players.
L.stat = function (pid, key, n) {
  var s = L.D.stats[pid] || (L.D.stats[pid] = {});
  s[key] = (s[key] || 0) + n;
};

// =====================================================================
// Season end and offseason
// =====================================================================
L.endSeason = function () {
  var D = L.D, me = D.team, rec = D.rec[me], P = D.teams[me].prestige;
  var out = { rec: rec.w + '-' + rec.l, rank: D.rank[me], conf: false, playoff: 0, champ: D.post.champ === me, bowl: null };
  out.conf = D.post.ccg.some(function (g) { return L.winner(g) === me; });
  if (D.post.seeds.indexOf(me) >= 0) {
    out.playoff = 1;
    if (D.post.sf.some(function (g) { return g.h === me || g.a === me; })) out.playoff = 2;
    if (D.post.final.some(function (g) { return g.h === me || g.a === me; })) out.playoff = 3;
  }
  if (D.post.bowl) out.bowl = { name: D.post.bowl.name, won: L.winner(D.post.bowl) === me };

  // Booster confidence
  var expect = 3 + P * 1.5, dj = Math.round((rec.w - expect) * 5);
  if (out.conf) dj += 15;
  if (out.playoff) dj += 10 * out.playoff;
  if (out.champ) dj += 25;
  if (out.bowl && out.bowl.won) dj += 5;
  var lostRival = D.sched[11].some(function (g) {
    return (g.h === me || g.a === me) && g.done && L.winner(g) !== me;
  });
  if (lostRival) dj -= 6;
  out.jobDelta = dj;
  D.job = SG.clamp(D.job + dj, -50, 100);
  // first year at a school is a honeymoon
  if (D.tenure === undefined) D.tenure = 0;
  D.tenure++;
  if (D.tenure <= 1) D.job = Math.max(D.job, 15);
  out.fired = D.job < 0;

  // Prestige drifts toward results for every school.
  out.prestigeBefore = P;
  D.teams.forEach(function (t, i) {
    var rk = D.rank[i], d = 0;
    if (D.post.champ === i) d = 0.8;
    else if (rk <= 5) d = 0.5;
    else if (rk <= 15) d = 0.25;
    else if (rk <= 25) d = 0.05;
    else if (D.rec[i].w < 5) d = -0.35;
    else d = -0.1;
    d += (SG.TEAMS[i].basePrestige - t.prestige) * 0.08;
    t.prestige = SG.clamp(Math.round((t.prestige + d) * 100) / 100, 1, 5);
  });
  out.prestigeAfter = D.teams[me].prestige;

  // Golden Helmet: our best skill player against a made-up field.
  var best = null, bestScore = 0;
  D.roster.forEach(function (p) {
    var s = D.stats[p.id]; if (!s) return;
    var v = (s.py || 0) / 22 + (s.ptd || 0) * 4 - (s.int || 0) * 3 + (s.ry || 0) / 10 + (s.rtd || 0) * 6 +
      (s.rcy || 0) / 10 + (s.rctd || 0) * 6;
    if (v > bestScore) { bestScore = v; best = p; }
  });
  var bar = 210 + SG.rf(-30, 40) - (out.champ ? 50 : 0) - (rec.w >= 11 ? 25 : 0);
  if (best && bestScore > bar) out.award = { mine: true, name: best.fn + ' ' + best.ln, pos: best.pos, team: me };
  else {
    var t = D.poll[SG.ri(0, 3)];
    if (t === me) t = D.poll[4];
    out.award = { mine: false, name: SG.pick(SG.FIRST) + ' ' + SG.pick(SG.LAST), pos: SG.pick(['QB', 'QB', 'RB', 'WR']), team: t };
  }
  if (out.champ) { D.cp += 15; D.titles++; }
  D.cp += out.conf ? 6 : 0;
  D.history.push({ yr: L.year(), team: me, rec: out.rec, rank: out.rank, conf: out.conf, playoff: out.playoff, champ: out.champ,
    bowl: out.bowl });
  D.offStep = out.fired ? 'fired' : 'grad';
  D.lastRecap = out;
  L.save();
  return out;
};

L.graduate = function () {
  var D = L.D, gone = [], pro = [];
  D.roster = D.roster.filter(function (p) {
    if (p.yr >= 3) { gone.push(p); return false; }
    if (p.yr === 2 && p.ovr >= 84 && SG.rand() < 0.5) { pro.push(p); return false; }
    return true;
  });
  D.recruits = L.makeRecruits();
  D.offStep = 'recruit';
  L.save();
  return { gone: gone, pro: pro };
};

L.scholarships = function () { return Math.max(0, SG.ROSTER_MAX - L.D.roster.length); };
// You may offer a few more than you have room for; signings stop once the roster is full.
L.offerCap = function () { return L.scholarships() + 4; };

L.needs = function () {
  var d = L.depth(), out = {};
  SG.POS.forEach(function (pos) {
    var want = SG.ROSTER_MIN[pos] + (pos === 'OL' || pos === 'DB' || pos === 'WR' || pos === 'DL' ? 1 : 0);
    out[pos] = Math.max(0, want - d[pos].length);
  });
  return out;
};

L.makeRecruits = function () {
  var D = L.D, P = D.teams[D.team].prestige, list = [], need = L.needs(), used = usedNums(D.roster);
  var pool = [];
  SG.POS.forEach(function (pos) {
    var n = need[pos] * 2 + (pos === 'K' ? 0 : 1);
    for (var i = 0; i < n; i++) pool.push(pos);
  });
  while (pool.length < 22) pool.push(SG.pick(['WR', 'OL', 'DL', 'DB', 'LB', 'RB', 'QB', 'TE']));
  SG.shuffle(pool);
  pool.slice(0, 22).forEach(function (pos) {
    var r = SG.rand(), stars = r < 0.07 ? 5 : r < 0.25 ? 4 : r < 0.6 ? 3 : r < 0.88 ? 2 : 1;
    // better programs and recruiting offices draw better prospects
    stars = SG.clamp(Math.round(stars + (P - 3) * 0.6 + (D.fac.recruit - 1) * 0.25 + SG.rf(-0.3, 0.3)), 1, 5);
    var target = 42 + stars * 6 + SG.gauss() * 2.5;
    var p = L.makePlayer(pos, target, 0, SG.clamp(stars + SG.ri(-1, 1), 1, 5), used);
    p.stars = stars;
    p.home = SG.pick(SG.HOMETOWNS);
    p.interest = Math.round(SG.clamp(56 + (P - stars) * 11 + (D.fac.recruit - 1) * 6 + SG.rf(-12, 12), 5, 96));
    p.offered = false; p.visits = 0;
    p.rid = list.length;
    list.push(p);
  });
  list.sort(function (a, b) { return b.stars - a.stars || b.ovr - a.ovr; });
  return list;
};

L.VISIT_COST = 2;
L.visit = function (r) {
  var D = L.D;
  if (D.cp < L.VISIT_COST || r.visits >= 2) return false;
  D.cp -= L.VISIT_COST; r.visits++;
  r.interest = Math.min(97, r.interest + SG.ri(10, 18));
  L.save();
  return true;
};

L.signingDay = function () {
  var D = L.D, signed = [], lost = [], used = usedNums(D.roster);
  var offers = D.recruits.filter(function (r) { return r.offered; });
  offers.sort(function (a, b) { return b.stars - a.stars || b.ovr - a.ovr; });
  offers.forEach(function (r) {
    if (SG.rand() * 100 < r.interest && D.roster.length < SG.ROSTER_MAX) {
      var p = L.makePlayer(r.pos, 50, 0, r.pot, used);
      ['fn', 'ln', 'spd', 'str', 'skl', 'arm', 'ovr', 'stars'].forEach(function (k) { p[k] = r[k]; });
      p.id = newId(); p.fresh = true;
      D.roster.push(p); signed.push(p);
    } else lost.push(r);
  });
  // Walk-ons keep every position playable.
  var walk = [];
  SG.POS.forEach(function (pos) {
    var d = L.depth()[pos].length;
    while (d < SG.ROSTER_MIN[pos]) {
      var p = L.makePlayer(pos, 46 + SG.gauss() * 3, 0, SG.ri(1, 3), used);
      p.id = newId(); p.stars = 1; p.walkon = true; p.fresh = true;
      D.roster.push(p); walk.push(p); d++;
    }
  });
  D.recruits = null;
  D.offStep = 'progress';
  L.save();
  return { signed: signed, lost: lost, walk: walk };
};

L.progress = function () {
  var D = L.D, ups = [];
  D.roster.forEach(function (p) {
    var before = p.ovr;
    if (!p.fresh) {
      var gain = 1.6 + p.pot * 1.05 + (D.fac.train - 1) * 0.7 + SG.gauss() * 1.3;
      ['spd', 'str', 'skl', 'arm'].forEach(function (k) {
        var g = gain * SG.rf(0.5, 1.15);
        if (k === 'spd') g *= 0.55;
        p[k] = attr(p[k] + g);
      });
      p.yr = Math.min(3, p.yr + 1);
      p.ovr = L.ovr(p);
    }
    if (p.ovr - before > 0) ups.push({ p: p, d: p.ovr - before });
    delete p.fresh;
  });
  ups.sort(function (a, b) { return b.d - a.d; });
  D.offStep = null;
  L.newSeason(false);
  return ups.slice(0, 8);
};

L.jobOffers = function () {
  var D = L.D, me = D.team, cap = Math.max(1.5, D.teams[me].prestige - 0.5), list = [];
  SG.TEAMS.forEach(function (t) {
    if (t.i !== me && D.teams[t.i].prestige <= cap) list.push(t.i);
  });
  SG.shuffle(list);
  if (list.length < 3) {
    list = SG.TEAMS.map(function (t) { return t.i; }).filter(function (i) { return i !== me; });
    list.sort(function (a, b) { return D.teams[a].prestige - D.teams[b].prestige; });
    list = SG.shuffle(list.slice(0, 6));
  }
  return list.slice(0, 3);
};

L.takeJob = function (team) {
  var D = L.D;
  D.team = team;
  D.job = 45; D.tenure = 0;
  D.roster = L.makeRoster(D.teams[team].prestige);
  D.offStep = null;
  L.newSeason(false);
};

// =====================================================================
// Persistence
// =====================================================================
L.save = function () {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(L.D)); } catch (e) { /* storage blocked: play on */ }
};
L.load = function () {
  var d = null;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { d = null; }
  if (d && d.v === 1 && d.roster && d.sched) { L.D = d; return true; }
  return false;
};
L.hasSave = function () {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
};
L.wipe = function () {
  L.D = null;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
};
L.loadSettings = function () {
  try {
    var s = JSON.parse(localStorage.getItem(SET_KEY) || 'null');
    if (s) Object.keys(L.settings).forEach(function (k) { if (k in s) L.settings[k] = s[k]; });
  } catch (e) { /* defaults */ }
};
L.saveSettings = function () {
  try { localStorage.setItem(SET_KEY, JSON.stringify(L.settings)); } catch (e) { /* ignore */ }
};
})();
