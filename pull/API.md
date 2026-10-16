# Full Pull — engine API (`window.TP`)

`core.js` creates one global, `window.TP`. Feature packs (`features/*.js`) only use this API.
They load **after** `core.js` and **before** `main.js` (which calls `TP.boot()`).

**Coordinates.** Y is up and units are metres. The pulling lane runs along **+X** from the start line (x = 0), and **+Z is the driver's right**.
The side camera stands on the +Z side, so the vehicle moves left to right on screen and the grandstand sits behind the track at −Z.
Players see distances in **feet** with 2 decimals (`TP.fmtFt(m)` → `"287.42"`), and weights in **lb**.

**Load-time rule.** Registries (`TP.classes`, `TP.vehicles`, `TP.venues`, `TP.drivers`, `TP.upgrades`, `TP.shop.items`, `TP.screens`, `TP.ui.menuItems`)
are plain objects or arrays, and you can fill them at load time. You need neither DOM nor THREE to do that.
Anything that touches DOM, WebGL or audio has to run inside a `build()` / `render()` function or in `TP.on('boot', fn)`.
Never throw at load time. Wrap risky code in `try/catch`.

---

## 1. Hooks

```js
var off = TP.on('pullEnd', function (result) { ... });   // returns an unsubscribe fn
TP.once('boot', fn);  TP.off('pullEnd', fn);  TP.emit('myEvent', a, b, c, d);   // up to 4 args
```
A listener that throws is caught and logged, and the other listeners still run.

| event | args | when |
|---|---|---|
| `boot` | – | renderer, venue and menu are up |
| `menu` | – | main menu shown |
| `screen` | `(id, args)` | any `TP.ui.show` |
| `venueLoaded` | `(venueCtx)` | `TP.loadVenue` built a venue |
| `pullStart` | `(pull)` | `TP.runPull` created the pull |
| `pullUpdate` | `(pull, simDt)` | every rendered frame of a pull (includes the coast after the end) |
| `launch` | `(pull, quality)` | green-light launch: `'perfect'|'good'|'late'|'early'` |
| `shift` | `(pull, gear)` | gear index after the shift (0-based); quality in `pull.lastShift` |
| `hop` | `(pull)` | wheel hop went above 0.6 |
| `boost` | `(pull)` | a boost shot fired |
| `breakdown` | `(pull, part)` | `'engine'|'driveline'` |
| `outOfBounds` | `(pull)` | crossed a boundary line (DQ) |
| `fullPull` | `(pull)` | reached the end of the track |
| `pullEnd` | `(result)` | the rendered pull finished, **and** for every AI pull an event skips (`result.player` tells which) |
| `eventStart` / `eventEnd` | `(eventDef)` / `(results)` | `TP.event.run` |
| `purchase` | `(item)` | shop buy (the item) or upgrade buy (`{id, category:'upgrades', level, uid, price, upgrade}`) |
| `cash` | `(delta, reason, total)` | `TP.addCash` |
| `xp` / `levelUp` | `(n, total)` / `(level)` | `TP.addXP` |
| `pause` / `resume` | – | player pull paused or resumed (also auto-paused on `visibilitychange`) |
| `settings` | `(settings)` | a setting changed |
| `camera` | `(mode)` | camera preset changed |
| `announce` | `(text, priority)` | the announcer said something |
| `hudShow` | `(renderState)` | the pull HUD was shown |
| `frame` | `(dt, realDt)` | every frame (prefer `TP.onFrame`) |
| `resize` | `(w, h)` | viewport changed |
| `quality` | `('high'|'low')` | quality switched |
| `audioReady`, `saveReset`, `garageSelect`(uid), `garageAdd`(entry) | | |

---

## 2. Three.js access and the low-poly toolkit

- `TP.scene`, `TP.camera` (PerspectiveCamera), `TP.renderer`, `TP.lights = {sun, hemi, sunDir}`. These exist only after boot.
- `TP.tmp` holds reusable scratch objects `{v1, v2, v3, v4, q1, m1, e1, c1, s1}`. Use them inside a single function and never keep them.
  Core uses v1–v4 in rig/effects code, so features should prefer their own scratch objects inside hot loops.
