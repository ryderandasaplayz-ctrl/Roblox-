/* =====================================================================
   features/powerups.js - NEW POWER-UPS + EFFECTS
   Owner: the "powerups" agent. Edit only this file.

   Adds these pickups (BB.itemTypes) and the effects they grant
   (BB.effectTypes):
     propeller  Propeller Hat: slow, steerable flight up for 4s
     rocket     Rocket: super fast launch for 1.5s, flames + shake
     star       Super Star: invincible 6s, smash enemies for bonus coins
     coins2x    Double Coins: every coin counts twice for 12s
     slowmo     Slow-Mo: the world runs at half speed for 6s
     giant      Giant: 1.8x size for 8s, flattens enemies, bigger bounce
     tiny       Tiny: 0.6x size for 8s with turbo steering (rare)
     bubble     Bubble Saver: the next fall (within 20s) pops the
                bubble and floats you back up
     springs    Spring Shoes: your next 5 landings bounce 1.5x
     mystery    Gift box: spins a slot-machine reel, then gives a
                random prize (any power-up above, jetpack, shield,
                magnet or a Coin Rain)
   Also gives the core magnet a field-line look and draws vector HUD
   icons on top of the effect badges.

   Notes for other features:
   - Size changes set G.p.r (physics). The ball is drawn scaled by
     wrapping BB.equipped('skin') for one call per frame, so skins,
     eyes, hats and 'drawPlayer' hooks all scale with it (inside the
     player draw, p.r is the normal radius again).
   - Bigger bounces (giant, springs) are applied in a 'land' hook, NOT
     through mods.jumpMult, so core's reachable-gap maths is untouched.
   - Public: BB.powerups.grant(name), BB.powerups.mystery(name?).
     Event 'powerups:grant' (name, G) after a pickup is applied.
   - Debug: BB.debug.powerupsShowcase(), BB.debug.powerupsGive(name),
     BB.debug.powerupsMystery(name?), BB.debug.powerupsList.
   ===================================================================== */
