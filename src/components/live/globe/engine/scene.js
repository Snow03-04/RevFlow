// The globe: continents drawn as dots, one point of light per order placed today and, for every
// new order, a comet that lands on the right town and sends a shockwave through the dots.
import * as THREE from "three";

THREE.ColorManagement.enabled = false; // shader colours are screen colours, no conversion

const DEG = Math.PI / 180;
const FOV = 30;
const MAX_IMPACTS = 6;
const TRAIL = 90;

export const ll2v = (lat, lng, r = 1, out = new THREE.Vector3()) => {
  const la = lat * DEG, lo = lng * DEG, c = Math.cos(la);
  return out.set(c * Math.sin(lo) * r, Math.sin(la) * r, c * Math.cos(lo) * r);
};
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const easeIn = (t) => t * t * (0.6 + 0.4 * t);

export function createGlobe({ canvas, slot, fx, grid, gridW, gridH, codes }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  const tanHalf = Math.tan((FOV / 2) * DEG);
  const U = { uTime: { value: 0 }, uScale: { value: 1 } }; // shared by every material

  const globe = new THREE.Group();
  scene.add(globe);

  // ------------------------------------------------------------ stars
  const stars = new THREE.Group();
  scene.add(stars);
  {
    const n = 1500, pos = new Float32Array(n * 3), a = new Float32Array(n * 2), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(60);
      pos.set([v.x, v.y, v.z], i * 3);
      a[i * 2] = Math.random(); a[i * 2 + 1] = Math.pow(Math.random(), 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aStar", new THREE.BufferAttribute(a, 2));
    stars.add(new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { ...U, uDpr: { value: 1 } }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec2 aStar; uniform float uTime, uDpr; varying float vA;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float tw = 0.6 + 0.4 * sin(uTime * (0.4 + aStar.x * 1.6) + aStar.x * 50.0);
          vA = (0.16 + aStar.y * 0.75) * tw; gl_PointSize = (1.0 + aStar.y * 1.9) * uDpr; }`,
      fragmentShader: `varying float vA; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(0.78, 0.86, 1.0), vA * smoothstep(1.0, 0.2, d)); }`,
    })));
  }

  // ------------------------------------------------------------ dark sphere + atmosphere
  const coreMat = new THREE.ShaderMaterial({
    uniforms: { uFlash: { value: 0 }, uTint: { value: new THREE.Vector3(0.15, 0.3, 0.52) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uFlash; uniform vec3 uTint; varying vec3 vN; varying vec3 vV;
      void main() { float f = 1.0 - max(dot(vN, vV), 0.0);
        float light = pow(max(dot(vN, normalize(vec3(-0.5, 0.62, 0.6))), 0.0), 1.5);
        vec3 col = vec3(0.012, 0.016, 0.026) + vec3(0.03, 0.044, 0.07) * light;
        col += uTint * pow(f, 3.0) * (0.6 + uFlash * 0.9);
        gl_FragColor = vec4(col, 1.0); }`,
  });
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.994, 96, 64), coreMat));

  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uFlash: { value: 0 }, uCol: { value: new THREE.Vector3(0.2, 0.42, 0.78) } },
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uFlash; uniform vec3 uCol; varying vec3 vN; varying vec3 vV;
      void main() { float i = pow(clamp(-dot(vN, vV) * 1.72, 0.0, 1.0), 2.6); gl_FragColor = vec4(uCol * (0.62 + uFlash * 1.3), i); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.2, 96, 64), atmoMat));

  // ------------------------------------------------------------ continents as dots
  const impactVec = Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector4(0, 1, 0, -100));
  const impactCol = Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector3(1, 1, 1));
  let dotCountry, heatAttr, heatTarget, heatMoving = false;
  const dotMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uSize: { value: 0.0082 }, uImpact: { value: impactVec }, uImpactCol: { value: impactCol }, uHeatCol: { value: new THREE.Vector3(0.55, 0.8, 1) } },
    transparent: true, depthWrite: false,
    vertexShader: `attribute float aSeed; attribute float aHeat;
      uniform float uTime, uScale, uSize; uniform vec4 uImpact[${MAX_IMPACTS}]; uniform vec3 uImpactCol[${MAX_IMPACTS}]; uniform vec3 uHeatCol;
      varying vec3 vCol; varying float vA;
      void main() {
        vec3 p = position; float glow = 0.0; vec3 tint = vec3(0.0); float lift = 0.0;
        for (int i = 0; i < ${MAX_IMPACTS}; i++) {
          float t = uTime - uImpact[i].w;
          if (t < 0.0 || t > 7.0) continue;
          float d = acos(clamp(dot(p, uImpact[i].xyz), -1.0, 1.0));
          float ring = exp(-pow((d - t * 0.5) / 0.042, 2.0)) * exp(-t * 0.85);
          float core = exp(-d * d / 0.014) * exp(-t * 0.55);
          float w = ring * 1.5 + core;
          glow += w; tint += uImpactCol[i] * w; lift += ring * 0.036 + core * 0.012;
        }
        p *= 1.0 + lift;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float facing = dot(normalize(normalMatrix * position), normalize(-mv.xyz));
        float tw = 0.86 + 0.14 * sin(uTime * (0.5 + aSeed * 1.6) + aSeed * 40.0);
        vec3 col = mix(vec3(0.5, 0.57, 0.66), uHeatCol, aHeat * 0.9) * (0.5 * tw + aHeat * 0.6);
        vCol = col + (tint / max(1.0, glow)) * min(glow, 1.25) * 1.15;
        vA = smoothstep(-0.02, 0.4, facing) * (0.74 + aHeat * 0.26);
        gl_PointSize = max(1.0, uSize * uScale / -mv.z * (1.0 + min(glow, 1.3) * 0.62 + aHeat * 0.3));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec3 vCol; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.62, d); if (a < 0.02) discard; gl_FragColor = vec4(vCol, a * vA); }`,
  });
  {
    const pos = [], ctry = [], seed = [], v = new THREE.Vector3(), step = 0.8;
    let row = 0;
    for (let lat = -57; lat <= 83.5; lat += step, row++) {
      const n = Math.max(1, Math.round((360 * Math.cos(lat * DEG)) / step));
      const gy = Math.min(gridH - 1, Math.floor(((90 - lat) / 180) * gridH));
      for (let i = 0; i < n; i++) {
        const lng = -180 + ((i + (row % 2) * 0.5) * 360) / n;
        const c = grid[gy * gridW + (Math.floor(((lng + 180) / 360) * gridW) % gridW)];
        if (!c) continue;
        ll2v(lat, lng, 1, v);
        pos.push(v.x, v.y, v.z); ctry.push(c); seed.push(Math.random());
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
    heatAttr = new THREE.Float32BufferAttribute(new Float32Array(ctry.length), 1);
    heatAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aHeat", heatAttr);
    dotCountry = Uint8Array.from(ctry);
    heatTarget = new Float32Array(ctry.length);
    const pts = new THREE.Points(g, dotMat);
    pts.frustumCulled = false;
    globe.add(pts);
  }

  // ------------------------------------------------------------ orbits (quiet decoration)
  const orbits = [];
  for (const [r, tiltX, tiltZ, speed, alpha] of [[1.42, 68, 12, 0.11, 0.13], [1.63, 104, -22, -0.07, 0.08]]) {
    const pts = [];
    for (let i = 0; i <= 160; i++) pts.push(Math.cos((i / 160) * Math.PI * 2) * r, Math.sin((i / 160) * Math.PI * 2) * r, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const grp = new THREE.Group();
    grp.rotation.set(tiltX * DEG, 0, tiltZ * DEG);
    grp.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: alpha, depthWrite: false, blending: THREE.AdditiveBlending })));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute([r, 0, 0], 3));
    const sat = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uScale; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 0.03 * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(0.3, 0.0, d) + exp(-d * d * 6.0) * 0.5; gl_FragColor = vec4(vec3(0.75, 0.88, 1.0), a * 0.9); }`,
    }));
    sat.frustumCulled = false;
    grp.add(sat);
    scene.add(grp);
    orbits.push({ sat, speed, phase: Math.random() * 6 });
  }

  // ------------------------------------------------------------ today's orders: a point of light + a beam
  const CAP = 4096;
  const mk = {
    n: 0, ids: [],
    pos: new Float32Array(CAP * 3), col: new Float32Array(CAP * 3), meta: new Float32Array(CAP * 4), // meta: size, birth, phase, strength
    lpos: new Float32Array(CAP * 6), lcol: new Float32Array(CAP * 6), lmeta: new Float32Array(CAP * 8), // per vertex: t, height, birth, strength
  };
  const mkGeo = new THREE.BufferGeometry();
  const mkAttrs = { position: new THREE.BufferAttribute(mk.pos, 3), aCol: new THREE.BufferAttribute(mk.col, 3), aMeta: new THREE.BufferAttribute(mk.meta, 4) };
  for (const [k, a] of Object.entries(mkAttrs)) { a.setUsage(THREE.DynamicDrawUsage); mkGeo.setAttribute(k, a); }
  mkGeo.setDrawRange(0, 0);
  const markers = new THREE.Points(mkGeo, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aCol; attribute vec4 aMeta; uniform float uTime, uScale; varying vec3 vCol; varying float vF; varying float vK;
      void main() { float age = uTime - aMeta.y;
        float pop = 1.0 + 2.4 * exp(-max(age, 0.0) * 2.0);
        float pulse = 1.0 + 0.13 * sin(uTime * 1.9 + aMeta.z);
        vec4 mv = modelViewMatrix * vec4(position * 1.005, 1.0);
        vF = dot(normalize(normalMatrix * position), normalize(-mv.xyz)); vCol = aCol; vK = aMeta.w;
        gl_PointSize = aMeta.x * pop * pulse * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vCol; varying float vF; varying float vK;
      void main() { float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = smoothstep(0.3, 0.05, d); float halo = exp(-d * d * 4.5) * 0.6;
        float a = (core + halo) * smoothstep(0.0, 0.3, vF) * vK * smoothstep(1.0, 0.8, d);
        gl_FragColor = vec4(mix(vCol, vec3(1.0), core * 0.7), a); }`,
  }));
  markers.frustumCulled = false;
  globe.add(markers);

  const lnGeo = new THREE.BufferGeometry();
  const lnAttrs = { position: new THREE.BufferAttribute(mk.lpos, 3), aCol: new THREE.BufferAttribute(mk.lcol, 3), aMeta: new THREE.BufferAttribute(mk.lmeta, 4) };
  for (const [k, a] of Object.entries(lnAttrs)) { a.setUsage(THREE.DynamicDrawUsage); lnGeo.setAttribute(k, a); }
  lnGeo.setDrawRange(0, 0);
  const beams = new THREE.LineSegments(lnGeo, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aCol; attribute vec4 aMeta; uniform float uTime; varying vec3 vCol; varying float vA;
      void main() { float g = clamp((uTime - aMeta.z) / 0.7, 0.0, 1.0); g = 1.0 - pow(1.0 - g, 3.0);
        vec3 p = position * (1.0 + aMeta.x * aMeta.y * g);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float f = dot(normalize(normalMatrix * position), normalize(-mv.xyz));
        vCol = aCol; vA = mix(0.85, 0.0, aMeta.x) * smoothstep(-0.1, 0.25, f) * aMeta.w; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vCol; varying float vA; void main() { gl_FragColor = vec4(vCol, vA); }`,
  }));
  beams.frustumCulled = false;
  globe.add(beams);

  const tmp = new THREE.Vector3();
  function writeMarker(i, m, born) {
    ll2v(m.lat, m.lng, 1, tmp);
    const c = rgb(m.color), k = m.dim ? 0.16 : 1;
    const size = 0.03 + Math.min(0.03, Math.sqrt(Math.max(m.eur, 1)) * 0.0022);
    const h = 0.035 + Math.min(0.2, Math.max(m.eur, 1) * 0.0011);
    mk.pos.set([tmp.x, tmp.y, tmp.z], i * 3);
    mk.col.set([c.x, c.y, c.z], i * 3);
    mk.meta.set([size, born, (i * 2.399) % 6.283, k], i * 4);
    mk.lpos.set([tmp.x, tmp.y, tmp.z, tmp.x, tmp.y, tmp.z], i * 6);
    mk.lcol.set([c.x, c.y, c.z, c.x, c.y, c.z], i * 6);
    mk.lmeta.set([0, h, born, k, 1, h, born, k], i * 8);
  }
  function flushMarkers() {
    for (const a of [...Object.values(mkAttrs), ...Object.values(lnAttrs)]) a.needsUpdate = true;
    mkGeo.setDrawRange(0, mk.n);
    lnGeo.setDrawRange(0, mk.n * 2);
  }
  /** Replace every point (on open, on switching store). `fresh` = they are born now, with the pop. */
  function setMarkers(list, { fresh = false } = {}) {
    const old = new Map(mk.ids.map((id, i) => [id, mk.meta[i * 4 + 1]]));
    mk.n = Math.min(CAP, list.length);
    mk.ids = [];
    for (let i = 0; i < mk.n; i++) {
      const m = list[i];
      mk.ids.push(m.id);
      writeMarker(i, m, old.get(m.id) ?? (fresh ? U.uTime.value + i * 0.03 : -100));
    }
    flushMarkers();
  }
  function addMarker(m) {
    let i = mk.ids.indexOf(m.id);
    if (i < 0) { if (mk.n >= CAP) return; i = mk.n++; mk.ids.push(m.id); }
    writeMarker(i, m, U.uTime.value);
    flushMarkers();
  }
  function removeMarker(id) {
    const i = mk.ids.indexOf(id);
    if (i < 0) return;
    mk.meta[i * 4 + 3] = 0; mk.lmeta[i * 8 + 3] = 0; mk.lmeta[i * 8 + 7] = 0;
    flushMarkers();
  }

  // ------------------------------------------------------------ heat per country
  const codeIdx = new Map(codes.map((c, i) => [c, i]));
  function setHeat(byCode, color) {
    const lut = new Float32Array(256);
    for (const [code, v] of Object.entries(byCode)) { const i = codeIdx.get(code); if (i) lut[i] = v; }
    for (let i = 0; i < dotCountry.length; i++) heatTarget[i] = lut[dotCountry[i]];
    if (color) dotMat.uniforms.uHeatCol.value.copy(rgb(color)).lerp(new THREE.Vector3(1, 1, 1), 0.25);
    heatMoving = true;
  }

  // ------------------------------------------------------------ orientation and camera
  const view = { lat: 30, lng: 12, homeLat: 34, homeLng: 14, focus: null, focusUntil: 0, zoom: 1, userZoom: 1, punch: 0,
    dragLat: 0, dragLng: 0, velLat: 0, velLng: 0, dragging: false, lastTouch: -100, cx: 0, cy: 0, rpx: 300 };
  let vw = 1, vh = 1, dpr = 1;

  function layout() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    const d = Math.min(window.devicePixelRatio || 1, 1.75);
    if (w !== vw || h !== vh || d !== dpr) {
      vw = w; vh = h; dpr = d;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      U.uScale.value = (h * dpr) / 2 / tanHalf;
      stars.children[0].material.uniforms.uDpr.value = dpr;
    }
    const r = slot.getBoundingClientRect(), c = canvas.getBoundingClientRect();
    view.cx = r.left + r.width / 2 - c.left;
    view.cy = r.top + r.height / 2 - c.top;
    view.rpx = Math.max(60, Math.min(r.width * 0.56, r.height * 0.47));
  }

  function place() {
    const rpx = view.rpx * view.zoom;
    const alpha = Math.atan((rpx / (vh / 2)) * tanHalf);
    camera.position.set(0, 0, 1 / Math.sin(alpha));
    camera.setViewOffset(vw, vh, vw / 2 - view.cx, vh / 2 - view.cy, vw, vh);
    camera.updateProjectionMatrix();
    globe.rotation.set((view.lat + view.dragLat) * DEG, -(view.lng + view.dragLng) * DEG, 0, "XYZ");
    stars.rotation.set(view.lat * DEG * 0.12, -(view.lng + view.dragLng * 0.3) * DEG * 0.12 + U.uTime.value * 0.004, 0);
  }

  // drag to rotate, wheel to zoom
  let px = 0, py = 0;
  canvas.addEventListener("pointerdown", (e) => { view.dragging = true; px = e.clientX; py = e.clientY; canvas.setPointerCapture(e.pointerId); view.velLat = view.velLng = 0; });
  canvas.addEventListener("pointermove", (e) => {
    if (!view.dragging) return;
    const k = 62 / (view.rpx * view.zoom), dx = (e.clientX - px) * k, dy = (e.clientY - py) * k;
    px = e.clientX; py = e.clientY;
    view.dragLng -= dx; view.dragLat = Math.max(-70, Math.min(70, view.dragLat + dy));
    view.velLng = -dx * 60; view.velLat = dy * 60;
    view.lastTouch = U.uTime.value;
  });
  const endDrag = () => { view.dragging = false; view.lastTouch = U.uTime.value; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); view.userZoom = Math.max(0.75, Math.min(2.4, view.userZoom * Math.exp(-e.deltaY * 0.0012))); view.lastTouch = U.uTime.value; }, { passive: false });
  canvas.addEventListener("dblclick", () => { view.userZoom = 1; view.dragLat = view.dragLng = 0; });

  // ------------------------------------------------------------ comets and impacts
  const comets = [], impacts = [], labels = [];
  let impactSlot = 0;
  const cometMat = () => new THREE.ShaderMaterial({
    uniforms: { ...U, uCol: { value: new THREE.Vector3(1, 1, 1) }, uFade: { value: 1 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aK; uniform float uScale; varying float vK;
      void main() { vK = aK; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = mix(0.09, 0.014, pow(aK, 0.45)) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uFade; varying float vK;
      void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float core = smoothstep(0.45, 0.0, d); float halo = exp(-d * d * 4.0);
        float a = (core * (1.0 - vK) + halo * 0.42) * pow(1.0 - vK, 1.3) * uFade * smoothstep(1.0, 0.7, d);
        gl_FragColor = vec4(mix(uCol, vec3(1.0), core * (1.0 - vK) * 0.85), a); }`,
  });
  const ringGeo = new THREE.RingGeometry(0.93, 1, 96);
  const Z = new THREE.Vector3(0, 0, 1);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3();
  const bez = (s, c, e, t, out) => { const u = 1 - t; return out.set(u * u * s.x + 2 * u * t * c.x + t * t * e.x, u * u * s.y + 2 * u * t * c.y + t * t * e.y, u * u * s.z + 2 * u * t * c.z + t * t * e.z); };

  /** A comet to (lat, lng). The promise resolves at the instant of impact. */
  function strike(m, { label, focus = true, duration = 1.25 } = {}) {
    return new Promise((resolve) => {
      const dir = ll2v(m.lat, m.lng, 1).clone();
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(TRAIL * 3), k = new Float32Array(TRAIL);
      for (let i = 0; i < TRAIL; i++) k[i] = i / (TRAIL - 1);
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute("aK", new THREE.BufferAttribute(k, 1));
      const mat = cometMat();
      mat.uniforms.uCol.value.copy(rgb(m.color));
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false; pts.renderOrder = 10;
      // a thread of light inside the trail, so the points do not show apart at speed
      const line = new THREE.Line(geo, new THREE.ShaderMaterial({
        uniforms: mat.uniforms, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute float aK; varying float vK; void main() { vK = aK; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uCol; uniform float uFade; varying float vK; void main() { gl_FragColor = vec4(mix(uCol, vec3(1.0), 0.55), pow(1.0 - vK, 1.2) * uFade * 0.9); }`,
      }));
      line.frustumCulled = false; line.renderOrder = 10;
      pts.add(line);
      scene.add(pts);
      // It comes in from above, on the order list's side, but inside the free part of the screen (the canvas sits under the panels).
      const side = Math.random() < 0.8 ? 1 : -1;
      const start = new THREE.Vector3(side * (0.55 + Math.random() * 0.65), 1.55 + Math.random() * 0.3, 0.9 + Math.random() * 0.7);
      comets.push({ m, dir, pts, pos, mat, start, t: 0, duration, hit: false, label, resolve });
      if (focus) { view.focus = { lat: m.lat, lng: m.lng }; view.focusUntil = U.uTime.value + duration + 4.2; }
    });
  }

  function onImpact(c) {
    const now = U.uTime.value, col = rgb(c.m.color);
    const s = impactSlot++ % MAX_IMPACTS;
    impactVec[s].set(c.dir.x, c.dir.y, c.dir.z, now);
    impactCol[s].copy(col);
    view.punch = 1;
    const imp = { dir: c.dir, t0: now, rings: [], sparks: null, flash: null };
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(col.x, col.y, col.z), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      mesh.quaternion.setFromUnitVectors(Z, c.dir);
      globe.add(mesh);
      imp.rings.push({ mesh, delay: i * 0.22, max: 0.2 + i * 0.07 });
    }
    // sparks
    const n = 44, sp = new Float32Array(n * 3), vel = [], right = new THREE.Vector3().crossVectors(c.dir, Math.abs(c.dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(), up2 = new THREE.Vector3().crossVectors(c.dir, right);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, out = 0.15 + Math.random() * 0.55, lat = 0.25 + Math.random() * 0.75;
      vel.push(new THREE.Vector3().addScaledVector(right, Math.cos(a) * out).addScaledVector(up2, Math.sin(a) * out).addScaledVector(c.dir, lat * 0.55).multiplyScalar(0.55 + Math.random() * 0.5));
      sp.set([c.dir.x, c.dir.y, c.dir.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage));
    const smat = new THREE.ShaderMaterial({
      uniforms: { ...U, uCol: { value: col.clone() }, uLife: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uScale, uLife; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 0.018 * (0.4 + uLife) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uCol; uniform float uLife; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(mix(uCol, vec3(1.0), 0.5), smoothstep(1.0, 0.0, d) * uLife); }`,
    });
    imp.sparks = { pts: new THREE.Points(sg, smat), sp, vel, n };
    imp.sparks.pts.frustumCulled = false;
    globe.add(imp.sparks.pts);
    // flash
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.Float32BufferAttribute([c.dir.x * 1.01, c.dir.y * 1.01, c.dir.z * 1.01], 3));
    const fmat = new THREE.ShaderMaterial({
      uniforms: { ...U, uCol: { value: col.clone() }, uLife: { value: 1 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uScale, uLife; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = (0.16 + 0.5 * (1.0 - uLife)) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uCol; uniform float uLife; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = (exp(-d * d * 5.0) + smoothstep(0.25, 0.0, d)) * uLife * uLife * smoothstep(1.0, 0.75, d); gl_FragColor = vec4(mix(uCol, vec3(1.0), 0.6), a); }`,
    });
    imp.flash = new THREE.Points(fg, fmat);
    imp.flash.frustumCulled = false; imp.flash.renderOrder = 11;
    globe.add(imp.flash);
    impacts.push(imp);

    addMarker(c.m);
    if (c.label) {
      const el = document.createElement("div");
      el.className = "pop" + (c.label.test ? " test" : "");
      el.style.setProperty("--c", c.m.color);
      const b = document.createElement("b"); b.textContent = c.label.amount;
      const s2 = document.createElement("span"); s2.textContent = c.label.where;
      if (c.label.store) { const sn = document.createElement("i"); sn.className = "sn"; sn.textContent = c.label.store; s2.append(" · ", sn); }
      el.append(b, s2);
      fx.append(el);
      for (const l of labels) if (l.dir.angleTo(c.dir) < 0.2) l.life = Math.min(l.life, now - l.t0 + 0.35);
      labels.push({ el, dir: c.dir, t0: now, life: 4.6 });
    }
    c.resolve();
  }

  /** A milestone: the whole globe lights up and throws a ring of ripples. */
  function celebrate(color = "#9fd3f5") {
    flash = 1;
    const col = rgb(color), now = U.uTime.value;
    for (let i = 0; i < 3; i++) {
      const s = impactSlot++ % MAX_IMPACTS;
      const d = ll2v(view.lat + 20 + i * 12, view.lng + (i - 1) * 40, 1);
      impactVec[s].set(d.x, d.y, d.z, now + i * 0.18);
      impactCol[s].copy(col).multiplyScalar(0.7);
    }
  }

  // ------------------------------------------------------------ loop
  let flash = 0;
  function step(dt) {
    U.uTime.value += dt;
    const t = U.uTime.value;
    layout();

    // where it looks: the order that just landed, otherwise the stores' region, swaying slowly
    const focusing = view.focus && t < view.focusUntil;
    let tLat = view.homeLat + Math.sin(t * 0.09) * 3.5, tLng = view.homeLng + Math.sin(t * 0.055) * 13;
    if (focusing) { tLat = Math.max(-50, Math.min(58, view.focus.lat - 13)); tLng = view.focus.lng; }
    let dLng = ((tLng - view.lng + 540) % 360) - 180;
    view.lat = damp(view.lat, tLat, focusing ? 2.4 : 0.7, dt);
    view.lng += dLng * (1 - Math.exp(-(focusing ? 2.4 : 0.7) * dt));
    if (!view.dragging) {
      view.dragLng += view.velLng * dt; view.dragLat = Math.max(-70, Math.min(70, view.dragLat + view.velLat * dt));
      view.velLng = damp(view.velLng, 0, 3, dt); view.velLat = damp(view.velLat, 0, 3, dt);
      if (t - view.lastTouch > 5 || focusing) { view.dragLat = damp(view.dragLat, 0, 1.6, dt); view.dragLng = damp(view.dragLng, 0, 1.6, dt); }
      if (Math.abs(view.dragLng) > 180) view.dragLng -= Math.sign(view.dragLng) * 360;
    }
    view.punch = damp(view.punch, 0, 2.2, dt);
    view.zoom = damp(view.zoom, view.userZoom * (focusing ? 1.09 : 1) * (1 + view.punch * 0.025), 2.2, dt);
    place();
    globe.updateMatrixWorld(true);

    flash = damp(flash, 0, 1.4, dt);
    coreMat.uniforms.uFlash.value = flash + view.punch * 0.35;
    atmoMat.uniforms.uFlash.value = flash + view.punch * 0.3;

    if (heatMoving) {
      const a = heatAttr.array, k = 1 - Math.exp(-3 * dt);
      let far = 0;
      for (let i = 0; i < a.length; i++) { const d = heatTarget[i] - a[i]; if (d) { a[i] += Math.abs(d) < 0.004 ? d : d * k; if (Math.abs(d) > far) far = Math.abs(d); } }
      heatAttr.needsUpdate = true;
      heatMoving = far > 0.004;
    }
    for (const o of orbits) o.sat.rotation.z = o.phase + t * o.speed;

    // comets
    for (let i = comets.length - 1; i >= 0; i--) {
      const c = comets[i];
      c.t += dt / c.duration;
      B.copy(c.dir).applyMatrix4(globe.matrixWorld);            // target (the globe keeps turning)
      C.copy(B).multiplyScalar(1.75).addScaledVector(c.start, 0.38); // control point: it arrives from above
      for (let j = 0; j < TRAIL; j++) {
        const u = c.t - (j / (TRAIL - 1)) * 0.2;
        const e = easeIn(Math.max(0, Math.min(1, u)));
        bez(c.start, C, B, e, P);
        if (u > 1) P.copy(B);
        c.pos.set([P.x, P.y, P.z], j * 3);
      }
      c.pts.geometry.attributes.position.needsUpdate = true;
      if (!c.hit && c.t >= 1) { c.hit = true; onImpact(c); }
      if (c.t > 1) c.mat.uniforms.uFade.value = Math.max(0, 1 - (c.t - 1) / 0.3);
      if (c.t >= 1.3) { scene.remove(c.pts); c.pts.geometry.dispose(); c.mat.dispose(); c.pts.children[0].material.dispose(); comets.splice(i, 1); }
    }

    // impacts
    for (let i = impacts.length - 1; i >= 0; i--) {
      const m = impacts[i], age = t - m.t0;
      for (const r of m.rings) {
        const a = (age - r.delay) / 1.7;
        if (a <= 0 || a >= 1) { r.mesh.visible = false; continue; }
        r.mesh.visible = true;
        const th = (1 - Math.pow(1 - a, 2.2)) * r.max;
        r.mesh.position.copy(m.dir).multiplyScalar(Math.cos(th) * 1.004);
        r.mesh.scale.setScalar(Math.sin(th) * 1.004 + 0.0001);
        r.mesh.material.opacity = Math.pow(1 - a, 1.6) * 0.85;
      }
      const life = Math.max(0, 1 - age / 1.5);
      const sp = m.sparks;
      if (sp.pts.parent) {
        for (let j = 0; j < sp.n; j++) {
          const v = sp.vel[j];
          A.set(sp.sp[j * 3], sp.sp[j * 3 + 1], sp.sp[j * 3 + 2]).addScaledVector(v, dt * 0.42);
          v.multiplyScalar(Math.exp(-2.4 * dt)).addScaledVector(A, -dt * 0.16); // drag, then fall back to the globe
          if (A.length() < 1.002) A.setLength(1.002);
          sp.sp.set([A.x, A.y, A.z], j * 3);
        }
        sp.pts.geometry.attributes.position.needsUpdate = true;
        sp.pts.material.uniforms.uLife.value = life;
      }
      m.flash.material.uniforms.uLife.value = Math.max(0, 1 - age / 0.75);
      if (age > 2.6) {
        for (const r of m.rings) { globe.remove(r.mesh); r.mesh.material.dispose(); }
        globe.remove(sp.pts); sp.pts.geometry.dispose(); sp.pts.material.dispose();
        globe.remove(m.flash); m.flash.geometry.dispose(); m.flash.material.dispose();
        impacts.splice(i, 1);
      }
    }

    // "+€128" labels pinned to where it landed
    for (let i = labels.length - 1; i >= 0; i--) {
      const l = labels[i], age = t - l.t0;
      if (age > l.life) { l.el.remove(); labels.splice(i, 1); continue; }
      P.copy(l.dir).multiplyScalar(1.03).applyMatrix4(globe.matrixWorld);
      const facing = A.copy(P).normalize().dot(B.copy(camera.position).sub(P).normalize());
      P.project(camera);
      const x = (P.x * 0.5 + 0.5) * vw, y = (-P.y * 0.5 + 0.5) * vh;
      const rise = 26 + (1 - Math.exp(-age * 1.6)) * 46;
      const inK = Math.min(1, age / 0.28), outK = Math.min(1, (l.life - age) / 0.7);
      const sc = 0.6 + 0.4 * (1 - Math.pow(1 - inK, 3)) + 0.18 * Math.sin(Math.min(1, age / 0.5) * Math.PI);
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${(y - rise).toFixed(1)}px) translate(-50%, -100%) scale(${sc.toFixed(3)})`;
      l.el.style.opacity = (Math.min(inK, outK) * (facing > -0.1 ? 1 : 0.25)).toFixed(3);
    }

    renderer.render(scene, camera);
  }

  // its own clock: it can be paused and stepped by hand (tests with the window covered)
  const clock = { paused: false, last: performance.now(), frames: 0, slow: 0, onSlow: null, alive: true };
  function frame(now) {
    if (!clock.alive) return;
    const raw = (now - clock.last) / 1000, dt = Math.min(0.1, raw);
    clock.last = now;
    if (!clock.paused) {
      step(dt); clock.frames++;
      // 40 frames in a row above 30 ms (with the window in view) = a machine drawing without a GPU
      if (clock.onSlow && !document.hidden) { clock.slow = raw > 0.03 && raw < 0.2 ? clock.slow + 1 : 0; if (clock.slow > 40) { const f = clock.onSlow; clock.onSlow = null; f(); } }
    }
    requestAnimationFrame(frame);
  }
  const software = (() => { try { const gl = renderer.getContext(), e = gl.getExtension("WEBGL_debug_renderer_info"); return /basic render|swiftshader|llvmpipe|software/i.test(String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "")); } catch { return false; } })();
  layout();
  requestAnimationFrame(frame);

  return {
    strike, setMarkers, addMarker, removeMarker, setHeat, celebrate,
    setHome(lat, lng) { view.homeLat = lat; view.homeLng = lng; },
    pause(v = true) { clock.paused = v; clock.last = performance.now(); },
    advance(sec) { for (let left = sec; left > 1e-6; left -= 1 / 60) step(Math.min(1 / 60, left)); },
    get time() { return U.uTime.value; },
    get frames() { return clock.frames; },
    get busy() { return comets.length + impacts.length; },
    /** Stop drawing and free the GPU context (the view was closed). */
    destroy() {
      clock.alive = false;
      for (const l of labels) l.el.remove();
      scene.traverse((o) => { o.geometry?.dispose?.(); if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.()); else o.material?.dispose?.(); });
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
    software,
    set onSlow(f) { clock.onSlow = f; },
    info: () => ({ dots: dotCountry.length, markers: mk.n, comets: comets.length, impacts: impacts.length, view: { ...view }, size: [vw, vh, dpr], gl: renderer.getContext().getParameter(renderer.getContext().VERSION) }),
  };
}