- `TP.quality` is `'high'|'low'`. `TP.setQuality(q)` switches it: pixelRatio 1.5 on High and 1 on Low, with sun shadows off on Low.
- `TP.setSky({top, horizon, bottom, sun, sunIntensity, hemiSky, hemiGround, hemiIntensity, fog, fogNear, fogFar, sunDir:[x,y,z], haze, sunSize, sunGlow, exposure})` takes sRGB hex values.
- `TP.onFrame(fn(dt, realDt))` returns an unsubscribe function. `dt` already includes `TP.timeScale` and is 0 while paused.

### `TP.lowpoly` (alias `LP` below)
Every builder returns a **non-indexed BufferGeometry** with flat normals and a vertex `color` attribute.
The geometry is already transformed by `o = {x, y, z, rx, ry, rz, sx, sy, sz}`.

```js
LP.box(w, h, d, color, o)
LP.cyl(rTop, rBot, h, seg, color, o)      // o.axis: 'x' | 'z' lays it down
LP.cone(r, h, seg, color, o)
LP.sphere(r, color, o)                     // icosahedron, o.detail
LP.wedge(w, h, d, color, o)                // o.slope 0..1: top drops toward +X
LP.taper(w, h, d, topScaleX, topScaleZ, color, o)   // o.shift moves the top face in X
LP.cab(w, h, d, color, o)                  // truck cab with glass band; o.glass, o.taperX, o.taperZ
LP.tire(radius, width, o)                  // lugged tire, axis Z; o = {lugs, lugDepth, chevron, rim, rimColor, color, seg, hub}
LP.merge(geoms) / LP.mergeGeometries(geoms)// own implementation; disposes the inputs
LP.paint(geo, color)                       // recolor a whole geometry
LP.builder()                               // .box().cyl().cone().sphere().wedge().taper().cab().add(geo) -> .geometry() | .mesh(o)
LP.mesh(geo, {shadow, receive, mat, matOpts})   // shared flat vertex-color material
LP.mat('vc' | color, {rough, metal, emissive, emissiveIntensity, transparent, opacity, side:'double', ...})  // cached by args
LP.color(hexOrCss)                         // cached linear THREE.Color
LP.canvasTexture(w, h, draw(ctx, w, h), {repeat:[x,y], nearest, anisotropy})   // tex.userData.ctx/canvas let you redraw
LP.decal(tex, w, h, {x, y, z, face:'x'|'-x'|'-z'|'up', emissive, receive})      // textured plane, polygon offset
LP.numberTexture(num, {fg, bg, ring, outline, shape:'circle'|'square'|'plain'})
LP.textTexture(text, {w, h, bg, fg, border, borderWidth, stroke, size, weight, align})
LP.liveryTexture(livery, {brand, w, h, numberX 0..1, mirror, fill})  // patterns: stripe|flames|twoTone|checker|farm|plain
LP.palette  // === TP.palette (dirt, diesel, flame, fair, sky, cream, barnRed, grass*, steel*, chrome, rubber, hay, skin[], shirts[], ...)
```
**InstancedMesh rule:** a mesh with `instanceColor` must not share a material with one that has none.
Use a distinct `LP.mat('vc', {instColor:true})` key, as `TP.venueKit.crowd` does.

### `TP.models` (core builders, reusable by vehicles.js)
- `TP.models.pickup(livery, veh)`, `TP.models.tractor(livery, veh)`, `TP.models.miniRod(livery, veh)`. Optional `veh.modelOpts`: pickup `{stacks, lift}`, tractor `{frontRadius, stackH, twinStacks}`.
- `TP.models.wheel(radius, width, tireOpts)` returns a pivot Group that you spin on Z.
- `TP.models.stack(parent, x, y, z, h, r, color, {rx, rz})` returns the **outlet Object3D**. Put these in `stacks[]`.
- `TP.models.sideDecals(parent, livery, texOpts, w, h, x, y, zHalf)` adds livery decals on both sides. The −Z side is mirrored correctly.
- `TP.models.sled(o)` builds the weight-transfer sled (core uses one shared instance from `TP.getSled()`).
- `TP.models.hex(cssOrNum, fallback)`, `TP.models.shade(hex, f)`.

---

## 3. Loop and time
`TP.dt` is the clamped, time-scaled frame dt (max 0.05 s). `TP.realDt` is the unscaled frame dt. `TP.time` is the sum of `TP.dt`.
`TP.timeScale` drives slow-motion (core uses 0.35 at a full pull). `TP.paused` is a bool; `TP.pause()` and `TP.resume()` only act during a pull.
`TP.fps()` returns the measured fps. `TP.frameCount` counts frames.

