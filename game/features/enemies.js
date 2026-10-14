/* =====================================================================
   features/enemies.js - NEW ENEMIES + BOSS FIGHTS
   Owner: the "enemies" agent. Edit only this file.

   Random enemies (absolute per-row weights, gated by minHeight):
     slime      Jelly Slime  - hops between platforms; stomp it for a BIG bounce
     spikeball  Spike Ball   - NOT stompable, dodge it
     ufo        UFO          - hovers side to side, drops slow 'laser' blobs
     ghost      Ghost        - fades in and out; only harmful (and stompable) while visible
     blackhole  Black Hole   - pulls you in; the centre is deadly; can't be stomped
     missile    Missile      - rare; "!" warning at the bottom edge, then it shoots up
   Projectiles (never spawn randomly): laser, minibat, ink

   Bosses (every 2500 height, rotating): kingbat 'KING BAT', megaufo 'MEGA UFO',
   squid 'SPACE SQUID'. Warning banner + rumble, the boss hovers near the top of
   the screen, attacks with telegraphed patterns, then dives / sinks low and gets
   dizzy - that is the moment to stomp it. 3-5 stomps to win. Defeat = explosion,
   coin shower, +500 score, toast, G.stats.bossesDefeated++.

   For other features:
     events  'enemies:bossWarn'(type, G)  'enemies:bossStart'(type, G)
             'enemies:bossHit'(boss, G)   'enemies:bossDefeated'(type, G)
     BB.enemies.bossActive() / .boss() / .startBoss(type?, instant?)
     BB.enemyTypes[name].label  - a friendly name ('Spike Ball')
     BB.save.enemies.bosses     - lifetime bosses defeated
   Debug: BB.debug.boss(type?), BB.debug.bossNow(type?), BB.debug.bossHit()

   Screen-anchored entities (bosses and boss projectiles) carry e.scr = true and
   live in screen coordinates e.sx / e.sy (e.y = G.cam + e.sy), so they keep the
   same on-screen speed however fast the player climbs.
   ===================================================================== */
