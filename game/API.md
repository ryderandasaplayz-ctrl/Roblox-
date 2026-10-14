# Bounce Blast - plugin API (`window.BB`)

This is the contract between `core.js` and the feature files. If this doc and
`core.js` ever disagree, `core.js` wins - but please report it.

---

## 0. Ground rules for feature authors

| File | Owner | What goes there |
|---|---|---|
| `core.js` | core | Engine, the `BB` API, base content. **Feature agents never edit it.** |
| `features/platforms.js` | platforms | New `BB.platformTypes` |
| `features/enemies.js` | enemies | New `BB.enemyTypes`, boss fights |
| `features/powerups.js` | powerups | New `BB.effectTypes` + the `BB.itemTypes` that grant them |
| `features/meta.js` | meta | Missions, achievements, daily reward, spin wheel, upgrades, revive offer, leaderboard, pause UI, settings |
| `features/worlds.js` | worlds | Biomes/backgrounds, combo system, music, cosmetics (skins/trails/hats), juice |
| `main.js` | core | `BB.boot()` |

Load order is fixed: `core.js` -> `platforms` -> `enemies` -> `powerups` -> `meta` -> `worlds` -> `main.js`.
All files are classic scripts. Wrap your file in an IIFE: `(function (BB) { 'use strict'; ... })(window.BB);`

Hard rules:

- **Only edit your own file.** If you need a core change, report it instead of making it.
- **JS files must be ASCII only.** The page can be parsed without a charset, so a literal `●` turns into `â—`. Write `'●'` instead. HTML entities (`&#9679;`) are fine inside `innerHTML` strings.
- No `alert()` / `confirm()` / `prompt()`. Build confirmations into the page with `BB.ui`.
- Never touch `localStorage` directly. Store under your own key in `BB.save` and call `BB.store()` (it already handles storage that throws).
- No network, no external scripts.
- Prefix every DOM id and CSS class you create with your feature name (`meta-pause`, `.worlds-badge`) so files don't clash.
- Performance (60fps on a mid phone): no `shadowBlur` in per-frame drawing, no per-frame object/array/closure allocation in hot paths, cap anything you spawn, skip drawing things that are off screen. Reuse objects.
- Copy is short, plain, kid-friendly and exciting.
- Read `BB.G` fresh each time (it is replaced on every new run). Never cache `const G = BB.G` at load time.
- Register types/cosmetics/hooks at load time. If you need to see what *other* features registered, do it in a `'boot'` hook.

---

## 1. Coordinates and units

- Canvas units are **CSS pixels**. `BB.W`, `BB.H` = canvas size. The context already has the DPR transform applied.
- **World space**: x grows right (0..`BB.W`; the player wraps around the sides), **y grows downward**. Climbing makes y more negative.
- **Camera**: `G.cam` is the world y shown at the top of the screen. It only ever moves up (decreases).
  `screenY = worldY - G.cam`, `worldY = screenY + G.cam`. The visible world band is `G.cam .. G.cam + BB.H`.
- **Height units**: `G.maxH` (and `minHeight`, `BB.debug.setHeight`) are in height units = 10 world px. `G.maxH` is the best height reached this run.
- **Difficulty** `d = BB.difficulty()` = `min(1, G.maxH / 12000)`, 0 at the start, 1 at height 12000.
- Platform `x, y` = **top-left corner**; `y` is the surface the player lands on. Items, enemies and the player use **centre** `x, y`.
- Time: `dt` passed to update callbacks is **world seconds** (already multiplied by `BB.mods.timeScale`, clamped to 0.033 before scaling). `BB.rawDt` is the unscaled frame time. Effect timers count **real seconds**.

---

## 2. Lifecycle and event order

```
page load: core.js runs (save loaded + migrated) -> feature files register -> main.js: BB.boot()
BB.boot():  validate equipped cosmetics -> emit 'boot' -> demo world (newGame with G.demo=true, fires 'newGame')
            -> show 'menu' -> emit 'menu' -> start frame loop
PLAY:       BB.start(): (ends a live run with reason 'quit' if one exists) -> newGame -> emit 'newGame'
            -> initial platforms (emit 'spawnRow' per row) -> run is live, HUD shown -> emit 'start'
each frame: update (if running && !paused) then draw (always)
death:      BB.kill(reason) -> emit 'beforeDie' (true = cancel) -> run ends, coins banked, best saved
            -> BB.ui.overExtras emptied -> emit 'die'(result) -> 'over' screen shown
revive:     BB.revive() (from the over screen) -> emit 'revive'
menu:       BB.toMenu() (ends a live run with reason 'quit', which also emits 'die') -> show 'menu' -> emit 'menu'
```

The menu shows a frozen **demo world** (`G.demo === true`). `'newGame'` and the draw hooks run for it; `'update'`
hooks never do. `BB.kill` does nothing in the demo.

---

## 3. State

