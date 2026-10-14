/* =====================================================================
   features/platforms.js - NEW PLATFORM TYPES
   Owner: the "platforms" agent. Edit only this file.

   Adds 15 platform types to BB.platformTypes:
     cloud       one bounce, then it vanishes in a poof
     trampoline  big rubber bounce (1.4x), the mat wobbles        (solid)
     blink       phases in and out on a timer, flickers first
     conveyor    belt that pushes you sideways after a bounce      (solid)
     slime       sticky goo: weak bounce (0.6x), slow steering
     golden      rare: +5 coins on the first landing               (solid)
     elevator    rides up and down a rail; boosts you when rising
     teleporter  portal pair: land on the pink one, pop out of the
                 mint one far above
     rocket      rare launch pad: shoots you very high             (solid)
     crumble     shakes for 0.4s after one bounce, then drops
     bubble      floaty bubble: pops with a small boost
     swing       plank hanging from ropes, swings side to side
     spikes      hazard (later on): landing hurts unless you are
                 shielded, then you smash them
     fan         updraft: you float in the wind column above it    (solid)
     mystery     "?" block: coins, super jump, bonus points or a
                 rare jackpot - always at least a normal bounce    (solid)
   New types the player has not met yet get a little name tag the first
   couple of times they show up (BB.save.platforms.seen).

   Debug: BB.debug.platformsShowcase() stacks one of each above the player.
          BB.debug.platformsOnly = 'blink' makes (almost) every row that type.
   Events: 'platforms:warp', 'platforms:rocket', 'platforms:gold',
           'platforms:mystery' (pl, G).
   ===================================================================== */
