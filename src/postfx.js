// Render pipeline: HDR scene → ground-truth AO → ray-marched volumetric light (torch cone,
// lamp cones and window shafts, all shadowed) → bloom → filmic tone map / grade → FXAA.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

const VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const VOL_FS = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uFrame;
uniform float uDensity;
uniform vec4 uBounds; // building footprint x0,x1,z0,z1
uniform float uCeil;

uniform vec3 uTPos; uniform vec3 uTDir; uniform vec4 uTParam; uniform vec3 uTColor; uniform mat4 uTMat;
uniform sampler2DShadow uTShadow;

uniform vec3 uSPos[4]; uniform vec3 uSDir[4]; uniform vec4 uSParam[4]; uniform vec3 uSColor[4]; uniform mat4 uSMat[4];
uniform sampler2DShadow uSShadow0; uniform sampler2DShadow uSShadow1; uniform sampler2DShadow uSShadow2; uniform sampler2DShadow uSShadow3;

uniform vec3 uDDir[2]; uniform vec3 uDColor[2]; uniform mat4 uDMat[2];
uniform sampler2DShadow uDShadow0; uniform sampler2DShadow uDShadow1;

#define PI 3.14159265359

float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float dust(vec3 p) {
  vec3 q = p * 1.15 + vec3(uTime * 0.035, -uTime * 0.05, uTime * 0.02);
  return uDensity * (0.45 + 0.8 * noise3(q) + 0.45 * noise3(q * 3.1 + 7.0));
}
float phase(float c) {
  const float g = 0.62;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
  return 0.45 + 0.55 * hg;
}

// interval of the ray (O + tV) inside the forward cone (apex A, axis D, cos half-angle c)
bool coneInterval(vec3 O, vec3 V, vec3 A, vec3 D, float c, float tmax, out float t0, out float t1) {
  vec3 CO = O - A;
  float vd = dot(V, D), cod = dot(CO, D), c2 = c * c;
  float a = vd * vd - c2;
  float b = 2.0 * (vd * cod - dot(V, CO) * c2);
  float cc = cod * cod - dot(CO, CO) * c2;
  bool inside = cod > 0.0 && cc > 0.0;
  if (abs(a) < 1e-6) a = 1e-6;
  float disc = b * b - 4.0 * a * cc;
  t0 = 0.0; t1 = tmax;
  if (disc < 0.0) return inside;
  float sq = sqrt(disc);
  float ta = (-b - sq) / (2.0 * a), tb = (-b + sq) / (2.0 * a);
  if (ta > tb) { float s = ta; ta = tb; tb = s; }
  bool va = (cod + ta * vd) > 0.0, vb = (cod + tb * vd) > 0.0;
  if (inside) {
    if (va && ta > 0.0) t1 = ta; else if (vb && tb > 0.0) t1 = tb;
  } else {
    if (va && vb) { t0 = ta; t1 = tb; }
    else if (va) { t0 = ta; }
    else if (vb) { t0 = tb; }
    else return false;
  }
  t0 = max(t0, 0.0); t1 = min(t1, tmax);
  return t1 > t0;
}