---

## 4. Classes — `TP.classes[id]`
```js
TP.addClass('pro_stock_diesel', {
  name: 'Pro Stock Diesel', group: 'truck' /* | 'tractor' */, short: 'PRO STOCK', order: 2,
  desc: '...', weightLimit: 7800 /* lb */, hpRange: [1500, 2000], tire: 'cut' /* dot|bigrig|ag|cut */,
  drive: '4wd' /* | '2wd' */, boostShots: 1, difficulty: 3 /* 1..5 */, trackLength: 300 /* ft */,
  speedRef: 7,                 // typical pulling speed (m/s); sets sled plow
  sledStart: 0.2, sledEnd: 0.8,// optional: resistance as a fraction of the class's traction at box rear / box front
  ref: { frontBias, hitchHeight, wheelbase },   // reference chassis used to size the sled
  sled: { baseWeight, boxWeight, boxTravel, panGrow, digSpeed, plow, speedRef },  // optional, else from TP.makeSled
  payPerFt: 13                 // optional, quick-pull cash per foot = payPerFt * 0.35
});
TP.classList(group?) // sorted by order
```
Core ships all 13: `street_diesel, work_stock, pro_stock_diesel, super_stock_diesel, modified_2wd, big_rig, mini_rod, farm_stock, hot_farm, pro_stock_tractor, light_super_stock, super_stock_tractor, unlimited_modified`.
`TP.makeSled(weightLimitLb, tireId, {drive, frontBias, hitchHeight, wheelbase, start, end, speedRef, trackLength, plow, panGrow})` sizes a sled from traction.
Tires: `TP.tires[id] = {name, mu, idealSlip, fall, floor, hopGain}`. Engine types: `TP.engineTypes[type]` (diesel|gas|methanol|turbine|multi).

## 5. Vehicles — `TP.vehicles[id]`
```js
TP.addVehicle('ps_bigsky', {
  name: 'Ridgeline 3500', brand: 'Big Sky Trucks' /* fictional only! */, class: 'pro_stock_diesel',
  price: 42000, levelReq: 4, desc: '...', hidden: false,
  specs: { hp: 1750, weight: 7780, gears: [22, 17.5, 14.2], redline: 4200, shiftRpm: 3900, idle: 800,
    traction: 1.0 /* x tire mu */, idealSlip: null /* default from tire */, durability: 1.0,
    wheelRadius: 0.62, wheelbase: 3.9, cgHeight: 0.95, hitchHeight: 0.62, frontBias: 0.55, halfWidth: 1.05,
    drive: '4wd', tire: 'cut', maxLift: 0.14, boostShots: 1, boost: { mult: 1.3, duration: 2.2, heat: 0.07 },
    shiftTime: 0.3, hopFreq: 4.6, converter: 1.25, wheelInertia: 16, steerRate: 1, heat: 1 },
  engine: { type: 'diesel', count: 1, cyl: 6, turbo: 2, whistle: 0.9, pitch: 1, rough: 0.5, blower: false, volume: 1 },
  liveries: [{ name: 'Sky Blue', base: '#2565ae', accent: '#fff4dc', trim: '#17140f', number: '42', pattern: 'stripe', rim: '#dfe4e8', brandText: 'BIG SKY' }],
  seatX: 1.6, seatY: 1.9,      // onboard camera (optional)
  modelOpts: { stacks: 2 },
  build: function (livery) { return TP.models.pickup(livery, this); }   // `this` is the vehicle def
});
```
`specs.hp` drives the sim: peak torque is derived so the dyno peak equals hp. `torque` is informational.
**`build(livery)` contract.** Livery is merged over `liveries[0]` with `TP.liveryFor(vehicleId, livery)`. The return value must be
`{ root: Object3D, body: Object3D, wheels: {front: [Object3D], rear: [Object3D]}, stacks: [Object3D outlets], hitch: Object3D, frontEnd?: Object3D, radius: {front, rear}, length }`.
`root` sits on the ground under the **rear axle**, faces **+X**, and has +Z on the right. Wheels are children of `root` and spin on local Z.
`hitch.position` is in root space at the chain point. `body` gets hop/vibration offsets. Stack outlets emit smoke and flames, with +Y as up.
Keep a vehicle to roughly 1–4 draw calls by merging with `LP.builder()` (decals are extra planes).
`TP.vehiclesInClass(classId)`. When it boots, core auto-creates a shop item `veh:<id>` for every vehicle with `price > 0`.

