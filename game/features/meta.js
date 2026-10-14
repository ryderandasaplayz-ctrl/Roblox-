/* =====================================================================
   features/meta.js - PROGRESSION + MENUS AROUND THE GAME
   Owner: the "meta" agent. Edit only this file.

   Belongs here:
   - Missions, achievements, daily reward, spin wheel, permanent upgrades
     (applied via BB.mods in a 'newGame' hook), revive offer on the
     game-over screen (BB.ui.overButton + BB.revive), local leaderboard,
     pause button/screen (BB.ui.hudButton + BB.pause/BB.resume + 'pause'
     hook), settings (BB.sound.enabled, BB.vibration.enabled).
   - Persist everything under BB.save.meta and call BB.store().

   Rules (see API.md "UI", "Run control", "Save data"):
   - Build screens with BB.ui.screen / BB.ui.show; menu entries with
     BB.ui.menuButton. No alert/confirm/prompt.
   - Never edit core.js; ask for core changes instead.
   ===================================================================== */
(function (BB) {
  'use strict';
  // BB.ui.menuButton('MISSIONS', () => BB.ui.show('missions'));
})(window.BB);