vec3 spotScatter(vec3 ro, vec3 rd, float tMax, float dither, vec3 pos, vec3 dir, vec4 prm, vec3 color, sampler2DShadow sm, mat4 m, int steps) {
  if (color.r + color.g + color.b < 1e-4) return vec3(0.0);
  float t0, t1;
  if (!coneInterval(ro, rd, pos, dir, prm.x, tMax, t0, t1)) return vec3(0.0);
  vec3 oc = ro - pos; float b = dot(oc, rd); float h = b * b - (dot(oc, oc) - prm.z * prm.z);
  if (h < 0.0) return vec3(0.0);
  h = sqrt(h); t0 = max(t0, -b - h); t1 = min(t1, -b + h);
  if (t1 <= t0) return vec3(0.0);
  float dt = (t1 - t0) / float(steps);
  float acc = 0.0;
  for (int i = 0; i < steps; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + dither) * dt);
    vec3 L = p - pos; float d = length(L); vec3 l = L / d;
    float cone = smoothstep(prm.x, prm.y, dot(l, dir));
    float att = smoothstep(prm.z, prm.z * 0.55, d) / (prm.w + pow(d, 1.7));
    vec4 sc = m * vec4(p, 1.0); sc.xyz /= sc.w;
    float sh = texture(sm, vec3(sc.xy, sc.z - 0.0008));
    acc += cone * att * sh * phase(dot(l, -rd)) * dust(p);
  }
  return color * acc * dt;
}

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  float depth = texture2D(tDepth, vUv).x;
  vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  wp /= wp.w;
  vec3 ray = wp.xyz - uCamPos;
  float len = length(ray);
  vec3 rd = ray / len;
  float tMax = min(len, 45.0);
  float dither = ign(gl_FragCoord.xy); // static pattern: an animated one shimmers without temporal AA

  vec3 col = spotScatter(uCamPos, rd, tMax, dither, uTPos, uTDir, uTParam, uTColor, uTShadow, uTMat, TORCH_STEPS);
  col += spotScatter(uCamPos, rd, tMax, dither, uSPos[0], uSDir[0], uSParam[0], uSColor[0], uSShadow0, uSMat[0], SPOT_STEPS);
  col += spotScatter(uCamPos, rd, tMax, dither, uSPos[1], uSDir[1], uSParam[1], uSColor[1], uSShadow1, uSMat[1], SPOT_STEPS);
  col += spotScatter(uCamPos, rd, tMax, dither, uSPos[2], uSDir[2], uSParam[2], uSColor[2], uSShadow2, uSMat[2], SPOT_STEPS);
  col += spotScatter(uCamPos, rd, tMax, dither, uSPos[3], uSDir[3], uSParam[3], uSColor[3], uSShadow3, uSMat[3], SPOT_STEPS);

  // window shafts from the two directional lights
  float tEnd = min(tMax, 24.0);
  float dt = tEnd / float(DIR_STEPS);
  vec3 acc = vec3(0.0);
  float p0 = phase(dot(uDDir[0], -rd)), p1 = phase(dot(uDDir[1], -rd));
  for (int i = 0; i < DIR_STEPS; i++) {
    vec3 p = uCamPos + rd * ((float(i) + dither) * dt);
    float inside = step(uBounds.x, p.x) * step(p.x, uBounds.y) * step(uBounds.z, p.z) * step(p.z, uBounds.w) * step(p.y, uCeil);
    if (inside < 0.5) continue;
    vec4 s0 = uDMat[0] * vec4(p, 1.0);
    vec4 s1 = uDMat[1] * vec4(p, 1.0);
    float sh0 = texture(uDShadow0, vec3(s0.xy, s0.z - 0.0012));
    float sh1 = texture(uDShadow1, vec3(s1.xy, s1.z - 0.0012));
    acc += (uDColor[0] * sh0 * p0 + uDColor[1] * sh1 * p1) * dust(p);
  }
  col += acc * dt;
  gl_FragColor = vec4(col, 1.0);
}
`;

const BLUR_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uDir;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
  c += (texture2D(tDiffuse, vUv + uDir * 1.3846).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846).rgb) * 0.316216;
  c += (texture2D(tDiffuse, vUv + uDir * 3.2308).rgb + texture2D(tDiffuse, vUv - uDir * 3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}
`;

