/* FULL PULL — main.js: start the game once every feature pack has registered its content. */
(function () {
  'use strict';
  function go() { try { window.TP.boot(); } catch (e) { console.error('[TP] boot error', e); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
