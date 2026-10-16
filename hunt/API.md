# Wildwood Hunter: Engine API (`window.HG`)

This is the contract between `core.js` and the feature packs in `features/*.js`.
Everything below exists in `core.js` today. If something is not documented here, treat it as private.

- [0. Ground rules](#0-ground-rules)
- [1. Conventions](#1-conventions)
- [2. Lifecycle and load order](#2-lifecycle-and-load-order)
- [3. Events](#3-events)
- [4. Loop, time, pause](#4-loop-time-pause)
- [5. Save data, currencies, XP](#5-save-data-currencies-xp)
- [6. Three.js objects and model helpers](#6-threejs-objects-and-model-helpers)
- [7. Player](#7-player)
- [8. Input and controls](#8-input-and-controls)
- [9. UI helpers](#9-ui-helpers)
- [10. Terrain, colliders, maps](#10-terrain-colliders-maps)
- [11. Environment: day/night, weather, wind](#11-environment-daynight-weather-wind)
- [12. Animals](#12-animals)
- [13. Weapons and ammo](#13-weapons-and-ammo)
- [14. Kill flow, trophies, kill cam](#14-kill-flow-trophies-kill-cam)
- [15. Hunt session](#15-hunt-session)
- [16. Shop](#16-shop)
- [17. Settings](#17-settings)
- [18. Audio](#18-audio)
- [19. Particles and tracking dots](#19-particles-and-tracking-dots)
- [20. Debug API (tests)](#20-debug-api-tests)
- [21. Performance rules for contributors](#21-performance-rules-for-contributors)
- [22. Base content shipped by core](#22-base-content-shipped-by-core)
- [23. Recipes](#23-recipes)

---

## 0. Ground rules

- Each feature pack edits **only its own file** (`features/<name>.js`). Wrap everything in an IIFE, `'use strict'`, and grab `var HG = window.HG;`.
- Use classic scripts only (no ES modules). Use only three.js r128 APIs: no `CapsuleGeometry`, no `Geometry`, no addons. All geometry is `BufferGeometry`.
- Never call `alert`, `confirm` or `prompt`. Use `HG.ui.confirm` / `HG.ui.toast`.
- Wrap any direct `localStorage` use in try/catch. You should not need it: put your data under `HG.save.<yourNamespace>` and call `HG.store()`.
- Purchases use in-game currency only: `cash`, earned by hunting, and the rarer `gold`. Never add or imply real-money payment.
- Keep it family-friendly. There is no gore. Animals tip over and fade, and the only blood is the small dark-red tracking dots (`HG.addTrackDot`).
- Styling: use the CSS tokens from `index.html` (`--pine --pine-2 --pine-3 --moss --bark --bark-2 --amber --amber-2 --amber-3 --cream --cream-2 --sky --gold --cash --danger --ink --panel --panel-line --radius --display --body --num --sl --sr --st --sb`). Draw icons with inline SVG or canvas. Do not build emoji-only UI. Touch targets must be at least 48px.
- Event handlers are isolated. A throwing handler is logged with `console.error` and does not break the game. Automated tests still treat any console error as a bug.

## 1. Conventions

| Thing | Convention |
|---|---|
| Units | meters, seconds, kilograms, radians (unless a name says `Deg`) |
| Axes | **Y up**. North = **-Z**, East = **+X**, South = +Z, West = -X |
| Yaw | `yaw = 0` looks toward **-Z**. Positive yaw turns **left** (counter-clockwise from above). `forward(yaw) = (-sin yaw, 0, -cos yaw)`. The same convention applies to the player, animals (`a.yaw`, `root.rotation.y = yaw`), wind (`HG.wind.dir`) and `HG.util.yawTo` |
| Bearing | Compass degrees: `0` = N, `90` = E. Use `HG.util.bearing(yaw)` |
| Models | Built facing **-Z** (head/muzzle toward -Z), origin at ground level, centered |
| Pitch | Positive = look up. Clamped to ±1.45 |
| Head pivot | `head.rotation.x < 0` lowers the head (grazing). `> 0` raises it |
| Map space | Square map of side `map.size`, centered at the origin. Playable area is `|x|,|z| < size/2 - 3` |
| Hour | `0..24`. Sunrise is around 6, sunset around 18 |

## 2. Lifecycle and load order

`index.html` loads, in order: `three.min.js (r128)` → `core.js` → `features/animals.js` → `features/weapons.js` → `features/worlds.js` → `features/progression.js` → `features/gear.js` → `main.js` (calls `HG.boot()`).

- **At load time** (top level of your IIFE), register registries (`HG.animalTypes`, `HG.weaponTypes`, `HG.maps`, `HG.sounds`, `HG.shop.add`, `HG.addSetting`, `HG.ui.menuButton`, `HG.ui.screen`, `HG.on(...)`, `HG.bindKey`, `HG.registerSaveDefaults`). The save is already loaded, so `HG.save` is valid.
- **`HG.boot()`** builds the HUD (core HUD widgets and core action buttons), applies graphics settings, loads the first map (`pine_valley` if present), emits `'boot'`, sets `HG.booted = true` and shows the main menu (emits `'menu'`).
  - Do HUD and action-button work either at load time (the slots and the cluster already exist) or in `HG.on('boot', ...)`.
- `HG.state`: `'boot' | 'menu' | 'hunt' | 'summary'`.
- `HG.version`: `'1.0.0'`. `HG.booted`: boolean. `HG.debugEnabled`: true when the URL hash contains `debug` (`#debug`).

## 3. Events

```js
var off = HG.on('kill', function (animal, info) { ... }, { priority: 0 }); // returns an unsubscribe fn
HG.once('huntStart', fn);
HG.off('kill', fn);
HG.emit('myFeatureEvent', a, b);   // features may emit their own (prefix them: 'gear:dogFound')
```
Handlers run synchronously in registration order. A higher `opts.priority` runs earlier. `this` is `HG`. `emit` passes **at most 6 arguments** and never allocates. Listener lists are copy-on-write, so it is safe to call `on`/`off` inside a handler.

| Event | Args | When |
|---|---|---|
| `boot` | none | once, inside `HG.boot()` after the HUD and first map are ready |
| `menu` | none | main menu shown (`HG.toMenu()`) |
| `screen` | `id, el` | any screen shown via `HG.ui.show` |
| `screenHide` | `id` | a screen was hidden |
| `mapUnload` | `map` | before the current map is disposed |
| `mapLoaded` | `map, ctx` | after `map.build(ctx)` ran (add more props via `ctx`) |
| `mapUnlocked` | `mapId` | a map was unlocked |
| `huntStart` | `session` | hunt began (player placed, animals spawned) |
| `huntEnd` | `summary` | hunt ended (before the summary screen is built) |
| `summary` | `summary, el` | summary screen built |
| `preUpdate` | `dt` | every unpaused frame, before core updates (player, AI, weapons) |
| `update` | `dt` | every unpaused frame, after core updates |
| `pausedUpdate` | `realDt` | every frame while paused |
| `postRender` | `realDt` | after the frame was rendered |
| `pause` | `reason` | simulation paused (first reason only) |
| `resume` | none | simulation resumed |
| `pauseMenu` | `el, buttonsContainer` | pause menu built (append your buttons) |
| `shoot` | `weaponDef, ray{origin,dir}` | a weapon fired. **`ray` vectors are reused, so copy them** |
| `hit` | `animal, zone, damage, info{distance, weapon, point}` | an animal took damage (`weapon` = weapon id) |
| `miss` | `info{point, weapon, projectile?}` | a shot hit nothing alive |
| `killScore` | `animal, info` | **before payout**: push `{label, cash, xp}` into `info.bonuses`, or edit `info.cash/xp/score` |
| `kill` | `animal, info` | animal killed (see [14](#14-kill-flow-trophies-kill-cam) for `info`) |
| `trophyCard` | `animal, info, el` | trophy card shown (decorate `el`) |
| `trophyClosed` | `animal, info` | player pressed Continue |
| `animalSpawn` | `a` | animal created |
| `animalRemove` | `a` | animal removed/disposed |
| `animalAlert` | `a, cause` | animal entered `alert`. Causes: `'sight' 'sound' 'scent' 'close' 'shot' 'impact' 'hit' 'herd' 'player' 'noise'` |
| `animalWarn` | `a` | aggressive animal warning (growl) before charging |
| `animalState` | `a, newState, prevState` | any AI state change |
| `playerHurt` | `amount, source` | player took damage (`source` = animal or string) |
| `playerDown` | none | health reached 0 (hunt ends ~0.7 s later with `downed:true`) |
| `purchase` | `item` | shop purchase or map unlock (`item.id`, `item.category`, ...) |
| `equip` | `slot, id` | equipment changed (`id` null on unequip) |
| `weaponSwitch` | `id, def` | held weapon changed (view model rebuilt) |
| `reload` | `def` | reload started |
| `drawStart` | `def` | a `fireMode:'release'` weapon started drawing |
| `ammo` | `ammoId, delta` | ammo reserve changed via `HG.addAmmo` |
| `cash` | `delta, reason` | cash changed via `HG.addCash` |
| `gold` | `delta, reason` | gold changed via `HG.addGold` |
| `xp` | `amount` | XP gained |
| `levelUp` | `level` | new level reached (also fired by `debug.setLevel`) |
| `settings` | `settings, key` | a setting changed |
| `hour` | `hour` | `HG.env.setHour` was called |
| `weather` | `id` | weather changed |
| `crouch` | `bool` | crouch toggled |
| `step` | `sprinting, crouching` | a footstep |
| `key` / `keyup` | `code, event` | any keyboard key (any state). For gameplay keys prefer `HG.bindKey` |
| `interact` | none | E pressed with no context button showing |
| `inputMode` | `'touch' or 'mouse'` | input mode switched |
| `resize` | `w, h` | viewport resized |
| `audioReady` | `AudioContext` | audio unlocked after the first gesture |
| `shopBuilt` | `el, tab` | shop screen (re)built |
| `saveReset` | none | `HG.resetSave()` ran |
| `unlockAll` | none | `HG.debug.unlockAll()` |

## 4. Loop, time, pause

| Field | Meaning |
|---|---|
| `HG.dt` | game delta this frame = `realDt * timeScale`, and **0 while paused** |
| `HG.realDt` | real delta, clamped to 0.05 s |
| `HG.time` | accumulated game time (s). Stops while paused, slows with `timeScale` |
| `HG.realTime` | accumulated real time (s) |
| `HG.timeScale` | default 1. Set lower for slow motion (kill cam). Reset to 1 at hunt start/end |
| `HG.paused` | true while any pause reason is active |
| `HG.frame` | frame counter |
| `HG.fps` | measured frames per second (real, unclamped) |

Frame order (unpaused): `pollInput` → `emit('preUpdate', dt)` → player (hunt) or menu camera → `HG.env.update(dt)` → animals (AI, movement, animation) → population (hunt) → projectiles → particles → weapon (hunt) → `emit('update', dt)` → threat edges → HUD → sky follow → chunk culling → render → `emit('postRender')`.

- `HG.pause(reason = 'user')`. Reasons `'user'` and `'visibility'` show the pause menu. Any other reason (e.g. `'trophy'`, `'cutscene'`, `'myFeature'`) just freezes the sim. Only works during a hunt.
- `HG.resume(reason = 'user')` removes that reason and resumes once no reasons remain. `'user'` also clears `'visibility'`.
- `HG.pauseReasons`: object of active reasons.
- Auto-pause: tab hidden (`visibilitychange`) or pointer lock lost during a hunt pauses with the menu.

## 5. Save data, currencies, XP

`HG.save` is persisted at `localStorage['wildwood_hunter']` (`HG.SAVE_KEY`), version `HG.SAVE_VERSION = 1`.

```js
HG.save = {
  v: 1, cash: 500, gold: 5, xp: 0 /* TOTAL xp */, level: 1,
  owned: ['hunting_rifle'],                 // non-consumable shop item ids (weapons use their weapon id)
  equipped: { weapon: 'hunting_rifle', sidearm: null, outfit: null, gear: [], companion: null, vehicle: null, extra: [] },
  ammo: { rifle_ammo: 40 },                 // RESERVE rounds per ammo type (magazine rounds live in HG.weaponState)
  trophies: [{ species, name, weight, score, zone, distance, weapon, map, date, legendary }],
  stats: { hunts, kills, shots, hits, headshots, heartShots, longestShot, heaviest, bySpecies: { id: { kills, bestScore, bestWeight } },
           distanceWalked, playTime, cashEarned, timesDowned, legendaryKills },
  settings: { sens: 1, invertY: false, graphics: 'low'|'high'|'ultra', sound: true, music: true, aimAssist: <touch device>, fov: 70, showFps: false, vibrate: true },
  unlockedMaps: ['pine_valley'],
  created, lastPlayed
  // + feature namespaces, e.g. progression: {...}, gear: {...}
};
```

- `HG.registerSaveDefaults(ns, defaults)` returns `HG.save[ns]`. Call it at load time. It deep-merges missing keys now and after every load/migration, so it is safe for older saves. Example: `var my = HG.registerSaveDefaults('progression', { contracts: [], daily: { last: 0, streak: 0 } });`
- `HG.store()` saves after a 400 ms debounce. `HG.storeNow()` saves immediately. Both catch storage errors and set `HG.storageOK` (false = storage blocked, and the game keeps running).
- `HG.saveMigrations[n] = function (save) { ...; return save; }` upgrades from version `n-1` to `n`. Only bump `HG.SAVE_VERSION` in core.
- `HG.resetSave()` wipes progress and keeps settings.
- `HG.settings` is the same object as `HG.save.settings`.
- `HG.addCash(n, reason, worldPos?)` changes cash (negative allowed, floored at 0). Positive amounts also count toward `session.cashEarned` and `stats.cashEarned`. With `worldPos` (Vector3), a floating `+$n` appears there. Emits `'cash'`.
- `HG.addGold(n, reason)` changes gold and emits `'gold'`. Core grants `HG.config.levelUpGold` (2) per level-up. Set it to 0 if progression handles level rewards.
- `HG.addXP(n)` adds XP and levels up while `xp >= HG.xpForLevel(level+1)` (max `HG.config.maxLevel` = 60). Each level-up shows a banner, plays `levelup` and emits `'levelUp'(level)`.
- `HG.xpForLevel(L)` returns the **total** XP needed to reach level L (`L=1 → 0`). Default step: `round(120 * i^1.45)`. You may replace `HG.xpForLevel`, because core always calls it through `HG`.
- `HG.levelProgress()` returns `{level, xp, cur, need, frac}` within the current level.

## 6. Three.js objects and model helpers

| Field | Meaning |
|---|---|
| `HG.renderer` | `WebGLRenderer` (`autoClear=false`). Pixel ratio capped at 1.5 (High) or 1 (Low). Shadow map on only for High |
| `HG.scene` | main scene with `THREE.Fog` (`HG.scene.fog`) |
| `HG.camera` | `PerspectiveCamera` (rotation order `'YXZ'`, far 1400). Core places it at the player's eye every frame from `player.pos/height/yaw/pitch`. Do not parent it, and do not move it during a hunt (use player fields) |
| `HG.viewScene`, `HG.viewCamera`, `HG.viewModel` | First-person weapon pass. `HG.viewModel` (Group) lives in `HG.viewScene` and renders after a depth clear, so it never clips into terrain. `viewCamera` sits at the origin looking -Z (FOV 58 in landscape, 80 in portrait). `HG.viewLights = {hemi, sun}` follow the environment |
| `HG.mapRoot` | Group holding the current map. Anything you add here is **disposed on map unload** |
| `HG.animalRoot` | Group holding animal roots |
| `HG.quality` | `{ level: 'low'|'high'|'ultra', low, high, ultra }` (graphics setting, see [6b](#6b-hggfx-rendering-and-model-toolkit)) |
| `HG.portrait` | true when height > width |
| `HG.tmp` | `{v1..v6: Vector3, q1, q2: Quaternion, m1: Matrix4, e1: Euler, c1, c2: Color, ray: Ray, box: Box3, sphere: Sphere}`. Scratch objects for **feature** code. Use them only within one synchronous function and never keep references. Core uses private temporaries |

Materials:
- New content: use `HG.gfx.mat` and the HG.gfx builders ([6b](#6b-hggfx-rendering-and-model-toolkit)). The helpers below are legacy and low-poly.
- `HG.vcMat`: shared vertex-colour material (Standard on High/Ultra, Lambert on Low). Use it for anything built with `HG.model`.
- `HG.mat(color, opts?)`: cached shared `MeshLambertMaterial`. `opts` may contain `emissive`, `transparent`, `opacity`, `side`, or `basic:true` for `MeshBasicMaterial`.
- Shared materials and geometries have `userData.shared = true` and are **never disposed** by `HG.disposeObject` or map unload. Set `geometry.userData.shared = true` on geometries you cache and reuse across instances.

`HG.model` (alias `M` below) makes **prepared** geometries: non-indexed, flat normals, a `color` attribute, no UVs, all mergeable. Common `opts`: `{pos:[x,y,z], rot:[x,y,z] (XYZ radians), scale:[x,y,z]|number, jitter:0..1 (per-face brightness variation), rng}`.
```js
M.box(w, h, d, color, opts)           M.cyl(rTop, rBottom, h, segments, color, opts)
M.cone(r, h, segments, color, opts)   // opts.open = true gives an open-ended cone (no base cap)
M.sphere(r, color, opts)              // opts.wseg (7), opts.hseg (5)
M.ico(r, detail, color, opts)         M.dodeca(r, color, opts)
M.prep(anyBufferGeometry, color, opts) // convert any geometry
M.colorize(geo, color, jitter, rng)   // recolor a prepared geometry
M.merge([geo, ...]) -> BufferGeometry // disposes inputs
M.mesh([geo, ...] | geo, material?) -> Mesh (HG.vcMat by default)
M.transform(geo, x, y, z, rotY, scale) // in place
M.arms({right:[x,y,z], left:[x,y,z]}) -> [geo...]  // first-person arms using HG.getOutfitColors()
```
- `HG.getOutfitColors()` returns `{sleeve, cuff, glove}` (CSS colors) for first-person arms. Outfits (gear.js) may replace this function. Arms are rebuilt on the next `HG.switchWeapon`.
- `HG.disposeObject(obj)` removes it from its parent and disposes non-shared geometries and materials.
- `HG.flora = {pine, aspen, bush, rock, grass, flower, reed}`: core vegetation factories `(rng, variant) -> prepared geometry`, reusable in `ctx.scatter`.
- `HG.makeLeg(null, color, hoofColor, length, rTop, rBottom)` returns `[geo...]` for a leg hanging down from a hip pivot (y = 0 → -length).

## 6b. HG.gfx: rendering and model toolkit

**Quality bar.** Every new model must read as the real thing: correct anatomy and proportions, smooth silhouettes, believable materials. Build with `HG.gfx`; do not use `HG.model` boxes for new content (it remains for legacy and tiny props). Study `deerSpec`/`rabbitSpec` (`HG.gfx.deerSpec(buck)`, `HG.gfx.rabbitSpec()`) and the `hunting_rifle` view model in core.js before you build anything.

`var G = HG.gfx, TX = HG.gfx.tex;`

### Renderer, lighting, quality
- `renderer.outputEncoding = sRGBEncoding`, ACES Filmic tone mapping (`G.exposure`, about 0.8, multiplied by the time of day). Colour textures made by `TX.*` are already sRGB. **All colours you pass to `HG.gfx` are sRGB CSS/hex strings.** `G.color(css)` returns a NEW linear `THREE.Color`.
- `HG.quality = {level: 'low'|'high'|'ultra', low, high, ultra}`. `G.level()`, `G.isLow()`. The first run auto-picks Low on small touch screens or devices reporting 3 GB or less of memory, and the choice persists in settings. High: MeshStandardMaterial + sky IBL, one soft PCF sun shadow that follows the player, normal maps. Ultra (desktop): 2048 shadow map, denser grass, longer view. Low: Lambert/Phong, no shadows, LOD distances x0.7, about 60% scatter, pixel ratio 1. Listen for `HG.on('settings', ...)`. Materials from `G.mat` are rebuilt per level automatically.
- Lights: `G.sun` (DirectionalLight), `G.hemi` (HemisphereLight). `HG.env.apply` drives them from `HG.env.hour`. `G.shadowExtent` (m) is the half-size of the shadow box. Only scatter chunks within about 1.75x this distance cast shadows.
- `G.sky = {mesh, material, uniforms, params}`: shader dome with an atmospheric gradient, sun disc and glow, drifting fbm clouds, stars and moon at night. Tune `params` per map or weather (applied every env update): `cloudCover 0..1, cloudScale, cloudSpeed, cloudSharp, haze 0..1, glow, starBrightness, tint ('#rrggbb'|null), tintAmount 0..1`. Fog colour follows the sky horizon automatically.
```js
// worlds.js: overcast swamp
HG.gfx.sky.params.cloudCover = 0.85; HG.gfx.sky.params.haze = 0.8; HG.gfx.sky.params.tint = '#9fb39a'; HG.gfx.sky.params.tintAmount = 0.25;
```

### Materials
`G.mat(opts)` returns a **cached shared** material (never dispose it). It is Standard on High/Ultra and Lambert on Low (Phong when `metalness > 0.5` or `roughness < 0.3`).
`opts: {color, map, normalMap, normalScale, roughness (0.8), metalness (0), vertexColors, skinning, side, alphaTest, transparent, opacity, depthWrite, emissive, emissiveIntensity, envMapIntensity, flat, fog, wind:{amp, fade}, key}`. Give a stable `key` when the options contain textures.
Suggested values: fur 0.85-0.9 roughness; antler/horn 0.55; oiled wood 0.42; blued steel `{roughness: 0.32, metalness: 0.88}`; parkerized `{0.6, 0.7}`; leather 0.65; lens `{color: '#1d3340', roughness: 0.04, metalness: 0.95}`.

### Textures (`HG.gfx.tex`, all cached by their options; sRGB CanvasTextures with RepeatWrapping)
| Call | Use |
|---|---|
| `TX.fur({base, back, belly, strokes, length:[a,b], alpha, mottle, spots:{count,size,color}, stripes:{count,width,color}, size, seed})` | coloured fur: countershaded (back at u edges, belly at u=0.5), directional strands along v |
| `TX.furDetail({strokes, length, alpha, seed})` | neutral (about white) fur detail. **Preferred**: tint it with vertex colours (`coat()` painting) so one texture serves every species |
| `TX.feathers({base, tip, edge, barred, iridescent:[c1,c2], size, rows, seed})` | plumage tile (turkey bronze: `iridescent:['#3f6b4a','#8a4a2a']`) |
| `TX.feather({base, tip, bands, bandColor, shaft, width, seed})` | one feather on an alpha card (for `G.wing` / `G.fan`) |
| `TX.scales({base, dark, light, rows, cols, scutes, size, seed})` | reptile scales; `scutes:true` gives armoured gator scutes |
| `TX.bark({style:'pine'|'oak'|'birch'|'dead'|'plate'|'smooth', base, dark, light, moss, size:[w,h], seed})` | tree bark |
| `TX.woodGrain({base, dark, light, figure 0..1, rings, size, seed, checker:[{x,y,w,h}]})` | gun stocks (grain along +v); `checker` adds checkering in normalised rects |
| `TX.metal('blued'|'parkerized'|'brushed'|'stainless'|'black')` or `TX.metal({type, size, seed})` | gun metal |
| `TX.leather({base, dark, stitch, seed})`, `TX.fabric({base, seed})` | slings, holsters, gloves, clothes |
| `TX.camo({pattern:'woodland'|'leafy'|'digital'|'blaze'|'marsh'|'snow', palette:[4 colours], seed})` | outfits, blinds, ATV |
| `TX.noise({size, period, octaves, seed})`, `TX.antler()`, `TX.rock()`, `TX.planks()`, `TX.shingles()`, `TX.stone()` | misc |
| `TX.normalOf(tex, strength)` | matching tangent-space normal map (use only when `!G.isLow()`) |
| `G.texture(key, w, h, draw(ctx, w, h, rng), {srgb, repeat, clamp})` | your own cached canvas texture |

### Geometry builders (indexed BufferGeometry with position/normal/uv; paint them afterwards)
```js
// spine of ellipsoid sections -> one smooth skin (Catmull-Rom between sections)
G.organicBody([{p:[0,0.8,0.6], w:0.3, hUp:0.14, hDown:0.2, sq:2.2}, ...], {radial:28, steps:4, smooth:2, density:2.5, capBulge:0.4})
G.loft(sections, opts)              // general: {p, rx, ry | ryUp/ryDown, sq, n} sections; opts {radial, steps, frame:'up'|'transport', linear, capStart, capEnd, density, displace(fn)}
G.taperedLimb([{p, r | rx, rz}...], {radial:12, steps:4, n:[0,0,-1]})   // rx = side radius, rz = front/back
G.tube(points, radius | [radii] | fn(t), opts)   // pipes, barrels, logs, slings
G.antler({base, beam:[[x,y,z]...], r:[r0, rTip], tines:[{t, dir, len, r, bend}], palm:{t0, t1, width, thick, points, pointLen}, burr:true, seg, radial}, side)  // side -1 mirrors to the left
G.horn({base, dir, axis, len, r0, r1, curl, twist, ridges, ridgeDepth, seg, radial}, side)   // ram curls, bison hooks, pronghorn
G.hoof({w, l, h, cloven:true})      G.paw({size, toes:4, claw:0.4})
G.ear({len, width, cup, thick, tip})        // uv.x 0 = back face, 1 = inner face
G.tail({len, w, h, droop, tipR, bushy})     G.beak({len, w, h, hook, flat})
G.wing({span, chord, primaries:9, secondaries:8}, side)   G.fan({radius, feathers:16, spread, width})   // use TX.feather + alphaTest
G.merge([geo, ...])                 // own mergeGeometries (indexed or not, fills missing attributes)
G.xform(geo, pos, rot, scale)  G.mirrorX(geo)  G.ensureColor(geo)  G.tint(geo, '#hex')
G.paint(geo, function (c, x, y, z, nx, ny, nz, u, v, i) { c.set(...); }, {multiply, gain})   // vertex colour painting (markings, countershading)
G.vertexAO(geo, {occluders:[[x,y,z,r]...]|'auto', cells, strength, ground:y, groundStrength, groundFalloff, under, min})       // creases, belly, under-ear darkening
```

### LOD
- `G.makeLOD(highFn, lowFn, dist)` returns a `THREE.LOD`.
- `G.lodSwap(mesh, [geoHi, geoLo, ...], [0, d1, ...])` swaps the geometry on ONE mesh (works for SkinnedMesh/InstancedMesh). Core updates it about 5 times per second.

### Rigs, gaits, quadrupeds
`G.quadruped(spec)` builds and caches a **skinned template** (high and low LOD geometry, rig, attachments). `G.spawnQuadruped(tpl, {tint, variant})` returns `parts` that you return directly from `buildMesh`. Core then calls `parts.animate(a, dt)` every frame and `parts.die(a, dt)` after a kill (a natural stumble and collapse, no gore).
```js
// spec (model space: +y up, head toward -z, ground at y = 0; see deerSpec for a complete example)
{ key: 'elk_bull',
  spine: [ {p, w, hUp, hDown, sq, bone:'pelvis'|'spine'|'chest'|'neck1'|'neck2'} ... last = poll (head joint) ],   // tail end first, head end last
  head:  [ ellipsoid sections from poll to nose ],
  legs:  { FR: [6 joints {p, r|rx,rz}: body-root, hip/shoulder, knee/elbow, hock/carpus, fetlock, hoof], BR: [...] },  // left side is mirrored
  hoof: {w, l, h} | paw: {size} | feet: false,
  ears: {p, len, width, cup, tip, rot}, tail: {p, len, w, h, droop, bushy},
  eyes: {p, r, rot, color}, nose: {p, r, color, sx, sy, sz},
  coat: function (c, x, y, z, nx, ny, nz, part, u, v) { /* part: body|head|legF|legH|ear|tail|hoof|paw -> c.set(sRGB) */ },
  fur: {strokes, length, alpha, seed}, roughness: 0.86, density: 2.6,
  gaits: ['walk', 'trot', 'gallop'], speeds: [walk->trot, trot->gallop] (m/s),
  poses: {idle, walk, run, alert, graze: [neck1, neck2, head] pitch radians},
  tailLift, tailFlag (0..1), earFwd, flexF, flexH, swingF, swingH, strideMul, lodDist, ao,
  attach: function (spec) { return [{bone: 'head', geometry /* model space */, material, lowGeometry, variant}]; } }   // antlers, horns, tusks, bell, mane
```
- Bones: `root > pelvis > spine > chest > neck1 > neck2 > head (earR, earL)`; legs `FL|FR|BL|BR` `_hip > _knee > _hock > _hoof`; `tail1 > tail2`. `parts.rig.bones[name]` lets you add extra motion (a jaw, a bugle).
- Gaits (`G.gaits`): `walk` (4-beat lateral), `trot` (diagonal), `gallop` (rotary, spine flex), `bound` (deer pronk, rabbits), `hop` (lagomorph), `waddle` (ducks, bears' roll), `fly`. The animator blends three gaits by speed and adds head bob and nod, idle breathing, look-around, ear flicks, tail swish and flag (whitetail), graze/alert poses and slope alignment. Birds and other non-quadrupeds can use `G.rig.build`, `G.skin.chain/rigid/fn`, `G.rig.skinnedMesh` and `G.legPose` directly, or rigid pivots with the classic `parts` contract (see §12).
```js
HG.animalTypes.mule_deer = { /* ...stats... */
  buildMesh: function (opts) {
    var spec = HG.gfx.deerSpec(true); spec.key = 'mule_deer'; spec.ears.len *= 1.5;  // derive from an existing spec
    return HG.gfx.spawnQuadruped(HG.gfx.quadruped(spec), { variant: 4 });
  } };
```

### First-person hands
`G.fpArms({right: {pos, basis:[[xAxis],[yAxis]] | rot, pose, arm:[dx,dy,dz], armLen}, left: {...}})` returns a Group of gloved hands and sleeves in weapon space. Poses (`G.handPoses`): `'trigger'`, `'support'`, `'grip'`, `'fist'`, `'open'`, `'pinch'`, or `{curl:[i,m,r,p], thumb, spread, index:[mcp,pip,dip]}`. The glove/sleeve colours come from `HG.getOutfitColors()` (`{sleeve, cuff, glove, pattern, palette}`; gear.js may replace it). `arms.userData.left/right` are the hand groups, so you can animate reloads. `G.handGeometry(pose)` and `G.sleeveGeometry` are the lower-level builders.
View-model pattern (see `hunting_rifle`): build parts once per quality into a cache, use one Mesh per material, add `G.fpArms`, set `grp.userData.muzzle`, and animate bolts, levers, slides, hammers, bow strings and limbs in `grp.userData.animate(w, dt)` using `w.lastShot`, `w.reloading`, `w.reloadT / w.reloadDur`.

### Environment builders
- `G.terrainMaterial(palette)`: slope- and height-blended grass/dirt/rock/extra layers with world-space UVs and macro noise. Palettes: `'meadow'|'snow'|'sand'|'mud'|'autumn'` or `{base, grass:[...], dirt, rock, extra, grassKind, extraKind:'sand'|'snow'|'mud'|'grass', scale:[m per tile x4], rules:{slopeDirt:[a,b], slopeRock:[a,b], shore, extraMode:'shore'|'high'|'low'|'noise'|'none', extraLevel, rockLevel, dirtNoise, grassGrow}, tint:[base, alt], weights: fn(x,z,h,slope,wl,out4), mode:'albedo'|'tint'}`. Maps select it with `map.terrain = <palette>` (otherwise it is derived from `map.groundColors`; core builds the `tw` weights attribute; `G.terrainWeights` is exposed).
- `G.waterMaterial({shallow, deep, opacity, ripple, speed, foam})`: fresnel sky reflection, animated ripples, sun glint, depth tint and shore foam. It needs a `depth` vertex attribute; core water planes have one.
- `G.trees.pine({height, seed, spread, whorls})`, `.oak({height, seed})`, `.birch({height, seed})`, `.dead({height, seed})`, `.bush({size, seed, berries})`, `.log({len, r, seed, stump})`, `G.plant('grass'|'fern'|'flowers'|'reeds'|'dry', {size, seed})`, `G.rock({size, seed, flat, stretch, moss, mossAmount})` all return `{geometry, material, lod:{geometry, dist}, castShadow}`. **Return them straight from a `ctx.scatter` factory**, which instances and LODs them per chunk with wind sway. They are cached, so create variants once outside the factory. Materials: `G.vegMaterial('tree'|'grass'|'plant')`, `G.rockMaterial()`.
- Grass: near-player instanced wind grass is automatic when `map.grass !== false`. Its density follows quality and its colour follows the terrain.
- `G.buildCabin(ctx, x, z, rotY)`, `G.nightGlow` (cabin window) are landmark helpers.
- Wind: `G.windUniforms` (shared), `G.applyWind(material, {amp, fade, flutter})` patches a material you own (not a shared `G.mat`) to sway.

### Budget and rules
- High: up to about 250 draw calls and about 600k triangles on screen. Measure with `HG.debug.renderInfo()`. Merge static props per material (`G.merge`), instance anything repeated (`ctx.scatter`), and give every animal a low LOD (the quadruped builder does this for you).
- Never create materials or textures per instance or per frame: everything from `G.mat`/`TX` is cached and shared (`userData.shared`). Cache your own geometries in closures and mark them `userData.shared = true`.

## 7. Player

```js
HG.player = {
  pos: Vector3 /* feet */, vel: Vector3, yaw, pitch,
  height /* current eye height */, standHeight: 1.65, crouchHeight: 1.0,
  crouch, sprint, stamina /* 0..1 */, health /* 0..100 */, maxHealth: 100,
  noise /* 0..1 movement/shot loudness, read by AI */, visibility /* 0..1 how visible, read by AI */,
  scentMult: 1,          // multiplies animals' smell range (scent spray < 1)
  visibilityMult: 1,     // camo/outfits (< 1 = harder to see)
  noiseMult: 1,          // quiet boots etc.
  speedMult: 1, staminaMult: 1, damageMult /* optional, default 1 */,
  walkSpeed: 3.3, sprintSpeed: 6.4, crouchSpeed: 1.6, radius: 0.4,
  inVehicle: null,       // set to an object while driving: {noise:0..1, eyeHeight?, canShoot?:bool}
  onStand: null,         // set to an object while on a tree stand/blind
  frozen: false,         // true = ignore move/look input (cutscenes)
  fovOverride: null,     // number (degrees) forces camera FOV (binoculars). Look sensitivity scales with it
  hideViewModel: false, hideCrosshair: false,
  speed, moving, inCover, shotNoise, lastHurt, recoilPitch, recoilYaw, bobPhase, roll
};
```
- Core computes `noise` (still 0, crouch-walk 0.12, walk ≈0.35, sprint 0.85, vehicles use `inVehicle.noise`, and shots spike it to the weapon's `noise`, decaying ~0.9/s) times `noiseMult`.
- Core computes `visibility`: 1 base, ×0.55 crouched, ×0.75 still, ×0.7 near cover colliders (2.6 m), ×0.6 on a stand, × `visibilityMult`, × daylight (0.45..1). Clamped to 0.05..1.
- **While `inVehicle` or `onStand` is set, core does not move the player.** You own `player.pos` (including `y`). Look input still applies. Drive vehicles from `HG.on('preUpdate', ...)` by reading `HG.input.move`. `colliders.resolve` and `terrain.heightAt` help. Animals cannot reach a player `onStand`.
- `HG.placePlayer(x, z, yaw?)` puts the feet on the terrain and resets velocity and pitch.
- `HG.hurtPlayer(amount, source)` (ignored when `HG.debug.god`), `HG.healPlayer(n)`, `HG.setCrouch(bool)`.
- Health regenerates 5/s after 6 s without damage. At 0 health: `'playerDown'`, then `HG.endHunt({downed:true})`.
- Stamina drains while sprinting (0.16/s ÷ `staminaMult`) and sprint stops below 0.04.
- Collision: terrain height, solid circle colliders (`HG.colliders`), map bounds and deep water (> 0.55 m below water level blocks walking).

## 8. Input and controls

```js
HG.input = {
  move: {x, y},        // x = strafe right, y = forward, -1..1 (virtual joystick or WASD/arrows)
  lookX, lookY,        // pending look deltas in RADIANS (core consumes and zeroes them every frame); add to them to rotate the view
  fire, firePressed,   // held / pressed this frame
  aim, aimToggle,      // aim held (mouse) or toggled (touch AIM button)
  sprint, sprintToggle, crouch,
  buttons: {},         // actionButton id -> true while held
  keys: {},            // KeyboardEvent.code -> held
  isTouch,             // touch UI mode (switches automatically on first touch / key press)
  pointerLocked, lockFailed,
  joystick: {active, x, y, sprint},
  enabled: true        // false = ignore gameplay pointer input
};
```
- Touch: a left-side joystick (spawns under the thumb in the left 42% of the screen; pushing past the rim upward sprints), drag anywhere else to look, and a button cluster on the right. Multi-touch is fully supported through Pointer Events.
- Desktop: WASD/arrows, mouse look (pointer lock on first click; if refused, drag-to-look and quick click to fire), left click fire, right click aim (hold), R reload, C crouch, Shift sprint, E interact, Q next weapon, 1-9 select loadout slot, wheel cycle, Esc/P pause. **B is reserved for binoculars (gear.js).**
- `HG.bindKey(code, fn(e), desc)` returns `unbind()`. Runs on keydown (no auto-repeat), only during an unpaused hunt. Example: `HG.bindKey('KeyB', toggleBinoculars, 'Binoculars')`.
- `HG.resetInput()` releases everything (called on pause, hunt start and end).
- `HG.requestPointerLock()`, `HG.exitPointerLock()`: lock is optional, and failure is handled.
- Core action buttons (ids): `fire` (hold), `aim` (toggle), `reload`, `weapon` (swap; hidden when the loadout has 1 weapon), `crouch`, `sprint` (toggle).

## 9. UI helpers

All UI is DOM over the canvas inside `#hg-root`. Screens live in `#hg-screens`. Use `.hg-btn`, `.hg-panel`, `.hg-pill`, `.hg-card`, `.hg-grid`, `.hg-tabs/.hg-tab`, `.hg-tag`, `.hg-title`, `.hg-screen-head`, `.hg-wrap`, `.hg-row`, `.hg-center`, `.hg-set`, `.hg-switch`, `.hg-seg` classes.
`#hg-root` gets `.touch` in touch mode, `.in-hunt` during a hunt (the HUD is only visible then), `.portrait` in portrait and `.card-open` while a trophy card is open (big toasts and banners are hidden then).

```js
HG.ui.css(cssText) -> <style>
HG.ui.screen(id, html?) -> <section class="hg-screen" id="scr-<id>" hidden>   // same id returns the same element; html replaces content
HG.ui.onShow(id, fn(el))          // run every time the screen is shown (build dynamic content here)
HG.ui.show(id, {keep}) -> el      // hides other screens unless keep:true; sets ui.current/ui.previous; emits 'screen'
HG.ui.hide(id); HG.ui.hideAll(); HG.ui.isOpen(id); HG.ui.getScreen(id); HG.ui.current; HG.ui.previous
HG.ui.button(label, fn, {primary, green, ghost, small, icon:'name'|'<svg..>', id, title, cls}) -> <button>
HG.ui.menuButton(label, fn, {primary, green, ghost, small, icon, id, order, container}) -> <button>  // main menu column; same id replaces
HG.ui.removeMenuButton(id)
HG.ui.backButton(fn) -> <button>  // square back arrow used by core screens
HG.ui.toast(text, {color, big, duration (s), html})
HG.ui.banner(title, subtitle, {duration (s), color, force})  // queued while a trophy card is pending/open (force:true skips the queue)
HG.ui.confirm(text, onYes, {title, yes, no (false = hide), onNo, html})
HG.ui.floatText(worldPos, text, color, {size})       // floating text projected from 3D
HG.ui.iconCanvas(drawFn(ctx, w, h), w=96, h=64) -> <canvas> (HiDPI)
HG.ui.draw.rifle(ctx,w,h,{wood,metal,scope}) / ammo(ctx,w,h,color) / box(ctx,w,h,color,label) / coin(ctx,w,h,isGold) / mapPreview(ctx,w,h,map) / quadruped(ctx,w,h,color)
HG.ui.icons.<name> (SVG strings) / HG.ui.icon(name) / HG.ui.svg(innerSvg, {fill, sw})
HG.walletHTML() -> cash+gold pills HTML;  HG.refreshWallet(rootEl) updates .cv .gv .hg-lvl .xpt .hg-xpbar b inside rootEl
```
Icon names: `fire aim reload crouch sprint swap binoculars hand pause play cart gear trophy antlers paw cash gold lock back close check foot eye wind arrow heart bolt pin star sound rotate map rifle ammo xp`. Add your own with `HG.ui.icons.myIcon = HG.ui.svg('<path d="..."/>')`.

Core screen ids: `menu`, `maps`, `shop`, `trophy`, `summary`, `pause`, `settings`. Core main menu buttons have ids `hg-btn-play` (order -10), `hg-btn-shop` (0) and `hg-btn-settings` (50). Use an `order` between them for yours (e.g. Lodge 10, Contracts 20). Screens scroll internally and must fit 360×640 and 640×360. Pad fixed UI with `var(--st/--sr/--sb/--sl)` (safe areas).

**HUD** (`HG.ui.hud`, visible only in hunts):
- `HG.ui.hudSlot(name)` returns a positioned flex container (children get pointer events). Names: `'topLeft'` (pause + health/stamina), `'topCenter'` (compass), `'topRight'` (hunt cash + noise/visibility/wind meters), `'bottomCenter'` (weapon + ammo; column-reverse, so appended items stack **above**), `'left'` (vertical middle-left), `'minimap'` (top-left under the bars). Unknown names create a new empty slot (position it yourself).
- `HG.compass.addMarker(id, {pos: Vector3 | bearing: deg, color, size})` and `HG.compass.removeMarker(id)`. Core already marks alert, fleeing and charging animals within 200 m.
- `HG.ui.threat(relAngle, intensity)` shows red edge glows (`relAngle` 0 ahead, +π/2 left, -π/2 right, π behind) and decays by itself. `HG.ui.hurtFlash(k)`, `HG.ui.hitMarker(isKill)`, `HG.ui.setCrosshair(gapPx, visible)` (core sets it every frame), `HG.ui.setScope(bool)` / `HG.ui.scopeEl` (overlay element; restyle the reticle by replacing its innerHTML on `'weaponSwitch'`).
- `HG.ui.actionButton(id, label, svgIcon, onPress, opts) -> el` adds a mobile button (touch mode only). `svgIcon` is an icon name or an `<svg>` string. `opts`: `{hold:true` (onPress on down, `opts.onRelease` on up, `HG.input.buttons[id]` true while held), `toggle:true` (`.on` class flips, `onPress(isOn)`), `cls`, `pos:{right, bottom, portrait:{right, bottom}}` (px from the bottom-right safe corner, reserved for the core arc), `order` (extras column order), `hidden:true`, `onRelease}`. Without `pos`, buttons go into the extras column on the right edge, under the top-right HUD and wrapping leftwards.
- `HG.ui.setActionVisible(id, bool)`, `HG.ui.setActionActive(id, bool)` (`.on` highlight), `HG.ui.actionEl(id)`.
- `HG.ui.contextButton(label, fn, {icon, id})` shows ONE context action (bottom-center pill; desktop shows `[E]`). Calling it every frame with the same label is cheap. `HG.ui.clearContext(id?)` (with `id`, only clears if you own it), `HG.ui.triggerContext()`, `HG.ui.contextActive()`.

## 10. Terrain, colliders, maps

```js
HG.terrain.heightAt(x, z)          // exact rendered surface height (clamped to the map)
HG.terrain.normalAt(x, z, out?)    // unit normal into out (Vector3)
HG.terrain.slopeAt(x, z)           // rise/run
HG.terrain.isWater(x, z)           // surface below waterLevel + 0.15
HG.terrain.inBounds(x, z, margin)
HG.terrain.size, .seg, .cell, .waterLevel (-1e9 if no water), .mesh, .ready
HG.water (Mesh or null), HG.mountains (Mesh or null), HG.map, HG.mapId, HG.mapCtx
```

**Colliders** (vertical cylinders on a spatial hash, cleared on map unload):
```js
var c = HG.colliders.add(x, z, r, { h: 6, y0: groundY (default terrain-0.5), tag: 'tree', cover: true, solid: true, data: anything });
HG.colliders.remove(c); HG.colliders.clear();
HG.colliders.query(x, z, r, function (c) { /* return true to stop */ });
HG.colliders.resolve(posVector3, radius, y?)   // push out of solid colliders (skips ones below y)
HG.colliders.raycast(origin, unitDir, maxDist, ignore?) -> distance | Infinity
HG.colliders.coverNear(x, z, dist) -> bool
HG.colliders.list
```
`solid:false` colliders (bushes) are walk-through but still give cover. Solid ones block players, animals, bullets and animal line of sight.

**Map registry**: `HG.maps[id] = def`. Core adds `def.id`.
```js
HG.maps.misty_marsh = {
  name: 'Misty Marsh', desc: 'Reeds, ducks and fog.', tagline: 'Ducks overhead!',   // tagline = hunt-start banner subtitle
  levelReq: 3, price: 2500, currency: 'cash' /* or 'gold' */,                          // price 0 = free once levelReq is met
  size: 400, segments: 110 /* optional; default min(128, size/3.4) */,
  height: function (x, z) { return ...; },                                              // pure function, called on a grid
  groundColors: { base, alt, slope, low, high, highLevel },                             // or groundColor(x,z,h,normalY,outColor) for full control
  fog: { color: '#cfd8d0', near: 50, far: 220 },  // fog color is also the daytime horizon color
  skyTop: '#6f9cc2', skyBottom: '#dfe8e4', mountainColor: '#6d7f86', treeColor: '#3a5a32', horizon: true /* false = no mountain ring */,
  water: { level: 0, color: '#3d6f7a', opacity: 0.82 },                                // optional water plane
  playerSpawn: { x: 0, z: 150, yaw: 0 }, menuCamera: { x, z, r, h },
  spawns: [{ type: 'mallard', weight: 5, max: 8 }],                                     // population table
  maxAnimals: 14, startHour: 7, weather: 'fog' /* optional HG.weatherTypes id applied at hunt start */,
  ambient: {...}, weatherOptions: [...],                                                // free-form, for worlds.js
  build: function (ctx) { ... }                                                         // add props/vegetation
};
```
`HG.loadMap(id)` emits `'mapUnload'`, removes animals, dots and projectiles, **disposes** `HG.mapRoot` (geometries and non-shared materials) and clears colliders. It then builds terrain, water and the mountain ring, calls `build(ctx)`, applies the environment and emits `'mapLoaded'(map, ctx)`. `HG.isMapUnlocked(id)`, `HG.unlockMap(id)` (charges the price, checks level, emits `'purchase'` and `'mapUnlocked'`). Maps with `price > 0` automatically get a `'maps'` shop item `map_<id>`.

**Build context** `ctx`:
```js
ctx.map, ctx.id, ctx.root (=HG.mapRoot), ctx.scene, ctx.rng (seeded by map id), ctx.size, ctx.half, ctx.waterLevel, ctx.quality, ctx.model, ctx.merge
ctx.heightAt(x,z), ctx.normalAt(x,z,out), ctx.slopeAt(x,z)
ctx.add(object3D)                              // into the map root (disposed on unload)
ctx.addCollider(x, z, r, opts)                 // = HG.colliders.add
ctx.clearArea(x, z, r)                         // later scatter/randomPoint calls avoid this circle (the spawn already has a 14 m clearing)
ctx.randomPoint({minH, maxH, slopeMax, margin=6, area:{x,z,r}, allowWater, density(x,z)->0..1, avoidClear=true}) -> {x,y,z} | null
ctx.addStatic([preparedGeo...], {castShadow, receiveShadow=true, material}) -> Mesh  // merged static props (1 draw call)
ctx.scatter(factory(rng, variantIndex) -> preparedGeo | {geometry, material}, count, opts) -> {count, points:[{x,y,z,s,ry,v}], meshes}
```
`scatter` opts: `{variants:1, scale:[min,max], minH, maxH, slopeMax, area, density, margin, allowWater, collider:r (×scale), colliderHeight (×scale), cover, solid, tag, yOffset (×scale), align (tilt to slope), castShadow, receiveShadow, chunk:100 (m), viewDist (m; hide chunks beyond, use ~70 for grass), lowMult:0.6 (count multiplier on Low)}`. It builds one `InstancedMesh` per (variant, chunk) with correct bounds, so frustum and distance culling work.

## 11. Environment: day/night, weather, wind

```js
HG.env = {
  hour, daySpeed /* game hours per real second, default 1/90 */, frozen /* stop the clock */, weather: 'clear',
  sun /* DirectionalLight (moon at night) */, hemi /* HemisphereLight */, sky /* Mesh */, skyMat /* ShaderMaterial: uniforms top, bottom, sunDir, sunColor, sunVis */, clouds /* Group */,
  sunDir: Vector3, skyTop: Color, skyBottom: Color, fogColor: Color, fogNear, fogFar, daylight /* 0 night .. 1 day */,
  lightScale /* weather light multiplier */, fogScale /* weather fog distance multiplier */,
  setHour(h), isNight(), setWeather(id) -> bool,
  apply(),     // recompute sky/fog/lights for hour + map + weather. worlds.js may wrap or replace
  update(dt)   // advances the clock, wind and clouds, calls apply() every 0.5 s and weatherTypes[weather].update(dt). worlds.js may wrap or replace
};
HG.weatherTypes.rain = { name: 'Rain', fogMult: 0.6, light: 0.7, start() {}, stop() {}, update(dt) {} };
HG.wind = { dir /* yaw convention: direction the wind blows TOWARD */, speed /* m/s */, vec /* unit Vector3 */, target, gust };
```
Core always calls `HG.env.apply` and `HG.env.update` through `HG.env`, so replacing them works. Scent rule: an animal smells the player when the direction from the player to the animal aligns with `HG.wind.vec` (dot > 0.72, i.e. the animal is **downwind**) and the distance is under `senses.smell × player.scentMult × (0.55 + min(wind.speed, 8)/9)`.

## 12. Animals

**Registry**: `HG.animalTypes[id] = def`
```js
HG.animalTypes.wild_boar = {
  name: 'Wild Boar', rarity: 'uncommon',                // 'common'|'uncommon'|'rare'|'legendary'  (HG.RARITY[r] = {mult, color, label})
  baseCash: 220, xp: 70, weightRange: [60, 140], size: 1 /* model scale multiplier */, hp: 160,
  speed: { walk: 1.3, run: 8 }, senses: { sight: 45, hearing: 70, smell: 110 },
  temperament: 'aggressive',                            // 'skittish' | 'calm' (reacts later) | 'aggressive' (warns then charges) | 'territorial' (charges inside def.territory m)
  group: [1, 3], fly: false, habitats: ['pine_valley'], activeAt: 'any',   // 'day' | 'night' | 'any'
  damage: 22, attackRange: 1.8, attackCooldown: 1.4, warnTime: 1.7, territory: 22,   // aggressive/territorial only (defaults shown)
  gait: 'walk',                                        // 'walk' (diagonal leg swing) | 'hop' | 'fly' (flaps parts.wings) | 'none'
  stride: 2.6, grazePitch: -0.95, alertPitch: 0.25, tailLift: -1.1, radius: 0.45, flyHeight: 14,
  furColor: 0x6b4a33,                                  // hit puff color
  sounds: { alert: 'boar_grunt', flee: 'boar_grunt', warn: 'growl', attack: 'growl' }, // HG.sounds names
  icon: function (ctx, w, h) { ... },                  // trophy card / UI silhouette (canvas)
  hitZones: [                                          // offsets in the root's local, unscaled space (or in parts[part] space)
    { name: 'head',  part: 'head', offset: new THREE.Vector3(0, 0.1, -0.3), radius: 0.18, mult: 3 },
    { name: 'vital', offset: new THREE.Vector3(0, 0.6, -0.35), radius: 0.2, mult: 2.5 },
    { name: 'body',  offset: new THREE.Vector3(0, 0.6, 0.1), radius: 0.45, mult: 1 },
    { name: 'leg',   offset: new THREE.Vector3(0.15, 0.25, -0.4), radius: 0.1, mult: 0.5 }
  ],
  buildMesh: function (opts /* spawn opts, e.g. {legendary} */) {
    var root = new THREE.Group();            // facing -Z, feet at y=0
    // ... HG.model geometry; head = Group pivot; legs = [FL, FR, BL, BR] Group pivots at the hips (rotation.x swings)
    return { root: root, legs: legs, head: head, tail: tail, wings: [left, right] /* optional */ };   // extra keys are kept in a.parts
  },
  init: function (a) {}, update: function (a, dt) { /* return true to skip core AI + movement this frame */ },
  onAlert: function (a, cause) {}, onHit: function (a, zone, dmg, info) {}, onKill: function (a, info) {}, dispose: function (a) {}
};
```
Zone names must be `'head' | 'vital' | 'body' | 'leg'` (score and cash bonuses key off them). When a ray crosses several spheres of one animal, **the zone with the highest `mult` wins**. Damage = `weapon.damage × zone.mult × range falloff` (× draw charge for release weapons).

**Instance** `a` (in `HG.animals`):
```
id, type, def, root (Object3D), parts (buildMesh result), legs, head, tail, wings,
pos (=== root.position), yaw, goalYaw, scale, weight (kg, rolled at spawn: skewed toward the low end; legendary ≈ top of range ×1.35), weightFrac, legendary,
hp, maxHp, alive, dead, wounded, hits, state, prevState, stateTime, stateDur,
speed, moveSpeed (desired), target (Vector3 wander goal), threat (Vector3), threatType, awareness (0..2; >0.35 alert, >=1 react), lastCause, sensing,
group (id), leader (animal|null), distToPlayer, alt (flyers), bob, phase, headPitch, senses {sight, hearing, smell},
noCount (ignored by population cap), keep (never despawned), data {} (free per-feature scratch)
```
**States**: `idle`, `graze` (head down, sees ×0.55), `wander` (walks to `a.target`; followers trail the leader), `alert` (stops, faces the threat, head up), `flee` (runs away from `a.threat` with zig-zag; the herd follows the leader's `fleeYaw`), `warn` (aggressive: growl, red edge HUD, then `charge`), `charge` (runs at the player and hits within `attackRange`, then `retreat`), `retreat`, `wounded` (limps away, then idles; `a.wounded` animals move at ×0.68 speed and drop tracking dots every ~1.6 m), `dead` (tips over and fades after the trophy card).

Detection (every 0.2 s per animal): sight (`senses.sight × player.visibility`, ×0.55 at night for non-nocturnal, 240° FOV, terrain and solid-collider line of sight, moving players are far easier to spot), hearing (`senses.hearing × player.noise`), smell (wind, see 11), and anything within 4 m. Gunshots alert every animal within `hearing × 4 × weapon.noise` after a short reaction delay. Impacts startle animals within ~14 m.

Functions:
```js
HG.spawnAnimal(type, {x, z}, {yaw, legendary, weight, group, leader, state, scale, noCount, data}) -> a | null
HG.spawnGroup(type, x, z, count, opts) -> [leader, ...followers]
HG.spawnFromTable(minDist, maxDist, preferAhead) -> group (uses the map table + habitats, respects max/activeAt)
HG.removeAnimal(a); HG.clearAnimals(); HG.fadeAnimal(a)
HG.setAnimalState(a, state, cause?)        // e.g. lure: HG.setAnimalState(a, 'wander'); a.target.set(x, 0, z);
HG.alertAnimal(a, posVector3, strength 0..2, cause, delaySeconds?)
HG.damageAnimal(a, damage, zone, {distance, weapon, point}); HG.killAnimal(a, zone)
HG.zoneWorld(a, zoneDef, out) -> world-space zone center
HG.raycastAnimals(origin, unitDir, maxDist, {includeDead}) -> {animal, zone, zoneDef, t, point} | null
```
Population: during a hunt, every 1.5 s core removes animals beyond `HG.config.despawnDist` (240 m; ×1.4 for wounded, never `a.keep`) and, while fewer than `map.maxAnimals || HG.config.maxAnimals` are alive, spawns one group `spawnMin..spawnMax` (70..180 m) away, preferring spots outside the view. The table is `map.spawns` plus any type whose `habitats` include the map (default weight 3/2/0.8/0.25 and max 5/2 by rarity). `HG.config.legendaryChance` (default 0) makes a group leader a legendary variant. At hunt start one group spawns 70-110 m ahead.

## 13. Weapons and ammo

```js
HG.ammoTypes.arrow = { name: 'Carbon Arrows', price: 30, pack: 6, color: '#c8c2b0', desc: '...', icon: fn(ctx,w,h)?, levelReq: 1 };
HG.weaponTypes.recurve_bow = {
  name: 'Recurve Bow', desc: '...', slot: 'primary' /* or 'sidearm' */, ammo: 'arrow', price: 1200, currency: 'cash', levelReq: 2,
  damage: 120, pellets: 1, spread: 0.03 /* rad cone at hip; ×0.12 fully aimed */, fireDelay: 0.9, magSize: 1, reloadTime: 0.7, range: 70,
  zoom: 50 /* aimed FOV in degrees */, scope: false /* true = scope overlay + hidden view model when aimed */,
  projectile: 'arrow' /* or 'hitscan' */, muzzleVelocity: 70, gravity: 9.8 /* m/s² bullet/arrow drop */,
  noise: 0.15 /* 0..1 */, recoil: 0.02 /* rad camera kick */, kickBack: 1 /* view-model kick multiplier */,
  fireMode: 'release' /* 'press' (default) | 'auto' (or auto:true) | 'release' (hold to draw, release to shoot; HG.weapon.charge 0..1) */, drawTime: 0.8,
  hipPos: [0.2, -0.215, -0.5], aimPos: [0, -0.012, -0.3],   // view-model positions (x right, y up, z forward=-)
  sound: { type: 'bow' /* plays HG.sounds['shot_'+type] or sound.name */, freq: 1, volume: 1 }, reloadSound: 'reload',
  stats: { Damage: 0.8, Range: 0.3, Stability: 0.7, 'Fire rate': 0.3 },   // 0..1 bars for the shop
  icon: function (ctx, w, h) {}, iconColors: { wood, metal, scope },
  projectileGeometry: geo /* optional custom arrow (prepared, userData.shared=true) */,
  buildViewModel: function () {           // -> Object3D for HG.viewModel; line of sight at local x=0,y=0, barrel toward -Z
    var g = new THREE.Group(); g.add(HG.model.mesh([...].concat(HG.model.arms({right:[...], left:[...]}))));
    g.userData.muzzle = { x: 0, y: -0.05, z: -0.7 }; return g;
  }
};
HG.shop.addWeapon('recurve_bow'); HG.shop.addAmmo('arrow', 1); HG.shop.addAmmo('arrow', 3);
```
- `HG.weaponStat(def, key)` is **the only way core reads weapon stats** (`damage spread fireDelay magSize reloadTime range zoom scope muzzleVelocity gravity noise recoil pellets auto fireMode drawTime`). weapons.js may wrap it to apply attachments and upgrades: `var base = HG.weaponStat; HG.weaponStat = function (def, k) { var v = base(def, k); ...; return v; };`
- `HG.weapon` (current): `{id, def, cooldown, reloading, reloadT, reloadDur, aimT 0..1, kick, bloom, switchT, model, flashT, spreadNow, charging, charge, lastShot}`.
- `HG.weaponState[id] = {mag}`: magazine rounds. At hunt start mags refill from `HG.save.ammo`, and at hunt end unspent mag rounds return to the reserve. `HG.weaponMag(id)` returns or creates that entry.
- `HG.getLoadout()` returns the carried weapon ids `[equipped.weapon, equipped.sidearm, ...equipped.extra]` (owned only). `HG.switchWeapon(id)`, `HG.cycleWeapon(±1)`, `HG.reload()`, `HG.fire(opts)` (`{debug, force, dir, charge}`; returns `{hits:[traceResult]}` or null), `HG.addAmmo(ammoId, n)`, `HG.totalAmmo(ammoId)`.
- `HG.equip(slot, id)`: slots `'weapon'|'primary'`, `'sidearm'`, `'extra'` (adds), `'outfit'`, `'companion'`, `'vehicle'`, `'gear'` (adds). `HG.unequip(slot, id)`, `HG.isEquipped(slot, id)`. Emits `'equip'`.
- `HG.traceShot(origin, dir, range, muzzleVelocity, gravity, ignoreCover)` returns `{distance, point, animal, zone, zoneDef, surface:'animal'|'terrain'|'obstacle'|null, dir}` (ballistic, 30 m segments).
- `HG.raycastTerrain(origin, dir, maxDist)` returns a distance or Infinity. `HG.spawnProjectile(origin, dir, def, {charge, geometry})` launches a visible arrow (gravity, sticks into ground/trees for 8 s).
- `HG.shootRay = {origin, dir}` is the last shot's camera ray (reused).
- Core feel: recoil kick (camera and view model), muzzle flash at `model.userData.muzzle`, hit marker (white X, red on kill), `HEADSHOT!` / `HEART SHOT!` / `LONG SHOT!` toasts, FOV lerp to `zoom`, scope overlay, dynamic crosshair spread, sway and bob, reload dip, empty click with auto-reload.
- Aim assist (touch, `settings.aimAssist`): when a vital zone is near the crosshair, look is slowed ×0.6 and gently pulled toward it while the player is turning or moving.

## 14. Kill flow, trophies, kill cam

On a kill core computes and pays out, then emits `'kill'(animal, info)`:
```
info = { zone, distance (m), weapon (id), weaponName, score, cash, xp, weight (kg), legendary, species (name), type (id), rarity,
         oneShot, map, mapName, time, hour, newRecord (best score for species), bonuses: [{label, cash, xp}] }
score = round(weight × 10 × zoneBonus{head 1.4, vital 1.6, body 1, leg 0.7} × (1 + min(dist,400)/200) × rarityMult (× 2.5 if a legendary variant))
cash  = round(baseCash × (0.75 + 0.5 × weightFrac) × zoneCash{head 1.2, vital 1.25, body 1, leg 0.8} × (1 + min(dist,300)/300) × (4 if legendary) × (1.1 one-shot))
xp    = round(def.xp × zoneBonus × (1 + min(dist,300)/300) × (4 if legendary))
```
Listen to `'killScore'` to add bonuses before payout (they are added to cash/xp and listed on the card). The trophy is saved to `HG.save.trophies`, stats update, the session records it and the herd bolts.

**Kill cam**: core calls `HG.killCam(animal, info)` right after the kill. The default does nothing. weapons.js may replace it and **return a Promise**, and the trophy card waits for it. Example: `HG.killCam = function (a, info) { if (info.zone !== 'vital' && info.distance < 120) return; HG.timeScale = 0.25; return new Promise(function (res) { setTimeout(function () { HG.timeScale = 1; res(); }, 1200); }); };`

**Trophy card**: about 0.9 s later (real time) `HG.showTrophyCard(animal, info, onContinue)` opens screen `'trophy'`, pauses with reason `'trophy'` and emits `'trophyCard'`. Continue resumes, fades the animal and shows the next queued card. You may replace `HG.showTrophyCard`, but you must call `onContinue` and `HG.resume('trophy')`. `HG.trophyPending()` returns true while cards are open or queued.

## 15. Hunt session

- `HG.startHunt(mapId) -> session | null` (checks unlock). It (re)loads the map if needed, sets the hour (`map.startHour` or `HG.config.startHour` 16.5) and `map.weather`, places the player at `map.playerSpawn`, resets health, stamina, crouch and vehicle/stand, refills mags, equips loadout[0], spawns the opening population, shows the banner and emits `'huntStart'`.
- `HG.session = { map, mapName, startTime (ms), startGameTime, kills: [info...], cashEarned, xpEarned }` (null outside hunts; add your own fields freely).
- `HG.endHunt({downed}) -> summary` builds `{map, mapName, duration (s), kills, cashEarned, xpEarned, downed, lostCash}`. If downed, it removes `HG.config.downedCashLoss` (25%) of the session's cash from the wallet. It returns mag rounds to the reserve, emits `'huntEnd'` and shows `'summary'` (Lodge / Shop / Hunt again). `HG.lastSummary` keeps it.
- `HG.toMenu()` ends any hunt and shows the main menu over an orbiting camera with a few grazing animals.
- `HG.showSummary(summary)` (re)shows the summary screen.

## 16. Shop

```js
HG.shop.add({
  id: 'camo_jacket', category: 'outfits',   // 'weapons'|'ammo'|'scopes'|'gear'|'outfits'|'companions'|'vehicles'|'maps'|'upgrades'
  name: 'Woodland Camo', desc: 'Harder to spot (-30% visibility).', price: 900, currency: 'cash' /* or 'gold' */, levelReq: 2,
  consumable: false, qty: undefined,        // consumables can be bought repeatedly (never 'owned')
  icon: function (ctx, w, h) { /* draw on a 120x64 canvas */ },
  stats: { Stealth: 0.7 },                  // optional 0..1 bars
  equipSlot: 'outfit',                      // optional; default by category: outfits->'outfit', companions->'companion', vehicles->'vehicle', gear->'gear', weapons->weapon slot; null = no Equip button
  onBuy: function (item) {},                // after currency is taken
  owned: function () { return bool; },      // optional custom ownership
  canBuy: function () { return true | 'reason text'; }, // optional extra gate
  hidden: false
});
HG.shop.buy(id) -> bool (checks level, currency, ownership, canBuy; adds to save.owned unless consumable; plays sound, toasts, stores, emits 'purchase')
HG.shop.canBuy(id) -> {ok, reason: 'owned'|'level'|'funds'|'missing'|custom}
HG.shop.owns(id); HG.shop.get(id); HG.shop.remove(id); HG.shop.items; HG.shop.categories [{id, name, icon}] (add your own category objects here)
HG.shop.equipSlot(item); HG.shop.addWeapon(weaponId, overrides); HG.shop.addAmmo(ammoId, packs, overrides) // id = ammoId or ammoId+'_x'+packs
HG.shop.open(tab?); HG.shop.tab; HG.shop.card(item, refresh) -> card element (replaceable)
```
The core shop screen (`'shop'`) rebuilds on every open: header, wallet, tabs for categories that have items, and a grid of `HG.shop.card` elements. It emits `'shopBuilt'(el, tab)`. progression.js may restyle it, replace `HG.shop.card`, or replace the screen via `HG.ui.onShow('shop', ...)`.

## 17. Settings

`HG.settingsDefs` rows: `{key, label, type: 'toggle'|'range'|'choice', min, max, step, options: [[value, label]], default, onChange(v)}`. `HG.addSetting(def)` adds or replaces a row. `HG.setSetting(key, value)` applies side effects (sound, music, graphics, FPS), stores and emits `'settings'`. `HG.openSettings(from = 'menu'|'pause')`. Core keys: `sens, invertY, fov, graphics ('low'|'high'|'ultra'), aimAssist, sound, music, vibrate, showFps`. `HG.applyGraphics()` re-applies pixel ratio and shadows.

## 18. Audio

- `HG.sounds[name] = function (ctx, dest, opts, t) { ... }` builds WebAudio nodes into `dest` starting at time `t`. Base sounds: `shot_rifle, reload, equip, empty, step, splash, hit, rustle, deer_call, deer_snort, rabbit_squeak, growl, hurt, ui, deny, buy, kill, trophy, levelup`.
- `HG.sfx(name, {volume, pos: Vector3 (distance attenuation + stereo pan), freq, ...})` does nothing until the audio is unlocked by a gesture, or when sound is off, and never throws.
- Helpers: `HG.audio.ctx`, `HG.audio.noiseSource(ctx)` (looping white noise), `HG.audio.noiseBurst(ctx, dest, t, dur, filterType, f0, f1?, peak, q?)`, `HG.audio.tone(ctx, dest, t, oscType, f0, f1?, dur, peak, attack?)`, `HG.audio.env(gainNode, t, attack, peak, decay)`, `HG.audio.unlock()`. Sends: `HG.audio.sfx` (sfx gain) and `HG.audio.musicGain`.
- `HG.sound.enabled`, `HG.music.enabled`, `HG.setSound(bool)`, `HG.setMusic(bool)`, `HG.music.play()` / `HG.music.stop()` (lodge music in the menu; replaceable), `HG.vibrate(ms)`.

## 19. Particles and tracking dots

- `HG.particles.emit(pos, count, {color, speed, up, life, gravity, spread, drag, dir})` uses a pooled `Points` system (`HG.config.particleMax` = 120 total). `HG.particles.clear()`.
- `HG.addTrackDot(x, z, size=1)` drops a subtle dark-red tracking dot on the ground (instanced ring buffer of `HG.config.trackDotMax` = 260). `HG.clearTrackDots()`.

## 20. Debug API (tests)

```js
HG.debug.god = true;                                  // no player damage
HG.debug.spawnAnimal(type, distance = 30, angleDeg = 0 /* + = left of view */, opts) -> a   // broadside, idle, keep, noCount
HG.debug.killAll(withRewards = false)                 // false = despawn all; true = kill each (cards)
HG.debug.teleport(x, z, yaw?); HG.debug.setTime(hour); HG.debug.setWeather(id)
HG.debug.giveCash(n = 10000); HG.debug.giveGold(n = 100); HG.debug.setLevel(n); HG.debug.unlockAll()
HG.debug.equip(id)                                    // own + equip weapon by slot (+ammo) or a shop item
HG.debug.lookAt(a, zone = 'vital')                    // aims the camera (drop-compensated for the held weapon)
HG.debug.fireAt(a, zone = 'vital')                    // aims + fires with no spread, ignoring cover; returns HG.fire result
HG.debug.listTypes() -> {animals, weapons, ammo, maps, weather, sounds, shop}
HG.debug.fps(); HG.debug.snapshot() -> compact state object
HG.debug.advance(seconds, step = 1/30)               // run the simulation synchronously (no rAF), then render one frame
```
Use `#debug` in the URL to set `HG.debugEnabled` (also shows the FPS counter). Headless SwiftShader renders at only a few FPS, so drive AI and physics with `HG.debug.advance()` instead of waiting in real time. The shared test harness is `/tmp/claude-0/-home-user-Roblox-/96d12926-78fa-5957-8f40-4c602984be15/scratchpad/hunt/harness.js` (usage at the top of that file).

## 21. Performance rules for contributors

- **No allocations in per-frame code**: no `new THREE.Vector3()`, no closures, arrays, `.clone()` or string concatenation in `update` handlers. Keep module-level temporaries or use `HG.tmp`. Throttle non-critical work with timers (e.g. every 0.2 s).
- Static props go through `ctx.addStatic` (merged, one draw call). Repeated props use `ctx.scatter` (instanced and chunked). Give grass-like detail a `viewDist` around 70 m. Target fewer than about 160 draw calls and 150k triangles in view on High.
- Share materials (`HG.vcMat`, `HG.mat`). Build models from `HG.model` primitives with vertex colors so they merge. Cache geometries per type when spawning often, and mark them `userData.shared = true`.
- Shadows exist on High only (one directional light). Set `castShadow` only on things that matter (trees, big rocks, animals) and never on grass or particles.
- Respect `HG.quality.low`: fewer instances (`lowMult`), no extra lights or effects. Never add more lights per object, because new lights recompile every material.
- Everything you add to `HG.scene` outside `HG.mapRoot` you must remove and dispose yourself (`HG.disposeObject`).
- DOM: update HUD text at about 10 Hz and only when the value changes. Avoid layout reads in loops.
- Particles are capped (`HG.particles`). Do not create parallel unbounded systems.

## 22. Base content shipped by core

| Kind | Ids |
|---|---|
| Map | `pine_valley` (420 m, hills, lake at (60,-45), spawn (0,150) facing north, cabin landmark at (16,162)) |
| Animals | `whitetail_deer` (common, skittish, herds 1-4, 45-110 kg; skinned HG.gfx quadruped, buck with 2-4 tine antlers or doe via `opts.buck/doe`), `rabbit` (cottontail, common, hops, 1.1-2.4 kg) |
| Weapon | `hunting_rifle` (bolt-action, 4x scope, mag 5, hitscan with mild drop) |
| Ammo | `rifle_ammo` (.308, pack 10, $40) |
| Shop items | `hunting_rifle`, `rifle_ammo` (×10), `rifle_ammo_x3` (×30), `gold_exchange` (5 gold → $750, upgrades) |
| Sounds | see [18](#18-audio) |
| Weather | `clear` |
| Starting save | $500, 5 gold, 40 rifle rounds, hunting rifle owned and equipped, Pine Valley unlocked |

## 23. Recipes

**Menu button + screen (progression.js)**
```js
var el = HG.ui.screen('lodge');
HG.ui.onShow('lodge', function (el) {
  el.innerHTML = '<div class="hg-wrap"><div class="hg-screen-head"><span class="bk"></span><h2 class="hg-title">Trophy Lodge</h2></div><div class="hg-grid"></div></div>';
  el.querySelector('.bk').appendChild(HG.ui.backButton(function () { HG.toMenu(); }));
  HG.save.trophies.forEach(function (t) { /* cards */ });
});
HG.ui.menuButton('Lodge', function () { HG.ui.show('lodge'); }, { icon: 'trophy', id: 'btn-lodge', order: 10 });
```

**Action button + key (gear.js binoculars)**
```js
function toggle() { var on = !HG.player.fovOverride; HG.player.fovOverride = on ? 12 : null; HG.player.hideViewModel = on; HG.player.hideCrosshair = on; HG.ui.setActionActive('binos', on); }
HG.ui.actionButton('binos', 'Binos', 'binoculars', toggle, { order: 1 });
HG.bindKey('KeyB', toggle, 'Binoculars');
HG.on('huntEnd', function () { HG.player.fovOverride = null; });
```

**HUD widget (gear.js minimap)**
```js
var cv = document.createElement('canvas'); cv.width = 220; cv.height = 220; cv.style.cssText = 'width:110px;height:110px;border-radius:14px;border:1.5px solid var(--panel-line);background:rgba(10,20,15,.6)';
HG.ui.hudSlot('minimap').appendChild(cv);
var t = 0; HG.on('update', function (dt) { t -= HG.realDt; if (t > 0) return; t = 0.25; /* redraw */ });
```

**Context action (tree stand)**
```js
HG.on('update', function () {
  var near = HG.util.dist2D(HG.player.pos.x, HG.player.pos.z, stand.x, stand.z) < 2.5;
  if (near && !HG.player.onStand) HG.ui.contextButton('Climb', climb, { id: 'stand', icon: 'hand' });
  else if (!near) HG.ui.clearContext('stand');
});
function climb() { HG.player.onStand = stand; HG.player.pos.set(stand.x, stand.topY, stand.z); HG.ui.contextButton('Climb down', down, { id: 'stand' }); }
```

**Lure animals (gear.js calls/decoys)**
```js
HG.animals.forEach(function (a) {
  if (a.dead || a.type !== 'whitetail_deer' || a.distToPlayer > 150) return;
  if (a.state === 'idle' || a.state === 'graze' || a.state === 'wander') { HG.setAnimalState(a, 'wander'); a.target.set(x, 0, z); a.stateDur = 25; }
});
```

**Legendary event**
```js
var a = HG.spawnAnimal('whitetail_deer', { x: 120, z: -60 }, { legendary: true });
HG.compass.addMarker('legend', { pos: a.pos, color: '#ffb54d', size: 5 });
HG.ui.banner('Legendary sighting!', 'A giant buck was spotted to the north');
```

**Kill bonus (progression.js contracts)**
```js
HG.on('killScore', function (a, info) { if (info.zone === 'vital' && contract.active) info.bonuses.push({ label: 'Contract: heart shot', cash: 150, xp: 40 }); });
```

**Map (worlds.js)**: see [10](#10-terrain-colliders-maps). Reuse `HG.flora.pine` etc. in `ctx.scatter`, add `ctx.addStatic` props and set `spawns`.