(function (BB) {
  'use strict';
  if (!BB || !BB.platformTypes) return;

  const T = BB.platformTypes;
  const TAU = Math.PI * 2;
  const MINE = ['cloud', 'trampoline', 'blink', 'conveyor', 'slime', 'golden', 'elevator',
    'teleporter', 'rocket', 'crumble', 'bubble', 'swing', 'spikes', 'fan', 'mystery'];

  // ------------------------------------------------------------------
  // small helpers (no per-frame allocation)
  // ------------------------------------------------------------------
  const DASH = [4, 5], NODASH = [];
  const FLAME = ['#ffcf3f', '#ff8a3d', '#ff4fa3'];
  const GOLD_SPX = [0.14, 0.55, 0.9], GOLD_SPY = [-6, -10, -5];

  function fillRR(c, x, y, w, h, r) { BB.rr(c, x, y, w, h, r); }
  function pathRR(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
  }
  function dot(c, x, y, r) { BB.util.circle(c, x, y, r); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function dash(c, on) { if (c.setLineDash) c.setLineDash(on ? DASH : NODASH); }
  function beep(f, d, type, v, slide) { try { BB.beep(f, d, type, v, slide); } catch (e) { /* no audio */ } }
  function later(ms, f, d, type, v, slide) { setTimeout(function () { beep(f, d, type, v, slide); }, ms); }
  function buzz(x) { try { BB.vibrate(x); } catch (e) { /* no vibration */ } }
  function part(x, y, vx, vy, life, col, size, grav) {
    return BB.emitParticle ? BB.emitParticle(x, y, vx, vy, life, col, size, grav) : null;
  }
  function spray(x, y, n, col, spdX, vyMin, vyMax, life, size, grav) {
    for (let i = 0; i < n; i++) part(x, y, rnd(-spdX, spdX), rnd(vyMin, vyMax), life, col, size, grav);
  }
  function ring(x, y, n, col, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      part(x, y, Math.cos(a) * speed, Math.sin(a) * speed * 0.6, life, col, size, 0);
    }
  }
  function star(c, x, y, s) {
    const k = s * 0.28;
    c.beginPath();
    c.moveTo(x, y - s); c.lineTo(x + k, y - k); c.lineTo(x + s, y); c.lineTo(x + k, y + k);
    c.lineTo(x, y + s); c.lineTo(x - k, y + k); c.lineTo(x - s, y); c.lineTo(x - k, y - k);
    c.closePath();
    c.fill();
  }
  function chevronUp(c, x, y, s) { c.moveTo(x - s, y + s * 0.7); c.lineTo(x, y); c.lineTo(x + s, y + s * 0.7); }
  function puff(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
  function toast(text, col) { try { BB.ui.toast(text, col); } catch (e) { /* ui missing */ } }
  function vw() { return BB.W || 360; }

  // per-run state lives on G (prefixed); rebuilt in 'newGame'
  function newFx() {
    return { pushT: 0, pushDir: 0, pushK: 1, slowT: 0, slowOn: false, rocketT: 0, spikeHit: false };
  }
  function fxOf(G) { return G.platformsFx || (G.platformsFx = newFx()); }

  // Relative weights, with a debug override that forces one of our types.
  function weight(name, fn) {
    return function (d, G) {
      const only = BB.debug && BB.debug.platformsOnly;
      if (only) return only === name ? 1000 : 0;
      return fn(d, G);
    };
  }
  // count a bounce we handled ourselves (when onLand returns 'pass')
  function countBounce(pl, p, G) {
    G.stats.jumps++;
    G.lastLand = pl;
    BB.emit('land', pl, p, G);
  }

  // ------------------------------------------------------------------
  // CLOUD - one bounce, then poof
  // ------------------------------------------------------------------
  T.cloud = {
    color: '#f4efff',
    w: d => Math.max(58, 78 - 16 * d),
    weight: weight('cloud', d => 0.06 + 0.04 * d),
    init(pl) { pl.used = false; pl.poof = 0; pl.seed = Math.random() * 6; },
    update(pl, dt) {
      if (pl.used) { pl.poof += dt * 3.2; if (pl.poof >= 1) pl.dead = true; }
    },
    onLand(pl, p) {
      if (pl.used) return 'pass';
      pl.used = true;
      const cx = pl.x + pl.w / 2;
      for (let i = 0; i < 12; i++) {
        part(cx + rnd(-pl.w / 2, pl.w / 2), pl.y + rnd(0, 8), rnd(-90, 90), rnd(-70, 30), 0.7, i % 3 ? '#f7f3ff' : '#cbbff5', 7, 60);
      }
      later(40, 620, 0.16, 'sine', 0.05, 0.45);
      return undefined; // normal bounce + default beep
    },
    draw(c, pl, G) {
      let k = 1, g = 0;
      if (pl.used) { k = 1 - pl.poof; g = pl.poof * 8; if (k <= 0) return; }
      const x = pl.x, y = pl.y, w = pl.w, cx = x + w / 2;
      const bob = pl.used ? 0 : Math.sin(G.t * 2 + pl.seed) * 1.2;
      c.globalAlpha = k;
      c.fillStyle = '#cbbff5';
      fillRR(c, x - g, y + 3 + bob, w + g * 2, 11, 6);
      c.fillStyle = '#f7f3ff';
      c.beginPath();
      puff(c, x + w * 0.24, y + 3 + bob, 8 + g);
      puff(c, x + w * 0.52, y + bob, 10 + g);
      puff(c, x + w * 0.78, y + 3 + bob, 7.5 + g);
      c.fill();
      fillRR(c, x - g, y + 1 + bob, w + g * 2, 10, 5);
      if (!pl.used) { // sleepy face
        c.fillStyle = '#6a5aa8';
        dot(c, cx - 6, y + 5 + bob, 1.7);
        dot(c, cx + 6, y + 5 + bob, 1.7);
        c.fillStyle = '#ffb3d9';
        dot(c, cx - 11, y + 7 + bob, 2);
        dot(c, cx + 11, y + 7 + bob, 2);
      }
      c.globalAlpha = 1;
    }
  };

  // ------------------------------------------------------------------
  // TRAMPOLINE - 1.4x bounce, wobbly mat
  // ------------------------------------------------------------------
  const TRAMP_WOB = 0.7;
  T.trampoline = {
    color: '#ff4fa3', solid: true,
    w: d => Math.max(58, 76 - 16 * d),
    weight: weight('trampoline', d => Math.max(0.025, 0.055 - 0.03 * d)),
    init(pl) { pl.wob = 0; },
    update(pl, dt) { if (pl.wob > 0) pl.wob = Math.max(0, pl.wob - dt); },
    onLand(pl, p) {
      pl.wob = TRAMP_WOB;
      beep(150, 0.42, 'sine', 0.09, 3.6);
      later(90, 300, 0.22, 'triangle', 0.04, 2.2);
      spray(p.x, pl.y + 2, 10, '#ff4fa3', 160, -260, -80, 0.5, 4, 700);
      BB.shake(3);
      return BB.JUMP * 1.4;
    },
    draw(c, pl) {
      const x = pl.x, y = pl.y, w = pl.w;
      const k = pl.wob / TRAMP_WOB;
      const sag = k > 0 ? Math.sin((1 - k) * 20) * 8 * k : 0;
      c.strokeStyle = '#ffcf3f';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x + 8, y + 6); c.lineTo(x + 3, y + 18);
      c.moveTo(x + w - 8, y + 6); c.lineTo(x + w - 3, y + 18);
      c.stroke();
      c.fillStyle = '#5a2a8a';
      fillRR(c, x + 1, y + 4, w - 2, 7, 3);
      c.strokeStyle = '#ff4fa3';
      c.lineWidth = 5;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x + 6, y + 2);
      c.quadraticCurveTo(x + w / 2, y + 2 + sag * 2, x + w - 6, y + 2);
      c.stroke();
      c.lineCap = 'butt';
      c.fillStyle = '#ffcf3f';
      dot(c, x + 4, y + 3, 4.5);
      dot(c, x + w - 4, y + 3, 4.5);
    }
  };

  // ------------------------------------------------------------------
  // BLINK - on / flicker warning / off / fade in
  // ------------------------------------------------------------------
  const BLINK_WARN = 0.6, BLINK_FADE = 0.25;
  function blinkState(pl) {
    const ph = (pl.age + pl.off) % pl.period;
    if (ph < pl.on) { pl.vis = 1; pl.solidNow = true; pl.warn = false; }
    else if (ph < pl.on + BLINK_WARN) {
      const u = (ph - pl.on) / BLINK_WARN;
      pl.vis = ((ph * 18) | 0) % 2 ? 0.25 + 0.4 * (1 - u) : 1 - 0.5 * u;
      pl.solidNow = true; pl.warn = true;
    } else if (ph < pl.period - BLINK_FADE) { pl.vis = 0; pl.solidNow = false; pl.warn = false; }
    else {
      const u = (ph - (pl.period - BLINK_FADE)) / BLINK_FADE;
      pl.vis = u; pl.solidNow = u > 0.5; pl.warn = false;
    }
  }
  T.blink = {
    color: '#6ea8ff', noItems: true,
    w: d => Math.max(54, 74 - 16 * d),
    weight: weight('blink', d => (d < 0.15 ? 0 : 0.02 + 0.07 * d)),
    init(pl, G, d) {
      pl.on = 1.8 - 0.5 * d;
      pl.offT = 0.9 + 0.35 * d;
      pl.period = pl.on + BLINK_WARN + pl.offT + BLINK_FADE;
      pl.off = Math.random() * pl.period;
      blinkState(pl);
    },
    update(pl) { blinkState(pl); },
    onLand(pl, p) {
      if (!pl.solidNow) return 'pass';
      beep(1400, 0.05, 'square', 0.03, 0.6);
      spray(p.x, pl.y, 6, '#bcd6ff', 120, -120, 20, 0.35, 3, 200);
      return undefined;
    },
    draw(c, pl, G) {
      const x = pl.x, y = pl.y, w = pl.w;
      if (pl.vis <= 0.02) { // ghost outline so you know where it comes back
        c.globalAlpha = 0.55;
        c.strokeStyle = '#8fb8ff';
        c.lineWidth = 2;
        dash(c, true);
        pathRR(c, x + 1, y + 1, w - 2, 10, 5);
        c.stroke();
        dash(c, false);
        c.globalAlpha = 1;
        return;
      }
      c.globalAlpha = pl.vis;
      c.fillStyle = '#2b5fd9';
      fillRR(c, x, y, w, 12, 6);
      c.fillStyle = pl.warn ? '#ffcf3f' : '#6ea8ff';
      fillRR(c, x + 2, y + 1, w - 4, 5, 3);
      // crackling energy line
      c.strokeStyle = '#e6f0ff';
      c.lineWidth = 1.5;
      c.beginPath();
      const seg = 6, flip = ((G.t * 14) | 0) % 2;
      let up = flip;
      c.moveTo(x + 6, y + 8);
      for (let sx = x + 6 + seg; sx < x + w - 5; sx += seg) { up = 1 - up; c.lineTo(sx, y + (up ? 6 : 10)); }
      c.stroke();
      c.globalAlpha = 1;
    }
  };

  // ------------------------------------------------------------------
  // CONVEYOR - pushes you sideways after the bounce
  // ------------------------------------------------------------------
  const PUSH_T = 0.55, PUSH_ACC = 1300, PUSH_KICK = 230;
  T.conveyor = {
    color: '#2c2f52', solid: true,
    w: d => Math.max(64, 88 - 20 * d),
    weight: weight('conveyor', d => (d < 0.04 ? 0 : 0.025 + 0.05 * d)),
    init(pl, G, d) { pl.dir = Math.random() < 0.5 ? -1 : 1; pl.spd = 1 + d * 0.6; },
    onLand(pl, p, G) {
      const f = fxOf(G);
      f.pushDir = pl.dir;
      f.pushK = pl.spd;
      f.pushT = PUSH_T;
      p.vx += pl.dir * PUSH_KICK * pl.spd;
      beep(260, 0.07, 'square', 0.035, 1.8);
      later(60, 200, 0.12, 'sawtooth', 0.025, 1.6);
      const ex = pl.dir > 0 ? pl.x + pl.w : pl.x;
      spray(ex, pl.y + 4, 6, '#ffcf3f', 40, -120, -20, 0.35, 3, 500);
      return undefined;
    },
    draw(c, pl) {
      const x = pl.x, y = pl.y, w = pl.w, dir = pl.dir;
      c.fillStyle = '#2c2f52';
      fillRR(c, x, y, w, 12, 6);
      c.fillStyle = '#454a7d';
      fillRR(c, x + 3, y + 1, w - 6, 3, 2);
      const sp = 12;
      let off = (pl.age * 46 * pl.spd) % sp;
      if (dir < 0) off = sp - off;
      c.strokeStyle = '#ffcf3f';
      c.lineWidth = 2.2;
      c.beginPath();
      for (let cx = x + 12 + off; cx < x + w - 11; cx += sp) {
        c.moveTo(cx - 2.5 * dir, y + 3);
        c.lineTo(cx + 2.5 * dir, y + 6.5);
        c.lineTo(cx - 2.5 * dir, y + 10);
      }
      c.stroke();
      // end rollers with spinning spokes
      c.fillStyle = '#8b84b8';
      dot(c, x + 6, y + 6, 5);
      dot(c, x + w - 6, y + 6, 5);
      const a = pl.age * 9 * dir * pl.spd, ca = Math.cos(a) * 4, sa = Math.sin(a) * 4;
      c.strokeStyle = '#2c2f52';
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(x + 6 - ca, y + 6 - sa); c.lineTo(x + 6 + ca, y + 6 + sa);
      c.moveTo(x + w - 6 - ca, y + 6 - sa); c.lineTo(x + w - 6 + ca, y + 6 + sa);
      c.stroke();
    }
  };

  // ------------------------------------------------------------------
  // SLIME - weak bounce, squelch, slow steering for a moment
  // ------------------------------------------------------------------
  const SLIME_STEER = 0.45, SLIME_T = 0.9;
  T.slime = {
    color: '#7cff4f',
    w: d => Math.max(56, 76 - 16 * d),
    weight: weight('slime', d => (d < 0.08 ? 0 : 0.02 + 0.05 * d)),
    init(pl) { pl.splat = 0; pl.seed = Math.random() * 6; },
    update(pl, dt) { if (pl.splat > 0) pl.splat = Math.max(0, pl.splat - dt * 2.2); },
    onLand(pl, p, G) {
      pl.splat = 1;
      const f = fxOf(G);
      if (!f.slowOn) { BB.mods.steerMult *= SLIME_STEER; f.slowOn = true; }
      f.slowT = SLIME_T;
      beep(150, 0.26, 'sine', 0.09, 0.4);
      later(50, 340, 0.12, 'triangle', 0.045, 0.5);
      for (let i = 0; i < 10; i++) {
        part(p.x + rnd(-12, 12), pl.y, rnd(-170, 170), rnd(-230, -60), 0.55, i % 2 ? '#7cff4f' : '#3fae2a', 5, 900);
      }
      return BB.JUMP * 0.6;
    },
    draw(c, pl, G) {
      const x = pl.x, y = pl.y, w = pl.w, cx = x + w / 2;
      const s = pl.splat;
      const wob = s > 0 ? Math.sin((1 - s) * 16) * 4 * s : 0;
      // drips
      c.fillStyle = '#3fae2a';
      for (let i = 0; i < 3; i++) {
        const dx = x + w * (0.2 + 0.3 * i);
        const len = 4 + 5 * (0.5 + 0.5 * Math.sin(G.t * 2 + pl.seed + i * 1.9));
        fillRR(c, dx - 2.5, y + 6, 5, len + 4, 2.5);
        dot(c, dx, y + 9 + len, 3.2);
      }
      c.fillStyle = '#4ccf2f';
      fillRR(c, x - wob, y + 1 + Math.abs(wob) * 0.5, w + wob * 2, 12 - Math.abs(wob) * 0.5, 6);
      c.fillStyle = '#9dff6e';
      fillRR(c, x + 4 - wob, y + 1, w - 8 + wob * 2, 4, 2);
      // googly eyes
      c.fillStyle = '#fff7e8';
      dot(c, cx - 6, y + 6, 3.2);
      dot(c, cx + 6, y + 6, 3.2);
      c.fillStyle = '#140b2e';
      dot(c, cx - 5.4, y + 6.8, 1.6);
      dot(c, cx + 6.6, y + 6.8, 1.6);
    }
  };

  // ------------------------------------------------------------------
  // GOLDEN - +5 coins on first landing
  // ------------------------------------------------------------------
  T.golden = {
    color: '#ffcf3f', solid: true,
    w: 68,
    weight: weight('golden', d => 0.012 + 0.01 * d),
    init(pl) { pl.paid = false; pl.glint = Math.random() * 3; },
    onLand(pl, p, G) {
      if (pl.paid) return undefined;
      pl.paid = true;
      const cx = pl.x + pl.w / 2;
      const got = BB.addCoins(5, cx, pl.y - 30);
      if (G.stats) G.stats.platformGold = (G.stats.platformGold || 0) + 1;
      for (let i = 0; i < 18; i++) {
        part(cx + rnd(-pl.w / 2, pl.w / 2), pl.y + rnd(-4, 6), rnd(-140, 140), rnd(-320, -60), 0.8, i % 3 ? '#ffcf3f' : '#fff7e8', i % 4 ? 4 : 6, 500);
      }
      beep(988, 0.07, 'square', 0.045);
      later(70, 1318, 0.08, 'square', 0.045);
      later(140, 1568, 0.16, 'square', 0.045);
      toast('GOLD! +' + (got || 5), '#ffcf3f');
      buzz(25);
      BB.emit('platforms:gold', pl, G);
      return undefined;
    },
    draw(c, pl, G) {
      const x = pl.x, y = pl.y, w = pl.w, used = pl.paid;
      c.fillStyle = used ? '#8a6d22' : '#c98f0a';
      fillRR(c, x, y + 3, w, 10, 5);
      c.fillStyle = used ? '#bfa04a' : '#ffcf3f';
      fillRR(c, x, y, w, 9, 5);
      if (used) return;
      c.fillStyle = '#fff3b0';
      fillRR(c, x + 4, y + 1.5, w - 8, 2.5, 1.2);
      const cyc = w + 40;
      const sx = x - 20 + ((G.t * 70 + pl.glint * 50) % cyc);
      if (sx > x + 5 && sx < x + w - 12) {
        c.fillStyle = '#fffbe6';
        c.beginPath();
        c.moveTo(sx + 2, y + 1); c.lineTo(sx + 8, y + 1); c.lineTo(sx + 5, y + 8); c.lineTo(sx - 1, y + 8);
        c.fill();
      }
      c.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) {
        const s = 4 * Math.sin(G.t * 4 + i * 2.1 + pl.glint);
        if (s > 0.4) star(c, x + w * GOLD_SPX[i], y + GOLD_SPY[i], s);
      }
    }
  };

  // ------------------------------------------------------------------
  // ELEVATOR - slides up and down a rail
  // ------------------------------------------------------------------
  function elevatorPos(pl) {
    pl.y = pl.baseY + Math.sin(pl.ph) * pl.range;
    pl.vyv = Math.cos(pl.ph) * pl.range * pl.spd; // px/s, < 0 = rising
  }
  T.elevator = {
    color: '#b8a6ff', noItems: true,
    w: d => Math.max(58, 74 - 14 * d),
    weight: weight('elevator', d => (d < 0.1 ? 0 : 0.02 + 0.06 * d)),
    init(pl, G, d) {
      pl.baseY = pl.y;
      pl.range = rnd(40, 55) + 25 * d;
      pl.spd = 1.2 + 0.6 * d;
      pl.ph = Math.random() * TAU;
      elevatorPos(pl);
    },
    update(pl, dt) {
      if (pl.falling) return;
      pl.ph += pl.spd * dt;
      elevatorPos(pl);
    },
    onLand(pl, p) {
      const lift = Math.min(0, pl.vyv) * 0.6; // riding up gives a little extra
      beep(520, 0.09, 'triangle', 0.05, 1.5);
      if (lift < -25) later(60, 780, 0.08, 'triangle', 0.04, 1.4);
      spray(p.x, pl.y, 5, '#b8a6ff', 100, -100, 0, 0.35, 3, 300);
      return BB.JUMP + lift;
    },
    draw(c, pl) {
      const x = pl.x, y = pl.y, w = pl.w, cx = x + w / 2;
      const top = pl.baseY - pl.range, bot = pl.baseY + pl.range + 12;
      c.globalAlpha = 0.4;
      c.strokeStyle = '#a99bd6';
      c.lineWidth = 2;
      dash(c, true);
      c.beginPath();
      c.moveTo(cx, top - 6); c.lineTo(cx, bot + 6);
      c.stroke();
      dash(c, false);
      c.fillStyle = '#a99bd6';
      dot(c, cx, top - 6, 3);
      dot(c, cx, bot + 6, 3);
      c.globalAlpha = 1;
      c.fillStyle = '#5b4a9e';
      fillRR(c, x, y + 3, w, 10, 5);
      c.fillStyle = '#b8a6ff';
      fillRR(c, x, y, w, 8, 4);
      const up = pl.vyv < 0;
      c.fillStyle = up ? '#ffcf3f' : '#7a6bb8';
      c.beginPath(); c.moveTo(cx - 12, y + 7); c.lineTo(cx - 7, y + 1.5); c.lineTo(cx - 2, y + 7); c.fill();
      c.fillStyle = up ? '#7a6bb8' : '#ffcf3f';
      c.beginPath(); c.moveTo(cx + 2, y + 1.5); c.lineTo(cx + 7, y + 7); c.lineTo(cx + 12, y + 1.5); c.fill();
    }
  };

  // ------------------------------------------------------------------
  // TELEPORTER - pink entry pad warps you up to its mint partner
  // ------------------------------------------------------------------
  let makingExit = false;
  // nudge q sideways so it doesn't sit on top of e
  function dodge(q, e, G) {
    const W = vw();
    const leftRoom = e.x - 12, rightRoom = W - (e.x + e.w + 12);
    let nx;
    if (leftRoom >= q.w && leftRoom >= rightRoom) nx = Math.random() * (leftRoom - q.w);
    else if (rightRoom >= q.w) nx = e.x + e.w + 12 + Math.random() * (rightRoom - q.w);
    else return;
    const dx = nx - q.x;
    const items = G.items, mid = q.x + q.w / 2;
    for (let i = 0; i < items.length; i++) { // carry the item resting on it
      const it = items[i];
      if (!it.got && Math.abs(it.x - mid) < 1.5 && it.y < q.y && it.y > q.y - 60) it.x += dx;
    }
    q.x = nx;
    if (q.x0 != null) q.x0 += dx;
    if (q.ax != null) q.ax += dx;
  }
  function overlaps(a, b) {
    return Math.abs(a.y - b.y) < 30 && a.x < b.x + b.w + 8 && a.x + a.w > b.x - 8;
  }
  T.teleporter = {
    color: '#c56bff',
    w: 62,
    weight: weight('teleporter', d => (d < 0.18 ? 0 : 0.012 + 0.02 * d)),
    init(pl, G, d) {
      pl.exit = makingExit;
      pl.used = false;
      pl.partner = null;
      pl.arrive = 0;
      pl.spin = Math.random() * TAU;
      if (makingExit) return;
      const W = vw();
      const dist = 520 + Math.random() * 240 + 160 * d;
      let ex = Math.random() * Math.max(0, W - pl.w);
      if (Math.abs(ex - pl.x) < 80) ex = (ex + W / 2) % Math.max(1, W - pl.w);
      let q = null;
      makingExit = true;
      try { q = BB.spawnPlatform('teleporter', ex, pl.y - dist, pl.w); } finally { makingExit = false; }
      if (!q) return;
      q.partner = pl;
      pl.partner = q;
      const plats = G.plats;
      for (let i = 0; i < plats.length; i++) {
        const o = plats[i];
        if (o !== q && !o.dead && overlaps(o, q)) { dodge(q, o, G); break; }
      }
    },
    update(pl, dt) { if (pl.arrive > 0) pl.arrive = Math.max(0, pl.arrive - dt * 1.6); },
    onLand(pl, p, G) {
      const q = pl.partner;
      if (pl.exit || pl.used || !q || q.dead || q.falling) {
        spray(p.x, pl.y, 5, pl.exit ? '#3ff0c0' : '#c56bff', 100, -120, 0, 0.35, 3, 300);
        return undefined;
      }
      pl.used = true;
      q.arrive = 1;
      spray(p.x, pl.y, 10, '#c56bff', 120, -260, -40, 0.4, 4, 0);
      p.x = q.x + q.w / 2;
      p.y = q.y - p.r;
      p.vx *= 0.3;
      p.vy = BB.JUMP * BB.mods.jumpMult;
      p.squash = 0.6;
      p.grace = Math.max(p.grace || 0, 0.8);
      const tr = G.trail;
      if (tr) for (let i = 0; i < tr.length; i++) { tr[i].x = p.x; tr[i].y = p.y; }
      // zoom streak + arrival burst
      for (let i = 0; i < 16; i++) {
        part(p.x + rnd(-10, 10), q.y + 30 + i * 22, 0, -900, 0.3, i % 2 ? '#ff4fa3' : '#3ff0c0', 4, 0);
      }
      ring(p.x, q.y, 16, '#3ff0c0', 220, 0.45, 4);
      BB.flash('#c56bff', 0.35);
      BB.shake(6);
      beep(240, 0.45, 'sine', 0.08, 5);
      later(120, 1400, 0.25, 'triangle', 0.04, 0.4);
      buzz(30);
      toast('WARP!', '#c56bff');
      if (G.stats) G.stats.platformWarps = (G.stats.platformWarps || 0) + 1;
      countBounce(q, p, G);
      BB.emit('platforms:warp', pl, G);
      return 'pass';
    },
    draw(c, pl, G) {
      const x = pl.x, y = pl.y, w = pl.w, cx = x + w / 2;
      const isExit = pl.exit, dim = pl.used && !isExit;
      const ringCol = isExit ? '#3ff0c0' : '#ff4fa3';
      if (dim) c.globalAlpha = 0.45;
      c.fillStyle = '#3a1f66';
      fillRR(c, x, y + 3, w, 10, 5);
      c.fillStyle = '#c56bff';
      fillRR(c, x, y, w, 7, 4);
      const rx = w / 2 - 5, ry = 5;
      c.strokeStyle = ringCol;
      c.lineWidth = 3;
      c.beginPath();
      c.ellipse(cx, y - 1, rx, ry, 0, 0, TAU);
      c.stroke();
      c.strokeStyle = '#fff7e8';
      c.lineWidth = 1.5;
      const a = G.t * (isExit ? -4 : 5) + pl.spin;
      c.beginPath();
      c.ellipse(cx, y - 1, rx * 0.55, ry * 0.55, 0, a, a + 2.4);
      c.stroke();
      if (!dim) {
        c.strokeStyle = ringCol;
        c.lineWidth = 2.5;
        for (let i = 0; i < 3; i++) {
          const u = (G.t * 1.3 + i / 3) % 1;
          c.globalAlpha = 1 - u;
          c.beginPath();
          if (isExit) { c.moveTo(cx - 5, y - 30 + u * 22); c.lineTo(cx, y - 26 + u * 22); c.lineTo(cx + 5, y - 30 + u * 22); }
          else chevronUp(c, cx, y - 10 - u * 26, 6);
          c.stroke();
        }
        c.globalAlpha = 1;
      }
      if (pl.arrive > 0) {
        const k = 1 - pl.arrive;
        c.globalAlpha = pl.arrive;
        c.strokeStyle = '#3ff0c0';
        c.lineWidth = 3;
        c.beginPath();
        c.ellipse(cx, y - 1, rx * (1 + k * 1.6), ry * (1 + k * 2.5), 0, 0, TAU);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
  };

  // ------------------------------------------------------------------
  // ROCKET PAD - launches you very high
  // ------------------------------------------------------------------
  const ROCKET_VY = 2.5, ROCKET_T = 1.2;
  T.rocket = {
    color: '#ff5a3c', solid: true,
    w: 58,
    weight: weight('rocket', d => (d < 0.1 ? 0 : 0.007 + 0.01 * d)),
    init(pl) { pl.fired = 0; },
    update(pl, dt) { if (pl.fired > 0) pl.fired = Math.max(0, pl.fired - dt); },
    onLand(pl, p, G) {
      const f = fxOf(G);
      f.rocketT = ROCKET_T;
      pl.fired = 0.7;
      p.grace = Math.max(p.grace || 0, 1.5);
      const cx = pl.x + pl.w / 2;
      for (let i = 0; i < 22; i++) {
        part(cx + rnd(-pl.w / 2, pl.w / 2), pl.y + 6, rnd(-220, 220), rnd(-60, 120), 0.5, FLAME[i % 3], 5, 200);
      }
      BB.shake(10);
      BB.flash('#ff8a3d', 0.25);
      beep(80, 0.8, 'sawtooth', 0.09, 8);
      later(80, 160, 0.5, 'square', 0.04, 5);
      buzz([25, 30, 40]);
      toast('BLAST OFF!', '#ff8a3d');
      if (G.stats) G.stats.platformRockets = (G.stats.platformRockets || 0) + 1;
      BB.emit('platforms:rocket', pl, G);
      return BB.JUMP * ROCKET_VY;
    },
    draw(c, pl, G) {
      const x = pl.x, y = pl.y, w = pl.w, cx = x + w / 2;
      // flame jets under the nozzles
      const fl = 6 + Math.sin(G.t * 30 + x) * 2.5 + pl.fired * 22;
      c.fillStyle = '#ff8a3d';
      c.beginPath();
      c.moveTo(x + 5, y + 12); c.lineTo(x + 15, y + 12); c.lineTo(x + 10, y + 12 + fl);
      c.moveTo(x + w - 15, y + 12); c.lineTo(x + w - 5, y + 12); c.lineTo(x + w - 10, y + 12 + fl);
      c.fill();
      c.fillStyle = '#ffcf3f';
      c.beginPath();
      c.moveTo(x + 7.5, y + 12); c.lineTo(x + 12.5, y + 12); c.lineTo(x + 10, y + 12 + fl * 0.55);
      c.moveTo(x + w - 12.5, y + 12); c.lineTo(x + w - 7.5, y + 12); c.lineTo(x + w - 10, y + 12 + fl * 0.55);
      c.fill();
      // pad: red top, caution-striped front
      c.fillStyle = '#2a1030';
      fillRR(c, x, y + 3, w, 10, 4);
      c.fillStyle = '#ffcf3f';
      c.beginPath();
      for (let sx = x + 5; sx < x + w - 6; sx += 8) {
        c.moveTo(sx, y + 12); c.lineTo(sx + 4, y + 5); c.lineTo(sx + 7, y + 5); c.lineTo(sx + 3, y + 12);
      }
      c.fill();
      c.fillStyle = '#ff5a3c';
      fillRR(c, x, y, w, 6, 3);
      c.fillStyle = '#ffb09c';
      fillRR(c, x + 4, y + 1, w - 8, 1.5, 1);
      // big bobbing arrow + trailing chevrons
      const bob = Math.sin(G.t * 6) * 2;
      c.fillStyle = '#ffcf3f';
      c.beginPath();
      c.moveTo(cx, y - 17 + bob); c.lineTo(cx + 8, y - 8 + bob); c.lineTo(cx + 3, y - 8 + bob);
      c.lineTo(cx + 3, y - 3 + bob); c.lineTo(cx - 3, y - 3 + bob); c.lineTo(cx - 3, y - 8 + bob);
      c.lineTo(cx - 8, y - 8 + bob);
      c.closePath();
      c.fill();
      c.strokeStyle = '#ff8a3d';
      c.lineWidth = 2.5;
      c.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        const u = (G.t * 1.6 + i * 0.5) % 1;
        c.globalAlpha = 0.9 * (1 - u);
        c.beginPath();
        chevronUp(c, cx, y - 22 - u * 16, 6);
        c.stroke();
      }
      c.globalAlpha = 1;
      c.lineCap = 'butt';
    }
  };

  // ------------------------------------------------------------------
  // CRUMBLE - one bounce, shakes 0.4s, then drops
  // ------------------------------------------------------------------
  const CRUMBLE_T = 0.4;
  T.crumble = {
    color: '#9a8cc0',
    w: d => Math.max(52, 74 - 18 * d),
    weight: weight('crumble', d => (d < 0.12 ? 0 : 0.02 + 0.07 * d)),
    init(pl) { pl.crT = -1; pl.fy0 = 0; },
    update(pl, dt) {
      if (pl.crT > 0) {
        pl.crT -= dt;
        if (pl.crT <= 0) {
          pl.crT = 0;
          pl.falling = true;
          pl.vy = 30;
          pl.fy0 = pl.y;
          for (let i = 0; i < 12; i++) {
            part(pl.x + Math.random() * pl.w, pl.y + rnd(0, 10), rnd(-80, 80), rnd(-80, 40), 0.6, i % 2 ? '#9a8cc0' : '#6b5e94', 5, 900);
          }
          beep(110, 0.3, 'sawtooth', 0.05, 0.4);
        }
      }
    },
    onLand(pl, p) {
      if (pl.crT !== -1) return 'pass';
      pl.crT = CRUMBLE_T;
      spray(p.x, pl.y + 2, 6, '#c9bdf2', 90, -90, 10, 0.4, 3, 600);
      beep(200, 0.08, 'square', 0.05, 0.5);
      return undefined;
    },
    draw(c, pl) {
      const shaking = pl.crT > 0;
      const ox = shaking ? (Math.random() - 0.5) * 4 : 0;
      const x = pl.x + ox, y = pl.y, w = pl.w;
      if (pl.falling) {
        const sep = Math.min(14, (pl.y - pl.fy0) * 0.12);
        c.globalAlpha = Math.max(0.2, 1 - (pl.y - pl.fy0) / 300);
        c.fillStyle = '#9a8cc0';
        fillRR(c, x - sep, y + sep * 0.3, w / 2 - 1, 11, 4);
        fillRR(c, x + w / 2 + 1 + sep, y - sep * 0.2, w / 2 - 1, 11, 4);
        c.globalAlpha = 1;
        return;
      }
      c.fillStyle = '#6b5e94';
      fillRR(c, x, y + 3, w, 10, 5);
      c.fillStyle = '#9a8cc0';
      fillRR(c, x, y, w, 9, 4);
      c.strokeStyle = '#4e4275';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x + 3, y + 6); c.lineTo(x + w - 3, y + 6);
      c.moveTo(x + w * 0.3, y + 1); c.lineTo(x + w * 0.3, y + 6);
      c.moveTo(x + w * 0.65, y + 1); c.lineTo(x + w * 0.65, y + 6);
      c.moveTo(x + w * 0.48, y + 6); c.lineTo(x + w * 0.48, y + 11);
      if (pl.crT >= 0) { // cracked
        c.moveTo(x + w * 0.38, y); c.lineTo(x + w * 0.45, y + 5); c.lineTo(x + w * 0.4, y + 8); c.lineTo(x + w * 0.5, y + 12);
        c.moveTo(x + w * 0.75, y + 1); c.lineTo(x + w * 0.7, y + 7); c.lineTo(x + w * 0.8, y + 11);
      }
      c.stroke();
    }
  };

  // ------------------------------------------------------------------
  // BUBBLE - floats, pops with a little boost
  // ------------------------------------------------------------------
  function bubblePos(pl) {
    pl.x = clamp(pl.x0 + Math.sin(pl.ph) * 16, 0, Math.max(0, vw() - pl.w));
    pl.y = pl.y0 + Math.sin(pl.ph * 0.7) * 7;
  }
  T.bubble = {
    color: '#8ff0ff', noItems: true,
    w: 62,
    weight: weight('bubble', d => (d < 0.05 ? 0 : 0.02 + 0.03 * d)),
    init(pl) { pl.x0 = pl.x; pl.y0 = pl.y; pl.ph = Math.random() * TAU; pl.popped = 0; bubblePos(pl); },
    update(pl, dt) {
      if (pl.popped > 0) { pl.popped += dt * 4; if (pl.popped >= 1) pl.dead = true; return; }
      pl.ph += dt * 1.6;
      bubblePos(pl);
    },
    onLand(pl, p) {
      if (pl.popped > 0) return 'pass';
      pl.popped = 0.001;
      ring(pl.x + pl.w / 2, pl.y + 5, 14, '#bff8ff', 160, 0.4, 3);
      beep(1100, 0.05, 'sine', 0.07, 2.2);
      later(30, 520, 0.08, 'triangle', 0.04, 0.5);
      return BB.JUMP * 1.15;
    },
    draw(c, pl) {
      const x = pl.x, y = pl.y, w = pl.w;
      const pop = pl.popped;
      if (pop > 0) {
        c.globalAlpha = Math.max(0, 1 - pop);
        c.strokeStyle = '#bff8ff';
        c.lineWidth = 2;
        pathRR(c, x - pop * 12, y - 3 - pop * 6, w + pop * 24, 16 + pop * 12, 8 + pop * 6);
        c.stroke();
        c.globalAlpha = 1;
        return;
      }
      c.globalAlpha = 0.22;
      c.fillStyle = '#8ff0ff';
      fillRR(c, x, y - 3, w, 16, 8);
      c.globalAlpha = 1;
      c.strokeStyle = '#8ff0ff';
      c.lineWidth = 2;
      pathRR(c, x, y - 3, w, 16, 8);
      c.stroke();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 2;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x + 7, y + 6); c.quadraticCurveTo(x + 7, y, x + 14, y);
      c.stroke();
      c.lineCap = 'butt';
      c.fillStyle = '#ffffff';
      dot(c, x + w - 11, y + 1, 1.8);
    }
  };

  // ------------------------------------------------------------------
  // SWING - plank on two ropes, swings side to side
  // ------------------------------------------------------------------
  function swingPos(pl) {
    const s = Math.sin(pl.ph);
    const th = pl.amp * s;
    pl.x = pl.ax + pl.L * Math.sin(th) - pl.w / 2;
    pl.y = pl.ay + pl.L * Math.cos(th);
    pl.vxs = pl.L * Math.cos(th) * pl.amp * Math.cos(pl.ph) * pl.om; // sideways speed, px/s
  }
  T.swing = {
    color: '#ff8a3d', noItems: true,
    w: 62,
    weight: weight('swing', d => (d < 0.22 ? 0 : 0.02 + 0.05 * d)),
    init(pl, G, d) {
      pl.L = 52;
      pl.amp = 0.6 + 0.25 * d;
      pl.om = 1.7 + 0.5 * d;
      pl.ph = Math.random() * TAU;
      const reach = pl.L * Math.sin(pl.amp) + pl.w / 2 + 2;
      const W = vw();
      pl.ax = reach * 2 < W ? clamp(pl.x + pl.w / 2, reach, W - reach) : W / 2;
      pl.ay = pl.y - pl.L;
      swingPos(pl);
    },
    update(pl, dt) {
      if (pl.falling) return;
      pl.ph += pl.om * dt;
      swingPos(pl);
    },
    onLand(pl, p) {
      p.vx += pl.vxs * 0.5; // the swing flings you a bit
      beep(330, 0.08, 'triangle', 0.05, 1.5);
      later(70, 240, 0.12, 'triangle', 0.03, 0.8);
      spray(p.x, pl.y, 5, '#ffb37a', 90, -120, 0, 0.35, 3, 400);
      return undefined;
    },
    draw(c, pl) {
      const x = pl.x, y = pl.y, w = pl.w;
      c.strokeStyle = '#d9ccff';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(pl.ax, pl.ay); c.lineTo(x + 6, y + 3);
      c.moveTo(pl.ax, pl.ay); c.lineTo(x + w - 6, y + 3);
      c.stroke();
      c.fillStyle = '#a99bd6';
      dot(c, pl.ax, pl.ay, 5);
      c.fillStyle = '#140b2e';
      dot(c, pl.ax, pl.ay, 2);
      c.fillStyle = '#b5521a';
      fillRR(c, x, y + 3, w, 10, 5);
      c.fillStyle = '#ff8a3d';
      fillRR(c, x, y, w, 8, 4);
      c.strokeStyle = '#b5521a';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x + w * 0.34, y + 1); c.lineTo(x + w * 0.34, y + 8);
      c.moveTo(x + w * 0.67, y + 1); c.lineTo(x + w * 0.67, y + 8);
      c.stroke();
      c.fillStyle = '#ffd9a8';
      dot(c, x + 6, y + 3, 2);
      dot(c, x + w - 6, y + 3, 2);
    }
  };

  // ------------------------------------------------------------------
  // SPIKES - hazard; a shield (or any invincibility) smashes them
  // ------------------------------------------------------------------
  T.spikes = {
    color: '#ff3d6e', noItems: true,
    w: d => Math.max(48, 66 - 16 * d),
    weight: weight('spikes', d => (d < 0.25 ? 0 : 0.015 + 0.045 * d)),
    init(pl) { pl.smashed = false; },
    onLand(pl, p, G) {
      if (pl.smashed) return undefined;
      const cx = pl.x + pl.w / 2;
      if (BB.isInvincible() || p.grace > 0) {
        pl.smashed = true;
        for (let i = 0; i < 14; i++) part(cx + rnd(-pl.w / 2, pl.w / 2), pl.y - 2, rnd(-200, 200), rnd(-300, -60), 0.6, i % 2 ? '#ff3d6e' : '#fff7e8', 4, 900);
        beep(140, 0.2, 'square', 0.07, 0.4);
        BB.shake(6);
        BB.floatText('SMASH!', cx, pl.y - 24, '#ff3d6e');
        return undefined;
      }
      fxOf(G).spikeHit = true; // kill after physics (in 'update'), see below
      for (let i = 0; i < 16; i++) part(p.x + rnd(-8, 8), pl.y - 2, rnd(-180, 180), rnd(-260, -40), 0.6, i % 2 ? '#ff3d6e' : '#ff4fa3', 5, 900);
      BB.shake(12);
      BB.flash('#ff3d6e', 0.3);
      beep(220, 0.3, 'sawtooth', 0.09, 0.3);
      buzz(60);
      return BB.JUMP * 0.45;
    },
    draw(c, pl, G) {
      const x = pl.x, y = pl.y, w = pl.w;
      if (!pl.smashed) {
        const n = Math.max(3, Math.floor((w - 4) / 10)), sw = (w - 4) / n;
        c.fillStyle = '#ff3d6e';
        c.beginPath();
        for (let i = 0; i < n; i++) {
          const sx = x + 2 + i * sw;
          c.moveTo(sx, y + 4); c.lineTo(sx + sw / 2, y - 8); c.lineTo(sx + sw, y + 4);
        }
        c.fill();
        c.fillStyle = '#ffd1dd';
        c.beginPath();
        for (let i = 0; i < n; i++) {
          const tx = x + 2 + (i + 0.5) * sw;
          c.moveTo(tx - 1.5, y - 4); c.lineTo(tx, y - 8); c.lineTo(tx + 1.5, y - 4);
        }
        c.fill();
        c.globalAlpha = 0.25 + 0.2 * Math.sin(G.t * 6 + x);
        c.fillStyle = '#ff3d6e';
        fillRR(c, x - 3, y + 10, w + 6, 4, 2);
        c.globalAlpha = 1;
      } else {
        c.fillStyle = '#7a3a5a';
        const n = Math.max(3, Math.floor((w - 4) / 10)), sw = (w - 4) / n;
        for (let i = 0; i < n; i++) fillRR(c, x + 2 + i * sw + sw * 0.25, y, sw * 0.5, 4, 1);
      }
      c.fillStyle = '#3b2257';
      fillRR(c, x, y + 2, w, 10, 5);
      c.fillStyle = '#5a3380';
      fillRR(c, x + 2, y + 3, w - 4, 3, 2);
    }
  };

  // ------------------------------------------------------------------
  // FAN - normal bounce plus a floaty updraft in the column above it
  // ------------------------------------------------------------------
  const FAN_H = 170, FAN_ACC = 1150, FAN_CAP = -520;
  T.fan = {
    color: '#8fd8ff', solid: true,
    w: 66,
    weight: weight('fan', d => (d < 0.06 ? 0 : 0.015 + 0.03 * d)),
    init(pl) { pl.spin = Math.random() * TAU; pl.blow = 0; },
    update(pl, dt, G) {
      pl.spin += dt * 16;
      if (pl.falling || !G || G.dead) return;
      const p = G.p;
      const dy = pl.y - (p.y + p.r);
      if (dy > -4 && dy < FAN_H && Math.abs(BB.wrapDx(p.x - (pl.x + pl.w / 2))) < pl.w / 2 + 8 &&
          !BB.effectFlag('noLand')) {
        const k = 1 - Math.max(0, dy) / FAN_H; // stronger near the fan
        if (p.vy > FAN_CAP) p.vy = Math.max(FAN_CAP, p.vy - FAN_ACC * (0.45 + 0.55 * k) * dt);
        if (pl.blow < 0.05) beep(700, 0.18, 'sine', 0.025, 1.6);
        pl.blow = Math.min(1, pl.blow + dt * 5);
        if (Math.random() < 0.25) part(p.x + rnd(-12, 12), p.y + p.r, rnd(-20, 20), -160, 0.3, '#cfeaff', 3, 0);
      } else if (pl.blow > 0) pl.blow = Math.max(0, pl.blow - dt * 2);
    },
    onLand(pl, p) {
      spray(p.x, pl.y, 6, '#cfeaff', 110, -160, -20, 0.4, 3, 200);
      return undefined;
    },
    draw(c, pl, G) {
      const x = pl.x, y = pl.y, w = pl.w, cx = x + w / 2;
      // wind streaks rising out of it
      c.strokeStyle = '#cfeaff';
      c.lineWidth = 2.5;
      c.lineCap = 'round';
      const amp = 0.5 + 0.4 * pl.blow;
      for (let i = 0; i < 4; i++) {
        const u = (G.t * 1.7 + i * 0.27) % 1;
        const sx = x + w * (0.2 + 0.2 * i);
        const sy = y - 6 - u * 110;
        const wig = Math.sin(G.t * 5 + i * 1.7) * 3;
        c.globalAlpha = amp * (1 - u) * Math.min(1, u * 6);
        c.beginPath();
        c.moveTo(sx, sy); c.quadraticCurveTo(sx + wig, sy - 9, sx, sy - 18);
        c.stroke();
      }
      c.globalAlpha = 1;
      c.lineCap = 'butt';
      c.fillStyle = '#2d4377';
      fillRR(c, x, y, w, 12, 6);
      c.fillStyle = '#8fd8ff';
      fillRR(c, x + 3, y + 1, w - 6, 3, 1.5);
      // spinning blades, seen from the side
      const bw = 18 * Math.abs(Math.cos(pl.spin)) + 3;
      c.fillStyle = '#cfeaff';
      c.beginPath();
      c.ellipse(cx - bw / 2 - 1.5, y + 7.5, bw / 2, 3, 0, 0, TAU);
      c.ellipse(cx + bw / 2 + 1.5, y + 7.5, bw / 2, 3, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#ffcf3f';
      dot(c, cx, y + 7.5, 3);
      c.fillStyle = '#5e7fc2';
      fillRR(c, x + 3, y + 6, 6, 3, 1.5);
      fillRR(c, x + w - 9, y + 6, 6, 3, 1.5);
    }
  };

  // ------------------------------------------------------------------
  // MYSTERY - "?" block: every outcome is at least a normal bounce
  // ------------------------------------------------------------------
  const CONFETTI = ['#ff4fa3', '#ffcf3f', '#3ff0c0', '#8fd8ff', '#c56bff'];
  T.mystery = {
    color: '#ff4fa3', solid: true,
    w: 60,
    weight: weight('mystery', d => (d < 0.03 ? 0 : 0.014 + 0.012 * d)),
    init(pl) { pl.opened = false; pl.pop = 0; pl.seed = Math.random() * 6; },
    update(pl, dt) { if (pl.pop > 0) pl.pop = Math.max(0, pl.pop - dt * 2.5); },
    onLand(pl, p, G) {
      if (pl.opened) return undefined;
      pl.opened = true;
      pl.pop = 1;
      const cx = pl.x + pl.w / 2;
      for (let i = 0; i < 18; i++) {
        part(cx + rnd(-pl.w / 2, pl.w / 2), pl.y - 4, rnd(-180, 180), rnd(-360, -120), 0.9, CONFETTI[i % 5], 5, 700);
      }
      beep(660, 0.08, 'square', 0.04, 1.5);
      const roll = Math.random();
      if (roll < 0.4) {
        const got = BB.addCoins(3, cx, pl.y - 30);
        later(80, 988, 0.07, 'square', 0.04);
        later(150, 1318, 0.12, 'square', 0.04);
        toast('SURPRISE COINS! +' + (got || 3), '#ffcf3f');
      } else if (roll < 0.7) {
        later(60, 200, 0.4, 'sine', 0.08, 4);
        toast('SUPER JUMP!', '#ff4fa3');
        BB.shake(4);
        return BB.JUMP * 1.6;
      } else if (roll < 0.94) {
        const pts = Math.round(BB.addScore(150) || 150);
        BB.floatText('+' + pts, cx, pl.y - 30, '#3ff0c0');
        later(80, 880, 0.15, 'triangle', 0.05, 1.5);
        toast('BONUS POINTS!', '#3ff0c0');
      } else {
        const got = BB.addCoins(10, cx, pl.y - 30);
        BB.flash('#ffcf3f', 0.3);
        later(70, 988, 0.07, 'square', 0.05);
        later(140, 1318, 0.07, 'square', 0.05);
        later(210, 1760, 0.2, 'square', 0.05);
        buzz([20, 40, 20]);
        toast('JACKPOT! +' + (got || 10), '#ffcf3f');
      }
      BB.emit('platforms:mystery', pl, G);
      return undefined;
    },
    draw(c, pl, G) {
      const x = pl.x, w = pl.w, cx = x + w / 2;
      const y = pl.y - Math.sin(pl.pop * Math.PI) * 6; // bumps up when hit
      const open = pl.opened;
      c.fillStyle = open ? '#3d2760' : '#a3175f';
      fillRR(c, x, y, w, 17, 5);
      c.fillStyle = open ? '#6a4c98' : '#ff4fa3';
      fillRR(c, x, y, w, 13, 5);
      c.fillStyle = open ? '#4a2f6e' : '#ffd1e8';
      dot(c, x + 5, y + 4, 1.6);
      dot(c, x + w - 5, y + 4, 1.6);
      dot(c, x + 5, y + 10, 1.6);
      dot(c, x + w - 5, y + 10, 1.6);
      if (open) return;
      // vector "?" (fonts may not be loaded)
      const qy = y + 1 + Math.sin(G.t * 5 + pl.seed) * 1;
      c.lineCap = 'round';
      c.lineWidth = 2.6;
      for (let pass = 0; pass < 2; pass++) {
        const o = pass ? 0 : 1.2;
        c.strokeStyle = pass ? '#ffcf3f' : '#6a0f3f';
        c.beginPath();
        c.arc(cx + o, qy + 4 + o, 3.2, Math.PI * 1.05, Math.PI * 2.3);
        c.lineTo(cx + o, qy + 8.6 + o);
        c.stroke();
        c.fillStyle = c.strokeStyle;
        dot(c, cx + o, qy + 11.6 + o, 1.5);
      }
      c.lineCap = 'butt';
      const s = 3.5 * Math.sin(G.t * 3 + pl.seed);
      if (s > 0.4) { c.fillStyle = '#ffffff'; star(c, x + w - 9, y - 4, s); }
    }
  };

  // ------------------------------------------------------------------
  // First-meeting name tags (persisted under BB.save.platforms)
  // ------------------------------------------------------------------
  const TIPS = {
    cloud: ['ONE BOUNCE', '#f4efff'],
    trampoline: ['SUPER BOUNCE', '#ff4fa3'],
    blink: ['BLINKS OUT', '#6ea8ff'],
    conveyor: ['PUSHES YOU', '#ffcf3f'],
    slime: ['STICKY GOO', '#7cff4f'],
    golden: ['+5 COINS', '#ffcf3f'],
    elevator: ['GOING UP', '#b8a6ff'],
    teleporter: ['WARP UP', '#ff4fa3'],
    rocket: ['BLAST OFF', '#ff8a3d'],
    crumble: ['CRUMBLES', '#c9bdf2'],
    bubble: ['POPS', '#8ff0ff'],
    swing: ['SWINGS', '#ff8a3d'],
    spikes: ['OUCH! AVOID', '#ff3d6e'],
    fan: ['FLOATY WIND', '#8fd8ff'],
    mystery: ['SURPRISE!', '#ff4fa3']
  };
  const TIP_SHOWS = 2;
  const TIP_FONT = '900 11px Nunito, system-ui, sans-serif';
  let tipW = {};
  try {
    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', function () { tipW = {}; });
    }
  } catch (e) { /* no font events */ }

  function seenStore() {
    try {
      const s = BB.save;
      if (!s) return null;
      let S = s.platforms;
      if (!S || typeof S !== 'object') S = s.platforms = {};
      if (!S.seen || typeof S.seen !== 'object') S.seen = {};
      return S.seen;
    } catch (e) { return null; }
  }
  function maybeTip(pl, G) {
    if (!G || G.demo || pl.exit || !TIPS[pl.type]) return;
    const tipped = G.platformsTipped || (G.platformsTipped = {});
    if (tipped[pl.type]) return;
    const seen = seenStore();
    if (!seen) return;
    const n = +seen[pl.type] || 0;
    if (n >= TIP_SHOWS) return;
    tipped[pl.type] = true;
    seen[pl.type] = n + 1;
    pl.tip = 1;
    try { BB.store(); } catch (e) { /* storage blocked */ }
  }
  function drawTip(c, pl, G) {
    const tip = TIPS[pl.type];
    if (!tip) { pl.tip = 0; return; }
    const txt = tip[0];
    c.font = TIP_FONT;
    let tw = tipW[txt];
    if (tw == null) tw = tipW[txt] = c.measureText(txt).width;
    const bw = tw + 14, bh = 18;
    const cx = pl.x + pl.w / 2;
    const bx = clamp(cx - bw / 2, 4, vw() - bw - 4);
    const by = pl.y + 21 + Math.sin(G.t * 4) * 1.5;
    c.globalAlpha = 0.88;
    c.fillStyle = '#140b2e';
    fillRR(c, bx, by, bw, bh, 9);
    c.globalAlpha = 1;
    c.strokeStyle = tip[1];
    c.lineWidth = 2;
    pathRR(c, bx, by, bw, bh, 9);
    c.stroke();
    c.fillStyle = tip[1];
    c.beginPath();
    c.moveTo(cx - 5, by); c.lineTo(cx, by - 6); c.lineTo(cx + 5, by);
    c.fill();
    c.fillStyle = '#fff7e8';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(txt, bx + bw / 2, by + bh / 2 + 1);
  }

  // Wrap init/onLand of every type we own to add/clear name tags.
  // (core already try/catches init/onLand; a tag must never break a spawn)
  for (let i = 0; i < MINE.length; i++) {
    const t = T[MINE[i]];
    if (!t) continue;
    const init0 = t.init, land0 = t.onLand;
    t.init = function (pl, G, d) {
      if (init0) init0(pl, G, d);
      try { maybeTip(pl, G); } catch (e) { pl.tip = 0; }
    };
    t.onLand = function (pl, p, G) {
      pl.tip = 0;
      return land0 ? land0(pl, p, G) : undefined;
    };
  }

  // ------------------------------------------------------------------
  // Hooks
  // ------------------------------------------------------------------
  BB.on('newGame', function (G) {
    G.platformsFx = newFx(); // mods were just reset, so no slow to undo
    G.platformsTipped = {};
  });

  // conveyor push (before steering so the player can fight it)
  BB.on('preUpdate', function (dt, G) {
    const f = G.platformsFx;
    if (!f || !(f.pushT > 0)) return;
    const p = G.p, k = f.pushT / PUSH_T;
    p.vx += f.pushDir * PUSH_ACC * f.pushK * k * dt;
    f.pushT -= dt;
    if (Math.random() < 0.5) {
      part(p.x - f.pushDir * p.r, p.y + rnd(-8, 8), -f.pushDir * 90, 0, 0.25, '#ffcf3f', 3, 0);
    }
  });

  BB.on('update', function (dt, G) {
    const f = G.platformsFx;
    if (!f) return;
    if (f.slowOn) {
      f.slowT -= dt;
      if (f.slowT <= 0) { BB.mods.steerMult /= SLIME_STEER; f.slowOn = false; f.slowT = 0; }
    }
    if (f.rocketT > 0) {
      f.rocketT -= dt;
      const p = G.p;
      if (p.vy < -150) {
        for (let i = 0; i < 2; i++) {
          part(p.x + rnd(-6, 6), p.y + p.r, rnd(-50, 50), rnd(160, 300), 0.35, FLAME[(Math.random() * 3) | 0], 5, -100);
        }
      }
    }
    if (f.spikeHit) {
      f.spikeHit = false;
      BB.kill('spikes'); // last thing we do this frame; may end the run
    }
  });

  // goo on the ball while slowed, flame under it while rocketing
  BB.on('drawPlayer', function (c, p, G) {
    const f = G && G.platformsFx;
    if (!f) return;
    if (f.slowOn) {
      c.globalAlpha = Math.min(1, f.slowT * 2.5);
      c.fillStyle = '#4ccf2f';
      dot(c, -8, p.r - 4, 4.5);
      dot(c, 2, p.r - 2, 5.5);
      dot(c, 10, p.r - 5, 3.5);
      fillRR(c, 0, p.r - 2, 4, 9 + Math.sin(G.t * 6) * 2, 2);
      c.fillStyle = '#9dff6e';
      dot(c, -9, p.r - 6, 1.6);
      c.globalAlpha = 1;
    }
    if (f.rocketT > 0 && p.vy < -150) {
      const fl = 14 + Math.sin(G.t * 40) * 5;
      c.fillStyle = '#ff8a3d';
      c.beginPath();
      c.moveTo(-8, p.r - 3); c.lineTo(8, p.r - 3); c.lineTo(0, p.r + fl);
      c.fill();
      c.fillStyle = '#ffcf3f';
      c.beginPath();
      c.moveTo(-4, p.r - 2); c.lineTo(4, p.r - 2); c.lineTo(0, p.r + fl * 0.55);
      c.fill();
    }
  });

  // name tags
  BB.on('drawWorld', function (c, G) {
    if (G.demo) return;
    const plats = G.plats, top = G.cam - 40, bot = G.cam + BB.H + 20;
    let any = false;
    for (let i = 0; i < plats.length; i++) {
      const pl = plats[i];
      if (!pl.tip) continue;
      if (pl.dead || pl.falling || pl.used || pl.popped > 0 || G.p.y < pl.y - 260) { pl.tip = 0; continue; }
      if (pl.y < top || pl.y > bot) continue;
      drawTip(c, pl, G);
      any = true;
    }
    if (any) c.globalAlpha = 1;
  });

  // keep new rows from landing on top of a teleporter exit pad
  BB.on('spawnRow', function (rowY, G) {
    const plats = G.plats;
    for (let i = 0; i < plats.length; i++) {
      const e = plats[i];
      if (e.type !== 'teleporter' || !e.exit || e.dead || Math.abs(e.y - rowY) > 70) continue;
      for (let j = 0; j < plats.length; j++) {
        const q = plats[j];
        if (q === e || q.dead || q.age > 0 || q.exit || q.y < rowY - 32 || q.y > rowY + 26) continue;
        if (overlaps(q, e)) dodge(q, e, G);
      }
    }
  });

  // ------------------------------------------------------------------
  // Debug helpers
  // ------------------------------------------------------------------
  const dbg = BB.debug || (BB.debug = {});
  dbg.platformsOnly = null;
  dbg.platformsTypes = MINE.slice();
  // One of each new type stacked above the player. Returns the names spawned.
  dbg.platformsShowcase = function (gap) {
    const G = BB.G;
    if (!G || G.dead) return [];
    gap = gap || 100;
    const out = [], W = vw(), d = BB.difficulty();
    for (let i = 0; i < MINE.length; i++) {
      const t = T[MINE[i]];
      if (!t) continue;
      const w = typeof t.w === 'function' ? t.w(d, G) : (t.w || 70);
      const x = (i % 2 ? 0.72 : 0.12) * Math.max(0, W - w);
      if (BB.spawnPlatform(MINE[i], x, G.p.y - 90 - i * gap, w)) out.push(MINE[i]);
    }
    return out;
  };
})(window.BB);