## 6. Simulation — `TP.sim` (pure and headless; works in Node with no THREE)
```js
var p = TP.sim.createPull({ vehicleId, upgrades: {engine_tune: 2}, driver: 'wade', venue: 'county_fair',
  trackCondition: 0.3 /* 0 hard..1 loose */, seed: 1234, sledMult: 1.08 /* pull-off */, sled: {...overrides}, extra: {hpMult: 1.1} /* extra effect */, classId });
TP.sim.step(p, dt, { throttle: 0..1, steer: -1..1, shift: bool /* rising edge */, boost: bool /* rising edge */ });
TP.sim.finish(p, controller, dt=1/60) -> result      // run to the end
TP.sim.simulate({ ...createPull opts, skill: 'pro' | controller }) -> result
TP.sim.coast(p, dt)        // visual roll-out after the end (keeps the result)
TP.sim.pedalFor(p, slipTarget) -> pedal that would hold that slip (assists / AI)
TP.sim.dyno(vehicleId, upgrades, steps) -> [{rpm, torque, hp}]
TP.sim.vehicleStats(vehicleId, upgrades, extra) -> effective stats
TP.sim.tune  // global constants (sledMass, boxCurve, chainDown, heatRate, cooling, driftAmp, hopOnset, hopFull, rollRes, powerGrip)
```
The sim is deterministic for the same seed, inputs and dt sequence. It integrates with fixed 1/240 s substeps.
**Pull state fields:** `dist` (m, sled), `travel` (m, vehicle), `speed` (m/s), `rpm`, `gear` (0-based), `throttle`, `steer`, `heading` (rad), `lateral` (m, +Z right),
`slip` (wheel-speed ratio), `idealSlip`, `grip`, `hop` (0..1.6), `hopPhase`, `frontLift` (≈rad, 0..maxLift), `frontLoad` (0..1), `sledBoxPos` (0..1), `sledForce` (N), `dig`,
`temp` (0.25 cold, 0.9 hot, 1 = boom), `damage {engine, driveline}`, `boostLeft`, `boostTimer`, `spool`, `limiter`, `light` ('red'|'yellow'|'green'),
`status` ('staged'|'launch'|'pulling'|'stopped'|'fullPull'|'out'|'broken'), `done`, `launch`, `lastShift` ('perfect'|'good'|'early'|'late'),
`stats` (vehicleStats), `sled`, `trackLength` (m), `trackLengthFt`, `laneHalf`, `halfWidth`, `events[]` `{t, type, data}` (launch, shift, boost, hop, bump, hook, breakdown, outOfBounds, end), `result`.
**Physics.** Torque curve per engine type, then turbo spool, then gearing and converter. Tire force follows a slip curve that peaks at `idealSlip`: too much throttle spins and loses force, too little bogs.
Weight transfer from the chain and acceleration lifts the front (and kills steering). Hop grows when slip goes past ~1.45× ideal; feathering damps it.
Sled resistance is `base + box * P(boxPos)` with pan friction that digs deeper as speed drops, plus plow drag that grows with speed.
Lateral drift needs steering, and crossing a line is a DQ. Heat comes from rpm³·throttle, more on the limiter and with boost, and above 0.92 it damages the engine (rare blow-ups).
The launch reaction to green gives 'perfect' (≤0.2 s), 'good', 'late' or 'early' (jumped), each with a grip bonus or malus for 3 s.
**Result:** `{vehicleId, classId, driverId, seed, status, reason, distance (m), distanceFt (2 dp), distanceText, trackLengthFt, fullPull, dq, broken, launch, launchReact, topSpeed (mph), maxHop, time, score}`.
`TP.runPull` adds `{player, name, label, newBest?}`.

## 7. Controllers
A controller is `{kind:'player'|'ai', name, update(pull, dt, out)}` and writes `out.throttle/steer/shift/boost`.
- `TP.controllers.player` reads `TP.input`. It honours the `autoShift` and `assistTraction` settings.
- `TP.controllers.ai(skill, {name, salt})` takes `skill` as a name (`rookie|novice|good|pro|legend`, see `TP.skills`) or `{reaction, throttleFeel, shiftTiming, steering, aggression, consistency}` (0..1).
- `TP.controllers.resolve(c, skill, name)` accepts `'player'|'autoplay'|skillName|controller`.
- `TP.input = {throttle, steer, pedal, steerL, steerR, shiftHeld, boostHeld, keys, usingTouch, consumeShift(), consumeBoost(), reset()}`.