(function (BB) {
  'use strict';
  if (!BB || !BB.effectTypes || !BB.itemTypes || typeof BB.on !== 'function') return;

  // ------------------------------------------------------------------
  // Tuning
  // ------------------------------------------------------------------
  const TAU = Math.PI * 2;
  const INK = '#140b2e';
  const CREAM = '#fff7e8';
  const GIANT_K = 1.8, TINY_K = 0.6;
  const SPRING_N = 5, SPRING_BOOST = 1.5, GIANT_BOOST = 1.15;
  const PROP_VY = -560, ROCKET_VY = -1650, EXIT_VY = -900;
  const COOL_ROWS = 7; // rows with none of our pickups after one spawned

  // name -> display info. `secs` = effect length for pickups.
  const INFO = {
    propeller: { label: 'Propeller', toast: 'PROPELLER HAT!', color: '#c58cff', icon: 'P', secs: 4 },
    rocket: { label: 'Rocket', toast: 'ROCKET!', color: '#ff5a4f', icon: 'R', secs: 1.5 },
    star: { label: 'Super Star', toast: 'SUPER STAR!', color: '#ffe14d', icon: '*', secs: 6 },
    coins2x: { label: 'Double Coins', toast: 'DOUBLE COINS!', color: '#ffcf3f', icon: '2', secs: 12 },
    slowmo: { label: 'Slow-Mo', toast: 'SLOW-MO!', color: '#5b8cff', icon: 'T', secs: 6 },
    giant: { label: 'Giant', toast: 'GIANT MODE!', color: '#9cff57', icon: 'G', secs: 8 },
    tiny: { label: 'Tiny', toast: 'TINY MODE!', color: '#ff9ad5', icon: 'm', secs: 8 },
    bubble: { label: 'Bubble', toast: 'BUBBLE SAVER!', color: '#7ff0ff', icon: 'B', secs: 20 },
    springs: { label: 'Spring Shoes', toast: 'SPRING SHOES!', color: '#3ff0c0', icon: 'W', secs: SPRING_N },
    coinrain: { label: 'Coin Rain', toast: 'COIN RAIN!', color: '#ffcf3f' },
    jet: { label: 'Jetpack', toast: 'JETPACK!', color: '#ff8a3d', secs: 2.5 },
    shield: { label: 'Shield', toast: 'SHIELD!', color: '#8fd8ff', secs: 8 },
    magnet: { label: 'Magnet', toast: 'COIN MAGNET!', color: '#ff4fa3', secs: 8 },
    mystery: { label: 'Mystery Box', toast: 'MYSTERY BOX!', color: '#ffcf3f' }
  };
  for (const k in INFO) INFO[k].up = INFO[k].label.toUpperCase();

  // Spawn chance per row (absolute, like core) + the height they unlock at.
  // Core power-ups are .03 each; ours add up to ~.036 with a row cooldown,
  // so one of ours shows up about 3-5 times a minute (1-2 early on).
  const ITEMS = {
    propeller: { w: 0.0055, min: 0 },
    springs: { w: 0.0055, min: 0 },
    coins2x: { w: 0.0045, min: 0 },
    mystery: { w: 0.0045, min: 200 },
    bubble: { w: 0.004, min: 300 },
    rocket: { w: 0.0035, min: 600 },
    giant: { w: 0.003, min: 800 },
    slowmo: { w: 0.003, min: 1200 },
    star: { w: 0.0025, min: 1500 },
    tiny: { w: 0.0012, min: 2500 }
  };
  const ITEM_NAMES = Object.keys(ITEMS);

  // What the mystery box can give, with relative weights.
  const MYSTERY_POOL = [
    ['rocket', 3], ['propeller', 3], ['star', 2], ['coins2x', 3], ['slowmo', 2], ['giant', 3],
    ['tiny', 3], ['bubble', 3], ['springs', 3], ['coinrain', 3], ['jet', 1], ['shield', 2], ['magnet', 2]
  ];

  // ------------------------------------------------------------------
  // Small helpers (nothing here allocates per frame)
  // ------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function circ(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
  function ring(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke(); }
  function oval(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); c.fill(); }
  function rrPath(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
  function tri(c, x1, y1, x2, y2, x3, y3) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.closePath(); c.fill(); }
  function sparkle(c, x, y, s) { c.fillRect(x - s, y - 0.8, s * 2, 1.6); c.fillRect(x - 0.8, y - s, 1.6, s * 2); }

  const RAINBOW = [];
  for (let i = 0; i < 36; i++) RAINBOW.push('hsl(' + (i * 10) + ',95%,62%)');
  function rainbow(t, off) { const i = Math.floor(t * 20 + (off || 0)) % 36; return RAINBOW[i < 0 ? i + 36 : i]; }
  const FLAME = ['#fff7e8', '#ffcf3f', '#ff8a3d', '#ff4fa3'];
  const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const STAR_PTS = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.45 : 1;
    STAR_PTS.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  function starPath(c, x, y, R) {
    c.beginPath();
    for (let i = 0; i < 10; i++) c.lineTo(x + STAR_PTS[i * 2] * R, y + STAR_PTS[i * 2 + 1] * R);
    c.closePath();
  }
  const fonts = {};
  function font(px, display) {
    const k = (display ? 'd' : 'b') + px;
    return fonts[k] || (fonts[k] = display ? px + 'px Bungee, Impact, sans-serif' : '900 ' + px + 'px Nunito, system-ui, sans-serif');
  }

  function live(G) { return !!(G && !G.dead && !G.demo); }
  function beep(f, d, type, v, slide) { try { BB.beep(f, d, type, v, slide); } catch (e) { /* no audio */ } }
  function later(ms, f, d, type, v, slide) { setTimeout(beep, ms, f, d, type, v, slide || 0); }
  function seq(list, gap, d, type, v) { for (let i = 0; i < list.length; i++) later(i * gap, list[i], d, type, v, 0); }
  function buzz(x) { try { if (BB.vibrate) BB.vibrate(x); } catch (e) { /* no vibration */ } }
  function toast(text, color) { try { BB.ui.toast(text, color); } catch (e) { /* no UI */ } }
  function part(x, y, vx, vy, life, col, size, grav) { return BB.emitParticle ? BB.emitParticle(x, y, vx, vy, life, col, size, grav) : null; }
  function colorOf(name, t) { return name === 'star' ? rainbow(t, 0) : (INFO[name] ? INFO[name].color : CREAM); }

  // ------------------------------------------------------------------
  // Sounds (pickup jingles; built from core beeps)
  // ------------------------------------------------------------------
  const SFX = {
    propeller() { seq([392, 523, 659, 784], 55, 0.09, 'triangle', 0.06); beep(160, 0.5, 'sawtooth', 0.025, 2); },
    rocket() { beep(90, 0.7, 'sawtooth', 0.08, 9); beep(140, 0.45, 'square', 0.04, 5); later(120, 60, 0.5, 'sawtooth', 0.05, 0.5); },
    star() { seq([523, 659, 784, 1047, 1319, 1568], 60, 0.1, 'square', 0.05); },
    coins2x() { seq([988, 1318, 1568, 1976], 70, 0.09, 'square', 0.045); },
    slowmo() { beep(700, 0.8, 'sine', 0.08, 0.25); beep(350, 0.8, 'triangle', 0.04, 0.25); },
    giant() { beep(110, 0.5, 'square', 0.05, 2.5); seq([196, 262, 330, 392], 80, 0.12, 'triangle', 0.07); },
    tiny() { beep(900, 0.35, 'sine', 0.06, 2.4); later(90, 1568, 0.06, 'square', 0.03); later(160, 2093, 0.06, 'square', 0.03); },
    bubble() { beep(320, 0.18, 'sine', 0.08, 2.4); later(120, 520, 0.16, 'sine', 0.07, 2); },
    springs() { beep(220, 0.3, 'sine', 0.08, 3.5); later(160, 330, 0.25, 'sine', 0.06, 3); },
    coinrain() { seq([1318, 1568, 1976, 2637, 1976, 2637], 50, 0.07, 'square', 0.04); },
    jet() { beep(200, 0.5, 'sawtooth', 0.06, 4); },
    shield() { beep(600, 0.3, 'sine', 0.08, 2); },
    magnet() { beep(500, 0.3, 'triangle', 0.08, 2); }
  };
  const STAR_TUNE = [523, 784, 659, 784, 1047, 784, 659, 784, 587, 880, 698, 880, 1175, 880, 698, 880];

  // ------------------------------------------------------------------
  // Vector icons: (ctx, x, y, scale, time, badgeColor). Drawn in ink on
  // top of a coloured badge of radius ~15*scale. Used by the pickups,
  // the HUD effect row and the mystery reel.
  // ------------------------------------------------------------------
  const ICON = {
    propeller(c, x, y, s, t) {
      c.fillStyle = INK;
      c.beginPath(); c.arc(x, y + 5 * s, 7.5 * s, Math.PI, TAU); c.closePath(); c.fill();
      c.fillRect(x - 10 * s, y + 4 * s, 20 * s, 3 * s);
      c.fillRect(x - 1.3 * s, y - 5 * s, 2.6 * s, 4 * s);
      const k = Math.abs(Math.cos(t * 14));
      oval(c, x, y - 6 * s, 10.5 * s * k + 0.8, 2.3 * s);
    },
    rocket(c, x, y, s, t, col) {
      c.fillStyle = INK;
      c.beginPath();
      c.moveTo(x, y - 11 * s);
      c.quadraticCurveTo(x + 6.5 * s, y - 4 * s, x + 4.5 * s, y + 4 * s);
      c.lineTo(x - 4.5 * s, y + 4 * s);
      c.quadraticCurveTo(x - 6.5 * s, y - 4 * s, x, y - 11 * s);
      c.fill();
      tri(c, x - 4.5 * s, y - 1 * s, x - 9 * s, y + 6 * s, x - 3.5 * s, y + 4 * s);
      tri(c, x + 4.5 * s, y - 1 * s, x + 9 * s, y + 6 * s, x + 3.5 * s, y + 4 * s);
      const f = 3 + Math.abs(Math.sin(t * 30)) * 3;
      tri(c, x - 2.6 * s, y + 5 * s, x + 2.6 * s, y + 5 * s, x, y + (5 + f) * s);
      c.fillStyle = col; circ(c, x, y - 3 * s, 2.1 * s);
    },
    star(c, x, y, s, t, col) {
      c.fillStyle = INK; starPath(c, x, y + 0.6 * s, 11 * s); c.fill();
      c.fillStyle = col;
      c.fillRect(x - 3 * s, y - 1.2 * s, 1.7 * s, 3.4 * s);
      c.fillRect(x + 1.3 * s, y - 1.2 * s, 1.7 * s, 3.4 * s);
    },
    coins2x(c, x, y, s) {
      c.strokeStyle = INK; c.lineWidth = 2 * s; ring(c, x, y, 9.5 * s);
      c.fillStyle = INK; c.font = font(Math.round(11 * s), false);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('2X', x, y + 0.8 * s);
    },
    slowmo(c, x, y, s, t) {
      c.fillStyle = INK;
      circ(c, x - 6 * s, y - 7 * s, 2.6 * s); circ(c, x + 6 * s, y - 7 * s, 2.6 * s);
      c.strokeStyle = INK; c.lineWidth = 2.4 * s; ring(c, x, y + 1 * s, 7.5 * s);
      const a = t * 1.5 - Math.PI / 2;
      c.lineWidth = 1.8 * s; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x, y + 1 * s); c.lineTo(x + Math.cos(a) * 5 * s, y + 1 * s + Math.sin(a) * 5 * s);
      c.moveTo(x, y + 1 * s); c.lineTo(x + 3.2 * s, y + 1 * s);
      c.stroke();
      c.lineCap = 'butt';
    },
    giant(c, x, y, s, t, col) {
      c.fillStyle = INK;
      c.beginPath(); c.arc(x, y + 1 * s, 10 * s, Math.PI, TAU); c.closePath(); c.fill();
      rrPath(c, x - 4 * s, y + 0.5 * s, 8 * s, 8 * s, 2.5 * s); c.fill();
      c.fillStyle = col;
      circ(c, x - 4.5 * s, y - 3.5 * s, 2 * s); circ(c, x + 4 * s, y - 5 * s, 1.7 * s); circ(c, x + 6.2 * s, y - 0.8 * s, 1.3 * s);
    },
    tiny(c, x, y, s) {
      c.fillStyle = INK;
      circ(c, x, y, 3.4 * s);
      tri(c, x - 11 * s, y - 4 * s, x - 11 * s, y + 4 * s, x - 6 * s, y);
      tri(c, x + 11 * s, y - 4 * s, x + 11 * s, y + 4 * s, x + 6 * s, y);
      tri(c, x - 4 * s, y - 11 * s, x + 4 * s, y - 11 * s, x, y - 6 * s);
      tri(c, x - 4 * s, y + 11 * s, x + 4 * s, y + 11 * s, x, y + 6 * s);
    },
    bubble(c, x, y, s) {
      c.strokeStyle = INK; c.lineWidth = 2.2 * s; ring(c, x - 1 * s, y - 1 * s, 8 * s);
      c.lineCap = 'round';
      c.beginPath(); c.arc(x - 1 * s, y - 1 * s, 4.6 * s, Math.PI * 1.1, Math.PI * 1.5); c.stroke();
      c.lineCap = 'butt';
      c.fillStyle = INK; circ(c, x + 7.5 * s, y + 7 * s, 2.2 * s);
    },
    springs(c, x, y, s) {
      c.fillStyle = INK;
      rrPath(c, x - 8 * s, y - 10 * s, 11 * s, 6 * s, 2.5 * s); c.fill();
      circ(c, x + 3 * s, y - 6.5 * s, 3 * s);
      c.strokeStyle = INK; c.lineWidth = 2 * s; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(x, y - 4 * s);
      for (let i = 1; i <= 4; i++) c.lineTo(x + (i % 2 ? 5 : -5) * s, y + (-4 + i * 2.6) * s);
      c.lineTo(x, y + 8 * s);
      c.stroke();
      c.lineJoin = 'miter';
      c.fillRect(x - 6 * s, y + 8 * s, 12 * s, 2.4 * s);
    },
    coinrain(c, x, y, s, t, col) {
      c.fillStyle = INK;
      circ(c, x - 5 * s, y - 4 * s, 4.5 * s); circ(c, x + 5 * s, y - 1 * s, 4.5 * s); circ(c, x - 1 * s, y + 6 * s, 4.5 * s);
      c.fillStyle = col;
      circ(c, x - 5 * s, y - 4 * s, 1.8 * s); circ(c, x + 5 * s, y - 1 * s, 1.8 * s); circ(c, x - 1 * s, y + 6 * s, 1.8 * s);
    },
    jet(c, x, y, s, t) {
      c.fillStyle = INK;
      rrPath(c, x - 8 * s, y - 9 * s, 7 * s, 13 * s, 3 * s); c.fill();
      rrPath(c, x + 1 * s, y - 9 * s, 7 * s, 13 * s, 3 * s); c.fill();
      const f = 3 + Math.abs(Math.sin(t * 28)) * 3;
      tri(c, x - 7 * s, y + 5 * s, x - 2 * s, y + 5 * s, x - 4.5 * s, y + (5 + f) * s);
      tri(c, x + 2 * s, y + 5 * s, x + 7 * s, y + 5 * s, x + 4.5 * s, y + (5 + f) * s);
    },
    shield(c, x, y, s, t, col) {
      c.fillStyle = INK;
      c.beginPath();
      c.moveTo(x, y - 10 * s);
      c.lineTo(x + 8 * s, y - 7 * s);
      c.quadraticCurveTo(x + 8 * s, y + 5 * s, x, y + 10 * s);
      c.quadraticCurveTo(x - 8 * s, y + 5 * s, x - 8 * s, y - 7 * s);
      c.closePath(); c.fill();
      c.fillStyle = col;
      c.fillRect(x - 1.2 * s, y - 6 * s, 2.4 * s, 11 * s);
      c.fillRect(x - 5 * s, y - 2 * s, 10 * s, 2.4 * s);
    },
    magnet(c, x, y, s, t, col) {
      c.strokeStyle = INK; c.lineWidth = 4.2 * s;
      c.beginPath();
      c.moveTo(x - 6 * s, y - 8 * s); c.lineTo(x - 6 * s, y + 1 * s);
      c.arc(x, y + 1 * s, 6 * s, Math.PI, 0, true);
      c.lineTo(x + 6 * s, y - 8 * s);
      c.stroke();
      c.fillStyle = CREAM;
      c.fillRect(x - 8.1 * s, y - 10 * s, 4.2 * s, 3.4 * s);
      c.fillRect(x + 3.9 * s, y - 10 * s, 4.2 * s, 3.4 * s);
    },
    mystery(c, x, y, s) { qMark(c, x, y, s, INK); }
  };
  function qMark(c, x, y, s, col) {
    c.strokeStyle = col; c.fillStyle = col;
    c.lineWidth = 2.8 * s; c.lineCap = 'round';
    c.beginPath();
    c.arc(x, y - 3 * s, 4.2 * s, Math.PI * 1.05, Math.PI * 2.3);
    c.lineTo(x, y + 3 * s);
    c.stroke();
    c.lineCap = 'butt';
    circ(c, x, y + 7.5 * s, 1.8 * s);
  }

  // ------------------------------------------------------------------
  // Pickup drawing (world space)
  // ------------------------------------------------------------------
  function drawPickup(c, it, G, name) {
    const t = G.t, x = it.x, y = it.y + Math.sin(t * 4 + it.x) * 3;
    const col = colorOf(name, t);
    const pulse = 0.5 + 0.5 * Math.sin(t * 5 + it.x * 0.1);
    c.globalAlpha = 0.16 + 0.14 * pulse;
    c.fillStyle = col; circ(c, x, y, 20 + 3 * pulse);
    c.globalAlpha = 1;
    c.fillStyle = CREAM; circ(c, x, y, 16.5);
    c.fillStyle = col; circ(c, x, y, 14.5);
    const ic = ICON[name];
    if (ic) ic(c, x, y, 1, t, col);
    const a = t * 3 + it.x;
    c.fillStyle = CREAM;
    sparkle(c, x + Math.cos(a) * 20, y + Math.sin(a) * 20, 1.5 + pulse * 2);
  }

  // A gift box with a rainbow ribbon and a "?" (different from the
  // platforms feature's pink "?" block).
  function drawGift(c, it, G) {
    const t = G.t, x = it.x, y = it.y + Math.sin(t * 4 + it.x) * 3;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6 + it.x);
    c.globalAlpha = 0.18 + 0.14 * pulse;
    c.fillStyle = rainbow(t, 0); circ(c, x, y, 22 + 3 * pulse);
    c.globalAlpha = 1;
    c.save();
    c.translate(x, y);
    c.rotate(Math.sin(t * 3 + it.x) * 0.14);
    const rib = rainbow(t, 9);
    c.fillStyle = '#b8860b'; rrPath(c, -14, -9, 28, 24, 6); c.fill();
    c.fillStyle = '#ffcf3f'; rrPath(c, -14, -10, 28, 22, 6); c.fill();
    c.fillStyle = rib; c.fillRect(-3, -10, 6, 22);
    c.fillStyle = '#ffe58a'; rrPath(c, -16, -16, 32, 9, 4); c.fill();
    c.fillStyle = rib; c.fillRect(-3, -16, 6, 9);
    c.beginPath(); c.ellipse(-6, -19, 6, 3.6, -0.5, 0, TAU); c.ellipse(6, -19, 6, 3.6, 0.5, 0, TAU); c.fill();
    c.fillStyle = INK;
    rrPath(c, -9, -6, 18, 16, 5); c.fill();
    qMark(c, 0, 1 - Math.abs(Math.sin(t * 5)) * 1.5, 0.82, '#ffcf3f');
    c.restore();
    c.fillStyle = CREAM;
    const a = t * 3 + it.x;
    sparkle(c, x + Math.cos(a) * 22, y + Math.sin(a) * 22, 1.5 + pulse * 2);
  }

  // ------------------------------------------------------------------
  // Effect visuals
  // ------------------------------------------------------------------
  // world space, before the player
  // a tall rocket behind the ball: nose and fins poke out around it
  function drawRocket(c, p, G) {
    const x = p.x, y = p.y, r = p.r, t = G.realT;
    const fl = r * (2.6 + Math.sin(t * 47) * 0.35 + Math.random() * 0.4);
    const by = y + r * 1.5;
    c.fillStyle = '#ff4fa3'; tri(c, x - r * 0.75, by, x + r * 0.75, by, x, by + fl * 1.25);
    c.fillStyle = '#ff8a3d'; tri(c, x - r * 0.58, by, x + r * 0.58, by, x, by + fl);
    c.fillStyle = '#ffcf3f'; tri(c, x - r * 0.38, by, x + r * 0.38, by, x, by + fl * 0.66);
    c.fillStyle = CREAM; tri(c, x - r * 0.18, by, x + r * 0.18, by, x, by + fl * 0.34);
    c.fillStyle = '#b8233a';
    tri(c, x - r * 0.7, y + r * 0.1, x - r * 1.5, y + r * 1.55, x - r * 0.7, y + r * 1.3);
    tri(c, x + r * 0.7, y + r * 0.1, x + r * 1.5, y + r * 1.55, x + r * 0.7, y + r * 1.3);
    c.fillStyle = '#ff5a4f'; rrPath(c, x - r * 0.78, y - r * 1.95, r * 1.56, r * 3.35, r * 0.5); c.fill();
    c.fillStyle = CREAM;
    c.beginPath(); c.moveTo(x - r * 0.78, y - r * 1.75); c.quadraticCurveTo(x, y - r * 3.3, x + r * 0.78, y - r * 1.75); c.fill();
    c.fillStyle = '#ffcf3f'; c.fillRect(x - r * 0.78, y - r * 1.55, r * 1.56, r * 0.2);
    c.fillStyle = '#5a3a6a'; c.fillRect(x - r * 0.55, y + r * 1.35, r * 1.1, r * 0.22);
  }
  function drawCoinOrbit(c, p, G) {
    const t = G.realT * 4, R = p.r + 12;
    for (let i = 0; i < 2; i++) {
      const a = t + i * Math.PI;
      const x = p.x + Math.cos(a) * R, y = p.y + Math.sin(a) * R * 0.45 - 4;
      const sx = Math.abs(Math.cos(a * 1.7)) * 4.5 + 1;
      c.fillStyle = '#b8860b'; oval(c, x, y + 1.2, sx, 5.5);
      c.fillStyle = '#ffcf3f'; oval(c, x, y, sx, 5.5);
    }
  }
  function drawAfterimages(c, p, G) {
    const tr = G.trail, n = tr ? tr.length : 0;
    if (!n) return;
    c.fillStyle = '#5b8cff';
    for (let k = 1; k <= 3; k++) {
      const q = tr[n - 1 - k * 4];
      if (!q) continue;
      c.globalAlpha = 0.26 - k * 0.06;
      circ(c, q.x, q.y, p.r);
    }
    c.globalAlpha = 1;
  }
  function drawMagnetField(c, p, G) {
    const range = clamp(BB.mods.magnetRange || 220, 60, 420);
    const t = G.realT, r0 = p.r + 8;
    c.strokeStyle = '#ff4fa3';
    c.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.8 + i / 3) % 1;
      c.globalAlpha = 0.42 * Math.sin(ph * Math.PI);
      ring(c, p.x, p.y, r0 + (range - r0) * (1 - ph));
    }
    const items = G.items, r2 = range * range;
    let n = 0;
    c.globalAlpha = 0.5; c.lineWidth = 1.5; c.strokeStyle = '#ffcf3f';
    c.beginPath();
    for (let i = 0; i < items.length && n < 12; i++) {
      const it = items[i];
      if (it.got) continue;
      const tt = BB.itemTypes[it.type];
      if (!tt || !tt.magnetic) continue;
      const dx = it.x - p.x, dy = it.y - p.y;
      if (dx * dx + dy * dy > r2) continue;
      const bend = Math.sin(t * 9 + i) * 0.25;
      c.moveTo(p.x, p.y);
      c.quadraticCurveTo(p.x + dx * 0.5 - dy * bend, p.y + dy * 0.5 + dx * bend, it.x, it.y);
      n++;
    }
    if (n) c.stroke();
    c.globalAlpha = 1;
  }

  // player-local space (inside the player's scale/squash)
  function drawPropHat(c, r, G) {
    const y = -r + 3;
    c.fillStyle = '#c58cff';
    c.beginPath(); c.arc(0, y, 10, Math.PI, TAU); c.closePath(); c.fill();
    c.fillStyle = '#ffcf3f';
    c.beginPath(); c.moveTo(0, y); c.arc(0, y, 10, Math.PI * 1.38, Math.PI * 1.62); c.closePath(); c.fill();
    c.fillStyle = '#8d5ad8'; BB.rr(c, -13, y - 1, 26, 4, 2);
    c.fillStyle = CREAM; c.fillRect(-1.2, y - 17, 2.4, 8);
    const a = G.realT * 30, k = Math.cos(a), ak = Math.abs(k);
    c.globalAlpha = 0.22; oval(c, 0, y - 17, 19, 3.4); c.globalAlpha = 1;
    c.fillStyle = '#ff4fa3'; oval(c, 9.5 * k, y - 17, 9.5 * ak + 0.8, 2.6);
    c.fillStyle = '#3ff0c0'; oval(c, -9.5 * k, y - 17, 9.5 * ak + 0.8, 2.6);
    c.fillStyle = '#ffcf3f'; circ(c, 0, y - 17, 2.6);
  }
  function drawSpringShoes(c, r) {
    c.strokeStyle = '#3ff0c0'; c.lineWidth = 2.4; c.lineJoin = 'round';
    c.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const x = side * 7;
      c.moveTo(x, r - 2);
      for (let i = 1; i <= 4; i++) c.lineTo(x + (i % 2 ? 4 : -4), r - 2 + i * 2.4);
      c.lineTo(x, r + 10);
    }
    c.stroke();
    c.lineJoin = 'miter';
    c.fillStyle = '#ff4fa3';
    BB.rr(c, -14, r + 9, 13, 4.5, 2);
    BB.rr(c, 1, r + 9, 13, 4.5, 2);
  }
  function drawBubble(c, r, G, big, rem) {
    let fade = 1;
    if (!big && rem < 2) fade = ((G.realT * 8) | 0) % 2 ? 0.35 : 1;
    const t = G.realT, R = r + (big ? 15 : 10) + Math.sin(t * 5) * 1.2;
    const sx = 1 + Math.sin(t * 7) * 0.05;
    c.save();
    c.scale(sx, 2 - sx);
    c.globalAlpha = 0.17 * fade; c.fillStyle = '#7ff0ff'; circ(c, 0, 0, R);
    c.globalAlpha = 0.9 * fade; c.strokeStyle = '#bff8ff'; c.lineWidth = 2.5; ring(c, 0, 0, R);
    c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.arc(0, 0, R - 5, Math.PI * 1.12, Math.PI * 1.42); c.stroke();
    c.fillStyle = '#ffffff'; circ(c, R * 0.5, -R * 0.52, 2);
    c.restore();
  }
  // rainbow body tint: painted by the skin proxy, before the eyes
  function starTint(c, p, G) {
    const rem = p.effects.star || 0;
    const blink = rem < 1.5 && ((G.realT * 10) | 0) % 2 === 0;
    c.globalAlpha = blink ? 0.15 : 0.62;
    c.fillStyle = rainbow(G.realT, 0); circ(c, 0, 0, p.r);
    c.globalAlpha = 0.5; c.fillStyle = '#ffffff';
    oval(c, -p.r * 0.38, -p.r * 0.5, p.r * 0.32, p.r * 0.17);
    c.globalAlpha = 1;
  }
  function drawStarAura(c, r, G) {
    const t = G.realT;
    c.strokeStyle = rainbow(t, 18); c.lineWidth = 3;
    c.globalAlpha = 0.85; ring(c, 0, 0, r + 4);
    c.globalAlpha = 1;
    c.fillStyle = CREAM;
    for (let i = 0; i < 3; i++) {
      const a = t * 3 + i * 2.09, d = r + 9 + Math.sin(t * 7 + i) * 3;
      sparkle(c, Math.cos(a) * d, Math.sin(a) * d, 2 + Math.abs(Math.sin(t * 6 + i * 2)) * 2.5);
    }
  }

  // ------------------------------------------------------------------
  // Effects
  // ------------------------------------------------------------------
  const FX = BB.effectTypes;

  FX.propeller = {
    icon: 'P', color: INFO.propeller.color, label: 'Propeller Hat', noLand: true, invincible: true,
    onStart(p, G) { BB.mods.steerMult *= 1.25; if (G) G.powerupsPropSnd = 0; },
    onEnd(p) {
      BB.mods.steerMult /= 1.25;
      p.grace = Math.max(p.grace || 0, 0.5);
      BB.burst(p.x, p.y - p.r, '#e9dcff', 8, 120);
    },
    update(p, dt, G) {
      const fx = p.effects;
      if (fx.rocket > 0 || fx.jet > 0) return; // the faster ride wins
      const rem = fx.propeller || 0;
      let target = PROP_VY + Math.sin(G.t * 9) * 40;
      if (rem < 0.6) target *= 0.4 + rem; // ease out so the drop feels soft
      p.vy += (target - p.vy) * Math.min(1, dt * 7);
      if (Math.random() < 0.3) part(p.x + rand(-14, 14), p.y - p.r * 1.7, rand(-80, 80), rand(-20, 40), 0.3, '#e9dcff', 3, 0);
      G.powerupsPropSnd -= BB.rawDt;
      if (G.powerupsPropSnd <= 0) { G.powerupsPropSnd = 0.09; beep(140 + Math.random() * 30, 0.06, 'triangle', 0.025, 1.4); }
    }
  };

  FX.rocket = {
    icon: 'R', color: INFO.rocket.color, label: 'Rocket', noLand: true, invincible: true,
    onStart(p, G) {
      BB.shake(16);
      BB.flash('#ff8a3d', 0.35);
      if (p.vy > EXIT_VY) p.vy = EXIT_VY;
      if (G) G.powerupsRocketSnd = 0;
    },
    onEnd(p) {
      if (p.vy < EXIT_VY) p.vy = EXIT_VY;
      p.grace = Math.max(p.grace || 0, 0.8);
      BB.burst(p.x, p.y + p.r, '#a99bd6', 14, 160);
    },
    update(p, dt, G) {
      const rem = p.effects.rocket || 0;
      p.vy = rem < 0.25 ? EXIT_VY + (ROCKET_VY - EXIT_VY) * (rem / 0.25) : ROCKET_VY;
      BB.shake(5);
      const r = p.r;
      for (let i = 0; i < 3; i++) {
        part(p.x + rand(-0.5, 0.5) * r, p.y + r * 2.6, rand(-80, 80), rand(260, 540), rand(0.3, 0.5),
          FLAME[(Math.random() * 4) | 0], rand(5, 8), -150);
      }
      if (Math.random() < 0.6) part(p.x + rand(-0.7, 0.7) * r, p.y + r * 3.2, rand(-50, 50), rand(80, 160), 0.7, '#a99bd6', 8, -60);
      G.powerupsRocketSnd -= BB.rawDt;
      if (G.powerupsRocketSnd <= 0) { G.powerupsRocketSnd = 0.07; beep(55 + Math.random() * 35, 0.09, 'sawtooth', 0.03, 0.7); }
    },
    draw: drawRocket
  };

  FX.star = {
    icon: '*', color: INFO.star.color, label: 'Super Star', invincible: true,
    onStart(p, G) {
      BB.mods.steerMult *= 1.2;
      if (G) { G.powerupsBeat = 0.25; G.powerupsBeatI = 0; }
      BB.flash('#fff7e8', 0.3);
    },
    onEnd(p) { BB.mods.steerMult /= 1.2; BB.burst(p.x, p.y, '#ffe14d', 10, 160); },
    update(p, dt, G) {
      if (Math.random() < 0.6) {
        part(p.x + rand(-p.r, p.r), p.y + rand(-p.r, p.r), rand(-50, 50), rand(-60, 40), 0.5, RAINBOW[(Math.random() * 36) | 0], 4, 150);
      }
      G.powerupsBeat -= BB.rawDt;
      if (G.powerupsBeat <= 0) {
        G.powerupsBeat = 0.125;
        beep(STAR_TUNE[(G.powerupsBeatI++) % STAR_TUNE.length], 0.08, 'square', 0.02);
      }
    }
  };

  FX.coins2x = {
    icon: '2', color: INFO.coins2x.color, label: 'Double Coins',
    onStart() { BB.mods.coinMult *= 2; },
    onEnd() { BB.mods.coinMult /= 2; },
    draw: drawCoinOrbit
  };

  FX.slowmo = {
    icon: 'T', color: INFO.slowmo.color, label: 'Slow-Mo',
    // half-speed world; steering is doubled (in world time) so it feels the
    // same in real time
    onStart(p, G) { BB.mods.timeScale *= 0.5; BB.mods.steerMult *= 2; if (G) G.powerupsTick = 0; },
    onEnd() { BB.mods.timeScale /= 0.5; BB.mods.steerMult /= 2; beep(300, 0.5, 'sine', 0.05, 2.3); },
    update(p, dt, G) {
      const inp = BB.input;
      if (inp && !inp.left && !inp.right) p.vx *= Math.pow(0.02, dt); // friction at real-time speed
      G.powerupsTick -= BB.rawDt;
      if (G.powerupsTick <= 0) {
        G.powerupsTick = 0.5;
        G.powerupsTock = !G.powerupsTock;
        beep(G.powerupsTock ? 1500 : 1100, 0.03, 'square', 0.02);
      }
    },
    draw: drawAfterimages
  };

  FX.giant = {
    icon: 'G', color: INFO.giant.color, label: 'Giant', invincible: true,
    onStart(p) { if (p.effects.tiny > 0) BB.endEffect('tiny'); BB.shake(10); },
    onEnd(p) { beep(400, 0.35, 'triangle', 0.06, 0.4); BB.burst(p.x, p.y, '#9cff57', 10, 160); }
  };

  FX.tiny = {
    icon: 'm', color: INFO.tiny.color, label: 'Tiny',
    onStart(p) { if (p.effects.giant > 0) BB.endEffect('giant'); BB.mods.steerMult *= 1.6; },
    onEnd(p) { BB.mods.steerMult /= 1.6; beep(500, 0.3, 'triangle', 0.05, 0.5); BB.burst(p.x, p.y, '#ff9ad5', 8, 140); },
    update(p) {
      const sp = Math.abs(p.vx);
      if (sp > 260 && Math.random() < 0.5) {
        const dir = p.vx > 0 ? 1 : -1;
        part(p.x - dir * p.r, p.y + rand(-4, 4), -dir * 80, 0, 0.2, '#ff9ad5', 2, 0);
      }
    }
  };

  FX.bubble = {
    icon: 'B', color: INFO.bubble.color, label: 'Bubble Saver',
    onEnd(p, G) {
      if (G && G.powerupsBubbleSave) return; // popped by a save: handled there
      beep(700, 0.12, 'sine', 0.05, 0.5);
      BB.burst(p.x, p.y, '#bff8ff', 10, 140);
    },
    update(p) {
      if (Math.random() < 0.06) part(p.x + rand(-p.r, p.r), p.y + p.r, rand(-15, 15), rand(-70, -30), 0.8, '#bff8ff', 3, -20);
    }
  };

  FX.springs = {
    icon: 'W', color: INFO.springs.color, label: 'Spring Shoes',
    // the timer is pinned to the number of springy landings left (see preUpdate)
    onStart(p, G) { if (G && !(G.powerupsSprings > 0)) G.powerupsSprings = SPRING_N; },
    onEnd(p, G) { if (G) G.powerupsSprings = 0; beep(330, 0.15, 'sine', 0.04, 0.6); }
  };

  // core magnet: add a field-line look if nobody drew it yet
  if (FX.magnet && !FX.magnet.draw) FX.magnet.draw = drawMagnetField;

  // ------------------------------------------------------------------
  // Items
  // ------------------------------------------------------------------
  function makeWeight(name) {
    const base = ITEMS[name].w;
    return function (d, G) {
      if (!G || G.powerupsCool > 0) return 0;
      let w = base * (0.9 + 0.2 * (d || 0));
      if (G.p && G.p.effects && G.p.effects[name] > 0) w *= 0.25;
      return w;
    };
  }
  ITEM_NAMES.forEach(name => {
    if (name === 'mystery') return;
    const inf = INFO[name];
    BB.itemTypes[name] = {
      weight: makeWeight(name), minHeight: ITEMS[name].min, lift: 34, radius: 16,
      powerup: true, color: inf.color, icon: inf.icon,
      draw(c, it, G) { drawPickup(c, it, G, name); },
      onCollect(it) {
        BB.burst(it.x, it.y, inf.color, 14, 200);
        grant(name, false);
      }
    };
  });
  BB.itemTypes.mystery = {
    weight: makeWeight('mystery'), minHeight: ITEMS.mystery.min, lift: 36, radius: 16,
    powerup: true, color: '#ffcf3f', icon: '?',
    draw: drawGift,
    onCollect(it, p, G) {
      for (let i = 0; i < 16; i++) part(it.x, it.y, rand(-200, 200), rand(-320, -60), 0.8, RAINBOW[(i * 5) % 36], 5, 700);
      startSlot(null);
      if (G && G.stats) G.stats.mysteryBoxes = (G.stats.mysteryBoxes || 0) + 1;
    }
  };

  // ------------------------------------------------------------------
  // Granting (pickups, mystery prizes, other features)
  // ------------------------------------------------------------------
  function coinRain(G) {
    const p = G.p, W = BB.W;
    if (!BB.itemTypes.coin) { BB.addCoins(10, p.x, p.y - 30); return; }
    for (let i = 0; i < 14; i++) {
      const x = clamp(p.x + Math.sin(i * 0.8) * 70, 18, W - 18);
      BB.spawnItem('coin', x, p.y - 90 - i * 30);
    }
    BB.flash('#ffcf3f', 0.25);
  }
  function grant(name, fromBox) {
    const G = BB.G;
    if (!live(G) || !BB.running) return false;
    const inf = INFO[name];
    if (!inf || name === 'mystery') return false;
    const p = G.p;
    if (name === 'coinrain') coinRain(G);
    else if (!FX[name]) return false;
    else if (name === 'springs') { G.powerupsSprings = SPRING_N; BB.setEffect('springs', SPRING_N); }
    else BB.addEffect(name, inf.secs || 5);
    toast(inf.toast, name === 'star' ? '#ffe14d' : inf.color);
    const s = SFX[name];
    if (s) s();
    buzz(name === 'rocket' ? 60 : 25);
    if (fromBox) BB.burst(p.x, p.y, inf.color, 16, 220);
    BB.emit('powerups:grant', name, G);
    return true;
  }

  // ---- mystery box slot reel
  let poolNames = [], poolW = [], poolTotal = 0;
  function buildPool() {
    poolNames = []; poolW = []; poolTotal = 0;
    for (let i = 0; i < MYSTERY_POOL.length; i++) {
      const n = MYSTERY_POOL[i][0];
      if (n !== 'coinrain' && !FX[n]) continue;
      poolNames.push(n); poolW.push(MYSTERY_POOL[i][1]); poolTotal += MYSTERY_POOL[i][1];
    }
  }
  buildPool();
  function pickPrize() {
    if (!poolNames.length) return 'coinrain';
    let r = Math.random() * poolTotal;
    for (let i = 0; i < poolNames.length; i++) { if (r < poolW[i]) return poolNames[i]; r -= poolW[i]; }
    return poolNames[poolNames.length - 1];
  }
  function reelNext(cur) {
    if (poolNames.length < 2) return poolNames[0] || 'coinrain';
    let n = cur;
    for (let i = 0; i < 6 && n === cur; i++) n = poolNames[(Math.random() * poolNames.length) | 0];
    return n;
  }
  function startSlot(forced) {
    const G = BB.G;
    if (!live(G)) return false;
    const old = G.powerupsSlot;
    if (old && !old.done) grant(old.final, true); // a box while spinning: pay out the old one now
    const final = forced && INFO[forced] && (forced === 'coinrain' || FX[forced]) ? forced : pickPrize();
    G.powerupsSlot = { t: 0, stepT: 0, gap: 0.05, steps: 0, cur: reelNext(final), prev: null, final,
      done: false, hold: 0, slideT: 0, slideDur: 0.05 };
    toast(INFO.mystery.toast, '#ffcf3f');
    beep(440, 0.12, 'square', 0.04, 2);
    buzz(20);
    return true;
  }
  function updateSlot(G, rdt) {
    const s = G.powerupsSlot;
    if (!s) return;
    s.t += rdt;
    s.slideT += rdt;
    if (s.done) { s.hold += rdt; if (s.hold > 1.0) G.powerupsSlot = null; return; }
    s.stepT += rdt;
    if (s.stepT < s.gap) return;
    s.stepT = 0;
    s.steps++;
    s.gap *= 1.2;
    s.prev = s.cur;
    s.slideT = 0;
    if (s.gap > 0.2) {
      s.cur = s.final; s.done = true; s.hold = 0; s.slideDur = 0.16;
      beep(1568, 0.16, 'square', 0.045);
      grant(s.final, true);
    } else {
      s.cur = reelNext(s.cur);
      s.slideDur = s.gap;
      beep(620 + s.steps * 45, 0.035, 'square', 0.035);
    }
  }
  function reelRow(c, name, w, h, dy, G) {
    const inf = INFO[name];
    if (!inf) return;
    const cy = h / 2 + dy, col = colorOf(name, G.realT);
    c.fillStyle = CREAM; circ(c, 32, cy, 18);
    c.fillStyle = col; circ(c, 32, cy, 16);
    const ic = ICON[name];
    if (ic) ic(c, 32, cy, 1.05, G.realT, col);
    c.fillStyle = CREAM;
    c.font = font(17, true);
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(inf.up, 60, cy + 1, w - 72);
  }
  function drawReel(c, G) {
    const s = G.powerupsSlot;
    if (!s) return;
    const W = BB.W, L = BB.layout || {};
    const w = Math.min(232, W - 40), h = 56;
    const x0 = Math.round((W - w) / 2), y0 = Math.round((L.hudBottom || 100) + 14);
    let a = Math.min(1, s.t / 0.12);
    if (s.done && s.hold > 0.7) a = Math.max(0, 1 - (s.hold - 0.7) / 0.3);
    if (a <= 0) return;
    c.save();
    c.globalAlpha = a;
    const pop = s.done ? 1 + 0.14 * Math.max(0, 1 - s.hold / 0.22) : 1;
    c.translate(x0 + w / 2, y0 + h / 2);
    if (pop !== 1) c.scale(pop, pop);
    c.translate(-w / 2, -h / 2);
    c.fillStyle = 'rgba(20,11,46,.97)';
    rrPath(c, 0, 0, w, h, 18); c.fill();
    c.lineWidth = 3;
    c.strokeStyle = s.done ? rainbow(G.realT, 0) : '#ffcf3f';
    c.stroke();
    c.save();
    rrPath(c, 3, 3, w - 6, h - 6, 15);
    c.clip();
    const prog = Math.min(1, s.slideT / Math.max(0.01, s.slideDur));
    const e = 1 - (1 - prog) * (1 - prog) * (1 - prog);
    if (s.prev && prog < 1) reelRow(c, s.prev, w, h, e * h * 0.9, G);
    reelRow(c, s.cur, w, h, (e - 1) * h * 0.9, G);
    c.restore();
    // little tag on the top edge
    c.fillStyle = '#ffcf3f';
    rrPath(c, w / 2 - 54, -11, 108, 20, 10); c.fill();
    c.fillStyle = INK;
    c.font = font(11, false);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(s.done ? 'YOU GOT' : 'MYSTERY BOX', w / 2, -0.5);
    c.restore();
  }

  // ------------------------------------------------------------------
  // Size changes: physics radius + a scaled player draw.
  // For one BB.equipped('skin') call per frame (the core player draw) we
  // hand back a proxy skin that scales the context and draws the real
  // skin at the normal radius, so eyes/hats/drawPlayer hooks scale too.
  // ------------------------------------------------------------------
  let armed = false, swapR = 0, swapP = null, starTinted = false;
  function restoreR() {
    if (swapP) { swapP.r = swapR; swapP = null; swapR = 0; }
  }
  const proxy = {
    id: null, name: '', price: 0, color: null, base: null,
    draw(c, p, t) {
      const base = this.base, G = BB.G;
      armed = false;
      const mine = !!(G && p === G.p);
      if (mine && !swapP) {
        const b = G.powerupsBaseR || 16;
        if (p.r > 0 && Math.abs(p.r - b) > 0.01) {
          const k = p.r / b;
          c.scale(k, k);
          swapP = p; swapR = p.r;
          p.r = b;
        }
      }
      if (base && typeof base.draw === 'function') base.draw(c, p, t);
      else { c.fillStyle = BB.util.paint(base && base.color ? base.color : '#ffcf3f', t || 0); circ(c, 0, 0, p.r); }
      if (mine && p.effects && p.effects.star > 0) { starTint(c, p, G); starTinted = true; }
    }
  };
  const origEquipped = BB.equipped;
  if (typeof origEquipped === 'function') {
    BB.equipped = function (kind) {
      const it = origEquipped.apply(this, arguments);
      if (!armed || kind !== 'skin') return it;
      proxy.base = it;
      proxy.id = it ? it.id : null;
      proxy.name = it ? it.name : '';
      proxy.price = it ? it.price : 0;
      proxy.color = it ? it.color : null;
      return proxy;
    };
  }
  function targetR(G) {
    const fx = G.p.effects, b = G.powerupsBaseR || 16;
    return b * (fx.giant > 0 ? GIANT_K : fx.tiny > 0 ? TINY_K : 1);
  }

  // ------------------------------------------------------------------
  // Screen-space extras
  // ------------------------------------------------------------------
  let vg = null, vgW = 0, vgH = 0;
  function drawVignette(c, a) {
    const W = BB.W, H = BB.H;
    if (!vg || vgW !== W || vgH !== H) {
      vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.sqrt(W * W + H * H) * 0.55);
      vg.addColorStop(0, 'rgba(70,140,255,0)');
      vg.addColorStop(0.5, 'rgba(70,140,255,0.18)');
      vg.addColorStop(1, 'rgba(40,90,255,0.7)');
      vgW = W; vgH = H;
    }
    c.save();
    c.setTransform(BB.DPR, 0, 0, BB.DPR, 0, 0);
    c.globalAlpha = a;
    c.fillStyle = 'rgba(80,150,255,0.10)';
    c.fillRect(0, 0, W, H);
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);
    c.restore();
  }
  function drawSpeedLines(c, G, a) {
    const W = BB.W, H = BB.H, t = G.realT;
    c.strokeStyle = CREAM; c.lineWidth = 2; c.globalAlpha = 0.32 * a;
    c.beginPath();
    for (let i = 0; i < 12; i++) {
      const x = ((i * 0.618034 + 0.13) % 1) * W;
      const y = G.cam + ((i * 0.37 + t * 2.4) % 1) * (H + 160) - 80;
      const len = 40 + (i % 3) * 22;
      c.moveTo(x, y); c.lineTo(x, y + len);
    }
    c.stroke();
    c.globalAlpha = 1;
  }
  function drawHudIcons(c, G) {
    const fx = G.p.effects, L = BB.layout || {};
    let x = (L.hudX || 16) + 20;
    const y = (L.effectsY || 50) + 22;
    for (const name in fx) {
      const ic = ICON[name];
      if (ic && INFO[name]) {
        const col = colorOf(name, G.realT);
        c.fillStyle = col; circ(c, x, y, 15);
        ic(c, x, y, 0.82, G.realT, col);
        if (name === 'springs' && G.powerupsSprings > 0) {
          c.fillStyle = '#ff4fa3'; circ(c, x + 13, y + 12, 8);
          c.fillStyle = CREAM;
          c.font = font(11, false);
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(DIGITS[Math.min(9, G.powerupsSprings)], x + 13, y + 12.5);
        }
      }
      x += 48;
    }
  }

  // ------------------------------------------------------------------
  // Hooks
  // ------------------------------------------------------------------
  // late priority: runs after anyone else who might change p.r
  BB.on('newGame', G => {
    G.powerupsBaseR = G.p.r || 16;
    G.powerupsR = G.powerupsBaseR;
    G.powerupsCool = 0;
    G.powerupsSprings = 0;
    G.powerupsCarry = 0;
    G.powerupsSlot = null;
    G.powerupsSlowA = 0;
    G.powerupsRocketA = 0;
    G.powerupsBubbleSave = false;
    G.powerupsPropSnd = 0; G.powerupsRocketSnd = 0; G.powerupsBeat = 0; G.powerupsBeatI = 0;
    G.powerupsTick = 0; G.powerupsTock = false;
    G.stats.mysteryBoxes = 0;
    G.stats.bubbleSaves = 0;
    G.stats.starSmashes = 0;
    armed = false; swapP = null; swapR = 0; starTinted = false;
  }, -50);

  // our pickups never come in clumps: a few quiet rows after each one
  BB.on('spawnRow', (rowY, G) => {
    if (G.powerupsCool > 0) G.powerupsCool--;
    const items = G.items;
    for (let i = items.length - 1, n = 0; i >= 0 && n < 4; i--, n++) {
      const it = items[i];
      if (it.age > 0 || it.powerupsSeen) break;
      it.powerupsSeen = true;
      if (ITEMS[it.type]) G.powerupsCool = COOL_ROWS;
    }
  });

  BB.on('preUpdate', (dt, G) => {
    if (!live(G)) return;
    restoreR();
    const p = G.p, fx = p.effects, rdt = BB.rawDt || 0;
    // grow / shrink smoothly
    const tr = targetR(G);
    if (G.powerupsR !== tr) {
      const R = G.powerupsR + (tr - G.powerupsR) * Math.min(1, rdt * 10);
      G.powerupsR = Math.abs(R - tr) < 0.05 ? tr : R;
      p.r = G.powerupsR;
    }
    // spring shoes: the HUD ring shows landings left
    if (fx.springs > 0) {
      if (!(G.powerupsSprings > 0)) G.powerupsSprings = SPRING_N;
      fx.springs = G.powerupsSprings;
      p.effectMax.springs = SPRING_N;
    }
    // bubble carrying you back up, then pop
    if (G.powerupsCarry > 0) {
      G.powerupsCarry -= rdt;
      if (G.powerupsCarry <= 0) {
        G.powerupsCarry = 0;
        BB.burst(p.x, p.y, '#bff8ff', 16, 220);
        beep(900, 0.08, 'sine', 0.06, 0.4);
      }
    }
    // screen effects fade in/out
    const sTo = fx.slowmo > 0 ? 1 : 0;
    G.powerupsSlowA += (sTo - G.powerupsSlowA) * Math.min(1, rdt * 5);
    if (!sTo && G.powerupsSlowA < 0.01) G.powerupsSlowA = 0;
    const rTo = fx.rocket > 0 ? 1 : 0;
    G.powerupsRocketA += (rTo - G.powerupsRocketA) * Math.min(1, rdt * 6);
    if (!rTo && G.powerupsRocketA < 0.01) G.powerupsRocketA = 0;
    updateSlot(G, rdt);
  });

  BB.on('land', (pl, p, G) => {
    if (G.demo) return;
    const fx = p.effects;
    if (fx.springs > 0 && G.powerupsSprings > 0 && p.vy < 0) {
      p.vy *= SPRING_BOOST;
      G.powerupsSprings--;
      beep(240 + (SPRING_N - G.powerupsSprings) * 50, 0.22, 'sine', 0.07, 3);
      BB.burst(p.x, p.y + p.r, '#3ff0c0', 8, 160);
      if (G.powerupsSprings <= 0) BB.endEffect('springs');
      else fx.springs = G.powerupsSprings;
    }
    if (fx.giant > 0 && p.vy < 0) {
      p.vy *= GIANT_BOOST;
      BB.shake(6);
      beep(80, 0.14, 'square', 0.06, 0.5);
      for (let i = 0; i < 8; i++) part(p.x + rand(-p.r, p.r), p.y + p.r, rand(-160, 160), rand(-120, -20), 0.4, CREAM, 4, 500);
      buzz(15);
    }
    if (fx.tiny > 0) beep(1500, 0.05, 'sine', 0.03, 1.4);
  });

  BB.on('stomp', (e, G) => {
    const fx = G.p.effects;
    if (fx.star > 0) {
      BB.addCoins(2, e.x, e.y - 24);
      G.stats.starSmashes = (G.stats.starSmashes || 0) + 1;
      for (let i = 0; i < 10; i++) part(e.x, e.y, rand(-220, 220), rand(-220, 120), 0.6, RAINBOW[(i * 4) % 36], 5, 500);
    } else if (fx.giant > 0) {
      BB.floatText('SQUASH!', e.x, e.y - 26, '#9cff57');
      BB.shake(12);
    }
  });

  BB.on('collect', (it, G) => {
    if (it.type === 'coin' && G.p.effects.coins2x > 0) BB.floatText('x2', it.x, it.y - 12, '#ffcf3f');
  });

  // Bubble Saver: one fall is forgiven. Runs before revive offers etc.
  BB.on('beforeDie', (reason, G) => {
    if (reason !== 'fall' || !G || !(G.p.effects.bubble > 0)) return;
    const p = G.p;
    G.powerupsBubbleSave = true;
    BB.endEffect('bubble');
    G.powerupsBubbleSave = false;
    p.y = G.cam + BB.H - p.r - 2; // on screen: core skips its own rescue bounce
    p.vy = BB.JUMP * 1.85 * BB.mods.jumpMult;
    p.vx *= 0.4;
    p.squash = 0.7;
    G.powerupsCarry = 0.85;
    G.stats.bubbleSaves = (G.stats.bubbleSaves || 0) + 1;
    BB.burst(p.x, p.y, '#bff8ff', 22, 260);
    BB.shake(8);
    BB.flash('#7ff0ff', 0.3);
    toast('BUBBLE SAVE!', '#7ff0ff');
    beep(260, 0.3, 'sine', 0.09, 3);
    later(140, 520, 0.25, 'sine', 0.07, 2);
    buzz([30, 40, 30]);
    return true;
  }, 20);

  BB.on('die', () => {
    const G = BB.G;
    if (G) G.powerupsSlot = null;
  });

  BB.on('revive', G => {
    restoreR();
    G.powerupsSlot = null;
    G.powerupsCarry = 0;
    G.powerupsSprings = 0;
    G.powerupsR = G.powerupsBaseR || 16;
    G.p.r = G.powerupsR;
  });

  // ---- drawing
  BB.on('drawBackground', () => { armed = false; starTinted = false; restoreR(); });
  BB.on('drawBehind', (c, G) => {
    const p = G.p;
    if (!p) return;
    const b = G.powerupsBaseR;
    if ((b && Math.abs(p.r - b) > 0.01) || (p.effects && p.effects.star > 0)) armed = true;
  });
  BB.on('drawPlayer', (c, p, G) => {
    const fx = p.effects;
    if (!fx) return;
    const r = p.r;
    if (fx.springs > 0) drawSpringShoes(c, r);
    if (fx.star > 0) {
      if (!starTinted) { c.globalAlpha = 0.35; c.fillStyle = rainbow(G.realT, 0); circ(c, 0, 0, r); c.globalAlpha = 1; }
      drawStarAura(c, r, G);
    }
    if (fx.propeller > 0) drawPropHat(c, r, G);
    if (fx.bubble > 0 || G.powerupsCarry > 0) drawBubble(c, r, G, G.powerupsCarry > 0, fx.bubble || 9);
    c.globalAlpha = 1;
  });
  // last: put the physics radius back after the scaled draw
  BB.on('drawPlayer', () => { restoreR(); }, -1000);
  BB.on('drawWorld', (c, G) => {
    armed = false;
    restoreR();
    if (G.demo) return;
    if (G.powerupsRocketA > 0) drawSpeedLines(c, G, G.powerupsRocketA);
    if (G.powerupsSlowA > 0) drawVignette(c, G.powerupsSlowA);
  }, -100);
  BB.on('drawHUD', (c, G) => {
    drawHudIcons(c, G);
    drawReel(c, G);
    c.globalAlpha = 1;
  });

  // ------------------------------------------------------------------
  // Public helpers + debug
  // ------------------------------------------------------------------
  BB.powerups = {
    items: ITEM_NAMES.slice(),
    prizes: () => poolNames.slice(),
    info: INFO,
    grant: name => grant(name, false),
    mystery: name => startSlot(name || null)
  };
  BB.on('boot', buildPool); // other features may have added/removed core effects

  const dbg = BB.debug || (BB.debug = {});
  dbg.powerupsList = ITEM_NAMES.slice();
  dbg.powerupsGive = name => grant(name, false);
  dbg.powerupsMystery = name => startSlot(name || null);
  // one of each pickup in a grid near the top of the screen
  dbg.powerupsShowcase = function () {
    const G = BB.G;
    if (!live(G)) return [];
    const out = [], W = BB.W;
    for (let i = 0; i < ITEM_NAMES.length; i++) {
      const x = W * ((i % 3) + 0.5) / 3;
      const y = G.cam + 140 + Math.floor(i / 3) * 62;
      if (BB.spawnItem(ITEM_NAMES[i], x, y)) out.push(ITEM_NAMES[i]);
    }
    return out;
  };
})(window.BB);
