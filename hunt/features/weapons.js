/* =====================================================================
 * Wildwood Hunter — features/weapons.js
 * Weapons, ammo, scopes, attachments and shooting feel: more HG.weaponTypes (bow + arrows, shotgun, revolver, magnum...), HG.ammoTypes, scope/attachment shop items (wrap HG.weaponStat), slow-mo kill cam (replace HG.killCam), extra recoil/feel polish.
 *
 * Rules for this file:
 *  - Edit ONLY this file. Rely only on core.js + API.md (window.HG).
 *  - Register content at load time (this file runs before main.js calls HG.boot()).
 *  - Keep everything inside this IIFE; expose shared helpers as HG.weapons = {...} if needed.
 *  - No per-frame allocations in hot paths (reuse HG.tmp / your own temporaries).
 *  - UI uses the CSS tokens from index.html (var(--pine), var(--amber), ...).
 * ===================================================================== */
(function () {
  'use strict';
  var HG = window.HG;
  if (!HG) return;

  // TODO(weapons): implement this feature pack.

})();