## 8. Rendering a pull
```js
TP.runPull({ vehicleId, upgrades, livery, driverId, name, controller: 'player'|'ai'|'autoplay'|ctrl, skill,
  venue, trackCondition, seed, sledMult, sled, extra, classId, spectate: bool, best /* ft to beat */, label }) -> Promise<result>
```
This renders the vehicle, the shared sled, a sagging hitch chain, the track, the boundary lines, the 50 ft markers, the live distance board and the start tree.
It drives the wheels, front lift, hop, smoke, flames, roost and sled dust, plus the HUD, announcer, crowd and engine audio.
Spectate mode turns on the camera director and the x1/x2/x4/Skip HUD. A full pull adds slow-mo, an orbit camera and confetti.
An aborted pull resolves `{aborted:true, ...}`.
Helpers: `TP.activePull()`, `TP.abortPull()`, `TP.skipPull()` (finishes instantly via `TP.sim.finish`), `TP.setFastForward(x)`, `TP.buildRig(vehicleId, livery)`,
`TP.poseRig(rig, pull, dt)`, `TP.rigEffects(rig, pull, dt)`, `TP.disposeRig(rig)`, `TP.menuShowcase(vehicleId, livery)`, `TP.hideMenuShowcase()`, `TP.driverLine(driverId, kind)`.
The render state is `TP.r3.pull`, which is `{p, rig, ctrl, ff, player, spectate, best, opts}` and is null when idle.

### Camera — `TP.cam`
`TP.cam.set(mode)`, `TP.cam.cycle()`, `TP.cam.director` (bool), `TP.cam.shake` (add to it), `TP.cam.order` (the cycle list), `TP.cam.names`.
Presets: `side` (default), `chase`, `front`, `sled`, `onboard`, `crowd`, `orbit`, `menu`. Add one with
`TP.cam.presets.myCam = function (rig, outPos, outLook) {...}`. `rig` exposes `{x, z, sledX, sledZ, lift, len, seatX, seatY}`.

### Particles — `TP.fx` (pooled, one draw call per type, no allocation)
`TP.fx.emit(type, x, y, z, vx, vy, vz, sizeMul?, lifeMul?, colorHex?)`, `TP.fx.burst(type, x, y, z, n, {spread, speed, up, sizeMul, lifeMul, color, colors, vx, vy, vz})`,
`TP.fx.addType(name, {max, tex:'puff'|'flame'|'chunk'|'square', blend:'normal'|'add', life:[a,b], size:[start,end], c0, c1, alpha, drag, gravity, spin})` (call before first use).
Types: `smoke, steam, dust, dirt, flame, spark, confetti`. `TP.fx.clear()`, `TP.fx.count()`. Pools are halved on Low.

### Audio — `TP.audio`
WebAudio starts on the first user gesture. `TP.audio.engine(vehicle.engine)` returns `{update(rpmNorm, throttle, load, boost, {limiter}), stop()}` and synthesizes diesel clatter, turbo whistle, gas V8, turbine or multi-engine stacks.
`TP.audio.sfx(name, {volume})` plays `hook|shift|bang|pop|horn|chime|click|light|go|whoosh|coin|thud`.
`TP.audio.crowd(level)`, `TP.audio.cheer(amount)`, `TP.cheer(amount)` (crowd jumps and the audio swells), `TP.audio.setMuted(bool)`, `TP.audio.ctx`, `TP.audio.master`.

