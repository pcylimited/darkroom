// Sky, exterior light and atmosphere: a setting moon in the west, the first cold light of
// dawn in the east, a lamp on the landing, drifting dust that catches the torch beam.
import * as THREE from 'three';
import { clamp } from './util.js';

export class Env {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.dawn = 0; // 0 night .. 1 escaped into daylight
    this.dustDensity = 0.02;
    this.shaftScale = 1.0;

    scene.fog = new THREE.FogExp2(new THREE.Color(0.012, 0.018, 0.028), 0.022);

    const size = game.quality.dirShadow;
    const mkDir = (color, intensity, dir) => {
      const l = new THREE.DirectionalLight(color, intensity);
      const d = new THREE.Vector3(...dir).normalize();
      l.target.position.set(14, 0, 9.5);
      l.position.copy(l.target.position).addScaledVector(d, -60);
      l.castShadow = true;
      l.shadow.mapSize.set(size, size);
      const c = l.shadow.camera;
      c.left = -27; c.right = 27; c.top = 27; c.bottom = -27; c.near = 10; c.far = 110;
      c.updateProjectionMatrix();
      l.shadow.bias = -0.0006;
      l.shadow.normalBias = 0.04;
      l.shadow.autoUpdate = false;
      l.shadow.needsUpdate = true;
      scene.add(l, l.target);
      return l;
    };
    this.moonDir = new THREE.Vector3(0.72, -0.5, 0.46).normalize();
    this.dawnDir = new THREE.Vector3(-0.86, -0.27, -0.36).normalize();
    this.moon = mkDir(new THREE.Color(0.50, 0.66, 1.0), 0.55, this.moonDir.toArray());
    this.dawnLight = mkDir(new THREE.Color(0.60, 0.78, 1.0), 0.8, this.dawnDir.toArray());
    this.dirs = [this.moon, this.dawnLight];
    this.hemi = new THREE.HemisphereLight(new THREE.Color(0.10, 0.16, 0.26), new THREE.Color(0.03, 0.025, 0.02), 0.22);
    scene.add(this.hemi);