| Field | Type | Notes |
|---|---|---|
| `BB.G` | object or null | Current world (getter). See below. Non-null after boot. |
| `BB.save` | object | Persisted data (getter, same object for the whole session). |
| `BB.store()` | fn | Write `BB.save` to `localStorage['bounceblast']`. Safe if storage throws. |
| `BB.W`, `BB.H` | number | Canvas size in CSS px (getters). |
| `BB.DPR` | number | Device pixel ratio in use (max 2). |
| `BB.ctx`, `BB.canvas` | | The 2D context and the canvas element. |
| `BB.running` | bool | A run is in progress. **Stays true while paused.** False on menu/game over. |
| `BB.paused` | bool | Run is paused. |
| `BB.booted` | bool | `BB.boot()` has run. |
| `BB.t` | number | `G.t`: world seconds since the run started (0 without G). |
| `BB.dt`, `BB.rawDt` | number | Last frame's world dt and real dt. |
| `BB.input` | `{left, right}` | Steering this frame (after autopilot). Read-only for features. |
| `BB.layout` | object | Screen-space HUD geometry, see section 12. |
| `BB.version` | 2 | |

### `G` (run state)

| Field | Meaning |
|---|---|
| `p` | The player, see below. |
| `cam` | Camera top world y. |
| `maxH` | Best height this run (height units). Drives difficulty. |
| `bonus` | Extra score from `BB.addScore`. Displayed score = `BB.score()` = `floor(maxH + bonus)`. |
| `coins` | Coins collected this run. |
| `plats`, `items`, `enemies` | Live entity arrays (see registries). Use the spawn functions to add. To remove, set `pl.dead`, `it.got`, `e.remove`. |
| `parts` | Particle array (internal; use `BB.burst` / `BB.emitParticle`). |
| `stars` | Default sky stars `{x,y,s,col}` (x, y in 0..1). |
| `topY` | World y of the most recent spawned row. |
| `lastSolidY` | World y of the highest guaranteed-safe platform (reachability tracking). |
| `combo` | Combo counter. **Owned by worlds.js**; core only reads it (land beep pitch, `stats.maxCombo`). Starts at 0. |
| `shake` | Current screen shake amount (decays x0.9 per frame). Use `BB.shake`. |
| `t`, `realT` | World seconds / real seconds of this run. |
| `stats` | `{jumps, stomps, coins, powerups, springs, maxCombo}`. Features may add keys (do it in `'newGame'`). |
| `demo` | true for the menu demo world. |
| `dead` | true after the run ended (until revive). |
| `killer` | Enemy type that caused an `'enemy'` death, else null. |
| `revives` | How many times this run was revived. |
| `result` | The last death result object (see `BB.kill`). |
| `lastLand` | The last platform bounced on. |
| `trail` | 14 `{x,y}` world positions of the player, oldest first (last = now). Objects are reused. Reset when the player wraps. |
| `y0`, `hOff`, `coinAcc`, `banked` | Internal bookkeeping. |

Features may add their own fields to `G` in a `'newGame'` hook; prefix them (`G.metaRunMissions`, `G.worldsBiome`).

### `G.p` (player)

`{ x, y, vx, vy, r: 16, squash, effects: {}, effectMax: {}, grace }`

- `x, y` centre in world space. `vy < 0` = moving up.
- `squash`: 1 = round; landing sets 0.6 and it eases back. Drawn as scale `(2 - squash, squash)` anchored at the bottom of the ball.
- `effects`: `name -> seconds remaining`. `effectMax`: `name -> seconds at start/refresh` (for timer rings).
- `grace`: seconds of "can't be hurt by enemy contact" (set after a cancelled death and by revive).

---

## 4. Constants and mods

- `BB.GRAV = 1500` (px/s^2), `BB.JUMP = -780` (px/s), `BB.PLAT_H = 12`.
- `BB.maxJump()` = height in px of a normal bounce with current mods (`JUMP^2 / (2 GRAV)` = 203 by default).
- `BB.maxGap()` = `0.7 * BB.maxJump()` (~142): the largest vertical gap core leaves between safe platforms.

`BB.mods` - reset to `BB.MOD_DEFAULTS` at the start of every `newGame` **before** `'newGame'` hooks fire
(same object identity; extra keys are deleted):

| Mod | Default | Read by |
|---|---|---|
| `coinMult` | 1 | `BB.addCoins` (fractions carry over between calls) |
| `scoreMult` | 1 | `BB.addScore`, and height gained (extra goes into `G.bonus`) |
| `jumpMult` | 1 | every bounce (default, numeric `onLand`, `BB.bounce`, stomps, rescue) |
| `gravityMult` | 1 | player gravity |
| `timeScale` | 1 | world dt for all physics and callbacks (not effect timers) |
| `magnetRange` | 220 | magnet effect pull radius (px) |
| `effectDuration` | 1 | multiplies `BB.addEffect` seconds |
| `steerMult` | 1 | steering accel (`2400 * steerMult`); top speed `420 * max(.5, abs(steerMult))`. Negative = reversed controls. |