## 9. Venues — `TP.venues[id]`
```js
TP.addVenue('night_fair', { name: 'Friday Night Lights', desc: '...', levelReq: 3, timeOfDay: 'night',
  trackCondition: 0.35, crowdSize: 1, laneHalf: 4.6, customTrack: false, trackOpts: { width: 29, dirtBase: '#6a4426' },
  sky: { top: 0x0b1530, horizon: 0x2a3050, sun: 0xffd9a0, sunIntensity: 0.6, hemiIntensity: 0.4, fogNear: 80, fogFar: 400 },
  build: function (ctx) { /* add scenery to ctx.group */ } });
```
`TP.loadVenue(id, {trackCondition, force})` builds a venue once and caches it. Unless `customTrack` is set, core builds the standard pad: the dirt track, berms, chalk lines at `±laneHalf`, the start line, the checkered finish, 50 ft cones and signs, the start tree and the live distance board.
**ctx:** `{id, def, group (add everything here), track:{length (m), lengthFt, laneHalf}, trackCondition, quality, lp, kit, palette, rng, addUpdate(fn(dt)), startLights, board, cheer}`.
**`TP.venueKit` (alias `ctx.kit`):** `dirtTexture(o)`, `grassTexture(o)`, `plane(ctx, w, d, tex, {x, y, z})`, `bleachers(builder, x0, x1, z0, rows, side, {roof, seat, riser}) -> seats[]`,
`crowd(ctx, seats, {max, maxLow}) -> {meshes, update}` (instanced, jumps with `TP.cheer`), `trees(ctx, [{x,z,s}])`, `hay(ctx, [{x,z,ry}])`, `pennants(builder, x0, x1, y, z, colors)`,
`banner(ctx, text, x, y, z, w, h, {bg, fg, face})`, `board(ctx, x, y, z, {sub, face}) -> {set(text, sub)}`, `standardTrack(ctx, o)`.
Put the grandstand at **−Z** (behind the track from the camera). The camera side (+Z) can stay open.
`TP.venueState` is the active ctx. Core ships `county_fair`.

## 10. Drivers — `TP.drivers[id]`
```js
TP.addDriver('dottie', { name: 'Dottie Mae Greer', nickname: 'Dynamite', hometown: 'Plum Hollow, KY',
  vehicleId: 'fs_prairie', livery: { base: '#e8731f', accent: '#17140f', number: '5', pattern: 'farm' }, upgrades: { engine_tune: 1 },
  skill: 'pro' /* or {reaction, throttleFeel, shiftTiming, steering, aggression, consistency} */, color: '#e8731f',
  lines: { intro: ['...'], good: ['...'], full: ['...'], bad: ['...'] } });
```
Core ships `wade`, `tammy`, `bo` (Street Diesel) and `earl` (Farm Stock). `TP.event.fieldFor(classId, n)` fills a field with generated drivers when needed; those have `generated: true`.

## 11. Events — `TP.event`
```js
TP.event.run({ name: 'County Fair Open', venue: 'county_fair', classes: ['street_diesel'],
  entrants: ['wade', 'tammy', 'bo', 'player'] /* optional: default = fieldFor(class, fieldSize||3) + player */,
  purse: 4000 /* per class */, payout: [0.5, 0.3, 0.2], pointsTable: [20, 17, 15, 13, 11],
  trackCondition: 0.2, pullOffMult: 1.08, onDone: function (out) {} }) -> Promise<out>
// out = { event, classes: {classId: [ranked results with place, points, cash, entrant, pullOff?]}, player: {place, cash, points, xp}, aborted? }
```
The flow per class is a hook order (shuffled AI, with the player after at least one AI).
For each AI hook the `eventNext` screen offers Watch / Skip / Skip all AI. Skipping uses `TP.sim.simulate`.
The track condition worsens by 0.035 per hook. Live standings are shown, ties of full pulls go to a pull-off (sled ×1.08 per round, up to 3 rounds), and each class ends with a standings screen.
The event ends with the `podium` screen and payouts (cash and XP go to the player). Helpers: `TP.event.rank(results)`, `TP.event.playerEntryFor(classId)`, `TP.event.active`.
`TP.watchPulls(driverIds, {heat, venue}) -> Promise<results>` spectates in sequence.

## 12. Save and economy — `TP.save` (localStorage `full_pull`, versioned)
`{v, cash, xp, level, garage:[{uid, vehicleId, upgrades:{id:level}, livery:{...}}], selected (uid), nextUid, owned:{shopId:true},
career:{}, stats:{pulls, fullPulls, wins, events, breakdowns, outs, totalFt, watched, bestByClass:{}, bestByVehicle:{}, perfectLaunches}, settings:{quality, sound, volume, assistTraction, autoShift, shake, showFps, camera, haptics, units}, trophies:[]}`.
- `TP.store()` persists and returns false if storage is unavailable; the game keeps running either way. `TP.extendSave(defaults)` deep-fills your own fields; call it at load time.
  `TP.migrations[fromVersion] = fn(save)`. `TP.resetSave()`.
