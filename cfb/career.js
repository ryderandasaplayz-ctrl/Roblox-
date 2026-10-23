// Gridiron Glory - menus, Road to Glory (HS -> College -> Pro), College Dynasty with recruiting.
(function (GG) {
  'use strict';
  var rand = GG.rand, ri = GG.ri, pick = GG.pick, clamp = GG.clamp, C = GG.COLLEGES, P = GG.PROS;
  var SAVE_KEY = 'gridiron-glory-v1';
  var SV = load();
  var ui;

  function load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(SV)); } catch (e) { } }
  GG.muted = !!SV.muted;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function show(html, acts) {
    ui.hidden = false; ui.innerHTML = '<div class="pane">' + html + '</div>'; ui.scrollTop = 0;
    Array.prototype.forEach.call(ui.querySelectorAll('[data-a]'), function (b) {
      b.addEventListener('click', function () {
        GG.sfx.click();
        var a = b.getAttribute('data-a'), arg = b.getAttribute('data-v');
        if (acts && acts[a]) acts[a](arg, b);
      });
    });
  }
  function hide() { ui.hidden = true; ui.innerHTML = ''; }
  function teamChip(t) { return '<span class="chip" style="background:' + t.c1 + ';color:' + t.c2 + '">' + t.ab + '</span>'; }
  function collegeRatings(t) { var b = 58 + t.prestige * 6; return { off: clamp(Math.round(b + rand(-3, 3)), 50, 95), def: clamp(Math.round(b + rand(-3, 3)), 50, 95) }; }
  function teamObj(t, off, def) { return { name: t.name, ab: t.ab, c1: t.c1, c2: t.c2, off: off, def: def }; }

  // =============================================================== TITLE
  function title() {
    var r = SV.rtg, d = SV.dyn;
    show(
      '<div class="logo"><div class="ball">&#127944;</div><h1>GRIDIRON<br>GLORY</h1><div class="sub">College Football Retro</div></div>' +
      '<div class="menu">' +
      (r && r.stage !== 'retired' ? '<button data-a="rtgc">Continue Road to Glory<small>' + esc(r.name) + ' &middot; ' + stageLabel(r) + '</small></button>' : '') +
      '<button data-a="rtgn">New Road to Glory<small>Create a player: High School &rarr; College &rarr; Pros</small></button>' +
      (d ? '<button data-a="dync">Continue Dynasty<small>' + C[d.teamId].name + ' &middot; Year ' + d.season + '</small></button>' : '') +
      '<button data-a="dynn">New College Dynasty<small>Coach a program, recruit, win titles</small></button>' +
      '<button data-a="quick" class="alt">Quick Game</button>' +
      '<button data-a="how" class="alt">How to Play</button>' +
      '<button data-a="snd" class="alt">Sound: ' + (GG.muted ? 'Off' : 'On') + '</button>' +
      '</div>' +
      (r && r.stage === 'retired' ? '<p class="dim">Last career: ' + esc(r.name) + ' &mdash; ' + (r.hof ? 'Hall of Famer' : 'Retired') + '</p>' : ''),
      {
        rtgc: rtgHub, rtgn: function () { if (r && r.stage !== 'retired') confirmBox('Start a new player? Your current Road to Glory will be replaced.', createPlayer, title); else createPlayer(); },
        dync: dynHub, dynn: function () { if (d) confirmBox('Start a new dynasty? Your current one will be replaced.', newDynasty, title); else newDynasty(); },
        quick: quickGame, how: howTo,
        snd: function () { GG.muted = !GG.muted; SV.muted = GG.muted; save(); title(); }
      });
  }
  function confirmBox(msg, yes, no) {
    show('<h2>Are you sure?</h2><p>' + msg + '</p><div class="row"><button data-a="y">Yes</button><button data-a="n" class="alt">Cancel</button></div>', { y: yes, n: no });
  }
  function howTo() {
    show('<h2>How to Play</h2><div class="card left">' +
      '<p><b>Offense is yours.</b> Pick PASS, RUN or PLAY ACTION, then hit SNAP (or tap the field).</p>' +
      '<p><b>Passing:</b> press and drag on the field to aim. Let go to throw to that spot. Lead your receiver! The bubbles over receivers show who is open (green = open, yellow = tight, red = covered). On a keyboard, keys 1&ndash;5 throw to a receiver with the lead done for you.</p>' +
      '<p><b>Running:</b> hold or drag where you want the runner to go. A quick tap does a <b>juke</b> that dodges tacklers. On a keyboard, use the arrows/WASD and Space to juke. Press S or SCRAMBLE to run with the QB.</p>' +
      '<p><b>Kicking:</b> stop the needle in the green zone.</p>' +
      '<p><b>Defense</b> is simulated by your team ratings, like Retro Bowl. Each game is a set number of drives for each team.</p>' +
      '<p><b>Road to Glory:</b> create a QB, RB or WR. Play your senior year of high school, earn scholarship offers, commit, win the starting job, chase the Heisman, get drafted and build a Hall of Fame pro career. Earn XP every game to upgrade your attributes.</p>' +
      '<p><b>Dynasty:</b> coach a college. Spend recruiting points on prospects each week, offer scholarships and set up visits. Upgrade facilities and staff with coaching credits, and make the 12-team playoff.</p>' +
      '</div><button data-a="b">Back</button>', { b: title });
  }
  function stageLabel(r) {
    if (r.stage === 'hs') return 'HS Senior';
    if (r.stage === 'recruit') return 'Recruiting';
    if (r.stage === 'college') return ['Freshman', 'Sophomore', 'Junior', 'Senior'][r.col.year - 1] + ' @ ' + C[r.col.teamId].ab;
    if (r.stage === 'draft') return 'NFL Draft';
    if (r.stage === 'pro') return 'Pro Year ' + r.pro.season + ' @ ' + P[r.pro.teamId].ab;
    return 'Retired';
  }

  // =============================================================== QUICK GAME
  function quickGame() {
    var opts = C.map(function (t) { return '<option value="' + t.id + '">' + t.name + ' (' + t.prestige + '&#9733;)</option>'; }).join('');
    show('<h2>Quick Game</h2><div class="card">' +
      '<label>Your team<select id="q-u">' + opts + '</select></label>' +
      '<label>Opponent<select id="q-o">' + opts + '</select></label>' +
      '<label>Drives per team<select id="q-d"><option>4</option><option selected>6</option><option>8</option></select></label>' +
      '</div><div class="row"><button data-a="go">Kick Off</button><button data-a="b" class="alt">Back</button></div>', {
      b: title,
      go: function () {
        var u = C[+document.getElementById('q-u').value], o = C[+document.getElementById('q-o').value];
        var ur = collegeRatings(u), or = collegeRatings(o), drives = +document.getElementById('q-d').value;
        hide();
        GG.Match.start({ user: teamObj(u, ur.off, ur.def), opp: teamObj(o, or.off, or.def), drives: drives }, function (res) {
          show('<h2>' + (res.won ? 'Victory!' : 'Defeat') + '</h2><div class="big">' + u.ab + ' ' + res.us + ' - ' + res.them + ' ' + o.ab + '</div>' + boxScore(res.stats) + '<button data-a="m">Main Menu</button>', { m: title });
        });
      }
    });
    document.getElementById('q-o').value = 1;
  }
  function boxScore(s) {
    return '<div class="card stats"><div><b>' + s.comp + '/' + s.att + '</b><span>Comp/Att</span></div><div><b>' + s.passYds + '</b><span>Pass Yds</span></div><div><b>' + s.rushYds + '</b><span>Rush Yds</span></div><div><b>' + (s.passTD + s.rushTD) + '</b><span>TDs</span></div><div><b>' + s.int + '</b><span>INT</span></div><div><b>' + (s.sacks || 0) + '</b><span>Sacked</span></div></div>';
  }

  // =============================================================== ROAD TO GLORY
  function createPlayer() {
    var pos = 'QB';
    function arches() { return Object.keys(GG.ARCH[pos]).map(function (a) { return '<option>' + a + '</option>'; }).join(''); }
    var stOpts = GG.STATES.map(function (s) { return '<option' + (s === 'TX' ? ' selected' : '') + '>' + s + '</option>'; }).join('');
    show('<h2>Create Your Player</h2><div class="card">' +
      '<label>Name<input id="c-n" maxlength="20" value="' + GG.name() + '"></label>' +
      '<label>Position<div class="seg" id="c-p"><button data-a="pos" data-v="QB" class="on">QB</button><button data-a="pos" data-v="RB">RB</button><button data-a="pos" data-v="WR">WR</button></div></label>' +
      '<label>Archetype<select id="c-a">' + arches() + '</select></label>' +
      '<label>Jersey #<input id="c-j" type="number" min="0" max="99" value="' + ri(1, 19) + '"></label>' +
      '<label>Home State<select id="c-s">' + stOpts + '</select></label>' +
      '</div><p class="dim">You start as a high school senior. Play well to earn offers from big programs.</p>' +
      '<div class="row"><button data-a="go">Start Career</button><button data-a="b" class="alt">Back</button></div>', {
      b: title,
      pos: function (v, btn) {
        pos = v; Array.prototype.forEach.call(document.querySelectorAll('#c-p button'), function (x) { x.classList.toggle('on', x === btn); });
        document.getElementById('c-a').innerHTML = arches();
      },
      go: function () {
        var name = document.getElementById('c-n').value.trim() || 'Player One';
        var arch = document.getElementById('c-a').value, mods = GG.ARCH[pos][arch], at = {};
        GG.ATTRS[pos].forEach(function (a) { at[a[0]] = clamp(64 + ri(-3, 3) + (mods[a[0]] || 0), 45, 85); });
        SV.rtg = {
          name: name, pos: pos, arch: arch, num: clamp(+document.getElementById('c-j').value || 7, 0, 99), home: document.getElementById('c-s').value,
          at: at, xp: 150, age: 17, stage: 'hs', awards: [], seasons: [], money: 0,
          hs: { team: pick(GG.HS) + ' ' + pick(GG.MASCOTS), week: 0, games: [], opps: [0, 1, 2, 3, 4].map(function () { return pick(GG.HS) + ' ' + pick(GG.MASCOTS); }), perf: 0 }
        };
        save(); rtgHub();
      }
    });
  }

  function me() { var r = SV.rtg; return { pos: r.pos, at: r.at, name: r.name, num: r.num }; }
  function myOvr() { return GG.ovr(SV.rtg); }

  function rtgHub() {
    var r = SV.rtg;
    if (!r) return title();
    if (r.stage === 'hs') return hsHub();
    if (r.stage === 'recruit') return recruitOffers();
    if (r.stage === 'college') return colHub();
    if (r.stage === 'draft') return draftDay();
    if (r.stage === 'pro') return proHub();
    return retiredScreen();
  }

  function playerCard() {
    var r = SV.rtg, o = myOvr();
    return '<div class="pcard"><div class="num">#' + r.num + '</div><div><div class="pn">' + esc(r.name) + '</div><div class="dim">' + r.pos + ' &middot; ' + r.arch + ' &middot; Age ' + r.age + '</div><div class="stars">' + GG.starStr(GG.starsFor(o)) + '</div></div><div class="ovr"><b>' + o + '</b><span>OVR</span></div></div>';
  }
  function attrPanel(back) {
    var r = SV.rtg;
    var rows = GG.ATTRS[r.pos].map(function (a) {
      var v = r.at[a[0]], cost = upCost(v);
      return '<div class="attr"><span>' + a[1] + '</span><div class="bar"><i style="width:' + v + '%"></i></div><b>' + v + '</b><button class="mini" data-a="up" data-v="' + a[0] + '"' + (r.xp < cost || v >= 99 ? ' disabled' : '') + '>+1 <small>' + cost + 'xp</small></button></div>';
    }).join('');
    return '<div class="card"><div class="row sp"><b>Attributes</b><span class="xp">' + r.xp + ' XP</span></div>' + rows + '</div>';
  }
  function upCost(v) { return Math.round(12 + Math.max(0, v - 60) * 3.2); }
  function upAct(redraw) {
    return function (k) { var r = SV.rtg, c = upCost(r.at[k]); if (r.xp >= c && r.at[k] < 99) { r.xp -= c; r.at[k]++; save(); redraw(); } };
  }
  function gameXP(my, won, pos) {
    var x = 30 + (won ? 30 : 0);
    if (pos === 'QB') x += my.passYds / 4 + my.passTD * 25 - my.int * 15 + my.rushYds / 3 + my.rushTD * 20;
    if (pos === 'RB') x += my.rushYds / 1.6 + my.rushTD * 25 + my.rec * 6 + my.recYds / 3;
    if (pos === 'WR') x += my.recYds / 1.6 + my.rec * 6 + my.recTD * 25;
    return Math.max(15, Math.round(x));
  }
  function statLine(my, pos) {
    if (pos === 'QB') return my.comp + '/' + my.att + ', ' + my.passYds + ' yds, ' + my.passTD + ' TD, ' + my.int + ' INT';
    if (pos === 'RB') return my.car + ' car, ' + my.rushYds + ' yds, ' + my.rushTD + ' TD' + (my.rec ? ' | ' + my.rec + ' rec ' + my.recYds + ' yds' : '');
    return my.rec + ' rec, ' + my.recYds + ' yds, ' + my.recTD + ' TD';
  }
  function addStats(acc, my) { for (var k in my) acc[k] = (acc[k] || 0) + my[k]; return acc; }

  function playMyGame(opts, done) {
    // opts: user team obj, opp team obj, starter bool, label
    var r = SV.rtg;
    var start = function (interactive) {
      var drives = opts.starter ? 6 : 3, startScore = [0, 0];
      if (!opts.starter) {
        var h = GG.simGame(opts.user.off, opts.user.def, opts.opp.off, opts.opp.def, null, 3);
        startScore = [h.us, h.them];
      }
      if (interactive) {
        hide();
        GG.Match.start({ user: opts.user, opp: opts.opp, drives: drives, me: me(), startScore: startScore }, finish);
      } else {
        var res = GG.simGame(opts.user.off, opts.user.def, opts.opp.off, opts.opp.def, me(), drives);
        res.us += startScore[0]; res.them += startScore[1]; res.won = res.us > res.them;
        if (res.us === res.them) { res.us += 3; res.won = true; }
        finish(res);
      }
    };
    function finish(res) {
      var xp = gameXP(res.my, res.won, r.pos);
      if (!opts.starter) xp = Math.round(xp * 0.8);
      r.xp += xp; save();
      done(res, xp);
    }
    show('<h2>' + opts.label + '</h2><div class="vs">' + teamChip(opts.user) + '<span>' + opts.user.off + '/' + opts.user.def + '</span><b>VS</b><span>' + opts.opp.off + '/' + opts.opp.def + '</span>' + teamChip(opts.opp) + '</div>' +
      '<p>' + (opts.starter ? 'You are the <b>starter</b>.' : 'You are a <b>backup</b>. You come in for the second half (3 drives).') + '</p>' +
      '<div class="row"><button data-a="p">Play</button><button data-a="s" class="alt">Sim</button><button data-a="b" class="alt">Back</button></div>',
      { p: function () { start(true); }, s: function () { start(false); }, b: rtgHub });
  }
  function postGame(res, xp, title2, next) {
    var r = SV.rtg;
    show('<h2>' + (res.won ? 'WIN' : 'LOSS') + ' ' + res.us + '-' + res.them + '</h2><p class="dim">' + title2 + '</p>' +
      '<div class="card"><b>Your game</b><div class="line">' + statLine(res.my, r.pos) + '</div><div class="xp">+' + xp + ' XP</div></div>' +
      '<button data-a="n">Continue</button>', { n: next });
  }

  // ---------------- High school
  function hsHub() {
    var r = SV.rtg, h = r.hs;
    var hsTeam = { name: h.team, ab: 'HS', c1: '#2b4c9b', c2: '#ffffff', off: 64, def: 62 };
    var games = h.opps.map(function (o, i) {
      var g = h.games[i];
      return '<li class="' + (i === h.week ? 'cur' : '') + '"><span>Wk ' + (i + 1) + ' vs ' + o + '</span><b>' + (g ? (g.won ? 'W ' : 'L ') + g.us + '-' + g.them : i === h.week ? 'NEXT' : '') + '</b></li>';
    }).join('');
    show(playerCard() + '<h2>Senior Year</h2><p class="dim">' + esc(h.team) + ' &middot; Scouts are watching! Big games earn better offers.</p>' +
      '<ul class="sched">' + games + '</ul>' + attrPanel() +
      '<div class="row"><button data-a="play">Play Week ' + (h.week + 1) + '</button><button data-a="m" class="alt">Menu</button></div>', {
      m: title, up: upAct(hsHub),
      play: function () {
        var opp = { name: h.opps[h.week], ab: h.opps[h.week].slice(0, 3).toUpperCase(), c1: pick(['#7a1f1f', '#1f6a3a', '#6a1f6a', '#333', '#b35a00']), c2: '#ffffff', off: ri(52, 66), def: ri(52, 66) };
        playMyGame({ user: hsTeam, opp: opp, starter: true, label: 'HS Week ' + (h.week + 1) }, function (res, xp) {
          h.games.push({ won: res.won, us: res.us, them: res.them }); h.perf += xp; h.week++;
          save();
          postGame(res, xp, 'Scouts took notes.', function () {
            if (h.week >= h.opps.length) { r.stage = 'recruit'; makeOffers(); save(); }
            rtgHub();
          });
        });
      }
    });
  }
  function makeOffers() {
    var r = SV.rtg, h = r.hs;
    var score = myOvr() + (h.perf / h.opps.length - 110) / 12 + h.games.filter(function (g) { return g.won; }).length;
    var stars = clamp(Math.round((score - 56) / 5), 1, 5);
    r.recStars = stars;
    var pool = C.filter(function (t) { return t.prestige <= stars + 1 && t.prestige >= stars - 2; });
    var homeTeams = C.filter(function (t) { return t.state === r.home && t.prestige <= stars + 1; });
    var offers = GG.shuffle(pool.slice()).slice(0, ri(4, 6));
    homeTeams.forEach(function (t) { if (offers.indexOf(t) < 0 && offers.length < 7) offers.push(t); });
    r.offers = offers.map(function (t) { return t.id; });
  }
  function recruitOffers() {
    var r = SV.rtg;
    var list = r.offers.map(function (id) {
      var t = C[id], th = starterThreshold(t), ok = myOvr() >= th;
      return '<button class="offer" data-a="c" data-v="' + id + '">' + teamChip(t) + '<span class="on">' + t.name + '<small>' + t.conf + ' &middot; ' + GG.starStr(t.prestige) + '</small></span><span class="dc">' + (ok ? 'Projected STARTER' : 'Depth: backup (need ' + th + ' OVR)') + '</span></button>';
    }).join('');
    show(playerCard() + '<h2>Signing Day</h2><p>You are a <b class="gold">' + GG.starStr(r.recStars) + '</b> recruit. Pick your school. Big programs win more, but you have to earn the starting job.</p><div class="offers">' + list + '</div>', {
      c: function (v) {
        var t = C[+v];
        confirmBox('Commit to <b>' + t.name + '</b>?', function () {
          r.stage = 'college'; r.age = 18;
          r.col = { teamId: t.id, year: 1, natl: 0 };
          newCollegeSeason(); save(); rtgHub();
        }, recruitOffers);
      }
    });
  }
  function starterThreshold(t) { return 62 + t.prestige * 4; }

  // ---------------- College
  function newCollegeSeason() {
    var r = SV.rtg, c = r.col, t = C[c.teamId];
    var sameConf = C.filter(function (x) { return x.conf === t.conf && x.id !== t.id; }), others = C.filter(function (x) { return x.conf !== t.conf; });
    var sched = GG.shuffle(sameConf.slice()).slice(0, 7).concat(GG.shuffle(others.slice()).slice(0, 10)).slice(0, 10);
    GG.shuffle(sched);
    var rt = collegeRatings(t);
    c.ratings = rt; c.sched = sched.map(function (x) { return x.id; }); c.week = 0; c.results = []; c.phase = 'reg'; c.post = [];
    c.stats = {}; c.oppR = sched.map(function (x) { return collegeRatings(x); });
  }
  function colTeam() {
    var c = SV.rtg.col, t = C[c.teamId], bonus = isStarter() ? (myOvr() - 75) * 0.2 : 0;
    return teamObj(t, Math.round(c.ratings.off + bonus), c.ratings.def);
  }
  function isStarter() { var c = SV.rtg.col; return myOvr() >= starterThreshold(C[c.teamId]) - (c.year - 1) * 2; }
  function record(results) { var w = 0, l = 0; results.forEach(function (x) { if (x.won) w++; else l++; }); return [w, l]; }

  function colHub() {
    var r = SV.rtg, c = r.col, t = C[c.teamId], rec = record(c.results), st = isStarter();
    var yr = ['Freshman', 'Sophomore', 'Junior', 'Senior'][c.year - 1];
    var games = c.sched.map(function (id, i) {
      var g = c.results[i], o = C[id];
      return '<li class="' + (i === c.week && c.phase === 'reg' ? 'cur' : '') + '"><span>' + teamChip(o) + ' ' + o.name + '</span><b>' + (g ? (g.won ? 'W ' : 'L ') + g.us + '-' + g.them : '') + '</b></li>';
    }).join('');
    var post = c.post.map(function (g) { return '<li><span>' + g.label + ' vs ' + C[g.opp].ab + '</span><b>' + (g.won ? 'W ' : 'L ') + g.us + '-' + g.them + '</b></li>'; }).join('');
    var action = '';
    if (c.phase === 'reg') action = '<button data-a="play">Play Week ' + (c.week + 1) + '</button>';
    else if (c.phase === 'post') action = '<button data-a="post">' + c.nextPost.label + '</button>';
    else action = '<button data-a="end">End Season</button>';
    var seasonLine = statLine(fillStats(c.stats), r.pos);
    show(playerCard() +
      '<div class="tbar" style="background:' + t.c1 + ';color:' + t.c2 + '"><b>' + t.name + '</b><span>' + yr + ' &middot; ' + rec[0] + '-' + rec[1] + '</span></div>' +
      '<p>' + (st ? '<b class="good">STARTER</b>' : '<b class="badc">BACKUP</b> &mdash; reach ' + (starterThreshold(t) - (c.year - 1) * 2) + ' OVR to start') + ' &middot; Team ' + c.ratings.off + ' OFF / ' + c.ratings.def + ' DEF</p>' +
      '<div class="card"><b>Season</b><div class="line">' + seasonLine + '</div></div>' +
      '<div class="row">' + action + '<button data-a="m" class="alt">Menu</button></div>' +
      attrPanel() +
      '<ul class="sched">' + games + post + '</ul>' + trophyCase(), {
      m: title, up: upAct(colHub),
      play: function () {
        var i = c.week, o = C[c.sched[i]], or = c.oppR[i];
        playMyGame({ user: colTeam(), opp: teamObj(o, or.off, or.def), starter: isStarter(), label: 'Week ' + (i + 1) + ': ' + (i % 2 ? '@ ' : 'vs ') + o.name }, function (res, xp) {
          c.results.push({ won: res.won, us: res.us, them: res.them }); addStats(c.stats, res.my); c.week++;
          if (c.week >= c.sched.length) setupPost();
          save();
          postGame(res, xp, '', colHub);
        });
      },
      post: function () {
        var np = c.nextPost, o = C[np.opp], or = collegeRatings(o);
        or.off += 3; or.def += 3;
        playMyGame({ user: colTeam(), opp: teamObj(o, or.off, or.def), starter: isStarter(), label: np.label }, function (res, xp) {
          np.won = res.won; np.us = res.us; np.them = res.them; c.post.push(np); addStats(c.stats, res.my);
          if (res.won && np.round < np.rounds) { c.nextPost = postGameDef(np.round + 1, np.rounds); }
          else {
            c.phase = 'done';
            if (res.won && np.rounds === 3 && np.round === 3) { c.natl++; r.awards.push('National Champion (' + yrLabel() + ')'); }
            if (res.won && np.rounds === 1) r.awards.push(np.label + ' Champion (' + yrLabel() + ')');
          }
          save();
          postGame(res, xp, res.won && c.phase === 'done' && np.rounds === 3 ? '<b class="gold">NATIONAL CHAMPIONS!</b>' : '', colHub);
        });
      },
      end: endCollegeSeason
    });
  }
  function yrLabel() { var r = SV.rtg; return r.stage === 'college' ? 'Yr ' + r.col.year : 'Pro ' + r.pro.season; }
  function fillStats(s) { var z = { comp: 0, att: 0, passYds: 0, passTD: 0, int: 0, car: 0, rushYds: 0, rushTD: 0, rec: 0, recYds: 0, recTD: 0 }; for (var k in s) z[k] = s[k]; return z; }
  function postGameDef(round, rounds) {
    var names = rounds === 3 ? ['Playoff Quarterfinal', 'Playoff Semifinal', 'National Championship'] : [pick(['Citrus', 'Sun', 'Gator', 'Holiday', 'Liberty', 'Alamo']) + ' Bowl'];
    var opp = C.filter(function (x) { return x.id !== SV.rtg.col.teamId && x.prestige >= (rounds === 3 ? 4 : 2); });
    return { round: round, rounds: rounds, label: names[round - 1], opp: pick(opp).id };
  }
  function setupPost() {
    var c = SV.rtg.col, rec = record(c.results);
    if (rec[0] >= 9) { c.phase = 'post'; c.nextPost = postGameDef(1, 3); }
    else if (rec[0] >= 6) { c.phase = 'post'; c.nextPost = postGameDef(1, 1); }
    else c.phase = 'done';
  }
  function heismanScore(s, pos) {
    if (pos === 'QB') return s.passYds / 25 + s.passTD * 6 - s.int * 4 + s.rushYds / 15;
    if (pos === 'RB') return s.rushYds / 10 + s.rushTD * 6 + s.recYds / 15;
    return s.recYds / 10 + s.recTD * 6 + s.rec / 2;
  }
  function endCollegeSeason() {
    var r = SV.rtg, c = r.col, rec = record(c.results.concat(c.post)), s = fillStats(c.stats);
    var hs = heismanScore(s, r.pos) + rec[0] * 4;
    var heis = isStarter() && hs > 160 + rand(-20, 20);
    var allAm = isStarter() && hs > 120;
    var notes = [];
    if (heis) { r.awards.push('Heisman Trophy (Yr ' + c.year + ')'); notes.push('<b class="gold">You won the HEISMAN TROPHY!</b>'); }
    else if (allAm) { r.awards.push('All-American (Yr ' + c.year + ')'); notes.push('Named <b>All-American</b>!'); }
    r.seasons.push({ lvl: 'College', yr: c.year, team: C[c.teamId].ab, w: rec[0], l: rec[1], line: statLine(s, r.pos), s: s });
    // natural growth
    GG.ATTRS[r.pos].forEach(function (a) { r.at[a[0]] = clamp(r.at[a[0]] + ri(1, 3), 0, 99); });
    r.xp += 100; r.age++;
    notes.push('Offseason training: all attributes up, +100 XP.');
    save();
    var canDeclare = c.year >= 3;
    show(playerCard() + '<h2>Season Over</h2><div class="card"><div class="line">' + rec[0] + '-' + rec[1] + ' &middot; ' + statLine(s, r.pos) + '</div>' + notes.map(function (n) { return '<p>' + n + '</p>'; }).join('') + '</div>' +
      (canDeclare ? '<p>Draft projection: <b>' + draftProjection().label + '</b></p>' : '') +
      '<div class="row">' + (c.year < 4 ? '<button data-a="stay">' + (canDeclare ? 'Return to school' : 'Next Season') + '</button>' : '') + (canDeclare ? '<button data-a="dec">Declare for the Draft</button>' : '') + '</div>', {
      stay: function () { c.year++; newCollegeSeason(); save(); rtgHub(); },
      dec: function () { r.stage = 'draft'; save(); rtgHub(); }
    });
  }
  function draftProjection() {
    var r = SV.rtg, o = myOvr(), bonus = 0;
    r.awards.forEach(function (a) { if (a.indexOf('Heisman') === 0) bonus += 4; else if (a.indexOf('All-American') === 0) bonus += 2; else if (a.indexOf('National') === 0) bonus += 1.5; });
    var sc = o + bonus;
    var round = sc >= 86 ? 1 : sc >= 82 ? 2 : sc >= 78 ? 3 : sc >= 75 ? 4 : sc >= 72 ? 5 : sc >= 70 ? 6 : sc >= 67 ? 7 : 0;
    return { round: round, sc: sc, label: round ? 'Round ' + round : 'Undrafted' };
  }
  function trophyCase() {
    var r = SV.rtg; if (!r.awards.length) return '';
    return '<div class="card"><b>Trophy Case</b>' + r.awards.map(function (a) { return '<div class="line">&#127942; ' + a + '</div>'; }).join('') + '</div>';
  }

  // ---------------- Draft
  function draftDay() {
    var r = SV.rtg, pj = draftProjection(), round = pj.round;
    if (round > 1 && Math.random() < 0.3) round--; else if (round && round < 7 && Math.random() < 0.25) round++;
    var pickNo = round ? (round - 1) * 32 + ri(1, 32) : 0;
    if (round === 1 && pj.sc > 92) pickNo = ri(1, 5);
    var team = P[ri(0, P.length - 1)];
    var salary = round === 1 ? (pickNo <= 10 ? 9 : 4) : round === 2 ? 2 : round ? 1 : 0.8;
    show(playerCard() + '<h2>Draft Day</h2><div class="card draft"><p class="dim">With the ' + (round ? ordinal(pickNo) + ' pick in round ' + round : 'draft over, you sign as an undrafted free agent with') + '...</p>' +
      '<div class="big">' + teamChip(team) + ' ' + team.name + '</div><p>' + (round ? 'select <b>' + esc(r.name) + '</b>, ' + r.pos + ', ' + C[r.col.teamId].name : '') + '</p><p>Rookie contract: <b class="gold">$' + salary + 'M / yr</b></p></div>' +
      '<button data-a="go">Start Pro Career</button>', {
      go: function () {
        r.stage = 'pro'; r.draft = { round: round, pick: pickNo, team: team.id };
        r.pro = { teamId: team.id, season: 1, salary: salary, titles: 0, mvps: 0 };
        newProSeason(); save(); rtgHub();
      }
    });
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  // ---------------- Pro
  function newProSeason() {
    var p = SV.rtg.pro;
    var opps = GG.shuffle(P.filter(function (t) { return t.id !== p.teamId; }).slice()).slice(0, 12);
    p.sched = opps.map(function (t) { return t.id; }); p.week = 0; p.results = []; p.phase = 'reg'; p.post = []; p.stats = {};
    p.rating = clamp(P[p.teamId].rating + ri(-4, 4), 62, 92);
    p.oppR = opps.map(function (t) { return clamp(t.rating + ri(-4, 4), 60, 94); });
  }
  function proStarter() { return myOvr() >= 76 || (SV.rtg.draft.round === 1 && myOvr() >= 72); }
  function proTeam() { var p = SV.rtg.pro, t = P[p.teamId], b = proStarter() ? (myOvr() - 78) * 0.25 : 0; return teamObj(t, Math.round(p.rating + b), p.rating); }
  function proHub() {
    var r = SV.rtg, p = r.pro, t = P[p.teamId], rec = record(p.results);
    var games = p.sched.map(function (id, i) { var g = p.results[i], o = P[id]; return '<li class="' + (i === p.week && p.phase === 'reg' ? 'cur' : '') + '"><span>' + teamChip(o) + ' ' + o.name + '</span><b>' + (g ? (g.won ? 'W ' : 'L ') + g.us + '-' + g.them : '') + '</b></li>'; }).join('');
    var post = p.post.map(function (g) { return '<li><span>' + g.label + '</span><b>' + (g.won ? 'W ' : 'L ') + g.us + '-' + g.them + '</b></li>'; }).join('');
    var action = p.phase === 'reg' ? '<button data-a="play">Play Week ' + (p.week + 1) + '</button>' : p.phase === 'post' ? '<button data-a="post">' + p.nextPost.label + '</button>' : '<button data-a="end">End Season</button>';
    show(playerCard() + '<div class="tbar" style="background:' + t.c1 + ';color:' + t.c2 + '"><b>' + t.name + '</b><span>Pro Yr ' + p.season + ' &middot; ' + rec[0] + '-' + rec[1] + '</span></div>' +
      '<p>' + (proStarter() ? '<b class="good">STARTER</b>' : '<b class="badc">BACKUP</b> &mdash; reach 76 OVR to start') + ' &middot; Salary $' + p.salary + 'M &middot; Career earnings $' + Math.round(r.money * 10) / 10 + 'M</p>' +
      '<div class="card"><b>Season</b><div class="line">' + statLine(fillStats(p.stats), r.pos) + '</div></div>' +
      '<div class="row">' + action + '<button data-a="ret" class="alt">Retire</button><button data-a="m" class="alt">Menu</button></div>' +
      attrPanel() + '<ul class="sched">' + games + post + '</ul>' + trophyCase(), {
      m: title, up: upAct(proHub),
      ret: function () { confirmBox('Retire and end your career?', function () { retire(); }, proHub); },
      play: function () {
        var i = p.week, o = P[p.sched[i]];
        playMyGame({ user: proTeam(), opp: teamObj(o, p.oppR[i], p.oppR[i]), starter: proStarter(), label: 'Week ' + (i + 1) + ' vs ' + o.name }, function (res, xp) {
          p.results.push({ won: res.won, us: res.us, them: res.them }); addStats(p.stats, res.my); p.week++;
          if (p.week >= p.sched.length) {
            var w = record(p.results)[0];
            if (w >= 8) { p.phase = 'post'; p.nextPost = proPost(1); } else p.phase = 'done';
          }
          save(); postGame(res, xp, '', proHub);
        });
      },
      post: function () {
        var np = p.nextPost, o = P[np.opp], rt = clamp(o.rating + 4, 70, 95);
        playMyGame({ user: proTeam(), opp: teamObj(o, rt, rt), starter: proStarter(), label: np.label }, function (res, xp) {
          np.won = res.won; np.us = res.us; np.them = res.them; p.post.push(np); addStats(p.stats, res.my);
          if (res.won && np.round < 3) p.nextPost = proPost(np.round + 1);
          else { p.phase = 'done'; if (res.won && np.round === 3) { p.titles++; r.awards.push('Championship Bowl Winner (Pro ' + p.season + ')'); } }
          save(); postGame(res, xp, res.won && np.round === 3 ? '<b class="gold">CHAMPIONSHIP BOWL CHAMPIONS!</b>' : '', proHub);
        });
      },
      end: endProSeason
    });
  }
  function proPost(round) { return { round: round, label: ['Wild Card', 'Conference Final', 'Championship Bowl'][round - 1], opp: pick(P.filter(function (t) { return t.id !== SV.rtg.pro.teamId; })).id }; }
  function endProSeason() {
    var r = SV.rtg, p = r.pro, s = fillStats(p.stats), rec = record(p.results), notes = [];
    r.money += p.salary;
    var sc = heismanScore(s, r.pos) * 0.9 + rec[0] * 4;
    if (proStarter() && sc > 175 + rand(-20, 20)) { p.mvps++; r.awards.push('League MVP (Pro ' + p.season + ')'); notes.push('<b class="gold">You are the LEAGUE MVP!</b>'); }
    else if (proStarter() && sc > 125) { r.awards.push('Pro Bowl (Pro ' + p.season + ')'); notes.push('Selected to the <b>Pro Bowl</b>!'); }
    r.seasons.push({ lvl: 'Pro', yr: p.season, team: P[p.teamId].ab, w: rec[0], l: rec[1], line: statLine(s, r.pos), s: s });
    r.age++;
    var chg = r.age <= 27 ? ri(0, 2) : r.age <= 30 ? ri(-1, 1) : -ri(1, 4);
    GG.ATTRS[r.pos].forEach(function (a) { r.at[a[0]] = clamp(r.at[a[0]] + chg + (a[0] === 'spd' && r.age > 30 ? -1 : 0), 30, 99); });
    notes.push(chg >= 0 ? 'Offseason: you got better (+' + chg + ').' : 'Age is catching up: attributes ' + chg + '.');
    // contract
    var contractEnd = p.season % 4 === 0;
    if (contractEnd) {
      var o = myOvr(), newSal = Math.max(1, Math.round((o - 65) * 1.6 + p.mvps * 5));
      notes.push('New contract signed: <b class="gold">$' + newSal + 'M / yr</b>');
      p.salary = newSal;
    }
    r.xp += 80; p.season++;
    var forced = r.age >= 38;
    save();
    show(playerCard() + '<h2>Season Over</h2><div class="card"><div class="line">' + rec[0] + '-' + rec[1] + ' &middot; ' + statLine(s, r.pos) + '</div>' + notes.map(function (n) { return '<p>' + n + '</p>'; }).join('') + '</div>' +
      '<div class="row">' + (forced ? '' : '<button data-a="n">Next Season</button>') + '<button data-a="ret" class="alt">Retire</button></div>', {
      n: function () { newProSeason(); save(); rtgHub(); }, ret: retire
    });
  }
  function careerTotals() {
    var t = {}; SV.rtg.seasons.forEach(function (s) { if (s.lvl === 'Pro') addStats(t, s.s); }); return fillStats(t);
  }
  function retire() {
    var r = SV.rtg, t = careerTotals();
    var legacy = Math.round(heismanScore(t, r.pos) / 4 + r.awards.length * 12 + (r.pro ? r.pro.titles * 25 + r.pro.mvps * 30 : 0));
    r.legacy = legacy; r.hof = legacy >= 250; r.stage = 'retired'; save(); retiredScreen();
  }
  function retiredScreen() {
    var r = SV.rtg;
    var rows = r.seasons.map(function (s) { return '<tr><td>' + s.lvl + ' ' + s.yr + '</td><td>' + s.team + '</td><td>' + s.w + '-' + s.l + '</td><td>' + s.line + '</td></tr>'; }).join('');
    show(playerCard() + '<h2>' + (r.hof ? 'HALL OF FAME' : 'Career Over') + '</h2><p>' + (r.hof ? 'First-ballot Hall of Famer! ' : '') + 'Legacy score: <b class="gold">' + r.legacy + '</b> (Hall of Fame at 250)</p>' +
      trophyCase() + '<div class="card"><table class="tbl"><tr><th>Season</th><th>Team</th><th>Rec</th><th>Stats</th></tr>' + rows + '</table></div>' +
      '<div class="row"><button data-a="n">New Player</button><button data-a="m" class="alt">Menu</button></div>', { n: createPlayer, m: title });
  }

  // =============================================================== DYNASTY
  var POS_SLOTS = { QB: 3, RB: 3, WR: 6, TE: 2, OL: 8, DL: 7, LB: 5, DB: 7 };
  var NEEDS = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 3, DB: 4 };
  function genPlayer(pos, base, yr) { return { name: GG.name(), pos: pos, ovr: clamp(Math.round(base + rand(-7, 6)), 40, 95), yr: yr || ri(1, 4) }; }
  function newDynasty() {
    var list = C.slice().sort(function (a, b) { return b.prestige - a.prestige; }).map(function (t) {
      return '<button class="offer" data-a="p" data-v="' + t.id + '">' + teamChip(t) + '<span class="on">' + t.name + '<small>' + t.conf + '</small></span><span class="dc">' + GG.starStr(t.prestige) + '</span></button>';
    }).join('');
    show('<h2>Choose Your Program</h2><label class="card">Coach name<input id="d-n" maxlength="20" value="Coach ' + pick(GG.LAST) + '"></label><p class="dim">Low-star schools are a real rebuild. Turn a 1-star into a dynasty!</p><div class="offers">' + list + '</div><button data-a="b" class="alt">Back</button>', {
      b: title,
      p: function (v) {
        var t = C[+v], base = 52 + t.prestige * 6, roster = [];
        for (var pos in POS_SLOTS) for (var i = 0; i < POS_SLOTS[pos]; i++) roster.push(genPlayer(pos, base - i * 2));
        SV.dyn = { coach: document.getElementById('d-n').value || 'Coach', teamId: t.id, season: 1, credits: 10, prestige: t.prestige, fac: { train: 1, recruit: 1, stadium: 1 }, staff: { oc: 0, dc: 0 }, roster: roster, history: [], titles: 0 };
        newDynSeason(); save(); dynHub();
      }
    });
  }
  function teamRatings(roster, staff) {
    function top(pos, n) { return roster.filter(function (p) { return p.pos === pos; }).sort(function (a, b) { return b.ovr - a.ovr; }).slice(0, n).map(function (p) { return p.ovr; }); }
    function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 45; }
    var qb = top('QB', 1), off = avg(qb.concat(qb, top('RB', 1), top('WR', 3), top('TE', 1), top('OL', 5)));
    var def = avg(top('DL', 4).concat(top('LB', 3), top('DB', 4)));
    return { off: Math.round(off + (staff ? staff.oc * 2 : 0)), def: Math.round(def + (staff ? staff.dc * 2 : 0)) };
  }
  function cpuRating(t) { return 56 + t.prestige * 6; }
  function newDynSeason() {
    var d = SV.dyn, t = C[d.teamId];
    var opp = GG.shuffle(C.filter(function (x) { return x.id !== t.id; }).slice());
    var conf = opp.filter(function (x) { return x.conf === t.conf; }).slice(0, 8), rest = opp.filter(function (x) { return conf.indexOf(x) < 0; });
    var sched = GG.shuffle(conf.concat(rest).slice(0, 12));
    d.sched = sched.map(function (x) { return x.id; }); d.week = 0; d.results = []; d.phase = 'reg'; d.post = [];
    d.league = {}; C.forEach(function (x) { d.league[x.id] = [0, 0]; });
    d.board = genProspects(); d.pointsMax = 40 + d.fac.recruit * 12; d.points = d.pointsMax; d.weekSpent = {};
  }
  function genProspects() {
    var list = [], poss = ['QB', 'RB', 'WR', 'WR', 'TE', 'OL', 'OL', 'DL', 'DL', 'LB', 'DB', 'DB'];
    for (var i = 0; i < 36; i++) {
      var stars = Math.random() < 0.06 ? 5 : Math.random() < 0.22 ? 4 : Math.random() < 0.55 ? 3 : 2;
      var rivals = GG.shuffle(C.filter(function (t) { return Math.abs(t.prestige - stars) <= 1 && t.id !== SV.dyn.teamId; }).slice()).slice(0, 3);
      list.push({ id: i, name: GG.name(), pos: pick(poss), stars: stars, state: pick(GG.STATES), mine: 0, offered: false, visit: false, rivals: rivals.map(function (t) { return { id: t.id, v: ri(0, 25) }; }), commit: null });
    }
    return list.sort(function (a, b) { return b.stars - a.stars; });
  }
  function dynRank() {
    var d = SV.dyn, scores = C.map(function (t) {
      var rec = t.id === d.teamId ? record(d.results) : d.league[t.id];
      var rt = t.id === d.teamId ? avgR() : cpuRating(t);
      return { id: t.id, s: rec[0] * 10 - rec[1] * 14 + rt * 0.6, rec: rec };
    }).sort(function (a, b) { return b.s - a.s; });
    return scores;
  }
  function avgR() { var r = teamRatings(SV.dyn.roster, SV.dyn.staff); return (r.off + r.def) / 2; }
  function simLeagueWeek() {
    var d = SV.dyn, ids = GG.shuffle(C.map(function (t) { return t.id; }).filter(function (id) { return id !== d.teamId && id !== d.sched[d.week]; }));
    for (var i = 0; i + 1 < ids.length; i += 2) {
      var a = C[ids[i]], b = C[ids[i + 1]], pa = 0.5 + (cpuRating(a) - cpuRating(b)) * 0.03;
      if (Math.random() < pa) { d.league[a.id][0]++; d.league[b.id][1]++; } else { d.league[b.id][0]++; d.league[a.id][1]++; }
    }
  }
  function dynHub() {
    var d = SV.dyn; if (!d) return title();
    var t = C[d.teamId], rr = teamRatings(d.roster, d.staff), rec = record(d.results);
    var rank = dynRank(), myRank = rank.findIndex(function (x) { return x.id === d.teamId; }) + 1;
    var games = d.sched.map(function (id, i) { var g = d.results[i], o = C[id]; return '<li class="' + (i === d.week && d.phase === 'reg' ? 'cur' : '') + '"><span>' + teamChip(o) + ' ' + o.name + ' <small class="dim">' + GG.starStr(o.prestige) + '</small></span><b>' + (g ? (g.won ? 'W ' : 'L ') + g.us + '-' + g.them : '') + '</b></li>'; }).join('');
    var post = d.post.map(function (g) { return '<li><span>' + g.label + ' vs ' + C[g.opp].ab + '</span><b>' + (g.won ? 'W ' : 'L ') + g.us + '-' + g.them + '</b></li>'; }).join('');
    var commits = d.board.filter(function (p) { return p.commit === d.teamId; }).length;
    var action = d.phase === 'reg' ? '<button data-a="play">Play Week ' + (d.week + 1) + '</button><button data-a="sim" class="alt">Sim Week</button>' : d.phase === 'post' ? '<button data-a="post">' + d.nextPost.label + '</button><button data-a="psim" class="alt">Sim</button>' : '<button data-a="off">Signing Day &amp; Offseason</button>';
    show('<div class="tbar" style="background:' + t.c1 + ';color:' + t.c2 + '"><b>' + t.name + '</b><span>Year ' + d.season + ' &middot; ' + rec[0] + '-' + rec[1] + (myRank <= 25 ? ' &middot; #' + myRank : '') + '</span></div>' +
      '<div class="card stats"><div><b>' + rr.off + '</b><span>OFF</span></div><div><b>' + rr.def + '</b><span>DEF</span></div><div><b class="gold">' + GG.starStr(d.prestige) + '</b><span>Prestige</span></div><div><b>' + d.credits + '</b><span>Credits</span></div><div><b>' + commits + '</b><span>Commits</span></div></div>' +
      '<div class="row">' + action + '</div>' +
      '<div class="row"><button data-a="rec" class="alt">Recruiting (' + d.points + ' pts)</button><button data-a="ros" class="alt">Roster</button><button data-a="fac" class="alt">Facilities</button><button data-a="t25" class="alt">Top 25</button><button data-a="m" class="alt">Menu</button></div>' +
      '<ul class="sched">' + games + post + '</ul>' +
      (d.history.length ? '<div class="card"><b>Program History</b>' + d.history.map(function (h) { return '<div class="line">Year ' + h.season + ': ' + h.rec + ' &middot; ' + h.note + '</div>'; }).join('') + '</div>' : ''), {
      m: title, rec: recruiting, ros: roster, fac: facilities, t25: top25,
      play: function () { dynGame(true); }, sim: function () { dynGame(false); },
      post: function () { dynPostGame(true); }, psim: function () { dynPostGame(false); }, off: offseason
    });
  }
  function myTeamObj() { var d = SV.dyn, rr = teamRatings(d.roster, d.staff); return teamObj(C[d.teamId], rr.off, rr.def); }
  function oppObj(id, boost) { var o = C[id], r = cpuRating(o) + (boost || 0); return teamObj(o, Math.round(r + rand(-3, 3)), Math.round(r + rand(-3, 3))); }
  function runGame(user, opp, interactive, cb) {
    if (interactive) { hide(); GG.Match.start({ user: user, opp: opp, drives: 6, defBoost: SV.dyn.fac.stadium }, cb); }
    else { var res = GG.simGame(user.off, user.def + SV.dyn.fac.stadium, opp.off, opp.def, null, 6); if (res.us === res.them) { res.us += 3; res.won = true; } cb(res); }
  }
  function dynGame(interactive) {
    var d = SV.dyn, oid = d.sched[d.week], user = myTeamObj(), opp = oppObj(oid);
    runGame(user, opp, interactive, function (res) {
      d.results.push({ won: res.won, us: res.us, them: res.them });
      d.league[oid][res.won ? 1 : 0]++;
      d.credits += res.won ? 3 + (d.fac.stadium - 1) : 1;
      simLeagueWeek(); recruitWeek(res.won); d.week++;
      if (d.week >= d.sched.length) dynSetupPost();
      save();
      show('<h2>' + (res.won ? 'WIN' : 'LOSS') + ' ' + res.us + '-' + res.them + '</h2><p>vs ' + C[oid].name + '</p>' + boxScore(res.stats) + '<div class="card"><b>Recruiting update</b>' + (d.lastNews.length ? d.lastNews.map(function (n) { return '<div class="line">' + n + '</div>'; }).join('') : '<div class="line dim">No commitments this week.</div>') + '</div><button data-a="c">Continue</button>', { c: dynHub });
    });
  }
  function dynSetupPost() {
    var d = SV.dyn, rank = dynRank(), pos = rank.findIndex(function (x) { return x.id === d.teamId; }) + 1, rec = record(d.results);
    d.finalRank = pos;
    if (pos <= 12) {
      var field = rank.slice(0, 12).map(function (x) { return x.id; });
      d.phase = 'post'; d.seed = pos; d.field = field;
      d.nextPost = { round: pos <= 4 ? 2 : 1, label: pos <= 4 ? 'Playoff Quarterfinal (bye earned)' : 'Playoff First Round', opp: field[12 - pos] !== d.teamId ? field[12 - pos] : field[0], rounds: 4 };
    } else if (rec[0] >= 6) { d.phase = 'post'; d.nextPost = { round: 1, rounds: 1, label: pick(['Citrus', 'Sun', 'Gator', 'Holiday', 'Liberty', 'Alamo']) + ' Bowl', opp: pick(rank.slice(12, 30)).id }; }
    else d.phase = 'done';
  }
  function dynPostGame(interactive) {
    var d = SV.dyn, np = d.nextPost;
    runGame(myTeamObj(), oppObj(np.opp, 3), interactive, function (res) {
      np.won = res.won; np.us = res.us; np.them = res.them; d.post.push(np);
      var names = { 2: 'Playoff Quarterfinal', 3: 'Playoff Semifinal', 4: 'National Championship' };
      if (res.won) d.credits += 5;
      if (res.won && np.round < np.rounds) {
        var pool = d.field.filter(function (id) { return id !== d.teamId && !d.post.some(function (g) { return g.opp === id; }); });
        d.nextPost = { round: np.round + 1, rounds: np.rounds, label: names[np.round + 1], opp: pool[Math.min(pool.length - 1, ri(0, 3))] };
      } else {
        d.phase = 'done';
        if (res.won && np.rounds === 4) { d.titles++; d.credits += 15; d.champ = true; }
        if (res.won && np.rounds === 1) d.bowlWin = np.label;
      }
      save();
      show('<h2>' + (res.won ? 'WIN' : 'LOSS') + ' ' + res.us + '-' + res.them + '</h2><p>' + np.label + ' vs ' + C[np.opp].name + '</p>' + (d.champ && d.phase === 'done' && res.won && np.rounds === 4 ? '<div class="big gold">NATIONAL CHAMPIONS!</div>' : '') + boxScore(res.stats) + '<button data-a="c">Continue</button>', { c: dynHub });
    });
  }

  // ---------------- Recruiting
  function needCount(pos) { var d = SV.dyn; var have = d.roster.filter(function (p) { return p.pos === pos && p.yr < 4; }).length; return Math.max(0, POS_SLOTS[pos] - have); }
  function recruiting() {
    var d = SV.dyn, t = C[d.teamId];
    var needs = Object.keys(POS_SLOTS).map(function (p) { var n = needCount(p); return '<span class="need' + (n ? ' hot' : '') + '">' + p + ' ' + n + '</span>'; }).join('');
    var rows = d.board.map(function (p) {
      var top = p.rivals.slice().sort(function (a, b) { return b.v - a.v; })[0];
      var status = p.commit === d.teamId ? '<b class="good">COMMITTED</b>' : p.commit != null ? '<span class="badc">Signed w/ ' + C[p.commit].ab + '</span>' : '';
      var spent = d.weekSpent[p.id] || 0;
      return '<div class="pros' + (p.commit != null ? ' done' : '') + '"><div class="pi"><b>' + p.name + '</b><small>' + p.pos + ' &middot; ' + p.state + (p.state === t.state ? ' (home)' : '') + '</small><span class="gold">' + GG.starStr(p.stars) + '</span></div>' +
        '<div class="ib"><div class="bar"><i style="width:' + Math.min(100, p.mine) + '%"></i></div><small>You ' + Math.round(p.mine) + ' &middot; ' + C[top.id].ab + ' ' + Math.round(top.v) + '</small></div>' +
        (p.commit == null ? '<div class="pa"><button class="mini" data-a="add" data-v="' + p.id + '"' + (d.points < 5 || spent >= 25 ? ' disabled' : '') + '>+5</button>' +
          '<button class="mini' + (p.offered ? ' on' : '') + '" data-a="off" data-v="' + p.id + '">' + (p.offered ? 'Offered' : 'Offer') + '</button>' +
          '<button class="mini" data-a="vis" data-v="' + p.id + '"' + (p.visit || d.points < 15 || !p.offered ? ' disabled' : '') + '>' + (p.visit ? 'Visited' : 'Visit 15') + '</button></div>' : '<div class="pa">' + status + '</div>') +
        '</div>';
    }).join('');
    var offers = d.board.filter(function (p) { return p.offered && p.commit == null; }).length;
    show('<h2>Recruiting</h2><div class="card"><div class="row sp"><span>Points this week: <b class="gold">' + d.points + '</b> / ' + d.pointsMax + '</span><span>Open offers: ' + offers + '/12</span></div><div class="needs">Needs: ' + needs + '</div><p class="dim">Spend points to raise interest (max 25/week each). A prospect commits at 100 interest if you lead and have offered. A visit gives a big boost, even bigger if you win that week. Home-state kids like you more. Prestige helps a lot.</p></div>' +
      '<div class="board">' + rows + '</div><button data-a="b">Back</button>', {
      b: dynHub,
      add: function (v) { var p = d.board[+v]; if (d.points >= 5) { d.points -= 5; d.weekSpent[p.id] = (d.weekSpent[p.id] || 0) + 5; p.mine += 5 * interestMult(p); save(); recruiting(); } },
      off: function (v) { var p = d.board[+v]; if (!p.offered && offers >= 12) return; p.offered = !p.offered; if (p.offered) p.mine += 4; save(); recruiting(); },
      vis: function (v) { var p = d.board[+v]; if (d.points >= 15 && !p.visit) { d.points -= 15; p.visit = d.week + 1; p.mine += 12 * interestMult(p); save(); recruiting(); } }
    });
  }
  function interestMult(p) {
    var d = SV.dyn, t = C[d.teamId];
    var m = 0.6 + d.prestige * 0.18;
    m *= [0, 1.4, 1.2, 1, 0.75, 0.55][p.stars];
    if (p.state === t.state) m *= 1.35;
    if (needCount(p.pos) > 0) m *= 1.1;
    return m;
  }
  function recruitWeek(won) {
    var d = SV.dyn; d.lastNews = [];
    d.board.forEach(function (p) {
      if (p.commit != null) return;
      if (p.visit === d.week + 1) p.mine += (won ? 22 : 6) * interestMult(p);
      p.rivals.forEach(function (r) { r.v += rand(2, 10) * (0.7 + C[r.id].prestige * 0.12); });
      var top = p.rivals.slice().sort(function (a, b) { return b.v - a.v; })[0];
      if (p.offered && p.mine >= 100 && p.mine > top.v) { p.commit = d.teamId; d.lastNews.push('&#9989; ' + GG.starStr(p.stars) + ' ' + p.pos + ' ' + p.name + ' COMMITS to you!'); }
      else if (top.v >= 100 && top.v > p.mine) { p.commit = top.id; if (p.mine > 20) d.lastNews.push('&#10060; ' + p.name + ' (' + p.pos + ') picks ' + C[top.id].name); }
    });
    d.points = d.pointsMax; d.weekSpent = {};
  }

  function roster() {
    var d = SV.dyn, yrs = ['FR', 'SO', 'JR', 'SR'];
    var html = Object.keys(POS_SLOTS).map(function (pos) {
      var ps = d.roster.filter(function (p) { return p.pos === pos; }).sort(function (a, b) { return b.ovr - a.ovr; });
      return '<div class="card"><b>' + pos + '</b>' + ps.map(function (p, i) { return '<div class="line rl"><span>' + (i < NEEDS[pos] ? '&#9679; ' : '') + p.name + '</span><span class="dim">' + yrs[p.yr - 1] + '</span><b>' + p.ovr + '</b></div>'; }).join('') + '</div>';
    }).join('');
    show('<h2>Roster</h2><p class="dim">&#9679; = starter</p><div class="grid">' + html + '</div><button data-a="b">Back</button>', { b: dynHub });
  }
  function facilities() {
    var d = SV.dyn;
    var items = [
      ['train', 'Training Facility', 'Players improve more each offseason.', d.fac.train, 5],
      ['recruit', 'Recruiting Office', '+12 recruiting points per week per level.', d.fac.recruit, 5],
      ['stadium', 'Stadium', 'Home crowd boosts defense, more credits per win.', d.fac.stadium, 5]
    ];
    var staff = [['oc', 'Offensive Coordinator', '+2 OFF per level', d.staff.oc, 3], ['dc', 'Defensive Coordinator', '+2 DEF per level', d.staff.dc, 3]];
    function row(it, kind) {
      var cost = (it[3] + 1) * (kind === 'f' ? 8 : 12), max = it[3] >= it[4];
      return '<div class="card fac"><div><b>' + it[1] + '</b> <span class="gold">Lv ' + it[3] + '/' + it[4] + '</span><p class="dim">' + it[2] + '</p></div><button class="mini" data-a="' + kind + '" data-v="' + it[0] + '"' + (max || d.credits < cost ? ' disabled' : '') + '>' + (max ? 'MAX' : 'Upgrade ' + cost + 'cr') + '</button></div>';
    }
    show('<h2>Facilities &amp; Staff</h2><p>Coaching credits: <b class="gold">' + d.credits + '</b> &middot; Earn them by winning.</p>' + items.map(function (i) { return row(i, 'f'); }).join('') + staff.map(function (i) { return row(i, 's'); }).join('') + '<button data-a="b">Back</button>', {
      b: dynHub,
      f: function (k) { var c = (d.fac[k] + 1) * 8; if (d.credits >= c && d.fac[k] < 5) { d.credits -= c; d.fac[k]++; if (k === 'recruit') { d.pointsMax += 12; d.points += 12; } save(); facilities(); } },
      s: function (k) { var c = (d.staff[k] + 1) * 12; if (d.credits >= c && d.staff[k] < 3) { d.credits -= c; d.staff[k]++; save(); facilities(); } }
    });
  }
  function top25() {
    var d = SV.dyn, rank = dynRank().slice(0, 25);
    show('<h2>Top 25</h2><div class="card">' + rank.map(function (x, i) { var t = C[x.id]; return '<div class="line rl' + (x.id === d.teamId ? ' me' : '') + '"><span>' + (i + 1) + '. ' + teamChip(t) + ' ' + t.name + '</span><b>' + x.rec[0] + '-' + x.rec[1] + '</b></div>'; }).join('') + '</div><button data-a="b">Back</button>', { b: dynHub });
  }
  function offseason() {
    var d = SV.dyn, rec = record(d.results.concat(d.post)), notes = [];
    // signing day: uncommitted offered prospects go to the highest bidder
    d.board.forEach(function (p) {
      if (p.commit != null) return;
      var top = p.rivals.slice().sort(function (a, b) { return b.v - a.v; })[0];
      if (p.offered && p.mine >= top.v && p.mine >= 50) p.commit = d.teamId; else p.commit = top.id;
    });
    var signed = d.board.filter(function (p) { return p.commit === d.teamId; });
    var grads = d.roster.filter(function (p) { return p.yr >= 4; });
    d.roster = d.roster.filter(function (p) { return p.yr < 4; });
    d.roster.forEach(function (p) { p.yr++; p.ovr = clamp(p.ovr + ri(1, 4) + d.fac.train, 40, 99); });
    signed.forEach(function (p) {
      var base = [0, 52, 58, 64, 70, 77][p.stars];
      d.roster.push({ name: p.name, pos: p.pos, ovr: clamp(base + ri(-3, 3), 40, 90), yr: 1 });
    });
    // walk-ons fill holes
    for (var pos in POS_SLOTS) { while (d.roster.filter(function (p) { return p.pos === pos; }).length < POS_SLOTS[pos]) d.roster.push(genPlayer(pos, 50, 1)); }
    // prestige
    var old = d.prestige;
    if (d.champ || rec[0] >= 11) d.prestige = Math.min(5, d.prestige + 1);
    else if (rec[0] <= 4) d.prestige = Math.max(1, d.prestige - 1);
    var note = d.champ ? '&#127942; National Champions' : d.bowlWin ? d.bowlWin + ' champs' : d.finalRank <= 12 ? 'Playoff (#' + d.finalRank + ')' : rec[0] >= 6 ? 'Bowl eligible' : 'Rebuilding';
    d.history.unshift({ season: d.season, rec: rec[0] + '-' + rec[1], note: note });
    notes.push('Signed <b>' + signed.length + '</b> recruits: ' + (signed.map(function (p) { return p.stars + '&#9733; ' + p.pos; }).join(', ') || 'none'));
    notes.push(grads.length + ' seniors graduated.');
    if (d.prestige !== old) notes.push('Prestige ' + (d.prestige > old ? 'UP' : 'DOWN') + ' to ' + GG.starStr(d.prestige));
    d.season++; d.champ = false; d.bowlWin = null; d.finalRank = null;
    newDynSeason(); save();
    show('<h2>Offseason</h2><div class="card">' + notes.map(function (n) { return '<p>' + n + '</p>'; }).join('') + '</div><button data-a="c">Start Year ' + d.season + '</button>', { c: dynHub });
  }

  // =============================================================== boot
  GG.boot = function () {
    ui = document.getElementById('gg-ui');
    GG.Match.init();
    title();
  };
})(window.GG);