Permanent upgrades: change mods in a `'newGame'` hook. Temporary effects: change in `onStart`, undo in `onEnd`.
When several features may touch the same mod, **multiply and divide** instead of assigning
(`BB.mods.timeScale *= 0.6` / `/= 0.6`).

---

## 5. Hooks

```js
const off = BB.on(event, fn, priority = 0); // returns an unsubscribe function
BB.off(event, fn);
BB.emit(event, a, b, c, d);      // calls every handler (max 4 args); returns true if ANY returned true
BB.emitUntil(event, a, b, c, d); // stops at the first handler returning true; returns true then
BB.hasListeners(event);
```

Higher `priority` runs first; equal priority runs in registration order. A throwing handler is logged
(`console.error`, first 3 times) and skipped; the others still run. You can emit your own events
(prefix them: `'meta:mission'`).

| Event | Args | When | Return value |
|---|---|---|---|
| `boot` | - | once, in `BB.boot()`, before the demo world | - |
| `newGame` | `G` | new world built (runs **and** the demo; check `G.demo`), mods just reset, before platforms spawn | - |
| `start` | `G` | a real run just went live (HUD visible) | - |
| `spawnRow` | `rowY, G` | after core spawned a row (platform, items, enemy) | - |
| `preUpdate` | `dt, G` | start of every live frame, before player physics | - |
| `update` | `dt, G` | after all physics, collisions, camera, spawning and culling; before the fall check | - |
| `land` | `pl, p, G` | after the player bounced off a platform (not for `'pass'`) | - |
| `collect` | `it, G` | after an item's `onCollect` | - |
| `coins` | `amount, G` | after `BB.addCoins` credited whole coins | - |
| `stomp` | `e, G` | after an enemy was defeated via `BB.defeatEnemy` | - |
| `effectStart` | `name, G` | an effect became active (not on refresh) | - |
| `effectEnd` | `name, G` | an effect ended (time out or `BB.endEffect`) | - |
| `beforeDie` | `reason, G` | `BB.kill` was called (not in god mode) | `true` cancels the death (see 9) |
| `die` | `result` | the run ended; `BB.ui.overExtras` was just emptied; over screen shows right after | - |
| `revive` | `G` | after `BB.revive()` restored the run | - |
| `pause` / `resume` | - | `BB.pause()` / `BB.resume()` | - |
| `menu` | - | main menu shown (boot, `BB.toMenu()`, shop BACK) | - |
| `screen` | `id` | `BB.ui.show(id)` | - |
| `shopOpen` | `tab` | shop opened | - |
| `buy` | `item, kind` | a cosmetic was bought | - |
| `equip` | `kind, id` | a cosmetic was equipped | - |
| `drawBackground` | `ctx, G` | screen space, before the world | `true` = "I painted the whole screen", core skips its default sky (see 11) |
| `drawBehind` | `ctx, G` | world space, before platforms | - |
| `drawWorld` | `ctx, G` | world space, after platforms/items/enemies/particles/player/float texts | - |
| `drawPlayer` | `ctx, p, G` | player-local space after body, eyes and equipped hat | - |
| `drawHUD` | `ctx, G` | screen space, only while a run is live or paused (not demo, not dead), after the effect icons | - |

---

## 6. Registries

### 6.1 Platforms - `BB.platformTypes[name]`

```js
{
  weight(d, G) -> number,   // RELATIVE spawn weight for a row's main platform (0 = never)
  color: '#3ff0c0',         // used by the default draw
  w: 60 | (d, G) => 60,     // optional width; default max(50, 80 - 25d)
  solid: true,              // true ONLY if the player can always land and bounce on it safely
  noItems: false,           // true = put this row's item on the companion platform instead
  init(pl, G, d),           // optional: set up custom fields on a new platform
  update(pl, dt, G),        // optional: every frame (also while falling)
  onLand(pl, p, G) -> 'bounce' | 'pass' | number | undefined,
  draw(ctx, pl, G)          // optional: REPLACES the default pill (world space)
}
```

Platform object: `{ type, x, y, w, h: 12, age, falling, vy, dead, companion?, revive? }` + your `init` fields.