    const lp = game.level.lampPost;
    this.lamp = new THREE.PointLight(new THREE.Color(1.0, 0.62, 0.3), 26, 16, 1.7);
    this.lamp.position.set(lp.x, lp.y - 0.05, lp.z);
    scene.add(this.lamp);
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 5.2, 2.2), fog: false });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), this.lampMat);
    bulb.position.set(lp.x, lp.y, lp.z);
    scene.add(bulb);

    // sky dome
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uDawn: { value: 0 }, uDawnDir: { value: this.dawnDir.clone().negate() }, uMoonDir: { value: this.moonDir.clone().negate() } },
      vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; vec4 p = modelViewMatrix * vec4(position, 0.0); gl_Position = projectionMatrix * vec4(p.xyz, 1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir; uniform float uDawn; uniform vec3 uDawnDir; uniform vec3 uMoonDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 zen = mix(vec3(0.010, 0.018, 0.042), vec3(0.16, 0.26, 0.42), uDawn);
          vec3 hor = mix(vec3(0.030, 0.055, 0.10), vec3(0.62, 0.70, 0.74), uDawn);
          vec3 col = mix(hor, zen, pow(h, 0.42));
          float az = max(dot(normalize(d.xz + 1e-5), normalize(uDawnDir.xz)), 0.0);
          float glow = pow(az, 3.0) * exp(-h * 6.0);
          col += mix(vec3(0.16, 0.24, 0.32), vec3(1.1, 0.86, 0.60), uDawn) * glow;
          col += vec3(0.05, 0.07, 0.10) * exp(-h * 14.0);
          // stars fade as the sky lightens
          vec3 g = floor(d * 140.0);
          float s = step(0.9965, hash(g)) * smoothstep(0.02, 0.25, d.y) * (1.0 - uDawn);
          col += vec3(0.5, 0.56, 0.7) * s * (0.4 + hash(g + 3.0));
          float m = dot(d, normalize(uMoonDir));
          col += vec3(1.6, 1.7, 1.75) * smoothstep(0.99962, 0.99975, m) * (1.0 - 0.7 * uDawn);
          col += vec3(0.10, 0.14, 0.2) * pow(max(m, 0.0), 180.0) * (1.0 - uDawn);
          col = mix(col, hor * 0.4, smoothstep(0.0, -0.12, d.y));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    dome.frustumCulled = false;
    dome.renderOrder = -10;
    this.dome = dome;
    scene.add(dome);

    // distant tree line silhouette
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    let sd = 99;
    const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    let y = 60;
    g.beginPath(); g.moveTo(0, 128);
    for (let x = 0; x <= 2048; x += 3) {
      y += (rnd() - 0.5) * 9; y = clamp(y, 28, 92);
      const spike = rnd() < 0.2 ? rnd() * 26 : 0;
      g.lineTo(x, y - spike);
    }
    g.lineTo(2048, 128); g.fill();
    const tl = new THREE.CanvasTexture(c);
    tl.wrapS = THREE.RepeatWrapping;
    this.treeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.006, 0.010, 0.016), alphaMap: tl, alphaTest: 0.5, side: THREE.BackSide, fog: false });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(105, 105, 22, 64, 1, true), this.treeMat);
    ring.position.set(14, 9.5, 10);
    ring.renderOrder = -9;
    scene.add(ring);

    // dust motes: only visible where the torch beam passes
    const N = game.quality.motes;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = Math.random() * 12; pos[i * 3 + 1] = Math.random() * 3.6; pos[i * 3 + 2] = Math.random() * 12; seed[i] = Math.random(); }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.moteMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uTPos: { value: new THREE.Vector3() }, uTDir: { value: new THREE.Vector3(0, 0, -1) }, uTCos: { value: new THREE.Vector2(0.8, 0.9) }, uTInt: { value: 0 }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float seed; uniform float uTime; uniform vec3 uCam, uTPos, uTDir; uniform vec2 uTCos; uniform float uTInt, uScale;
        varying float vA;
        void main() {
          vec3 p = position;
          p += vec3(sin(uTime * 0.21 + seed * 40.0) * 0.25, -uTime * (0.012 + seed * 0.02) + sin(uTime * 0.3 + seed * 17.0) * 0.1, cos(uTime * 0.17 + seed * 23.0) * 0.25);
          p.xz = mod(p.xz - uCam.xz + 6.0, 12.0) - 6.0 + uCam.xz;
          p.y = mod(p.y, 3.55) + 0.02;
          vec3 L = p - uTPos; float d = length(L);
          float cone = smoothstep(uTCos.x, uTCos.y, dot(L / d, uTDir));
          vA = cone * uTInt / (1.0 + d * d) * smoothstep(11.0, 6.0, d) * (0.4 + seed);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uScale * (0.006 + 0.008 * seed) / -mv.z, 1.0, 5.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.05, length(c)); gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * vA * a, 1.0); }`,
    });
    const motes = new THREE.Points(mg, this.moteMat);
    motes.frustumCulled = false;
    scene.add(motes);
  }

  update(dt, time) {
    const g = this.game;
    this.dome.position.copy(g.camera.position);
    this.dome.scale.setScalar(200);
    const d = this.dawn;
    this.skyMat.uniforms.uDawn.value = d;
    this.dawnLight.intensity = 0.8 + d * 9;
    this.dawnLight.color.setRGB(0.60 + 0.4 * d, 0.78 + 0.1 * d, 1.0 - 0.15 * d);
    this.hemi.intensity = 0.22 + d * 2.6;
    this.moon.intensity = 0.55 * (1 - d * 0.8);
    this.lampMat.color.setRGB(9 - 6 * d, 5.2 - 3.5 * d, 2.2 - 1.4 * d);
    g.scene.fog.color.setRGB(0.012 + 0.30 * d, 0.018 + 0.34 * d, 0.028 + 0.36 * d);
    g.scene.fog.density = 0.022 - 0.012 * d;
    this.treeMat.color.setRGB(0.006 + 0.05 * d, 0.010 + 0.06 * d, 0.016 + 0.07 * d);
    // sun/moon shadow maps are static apart from doors, hero and creature: refresh alternately
    const f = g.frame;
    if (f % 2 === 0) this.moon.shadow.needsUpdate = true;
    if (f % 2 === 1 || d > 0) this.dawnLight.shadow.needsUpdate = true;

    const u = this.moteMat.uniforms;
    const t = g.player.torch;
    u.uTime.value = time;
    u.uCam.value.copy(g.camera.position);
    u.uTPos.value.copy(g.player.hero.torchPos);
    u.uTDir.value.copy(g.player.hero.torchDir);
    u.uTCos.value.set(Math.cos(t.angle), Math.cos(t.angle * 0.75));
    u.uTInt.value = t.intensity * 0.05;
    u.uScale.value = g.renderer.domElement.height;
  }
}