- `TP.addCash(n, reason)`, `TP.addXP(n)` (emits `levelUp`), `TP.xpForLevel(level)`, `TP.rewardFor(result, {mult})`.
- `TP.garage.list() / get(uid) / selected() / select(uid) / owns(vehicleId) / findByVehicle(id) / add(vehicleId, livery) / remove(uid) / upgradeLevel(uid, id) / buyUpgrade(uid, id)`.
- `TP.playerEntry(vehicleId)` returns the garage entry or a loaner `{uid:null, loaner:true, ...}`.

## 13. Upgrades — `TP.upgrades[id]`
```js
TP.addUpgrade('compound_turbo', { name: 'Compound Turbos', slot: 'turbo' /* engine|turbo|fuel|tires|gearing|weights|hitch|cooling|driveline|boost */,
  desc: '...', appliesTo: { classes: [...], groups: ['truck'], vehicles: [...], engines: ['diesel'], boostOnly: true } /* or fn(vehicle) */,
  levels: [{ price: 9000, levelReq: 3, effect: { hpMult: 1.1, spoolMult: 1.3, heatMult: 1.05 } }, ...] });
```
The owned level's effect is **absolute**: level 2 uses `levels[1].effect` and does not stack with level 1. Effects from different upgrades combine, with `*Mult` keys multiplied and the others added.
Effect keys (`TP.effectKeys`): `hpMult, torqueMult, tractionAdd, heatMult, coolingAdd, weightAdd, frontWeightAdd, gearMult, shiftTimeMult, boostShotsAdd, boostMult, durabilityMult, hopDampMult, idealSlipMult, spoolMult, launchAdd, redlineAdd, hitchHeightAdd, steerMult, inertiaMult`.
Core ships `engine_tune, turbo, tires, cooling, front_weights, driveline, boost_kit`.

## 14. Shop — `TP.shop`
```js
TP.shop.add({ id: 'paint:chrome_flames', category: 'paint' /* vehicles|upgrades|paint|stacks|tires|weights|boost|cosmetic */,
  name: 'Chrome Flames', desc: '...', price: 2500, levelReq: 2, appliesTo: { groups: ['truck'] }, consumable: false, hidden: false,
  icon: function (ctx, w, h, item) { /* draw on a 96x64 canvas */ }, stats: { ... },
  onBuy: function (ctx) { var g = TP.garage.selected(); g.livery.pattern = 'flames'; TP.store(); } });
TP.shop.buy(id) -> bool;  TP.shop.owns(id);  TP.shop.blocker(id) -> '' | reason;  TP.shop.get(id);  TP.shop.items;  TP.shop.categories
```
Vehicle items are `veh:<vehicleId>` and are auto-created at boot.

## 15. UI — `TP.ui`
- `TP.ui.register(id, {render(el, args), onShow?(el, args), onHide?()})` registers a screen. You can replace core screens: `menu, quick, results, watch, garage, shop, settings, career, pause, eventNext, standings, podium`.
- `TP.ui.show(id, args)` / `TP.ui.go`, `TP.ui.hide(id?)`, `TP.ui.back()`, `TP.ui.rerender(id)`, `TP.ui.current`, `TP.ui.screen(id, html?)` returns the `<section class="screen">` element.
- `TP.ui.header(title, {back})` returns html (back button plus cash/level chips). `TP.ui.wire(el, {actName: fn(dataId, target, event), back?})` hooks up `[data-act][data-id]`, `[data-back]` and `[data-go]`.
- `TP.ui.menuButton(label, fn, {primary, icon, small, sub, cls, disabled})` returns a `<button>`. `TP.ui.icon(name)` returns svg markup, and `TP.ui.icons[name] = '<path/>'` adds an icon.
- `TP.ui.addMenuItem({id, label, sub, icon, primary, order, hidden, action})` adds a main-menu entry. Core ids are `play, career, watch, garage, shop, settings`.
- `TP.ui.toast(text, 'good'|'bad', ms)`, `TP.ui.banner(title, sub, {kind:'full'|'good'|'bad', ms})`, `TP.ui.announcer(text, {priority 0..3})`, `TP.ui.numberPop(text, kind)`.
- `TP.ui.css(cssText)` injects styles. `TP.ui.vehicleCard(v, o)`, `TP.ui.classCard(c, o)` and `TP.ui.standingsHtml(rows)` return html. `TP.ui.$(id)` and `TP.ui.$el(tag, cls, html)` are shortcuts.
- **HUD:** `TP.ui.hud.show(state)`, `.hide()`, `.update(state, dt)`, `.on`. `TP.ui.hudSlot(name)` returns an existing `[data-slot]` element (`distance, info, gauges, cluster, slip, tach, hop, lane, tree`)
  or creates a `div.hud-slot.slot-<name>` in `#hud-extra`. You position it with your own CSS.
