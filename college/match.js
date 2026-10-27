/* Saturday Gridiron - match.js
   Runs one game: coin toss, our drives on the field, their drives as a
   quick sim, the clock, special teams, college overtime and the box score.
   Talks to the screen only through SG.UI hooks. ASCII only. */
(function () {
'use strict';
var SG = window.SG, L = SG.L, F = SG.F;
var M = SG.M = {};
var MIDY = 53.333 / 2;
var S = null;

M.active = function () { return !!S; };
M.state = function () { return S; };

function UI() { return SG.UI; }
var token = 0;
// setTimeout that does nothing if the game ended or a new one started meanwhile
function later(fn, ms) {
  var tok = token;
  setTimeout(function () { if (S && !S.over && tok === token) fn(); }, ms);
}
function T(i) { return SG.TEAMS[i]; }
function oppName() { return T(S.opp).city; }

// =====================================================================
// Start
// =====================================================================
M.start = function (g, onFinish) {
  var D = L.D, me = D.team;
  var meHome = g.h === me, opp = meHome ? g.a : g.h;
  var qlen = L.settings.qlen || 10;
  token++;
  S = {
    g: g, me: me, opp: opp, meHome: meHome, neutral: !!g.neutral, onFinish: onFinish,
    sc: [0, 0], q: 1, qsec: qlen * 60, clock: qlen * 60,
    poss: null, los: 25, down: 1, togo: 10, spotY: MIDY, conv: false,
    ot: 0, otOrder: null, otDone: null,
    lastCall: 'short', drive: null, myTD: 0, log: [],
    st: { pa: 0, pc: 0, py: 0, ptd: 0, int: 0, ra: 0, ry: 0, rtd: 0, sk: 0, fgm: 0, fga: 0, plays: 0, yds: 0 },
    opst: { yds: 0, plays: 0, to: 0 },
    pst: {},
    myR: L.myRatings(), oppR: L.ratings(opp),
    wind: Math.round(SG.rf(-14, 14)),
    over: false
  };
  F.difficulty = L.settings.diff;
  var st = L.starters();
  F.loadGame({ home: g.h, away: g.a, us: me, offense: st, defense: L.genDefense(opp) });
  S.kicker = st.K[0] || { arm: 60, skl: 60, fn: 'Walk', ln: 'On' };
  F.onResult = onPlay;
  F.onSnapTap = function () { snapNow(); };
  UI().gameShow(S);
  // coin toss
  var weWin = SG.rand() < 0.5;
  S.recv1 = weWin ? 'opp' : 'me';
  S.recv2 = weWin ? 'me' : 'opp';
  var line = weWin ? 'You win the toss and defer. ' + oppName() + ' receives.' : oppName() + ' wins the toss and defers. You receive.';
  UI().card({
    title: L.gameLabel(g), big: T(S.meHome ? opp : me).abbr + ' at ' + T(S.meHome ? me : opp).abbr,
    lines: [line, 'Wind ' + Math.abs(S.wind) + ' mph ' + (S.wind === 0 ? '' : S.wind > 0 ? 'blowing right' : 'blowing left')],
    button: 'Kick off',
    onDone: function () { kickoffTo(S.recv1); }
  });
};

// =====================================================================
// Possessions
// =====================================================================
function kickoffTo(side) {
  if (side === 'me') myBall(L.nextStart({ kind: 'TD' }), 'Kickoff');
  else oppBall(L.nextStart({ kind: 'TD' }), 'kickoff');
}

function myBall(x, why) {
  S.poss = 'me';
  S.los = SG.clamp(Math.round(x), 1, 99);
  S.down = 1; S.togo = Math.min(10, 100 - S.los); S.spotY = MIDY; S.conv = false;
  S.drive = { start: S.los, plays: 0 };
  if (why) UI().banner(why === 'Kickoff' ? 'YOUR BALL' : why, 'Ball on the ' + spotText(S.los), 'info', 1300);
  nextSnap();
}

function nextSnap() {
  if (S.over) return;
  UI().hud(S);
  F.setupPlay({ los: S.los, spotY: S.spotY, togo: S.togo, down: S.down, call: S.lastCall, conv: S.conv });
  S.awaitSnap = true;
  UI().playCall(playOptions(), S.lastCall, pickPlay);
}

function kickDist() { return Math.round(100 - S.los + 17); }

function playOptions() {
  var o = [
    { id: 'short', label: 'Short Pass', sub: 'Quick routes' },
    { id: 'deep', label: 'Deep Pass', sub: 'Shots downfield' },
    { id: 'inside', label: 'Run Inside', sub: 'Between the tackles' },
    { id: 'outside', label: 'Run Outside', sub: 'Toss to the edge' }
  ];
  if (S.conv) return o;
  var late = (S.q === 2 || S.q === 4) && S.clock <= 40;
  var fgOk = kickDist() <= 62;
  if (fgOk && (S.down === 4 || late || S.ot)) o.push({ id: 'fg', label: 'Field Goal', sub: kickDist() + ' yd try', special: true });
  if (S.down === 4 && !S.ot) o.push({ id: 'punt', label: 'Punt', sub: 'Flip the field', special: true });
  if (S.q === 4 && S.clock <= 130 && S.sc[0] > S.sc[1] && !S.ot) o.push({ id: 'kneel', label: 'Kneel', sub: 'Run the clock', special: true });
  return o;
}

function pickPlay(id) {
  if (!S || !S.awaitSnap) return;
  UI().sfx('blip');
  if (id === 'fg') { S.awaitSnap = false; UI().hidePlayCall(); fieldGoal(); return; }
  if (id === 'punt') { S.awaitSnap = false; UI().hidePlayCall(); punt(); return; }
  if (id === 'kneel') { S.awaitSnap = false; UI().hidePlayCall(); kneel(); return; }
  if (id === 'snap') { snapNow(); return; }
  S.lastCall = id;
  F.setupPlay({ los: S.los, spotY: S.spotY, togo: S.togo, down: S.down, call: id, conv: S.conv });
  UI().playCall(playOptions(), S.lastCall, pickPlay);
}

function snapNow() {
  if (!S || !S.awaitSnap) return;
  S.awaitSnap = false;
  UI().hidePlayCall();
  UI().hint(S.lastCall === 'inside' || S.lastCall === 'outside'
    ? 'Hold above or below the runner to steer. Tap to juke, swipe forward to dive.'
    : 'Pull back and release to throw. Push forward to scramble.');
  F.snap();
}

// =====================================================================
// Field results
// =====================================================================
function ps(pl) {
  if (!pl || !pl.id) return null;
  return S.pst[pl.id] || (S.pst[pl.id] = { pl: pl });
}
function add(o, k, n) { if (o) o[k] = (o[k] || 0) + n; }

function onPlay(r) {
  if (!S || S.over) return;
  UI().hint('');
  if (S.conv) { convResult(r); return; }
  S.drive.plays++; S.st.plays++;
  var gain = r.kind === 'td' ? 100 - S.los : Math.round(r.gain);
  var completed = r.thrown && r.side === 0 && r.carrier && r.kind !== 'inc' && r.kind !== 'sack' && !r.scramble && r.carrierRole !== 'QB';
  // box score
  if (r.thrown) {
    S.st.pa++; add(ps(r.passer), 'pa', 1);
    if (completed) {
      S.st.pc++; S.st.py += gain; add(ps(r.passer), 'pc', 1); add(ps(r.passer), 'py', gain);
      add(ps(r.carrier), 'rec', 1); add(ps(r.carrier), 'rcy', gain);
      if (r.kind === 'td') { S.st.ptd++; add(ps(r.passer), 'ptd', 1); add(ps(r.carrier), 'rctd', 1); }
    }
    if (r.side === 1) { S.st.int++; add(ps(r.passer), 'int', 1); }
  } else if (r.kind === 'sack') {
    S.st.sk++;
  } else if (r.carrier && r.side === 0) {
    S.st.ra++; S.st.ry += gain; add(ps(r.carrier), 'ra', 1); add(ps(r.carrier), 'ry', gain);
    if (r.kind === 'td') { S.st.rtd++; add(ps(r.carrier), 'rtd', 1); }
  }
  if (r.side === 0 && r.kind !== 'inc') S.st.yds += gain;

  var secs = SG.clamp(Math.round(r.t * 1.4 + 2), 3, 15);
  var stops = r.kind === 'inc' || r.kind === 'oob' || r.kind === 'td' || r.side === 1 || r.kind === 'touchback';
  S.clock = Math.max(0, S.clock - secs);

  // ----- turnovers and scores
  if (r.kind === 'pick6') {
    UI().banner('PICK SIX', oppName() + ' takes it the other way', 'bad', 1800); UI().sfx('boo');
    score('opp', 7, 'Interception return TD');
    return afterScoreBy('opp');
  }
  if (r.side === 1) {
    var start = r.kind === 'touchback' ? 20 : SG.clamp(100 - Math.round(r.x), 1, 99);
    UI().banner('INTERCEPTED', r.defender ? 'Picked off by #' + r.defender.num : '', 'bad', 1800); UI().sfx('boo');
    S.opst.to++;
    return endDrive(function () { oppBall(start, 'int'); });
  }
  if (r.kind === 'td') {
    UI().banner('TOUCHDOWN!', r.carrier ? r.carrier.fn[0] + '. ' + r.carrier.ln + (completed ? ' catches it' : ' scores') : '', 'good', 2000);
    UI().sfx('cheer');
    S.myTD++;
    score('me', 6, (completed ? 'TD pass to ' : 'TD run by ') + (r.carrier ? r.carrier.ln : ''));
    return extraPoint();
  }
  var newLos = r.kind === 'inc' ? S.los : Math.round(r.x * 2) / 2;
  if (r.kind !== 'inc' && newLos <= 0) {
    UI().banner('SAFETY', 'Tackled in the end zone', 'bad', 1800); UI().sfx('boo');
    score('opp', 2, 'Safety');
    return endDrive(function () { oppBall(SG.ri(30, 45), 'free kick'); });
  }
  if (r.fumble) {
    if (!r.recovered) {
      UI().banner('FUMBLE', oppName() + ' recovers', 'bad', 1800); UI().sfx('boo');
      return endDrive(function () { oppBall(SG.clamp(100 - Math.round(newLos), 1, 99), 'fumble'); });
    }
    UI().toast('Fumble! You fell on it.');
  }
  // ----- downs
  var line = '';
  if (r.kind === 'inc') { line = r.why || 'Incomplete'; UI().sfx('whistle'); }
  else if (r.kind === 'sack') { line = 'Sacked for ' + Math.abs(gain) + (Math.abs(gain) === 1 ? ' yard' : ' yards'); UI().sfx('hit'); }
  else line = gain > 0 ? 'Gain of ' + gain : gain === 0 ? 'No gain' : 'Loss of ' + Math.abs(gain);
  var first = newLos >= S.los + S.togo;
  S.los = Math.min(99, Math.max(1, Math.round(newLos)));
  if (r.kind !== 'inc') S.spotY = SG.clamp(r.y, 20, 53.333 - 20);
  if (first) {
    S.down = 1; S.togo = Math.min(10, 100 - S.los);
    UI().banner('FIRST DOWN', line, 'good', 1100); UI().sfx('first');
  } else {
    S.down++;
    S.togo = Math.max(1, Math.round(S.togo - (r.kind === 'inc' ? 0 : gain)));
    if (S.los + S.togo > 100) S.togo = 100 - S.los;
    if (S.down > 4) {
      UI().banner('TURNOVER ON DOWNS', line, 'bad', 1600); UI().sfx('boo');
      var at = S.los;
      return endDrive(function () { oppBall(SG.clamp(100 - at, 1, 99), 'downs'); });
    }
    UI().toast(line);
  }
  // ----- clock
  if (!stops && S.clock > 0 && !S.ot) {
    var hurry = (S.q === 2 || S.q === 4) && S.clock <= 120;
    S.clock = Math.max(0, S.clock - (hurry ? 12 : 28));
  }
  if (!S.ot && S.clock <= 0) { quarterEnds(); return; }
  nextSnap();
}

function score(side, pts, what) {
  if (side === 'me') S.sc[0] += pts; else S.sc[1] += pts;
  S.log.push({ q: S.ot ? 'OT' : 'Q' + S.q, side: side, pts: pts, what: what, sc: S.sc.slice() });
  UI().hud(S);
}

// Our possession is over. In Q1/Q3 an expired clock just flips the quarter.
function betweenPossessions(next, ms) {
  if (S.clock <= 0) {
    if (S.q === 1 || S.q === 3) {
      S.q++; S.clock = S.qsec;
      UI().hud(S);
      UI().banner('END OF Q' + (S.q - 1), '', 'info', 1200);
      later(next, ms + 600);
      return;
    }
    quarterEnds();
    return;
  }
  later(next, ms);
}

function endDrive(next) {
  S.drive = null;
  F.clear();
  if (S.ot) { otPossessionDone('me'); return; }
  betweenPossessions(next, 900);
}

// After a score by either side: kickoff unless the clock says otherwise.
function afterScoreBy(side) {
  F.clear();
  if (S.ot) { otPossessionDone(side === 'me' ? 'me' : 'opp-pick6'); return; }
  betweenPossessions(function () { kickoffTo(side === 'me' ? 'opp' : 'me'); }, 1000);
}

// =====================================================================
// Kicking game
// =====================================================================
function extraPoint() {
  var mustGo = S.ot >= 2;
  later(function () {
    if (mustGo) { twoPoint(); return; }
    UI().choice('Extra point', 'Kick for one or go for two from the 3.', [
      { id: 'kick', label: 'Kick PAT', sub: '20 yards' },
      { id: 'two', label: 'Go for 2', sub: 'One play' }
    ], function (id) { if (id === 'two') twoPoint(); else patKick(); });
  }, 1400);
}

function patKick() {
  UI().kickHud({ dist: 20, wind: S.wind, kind: 'PAT' });
  F.startKick({ dist: 20, leg: S.kicker.arm, acc: S.kicker.skl, wind: S.wind, kind: 'pat' }, function (res) {
    UI().kickHud(null);
    if (res.good) { score('me', 1, 'PAT'); }
    afterScoreBy('me');
  });
}

function twoPoint() {
  S.conv = true; S.los = 97; S.down = 1; S.togo = 3; S.spotY = MIDY;
  UI().banner('TWO-POINT TRY', 'Get it in from the 3', 'info', 1300);
  nextSnap();
}

function convResult(r) {
  S.conv = false;
  if (r.kind === 'td') { score('me', 2, 'Two-point conversion'); UI().banner('IT\'S GOOD', 'Two points', 'good', 1500); UI().sfx('cheer'); }
  else { UI().banner('NO GOOD', 'Conversion fails', 'bad', 1500); UI().sfx('boo'); }
  if (S.ot >= 3) { F.clear(); otPossessionDone('me'); return; }
  afterScoreBy('me');
}

function fieldGoal() {
  var dist = kickDist();
  S.st.fga++;
  UI().kickHud({ dist: dist, wind: S.wind, kind: 'FG' });
  F.startKick({ dist: dist, leg: S.kicker.arm, acc: S.kicker.skl, wind: S.wind, kind: 'fg' }, function (res) {
    UI().kickHud(null);
    S.clock = Math.max(0, S.clock - 5);
    if (res.good) {
      S.st.fgm++;
      score('me', 3, dist + ' yd field goal');
      afterScoreBy('me');
    } else {
      var start = Math.max(20, 100 - (S.los - 7));
      endDrive(function () { oppBall(start, 'missed FG'); });
    }
  });
}

function punt() {
  var gross = Math.round(37 + (S.kicker.arm - 50) * 0.18 + SG.rf(-6, 7));
  var land = S.los + gross, start, txt;
  if (land >= 100) { start = 20; txt = 'Touchback'; }
  else { var ret = SG.ri(0, 11); start = SG.clamp(100 - land + ret, 2, 99); txt = ret ? 'Returned ' + ret + ' yards' : 'Fair catch'; }
  S.clock = Math.max(0, S.clock - 8);
  UI().banner('PUNT', gross + ' yards. ' + txt, 'info', 1600);
  UI().sfx('kick');
  endDrive(function () { oppBall(start, 'punt'); });
}

function kneel() {
  UI().banner('VICTORY FORMATION', 'Take a knee', 'info', 1200);
  S.los = Math.max(1, S.los - 1); S.down++; S.togo++;
  S.clock = Math.max(0, S.clock - 42);
  if (S.down > 4) { var at = S.los; endDrive(function () { oppBall(100 - at, 'downs'); }); return; }
  if (S.clock <= 0) { quarterEnds(); return; }
  later(nextSnap, 900);
}

// =====================================================================
// Their drive (simulated)
// =====================================================================
function myDefenders(pos) {
  var d = L.depth()[pos] || [];
  return d.length ? d[SG.ri(0, Math.min(d.length, SG.STARTERS[pos]) - 1)] : null;
}
function nm(p) { return p ? p.fn[0] + '. ' + p.ln : 'Your defense'; }

function oppBall(startX, why) {
  if (S.over) return;
  S.poss = 'opp';
  F.clear();
  UI().hidePlayCall();
  var defBonus = [6, 0, -5][L.settings.diff] + (S.meHome && !S.neutral ? 1.5 : 0) - (!S.meHome && !S.neutral ? 1.5 : 0);
  var dr = L.simDrive(S.oppR.off, S.myR.def + defBonus, startX);
  var lines = [];
  var who = oppName();
  lines.push(who + ' ball at ' + (startX < 50 ? 'their own ' + startX : startX === 50 ? 'midfield' : 'your ' + (100 - startX)));
  var halfEnd = false;
  if (!S.ot) {
    if (S.q === 2 || S.q === 4) {
      if (dr.secs >= S.clock) {
        if (dr.pts > 0 && SG.rand() > Math.min(1, S.clock / dr.secs * 1.5)) { dr.kind = 'CLOCK'; dr.pts = 0; }
        dr.secs = S.clock; S.clock = 0; halfEnd = true;
      } else S.clock -= dr.secs;
    } else {
      S.clock -= dr.secs;
      if (S.clock <= 0) { S.q++; S.clock += S.qsec; }
    }
  }
  S.opst.yds += dr.yards; S.opst.plays += dr.plays;
  lines.push(dr.plays + ' plays, ' + dr.yards + ' yards' + (S.ot ? '' : ', ' + clockText(dr.secs)));
  var res, kind = 'info';
  switch (dr.kind) {
    case 'TD':
      if (S.ot >= 2) { dr.pts = 6 + (SG.rand() < 0.45 ? 2 : 0); }
      res = 'Touchdown, ' + who + '.' + (dr.pts === 6 ? ' Extra point no good.' : dr.pts === 8 ? ' Two-point try good.' : '');
      kind = 'bad'; break;
    case 'FG': res = who + ' kicks a ' + Math.round(100 - dr.endX + 17) + '-yard field goal.'; kind = 'bad'; break;
    case 'MISS': res = who + ' misses from ' + Math.round(100 - dr.endX + 17) + ' yards.'; kind = 'good'; break;
    case 'PUNT': res = 'Your defense forces a punt.'; kind = 'good'; break;
    case 'INT': res = 'INTERCEPTION! ' + nm(myDefenders('DB')) + ' picks it off.'; kind = 'good'; S.opst.to++; break;
    case 'FUM': res = 'FUMBLE! ' + nm(myDefenders(SG.rand() < 0.5 ? 'LB' : 'DL')) + ' forces it and you recover.'; kind = 'good'; S.opst.to++; break;
    case 'DOWNS': res = 'Stuffed on fourth down by ' + nm(myDefenders('DL')) + '!'; kind = 'good'; break;
    default: res = 'Time runs out on the drive.';
  }
  lines.push(res);
  if (dr.pts) score('opp', dr.pts, dr.kind === 'TD' ? 'TD drive' : 'Field goal');
  UI().sfx(kind === 'bad' ? 'boo' : 'cheer');
  UI().hud(S);
  if (S.ot) {
    S.otOpp = dr.pts;
    UI().card({ title: 'Overtime: ' + who + ' ball', lines: lines, kind: kind, button: 'Continue', onDone: function () { otPossessionDone('opp'); } });
    return;
  }
  UI().card({
    title: 'Defense', lines: lines, kind: kind, button: halfEnd ? 'Continue' : 'Take the field',
    onDone: function () {
      if (halfEnd || S.clock <= 0) { quarterEnds(); return; }
      var start = L.nextStart(dr);
      myBall(start, dr.kind === 'TD' || dr.kind === 'FG' ? 'Kickoff' : 'YOUR BALL');
    }
  });
}

// =====================================================================
// Clock
// =====================================================================
// Clock hit zero. Mid-drive in Q1/Q3 we keep the ball; Q2 is halftime; Q4 ends it.
function quarterEnds() {
  if (S.over) return;
  UI().hidePlayCall();
  if (S.q === 1 || S.q === 3) {
    S.q++; S.clock = S.qsec;
    UI().hud(S);
    UI().banner('END OF Q' + (S.q - 1), '', 'info', 1300);
    later(nextSnap, 1100);
    return;
  }
  F.clear();
  if (S.q === 2) {
    S.q = 3; S.clock = S.qsec;
    UI().card({
      title: 'Halftime', big: T(S.me).abbr + ' ' + S.sc[0] + ' - ' + S.sc[1] + ' ' + T(S.opp).abbr,
      lines: halfLines(), button: 'Start 2nd half',
      onDone: function () { kickoffTo(S.recv2); }
    });
    return;
  }
  // end of regulation
  if (S.sc[0] !== S.sc[1]) { finish(); return; }
  UI().card({ title: 'End of regulation', big: 'TIED ' + S.sc[0] + ' - ' + S.sc[1], lines: ['College overtime: each team gets the ball at the 25.', 'From the 2nd OT you must go for two. From the 3rd OT it is a two-point shootout.'], button: 'Overtime', onDone: startOT });
}

function halfLines() {
  var s = S.st;
  return [
    'Passing: ' + s.pc + '/' + s.pa + ', ' + s.py + ' yds, ' + s.ptd + ' TD' + (s.int ? ', ' + s.int + ' INT' : ''),
    'Rushing: ' + s.ra + ' for ' + s.ry + ' yds',
    'Second half: ' + (S.recv2 === 'me' ? 'you receive' : oppName() + ' receives')
  ];
}

// =====================================================================
// Overtime
// =====================================================================
function startOT() {
  S.ot = 1;
  S.otFirst = SG.rand() < 0.5 ? 'me' : 'opp';
  otRound();
}
function otRound() {
  S.otDone = { me: false, opp: false };
  S.otMe = 0; S.otOpp = 0;
  S.otStart = S.sc.slice();
  UI().hud(S);
  var first = S.ot % 2 === 1 ? S.otFirst : (S.otFirst === 'me' ? 'opp' : 'me');
  S.otOrderNow = first;
  UI().banner('OVERTIME ' + S.ot, first === 'me' ? 'You have the ball first' : oppName() + ' has the ball first', 'info', 1500);
  later(function () { otGo(first); }, 1200);
}
function otGo(side) {
  if (side === 'me') {
    if (S.ot >= 3) { S.conv = true; S.los = 97; S.down = 1; S.togo = 3; S.spotY = MIDY; S.drive = { start: 97, plays: 0 }; nextSnap(); }
    else myBall(75, 'OT ' + S.ot);
  } else {
    if (S.ot >= 3) {
      var ok = SG.rand() < 0.45 + (S.oppR.off - S.myR.def) * 0.006;
      if (ok) score('opp', 2, 'OT conversion');
      UI().card({ title: 'Overtime ' + S.ot, lines: [oppName() + ' goes for two...', ok ? 'They convert.' : 'Stopped! Your defense holds.'], kind: ok ? 'bad' : 'good', button: 'Continue', onDone: function () { otPossessionDone('opp'); } });
      return;
    }
    oppBall(75, 'ot');
  }
}
function otPossessionDone(side) {
  if (S.over) return;
  if (side === 'opp-pick6') { finish(); return; }
  S.otDone[side] = true;
  UI().hud(S);
  if (S.otDone.me && S.otDone.opp) {
    if (S.sc[0] !== S.sc[1]) { later(finish, 900); return; }
    S.ot++;
    later(otRound, 900);
    return;
  }
  later(function () { otGo(side === 'me' ? 'opp' : 'me'); }, 900);
}

// =====================================================================
// Finish
// =====================================================================
M.simRest = function () {
  if (!S || S.over) return;
  UI().hidePlayCall();
  F.clear();
  var left = S.ot ? 0 : (4 - S.q) * S.qsec + S.clock;
  var n = Math.round(left / 300);
  var me = S.poss === 'me';
  for (var i = 0; i < n; i++) {
    var dr = me ? L.simDrive(S.myR.off, S.oppR.def, SG.ri(15, 40)) : L.simDrive(S.oppR.off, S.myR.def, SG.ri(15, 40));
    if (dr.pts) score(me ? 'me' : 'opp', dr.pts, 'Simulated drive');
    me = !me;
  }
  var guard = 0;
  while (S.sc[0] === S.sc[1] && guard++ < 8) {
    var a = L.simDrive(S.myR.off, S.oppR.def, 75).pts, b = L.simDrive(S.oppR.off, S.myR.def, 75).pts;
    if (a) score('me', a, 'OT'); if (b) score('opp', b, 'OT');
    S.ot = Math.max(1, S.ot + 1);
  }
  if (S.sc[0] === S.sc[1]) score('me', 2, 'OT');
  S.q = 4; S.clock = 0;
  finish();
};

function finish() {
  if (S.over) return;
  S.over = true;
  F.clear();
  UI().hidePlayCall();
  var g = S.g, D = L.D;
  var hs = S.meHome ? S.sc[0] : S.sc[1], as = S.meHome ? S.sc[1] : S.sc[0];
  L.record(g, hs, as, S.ot ? Math.max(1, S.ot) : 0);
  // season stats
  Object.keys(S.pst).forEach(function (id) {
    var o = S.pst[id];
    ['pa', 'pc', 'py', 'ptd', 'int', 'ra', 'ry', 'rtd', 'rec', 'rcy', 'rctd'].forEach(function (k) {
      if (o[k]) L.stat(o.pl.id, k, o[k]);
    });
  });
  var cp = L.awardGame(g, S.myTD);
  L.save();
  var won = S.sc[0] > S.sc[1];
  var sum = { g: g, won: won, sc: S.sc.slice(), me: S.me, opp: S.opp, st: S.st, opst: S.opst, pst: S.pst, log: S.log, cp: cp, ot: S.ot };
  var done = S.onFinish;
  S = null; token++;
  F.onResult = null; F.onSnapTap = null;
  UI().sfx(won ? 'cheer' : 'boo');
  if (done) done(sum);
}

// =====================================================================
// Text helpers
// =====================================================================
function spotText(x) {
  x = Math.round(x);
  if (x === 50) return '50';
  return x < 50 ? 'own ' + x : 'opp ' + (100 - x);
}
function clockText(s) {
  s = Math.max(0, Math.round(s));
  var m = Math.floor(s / 60), r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
M.spotText = spotText;
M.clockText = clockText;
M.downText = function () {
  if (!S) return '';
  if (S.conv) return '2-PT TRY';
  var d = ['1st', '2nd', '3rd', '4th'][Math.min(3, S.down - 1)];
  var goal = S.los + S.togo >= 100;
  return d + ' & ' + (goal ? 'Goal' : S.togo);
};
})();
