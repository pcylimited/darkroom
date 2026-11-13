// Procedural PBR texture baking. Every surface in the game is generated on the GPU at load:
// a GLSL "surface" function writes albedo / height / roughness / metalness, then a second
// pass derives a tangent-space normal map from the height field. All surfaces tile seamlessly.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const COMMON = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform int mode;
#define PI 3.14159265359

float hash11(float n) { return fract(sin(n * 127.1 + 1.7) * 43758.5453123); }
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p) { float n = hash21(p); return vec2(n, hash21(p + n + 17.17)); }

// periodic value noise. p is in lattice units, per is the (integer) period per axis.
float vnoise(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 i0 = mod(i, per), i1 = mod(i + 1.0, per);
  float a = hash21(i0), b = hash21(vec2(i1.x, i0.y)), c = hash21(vec2(i0.x, i1.y)), d = hash21(i1);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm2(vec2 uv, vec2 freq, int oct, float gain) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise(uv * freq + float(i) * 17.3, freq);
    n += a; a *= gain; freq *= 2.0;
  }
  return s / n;
}
float fbm(vec2 uv, float freq, int oct, float gain) { return fbm2(uv, vec2(freq), oct, gain); }

// periodic voronoi: x = F1, y = F2, z = cell id
vec3 voronoi(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 c = mod(i + g, per);
    vec2 r = g + hash22(c) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash21(c + 3.7); } else if (d < d2) { d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
`;

const MAIN = /* glsl */ `
void main() {
  vec3 alb; float h, r, m;
  surf(vUv, alb, h, r, m);
  if (mode == 0) gl_FragColor = vec4(max(alb, 0.0), 1.0);
  else gl_FragColor = vec4(h, r, m, 1.0);
}
`;

// size: bake resolution, tile: metres covered by one repeat, depth: metres represented by height 1.0
const SURFACES = {
  floorWood: {
    size: 2048, tile: 2.4, depth: 0.012,
    body: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float m) {
  const float N = 16.0;
  float py = uv.y * N; float row = floor(py); float fy = fract(py);
  float nb = 2.0;
  float off = floor(hash11(row * 3.71 + 1.3) * 8.0) / 8.0;
  float px = uv.x * nb + off; float col = mod(floor(px), nb); float fx = fract(px);
  float id = hash21(vec2(col + 11.0, row + 5.0));
  float id2 = hash21(vec2(col + 3.0, row + 29.0));
  float ey = min(fy, 1.0 - fy) * (2.4 / N);
  float ex = min(fx, 1.0 - fx) * (2.4 / nb);
  float e = min(ey, ex);
  float gap = 1.0 - smoothstep(0.0012, 0.0035, e);
  float bevel = 1.0 - smoothstep(0.002, 0.013, e);
  vec2 gu = uv + vec2(id * 0.73, id2 * 0.41);
  float warp = fbm2(gu, vec2(3.0, 6.0), 3, 0.5);
  float rings = sin((py * 0.9 + warp * 5.0 + id * 9.0) * 10.05) * 0.5 + 0.5;
  float fine = fbm2(gu, vec2(6.0, 160.0), 4, 0.6);
  float grain = mix(rings, fine, 0.55);
  float pores = smoothstep(0.62, 0.9, fbm2(gu + 0.31, vec2(14.0, 420.0), 2, 0.5));
  vec3 dark = vec3(0.060, 0.034, 0.018), mid = vec3(0.150, 0.088, 0.046), lite = vec3(0.235, 0.150, 0.085);
  vec3 c = mix(dark, mid, id);
  c = mix(c, lite, id2 * id2 * 0.55);
  c *= 0.72 + 0.5 * grain;
  c *= 1.0 - 0.35 * pores;
  float wear = smoothstep(0.52, 0.78, fbm(uv + 0.17, 3.0, 5, 0.55));
  float stain = smoothstep(0.58, 0.8, fbm(uv + 0.63, 2.0, 4, 0.5));
  float lum = dot(c, vec3(0.3, 0.5, 0.2));
  c = mix(c, vec3(lum) * vec3(1.25, 1.15, 1.0) + 0.02, wear * 0.45);
  c *= 1.0 - 0.55 * stain;
  float dust = fbm(uv + 0.9, 24.0, 3, 0.5);
  c = mix(c, vec3(0.11, 0.10, 0.09), 0.10 * dust);
  c *= 1.0 - 0.85 * gap;
  c *= 1.0 - 0.25 * bevel;
  alb = c;
  float cup = (fy - 0.5) * (fy - 0.5) * 4.0;
  h = 0.6 + 0.05 * grain - 0.03 * pores - 0.10 * cup * (0.4 + id) - 0.16 * bevel - 0.4 * gap + (id - 0.5) * 0.05;
  r = clamp(0.50 + 0.22 * fine + 0.25 * wear - 0.24 * stain + 0.3 * gap, 0.16, 1.0);
  m = 0.0;
}`,
  },

  floorTile: {
    size: 2048, tile: 2.4, depth: 0.010,
    body: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float m) {
  const float N = 8.0;
  vec2 p = uv * N; vec2 id = floor(p); vec2 f = fract(p);
  float chk = mod(id.x + id.y, 2.0);
  float rnd = hash21(mod(id, N) + 7.0);
  float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 0.3;
  float grout = 1.0 - smoothstep(0.003, 0.006, e);
  float bevel = 1.0 - smoothstep(0.004, 0.016, e);
  float n1 = fbm(uv + rnd, 8.0, 5, 0.55);
  float n2 = fbm(uv + 0.4, 48.0, 3, 0.5);
  float vein = 1.0 - smoothstep(0.0, 0.05, abs(fbm(uv + rnd * 3.0, 6.0, 5, 0.6) - 0.5));
  vec3 a = vec3(0.30, 0.285, 0.26), b = vec3(0.050, 0.052, 0.058);
  vec3 c = mix(a, b, chk);
  c *= 0.75 + 0.5 * n1; c *= 0.9 + 0.2 * n2;
  c *= 0.85 + 0.3 * rnd;
  c = mix(c, c * 1.6 + 0.02, vein * 0.25);
  float w = fbm(uv, 4.0, 3, 0.5);
  vec3 v = voronoi(uv * 5.0 + 2.0 * w, 5.0);
  float crackMask = smoothstep(0.55, 0.7, fbm(uv + 0.77, 3.0, 3, 0.5));
  float crack = (1.0 - smoothstep(0.0, 0.035, v.y - v.x)) * crackMask;
  float dirt = smoothstep(0.45, 0.8, fbm(uv + 0.21, 4.0, 5, 0.55));
  c = mix(c, vec3(0.045, 0.04, 0.032), dirt * 0.6);
  c *= 1.0 - 0.7 * crack;
  c = mix(c, vec3(0.03, 0.028, 0.025), grout);
  alb = c;
  h = 0.6 + 0.03 * n2 + (rnd - 0.5) * 0.06 - 0.10 * bevel - 0.25 * grout - 0.3 * crack;
  r = clamp(0.26 + 0.3 * n1 + 0.45 * dirt + 0.3 * grout, 0.12, 1.0);
  m = 0.0;
}`,
  },

  plaster: {
    size: 2048, tile: 3.0, depth: 0.010,
    body: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float m) {
  float broad = fbm(uv, 3.0, 6, 0.55);
  float mid = fbm(uv + 0.31, 12.0, 5, 0.55);
  float fine = fbm(uv + 0.67, 96.0, 3, 0.5);
  float trowel = fbm2(uv + 0.13, vec2(5.0, 40.0), 3, 0.5);
  vec2 w = vec2(fbm(uv + 0.5, 6.0, 3, 0.5), fbm(uv + 0.9, 6.0, 3, 0.5));
  vec3 v = voronoi(uv * 4.0 + w * 1.2, 4.0);
  float crackMask = smoothstep(0.50, 0.66, fbm(uv + 0.23, 2.0, 4, 0.5));
  float crack = (1.0 - smoothstep(0.0, 0.022, v.y - v.x)) * crackMask;
  vec3 v2 = voronoi(uv * 14.0 + w * 2.0, 14.0);
  float hair = (1.0 - smoothstep(0.0, 0.03, v2.y - v2.x)) * smoothstep(0.6, 0.75, mid) * 0.6;
  float fl = fbm(uv + 0.41, 5.0, 5, 0.6);
  float flake = smoothstep(0.63, 0.66, fl);
  float flakeEdge = smoothstep(0.60, 0.63, fl) - flake;
  float dn = fbm(uv + 0.77, 2.0, 5, 0.6);
  float damp = smoothstep(0.50, 0.85, dn);
  float tide = smoothstep(0.60, 0.64, dn) - smoothstep(0.64, 0.72, dn);
  vec3 base = vec3(0.47, 0.455, 0.42);
  vec3 c = base * (0.80 + 0.35 * broad) * (0.92 + 0.16 * mid);
  c = mix(c, vec3(0.34, 0.31, 0.26), flake * 0.9);
  c = mix(c, vec3(0.26, 0.21, 0.13), damp * 0.55);
  c *= 1.0 - 0.35 * tide;
  c *= 1.0 - 0.75 * crack; c *= 1.0 - 0.4 * hair;
  c += 0.05 * flakeEdge;
  alb = c;
  h = 0.6 + 0.06 * mid + 0.025 * fine + 0.03 * trowel - 0.10 * flake + 0.04 * flakeEdge - 0.35 * crack - 0.12 * hair;
  r = clamp(0.86 + 0.1 * fine - 0.3 * damp, 0.4, 1.0);
  m = 0.0;
}`,
  },

  wallpaper: {
    size: 2048, tile: 1.06, depth: 0.004,
    body: /* glsl */ `
float motif(vec2 q) {
  float rr = length(q); float a = atan(q.y, q.x);
  float petal = 0.27 + 0.10 * cos(a * 4.0) + 0.035 * cos(a * 8.0 + 1.0);
  float m1 = 1.0 - smoothstep(petal - 0.015, petal, rr);
  float inR = 0.14 + 0.04 * cos(a * 4.0 + PI);
  float inner = smoothstep(0.075, 0.09, rr) * (1.0 - smoothstep(inR - 0.012, inR, rr));
  float eye = 1.0 - smoothstep(0.03, 0.04, rr);
  float lace = smoothstep(0.02, 0.0, abs(rr - petal - 0.045)) ;
  return clamp(m1 - inner * 0.75 + eye + lace * 0.7, 0.0, 1.0);
}
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float m) {
  vec2 p = uv * 4.0; float colI = floor(p.x);
  p.y += 0.5 * mod(colI, 2.0);
  vec2 q = fract(p) - 0.5;
  float mo = motif(q);
  vec2 q2 = fract(p + 0.5) - 0.5;
  float small = 1.0 - smoothstep(0.045, 0.06, length(q2) + 0.018 * cos(atan(q2.y, q2.x) * 6.0));
  float fs = fract(uv.x * 8.0);
  float stripe = smoothstep(0.035, 0.02, abs(fs - 0.5)) * 0.0 + smoothstep(0.012, 0.004, abs(abs(fs - 0.5) - 0.47));
  float pat = clamp(mo + small + 0.6 * stripe, 0.0, 1.0);
  float paper = fbm(uv, 64.0, 3, 0.5);
  float fiber = fbm2(uv + 0.3, vec2(200.0, 8.0), 2, 0.5);
  float fade = fbm(uv + 0.2, 2.0, 5, 0.55);
  float streak = fbm2(uv + 0.6, vec2(48.0, 2.0), 3, 0.55);
  float streakMask = smoothstep(0.5, 0.75, fbm2(uv + 0.11, vec2(6.0, 1.0), 3, 0.5));
  vec3 base = vec3(0.50, 0.47, 0.42);
  vec3 ink = vec3(0.21, 0.185, 0.155);
  vec3 c = mix(base, ink, pat * 0.5);
  c *= 0.78 + 0.4 * fade; c *= 0.93 + 0.14 * paper;
  c *= 1.0 - 0.45 * smoothstep(0.45, 0.8, streak) * streakMask;
  float mould = smoothstep(0.62, 0.82, fbm(uv + 0.83, 4.0, 5, 0.6));
  c = mix(c, vec3(0.10, 0.11, 0.08), mould * 0.55);
  float fr = fract(uv.x * 2.0); float sd = min(fr, 1.0 - fr) * 0.53;
  float seam = 1.0 - smoothstep(0.0, 0.0025, sd);
  float lift = 1.0 - smoothstep(0.0, 0.03, sd);
  float tn = fbm(uv + 0.37, 3.0, 5, 0.6);
  float torn = smoothstep(0.70, 0.715, tn);
  float tornEdge = smoothstep(0.68, 0.70, tn) - torn;
  vec3 pl = vec3(0.43, 0.42, 0.39) * (0.8 + 0.4 * fbm(uv, 16.0, 4, 0.5));
  c = mix(c, pl, torn);
  c = mix(c, vec3(0.62, 0.60, 0.55), tornEdge * 0.7);
  c *= 1.0 - 0.5 * seam;
  alb = c;
  h = 0.6 + 0.012 * paper + 0.01 * fiber + 0.02 * pat - 0.08 * torn + 0.06 * tornEdge
      + 0.03 * lift * fbm(uv, 8.0, 2, 0.5) - 0.05 * seam;
  r = clamp(0.80 - 0.22 * pat + 0.12 * paper + 0.1 * torn - 0.2 * mould, 0.3, 1.0);
  m = 0.0;
}`,
  },

  wood: {
    size: 1024, tile: 1.2, depth: 0.003,
    body: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float m) {
  float warp = fbm2(uv, vec2(2.0, 5.0), 4, 0.55);
  float rings = sin((uv.y * 9.0 + warp * 3.2) * 6.2831853);
  rings = pow(rings * 0.5 + 0.5, 1.6);
  float fine = fbm2(uv + 0.2, vec2(8.0, 220.0), 4, 0.6);
  float pores = smoothstep(0.6, 0.9, fbm2(uv + 0.7, vec2(18.0, 500.0), 2, 0.5));
  vec3 dark = vec3(0.055, 0.028, 0.014), lite = vec3(0.19, 0.105, 0.05);
  vec3 c = mix(dark, lite, clamp(rings * 0.6 + fine * 0.5, 0.0, 1.0));
  c *= 1.0 - 0.3 * pores;
  float wear = smoothstep(0.55, 0.8, fbm(uv + 0.5, 4.0, 5, 0.55));
  c = mix(c, c * 1.5 + 0.02, wear * 0.4);
  float scr = smoothstep(0.86, 0.93, fbm2(uv + 0.33, vec2(3.0, 90.0), 2, 0.5)) * smoothstep(0.5, 0.7, fbm(uv + 0.1, 5.0, 3, 0.5));
  c += 0.07 * scr;
  float grime = smoothstep(0.5, 0.85, fbm(uv + 0.9, 3.0, 5, 0.6));
  c *= 1.0 - 0.45 * grime;
  alb = c;
  h = 0.6 + 0.05 * rings + 0.04 * fine - 0.05 * pores - 0.03 * scr;
  r = clamp(0.30 + 0.25 * fine + 0.3 * wear + 0.25 * grime, 0.12, 1.0);
  m = 0.0;
}`,
  },

  paint: {
    size: 1024, tile: 1.2, depth: 0.006,
    body: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float m) {
  float brush = fbm2(uv, vec2(4.0, 140.0), 3, 0.55);
  float n = fbm(uv + 0.3, 6.0, 5, 0.6);
  float chipN = fbm(uv + 0.71, 10.0, 5, 0.6);
  float chip = smoothstep(0.66, 0.68, chipN);
  float chipEdge = smoothstep(0.63, 0.66, chipN) - chip;
  vec3 paint = vec3(0.50, 0.48, 0.43) * (0.82 + 0.3 * n);
  float woodg = fbm2(uv + 0.5, vec2(6.0, 180.0), 3, 0.6);
  vec3 wood = mix(vec3(0.07, 0.04, 0.022), vec3(0.17, 0.10, 0.055), woodg);
  vec3 c = mix(paint, wood, chip);
  float grime = smoothstep(0.45, 0.85, fbm(uv + 0.15, 3.0, 5, 0.6));
  c = mix(c, c * vec3(0.5, 0.45, 0.36), grime * 0.7);
  c *= 1.0 - 0.25 * chipEdge;
  float groove = 0.0, bead = 0.0;
#ifdef BEADBOARD
  float bx = fract(uv.x * 12.0); float gd = min(bx, 1.0 - bx) * 0.1;
  groove = 1.0 - smoothstep(0.002, 0.006, gd);
  bead = (1.0 - smoothstep(0.006, 0.014, gd)) - groove;
  c *= 1.0 - 0.6 * groove;
#endif
  alb = c;
  h = 0.6 + 0.025 * brush - 0.07 * chip + 0.02 * chipEdge + 0.02 * woodg * chip - 0.3 * groove + 0.05 * bead;
  r = clamp(0.42 + 0.2 * brush + 0.3 * grime + 0.3 * chip, 0.2, 1.0);
  m = 0.0;
}`,
  },

  fabric: {
    size: 1024, tile: 0.3, depth: 0.0016,
    body: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float m) {
  const float F = 90.0;
  float wx = sin(uv.x * F * 6.2831853), wy = sin(uv.y * F * 6.2831853);
  float weave = wx * wy;
  float thr = fbm2(uv, vec2(F, 12.0), 2, 0.5) * 0.5 + fbm2(uv + 0.5, vec2(12.0, F), 2, 0.5) * 0.5;
  float n = fbm(uv + 0.2, 6.0, 4, 0.55);
  vec3 c = vec3(0.55) * (0.82 + 0.12 * weave + 0.2 * thr) * (0.85 + 0.3 * n);
#ifdef STRIPES
  float s = smoothstep(0.40, 0.42, abs(fract(uv.x * 6.0) - 0.5));
  c = mix(c, c * vec3(0.30, 0.36, 0.52), s);
#endif
  float stain = smoothstep(0.6, 0.85, fbm(uv + 0.63, 3.0, 4, 0.55));
  c = mix(c, c * vec3(0.55, 0.47, 0.35), stain * 0.6);
  alb = c;
  h = 0.5 + 0.2 * weave + 0.15 * thr + 0.1 * n;
  r = 0.95;
  m = 0.0;
}`,
  },

  metal: {
    size: 1024, tile: 0.6, depth: 0.003,
    body: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float m) {
  float n = fbm(uv, 8.0, 5, 0.55); float fine = fbm(uv + 0.4, 64.0, 3, 0.5);
  float rust = smoothstep(0.52, 0.7, fbm(uv + 0.6, 5.0, 6, 0.62));
  float brushed = fbm2(uv + 0.2, vec2(4.0, 200.0), 2, 0.5);
  vec3 steel = vec3(0.42, 0.40, 0.37) * (0.7 + 0.4 * n);
  vec3 rc = mix(vec3(0.20, 0.075, 0.03), vec3(0.34, 0.16, 0.06), fine);
  alb = mix(steel, rc, rust);
  h = 0.6 + 0.02 * brushed + 0.08 * rust * fine - 0.03 * rust;
  r = clamp(mix(0.30 + 0.25 * brushed + 0.2 * n, 0.9, rust), 0.1, 1.0);
  m = 1.0 - rust * 0.9;
}`,
  },

  siding: {
    size: 1024, tile: 2.4, depth: 0.03,
    body: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float m) {
  const float N = 12.0;
  float py = uv.y * N; float row = floor(py); float fy = fract(py);
  float id = hash11(row * 5.3 + 2.0);
  float lap = smoothstep(0.0, 0.07, fy);
  float grain = fbm2(uv + id, vec2(4.0, 150.0), 4, 0.6);
  float peel = smoothstep(0.50, 0.53, fbm(uv + id * 0.3, 7.0, 5, 0.6));
  vec3 paint = vec3(0.34, 0.36, 0.35) * (0.8 + 0.3 * fbm(uv, 3.0, 4, 0.5));
  vec3 wood = mix(vec3(0.07, 0.06, 0.05), vec3(0.19, 0.17, 0.15), grain);
  vec3 c = mix(paint, wood, peel);
  c *= 0.5 + 0.5 * lap;
  c *= 0.8 + 0.3 * fbm2(uv + 0.4, vec2(60.0, 2.0), 3, 0.5);
  alb = c;
  h = mix(0.35, 0.75, 1.0 - fy) + 0.04 * grain - 0.03 * peel;
  r = 0.85;
  m = 0.0;
}`,
  },

  ground: {
    size: 1024, tile: 8.0, depth: 0.08,
    body: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float m) {
  float n = fbm(uv, 6.0, 6, 0.6); float f = fbm(uv + 0.3, 64.0, 4, 0.6);
  float grass = smoothstep(0.42, 0.62, fbm(uv + 0.8, 10.0, 5, 0.6));
  float blades = fbm2(uv + 0.1, vec2(260.0, 60.0), 2, 0.5);
  vec3 dirt = vec3(0.060, 0.048, 0.036) * (0.6 + 0.8 * n);
  vec3 gr = vec3(0.030, 0.050, 0.022) * (0.6 + 0.9 * blades);
  alb = mix(dirt, gr, grass);
  h = 0.5 + 0.2 * n + 0.1 * f + 0.15 * grass * blades;
  r = 1.0;
  m = 0.0;
}`,
  },

  rug: {
    size: 1024, tile: 1.0, depth: 0.004, noRepeat: true,
    body: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float m) {
  vec2 q = abs(uv - 0.5) * 2.0;
  float edge = max(q.x, q.y);
  float inField = 1.0 - step(0.74, edge);
  float border1 = step(0.84, edge) * (1.0 - step(0.965, edge));
  float border2 = step(0.74, edge) * (1.0 - step(0.80, edge));
  vec2 p = uv * vec2(6.0, 9.0);
  vec2 f = abs(fract(p) - 0.5);
  float dia = 1.0 - smoothstep(0.30, 0.34, f.x + f.y);
  float dia2 = 1.0 - smoothstep(0.10, 0.13, f.x + f.y);
  float md = length((uv - 0.5) * vec2(1.0, 1.5));
  float med = 1.0 - smoothstep(0.25, 0.27, md);
  float medIn = 1.0 - smoothstep(0.10, 0.12, md + 0.03 * cos(atan(uv.y - 0.5, uv.x - 0.5) * 8.0));
  vec3 red = vec3(0.20, 0.028, 0.022), navy = vec3(0.025, 0.035, 0.075), cream = vec3(0.36, 0.30, 0.20), gold = vec3(0.30, 0.19, 0.05);
  vec3 c = red;
  c = mix(c, navy, dia * inField);
  c = mix(c, gold, dia2 * inField);
  c = mix(c, navy, med);
  c = mix(c, cream, medIn);
  c = mix(c, cream, border2);
  c = mix(c, navy, border1);
  float bm = 1.0 - smoothstep(0.2, 0.25, abs(fract(uv.x * 14.0) - 0.5) + abs(fract(uv.y * 20.0) - 0.5));
  c = mix(c, gold, bm * border1);
  float thread = sin(uv.x * 900.0) * sin(uv.y * 1300.0);
  float wear = smoothstep(0.45, 0.8, fbm(uv, 4.0, 5, 0.6));
  c = mix(c, vec3(dot(c, vec3(0.33))) * 1.2 + 0.03, wear * 0.55);
  c *= 0.8 + 0.3 * fbm(uv + 0.3, 24.0, 3, 0.5);
  c *= 0.92 + 0.08 * thread;
  alb = c;
  h = 0.5 + 0.2 * thread + 0.1 * (dia * inField + border1) - 0.15 * wear;
  r = 0.97;
  m = 0.0;
}`,
  },
};
SURFACES.beadboard = { ...SURFACES.paint, defines: { BEADBOARD: 1 } };
SURFACES.ticking = { ...SURFACES.fabric, defines: { STRIPES: 1 } };

const NORMAL_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tData;
uniform float texel;
uniform float k;
void main() {
  float hL = texture2D(tData, vUv - vec2(texel, 0.0)).r;
  float hR = texture2D(tData, vUv + vec2(texel, 0.0)).r;
  float hD = texture2D(tData, vUv - vec2(0.0, texel)).r;
  float hU = texture2D(tData, vUv + vec2(0.0, texel)).r;
  vec3 n = normalize(vec3((hL - hR) * k, (hD - hU) * k, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;
const ORM_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tData;
void main() {
  vec4 d = texture2D(tData, vUv);
  gl_FragColor = vec4(1.0, d.g, d.b, 1.0);
}
`;