- **Landing**: checked when `p.vy > 0`, no active `noLand` effect, `p.x` is within `[pl.x - 0.6r, pl.x + pl.w + 0.6r]`, and the ball's bottom crossed `pl.y` this frame.
- **`onLand` results**: `undefined`/`'bounce'` -> normal bounce `JUMP * jumpMult` + default beep. `number` -> `p.vy = number * jumpMult`, **no** default beep (play your own). `'pass'` -> no bounce, the player falls through. Every bounce does `stats.jumps++`, sets `G.lastLand`, emits `'land'`.
- `pl.falling = true` -> core makes it fall with gravity and skips collision (that's how `break` works).
- `pl.dead = true` -> removed at the end of the frame. Platforms below `G.cam + BB.H + 100` are culled automatically.
- **Row spawning** (`spawnRow`): `rowY = topY - (60 + rand*(40 + 60d))`; type picked by relative weight.
  - `solid` type: `rowY` is clamped so it's never more than `BB.maxGap()` above `G.lastSolidY`.
  - not `solid` (default!): the platform spawns at `rowY` and core adds a `'normal'` companion (`companion: true`) at `rowY - 30` (also clamped to `maxGap`). **Anything fragile, moving-away, harmful or tricky must leave `solid` unset.**
  - Then: one item (on the row platform, or the companion if `noItems`), maybe one enemy, then `'spawnRow'`.
- Core weights (sum to exactly 1): `normal 1 - max(.28, .22 + .2d)`, `moving .12 + .15d`, `break .10 + .05d`, `spring max(0, .06 - .2d)`. So a new type with weight `0.05` shows up on roughly 5% of rows.
- Platforms you add from a `'spawnRow'` hook are extras: they don't count toward reachability.

Example:

```js
BB.platformTypes.cloud = {
  color: '#e8e0ff',
  weight: d => 0.03 + 0.05 * d,   // not solid: vanishes after one bounce, so core adds a safe companion
  init(pl) { pl.alpha = 1; },
  update(pl, dt) { if (pl.used) { pl.alpha -= dt * 3; if (pl.alpha <= 0) pl.dead = true; } },
  onLand(pl, p, G) {
    if (pl.used) return 'pass';
    pl.used = true;              // returning undefined = normal bounce + default beep
  },
  draw(ctx, pl) {
    ctx.globalAlpha = Math.max(0, pl.alpha);
    BB.drawPlatformBase(ctx, pl, '#e8e0ff');
    ctx.globalAlpha = 1;
  }
};
```

### 6.2 Items - `BB.itemTypes[name]`

```js
{
  weight(d, G) -> number,  // ABSOLUTE chance per row (core: coin .35, jet/shield/magnet .03 each; leftover = no item).
                           // If all weights add up to more than 1 they are normalised.
  minHeight: 0,            // optional: only spawn once G.maxH >= minHeight
  lift: 30,                // optional: px above the host platform's top (power-ups use 34)
  radius: 14,              // optional: pickup radius added to p.r
  powerup: false,          // true = core does stats.powerups++ on collect
  magnetic: false,         // true = pulled by the magnet effect
  color, icon,             // used by the default draw: BB.drawBadge(ctx, x, y + bob, 14, color, icon)
  init(it, G),             // optional
  update(it, dt, G),       // optional
  draw(ctx, it, G),        // optional (world space)
  onCollect(it, p, G)      // required
}
```

Item object: `{ type, x, y, age, got }` (centre). Set `it.got = true` to remove it.
On pickup core sets `it.got = true`, does `stats.powerups++` if `powerup`, calls `onCollect`, emits `'collect'`.
`BB.spawnItem(type, x, y)` returns the item.

### 6.3 Effects - `BB.effectTypes[name]`

```js
{
  icon: 'J', color: '#ff8a3d', label: 'Jetpack', // HUD badge: coloured circle + icon letter + timer ring
  noLand: false,       // true while active: platforms are ignored (jetpack)
  invincible: false,   // true while active: touching any enemy defeats it (jet, shield)
  onStart(p, G),       // when it becomes active (not on refresh)
  onEnd(p, G),         // when it runs out or BB.endEffect is called
  update(p, dt, G),    // every live frame while active; runs AFTER gravity was added, BEFORE position integrates
  draw(ctx, p, G)      // optional, world space, drawn just before the player (shield ring)
}
```

- `BB.addEffect(name, secs)` -> remaining secs. Duration is `secs * mods.effectDuration`. If already active, the timer becomes `max(remaining, new)` and the ring restarts when it grew. `onStart` only fires the first time.
- `BB.setEffect(name, secs)` - same but ignores `effectDuration`.
- `BB.hasEffect(name)`, `BB.endEffect(name)`, `BB.effectFlag('noLand' | 'invincible' | yourFlag)` -> any active effect has the flag.
- `BB.isInvincible()` -> `BB.debug.god` or an `invincible` effect is active.
- Timers tick in **real seconds**, only while the run is live (not paused, not dead).
- When a new run starts, effects are dropped **without** `onEnd` (mods are reset anyway). `BB.revive()` ends all effects with `onEnd`, then gives a 2s shield.
- Core effects: `jet` (2.5s, `noLand` + `invincible`, `vy = -950`), `shield` (8s, `invincible`), `magnet` (8s).

Example (item + effect):

```js
BB.effectTypes.slowmo = {
  icon: 'T', color: '#8fd8ff', label: 'Slow-mo',
  onStart() { BB.mods.timeScale *= 0.6; },
  onEnd()   { BB.mods.timeScale /= 0.6; }
};
BB.itemTypes.slowmo = {
  weight: () => 0.015, lift: 34, powerup: true, color: '#8fd8ff', icon: 'T',
  onCollect() { BB.addEffect('slowmo', 5); BB.ui.toast('SLOW-MO!'); BB.beep(300, 0.4, 'sine', 0.07, 0.5); }
};
```

### 6.4 Enemies - `BB.enemyTypes[name]`

```js
{
  r: 18,                    // collision radius
  weight(d, G) -> number,   // ABSOLUTE chance per row (bat: .04 + .08d). Return 0 for bosses you spawn yourself.
  minHeight: 1500,          // only spawn once G.maxH >= minHeight
  stompable: true,          // false = landing on it from above still hurts
  color,                    // default draw colour and stomp burst colour
  create(x, y, G) -> props, // optional; returned props are merged onto the enemy
  update(e, dt, G),         // optional; not called once e.dead
  draw(ctx, e, G),          // optional (world space); default is a circle
  onStomp(e, p, G, how),    // optional; how = 'stomp' | 'invincible'. Return true = you handled it all.
  onHit(e, p, G)            // optional; return true = the player survives this touch
}
```

Enemy object: `{ type, x, y, r, age, dead, remove }` + `create` props. Random enemies spawn at `(rand * W, rowY - 40)`.

Contact (circles overlap, `p.r + e.r`), checked every frame:
1. If (`p.vy > 0` and `p.y < e.y - 4` and `stompable !== false`) or `BB.isInvincible()`:
   `onStomp` -> if it returned `true` stop; otherwise `BB.defeatEnemy(e)` and `BB.bounce(BB.JUMP * 1.1)`.
2. Else if `p.grace > 0`: nothing.
3. Else `onHit` -> if it returned `true` stop; otherwise `G.killer = e.type; BB.kill('enemy')`.

Contact repeats every frame while overlapping - multi-hit enemies need their own cooldown.
`e.dead = true` -> stops updating/colliding and falls at 400 px/s until culled. `e.remove = true` -> deleted now.
Enemies below `G.cam + BB.H + 100` are culled (a boss that follows the camera stays).

- `BB.defeatEnemy(e, opts?)` -> coins credited. Sets `e.dead`, shake, `+coins`, burst, sound, toast `"STOMP! +3"`, `stats.stomps++`, emits `'stomp'`. `opts = { coins: 3, toast: 'STOMP!' | false, color, shake: 8 }`.
- `BB.bounce(vy = BB.JUMP)` -> `p.vy = vy * jumpMult`, squash.

Example (plus a boss sketch):

```js
BB.enemyTypes.ghost = {
  r: 16, minHeight: 3000, stompable: false, color: '#c9b8ff',
  weight: d => 0.02 + 0.04 * d,
  create() { return { phase: Math.random() * 6 }; },
  update(e, dt, G) { e.phase += dt; e.x += BB.wrapDx(G.p.x - e.x) * 0.3 * dt; },
  draw(ctx, e) { ctx.globalAlpha = 0.7; ctx.fillStyle = '#c9b8ff'; BB.util.circle(ctx, e.x, e.y, e.r); ctx.globalAlpha = 1; }
};

BB.enemyTypes.kingBat = {
  r: 40, weight: () => 0, color: '#ff4fa3',
  create() { return { hp: 3, hitT: 0 }; },
  update(e, dt, G) { e.hitT -= dt; e.y += (G.cam + 150 - e.y) * 2 * dt; },   // hover near the top of the screen
  onStomp(e, p, G, how) {
    if (e.hitT > 0) return true;
    e.hitT = 0.5; e.hp--; BB.bounce(BB.JUMP * 1.2); BB.shake(10);
    if (e.hp <= 0) BB.defeatEnemy(e, { coins: 25, toast: 'BOSS DOWN!' });
    return true;
  }
};
BB.on('update', (dt, G) => {
  if (G.maxH > 5000 && !G.enemiesBoss1) { G.enemiesBoss1 = true; BB.spawnEnemy('kingBat', BB.W / 2, G.cam - 60); }
});
```

---

## 7. Spawning

| Call | Returns | Notes |
|---|---|---|
| `BB.spawnPlatform(type, x?, y, w?)` | platform or null | `x` null/undefined = random. Width defaults as in 6.1. Calls `init`. |
| `BB.spawnItem(type, x, y)` | item or null | centre position |
| `BB.spawnEnemy(type, x, y)` | enemy or null | centre position, merges `create()` |
| `BB.spawnRow()` | - | force one more core row above `G.topY` (rarely needed) |

Unknown types log a warning and return null. All need a world (`BB.G`).

---

## 8. Coins and score

- `BB.addCoins(n, x?, y?)` -> whole coins credited (`n * coinMult`, fractions carry). With `x, y` (world) floats a `"+n"`. `n` must be > 0. Updates `G.coins`, `G.stats.coins`, emits `'coins'`.
- `BB.addScore(n)` -> adds `n * scoreMult` to `G.bonus`.
- `BB.score()` -> `floor(G.maxH + G.bonus)` (what the HUD shows).
- Wallet (outside runs): `BB.bankCoins(n)` adds to `BB.save.coins` (negative allowed, floors at 0), saves, refreshes the menu. `BB.spendCoins(n)` -> `true` and saves if affordable, else `false`.
- Run coins are added to the wallet when the run ends (each coin only once, also across revives).

---

## 9. Death, revive, run control

`BB.kill(reason)` -> `true` if the run ended.
- Ignored (returns false) in the demo, when not running, or already dead.
- `BB.debug.god` cancels every reason except `'debug'`.
- Otherwise `'beforeDie'(reason, G)` handlers run by priority until one returns `true` (= cancelled).
- **Cancelled**: if the player is still below the screen, core does a rescue bounce from the bottom edge (`JUMP * 1.5`); the player gets 1s `grace`. A handler may move the player itself instead (bubble, teleport).
- **Not cancelled**: run ends, coins banked, best saved, `overExtras` emptied, `'die'(result)` fires, then the over screen shows (unless a `'die'` handler revived).

Core reasons: `'fall'` (dropped 60px below the screen), `'enemy'`, `'debug'`, and `'quit'` (only from `BB.start()`/`BB.toMenu()` during a live run; never goes through `'beforeDie'`, no over screen). Features may use their own (`'spikes'`, `'laser'`).

`result = { score, height, coins, reason, durationSec, stats, newBest, prevBest, killer, revives }`
(`coins` = this run's total, `durationSec` = real time incl. revived parts, `stats` is `G.stats`).

| Call | Effect |
|---|---|
| `BB.start()` | New run (ends a live one as `'quit'` first). |
| `BB.pause()` -> bool | Live run only. Freezes update; draw continues. Clears steering. Emits `'pause'`. |
| `BB.resume()` -> bool | Emits `'resume'`. |
| `BB.toMenu()` | Ends a live run as `'quit'`, hides the HUD, shows the menu, emits `'menu'`. Safe to call any time (use it for BACK buttons). |
| `BB.revive()` -> bool | Only after a real death (not `'quit'`) while the over screen is up. Ends effects, adds a 90px `'normal'` platform at `G.cam + 0.72H` (`pl.revive = true`), puts the player on it bouncing up, 2s shield + 1s grace, run live again, emits `'revive'`. |

Auto-pause: when the tab is hidden during a live run core calls `BB.pause()`.
**Pause UI belongs to meta.js.** Until some file registers a `'pause'` listener, core draws a fallback
"PAUSED / Tap to keep going" overlay and resumes on canvas tap or Space/Enter/Esc/P. Once you listen to
`'pause'`, you must offer a way to call `BB.resume()`.

---

## 10. Juice, sound, vibration

| Call | Notes |
|---|---|
| `BB.beep(freq, dur = .08, type = 'square', vol = .06, slide = 0)` | One oscillator blip; `slide` = end freq multiplier. No-op when sound is off. |
| `BB.burst(x, y, color, n = 12, speed = 220)` | World-space particle burst (life .6s, gravity 600). |
| `BB.emitParticle(x, y, vx, vy, life = .6, color, size = 4, gravity = 600)` | One square particle; returns it or null when the cap (320) is hit. |
| `BB.shake(amount = 8)` | Screen shake (`G.shake = max(G.shake, amount)`). |
| `BB.flash(color = '#fff', alpha = .5)` | Full-screen flash fading over 0.25s. |
| `BB.floatText(text, x, y, color)` | World-space text rising and fading over 0.9s (cap 24). |
| `BB.vibrate(ms or pattern)` | Respects `BB.vibration.enabled`; safe where unsupported. |
| `BB.sound.enabled` | get/set. Setting false also mutes `BB.sound.out()` (music). |
| `BB.sound.ctx()` | The shared `AudioContext` or null. Created lazily; resumed on the first tap/key. |
| `BB.sound.out()` | Master `GainNode` - connect music here, not to `ctx.destination`. |
| `BB.vibration.enabled` | Plain boolean flag (settings toggle it; meta persists it). |

Audio can only start after a user gesture; wrap your WebAudio code in try/catch and bail if `BB.sound.ctx()` is null.

---

## 11. Drawing

Per frame:

1. Default sky (gradient + stars) - skipped if a `'drawBackground'` handler returned `true` **last frame**.
2. `'drawBackground'` (screen space). Then the context is reset (transform + alpha).
3. World transform (`translate(shake, -G.cam + shake)`), `'drawBehind'`.
4. Platforms, items, enemies (only near the screen), particles.
5. Effect `draw`s (e.g. shield ring), equipped trail.
6. Player: body (skin), eyes, equipped hat, `'drawPlayer'` (player-local space).
7. Float texts, `'drawWorld'`, restore.
8. Flash overlay. Then, during a live/paused run: effect icon row, `'drawHUD'` (screen space).

`'drawBackground'` that **replaces** the sky must paint the whole screen opaquely and `return true`, and should
use a higher priority (e.g. `10`) so decorations (priority 0, return nothing) draw on top of it.

```js
BB.on('drawBackground', (ctx, G) => {
  if (G.maxH < 3000) return;              // core's default sky
  ctx.fillStyle = '#062a33';
  ctx.fillRect(0, 0, BB.W, BB.H);
  return true;
}, 10);
```

**Player-local space** (skins, hats, `'drawPlayer'`): origin = ball centre, squash/stretch applied, top of the
head at `(0, -p.r)`, `p.r` = 16. Eyes sit at `(+-6, -3)`.

Always restore what you change (`globalAlpha`, `lineWidth`, transforms - prefer `save/restore` only around
transforms). Never use `shadowBlur` per frame.

Helpers: `BB.rr(ctx, x, y, w, h, r)` (filled round rect), `BB.util.circle(ctx, x, y, r)` (filled),
`BB.drawPlatformBase(ctx, pl, color)`, `BB.drawBadge(ctx, x, y, r, color, icon)`,
`BB.util.paint(color, t)` (resolves `'rainbow'`).

---

## 12. UI

All overlays are `.screen` elements inside `#screens` (inside `#wrap`). Only one screen shows at a time.
A visible screen covers the canvas and blocks steering, so during a run pause first (or use `BB.ui.toast` /
`'drawHUD'` for in-run messages).

| Call | Notes |
|---|---|
| `BB.ui.screen(id, html?)` -> element | Creates (hidden) or returns `#id`; sets `innerHTML` if `html` given. Content is centred and scrolls when tall. |
| `BB.ui.show(id)` | Hides every other screen, shows `#id`, emits `'screen'`. Doesn't touch the HUD. |
| `BB.ui.hide(id)`, `BB.ui.hideAll()`, `BB.ui.current()` | |
| `BB.ui.button(label, onClick, cls?)` -> button | Detached button (label is HTML). Click errors are caught + logged. |
| `BB.ui.menuButton(label, onClick, {alt = true, id})` -> button | Appended to the menu's `#menuExtras` row (under PLAY/SHOP). `alt:false` = big sun-yellow style. |
| `BB.ui.hudButton(label, onClick, ariaLabel)` -> button | 44px round button in the HUD's second row (right side). Never steers. Visible only during runs. |
| `BB.ui.overButton(label, onClick, {alt = true, id})` -> button | Appended to `BB.ui.overExtras`, which is **emptied at every death before `'die'`** - add per-death buttons (Revive) from a `'die'` handler. |
| `BB.ui.toast(text, color?)` | Big centred message for 1.1s (default mint). |
| `BB.ui.css(cssText)` -> `<style>` | Inject CSS. |
| `BB.ui.overExtras`, `BB.ui.menuExtras`, `BB.ui.hud`, `BB.ui.hudButtons`, `BB.ui.root` | The raw elements. |

Core screen ids: `menu`, `shop`, `over`. Core element ids: `play`, `shopBtn`, `again`, `home`, `back`, `best`,
`coins`, `final`, `overMsg`, `hud`, `hudRow`, `score`, `coinsHud`, `hudBtns`, `toast`.

Available CSS: tokens `--sky --sky2 --ink --sun --pop --mint --dim`, fonts `--display` (Bungee) and `--body`
(Nunito 700/900); elements `h1`, `h2`, `p` (dim, 30ch), `.big`, `button` (sun, chunky shadow), `button.alt`
(mint, smaller), `.stats` (`<b>` is sun), `.extras` (wrapping button row), `.scroll` (vertical scroll area -
**required** for anything scrollable, the page blocks touch scrolling elsewhere), `.tabs` + `.tab` + `.tab.on`,
`.skin` (shop card), `.hbtn` (round HUD button). Buttons are >= 44px tall; keep your touch targets >= 44px.

`BB.layout` (canvas px, refreshed on resize and when a run starts):
`hudX` (left edge of the score), `effectsY` (top of the effect icon row / HUD button row),
`hudBottom` (first free y below the HUD), `safeTop`, `safeBottom`, `safeLeft`, `safeRight` (env insets).
Draw your own HUD bits below `hudBottom`, or above `BB.H - layout.safeBottom`.

Example (pause screen for meta.js):

```js
BB.ui.screen('meta-pause', '<h2>PAUSED</h2><button id="meta-resume">KEEP GOING</button>' +
  '<button class="alt" id="meta-quit">QUIT</button>');
document.getElementById('meta-resume').onclick = () => BB.resume();
document.getElementById('meta-quit').onclick = () => BB.toMenu();
BB.ui.hudButton('II', () => BB.pause(), 'Pause');
BB.on('pause', () => BB.ui.show('meta-pause'));
BB.on('resume', () => BB.ui.hide('meta-pause'));

BB.on('die', r => {                       // per-death revive offer
  if (r.reason === 'quit' || BB.G.revives > 0) return;
  BB.ui.overButton('REVIVE ● 50', () => { if (BB.spendCoins(50)) BB.revive(); }, { alt: false });
});
```

---

## 13. Cosmetics and the shop

```js
BB.cosmetics = {
  skins:  [{ id, name, price, color?, draw?(ctx, p, t), preview?, locked?() }],
  trails: [{ id, name, price, color?, draw?(ctx, pts, p, G), preview?, locked?() }],
  hats:   [{ id, name, price, draw(ctx, p, t), preview?, locked?() }]
};
```

- `id` must be **unique across all three lists** (ownership is one list). Prefix new ones (`worlds-crown`).
- `price: 0` = owned by everyone.
- `color`: CSS colour or `'rainbow'` (cycles hue over time).
- Skin `draw(ctx, p, t)`: player-local space, paint the body (circle of radius `p.r` at the origin); core draws eyes on top.
- Hat `draw(ctx, p, t)`: player-local space, after the eyes. Top of the head is `(0, -p.r)`.
- Trail: either `color` (core draws fading dots) or `draw(ctx, pts, p, G)` in world space before the player;
  `pts` = `G.trail` (14 reused `{x, y}`, oldest first). Don't keep references.
- `preview`: CSS background for the shop dot, or `'none'` (dashed circle). Without it, colour skins show their
  colour and anything with `draw` gets a small canvas preview (calls your `draw` with a fake `p`, `r = 15`, `t = 0`).
- `locked()`: return a short string (`'Reach 5000'`) to show instead of the price and block buying; falsy = buyable.
- Core content: skins `sunny` (0), `bubblegum` (50), `mint` (100), `lava` (200), `ice` (300), `rainbow` (600);
  trail `notrail`; hat `nohat`.
- Shop screen (`BB.openShop(tab?)`, tab = `'skins' | 'trails' | 'hats'`) is rebuilt every time it opens, so
  push items at load time or any time before. `BB.renderShop()` redraws it while open.
- Helpers: `BB.equipped(kind)` -> item (kind = `'skin' | 'trail' | 'hat'`), `BB.equip(kind, id)` -> bool (must own),
  `BB.owns(id)`, `BB.grant(id)` (give for free, e.g. spin-wheel prize), `BB.findCosmetic(id)`.

```js
BB.cosmetics.hats.push({
  id: 'worlds-crown', name: 'Crown', price: 400,
  draw(ctx, p) {
    const y = -p.r + 3;
    ctx.fillStyle = '#ffcf3f';
    ctx.beginPath();
    ctx.moveTo(-10, y); ctx.lineTo(-10, y - 12); ctx.lineTo(-5, y - 6); ctx.lineTo(0, y - 14);
    ctx.lineTo(5, y - 6); ctx.lineTo(10, y - 12); ctx.lineTo(10, y);
    ctx.fill();
  }
});
```

---

## 14. Save data

`BB.save` (persisted as JSON in `localStorage['bounceblast']`):

```js
{ v: 2, best, coins, owned: ['sunny', ...], equipped: { skin, trail, hat }, /* feature keys */ }
```

- Old saves (`owned` = skin indices, `skin` = index) are migrated on load: index 0..5 ->
  `sunny, bubblegum, mint, lava, ice, rainbow`. Unknown equipped ids fall back to the first item at boot.
- Each feature keeps everything under one key named after it and calls `BB.store()` after changes:

```js
const S = BB.save.meta || (BB.save.meta = { daily: 0, missions: [] });
S.daily = Date.now();
BB.store();
```

- Unknown top-level keys survive load/save, so you never need a migration from core.
- The game must work when storage throws (it starts fresh each load); `BB.store()` handles that.

---

## 15. Debug and testing

`BB.debug` (works in any build; `#debug` in the URL only sets `BB.debugEnabled = true`, no UI):

| Member | Notes |
|---|---|
| `god` | No death (any reason except `'debug'`); also counts as invincible, so enemies get stomped. Falling = rescue bounce. |
| `autopilot` | Steers toward the highest platform it can reach. |
| `spawnPlatform(type)` | Centred on the player, 90px above. |
| `spawnItem(type)` | 70px above the player. |
| `spawnEnemy(type)` | 180px above the player. |
| `effect(name, secs = 5)` | `BB.addEffect`. |
| `setHeight(h)` | Jump progression/difficulty to height `h` (score follows). |
| `addCoins(n)` | Adds to the wallet. |
| `kill()` | Ends the run with reason `'debug'` even in god mode. |
| `listTypes()` | `{platforms, items, enemies, effects, skins, trails, hats}` id lists. |

Headless smoke test recipe (Chromium at `/opt/pw-browsers`, phone 390x844, DPR 2, touch): open
`file:///home/user/Roblox-/game/index.html`, collect `console` errors and `pageerror`s, click `#play`, set
`BB.debug.god = BB.debug.autopilot = true`, wait, spawn each of your types via `BB.debug`, check `BB.score()`
rises and no errors were logged. Run `node --check` on your file.
Core adds a viewport meta tag when the page has none (raw file://), so phone emulation lays out at real
phone width; under the publish host the host's own tag is used.

---

## 16. Misc helpers

`BB.difficulty()`, `BB.score()`, `BB.maxJump()`, `BB.maxGap()`, `BB.wrapDx(dx)` (shortest horizontal delta
with wrap-around), `BB.util.clamp(v, a, b)`, `BB.util.rand(a, b)`, `BB.util.pick(arr)`, `BB.clearInput()`,
`BB.refreshMenu()`, `BB.colors` (token hex values), `BB.MOD_DEFAULTS`.
