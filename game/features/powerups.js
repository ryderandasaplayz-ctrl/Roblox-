/* =====================================================================
   features/powerups.js - NEW POWER-UPS + EFFECTS
   Owner: the "powerups" agent. Edit only this file.

   Belongs here:
   - New BB.effectTypes (timed effects shown in the HUD row with timer rings:
     e.g. rocket, slow-mo, double coins, giant, tiny, ghost, bubble/extra life,
     super jump, score x2, coin rain...).
   - New BB.itemTypes that grant them (pickups floating above platforms).
   - Death-saving effects go through BB.on('beforeDie', ...) returning true.

   Rules (see API.md "Effects" and "Items"):
   - Item weight(d, G) is an ABSOLUTE per-row chance (core: coin .35, each
     power-up .03). Keep new power-ups around .01-.03 each.
   - Change physics through BB.mods (reset each run), not constants.
   - Never edit core.js; ask for core changes instead.
   ===================================================================== */
(function (BB) {
  'use strict';
  // BB.effectTypes.myFx = { icon: 'X', color: '#fff', label: 'My FX', onStart(p) {}, onEnd(p) {}, update(p, dt, G) {} };
  // BB.itemTypes.myFx = { weight: () => 0.02, powerup: true, color: '#fff', icon: 'X', onCollect() { BB.addEffect('myFx', 6); } };
})(window.BB);