export function bakeTextures(renderer, texShift = 0) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const quad = new FullScreenQuad(null);
  const prevTarget = renderer.getRenderTarget();
  const out = {};

  const normalMat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: NORMAL_FS, depthTest: false, depthWrite: false,
    uniforms: { tData: { value: null }, texel: { value: 0 }, k: { value: 1 } },
  });
  const ormMat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: ORM_FS, depthTest: false, depthWrite: false,
    uniforms: { tData: { value: null } },
  });

  for (const [name, def] of Object.entries(SURFACES)) {
    const size = Math.max(256, def.size >> texShift);
    const wrap = def.noRepeat ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    const rtData = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType, depthBuffer: false,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    const mk = (srgb) => {
      const rt = new THREE.WebGLRenderTarget(size, size, {
        type: THREE.UnsignedByteType, depthBuffer: false,
        colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
        wrapS: wrap, wrapT: wrap, generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      });
      rt.texture.anisotropy = aniso;
      return rt;
    };
    const rtAlb = mk(true), rtNor = mk(false), rtOrm = mk(false);

    const surfMat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: COMMON + def.body + MAIN,
      defines: def.defines || {}, depthTest: false, depthWrite: false,
      uniforms: { mode: { value: 0 } },
    });
    quad.material = surfMat;
    surfMat.uniforms.mode.value = 0;
    renderer.setRenderTarget(rtAlb); quad.render(renderer);
    surfMat.uniforms.mode.value = 1;
    renderer.setRenderTarget(rtData); quad.render(renderer);

    quad.material = normalMat;
    normalMat.uniforms.tData.value = rtData.texture;
    normalMat.uniforms.texel.value = 1 / size;
    normalMat.uniforms.k.value = (def.depth * size) / (2 * def.tile);
    renderer.setRenderTarget(rtNor); quad.render(renderer);

    quad.material = ormMat;
    ormMat.uniforms.tData.value = rtData.texture;
    renderer.setRenderTarget(rtOrm); quad.render(renderer);

    surfMat.dispose();
    rtData.dispose();
    out[name] = { map: rtAlb.texture, normalMap: rtNor.texture, ormMap: rtOrm.texture, tile: def.tile };
  }
  renderer.setRenderTarget(prevTarget);
  normalMat.dispose(); ormMat.dispose();

  Object.assign(out, makeCanvasTextures());
  return out;
}

