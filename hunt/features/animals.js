/* =====================================================================
 * Wildwood Hunter — features/animals.js  (HOOFED GAME)
 * Whitetail (age classes), mule deer, black-tailed deer, Rocky Mountain + Roosevelt elk, moose, caribou,
 * pronghorn, bighorn sheep, mountain goat, plains bison, musk ox + six named legendaries.
 *
 *  - Models: one parametric ungulate builder (anatomy params -> HG.gfx.quadruped spec) + species coats,
 *    antler/horn generators per age class, hair attachments (bell, beards), shaggy displacement, LOD.
 *  - Behaviour (def.update augments core AI): hit reactions per zone (a.hitReaction, 'animals:hitReaction'),
 *    bleed-out, rut calls + sparring + ram clashes, bedding, drinking, alert stomps, cliff fleeing,
 *    caribou migration, bison stampedes, musk-ox defensive circle, elk harems.
 *  - Legendaries (one per map, aura, banner), trophy scoring (antler/horn inches), codex facts,
 *    synthesized calls, call gear in the shop.
 * Public: HG.ww = {species, buildSpec, reactions, spawnLegendary, ...}; HG.debug.ww = {...}.
 * ===================================================================== */
(function () {
  'use strict';
  var HG = window.HG;
  if (!HG || !window.THREE || !HG.gfx) return;
  var G = HG.gfx, TX = G.tex, U = HG.util, DEG = Math.PI / 180, TAU = Math.PI * 2;
  var sm = U.smooth, clamp = U.clamp;
  var WW = HG.ww = { species: {}, legendaries: {}, version: 1 };

  /* ------------------------------------------------------------------
   * 1. Parametric ungulate anatomy -> HG.gfx.quadruped spec
   *    Base numbers are a mature whitetail buck (metres); species params scale/reshape them.
   * ------------------------------------------------------------------ */
  var BASE = {
    // torso: [y, z, w, hUp, hDown, bone]  (tail end first)
    torso: [[0.84, 0.67, 0.13, 0.07, 0.10], [0.83, 0.56, 0.27, 0.12, 0.19, 'pelvis'], [0.815, 0.36, 0.32, 0.145, 0.2], [0.8, 0.12, 0.34, 0.16, 0.215, 'spine'],
      [0.805, -0.12, 0.34, 0.185, 0.26], [0.82, -0.3, 0.31, 0.195, 0.265, 'chest'], [0.86, -0.44, 0.25, 0.16, 0.23]],
    // neck relative to the last torso section: [up, forward, w, hUp, hDown, bone] (last = poll)
    neck: [[0.10, 0.11, 0.2, 0.11, 0.18, 'neck1'], [0.22, 0.19, 0.16, 0.08, 0.125], [0.34, 0.26, 0.135, 0.068, 0.095, 'neck2'], [0.44, 0.32, 0.11, 0.06, 0.072], [0.48, 0.34, 0.1, 0.055, 0.06]],
    // head along its axis from the poll: [t, up, w, hUp, hDown]
    head: [[-0.045, 0.01, 0.085, 0.05, 0.05], [0.01, 0.012, 0.12, 0.062, 0.07], [0.07, 0.008, 0.13, 0.06, 0.068], [0.13, 0, 0.1, 0.047, 0.06], [0.19, -0.006, 0.074, 0.038, 0.05],
      [0.245, -0.01, 0.062, 0.033, 0.043], [0.285, -0.012, 0.058, 0.03, 0.037], [0.305, -0.012, 0.04, 0.02, 0.025]],
    // legs: [x, y, z, rx, rz]
    FR: [[0.1, 0.86, -0.34, 0.06, 0.06], [0.12, 0.72, -0.4, 0.07, 0.1], [0.115, 0.55, -0.35, 0.05, 0.064], [0.104, 0.3, -0.36, 0.028, 0.036], [0.1, 0.085, -0.37, 0.02, 0.025], [0.1, 0.02, -0.395, 0.019, 0.024]],
    BR: [[0.09, 0.86, 0.48, 0.08, 0.08], [0.12, 0.76, 0.46, 0.095, 0.14], [0.125, 0.6, 0.37, 0.07, 0.1], [0.105, 0.44, 0.5, 0.03, 0.05], [0.1, 0.1, 0.47, 0.021, 0.028], [0.1, 0.02, 0.445, 0.019, 0.024]]
  };
  var HUMP = [0, 0, 0, 0.2, 0.65, 1, 0.9];
  var DEF_P = {
    S: 1, legK: 1, lenK: 1, wideK: 1.06, depthK: 1, upK: 1, hump: 0, rumpDrop: 0, chestW: 1, hipW: 1, chestD: 1,
    neckLen: 1, neckW: 1, neckAngle: 54.7, neckDrop: 0, maneUp: 0, maneDown: 0, maneW: 0,
    headLen: 1, headW: 1, headH: 1, headPitch: -38.3, muzzle: 1, muzzleLen: 1, lipDrop: 1, roman: 0, eyeK: 1,
    legW: 1.1, upperLegW: 1.05, hoofK: 1, earLen: 1, earW: 1, earCup: 0.42, earTip: 0.55, earRot: [0.25, 0.25, -0.95], earY: 0.035,
    tailLen: 1, tailW: 1, tailH: 1, tailDroop: 1.3, tailBushy: false
  };
  var DEF_C = {
    coat: '#86684b', back: '#5f4731', belly: '#f1ece3', white: '#f1ece3', leg: '#9c7f60', legLow: '#4a3828', face: '#5d4632', muzzle: '#9a826a',
    nose: '#161212', hoof: '#1c1713', earIn: '#efe6da', earOut: '#7e6650', earTip: '#3c2e22', headBase: null,
    backK: 1, bellyK: 1, faceK: 0.75, muzzleK: 0.5, noseK: 1, throat: 1, eyeRing: 0.8, muzzleBand: 0.9, chinWhite: 0.9,
    rump: { color: '#f1ece3', k: 0.7, size: 0.6, top: 0, edge: null }, tailTop: '#62492f', tailUnder: '#f1ece3', tailUnderK: 1, tailTip: null, tailEdge: '#3d2b1c',
    neck: null, neckK: 0, mane: null, maneK: 0, fore: null, foreK: 0, saddle: null, saddleK: 0, legInner: 0.65, legBack: 0, legLowK: 0.55, stripe: 0, stripeColor: null,
    cheek: 0, cheekColor: '#151110', bands: 0, sideWhite: 0, sock: 0, faceWhite: 0, mask: 0, maskColor: '#2b2119', gland: 0.6, neckStripe: 0
  };
  function mix(base, over) { var o = {}, k; for (k in base) o[k] = base[k]; if (over) for (k in over) o[k] = over[k]; return o; }
  function band(v, c, w) { return sm(c - w, c - w * 0.35, v) * sm(c + w, c + w * 0.35, v); }

  /** Build a quadruped spec + anchors from anatomy params P and coat C. */
  function buildSpec(key, P, C) {
    P = mix(DEF_P, P); C = mix(DEF_C, C);
    var raise = (P.legK - 1) * 0.58, spine = [], i;
    BASE.torso.forEach(function (s, i) {
      var fz = clamp((s[1] - 0.05) / 0.62, 0, 1), fw = i >= 4 ? P.chestW : (i <= 2 ? P.hipW : (P.chestW + P.hipW) / 2);
      var sec = { p: [0, s[0] + raise - P.rumpDrop * fz + P.hump * HUMP[i] * 0.3, s[1] * P.lenK], w: s[2] * P.wideK * fw, hUp: s[3] * P.upK + P.hump * HUMP[i] * 0.7, hDown: s[4] * P.depthK * (i >= 3 ? P.chestD : 1) };
      if (s[5]) sec.bone = s[5];
      spine.push(sec);
    });
    var nb = spine[6].p, a0 = Math.atan2(0.48, 0.34), dA = P.neckAngle * DEG - a0, ca = Math.cos(dA), sa = Math.sin(dA);
    BASE.neck.forEach(function (s, i) {
      var fw = (s[1] * ca - s[0] * sa) * P.neckLen, up = (s[1] * sa + s[0] * ca) * P.neckLen, mane = Math.sin(Math.PI * Math.min(1, (i + 0.6) / 4.6));
      var sec = { p: [0, nb[1] + up - P.neckDrop * (1 - i / 5), nb[2] - fw], w: s[2] * P.neckW * (1 + P.maneW * mane), hUp: s[3] * P.neckW * (1 + P.maneUp * mane), hDown: s[4] * P.neckW * (1 + P.maneDown * mane) };
      if (s[5]) sec.bone = s[5];
      spine.push(sec);
    });
    var poll = spine[spine.length - 1].p.slice();
    var hp = P.headPitch * DEG, dir = [0, Math.sin(hp), -Math.cos(hp)], perp = [0, Math.cos(hp), Math.sin(hp)];
    function tAt(t0) { return t0 <= 0.13 ? t0 * P.headLen : 0.13 * P.headLen + (t0 - 0.13) * P.headLen * P.muzzleLen; }
    function hpos(t0, up) { var t = tAt(t0); return [0, poll[1] + dir[1] * t + perp[1] * up, poll[2] + dir[2] * t + perp[2] * up]; }
    var head = BASE.head.map(function (s, i) {
      var m = i >= 4 ? P.muzzle : 1, rom = P.roman * Math.sin(Math.PI * clamp((i - 1) / 5, 0, 1));
      return { p: hpos(s[0], s[1] * P.headH + rom), w: s[2] * P.headW * m, hUp: s[3] * P.headH * m, hDown: s[4] * P.headH * m * (i >= 4 ? P.lipDrop : 1) };
    });
    function legT(L, rear) {
      return L.map(function (j, i) {
        var x = j[0] * P.wideK * (rear ? P.hipW : P.chestW), y, z = j[2] * P.lenK;
        if (i <= 1) { var fz = rear ? clamp((j[2] - 0.05) / 0.62, 0, 1) : 0; y = j[1] + raise - P.rumpDrop * fz; }
        else y = j[1] * P.legK;
        var k = i <= 1 ? P.wideK * Math.sqrt(P.legW) * P.upperLegW : (i === 2 ? P.legW * P.upperLegW : P.legW);
        if (i === 0) return { p: [x, y, z], r: j[3] * k };
        return { p: [x, y, z], rx: j[3] * k, rz: j[4] * k };
      });
    }
    var FR = legT(BASE.FR, false), BR = legT(BASE.BR, true);
    var tail0 = spine[0];
    var spec = {
      key: key, spine: spine, head: head, legs: { FR: FR, BR: BR },
      hoof: { w: 0.046 * P.legW * P.hoofK, l: 0.062 * P.legW * P.hoofK, h: 0.05 * P.legW * Math.sqrt(P.hoofK) },
      ears: { p: [0.05 * P.headW, poll[1] + P.earY * P.headH, poll[2] + 0.01], len: 0.16 * P.earLen, width: 0.085 * P.earW, cup: P.earCup, tip: P.earTip, rot: P.earRot },
      tail: { p: [0, tail0.p[1] + 0.04 * P.upK, tail0.p[2] - 0.01], len: 0.24 * P.tailLen, w: 0.105 * P.tailW, h: 0.04 * P.tailH, droop: P.tailDroop, bushy: P.tailBushy },
      eyes: { p: [0.058 * P.headW, 0, 0], r: 0.017 * P.eyeK, rot: 0.5, color: '#120c08' },
      nose: { p: hpos(0.302, -0.006), r: 0.022 * P.muzzle, sx: 1.2, sy: 0.75, sz: 0.65, color: C.nose }
    };
    var ep = hpos(0.07, 0.028 * P.headH); spec.eyes.p[1] = ep[1]; spec.eyes.p[2] = ep[2];
    // ---- scale everything by S ----
    var S = P.S;
    function sp(p) { return [p[0] * S, p[1] * S, p[2] * S]; }
    spec.spine.concat(spec.head).forEach(function (s) { s.p = sp(s.p); s.w *= S; s.hUp *= S; s.hDown *= S; });
    [FR, BR].forEach(function (L) { L.forEach(function (j) { j.p = sp(j.p); if (j.r != null) j.r *= S; if (j.rx != null) { j.rx *= S; j.rz *= S; } }); });
    spec.hoof.w *= S; spec.hoof.l *= S; spec.hoof.h *= S;
    spec.ears.p = sp(spec.ears.p); spec.ears.len *= S; spec.ears.width *= S;
    spec.tail.p = sp(spec.tail.p); spec.tail.len *= S; spec.tail.w *= S; spec.tail.h *= S;
    spec.eyes.p = sp(spec.eyes.p); spec.eyes.r *= S; spec.nose.p = sp(spec.nose.p); spec.nose.r *= S;
    var A = {
      S: S, P: P, poll: sp(poll), dir: dir, perp: perp, tEnd: tAt(0.305) * S, tAt: function (t0) { return tAt(t0) * S; },
      hpos: function (t0, up) { return sp(hpos(t0, up)); },
      zR: spine[0].p[2], zP: spine[1].p[2], zS: spine[3].p[2], zC: spine[5].p[2], zCF: spine[6].p[2],
      yC: spine[3].p[1], belly: spine[4].p[1] - spine[4].hDown, back: spine[5].p[1] + spine[5].hUp,
      yElbow: FR[2].p[1], legLowY: FR[3].p[1], tailZ: spec.tail.p[2], tailY: spec.tail.p[1], tailLen: spec.tail.len,
      eye: spec.eyes.p, headHalfW: head[1].w / 2, neck1: spine[7].p, neck2: spine[9].p, chest: spine[5], spineMid: spine[3], pelvis: spine[1],
      FR: FR, BR: BR
    };
    spec.coat = coatFn(C, A);
    spec.anchors = A;
    return spec;
  }

  /** Coat painter (part-aware vertex colours, multiplied by the shared fur detail texture). */
  function coatFn(C, A) {
    var X = new THREE.Color(), Y = new THREE.Color(), S = A.S;
    return function (c, x, y, z, nx, ny, nz, part, u, v) {
      if (part === 'hoof') return c.set(C.hoof);
      if (part === 'ear') {
        if (u > 0.5) { X.set(C.earIn).lerp(Y.set(C.earOut), sm(0.72, 1, v) * 0.6); return c.copy(X); }
        X.set(C.earOut).lerp(Y.set(C.earTip), sm(0.76, 1, v)); return c.copy(X);
      }
      if (part === 'tail') {
        var tt = Math.sqrt((z - A.tailZ) * (z - A.tailZ) + (y - A.tailY) * (y - A.tailY)) / Math.max(1e-3, A.tailLen);
        X.set(C.tailTop).lerp(Y.set(C.tailUnder), sm(0.15, -0.45, ny) * C.tailUnderK);
        if (C.tailEdge) X.lerp(Y.set(C.tailEdge), sm(0.65, 0.95, Math.abs(nx)) * 0.45 * (1 - sm(0.15, -0.45, ny)));
        if (C.tailTip) X.lerp(Y.set(C.tailTip), sm(0.55, 0.8, tt));
        return c.copy(X);
      }
      X.set(C.coat).lerp(Y.set(C.back), sm(0.3, 0.95, ny) * C.backK);
      if (part === 'body') {
        var neckF = sm(A.zCF + 0.05 * S, A.zCF - 0.14 * S, z), torsoF = 1 - neckF;
        if (C.fore) X.lerp(Y.set(C.fore), sm(A.zS + 0.05 * S, A.zC + 0.02 * S, z) * C.foreK);
        if (C.neck) X.lerp(Y.set(C.neck), neckF * C.neckK);
        if (C.saddle) X.lerp(Y.set(C.saddle), sm(0.35, 0.8, ny) * sm(A.zC, A.zS, z) * sm(A.zP + 0.05 * S, A.zS, z) * C.saddleK);
        X.lerp(Y.set(C.belly), sm(-0.3, -0.75, ny) * torsoF * C.bellyK * sm(A.zR, A.zP, z));
        if (C.sideWhite) X.lerp(Y.set(C.white), sm(0.0, -0.25, ny + 0.05 * Math.sin(z * 9 / S)) * torsoF * C.sideWhite);
        if (C.stripe) X.lerp(Y.set(C.stripeColor || C.back), sm(0.86, 0.97, ny) * C.stripe * torsoF);
        if (C.rump && C.rump.k) {
          var r = C.rump, rz = sm(A.zP - (0.04 + 0.16 * r.size) * S, A.zR - 0.03 * S, z) * sm(-0.25, 0.3, nz + r.top * ny) * sm(-0.95, -0.4, ny - r.top * 0.5);
          if (r.edge) X.lerp(Y.set(r.edge), band(rz, 0.35, 0.22) * 0.7);
          X.lerp(Y.set(r.color), sm(0.4, 0.75, rz) * r.k);
        }
        if (C.mane) X.lerp(Y.set(C.mane), neckF * sm(0.3, -0.35, ny) * C.maneK);
        if (C.neckStripe) X.lerp(Y.set(C.cheekColor), neckF * sm(0.55, 0.85, ny) * C.neckStripe);
        if (C.throat) { var nh = sm(A.poll[1] - 0.32 * S, A.poll[1] - 0.12 * S, y); X.lerp(Y.set(C.white), C.throat * nh * neckF * sm(0.05, 0.5, -nz * 0.6 - ny * 0.6)); }
        if (C.bands) {
          var ns = clamp((A.zCF - z) / Math.max(1e-3, A.zCF - A.poll[2]), 0, 1), fr = sm(0.0, 0.55, -nz * 0.5 - ny * 0.7);
          X.lerp(Y.set(C.white), (band(ns, 0.45, 0.1) + band(ns, 0.78, 0.09)) * fr * C.bands);
        }
      } else if (part === 'head') {
        var dy = y - A.poll[1], dz = z - A.poll[2], t = (dy * A.dir[1] + dz * A.dir[2]) / A.tEnd;
        if (C.headBase) X.set(C.headBase).lerp(Y.set(C.back), sm(0.5, 0.95, ny) * 0.4);
        X.lerp(Y.set(C.face), sm(-0.15, 0.6, ny) * sm(-0.1, 0.35, t) * C.faceK);
        if (C.mask) X.lerp(Y.set(C.maskColor), sm(0.1, 0.4, t) * C.mask * sm(-0.4, 0.2, ny + 0.3));
        X.lerp(Y.set(C.muzzle), sm(0.5, 0.8, t) * C.muzzleK);
        if (C.faceWhite) X.lerp(Y.set(C.white), sm(0.55, 0.78, t) * C.faceWhite);
        if (C.muzzleBand) X.lerp(Y.set(C.white), band(t, 0.82, 0.06) * C.muzzleBand + sm(0.0, -0.7, ny) * sm(0.55, 0.85, t) * C.chinWhite);
        X.lerp(Y.set(C.nose), sm(0.9, 0.975, t) * sm(-0.6, 0.15, ny + 0.45) * C.noseK);
        if (C.eyeRing) { var ex = Math.abs(x) - A.eye[0], ey = y - A.eye[1], ez = z - A.eye[2], ed = Math.sqrt(ex * ex * 2 + ey * ey + ez * ez); X.lerp(Y.set(C.white), sm(0.035 * S, 0.018 * S, ed) * C.eyeRing); }
        if (C.cheek) X.lerp(Y.set(C.cheekColor), sm(0.45, 0.8, Math.abs(nx)) * band(t, 0.32, 0.14) * sm(0.03 * S, -0.03 * S, y - A.eye[1]) * C.cheek);
      } else {
        var front = part === 'legF';
        X.set(C.leg).lerp(Y.set(C.coat), sm(A.yElbow, A.yElbow + 0.2 * S, y) * 0.6);
        X.lerp(Y.set(C.legLow), sm(A.legLowY * 0.9, A.legLowY * 0.35, y) * C.legLowK);
        X.lerp(Y.set(C.white), sm(0.2, 0.8, -nx * (x > 0 ? 1 : -1)) * sm(A.yElbow * 1.25, A.yElbow * 0.8, y) * C.legInner);
        if (C.legBack) X.lerp(Y.set(C.white), sm(0.2, 0.75, front ? nz : -nz * 0.4 + nz) * sm(A.yElbow * 1.1, A.yElbow * 0.5, y) * C.legBack);
        if (!front && C.gland) X.lerp(Y.set('#4a3626'), sm(0.035 * S, 0.0, Math.abs(y - A.BR[3].p[1])) * sm(0.3, 0.8, nz) * C.gland);
        if (C.sock) X.lerp(Y.set(C.white), band(y, 0.11 * S, 0.05 * S) * C.sock);
        X.lerp(Y.set(C.legLow), sm(0.12 * S, 0.04 * S, y) * 0.5);
      }
      return c.copy(X);
    };
  }

  /* ------------------------------------------------------------------
   * 2. Geometry helpers: hair shells, shaggy displacement, attachments
   * ------------------------------------------------------------------ */
  function hash3(x, y, z) { var h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
  function vnoise(x, y, z) { return 0.5 + 0.5 * (U.noise2 ? U.noise2(x + z * 0.71, y - z * 0.37) : Math.sin(x * 1.7 + y * 2.3 + z)); }
  var _shOut = [0, 0];
  /** Displace template vertices (hi + lo LOD) along normals for shaggy coats. fn(x,y,z,nx,ny,nz,out) -> out[0] outward m, out[1] droop m */
  function shag(tpl, fn, freq) {
    if (tpl._wwShag) return; tpl._wwShag = true;
    freq = freq || 22;
    tpl.geos.forEach(function (g) {
      var p = g.attributes.position, n = g.attributes.normal;
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
        _shOut[0] = 0; _shOut[1] = 0; fn(x, y, z, nx, ny, nz, _shOut);
        if (_shOut[0] <= 0 && _shOut[1] <= 0) continue;
        var cl = vnoise(x * freq, y * freq, z * freq), fine = hash3(Math.round(x * 90), Math.round(y * 90), Math.round(z * 90));
        var k = 0.45 + 0.4 * cl + 0.15 * fine, d = _shOut[0] * k;
        p.setXYZ(i, x + nx * d, y + ny * d - _shOut[1] * (0.4 + 0.8 * cl * fine + 0.3 * cl), z + nz * d);
      }
      p.needsUpdate = true; g.computeBoundingSphere(); g.boundingSphere.radius *= 1.3;
    });
  }
  var _hairMats = {};
  function hairMat(spec) {
    var k = 'ww:hair:' + JSON.stringify(spec.fur || {});
    return G.mat({ map: TX.furDetail(spec.fur || {}), vertexColors: true, roughness: 0.92, key: k });
  }
  function antlerMat() { return G.mat({ map: TX.antler(), vertexColors: true, roughness: 0.55, key: 'antler' }); }
  function hornMat() { return G.mat({ map: TX.antler(), vertexColors: true, roughness: 0.42, key: 'ww:horn' }); }
  /** Hanging hair tassel (beard, bell): from point p0 down to p1 (model space), widths. Returns painted geometry. */
  function tassel(p0, p1, w0, d0, color, colorTip, radial) {
    var secs = [], n = 6;
    for (var i = 0; i <= n; i++) {
      var t = i / n, w = w0 * (1 - t * 0.65) * (0.85 + 0.3 * Math.sin(t * 3.1)), d = d0 * (1 - t * 0.55);
      secs.push({ p: [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t + Math.sin(t * Math.PI) * d0 * 0.4], rx: Math.max(0.003, w / 2), ry: Math.max(0.003, d / 2), sq: 2.2, n: [0, 0, -1] });
    }
    var g = G.loft(secs, { radial: radial || 10, steps: 2, frame: 'transport', density: 6, capBulge: 0.7, displace: function (v, t, th) { var j = hash3(Math.round(th * 5), 1, 2); if (t > 0.75) v.y -= (j - 0.3) * w0 * 0.6 * (t - 0.75) * 4; } });
    var A = new THREE.Color(), B = new THREE.Color(colorTip || color);
    G.paint(g, function (c, x, y) { var t = clamp((p0[1] - y) / Math.max(1e-3, p0[1] - p1[1]), 0, 1); return c.copy(A.set(color)).lerp(B, t * 0.6); });
    return g;
  }
  /** Attach geometry (MODEL space, cached per key) rigidly to a bone of a spawned quadruped. */
  var _attCache = {};
  function attach(parts, tpl, bone, key, buildFn, mat, castShadow) {
    var ck = tpl.key + '|' + bone + '|' + key, ent = _attCache[ck];
    if (!ent) {
      var r = buildFn(); if (!r) return null;
      var bp = G.rig.find(tpl.rigSpec, bone).p;
      [r.hi, r.lo].forEach(function (g) { if (g) { g.translate(-bp[0], -bp[1], -bp[2]); g.computeBoundingSphere(); g.userData.shared = true; } });
      ent = _attCache[ck] = { hi: r.hi, lo: r.lo, info: r.info || null };
    }
    var m = new THREE.Mesh(ent.hi, mat);
    m.castShadow = castShadow !== false && !G.isLow();
    parts.rig.bones[bone].add(m);
    if (ent.lo) G.lodSwap(m, [ent.hi, ent.lo], [0, tpl.lodDist * (G.isLow() ? 0.7 : 1)]);
    parts.extras = parts.extras || []; parts.extras.push(m);
    m.userData.wwInfo = ent.info;
    return m;
  }

  /* ------------------------------------------------------------------
   * 3. Antlers & horns (per age class; right side built, left mirrored with its own jitter)
   * ------------------------------------------------------------------ */
  function pathLen(pts) { var L = 0; for (var i = 1; i < pts.length; i++) { var a = pts[i - 1], b = pts[i]; L += Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2])); } return L; }
  /** rack(sideFn, paint, lo) : sideFn(side, rng, lo) -> {specs:[G.antler specs in +x coords], beam:m, tines:[m], points, spread, r0} */
  function rack(sideFn, seed, paintFn, opts) {
    opts = opts || {};
    function build(lo) {
      var geos = [], info = { points: 0, len: 0, spread: 0, mass: 0, sides: [] };
      [1, -1].forEach(function (side) {
        var rng = U.rng(seed * 7 + (side > 0 ? 1 : 2)), d = sideFn(rng, lo);
        d.specs.forEach(function (sp) { if (lo) { sp.seg = Math.max(6, Math.round((sp.seg || 16) * 0.5)); sp.radial = 4; } geos.push(G.antler(sp, side)); });
        (d.horns || []).forEach(function (h) { geos.push(hornTube(h, lo, side)); });
        info.points += d.points; info.len += d.len; info.spread = Math.max(info.spread, d.spread || 0); info.mass += d.mass || 0; info.sides.push(d.points);
      });
      if (opts.extra) opts.extra(geos, lo);
      var g = G.merge(geos);
      G.paint(g, paintFn);
      return { g: g, info: info };
    }
    var hi = build(false), lo = build(true);
    return { hi: hi.g, lo: lo.g, info: hi.info };
  }
  /** horn tube along control points with radius profile (ridges optional), side mirrors */
  function hornTube(h, lo, side) {
    var pts = G.curvePoints(h.pts, lo ? Math.max(6, Math.round((h.seg || 24) * 0.4)) : (h.seg || 24));
    var g = G.tube(pts.map(function (p) { return [p.x, p.y, p.z]; }), function (t) {
      var r = h.r0 + (h.r1 - h.r0) * Math.pow(t, h.taper || 1);
      if (h.ridges && !lo) r *= 1 + Math.max(0, Math.sin(t * h.ridges * Math.PI * 2)) * (h.ridgeDepth || 0.06) * (1 - t * 0.8);
      return r;
    }, { radial: lo ? 5 : (h.radial || 12), steps: lo ? 1 : 2, density: 6, capBulge: 0.6, sq: h.sq });
    if (h.flat) { var p = g.attributes.position; }
    if (side < 0) G.mirrorX(g);
    return g;
  }
  function antlerPaint(base, len, dark, light, tipStart) {
    var A = new THREE.Color(), B = new THREE.Color();
    return function (c, x, y, z) {
      var dx = Math.abs(x) - Math.abs(base[0]), dy = y - base[1], dz = z - base[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) / len;
      return c.copy(A.set(dark)).lerp(B.set(light), sm(tipStart || 0.15, 0.95, d));
    };
  }
  function J(rng, a) { return 1 + (rng() - 0.5) * 2 * (a == null ? 0.12 : a); }

  // ---- whitetail / mule / blacktail ----
  var WT_CLASSES = {
    spike: { label: 'Spike', s: 0.9, w: [55, 72] }, fork: { label: 'Fork-horn', s: 1.0, w: [60, 82] }, '8pt': { label: '8-point', s: 1.25, w: [72, 100] },
    '10pt': { label: '10-point', s: 1.45, w: [85, 118] }, '12pt': { label: '12-point', s: 1.62, w: [100, 135] }, nontyp: { label: 'Non-typical', s: 1.9, w: [140, 170] }
  };
  function whitetailRack(A, cls, seed) {
    var C = WT_CLASSES[cls], base = [0.042 * A.P.headW * A.S, A.poll[1] + 0.062 * A.S, A.poll[2] + 0.03 * A.S], s = C.s * A.S;
    return rack(function (rng, lo) {
      var b = base, specs = [], tines = [], pts, spread;
      function P(x, y, z) { return [b[0] + x * s, b[1] + y * s, b[2] + z * s]; }
      var spd = J(rng, 0.1);
      if (cls === 'spike') {
        pts = [P(0.015, 0.07, 0.02), P(0.03 * spd, 0.15, 0.0), P(0.035 * spd, 0.21 * J(rng), -0.03)];
        specs.push({ base: b, beam: pts, r: [0.013 * s, 0.004], seg: 10, radial: 7 });
        return { specs: specs, points: 1, len: pathLen([b].concat(pts)), spread: b[0] + 0.035 * s, mass: 0.013 * s };
      }
      if (cls === 'fork') {
        pts = [P(0.05 * spd, 0.07, 0.04), P(0.1 * spd, 0.13, 0.0), P(0.12 * spd, 0.17, -0.08)];
        var fl = 0.1 * s * J(rng);
        specs.push({ base: b, beam: pts, r: [0.016 * s, 0.005], seg: 14, radial: 7, tines: [{ t: 0.5, dir: [-0.05, 1, 0.12], len: fl, r: 0.008 * s }] });
        return { specs: specs, points: 2, len: pathLen([b].concat(pts)) + fl, spread: b[0] + 0.12 * s * spd, mass: 0.016 * s };
      }
      pts = [P(0.05 * spd, 0.07, 0.05), P(0.14 * spd, 0.13, 0.04), P(0.19 * spd, 0.15, -0.06), P(0.16 * spd, 0.14, -0.18), P(0.08 * spd, 0.13 * J(rng, 0.08), -0.25)];
      var T = [{ t: 0.08, dir: [0.15, 1, -0.35], len: 0.07 }, { t: 0.38, dir: [-0.05, 1, 0.08], len: 0.2 }, { t: 0.58, dir: [-0.12, 1, 0.05], len: 0.16 }];
      if (cls === '10pt' || cls === '12pt' || cls === 'nontyp') T.push({ t: 0.76, dir: [-0.2, 1, 0.0], len: 0.11 });
      if (cls === '12pt' || cls === 'nontyp') T.push({ t: 0.9, dir: [-0.25, 1, -0.05], len: 0.07 });
      if (cls === 'nontyp') {
        T.push({ t: 0.42, dir: [0.55, 0.8, -0.1], len: 0.1 }, { t: 0.55, dir: [0.25, -1, 0.15], len: 0.14, bend: [0.02, 0, 0.02] }, { t: 0.3, dir: [-0.3, 0.6, 0.6], len: 0.08 });
        if (rng() < 0.6) T.push({ t: 0.66, dir: [0.4, 0.9, 0.3], len: 0.09 });
        if (rng() < 0.5) T.push({ t: 0.16, dir: [0.6, 0.5, -0.5], len: 0.07 });
      }
      var tl = 0, pl = 0;
      var tn = T.map(function (q) {
        var L = q.len * s * J(rng); tl += L; pl++;
        return { t: q.t + (rng() - 0.5) * 0.03, dir: [q.dir[0] + (rng() - 0.5) * 0.12, q.dir[1], q.dir[2] + (rng() - 0.5) * 0.12], len: L, r: Math.max(0.006 * s, 0.011 * s * (q.len / 0.2)), bend: q.bend || [-0.02 * s, 0, -0.02 * s] };
      });
      specs.push({ base: b, beam: pts, r: [0.021 * s * (cls === 'nontyp' ? 1.15 : 1), 0.006 * s], seg: 18, radial: 7, tines: tn });
      return { specs: specs, points: pl + 1, len: pathLen([b].concat(pts)) + tl, spread: b[0] + 0.19 * s * spd, mass: 0.021 * s };
    }, seed, antlerPaint(base, 0.32 * s, '#5d4630', '#efe6d0'));
  }
  var MULE_CLASSES = { '2x2': { label: '2x2 Fork-horn', s: 0.92, w: [62, 85] }, '3x3': { label: '3x3', s: 1.05, w: [75, 105] }, '4x4': { label: '4x4', s: 1.2, w: [90, 135] }, '4x4+': { label: '4x4 with eye guards', s: 1.36, w: [110, 150] } };
  function muleRack(A, cls, seed, sMul) {
    var C = MULE_CLASSES[cls], base = [0.045 * A.P.headW * A.S, A.poll[1] + 0.06 * A.S, A.poll[2] + 0.03 * A.S], s = C.s * A.S * (sMul || 1);
    return rack(function (rng) {
      var b = base, specs = [], spd = J(rng, 0.1);
      function P(x, y, z) { return [b[0] + x * s, b[1] + y * s, b[2] + z * s]; }
      var trunk = [P(0.07 * spd, 0.08, 0.03), P(0.15 * spd, 0.17, 0.03), P(0.21 * spd, 0.24, 0.0)], F = trunk[2], len = pathLen([b].concat(trunk)), pts = 2;
      var trunkTines = []; if (cls === '4x4+') { trunkTines.push({ t: 0.12, dir: [0.1, 1, -0.5], len: 0.05 * s, r: 0.006 * s }); len += 0.05 * s; }
      specs.push({ base: b, beam: trunk, r: [0.02 * s, 0.014 * s], seg: 12, radial: 7, tines: trunkTines });
      function Fp(x, y, z) { return [F[0] + x * s, F[1] + y * s, F[2] + z * s]; }
      var rear = [Fp(0.04 * spd, 0.1, 0.05), Fp(0.06 * spd, 0.21 * J(rng), 0.04)], front = [Fp(0.03 * spd, 0.1, -0.06), Fp(0.03 * spd, 0.17 * J(rng), -0.12)];
      var rT = [], fT = [];
      if (cls !== '2x2') { rT.push({ t: 0.5, dir: [-0.1, 1, 0.35], len: 0.1 * s * J(rng), r: 0.008 * s }); pts++; len += 0.1 * s; }
      if (cls === '4x4' || cls === '4x4+') { fT.push({ t: 0.5, dir: [-0.1, 1, -0.1], len: 0.09 * s * J(rng), r: 0.008 * s }); pts++; len += 0.09 * s; }
      specs.push({ base: F, beam: rear, r: [0.014 * s, 0.005 * s], seg: 10, radial: 6, burr: false, tines: rT });
      specs.push({ base: F, beam: front, r: [0.013 * s, 0.005 * s], seg: 10, radial: 6, burr: false, tines: fT });
      len += pathLen([F].concat(rear)) + pathLen([F].concat(front));
      if (cls === '4x4+') pts++;
      return { specs: specs, points: pts, len: len, spread: b[0] + 0.25 * s * spd, mass: 0.02 * s };
    }, seed, antlerPaint(base, 0.4 * s, '#5a4430', '#ebe1cb'));
  }
  // ---- elk ----
  var ELK_CLASSES = { spike: { label: 'Spike', s: 0.55, w: [210, 260] }, rag: { label: '4x4 Raghorn', s: 0.78, w: [250, 310] }, '5x5': { label: '5x5', s: 0.9, w: [280, 350] },
    '6x6': { label: '6x6 Royal', s: 1.0, w: [320, 400] }, '7x7': { label: '7x7 Imperial', s: 1.1, w: [360, 440] }, giant: { label: '8x8 Monarch', s: 1.22, w: [430, 470] } };
  function elkRack(A, cls, seed, crown) {
    var C = ELK_CLASSES[cls], base = [0.05 * A.P.headW * A.S, A.poll[1] + 0.065 * A.S, A.poll[2] + 0.02 * A.S], s = C.s * (crown ? 0.94 : 1) * A.S / 1.52;
    return rack(function (rng) {
      var b = base, specs = [];
      function P(x, y, z) { return [b[0] + x * s, b[1] + y * s, b[2] + z * s]; }
      if (cls === 'spike') {
        var sp = [P(0.03, 0.15, 0.06), P(0.06, 0.3, 0.08), P(0.07, 0.42 * J(rng), 0.06)];
        specs.push({ base: b, beam: sp, r: [0.022 * s, 0.006 * s], seg: 12, radial: 7 });
        return { specs: specs, points: 1, len: pathLen([b].concat(sp)), spread: b[0] + 0.07 * s, mass: 0.022 * s };
      }
      var spd = J(rng, 0.08);
      var beam = [P(0.08 * spd, 0.12, 0.08), P(0.2 * spd, 0.38, 0.2), P(0.28 * spd, 0.62, 0.32), P(0.27 * spd, 0.86, 0.36), P(0.2 * spd, 1.04 * J(rng, 0.05), 0.3), P(0.14 * spd, 1.12, 0.2)];
      var T = [{ t: 0.03, dir: [0.05, 0.35, -1], len: 0.34, bend: [0, 0.08, 0] }];
      if (cls !== 'rag') T.push({ t: 0.09, dir: [0.08, 0.42, -1], len: 0.3, bend: [0, 0.06, 0] });
      T.push({ t: 0.3, dir: [-0.05, 0.45, -1], len: 0.25 }, { t: 0.5, dir: [-0.08, 0.75, -1], len: 0.38, bend: [0, 0.05, 0.03] });
      if (cls === '6x6' || cls === '7x7' || cls === 'giant') T.push({ t: 0.7, dir: [-0.05, 0.8, -0.9], len: 0.27 });
      if (cls === '7x7' || cls === 'giant') T.push({ t: 0.83, dir: [-0.15, 0.9, -0.5], len: 0.2 });
      if (cls === 'giant') T.push({ t: 0.6, dir: [0.4, 0.7, -0.4], len: 0.18 }, { t: 0.92, dir: [0.2, 0.9, 0.5], len: 0.14 });
      if (crown) T.push({ t: 0.88, dir: [-0.3, 1, 0.1], len: 0.13 }, { t: 0.94, dir: [0.25, 1, -0.2], len: 0.11 });
      var tl = 0;
      var tn = T.map(function (q) { var L = q.len * s * J(rng); tl += L; return { t: q.t + (rng() - 0.5) * 0.02, dir: q.dir, len: L, r: 0.016 * s * Math.min(1.2, 0.6 + q.len), bend: q.bend ? [q.bend[0] * s, q.bend[1] * s, q.bend[2] * s] : [0, 0.04 * s, 0] }; });
      specs.push({ base: b, beam: beam, r: [0.034 * s, 0.01 * s], seg: 22, radial: 8, tines: tn });
      return { specs: specs, points: T.length + 1, len: pathLen([b].concat(beam)) + tl, spread: b[0] + 0.28 * s * spd, mass: 0.034 * s };
    }, seed, antlerPaint(base, 1.1 * s, '#4e3a28', '#e7dcc4', 0.2));
  }
  // ---- moose ----
  var MOOSE_CLASSES = { young: { label: 'Young bull', s: 0.62, w: [380, 470] }, mature: { label: 'Mature bull', s: 0.86, w: [450, 580] }, trophy: { label: 'Trophy bull', s: 1.0, w: [540, 650] }, giant: { label: 'Giant bull', s: 1.12, w: [620, 700] } };
  function mooseRack(A, cls, seed) {
    var C = MOOSE_CLASSES[cls], base = [0.06 * A.P.headW * A.S, A.poll[1] + 0.045 * A.S, A.poll[2] + 0.02 * A.S], s = C.s * A.S / 1.62;
    return rack(function (rng) {
      var b = base, specs = [];
      function P(x, y, z) { return [b[0] + x * s, b[1] + y * s, b[2] + z * s]; }
      var beam = [P(0.12, 0.03, 0.0), P(0.25, 0.08, 0.02), P(0.42, 0.17, 0.05), P(0.6 * J(rng, 0.06), 0.3, 0.06)];
      var nP = cls === 'young' ? 4 : cls === 'mature' ? 7 : cls === 'trophy' ? 9 : 11;
      specs.push({ base: b, beam: beam, r: [0.045 * s, 0.024 * s], seg: 16, radial: 8,
        tines: [{ t: 0.22, dir: [0.25, 0.25, -1], len: 0.17 * s, r: 0.02 * s }, { t: 0.26, dir: [0.4, 0.5, -1], len: 0.14 * s, r: 0.018 * s }],
        palm: { t0: 0.28, t1: 1.0, width: 0.52 * s, thick: 0.024 * s, points: nP, pointLen: 0.1 * s, normal: [0, 0.78, -0.62] } });
      return { specs: specs, points: nP + 2, len: pathLen([b].concat(beam)) + 0.3 * s + nP * 0.1 * s, spread: b[0] + 0.62 * s, mass: 0.05 * s, palm: 0.52 * s };
    }, seed, antlerPaint(base, 0.7 * s, '#4f3d2b', '#d9cdb3', 0.25));
  }
  // ---- caribou ----
  var CARIBOU_CLASSES = { young: { label: 'Young bull', s: 0.62, w: [150, 190] }, mature: { label: 'Mature bull', s: 0.85, w: [180, 240] }, trophy: { label: 'Trophy bull', s: 1.0, w: [220, 290] }, giant: { label: 'Giant bull', s: 1.12, w: [270, 300] }, cow: { label: 'Cow', s: 0.42, w: [80, 140] } };
  function caribouRack(A, cls, seed) {
    var C = CARIBOU_CLASSES[cls], base = [0.045 * A.P.headW * A.S, A.poll[1] + 0.06 * A.S, A.poll[2] + 0.02 * A.S], s = C.s * A.S / 1.2;
    return rack(function (rng) {
      var b = base, specs = [], spd = J(rng, 0.08), side = rng() < 0.5;
      function P(x, y, z) { return [b[0] + x * s, b[1] + y * s, b[2] + z * s]; }
      var beam = [P(0.06 * spd, 0.12, 0.12), P(0.15 * spd, 0.38, 0.28), P(0.21 * spd, 0.66, 0.3), P(0.2 * spd, 0.88, 0.14), P(0.13 * spd, 1.0, -0.08), P(0.08 * spd, 1.04, -0.2)];
      var pts = 1, len = pathLen([b].concat(beam));
      var bm = { base: b, beam: beam, r: [0.026 * s, 0.009 * s], seg: 22, radial: 7, tines: [{ t: 0.2, dir: [0.0, 0.25, -1], len: 0.28 * s, r: 0.012 * s, bend: [0, 0.05 * s, 0] }, { t: 0.45, dir: [0.1, 0.2, 1], len: 0.12 * s, r: 0.01 * s }] };
      pts += 2; len += 0.4 * s;
      if (cls !== 'cow') { bm.tines.push({ t: 0.23, dir: [-0.2, 0.5, -1], len: 0.2 * s, r: 0.01 * s }); bm.palm = { t0: 0.78, t1: 1.0, width: 0.2 * s, thick: 0.012 * s, points: cls === 'young' ? 3 : 5, pointLen: 0.07 * s, normal: [1, 0, 0.25] }; pts += 1 + bm.palm.points; len += 0.2 * s + bm.palm.points * 0.07 * s; }
      specs.push(bm);
      if (cls !== 'cow' && (side || cls === 'giant')) { // the famous brow "shovel"
        var sh = [P(0.015, 0.09, -0.06), P(0.01, 0.11, -0.2), P(0.0, 0.08, -0.33)];
        specs.push({ base: b, beam: sh, r: [0.018 * s, 0.012 * s], seg: 10, radial: 6, burr: false, palm: { t0: 0.35, t1: 1.0, width: 0.17 * s, thick: 0.01 * s, points: 4, pointLen: 0.04 * s, normal: [1, 0, 0] } });
        pts += 4; len += 0.3 * s;
      }
      return { specs: specs, points: pts, len: len, spread: b[0] + 0.21 * s * spd, mass: 0.026 * s };
    }, seed, antlerPaint(base, 1.0 * s, '#5a4632', '#e9dfc6', 0.2));
  }
  // ---- pronghorn ----
  function pronghornHorns(A, buck, seed) {
    var base = [0.034 * A.P.headW * A.S, A.poll[1] + 0.03 * A.S, A.poll[2] - 0.035 * A.S], s = (buck ? 1 : 0.22) * A.S / 0.92;
    return rack(function (rng) {
      var b = base, k = J(rng, 0.12);
      function P(x, y, z) { return [b[0] + x * s, b[1] + y * s * k, b[2] + z * s]; }
      var horns = [{ pts: [b, P(0.006, 0.08, -0.005), P(0.004, 0.16, 0.0), P(-0.01, 0.24, 0.02), P(-0.032, 0.28, 0.07)], r0: 0.021 * s, r1: 0.004 * s, seg: 18, radial: 10 }];
      if (buck) horns.push({ pts: [P(0.004, 0.115, -0.012), P(0.006, 0.135, -0.04), P(0.006, 0.16, -0.06)], r0: 0.012 * s, r1: 0.003 * s, seg: 8, radial: 8 });
      return { specs: [], horns: horns, points: buck ? 2 : 1, len: 0.34 * s * k + (buck ? 0.06 * s : 0), spread: b[0] + 0.03 * s, mass: 0.021 * s };
    }, seed, antlerPaint(base, 0.3 * s, '#2a231d', '#0f0d0b', 0.1));
  }
  // ---- bighorn ----
  var SHEEP_CLASSES = { half: { label: '1/2 curl', curl: 0.5, w: [70, 90] }, three: { label: '3/4 curl', curl: 0.72, w: [80, 105] }, full: { label: 'Full curl', curl: 0.92, w: [95, 125] }, broom: { label: 'Broomed full curl', curl: 1.0, w: [110, 135] }, king: { label: 'Royal curl', curl: 1.18, w: [130, 145] } };
  function bighornHorns(A, cls, seed, ewe) {
    var base = [0.045 * A.P.headW * A.S, A.poll[1] + 0.035 * A.S, A.poll[2] - 0.03 * A.S], S = A.S;
    return rack(function (rng) {
      var b = base;
      if (ewe) {
        var pe = [b, [b[0] + 0.012 * S, b[1] + 0.07 * S, b[2] + 0.03 * S], [b[0] + 0.03 * S, b[1] + 0.11 * S, b[2] + 0.09 * S], [b[0] + 0.045 * S, b[1] + 0.1 * S, b[2] + 0.15 * S]];
        return { specs: [], horns: [{ pts: pe, r0: 0.02 * S, r1: 0.005 * S, seg: 14, radial: 9, ridges: 6, ridgeDepth: 0.05 }], points: 1, len: pathLen(pe), spread: b[0] + 0.05 * S, mass: 0.02 * S };
      }
      var C = SHEEP_CLASSES[cls], curl = C.curl * (0.95 + rng() * 0.1), turns = curl * TAU, R0 = 0.115 * S, n = 30, pts = [], ph0 = -0.5;
      var cy = b[1] - R0 * Math.cos(ph0), cz = b[2] - R0 * Math.sin(ph0);
      for (var i = 0; i <= n; i++) {
        var u = i / n, ph = ph0 + turns * u, R = R0 * (1 - 0.18 * u);
        pts.push([b[0] + 0.15 * S * u + 0.05 * S * u * u * u * (curl > 0.85 ? 1 : 0.3), cy + R * Math.cos(ph), cz + R * Math.sin(ph)]);
      }
      var r0 = (0.05 + 0.012 * curl) * S, r1 = (cls === 'broom' ? 0.03 : 0.014) * S * (0.8 + 0.4 * curl);
      return { specs: [], horns: [{ pts: pts, r0: r0, r1: r1, seg: 40, radial: 13, ridges: 16, ridgeDepth: 0.07, taper: 0.8 }], points: 1, len: pathLen(pts), spread: Math.abs(pts[n][0]) + 0.02 * S, mass: r0 };
    }, seed, antlerPaint(base, (ewe ? 0.2 : 0.7) * S, ewe ? '#6b5a44' : '#5e4a34', ewe ? '#9c8a6e' : '#b49a74', 0.05));
  }
  function goatHorns(A, billy, seed) {
    var base = [0.034 * A.P.headW * A.S, A.poll[1] + 0.035 * A.S, A.poll[2] - 0.035 * A.S], s = (billy ? 1.08 : 0.95) * A.S;
    return rack(function (rng) {
      var b = base, k = J(rng, 0.1);
      var pts = [b, [b[0] + 0.004 * s, b[1] + 0.09 * s * k, b[2] + 0.02 * s], [b[0] + 0.009 * s, b[1] + 0.16 * s * k, b[2] + 0.065 * s], [b[0] + 0.012 * s, b[1] + 0.2 * s * k, b[2] + 0.125 * s]];
      return { specs: [], horns: [{ pts: pts, r0: (billy ? 0.019 : 0.015) * s, r1: 0.003 * s, seg: 16, radial: 9, ridges: 8, ridgeDepth: 0.04 }], points: 1, len: pathLen(pts), spread: b[0] + 0.015 * s, mass: 0.019 * s };
    }, seed, antlerPaint(base, 0.26 * s, '#262019', '#0c0a09', 0.1));
  }
  function bisonHorns(A, bull, seed) {
    var base = [A.headHalfW * 0.82, A.poll[1] + 0.035 * A.S, A.poll[2] - 0.05 * A.S], s = (bull ? 1 : 0.8) * A.S / 1.55;
    return rack(function (rng) {
      var b = base, k = J(rng, 0.1);
      var pts = [[b[0] - 0.03 * s, b[1], b[2]], [b[0] + 0.09 * s * k, b[1] + 0.01 * s, b[2] - 0.01 * s], [b[0] + 0.15 * s * k, b[1] + 0.07 * s, b[2] - 0.03 * s], [b[0] + 0.15 * s * k, b[1] + 0.15 * s * k, b[2] - 0.065 * s]];
      return { specs: [], horns: [{ pts: pts, r0: (bull ? 0.045 : 0.032) * s, r1: 0.006 * s, seg: 16, radial: 11, ridges: 5, ridgeDepth: 0.04 }], points: 1, len: pathLen(pts), spread: b[0] + 0.16 * s, mass: 0.045 * s };
    }, seed, antlerPaint(base, 0.32 * s, '#3c3329', '#0e0c0a', 0.2));
  }
  function muskoxHorns(A, bull, seed) {
    var S = A.S / 1.25, b0 = [0.025 * S, A.poll[1] + 0.06 * S, A.poll[2] - 0.035 * S], s = (bull ? 1 : 0.75) * S;
    return rack(function (rng) {
      var b = b0, k = J(rng, 0.08);
      function P(x, y, z) { return [b[0] + x * s, b[1] + y * s, b[2] + z * s]; }
      var pts = [b, P(0.08, 0.005, 0.005), P(0.15, -0.05, 0.0), P(0.19, -0.16 * k, -0.03), P(0.205, -0.22 * k, -0.11), P(0.24, -0.16 * k, -0.19)];
      return { specs: [], horns: [{ pts: pts, r0: (bull ? 0.06 : 0.035) * s, r1: 0.007 * s, seg: 26, radial: 12, taper: 0.7 }], points: 1, len: pathLen(pts), spread: b[0] + 0.24 * s, mass: 0.06 * s };
    }, seed, (function () {
      var A1 = new THREE.Color(), B1 = new THREE.Color();
      return function (c, x, y, z) { var d = Math.sqrt((Math.abs(x) - b0[0]) * (Math.abs(x) - b0[0]) + (y - b0[1]) * (y - b0[1]) + (z - b0[2]) * (z - b0[2])) / (0.42 * s); return c.copy(A1.set('#d8cfbd')).lerp(B1.set('#2a241e'), sm(0.45, 1.0, d)); };
    })(), { extra: function (geos, lo) {
      // the "boss": broad horn plate across the forehead
      var g = new THREE.SphereGeometry(1, lo ? 10 : 18, lo ? 6 : 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
      g.scale(0.14 * s, 0.07 * s, 0.085 * s); g.translate(0, b0[1] - 0.02 * s, b0[2] + 0.005 * s); geos.push(g);
    } });
  }

  /* ------------------------------------------------------------------
   * 4. Species catalogue
   * ------------------------------------------------------------------ */
  var DEER_POSES = { idle: [0, 0, 0], walk: [-0.2, -0.02, 0.1], run: [-0.42, -0.05, 0.28], alert: [0.18, 0.08, -0.12], graze: [-1.22, -0.42, 0.62] };
  var SPECIES = WW.species;
  /* Each: fam, sexes {m:{P,C,sizeK,w:[kg]}, f:{...}}, stats, habitats, spawn {weight,max}, gaits, speeds, poses, extras(parts,tpl,spec,a,opts), facts, tips */
  SPECIES.whitetail_deer = {
    fam: 'deer', name: 'Whitetail Deer', scoreUnit: 'in', rut: 'grunt', stomp: true, bed: 0.35, drink: 0.12,
    m: { P: { wideK: 1.1, legW: 1.14, upperLegW: 1.08, neckW: 1.1, maneDown: 0.18, tailW: 1.18, tailLen: 1.05 }, C: { face: '#4f3b2a' }, w: [55, 135] },
    f: { P: { wideK: 1.02, legW: 1.06, neckW: 0.84, headLen: 0.96, headW: 0.95, tailW: 1.12 }, C: { coat: '#8f7255', back: '#6d5439', face: '#6d543c' }, sizeK: 0.9, w: [42, 80] },
    gaits: ['walk', 'trot', 'gallop'], speeds: [2.1, 4.8], poses: DEER_POSES, tailFlag: 1, tailLift: 2.0, lodDist: 46,
    furTints: ['#ffffff', '#f1ebe3', '#fff6ea', '#e8e4e0'],
    facts: ['Flags its bright white tail when it bolts, warning the herd.', 'Bucks grow a new set of antlers every summer and shed them in late winter.', 'Can run up to 75 km/h and leap 3 m high.'],
    tips: ['Watch field edges at dawn and dusk.', 'A stomping, snorting doe has seen you: freeze.', 'Rattling antlers pull in curious bucks during the rut.']
  };
  SPECIES.mule_deer = {
    fam: 'deer', name: 'Mule Deer', rarity: 'common', baseCash: 175, xp: 55, hp: 115, scoreUnit: 'in', rut: 'grunt', stomp: true, bed: 0.35, drink: 0.1, stott: true,
    speed: { walk: 1.5, run: 10 }, senses: { sight: 85, hearing: 75, smell: 95 }, group: [1, 5], habitats: ['frost_peaks', 'golden_plains', 'autumn_ridge', 'red_rock_mesa'], spawn: { weight: 3, max: 6 },
    m: { P: { S: 1.07, wideK: 1.16, depthK: 1.06, legW: 1.14, upperLegW: 1.1, neckW: 1.14, maneDown: 0.2, earLen: 1.55, earW: 1.5, earCup: 0.5, earRot: [0.2, 0.35, -0.85], headLen: 1.04, tailLen: 0.82, tailW: 0.5, tailH: 0.8, tailDroop: 1.45 },
      C: { coat: '#8b7a66', back: '#6b5e50', face: '#3b302a', faceK: 0.85, muzzle: '#d9d0c2', muzzleK: 0.4, faceWhite: 0.55, leg: '#9a8a74', tailTop: '#ece6da', tailUnder: '#f2ede4', tailTip: '#141110', tailEdge: null, rump: { color: '#efe9de', k: 0.95, size: 1.3, top: 0.4 }, earOut: '#7d6f60', earTip: '#2a221c' }, w: [70, 150] },
    f: { P: { S: 1.0, wideK: 1.06, legW: 1.06, neckW: 0.86, earLen: 1.5, earW: 1.45, earCup: 0.5, earRot: [0.2, 0.35, -0.85], headLen: 0.98, tailLen: 0.8, tailW: 0.5, tailH: 0.8, tailDroop: 1.45 },
      C: { coat: '#8f806c', back: '#726555', face: '#55473b', muzzle: '#d9d0c2', faceWhite: 0.45, leg: '#9a8a74', tailTop: '#ece6da', tailUnder: '#f2ede4', tailTip: '#141110', tailEdge: null, rump: { color: '#efe9de', k: 0.95, size: 1.3, top: 0.4 }, earOut: '#7d6f60', earTip: '#2a221c' }, sizeK: 0.88, w: [45, 82] },
    gaits: ['walk', 'trot', 'bound'], speeds: [2.0, 4.4], poses: DEER_POSES, tailFlag: 0.25, tailLift: 0.8, lodDist: 48, furTints: ['#ffffff', '#f2eee8', '#ece8e2'],
    facts: ['Named for its huge mule-like ears.', 'Escapes with a stiff-legged bounce called stotting: all four hooves leave the ground at once.', 'Antlers fork, then fork again, unlike a whitetail\'s single main beam.'],
    tips: ['Mule deer often stop and look back before cresting a ridge: be ready.', 'Glass open slopes and sage flats from above.']
  };
  SPECIES.blacktail_deer = {
    fam: 'deer', name: 'Black-tailed Deer', rarity: 'common', baseCash: 160, xp: 50, hp: 95, scoreUnit: 'in', rut: 'grunt', stomp: true, bed: 0.4, drink: 0.15,
    speed: { walk: 1.4, run: 9.5 }, senses: { sight: 65, hearing: 70, smell: 100 }, group: [1, 3], habitats: ['redwood_canyon', 'misty_bayou'], spawn: { weight: 3, max: 5 },
    m: { P: { S: 0.95, wideK: 1.1, legW: 1.12, neckW: 1.08, maneDown: 0.15, earLen: 1.28, earW: 1.25, tailW: 1.35, tailLen: 1.0 }, C: { coat: '#735640', back: '#4b3626', face: '#3e2e21', tailTop: '#1d1612', tailEdge: null, rump: { color: '#ebe3d5', k: 0.5, size: 0.4, top: 0 }, leg: '#86694f' }, w: [55, 100] },
    f: { P: { S: 0.95, wideK: 1.0, legW: 1.04, neckW: 0.84, earLen: 1.25, earW: 1.22, tailW: 1.3, headLen: 0.95 }, C: { coat: '#7a5c45', back: '#54402e', face: '#4a3727', tailTop: '#1d1612', tailEdge: null, rump: { color: '#ebe3d5', k: 0.5, size: 0.4, top: 0 }, leg: '#86694f' }, sizeK: 0.88, w: [35, 65] },
    gaits: ['walk', 'trot', 'gallop'], speeds: [2.0, 4.6], poses: DEER_POSES, tailFlag: 0.7, tailLift: 1.8, lodDist: 44, furTints: ['#ffffff', '#f0e8e0', '#f6efe6'],
    facts: ['A coastal cousin of the mule deer with a broad, jet-black tail.', 'Lives in thick rainforest where shots are close and quick.', 'Most active in fog and drizzle.'],
    tips: ['Still-hunt slowly through ferns; let them step out first.', 'Look for the dark tail flicking in the undergrowth.']
  };
  var ELK_POSES = { idle: [0, 0, 0], walk: [-0.18, -0.02, 0.1], run: [-0.34, -0.05, 0.26], alert: [0.16, 0.06, -0.1], graze: [-1.08, -0.4, 0.58] };
  SPECIES.elk = {
    fam: 'elk', name: 'Rocky Mountain Elk', rarity: 'uncommon', baseCash: 330, xp: 95, hp: 220, scoreUnit: 'in', rut: 'bugle', bed: 0.3, drink: 0.15, harem: true,
    speed: { walk: 1.7, run: 11 }, senses: { sight: 75, hearing: 80, smell: 120 }, group: [3, 6], habitats: ['pine_valley', 'frost_peaks', 'autumn_ridge'], spawn: { weight: 2.2, max: 7 },
    m: { P: { S: 1.52, lenK: 1.08, wideK: 1.08, depthK: 1.06, legW: 1.16, upperLegW: 1.1, neckW: 1.42, maneDown: 0.65, maneUp: 0.12, neckAngle: 46, headLen: 1.16, headW: 1.02, muzzle: 1.05, earLen: 0.95, earW: 0.95, tailLen: 0.42, tailW: 0.75, tailH: 1.1, tailDroop: 1.5 },
      C: { coat: '#b49b74', back: '#9b8160', belly: '#4f3a28', bellyK: 0.85, neck: '#4c3524', neckK: 0.95, mane: '#3a2819', maneK: 0.9, face: '#4a3423', faceK: 0.9, headBase: '#6a4e36', muzzle: '#3a2a1e', muzzleK: 0.6, muzzleBand: 0, chinWhite: 0, eyeRing: 0.25, throat: 0,
        leg: '#4a3626', legLow: '#2e2219', legInner: 0.1, rump: { color: '#e9d8b0', k: 0.95, size: 1.15, top: 0.55, edge: '#3d2a1b' }, tailTop: '#d8c39a', tailUnder: '#cdb68a', tailEdge: null, earOut: '#7e6347', earIn: '#d7c6a8', gland: 0.2 }, w: [280, 450] },
    f: { P: { S: 1.52, lenK: 1.05, wideK: 1.02, legW: 1.12, neckW: 1.06, maneDown: 0.25, neckAngle: 50, headLen: 1.12, headW: 0.96, earLen: 1.05, earW: 1.0, tailLen: 0.42, tailW: 0.75, tailH: 1.1, tailDroop: 1.5 },
      C: { coat: '#a88e6a', back: '#8f7656', belly: '#55402d', bellyK: 0.8, neck: '#5a4230', neckK: 0.85, mane: '#46331f', maneK: 0.6, face: '#5a4330', faceK: 0.85, headBase: '#6f5640', muzzle: '#3a2a1e', muzzleK: 0.6, muzzleBand: 0, chinWhite: 0, eyeRing: 0.25, throat: 0,
        leg: '#4f3b2a', legLow: '#2e2219', legInner: 0.1, rump: { color: '#e5d4ad', k: 0.95, size: 1.1, top: 0.55, edge: '#3d2a1b' }, tailTop: '#d8c39a', tailUnder: '#cdb68a', tailEdge: null, earOut: '#7e6347', earIn: '#d7c6a8', gland: 0.2 }, sizeK: 0.88, w: [200, 290] },
    gaits: ['walk', 'trot', 'gallop'], speeds: [2.5, 5.6], poses: ELK_POSES, tailFlag: 0.15, tailLift: 0.8, lodDist: 60, furTints: ['#ffffff', '#f3ede4', '#ebe5dc'],
    facts: ['A bull\'s bugle (a rising scream ending in grunts) carries for kilometres in the September rut.', 'Bulls gather harems of cows and fight rivals antler-to-antler.', 'A mature bull can weigh over 400 kg.'],
    tips: ['Answer a bugle with your bugle tube and the bull may come looking for a fight.', 'Elk have a superb nose: always keep the wind in your face.']
  };
  SPECIES.roosevelt_elk = {
    fam: 'elk', name: 'Roosevelt Elk', rarity: 'uncommon', baseCash: 380, xp: 105, hp: 245, scoreUnit: 'in', rut: 'bugle', bed: 0.35, drink: 0.18, harem: true, crown: true,
    speed: { walk: 1.6, run: 10.5 }, senses: { sight: 65, hearing: 80, smell: 125 }, group: [3, 7], habitats: ['redwood_canyon'], spawn: { weight: 2.4, max: 8 },
    m: { P: { S: 1.6, lenK: 1.06, wideK: 1.16, depthK: 1.1, legW: 1.2, upperLegW: 1.12, neckW: 1.48, maneDown: 0.7, maneUp: 0.12, neckAngle: 44, headLen: 1.14, headW: 1.06, muzzle: 1.06, earLen: 0.92, earW: 0.95, tailLen: 0.42, tailW: 0.75, tailH: 1.1, tailDroop: 1.5 },
      C: { coat: '#9c8160', back: '#7f6648', belly: '#3d2c1e', bellyK: 0.85, neck: '#3a2819', neckK: 0.95, mane: '#2c1e13', maneK: 0.9, face: '#3c2a1c', faceK: 0.9, headBase: '#5a412d', muzzle: '#2e2219', muzzleK: 0.6, muzzleBand: 0, chinWhite: 0, eyeRing: 0.2, throat: 0,
        leg: '#3d2c1e', legLow: '#251b13', legInner: 0.1, rump: { color: '#dcc79c', k: 0.92, size: 1.1, top: 0.55, edge: '#2c1e13' }, tailTop: '#c9b287', tailUnder: '#c0a97f', tailEdge: null, earOut: '#6d543c', earIn: '#cdbb9b', gland: 0.2 }, w: [320, 500] },
    f: { P: { S: 1.6, lenK: 1.04, wideK: 1.08, legW: 1.14, neckW: 1.08, maneDown: 0.25, neckAngle: 50, headLen: 1.1, headW: 0.98, earLen: 1.02, tailLen: 0.42, tailW: 0.75, tailH: 1.1, tailDroop: 1.5 },
      C: { coat: '#957b5a', back: '#7a6245', belly: '#46342a', bellyK: 0.8, neck: '#4a3524', neckK: 0.85, mane: '#3a291b', maneK: 0.6, face: '#4c3726', headBase: '#5f4733', muzzle: '#2e2219', muzzleK: 0.6, muzzleBand: 0, chinWhite: 0, eyeRing: 0.2, throat: 0,
        leg: '#45331f', legLow: '#251b13', legInner: 0.1, rump: { color: '#d8c398', k: 0.92, size: 1.05, top: 0.55, edge: '#2c1e13' }, tailTop: '#c9b287', tailUnder: '#c0a97f', tailEdge: null, earOut: '#6d543c', earIn: '#cdbb9b', gland: 0.2 }, sizeK: 0.88, w: [250, 330] },
    gaits: ['walk', 'trot', 'gallop'], speeds: [2.5, 5.6], poses: ELK_POSES, tailFlag: 0.15, tailLift: 0.8, lodDist: 62, furTints: ['#ffffff', '#f0e9df', '#e9e2d8'],
    facts: ['The largest elk in North America, living in coastal rainforest.', 'Antlers are heavier and shorter than Rocky Mountain elk, often ending in a "crown" of points.', 'Named after President Theodore Roosevelt.'],
    tips: ['Herds move through fern gullies at first light.', 'Use the creek noise to cover your approach.']
  };
  SPECIES.moose = {
    fam: 'moose', name: 'Moose', rarity: 'rare', baseCash: 460, xp: 130, hp: 320, scoreUnit: 'in spread', rut: 'moose', bed: 0.3, drink: 0.3,
    temperament: 'territorial', territory: 16, damage: 32, attackRange: 2.6, warnTime: 1.9,
    speed: { walk: 1.6, run: 9.5 }, senses: { sight: 45, hearing: 85, smell: 120 }, group: [1, 2], habitats: ['pine_valley', 'northern_tundra', 'misty_bayou'], spawn: { weight: 0.9, max: 2 },
    m: { P: { S: 1.62, legK: 1.42, lenK: 1.0, wideK: 1.0, depthK: 1.18, upK: 1.05, hump: 0.12, rumpDrop: 0.1, hipW: 0.9, legW: 1.18, upperLegW: 1.12, hoofK: 1.25, neckLen: 0.78, neckW: 1.5, maneUp: 0.35, neckAngle: 33, headLen: 1.5, headW: 1.08, headH: 1.12, muzzle: 1.6, muzzleLen: 1.3, lipDrop: 1.4, headPitch: -48, earLen: 1.3, earW: 1.15, earTip: 0.6, tailLen: 0.35, tailW: 0.6 },
      C: { coat: '#3e2f24', back: '#2b211a', belly: '#2a201a', bellyK: 0.6, white: '#d4c8b6', leg: '#a29684', legLow: '#8e8272', legLowK: 0.3, legInner: 0.3, face: '#2a1f17', faceK: 0.6, headBase: '#4a3a2c', muzzle: '#4c3c2e', muzzleK: 0.5, nose: '#231b15', noseK: 0.6,
        muzzleBand: 0, chinWhite: 0, eyeRing: 0, throat: 0, rump: null, tailTop: '#2b211a', tailUnder: '#3a2d22', tailEdge: null, earOut: '#3e2f24', earIn: '#7a6a58', earTip: '#20180f', gland: 0, stripe: 0.4, stripeColor: '#1e1712' }, w: [380, 700] },
    f: { P: { S: 1.62, legK: 1.4, wideK: 0.96, depthK: 1.12, hump: 0.09, rumpDrop: 0.1, hipW: 0.9, legW: 1.14, upperLegW: 1.08, hoofK: 1.2, neckLen: 0.8, neckW: 1.3, maneUp: 0.25, neckAngle: 34, headLen: 1.45, headW: 1.02, headH: 1.08, muzzle: 1.5, muzzleLen: 1.28, lipDrop: 1.35, headPitch: -48, earLen: 1.3, earW: 1.15, tailLen: 0.35, tailW: 0.6 },
      C: { coat: '#4a3929', back: '#352a1f', belly: '#30251c', bellyK: 0.6, white: '#d4c8b6', leg: '#a89a86', legLow: '#958876', legLowK: 0.3, legInner: 0.3, face: '#3a2c20', faceK: 0.6, headBase: '#5a4734', muzzle: '#5a4734', muzzleK: 0.4, nose: '#231b15', noseK: 0.6,
        muzzleBand: 0, chinWhite: 0, eyeRing: 0, throat: 0, rump: null, tailTop: '#352a1f', tailUnder: '#3a2d22', tailEdge: null, earOut: '#4a3929', earIn: '#7a6a58', earTip: '#20180f', gland: 0, stripe: 0.3, stripeColor: '#241b14' }, sizeK: 0.9, w: [300, 450] },
    gaits: ['walk', 'trot', 'gallop'], speeds: [2.6, 7.2], poses: { idle: [0, 0, 0], walk: [-0.15, 0, 0.08], run: [-0.28, -0.02, 0.2], alert: [0.18, 0.05, -0.08], graze: [-0.95, -0.45, 0.55] }, tailFlag: 0, tailLift: 0.5, lodDist: 70, furTints: ['#ffffff', '#f2ece6', '#e6e0da'],
    facts: ['The largest deer on Earth: a bull can stand 2 m at the shoulder.', 'The hanging flap of skin under the throat is called a "bell".', 'Despite its size, a moose can trot faster than you can sprint, and it swims well.'],
    tips: ['Do not crowd a bull: inside about 16 m he may charge.', 'Check willow flats and pond edges, where moose browse and wade.']
  };
  SPECIES.caribou = {
    fam: 'caribou', name: 'Caribou', rarity: 'uncommon', baseCash: 300, xp: 90, hp: 170, scoreUnit: 'in', rut: 'caribou', bed: 0.25, drink: 0.1, migrate: true,
    speed: { walk: 1.7, run: 11 }, senses: { sight: 60, hearing: 70, smell: 130 }, group: [4, 9], habitats: ['northern_tundra', 'frost_peaks'], spawn: { weight: 2.6, max: 10 },
    m: { P: { S: 1.2, legK: 0.98, wideK: 1.12, depthK: 1.1, hump: 0.04, legW: 1.18, upperLegW: 1.1, hoofK: 1.6, neckW: 1.3, maneDown: 0.95, maneW: 0.12, neckAngle: 44, headLen: 1.12, headW: 1.02, muzzle: 1.18, earLen: 0.68, earW: 0.85, earTip: 0.4, tailLen: 0.48, tailW: 0.95, tailDroop: 1.4 },
      C: { coat: '#7b6b59', back: '#5e5244', belly: '#ece6da', white: '#ece6da', neck: '#d9d1c2', neckK: 0.75, mane: '#f2ede4', maneK: 1, face: '#3b3026', faceK: 0.9, headBase: '#5a4b3d', muzzle: '#c9bfae', muzzleK: 0.45, muzzleBand: 0, chinWhite: 0.6, eyeRing: 0.3, throat: 0,
        leg: '#3d3128', legLow: '#2c231c', legInner: 0.1, sock: 0.9, rump: { color: '#efe9de', k: 0.95, size: 0.9, top: 0.25 }, tailTop: '#e9e3d6', tailUnder: '#f2ede4', tailEdge: null, earOut: '#5e5244', earIn: '#cfc5b4', saddle: '#9a8a76', saddleK: 0.35, gland: 0 }, w: [160, 300] },
    f: { P: { S: 1.2, legK: 0.98, wideK: 1.04, depthK: 1.05, legW: 1.12, hoofK: 1.5, neckW: 1.08, maneDown: 0.55, neckAngle: 48, headLen: 1.08, headW: 0.96, muzzle: 1.12, earLen: 0.7, earW: 0.85, earTip: 0.4, tailLen: 0.48, tailW: 0.95, tailDroop: 1.4 },
      C: { coat: '#7d6e5d', back: '#625646', belly: '#ece6da', white: '#ece6da', neck: '#cfc6b6', neckK: 0.6, mane: '#ebe5d9', maneK: 0.85, face: '#43372c', faceK: 0.85, headBase: '#5f5042', muzzle: '#c9bfae', muzzleK: 0.45, muzzleBand: 0, chinWhite: 0.6, eyeRing: 0.3, throat: 0,
        leg: '#43362b', legLow: '#2c231c', legInner: 0.1, sock: 0.9, rump: { color: '#efe9de', k: 0.95, size: 0.9, top: 0.25 }, tailTop: '#e9e3d6', tailUnder: '#f2ede4', tailEdge: null, earOut: '#625646', earIn: '#cfc5b4', saddle: '#9a8a76', saddleK: 0.3, gland: 0 }, sizeK: 0.85, w: [80, 140] },
    gaits: ['walk', 'trot', 'gallop'], speeds: [2.3, 5.4], poses: { idle: [0, 0, 0], walk: [-0.22, -0.03, 0.12], run: [-0.36, -0.05, 0.26], alert: [0.15, 0.06, -0.1], graze: [-1.15, -0.4, 0.6] }, tailFlag: 0.5, tailLift: 1.3, lodDist: 54, furTints: ['#ffffff', '#f4efe8', '#e9e5df'],
    facts: ['The only deer where both bulls and cows grow antlers.', 'Their ankles make a clicking sound as they walk, keeping the herd together in blizzards.', 'Some herds migrate over 1,000 km a year, farther than any other land mammal.'],
    tips: ['Herds walk steadily in one direction: get ahead of them and wait.', 'Big bulls carry a forward "shovel" tine over the face.']
  };
  SPECIES.pronghorn = {
    fam: 'pronghorn', name: 'Pronghorn', rarity: 'uncommon', baseCash: 230, xp: 75, hp: 80, scoreUnit: 'in', rut: 'snort', stomp: true, bed: 0.2, drink: 0.08,
    speed: { walk: 1.7, run: 16 }, senses: { sight: 180, hearing: 60, smell: 80 }, group: [2, 6], habitats: ['golden_plains', 'red_rock_mesa'], spawn: { weight: 2.6, max: 7 },
    m: { P: { S: 0.92, legK: 1.08, lenK: 0.95, wideK: 0.92, depthK: 1.0, legW: 0.98, neckLen: 0.95, neckW: 0.98, neckAngle: 50, headLen: 0.9, headW: 0.98, muzzle: 0.95, eyeK: 1.55, earLen: 0.95, earW: 0.82, earTip: 0.8, tailLen: 0.38, tailW: 0.7 },
      C: { coat: '#c4864c', back: '#b1743d', belly: '#f4efe5', white: '#f4efe5', bellyK: 1, sideWhite: 0.9, face: '#9c6a3c', faceK: 0.6, muzzle: '#2a1e16', muzzleK: 0.7, muzzleBand: 0, chinWhite: 0.8, eyeRing: 0.25, throat: 0, bands: 0.95, cheek: 0.95, neckStripe: 0.7,
        leg: '#c88d55', legLow: '#8f6037', legInner: 0.6, rump: { color: '#f6f2ea', k: 1, size: 1.25, top: 0.3 }, tailTop: '#f2ece2', tailUnder: '#f6f2ea', tailEdge: null, earOut: '#b07a48', earIn: '#efe4d2', earTip: '#2a1e16', gland: 0 }, w: [45, 65] },
    f: { P: { S: 0.92, legK: 1.08, lenK: 0.95, wideK: 0.9, legW: 0.96, neckLen: 0.95, neckW: 0.92, neckAngle: 52, headLen: 0.88, headW: 0.95, muzzle: 0.94, eyeK: 1.5, earLen: 0.98, earW: 0.82, earTip: 0.8, tailLen: 0.38, tailW: 0.7 },
      C: { coat: '#c88d55', back: '#b57b45', belly: '#f4efe5', white: '#f4efe5', sideWhite: 0.9, face: '#a37445', faceK: 0.5, muzzle: '#3a2a1e', muzzleK: 0.6, muzzleBand: 0, chinWhite: 0.8, eyeRing: 0.25, throat: 0, bands: 0.9, cheek: 0, neckStripe: 0.3,
        leg: '#c88d55', legLow: '#8f6037', legInner: 0.6, rump: { color: '#f6f2ea', k: 1, size: 1.2, top: 0.3 }, tailTop: '#f2ece2', tailUnder: '#f6f2ea', tailEdge: null, earOut: '#b07a48', earIn: '#efe4d2', earTip: '#2a1e16', gland: 0 }, sizeK: 0.94, w: [35, 50] },
    gaits: ['walk', 'trot', 'gallop'], speeds: [2.3, 5.2], poses: { idle: [0, 0, 0], walk: [-0.18, -0.02, 0.1], run: [-0.4, -0.06, 0.3], alert: [0.2, 0.08, -0.12], graze: [-1.2, -0.4, 0.6] }, tailFlag: 0.3, tailLift: 1.0, lodDist: 44, furTints: ['#ffffff', '#fff4e8', '#f3ebe0'],
    facts: ['The fastest land animal in the Americas: sprints near 90 km/h.', 'Flares its white rump hairs as an alarm signal visible for kilometres.', 'Not a true antelope: its horn sheaths are shed every year.'],
    tips: ['Their eyesight is incredible: use terrain folds, not open ground.', 'A long, flat shot is often your only chance.']
  };
  SPECIES.bighorn_sheep = {
    fam: 'sheep', name: 'Bighorn Sheep', rarity: 'rare', baseCash: 400, xp: 120, hp: 140, scoreUnit: 'in', rut: 'clash', clash: true, cliff: true, bed: 0.3, drink: 0.05,
    speed: { walk: 1.3, run: 9 }, senses: { sight: 110, hearing: 60, smell: 80 }, group: [2, 5], habitats: ['frost_peaks', 'red_rock_mesa'], spawn: { weight: 1.5, max: 5 },
    m: { P: { S: 1.0, legK: 0.84, lenK: 0.98, wideK: 1.22, depthK: 1.14, upK: 1.06, hump: 0.02, legW: 1.25, upperLegW: 1.15, neckLen: 0.8, neckW: 1.55, maneDown: 0.2, neckAngle: 46, headLen: 0.92, headW: 1.15, headH: 1.12, roman: 0.022, muzzle: 1.05, earLen: 0.62, earW: 0.8, earTip: 0.6, earRot: [0.25, 0.2, -1.2], tailLen: 0.35, tailW: 0.7, tailDroop: 1.4 },
      C: { coat: '#7c6249', back: '#664f3b', belly: '#efe8dc', white: '#efe8dc', face: '#6a5340', faceK: 0.5, muzzle: '#ece4d6', muzzleK: 0.9, muzzleBand: 0, chinWhite: 0.9, eyeRing: 0.6, throat: 0,
        leg: '#6a5340', legLow: '#3a2e24', legInner: 0.5, legBack: 0.85, rump: { color: '#f1ebe0', k: 1, size: 1.3, top: 0.2 }, tailTop: '#4a3a2c', tailUnder: '#4a3a2c', tailEdge: null, earOut: '#6a5340', earIn: '#d8ccb8', gland: 0 }, w: [75, 140] },
    f: { P: { S: 1.0, legK: 0.86, wideK: 1.1, depthK: 1.06, legW: 1.15, neckLen: 0.86, neckW: 1.15, neckAngle: 50, headLen: 0.9, headW: 1.0, headH: 1.04, roman: 0.012, earLen: 0.68, earW: 0.82, earRot: [0.25, 0.2, -1.2], tailLen: 0.35, tailW: 0.7, tailDroop: 1.4 },
      C: { coat: '#866b52', back: '#6f5843', belly: '#efe8dc', white: '#efe8dc', face: '#73594a', faceK: 0.5, muzzle: '#ece4d6', muzzleK: 0.85, muzzleBand: 0, chinWhite: 0.9, eyeRing: 0.6, throat: 0,
        leg: '#73594a', legLow: '#3a2e24', legInner: 0.5, legBack: 0.85, rump: { color: '#f1ebe0', k: 1, size: 1.25, top: 0.2 }, tailTop: '#4a3a2c', tailUnder: '#4a3a2c', tailEdge: null, earOut: '#73594a', earIn: '#d8ccb8', gland: 0 }, sizeK: 0.82, w: [50, 85] },
    gaits: ['walk', 'trot', 'gallop'], speeds: [1.9, 4.6], poses: { idle: [0, 0, 0], walk: [-0.18, -0.02, 0.1], run: [-0.32, -0.05, 0.24], alert: [0.15, 0.06, -0.1], graze: [-0.95, -0.35, 0.5] }, tailFlag: 0, tailLift: 0.4, lodDist: 48, furTints: ['#ffffff', '#f2ece5', '#ece4dc'],
    facts: ['A ram\'s horns can weigh as much as the rest of its skeleton.', 'Rams rear up and crash heads at over 30 km/h; the crack echoes across canyons.', 'Lives on steep cliffs where predators cannot follow.'],
    tips: ['Spook them and they climb: shoot before they reach the rocks.', 'Count the curl: a full curl ram is the prize.']
  };
  SPECIES.mountain_goat = {
    fam: 'goat', name: 'Mountain Goat', rarity: 'rare', baseCash: 380, xp: 115, hp: 140, scoreUnit: 'in', rut: 'bleat', cliff: true, bed: 0.35, drink: 0.05,
    speed: { walk: 1.1, run: 7 }, senses: { sight: 100, hearing: 55, smell: 85 }, group: [1, 3], habitats: ['frost_peaks'], spawn: { weight: 1.6, max: 4 },
    m: { P: { S: 1.0, legK: 0.82, lenK: 0.96, wideK: 1.2, depthK: 1.28, upK: 1.08, hump: 0.09, legW: 1.32, upperLegW: 1.28, neckLen: 0.78, neckW: 1.45, maneUp: 0.35, maneDown: 0.25, neckAngle: 48, headLen: 1.0, headW: 0.88, headH: 0.98, muzzle: 0.95, earLen: 0.75, earW: 0.72, earTip: 0.75, earRot: [0.2, 0.2, -0.7], tailLen: 0.38, tailW: 0.8, tailDroop: 1.3 },
      C: { coat: '#e9e4d7', back: '#f1ede4', belly: '#ddd5c4', white: '#f4f1ea', face: '#ebe6db', faceK: 0.3, muzzle: '#dcd5c8', muzzleK: 0.3, nose: '#141110', muzzleBand: 0, chinWhite: 0, eyeRing: 0, throat: 0, leg: '#e6e0d2', legLow: '#d9d2c3', legLowK: 0.35, legInner: 0, rump: null, tailTop: '#ebe6db', tailUnder: '#e2dccf', tailEdge: null, earOut: '#e6e0d2', earIn: '#d9cfc0', earTip: '#d2cabb', hoof: '#151210', gland: 0, backK: 0.6 }, w: [70, 140] },
    f: { P: { S: 1.0, legK: 0.82, lenK: 0.94, wideK: 1.12, depthK: 1.22, upK: 1.06, hump: 0.06, legW: 1.25, upperLegW: 1.22, neckLen: 0.82, neckW: 1.25, maneUp: 0.25, neckAngle: 50, headLen: 0.98, headW: 0.86, earLen: 0.78, earW: 0.72, earTip: 0.75, earRot: [0.2, 0.2, -0.7], tailLen: 0.38, tailW: 0.8 },
      C: { coat: '#ebe6da', back: '#f2eee6', belly: '#ddd5c4', white: '#f4f1ea', face: '#ede8de', faceK: 0.3, muzzle: '#dcd5c8', muzzleK: 0.3, nose: '#141110', muzzleBand: 0, chinWhite: 0, eyeRing: 0, throat: 0, leg: '#e6e0d2', legLow: '#d9d2c3', legLowK: 0.35, legInner: 0, rump: null, tailTop: '#ebe6db', tailUnder: '#e2dccf', tailEdge: null, earOut: '#e6e0d2', earIn: '#d9cfc0', earTip: '#d2cabb', hoof: '#151210', gland: 0, backK: 0.6 }, sizeK: 0.9, w: [50, 85] },
    gaits: ['walk', 'trot', 'gallop'], speeds: [1.8, 4.2], poses: { idle: [0, 0, 0], walk: [-0.15, -0.02, 0.08], run: [-0.28, -0.04, 0.2], alert: [0.15, 0.05, -0.1], graze: [-0.9, -0.35, 0.5] }, tailFlag: 0, tailLift: 0.3, lodDist: 50, fur: { strokes: 15000, length: [9, 20], alpha: 0.32, seed: 41 }, furTints: ['#ffffff', '#fbf7ef', '#f4f0e6'],
    facts: ['Not a true goat: its closest relatives are wild antelopes of Asia.', 'Rubber-soled hooves grip near-vertical rock.', 'Both billies and nannies grow short black dagger horns.'],
    tips: ['Glass the cliffs for a white dot that moves.', 'Make the shot count: a goat on a ledge can fall far.']
  };
  SPECIES.bison = {
    fam: 'bison', name: 'Plains Bison', rarity: 'uncommon', baseCash: 420, xp: 120, hp: 380, scoreUnit: 'in', rut: 'bellow', bed: 0.35, drink: 0.15, stampede: true,
    temperament: 'calm', damage: 36, attackRange: 2.8, warnTime: 1.6,
    speed: { walk: 1.3, run: 10 }, senses: { sight: 40, hearing: 70, smell: 130 }, group: [4, 8], habitats: ['golden_plains'], spawn: { weight: 2.4, max: 9 },
    m: { P: { S: 1.55, legK: 0.78, lenK: 1.06, wideK: 1.3, depthK: 1.28, upK: 1.05, hump: 0.34, rumpDrop: 0.13, chestW: 1.18, hipW: 0.84, chestD: 1.1, legW: 1.35, upperLegW: 1.3, hoofK: 1.2, neckLen: 0.62, neckW: 2.0, maneUp: 0.3, maneDown: 0.35, neckAngle: 6, neckDrop: 0.08, headLen: 1.0, headW: 1.55, headH: 1.35, muzzle: 1.12, headPitch: -66, earLen: 0.5, earW: 0.8, earY: -0.01, earRot: [0.4, 0.2, -1.4], tailLen: 0.55, tailW: 0.35, tailH: 1.0, tailDroop: 1.55 },
      C: { coat: '#5e3f27', back: '#56391f', belly: '#3a2617', bellyK: 0.6, fore: '#36231a', foreK: 0.95, neck: '#2e1d12', neckK: 1, face: '#22160e', faceK: 1, headBase: '#2b1b11', muzzle: '#1e140d', muzzleK: 0.6, nose: '#120d09', muzzleBand: 0, chinWhite: 0, eyeRing: 0, throat: 0,
        leg: '#2d1d12', legLow: '#20150d', legInner: 0, rump: null, tailTop: '#2d1d12', tailUnder: '#2d1d12', tailTip: '#1a110b', tailEdge: null, earOut: '#2b1b11', earIn: '#4a3626', earTip: '#1a110b', gland: 0 }, w: [650, 1000] },
    f: { P: { S: 1.55, legK: 0.8, lenK: 1.02, wideK: 1.16, depthK: 1.18, hump: 0.24, rumpDrop: 0.1, chestW: 1.1, hipW: 0.86, legW: 1.25, upperLegW: 1.2, hoofK: 1.15, neckLen: 0.66, neckW: 1.65, maneUp: 0.22, maneDown: 0.25, neckAngle: 8, neckDrop: 0.06, headLen: 1.0, headW: 1.35, headH: 1.22, muzzle: 1.08, headPitch: -64, earLen: 0.55, earW: 0.8, earY: -0.01, earRot: [0.4, 0.2, -1.4], tailLen: 0.55, tailW: 0.35, tailDroop: 1.55 },
      C: { coat: '#674630', back: '#5c3e25', belly: '#3e2a1a', bellyK: 0.6, fore: '#3c271b', foreK: 0.9, neck: '#33211a', neckK: 1, face: '#2a1b12', faceK: 1, headBase: '#311f14', muzzle: '#1e140d', muzzleK: 0.6, nose: '#120d09', muzzleBand: 0, chinWhite: 0, eyeRing: 0, throat: 0,
        leg: '#33211a', legLow: '#20150d', legInner: 0, rump: null, tailTop: '#33211a', tailUnder: '#33211a', tailTip: '#1a110b', tailEdge: null, earOut: '#311f14', earIn: '#4a3626', earTip: '#1a110b', gland: 0 }, sizeK: 0.84, w: [350, 550] },
    gaits: ['walk', 'trot', 'gallop'], speeds: [2.2, 5.2], poses: { idle: [0, 0, 0], walk: [-0.06, 0, 0.04], run: [-0.12, 0, 0.1], alert: [0.18, 0.05, -0.06], graze: [-0.5, -0.25, 0.35] }, tailFlag: 0.4, tailLift: 1.2, lodDist: 70,
    fur: { strokes: 16000, length: [10, 24], alpha: 0.34, seed: 57 }, furTints: ['#ffffff', '#f0e8e0', '#e8e0d8'],
    facts: ['North America\'s heaviest land animal: a bull can top 900 kg.', 'Once numbered in the tens of millions; a shot can send a whole herd stampeding.', 'Wallows in dust to shed insects and shaggy winter wool.'],
    tips: ['Never stand in front of a running herd.', 'Shoot from the side, behind the massive shoulder hump.']
  };
  SPECIES.musk_ox = {
    fam: 'muskox', name: 'Musk Ox', rarity: 'rare', baseCash: 420, xp: 125, hp: 300, scoreUnit: 'in', rut: 'clash', clash: true, circle: true, bed: 0.3, drink: 0.05,
    temperament: 'calm', damage: 32, attackRange: 2.4, warnTime: 1.4,
    speed: { walk: 1.2, run: 8 }, senses: { sight: 55, hearing: 60, smell: 110 }, group: [3, 6], habitats: ['northern_tundra'], spawn: { weight: 1.5, max: 7 },
    m: { P: { S: 1.25, legK: 0.62, lenK: 0.95, wideK: 1.32, depthK: 1.55, upK: 1.18, hump: 0.14, legW: 1.3, upperLegW: 1.2, hoofK: 1.3, neckLen: 0.55, neckW: 1.75, maneUp: 0.45, maneDown: 0.65, neckAngle: 12, neckDrop: 0.05, headLen: 1.0, headW: 1.3, headH: 1.2, muzzle: 1.12, headPitch: -58, earLen: 0.35, earW: 0.6, earY: -0.02, tailLen: 0.25, tailW: 0.6 },
      C: { coat: '#2e231b', back: '#3a2c22', belly: '#241b15', bellyK: 0.5, saddle: '#a08b6f', saddleK: 0.85, face: '#2a2019', faceK: 0.7, headBase: '#3a2e24', muzzle: '#8d8274', muzzleK: 0.7, nose: '#1a1612', noseK: 0.7, muzzleBand: 0, chinWhite: 0, eyeRing: 0, throat: 0,
        leg: '#cfc6b5', legLow: '#ddd5c6', legLowK: 0.6, legInner: 0, rump: null, tailTop: '#2e231b', tailUnder: '#2e231b', tailEdge: null, earOut: '#2e231b', earIn: '#4a3c30', hoof: '#1f1a15', gland: 0 }, w: [270, 410] },
    f: { P: { S: 1.25, legK: 0.62, lenK: 0.94, wideK: 1.24, depthK: 1.5, upK: 1.15, hump: 0.11, legW: 1.24, upperLegW: 1.16, hoofK: 1.25, neckLen: 0.58, neckW: 1.6, maneUp: 0.4, maneDown: 0.6, neckAngle: 12, neckDrop: 0.05, headW: 1.2, headH: 1.12, muzzle: 1.08, headPitch: -58, earLen: 0.35, earW: 0.6, earY: -0.02, tailLen: 0.25, tailW: 0.6 },
      C: { coat: '#33271e', back: '#3e3025', belly: '#241b15', bellyK: 0.5, saddle: '#9a8569', saddleK: 0.75, face: '#2e231c', faceK: 0.7, headBase: '#3e3127', muzzle: '#8d8274', muzzleK: 0.7, nose: '#1a1612', noseK: 0.7, muzzleBand: 0, chinWhite: 0, eyeRing: 0, throat: 0,
        leg: '#cfc6b5', legLow: '#ddd5c6', legLowK: 0.6, legInner: 0, rump: null, tailTop: '#33271e', tailUnder: '#33271e', tailEdge: null, earOut: '#33271e', earIn: '#4a3c30', hoof: '#1f1a15', gland: 0 }, sizeK: 0.9, w: [180, 280] },
    gaits: ['walk', 'trot', 'gallop'], speeds: [2.0, 4.6], poses: { idle: [0, 0, 0], walk: [-0.06, 0, 0.04], run: [-0.12, 0, 0.1], alert: [0.15, 0.05, -0.06], graze: [-0.55, -0.25, 0.35] }, tailFlag: 0, tailLift: 0.2, lodDist: 60,
    fur: { strokes: 17000, length: [12, 28], alpha: 0.36, seed: 63 }, furTints: ['#ffffff', '#f2ece6', '#e9e2db'],
    facts: ['An Ice Age survivor whose under-wool, qiviut, is eight times warmer than sheep wool.', 'When threatened the herd forms a ring, horns facing out.', 'Bulls clash heads at full gallop during the rut.'],
    tips: ['A ring of musk oxen will not run: do not walk too close, a bull will charge.', 'Wait for one to step out of the ring for a clean broadside shot.']
  };
  var FAM_CALL = { deer: 'ww_grunt', elk: 'ww_bugle', moose: 'ww_moose', caribou: 'ww_caribou', pronghorn: 'ww_wheeze', sheep: 'ww_bleat', goat: 'ww_bleat', bison: 'ww_bison', muskox: 'ww_muskox' };
  var FAM_ALERT = { deer: 'deer_snort', elk: 'ww_elk_bark', moose: 'ww_moose_grunt', caribou: 'ww_caribou_grunt', pronghorn: 'ww_wheeze', sheep: 'ww_snort', goat: 'ww_snort', bison: 'ww_bison_grunt', muskox: 'ww_snort' };

  // ---- legendaries ----
  var LEGENDS = WW.legendaries;
  LEGENDS.ghost_elk = { base: 'elk', name: 'Ghost Elk', map: 'frost_peaks', aura: '#bfe8ff', cls: 'giant', gold: 25, cash: 1800, xp: 400, weight: [460, 520], sizeK: 1.12,
    C: { coat: '#ece8df', back: '#e3ddd1', belly: '#d6cfc1', neck: '#d9d2c4', neckK: 0.9, mane: '#cfc7b8', maneK: 0.8, face: '#d2cabb', headBase: '#ddd6c9', muzzle: '#9d958a', leg: '#cdc5b6', legLow: '#a59d90', rump: { color: '#f6f3ec', k: 0.6, size: 1.1, top: 0.55 }, tailTop: '#f2eee6', tailUnder: '#f2eee6', earOut: '#d6cfc2', earIn: '#efe8dc' },
    facts: ['A pure white bull said to walk the high passes only in falling snow.'], tips: ['Its pale coat vanishes against the snow: look for the dark eyes and antler tips.'] };
  LEGENDS.autumn_monarch = { base: 'whitetail_deer', name: 'Autumn Monarch', map: 'autumn_ridge', aura: '#ffb54d', cls: 'nontyp', gold: 20, cash: 1400, xp: 320, weight: [150, 175], sizeK: 1.15,
    C: { coat: '#8a5f3c', back: '#5e3d22', face: '#45301f' }, facts: ['A giant non-typical buck whose tangled rack has more points than anyone has managed to count.'], tips: ['He only moves at first and last light along the oak ridges.'] };
  LEGENDS.redwood_giant = { base: 'roosevelt_elk', name: 'Redwood Giant', map: 'redwood_canyon', aura: '#d8ff9a', cls: 'giant', gold: 25, cash: 1900, xp: 420, weight: [520, 580], sizeK: 1.12,
    C: { coat: '#8a6d4c', back: '#6b5236', neck: '#2a1c11' }, facts: ['A colossal Roosevelt bull with a crown of points, as old as the forest legends.'], tips: ['Listen for the deepest bugle in the canyon.'] };
  LEGENDS.desert_king = { base: 'bighorn_sheep', name: 'Desert King', map: 'red_rock_mesa', aura: '#ffd27a', cls: 'king', gold: 25, cash: 1700, xp: 380, weight: [140, 160], sizeK: 1.12,
    C: { coat: '#a88763', back: '#8d6d4c', face: '#9a7a58' }, facts: ['A desert bighorn ram whose horns curl more than a full turn.'], tips: ['He keeps to the highest red ledges at midday.'] };
  LEGENDS.tundra_ghost = { base: 'caribou', name: 'Tundra Ghost', map: 'northern_tundra', aura: '#c8f4ff', cls: 'giant', gold: 25, cash: 1700, xp: 380, weight: [290, 330], sizeK: 1.12,
    C: { coat: '#e7e3da', back: '#d9d4c9', neck: '#f4f1ea', face: '#cfc8bb', headBase: '#ddd7cc', leg: '#c9c2b5', legLow: '#9f988c', saddle: '#efebe3' }, facts: ['A white caribou bull that leads the migration, glimpsed for a moment and gone.'], tips: ['Get ahead of the herd and wait: the Ghost walks at the front.'] };
  LEGENDS.thunder_bison = { base: 'bison', name: 'Thunder Bison', map: 'golden_plains', aura: '#ffe08a', cls: 'm', gold: 30, cash: 2200, xp: 450, weight: [1050, 1200], sizeK: 1.15,
    C: { coat: '#4a3020', back: '#3f2817', fore: '#1f140d', neck: '#1a110b' }, facts: ['A colossal bull whose stampede sounds like a storm rolling over the plains.'], tips: ['When the ground shakes, find a rock and let the herd pass.'] };

  /* ------------------------------------------------------------------
   * 5. Templates + instancing
   * ------------------------------------------------------------------ */
  var _specCache = {};
  function getSpec(id, sex, legend) {
    var key = 'ww_' + id + '_' + sex + (legend ? '_' + legend : '');
    if (_specCache[key]) return _specCache[key];
    var sp = SPECIES[id], sx = sp[sex] || sp.m, L = legend ? LEGENDS[legend] : null;
    var spec = buildSpec(key, sx.P, L ? mix(sx.C, L.C) : sx.C);
    spec.fur = sp.fur || { strokes: 13000, length: [5, 12], alpha: 0.28 };
    spec.roughness = 0.87; spec.density = 2.6;
    spec.gaits = sp.gaits; spec.speeds = sp.speeds; spec.poses = sp.poses;
    spec.tailFlag = sp.tailFlag; spec.tailLift = sp.tailLift; spec.earFwd = 0.4; spec.lodDist = sp.lodDist || 50;
    _specCache[key] = spec;
    return spec;
  }
  function shagFor(id, tpl, spec) {
    var A = spec.anchors, S = A.S;
    if (id === 'bison') shag(tpl, function (x, y, z, nx, ny, nz, o) {
      var front = sm(A.zS + 0.15 * S, A.zC - 0.05 * S, z), up = sm(A.legLowY, A.belly + 0.05 * S, y);
      o[0] = front * up * 0.075 * S * (0.4 + 0.6 * sm(-0.8, 0.4, ny)); o[1] = front * sm(0.1, -0.6, ny) * up * 0.07 * S;
    }, 14 / S);
    else if (id === 'musk_ox') shag(tpl, function (x, y, z, nx, ny, nz, o) {
      var torso = sm(A.zR + 0.05 * S, A.zP, z) * sm(A.zCF - 0.2 * S, A.zC, z), low = sm(A.yC + 0.05 * S, A.belly + 0.05 * S, y);
      if (y < A.legLowY * 0.9) return;
      o[0] = (0.03 + 0.04 * low) * S * torso + 0.03 * S * sm(A.zC, A.zCF - 0.25 * S, z) * sm(A.belly, A.yC, y);
      o[1] = torso * low * sm(0.4, -0.5, ny) * 0.13 * S;
    }, 16 / S);
    else if (id === 'mountain_goat') shag(tpl, function (x, y, z, nx, ny, nz, o) {
      var under = sm(0.2, -0.6, ny) * sm(A.zR, A.zP, z), legs = sm(A.legLowY * 0.8, A.yElbow, y) * sm(A.belly + 0.02 * S, A.belly - 0.05 * S, y);
      var crest = sm(0.6, 0.95, ny) * sm(A.zS, A.zCF, z);
      o[0] = (under * 0.03 + legs * 0.035 + crest * 0.03) * S; o[1] = under * 0.05 * S + legs * 0.02 * S;
    }, 20 / S);
    else if (id === 'caribou') shag(tpl, function (x, y, z, nx, ny, nz, o) {
      var neck = sm(A.zCF + 0.05 * S, A.zCF - 0.12 * S, z) * sm(A.poll[1] - 0.05 * S, A.poll[1] - 0.25 * S, y);
      o[0] = neck * sm(0.2, -0.6, ny) * 0.035 * S; o[1] = neck * sm(0.0, -0.7, ny) * 0.06 * S;
    }, 18 / S);
    else if (id === 'elk' || id === 'roosevelt_elk') shag(tpl, function (x, y, z, nx, ny, nz, o) {
      var neck = sm(A.zCF + 0.05 * S, A.zCF - 0.1 * S, z) * sm(A.poll[1] - 0.03 * S, A.poll[1] - 0.2 * S, y);
      o[0] = neck * sm(0.2, -0.6, ny) * 0.02 * S; o[1] = neck * sm(0.0, -0.7, ny) * 0.028 * S;
    }, 18 / S);
  }
  function getTemplate(id, sex, legend) {
    var spec = getSpec(id, sex, legend), tpl = G.quadruped(spec);
    if (!tpl._ww) { tpl._ww = true; shagFor(id, tpl, spec); }
    return tpl;
  }
  var _auraMats = {};
  function auraMat(color) {
    if (_auraMats[color]) return _auraMats[color];
    var m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).convertSRGBToLinear(), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, skinning: true, fog: true });
    m.onBeforeCompile = function (sh) { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3( position ) + normal * 0.045;'); };
    m.userData.shared = true;
    _auraMats[color] = m;
    return m;
  }
  /** Build the parts for one instance. opts: spawn opts (leader, legendary, ww:{sex, cls}) */
  function buildAnimal(id, opts, legendId) {
    opts = opts || {};
    var sp = SPECIES[id], L = legendId ? LEGENDS[legendId] : null, lead = opts.leader && opts.leader.data && opts.leader.data.ww;
    var force = opts.ww || {}, sex = force.sex || choosesSex(id, opts, lead, L);
    if (L) sex = 'm';
    var tpl = getTemplate(id, sex, legendId), spec = tpl.spec, A = spec.anchors;
    var tints = sp.furTints || ['#ffffff'];
    var parts = G.spawnQuadruped(tpl, { tint: L ? null : tints[Math.floor(Math.random() * tints.length)] });
    var cls = force.cls || (L ? L.cls : chooseClass(id, sex, opts, lead)), seed = force.seed != null ? force.seed : Math.floor(Math.random() * 4);
    if (L) seed = 9;
    var w = { sex: sex, cls: cls, seed: seed, species: id, fam: sp.fam, legend: legendId || null, act: null, bedT: 0, bedK: 0, stomp: 0, kick: 0, callK: 0, sparK: 0, rearK: 0, shake: 0, flare: 0, hunch: 0, limp: 0, limpLeg: 1,
      rutT: 2 + Math.random() * 6, lastState: 'idle', score: 0, points: 0, label: '', hurtCD: 0, stampede: 0, circle: null, lure: null, auraT: 0 };
    parts.wwSeed = w;
    // ---- antlers / horns / extras ----
    var rk = null, mat = antlerMat();
    if (id === 'whitetail_deer' && sex === 'm') rk = attach(parts, tpl, 'head', 'wt_' + cls + '_' + seed, function () { return whitetailRack(A, cls, seed); }, mat);
    else if ((id === 'mule_deer' || id === 'blacktail_deer') && sex === 'm') rk = attach(parts, tpl, 'head', 'md_' + cls + '_' + seed, function () { return muleRack(A, cls, seed, id === 'blacktail_deer' ? 0.82 : 1); }, mat);
    else if ((id === 'elk' || id === 'roosevelt_elk') && sex === 'm') rk = attach(parts, tpl, 'head', 'elk_' + cls + '_' + seed, function () { return elkRack(A, cls, seed, id === 'roosevelt_elk'); }, mat);
    else if (id === 'moose' && sex === 'm') rk = attach(parts, tpl, 'head', 'mo_' + cls + '_' + seed, function () { return mooseRack(A, cls, seed); }, mat);
    else if (id === 'caribou') rk = attach(parts, tpl, 'head', 'ca_' + cls + '_' + seed, function () { return caribouRack(A, cls, seed); }, mat);
    else if (id === 'pronghorn') rk = attach(parts, tpl, 'head', 'ph_' + sex + '_' + seed, function () { return pronghornHorns(A, sex === 'm', seed); }, hornMat());
    else if (id === 'bighorn_sheep') rk = attach(parts, tpl, 'head', 'bh_' + (sex === 'm' ? cls : 'ewe') + '_' + seed, function () { return bighornHorns(A, cls, seed, sex !== 'm'); }, hornMat());
    else if (id === 'mountain_goat') rk = attach(parts, tpl, 'head', 'gt_' + sex + '_' + seed, function () { return goatHorns(A, sex === 'm', seed); }, hornMat());
    else if (id === 'bison') rk = attach(parts, tpl, 'head', 'bi_' + sex + '_' + seed, function () { return bisonHorns(A, sex === 'm', seed); }, hornMat());
    else if (id === 'musk_ox') rk = attach(parts, tpl, 'head', 'mx_' + sex + '_' + seed, function () { return muskoxHorns(A, sex === 'm', seed); }, hornMat());
    var info = rk && rk.userData.wwInfo;
    if (info) { w.points = info.points; w.rawScore = info.len * 2 / 0.0254 * 0.5 + info.spread * 2 / 0.0254 * 0.5 + info.mass * TAU / 0.0254 * 4; }
    // hair extras
    var hm = hairMat(spec);
    if (id === 'moose') attach(parts, tpl, 'head', 'bell_' + sex, function () {
      var p0 = A.hpos(0.06, -0.075), len = (sex === 'm' ? 0.32 : 0.14) * A.S / 1.62;
      var hi = tassel(p0, [0, p0[1] - len, p0[2] + 0.03 * A.S], 0.05 * A.S / 1.62, 0.07 * A.S / 1.62, '#2b211a', '#1b1410'), lo = tassel(p0, [0, p0[1] - len, p0[2] + 0.03 * A.S], 0.05 * A.S / 1.62, 0.07 * A.S / 1.62, '#2b211a', '#1b1410', 6);
      return { hi: hi, lo: lo };
    }, hm);
    if (id === 'mountain_goat') attach(parts, tpl, 'head', 'beard_' + sex, function () {
      var p0 = A.hpos(0.2, -0.05), len = (sex === 'm' ? 0.16 : 0.1) * A.S;
      return { hi: tassel(p0, [0, p0[1] - len, p0[2] + 0.04 * A.S], 0.06 * A.S, 0.05 * A.S, '#f0ebe0', '#e0d8c8'), lo: tassel(p0, [0, p0[1] - len, p0[2] + 0.04 * A.S], 0.06 * A.S, 0.05 * A.S, '#f0ebe0', '#e0d8c8', 6) };
    }, hm);
    if (id === 'bison') attach(parts, tpl, 'head', 'beard_' + sex, function () {
      var p0 = A.hpos(0.15, -0.06), len = (sex === 'm' ? 0.3 : 0.18) * A.S / 1.55;
      return { hi: tassel(p0, [0, p0[1] - len, p0[2] + 0.07 * A.S], 0.13 * A.S / 1.55, 0.1 * A.S / 1.55, '#2a1a10', '#1c120b'), lo: tassel(p0, [0, p0[1] - len, p0[2] + 0.07 * A.S], 0.13 * A.S / 1.55, 0.1 * A.S / 1.55, '#2a1a10', '#1c120b', 6) };
    }, hm);
    if (id === 'pronghorn') {
      var fl = attach(parts, tpl, 'pelvis', 'rumpflare', function () {
        var geos = [];
        [1, -1].forEach(function (sd) {
          var g = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5); g.rotateX(Math.PI / 2); g.scale(0.07 * A.S, 0.1 * A.S, 0.03 * A.S);
          g.rotateY(sd * 0.55); g.translate(sd * 0.055 * A.S, A.pelvis.p[1] - 0.02 * A.S, A.zR + 0.005 * A.S); geos.push(g);
        });
        var g2 = G.merge(geos); G.tint(g2, '#f7f3ea'); return { hi: g2 };
      }, hm);
      if (fl) { w.flareMesh = fl; fl.userData.base = fl.position.clone(); }
    }
    // legendary aura shell (shares the skeleton)
    if (L) {
      var am = new THREE.SkinnedMesh(tpl.geos[0], auraMat(L.aura));
      am.bind(parts.mesh.skeleton, parts.mesh.bindMatrix);
      am.frustumCulled = false; am.castShadow = false; am.renderOrder = 2; am.name = 'aura';
      parts.root.add(am); G.lodSwap(am, tpl.geos, [0, tpl.lodDist]);
      w.aura = am;
    }
    parts.animate = animateWW;
    return parts;
  }
  function choosesSex(id, opts, lead, L) {
    var r = Math.random(), sp = SPECIES[id];
    if (opts.buck || opts.bull || opts.ram || opts.male) return 'm';
    if (opts.doe || opts.cow || opts.ewe || opts.female) return 'f';
    if (opts.legendary) return 'm';
    if (!lead) { // group leader
      if (sp.harem) return 'm';
      if (id === 'bighorn_sheep') return r < 0.5 ? 'm' : 'f';
      if (id === 'moose') return r < 0.6 ? 'm' : 'f';
      return r < 0.5 ? 'm' : 'f';
    }
    if (sp.harem) return r < 0.1 ? 'm' : 'f';
    if (id === 'bighorn_sheep') return lead.sex === 'm' ? (r < 0.85 ? 'm' : 'f') : (r < 0.12 ? 'm' : 'f');
    if (id === 'caribou' || id === 'musk_ox') return r < 0.42 ? 'm' : 'f';
    if (id === 'bison') return r < 0.35 ? 'm' : 'f';
    return r < 0.28 ? 'm' : 'f';
  }
  function pickW(tab) { var tot = 0, k; for (k in tab) tot += tab[k]; var r = Math.random() * tot; for (k in tab) { r -= tab[k]; if (r <= 0) return k; } return k; }
  function chooseClass(id, sex, opts, lead) {
    var top = opts.legendary, young = !!lead && sex === 'm' && SPECIES[id].harem;
    if (id === 'whitetail_deer') return sex !== 'm' ? 'doe' : top ? '12pt' : young ? 'spike' : pickW({ spike: 15, fork: 20, '8pt': 30, '10pt': 22, '12pt': 13 });
    if (id === 'mule_deer' || id === 'blacktail_deer') return sex !== 'm' ? 'doe' : top ? '4x4+' : pickW({ '2x2': 25, '3x3': 30, '4x4': 33, '4x4+': 12 });
    if (id === 'elk' || id === 'roosevelt_elk') return sex !== 'm' ? 'cow' : top ? '7x7' : young ? (Math.random() < 0.6 ? 'spike' : 'rag') : pickW({ rag: 20, '5x5': 28, '6x6': 38, '7x7': 14 });
    if (id === 'moose') return sex !== 'm' ? 'cow' : top ? 'giant' : pickW({ young: 25, mature: 40, trophy: 28, giant: 7 });
    if (id === 'caribou') return sex !== 'm' ? 'cow' : top ? 'giant' : pickW({ young: 30, mature: 38, trophy: 25, giant: 7 });
    if (id === 'bighorn_sheep') return sex !== 'm' ? 'ewe' : top ? 'king' : pickW({ half: 18, three: 30, full: 35, broom: 17 });
    return sex === 'm' ? 'm' : 'f';
  }
  var CLASS_TABLES = { whitetail_deer: WT_CLASSES, mule_deer: MULE_CLASSES, blacktail_deer: MULE_CLASSES, elk: ELK_CLASSES, roosevelt_elk: ELK_CLASSES, moose: MOOSE_CLASSES, caribou: CARIBOU_CLASSES, bighorn_sheep: SHEEP_CLASSES };
  var SEX_LABEL = { deer: ['Buck', 'Doe'], elk: ['Bull', 'Cow'], moose: ['Bull', 'Cow'], caribou: ['Bull', 'Cow'], pronghorn: ['Buck', 'Doe'], sheep: ['Ram', 'Ewe'], goat: ['Billy', 'Nanny'], bison: ['Bull', 'Cow'], muskox: ['Bull', 'Cow'] };
  var SCORE_K = { whitetail_deer: 0.95, mule_deer: 1.05, blacktail_deer: 0.95, elk: 0.82, roosevelt_elk: 0.8, moose: 1, caribou: 0.8, pronghorn: 1.1, bighorn_sheep: 0.92, mountain_goat: 1.15, bison: 1.0, musk_ox: 1.0 };

  /** def.init: per-sex weight + scale, labels, trophy score */
  function initWW(a) {
    var w = a.parts && a.parts.wwSeed; if (!w) return;
    a.data.ww = w; delete a.parts.wwSeed;
    var sp = SPECIES[w.species], sx = sp[w.sex] || sp.m, L = w.legend ? LEGENDS[w.legend] : null;
    var ct = CLASS_TABLES[w.species], cl = ct && ct[w.cls];
    var wr = L ? L.weight : (cl && cl.w) || sx.w, wf = L ? 0.5 + Math.random() * 0.5 : Math.pow(Math.random(), 1.4);
    if (a.data.forceWeight) wf = clamp((a.data.forceWeight - wr[0]) / (wr[1] - wr[0]), 0, 1);
    a.weight = Math.round((wr[0] + (wr[1] - wr[0]) * wf) * 10) / 10;
    var dw = a.def.weightRange; a.weightFrac = clamp((a.weight - dw[0]) / (dw[1] - dw[0]), 0, 1);
    var sxr = (sx.w[0] + sx.w[1]) / 2, sizeK = (sx.sizeK || 1) * Math.pow(a.weight / sxr, 1 / 3) * (L ? L.sizeK || 1.12 : 1);
    a.scale = clamp(sizeK, 0.6, 1.5);
    a.root.scale.setScalar(a.scale);
    var names = SEX_LABEL[w.fam] || ['Male', 'Female'];
    w.label = L ? L.name : (cl && w.sex === 'm' ? cl.label + ' ' + names[0].toLowerCase() : names[w.sex === 'm' ? 0 : 1]);
    if (w.rawScore) w.score = Math.round(w.rawScore * (SCORE_K[w.species] || 1) * a.scale * 10) / 10;
    a.data.label = w.label;
    if (L) a.keep = true;
  }

  /* ------------------------------------------------------------------
   * 6. Animation layer (runs after the core quadruped animator)
   * ------------------------------------------------------------------ */
  var LEGS4 = ['FL', 'FR', 'BL', 'BR'];
  var _warned = false;
  function animateWW(a, dt) {
    G.anim.quadruped(a, dt);
    try { postAnimate(a, dt); } catch (e) { if (!_warned) { _warned = true; console.warn('[animals] post-animate', e); } }
  }
  function dampTo(v, t, l, dt) { return t + (v - t) * Math.exp(-l * dt); }
  function postAnimate(a, dt) {
    var w = a.data.ww; if (!w) return;
    var B = a.parts.rig.bones, C = a.parts.cfg, rx = a.hitReaction, t = HG.time + a.id * 1.37;
    var calm = a.state === 'idle' || a.state === 'graze';
    // blends
    w.bedK = dampTo(w.bedK, (w.bedT > 0 && a.state === 'idle') || (rx && rx.active && rx.phase === 'bed') ? 1 : 0, w.bedT > 0 ? 1.6 : 6, dt);
    w.callK = dampTo(w.callK, w.act && w.act.type === 'call' && w.act.t > 0.2 && w.act.t < w.act.dur - 0.4 ? 1 : 0, 4, dt);
    w.sparK = dampTo(w.sparK, w.act && (w.act.type === 'spar' || (w.act.type === 'clash' && w.act.phase !== 'back')) ? 1 : 0, 5, dt);
    w.rearK = dampTo(w.rearK, w.act && w.act.type === 'clash' && w.act.phase === 'rear' ? 1 : 0, 7, dt);
    w.hunch = dampTo(w.hunch, rx && rx.active && rx.type === 'gut' ? 1 : 0, 3, dt);
    w.limp = dampTo(w.limp, (rx && rx.type === 'leg' && !rx.healed) ? 1 : 0, 4, dt);
    var bed = w.bedK, k;
    // bedding: fold the legs, lower the body (head stays up)
    if (bed > 0.01) {
      for (var l = 0; l < 4; l++) {
        var id = LEGS4[l], front = l < 2;
        B[id + '_hip'].rotation.x = B[id + '_hip'].rotation.x * (1 - bed) + (front ? 0.35 : -0.25) * bed;
        B[id + '_knee'].rotation.x = B[id + '_knee'].rotation.x * (1 - bed) + (front ? 0.55 : -0.9) * bed;
        B[id + '_hock'].rotation.x = B[id + '_hock'].rotation.x * (1 - bed) + (front ? -1.75 : 1.5) * bed;
        B[id + '_hoof'].rotation.x = B[id + '_hoof'].rotation.x * (1 - bed) + (front ? -0.5 : -0.4) * bed;
      }
      B.pelvis.position.y -= C.bellyH * 0.8 * bed;
      B.root.rotation.x *= 1 - bed;
    }
    // alert stomp
    if (w.stomp > 0) {
      var u = 1.6 - w.stomp, lift = w.stomp > 0.15 ? Math.pow(Math.abs(Math.sin(u * Math.PI / 0.55)), 2) : 0;
      B.FR_hip.rotation.x += 0.28 * lift; B.FR_knee.rotation.x += 0.3 * lift; B.FR_hock.rotation.x -= 1.25 * lift; B.FR_hoof.rotation.x -= 0.55 * lift;
    }
    // mule kick (heart shot)
    if (w.kick > 0) {
      k = Math.sin(clamp(w.kick / 0.55, 0, 1) * Math.PI);
      B.BL_hip.rotation.x -= 1.0 * k; B.BR_hip.rotation.x -= 1.05 * k; B.BL_hock.rotation.x -= 0.7 * k; B.BR_hock.rotation.x -= 0.7 * k;
      rootPivot(B, -0.22 * k, C.frontZ);
    } else if (w.rearK > 0.01) rootPivot(B, 0.5 * w.rearK, C.hindZ);
    else { B.root.position.y = 0; B.root.position.z = 0; }
    // gut shot: hunched back, head low, tail tucked
    if (w.hunch > 0.01) { k = w.hunch; B.spine.rotation.x += 0.14 * k; B.chest.rotation.x -= 0.12 * k; B.neck1.rotation.x -= 0.35 * k; if (B.tail1) B.tail1.rotation.x += 0.35 * k; }
    // leg hit: carry the leg
    if (w.limp > 0.01 && a.speed > 0.1) {
      k = w.limp; var lid = LEGS4[w.limpLeg || 0], fr = (w.limpLeg || 0) < 2;
      B[lid + '_hip'].rotation.x *= 1 - 0.6 * k;
      B[lid + '_knee'].rotation.x += (fr ? 0.25 : -0.3) * k; B[lid + '_hock'].rotation.x += (fr ? -0.9 : 0.75) * k; B[lid + '_hoof'].rotation.x -= 0.4 * k;
      B.root.rotation.z += Math.sin(a.parts.state.phase * TAU) * 0.05 * k * ((w.limpLeg % 2) ? 1 : -1);
    }
    // lung shot standing: wobble
    if (rx && rx.active && rx.phase === 'stand') { B.root.rotation.z += Math.sin(t * 2.6) * 0.04 * clamp(rx.t / 10, 0.3, 1); B.neck1.rotation.x -= 0.25; }
    // call / bugle: head up, nose high
    if (w.callK > 0.01) { k = w.callK; var hi = w.fam === 'bison' || w.fam === 'muskox' ? 0.3 : 1; B.neck1.rotation.x += 0.28 * k * hi; B.neck2.rotation.x += 0.22 * k * hi; B.head.rotation.x += 0.75 * k * hi; B.head.rotation.y = 0; B.neck1.rotation.y *= 1 - k; }
    // sparring: heads low, antlers forward, legs braced
    if (w.sparK > 0.01) {
      k = w.sparK; var push = w.act && w.act.type === 'spar' ? Math.sin(t * 5) * 0.08 : 0;
      B.neck1.rotation.x = B.neck1.rotation.x * (1 - k) + (-0.55 + push) * k; B.neck2.rotation.x = B.neck2.rotation.x * (1 - k) - 0.1 * k; B.head.rotation.x = B.head.rotation.x * (1 - k) + 0.25 * k;
      B.neck1.rotation.y *= 1 - k; B.head.rotation.y = Math.sin(t * 3.1) * 0.15 * k * (w.act && w.act.type === 'spar' ? 1 : 0);
      B.FL_hip.rotation.x += 0.12 * k; B.FR_hip.rotation.x += 0.12 * k; B.BL_hip.rotation.x -= 0.18 * k; B.BR_hip.rotation.x -= 0.18 * k;
    }
    if (w.shake > 0) { B.head.rotation.z += Math.sin(w.shake * 30) * 0.18 * w.shake; B.neck2.rotation.y += Math.sin(w.shake * 26) * 0.1 * w.shake; }
    // stotting (mule deer bound): whole body leaves the ground
    if (a.def.wwStott) {
      var ps = a.parts.state, bk = ps.w2 / Math.max(1e-3, ps.w0 + ps.w1 + ps.w2);
      a.bob = bk > 0.05 ? bk * Math.pow(Math.max(0, Math.sin(ps.phase * TAU + 0.3)), 1.4) * 0.42 * a.scale : 0;
    }
    // pronghorn rump flare
    if (w.flareMesh) {
      w.flare = dampTo(w.flare, a.state === 'flee' || a.state === 'alert' ? 1 : 0, 6, dt);
      var fs = 1 + 0.55 * w.flare; w.flareMesh.scale.set(fs, fs, 1 + 0.8 * w.flare);
    }
    if (w.aura) w.aura.material.opacity = 0.13 + 0.06 * Math.sin(t * 2.2);
  }
  /** rotate the root bone by th (x) about a pivot at model z = zp on the ground */
  function rootPivot(B, th, zp) { B.root.rotation.x += th; B.root.position.y = zp * Math.sin(th); B.root.position.z = zp * (1 - Math.cos(th)); }

  /* ------------------------------------------------------------------
   * 7. Behaviour layer (def.update): reactions, rut, bedding, herds
   * ------------------------------------------------------------------ */
  var T = HG.terrain;
  function okGround(x, z, steep) { return T.inBounds(x, z, 6) && !T.isWater(x, z) && T.slopeAt(x, z) < (steep ? 1.6 : 1.1); }
  /** move like core's moveAnimal, but driven by us */
  function drive(a, goalYaw, speed, turn, dt) {
    a.goalYaw = goalYaw;
    a.yaw = U.wrap(a.yaw + clamp(U.angleDiff(a.yaw, goalYaw), -turn * dt, turn * dt));
    a.moveSpeed = speed;
    a.speed = U.damp(a.speed, speed, speed > a.speed ? 3.5 : 5, dt);
    if (a.speed > 0.02) {
      var nx = a.pos.x - Math.sin(a.yaw) * a.speed * dt, nz = a.pos.z - Math.cos(a.yaw) * a.speed * dt;
      if (T.isWater(nx, nz) || !T.inBounds(nx, nz, 4)) {
        a.yaw += (a.id % 2 ? 1 : -1) * 2.5 * dt; a.speed *= 0.5;
        if (!T.inBounds(nx, nz, 4)) a.yaw += U.angleDiff(a.yaw, U.yawTo(a.pos.x, a.pos.z, 0, 0)) * Math.min(1, dt * 3);
      } else { a.pos.x = nx; a.pos.z = nz; HG.colliders.resolve(a.pos, (a.def.radius || 0.45) * a.scale, null); }
    }
    a.pos.y = T.heightAt(a.pos.x, a.pos.z) + (a.bob || 0);
    a.root.rotation.y = a.yaw;
    return true;
  }
  function hold(a, faceYaw, dt) { return drive(a, faceYaw == null ? a.yaw : faceYaw, 0, 2.2, dt); }
  /** flee heading away from p, probing for good ground */
  function awayYaw(a, px, pz, steep) {
    var fy = U.yawTo(px, pz, a.pos.x, a.pos.z);
    for (var i = 0; i < 6; i++) {
      var x = a.pos.x - Math.sin(fy) * 8, z = a.pos.z - Math.cos(fy) * 8;
      if (okGround(x, z, steep)) return fy;
      fy += (i % 2 ? -1 : 1) * (0.6 + i * 0.35);
    }
    return fy;
  }
  function isCalm(a) { return a.state === 'idle' || a.state === 'graze' || a.state === 'wander'; }
  function sameFam(a, b) { return b.data && b.data.ww && b.data.ww.fam === a.data.ww.fam && b.type === a.type; }

  // ---- hit reactions ----
  var REACT = WW.reactions = {
    heart: { label: 'Heart', gait: 'mule-kick then sprint', trail: 0.9, bleedTime: [6, 10], toast: 'Heart hit: it mule-kicked! It will not go far.' },
    lungs: { label: 'Double lung', gait: 'runs hard, then slows', trail: 1, bleedTime: [12, 18], toast: 'Lung hit: watch where it goes, then follow the blood.' },
    liver: { label: 'Liver', gait: 'runs, then beds down', trail: 0.6, bleedTime: [28, 40], toast: 'Liver hit: give it time, then track it.' },
    gut: { label: 'Gut', gait: 'hunched slow walk', trail: 0.25, bleedTime: [60, 90], toast: 'Gut shot: it hunched up. Track slowly.' },
    neck: { label: 'Neck', gait: 'bolts hard', trail: 0.75, bleedTime: [18, 26], toast: 'Neck hit!' },
    leg: { label: 'Leg', gait: 'limp', trail: 0.5, bleedTime: null, toast: null },
    head: { label: 'Head graze', gait: 'staggers, then runs', trail: 0.35, bleedTime: null, toast: 'Grazed it! It is running.' },
    body: { label: 'Body', gait: 'runs', trail: 0.4, bleedTime: null, toast: null },
    hams: { label: 'Hindquarter', gait: 'runs, slight limp', trail: 0.55, bleedTime: [70, 100], toast: null }
  };
  var _zw = new THREE.Vector3();
  function subZone(a, zone, point) {
    var zs = a.def.hitZones, best = null, bd = Infinity;
    for (var i = 0; i < zs.length; i++) {
      var z = zs[i]; if (z.name !== zone) continue;
      if (!point) { if (!best || (z.mult || 1) > (best.mult || 1)) best = z; continue; }
      HG.zoneWorld(a, z, _zw);
      var d = _zw.distanceTo(point) / Math.max(0.05, z.radius * a.scale);
      if (d < bd) { bd = d; best = z; }
    }
    return best ? (best.sub || best.name) : zone;
  }
  function onHit(a, zone, dmg, info) {
    var w = a.data.ww; if (!w || a.dead || a._wwBleedKill) return;
    var sub = subZone(a, zone, info && info.point), R = REACT[sub] || REACT.body;
    w.act && endAct(a, w);
    if (w.bedT > 0) w.bedT = 0;
    var prev = a.hitReaction, sev = { heart: 9, lungs: 8, neck: 7, liver: 6, gut: 4, hams: 3, leg: 2, head: 1, body: 0 };
    var rx = { type: sub, zone: zone, label: R.label, gait: R.gait, trail: R.trail, t: 0, phase: 'start', active: true, bleed: 0, side: 1, leg: -1, healed: false, passive: false, local: null, distance: info && info.distance };
    if (info && info.point) { var lp = a.root.worldToLocal(info.point.clone()); rx.local = [lp.x, lp.y, lp.z]; rx.side = lp.x >= 0 ? 1 : -1; }
    if (sub === 'leg' && rx.local) { var front = rx.local[2] < (a.def._midZ || 0); rx.leg = (front ? 0 : 2) + (rx.local[0] >= 0 ? 1 : 0); w.limpLeg = rx.leg; }
    if (prev && prev.active && (sev[prev.type] || 0) > (sev[sub] || 0)) { prev.bleed += R.bleedTime ? a.maxHp / R.bleedTime[1] * 0.5 : 0; prev.extraHit = sub; HG.emit('animals:hitReaction', a, prev); return; }
    if (R.bleedTime) rx.bleed = Math.max(0.5, a.hp) / U.rand(R.bleedTime[0], R.bleedTime[1]);
    if (sub === 'heart') w.kick = 0.55;
    if (w.circle || a.state === 'warn' || a.state === 'charge' || a.state === 'retreat') rx.passive = true;
    if (prev && prev.type === 'leg' && sub !== 'leg') rx.limpToo = true;
    a.hitReaction = rx;
    if (R.toast && HG.state === 'hunt' && a.hp > 0) HG.ui.toast(R.toast, { color: 'var(--cream-2)', duration: 2.2 });
    HG.emit('animals:hitReaction', a, rx);
    if (w.fam === 'bison') startStampede(a);
    if (w.circle && w.fam === 'muskox') w.circle.t = Math.min(w.circle.t, 5);
    // wounded bulls of the big species sometimes turn and charge
    if ((w.fam === 'bison' || w.fam === 'moose') && w.sex === 'm' && a.hp > a.maxHp * 0.4 && a.distToPlayer < 45 && Math.random() < 0.35 && sub !== 'heart') {
      rx.passive = true; HG.setAnimalState(a, 'warn');
    }
  }
  function reactionUpdate(a, w, rx, dt) {
    rx.t += dt;
    if (w.kick > 0) w.kick -= dt;
    // bleeding out
    if (rx.bleed > 0 && HG.state === 'hunt') {
      a.hp -= rx.bleed * dt;
      if (a.hp <= 0) { a._wwBleedKill = true; rx.active = false; HG.killAnimal(a, rx.zone); bleedToast(a); return true; }
    }
    if (rx.passive) { if (rx.t > 20 && !rx.bleed) rx.active = false; return false; }
    var sp = a.def.speed, run = sp.run, walk = sp.walk, steep = !!a.def.wwCliff, near = a.distToPlayer < 28 && a.awareness > 0.9;
    var tx = a.threat.x, tz = a.threat.z;
    if (!rx.fy || Math.random() < dt * 0.8) rx.fy = awayYaw(a, tx, tz, steep);
    var zig = Math.sin(rx.t * 1.3 + a.id) * 0.25, ph = rx.phase;
    function setPh(p, st) { rx.phase = p; if (st && a.state !== st) HG.setAnimalState(a, st, 'hit'); }
    switch (rx.type) {
      case 'heart':
        if (rx.t < 0.55) return hold(a, null, dt);
        if (ph !== 'run') setPh('run', 'flee');
        return drive(a, rx.fy + zig * 0.5, run * 1.12, 3.5, dt);
      case 'lungs':
        if (rx.t < 4.5 || near) { if (ph !== 'run') setPh('run', 'flee'); return drive(a, rx.fy + zig, run * 1.05, 3.5, dt); }
        if (rx.t < 13) { if (ph !== 'slow') setPh('slow', 'wounded'); return drive(a, rx.fy + zig, U.lerp(run * 0.8, walk * 0.8, (rx.t - 4.5) / 8.5), 2, dt); }
        if (ph !== 'stand') setPh('stand', 'wounded');
        return hold(a, null, dt);
      case 'liver': case 'neck': case 'hams':
        if (rx.t < 6 || near) { if (ph !== 'run') setPh('run', 'flee'); return drive(a, rx.fy + zig, run * (rx.type === 'neck' ? 1.05 : 0.85), 3.2, dt); }
        if (rx.t < 22) { if (ph !== 'walk') setPh('walk', 'wounded'); return drive(a, rx.fy + zig * 1.5, walk * 0.75, 1.5, dt); }
        if (ph !== 'bed') setPh('bed', 'wounded');
        return hold(a, null, dt);
      case 'gut':
        if (rx.t < 1.2) return hold(a, null, dt);
        if (near && rx.t > 3) { if (ph !== 'run') setPh('run', 'flee'); return drive(a, rx.fy + zig, run * 0.55, 2.5, dt); }
        if (rx.t < 34) { if (ph !== 'walk') setPh('walk', 'wounded'); return drive(a, rx.fy + zig * 1.5, walk * 0.55, 1.3, dt); }
        if (ph !== 'bed') setPh('bed', 'wounded');
        return hold(a, null, dt);
      case 'leg':
        if (rx.t < 12 || near) { if (ph !== 'run') setPh('run', 'flee'); return drive(a, rx.fy + zig, run * 0.62, 3, dt); }
        rx.active = false; if (a.state !== 'wounded') HG.setAnimalState(a, 'wounded', 'hit');
        return false;
      case 'head':
        if (rx.t < 1.0) { a.root.rotation.z = Math.sin(rx.t * 18) * 0.06 * (1 - rx.t); return hold(a, a.yaw + Math.sin(rx.t * 9) * 0.6, dt); }
        a.root.rotation.z = 0; rx.active = false; if (a.state !== 'flee') HG.setAnimalState(a, 'flee', 'hit');
        return false;
      default:
        rx.active = rx.bleed > 0 && rx.t < 2; return false;
    }
  }
  var _bt = 0;
  function bleedToast(a) {
    if (HG.state !== 'hunt' || HG.realTime - _bt < 2) return; _bt = HG.realTime;
    HG.ui.toast((a.def.name || 'Animal') + ' went down ' + Math.round(a.distToPlayer) + ' m away: follow the trail!', { color: 'var(--amber-2)', duration: 3 });
  }

  // ---- rut, calls, sparring, ram clashes ----
  function startAct(a, type, o) { var w = a.data.ww; w.act = { type: type, t: 0, dur: (o && o.dur) || 3, partner: o && o.partner, fight: o && o.fight, phase: o && o.phase }; if (a.state === 'wander') HG.setAnimalState(a, 'idle'); }
  function endAct(a, w) {
    var f = w.act && w.act.fight;
    w.act = null;
    if (f && !f.done) { f.done = true; var o = f.a === a ? f.b : f.a; if (o && o.data.ww && o.data.ww.act && o.data.ww.act.fight === f) o.data.ww.act = null; }
  }
  function playCall(a) {
    var w = a.data.ww, snd = FAM_CALL[w.fam];
    if (w.fam === 'elk' && w.sex !== 'm') snd = 'ww_mew';
    if (w.fam === 'deer' && w.sex !== 'm') snd = 'ww_doebleat';
    if (w.fam === 'moose' && w.sex !== 'm') snd = 'ww_moose_cow';
    HG.sfx(snd, { pos: a.pos, freq: w.legend ? 0.85 : (0.92 + Math.random() * 0.16) });
    HG.emit('animals:call', a, snd);
  }
  function rutTick(a, w) {
    if (!isCalm(a) || a.wounded || HG.state !== 'hunt' || w.circle) return;
    var sp = SPECIES[w.species];
    // rival nearby?
    if (w.sex === 'm' && (w.points || w.fam === 'bison' || w.fam === 'muskox' || w.fam === 'sheep') && w.cls !== 'spike') {
      var best = null, bd = 32;
      for (var i = 0; i < HG.animals.length; i++) {
        var b = HG.animals[i]; if (b === a || b.dead || !sameFam(a, b)) continue;
        var bw = b.data.ww; if (bw.sex !== 'm' || bw.act || !isCalm(b) || b.wounded || bw.circle || bw.cls === 'spike' || bw.bedT > 0) continue;
        var d = U.dist2D(a.pos.x, a.pos.z, b.pos.x, b.pos.z); if (d < bd) { bd = d; best = b; }
      }
      if (best && Math.random() < 0.35) { startFight(a, best); return; }
    }
    var callP = w.sex === 'm' ? 0.16 : 0.04;
    if (sp.rut === 'clash' && w.sex !== 'm') callP = 0.02;
    if (Math.random() < callP && a.distToPlayer < 260) {
      w.bedT = 0; startAct(a, 'call', { dur: w.fam === 'elk' ? 3.2 : 2.2 }); playCall(a);
      // rivals answer and come looking
      for (var j = 0; j < HG.animals.length; j++) {
        var c = HG.animals[j]; if (c === a || c.dead || !sameFam(a, c)) continue;
        var cw = c.data.ww; if (cw.sex !== 'm' || w.sex !== 'm' || cw.act || !isCalm(c)) continue;
        var dd = U.dist2D(a.pos.x, a.pos.z, c.pos.x, c.pos.z);
        if (dd < 170 && Math.random() < 0.45) { cw.answerT = 1.2 + Math.random() * 2; cw.answerTo = a; }
      }
    }
  }
  function startFight(a, b) {
    var f = { a: a, b: b, t: 0, round: 0, rounds: SPECIES[a.data.ww.species].clash ? 2 + Math.floor(Math.random() * 2) : 1, done: false, clash: !!SPECIES[a.data.ww.species].clash, phase: 'approach' };
    var dur = 5 + Math.random() * 4;
    [a, b].forEach(function (x) { x.data.ww.bedT = 0; startAct(x, f.clash ? 'clash' : 'spar', { dur: dur, partner: x === a ? b : a, fight: f, phase: 'approach' }); });
    if (!f.clash) { a.data.ww.act.type = 'approach'; b.data.ww.act.type = 'approach'; }
  }
  function reach(a) { return (a.def._noseZ || 1) * a.scale; }
  function actUpdate(a, w, dt) {
    var act = w.act; act.t += dt;
    var p = act.partner;
    if (act.type === 'call') { if (act.t > act.dur) w.act = null; return hold(a, null, dt); }
    if (!p || p.dead || p.removed || !p.data.ww || !p.data.ww.act || p.data.ww.act.fight !== act.fight) { w.act = null; return false; }
    var f = act.fight, dx = p.pos.x - a.pos.x, dz = p.pos.z - a.pos.z, d = Math.sqrt(dx * dx + dz * dz), face = U.yawTo(a.pos.x, a.pos.z, p.pos.x, p.pos.z), rr = (reach(a) + reach(p)) * 0.95;
    var lead = f.a === a;
    if (act.type === 'approach') {
      if (d > rr + 0.15) return drive(a, face, a.def.speed.walk * 1.35, 2.5, dt);
      act.type = 'spar'; act.t = 0; if (lead) f.t = 0;
      return hold(a, face, dt);
    }
    if (act.type === 'spar') {
      if (lead) {
        f.t += dt; f.clk = (f.clk || 0) - dt;
        if (f.clk <= 0) { f.clk = 0.5 + Math.random() * 0.9; HG.sfx('ww_clack', { pos: a.pos, freq: 0.85 + Math.random() * 0.3 }); }
        if (f.t > act.dur) { finishFight(f); return hold(a, face, dt); }
      }
      if (d > rr + 0.3) return drive(a, face, a.def.speed.walk, 2.5, dt);
      var push = Math.sin(HG.time * 1.6 + (lead ? 0 : Math.PI)) * 0.25;
      return drive(a, face, d < rr - 0.1 ? 0 : Math.max(0, push), 3, dt);
    }
    // ram/musk-ox clash rounds: back off -> rear -> rush -> crash
    if (lead) {
      f.t += dt;
      if (f.phase === 'approach' && (d < rr * 2.2 || f.t > 8)) { f.phase = 'back'; f.t = 0; }
      else if (f.phase === 'back' && (d > rr * 3.2 + 3 || f.t > 3.5)) { f.phase = 'rear'; f.t = 0; }
      else if (f.phase === 'rear' && f.t > 0.65) { f.phase = 'rush'; f.t = 0; }
      else if (f.phase === 'rush' && (d < rr + 0.1 || f.t > 4)) {
        f.phase = 'crash'; f.t = 0; f.round++;
        HG.sfx('ww_crack', { pos: a.pos, volume: 1.4 });
        HG.emit('animals:clash', a, p);
        a.data.ww.shake = 1; p.data.ww.shake = 1;
        if (HG.particles && a.distToPlayer < 90) { _zw.set((a.pos.x + p.pos.x) / 2, a.pos.y + 0.8 * a.scale, (a.pos.z + p.pos.z) / 2); HG.particles.emit(_zw, 6, { color: 0xc9b89a, speed: 1.6, up: 1, life: 0.6 }); }
      } else if (f.phase === 'crash' && f.t > 1.4) { if (f.round >= f.rounds) { finishFight(f); return hold(a, face, dt); } f.phase = 'back'; f.t = 0; }
    }
    act.phase = f.phase;
    if (w.shake > 0) w.shake = Math.max(0, w.shake - dt);
    switch (f.phase) {
      case 'approach': return drive(a, face, a.def.speed.walk * 1.2, 2.5, dt);
      case 'back': return drive(a, face + Math.PI, a.def.speed.walk * 1.1, 3, dt);
      case 'rear': return hold(a, face, dt);
      case 'rush': return drive(a, face, Math.min(a.def.speed.run * 0.65, 7), 4, dt);
      default: return hold(a, face, dt);
    }
  }
  function finishFight(f) {
    if (f.done) return; f.done = true;
    var win = f.a.weight >= f.b.weight ? f.a : f.b, lose = win === f.a ? f.b : f.a;
    [f.a, f.b].forEach(function (x) { if (x.data.ww) { x.data.ww.act = null; x.data.ww.shake = 0; } });
    if (!lose.dead) { var y = U.yawTo(win.pos.x, win.pos.z, lose.pos.x, lose.pos.z); HG.setAnimalState(lose, 'wander'); lose.target.set(lose.pos.x - Math.sin(y) * 35, 0, lose.pos.z - Math.cos(y) * 35); lose.stateDur = 25; }
    if (!win.dead && Math.random() < 0.7) { startAct(win, 'call', { dur: 3 }); playCall(win); }
    HG.emit('animals:fightEnd', win, lose);
  }

  // ---- musk ox defensive circle ----
  function formCircle(a) {
    var w = a.data.ww; if (!w || w.circle || a.dead) return;
    var mem = HG.animals.filter(function (b) { return !b.dead && b.group === a.group && b.data.ww && b.data.ww.fam === 'muskox' && U.dist2D(a.pos.x, a.pos.z, b.pos.x, b.pos.z) < 45; });
    if (mem.length < 2) return;
    var cx = 0, cz = 0; mem.forEach(function (b) { cx += b.pos.x; cz += b.pos.z; }); cx /= mem.length; cz /= mem.length;
    var r = Math.max(1.9, mem.length * 0.62) * a.scale, base = U.yawTo(cx, cz, HG.player.pos.x, HG.player.pos.z);
    // nearest member takes the slot facing the threat
    mem.sort(function (p, q) { return p.distToPlayer - q.distToPlayer; });
    var c = { cx: cx, cz: cz, r: r, n: mem.length };
    mem.forEach(function (b, i) {
      var bw = b.data.ww; bw.act && endAct(b, bw); bw.bedT = 0;
      var ang = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * TAU / mem.length;
      bw.circle = { c: c, ang: ang, t: 0, dur: 40 + Math.random() * 15 };
      if (b.state !== 'alert') HG.setAnimalState(b, 'alert', 'herd');
    });
    if (HG.state === 'hunt' && a.distToPlayer < 160) HG.ui.toast('The musk oxen form a defensive ring!', { color: 'var(--cream-2)', duration: 2.2 });
    HG.emit('animals:circle', a, mem);
  }
  function circleUpdate(a, w, dt) {
    var ci = w.circle, c = ci.c; ci.t += dt;
    var pd = a.distToPlayer;
    if (ci.t > ci.dur || (pd > 120 && ci.t > 8)) { w.circle = null; a.awareness = 0.5; HG.setAnimalState(a, pd < 90 ? 'flee' : 'wander'); return false; }
    // bull charges an intruder
    if (pd < 15 && !HG.player.onStand && w.sex === 'm' && !(c.charged > 0)) {
      c.charged = 1; w.circle = null; a.threat.copy(HG.player.pos); HG.setAnimalState(a, 'warn'); return false;
    }
    a.awareness = Math.min(a.awareness, 0.95);
    if (a.state !== 'alert') a.state = 'alert';
    var sx = c.cx - Math.sin(ci.ang) * c.r, sz = c.cz - Math.cos(ci.ang) * c.r, d = U.dist2D(a.pos.x, a.pos.z, sx, sz);
    var out = U.yawTo(c.cx, c.cz, sx, sz), toP = U.yawTo(a.pos.x, a.pos.z, HG.player.pos.x, HG.player.pos.z);
    if (d > 0.5) return drive(a, U.yawTo(a.pos.x, a.pos.z, sx, sz), Math.min(a.def.speed.walk * 2, d * 1.5), 3, dt);
    var facing = Math.abs(U.angleDiff(out, toP)) < 1.3 ? toP : out;
    return hold(a, facing, dt);
  }

  // ---- bison stampede ----
  var _stampT = -99;
  function startStampede(src) {
    var n = 0, cx = 0, cz = 0;
    for (var i = 0; i < HG.animals.length; i++) {
      var b = HG.animals[i]; if (b.dead || !b.data.ww || b.data.ww.fam !== 'bison') continue;
      if (U.dist2D(src.pos.x, src.pos.z, b.pos.x, b.pos.z) > 170) continue;
      b.data.ww.stampede = 12 + Math.random() * 6; b.data.ww.act && endAct(b, b.data.ww); b.data.ww.bedT = 0;
      if (b !== src || !src.dead) HG.alertAnimal(b, HG.player.pos, 2, 'shot', b === src ? 0 : 0.2 + Math.random() * 0.5);
      cx += b.pos.x; cz += b.pos.z; n++;
    }
    if (n >= 2 && HG.realTime - _stampT > 10) {
      _stampT = HG.realTime; _zw.set(cx / n, 0, cz / n); HG.sfx('ww_stampede', { pos: _zw, volume: 1.4 });
      if (HG.state === 'hunt') HG.ui.toast('STAMPEDE!', { big: true, color: 'var(--danger)' });
      HG.emit('animals:stampede', src, n);
    }
  }

  // ---- shared per-frame behaviour ----
  function wwUpdate(a, dt) {
    var w = a.data.ww; if (!w) return false;
    if (a.state !== w.lastState) { stateChanged(a, w, w.lastState); w.lastState = a.state; }
    if (w.stomp > 0) { var s0 = w.stomp; w.stomp -= dt; if ((s0 > 1.25 && w.stomp <= 1.25) || (s0 > 0.7 && w.stomp <= 0.7)) HG.sfx('ww_stomp', { pos: a.pos }); }
    if (w.hurtCD > 0) w.hurtCD -= dt;
    if (w.answerT > 0) {
      w.answerT -= dt;
      if (w.answerT <= 0 && isCalm(a) && !w.act && !a.wounded) {
        startAct(a, 'call', { dur: 2.6 }); playCall(a);
        var to = w.answerTo; if (to && !to.dead && Math.random() < 0.6) { w.lure = { x: to.pos.x, z: to.pos.z, t: 25 }; }
      }
    }
    if (w.aura) auraTick(a, w, dt);
    // stampede: run with the herd, trample the careless
    if (w.stampede > 0) {
      w.stampede -= dt;
      if (a.state === 'flee') { a.stateDur = Math.max(a.stateDur, a.stateTime + 1); if (a.distToPlayer < 2.2 * a.scale && a.speed > 4 && w.hurtCD <= 0 && !HG.player.onStand && !HG.player.inVehicle) { w.hurtCD = 1.4; HG.hurtPlayer(14, a); } }
    }
    var rx = a.hitReaction;
    if (rx && rx.active) return reactionUpdate(a, w, rx, dt);
    if (w.circle) return circleUpdate(a, w, dt);
    if (w.act) { if (!isCalm(a) || a.wounded) endAct(a, w); else return actUpdate(a, w, dt); }
    // bedded down: hold the idle state
    if (w.bedT > 0) { if (a.state === 'idle') { w.bedT -= dt; a.stateTime = 0; if (w.bedT <= 0) a.stateTime = 99; } else w.bedT = 0; }
    // lured by a call
    if (w.lure && isCalm(a)) {
      w.lure.t -= dt;
      if (w.lure.t <= 0) w.lure = null;
      else if (a.state !== 'wander' || U.dist2D(a.target.x, a.target.z, w.lure.x, w.lure.z) > 6) { if (a.state !== 'wander') HG.setAnimalState(a, 'wander'); a.target.set(w.lure.x + (Math.random() - 0.5) * 8, 0, w.lure.z + (Math.random() - 0.5) * 8); a.stateDur = a.stateTime + 20; }
    }
    // cliff dwellers flee uphill
    if (a.state === 'flee' && a.def.wwCliff) {
      w.climbT = (w.climbT || 0) - dt;
      if (w.climbT <= 0) {
        w.climbT = 0.5;
        var h0 = T.heightAt(a.pos.x, a.pos.z), gx = T.heightAt(a.pos.x + 4, a.pos.z) - h0, gz = T.heightAt(a.pos.x, a.pos.z + 4) - h0;
        if (gx * gx + gz * gz > 0.4) {
          var up = Math.atan2(-gx, -gz), away = U.yawTo(a.threat.x, a.threat.z, a.pos.x, a.pos.z);
          if (Math.abs(U.angleDiff(away, up)) < 1.7 && a.fleeYaw != null) a.fleeYaw = U.wrap(a.fleeYaw + U.angleDiff(a.fleeYaw, up) * 0.45);
        }
      }
    }
    w.rutT -= dt;
    if (w.rutT <= 0) { w.rutT = 3.5 + Math.random() * 4; rutTick(a, w); }
    return false;
  }
  function stateChanged(a, w, prev) {
    var sp = SPECIES[w.species], st = a.state;
    if (st !== 'idle') w.bedT = 0;
    if (st === 'idle' && prev !== 'idle' && !a.wounded && sp.bed && Math.random() < sp.bed && !(a.hitReaction && a.hitReaction.active)) w.bedT = 18 + Math.random() * 30;
    if (st === 'graze' && w.drinkGo) { w.drinkGo = false; a.stateDur = 9 + Math.random() * 6; }
    if (st === 'idle' && w.drinkGo && prev === 'wander') { w.drinkGo = false; HG.setAnimalState(a, 'graze'); a.stateDur = 9 + Math.random() * 6; }
    if (st === 'wander' && !w.lure) {
      var L = a.leader && !a.leader.dead ? a.leader : null;
      if (!L && sp.migrate) { // caribou: the lead animal walks on along the migration line
        for (var i = 0; i < 6; i++) { var y = WW.migYaw + (Math.random() - 0.5) * 0.6, d = 35 + Math.random() * 25, x = a.pos.x - Math.sin(y) * d, z = a.pos.z - Math.cos(y) * d; if (okGround(x, z)) { a.target.set(x, 0, z); a.stateDur = 40; break; } }
        if (!T.inBounds(a.target.x, a.target.z, 30)) WW.migYaw = U.wrap(WW.migYaw + Math.PI * 0.75);
      } else if (!L && a.def.wwCliff) { // climbers prefer steep, high ground
        var best = null, bs = -1;
        for (var k = 0; k < 7; k++) { var yy = Math.random() * TAU, dd = 15 + Math.random() * 30, xx = a.pos.x - Math.sin(yy) * dd, zz = a.pos.z - Math.cos(yy) * dd; if (!okGround(xx, zz, true)) continue; var sc = Math.min(1.2, T.slopeAt(xx, zz)) + T.heightAt(xx, zz) * 0.01; if (sc > bs) { bs = sc; best = [xx, zz]; } }
        if (best) a.target.set(best[0], 0, best[1]);
      } else if (!L && sp.drink && T.waterLevel > -1e8 && Math.random() < sp.drink) { // walk to the shore to drink
        for (var j = 0; j < 14; j++) {
          var ay = Math.random() * TAU, ad = 10 + Math.random() * 60, ax = a.pos.x - Math.sin(ay) * ad, az = a.pos.z - Math.cos(ay) * ad;
          if (!okGround(ax, az)) continue;
          if (T.isWater(ax + 2.5, az) || T.isWater(ax - 2.5, az) || T.isWater(ax, az + 2.5) || T.isWater(ax, az - 2.5)) { a.target.set(ax, 0, az); a.stateDur = 45; w.drinkGo = true; break; }
        }
      }
    }
    if (st === 'flee' || st === 'alert') w.bedT = 0;
  }
  function onAlert(a, cause) {
    var w = a.data.ww; if (!w) return;
    if (SPECIES[w.species].stomp && !a.wounded && cause !== 'shot' && Math.random() < 0.75) w.stomp = 1.6;
    if (SPECIES[w.species].circle && (cause === 'sight' || cause === 'scent' || cause === 'close' || cause === 'shot' || cause === 'hit' || cause === 'herd') && a.distToPlayer < 140) formCircle(a);
  }

  /* ------------------------------------------------------------------
   * 8. Species definitions (HG.animalTypes)
   * ------------------------------------------------------------------ */
  function makeZones(spec) {
    var A = spec.anchors, S = A.S, ch = A.chest, mid = A.spineMid, pel = A.pelvis, V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    var hc = A.tAt(0.12), hz = { name: 'head', sub: 'head', part: 'head', offset: V(0, A.dir[1] * hc + A.perp[1] * 0.01 * S, A.dir[2] * hc + A.perp[2] * 0.01 * S), radius: A.headHalfW * 1.15, mult: 3 };
    var n1 = A.neck1, n2 = A.neck2;
    var zones = [
      { name: 'vital', sub: 'heart', offset: V(0, ch.p[1] - ch.hDown * 0.55, ch.p[2] + 0.03 * S), radius: 0.085 * S * Math.sqrt(A.P.wideK), mult: 2.6 },
      { name: 'vital', sub: 'lungs', offset: V(0, ch.p[1] - ch.hDown * 0.1, ch.p[2] + 0.08 * S), radius: 0.15 * S * A.P.wideK, mult: 2.3 },
      { name: 'vital', sub: 'neck', part: 'neck', offset: V(0, (n2[1] - n1[1]) * 0.45, (n2[2] - n1[2]) * 0.45), radius: spec.spine[8].w * 0.5, mult: 2.1 },
      hz,
      { name: 'body', sub: 'body', offset: V(0, mid.p[1], mid.p[2]), radius: mid.w * 0.62, mult: 0.85 },
      { name: 'body', sub: 'liver', offset: V(0, mid.p[1] - mid.hDown * 0.05, (mid.p[2] + ch.p[2]) * 0.5 + 0.05 * S), radius: 0.1 * S * A.P.wideK, mult: 1.6 },
      { name: 'body', sub: 'gut', offset: V(0, mid.p[1] - mid.hDown * 0.25, (mid.p[2] + pel.p[2]) * 0.5), radius: 0.15 * S * A.P.wideK, mult: 0.9 },
      { name: 'body', sub: 'hams', offset: V(0, pel.p[1] - pel.hDown * 0.2, pel.p[2] + 0.04 * S), radius: pel.w * 0.42, mult: 1.0 }
    ];
    [[A.FR, 1], [A.FR, -1], [A.BR, 1], [A.BR, -1]].forEach(function (q) {
      var L = q[0], j0 = L[2].p, j1 = L[3].p;
      zones.push({ name: 'leg', sub: 'leg', offset: V(q[1] * j0[0], (j0[1] + j1[1]) / 2, (j0[2] + j1[2]) / 2), radius: Math.max(0.06 * S, (L[2].rz || L[2].r) * 1.5), mult: 0.5 });
    });
    return zones;
  }
  function speciesIcon(id) {
    return function (ctx, w, h) { drawIcon(ctx, w, h, id); };
  }
  function defineSpecies(id) {
    var sp = SPECIES[id], spec = getSpec(id, 'm'), A = spec.anchors;
    var def = HG.animalTypes[id] || {};
    var core = id === 'whitetail_deer' && HG.animalTypes[id];
    var wr = [Math.min(sp.f.w[0], sp.m.w[0]), Math.max(sp.f.w[1], sp.m.w[1])];
    var o = {
      name: sp.name, rarity: sp.rarity || def.rarity || 'common', baseCash: sp.baseCash || def.baseCash || 140, xp: sp.xp || def.xp || 45, weightRange: wr, size: 1, hp: sp.hp || def.hp || 100,
      speed: sp.speed || def.speed || { walk: 1.5, run: 9.5 }, senses: sp.senses || def.senses, temperament: sp.temperament || def.temperament || 'skittish', group: sp.group || def.group || [1, 4],
      habitats: (def.habitats || []).concat(sp.habitats || []), activeAt: 'any', gait: 'walk', radius: 0.32 * A.S * A.P.wideK, furColor: new THREE.Color(sp.m.C.coat || '#86684b').getHex(),
      damage: sp.damage, attackRange: sp.attackRange, warnTime: sp.warnTime, territory: sp.territory,
      sounds: { alert: FAM_ALERT[sp.fam] || 'deer_snort', flee: FAM_ALERT[sp.fam] || 'deer_snort', warn: sp.fam === 'moose' ? 'ww_moose_grunt' : 'ww_bison_grunt', attack: sp.fam === 'moose' ? 'ww_moose_grunt' : 'ww_bison' },
      icon: speciesIcon(id), hitZones: makeZones(spec),
      buildMesh: function (opts) { return buildAnimal(id, opts, null); }, init: initWW, update: wwUpdate, onAlert: onAlert,
      facts: sp.facts, tips: sp.tips, scoreUnit: sp.scoreUnit, family: sp.fam, wwStott: !!sp.stott, wwCliff: !!sp.cliff, _ww: true,
      _noseZ: Math.abs(A.poll[2] + A.dir[2] * A.tEnd), _midZ: A.zS,
      codex: { weight: wr[0] + '-' + wr[1] + ' kg', habitat: (sp.habitats || []).slice(), facts: sp.facts, tips: sp.tips }
    };
    if (core) { o.habitats = ['pine_valley', 'misty_bayou', 'golden_plains', 'autumn_ridge']; o.sounds.alert = 'deer_snort'; o.sounds.flee = 'deer_snort'; }
    for (var k in o) if (o[k] !== undefined) def[k] = o[k];
    HG.animalTypes[id] = def;
    return def;
  }
  function defineLegend(lid) {
    var L = LEGENDS[lid], base = HG.animalTypes[L.base];
    var def = {};
    for (var k in base) def[k] = base[k];
    def.name = L.name; def.rarity = 'legendary'; def.weightRange = [L.weight[0], L.weight[1]];
    def.baseCash = L.cash; def.xp = L.xp; def.hp = Math.round(base.hp * 1.25); def.habitats = []; def.legendaryOf = L.base; def.legendMap = L.map;
    def.facts = L.facts.concat(base.facts || []); def.tips = L.tips; def.senses = { sight: base.senses.sight * 1.15, hearing: base.senses.hearing * 1.15, smell: base.senses.smell * 1.1 };
    def.buildMesh = function (opts) { return buildAnimal(L.base, opts, lid); };
    def.icon = function (ctx, w, h) { drawIcon(ctx, w, h, L.base, L.aura); };
    def.codex = { weight: L.weight[0] + '-' + L.weight[1] + ' kg', habitat: [L.map], facts: def.facts, tips: L.tips, legendary: true };
    HG.animalTypes[lid] = def;
  }
  Object.keys(SPECIES).forEach(defineSpecies);
  Object.keys(LEGENDS).forEach(defineLegend);
  WW.migYaw = Math.random() * TAU;

  /* ------------------------------------------------------------------
   * 9. Events: hits, kills, trophy scoring, stampedes
   * ------------------------------------------------------------------ */
  HG.on('hit', function (a, zone, dmg, info) { if (a && a.def && a.def._ww) onHit(a, zone, dmg, info || {}); });
  var _pendingSub = null;
  HG.on('killScore', function (a, info) {
    var w = a.data && a.data.ww; if (!w) return;
    var rx = a.hitReaction, sub = rx ? rx.type : (info.zone === 'vital' ? 'heart' : info.zone);
    if (!rx && a.def.hitZones && info.zone) sub = subZone(a, info.zone, a._wwLastPoint);
    _pendingSub = sub; info.subZone = sub; info.ageClass = w.label;
    if (w.score > 0) {
      info.trophyScore = w.score; info.trophyPoints = w.points;
      var k = { deer: 1.1, elk: 0.9, moose: 1.3, caribou: 0.8, pronghorn: 2.4, sheep: 1.8, goat: 3.2, bison: 1.6, muskox: 1.8 }[w.fam] || 1;
      var bonus = Math.round(w.score * k * (w.score > 150 && w.fam === 'deer' ? 1.4 : 1) / 5) * 5;
      if (bonus > 0) info.bonuses.push({ label: (w.points > 1 ? w.points + ' pts, ' : '') + w.score.toFixed(0) + ' in ' + (w.fam === 'sheep' || w.fam === 'goat' || w.fam === 'bison' || w.fam === 'muskox' || w.fam === 'pronghorn' ? 'horns' : 'antlers'), cash: bonus, xp: Math.round(bonus / 6) });
    }
    if (w.legend) { var L = LEGENDS[w.legend]; info.bonuses.push({ label: 'Legendary bounty: +' + L.gold + ' gold', cash: 0, xp: 0 }); }
    if (sub === 'heart' || sub === 'lungs') info.bonuses.push({ label: sub === 'heart' ? 'Clean heart shot' : 'Double lung', cash: Math.round(a.def.baseCash * 0.1), xp: 5 });
  }, { priority: 5 });
  // relabel core's "HEART SHOT!" when it was really the lungs or the neck
  if (HG.ui && HG.ui.toast) {
    var _toast = HG.ui.toast;
    HG.ui.toast = function (text, opts) {
      if (text === 'HEART SHOT!' && _pendingSub && _pendingSub !== 'heart') text = { lungs: 'DOUBLE LUNG!', neck: 'NECK SHOT!', liver: 'LIVER SHOT!' }[_pendingSub] || text;
      return _toast.call(this, text, opts);
    };
  }
  HG.on('kill', function (a, info) {
    _pendingSub = null;
    var w = a.data && a.data.ww; if (!w) return;
    var tr = HG.save.trophies && HG.save.trophies[HG.save.trophies.length - 1];
    if (tr && tr.species === a.type) { tr.ageClass = w.label; tr.subZone = info.subZone; if (w.score) { tr.trophyScore = w.score; tr.points = w.points; } }
    if (w.legend) {
      var L = LEGENDS[w.legend]; HG.addGold(L.gold, 'legendary');
      var ls = WW.save; if (ls) { ls.legendKills[w.legend] = (ls.legendKills[w.legend] || 0) + 1; HG.store(); }
      if (HG.compass) HG.compass.removeMarker('ww_legend');
    }
    if (w.fam === 'bison') startStampede(a);
    if (a.hitReaction) a.hitReaction.active = false;
  });
  HG.on('animalRemove', function (a) { if (a.data && a.data.ww && a.data.ww.legend && HG.compass) HG.compass.removeMarker('ww_legend'); if (a.data && a.data.ww && a.data.ww.act) endAct(a, a.data.ww); });
  HG.on('trophyCard', function (a, info, el) {
    var w = a.data && a.data.ww; if (!w || !el) return;
    var box = document.createElement('div'); box.className = 'ww-tro';
    var sub = info.subZone && REACT[info.subZone] ? REACT[info.subZone].label : '';
    var html = '<div class="ww-row"><span class="ww-cls">' + U.esc(w.label) + '</span>' + (sub ? '<span class="ww-sub">' + U.esc(sub) + ' shot</span>' : '') + '</div>';
    if (w.score) html += '<div class="ww-score"><b>' + w.score.toFixed(1) + '</b><small>' + (w.points > 1 ? w.points + '-point ' : '') + 'trophy score (' + U.esc(a.def.scoreUnit || 'in') + ')</small></div>';
    var facts = a.def.facts || []; if (facts.length) html += '<div class="ww-fact">' + U.esc(facts[Math.floor(Math.random() * facts.length)]) + '</div>';
    box.innerHTML = html;
    var anchor = el.querySelector('.rew') || el.querySelector('.act');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor); else (el.querySelector('.hg-panel') || el).appendChild(box);
  });
  if (HG.ui && HG.ui.css) HG.ui.css(
    '.ww-tro{margin:6px 0 4px;display:flex;flex-direction:column;gap:5px;align-items:center;text-align:center;font-family:var(--body)}' +
    '.ww-tro .ww-row{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}' +
    '.ww-tro .ww-cls,.ww-tro .ww-sub{font:600 12px/1 var(--body);padding:5px 9px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid var(--panel-line);color:var(--cream)}' +
    '.ww-tro .ww-sub{color:var(--amber-2)}' +
    '.ww-tro .ww-score{display:flex;align-items:baseline;gap:6px;color:var(--cream-2)}.ww-tro .ww-score b{font:700 20px/1 var(--num,var(--display));color:var(--gold)}.ww-tro .ww-score small{font-size:11px;opacity:.85}' +
    '.ww-tro .ww-fact{font-size:11.5px;line-height:1.35;color:var(--cream-2);opacity:.85;max-width:300px}'
  );

  /* ------------------------------------------------------------------
   * 10. Legendaries: one per map, rare, banner + compass marker
   * ------------------------------------------------------------------ */
  WW.save = HG.registerSaveDefaults ? HG.registerSaveDefaults('animals', { legendKills: {}, legendSeen: {}, trackerHunts: 0 }) : { legendKills: {}, legendSeen: {}, trackerHunts: 0 };
  WW.legendChance = 0.3;
  var legendTimer = -1, legendFor = null;
  function legendForMap(mapId) { for (var k in LEGENDS) if (LEGENDS[k].map === mapId) return k; return null; }
  function aliveLegend() { for (var i = 0; i < HG.animals.length; i++) { var a = HG.animals[i]; if (!a.dead && a.data.ww && a.data.ww.legend) return a; } return null; }
  WW.spawnLegendary = function (lid, dist) {
    lid = lid || legendForMap(HG.mapId); if (!lid || !HG.animalTypes[lid]) return null;
    var cur = aliveLegend(); if (cur) return cur;
    var P = HG.player.pos, a = null;
    for (var t = 0; t < 24 && !a; t++) {
      var y = Math.random() * TAU, d = (dist || 150) + Math.random() * 50, x = P.x - Math.sin(y) * d, z = P.z - Math.cos(y) * d;
      if (!okGround(x, z, true)) continue;
      a = HG.spawnAnimal(lid, { x: x, z: z }, { legendary: true, noCount: true, state: 'graze' });
    }
    if (!a) return null;
    a.keep = true; a.noCount = true;
    // a small escort of its own kind
    if (LEGENDS[lid].base !== 'whitetail_deer') {
      var esc = LEGENDS[lid].base === 'bighorn_sheep' ? 2 : 3;
      for (var i = 0; i < esc; i++) { var ang = Math.random() * TAU, rr = 4 + Math.random() * 6; HG.spawnAnimal(LEGENDS[lid].base, { x: a.pos.x + Math.cos(ang) * rr, z: a.pos.z + Math.sin(ang) * rr }, { group: a.group, leader: a, noCount: true }); }
    }
    if (HG.compass) HG.compass.addMarker('ww_legend', { pos: a.pos, color: LEGENDS[lid].aura, size: 6 });
    HG.sfx('ww_legend');
    HG.ui.banner('A legendary animal has been spotted!', LEGENDS[lid].name + ' roams ' + (HG.map ? HG.map.name : 'these hills') + '. Follow the gold marker.', { duration: 4.5, color: 'var(--gold)' });
    if (WW.save) { WW.save.legendSeen[lid] = (WW.save.legendSeen[lid] || 0) + 1; HG.store(); }
    HG.emit('animals:legendary', a, lid);
    return a;
  };
  HG.on('huntStart', function () {
    legendTimer = -1; legendFor = legendForMap(HG.mapId);
    if (!legendFor) return;
    var chance = WW.legendChance;
    if (WW.save && WW.save.trackerHunts > 0) { chance = 1; WW.save.trackerHunts--; HG.store(); HG.ui.toast('Legend Tracker\'s Map: something big is out there today...', { color: 'var(--gold)', duration: 3 }); }
    if (Math.random() < chance) legendTimer = 45 + Math.random() * 110;
  });
  HG.on('huntEnd', function () { legendTimer = -1; if (HG.compass) HG.compass.removeMarker('ww_legend'); });
  function auraTick(a, w, dt) {
    w.auraT -= dt;
    if (w.auraT <= 0 && a.root.visible && a.distToPlayer < 110) {
      w.auraT = 0.35;
      _zw.set(a.pos.x + (Math.random() - 0.5) * a.scale, a.pos.y + (0.6 + Math.random() * 0.8) * a.scale * A_H(a), a.pos.z + (Math.random() - 0.5) * a.scale);
      HG.particles.emit(_zw, 1, { color: new THREE.Color(LEGENDS[w.legend].aura).getHex(), speed: 0.25, up: 0.6, life: 1.4, gravity: -0.3 });
    }
  }
  function A_H(a) { return a.def._h || 1; }

  /* ------------------------------------------------------------------
   * 11. Habitats: register spawn entries when maps load (maps are built in parallel)
   * ------------------------------------------------------------------ */
  function registerSpawns(map) {
    if (!map || !map.id) return;
    if (!Array.isArray(map.spawns)) map.spawns = [];
    Object.keys(SPECIES).forEach(function (id) {
      var def = HG.animalTypes[id], sp = SPECIES[id]; if (!def || !def.habitats || def.habitats.indexOf(map.id) < 0) return;
      if (map.spawns.some(function (s) { return s && s.type === id; })) return;
      var sw = sp.spawn || { weight: 4, max: 6 };
      map.spawns.push({ type: id, weight: sw.weight, max: sw.max });
    });
  }
  HG.on('mapLoaded', function (map) { try { registerSpawns(map); } catch (e) { console.warn('[animals] spawns', e); } });
  HG.on('huntStart', function () { try { registerSpawns(HG.map); } catch (e) { } });
  HG.on('boot', function () { for (var id in HG.maps) { try { registerSpawns(HG.maps[id]); } catch (e) { } } });

  HG.on('update', function (dt) {
    if (HG.state !== 'hunt') return;
    if (legendTimer > 0) { legendTimer -= dt; if (legendTimer <= 0) { legendTimer = -1; if (!WW.spawnLegendary(legendFor)) legendTimer = 20; } }
    // ground shake near a stampede
    var k = 0;
    for (var i = 0; i < HG.animals.length; i++) { var a = HG.animals[i]; if (!a.dead && a.data.ww && a.data.ww.stampede > 0 && a.speed > 4) k = Math.max(k, 1 - a.distToPlayer / 55); }
    if (k > 0 && HG.input) { HG.input.lookY += (Math.random() - 0.5) * 0.004 * k; HG.input.lookX += (Math.random() - 0.5) * 0.003 * k; }
  });

  /* ------------------------------------------------------------------
   * 12. Sounds (WebAudio, synthesized)
   * ------------------------------------------------------------------ */
  var AU = HG.audio || {};
  function nb(ctx, d, t, dur, type, f0, f1, peak, q) { if (AU.noiseBurst) AU.noiseBurst(ctx, d, t, dur, type, f0, f1, peak, q); }
  function tn(ctx, d, t, type, f0, f1, dur, peak, att) { if (AU.tone) AU.tone(ctx, d, t, type, f0, f1, dur, peak, att); }
  function voice(ctx, dest, t, o) {
    // generic animal voice: oscillator through a formant band-pass with vibrato and envelope; o:{type,f:[[time,freq]...],dur,peak,band,q,vib,vibDepth,attack}
    var osc = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain();
    osc.type = o.type || 'sawtooth';
    o.f.forEach(function (p, i) { if (i === 0) osc.frequency.setValueAtTime(p[1], t + p[0]); else osc.frequency.linearRampToValueAtTime(p[1], t + p[0]); });
    vib.frequency.value = o.vib || 6; vg.gain.value = o.vibDepth || 0; vib.connect(vg); vg.connect(osc.frequency);
    f.type = 'bandpass'; f.frequency.value = o.band || 900; f.Q.value = o.q || 1.5;
    var pk = o.peak || 0.3, dur = o.dur;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + (o.attack || 0.05)); g.gain.setValueAtTime(pk, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(f); f.connect(g); g.connect(dest); osc.start(t); osc.stop(t + dur + 0.05); vib.start(t); vib.stop(t + dur + 0.05);
  }
  function S(fn) { return function (ctx, dest, o, t) { try { fn(ctx, dest, o || {}, t); } catch (e) { } }; }
  var SN = HG.sounds;
  SN.ww_bugle = S(function (ctx, d, o, t) {
    var k = o.freq || 1;
    voice(ctx, d, t, { type: 'sawtooth', f: [[0, 160 * k], [0.35, 260 * k]], dur: 0.45, peak: 0.16, band: 500, q: 1.2 });
    voice(ctx, d, t + 0.3, { type: 'sine', f: [[0, 600 * k], [0.4, 1500 * k], [1.3, 1650 * k], [1.7, 1100 * k]], dur: 1.8, peak: 0.22, band: 1400 * k, q: 0.8, vib: 7, vibDepth: 22 });
    voice(ctx, d, t + 0.32, { type: 'triangle', f: [[0, 1200 * k], [0.4, 3000 * k], [1.3, 3250 * k], [1.7, 2200 * k]], dur: 1.75, peak: 0.05, band: 2800 * k, q: 1, vib: 7, vibDepth: 40 });
    for (var i = 0; i < 4; i++) voice(ctx, d, t + 2.15 + i * 0.22, { type: 'sawtooth', f: [[0, 130 * k], [0.12, 95 * k]], dur: 0.16, peak: 0.16, band: 380, q: 1.4 });
  });
  SN.ww_mew = S(function (ctx, d, o, t) { var k = o.freq || 1; voice(ctx, d, t, { type: 'sine', f: [[0, 900 * k], [0.15, 1050 * k], [0.55, 650 * k]], dur: 0.6, peak: 0.18, band: 950, q: 0.9, vib: 9, vibDepth: 14 }); });
  SN.ww_elk_bark = S(function (ctx, d, o, t) { voice(ctx, d, t, { type: 'sawtooth', f: [[0, 520], [0.18, 380]], dur: 0.22, peak: 0.3, band: 900, q: 1.3 }); nb(ctx, d, t, 0.2, 'bandpass', 1400, 700, 0.25, 1.2); });
  SN.ww_grunt = S(function (ctx, d, o, t) { var k = o.freq || 1; for (var i = 0; i < 3; i++) voice(ctx, d, t + i * 0.32, { type: 'sawtooth', f: [[0, 95 * k], [0.18, 80 * k]], dur: 0.22, peak: 0.28, band: 300, q: 2 }); });
  SN.ww_doebleat = S(function (ctx, d, o, t) { voice(ctx, d, t, { type: 'sawtooth', f: [[0, 420], [0.35, 360]], dur: 0.45, peak: 0.16, band: 1000, q: 2, vib: 16, vibDepth: 10 }); });
  SN.ww_moose = S(function (ctx, d, o, t) { var k = o.freq || 1; for (var i = 0; i < 2; i++) voice(ctx, d, t + i * 0.55, { type: 'sawtooth', f: [[0, 120 * k], [0.15, 150 * k], [0.4, 85 * k]], dur: 0.45, peak: 0.34, band: 420, q: 2.2 }); });
  SN.ww_moose_grunt = S(function (ctx, d, o, t) { voice(ctx, d, t, { type: 'sawtooth', f: [[0, 110], [0.3, 80]], dur: 0.38, peak: 0.36, band: 360, q: 2 }); nb(ctx, d, t, 0.3, 'lowpass', 500, 200, 0.2); });
  SN.ww_moose_cow = S(function (ctx, d, o, t) { voice(ctx, d, t, { type: 'sawtooth', f: [[0, 260], [0.4, 330], [1.6, 200]], dur: 1.8, peak: 0.18, band: 700, q: 1.6, vib: 5, vibDepth: 6 }); });
  SN.ww_caribou = S(function (ctx, d, o, t) {
    voice(ctx, d, t, { type: 'sawtooth', f: [[0, 140], [0.5, 110]], dur: 0.55, peak: 0.24, band: 420, q: 1.6, vib: 25, vibDepth: 18 });
    for (var i = 0; i < 6; i++) nb(ctx, d, t + 0.7 + i * 0.28, 0.025, 'highpass', 3200, 2600, 0.18, 1);
  });
  SN.ww_caribou_grunt = S(function (ctx, d, o, t) { voice(ctx, d, t, { type: 'sawtooth', f: [[0, 160], [0.25, 120]], dur: 0.3, peak: 0.24, band: 450, q: 1.5, vib: 25, vibDepth: 14 }); });
  SN.ww_wheeze = S(function (ctx, d, o, t) { nb(ctx, d, t, 0.35, 'bandpass', 2400, 1500, 0.32, 1.1); nb(ctx, d, t + 0.4, 0.2, 'bandpass', 2200, 1400, 0.22, 1.1); });
  SN.ww_snort = S(function (ctx, d, o, t) { nb(ctx, d, t, 0.25, 'bandpass', 700, 380, 0.45, 1.3); });
  SN.ww_bleat = S(function (ctx, d, o, t) { var k = o.freq || 1; voice(ctx, d, t, { type: 'sawtooth', f: [[0, 340 * k], [0.5, 300 * k]], dur: 0.6, peak: 0.18, band: 1100, q: 1.8, vib: 11, vibDepth: 18 }); });
  SN.ww_bison = S(function (ctx, d, o, t) {
    var k = o.freq || 1;
    voice(ctx, d, t, { type: 'sawtooth', f: [[0, 70 * k], [0.4, 92 * k], [1.4, 62 * k]], dur: 1.6, peak: 0.45, band: 260, q: 1.8, vib: 24, vibDepth: 9 });
    nb(ctx, d, t, 1.3, 'lowpass', 420, 180, 0.2);
  });
  SN.ww_bison_grunt = S(function (ctx, d, o, t) { voice(ctx, d, t, { type: 'sawtooth', f: [[0, 80], [0.3, 64]], dur: 0.4, peak: 0.4, band: 240, q: 1.8, vib: 22, vibDepth: 7 }); });
  SN.ww_muskox = S(function (ctx, d, o, t) { voice(ctx, d, t, { type: 'sawtooth', f: [[0, 95], [0.3, 120], [0.9, 80]], dur: 1.0, peak: 0.38, band: 330, q: 1.7, vib: 18, vibDepth: 10 }); });
  SN.ww_stomp = S(function (ctx, d, o, t) { tn(ctx, d, t, 'sine', 90, 40, 0.14, 0.4); nb(ctx, d, t, 0.08, 'lowpass', 600, 200, 0.3); });
  SN.ww_clack = S(function (ctx, d, o, t) { var k = o.freq || 1; nb(ctx, d, t, 0.05, 'bandpass', 2600 * k, 1800 * k, 0.55, 3); tn(ctx, d, t, 'triangle', 1250 * k, 1100 * k, 0.07, 0.12); nb(ctx, d, t + 0.09, 0.04, 'bandpass', 2200 * k, 1600 * k, 0.35, 3); });
  SN.ww_crack = S(function (ctx, d, o, t) { nb(ctx, d, t, 0.09, 'highpass', 1800, 900, 0.9, 0.8); tn(ctx, d, t, 'sine', 140, 60, 0.25, 0.6); nb(ctx, d, t + 0.02, 0.5, 'bandpass', 900, 500, 0.18, 1.5); });
  SN.ww_rattle = S(function (ctx, d, o, t) { for (var i = 0; i < 11; i++) { var tt = t + i * 0.13 + Math.random() * 0.05, k = 0.8 + Math.random() * 0.4; nb(ctx, d, tt, 0.05, 'bandpass', 2400 * k, 1700 * k, 0.5, 3); tn(ctx, d, tt, 'triangle', 1150 * k, 1000 * k, 0.06, 0.08); } });
  SN.ww_stampede = S(function (ctx, d, o, t) {
    var n = AU.noiseSource ? AU.noiseSource(ctx) : null; if (!n) return;
    var f = ctx.createBiquadFilter(), g = ctx.createGain(), am = ctx.createOscillator(), ag = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 180; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9, t + 0.6); g.gain.setValueAtTime(0.9, t + 2.6); g.gain.exponentialRampToValueAtTime(0.001, t + 4);
    am.frequency.value = 11; ag.gain.value = 0.35; am.connect(ag); ag.connect(g.gain);
    n.connect(f); f.connect(g); g.connect(d); n.start(t); n.stop(t + 4.1); am.start(t); am.stop(t + 4.1);
  });
  SN.ww_legend = S(function (ctx, d, o, t) { [392, 494, 587, 784].forEach(function (f, i) { tn(ctx, d, t + i * 0.09, 'triangle', f, f, 1.6 - i * 0.2, 0.1, 0.05); tn(ctx, d, t + i * 0.09, 'sine', f * 2, f * 2, 1.2, 0.03, 0.05); }); });

  /* ------------------------------------------------------------------
   * 13. Calls (shop gear) + action button
   * ------------------------------------------------------------------ */
  var CALLS = WW.calls = {
    rattling_antlers: { name: 'Rattling Antlers', desc: 'Clash a pair of sheds to fake a buck fight. Pulls in curious bucks (deer).', price: 450, level: 2, sound: 'ww_rattle', fams: ['deer'], males: true, range: 220 },
    elk_bugle: { name: 'Elk Bugle Tube', desc: 'Challenge a bull elk. Bulls answer and come looking for a fight.', price: 950, level: 4, sound: 'ww_bugle', fams: ['elk'], males: true, range: 320 },
    moose_call: { name: 'Moose Cow Call', desc: 'A long cow moan that draws bulls in from the willows. Careful: they arrive angry.', price: 1300, level: 6, sound: 'ww_moose_cow', fams: ['moose'], males: true, range: 300 },
    caribou_grunt: { name: 'Caribou Grunter', desc: 'Grunts and clicks that turn a passing herd toward you.', price: 1100, level: 5, sound: 'ww_caribou', fams: ['caribou'], males: false, range: 260 }
  };
  function iconCall(kind) {
    return function (ctx, w, h) {
      ctx.save(); ctx.translate(w / 2, h / 2); var s = Math.min(w / 120, h / 64); ctx.scale(s, s); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (kind === 'rattling_antlers') {
        ctx.strokeStyle = '#e9dcc0'; ctx.lineWidth = 5;
        [1, -1].forEach(function (sd) { ctx.save(); ctx.scale(sd, 1); ctx.rotate(0.5); ctx.beginPath(); ctx.moveTo(-34, 14); ctx.quadraticCurveTo(-8, -18, 26, -6); ctx.moveTo(-14, 0); ctx.lineTo(-18, -18); ctx.moveTo(2, -8); ctx.lineTo(0, -26); ctx.moveTo(14, -8); ctx.lineTo(16, -22); ctx.stroke(); ctx.restore(); });
        ctx.fillStyle = '#7b5a38'; ctx.beginPath(); ctx.arc(0, 18, 5, 0, TAU); ctx.fill();
      } else if (kind === 'elk_bugle') {
        ctx.strokeStyle = '#d6a050'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(-40, 10); ctx.quadraticCurveTo(0, -24, 34, -4); ctx.stroke();
        ctx.fillStyle = '#d6a050'; ctx.beginPath(); ctx.moveTo(30, -14); ctx.lineTo(48, -20); ctx.lineTo(46, 12); ctx.lineTo(30, 6); ctx.fill();
        ctx.fillStyle = '#3a2a1c'; ctx.fillRect(-46, 4, 10, 12);
      } else if (kind === 'moose_call') {
        ctx.fillStyle = '#c38a4a'; ctx.beginPath(); ctx.moveTo(-40, -5); ctx.lineTo(36, -24); ctx.lineTo(36, 24); ctx.lineTo(-40, 5); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#5a3c22'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(36, 0, 6, 24, 0, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#e9dcc0'; ctx.lineWidth = 2; for (var i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-20 + i * 18, -6 - i * 4); ctx.lineTo(-20 + i * 18, 6 + i * 4); ctx.stroke(); }
      } else if (kind === 'caribou_grunt') {
        ctx.fillStyle = '#9fb8c6'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-36, -12, 60, 24, 10) : ctx.rect(-36, -12, 60, 24); ctx.fill();
        ctx.fillStyle = '#2c3e4a'; ctx.beginPath(); ctx.arc(28, 0, 10, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#e9dcc0'; ctx.lineWidth = 3; for (var j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(40, 0, 12 + j * 7, -0.6, 0.6); ctx.stroke(); }
      } else if (kind === 'map') {
        ctx.fillStyle = '#e8d9b4'; ctx.beginPath(); ctx.moveTo(-44, -22); ctx.lineTo(-14, -26); ctx.lineTo(14, -20); ctx.lineTo(44, -26); ctx.lineTo(44, 22); ctx.lineTo(14, 26); ctx.lineTo(-14, 20); ctx.lineTo(-44, 26); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#a07c48'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(-34, 14); ctx.quadraticCurveTo(-10, -12, 18, 4); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffb54d'; ctx.beginPath(); for (var p = 0; p < 10; p++) { var r = p % 2 ? 5 : 12, an = p / 10 * TAU - Math.PI / 2; ctx.lineTo(26 + Math.cos(an) * r, -2 + Math.sin(an) * r); } ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    };
  }
  Object.keys(CALLS).forEach(function (id) {
    var c = CALLS[id];
    HG.shop.add({ id: 'ww_' + id, category: 'gear', name: c.name, desc: c.desc, price: c.price, currency: 'cash', levelReq: c.level, icon: iconCall(id), stats: { Range: Math.min(1, c.range / 320) }, equipSlot: 'gear' });
  });
  HG.shop.add({ id: 'ww_legend_map', category: 'gear', name: 'Legend Tracker\'s Map', desc: 'Guarantees the map\'s legendary animal appears on your next hunt there (one use).', price: 12, currency: 'gold', levelReq: 3, consumable: true, icon: iconCall('map'), equipSlot: null,
    onBuy: function () { if (WW.save) { WW.save.trackerHunts = (WW.save.trackerHunts || 0) + 1; HG.store(); } } });
  function equippedCalls() {
    var out = []; Object.keys(CALLS).forEach(function (id) { var sid = 'ww_' + id; if (HG.shop.owns(sid) && HG.isEquipped('gear', sid)) out.push(id); }); return out;
  }
  var callIdx = 0, callCD = 0;
  function useCall() {
    if (HG.state !== 'hunt' || HG.paused) return;
    var list = equippedCalls(); if (!list.length) { HG.ui.toast('Equip a game call from the shop (Gear).', { duration: 2 }); return; }
    if (callCD > 0) { HG.ui.toast('Wait a moment before calling again.', { duration: 1.2 }); return; }
    var id = list[callIdx % list.length]; callIdx++;
    var c = CALLS[id], P = HG.player.pos; callCD = 7;
    HG.sfx(c.sound, { volume: 0.9 });
    HG.ui.toast(c.name + '!', { color: 'var(--amber-2)', duration: 1.4 });
    HG.player.noise = Math.max(HG.player.noise || 0, 0.25);
    var n = 0;
    HG.animals.forEach(function (a) {
      var w = a.data.ww; if (!w || a.dead || c.fams.indexOf(w.fam) < 0 || (c.males && w.sex !== 'm' && w.fam !== 'caribou')) return;
      if (a.distToPlayer > c.range || a.wounded || !(isCalm(a) || (a.state === 'alert' && a.awareness < 0.8))) return;
      var ang = Math.random() * TAU, r = 10 + Math.random() * 12;
      w.lure = { x: P.x + Math.cos(ang) * r, z: P.z + Math.sin(ang) * r, t: 30 }; w.bedT = 0; w.act && endAct(a, w);
      if (w.sex === 'm' && Math.random() < 0.7) { w.answerT = 1 + Math.random() * 2.5; w.answerTo = null; }
      n++;
    });
    HG.emit('animals:callUsed', id, n);
  }
  WW.useCall = useCall;
  var callSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14c4-1 7-4 9-8"/><path d="M12 6l7-2v14l-7-2"/><path d="M21 9c1 1 1 5 0 6"/></svg>';
  if (HG.ui && HG.ui.actionButton) { try { HG.ui.actionButton('wwcall', 'Call', callSvg, useCall, { order: 6, hidden: true }); } catch (e) { } }
  if (HG.bindKey) HG.bindKey('KeyV', useCall, 'Game call');
  function syncCallBtn() { try { if (HG.ui.setActionVisible) HG.ui.setActionVisible('wwcall', HG.state === 'hunt' && equippedCalls().length > 0); } catch (e) { } }
  HG.on('huntStart', syncCallBtn); HG.on('equip', syncCallBtn); HG.on('purchase', syncCallBtn); HG.on('huntEnd', syncCallBtn); HG.on('boot', syncCallBtn);
  HG.on('update', function (dt) { if (callCD > 0) callCD -= dt; });

  /* ------------------------------------------------------------------
   * 14. Icons: side silhouettes straight from the anatomy spec
   * ------------------------------------------------------------------ */
  var ICON_RACK = { whitetail_deer: 'wt', mule_deer: 'md', blacktail_deer: 'md', elk: 'elk', roosevelt_elk: 'elk', moose: 'moose', caribou: 'caribou', pronghorn: 'ph', bighorn_sheep: 'bh', mountain_goat: 'goat', bison: 'bison', musk_ox: 'mx' };
  function drawIcon(ctx, w, h, id, glow) {
    var spec = getSpec(id, 'm'), A = spec.anchors, pts = [];
    var minZ = 1e9, maxZ = -1e9, maxY = 0;
    spec.spine.concat(spec.head).forEach(function (s) { minZ = Math.min(minZ, s.p[2] - s.w * 0.3); maxZ = Math.max(maxZ, s.p[2] + 0.05); maxY = Math.max(maxY, s.p[1] + s.hUp); });
    var top = maxY + (ICON_RACK[id] === 'elk' || ICON_RACK[id] === 'caribou' ? 0.75 * A.S / 1.4 : ICON_RACK[id] === 'moose' ? 0.25 * A.S : 0.18 * A.S);
    var sc = Math.min((w - 10) / (maxZ - minZ + 0.1), (h - 8) / top);
    ctx.save();
    ctx.translate(w / 2 + (maxZ + minZ) / 2 * sc, h - 4);
    ctx.scale(-sc, -sc); // model z -> screen x (head left), y up
    ctx.fillStyle = glow || '#e4d6b8'; ctx.strokeStyle = glow || '#e4d6b8';
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 10; }
    function blob(list) { for (var i = 0; i < list.length - 1; i++) { var a = list[i], b = list[i + 1]; for (var k = 0; k <= 4; k++) { var t = k / 4, y = a.p[1] + (b.p[1] - a.p[1]) * t, z = a.p[2] + (b.p[2] - a.p[2]) * t, hu = a.hUp + (b.hUp - a.hUp) * t, hd = a.hDown + (b.hDown - a.hDown) * t; ctx.beginPath(); ctx.ellipse(-z, y + (hu - hd) / 2, Math.max(0.01, (hu + hd) / 2 * 0.9), (hu + hd) / 2, 0, 0, TAU); ctx.fill(); } } }
    blob(spec.spine); blob(spec.head);
    ctx.lineCap = 'round';
    [spec.legs.FR, spec.legs.BR].forEach(function (L) { for (var i = 1; i < L.length - 1; i++) { var a = L[i], b = L[i + 1]; ctx.lineWidth = ((a.rz || a.r) + (b.rz || b.r)) * 1.1; ctx.beginPath(); ctx.moveTo(-a.p[2], a.p[1]); ctx.lineTo(-b.p[2], b.p[1]); ctx.stroke(); } });
    var e = spec.ears; ctx.beginPath(); ctx.moveTo(-e.p[2] + 0.02, e.p[1]); ctx.lineTo(-e.p[2] - e.len * 0.55, e.p[1] + e.len * 0.75); ctx.lineTo(-e.p[2] - 0.03, e.p[1] - 0.01); ctx.fill();
    var tl = spec.tail; ctx.lineWidth = tl.w * 0.8; ctx.beginPath(); ctx.moveTo(-tl.p[2], tl.p[1]); ctx.lineTo(-tl.p[2] - tl.len * 0.5, tl.p[1] - tl.len * 0.8); ctx.stroke();
    // headgear
    var P = A.poll, S = A.S, kind = ICON_RACK[id]; ctx.strokeStyle = glow ? '#fff3d6' : '#f3ead7'; ctx.lineWidth = 0.028 * S;
    function L(pts) { ctx.beginPath(); ctx.moveTo(-pts[0][1], pts[0][0]); for (var i = 1; i < pts.length; i++) ctx.lineTo(-pts[i][1], pts[i][0]); ctx.stroke(); }
    var by = P[1] + 0.05 * S, bz = P[2] + 0.03 * S;
    function R(y, z) { return [by + y * S, bz + z * S]; }
    if (kind === 'wt') { L([R(0, 0), R(0.18, 0.06), R(0.25, -0.1), R(0.22, -0.32)]); L([R(0.2, -0.04), R(0.42, -0.02)]); L([R(0.24, -0.16), R(0.42, -0.16)]); L([R(0.24, -0.26), R(0.36, -0.28)]); }
    else if (kind === 'md') { L([R(0, 0), R(0.25, 0.02)]); L([R(0.25, 0.02), R(0.47, 0.08)]); L([R(0.25, 0.02), R(0.43, -0.12)]); L([R(0.37, 0.05), R(0.5, -0.02)]); }
    else if (kind === 'elk') { var s2 = S / 1.52; ctx.lineWidth = 0.035 * S; L([R(0, 0), R(0.4 * s2, 0.2 * s2), R(0.86 * s2, 0.36 * s2), R(1.12 * s2, 0.2 * s2)]); L([R(0.03 * s2, 0.02), R(0.15 * s2, -0.32 * s2)]); L([R(0.3 * s2, 0.15 * s2), R(0.42 * s2, -0.1 * s2)]); L([R(0.52 * s2, 0.27 * s2), R(0.8 * s2, 0.02)]); L([R(0.75 * s2, 0.36 * s2), R(0.98 * s2, 0.14 * s2)]); }
    else if (kind === 'moose') { ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.ellipse(-(bz + 0.02 * S), by + 0.2 * S, 0.22 * S, 0.12 * S, 0.3, 0, TAU); ctx.fill(); }
    else if (kind === 'caribou') { var s3 = S / 1.2; L([R(0, 0), R(0.38 * s3, 0.28 * s3), R(0.88 * s3, 0.14 * s3), R(1.02 * s3, -0.15 * s3)]); L([R(0.08 * s3, 0.02), R(0.1 * s3, -0.3 * s3)]); L([R(0.2 * s3, 0.18 * s3), R(0.3 * s3, -0.1 * s3)]); }
    else if (kind === 'ph') { ctx.strokeStyle = '#1b1612'; L([R(-0.02, -0.03), R(0.24, -0.03), R(0.28, 0.04)]); L([R(0.1, -0.03), R(0.14, -0.08)]); }
    else if (kind === 'bh') { ctx.lineWidth = 0.07 * S; ctx.strokeStyle = '#c3a77e'; ctx.beginPath(); ctx.arc(-(bz + 0.07 * S), by - 0.06 * S, 0.11 * S, -0.3, Math.PI * 1.6); ctx.stroke(); }
    else if (kind === 'goat') { ctx.strokeStyle = '#1b1612'; L([R(-0.02, -0.04), R(0.15, 0.0), R(0.2, 0.08)]); }
    else if (kind === 'bison') { ctx.strokeStyle = '#1b1612'; ctx.lineWidth = 0.04 * S; L([R(-0.05, -0.08), R(0.03, -0.12), R(0.1, -0.15)]); }
    else if (kind === 'mx') { ctx.strokeStyle = '#d8cfbd'; ctx.lineWidth = 0.06 * S; L([R(0, -0.04), R(-0.08, 0.02), R(-0.22, -0.04), R(-0.15, -0.16)]); }
    ctx.restore();
  }
  WW.drawIcon = drawIcon;

  /* ------------------------------------------------------------------
   * 15. Debug helpers (tests)
   * ------------------------------------------------------------------ */
  WW.buildSpec = buildSpec; WW.getTemplate = getTemplate; WW.formCircle = formCircle; WW.startFight = startFight; WW.startStampede = startStampede;
  if (HG.debug) HG.debug.ww = {
    spawn: function (type, dist, angle, opts) { var a = HG.debug.spawnAnimal(type, dist == null ? 30 : dist, angle || 0, opts); return a; },
    legendary: function (lid, dist) { return WW.spawnLegendary(lid, dist || 60); },
    fight: function (type, dist) {
      var a = HG.debug.spawnAnimal(type, dist || 40, -6, { ww: { sex: 'm' } }), b = HG.debug.spawnAnimal(type, (dist || 40) + 4, 6, { ww: { sex: 'm' } });
      if (a && b) { a.yaw = U.yawTo(a.pos.x, a.pos.z, b.pos.x, b.pos.z); b.yaw = U.yawTo(b.pos.x, b.pos.z, a.pos.x, a.pos.z); startFight(a, b); }
      return [a, b];
    },
    react: function (a, sub) { var z = (a.def.hitZones || []).filter(function (q) { return q.sub === sub; })[0]; if (!z) return null; HG.zoneWorld(a, z, _zw); onHit(a, z.name, 1, { point: _zw.clone(), distance: a.distToPlayer }); return a.hitReaction; },
    call: function (id) { var sid = 'ww_' + id; if (HG.save.owned.indexOf(sid) < 0) HG.save.owned.push(sid); HG.equip('gear', sid); syncCallBtn(); callCD = 0; callIdx = Object.keys(CALLS).indexOf(id) >= 0 ? equippedCalls().indexOf(id) : 0; useCall(); },
    species: function () { return Object.keys(SPECIES).concat(Object.keys(LEGENDS)); }
  };
})();