(function (BB) {
  'use strict';
  if (!BB || !BB.enemyTypes) return;

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
  function beep(f, d, type, v, slide) { if (BB.beep) BB.beep(f, d, type, v, slide); }

  const F_WARN = '34px Bungee, Impact, sans-serif';
  const F_SUB = '900 17px Nunito, system-ui, sans-serif';
  const F_NAME = '15px Bungee, Impact, sans-serif';
  const F_HINT = '14px Bungee, Impact, sans-serif';
  const F_BANG = '22px Bungee, Impact, sans-serif';
  const DASH = [5, 7], NODASH = [];

  const PROJ = { laser: 1, minibat: 1, ink: 1 };
  const BOSS = { kingbat: 1, megaufo: 1, squid: 1 };
  const MINE = { slime: 1, spikeball: 1, ufo: 1, ghost: 1, blackhole: 1, missile: 1, laser: 1, minibat: 1, ink: 1 };
  const PROJ_CAP = 16;

  const BOSS_EVERY = 2500;
  const BOSS_ORDER = ['kingbat', 'megaufo', 'squid'];
  const WARN_T = 2.6;
  const BEAM_WARN = 0.85, BEAM_T = 0.95, BEAM_HW = 15;
  // top / half = how far the art reaches above / beside the centre (layout only)
  const INFO = {
    kingbat: { name: 'KING BAT', label: 'King Bat', coming: 'KING BAT IS COMING!', color: '#ff4fa3', r: 40, top: 50, half: 86,
      plan0: ['swarm', 'dive'], plan1: ['swarm', 'dive', 'swarm', 'swarm', 'dive'] },
    megaufo: { name: 'MEGA UFO', label: 'Mega UFO', coming: 'MEGA UFO IS COMING!', color: '#3ff0c0', r: 44, top: 48, half: 56,
      plan0: ['rain', 'beam'], plan1: ['rain', 'beam', 'rain', 'rain', 'beam'] },
    squid: { name: 'SPACE SQUID', label: 'Space Squid', coming: 'SPACE SQUID IS COMING!', color: '#b07cff', r: 42, top: 60, half: 52,
      plan0: ['ink', 'dive'], plan1: ['ink', 'dive', 'ink', 'ink', 'dive'] }
  };

  // =====================================================================
  // Shared helpers
  // =====================================================================
  function live(G) { return !!(G && !G.dead && !G.demo); }
  function onScreen(G, y, m) { return y > G.cam - m && y < G.cam + BB.H + m; }

  // Effects that let the player pass through harm. Core already treats any
  // effect flagged `invincible` as "stomp everything"; these are the softer
  // pass-through kinds other features might add.
  const PASS_FLAGS = ['intangible', 'ghost', 'passThrough', 'phase'];
  const PASS_NAMES = ['star', 'superstar', 'ghostmode', 'ghost', 'phase', 'invisible', 'intangible'];
  function untouchable(G) {
    if (BB.isInvincible && BB.isInvincible()) return true;
    if (BB.effectFlag) for (let i = 0; i < PASS_FLAGS.length; i++) if (BB.effectFlag(PASS_FLAGS[i])) return true;
    const fx = G && G.p && G.p.effects;
    if (fx) for (let i = 0; i < PASS_NAMES.length; i++) if (fx[PASS_NAMES[i]] > 0) return true;
    return false;
  }
  // Damage from something that is not a plain circle contact (the MEGA UFO beam).
  function hurt(G, killer) {
    if (!live(G) || G.p.grace > 0 || untouchable(G)) return false;
    G.killer = killer;
    return BB.kill('enemy');
  }

  function countProj(G) {
    let n = 0;
    const ens = G.enemies;
    for (let i = 0; i < ens.length; i++) { const e = ens[i]; if (PROJ[e.type] && !e.remove && !e.dead) n++; }
    return n;
  }
  function hasType(G, type) {
    const ens = G.enemies;
    for (let i = 0; i < ens.length; i++) { const e = ens[i]; if (e.type === type && !e.remove && !e.dead) return true; }
    return false;
  }
  function nearType(G, type, y, dist) {
    const ens = G.enemies;
    for (let i = 0; i < ens.length; i++) {
      const e = ens[i];
      if (e.type === type && !e.remove && !e.dead && Math.abs(e.y - y) < dist) return true;
    }
    return false;
  }

  // One check per row: no new enemy of ours right next to another one, none during a boss.
  let crowdG = null, crowdY = NaN, crowdOk = true;
  function roomFor(G) {
    if (!G || G.demo || G.enemiesBoss || G.enemiesWarn > 0) return false;
    if (G === crowdG && G.topY === crowdY) return crowdOk;
    crowdG = G; crowdY = G.topY;
    const y = G.topY - 40, ens = G.enemies;
    let ok = true;
    for (let i = 0; i < ens.length; i++) {
      const e = ens[i];
      if (e.dead || e.remove || PROJ[e.type] || e.type === 'missile') continue;
      if (Math.abs(e.y - y) < 190) { ok = false; break; }
    }
    crowdOk = ok;
    return ok;
  }

  // Pick an x for a hazard that keeps `clear` px of air between it and any
  // platform in its band, so you never bounce straight up into it.
  function safeX(G, x0, y, clear, edge) {
    const W = BB.W, plats = G.plats;
    const lo = edge, hi = Math.max(edge, W - edge);
    let bestX = clamp(x0, lo, hi), bestS = -1;
    for (let k = 0; k < 12; k++) {
      const x = k === 0 ? bestX : rand(lo, hi);
      let s = 1e9;
      for (let i = 0; i < plats.length; i++) {
        const pl = plats[i];
        if (pl.dead || pl.y < y - 110 || pl.y > y + 130) continue;
        const gap = x < pl.x ? pl.x - x : x > pl.x + pl.w ? x - pl.x - pl.w : 0;
        if (gap < s) s = gap;
      }
      if (s > bestS) { bestS = s; bestX = x; }
      if (s >= clear) break;
    }
    return bestX;
  }
  // Slide a freshly spawned platform sideways out of a hazard's column.
  function clearPlat(pl, e, W) {
    if (pl.dead || pl.y < e.y - 110 || pl.y > e.y + 130) return;
    const m = e.clear;
    if (pl.x + pl.w < e.x - m || pl.x > e.x + m) return;
    const leftX = e.x - m - pl.w, rightX = e.x + m;
    const canL = leftX >= 0, canR = rightX + pl.w <= W;
    if (canL && canR) pl.x = Math.random() < 0.5 ? rand(0, leftX) : rand(rightX, W - pl.w);
    else if (canL) pl.x = rand(0, leftX);
    else if (canR) pl.x = rand(rightX, W - pl.w);
  }
  function nearestPlat(G, x, y, maxDy) {
    const plats = G.plats;
    let best = null, bestS = 1e9;
    for (let i = 0; i < plats.length; i++) {
      const pl = plats[i];
      if (pl.dead || pl.falling) continue;
      const dy = Math.abs(pl.y - y);
      if (dy > maxDy) continue;
      const s = dy + Math.abs(pl.x + pl.w / 2 - x) * 0.3;
      if (s < bestS) { bestS = s; best = pl; }
    }
    return best;
  }

  // Puff an enemy away (arena clearing, revive mercy, boss shots on defeat).
  function poof(G, e) {
    if (onScreen(G, e.y, 40)) BB.burst(e.x, e.y, '#fff7e8', 6, 140);
    e.remove = true;
  }

  // Screen-space projectile spawn (boss attacks).
  function spawnShot(G, type, sx, sy, vx, vy) {
    if (countProj(G) >= PROJ_CAP) return null;
    const e = BB.spawnEnemy(type, sx, G.cam + sy);
    if (e) { e.scr = true; e.sx = sx; e.sy = sy; e.vx = vx; e.vy = vy; }
    return e;
  }
  function projMove(e, dt, G) {
    if (e.scr) {
      e.sx += e.vx * dt; e.sy += e.vy * dt;
      e.x = e.sx; e.y = G.cam + e.sy;
      if (e.sy > BB.H + 50 || e.sy < -160 || e.sx < -50 || e.sx > BB.W + 50) e.remove = true;
    } else {
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.x < -50 || e.x > BB.W + 50 || e.y < G.cam - 400) e.remove = true;
    }
  }

  // Local drawing space for an enemy. Defeated enemies tumble while they fall.
  function local(c, e, G) {
    if (e.dead) { c.save(); c.translate(e.x, e.y); c.rotate(G.t * 9); c.globalAlpha = 0.85; return true; }
    c.translate(e.x, e.y);
    return false;
  }
  function unlocal(c, e, saved) {
    if (saved) c.restore(); else c.translate(-e.x, -e.y);
    c.globalAlpha = 1;
  }

  // Two eyes looking at the player.
  function eyes(c, e, G, x, y, gap, er, pupilCol) {
    const p = G.p;
    let dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    dx = dx / d * er * 0.4; dy = dy / d * er * 0.4;
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(x - gap + er, y); c.arc(x - gap, y, er, 0, TAU);
    c.moveTo(x + gap + er, y); c.arc(x + gap, y, er, 0, TAU);
    c.fill();
    const pr = er * 0.52;
    c.fillStyle = pupilCol || '#140b2e';
    c.beginPath();
    c.moveTo(x - gap + dx + pr, y + dy); c.arc(x - gap + dx, y + dy, pr, 0, TAU);
    c.moveTo(x + gap + dx + pr, y + dy); c.arc(x + gap + dx, y + dy, pr, 0, TAU);
    c.fill();
  }
  function brows(c, x, y, gap, er, lw) {
    c.strokeStyle = '#140b2e';
    c.lineWidth = lw;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x - gap - er, y - er - 2); c.lineTo(x - gap + er * 0.8, y - er + 3);
    c.moveTo(x + gap + er, y - er - 2); c.lineTo(x + gap - er * 0.8, y - er + 3);
    c.stroke();
    c.lineCap = 'butt';
    c.lineWidth = 1;
  }
  function xEyes(c, x, y, gap, s) {
    c.strokeStyle = '#140b2e';
    c.lineWidth = 3.5;
    c.lineCap = 'round';
    c.beginPath();
    for (let k = -1; k <= 1; k += 2) {
      const ex = x + k * gap;
      c.moveTo(ex - s, y - s); c.lineTo(ex + s, y + s);
      c.moveTo(ex + s, y - s); c.lineTo(ex - s, y + s);
    }
    c.stroke();
    c.lineCap = 'butt';
    c.lineWidth = 1;
  }
  function star(c, x, y, s) {
    c.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 ? s * 0.45 : s, a = -Math.PI / 2 + k * Math.PI / 5;
      if (k === 0) c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath();
    c.fill();
  }

  // =====================================================================
  // Shapes (local space, origin = enemy centre)
  // =====================================================================
  // mood: 0 calm, 1 angry, 2 dizzy
  function ufoShape(c, s, t, mood) {
    c.fillStyle = '#5b4d99';
    c.beginPath(); c.ellipse(0, 5 * s, 24 * s, 8 * s, 0, 0, TAU); c.fill();
    c.fillStyle = '#c9bdf2';
    c.beginPath(); c.ellipse(0, 2 * s, 24 * s, 7 * s, 0, 0, TAU); c.fill();
    c.fillStyle = '#e9e2ff';
    c.beginPath(); c.ellipse(0, 0.5 * s, 18 * s, 3 * s, 0, 0, TAU); c.fill();
    // glass dome + alien pilot
    c.fillStyle = 'rgba(63,240,192,0.32)';
    c.beginPath(); c.arc(0, 0, 12 * s, Math.PI, TAU); c.closePath(); c.fill();
    c.fillStyle = '#9dff5c';
    circle(c, 0, -3.5 * s, 5.5 * s);
    if (mood === 2) {
      xEyes(c, 0, -4.5 * s, 0, 1.6 * s);
    } else {
      c.fillStyle = '#fff'; circle(c, 0, -4.5 * s, 2.8 * s);
      c.fillStyle = mood === 1 ? '#ff2a5a' : '#140b2e'; circle(c, 0, -4.2 * s, 1.4 * s);
      if (mood === 1) {
        c.strokeStyle = '#140b2e'; c.lineWidth = 0.9 * s; c.lineCap = 'round';
        c.beginPath(); c.moveTo(-3 * s, -8.6 * s); c.lineTo(3 * s, -7.2 * s); c.stroke();
        c.lineCap = 'butt'; c.lineWidth = 1;
      }
    }
    c.strokeStyle = '#3ff0c0';
    c.lineWidth = Math.max(1.5, 0.9 * s);
    c.beginPath(); c.arc(0, 0, 12 * s, Math.PI, TAU); c.stroke();
    c.lineWidth = 1;
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.beginPath(); c.ellipse(-5 * s, -7 * s, 1.8 * s, 3 * s, -0.5, 0, TAU); c.fill();
    const k = (t * 6) | 0;
    for (let i = 0; i < 5; i++) {
      c.fillStyle = (i + k) % 2 ? '#ffcf3f' : '#ff4fa3';
      circle(c, (-16 + i * 8) * s, 4.6 * s, 1.9 * s);
    }
  }

  function spikeShape(c, r, rot) {
    c.globalAlpha = 0.2;
    c.fillStyle = '#ff6a3d';
    circle(c, 0, 0, r + 13);
    c.globalAlpha = 1;
    c.fillStyle = '#ffe2a8';
    c.beginPath();
    const n = 10, tip = r + 9, base = r - 2, hw = 0.21;
    for (let i = 0; i < n; i++) {
      const a = rot + i * TAU / n;
      c.moveTo(Math.cos(a - hw) * base, Math.sin(a - hw) * base);
      c.lineTo(Math.cos(a) * tip, Math.sin(a) * tip);
      c.lineTo(Math.cos(a + hw) * base, Math.sin(a + hw) * base);
      c.closePath();
    }
    c.fill();
    c.fillStyle = '#ff6a3d';
    circle(c, 0, 0, r);
    c.fillStyle = '#ff9466';
    c.beginPath(); c.ellipse(-r * 0.3, -r * 0.42, r * 0.42, r * 0.26, -0.5, 0, TAU); c.fill();
  }

  function holeShape(c, e, t) {
    const R = e.R, r = e.r;
    c.fillStyle = '#8a5cff';
    c.globalAlpha = 0.07 + 0.02 * Math.sin(t * 3);
    circle(c, 0, 0, R);
    c.globalAlpha = 0.1;
    circle(c, 0, 0, R * 0.6);
    c.globalAlpha = 0.35;
    c.strokeStyle = '#a99bd6';
    c.lineWidth = 1.5;
    c.setLineDash(DASH);
    c.lineDashOffset = -t * 30;
    c.beginPath(); c.arc(0, 0, R, 0, TAU); c.stroke();
    c.setLineDash(NODASH);
    c.lineDashOffset = 0;
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.globalAlpha = 0.8;
    for (let k = 0; k < 3; k++) {
      c.strokeStyle = k === 1 ? '#ff4fa3' : '#b07cff';
      c.beginPath();
      for (let j = 0; j <= 12; j++) {
        const f = j / 12, rr = R * 0.8 * (1 - f) + (r + 4) * f;
        const a = e.ang + k * TAU / 3 + f * 2.8;
        if (j === 0) c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.stroke();
    }
    c.globalAlpha = 1;
    c.fillStyle = '#05020d';
    circle(c, 0, 0, r + 5);
    c.strokeStyle = '#ffcf3f';
    c.lineWidth = 2.5;
    c.beginPath(); c.arc(0, 0, r + 8, e.ang * 2, e.ang * 2 + 3.6); c.stroke();
    c.strokeStyle = '#ff4fa3';
    c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, r + 5, 0, TAU); c.stroke();
    c.lineWidth = 1;
    c.lineCap = 'butt';
  }

  function ghostShape(c, r, t) {
    c.fillStyle = '#e6dcff';
    c.beginPath();
    c.arc(0, -2, r, Math.PI, 0);
    const by = r * 0.95, w = (2 * r) / 4, wav = Math.sin(t * 7) * 2.5;
    c.lineTo(r, by);
    for (let i = 0; i < 4; i++) {
      c.quadraticCurveTo(r - w * (i + 0.5), by + (i % 2 ? -5 : 6) + wav, r - w * (i + 1), by);
    }
    c.closePath();
    c.fill();
    c.fillStyle = '#140b2e';
    c.beginPath();
    c.moveTo(-5.5 + 2.6, -3); c.ellipse(-5.5, -3, 2.6, 3.6, 0, 0, TAU);
    c.moveTo(5.5 + 2.6, -3); c.ellipse(5.5, -3, 2.6, 3.6, 0, 0, TAU);
    c.moveTo(2.4, 5.5); c.ellipse(0, 5.5, 2.4, 3, 0, 0, TAU);
    c.fill();
  }

  function slimeShape(c, e, G) {
    const r = e.r, sq = e.sq;
    const sx = clamp(2 - sq, 0.65, 1.45), sy = clamp(sq, 0.55, 1.45);
    const rx = r * sx, ry = r * sy, b = r;
    c.fillStyle = '#3fae3a';
    c.beginPath(); c.ellipse(0, b - ry * 0.9, rx * 1.02, ry * 0.92, 0, 0, TAU); c.fill();
    c.fillStyle = '#7cf25a';
    c.beginPath(); c.ellipse(0, b - ry * 1.02, rx, ry, 0, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath(); c.ellipse(-rx * 0.42, b - ry * 1.55, rx * 0.22, ry * 0.16, -0.6, 0, TAU); c.fill();
    const ey = b - ry * 1.08;
    eyes(c, e, G, 0, ey, 5.5 * sx, 3.6, null);
    c.strokeStyle = '#1f6b1c';
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.beginPath(); c.arc(0, ey + 4, 3.5, 0.3, Math.PI - 0.3); c.stroke();
    c.lineCap = 'butt';
    c.lineWidth = 1;
  }

  function batShape(c, r, t) {
    c.fillStyle = '#c2307d';
    const f = Math.sin(t * 22) * 6;
    c.beginPath();
    c.moveTo(-r * 0.6, -2); c.lineTo(-r - 11, -6 + f); c.lineTo(-r + 1, r * 0.55);
    c.moveTo(r * 0.6, -2); c.lineTo(r + 11, -6 + f); c.lineTo(r - 1, r * 0.55);
    c.fill();
    c.fillStyle = '#ff4fa3';
    circle(c, 0, 0, r);
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(-3.5 + 3, -2); c.arc(-3.5, -2, 3, 0, TAU);
    c.moveTo(3.5 + 3, -2); c.arc(3.5, -2, 3, 0, TAU);
    c.fill();
    c.fillStyle = '#140b2e';
    c.beginPath();
    c.moveTo(-3.5 + 1.5, -1); c.arc(-3.5, -1, 1.5, 0, TAU);
    c.moveTo(3.5 + 1.5, -1); c.arc(3.5, -1, 1.5, 0, TAU);
    c.fill();
  }

  // =====================================================================
  // Random enemies
  // =====================================================================
  BB.enemyTypes.slime = {
    label: 'Jelly Slime', r: 15, minHeight: 800, stompable: true, color: '#7cf25a',
    weight: (d, G) => (roomFor(G) ? 0.02 + 0.015 * d : 0),
    create(x, y, G) {
      const pl = nearestPlat(G, x, y + 40, 220);
      if (pl) {
        const off = rand(0.2, 0.8) * pl.w;
        return { st: 'sit', pl, off, x: pl.x + off, y: pl.y - 15, vx: 0, vy: 0, t: rand(0.9, 1.9), sq: 1 };
      }
      return { st: 'air', pl: null, off: 0, vx: 0, vy: 0, t: 1, sq: 1 };
    },
    update(e, dt, G) {
      e.sq += (1 - e.sq) * Math.min(1, dt * 9);
      if (e.st === 'sit') {
        const pl = e.pl;
        if (!pl || pl.dead || pl.falling) { e.st = 'air'; e.pl = null; e.vx = 0; e.vy = 0; return; }
        e.x = pl.x + e.off;
        e.y = pl.y - e.r;
        e.t -= dt;
        if (e.t < 0.35) e.sq = 0.68 + 0.32 * Math.max(0, e.t / 0.35); // wind-up squish
        if (e.t <= 0) slimeHop(e, G);
        return;
      }
      e.vy += 1300 * dt;
      const oldBottom = e.y + e.r;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      const W = BB.W;
      if (e.x < e.r) { e.x = e.r; e.vx = Math.abs(e.vx); }
      else if (e.x > W - e.r) { e.x = W - e.r; e.vx = -Math.abs(e.vx); }
      e.sq = clamp(1 + Math.abs(e.vy) / 2600, 1, 1.3);
      if (e.vy > 0) {
        const plats = G.plats;
        for (let i = 0; i < plats.length; i++) {
          const pl = plats[i];
          if (pl.dead || pl.falling) continue;
          if (e.x >= pl.x + 2 && e.x <= pl.x + pl.w - 2 && oldBottom <= pl.y + 3 && e.y + e.r >= pl.y) {
            e.st = 'sit'; e.pl = pl; e.off = clamp(e.x - pl.x, 4, pl.w - 4);
            e.y = pl.y - e.r; e.vx = 0; e.vy = 0; e.sq = 0.55; e.t = rand(1.0, 2.0);
            if (onScreen(G, e.y, 0)) {
              beep(180, 0.08, 'sine', 0.03, 0.6);
              BB.emitParticle(e.x - 8, pl.y, -60, -80, 0.3, '#7cf25a', 3, 500);
              BB.emitParticle(e.x + 8, pl.y, 60, -80, 0.3, '#7cf25a', 3, 500);
            }
            break;
          }
        }
      }
      if (e.y > G.cam + BB.H + 60) e.remove = true;
    },
    onStomp(e, p, G, how) {
      BB.defeatEnemy(e, { coins: 3, toast: 'SPLAT!', color: '#7cf25a' });
      BB.burst(e.x, e.y + 6, '#9dff5c', 12, 200);
      if (how === 'stomp') { BB.bounce(BB.JUMP * 1.5); beep(240, 0.3, 'sine', 0.08, 3); }
      else BB.bounce(BB.JUMP * 1.1);
      return true;
    },
    onHit(e, p, G) { return untouchable(G); },
    draw(c, e, G) {
      const s = local(c, e, G);
      slimeShape(c, e, G);
      unlocal(c, e, s);
    }
  };
  function slimeHop(e, G) {
    const cur = e.pl, plats = G.plats;
    let target = null, n = 0;
    for (let i = 0; i < plats.length; i++) {
      const pl = plats[i];
      if (pl === cur || pl.dead || pl.falling) continue;
      const dy = pl.y - cur.y;
      if (dy < -170 || dy > 50) continue;
      const dx = pl.x + pl.w / 2 - e.x;
      if (dx > 170 || dx < -170 || (dx < 24 && dx > -24)) continue;
      n++;
      if (Math.random() * n < 1) target = pl;
    }
    const T = rand(0.68, 0.82), g = 1300;
    if (target) {
      const tx = target.x + clamp(rand(0.2, 0.8) * target.w, 6, target.w - 6);
      const ty = target.y - e.r;
      e.vx = (tx - e.x) / T;
      e.vy = (ty - e.y) / T - 0.5 * g * T;
    } else {
      e.vx = rand(-30, 30);
      e.vy = -430;
    }
    e.st = 'air'; e.pl = null; e.sq = 1.35;
    if (onScreen(G, e.y, 0)) beep(300, 0.1, 'sine', 0.03, 2);
  }

  BB.enemyTypes.spikeball = {
    label: 'Spike Ball', r: 17, minHeight: 1800, stompable: false, color: '#ff6a3d',
    weight: (d, G) => (roomFor(G) ? 0.012 + 0.025 * d : 0),
    create(x, y, G) {
      const d = BB.difficulty();
      const amp = Math.random() < 0.25 + 0.45 * d ? rand(24, 54) : 0;
      const clear = 17 + 16 + amp + 14;
      const hx = safeX(G, x, y, clear, 30 + amp);
      return { hx, hy: y, x: hx, amp, clear, ph: rand(0, 6), rot: rand(0, 6), spin: (Math.random() < 0.5 ? -1 : 1) * rand(1.2, 2.2) };
    },
    update(e, dt) {
      e.ph += dt;
      e.rot += e.spin * dt;
      e.x = e.hx + Math.sin(e.ph * 1.1) * e.amp;
      e.y = e.hy + Math.sin(e.ph * 2.2) * 5;
    },
    // only reached while invincible (shield / jetpack / god): smash it
    onStomp(e) {
      BB.defeatEnemy(e, { coins: 4, toast: 'SMASH!', color: '#ff6a3d' });
      BB.bounce(BB.JUMP * 1.1);
      return true;
    },
    onHit(e, p, G) {
      if (untouchable(G)) return true;
      BB.burst(p.x, p.y, '#ff6a3d', 14, 260);
      return false;
    },
    draw(c, e, G) {
      const s = local(c, e, G);
      spikeShape(c, e.r, e.rot);
      eyes(c, e, G, 0, -1, 6, 4.2, null);
      brows(c, 0, -1, 6, 4.2, 2.5);
      unlocal(c, e, s);
    }
  };

  BB.enemyTypes.ufo = {
    label: 'UFO', r: 20, minHeight: 3000, stompable: true, color: '#3ff0c0',
    weight: (d, G) => (roomFor(G) ? 0.01 + 0.015 * d : 0),
    create(x, y) {
      const W = BB.W;
      const amp = Math.min(rand(50, 110), Math.max(0, W / 2 - 40));
      const hx = clamp(x, 34 + amp, W - 34 - amp);
      return { hx, x: hx, hy: y, amp, ph: rand(0, 6), spd: rand(0.7, 1.1), fire: rand(1.2, 2.4) };
    },
    update(e, dt, G) {
      e.ph += dt * e.spd;
      e.x = e.hx + Math.sin(e.ph) * e.amp;
      e.y = e.hy + Math.sin(e.ph * 2.3) * 6;
      const sy = e.y - G.cam;
      if (sy > 0 && sy < BB.H * 0.7) {
        e.fire -= dt;
        if (e.fire <= 0) {
          e.fire = rand(2.4, 3.4) - BB.difficulty() * 0.5;
          if (countProj(G) < PROJ_CAP) {
            const l = BB.spawnEnemy('laser', e.x, e.y + 14);
            if (l) l.vy = 125 + 50 * BB.difficulty();
            beep(1300, 0.16, 'sine', 0.03, 0.35);
          }
        }
      }
    },
    onStomp(e) {
      BB.defeatEnemy(e, { coins: 4, toast: 'UFO DOWN!', color: '#3ff0c0' });
      BB.bounce(BB.JUMP * 1.2);
      return true;
    },
    onHit(e, p, G) { return untouchable(G); },
    draw(c, e, G) {
      if (!e.dead && e.fire < 0.7 && onScreen(G, e.y, 0)) {
        const k = 1 - Math.max(0, e.fire) / 0.7;
        c.globalAlpha = 0.18 + 0.12 * k;
        c.fillStyle = '#b8ff3c';
        c.beginPath();
        c.moveTo(e.x - 9, e.y + 8); c.lineTo(e.x + 9, e.y + 8);
        c.lineTo(e.x + 20 * k, e.y + 10 + 60 * k); c.lineTo(e.x - 20 * k, e.y + 10 + 60 * k);
        c.closePath();
        c.fill();
        c.globalAlpha = 1;
      }
      const s = local(c, e, G);
      ufoShape(c, 1, G.t, e.dead ? 2 : e.fire < 0.7 ? 1 : 0);
      unlocal(c, e, s);
    }
  };

  const GH_VIS = 1.9, GH_OUT = 0.5, GH_HID = 1.4, GH_IN = 0.6;
  const GH_CYC = GH_VIS + GH_OUT + GH_HID + GH_IN;
  BB.enemyTypes.ghost = {
    label: 'Ghost', r: 16, minHeight: 3800, stompable: true, color: '#e6dcff',
    weight: (d, G) => (roomFor(G) ? 0.012 + 0.018 * d : 0),
    create(x, y) {
      return { x: clamp(x, 30, BB.W - 30), hy: y, ph: rand(0, GH_CYC), bob: rand(0, 6), alpha: 1, solid: true, was: true };
    },
    update(e, dt, G) {
      const p = G.p;
      const dx = p.x - e.x, dy = p.y - e.y;
      const reach = e.r + p.r + 18;
      // never pop back in right on top of the player
      const hold = e.ph >= GH_VIS + GH_OUT + GH_HID && dx * dx + dy * dy < reach * reach;
      if (!hold) { e.ph += dt; if (e.ph >= GH_CYC) e.ph -= GH_CYC; }
      const ph = e.ph;
      e.alpha = ph < GH_VIS ? 1 : ph < GH_VIS + GH_OUT ? 1 - (ph - GH_VIS) / GH_OUT
        : ph < GH_VIS + GH_OUT + GH_HID ? 0 : (ph - GH_VIS - GH_OUT - GH_HID) / GH_IN;
      e.solid = e.alpha > 0.7;
      e.bob += dt * 2.4;
      if (e.alpha > 0.3 && dy > -420 && dy < 420) e.x += clamp(dx * 0.6, -38, 38) * dt;
      e.x = clamp(e.x, e.r + 4, BB.W - e.r - 4);
      e.y = e.hy + Math.sin(e.bob) * 10;
      if (e.solid && !e.was && onScreen(G, e.y, 0)) beep(520, 0.3, 'sine', 0.025, 0.55);
      e.was = e.solid;
    },
    onStomp(e, p, G, how) {
      if (!e.solid) return true; // you pass right through a faded ghost
      BB.defeatEnemy(e, { coins: 3, toast: 'BOO!', color: '#e6dcff' });
      BB.bounce(BB.JUMP * (how === 'stomp' ? 1.15 : 1.05));
      return true;
    },
    onHit(e, p, G) { return !e.solid || untouchable(G); },
    draw(c, e, G) {
      const a = e.dead ? 0.85 : Math.max(0.1, e.alpha);
      const s = local(c, e, G);
      if (!e.dead && !e.solid) {
        // shimmer outline so a faded ghost is still readable (and harmless)
        c.globalAlpha = 0.3;
        c.strokeStyle = '#e6dcff';
        c.lineWidth = 1.5;
        c.setLineDash(DASH);
        c.beginPath(); c.arc(0, 0, e.r + 3, 0, TAU); c.stroke();
        c.setLineDash(NODASH);
        c.lineWidth = 1;
      }
      c.globalAlpha = a;
      ghostShape(c, e.r, G.t);
      c.fillStyle = '#ff4fa3';
      c.globalAlpha = a * 0.45;
      circle(c, -9.5, 2.5, 2.6);
      circle(c, 9.5, 2.5, 2.6);
      unlocal(c, e, s);
    }
  };

  BB.enemyTypes.blackhole = {
    label: 'Black Hole', r: 12, minHeight: 5500, stompable: false, color: '#8a5cff',
    weight: (d, G) => (roomFor(G) && !nearType(G, 'blackhole', G.topY, 1000) ? 0.005 + 0.01 * d : 0),
    create(x, y, G) {
      const clear = 12 + 16 + 48;
      return { x: safeX(G, x, y, clear, 46), R: 135, clear, ang: rand(0, 6), pt: 0, inside: false };
    },
    update(e, dt, G) {
      e.ang += dt * 2.6;
      const p = G.p, R = e.R;
      const dx = BB.wrapDx(e.x - p.x), dy = e.y - p.y, d2 = dx * dx + dy * dy;
      const inside = d2 < R * R;
      if (inside && d2 > 4 && !G.dead && !BB.effectFlag('noLand')) {
        // strong near the centre, gentle at the rim; steering (2400) always wins
        const d = Math.sqrt(d2), k = 1 - d / R, f = (1450 * k * k + 260 * k) * dt;
        p.vx += dx / d * f;
        p.vy += dy / d * f * 0.55;
        if (!e.inside) beep(85, 0.5, 'sine', 0.06, 0.6);
      }
      e.inside = inside;
      if (onScreen(G, e.y, 40)) {
        e.pt += dt * 22;
        while (e.pt >= 1) {
          e.pt -= 1;
          const a = Math.random() * TAU, rr = R * rand(0.75, 0.95), sp = rand(110, 170);
          const ca = Math.cos(a), sa = Math.sin(a);
          BB.emitParticle(e.x + ca * rr, e.y + sa * rr, -ca * sp - sa * sp * 0.35, -sa * sp + ca * sp * 0.35,
            rr / sp * 0.85, Math.random() < 0.5 ? '#b07cff' : '#ff8fc8', 3, 0);
        }
      }
    },
    // shield / jetpack / god: pop it
    onStomp(e, p, G) {
      const x = e.x, y = e.y;
      BB.defeatEnemy(e, { coins: 5, toast: 'VOID POP!', color: '#b07cff', shake: 12 });
      e.remove = true;
      BB.burst(x, y, '#ffcf3f', 14, 300);
      BB.flash('#b07cff', 0.25);
      BB.bounce(BB.JUMP * 1.1);
      return true;
    },
    onHit(e, p, G) {
      if (untouchable(G)) return true;
      BB.burst(e.x, e.y, '#b07cff', 16, 200);
      return false;
    },
    draw(c, e, G) {
      c.translate(e.x, e.y);
      holeShape(c, e, G.t);
      c.translate(-e.x, -e.y);
    }
  };

  BB.enemyTypes.missile = {
    label: 'Missile', r: 11, minHeight: 6500, stompable: true, color: '#fff7e8',
    weight: (d, G) => {
      if (!G || G.demo || G.enemiesBoss || G.enemiesWarn > 0) return 0;
      const last = G.enemiesLastMissile == null ? -99 : G.enemiesLastMissile;
      if (G.t - last < 15 || hasType(G, 'missile')) return 0;
      return 0.008 + 0.012 * d;
    },
    create(x, y, G) {
      G.enemiesLastMissile = G.t;
      const mx = clamp(G.p.x + rand(-24, 24), 16, BB.W - 16);
      return { x: mx, y: G.cam + BB.H + 60, st: 'warn', wt: 1.1, bk: 0, vy: 0 };
    },
    update(e, dt, G) {
      if (e.st === 'warn') {
        e.y = G.cam + BB.H + 60;
        e.wt -= dt; e.bk -= dt;
        if (e.bk <= 0) { e.bk = 0.22; beep(950, 0.06, 'square', 0.035); }
        if (e.wt <= 0) {
          e.st = 'fly'; e.vy = -900;
          beep(180, 0.55, 'sawtooth', 0.05, 3.5);
          BB.vibrate(30);
        }
        return;
      }
      e.y += e.vy * dt;
      if (onScreen(G, e.y, 20)) {
        BB.emitParticle(e.x + rand(-3, 3), e.y + 18, rand(-30, 30), rand(40, 120), 0.45, '#a99bd6', 5, -60);
      }
      if (e.y < G.cam - 160) e.remove = true;
    },
    onStomp(e, p, G, how) {
      if (e.st === 'warn') return true;
      const x = e.x, y = e.y;
      BB.defeatEnemy(e, { coins: 4, toast: 'BOOM!', color: '#ff8a3d', shake: 12 });
      e.remove = true;
      BB.burst(x, y, '#ffcf3f', 14, 300);
      BB.bounce(BB.JUMP * (how === 'stomp' ? 1.2 : 1.05));
      return true;
    },
    onHit(e, p, G) {
      if (e.st === 'warn' || untouchable(G)) return true;
      BB.burst(p.x, p.y, '#ff8a3d', 18, 300);
      return false;
    },
    draw(c, e, G) {
      if (e.st === 'warn') {
        const H = BB.H;
        const blink = ((e.wt * 9) | 0) % 2 === 0;
        c.fillStyle = '#ff4fa3';
        c.globalAlpha = blink ? 0.2 : 0.1;
        c.fillRect(e.x - 13, G.cam, 26, H);
        c.globalAlpha = 1;
        const mx = clamp(e.x, 24, BB.W - 24);
        const my = G.cam + H - 46 - ((BB.layout && BB.layout.safeBottom) || 0);
        c.fillStyle = blink ? '#ff4fa3' : '#ffcf3f';
        c.beginPath();
        c.moveTo(mx, my - 24); c.lineTo(mx + 22, my + 14); c.lineTo(mx - 22, my + 14);
        c.closePath();
        c.fill();
        c.fillStyle = '#140b2e';
        c.font = F_BANG;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('!', mx, my + 3);
        return;
      }
      const s = local(c, e, G);
      c.fillStyle = Math.random() < 0.5 ? '#ffcf3f' : '#ff8a3d';
      c.beginPath(); c.moveTo(-6, 13); c.lineTo(0, 26 + Math.random() * 10); c.lineTo(6, 13); c.closePath(); c.fill();
      c.fillStyle = '#ff4fa3';
      c.beginPath();
      c.moveTo(-6, 4); c.lineTo(-13, 15); c.lineTo(-6, 13);
      c.moveTo(6, 4); c.lineTo(13, 15); c.lineTo(6, 13);
      c.fill();
      c.fillStyle = '#fff7e8';
      BB.rr(c, -6.5, -12, 13, 26, 5);
      c.fillStyle = '#ff4fa3';
      c.beginPath(); c.moveTo(-6.5, -8); c.quadraticCurveTo(0, -26, 6.5, -8); c.closePath(); c.fill();
      c.fillStyle = '#8fd8ff';
      circle(c, 0, -1, 3.4);
      unlocal(c, e, s);
    }
  };

  // =====================================================================
  // Projectiles
  // =====================================================================
  function popShot(e) {
    BB.burst(e.x, e.y, BB.enemyTypes[e.type].color, 8, 150);
    beep(900, 0.06, 'square', 0.03, 0.5);
    e.remove = true;
  }
  BB.enemyTypes.laser = {
    label: 'Laser Blob', r: 9, stompable: false, color: '#b8ff3c', weight: () => 0,
    create(x, y, G) { return { scr: false, sx: x, sy: y - G.cam, vx: 0, vy: 130 }; },
    update: projMove,
    onStomp(e) { popShot(e); return true; },
    onHit(e, p, G) {
      if (untouchable(G)) return true;
      BB.burst(p.x, p.y, '#b8ff3c', 12, 220);
      return false;
    },
    draw(c, e, G) {
      const r = e.r, k = Math.sin(G.t * 22) * 1.5;
      c.translate(e.x, e.y);
      c.fillStyle = '#b8ff3c';
      c.globalAlpha = 0.28; circle(c, 0, 0, r + 6 + k);
      c.globalAlpha = 0.45; circle(c, 0, -r * 1.6, r * 0.55);
      c.globalAlpha = 0.25; circle(c, 0, -r * 2.6, r * 0.32);
      c.globalAlpha = 1; circle(c, 0, 0, r);
      c.fillStyle = '#fff';
      circle(c, -r * 0.25, -r * 0.25, r * 0.42);
      c.translate(-e.x, -e.y);
    }
  };
  BB.enemyTypes.minibat = {
    label: 'Mini Bat', r: 11, stompable: true, color: '#ff4fa3', weight: () => 0,
    create(x, y, G) { return { scr: false, sx: x, sy: y - G.cam, vx: 0, vy: 100, ph: rand(0, 6) }; },
    update(e, dt, G) {
      e.ph += dt * 7;
      if (e.scr) e.sx += Math.sin(e.ph) * 40 * dt; else e.x += Math.sin(e.ph) * 40 * dt;
      projMove(e, dt, G);
    },
    onStomp(e, p, G, how) {
      const x = e.x, y = e.y;
      BB.defeatEnemy(e, { coins: 1, toast: false, shake: 4 });
      BB.floatText('+1', x, y - 12, '#ffcf3f');
      if (how === 'stomp') BB.bounce(BB.JUMP * 1.05);
      return true;
    },
    onHit(e, p, G) { return untouchable(G); },
    draw(c, e, G) {
      const s = local(c, e, G);
      batShape(c, e.r, G.t + e.ph);
      unlocal(c, e, s);
    }
  };
  BB.enemyTypes.ink = {
    label: 'Ink Ball', r: 9, stompable: false, color: '#b07cff', weight: () => 0,
    create(x, y, G) { return { scr: false, sx: x, sy: y - G.cam, vx: 0, vy: 160 }; },
    update: projMove,
    onStomp(e) { popShot(e); return true; },
    onHit(e, p, G) {
      if (untouchable(G)) return true;
      BB.burst(p.x, p.y, '#b07cff', 14, 220);
      return false;
    },
    draw(c, e, G) {
      const r = e.r;
      c.translate(e.x, e.y);
      c.fillStyle = '#b07cff';
      c.globalAlpha = 0.3; circle(c, 0, 0, r + 5 + Math.sin(G.t * 18) * 1.2);
      c.globalAlpha = 1;
      c.fillStyle = '#8a4dff'; circle(c, 0, 0, r);
      c.fillStyle = '#e6d4ff'; circle(c, -r * 0.3, -r * 0.3, r * 0.36);
      c.translate(-e.x, -e.y);
    }
  };

  // =====================================================================
  // Bosses
  // =====================================================================
  function setSt(e, st) { e.st = st; e.stT = 0; }
  // Hover just under the HP bar. The player can never rise above ~0.42H (the
  // camera follows), and touching a hovering boss is harmless anyway.
  function hoverY(e) {
    const L = BB.layout || {}, H = BB.H, info = INFO[e.type];
    const barBottom = (L.hudBottom || 100) + 48;
    return Math.min(barBottom + 14 + (info ? info.top : e.r), H * 0.42 - 10);
  }
  // Where it dives / sinks to: low enough that you can fall onto it from your bounce.
  function lowY(e) { return Math.max(hoverY(e) + 100, BB.H * 0.56); }
  function waitTime(e) { return Math.max(0.6, 1.5 - 0.2 * Math.min(3, e.level) - 0.15 * (e.hpMax - e.hp)); }
  function pace(e) { return 1 + 0.18 * Math.min(3, e.level) + 0.12 * (e.hpMax - e.hp); }

  function swayTo(e, dt, hy, sp) {
    const W = BB.W, info = INFO[e.type];
    e.sway += dt * 0.85 * sp;
    // edge to edge on a phone, but not across a whole desktop screen
    const amp = Math.max(0, Math.min(230, W / 2 - (info ? info.half : e.r + 30) - 6));
    const k = Math.min(1, dt * 3);
    e.sx += (W / 2 + Math.sin(e.sway) * amp - e.sx) * k;
    e.sy += (hy + Math.sin(e.sway * 2.1) * 8 - e.sy) * k;
  }

  function nextMove(e, G) {
    const info = INFO[e.type];
    const plan = e.level > 0 ? info.plan1 : info.plan0;
    e.move = plan[e.step % plan.length];
    e.step++;
    e.locked = false;
    e.soft = false;
    e.shots = 0;
    e.shotT = 0;
    if (e.move === 'dive') {
      e.diveX = clamp(G.p.x, e.r + 14, BB.W - e.r - 14);
      e.bk = 0;
      setSt(e, 'diveWarn');
    } else {
      setSt(e, 'windup');
      beep(260, 0.45, 'triangle', 0.05, 2.2);
    }
  }
  function endAttack(e) { setSt(e, 'hover'); e.wait = waitTime(e); }

  function bossUpdate(e, dt, G) {
    const cur = G.enemiesBoss;
    if (cur && cur !== e && !cur.remove && !cur.dead) { e.remove = true; return; }
    if (cur !== e) { G.enemiesBoss = e; G.enemiesNextBoss = Infinity; }
    e.beat = G.t;
    e.stT += dt; e.flash -= dt; e.hitCd -= dt; e.lostT -= dt;
    const W = BB.W, hy = hoverY(e), pc = pace(e);
    switch (e.st) {
      case 'enter':
        e.sy += (hy - e.sy) * Math.min(1, dt * 2.2);
        e.sx += (W / 2 - e.sx) * Math.min(1, dt * 2);
        if (e.stT > 1.5) { setSt(e, 'hover'); e.wait = 0.8; }
        break;
      case 'hover':
        swayTo(e, dt, hy, pc);
        if (e.stT > e.wait) nextMove(e, G);
        break;
      case 'windup':
        bossWindup(e, dt, G, hy, pc);
        break;
      case 'attack':
        bossAttack(e, dt, G, hy, pc);
        break;
      case 'diveWarn': {
        e.sx += (e.diveX - e.sx) * Math.min(1, dt * 7);
        e.sy += (hy - 6 - e.sy) * Math.min(1, dt * 4);
        e.bk -= dt;
        if (e.bk <= 0) { e.bk = 0.2; beep(220, 0.08, 'square', 0.045, 1.4); }
        if (e.stT > Math.max(0.8, 1.0 - 0.07 * e.level)) {
          e.sx = e.diveX;
          setSt(e, 'dive');
          beep(500, 0.35, 'sawtooth', 0.05, 0.25);
        }
        break;
      }
      case 'dive': {
        const ly = lowY(e);
        e.sy += (e.soft ? 240 : 820) * dt;
        if (e.soft && Math.random() < 0.4) BB.emitParticle(e.x + rand(-20, 20), e.y - 10, rand(-30, 30), -60, 0.6, '#a99bd6', 6, -40);
        if (e.sy >= ly) {
          e.sy = ly;
          setSt(e, 'dizzy');
          BB.shake(e.soft ? 5 : 10);
          beep(80, 0.3, 'square', 0.08, 0.5);
          BB.burst(e.sx, G.cam + ly + e.r * 0.6, '#fff7e8', 10, 160);
          if (!e.hinted) { e.hinted = true; BB.ui.toast('JUMP ON IT!', '#ffcf3f'); }
        }
        break;
      }
      case 'dizzy':
        e.sy = lowY(e) + Math.sin(e.stT * 3) * 4;
        if (e.type === 'megaufo' && Math.random() < 0.25) {
          BB.emitParticle(e.x + rand(-30, 30), e.y - 14, rand(-20, 20), -50, 0.8, '#a99bd6', 6, -30);
        }
        if (e.stT > Math.max(1.9, 2.7 - 0.2 * e.level)) setSt(e, 'rise');
        break;
      case 'rise':
        e.sy += (hy - e.sy) * Math.min(1, dt * 3);
        e.sx += (clamp(e.sx, INFO[e.type].half, W - INFO[e.type].half) - e.sx) * Math.min(1, dt * 3);
        if (e.stT > 0.95) { setSt(e, 'hover'); e.wait = waitTime(e); }
        break;
      case 'dying':
        e.boomT -= dt;
        if (e.boomT <= 0) {
          e.boomT = 0.11;
          const r = e.r;
          BB.burst(e.x + rand(-r, r), e.y + rand(-r, r), Math.random() < 0.5 ? INFO[e.type].color : '#ffcf3f', 10, 200);
          beep(60 + Math.random() * 50, 0.22, 'square', 0.07, 0.4);
          BB.shake(8);
        }
        if (e.stT > 1.2) finishBoss(e, G);
        break;
      default:
        setSt(e, 'hover');
    }
    e.x = e.sx;
    e.y = G.cam + e.sy;
  }

  function bossWindup(e, dt, G, hy, pc) {
    if (e.move === 'beam') {
      if (e.stT < 0.5) {
        e.sx += (clamp(G.p.x, e.r + 14, BB.W - e.r - 14) - e.sx) * Math.min(1, dt * 6);
        e.beamX = e.sx;
      } else if (!e.locked) {
        e.locked = true;
        beep(520, 0.5, 'sawtooth', 0.04, 1.6);
      }
      e.sy += (hy - e.sy) * Math.min(1, dt * 3);
      if (e.stT > 0.5 + BEAM_WARN) {
        setSt(e, 'attack');
        beep(140, 0.9, 'sawtooth', 0.07, 1.4);
        BB.shake(6);
        BB.vibrate(40);
      }
      return;
    }
    swayTo(e, dt, hy, pc * 0.35);
    const dur = e.move === 'swarm' ? 0.75 : e.move === 'rain' ? 0.6 : 0.65;
    if (e.stT > dur / Math.sqrt(pc)) setSt(e, 'attack');
  }

  function bossAttack(e, dt, G, hy, pc) {
    const lv = Math.min(3, e.level);
    if (e.move === 'beam') {
      e.sx = e.beamX;
      const p = G.p;
      if (p.y > e.y && Math.abs(BB.wrapDx(p.x - e.beamX)) < BEAM_HW + p.r * 0.6) hurt(G, e.type);
      if (Math.random() < 0.6) {
        BB.emitParticle(e.beamX + rand(-10, 10), G.cam + BB.H - 6, rand(-90, 90), rand(-280, -120), 0.4, '#ff8fc8', 4, 500);
      }
      if (e.stT > BEAM_T) {
        e.soft = true; // overheated: sinks low and gets dizzy (harmless while sinking)
        setSt(e, 'dive');
        beep(300, 0.6, 'sine', 0.05, 0.3);
      }
      return;
    }
    swayTo(e, dt, hy, pc * (e.move === 'rain' ? 1.3 : 0.5));
    if (e.move === 'swarm') {
      if (e.shots === 0) {
        e.shots = 1;
        const n = 3 + (lv > 0 ? 1 : 0), spread = n === 3 ? 95 : 85;
        for (let i = 0; i < n; i++) spawnShot(G, 'minibat', e.sx, e.sy + 18, (i - (n - 1) / 2) * spread, 85 + 12 * lv);
        beep(700, 0.2, 'square', 0.045, 0.5);
      }
      if (e.stT > 0.6) endAttack(e);
    } else if (e.move === 'rain') {
      const n = 3 + Math.min(2, lv);
      e.shotT -= dt;
      if (e.shotT <= 0 && e.shots < n) {
        e.shots++;
        e.shotT = 0.36;
        spawnShot(G, 'laser', e.sx, e.sy + 24, 0, 150 + 15 * lv);
        beep(1300, 0.14, 'sine', 0.035, 0.35);
      }
      if (e.shots >= n && e.shotT <= 0) endAttack(e);
    } else if (e.move === 'ink') {
      const volleys = lv > 0 ? 2 : 1;
      e.shotT -= dt;
      if (e.shotT <= 0 && e.shots < volleys) {
        e.shots++;
        e.shotT = 0.55;
        const p = G.p, x0 = e.sx, y0 = e.sy + 16;
        const base = Math.atan2(p.y - G.cam - y0, p.x - x0), sp = 165 + 18 * lv;
        for (let k = -1; k <= 1; k++) {
          const a = base + k * 0.3;
          spawnShot(G, 'ink', x0, y0, Math.cos(a) * sp, Math.sin(a) * sp);
        }
        beep(240, 0.18, 'sine', 0.06, 0.5);
      }
      if (e.shots >= volleys && e.shotT <= -0.2) endAttack(e);
    } else {
      endAttack(e);
    }
  }

  function bossHit(e, G, bounce) {
    if (e.hitCd > 0 || e.st === 'dying' || e.hp <= 0) return false;
    const info = INFO[e.type];
    e.hp--;
    e.hitCd = 0.7; e.flash = 0.2; e.lostT = 0.6;
    BB.shake(12);
    BB.vibrate(50);
    beep(180, 0.2, 'square', 0.08, 0.4);
    beep(900, 0.12, 'square', 0.05, 1.6);
    BB.burst(e.x, e.y - e.r * 0.6, '#fff7e8', 14, 260);
    BB.burst(e.x, e.y, info.color, 10, 200);
    BB.floatText('BONK!', e.x, e.y - e.r - 26, '#ffcf3f');
    BB.addScore(50);
    BB.addCoins(2, e.x, e.y);
    if (bounce) BB.bounce(BB.JUMP * 1.35);
    BB.emit('enemies:bossHit', e, G);
    if (e.hp <= 0) {
      setSt(e, 'dying');
      e.boomT = 0;
      BB.flash('#fff7e8', 0.35);
      clearShots(G);
    } else {
      setSt(e, 'rise');
    }
    return true;
  }

  function clearShots(G) {
    const ens = G.enemies;
    for (let i = 0; i < ens.length; i++) { const s = ens[i]; if (PROJ[s.type] && !s.remove && !s.dead) poof(G, s); }
  }

  const JINGLE = [523, 659, 784, 1047, 1319];
  function finishBoss(e, G) {
    const info = INFO[e.type];
    const x = e.x, y = e.y;
    e.finishing = true;
    BB.defeatEnemy(e, { coins: 0, toast: false, shake: 22, color: info.color });
    e.remove = true;
    BB.burst(x, y, '#fff7e8', 26, 420);
    BB.burst(x, y, info.color, 26, 360);
    BB.burst(x, y, '#ffcf3f', 20, 300);
    BB.flash('#fff7e8', 0.65);
    BB.vibrate([80, 40, 160]);
    coinShower(G, x, y, 30);
    BB.addScore(500);
    BB.floatText('+500', x, y - 34, '#ffcf3f');
    BB.ui.toast('BOSS DEFEATED!', '#ffcf3f');
    G.stats.bossesDefeated = (G.stats.bossesDefeated || 0) + 1;
    const S = BB.save.enemies && typeof BB.save.enemies === 'object' ? BB.save.enemies : (BB.save.enemies = { bosses: 0 });
    S.bosses = (S.bosses || 0) + 1;
    BB.store();
    for (let i = 0; i < JINGLE.length; i++) {
      setTimeout(() => beep(JINGLE[i], i === JINGLE.length - 1 ? 0.4 : 0.12, 'square', 0.05), 160 + 110 * i);
    }
    clearShots(G);
    G.enemiesBoss = null;
    scheduleNext(G);
    BB.emit('enemies:bossDefeated', e.type, G);
  }

  function coinShower(G, x, y, n) {
    if (!BB.itemTypes.coin) { BB.addCoins(n, x, y); return; }
    for (let i = 0; i < n; i++) {
      const it = BB.spawnItem('coin', x + rand(-10, 10), y + rand(-10, 10));
      if (!it) continue;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7, s = rand(160, 430);
      G.enemiesShower.push({ it, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, home: 0.6 + i * 0.03 });
    }
  }
  function updateShower(G, dt) {
    const sh = G.enemiesShower;
    if (!sh || !sh.length) return;
    const p = G.p, W = BB.W;
    let j = 0;
    for (let i = 0; i < sh.length; i++) {
      const c = sh[i], it = c.it;
      if (it.got) continue;
      c.t += dt;
      if (c.t < c.home) {
        const k = Math.exp(-3.2 * dt);
        c.vx *= k; c.vy *= k;
      } else {
        // fly to the player so the whole shower is yours
        const dx = p.x - it.x, dy = p.y - it.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const sp = Math.min(1100, 260 + (c.t - c.home) * 1400);
        c.vx = dx / d * sp; c.vy = dy / d * sp;
      }
      it.x += c.vx * dt;
      it.y += c.vy * dt;
      if (it.x < 10) { it.x = 10; c.vx = Math.abs(c.vx); }
      else if (it.x > W - 10) { it.x = W - 10; c.vx = -Math.abs(c.vx); }
      if (c.t < 6) sh[j++] = c;
    }
    sh.length = j;
  }

  function scheduleNext(G) {
    let n = (Math.floor(G.maxH / BOSS_EVERY) + 1) * BOSS_EVERY;
    if (n - G.maxH < 1200) n += BOSS_EVERY;
    G.enemiesNextBoss = n;
  }

  function startWarning(G, type) {
    if (!live(G) || G.enemiesBoss || G.enemiesWarn > 0) return false;
    if (!type || !BOSS[type]) type = BOSS_ORDER[(G.enemiesBossIdx || 0) % BOSS_ORDER.length];
    G.enemiesWarn = WARN_T;
    G.enemiesWarnType = type;
    G.enemiesSiren = 0;
    G.enemiesNextBoss = Infinity;
    // the boss scares everyone else away
    const ens = G.enemies;
    for (let i = 0; i < ens.length; i++) {
      const e = ens[i];
      if (!e.remove && !e.dead && !BOSS[e.type]) poof(G, e);
    }
    BB.vibrate([90, 70, 90, 70, 240]);
    BB.shake(10);
    BB.emit('enemies:bossWarn', type, G);
    return true;
  }
  function spawnBoss(G, type) {
    const e = BB.spawnEnemy(type, BB.W / 2, G.cam - 90);
    if (!e) { scheduleNext(G); return null; }
    G.enemiesBoss = e;
    G.enemiesNextBoss = Infinity;
    G.enemiesBossIdx = (G.enemiesBossIdx || 0) + 1;
    beep(110, 0.7, 'sawtooth', 0.07, 0.5);
    BB.shake(14);
    BB.emit('enemies:bossStart', type, G);
    return e;
  }

  function bossCreate(type) {
    return function (x, y, G) {
      const idx = G.enemiesBossIdx || 0;
      const hp = Math.min(5, 3 + Math.floor(idx / 3)); // 3 HP for the first round of bosses, then 4, then 5
      return {
        scr: true, sx: clamp(x, 60, BB.W - 60), sy: y - G.cam, st: 'enter', stT: 0,
        hp, hpMax: hp, level: Math.floor(idx / 3), step: 0, move: null, wait: 1,
        flash: 0, hitCd: 0, lostT: 0, sway: 0, beat: G.t, shots: 0, shotT: 0, bk: 0, boomT: 0,
        diveX: x, beamX: x, locked: false, soft: false, hinted: false, finishing: false
      };
    };
  }
  function bossStomp(e, p, G, how) {
    if (e.st === 'dying' || e.st === 'enter') return true;
    if (e.st === 'dizzy' || e.st === 'dive') { if (bossHit(e, G, true)) return true; }
    if (how === 'stomp' && e.hitCd <= 0) {
      // landed on it while it is still tough: a little boop so you don't sink in
      e.hitCd = 0.25;
      BB.bounce(BB.JUMP * 0.85);
      beep(260, 0.06, 'square', 0.03);
    }
    return true;
  }
  // Only the dive itself hurts on contact; hovering / dizzy / rising bosses are safe to touch.
  function bossTouch(e, p, G) { return !(e.st === 'dive' && !e.soft) || untouchable(G); }

  function drawKingBat(c, e, G) {
    const r = e.r, t = G.t;
    const fast = e.st === 'windup' || e.st === 'diveWarn';
    const f = Math.sin(t * (fast ? 28 : 11));
    c.fillStyle = '#b52a72';
    for (let s = -1; s <= 1; s += 2) {
      c.beginPath();
      c.moveTo(s * r * 0.5, -r * 0.35);
      c.quadraticCurveTo(s * (r + 22), -r - 12 - f * 16, s * (r + 44), -r * 0.25 + f * 12);
      c.quadraticCurveTo(s * (r + 34), r * 0.1, s * (r + 27), r * 0.45 + f * 4);
      c.quadraticCurveTo(s * (r + 18), r * 0.15, s * (r + 9), r * 0.5);
      c.quadraticCurveTo(s * (r + 2), r * 0.2, s * r * 0.5, r * 0.35);
      c.closePath();
      c.fill();
    }
    c.fillStyle = '#ff4fa3';
    c.beginPath();
    c.moveTo(-r * 0.8, -r * 0.4); c.lineTo(-r * 0.62, -r * 1.12); c.lineTo(-r * 0.25, -r * 0.8);
    c.moveTo(r * 0.8, -r * 0.4); c.lineTo(r * 0.62, -r * 1.12); c.lineTo(r * 0.25, -r * 0.8);
    c.fill();
    circle(c, 0, 0, r);
    c.fillStyle = '#ff8cc6';
    c.beginPath(); c.ellipse(0, r * 0.38, r * 0.6, r * 0.45, 0, 0, TAU); c.fill();
    // crown
    const cy = -r * 0.8;
    c.fillStyle = '#ffcf3f';
    c.beginPath();
    c.moveTo(-15, cy + 6); c.lineTo(-17, cy - 12); c.lineTo(-8, cy - 3); c.lineTo(0, cy - 17);
    c.lineTo(8, cy - 3); c.lineTo(17, cy - 12); c.lineTo(15, cy + 6);
    c.closePath();
    c.fill();
    c.fillStyle = '#3ff0c0'; circle(c, 0, cy - 1, 3);
    c.fillStyle = '#ff4fa3'; circle(c, -9, cy + 1, 2); circle(c, 9, cy + 1, 2);
    bossFace(c, e, G, 0, -r * 0.1, 13, 8);
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(-9, r * 0.24); c.lineTo(-5.5, r * 0.24 + 9); c.lineTo(-2, r * 0.24);
    c.moveTo(2, r * 0.24); c.lineTo(5.5, r * 0.24 + 9); c.lineTo(9, r * 0.24);
    c.fill();
  }
  function drawMegaUfo(c, e, G) {
    const s = 2.2, t = G.t;
    // antenna
    c.strokeStyle = '#c9bdf2';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, -12 * s); c.lineTo(0, -12 * s - 14); c.stroke();
    c.lineWidth = 1;
    c.fillStyle = ((t * 4) | 0) % 2 ? '#ff4fa3' : '#ffcf3f';
    circle(c, 0, -12 * s - 16, 5);
    const mood = e.st === 'dizzy' || e.st === 'dying' ? 2 : (e.st === 'windup' || e.st === 'attack') ? 1 : 0;
    ufoShape(c, s, t, mood);
    // under-port glows while charging
    if (e.st === 'windup' || e.st === 'attack') {
      c.fillStyle = e.move === 'beam' ? '#ff4fa3' : '#b8ff3c';
      c.globalAlpha = 0.6 + 0.4 * Math.sin(t * 30);
      c.beginPath(); c.ellipse(0, 11 * s, 7 * s, 2.5 * s, 0, 0, TAU); c.fill();
      c.globalAlpha = 1;
    }
  }
  function drawSquid(c, e, G) {
    const r = e.r, t = G.t;
    const puff = e.st === 'windup' && e.move === 'ink' ? 1 + 0.13 * Math.min(1, e.stT / 0.55) + Math.sin(t * 30) * 0.02 : 1;
    c.strokeStyle = '#7d4fe0';
    c.lineWidth = 7;
    c.lineCap = 'round';
    c.beginPath();
    const fast = e.st === 'diveWarn' || e.st === 'dive' ? 12 : 5;
    for (let i = 0; i < 6; i++) {
      const bx = (-1 + i * 0.4) * r * 0.72;
      const w = Math.sin(t * fast + i * 1.3) * 10;
      c.moveTo(bx, r * 0.3);
      c.quadraticCurveTo(bx + w, r * 0.95, bx * 1.3 - w * 0.6, r * 1.55);
    }
    c.stroke();
    c.lineCap = 'butt';
    c.lineWidth = 1;
    // fins
    c.fillStyle = '#7d4fe0';
    c.beginPath();
    c.moveTo(-r * 0.55 * puff, -r * 0.9 * puff); c.lineTo(-r * 1.05 * puff, -r * 1.2 * puff); c.lineTo(-r * 0.85 * puff, -r * 0.3);
    c.moveTo(r * 0.55 * puff, -r * 0.9 * puff); c.lineTo(r * 1.05 * puff, -r * 1.2 * puff); c.lineTo(r * 0.85 * puff, -r * 0.3);
    c.fill();
    c.fillStyle = '#9b6bff';
    c.beginPath();
    c.moveTo(-r * puff, r * 0.4);
    c.quadraticCurveTo(-r * 1.08 * puff, -r * puff, 0, -r * 1.35 * puff);
    c.quadraticCurveTo(r * 1.08 * puff, -r * puff, r * puff, r * 0.4);
    c.quadraticCurveTo(0, r * 0.62, -r * puff, r * 0.4);
    c.fill();
    c.fillStyle = '#ff4fa3';
    circle(c, -r * 0.48, -r * 0.55, 5);
    circle(c, r * 0.5, -r * 0.72, 4);
    circle(c, r * 0.1, -r * 1.0, 3.5);
    circle(c, -r * 0.1, -r * 0.62, 2.5);
    bossFace(c, e, G, 0, -r * 0.05, 13, 9);
    c.fillStyle = '#140b2e';
    if (e.st === 'windup' || e.st === 'attack') circle(c, 0, r * 0.3, 5);
    else { c.beginPath(); c.ellipse(0, r * 0.28, 6, 2.5, 0, 0, TAU); c.fill(); }
  }
  function bossFace(c, e, G, x, y, gap, er) {
    if (e.st === 'dizzy' || e.st === 'dying') { xEyes(c, x, y, gap, 5); return; }
    const angry = e.st === 'windup' || e.st === 'diveWarn' || e.st === 'attack' || e.st === 'dive';
    eyes(c, e, G, x, y, gap, er, angry ? '#ff2a5a' : null);
    brows(c, x, y, gap, er, 3.5);
  }
  const BOSS_DRAW = { kingbat: drawKingBat, megaufo: drawMegaUfo, squid: drawSquid };

  function bossTelegraph(c, e, G) {
    const bottom = G.cam + BB.H;
    if (e.st === 'diveWarn') {
      const hw = e.r + 16, top = e.y, h = bottom - top;
      c.fillStyle = '#ff4fa3';
      c.globalAlpha = 0.12 + 0.08 * Math.sin(G.t * 18);
      c.fillRect(e.diveX - hw, top, hw * 2, h);
      c.globalAlpha = 0.7;
      c.fillRect(e.diveX - hw, top, 3, h);
      c.fillRect(e.diveX + hw - 3, top, 3, h);
      // chevrons sliding down the lane
      c.globalAlpha = 0.85;
      c.fillStyle = '#ffcf3f';
      const span = Math.max(40, G.cam + lowY(e) - top);
      for (let k = 0; k < 3; k++) {
        const yy = top + e.r + ((G.t * 180 + k * span / 3) % span);
        c.beginPath();
        c.moveTo(e.diveX - 12, yy); c.lineTo(e.diveX, yy + 10); c.lineTo(e.diveX + 12, yy);
        c.lineTo(e.diveX + 12, yy + 5); c.lineTo(e.diveX, yy + 15); c.lineTo(e.diveX - 12, yy + 5);
        c.closePath();
        c.fill();
      }
      c.globalAlpha = 1;
    } else if (e.move === 'beam' && ((e.st === 'windup' && e.stT >= 0.5) || e.st === 'attack')) {
      const x = e.beamX, top = e.y + 20, h = bottom - top;
      c.fillStyle = '#ff4fa3';
      if (e.st === 'windup') {
        c.globalAlpha = ((G.t * 16) | 0) % 2 ? 0.95 : 0.45;
        c.fillRect(x - 1.5, top, 3, h);
        c.globalAlpha = 0.12;
        c.fillRect(x - BEAM_HW - 8, top, (BEAM_HW + 8) * 2, h);
      } else {
        const w = BEAM_HW * (0.85 + 0.15 * Math.sin(G.t * 50));
        c.globalAlpha = 0.3;
        c.fillRect(x - w - 9, top, (w + 9) * 2, h);
        c.globalAlpha = 0.9;
        c.fillRect(x - w, top, w * 2, h);
        c.globalAlpha = 1;
        c.fillStyle = '#fff';
        c.fillRect(x - w * 0.35, top, w * 0.7, h);
      }
      c.globalAlpha = 1;
    } else if (e.st === 'windup' && e.move === 'rain') {
      const k = Math.min(1, e.stT / 0.6);
      c.globalAlpha = 0.28 * k;
      c.fillStyle = '#b8ff3c';
      c.beginPath();
      c.moveTo(e.x - 16, e.y + 22); c.lineTo(e.x + 16, e.y + 22);
      c.lineTo(e.x + 44 * k, e.y + 22 + 110 * k); c.lineTo(e.x - 44 * k, e.y + 22 + 110 * k);
      c.closePath();
      c.fill();
      c.globalAlpha = 1;
    } else if (e.st === 'windup' && e.move === 'swarm') {
      c.fillStyle = '#ff4fa3';
      c.globalAlpha = 0.2 + 0.15 * Math.sin(G.t * 30);
      circle(c, e.x, e.y, e.r + 10 + 10 * Math.min(1, e.stT / 0.7));
      c.globalAlpha = 1;
    }
  }

  function bossDraw(c, e, G) {
    if (!e.dead) bossTelegraph(c, e, G);
    const shiver = e.st === 'diveWarn' ? 5 : e.st === 'dying' ? 9 : 0;
    const ox = shiver ? (Math.random() - 0.5) * shiver : 0;
    const x = e.x + ox;
    c.translate(x, e.y);
    if (e.hitCd > 0.25 && e.st !== 'dying' && ((G.t * 20) | 0) % 2 === 0) c.globalAlpha = 0.55;
    if (e.st === 'dying' && ((G.t * 14) | 0) % 2 === 0) c.globalAlpha = 0.7;
    const fn = BOSS_DRAW[e.type];
    if (fn) fn(c, e, G);
    c.globalAlpha = 1;
    if (e.flash > 0) {
      c.globalAlpha = Math.min(1, e.flash / 0.2) * 0.8;
      c.fillStyle = '#fff';
      circle(c, 0, 0, e.r + 2);
      c.globalAlpha = 1;
    }
    if (e.st === 'dizzy') {
      const r = e.r, tt = G.t * 4;
      c.fillStyle = '#ffcf3f';
      for (let i = 0; i < 3; i++) {
        const a = tt + i * TAU / 3;
        star(c, Math.cos(a) * r * 0.8, -r - 14 + Math.sin(a) * 6, 6);
      }
      const bob = Math.abs(Math.sin(G.t * 6)) * 8;
      const hy = -r - 46 - bob;
      c.beginPath(); c.moveTo(-12, hy); c.lineTo(12, hy); c.lineTo(0, hy + 14); c.closePath(); c.fill();
      c.font = F_HINT;
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      c.fillStyle = '#140b2e';
      c.fillText('STOMP!', 0, hy);
      c.fillStyle = '#ffcf3f';
      c.fillText('STOMP!', 0, hy - 2);
    }
    c.translate(-x, -e.y);
  }

  for (let i = 0; i < BOSS_ORDER.length; i++) {
    const type = BOSS_ORDER[i], info = INFO[type];
    BB.enemyTypes[type] = {
      label: info.label,
      boss: true, r: info.r, stompable: true, color: info.color, weight: () => 0,
      create: bossCreate(type),
      update: bossUpdate,
      onStomp: bossStomp,
      onHit: bossTouch,
      draw: bossDraw
    };
  }

  // Bombs / other features can hurt a boss, but never one-shot it.
  const origDefeat = BB.defeatEnemy;
  if (typeof origDefeat === 'function') {
    BB.defeatEnemy = function (e, opts) {
      if (e && BOSS[e.type] && !e.finishing) {
        const G = BB.G;
        if (G && !e.dead && !e.remove && e.st !== 'dying' && e.st !== 'enter') bossHit(e, G, false);
        return 0;
      }
      return origDefeat.call(this, e, opts);
    };
  }

  // =====================================================================
  // HUD: warning banner + boss HP bar
  // =====================================================================
  let vig = null, vigKey = -1;
  function vignette(c, W, H) {
    const key = W * 100000 + H;
    if (!vig || vigKey !== key) {
      vig = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      vig.addColorStop(0, 'rgba(255,40,90,0)');
      vig.addColorStop(1, 'rgba(255,40,90,0.9)');
      vigKey = key;
    }
    return vig;
  }
  function stripes(c, x0, y, w, h, t) {
    c.save();
    c.beginPath(); c.rect(x0, y, w, h); c.clip();
    c.fillStyle = '#ffcf3f';
    c.fillRect(x0, y, w, h);
    c.fillStyle = '#140b2e';
    const step = 22, shift = (t * 60) % step;
    c.beginPath();
    for (let x = x0 - step * 2 + shift; x < x0 + w + step; x += step) {
      c.moveTo(x, y + h); c.lineTo(x + h, y); c.lineTo(x + h + step / 2, y); c.lineTo(x + step / 2, y + h);
      c.closePath();
    }
    c.fill();
    c.restore();
  }
  function drawWarning(c, G) {
    const W = BB.W, H = BB.H;
    const info = INFO[G.enemiesWarnType] || INFO.kingbat;
    const left = G.enemiesWarn, el = WARN_T - left;
    const k = Math.min(1, el / 0.3, left / 0.3);
    const ease = 1 - (1 - k) * (1 - k) * (1 - k);
    c.globalAlpha = (0.3 + 0.22 * Math.sin(el * 14)) * k;
    c.fillStyle = vignette(c, W, H);
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 1;
    const bh = 104, by = Math.round(H * 0.3), off = (1 - ease) * -W;
    c.fillStyle = 'rgba(20,11,46,0.9)';
    c.fillRect(off, by, W, bh);
    stripes(c, off, by, W, 12, el);
    stripes(c, off, by + bh - 12, W, 12, -el);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = F_WARN;
    const tx = W / 2 - off;
    c.fillStyle = '#140b2e';
    c.fillText('WARNING!', tx, by + 43);
    c.fillStyle = ((el * 6) | 0) % 2 === 0 ? '#ffcf3f' : '#ff4fa3';
    c.fillText('WARNING!', tx, by + 40);
    c.font = F_SUB;
    c.fillStyle = '#fff7e8';
    c.fillText(info.coming, tx, by + 76);
  }
  function drawBossBar(c, e, G) {
    const info = INFO[e.type];
    if (!info) return;
    const W = BB.W, L = BB.layout || {};
    const w = Math.min(W - 48, 250), x0 = (W - w) / 2, y0 = (L.hudBottom || 100) + 4;
    c.globalAlpha = Math.min(1, e.age * 2);
    c.fillStyle = 'rgba(20,11,46,0.88)';
    BB.rr(c, x0 - 10, y0, w + 20, 44, 14);
    c.font = F_NAME;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillStyle = info.color;
    c.fillText(info.name, W / 2, y0 + 6);
    const n = e.hpMax, gap = 5, sw = (w - gap * (n - 1)) / n, by = y0 + 27;
    const blink = ((G.t * 16) | 0) % 2 === 0;
    for (let i = 0; i < n; i++) {
      c.fillStyle = i < e.hp ? '#ffcf3f' : (i === e.hp && e.lostT > 0 && blink) ? '#fff7e8' : 'rgba(255,247,232,0.16)';
      BB.rr(c, x0 + i * (sw + gap), by, sw, 10, 5);
    }
    c.globalAlpha = 1;
  }

  // =====================================================================
  // Hooks
  // =====================================================================
  BB.on('boot', () => {
    // No random enemies (anyone's) while a boss fight is on.
    for (const name in BB.enemyTypes) {
      const t = BB.enemyTypes[name];
      if (!t || t.enemiesWrapped) continue;
      const orig = t.weight;
      t.weight = function (d, G) {
        if (G && (G.enemiesBoss || G.enemiesWarn > 0)) return 0;
        return typeof orig === 'function' ? orig.call(this, d, G) : (+orig || 0);
      };
      t.enemiesWrapped = true;
    }
  });

  BB.on('newGame', G => {
    G.enemiesBoss = null;
    G.enemiesWarn = 0;
    G.enemiesWarnType = null;
    G.enemiesSiren = 0;
    G.enemiesSirenHi = false;
    G.enemiesBossIdx = 0;
    G.enemiesNextBoss = BOSS_EVERY;
    G.enemiesShower = [];
    G.enemiesLastMissile = -99;
    G.enemiesPlatN = 0;
    G.stats.bossesDefeated = 0;
  });

  BB.on('spawnRow', (rowY, G) => {
    const plats = G.plats, ens = G.enemies, W = BB.W;
    const start = Math.min(G.enemiesPlatN || 0, plats.length);
    for (let i = 0; i < ens.length; i++) {
      const e = ens[i];
      if (!e.clear || e.dead || e.remove || e.y < rowY - 140 || e.y > rowY + 160) continue;
      for (let j = start; j < plats.length; j++) clearPlat(plats[j], e, W);
    }
    // extra footholds while a boss is around, so there is always somewhere to dodge to
    if (!G.demo && (G.enemiesBoss || G.enemiesWarn > 0) && BB.platformTypes.normal && Math.random() < 0.6) {
      BB.spawnPlatform('normal', rand(0, Math.max(0, W - 64)), rowY - rand(14, 44), 64);
    }
    G.enemiesPlatN = plats.length;
  });

  BB.on('update', (dt, G) => {
    G.enemiesPlatN = G.plats.length;
    if (!live(G)) return;
    // keep screen-anchored things glued to the camera that just moved
    const ens = G.enemies;
    for (let i = 0; i < ens.length; i++) {
      const e = ens[i];
      if (e.scr && !e.dead && !e.remove) e.y = G.cam + e.sy;
    }
    const b = G.enemiesBoss;
    if (b && (b.remove || G.t - b.beat > 0.5)) { G.enemiesBoss = null; scheduleNext(G); }
    if (!G.enemiesBoss && !(G.enemiesWarn > 0) && G.maxH >= G.enemiesNextBoss) startWarning(G);
    if (G.enemiesWarn > 0) {
      G.enemiesWarn -= dt;
      G.enemiesSiren -= dt;
      if (G.enemiesSiren <= 0) {
        G.enemiesSiren = 0.32;
        G.enemiesSirenHi = !G.enemiesSirenHi;
        beep(G.enemiesSirenHi ? 660 : 440, 0.28, 'sawtooth', 0.045, 0.85);
        BB.shake(5);
      }
      if (G.enemiesWarn <= 0) { G.enemiesWarn = 0; spawnBoss(G, G.enemiesWarnType); }
    }
    updateShower(G, dt);
  });

  BB.on('revive', G => {
    const b = G.enemiesBoss;
    if (b && !b.remove && b.st !== 'dying') { setSt(b, 'rise'); b.hitCd = 0; }
    // a fair restart: clear our hazards and shots off the screen
    const ens = G.enemies;
    for (let i = 0; i < ens.length; i++) {
      const e = ens[i];
      if (MINE[e.type] && !e.remove && !e.dead && onScreen(G, e.y, 60)) poof(G, e);
    }
  });

  BB.on('drawHUD', (c, G) => {
    if (G.enemiesWarn > 0) drawWarning(c, G);
    const b = G.enemiesBoss;
    if (b && !b.remove) drawBossBar(c, b, G);
  });

  // =====================================================================
  // Public helpers + debug
  // =====================================================================
  function startBoss(type, instant) {
    const G = BB.G;
    if (!live(G) || !BB.running || G.enemiesBoss || G.enemiesWarn > 0) return false;
    if (!instant) return startWarning(G, type);
    if (!type || !BOSS[type]) type = BOSS_ORDER[(G.enemiesBossIdx || 0) % BOSS_ORDER.length];
    startWarning(G, type);
    G.enemiesWarn = 0;
    return !!spawnBoss(G, type);
  }
  BB.enemies = {
    bossTypes: BOSS_ORDER.slice(),
    every: BOSS_EVERY,
    bossActive() { const G = BB.G; return !!(G && (G.enemiesBoss || G.enemiesWarn > 0)); },
    boss() { const G = BB.G; return (G && G.enemiesBoss) || null; },
    startBoss
  };
  if (BB.debug) {
    BB.debug.boss = type => startBoss(type, false);
    BB.debug.bossNow = type => startBoss(type, true);
    BB.debug.bossHit = () => {
      const G = BB.G, b = G && G.enemiesBoss;
      if (!b || b.remove) return false;
      b.hitCd = 0;
      return bossHit(b, G, true);
    };
  }
})(window.BB);