// ---------------------------------------------------------------------------------------
// Canvas-drawn helper textures (light cookie, smoke sprites, glass grime, props)
// ---------------------------------------------------------------------------------------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function makeCanvasTextures() {
  const t = {};

  // Torch cookie: hot centre, soft corona, faint reflector rings and a slightly dirty lens.
  {
    const [c, g] = canvas(512, 512);
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
    const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    grad.addColorStop(0.0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.22, 'rgba(255,252,242,0.97)');
    grad.addColorStop(0.45, 'rgba(244,238,220,0.86)');
    grad.addColorStop(0.66, 'rgba(225,220,200,0.74)');
    grad.addColorStop(0.82, 'rgba(190,186,170,0.56)');
    grad.addColorStop(0.93, 'rgba(110,108,100,0.24)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
    g.globalCompositeOperation = 'lighter';
    for (const [r, a, w] of [[86, 0.045, 7], [150, 0.03, 10], [205, 0.02, 12]]) {
      g.strokeStyle = `rgba(255,250,230,${a})`; g.lineWidth = w;
      g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke();
    }
    g.globalCompositeOperation = 'multiply';
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 60; i++) {
      const a = rnd() * Math.PI * 2, r = 30 + rnd() * 215;
      const x = 256 + Math.cos(a) * r, y = 256 + Math.sin(a) * r, rr = 3 + rnd() * 16;
      const gg = g.createRadialGradient(x, y, 0, x, y, rr);
      gg.addColorStop(0, `rgba(150,150,150,1)`); gg.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gg; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    t.cookie = tex;
  }

  // Soft noisy blob used for creature smoke and dust.
  {
    const [c, g] = canvas(128, 128);
    const img = g.createImageData(128, 128);
    let s = 11;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const lobes = [];
    for (let i = 0; i < 9; i++) lobes.push([64 + (rnd() - 0.5) * 50, 64 + (rnd() - 0.5) * 50, 14 + rnd() * 22]);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      let v = 0;
      for (const [lx, ly, lr] of lobes) { const d = Math.hypot(x - lx, y - ly) / lr; v += Math.exp(-d * d * 1.6); }
      const edge = Math.max(0, 1 - Math.hypot(x - 64, y - 64) / 62);
      v = Math.min(1, v * 0.55) * Math.min(1, edge * 2.2);
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = v * 255;
    }
    g.putImageData(img, 0, 0);
    t.smoke = new THREE.CanvasTexture(c);
  }

  // Window grime: alpha map (white = dirty/opaque).
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#3a3a3a'; g.fillRect(0, 0, 256, 256);
    let s = 23;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 260; i++) {
      const x = rnd() * 256, y = rnd() * 256, r = 6 + rnd() * 46;
      const gg = g.createRadialGradient(x, y, 0, x, y, r);
      const v = Math.floor(70 + rnd() * 150);
      gg.addColorStop(0, `rgba(${v},${v},${v},${0.10 + rnd() * 0.22})`); gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // streaks from rain
    for (let i = 0; i < 40; i++) {
      const x = rnd() * 256;
      const gg = g.createLinearGradient(0, 0, 0, 256);
      gg.addColorStop(0, 'rgba(200,200,200,0)'); gg.addColorStop(0.3 + rnd() * 0.4, `rgba(210,210,210,${0.08 + rnd() * 0.16})`); gg.addColorStop(1, 'rgba(200,200,200,0)');
      g.fillStyle = gg; g.fillRect(x, 0, 1 + rnd() * 4, 256);
    }
    // heavy grime in the corners
    const cg = g.createRadialGradient(128, 128, 60, 128, 128, 185);
    cg.addColorStop(0, 'rgba(255,255,255,0)'); cg.addColorStop(1, 'rgba(255,255,255,0.55)');
    g.fillStyle = cg; g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    t.grime = tex;
  }

  // Soft round decal (dust fall, ceiling stain).
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    let s = 5;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.7) * 92;
      const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r, rr = 10 + rnd() * 34;
      const gg = g.createRadialGradient(x, y, 0, x, y, rr);
      gg.addColorStop(0, `rgba(255,255,255,${0.05 + rnd() * 0.14})`); gg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gg; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    t.blob = new THREE.CanvasTexture(c);
  }

  // Clock face
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#b9ad8e'; g.fillRect(0, 0, 256, 256);
    const gg = g.createRadialGradient(128, 128, 20, 128, 128, 150);
    gg.addColorStop(0, 'rgba(255,245,215,0.5)'); gg.addColorStop(1, 'rgba(60,40,10,0.55)');
    g.fillStyle = gg; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#1c150c'; g.fillStyle = '#1c150c';
    g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
    g.font = '22px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const R = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      g.fillText(R[i], 128 + Math.cos(a) * 90, 128 + Math.sin(a) * 90);
    }
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      g.lineWidth = i % 5 === 0 ? 2.5 : 1;
      g.beginPath(); g.moveTo(128 + Math.cos(a) * 104, 128 + Math.sin(a) * 104); g.lineTo(128 + Math.cos(a) * 110, 128 + Math.sin(a) * 110); g.stroke();
    }
    g.lineCap = 'round';
    g.lineWidth = 5; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 - 30, 128 - 52); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + 22, 128 - 84); g.stroke();
    g.beginPath(); g.arc(128, 128, 6, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    t.clock = tex;
  }

  // Dim oil paintings: abstract landscape and portrait silhouettes under dark varnish.
  t.paintings = [0, 1, 2].map((k) => {
    const [c, g] = canvas(256, 320);
    let s = 31 + k * 97;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const sky = g.createLinearGradient(0, 0, 0, 320);
    const pal = [['#3b4a48', '#1b1c14', '#0d0b07'], ['#4a3a2a', '#20160e', '#0a0806'], ['#2f3440', '#15171c', '#08080a']][k];
    sky.addColorStop(0, pal[0]); sky.addColorStop(0.55, pal[1]); sky.addColorStop(1, pal[2]);
    g.fillStyle = sky; g.fillRect(0, 0, 256, 320);
    if (k === 1) {
      // portrait: shoulders and a pale oval
      g.fillStyle = '#0b0907'; g.beginPath(); g.ellipse(128, 330, 120, 150, 0, 0, Math.PI * 2); g.fill();
      const fg = g.createRadialGradient(124, 130, 5, 128, 135, 62);
      fg.addColorStop(0, '#8d7b62'); fg.addColorStop(0.7, '#4a3d2e'); fg.addColorStop(1, 'rgba(20,15,10,0)');
      g.fillStyle = fg; g.beginPath(); g.ellipse(128, 135, 46, 60, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(10,8,6,0.75)'; g.beginPath(); g.ellipse(110, 124, 9, 5, 0, 0, Math.PI * 2); g.ellipse(146, 124, 9, 5, 0, 0, Math.PI * 2); g.fill();
    } else {
      for (let i = 0; i < 5; i++) {
        g.fillStyle = `rgba(${10 + i * 5},${12 + i * 5},${8 + i * 4},0.85)`;
        g.beginPath(); g.moveTo(0, 320);
        let y = 150 + i * 30;
        for (let x = 0; x <= 256; x += 16) { y += (rnd() - 0.5) * 22; g.lineTo(x, y); }
        g.lineTo(256, 320); g.fill();
      }
      g.fillStyle = 'rgba(190,180,140,0.28)'; g.beginPath(); g.arc(70 + k * 50, 70, 16, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 700; i++) {
      g.strokeStyle = `rgba(${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 240 : 0},200,${rnd() * 0.035})`;
      const x = rnd() * 256, y = rnd() * 320;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 8); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });

  // Piano keyboard strip
  {
    const [c, g] = canvas(1024, 64);
    g.fillStyle = '#c9c1a8'; g.fillRect(0, 0, 1024, 64);
    const W = 1024 / 52;
    for (let i = 0; i < 52; i++) {
      g.fillStyle = `rgba(40,30,15,${0.55})`; g.fillRect(i * W, 0, 1.2, 64);
      g.fillStyle = `rgba(90,70,30,${Math.random() * 0.12})`; g.fillRect(i * W, 0, W, 64);
    }
    const pattern = [1, 1, 0, 1, 1, 1, 0];
    for (let i = 0; i < 51; i++) if (pattern[(i + 5) % 7]) { g.fillStyle = '#0b0a09'; g.fillRect((i + 1) * W - W * 0.3, 26, W * 0.6, 38); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    t.keys = tex;
  }
  return t;
}