const COMBINE_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tVol;
uniform float uVol;
void main() {
  gl_FragColor = vec4(texture2D(tScene, vUv).rgb + texture2D(tVol, vUv).rgb * uVol, 1.0);
}
`;

const GRADE_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uExposure, uTime, uGrain, uDamage, uFade, uGamma, uLowHealth, uFocus, uCA, uDesat;

vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(outM * RRTAndODTFit(inM * c), 0.0, 1.0);
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  vec2 off = c * r2 * uCA;
  vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
  col = aces(col * uExposure);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // cool shadows, faintly warm highlights, restrained saturation
  col = mix(col, col * vec3(0.90, 1.0, 1.10), (1.0 - smoothstep(0.0, 0.35, l)) * 0.55);
  col = mix(col, col * vec3(1.04, 1.0, 0.95), smoothstep(0.5, 1.0, l) * 0.5);
  col = mix(vec3(l), col, 0.90 - uDesat);
  // vignette (focus tightens it slightly: narrower peripheral awareness)
  float vr = length(c * vec2(1.0, 0.86));
  float vig = smoothstep(0.92 - 0.14 * uFocus, 0.28 - 0.04 * uFocus, vr);
  col *= mix(0.42 - 0.12 * uFocus, 1.0, vig);
  // injury: red pulse at the edge of vision, never over the centre where tells are read
  float edge = smoothstep(0.30, 0.78, vr);
  col = mix(col, vec3(0.42, 0.015, 0.01) * (0.4 + l), edge * clamp(uDamage + uLowHealth, 0.0, 1.0) * 0.8);
  col = pow(max(col, 0.0), vec3(1.0 / uGamma));
  col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  col += (hash(vUv * uRes + fract(uTime) * 61.0) - 0.5) * uGrain;
  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

export class PostFX {
  constructor(game) {
    this.game = game;
    const { renderer, scene, camera, quality } = game;
    this.renderer = renderer;
    this.quality = quality;
    this.quad = new FullScreenQuad(null);
    this.frame = 0;

    const depth = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
    depth.format = THREE.DepthFormat;
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthTexture: depth, samples: 0 });
    const hdr = () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtA = hdr(); this.rtB = hdr(); this.rtVol = hdr(); this.rtVol2 = hdr();
    this.rtLDR = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });

    this.gtao = new GTAOPass(scene, camera, 4, 4, { depthTexture: depth }, { radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.25, samples: quality.aoSamples, screenSpaceRadius: false });
    this.gtao.blendIntensity = 1.0;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.2, 0.6, 2.2);
    this.fxaa = new FXAAPass();
    this.fxaa.renderToScreen = true;

    const m4 = () => new THREE.Matrix4();
    const v3 = () => new THREE.Vector3();
    this.vol = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: VOL_FS, depthTest: false, depthWrite: false,
      defines: { TORCH_STEPS: quality.torchSteps, SPOT_STEPS: quality.spotSteps, DIR_STEPS: quality.dirSteps },
      uniforms: {
        tDepth: { value: depth }, uInvViewProj: { value: m4() }, uCamPos: { value: v3() },
        uTime: { value: 0 }, uFrame: { value: 0 }, uDensity: { value: 0.03 },
        uBounds: { value: new THREE.Vector4(-0.1, 28.0, -3.4, 22.7) }, uCeil: { value: 3.6 },
        uTPos: { value: v3() }, uTDir: { value: v3() }, uTParam: { value: new THREE.Vector4() }, uTColor: { value: v3() }, uTMat: { value: m4() }, uTShadow: { value: null },
        uSPos: { value: [v3(), v3(), v3(), v3()] }, uSDir: { value: [v3(), v3(), v3(), v3()] },
        uSParam: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uSColor: { value: [v3(), v3(), v3(), v3()] },
        uSMat: { value: [m4(), m4(), m4(), m4()] },
        uSShadow0: { value: null }, uSShadow1: { value: null }, uSShadow2: { value: null }, uSShadow3: { value: null },
        uDDir: { value: [v3(), v3()] }, uDColor: { value: [v3(), v3()] }, uDMat: { value: [m4(), m4()] },
        uDShadow0: { value: null }, uDShadow1: { value: null },
      },
    });
    this.blur = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: BLUR_FS, depthTest: false, depthWrite: false, uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } } });
    this.combine = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: COMBINE_FS, depthTest: false, depthWrite: false, uniforms: { tScene: { value: null }, tVol: { value: null }, uVol: { value: 1 } } });
    this.grade = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: GRADE_FS, depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uExposure: { value: 1 }, uTime: { value: 0 },
        uGrain: { value: 0.012 }, uDamage: { value: 0 }, uFade: { value: 1 }, uGamma: { value: 1 }, uLowHealth: { value: 0 },
        uFocus: { value: 0 }, uCA: { value: 0.012 }, uDesat: { value: 0 },
      },
    });
    this._vp = new THREE.Matrix4();
    this._tmp = new THREE.Vector3();
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    const hw = Math.max(2, Math.round(w * this.quality.volScale)), hh = Math.max(2, Math.round(h * this.quality.volScale));
    this.rtScene.setSize(w, h); this.rtA.setSize(w, h); this.rtB.setSize(w, h); this.rtLDR.setSize(w, h);
    this.rtVol.setSize(hw, hh); this.rtVol2.setSize(hw, hh);
    this.hw = hw; this.hh = hh;
    this.gtao.setSize(w, h);
    this.bloom.setSize(w, h);
    this.fxaa.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w, h);
  }

  _spot(light, pos, dir, prm, color, mat, scale) {
    light.getWorldPosition(pos);
    light.target.getWorldPosition(dir).sub(pos).normalize();
    const cosO = Math.cos(light.angle), cosI = Math.cos(light.angle * (1 - light.penumbra));
    prm.set(cosO, Math.max(cosI, cosO + 1e-4), light.distance > 0 ? light.distance : 14, 0);
    const k = light.shadow.map ? light.intensity * scale : 0;
    color.set(light.color.r * k, light.color.g * k, light.color.b * k);
    mat.copy(light.shadow.matrix);
    return light.shadow.map ? light.shadow.map.depthTexture : null;
  }

  render(time) {
    const g = this.game, r = this.renderer, q = this.quality, cam = g.camera;
    this.frame++;
    // 1. scene
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(g.scene, cam);
    let cur = this.rtScene;
    // 2. ambient occlusion
    if (q.ao) { this.gtao.render(r, this.rtA, this.rtScene); cur = this.rtA; }
    // 3. volumetric light
    if (q.volumetric) {
      const u = this.vol.uniforms;
      this._vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      u.uInvViewProj.value.copy(this._vp).invert();
      u.uCamPos.value.copy(cam.position);
      u.uTime.value = time; u.uFrame.value = this.frame;
      u.uDensity.value = g.env.dustDensity;
      const torch = g.player.torch;
      u.uTShadow.value = this._spot(torch, u.uTPos.value, u.uTDir.value, u.uTParam.value, u.uTColor.value, u.uTMat.value, 0.42 - 0.26 * g.player.focus);
      u.uTParam.value.z = 11; u.uTParam.value.w = 1.4;
      g.lights.slots.forEach((s, i) => {
        u['uSShadow' + i].value = this._spot(s.spot, u.uSPos.value[i], u.uSDir.value[i], u.uSParam.value[i], u.uSColor.value[i], u.uSMat.value[i], 0.11);
        u.uSParam.value[i].z = 6; u.uSParam.value[i].w = 0.5;
      });
      g.env.dirs.forEach((d, i) => {
        d.target.getWorldPosition(this._tmp);
        u.uDDir.value[i].copy(this._tmp).sub(d.position).normalize();
        const k = d.shadow.map ? d.intensity * g.env.shaftScale : 0;
        u.uDColor.value[i].set(d.color.r * k, d.color.g * k, d.color.b * k);
        u.uDMat.value[i].copy(d.shadow.matrix);
        u['uDShadow' + i].value = d.shadow.map ? d.shadow.map.depthTexture : null;
      });
      this.quad.material = this.vol;
      r.setRenderTarget(this.rtVol); this.quad.render(r);
      this.quad.material = this.blur;
      this.blur.uniforms.tDiffuse.value = this.rtVol.texture; this.blur.uniforms.uDir.value.set(1 / this.hw, 0);
      r.setRenderTarget(this.rtVol2); this.quad.render(r);
      this.blur.uniforms.tDiffuse.value = this.rtVol2.texture; this.blur.uniforms.uDir.value.set(0, 1 / this.hh);
      r.setRenderTarget(this.rtVol); this.quad.render(r);
      this.quad.material = this.combine;
      this.combine.uniforms.tScene.value = cur.texture; this.combine.uniforms.tVol.value = this.rtVol.texture;
      r.setRenderTarget(this.rtB); this.quad.render(r);
      cur = this.rtB;
    }
    // 4. bloom (added in place)
    if (q.bloom) this.bloom.render(r, null, cur, 0, false);
    // 5. tone map + grade, 6. FXAA to screen
    this.quad.material = this.grade;
    this.grade.uniforms.tDiffuse.value = cur.texture;
    this.grade.uniforms.uTime.value = time;
    r.setRenderTarget(this.rtLDR); this.quad.render(r);
    this.fxaa.render(r, null, this.rtLDR, 0, false);
    r.setRenderTarget(null);
  }
}
