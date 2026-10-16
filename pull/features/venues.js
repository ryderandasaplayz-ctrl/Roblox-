/* =============================================================================
 * FULL PULL — features/venues.js
 * Venues, atmosphere, effects, cameras, audio layers and the announcer.
 *
 *  - 5 venues (county_fair upgraded, twilight_fair, state_fair_night, mud_bog, national_finals)
 *  - realistic tilled dirt (normal-mapped), grass, clouds, stars, per-venue environment map (IBL)
 *  - GPU-animated instanced crowd (stand / cheer / wave arms / jump / stadium wave) — one draw call
 *  - persistent tire ruts + sled pan swipes (instanced decals), track-prep tractor between sessions
 *  - extra pooled FX: billowing diesel smoke, methanol flames + lift-off pops, heat shimmer,
 *    turbine glow, roostertails, mud, sled sparks, cartoon fireballs, fireworks
 *  - cameras: smooth side tracking with lead/zoom, heli, wheel cam, spectate director
 *  - audio layers: exhaust roar, V8 lope, methanol scream, tire spin, sled scrape, PA babble
 *  - announcer: lots of varied hype lines reacting to the pull
 * Only uses window.TP (see API.md). Everything is defensive: missing pieces are skipped.
 * ========================================================================== */
(function () {
  'use strict';
  var TP = window.TP;
  if (!TP) return;

  var VX = TP.venuesFx = { version: 1 };
  var FT = 0.3048;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function mkRng(seed) {
    var s = (seed >>> 0) || 1;
    var f = function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.range = function (a, b) { return a + (b - a) * f(); };
    return f;
  }
  function warn(e) { try { console.warn('[venues]', e); } catch (x) {} }
  function hexRgb(h) { if (typeof h === 'string') h = parseInt(h.replace('#', ''), 16); return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
  var LPX = function () { return TP.lowpoly; };
  function low() { return TP.quality === 'low'; }

  /* ---------------------------------------------------------------------------
   * 1. PARTICLE TYPES (registered at load; pools are created lazily on first emit)
   * ------------------------------------------------------------------------- */
  try {
    var AT = TP.fx && TP.fx.addType;
    if (AT) {
      AT('billow',   { max: 240, tex: 'puff', blend: 'normal', life: [2.4, 4.2], size: [1.2, 7.5], c0: 0x110f0d, c1: 0x6d6862, alpha: 0.36, drag: 0.9, gravity: -0.55, spin: 0.3 });
      AT('shimmer',  { max: 110, tex: 'puff', blend: 'normal', life: [0.35, 0.8], size: [0.35, 1.5], c0: 0xe8e2d8, c1: 0xffffff, alpha: 0.1, drag: 1.2, gravity: -2.5, spin: 1 });
      AT('glow',     { max: 90, tex: 'flame', blend: 'add', life: [0.07, 0.16], size: [1.1, 2.0], c0: 0xfff0d0, c1: 0xff7a20, alpha: 0.8, drag: 2, gravity: -1, spin: 0 });
      AT('bigflame', { max: 260, tex: 'flame', blend: 'add', life: [0.14, 0.38], size: [1.0, 3.0], c0: 0xfff7d8, c1: 0xff3a08, alpha: 1, drag: 1.6, gravity: -7, spin: 2 });
      AT('clod',     { max: 320, tex: 'chunk', blend: 'normal', life: [0.8, 1.6], size: [0.26, 0.2], c0: 0x4a2e17, c1: 0x6a4626, alpha: 1, drag: 0.15, gravity: 11, spin: 9 });
      AT('roostdust',{ max: 220, tex: 'puff', blend: 'normal', life: [1.0, 2.2], size: [0.6, 3.8], c0: 0x8a6440, c1: 0xbfa07a, alpha: 0.42, drag: 1.4, gravity: -0.1, spin: 0.4 });
      AT('mud',      { max: 420, tex: 'chunk', blend: 'normal', life: [0.7, 1.4], size: [0.22, 0.16], c0: 0x24160b, c1: 0x3a2513, alpha: 1, drag: 0.2, gravity: 10.5, spin: 8 });
      AT('spray',    { max: 140, tex: 'puff', blend: 'normal', life: [0.5, 1.1], size: [0.4, 1.8], c0: 0x8a7a66, c1: 0xb8ab98, alpha: 0.3, drag: 1.4, gravity: 3, spin: 0.5 });
      AT('fireball', { max: 140, tex: 'flame', blend: 'add', life: [0.5, 1.2], size: [2.2, 7.5], c0: 0xfff4c0, c1: 0xff2a00, alpha: 1, drag: 1.7, gravity: -3, spin: 1 });
      AT('firework', { max: 900, tex: 'flame', blend: 'add', life: [1.1, 2.0], size: [0.55, 0.15], c0: 0xffffff, c1: 0xffffff, alpha: 1, drag: 1.25, gravity: 2.2, spin: 0, keepColor: true });
      AT('ember',    { max: 200, tex: 'flame', blend: 'add', life: [0.25, 0.55], size: [0.4, 0.1], c0: 0xfff0c0, c1: 0xff7a20, alpha: 0.9, drag: 1, gravity: 1, spin: 0 });
    }
  } catch (e) { warn(e); }

  /* ---------------------------------------------------------------------------
   * 2. TEXTURES — tileable value noise, tilled dirt (+normal map), grass, ruts, clouds
   * ------------------------------------------------------------------------- */
  var texCache = {};
  function noiseLayer(N, cells, rng) {
    var g = new Float32Array(cells * cells), out = new Float32Array(N * N), i, x, y;
    for (i = 0; i < g.length; i++) g[i] = rng();
    for (y = 0; y < N; y++) {
      var fy = y / N * cells, iy = Math.floor(fy), ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
      var y0 = iy % cells, y1 = (iy + 1) % cells;
      for (x = 0; x < N; x++) {
        var fx = x / N * cells, ix = Math.floor(fx), tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
        var x0 = ix % cells, x1 = (ix + 1) % cells;
        var a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
        out[y * N + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      }
    }
    return out;
  }
  function fbm(N, seed, base, oct) {
    var rng = mkRng(seed), out = new Float32Array(N * N), amp = 1, tot = 0, cells = base;
    for (var o = 0; o < oct; o++) {
      var l = noiseLayer(N, cells, rng);
      for (var i = 0; i < out.length; i++) out[i] += l[i] * amp;
      tot += amp; amp *= 0.5; cells *= 2;
    }
    for (var j = 0; j < out.length; j++) out[j] /= tot;
    return out;
  }
  function normalCanvas(h, N, strength) {
    var cv = document.createElement('canvas'); cv.width = cv.height = N;
    var c = cv.getContext('2d'), img = c.createImageData(N, N), d = img.data;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var l = h[y * N + ((x - 1 + N) % N)], r = h[y * N + ((x + 1) % N)], u = h[((y - 1 + N) % N) * N + x], dn = h[((y + 1) % N) * N + x];
      var nx = (l - r) * strength, ny = (u - dn) * strength, nz = 1, il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      var k = (y * N + x) * 4;
      d[k] = (nx * il * 0.5 + 0.5) * 255; d[k + 1] = (ny * il * 0.5 + 0.5) * 255; d[k + 2] = (nz * il * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return cv;
  }
  function texFromCanvas(cv, repeat, srgb) {
    var t = new THREE.CanvasTexture(cv);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = low() ? 2 : 8;
    t.userData = t.userData || {};
    t.userData.canvas = cv;
    return t;
  }
  /** Realistic tilled pulling dirt. o = {base, wet, grooves, repeat}. Returns the color map; userData.normalMap + rough. */
  function dirtTexture(o) {
    o = o || {};
    var N = low() ? 256 : 512, wet = clamp(o.wet || 0, 0, 1);
    var key = 'dirt|' + N + '|' + (o.base || '') + '|' + wet.toFixed(2) + '|' + (o.grooves !== false);
    var cached = texCache[key];
    if (!cached) {
      var n1 = fbm(N, 17, 4, 5), n2 = fbm(N, 91, 16, 3), rng = mkRng(33);
      var h = new Float32Array(N * N), furrows = 22;
      var fo = fbm(N, 5, 3, 2);
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        var i = y * N + x;
        var v = y / N * furrows + fo[i] * 1.6;
        var fur = Math.pow(Math.abs(Math.sin(v * Math.PI)), 0.7);
        h[i] = n1[i] * 0.45 + n2[i] * 0.25 + (o.grooves === false ? 0.15 : fur * 0.32);
      }
      // clods + pebbles
      for (var cnum = 0; cnum < N * 1.6; cnum++) {
        var cx = (rng() * N) | 0, cy = (rng() * N) | 0, r = 1 + (rng() * (N / 160)) | 0, amp = 0.15 + rng() * 0.25;
        for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
          var dd = (dx * dx + dy * dy) / (r * r + 0.01); if (dd > 1) continue;
          var ii = ((cy + dy + N) % N) * N + ((cx + dx + N) % N); h[ii] += amp * (1 - dd);
        }
      }
      var base = hexRgb(o.base || (wet > 0.45 ? '#5e3d22' : '#8c5d36'));
      var dk = 0.62 - wet * 0.12, lt = 1.22 - wet * 0.18;
      var cv = document.createElement('canvas'); cv.width = cv.height = N;
      var c = cv.getContext('2d'), img = c.createImageData(N, N), d = img.data;
      for (var k = 0; k < N * N; k++) {
        var hv = clamp(h[k], 0, 1.4), m = dk + (lt - dk) * clamp(hv * 0.9, 0, 1);
        var sp = (n2[k] - 0.5) * 0.12;
        var r0 = base[0] * (m + sp), g0 = base[1] * (m + sp * 0.9), b0 = base[2] * (m + sp * 0.7);
        if (hv > 0.9) { r0 *= 1.08; g0 *= 1.06; }     // sun-dried tops of clods
        d[k * 4] = clamp(r0, 0, 255); d[k * 4 + 1] = clamp(g0, 0, 255); d[k * 4 + 2] = clamp(b0, 0, 255); d[k * 4 + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      // fine grit
      for (var s = 0; s < N * 6; s++) { c.fillStyle = rng() < 0.5 ? 'rgba(40,24,10,0.35)' : 'rgba(210,170,120,0.25)'; c.fillRect(rng() * N, rng() * N, 1 + rng() * 1.5, 1 + rng() * 1.5); }
      cached = texCache[key] = { cv: cv, ncv: normalCanvas(h, N, low() ? 2.2 : 3.2), rough: 0.97 - wet * 0.42 };
    }
    var t = texFromCanvas(cached.cv, o.repeat || [1, 1], true);
    var nt = texFromCanvas(cached.ncv, o.repeat || [1, 1], false);
    t.userData.normalMap = nt; t.userData.rough = cached.rough; t.userData.normalScale = 0.9 + wet * 0.3;
    return t;
  }
  function grassTexture(o) {
    o = o || {};
    var N = low() ? 256 : 512, key = 'grass|' + N + '|' + (o.base || '') + '|' + (o.dry || 0);
    var cached = texCache[key];
    if (!cached) {
      var n1 = fbm(N, 7, 3, 4), rng = mkRng(77), base = hexRgb(o.base || '#5f8f36');
      var cv = document.createElement('canvas'); cv.width = cv.height = N;
      var c = cv.getContext('2d'), img = c.createImageData(N, N), d = img.data, dry = o.dry || 0;
      for (var k = 0; k < N * N; k++) {
        var m = 0.72 + n1[k] * 0.5;
        d[k * 4] = clamp(base[0] * m + dry * 40 * n1[k], 0, 255); d[k * 4 + 1] = clamp(base[1] * m, 0, 255); d[k * 4 + 2] = clamp(base[2] * m * 0.9, 0, 255); d[k * 4 + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      for (var s = 0; s < N * 14; s++) {
        var x = rng() * N, y = rng() * N, l = 2 + rng() * 5;
        c.strokeStyle = rng() < 0.5 ? 'rgba(40,70,20,0.35)' : 'rgba(170,200,100,0.28)';
        c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rng() - 0.5) * 2, y - l); c.stroke();
      }
      cached = texCache[key] = { cv: cv };
    }
    return texFromCanvas(cached.cv, o.repeat || [40, 40], true);
  }
  function canvasTex(key, w, h, draw, srgb) {
    if (texCache[key] && texCache[key].tex) return texCache[key].tex;
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(cv); if (srgb !== false) t.encoding = THREE.sRGBEncoding;
    t.userData = { canvas: cv, ctx: cv.getContext('2d') };
    texCache[key] = { tex: t };
    return t;
  }

  // Patch the venue kit so the core's standard track uses the realistic dirt (+normal map, wet roughness).
  try {
    var VK = TP.venueKit;
    if (VK) {
      VK.dirtTextureBasic = VK.dirtTexture;
      VK.dirtTexture = function (o) { try { return dirtTexture(o); } catch (e) { warn(e); return VK.dirtTextureBasic(o); } };
      VK.grassTextureBasic = VK.grassTexture;
      VK.grassTexture = function (o) { try { return grassTexture(o); } catch (e) { warn(e); return VK.grassTextureBasic(o); } };
      var origPlane = VK.plane;
      VK.plane = function (ctx, w, d, tex, o) {
        var m = origPlane.apply(this, arguments);
        try {
          if (m && m.material && tex && tex.userData && tex.userData.normalMap) {
            m.material.normalMap = tex.userData.normalMap;
            m.material.normalScale.set(tex.userData.normalScale || 1, tex.userData.normalScale || 1);
            m.material.roughness = tex.userData.rough != null ? tex.userData.rough : 0.95;
            m.material.envMapIntensity = 0.6;
            m.material.needsUpdate = true;
          }
        } catch (e) { warn(e); }
        return m;
      };
    }
  } catch (e) { warn(e); }

  /* ---------------------------------------------------------------------------
   * 3. ENVIRONMENT MAP (IBL) per venue — makes paint, chrome, glass and wet dirt read real
   * ------------------------------------------------------------------------- */
  var envCache = {};
  function buildEnv(def) {
    var id = def.id;
    if (envCache[id]) return envCache[id];
    var sky = def.sky || {}, E = def.env || {};
    var sc = new THREE.Scene();
    var col = function (h, k) { var c = new THREE.Color(h); c.convertSRGBToLinear(); return c.multiplyScalar(k || 1); };
    var mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: col(E.top != null ? E.top : (sky.top != null ? sky.top : 0x3d8fd8), E.k || 1) },
        hor: { value: col(E.horizon != null ? E.horizon : (sky.horizon != null ? sky.horizon : 0xd6ebf2), E.k || 1) },
        bot: { value: col(E.ground != null ? E.ground : 0x5a4630, E.kg || 0.6) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 bot; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.6)) : mix(hor, bot, pow(min(1.0, -h * 4.0), 0.6)); gl_FragColor = vec4(c, 1.0); }'
    });
    var geos = [], mats = [mat];
    var sph = new THREE.SphereGeometry(50, 32, 16); geos.push(sph);
    sc.add(new THREE.Mesh(sph, mat));
    var lights = E.lights || [];
    if (!E.lights && sky.sunDir) lights = [{ dir: sky.sunDir, color: sky.sun != null ? sky.sun : 0xfff0d8, k: 18, r: 5 }];
    lights.forEach(function (l) {
      var g = new THREE.SphereGeometry(l.r || 4, 12, 8); geos.push(g);
      var m = new THREE.MeshBasicMaterial({ color: col(l.color, l.k || 10), side: THREE.DoubleSide }); mats.push(m);
      var mesh = new THREE.Mesh(g, m); var d = new THREE.Vector3(l.dir[0], l.dir[1], l.dir[2]).normalize().multiplyScalar(40);
      mesh.position.copy(d); sc.add(mesh);
    });
    var rt = null;
    try {
      var pm = new THREE.PMREMGenerator(TP.renderer);
      rt = pm.fromScene(sc, 0.03);
      pm.dispose();
    } catch (e) { warn(e); }
    geos.forEach(function (g) { g.dispose(); }); mats.forEach(function (m) { m.dispose(); });
    envCache[id] = rt;
    return rt;
  }
  VX.applyEnv = function (ctx) {
    if (!TP.renderer || !TP.scene) return;
    var rt = buildEnv(ctx.def);
    TP.scene.environment = rt ? rt.texture : null;
  };

  /* ---------------------------------------------------------------------------
   * 4. GLOW POINTS — lamp halos, string lights, stars (one additive draw call per set)
   * ------------------------------------------------------------------------- */
  var glowMats = [];
  var GLOW_VS = [
    'attribute float size; attribute vec3 gcol; attribute float phase;',
    'uniform float scale; uniform float uTime; uniform float uTw;',
    'varying vec3 vC; varying float vA;',
    'void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = clamp(size * scale / max(1.0, -mv.z), 1.0, 256.0);',
    '  vC = gcol; vA = 1.0 - uTw * (0.5 + 0.5 * sin(uTime * 2.6 + phase));',
    '  gl_Position = projectionMatrix * mv; }'].join('\n');
  var GLOW_FS = [
    'varying vec3 vC; varying float vA;',
    'void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.4) + 0.6 * pow(max(0.0, 1.0 - d * 3.0), 2.0);',
    '  gl_FragColor = vec4(vC * a * vA, 1.0); }'].join('\n');
  function GlowSet() { this.p = []; this.c = []; this.s = []; this.ph = []; }
  GlowSet.prototype.add = function (x, y, z, color, size, phase) {
    var c = new THREE.Color(color); c.convertSRGBToLinear();
    this.p.push(x, y, z); this.c.push(c.r, c.g, c.b); this.s.push(size); this.ph.push(phase || 0);
    return this;
  };
  GlowSet.prototype.build = function (parent, o) {
    o = o || {};
    if (!this.s.length) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('gcol', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('phase', new THREE.Float32BufferAttribute(this.ph, 1));
    g.computeBoundingSphere();
    var m = new THREE.ShaderMaterial({ uniforms: { scale: { value: 400 }, uTime: { value: 0 }, uTw: { value: o.twinkle || 0 } },
      vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    var pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 6;
    glowMats.push(m);
    parent.add(pts);
    return pts;
  };

  /* ---------------------------------------------------------------------------
   * 5. GEOMETRY HELPERS (all merged into a couple of vertex-color meshes per venue)
   * ------------------------------------------------------------------------- */
  function stripeGeo(geo, c1, c2, n) {
    var p = geo.attributes.position, col = geo.attributes.color, a = LPX().color(c1), b = LPX().color(c2);
    for (var t = 0; t < p.count; t += 3) {
      var cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3, cz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
      var ang = Math.atan2(cz - geo._cz, cx - geo._cx) + Math.PI, k = Math.floor(ang / (Math.PI * 2) * n) % 2;
      var cc = k ? a : b;
      for (var j = 0; j < 3; j++) col.setXYZ(t + j, cc.r, cc.g, cc.b);
    }
    return geo;
  }
  function stripedCone(r, h, seg, c1, c2, o) { var g = LPX().cone(r, h, seg, c1, o); g._cx = o.x || 0; g._cz = o.z || 0; return stripeGeo(g, c1, c2, seg); }
  function stripedCyl(r, h, seg, c1, c2, o) { var g = LPX().cyl(r, r, h, seg, c1, o); g._cx = o.x || 0; g._cz = o.z || 0; return stripeGeo(g, c1, c2, seg); }

  /** Carnival tent: striped skirt + roof + pennant. */
  function tent(b, x, z, r, c1, c2) {
    b.add(stripedCyl(r, 2.2, 12, c1, c2, { x: x, y: 1.1, z: z }));
    b.add(stripedCone(r * 1.12, 2.4, 12, c1, c2, { x: x, y: 3.4, z: z }));
    b.cyl(0.04, 0.04, 1.2, 4, 0x8e979f, { x: x, y: 5.1, z: z }).wedge(0.6, 0.35, 0.02, c1, { x: x + 0.3, y: 5.5, z: z, rz: -Math.PI / 2, slope: 1 });
  }
  /** Food stand / concession trailer with awning and lit sign (emissive in be). */
  function foodStand(b, be, glow, x, z, col, lit, ry) {
    var s = ry ? -1 : 1;
    b.box(5, 2.6, 2.6, 0xf3efe6, { x: x, y: 1.6, z: z }).box(5.1, 0.25, 2.7, col, { x: x, y: 3.0, z: z })
      .box(4.2, 1.0, 0.06, 0x2a2420, { x: x, y: 1.9, z: z + s * 1.31 })
      .wedge(5.2, 0.15, 1.4, col, { x: x, y: 2.55, z: z + s * 1.9, rx: s * 0.3 })
      .cyl(0.3, 0.3, 0.2, 8, 0x333333, { x: x - 1.6, y: 0.3, z: z - 1.0, axis: 'z' }).cyl(0.3, 0.3, 0.2, 8, 0x333333, { x: x - 1.6, y: 0.3, z: z + 1.0, axis: 'z' });
    if (be) { be.box(3.8, 0.55, 0.05, lit ? 0xffe7a0 : 0xfff4dc, { x: x, y: 3.5, z: z + s * 1.2 }); }
    if (lit && glow) { for (var i = 0; i < 5; i++) glow.add(x - 2 + i, 2.62, z + s * 2.5, 0xffd890, 0.9, i); glow.add(x, 2.0, z + s * 1.4, 0xffcf80, 3.5); }
  }
  /** Light tower (lamp grid in be, halos in glow when lit). */
  function lightTower(b, be, glow, x, z, h, face, lit) {
    b.cyl(0.22, 0.3, h, 8, 0x8e979f, { x: x, y: h / 2, z: z });
    b.box(4.2, 2.0, 0.3, 0x4b5157, { x: x, y: h, z: z });
    for (var r = 0; r < 2; r++) for (var c = 0; c < 5; c++) {
      var lx = x - 1.6 + c * 0.8, ly = h - 0.45 + r * 0.9, lz = z + face * 0.18;
      if (be) be.box(0.62, 0.62, 0.06, lit ? 0xfffbe8 : 0xd8dce0, { x: lx, y: ly, z: lz });
      if (lit && glow) glow.add(lx, ly, lz + face * 0.3, 0xfff2d6, 5.5, c + r);
    }
    if (lit && glow) glow.add(x, h, z + face * 1, 0xfff0d0, 22);
  }
  function fence(b, x0, x1, z, col) {
    b.box(x1 - x0, 0.08, 0.06, col, { x: (x0 + x1) / 2, y: 0.6, z: z }).box(x1 - x0, 0.08, 0.06, col, { x: (x0 + x1) / 2, y: 1.1, z: z });
    for (var x = x0; x <= x1; x += 3) b.box(0.1, 1.2, 0.1, 0xd9d2c4, { x: x, y: 0.6, z: z });
  }
  /** Concrete "jersey" wall + dasher. */
  function wall(b, x0, x1, z, h, col) { b.box(x1 - x0, h, 0.4, col, { x: (x0 + x1) / 2, y: h / 2, z: z }).box(x1 - x0, 0.1, 0.5, 0xe9e4da, { x: (x0 + x1) / 2, y: h, z: z }); }
  /** Grandstand: aluminum bleachers + structure + back wall + optional roof; returns seats. */
  function grandstand(ctx, b, x0, x1, z0, rows, side, o) {
    o = o || {};
    var seats = ctx.kit.bleachers(b, x0, x1, z0, rows, side, { roof: o.roof, seat: o.seat || 0xc9ccd1, riser: o.riser || 0x7e878f });
    var top = 0.5 + rows * 0.45, zb = z0 + side * (rows - 0.5) * 0.8, cx = (x0 + x1) / 2;
    b.box(x1 - x0, top + 1.1, 0.25, o.back || 0x5b6168, { x: cx, y: (top + 1.1) / 2, z: zb + side * 0.15 });
    b.box(x1 - x0, 0.06, 0.06, 0xdfe4e8, { x: cx, y: top + 1.1, z: zb });
    b.box(x1 - x0, 0.5, 0.2, o.front || 0x3c4248, { x: cx, y: 0.25, z: z0 - side * 0.45 });
    // stairs every ~12 m
    for (var sx = x0 + 6; sx < x1 - 3; sx += 12) for (var r = 0; r < rows; r++) b.box(1.0, 0.06, 0.8, 0xa8adb2, { x: sx, y: 0.28 + r * 0.45, z: z0 + side * (r * 0.8 - 0.1) });
    // drop seats on the stairs (nobody sits there)
    var out = [];
    for (var i = 0; i < seats.length; i++) { var s = seats[i], ok = true; for (var q = x0 + 6; q < x1 - 3; q += 12) if (Math.abs(s.x - q) < 0.7) ok = false; if (ok) out.push(s); }
    return out;
  }
  function standingLine(list, x0, x1, z, y, ry, spacing, rng, depth) {
    for (var x = x0; x < x1; x += spacing * (0.7 + rng() * 0.6)) list.push({ x: x, y: y || 0, z: z + (rng() - 0.5) * (depth || 0.6), ry: ry + (rng() - 0.5) * 0.5 });
  }
  /** Sponsor banners from one canvas atlas → one draw call. items [{text,bg,fg,x,y,z,w,h,ry}] (max 8 distinct texts). */
  function sponsorBanners(ctx, items, o) {
    o = o || {};
    var texts = []; items.forEach(function (it) { var k = it.text + '|' + it.bg + '|' + it.fg; if (texts.indexOf(k) < 0) texts.push(k); });
    var rows = 8;
    var tex = canvasTex('banners|' + texts.join('#'), 1024, 1024, function (c, w, h) {
      texts.forEach(function (k, r) {
        var p = k.split('|'), y0 = r * 128;
        c.fillStyle = p[1]; c.fillRect(0, y0, w, 128);
        c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 6; c.strokeRect(6, y0 + 6, w - 12, 116);
        c.fillStyle = p[2]; c.font = '900 76px "Saira Condensed", "Arial Narrow", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        var fs = 76; while (c.measureText(p[0]).width > w - 60 && fs > 30) { fs -= 4; c.font = '900 ' + fs + 'px "Saira Condensed", "Arial Narrow", Impact, sans-serif'; }
        c.fillText(p[0], w / 2, y0 + 68);
      });
    });
    var geos = [];
    items.forEach(function (it) {
      var r = texts.indexOf(it.text + '|' + it.bg + '|' + it.fg);
      var g = new THREE.PlaneGeometry(it.w, it.h), uv = g.attributes.uv;
      for (var i = 0; i < uv.count; i++) uv.setY(i, 1 - (r + 1 - uv.getY(i)) / rows);
      if (it.ry) g.rotateY(it.ry);
      g.translate(it.x, it.y, it.z);
      geos.push(g);
    });
    var geo = LPX().merge(geos);
    var mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (o.lit) { mat.emissive = new THREE.Color(0xffffff); mat.emissiveMap = tex; mat.emissiveIntensity = o.lit; }
    mat._shared = true;
    var m = new THREE.Mesh(geo, mat); ctx.group.add(m);
    return m;
  }
  /** Instanced realistic-ish trees (broadleaf + pine) with per-instance tint. pts [{x,z,s,pine}] */
  function forest(ctx, pts) {
    var LP = LPX(), rng = mkRng(4242);
    var broad = LP.merge([LP.cyl(0.16, 0.26, 2.2, 7, 0x5a4026, { y: 1.1 }), LP.sphere(1.5, 0x4e7d32, { y: 3.0, detail: 1 }), LP.sphere(1.15, 0x5c8f3a, { y: 3.9, x: 0.5, detail: 1 }), LP.sphere(1.1, 0x477530, { y: 3.4, x: -0.7, z: 0.4, detail: 1 }), LP.sphere(0.9, 0x6a9a42, { y: 4.4, x: -0.2, z: -0.3, detail: 1 })]);
    var pine = LP.merge([LP.cyl(0.12, 0.2, 1.4, 6, 0x4f3a24, { y: 0.7 }), LP.cone(1.5, 2.4, 9, 0x2f5a2c, { y: 2.2 }), LP.cone(1.2, 2.1, 9, 0x376832, { y: 3.4 }), LP.cone(0.85, 1.8, 9, 0x3f7538, { y: 4.5 }), LP.cone(0.45, 1.2, 9, 0x467d3c, { y: 5.4 })]);
    var mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 }); mat._shared = true;
    [false, true].forEach(function (isPine) {
      var list = pts.filter(function (p) { return !!p.pine === isPine; });
      if (!list.length) return;
      var m = new THREE.InstancedMesh(isPine ? pine : broad, mat, list.length), d = new THREE.Object3D(), c = new THREE.Color();
      list.forEach(function (p, i) {
        d.position.set(p.x, 0, p.z); d.rotation.set(0, rng() * 6.28, 0); var s = p.s || 1; d.scale.set(s * (0.85 + rng() * 0.3), s, s * (0.85 + rng() * 0.3)); d.updateMatrix();
        m.setMatrixAt(i, d.matrix); var t = 0.75 + rng() * 0.4; c.setRGB(t * (p.tint || 1), t, t * 0.9); m.setColorAt(i, c);
      });
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      ctx.group.add(m);
    });
    if (!pts.some(function (p) { return p.pine; })) pine.dispose();
    if (!pts.some(function (p) { return !p.pine; })) broad.dispose();
  }
  /** Distant hills ring (merged). */
  function hills(b, color, rng, rad, n, hmax) {
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2 + rng() * 0.2, r = rad * (0.85 + rng() * 0.35);
      var x = 50 + Math.cos(a) * r, z = Math.sin(a) * r, w = 60 + rng() * 90;
      b.add(LPX().sphere(1, color, { x: x, y: -w * 0.08, z: z, sx: w, sy: (0.12 + rng() * 0.18) * w * (hmax || 1), sz: w * 0.7, detail: 1 }));
    }
  }
  /** Cloud billboards (one mesh). */
  function clouds(ctx, o) {
    o = o || {};
    var tex = canvasTex('cloud', 256, 128, function (c, w, h) {
      var rng = mkRng(9);
      for (var i = 0; i < 26; i++) {
        var x = w * (0.18 + rng() * 0.64), y = h * (0.45 + (rng() - 0.5) * 0.35), r = h * (0.16 + rng() * 0.22);
        var g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.3); c.fill();
      }
    });
    var rng = mkRng(o.seed || 3), geos = [], n = o.n || 14;
    for (var i = 0; i < n; i++) {
      var a = -Math.PI * (0.05 + rng() * 0.9) + (rng() < 0.3 ? Math.PI : 0), R = 420 + rng() * 120, w = 90 + rng() * 120;
      var g = new THREE.PlaneGeometry(w, w * 0.4);
      var x = 50 + Math.cos(a) * R, z = Math.sin(a) * R;
      g.lookAt(new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)));
      g.translate(x, 60 + rng() * 90, z);
      geos.push(g);
    }
    var geo = LPX().merge(geos);
    var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(o.color || 0xffffff), fog: false, opacity: o.opacity || 0.9 });
    mat._shared = true;
    var m = new THREE.Mesh(geo, mat); m.renderOrder = -5; ctx.group.add(m);
    return m;
  }
  function stars(ctx, n) {
    var gs = new GlowSet(), rng = mkRng(55);
    for (var i = 0; i < n; i++) {
      var a = rng() * Math.PI * 2, el = 0.12 + rng() * 1.3, R = 600;
      gs.add(50 + Math.cos(a) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(a) * Math.cos(el) * R, rng() < 0.15 ? 0xffe8c8 : 0xdfe8ff, 1.2 + rng() * 2.4, rng() * 30);
    }
    gs.add(-120, 260, -420, 0xfff6e0, 70);   // moon
    return gs.build(ctx.group, { twinkle: 0.35 });
  }
  /** Ferris wheel: rotating rim + spokes, hanging gondolas (instanced), optional lit bulbs. */
  function ferris(ctx, x, z, R, o) {
    o = o || {};
    var LP = LPX(), base = LP.builder(), y0 = R + 2.5;
    [-1, 1].forEach(function (s) { base.box(0.7, y0 + 1, 0.7, 0xdfe4e8, { x: x - s * R * 0.3, y: y0 / 2, z: z + s * 1.4, rz: s * 0.28 }).box(0.7, y0 + 1, 0.7, 0xdfe4e8, { x: x + s * R * 0.3, y: y0 / 2, z: z + s * 1.4, rz: -s * 0.28 }); });
    base.box(R * 0.9, 1.2, 4.2, 0x6a3f9a, { x: x, y: 0.6, z: z });
    ctx.group.add(base.mesh({}));
    var wheelB = LP.builder(), n = 16;
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      for (var i = 0; i < 48; i++) { var a0 = i / 48 * Math.PI * 2, a1 = (i + 1) / 48 * Math.PI * 2, mx = (Math.cos(a0) + Math.cos(a1)) / 2 * R, my = (Math.sin(a0) + Math.sin(a1)) / 2 * R; wheelB.box(0.3, R * 0.135, 0.3, 0xf3efe6, { x: mx, y: my, z: s2 * 1.2, rz: (a0 + a1) / 2 }); }
      for (var k = 0; k < n; k++) { var a = k / n * Math.PI * 2; wheelB.box(0.14, R, 0.14, 0xdfe4e8, { x: Math.cos(a) * R / 2, y: Math.sin(a) * R / 2, z: s2 * 1.2, rz: a + Math.PI / 2 }); }
    }
    wheelB.cyl(0.8, 0.8, 3, 10, 0x8e979f, { axis: 'z' });
    var wheel = wheelB.mesh({}); wheel.position.set(x, y0, z); ctx.group.add(wheel);
    var bulbs = null;
    if (o.lit) {
      var gs = new GlowSet(), cols = [0xff4a3a, 0xffd23f, 0x4ab0ff, 0x7aff7a, 0xff7ae0];
      for (var bI = 0; bI < 64; bI++) { var ab = bI / 64 * Math.PI * 2; gs.add(Math.cos(ab) * R, Math.sin(ab) * R, 1.5, cols[bI % cols.length], 1.6, bI * 0.6); }
      for (var sp = 0; sp < n; sp++) for (var q = 1; q < 4; q++) { var as = sp / n * Math.PI * 2; gs.add(Math.cos(as) * R * q / 4, Math.sin(as) * R * q / 4, 1.5, cols[(sp + q) % cols.length], 1.1, sp + q); }
      gs.add(0, 0, 1.6, 0xffffff, 4);
      bulbs = gs.build(wheel, { twinkle: 0.6 });
    }
    var carGeo = LP.merge([LP.box(1.5, 1.2, 1.5, o.car || 0xd23a2a, { y: -1.0 }), LP.box(1.7, 0.18, 1.7, 0xf3efe6, { y: -0.32 }), LP.box(0.1, 0.6, 0.1, 0x8e979f, { y: -0.1 })]);
    var palette = [0xd23a2a, 0xffc61a, 0x2565ae, 0x2e8b3d, 0xff7a1a, 0x7a3fa0];
    var cars = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6 }), n);
    var cc = new THREE.Color();
    for (var ci = 0; ci < n; ci++) { cc.setHex(palette[ci % palette.length]).convertSRGBToLinear(); cc.r = cc.r * 2 + 0.2; cars.setColorAt(ci, cc.setRGB(1, 1, 1).set(palette[ci % palette.length]).convertSRGBToLinear()); }
    ctx.group.add(cars);
    var d = new THREE.Object3D(), ang = 0, speed = o.speed || 0.06;
    var upd = function (dt) {
      ang += dt * speed; wheel.rotation.z = ang;
      for (var c = 0; c < n; c++) { var a = ang + c / n * Math.PI * 2; d.position.set(x + Math.cos(a) * R, y0 + Math.sin(a) * R, z); d.rotation.set(0, 0, Math.sin(ang * 3 + c) * 0.04); d.updateMatrix(); cars.setMatrixAt(c, d.matrix); }
      cars.instanceMatrix.needsUpdate = true;
    };
    upd(0);
    ctx.addUpdate(upd);
    return { wheel: wheel, cars: cars, bulbs: bulbs };
  }
  /** Catenary string of bulbs between two points (glow + thin wire in b). */
  function stringLights(b, gs, x0, y0, z0, x1, y1, z1, n, colors, sag) {
    sag = sag == null ? 0.9 : sag;
    for (var i = 0; i <= n; i++) {
      var t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * sag, z = z0 + (z1 - z0) * t;
      gs.add(x, y, z, colors[i % colors.length], 0.75, i * 0.7);
      if (i < n) { var t2 = (i + 0.5) / n; b.box(Math.hypot(x1 - x0, z1 - z0) / n, 0.03, 0.03, 0x222222, { x: x0 + (x1 - x0) * t2, y: y0 + (y1 - y0) * t2 - Math.sin(t2 * Math.PI) * sag, z: z0 + (z1 - z0) * t2, ry: -Math.atan2(z1 - z0, x1 - x0) }); }
    }
  }
  /** A parked pickup / hauler silhouette (static scenery). */
  function parkedTruck(b, x, z, col, ry, trailer) {
    var c = Math.cos(ry || 0), s = Math.sin(ry || 0);
    var P = function (lx, lz) { return { x: x + lx * c + lz * s, z: z - lx * s + lz * c }; };
    var q = P(0, 0); b.box(5.4, 0.9, 2.0, col, { x: q.x, y: 0.95, z: q.z, ry: ry });
    q = P(0.4, 0); b.box(2.0, 0.9, 1.9, col, { x: q.x, y: 1.85, z: q.z, ry: ry }); b.box(1.6, 0.6, 1.95, 0x1c262e, { x: q.x, y: 1.95, z: q.z, ry: ry });
    [-1.7, 1.7].forEach(function (lx) { [-0.95, 0.95].forEach(function (lz) { var w = P(lx, lz); b.cyl(0.42, 0.42, 0.3, 10, 0x1d1b19, { x: w.x, y: 0.42, z: w.z, axis: 'z', ry: ry }); }); });
    if (trailer) { q = P(-6.2, 0); b.box(6, 0.25, 2.3, 0x4b5157, { x: q.x, y: 0.8, z: q.z, ry: ry }); var w2 = P(-6.6, 1.15), w3 = P(-6.6, -1.15); b.cyl(0.38, 0.38, 0.25, 10, 0x1d1b19, { x: w2.x, y: 0.38, z: w2.z, axis: 'z', ry: ry }).cyl(0.38, 0.38, 0.25, 10, 0x1d1b19, { x: w3.x, y: 0.38, z: w3.z, axis: 'z', ry: ry }); }
  }
  function barn(b, x, z, s, col) {
    s = s || 1; col = col || 0xa52a22;
    b.box(10 * s, 6 * s, 8 * s, col, { x: x, y: 3 * s, z: z }).taper(10.6 * s, 3.4 * s, 8.8 * s, 1, 0.06, 0x4a2a20, { x: x, y: 7.7 * s, z: z })
      .box(3 * s, 4 * s, 0.1, 0xf3efe6, { x: x, y: 2 * s, z: z + 4 * s + 0.05 }).box(2.6 * s, 3.6 * s, 0.12, col, { x: x, y: 2 * s, z: z + 4 * s + 0.06 })
      .box(0.2, 5 * s, 0.14, 0xf3efe6, { x: x, y: 2.2 * s, z: z + 4 * s + 0.07, rz: 0.62 }).box(0.2, 5 * s, 0.14, 0xf3efe6, { x: x, y: 2.2 * s, z: z + 4 * s + 0.07, rz: -0.62 });
  }
  function silo(b, x, z, h, r) {
    b.cyl(r, r, h, 14, 0xc9ccd1, { x: x, y: h / 2, z: z }).add(LPX().sphere(r, 0xdfe4e8, { x: x, y: h, z: z, sy: 0.6, detail: 1 }));
    for (var i = 1; i < h / 1.4; i++) b.cyl(r * 1.02, r * 1.02, 0.08, 14, 0x9aa0a6, { x: x, y: i * 1.4, z: z });
  }
  function crowdColorsDay() { return null; }

  /* ---------------------------------------------------------------------------
   * 6. CROWD — instanced, animated in the vertex shader (stand, wave arms, jump, stadium wave)
   * ------------------------------------------------------------------------- */
  var crowdGeoCache = null;
  function personGeometry() {
    if (crowdGeoCache) return crowdGeoCache;
    var LP = LPX(), parts = [];
    // [geo, part(0 shirt,1 skin,2 pants,3 hat), arm(-1,0,1)]
    parts.push([LP.box(0.17, 0.8, 0.2, 0xffffff, { x: -0.1, y: 0.4 }), 2, 0]);
    parts.push([LP.box(0.17, 0.8, 0.2, 0xffffff, { x: 0.1, y: 0.4 }), 2, 0]);
    parts.push([LP.taper(0.44, 0.6, 0.26, 1.0, 0.95, 0xffffff, { y: 1.1 }), 0, 0]);
    parts.push([LP.box(0.12, 0.14, 0.12, 0xe0e0e0, { y: 1.45 }), 1, 0]);
    parts.push([LP.box(0.23, 0.26, 0.24, 0xffffff, { y: 1.62 }), 1, 0]);
    parts.push([LP.box(0.11, 0.56, 0.12, 0xffffff, { x: -0.29, y: 1.08 }), 0, -1]);
    parts.push([LP.box(0.11, 0.56, 0.12, 0xffffff, { x: 0.29, y: 1.08 }), 0, 1]);
    parts.push([LP.box(0.1, 0.1, 0.1, 0xffffff, { x: -0.29, y: 0.76 }), 1, -1]);
    parts.push([LP.box(0.1, 0.1, 0.1, 0xffffff, { x: 0.29, y: 0.76 }), 1, 1]);
    parts.push([LP.box(0.27, 0.09, 0.28, 0xffffff, { y: 1.79 }), 3, 0]);
    parts.push([LP.box(0.27, 0.03, 0.14, 0xdddddd, { y: 1.75, z: -0.2 }), 3, 0]);
    var geo = LP.merge(parts.map(function (p) { return p[0]; }));
    // Recreate part/arm arrays (LP.merge keeps order)
    var n = geo.attributes.position.count, aPart = new Float32Array(n), aArm = new Float32Array(n), off = 0;
    var counts = [36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36];
    for (var i = 0; i < parts.length; i++) { for (var k = 0; k < counts[i] && off < n; k++, off++) { aPart[off] = parts[i][1]; aArm[off] = parts[i][2]; } }
    geo.setAttribute('aPart', new THREE.BufferAttribute(aPart, 1));
    geo.setAttribute('aArm', new THREE.BufferAttribute(aArm, 1));
    crowdGeoCache = geo;
    return geo;
  }
  var CROWD_U = { uTime: { value: 0 }, uCheer: { value: 0 }, uWave: { value: -999 }, uWaveAmt: { value: 0 } };
  function crowdMaterial() {
    var m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = CROWD_U.uTime; sh.uniforms.uCheer = CROWD_U.uCheer; sh.uniforms.uWave = CROWD_U.uWave; sh.uniforms.uWaveAmt = CROWD_U.uWaveAmt;
      sh.vertexShader = 'attribute float aPart; attribute float aArm; attribute vec3 aShirt; attribute vec3 aSkin; attribute vec3 aPants; attribute vec3 aHat; attribute vec4 aAnim;\nuniform float uTime; uniform float uCheer; uniform float uWave; uniform float uWaveAmt;\n' +
        sh.vertexShader
          .replace('#include <color_vertex>', 'vColor = aPart < 0.5 ? aShirt : (aPart < 1.5 ? aSkin : (aPart < 2.5 ? aPants : aHat)); vColor *= color;')
          .replace('#include <begin_vertex>', [
            'vec3 transformed = vec3(position);',
            'float ix = instanceMatrix[3].x;',
            'float ex = clamp(uCheer * aAnim.y, 0.0, 1.4);',
            'float wv = uWaveAmt * exp(-pow((ix - uWave) / 5.0, 2.0));',
            'float arm = clamp(ex * 1.3 + wv * 1.6 + step(0.92, aAnim.w) * 0.6, 0.0, 1.0);',
            'if (aArm != 0.0) {',
            '  float wav = sin(uTime * (7.0 + aAnim.y * 5.0) + aAnim.x * 7.0) * (0.15 + 0.45 * ex);',
            '  float ang = aArm * (arm * 2.6 + wav * arm + 0.08);',
            '  vec2 pv = vec2(aArm * 0.24, 1.36); vec2 d = transformed.xy - pv; float c = cos(ang), s = sin(ang);',
            '  transformed.xy = pv + vec2(c * d.x - s * d.y, s * d.x + c * d.y);',
            '}',
            'float jumpRate = 6.0 + aAnim.y * 4.0;',
            'transformed.y += max(0.0, sin(uTime * jumpRate + aAnim.x * 6.283)) * (0.02 + 0.34 * ex * step(0.35, aAnim.y)) + wv * 0.45;',
            'transformed.y += sin(uTime * 1.3 + aAnim.x * 20.0) * 0.012;',
            'transformed.x += sin(uTime * 0.9 + aAnim.x * 13.0) * 0.03 * (1.0 - ex);',
            'if (aPart > 2.5 && aAnim.z < 0.5) transformed = vec3(0.0, 1.6, 0.0);'
          ].join('\n'));
    };
    m.customProgramCacheKey = function () { return 'tp-venues-crowd'; };
    m._shared = true;
    return m;
  }
  var crowdMat = null;
  /** seats [{x,y,z,ry}] → one InstancedMesh. o = {max, maxLow, density, seed, dress:'fair'|'night'|'farm'} */
  function makeCrowd(ctx, seats, o) {
    o = o || {};
    var rng = mkRng(o.seed || 21), dens = o.density != null ? o.density : 1;
    var max = Math.round((low() ? (o.maxLow || 320) : (o.max || 1100)));
    var list = [];
    for (var i = 0; i < seats.length; i++) if (rng() < dens) list.push(seats[i]);
    if (list.length > max) { var step = list.length / max, sel = []; for (var j = 0; j < max; j++) sel.push(list[Math.floor(j * step)]); list = sel; }
    if (!list.length) return null;
    var geo = personGeometry().clone();
    var n = list.length, P = TP.palette;
    var shirt = new Float32Array(n * 3), skin = new Float32Array(n * 3), pants = new Float32Array(n * 3), hat = new Float32Array(n * 3), anim = new Float32Array(n * 4);
    var shirts = (P.shirts || [0xd23a2a]).concat([0x3a6ea5, 0xe8e2d0, 0x7a2a2a, 0x2a5a3a, 0xf7d046]);
    var skins = P.skin || [0xe0ac69];
    var pantsC = [0x2b3a55, 0x34465f, 0x1f2a3a, 0x3d3a34, 0x5a4a38, 0x23272c, 0x6a6458];
    var hats = [0xd23a2a, 0xf3efe6, 0x2565ae, 0x1b1b1b, 0xd8b25a, 0x2e8b3d, 0x8a5a2b, 0xff7a1a];
    var c = new THREE.Color();
    function put(arr, k, hex, v) { c.setHex(hex).convertSRGBToLinear(); var m = v || 1; arr[k * 3] = c.r * m; arr[k * 3 + 1] = c.g * m; arr[k * 3 + 2] = c.b * m; }
    var mesh = new THREE.InstancedMesh(geo, crowdMat || (crowdMat = crowdMaterial()), n);
    var d = new THREE.Object3D();
    for (var k = 0; k < n; k++) {
      var s = list[k];
      d.position.set(s.x, s.y || 0, s.z); d.rotation.set(0, (s.ry || 0) + (rng() - 0.5) * 0.4, 0);
      var sc = 0.9 + rng() * 0.18; d.scale.set(sc * (0.9 + rng() * 0.25), sc, sc); d.updateMatrix();
      mesh.setMatrixAt(k, d.matrix);
      put(shirt, k, shirts[(rng() * shirts.length) | 0], 0.85 + rng() * 0.25);
      put(skin, k, skins[(rng() * skins.length) | 0]);
      put(pants, k, pantsC[(rng() * pantsC.length) | 0]);
      var hasHat = rng() < (o.hats != null ? o.hats : 0.55);
      put(hat, k, hasHat ? hats[(rng() * hats.length) | 0] : [0x2a1a10, 0x4a3020, 0x8a6a3a, 0x111111][(rng() * 4) | 0]);
      anim[k * 4] = rng(); anim[k * 4 + 1] = 0.25 + rng() * 0.85; anim[k * 4 + 2] = 1; anim[k * 4 + 3] = rng();
    }
    geo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirt, 3));
    geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
    geo.setAttribute('aPants', new THREE.InstancedBufferAttribute(pants, 3));
    geo.setAttribute('aHat', new THREE.InstancedBufferAttribute(hat, 3));
    geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(anim, 4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
    ctx.group.add(mesh);
    ctx.crowdCount = (ctx.crowdCount || 0) + n;
    return mesh;
  }
  // crowd state (excitement, stadium wave)
  var HYPE = { level: 0, target: 0, wave: -1, waveDir: 1 };
  VX.wave = function () { var vs = TP.venueState; if (!vs) return; HYPE.wave = 0; HYPE.waveLen = vs.track.length + 80; };

  /* ---------------------------------------------------------------------------
   * 7. RUTS — persistent instanced tread marks + sled pan swipes
   * ------------------------------------------------------------------------- */
  function rutTexture(kind) {
    return canvasTex('rut|' + kind, 64, 128, function (c, w, h) {
      c.clearRect(0, 0, w, h);
      if (kind === 'tread') {
        var g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(50,30,14,0)'); g.addColorStop(0.15, 'rgba(50,30,14,0.75)'); g.addColorStop(0.85, 'rgba(50,30,14,0.75)'); g.addColorStop(1, 'rgba(50,30,14,0)');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
        c.fillStyle = 'rgba(28,16,6,0.85)';
        for (var y = 0; y < h; y += 16) { c.save(); c.translate(w / 2, y + 8); c.beginPath(); c.moveTo(-w * 0.42, -6); c.lineTo(0, 3); c.lineTo(w * 0.42, -6); c.lineTo(w * 0.42, 0); c.lineTo(0, 9); c.lineTo(-w * 0.42, 0); c.closePath(); c.fill(); c.restore(); }
      } else {
        var g2 = c.createLinearGradient(0, 0, w, 0); g2.addColorStop(0, 'rgba(120,84,50,0)'); g2.addColorStop(0.2, 'rgba(118,82,48,0.55)'); g2.addColorStop(0.8, 'rgba(118,82,48,0.55)'); g2.addColorStop(1, 'rgba(120,84,50,0)');
        c.fillStyle = g2; c.fillRect(0, 0, w, h);
        c.strokeStyle = 'rgba(70,45,22,0.35)'; c.lineWidth = 1;
        for (var x = 6; x < w; x += 5) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
      }
    });
  }
  function Ruts(ctx, kind, cap, wet) {
    var geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2); geo.rotateY(Math.PI / 2);
    var mat = new THREE.MeshStandardMaterial({ map: rutTexture(kind), transparent: true, depthWrite: false, roughness: wet > 0.4 ? 0.32 : 0.95, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: kind === 'tread' ? -6 : -4 });
    mat._shared = true;
    var m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    m.count = 0; m.frustumCulled = false; m.receiveShadow = true; m.renderOrder = 1;
    ctx.group.add(m);
    this.m = m; this.cap = cap; this.head = 0; this.filled = 0; this.dmin = 1e9; this.dmax = -1; this.full = false;
    this.d = new THREE.Object3D(); this.c = new THREE.Color();
  }
  Ruts.prototype.stamp = function (x, z, ry, len, wid, shade) {
    var i = this.head; this.head = (this.head + 1) % this.cap; if (this.filled < this.cap) this.filled++;
    var d = this.d; d.position.set(x, 0.012 + (i % 7) * 0.0004, z); d.rotation.set(0, ry, 0); d.scale.set(len, 1, wid); d.updateMatrix();
    this.m.setMatrixAt(i, d.matrix); this.c.setRGB(shade, shade, shade); this.m.setColorAt(i, this.c);
    if (i < this.dmin) this.dmin = i; if (i > this.dmax) this.dmax = i;
    this.m.count = this.filled;
  };
  Ruts.prototype.flush = function () {
    if (this.dmax < 0 && !this.full) return;
    var im = this.m.instanceMatrix, ic = this.m.instanceColor;
    if (this.full) { im.updateRange.offset = 0; im.updateRange.count = -1; if (ic) { ic.updateRange.offset = 0; ic.updateRange.count = -1; } }
    else { im.updateRange.offset = this.dmin * 16; im.updateRange.count = (this.dmax - this.dmin + 1) * 16; if (ic) { ic.updateRange.offset = this.dmin * 3; ic.updateRange.count = (this.dmax - this.dmin + 1) * 3; } }
    im.needsUpdate = true; if (ic) ic.needsUpdate = true;
    this.dmin = 1e9; this.dmax = -1; this.full = false;
  };
  Ruts.prototype.clear = function () { this.head = 0; this.filled = 0; this.m.count = 0; };
  /** Hide marks with x < xMax (prep tractor smoothing). */
  Ruts.prototype.smoothBefore = function (xMax) {
    var a = this.m.instanceMatrix.array, any = false;
    for (var i = 0; i < this.filled; i++) { var k = i * 16; if (a[k + 15] !== 0 && a[k + 12] < xMax) { for (var j = 0; j < 16; j++) a[k + j] = 0; any = true; } }
    if (any) this.full = true;
  };
  var RUT = { last: {}, cls: null };
  function rutsFor(vs) {
    if (!vs) return null;
    if (!vs._ruts) {
      var cap = low() ? 1800 : 4200, wet = vs.trackCondition || 0;
      vs._ruts = { tread: new Ruts(vs, 'tread', cap, wet), pan: new Ruts(vs, 'pan', Math.round(cap / 3), wet) };
    }
    return vs._ruts;
  }
  VX.clearRuts = function () { var r = TP.venueState && TP.venueState._ruts; if (r) { r.tread.clear(); r.pan.clear(); } };
  function rutStep(p, rig) {
    var vs = TP.venueState, R = rutsFor(vs); if (!R || !rig) return;
    if (p.status === 'staged') { RUT.rx = rig.x; RUT.fx = rig.x + rig.frontX; RUT.sx = rig.sledX; return; }
    if (rig._rutZ == null) {
      var mz = 0.9, ww = 0.5, wr = rig.model && rig.model.wheels && rig.model.wheels.rear;
      if (wr) for (var i = 0; i < wr.length; i++) mz = Math.max(mz, Math.abs(wr[i].position.z));
      rig._rutZ = mz; rig._rutW = clamp((rig.Rr || 0.6) * 0.75, 0.35, 0.9); rig._fz = mz * 0.95; rig._fw = clamp((rig.Rf || 0.5) * 0.55, 0.25, 0.6);
    }
    var hd = -p.heading, ch = Math.cos(p.heading), sh = Math.sin(p.heading);
    var spin = clamp((p.w - p.speed) / Math.max(1, p.speed + 1), 0, 2);
    var shade = clamp(1.05 - spin * 0.35, 0.45, 1.05);
    if (rig.x - RUT.rx >= 0.42) {
      var x = rig.x - 0.2;
      for (var s = -1; s <= 1; s += 2) R.tread.stamp(x - s * rig._rutZ * sh, rig.z + s * rig._rutZ * ch, hd, 0.5, rig._rutW, shade);
      RUT.rx = rig.x;
    }
    var fx = rig.x + rig.frontX;
    if (fx - RUT.fx >= 0.42) {
      if (rig.lift < 0.035) for (var s2 = -1; s2 <= 1; s2 += 2) R.tread.stamp(fx - 0.2 - s2 * rig._fz * sh, rig.z + s2 * rig._fz * ch + fx * sh * 0, hd, 0.48, rig._fw, 1.12);
      RUT.fx = fx;
    }
    if (p.chainTaut && rig.sledX - RUT.sx >= 0.5) {
      R.pan.stamp(rig.sledX - 1.2, rig.sledZ, 0, 0.62, 2.7, clamp(0.85 + p.dig * 0.12, 0.8, 1.15));
      RUT.sx = rig.sledX;
    } else if (!p.chainTaut) RUT.sx = Math.max(RUT.sx, rig.sledX);
  }
  TP.onFrame(function () { var vs = TP.venueState; if (vs && vs._ruts) { vs._ruts.tread.flush(); vs._ruts.pan.flush(); } });

  /* Track prep tractor: drives the lane while you're in the menus and smooths the ruts away. */
  var PREP = { mesh: null, active: false, x: 0, pending: false, idleT: 0, smT: 0 };
  function prepTractor(ctx) {
    var LP = LPX(), b = LP.builder();
    b.box(2.6, 0.9, 1.2, 0x2e7d32, { x: 0.6, y: 1.25 }).box(1.4, 1.5, 1.3, 0x2e7d32, { x: -0.5, y: 1.5 }).box(1.3, 1.1, 1.25, 0x22313b, { x: -0.5, y: 2.75 }).box(1.6, 0.1, 1.6, 0xf3efe6, { x: -0.5, y: 3.35 })
      .cyl(0.08, 0.08, 1.2, 6, 0x222222, { x: 1.2, y: 2.2, z: 0.4 })
      .cyl(0.85, 0.85, 0.5, 14, 0x1d1b19, { x: -0.6, y: 0.85, z: 0.85, axis: 'z' }).cyl(0.85, 0.85, 0.5, 14, 0x1d1b19, { x: -0.6, y: 0.85, z: -0.85, axis: 'z' })
      .cyl(0.5, 0.5, 0.3, 12, 0x1d1b19, { x: 1.6, y: 0.5, z: 0.7, axis: 'z' }).cyl(0.5, 0.5, 0.3, 12, 0x1d1b19, { x: 1.6, y: 0.5, z: -0.7, axis: 'z' })
      .cyl(0.5, 0.5, 0.52, 12, 0xffc61a, { x: -0.6, y: 0.85, z: 0.85, axis: 'z' }).cyl(0.5, 0.5, 0.52, 12, 0xffc61a, { x: -0.6, y: 0.85, z: -0.85, axis: 'z' })
      .box(0.25, 0.25, 7.6, 0x4b5157, { x: -2.6, y: 0.45 }).box(1.2, 0.1, 0.1, 0x4b5157, { x: -1.9, y: 0.55, z: 1.0 }).box(1.2, 0.1, 0.1, 0x4b5157, { x: -1.9, y: 0.55, z: -1.0 });
    for (var t = -3.6; t <= 3.6; t += 0.4) b.box(0.06, 0.4, 0.06, 0x8e979f, { x: -2.6, y: 0.2, z: t, rz: 0.35 });
    var m = b.mesh({ shadow: true }); m.visible = false; m.position.set(-30, 0, 0); ctx.group.add(m);
    return m;
  }
  TP.onFrame(function (dt, realDt) {
    var vs = TP.venueState; if (!vs || !vs._ruts) return;
    var busy = !!(TP.r3 && TP.r3.pull);
    if (!PREP.mesh || PREP.mesh.parent !== vs.group) { PREP.mesh = vs._prep || null; PREP.active = false; }
    if (!PREP.mesh) return;
    if (busy) { if (PREP.active) { PREP.active = false; PREP.mesh.visible = false; } PREP.idleT = 0; return; }
    if (!PREP.active) {
      if (PREP.pending && vs._ruts.tread.filled > 0) { PREP.idleT += realDt; if (PREP.idleT > 1.2) { PREP.active = true; PREP.pending = false; PREP.x = 14; PREP.mesh.visible = true; vs._ruts.tread.smoothBefore(14); vs._ruts.pan.smoothBefore(14); } }
      return;
    }
    PREP.x += realDt * 7.5;
    PREP.mesh.position.set(PREP.x, 0, 0); PREP.mesh.position.y = Math.sin(TP.time * 18) * 0.015;
    PREP.smT -= realDt;
    if (PREP.smT <= 0) { PREP.smT = 0.2; vs._ruts.tread.smoothBefore(PREP.x - 2.4); vs._ruts.pan.smoothBefore(PREP.x - 2.4); }
    if (Math.random() < realDt * 30 * (low() ? 0.5 : 1)) TP.fx.emit('roostdust', PREP.x - 2.8, 0.3, (Math.random() - 0.5) * 7, -1, 0.5, 0, 0.8, 1);
    if (PREP.x > vs.track.length + 25) { PREP.active = false; PREP.mesh.visible = false; vs._ruts.tread.clear(); vs._ruts.pan.clear(); }
  });

  /* ---------------------------------------------------------------------------
   * 8. LEADER MARK — a glowing "TO BEAT" line on the track at the leader's distance
   * ------------------------------------------------------------------------- */
  function leaderMark(vs) {
    if (vs._lead) return vs._lead;
    var LP = LPX(), lh = vs.track.laneHalf, b = LP.builder();
    b.box(0.16, 0.02, lh * 2, 0xffd23f, { y: 0.03 });
    [-1, 1].forEach(function (s) { b.cyl(0.04, 0.04, 2.2, 6, 0xdfe4e8, { y: 1.1, z: s * (lh + 0.5) }); });
    var g = new THREE.Group();
    var line = b.mesh({ mat: new THREE.MeshBasicMaterial({ vertexColors: true }) }); g.add(line);
    var tex = LP.canvasTexture(256, 96, function () {});
    var flags = [];
    [-1, 1].forEach(function (s) { var f = LP.decal(tex, 1.5, 0.56, { x: 0.78, y: 1.9, z: s * (lh + 0.5), emissive: 0.8 }); g.add(f); flags.push(f); });
    var back = LP.decal(tex, 1.5, 0.56, { x: 0.78, y: 1.9, z: -(lh + 0.52), face: '-z', emissive: 0.8 }); g.add(back);
    g.visible = false; vs.group.add(g);
    vs._lead = { g: g, tex: tex, set: function (ft) {
      if (!(ft > 0)) { g.visible = false; return; }
      var c = tex.userData.ctx; c.fillStyle = '#17140f'; c.fillRect(0, 0, 256, 96); c.fillStyle = '#ffd23f'; c.fillRect(0, 0, 256, 8); c.fillRect(0, 88, 256, 8);
      c.fillStyle = '#ffd23f'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '800 24px "Saira Condensed", "Arial Narrow", Impact, sans-serif'; c.fillText('TO BEAT', 128, 28);
      c.font = '900 40px "Saira Condensed", "Arial Narrow", Impact, sans-serif'; c.fillText(ft.toFixed(2) + ' ft', 128, 64);
      tex.needsUpdate = true;
      g.position.set(ft * FT, 0, 0); g.visible = ft * FT < vs.track.length + 1;
    } };
    return vs._lead;
  }

  /* ---------------------------------------------------------------------------
   * 9. SPOTLIGHT BEAMS + HAZE (arena / night)
   * ------------------------------------------------------------------------- */
  function beams(ctx, list, color) {
    var geo = new THREE.CylinderGeometry(0.25, 3.6, 1, 18, 1, true); geo.translate(0, -0.5, 0);
    var mat = new THREE.ShaderMaterial({
      uniforms: { col: { value: new THREE.Color(color || 0xfff1d6).convertSRGBToLinear() }, k: { value: 0.16 } },
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = -position.y; vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'uniform vec3 col; uniform float k; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float a = k * e * (1.0 - vY) * smoothstep(0.0, 0.08, vY); gl_FragColor = vec4(col * a, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    mat._shared = true;
    var m = new THREE.InstancedMesh(geo, mat, list.length); m.frustumCulled = false; m.renderOrder = 7;
    ctx.group.add(m);
    var d = new THREE.Object3D(), tv = new THREE.Vector3(), t0 = Math.random() * 10;
    var upd = function () {
      var t = TP.time + t0, r = TP.r3 && TP.r3.pull && TP.r3.pull.rig, follow = r ? r.x : ctx.track.length * 0.3;
      for (var i = 0; i < list.length; i++) {
        var L = list[i];
        var tx = L.follow ? follow + Math.sin(t * 0.7 + i) * 3 : L.tx + Math.sin(t * (0.3 + i * 0.07) + i * 2) * (L.sweep || 12);
        var tz = (L.tz || 0) + Math.cos(t * (0.25 + i * 0.05) + i) * (L.sweepZ || 4);
        tv.set(tx - L.x, 0 - L.y, tz - L.z); var len = tv.length();
        d.position.set(L.x, L.y, L.z); d.quaternion.setFromUnitVectors(UPV, tv.multiplyScalar(-1 / len));
        d.scale.set(len / 30 + 0.4, len, len / 30 + 0.4); d.updateMatrix(); m.setMatrixAt(i, d.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    };
    upd(); ctx.addUpdate(upd);
    return m;
  }
  var UPV = null;
  function hazeLayer(ctx, n, color, opacity, y0, y1) {
    var tex = canvasTex('hazepuff', 128, 128, function (c, w, h) { var g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); });
    var rng = mkRng(31), pos = [];
    for (var i = 0; i < n; i++) pos.push(rng.range(-30, ctx.track.length + 40), rng.range(y0, y1), rng.range(-30, 25));
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    var m = new THREE.PointsMaterial({ map: tex, size: 26, sizeAttenuation: true, transparent: true, depthWrite: false, opacity: opacity, color: new THREE.Color(color) });
    m._shared = true;
    var pts = new THREE.Points(g, m); pts.renderOrder = 3; pts.frustumCulled = false; ctx.group.add(pts);
    return pts;
  }

  /* ---------------------------------------------------------------------------
   * 10. LED DISTANCE BOARDS
   * ------------------------------------------------------------------------- */
  function ledBoard(ctx, x, y, z, w, h, o) {
    o = o || {};
    var LP = LPX(), b = LP.builder();
    b.box(w + 0.6, h + 0.6, 0.5, 0x101214, { y: 0 });
    if (o.legs) { b.box(0.4, y, 0.4, 0x4b5157, { x: -w * 0.35, y: -y / 2 }).box(0.4, y, 0.4, 0x4b5157, { x: w * 0.35, y: -y / 2 }); }
    var grp = new THREE.Group(); grp.add(b.mesh({})); grp.position.set(x, y, z); if (o.ry) grp.rotation.y = o.ry;
    var tex = LP.canvasTexture(768, 288, function () {});
    var mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    var face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); face.position.z = 0.26; grp.add(face);
    ctx.group.add(grp);
    var last = '';
    var dots = canvasTex('leddots', 8, 8, function (c) { c.fillStyle = '#000'; c.fillRect(0, 0, 8, 8); c.fillStyle = '#fff'; c.beginPath(); c.arc(4, 4, 3, 0, 6.3); c.fill(); }, false);
    var draw = function (txt, sub) {
      var c = tex.userData.ctx, W = 768, H = 288;
      c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
      var g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#16202c'); g.addColorStop(1, '#06080c'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = '#ff7a1a'; c.fillRect(0, 0, W, 54);
      c.fillStyle = '#17140f'; c.font = '900 40px "Saira Condensed", "Arial Narrow", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText((sub || 'DISTANCE').slice(0, 28), W / 2, 29);
      c.shadowColor = '#ffb020'; c.shadowBlur = 18; c.fillStyle = '#ffd23f'; c.font = '900 170px "Saira Condensed", "Arial Narrow", Impact, sans-serif';
      c.fillText(txt, W / 2 - 30, 172); c.shadowBlur = 0;
      c.fillStyle = '#fff4dc'; c.font = '800 48px "Saira Condensed", "Arial Narrow", Impact, sans-serif'; c.textAlign = 'left'; c.fillText('FT', W / 2 + c.measureText(txt).width * 0 + 230, 196);
      // dot-matrix overlay
      c.globalAlpha = 0.18; c.fillStyle = '#000'; for (var yy = 54; yy < H; yy += 4) c.fillRect(0, yy, W, 1.5); for (var xx = 0; xx < W; xx += 4) c.fillRect(xx, 54, 1.5, H); c.globalAlpha = 1;
      tex.needsUpdate = true;
    };
    draw('0.00', o.sub || 'FULL PULL');
    return { mesh: grp, set: function (txt, sub) { var k = txt + '|' + (sub || ''); if (k === last) return; last = k; draw(txt, sub); } };
    // (dots kept for future texture use)
  }
  /** Chain a new board onto ctx.board so the core's live distance updates drive both. */
  function addBoard(ctx, board) {
    var prev = ctx.board;
    ctx.board = { set: function (t, s) { try { if (prev) prev.set(t, s); } catch (e) {} board.set(t, s); }, mesh: board.mesh };
  }
  /** Scrolling LED ribbon (texture offset animation — no redraw). */
  function ledRibbon(ctx, x0, x1, y, z, h, ry) {
    var tex = canvasTex('ribbon', 2048, 64, function (c, w, hh) {
      var items = [['IRONHORSE TRACTOR CO.', '#ffd23f'], ['BIG SKY TRUCKS', '#5fb6e8'], ['RED ROOSTER AG', '#ff5a3a'], ['THUNDERBOLT DIESEL', '#ffd23f'], ['PRAIRIE KING', '#7ae07a'], ['FULL PULL NATIONALS', '#fff4dc']];
      c.fillStyle = '#05070a'; c.fillRect(0, 0, w, hh);
      c.font = '900 44px "Saira Condensed", "Arial Narrow", Impact, sans-serif'; c.textBaseline = 'middle';
      var x = 20; items.forEach(function (it) { c.fillStyle = it[1]; c.fillText(it[0], x, 34); x += c.measureText(it[0]).width + 30; c.fillStyle = '#ff7a1a'; c.fillText('★', x, 34); x += 60; });
    });
    tex.wrapS = THREE.RepeatWrapping; tex.repeat.set((x1 - x0) / 60, 1);
    var m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    m.material._shared = true;
    m.position.set((x0 + x1) / 2, y, z); if (ry) m.rotation.y = ry; ctx.group.add(m);
    ctx.addUpdate(function (dt) { tex.offset.x = (tex.offset.x + dt * 0.03) % 1; });
    return m;
  }

  /* ---------------------------------------------------------------------------
   * 11. VENUES
   * ------------------------------------------------------------------------- */
  function emissiveMesh(be) { return be.parts.length ? be.mesh({ mat: lampMat() }) : null; }
  var _lampMat = null;
  function lampMat() { if (!_lampMat) { _lampMat = new THREE.MeshBasicMaterial({ vertexColors: true }); _lampMat._shared = true; } return _lampMat; }
  function finish(ctx, b, be, gs, o) {
    o = o || {};
    if (b && b.parts.length) ctx.group.add(b.mesh({ shadow: false, receive: true }));
    var em = be && emissiveMesh(be); if (em) ctx.group.add(em);
    if (gs) gs.build(ctx.group, { twinkle: o.twinkle || 0 });
  }
  var SPONSORS = [
    { text: 'IRONHORSE TRACTOR CO.', bg: '#b8322a', fg: '#fff4dc' }, { text: 'BIG SKY TRUCKS', bg: '#17140f', fg: '#ffd23f' },
    { text: 'RED ROOSTER AG', bg: '#2565ae', fg: '#fff4dc' }, { text: 'THUNDERBOLT DIESEL', bg: '#17140f', fg: '#ff7a1a' },
    { text: 'PRAIRIE KING', bg: '#2e7d32', fg: '#ffd23f' }, { text: 'COUNTY CO-OP FEED', bg: '#ff7a1a', fg: '#17140f' },
    { text: 'MUDDY CREEK TIRE', bg: '#3a2a1e', fg: '#fff4dc' }, { text: 'SUNDOWN FUEL & LUBE', bg: '#fff4dc', fg: '#b8322a' }];
  function fenceBanners(ctx, z, x0, n, step, lit) {
    var items = [];
    for (var i = 0; i < n; i++) { var s = SPONSORS[i % SPONSORS.length]; items.push({ text: s.text, bg: s.bg, fg: s.fg, x: x0 + i * step, y: 0.85, z: z + 0.06, w: 5.4, h: 0.9 }); }
    return sponsorBanners(ctx, items, { lit: lit });
  }
  function treeRing(ctx, rng, n, rmin, rmax, pineFrac) {
    var lh = ctx.track.laneHalf, pts = [];
    for (var t = 0; t < n; t++) { var side = rng() < 0.62 ? -1 : 1; pts.push({ x: rng.range(-140, 240), z: side * rng.range(lh + rmin, lh + rmax), s: rng.range(1.2, 2.3), pine: rng() < pineFrac }); }
    forest(ctx, pts);
  }
  function midway(ctx, b, be, gs, x0, z0, lit, rng) {
    var cols = [[0xd23a2a, 0xf3efe6], [0x2565ae, 0xf3efe6], [0xffc61a, 0xd23a2a], [0x2e8b3d, 0xf3efe6], [0x7a3fa0, 0xffc61a]];
    for (var i = 0; i < 7; i++) { var c = cols[i % cols.length]; tent(b, x0 + i * 9 + rng() * 2, z0 - rng() * 8, 2.6 + rng() * 1.2, c[0], c[1]); }
    for (var j = 0; j < 4; j++) foodStand(b, be, gs, x0 + 4 + j * 15, z0 + 6, [0xd23a2a, 0x2565ae, 0xff7a1a, 0x2e8b3d][j], lit, false);
  }

  function countyFairBuild(ctx, o) {
    o = o || {};
    var K = ctx.kit, P = ctx.palette, L = ctx.track.length, lh = ctx.track.laneHalf, rng = mkRng(101 + (o.seed || 0));
    var lit = !!o.lit, night = !!o.night;
    K.plane(ctx, 1000, 1000, grassTexture({ repeat: [100, 100], base: o.grass || '#5f8f36' }), { x: 50, y: -0.02 });
    var b = LPX().builder(), be = LPX().builder(), gs = new GlowSet(), seats = [];
    hills(b, o.hillColor || 0x5d7f45, rng, 520, 22, 1);
    // grandstands behind the track (−Z)
    seats = seats.concat(grandstand(ctx, b, -6, 30, -(lh + 12), 10, -1, { roof: 0xb8322a }));
    seats = seats.concat(grandstand(ctx, b, 32, 62, -(lh + 12), 12, -1, { roof: 0x2565ae }));
    seats = seats.concat(grandstand(ctx, b, 64, 100, -(lh + 12), 10, -1, { roof: 0xb8322a }));
    seats = seats.concat(grandstand(ctx, b, 20, 34, lh + 16, 5, 1, {}));
    seats = seats.concat(grandstand(ctx, b, 60, 74, lh + 16, 5, 1, {}));
    standingLine(seats, -8, 102, -(lh + 11.1), 0, Math.PI, 0.75, rng, 0.4);
    fence(b, -30, L + 30, -(lh + 10.6), 0xf3efe6); fence(b, -30, L + 30, lh + 10.6, 0xf3efe6);
    ctx.kit.pennants(b, -6, 100, 6.4, -(lh + 11.2), [P.red, P.yellow, P.blue, P.cream, P.orange]);
    // announcer booth + light towers
    b.box(5, 3.2, 3.4, P.cream, { x: 47, y: 8.6, z: -(lh + 21.5) }).box(5.6, 0.3, 3.9, P.red, { x: 47, y: 10.35, z: -(lh + 21.5) });
    be.box(4.2, 1.1, 0.05, lit ? 0xffe0a0 : 0x2a3a48, { x: 47, y: 8.9, z: -(lh + 19.78) });
    [-12, 22, 56, 90, 118].forEach(function (x) { lightTower(b, be, gs, x, -(lh + 27), 19, 1, lit); });
    [8, 76].forEach(function (x) { lightTower(b, be, gs, x, lh + 26, 17, -1, lit); });
    // midway, barns, pits
    midway(ctx, b, be, gs, 112, -(lh + 30), lit, rng);
    midway(ctx, b, be, gs, -70, -(lh + 30), lit, rng);
    barn(b, -48, -(lh + 46), 1.1); barn(b, 170, -(lh + 50), 1.2, 0xb8322a);
    for (var pt = 0; pt < 6; pt++) parkedTruck(b, -40 + pt * 8, lh + 22, [0xf3efe6, 0x2565ae, 0x17140f, 0xd23a2a, 0x8e979f, 0x2e7d32][pt], Math.PI / 2, pt % 2 === 0);
    for (var pt2 = 0; pt2 < 5; pt2++) parkedTruck(b, 120 + pt2 * 7, lh + 20, [0xffc61a, 0x17140f, 0xf3efe6, 0xb8322a, 0x1b2f55][pt2], Math.PI / 2, pt2 % 2 === 1);
    if (lit) {
      // string lights over the fence + midway
      for (var sl = -6; sl < 100; sl += 12) stringLights(b, gs, sl, 6.6, -(lh + 11.4), sl + 12, 6.6, -(lh + 11.4), 14, [0xffe0a0, 0xffd080, 0xfff0c0], 0.7);
      stringLights(b, gs, 108, 5, -(lh + 24), 175, 5, -(lh + 24), 50, [0xff5a3a, 0xffd23f, 0x4ab0ff, 0x7aff7a], 1.2);
      stringLights(b, gs, -75, 5, -(lh + 24), -10, 5, -(lh + 24), 48, [0xff5a3a, 0xffd23f, 0x4ab0ff, 0x7aff7a], 1.2);
    }
    finish(ctx, b, be, gs, { twinkle: lit ? 0.25 : 0 });
    ferris(ctx, 150, -(lh + 66), 15, { lit: lit, speed: 0.07 });
    fenceBanners(ctx, -(lh + 10.6), -8, 7, 18, night ? 0.5 : 0);
    makeCrowd(ctx, seats, { max: o.crowdMax || 1150, maxLow: 360, density: o.density || 0.85, seed: 3 });
    var hay = [];
    for (var hb = 0; hb < 8; hb++) hay.push({ x: -14 + (hb % 4) * 1.3, z: -(lh + 4) - Math.floor(hb / 4) * 1.4, ry: 0 });
    for (var hb2 = 0; hb2 < 6; hb2++) hay.push({ x: L + 12 + hb2 * 1.3, z: (hb2 % 2 ? 1 : -1) * (lh + 3.5), ry: 0 });
    ctx.kit.hay(ctx, hay);
    treeRing(ctx, rng, low() ? 60 : 110, 40, 140, 0.25);
    if (!night) clouds(ctx, { n: 16, color: o.cloudColor || 0xffffff, opacity: o.cloudOpacity || 0.85 });
  }

  // 1. County Fair (day) — upgraded
  TP.addVenue('county_fair', {
    name: 'County Fairgrounds', desc: 'Saturday afternoon at the fair: bleachers packed, funnel cakes frying and a freshly worked dirt track.',
    levelReq: 1, timeOfDay: 'day', trackCondition: 0.2, crowdSize: 0.8, laneHalf: 4.6, fireworks: false,
    trackOpts: { width: 29, dirtBase: '#8c5d36' },
    sky: { top: 0x2f7fd0, horizon: 0xcfe5ef, bottom: 0x9fb5a0, sun: 0xfff0d8, sunIntensity: 2.3, hemiSky: 0xcfe6ff, hemiGround: 0x8a6a48, hemiIntensity: 0.5,
      sunDir: [-0.45, 0.62, 0.64], fogNear: 180, fogFar: 760, haze: 1, exposure: 1.05 },
    env: { k: 1.0, ground: 0x5a4a32, kg: 0.5 },
    build: function (ctx) { countyFairBuild(ctx, {}); }
  });
  // 2. Twilight Fairgrounds (sunset)
  TP.addVenue('twilight_fair', {
    name: 'Twilight Fairgrounds', desc: 'Golden hour. String lights flicker on, the Ferris wheel glows and the diesel smoke turns pink.',
    levelReq: 2, timeOfDay: 'sunset', trackCondition: 0.25, crowdSize: 0.9, laneHalf: 4.6, fireworks: true,
    trackOpts: { width: 29, dirtBase: '#8a5634' },
    sky: { top: 0x2b2f6a, horizon: 0xff9a52, bottom: 0x5a4a5a, sun: 0xffa060, sunIntensity: 2.0, hemiSky: 0x9a8ad0, hemiGround: 0x6a4a38, hemiIntensity: 0.45,
      sunDir: [-0.85, 0.16, 0.42], fogNear: 140, fogFar: 640, haze: 1.6, sunSize: 3, sunGlow: 0xffb070, exposure: 1.1 },
    env: { k: 0.9, ground: 0x4a3428, kg: 0.4 },
    build: function (ctx) { countyFairBuild(ctx, { lit: true, seed: 7, grass: '#56783a', hillColor: 0x4a5a3a, cloudColor: 0xffb08a, cloudOpacity: 0.75, crowdMax: 1200, density: 0.9 }); }
  });
  // 3. State Fair Night Pull
  TP.addVenue('state_fair_night', {
    name: 'State Fair Night Pull', desc: 'Stadium lights, a packed double-deck grandstand and fireworks for every full pull.',
    levelReq: 4, timeOfDay: 'night', trackCondition: 0.18, crowdSize: 1.2, laneHalf: 4.6, fireworks: true,
    trackOpts: { width: 29, dirtBase: '#8a5a34' },
    sky: { top: 0x040818, horizon: 0x1c2446, bottom: 0x10121a, sun: 0xeef2ff, sunIntensity: 2.0, hemiSky: 0x4a5a8a, hemiGround: 0x3a2a20, hemiIntensity: 0.38,
      sunDir: [-0.25, 0.9, 0.35], fogNear: 120, fogFar: 520, haze: 0.4, sunSize: 0.001, sunGlow: 0x000000, exposure: 1.15 },
    env: { k: 0.35, ground: 0x2a2018, kg: 0.3, lights: [{ dir: [-0.3, 0.6, -0.8], color: 0xfff2d6, k: 30, r: 3 }, { dir: [0.4, 0.6, -0.8], color: 0xfff2d6, k: 30, r: 3 }, { dir: [0, 0.5, 0.9], color: 0xfff2d6, k: 24, r: 3 }] },
    build: function (ctx) {
      var K = ctx.kit, P = ctx.palette, L = ctx.track.length, lh = ctx.track.laneHalf, rng = mkRng(303);
      K.plane(ctx, 1000, 1000, grassTexture({ repeat: [100, 100], base: '#3e5a2a' }), { x: 50, y: -0.02 });
      var b = LPX().builder(), be = LPX().builder(), gs = new GlowSet(), seats = [];
      // double-deck main grandstand
      seats = seats.concat(grandstand(ctx, b, -12, 104, -(lh + 12), 14, -1, { roof: 0x1b2f55 }));
      var deckY = 0.5 + 14 * 0.45 + 1.2, deckZ = -(lh + 12 + 14 * 0.8 + 1.5);
      b.box(116, 0.6, 3, 0x3c4248, { x: 46, y: deckY, z: deckZ + 1.5 });
      var upper = K.bleachers(b, -12, 104, deckZ, 10, -1, { seat: 0xb9bec4, riser: 0x6a737b });
      for (var u = 0; u < upper.length; u++) upper[u].y += deckY;
      seats = seats.concat(upper);
      b.box(118, 0.4, 16, 0x1b2f55, { x: 46, y: deckY + 0.5 + 10 * 0.45 + 2.6, z: deckZ - 6, rx: 0.06 });
      b.box(116, deckY + 7, 0.3, 0x2a3038, { x: 46, y: (deckY + 7) / 2, z: deckZ - 8.5 });
      // near-side grandstand (other cameras)
      seats = seats.concat(grandstand(ctx, b, 0, 90, lh + 14, 9, 1, { roof: 0x1b2f55 }));
      standingLine(seats, -12, 104, -(lh + 11.1), 0, Math.PI, 0.6, rng, 0.5);
      wall(b, -30, L + 30, -(lh + 10.6), 1.2, 0x6a737b); wall(b, -30, L + 30, lh + 10.6, 1.2, 0x6a737b);
      // stadium light towers (tall) both sides
      [-20, 15, 50, 85, 118].forEach(function (x) { lightTower(b, be, gs, x, -(lh + 38), 30, 1, true); });
      [-5, 45, 95].forEach(function (x) { lightTower(b, be, gs, x, lh + 30, 26, -1, true); });
      // midway glow beyond the ends
      midway(ctx, b, be, gs, 118, -(lh + 34), true, rng);
      midway(ctx, b, be, gs, -80, -(lh + 34), true, rng);
      stringLights(b, gs, 110, 5.5, -(lh + 28), 185, 5.5, -(lh + 28), 60, [0xff5a3a, 0xffd23f, 0x4ab0ff, 0x7aff7a, 0xff7ae0], 1.3);
      stringLights(b, gs, -88, 5.5, -(lh + 28), -14, 5.5, -(lh + 28), 60, [0xff5a3a, 0xffd23f, 0x4ab0ff, 0x7aff7a, 0xff7ae0], 1.3);
      // pit trucks with work lights
      for (var pt = 0; pt < 8; pt++) { parkedTruck(b, -36 + pt * 9, lh + 34, [0xf3efe6, 0x2565ae, 0x17140f, 0xd23a2a][pt % 4], Math.PI / 2, true); gs.add(-36 + pt * 9, 3.2, lh + 32, 0xfff0d0, 4); }
      finish(ctx, b, be, gs, { twinkle: 0.3 });
      ferris(ctx, 160, -(lh + 75), 18, { lit: true, speed: 0.08 });
      ferris(ctx, -60, -(lh + 80), 12, { lit: true, speed: -0.1 });
      fenceBanners(ctx, -(lh + 10.82), -8, 7, 18, 0.9);
      ledRibbon(ctx, -12, 104, deckY + 0.05, deckZ + 3.05, 0.8);
      addBoard(ctx, ledBoard(ctx, 46, deckY + 14, deckZ - 9, 14, 5.2, { sub: 'STATE FAIR' }));
      makeCrowd(ctx, seats, { max: 1700, maxLow: 450, density: 0.95, seed: 11, hats: 0.4 });
      beams(ctx, [{ x: 10, y: 32, z: -(lh + 37), tx: 20, sweep: 25, tz: 0 }, { x: 80, y: 32, z: -(lh + 37), tx: 60, sweep: 25, tz: 0 }, { x: 45, y: 30, z: lh + 29, follow: true }], 0xeaf0ff);
      stars(ctx, low() ? 120 : 260);
      treeRing(ctx, rng, low() ? 40 : 80, 60, 150, 0.4);
    }
  });
  // 4. Mud Bog Farm Pull
  TP.addVenue('mud_bog', {
    name: 'Mud Bog Farm Pull', desc: 'Out on the Hollister farm after a rain: soft, wet dirt, puddles everywhere and folks watching from their tailgates.',
    levelReq: 3, timeOfDay: 'overcast', trackCondition: 0.55, crowdSize: 0.6, laneHalf: 4.6, mud: true, fireworks: false,
    trackOpts: { width: 27, dirtBase: '#5a3a20' },
    sky: { top: 0x6f8296, horizon: 0xc4cac4, bottom: 0x8a8a7a, sun: 0xf2eee0, sunIntensity: 1.5, hemiSky: 0xc8d0d8, hemiGround: 0x6a5a40, hemiIntensity: 0.6,
      sunDir: [-0.3, 0.75, 0.5], fogNear: 90, fogFar: 520, haze: 1.8, sunSize: 6, sunGlow: 0xb0a890, exposure: 1.1 },
    env: { k: 0.9, ground: 0x4a3a28, kg: 0.5 },
    build: function (ctx) {
      var K = ctx.kit, P = ctx.palette, L = ctx.track.length, lh = ctx.track.laneHalf, rng = mkRng(404);
      K.plane(ctx, 1000, 1000, grassTexture({ repeat: [100, 100], base: '#6a7a3a', dry: 1 }), { x: 50, y: -0.02 });
      var b = LPX().builder(), be = LPX().builder(), seats = [];
      hills(b, 0x6a7a4a, rng, 380, 20, 1.4);
      // dirt spectator banks + hay-wagon bleachers + tailgate row
      b.taper(L + 50, 1.6, 9, 1, 0.55, 0x5a4a30, { x: L / 2, y: 0.8, z: -(lh + 16) });
      standingLine(seats, -15, L + 20, -(lh + 13.2), 0.55, Math.PI, 0.8, rng, 0.8);
      standingLine(seats, -15, L + 20, -(lh + 15.5), 1.35, Math.PI, 0.9, rng, 0.8);
      for (var w = 0; w < 5; w++) {
        var wx = -6 + w * 22;
        b.box(7, 0.25, 2.6, 0x8a5a2b, { x: wx, y: 1.0, z: -(lh + 21) });
        [-2.5, 2.5].forEach(function (dx) { b.cyl(0.45, 0.45, 0.3, 10, 0x1d1b19, { x: wx + dx, y: 0.45, z: -(lh + 19.7), axis: 'z' }).cyl(0.45, 0.45, 0.3, 10, 0x1d1b19, { x: wx + dx, y: 0.45, z: -(lh + 22.3), axis: 'z' }); });
        for (var hb = 0; hb < 6; hb++) b.box(1.1, 0.45, 0.5, P.hay, { x: wx - 2.7 + hb * 1.1, y: 1.35, z: -(lh + 21) });
        standingLine(seats, wx - 3, wx + 3, -(lh + 21), 1.6, Math.PI, 0.75, rng, 0.6);
      }
      for (var t = 0; t < 12; t++) { var tx = -20 + t * 10, tz = lh + 15 + rng() * 2; parkedTruck(b, tx, tz, [0xf3efe6, 0x2565ae, 0x17140f, 0xd23a2a, 0x8e979f, 0x2e7d32, 0x7a5230][t % 7], -Math.PI / 2 + (rng() - 0.5) * 0.3, false); standingLine(seats, tx - 1, tx + 1, tz - 3.5, 0, 0, 0.7, rng, 0.8); }
      // farm: wooden fence, barns, silos, grain bins, windmill frame
      for (var fx = -30; fx <= L + 30; fx += 3) { b.box(0.16, 1.3, 0.16, 0x6a4a2a, { x: fx, y: 0.65, z: -(lh + 10.6) }).box(0.16, 1.3, 0.16, 0x6a4a2a, { x: fx, y: 0.65, z: lh + 10.6 }); }
      [0.45, 1.0].forEach(function (y) { b.box(L + 60, 0.12, 0.05, 0x7a5a36, { x: L / 2, y: y, z: -(lh + 10.6) }).box(L + 60, 0.12, 0.05, 0x7a5a36, { x: L / 2, y: y, z: lh + 10.6 }); });
      barn(b, -45, -(lh + 42), 1.3, 0x9a2a22); barn(b, 140, -(lh + 46), 1.1, 0x8a8a8a);
      silo(b, -28, -(lh + 46), 16, 2.6); silo(b, -22, -(lh + 47), 13, 2.2);
      for (var gb = 0; gb < 3; gb++) { b.cyl(3.4, 3.4, 6, 16, 0xc9ccd1, { x: 110 + gb * 8, y: 3, z: -(lh + 40) }).cone(3.6, 2, 16, 0xb9bec4, { x: 110 + gb * 8, y: 7, z: -(lh + 40) }); }
      b.box(0.3, 14, 0.3, 0x8e979f, { x: 170, y: 7, z: -(lh + 30), rz: 0.05 }).box(0.3, 14, 0.3, 0x8e979f, { x: 172, y: 7, z: -(lh + 30), rz: -0.05 });
      // a sponsor banner on the fence + hay
      finish(ctx, b, be, null);
      var mill = LPX().builder(); for (var bl = 0; bl < 12; bl++) { var a = bl / 12 * Math.PI * 2; mill.box(0.25, 2.2, 0.05, 0xdfe4e8, { x: Math.cos(a) * 1.3, y: Math.sin(a) * 1.3, rz: a + Math.PI / 2 }); }
      var millM = mill.mesh({}); millM.position.set(171, 14, -(lh + 29.6)); ctx.group.add(millM); ctx.addUpdate(function (dt) { millM.rotation.z -= dt * 1.4; });
      fenceBanners(ctx, -(lh + 10.68), -6, 5, 22, 0);
      // corn field (instanced stalks)
      var corn = LPX().merge([LPX().cyl(0.03, 0.04, 2.2, 4, 0x6a8a3a, { y: 1.1 }), LPX().cone(0.35, 0.9, 5, 0x7a9a42, { y: 1.6, rz: 0.4 }), LPX().cone(0.3, 0.8, 5, 0x6a8a3a, { y: 1.2, rz: -0.5 }), LPX().cone(0.12, 0.5, 4, 0xc9a85a, { y: 2.35 })]);
      var nC = low() ? 500 : 1400, cm = new THREE.InstancedMesh(corn, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }), nC), dd = new THREE.Object3D();
      for (var ci = 0; ci < nC; ci++) { var row = ci % 28, col = (ci / 28) | 0; dd.position.set(-40 + col * (180 / (nC / 28)) + rng() * 0.6, 0, lh + 34 + row * 0.9 + rng() * 0.2); dd.rotation.set((rng() - 0.5) * 0.15, rng() * 6, (rng() - 0.5) * 0.15); dd.scale.setScalar(0.8 + rng() * 0.45); dd.updateMatrix(); cm.setMatrixAt(ci, dd.matrix); }
      cm.instanceMatrix.needsUpdate = true; ctx.group.add(cm);
      // puddles (glossy, reflect the sky) — beside the lane and in the pits
      var pg = [];
      for (var pu = 0; pu < 26; pu++) {
        var side = rng() < 0.5 ? -1 : 1, px = rng.range(-26, L + 30), pz = side * rng.range(lh + 1.4, lh + 9.5), r = rng.range(0.8, 2.6);
        if (pu < 6) { px = rng.range(-24, -6); pz = rng.range(-3, 3); }
        var cg = new THREE.CircleGeometry(r, 14), pa = cg.attributes.position;
        for (var vi = 1; vi < pa.count; vi++) { var k = 0.7 + rng() * 0.45; pa.setX(vi, pa.getX(vi) * k * 1.5); pa.setY(vi, pa.getY(vi) * k); }
        cg.rotateX(-Math.PI / 2); cg.translate(px, 0.018 + pu * 0.0003, pz); pg.push(cg);
      }
      var pm = new THREE.Mesh(LPX().merge(pg), new THREE.MeshStandardMaterial({ color: 0x2a1d12, roughness: 0.06, metalness: 0.2, envMapIntensity: 1.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
      pm.receiveShadow = true; ctx.group.add(pm);
      makeCrowd(ctx, seats, { max: 700, maxLow: 260, density: 0.95, seed: 9, hats: 0.75 });
      var hay = []; for (var h2 = 0; h2 < 16; h2++) hay.push({ x: rng.range(-30, L + 30), z: (rng() < 0.5 ? -1 : 1) * rng.range(lh + 25, lh + 32), ry: rng() * 3 });
      ctx.kit.hay(ctx, hay);
      treeRing(ctx, rng, low() ? 60 : 120, 50, 160, 0.15);
      clouds(ctx, { n: 22, color: 0xd8dcdc, opacity: 0.95 });
    }
  });
  // 5. National Finals Arena (indoor)
  TP.addVenue('national_finals', {
    name: 'National Finals Arena', desc: 'Indoors under the big roof: twenty thousand fans, sweeping spotlights, smoke haze and a giant LED board.',
    levelReq: 6, timeOfDay: 'indoor', trackCondition: 0.12, crowdSize: 1.4, laneHalf: 4.6, indoor: true, fireworks: true,
    trackOpts: { width: 26, dirtBase: '#94603a' },
    sky: { top: 0x07080c, horizon: 0x141822, bottom: 0x0a0b0e, sun: 0xfff4e6, sunIntensity: 2.3, hemiSky: 0x5a6070, hemiGround: 0x3a2c22, hemiIntensity: 0.42,
      sunDir: [-0.15, 0.95, 0.25], fogNear: 60, fogFar: 300, fog: 0x161a22, haze: 0, sunSize: 0.001, sunGlow: 0x000000, exposure: 1.12 },
    env: { k: 0.25, ground: 0x2a2018, kg: 0.25, lights: [{ dir: [-0.4, 0.8, 0], color: 0xfff4e6, k: 40, r: 3 }, { dir: [0.4, 0.8, 0], color: 0xfff4e6, k: 40, r: 3 }, { dir: [0, 0.3, -1], color: 0xff9a40, k: 8, r: 6 }, { dir: [0, 0.3, 1], color: 0x80b0ff, k: 8, r: 6 }] },
    build: function (ctx) {
      var K = ctx.kit, P = ctx.palette, L = ctx.track.length, lh = ctx.track.laneHalf, rng = mkRng(505);
      var floorTex = canvasTex('concrete', 256, 256, function (c, w, h) { c.fillStyle = '#3a3a3c'; c.fillRect(0, 0, w, h); var r = mkRng(3); for (var i = 0; i < 3000; i++) { c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)'; c.fillRect(r() * w, r() * h, 2, 2); } });
      floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(40, 40);
      K.plane(ctx, 400, 400, floorTex, { x: 50, y: -0.02 });
      var b = LPX().builder(), be = LPX().builder(), gs = new GlowSet(), seats = [];
      var X0 = -48, X1 = L + 56, Z = 50, H = 34;
      // bowl: stands on 4 sides, tiered
      seats = seats.concat(grandstand(ctx, b, -40, L + 48, -(lh + 12), 22, -1, { back: 0x22262c, front: 0x1b1d22, seat: 0x5a6a8a, riser: 0x2a2e36 }));
      seats = seats.concat(grandstand(ctx, b, -40, L + 48, lh + 14, 20, 1, { back: 0x22262c, front: 0x1b1d22, seat: 0x5a6a8a, riser: 0x2a2e36 }));
      var endL = K.bleachers(b, -42 - 18 * 0.8, -42, 0, 1, 1, {}); // placeholder (no rows)
      for (var e = 0; e < 16; e++) { b.box(0.8, 0.45, 2 * (lh + 12), 0x5a6a8a, { x: X0 + 6 - e * 0.8, y: 0.5 + e * 0.45, z: 1 }); for (var sz = -(lh + 10); sz < lh + 12; sz += 0.75) seats.push({ x: X0 + 6 - e * 0.8, y: 0.55 + e * 0.45, z: sz, ry: -Math.PI / 2 }); }
      for (var e2 = 0; e2 < 16; e2++) { b.box(0.8, 0.45, 2 * (lh + 12), 0x5a6a8a, { x: X1 - 6 + e2 * 0.8, y: 0.5 + e2 * 0.45, z: 1 }); for (var sz2 = -(lh + 10); sz2 < lh + 12; sz2 += 0.75) seats.push({ x: X1 - 6 + e2 * 0.8, y: 0.55 + e2 * 0.45, z: sz2, ry: Math.PI / 2 }); }
      void endL;
      // walls + roof + trusses
      b.box(X1 - X0 + 40, H, 1, 0x15171c, { x: (X0 + X1) / 2, y: H / 2, z: -Z }).box(X1 - X0 + 40, H, 1, 0x15171c, { x: (X0 + X1) / 2, y: H / 2, z: Z })
        .box(1, H, 2 * Z, 0x15171c, { x: X0 - 20, y: H / 2, z: 0 }).box(1, H, 2 * Z, 0x15171c, { x: X1 + 20, y: H / 2, z: 0 })
        .box(X1 - X0 + 40, 1, 2 * Z, 0x0e1014, { x: (X0 + X1) / 2, y: H, z: 0 });
      for (var tx = X0 - 10; tx <= X1 + 10; tx += 16) {
        b.box(0.8, 2.4, 2 * Z, 0x3a3f48, { x: tx, y: H - 2.2, z: 0 }).box(0.3, 0.3, 2 * Z, 0x50565f, { x: tx, y: H - 4, z: 0 });
        for (var tz = -Z + 6; tz < Z; tz += 12) { be.box(1.2, 0.3, 1.2, 0xfff4e6, { x: tx, y: H - 3.5, z: tz }); gs.add(tx, H - 3.8, tz, 0xfff0d8, 7, tx + tz); }
      }
      // fascia + dasher boards + scrolling ribbons
      wall(b, -40, L + 48, -(lh + 10.6), 1.1, 0x1b1d22); wall(b, -40, L + 48, lh + 10.6, 1.1, 0x1b1d22);
      ledRibbon(ctx, -40, L + 48, 0.62, -(lh + 10.35), 0.8);
      ledRibbon(ctx, -40, L + 48, 10.9, -(lh + 12 + 22 * 0.8) + 0.2, 1.4);
      // jumbotron behind the stands + center-hung cube
      addBoard(ctx, ledBoard(ctx, L * 0.5, 15.5, -(lh + 31), 22, 8, { sub: 'NATIONAL FINALS' }));
      var cube = LPX().builder(); cube.box(10, 5, 10, 0x101214, {}); var cm = cube.mesh({}); cm.position.set(L * 0.5, H - 9, 0); ctx.group.add(cm);
      [['', 0], ['', Math.PI / 2], ['', Math.PI], ['', -Math.PI / 2]].forEach(function (f) {
        var bd = ledBoard(ctx, L * 0.5 + Math.sin(f[1]) * 5.05, H - 9, Math.cos(f[1]) * 5.05, 9.4, 4.4, { ry: f[1], sub: 'NATIONAL FINALS' });
        addBoard(ctx, bd);
      });
      // tunnel + pit-side flag stands
      b.box(10, 6, 1, 0x2a2e36, { x: X0 - 4, y: 3, z: -(lh + 12) });
      be.box(8, 1.2, 0.1, 0xff7a1a, { x: X0 - 4, y: 5.2, z: -(lh + 11.4) });
      finish(ctx, b, be, gs, { twinkle: 0.1 });
      fenceBanners(ctx, -(lh + 10.82), -30, 9, 15, 0.7);
      makeCrowd(ctx, seats, { max: 2400, maxLow: 560, density: 0.97, seed: 17, hats: 0.35 });
      beams(ctx, [
        { x: 0, y: H - 3, z: -20, tx: 20, sweep: 20 }, { x: 30, y: H - 3, z: 20, tx: 40, sweep: 22 }, { x: 60, y: H - 3, z: -20, tx: 60, sweep: 24 },
        { x: 90, y: H - 3, z: 20, tx: 80, sweep: 18 }, { x: 45, y: H - 3, z: 0, follow: true }, { x: 20, y: H - 3, z: 0, follow: true }], 0xfff1d6);
      hazeLayer(ctx, low() ? 18 : 40, 0x9aa4b8, 0.07, 3, 22);
    }
  });

  /* ---------------------------------------------------------------------------
   * 12. VENUE LOADED: env map, ruts, prep tractor, leader mark, crowd defaults
   * ------------------------------------------------------------------------- */
  TP.on('venueLoaded', function (ctx) {
    try { VX.applyEnv(ctx); } catch (e) { warn(e); }
    try { rutsFor(ctx); ctx._prep = prepTractor(ctx); PREP.mesh = ctx._prep; PREP.active = false; } catch (e) { warn(e); }
    try { leaderMark(ctx); } catch (e) { warn(e); }
    HYPE.level = 0; HYPE.wave = -1;
    try { if (TP.audio) TP.audio.crowd(0.22 * (ctx.def.crowdSize || 0.8)); } catch (e) {}
  });

  /* ---------------------------------------------------------------------------
   * 13. PULL-TIME EFFECTS
   * ------------------------------------------------------------------------- */
  var SUPER = { super_stock_diesel: 1, super_stock_tractor: 1, light_super_stock: 1, unlimited_modified: 1, modified_2wd: 0.6, mini_rod: 0.8, pro_stock_tractor: 0.5 };
  var EFX = { lastThr: 0, thrHist: 0, liftT: 0, sparkAcc: 0, billowAcc: [], shimAcc: 0, mudAcc: 0, rmax: 0 };
  var V1 = null, V2 = null;
  function rigState() { var S = TP.r3 && TP.r3.pull; return S && S.rig ? S : null; }
  function pullEffects(p, dt) {
    var S = rigState(); if (!S || dt <= 0) return;
    if (!V1) { V1 = new THREE.Vector3(); V2 = new THREE.Vector3(); UPV = UPV || new THREE.Vector3(0, 1, 0); }
    var rig = S.rig, FX = TP.fx, st = p.stats, q = low() ? 0.5 : 1, et = st.engineType || 'diesel';
    var rpmN = clamp(p.rpm / st.redline, 0, 1.1), running = !p.broken && p.status !== 'staged' || (p.status === 'staged' && !p.broken);
    var stacks = rig.model.stacks || [], n = Math.max(1, stacks.length), sq = 1 / Math.sqrt(n);
    var superK = SUPER[p.classId] || (et === 'methanol' ? 0.8 : 0);
    // lift-off detection (throttle dropping fast from high) → flame pops
    var thr = p.throttle, liftOff = EFX.lastThr > 0.75 && thr < 0.35 && !p.done;
    EFX.lastThr = thr;
    if (EFX.billowAcc.length < n) for (var bi = EFX.billowAcc.length; bi < n; bi++) EFX.billowAcc.push(0);
    for (var i = 0; i < stacks.length; i++) {
      stacks[i].getWorldPosition(V1);
      if (!p.broken) {
        if (et === 'diesel' || et === 'multi') {
          EFX.billowAcc[i] += (thr * (0.4 + rpmN) * 9 + 0.4) * q * sq * dt * (p.boostTimer > 0 ? 1.6 : 1);
          while (EFX.billowAcc[i] >= 1) { EFX.billowAcc[i] -= 1; FX.emit('billow', V1.x, V1.y + 0.3, V1.z, -p.speed * 0.25 + (Math.random() - 0.5) * 0.6, 2.5 + thr * 4, (Math.random() - 0.5) * 0.8, (0.6 + thr) * sq * 1.3, 1); }
        } else if (thr > 0.2 && Math.random() < thr * 0.7 * q) FX.emit('shimmer', V1.x, V1.y + 0.2, V1.z, (Math.random() - 0.5) * 0.4, 2 + rpmN * 2, (Math.random() - 0.5) * 0.4, 1, 1);
        if (et === 'turbine') { FX.emit('glow', V1.x, V1.y + 0.1, V1.z, 0, 1 + thr * 2, 0, 0.7 + thr, 1); if (Math.random() < 0.6 * q) FX.emit('shimmer', V1.x, V1.y + 0.6, V1.z, 0, 3, 0, 1.6, 1); }
        if (superK > 0) {
          var hot = rpmN > 0.78 && thr > 0.8;
          if (hot && Math.random() < superK * 0.85) FX.emit('bigflame', V1.x, V1.y + 0.1, V1.z, (Math.random() - 0.5) * 0.5, 7 + Math.random() * 6, (Math.random() - 0.5) * 0.5, (0.6 + superK * 0.7) * (0.7 + rpmN * 0.4), 1);
          if (liftOff) { for (var f = 0; f < 7; f++) FX.emit('bigflame', V1.x, V1.y + 0.1, V1.z, (Math.random() - 0.5) * 1.6, 5 + Math.random() * 8, (Math.random() - 0.5) * 1.6, 1.2 + superK * 0.6, 1.3); }
          if (p._popT > 0.15 && Math.random() < 0.5) FX.emit('bigflame', V1.x, V1.y + 0.1, V1.z, 0, 9, 0, 1 + superK * 0.5, 1);
        }
      }
    }
    if (liftOff && superK > 0 && !p.broken) { try { TP.audio.sfx('pop', { volume: 0.7 }); } catch (e) {} if (TP.cam) TP.cam.shake = Math.max(TP.cam.shake, 0.6); }
    // roostertails off the drive tires (scaled by slip)
    if (p.status !== 'staged') {
      var slipV = Math.max(0, p.w - p.speed), wr = rig.model.wheels.rear, mud = !!(TP.venueState && TP.venueState.def && TP.venueState.def.mud);
      EFX.mudAcc += (slipV * 14 + p.speed * 1.5) * q * dt;
      while (EFX.mudAcc >= 1) {
        EFX.mudAcc -= 1;
        var wh = wr[(Math.random() * wr.length) | 0]; if (!wh) break;
        wh.getWorldPosition(V2);
        var sp = 3 + slipV * 1.5;
        FX.emit(mud ? 'mud' : 'clod', V2.x - rig.Rr * 0.6, 0.25, V2.z + (Math.random() - 0.5) * 0.5, -sp * (0.5 + Math.random() * 0.5), sp * (0.7 + Math.random() * 0.9), (Math.random() - 0.5) * 3, 0.8 + Math.random() * 0.8, 1);
        if (Math.random() < 0.35) FX.emit(mud ? 'spray' : 'roostdust', V2.x - rig.Rr * 1.2, 0.5, V2.z, -sp * 0.5, 0.8 + slipV * 0.3, (Math.random() - 0.5) * 1.5, 0.8 + slipV * 0.12, 1);
      }
      // sled sparks when the pan digs hard
      if (p.chainTaut && p.dig > 0.45 && p.speed > 0.8) {
        EFX.sparkAcc += (p.dig - 0.4) * 40 * q * dt;
        while (EFX.sparkAcc >= 1) { EFX.sparkAcc -= 1; FX.emit('spark', rig.sledX - 1.2 + Math.random() * 0.4, 0.15, rig.sledZ + (Math.random() - 0.5) * 2.4, p.speed * 0.4 + Math.random() * 2, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3, 1, 0.8); }
      }
    }
  }
  function blowUpExtra(p) {
    var S = rigState(); if (!S) return;
    if (!V1) { V1 = new THREE.Vector3(); V2 = new THREE.Vector3(); }
    S.rig.group.getWorldPosition(V1);
    var x = V1.x + S.rig.frontX * 0.55, z = V1.z;
    TP.fx.burst('fireball', x, 1.8, z, low() ? 14 : 28, { spread: 1.2, speed: 3, up: 1.6, sizeMul: 1.2 });
    TP.fx.burst('billow', x, 2.4, z, low() ? 12 : 24, { spread: 1.6, speed: 1.6, up: 2.2, sizeMul: 1.3 });
    TP.fx.burst('ember', x, 1.8, z, 40, { spread: 0.6, speed: 6, up: 1.4 });
    PARTS.launch(x, 1.6, z);
    if (TP.cam) TP.cam.shake = Math.max(TP.cam.shake, 3);
    try { setTimeout(function () { try { TP.audio.sfx('pop', { volume: 0.8 }); } catch (e) {} }, 180); } catch (e) {}
    try { TP.ui.numberPop('KA-BOOM!', 'bad'); } catch (e) {}
    TP.cheer(1.0);
  }
  /* bouncing cartoon engine parts (pooled meshes) */
  var PARTS = { list: null, launch: function (x, y, z) {
    if (!TP.scene) return;
    if (!PARTS.list) {
      var LP = LPX(), defs = [
        LP.merge([LP.cyl(0.14, 0.14, 0.22, 10, 0xdfe4e8, {}), LP.box(0.06, 0.3, 0.06, 0x8e979f, { y: -0.2 })]),
        LP.box(0.6, 0.1, 0.22, 0xd23a2a, {}), LP.box(0.5, 0.08, 0.2, 0xdfe4e8, {}),
        LP.cyl(0.1, 0.1, 0.35, 8, 0x4b5157, { axis: 'x' }), LP.merge([LP.cyl(0.2, 0.2, 0.12, 12, 0x2b2b2b, { axis: 'z' }), LP.cyl(0.1, 0.1, 0.13, 8, 0xdfe4e8, { axis: 'z' })]),
        LP.box(0.3, 0.3, 0.3, 0x3a3a3a, {})];
      var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 });
      PARTS.list = defs.map(function (g) { var m = new THREE.Mesh(g, mat); m.visible = false; m.castShadow = true; return { m: m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 }; });
    }
    PARTS.list.forEach(function (d) {
      if (d.m.parent !== TP.scene) TP.scene.add(d.m);
      d.m.visible = true; d.m.position.set(x, y, z); d.v.set((Math.random() - 0.4) * 6, 6 + Math.random() * 6, (Math.random() - 0.5) * 7); d.w.set(Math.random() * 12, Math.random() * 12, Math.random() * 12); d.life = 3.5;
    });
  } };
  TP.onFrame(function (dt) {
    if (!PARTS.list) return;
    for (var i = 0; i < PARTS.list.length; i++) {
      var d = PARTS.list[i]; if (d.life <= 0) continue;
      d.life -= dt; d.v.y -= 9.8 * dt; d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < 0.1) { d.m.position.y = 0.1; d.v.y = Math.abs(d.v.y) * 0.5; d.v.x *= 0.7; d.v.z *= 0.7; d.w.multiplyScalar(0.7); if (Math.random() < 0.2) TP.fx.emit('roostdust', d.m.position.x, 0.2, d.m.position.z, 0, 0.5, 0, 0.5, 0.6); }
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      if (d.life <= 0) d.m.visible = false;
    }
  });

  /* ---------------------------------------------------------------------------
   * 14. FIREWORKS (night venues: full pulls, event end, and a few over the menu)
   * ------------------------------------------------------------------------- */
  var FW = { shells: [], queue: 0, qT: 0, ambientT: 6 };
  for (var fwi = 0; fwi < 14; fwi++) FW.shells.push({ on: false, x: 0, y: 0, z: 0, vy: 0, fuse: 0, col: 0, col2: 0, kind: 0 });
  var FW_COLS = [0xff4a3a, 0xffd23f, 0x4ab0ff, 0x7aff7a, 0xff7ae0, 0xffffff, 0xff9a2a, 0xb07aff];
  VX.fireworks = function (n) { FW.queue += n || 8; };
  function launchShell() {
    var vs = TP.venueState; if (!vs) return;
    for (var i = 0; i < FW.shells.length; i++) {
      var s = FW.shells[i]; if (s.on) continue;
      var r = rigState(), cx = r ? r.rig.x : vs.track.length * 0.5, lh = vs.track.laneHalf;
      s.on = true; s.x = cx + (Math.random() - 0.3) * 50; s.z = -(lh + 28 + Math.random() * 20); s.y = 2; s.vy = 20 + Math.random() * 7;
      s.fuse = 0.9 + Math.random() * 0.5; s.col = FW_COLS[(Math.random() * FW_COLS.length) | 0]; s.col2 = FW_COLS[(Math.random() * FW_COLS.length) | 0]; s.kind = (Math.random() * 3) | 0;
      try { TP.audio.sfx('whoosh', { volume: 0.25 }); } catch (e) {}
      return;
    }
  }
  function burstShell(s) {
    var n = low() ? 50 : 110, FX = TP.fx, sp = s.kind === 1 ? 9 : 13;
    for (var i = 0; i < n; i++) {
      var u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = Math.sqrt(1 - u * u), k = s.kind === 2 ? 1 : (0.85 + Math.random() * 0.15);
      FX.emit('firework', s.x, s.y, s.z, Math.cos(a) * r * sp * k, u * sp * k + 1.5, Math.sin(a) * r * sp * k, 1 + Math.random() * 0.5, 1, i % 3 === 0 ? s.col2 : s.col);
    }
    FX.emit('glow', s.x, s.y, s.z, 0, 0, 0, 9, 3);
    try { TP.audio.sfx('thud', { volume: 0.55 }); TP.audio.sfx('pop', { volume: 0.25 }); } catch (e) {}
  }
  TP.onFrame(function (dt, realDt) {
    var vs = TP.venueState; if (!vs || !TP.fx) return;
    var night = vs.def && vs.def.fireworks;
    if (night && !(TP.r3 && TP.r3.pull) && TP.ui && TP.ui.current === 'menu') { FW.ambientT -= realDt; if (FW.ambientT <= 0) { FW.ambientT = 4 + Math.random() * 6; FW.queue += 1 + ((Math.random() * 3) | 0); } }
    if (FW.queue > 0) { FW.qT -= realDt; if (FW.qT <= 0) { FW.queue--; FW.qT = 0.18 + Math.random() * 0.3; launchShell(); } }
    var d = Math.max(dt, realDt * 0.5);
    for (var i = 0; i < FW.shells.length; i++) {
      var s = FW.shells[i]; if (!s.on) continue;
      s.y += s.vy * d; s.vy -= 9.8 * d * 0.7; s.fuse -= d;
      if (Math.random() < 0.8) TP.fx.emit('ember', s.x, s.y, s.z, (Math.random() - 0.5) * 0.4, -1, (Math.random() - 0.5) * 0.4, 0.8, 1);
      if (s.fuse <= 0) { s.on = false; burstShell(s); }
    }
  });

  /* ---------------------------------------------------------------------------
   * 15. CAMERAS — smooth side tracking with lead + zoom, heli, wheel cam, director
   * ------------------------------------------------------------------------- */
  var SIDE = { lead: 0, far: 0 };
  var DIR = { on: false, t: 0, phase: '', last: '' };
  function setupCameras() {
    var CAM = TP.cam; if (!CAM || !CAM.presets) return;
    var origSide = CAM.presets.side;
    CAM.presets.side = function (r, P, L) {
      var p = TP.activePull ? TP.activePull() : null;
      if (!p) { SIDE.lead = 0; SIDE.far = 0; return origSide(r, P, L); }
      var spd = p.speed || 0, dt = Math.min(0.05, TP.realDt || 0.016), k = 1 - Math.exp(-2.4 * dt);
      SIDE.lead += (clamp(spd * 0.32, 0, 2.2) - SIDE.lead) * k;
      SIDE.far += (clamp(spd * 0.55 + p.hop * 1.5, 0, 5) - SIDE.far) * k;
      var por = TP.portrait, cx = r.x - (por ? 4.2 : 2.8) + SIDE.lead, far = (por ? 23 : 13.5) + SIDE.far * (por ? 1.6 : 1);
      P.set(cx - 1.2 - SIDE.lead * 0.6, (por ? 5.5 : 2.8) + SIDE.far * 0.22 + r.lift * 2, far + r.z * 0.6);
      L.set(cx, (por ? 2.2 : 1.3) + r.lift * 1.5, r.z * 0.6);
    };
    CAM.presets.heli = function (r, P, L) { var t = TP.time * 0.12; P.set(r.x - 16 + Math.sin(t) * 6, 17 + Math.sin(t * 1.7) * 1.5, 22 + Math.cos(t) * 4); L.set(r.x + 3, 0.5, r.z); };
    CAM.presets.wheel = function (r, P, L) { P.set(r.x - 2.4, 0.42, r.z + 2.9); L.set(r.x + 4, 0.9 + r.lift * 3, r.z - 0.2); };
    CAM.presets.tower = function (r, P, L) { var lh = TP.venueState ? TP.venueState.track.laneHalf : 4.6; P.set(r.sledX - 8, 6.5, -(lh + 9)); L.set(r.x + 2, 1, r.z); };
    ['heli', 'wheel'].forEach(function (m) { if (CAM.order.indexOf(m) < 0) CAM.order.push(m); });
    CAM.names.heli = 'Helicopter'; CAM.names.wheel = 'Wheel cam'; CAM.names.tower = 'Tower';
  }
  function dirCut(mode, t) { if (!TP.cam || !TP.cam.presets[mode]) return; TP.cam.set(mode); DIR.last = mode; DIR.t = t; }
  TP.onFrame(function (dt, realDt) {
    if (!DIR.on) return;
    var S = TP.r3 && TP.r3.pull, CAM = TP.cam; if (!S || !CAM) { DIR.on = false; return; }
    if (CAM.mode === 'orbit') return;
    var p = S.p, ff = S.ff || 1;
    if (p.done) { if (DIR.phase !== 'end') { DIR.phase = 'end'; if (p.status !== 'fullPull') dirCut(p.broken ? 'chase' : 'side', 99); } return; }
    if (p.status === 'staged') return;
    var prog = p.dist / Math.max(1, p.trackLength);
    if (DIR.phase !== 'sled' && DIR.phase !== 'launch' && p.status === 'pulling' && (prog > 0.8 || p.sledBoxPos > 0.85)) { DIR.phase = 'sled'; dirCut(Math.random() < 0.65 ? 'sled' : 'tower', 99); return; }
    DIR.t -= realDt * Math.min(ff, 2);
    if (DIR.t <= 0) {
      if (DIR.phase === 'sled') { dirCut('side', 99); return; }
      DIR.phase = 'mid';
      var pool = ['side', 'side', 'chase', 'heli', 'wheel', 'front', 'crowd', 'onboard', 'side'];
      var next = pool[(Math.random() * pool.length) | 0]; if (next === DIR.last) next = 'side';
      dirCut(next, next === 'side' ? 3.2 + Math.random() * 1.5 : 2.0 + Math.random() * 1.3);
    }
  });

  /* ---------------------------------------------------------------------------
   * 16. AUDIO LAYERS — exhaust roar, V8 lope, methanol scream, tire spin, sled scrape, PA babble
   * ------------------------------------------------------------------------- */
  var AUX = { v: null, frame: 0 };
  function auxVoice(engine) {
    var AU = TP.audio; if (!AU || !AU.ready || !AU.ctx || !AU.noise) return null;
    try {
      var ctx = AU.ctx, type = (engine && engine.type) || 'diesel', srcs = [];
      var out = ctx.createGain(); out.gain.value = 0.9; out.connect(AU.master);
      var noise = function () { var s = ctx.createBufferSource(); s.buffer = AU.noise; s.loop = true; s.loopStart = Math.random(); srcs.push(s); return s; };
      var mk = function (src, ftype, f, q, g) { var flt = ctx.createBiquadFilter(); flt.type = ftype; flt.frequency.value = f; flt.Q.value = q || 0.7; var gg = ctx.createGain(); gg.gain.value = g || 0; src.connect(flt); flt.connect(gg); gg.connect(out); return { f: flt, g: gg }; };
      var roar = mk(noise(), 'lowpass', 300, 1.2, 0);
      var tire = mk(noise(), 'bandpass', 1300, 0.8, 0);
      var scrape = mk(noise(), 'lowpass', 220, 2, 0);
      var grit = mk(noise(), 'bandpass', 3200, 1.5, 0);
      var lope = null, scream = null;
      if (type === 'gas' || type === 'multi') {
        var o = ctx.createOscillator(); o.type = 'square'; var og = ctx.createGain(); og.gain.value = 0; var lfo = ctx.createOscillator(); lfo.type = 'sine'; var lg = ctx.createGain(); lg.gain.value = 0;
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
        o.connect(lp); lp.connect(og); og.connect(out); lfo.connect(lg); lg.connect(og.gain); o.start(); lfo.start(); srcs.push(o, lfo);
        lope = { o: o, g: og, lfo: lfo, lg: lg };
      }
      if (type === 'methanol' || type === 'multi' || (engine && engine.blower)) {
        var so = ctx.createOscillator(); so.type = 'sawtooth'; var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400; var sg = ctx.createGain(); sg.gain.value = 0;
        so.connect(hp); hp.connect(sg); sg.connect(out); so.start(); srcs.push(so);
        scream = { o: so, g: sg };
      }
      srcs.forEach(function (s) { try { if (s.buffer) s.start(); } catch (e) {} });
      var cyl = (engine && engine.cyl) || 8, cnt = (engine && engine.count) || 1;
      return {
        update: function (p) {
          var t = ctx.currentTime, st = p.stats, rpmN = clamp(p.rpm / st.redline, 0, 1.1), thr = p.broken ? 0 : p.throttle;
          var slipV = Math.max(0, p.w - p.speed);
          roar.g.gain.setTargetAtTime((0.05 + 0.32 * thr * (0.4 + rpmN)) * (type === 'turbine' ? 0.4 : 1) * Math.min(1.6, Math.sqrt(cnt)), t, 0.06);
          roar.f.frequency.setTargetAtTime(160 + 900 * rpmN * (0.5 + thr * 0.5), t, 0.06);
          tire.g.gain.setTargetAtTime(clamp(slipV * 0.035, 0, 0.22), t, 0.08);
          tire.f.frequency.setTargetAtTime(700 + slipV * 120, t, 0.1);
          var sc = p.chainTaut ? clamp((p.dig * 0.5 + p.sledBoxPos * 0.4) * Math.min(1, p.speed / 3), 0, 1) : 0;
          scrape.g.gain.setTargetAtTime(sc * 0.5, t, 0.1); grit.g.gain.setTargetAtTime(sc * 0.06, t, 0.1);
          var fire = (500 + 6000 * rpmN) / 60 * cyl / 2 / 8;
          if (lope) { lope.o.frequency.setTargetAtTime(Math.max(18, fire * 0.5), t, 0.04); var lw = clamp(1 - rpmN * 1.6, 0, 1); lope.g.gain.setTargetAtTime(0.05 + 0.08 * lw, t, 0.06); lope.lg.gain.setTargetAtTime(0.09 * lw, t, 0.06); lope.lfo.frequency.setTargetAtTime(4 + rpmN * 6, t, 0.1); }
          if (scream) { scream.o.frequency.setTargetAtTime(400 + 2600 * rpmN, t, 0.04); scream.g.gain.setTargetAtTime(0.06 * Math.pow(rpmN, 3) * thr, t, 0.05); }
        },
        stop: function () {
          try { out.gain.setTargetAtTime(0, ctx.currentTime, 0.1); } catch (e) {}
          setTimeout(function () { srcs.forEach(function (s) { try { s.stop(); } catch (e) {} }); try { out.disconnect(); } catch (e) {} }, 500);
        }
      };
    } catch (e) { warn(e); return null; }
  }
  function stopAux() { if (AUX.v) { try { AUX.v.stop(); } catch (e) {} AUX.v = null; } }
  /** Muffled PA "voice": a few formant syllables, very quiet, when the announcer talks. */
  var paT = 0;
  function paBabble(text, pr) {
    var AU = TP.audio; if (!AU || !AU.ready || !AU.ctx) return;
    var now = AU.ctx.currentTime; if (now < paT) return;
    try {
      var ctx = AU.ctx, n = clamp(Math.round(text.length / 7), 3, 9), g = ctx.createGain(), bp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.4; hp.type = 'highpass'; hp.frequency.value = 350;
      g.gain.value = 0; bp.connect(hp); hp.connect(g); g.connect(AU.master);
      var o = ctx.createOscillator(); o.type = 'sawtooth'; o.connect(bp);
      var t = now + 0.05, base = 125 + Math.random() * 40, vol = 0.05 + (pr || 0) * 0.015;
      for (var i = 0; i < n; i++) {
        var d = 0.09 + Math.random() * 0.1;
        o.frequency.setValueAtTime(base * (1 + (Math.random() - 0.3) * 0.25 + (pr >= 2 ? 0.2 : 0)), t);
        bp.frequency.setValueAtTime(700 + Math.random() * 1300, t);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.linearRampToValueAtTime(0.0001, t + d);
        t += d + 0.03 + Math.random() * 0.04;
      }
      o.start(now); o.stop(t + 0.1);
      paT = t;
      setTimeout(function () { try { g.disconnect(); } catch (e) {} }, (t - now + 0.4) * 1000);
    } catch (e) {}
  }

  /* ---------------------------------------------------------------------------
   * 17. ANNOUNCER — varied hype lines
   * ------------------------------------------------------------------------- */
  var LINES = {
    launch_perfect: ['WHAT A HOLESHOT! {Who} left like a scalded cat!', 'Perfect launch! {Who} had that green light memorized!', 'Off the line like a rocket! Somebody check the tree, I think {who} beat it!', 'Hooked and booked! Textbook start by {who}!', 'That launch was smoother than Grandma\'s gravy!'],
    launch_good: ['Good start for {who}!', 'Nice clean hook, {who} is on the move!', 'Solid launch — now let\'s see the horsepower!', 'Here we go! {Who} digs in!'],
    launch_late: ['A little sleepy on the green, {who}!', 'Late on the tree — gotta make it up with horsepower now!', 'Was {who} checking the funnel cake line? Late start!'],
    launch_early: ['Jumped the light! Easy there, {who}!', 'Whoa! {Who} jumped the gun — the sled noticed!', 'Little anxious on the pedal there!'],
    hop: ['Bouncing like a bronco at the rodeo!', 'Hang on, {who}! She\'s HOPPING!', 'Wheel hop! Feather it, feather it!', 'That front end is doing the cha-cha!', 'Somebody hold that hood down!'],
    wheelie: ['FRONT WHEELS IN THE AIR! Look at that!', 'Wheels up! {Who} is flying the flag!', 'Pointing at the moon! What a wheelstand!', 'That\'s a two-wheel tractor now, folks!'],
    boundary: ['Watch that line, {who}!', 'Close to the chalk! Steer it, steer it!', 'Drifting! Keep it between the lines!', 'Careful — the line judge is awake today!'],
    leader: ['{Who} is PAST the leader\'s mark!', 'NEW LEADER on the move! {Who} rolls past the mark!', 'Past the flag and still pulling! The crowd is on its feet!', 'That\'s past the number to beat, y\'all!'],
    boost: ['Hit the button! Here comes the juice!', 'Shot of boost! Hang on to your hats!', 'Squeeze! {Who} just went to the bottle!'],
    full: ['FULL PULL! FULL PULL! Listen to this crowd!', 'ALL THE WAY TO THE END! {Who} drags it home!', 'That sled never stood a chance! FULL PULL!', 'Lock the gates — {who} just went the distance!', 'FULL PULL! Somebody fetch more weight!'],
    boom: ['KABOOM! That engine just went to the big barn in the sky!', 'Well, there go the pistons — and a few of them came our way!', 'That\'s what we call a cartoon ending, folks! Everybody\'s OK!', 'Oil-down, fire-out, and one LOUD bang! Track crew to the rescue!'],
    dq: ['Over the line — that\'s a disqualification!', 'Out of bounds! The flagman says no dice!', 'Aww, crossed the chalk. Rules are rules!'],
    record: ['NEW TRACK RECORD! Write it on the barn door!', 'That\'s the best we\'ve seen ALL DAY!', 'A new mark to beat! {Who} sets the pace!'],
    near: ['Is this gonna be a FULL PULL?!', 'Two-fifty and still digging!', 'The sled is pushing hard but {who} isn\'t quitting!', 'Get up, get up, GET UP!'],
    stop: ['And it bogs down — the sled wins this round.', 'That\'s where she stops! Measuring now...', 'Out of steam! Good effort from {who}.'],
    intro: ['Strap in, folks — this one\'s got horsepower to spare.', 'Get your earplugs ready, it\'s about to get loud.', 'Funnel cakes down, phones up — here we go!', 'The track crew says the dirt is just right.']
  };
  var ANN = { t: 0, lastKey: '', state: null };
  function who(p) {
    if (!p) return 'this driver';
    if (p.player) return pick(['you', 'our challenger', 'the home-town hero', 'you']);
    var d = p.driverId && TP.drivers[p.driverId];
    if (d && d.nickname && Math.random() < 0.6) return '"' + d.nickname + '"';
    return (p.name || 'this driver').split(' ')[0];
  }
  function say(key, p, pr, force) {
    try {
      var list = LINES[key]; if (!list || !TP.ui || !TP.ui.announcer) return;
      var now = TP.time; pr = pr || 0;
      if (!force && pr < 2 && now - ANN.t < 1.6) return;
      ANN.t = now; ANN.lastKey = key;
      var line = pick(list), w = who(p);
      line = line.replace(/\{Who\}/g, w.charAt(0).toUpperCase() + w.slice(1)).replace(/\{who\}/g, w);
      TP.ui.announcer(line, { priority: pr });
    } catch (e) { warn(e); }
  }
  VX.lines = LINES; VX.say = say;

  /* ---------------------------------------------------------------------------
   * 18. EVENT WIRING
   * ------------------------------------------------------------------------- */
  var PS = { best: 0, passed: false, wheelie: false, boundT: 0, near: false, cls: null, maxLift: 0 };
  TP.on('boot', function () {
    try { setupCameras(); } catch (e) { warn(e); }
    try { UPV = new THREE.Vector3(0, 1, 0); } catch (e) {}
    try {
      TP.ui.css([
        '#announcer.on{animation:vnAnnIn .28s cubic-bezier(.2,1.4,.4,1) both}',
        '@keyframes vnAnnIn{0%{transform:translateY(-8px) scale(.92);opacity:0}100%{transform:none;opacity:1}}'
      ].join('\n'));
    } catch (e) {}
  });
  TP.on('pullStart', function (p) {
    try {
      var S = TP.r3 && TP.r3.pull;
      PS.best = S && S.best || 0; PS.passed = !(PS.best > 0); PS.wheelie = false; PS.near = false; PS.boundT = 0; PS.maxLift = 0;
      EFX.lastThr = 0; EFX.billowAcc.length = 0; EFX.mudAcc = 0; EFX.sparkAcc = 0;
      RUT.rx = -1e9; RUT.fx = -1e9; RUT.sx = -1e9;
      var vs = TP.venueState;
      // a new class means the track crew worked the dirt
      if (PS.cls && p.classId !== PS.cls) VX.clearRuts();
      PS.cls = p.classId;
      if (vs && vs._lead) vs._lead.set(PS.best > 0 && PS.best < (p.trackLengthFt || 300) ? PS.best : 0);
      if (PREP.mesh) { PREP.active = false; PREP.mesh.visible = false; }
      HYPE.wave = -1;
      // director for spectated pulls
      if (!p.player && TP.cam) { TP.cam.director = false; DIR.on = true; DIR.phase = 'staged'; DIR.t = 99; DIR.last = 'side'; }
      else DIR.on = false;
      stopAux(); AUX.v = auxVoice(TP.vehicles[p.vehicleId] && TP.vehicles[p.vehicleId].engine);
      if (Math.random() < 0.35) setTimeout(function () { var a = TP.activePull(); if (a === p && a.status === 'staged') say('intro', p, 0); }, 2200);
    } catch (e) { warn(e); }
  });
  TP.on('launch', function (p, quality) {
    try {
      say('launch_' + quality, p, 1, true);
      if (quality === 'perfect') TP.cheer(0.5);
      if (TP.cam) TP.cam.shake = Math.max(TP.cam.shake, quality === 'perfect' ? 1.2 : 0.7);
      if (DIR.on) { DIR.phase = 'launch'; dirCut(Math.random() < 0.6 ? 'front' : 'wheel', 1.7); }
      if (p.classId === 'big_rig') try { TP.audio.sfx('horn', { volume: 0.6 }); } catch (e) {}
      HYPE.target = 0.4;
    } catch (e) { warn(e); }
  });
  TP.on('hop', function (p) { try { if (TP.cam) TP.cam.shake = Math.max(TP.cam.shake, 1.1); if (Math.random() < 0.5) say('hop', p, 1); TP.cheer(0.3); } catch (e) {} });
  TP.on('boost', function (p) { try { say('boost', p, 1); TP.cheer(0.35); var S = rigState(); if (S) S.rig.model.stacks.forEach(function (s) { s.getWorldPosition(V1 || (V1 = new THREE.Vector3())); TP.fx.burst('bigflame', V1.x, V1.y, V1.z, 10, { spread: 0.2, speed: 1.5, up: 6, sizeMul: 1.5 }); }); } catch (e) {} });
  TP.on('breakdown', function (p, part) { try { blowUpExtra(p); setTimeout(function () { say('boom', p, 3, true); }, 900); } catch (e) { warn(e); } });
  TP.on('outOfBounds', function (p) { try { if (Math.random() < 0.6) setTimeout(function () { say('dq', p, 2, true); }, 1500); } catch (e) {} });
  TP.on('fullPull', function (p) {
    try {
      var vs = TP.venueState;
      TP.cheer(1.3); VX.wave();
      if (vs && vs.def && vs.def.fireworks) VX.fireworks(low() ? 6 : 12);
      else { var S = rigState(); if (S) { S.rig.group.getWorldPosition(V1 || (V1 = new THREE.Vector3())); TP.fx.burst('confetti', V1.x - 6, 9, -(vs ? vs.track.laneHalf + 10 : 15), 80, { spread: 10, speed: 3, up: 0.5, colors: [0xffd23f, 0xff6a1a, 0x2565ae, 0xd23a2a, 0xf3efe6, 0x2e8b3d] }); } }
      setTimeout(function () { say('full', p, 3, true); }, 1300);
      HYPE.target = 1;
    } catch (e) { warn(e); }
  });
  TP.on('pullUpdate', function (p, simDt) {
    try {
      if (simDt > 0) pullEffects(p, simDt);
      var S = rigState();
      if (S) rutStep(p, S.rig);
      if (AUX.v && (AUX.frame++ & 1) === 0) AUX.v.update(p);
      if (p.done || p.status === 'staged') { if (p.done) HYPE.target = p.status === 'fullPull' ? 1 : 0.25; return; }
      var ft = p.dist / FT, len = p.trackLengthFt || 300;
      // hype / crowd noise swelling with the action
      var prog = ft / len;
      HYPE.target = clamp(0.2 + prog * 0.45 + p.sledBoxPos * 0.25 + (p.frontLift > 0.08 ? 0.2 : 0), 0, 1);
      try { var cs = (TP.venueState && TP.venueState.def.crowdSize) || 0.8; TP.audio.crowd(clamp((0.25 + HYPE.level * 0.6) * cs, 0, 1)); } catch (e) {}
      // wheelie
      PS.maxLift = Math.max(PS.maxLift, p.frontLift);
      if (!PS.wheelie && p.frontLift > Math.max(0.1, (p.stats.maxLift || 0.15) * 0.7)) { PS.wheelie = true; say('wheelie', p, 1); TP.cheer(0.5); }
      // near the boundary
      PS.boundT -= simDt;
      if (p.status === 'pulling' && p.laneHalf - p.halfWidth - Math.abs(p.lateral) < 0.45 && PS.boundT <= 0) { PS.boundT = 4; say('boundary', p, 1); }
      // passing the leader's mark
      if (!PS.passed && PS.best > 0 && ft >= PS.best) { PS.passed = true; say('leader', p, 2, true); TP.cheer(0.7); if (TP.cam) TP.cam.shake = Math.max(TP.cam.shake, 0.8); }
      if (!PS.near && prog > 0.84) { PS.near = true; if (PS.passed) say('near', p, 1); }
    } catch (e) { warn(e); }
  });
  TP.on('pullEnd', function (res) {
    try {
      stopAux(); DIR.on = false;
      if (res && res.player && res.newBest && !res.fullPull && !res.dq && res.distanceFt > 0) setTimeout(function () { say('record', { player: true }, 2, true); }, 200);
    } catch (e) {}
  });
  TP.on('menu', function () { PREP.pending = true; PREP.idleT = 0; stopAux(); DIR.on = false; HYPE.target = 0; });
  TP.on('eventEnd', function () { try { var vs = TP.venueState; if (vs && vs.def && vs.def.fireworks) VX.fireworks(10); TP.cheer(1); } catch (e) {} });
  TP.on('announce', function (text, pr) { try { if (TP.r3 && TP.r3.pull) paBabble(text, pr); } catch (e) {} });

  // crowd + glow uniforms, hype smoothing, stadium wave
  TP.onFrame(function (dt, realDt) {
    try {
      var vs = TP.venueState;
      HYPE.level += (HYPE.target - HYPE.level) * (1 - Math.exp(-1.5 * realDt));
      CROWD_U.uTime.value += realDt;
      CROWD_U.uCheer.value = clamp((vs ? vs.cheer : 0) * 0.9 + HYPE.level * 0.35, 0, 1.4);
      if (HYPE.wave >= 0 && vs) {
        HYPE.wave += realDt * 34; CROWD_U.uWave.value = HYPE.wave - 50; CROWD_U.uWaveAmt.value = 1;
        if (HYPE.wave > (HYPE.waveLen || 200)) { HYPE.wave = -1; CROWD_U.uWaveAmt.value = 0; }
      } else CROWD_U.uWaveAmt.value = 0;
      if (glowMats.length && TP.renderer && TP.camera) {
        var sc = TP.renderer.domElement.height / (2 * Math.tan(TP.camera.fov * Math.PI / 360));
        for (var i = glowMats.length - 1; i >= 0; i--) { var m = glowMats[i]; m.uniforms.scale.value = sc; m.uniforms.uTime.value = CROWD_U.uTime.value; }
      }
    } catch (e) { warn(e); }
  });
  // drop glow materials of unloaded venues
  TP.on('venueLoaded', function () {
    var keep = [];
    for (var i = 0; i < glowMats.length; i++) if (glowMats[i]._alive !== false) keep.push(glowMats[i]);
    glowMats.length = 0; Array.prototype.push.apply(glowMats, keep);
  });

  /* ---------------------------------------------------------------------------
   * 19. DEBUG
   * ------------------------------------------------------------------------- */
  try {
    var D = TP.debug || (TP.debug = {});
    D.venues = {
      list: function () { return Object.keys(TP.venues); },
      load: function (id) { return TP.loadVenue(id, { force: true }); },
      fireworks: function (n) { VX.fireworks(n || 10); },
      wave: function () { VX.wave(); },
      cheer: function (a) { TP.cheer(a == null ? 1.3 : a); },
      ruts: function () { var r = TP.venueState && TP.venueState._ruts; return r ? { tread: r.tread.filled, pan: r.pan.filled } : null; },
      prep: function () { PREP.pending = true; PREP.idleT = 2; },
      say: function (k) { say(k, TP.activePull() || { player: true }, 2, true); },
      blowUp: function () { var p = TP.activePull(); if (p) blowUpExtra(p); },
      crowd: function () { return TP.venueState ? TP.venueState.crowdCount || 0 : 0; }
    };
  } catch (e) {}
})();