- CSS tokens on `:root`: `--dirt --dirt-dk --diesel --flame --fair --sky --cream --green --red --blue --f-title --f-num --f-body --sl/--sr/--st/--sb (safe areas) --rad --shadow`.
  Classes: `.btn(.primary|.small|.icon|.danger) .chip .chipbtn .card .tabs/.tab .grid .list/.lrow .panel .toggle .seg .sticky-go .scr-head .scr-body`.
  `html.portrait` and `html.touch` are toggled automatically.
- Flow helpers: `TP.toMenu()`, `TP.startQuickPull(vehicleId, venueId, {controller, seed, trackCondition})`, `TP.quick` (the quick-pull selection).

## 16. Debug — `TP.debug` (URL `#debug` shows the FPS/draw-call meter and logs `listTypes()`)
`simulate(vehicleId, skill='pro', opts) -> result`, `batch(vehicleId, skill, n=20, opts) -> {avgFt, avgPct, min, max, fullPulls, dq, broken}`, `giveCash(n)`, `setLevel(l)`, `unlockAll()`,
`startQuickPull(vehicleId, venueId)`, `autoplay(vehicleId, skill, venueId)` (player pull driven by the AI), `fastForward(x)`, `listTypes()`, `fps()`, `info()` → `{calls, triangles, geometries, textures, particles, fps, quality}`.

---

## Performance rules (mid phones)
- Per frame there must be no `new`, closures, array or object literals, or string building. Use `TP.tmp`, preallocated arrays and pooled particles.
- Merge static geometry with `LP.builder()`. Use `InstancedMesh` for anything repeated (crowd, trees, bales, cones). A venue should stay under ~45 draw calls and ~60k triangles.
- Only `TP.lights.sun` casts shadows (off on Low). Do not add shadow-casting lights; use emissive materials for night lamps.
- Use `TP.quality === 'low'` to cut counts (crowd, particle rates). Particles are capped per type.
- Redraw canvas textures only when their content changes (see `venueKit.board`).
- DOM HUD: write only when a value changes, the way core caches through `setTxtC`.

## How to…
- **Add a class:** call `TP.addClass(id, {...})` at load. Sled numbers come from `weightLimit`, `tire` and `drive` unless you pass `sled`. Check balance with `TP.debug.batch(vehId, 'pro'|'good'|'novice')`. The targets are: pro averages 85–100% of the track with occasional full pulls, and novice 55–75%.
- **Add a vehicle:** call `TP.addVehicle(id, {..., build})`. Reuse `TP.models.*` or write a builder that returns the contract in §5, then add it to a class. Core creates the shop item.
- **Add a venue:** call `TP.addVenue(id, {sky, build(ctx)})` and add scenery to `ctx.group` with `ctx.kit` helpers. It appears in Quick Pull automatically.
- **Add a driver:** call `TP.addDriver(id, {...})`. Drivers appear in Watch, and in event fields for their vehicle's class.
- **Add an upgrade:** call `TP.addUpgrade(id, {slot, levels:[{price, effect}]})`. It appears in the Garage for every vehicle it `appliesTo`.
- **Add a shop item:** call `TP.shop.add({...})` and do your work in `onBuy`. A new category appears as a tab if it is one of `TP.shop.categories`; push your own category name there if needed.
- **Add a screen:** call `TP.ui.register('myScreen', {render: function (el) { el.innerHTML = TP.ui.header('Title') + '<div class="scr-body">...</div>'; TP.ui.wire(el, {...}); }})`, then `TP.ui.addMenuItem({id, label, icon, order, action: function () { TP.ui.show('myScreen'); }})`.
- **Add a HUD slot:** `TP.on('hudShow', function (S) { var e = TP.ui.hudSlot('combo'); e.textContent = ''; }); TP.on('pullUpdate', function (p) { ... });` with your CSS from `TP.ui.css`.
