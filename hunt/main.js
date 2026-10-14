/* Wildwood Hunter — main.js
 * Loaded last (after core.js and every features/*.js). Boots the game.
 * Feature packs must register everything at load time (registries, menu buttons,
 * settings, HG.on hooks); HG.boot() then builds the HUD, loads the first map and
 * shows the main menu. */
(function () {
  'use strict';
  if (!window.HG || !window.HG.boot) { console.error('Wildwood Hunter: core.js failed to load'); return; }
  window.HG.boot();
})();
