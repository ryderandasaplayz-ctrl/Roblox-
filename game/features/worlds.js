/* =====================================================================
   features/worlds.js - LOOK, FEEL AND STYLE
   Owner: the "worlds" agent. Edit only this file.

   Belongs here:
   - Biomes / backgrounds that change with height ('drawBackground' returning
     true replaces the default sky; 'drawBehind' for world-space scenery).
   - Combo system (owns G.combo; core reads it for the land beep pitch and
     G.stats.maxCombo), music (connect to BB.sound.out()), screen juice.
   - Cosmetics: push more skins, trails and hats into BB.cosmetics.*.

   Rules (see API.md "Drawing", "Cosmetics", "Juice"):
   - Keep it fast: no shadowBlur in per-frame drawing, cap particles,
     reuse objects, skip things that are off screen.
   - Never edit core.js; ask for core changes instead.
   ===================================================================== */
(function (BB) {
  'use strict';
  // BB.cosmetics.hats.push({ id: 'crown', name: 'Crown', price: 400, draw(ctx, p, t) {} });
})(window.BB);
