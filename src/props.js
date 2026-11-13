// Furniture and set dressing. Each function draws into a local frame F (see batch.js: frame()).
// Local +z is the "front" of a piece; y is up; units are metres.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const RB = (w, h, d, r, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
const CYL = (r1, r2, h, seg = 12) => new THREE.CylinderGeometry(r1, r2, h, seg);
const SPH = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const LATHE = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

const turnedLeg = (h, r = 0.04) => LATHE([
  [r * 0.75, 0], [r * 0.9, h * 0.04], [r * 0.55, h * 0.1], [r * 0.8, h * 0.3], [r * 1.0, h * 0.55],
  [r * 0.6, h * 0.68], [r * 0.9, h * 0.74], [r * 1.05, h * 0.78], [r * 1.05, h], [0, h],
], 10);

/** Raised panel detail on a cabinet/door face. Face lies in the local XY plane at z. */
function panels(F, mat, cx, cy, z, w, h, cols, rows, o = {}) {
  const gap = o.gap ?? 0.05;
  const pw = (w - gap * (cols + 1)) / cols, ph = (h - gap * (rows + 1)) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = cx - w / 2 + gap + pw / 2 + i * (pw + gap);
    const y = cy - h / 2 + gap + ph / 2 + j * (ph + gap);
    F.box(mat, x, y, z, pw, ph, 0.012, { chamfer: 0.006, grain: 1, color: o.color });
  }
}

export function bed(F) {
  const W = 1.5, L = 2.05, wood = 'wood';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box(wood, sx * (W / 2 - 0.04), 0.17, sz * (L / 2 - 0.04), 0.075, 0.34, 0.075, { chamfer: 0.01, grain: 1 });
  for (const sx of [-1, 1]) F.box(wood, sx * (W / 2 - 0.03), 0.36, 0, 0.035, 0.17, L - 0.12, { chamfer: 0.006, grain: 2 });
  for (const sz of [-1, 1]) F.box(wood, 0, 0.36, sz * (L / 2 - 0.03), W - 0.12, 0.17, 0.035, { chamfer: 0.006, grain: 0 });
  F.box(wood, 0, 0.435, 0, W - 0.08, 0.025, L - 0.08, { grain: 2 });
  F.geom('ticking', RB(W - 0.05, 0.2, L - 0.08, 0.06), 0, 0.55, 0, { uvMul: 4 });
  F.geom('fabricWhite', RB(W - 0.02, 0.05, L * 0.62, 0.024), 0.02, 0.665, 0.34, { uvMul: 5, ry: 0.03 });
  F.geom('fabricBlue', RB(W + 0.06, 0.07, L * 0.46, 0.034), 0.1, 0.70, 0.52, { uvMul: 5, ry: -0.07 });
  F.geom('fabricBlue', RB(0.05, 0.42, 0.85, 0.02), W / 2 + 0.035, 0.50, 0.55, { uvMul: 4, rz: 0.06 });
  F.geom('fabricWhite', RB(0.62, 0.13, 0.4, 0.06), -0.32, 0.72, -L / 2 + 0.3, { uvMul: 2, ry: 0.15 });
  F.geom('fabricWhite', RB(0.6, 0.12, 0.4, 0.055), 0.36, 0.71, -L / 2 + 0.34, { uvMul: 2, ry: -0.25, rz: 0.08 });
  for (const sx of [-1, 1]) {
    F.box(wood, sx * (W / 2 - 0.04), 0.66, -L / 2 - 0.02, 0.08, 1.32, 0.08, { chamfer: 0.012, grain: 1 });
    F.geom('wood', SPH(0.05), sx * (W / 2 - 0.04), 1.36, -L / 2 - 0.02);
    F.box(wood, sx * (W / 2 - 0.04), 0.4, L / 2 + 0.02, 0.08, 0.8, 0.08, { chamfer: 0.012, grain: 1 });
    F.geom('wood', SPH(0.045), sx * (W / 2 - 0.04), 0.84, L / 2 + 0.02);
  }
  F.box(wood, 0, 0.88, -L / 2 - 0.02, W - 0.16, 0.62, 0.03, { grain: 0, chamfer: 0.004 });
  F.box(wood, 0, 1.24, -L / 2 - 0.02, W - 0.1, 0.08, 0.06, { grain: 0, chamfer: 0.012 });
  for (let i = -2; i <= 2; i++) F.box(wood, i * 0.24, 0.88, -L / 2 + 0.005, 0.035, 0.6, 0.02, { grain: 1, chamfer: 0.004 });
  F.box(wood, 0, 0.56, L / 2 + 0.02, W - 0.16, 0.34, 0.03, { grain: 0 });
  F.box(wood, 0, 0.78, L / 2 + 0.02, W - 0.1, 0.07, 0.06, { grain: 0, chamfer: 0.012 });
  // colliders leave the gap under the frame open so beams and sightlines can reach beneath
  F.solid(0, 0.57, 0, W, 0.5, L);
  F.solid(0, 0.66, -L / 2 - 0.02, W, 1.32, 0.1);
  F.solid(0, 0.4, L / 2 + 0.02, W, 0.8, 0.1);
}

export function nightstand(F) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box('wood', sx * 0.19, 0.06, sz * 0.16, 0.04, 0.12, 0.04, { grain: 1 });
  F.box('wood', 0, 0.36, 0, 0.45, 0.5, 0.4, { chamfer: 0.008, grain: 1 });
  F.box('wood', 0, 0.625, 0, 0.5, 0.03, 0.44, { chamfer: 0.008, grain: 0 });
  F.box('woodLight', 0, 0.5, 0.203, 0.38, 0.14, 0.012, { chamfer: 0.005, grain: 0 });
  F.box('woodLight', 0, 0.27, 0.203, 0.38, 0.26, 0.012, { chamfer: 0.005, grain: 0 });
  F.geom('brass', SPH(0.016, 8, 6), 0, 0.5, 0.22);
  F.geom('brass', SPH(0.016, 8, 6), 0.13, 0.27, 0.22);
  F.geom('brass', CYL(0.05, 0.06, 0.02), 0.08, 0.65, -0.05);
  F.geom('ivory', CYL(0.012, 0.014, 0.11, 8), 0.08, 0.71, -0.05);
  F.box('plain', -0.1, 0.655, 0.03, 0.15, 0.03, 0.21, { rot: 0.3, color: [0.35, 0.12, 0.1], chamfer: 0.003 });
  F.solid(0, 0.32, 0, 0.5, 0.64, 0.44);
}

export function wardrobe(F, o = {}) {
  const W = o.w || 1.25, D = 0.58, Ht = o.h || 2.05, wood = o.wood || 'wood';
  F.box(wood, 0, 0.05, 0, W + 0.04, 0.1, D + 0.02, { chamfer: 0.01, grain: 0 });
  F.box(wood, 0, Ht / 2 + 0.04, -0.01, W, Ht - 0.1, D - 0.02, { chamfer: 0.006, grain: 1 });
  F.box(wood, 0, Ht + 0.02, 0, W + 0.1, 0.07, D + 0.07, { chamfer: 0.02, grain: 0 });
  F.box('black', 0, Ht / 2 + 0.04, D / 2 - 0.012, W - 0.1, Ht - 0.22, 0.006);
  const dw = (W - 0.1) / 2, dh = Ht - 0.24;
  // left door closed
  F.box(wood, -dw / 2, Ht / 2 + 0.04, D / 2 + 0.006, dw - 0.006, dh, 0.022, { chamfer: 0.004, grain: 1 });
  panels(F, wood, -dw / 2, Ht / 2 + 0.04, D / 2 + 0.02, dw - 0.006, dh, 1, 2, { gap: 0.07, color: [1.15, 1.1, 1.05] });
  F.geom('brass', SPH(0.017, 8, 6), -0.05, Ht / 2, D / 2 + 0.035);
  // right door ajar
  const ajar = o.ajar ?? 0.5;
  const H2 = F.sub(W / 2 - 0.05, 0, D / 2 + 0.006, ajar);
  H2.box(wood, -dw / 2, Ht / 2 + 0.04, 0, dw - 0.006, dh, 0.022, { chamfer: 0.004, grain: 1 });
  panels(H2, wood, -dw / 2, Ht / 2 + 0.04, 0.014, dw - 0.006, dh, 1, 2, { gap: 0.07, color: [1.15, 1.1, 1.05] });
  H2.geom('brass', SPH(0.017, 8, 6), -dw + 0.05, Ht / 2, 0.03);
  F.solid(0, Ht / 2, 0, W + 0.06, Ht + 0.1, D + 0.06);
}

export function dresser(F) {
  const W = 1.2, D = 0.48, Ht = 0.86;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box('wood', sx * (W / 2 - 0.04), 0.07, sz * (D / 2 - 0.04), 0.05, 0.14, 0.05, { grain: 1 });
  F.box('wood', 0, Ht / 2 + 0.07, 0, W, Ht - 0.14, D, { chamfer: 0.008, grain: 1 });
  F.box('wood', 0, Ht + 0.015, 0, W + 0.05, 0.035, D + 0.04, { chamfer: 0.012, grain: 0 });
  for (let i = 0; i < 3; i++) {
    const y = 0.26 + i * 0.22;
    F.box('woodLight', 0, y, D / 2 + 0.004, W - 0.08, 0.19, 0.014, { chamfer: 0.006, grain: 0 });
    for (const sx of [-1, 1]) F.geom('brass', SPH(0.018, 8, 6), sx * 0.3, y, D / 2 + 0.022);
  }
  // tilting mirror on posts
  for (const sx of [-1, 1]) F.box('wood', sx * 0.36, Ht + 0.42, -D / 2 + 0.06, 0.035, 0.8, 0.035, { grain: 1, chamfer: 0.006 });
  F.box('wood', 0, Ht + 0.5, -D / 2 + 0.07, 0.66, 0.74, 0.03, { rot: [-0.1, 0, 0], chamfer: 0.012, grain: 1 });
  F.box('mirror', 0, Ht + 0.5, -D / 2 + 0.088, 0.56, 0.64, 0.006, { rot: [-0.1, 0, 0] });
  F.geom('ceramic', LATHE([[0.0, 0], [0.05, 0], [0.065, 0.05], [0.04, 0.12], [0.025, 0.17], [0.035, 0.19]]), -0.38, Ht + 0.032, 0.05);
  F.box('plain', 0.3, Ht + 0.05, 0.08, 0.2, 0.035, 0.14, { rot: -0.25, color: [0.2, 0.25, 0.2], chamfer: 0.004 });
  F.solid(0, Ht / 2, 0, W + 0.04, Ht + 0.04, D + 0.04);
  F.solid(0, Ht + 0.5, -D / 2 + 0.07, 0.8, 0.9, 0.1);
}

export function chair(F, o = {}) {
  const wood = o.wood || 'wood';
  const S = 0.42;
  F.box(wood, 0, 0.455, 0, S, 0.03, S, { chamfer: 0.008, grain: 2 });
  if (o.cushion) F.geom(o.cushion, RB(S - 0.05, 0.045, S - 0.05, 0.02), 0, 0.49, 0, { uvMul: 2 });
  for (const sx of [-1, 1]) {
    F.box(wood, sx * (S / 2 - 0.025), 0.22, S / 2 - 0.025, 0.035, 0.44, 0.035, { grain: 1, chamfer: 0.005 });
    F.box(wood, sx * (S / 2 - 0.025), 0.49, -S / 2 + 0.02, 0.035, 0.98, 0.035, { grain: 1, chamfer: 0.005, rot: [-0.06, 0, 0] });
    F.box(wood, sx * (S / 2 - 0.025), 0.2, 0, 0.02, 0.025, S - 0.07, { grain: 2 });
  }
  F.box(wood, 0, 0.24, S / 2 - 0.025, S - 0.07, 0.025, 0.02, { grain: 0 });
  F.box(wood, 0, 0.93, -S / 2 - 0.006, S - 0.02, 0.07, 0.022, { grain: 0, chamfer: 0.008 });
  F.box(wood, 0, 0.62, -S / 2 + 0.012, S - 0.06, 0.04, 0.018, { grain: 0 });
  for (let i = -1; i <= 1; i++) F.box(wood, i * 0.1, 0.78, -S / 2 + 0.004, 0.035, 0.28, 0.012, { grain: 1 });
  if (o.solid !== false) F.solid(0, 0.48, 0, S + 0.02, 0.96, S + 0.02);
}

export function lowTable(F) {
  const W = 1.2, D = 0.65;
  F.box('wood', 0, 0.44, 0, W, 0.04, D, { chamfer: 0.012, grain: 0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box('wood', sx * (W / 2 - 0.06), 0.21, sz * (D / 2 - 0.06), 0.05, 0.42, 0.05, { chamfer: 0.008, grain: 1 });
  F.box('wood', 0, 0.14, 0, W - 0.14, 0.02, D - 0.14, { grain: 0 });
  F.box('wood', 0, 0.395, D / 2 - 0.06, W - 0.14, 0.05, 0.02, { grain: 0 });
  F.box('wood', 0, 0.395, -D / 2 + 0.06, W - 0.14, 0.05, 0.02, { grain: 0 });
  // things left behind
  F.box('plain', -0.3, 0.475, 0.05, 0.22, 0.03, 0.3, { rot: 0.2, color: [0.3, 0.1, 0.08], chamfer: 0.003 });
  F.box('plain', -0.28, 0.503, 0.04, 0.2, 0.025, 0.28, { rot: -0.1, color: [0.12, 0.18, 0.24], chamfer: 0.003 });
  F.geom('ceramic', LATHE([[0, 0], [0.035, 0], [0.04, 0.02], [0.04, 0.075], [0.036, 0.075], [0.034, 0.012], [0, 0.012]]), 0.2, 0.46, -0.12);
  F.geom('ceramic', CYL(0.075, 0.05, 0.012, 14), 0.2, 0.466, -0.12);
  F.geom('brass', LATHE([[0, 0], [0.07, 0], [0.085, 0.025], [0.075, 0.03], [0.06, 0.012], [0, 0.012]]), 0.38, 0.46, 0.14);
  F.box('plain', 0.05, 0.156, 0.02, 0.3, 0.012, 0.42, { rot: 0.5, color: [0.5, 0.48, 0.42] });
  F.solid(0, 0.3, 0, W, 0.34, D);
}

export function sofa(F, o = {}) {
  const W = o.w || 2.0, D = 0.9, fab = o.fabric || 'fabricGreen';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.geom('wood', turnedLeg(0.16, 0.035), sx * (W / 2 - 0.1), 0, sz * (D / 2 - 0.1));
  F.geom(fab, RB(W, 0.24, D, 0.05), 0, 0.28, 0, { uvMul: 5 });
  F.geom(fab, RB(W, 0.62, 0.24, 0.09), 0, 0.68, -D / 2 + 0.12, { uvMul: 5, rx: -0.08 });
  for (const sx of [-1, 1]) F.geom(fab, RB(0.24, 0.44, D, 0.1), sx * (W / 2 - 0.12), 0.56, 0, { uvMul: 4 });
  const n = Math.round((W - 0.48) / 0.76);
  const cw = (W - 0.5) / n;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + 0.25 + cw / 2 + i * cw;
    F.geom(fab, RB(cw - 0.015, 0.16, D - 0.3, 0.06), x, 0.47, 0.1, { uvMul: 3, ry: (i - 0.5) * 0.02, color: [0.92, 0.92, 0.92] });
    F.geom(fab, RB(cw - 0.03, 0.42, 0.16, 0.07), x, 0.75, -D / 2 + 0.3, { uvMul: 3, rx: -0.2, color: [0.95, 0.95, 0.95] });
  }
  if (o.throwCushion) F.geom('fabricRed', RB(0.42, 0.14, 0.42, 0.065), -W / 2 + 0.5, 0.63, 0.12, { uvMul: 2, rx: -0.5, ry: 0.4 });
  F.solid(0, 0.45, 0, W, 0.9, D);
}

export function longTable(F) {
  const W = 1.1, L = 4.2;
  F.box('woodRed', 0, 0.765, 0, W, 0.055, L, { chamfer: 0.014, grain: 2 });
  for (const sx of [-1, 1]) F.box('woodRed', sx * (W / 2 - 0.12), 0.68, 0, 0.03, 0.11, L - 0.3, { grain: 2 });
  for (const sz of [-1, 1]) F.box('woodRed', 0, 0.68, sz * (L / 2 - 0.15), W - 0.24, 0.11, 0.03, { grain: 0 });
  for (const sx of [-1, 1]) for (const z of [-L / 2 + 0.18, 0, L / 2 - 0.18]) F.geom('woodRed', turnedLeg(0.74, 0.055), sx * (W / 2 - 0.14), 0, z);
  F.box('woodRed', 0, 0.16, 0, 0.05, 0.05, L - 0.5, { grain: 2, chamfer: 0.008 });
  // table runner, plates, candlesticks
  F.box('fabricWhite', 0.02, 0.796, 0.2, 0.42, 0.006, L - 0.9, { rot: 0.01, uvScale: 1 });
  const candle = (x, z, tilt = 0) => {
    const C = F.sub(x, 0.795, z, 0, tilt, 0);
    C.geom('brass', LATHE([[0, 0], [0.06, 0], [0.065, 0.012], [0.02, 0.03], [0.014, 0.12], [0.03, 0.14], [0.014, 0.16], [0.012, 0.22], [0.035, 0.235], [0.035, 0.25], [0, 0.25]], 12), 0, 0, 0);
    C.geom('ivory', CYL(0.011, 0.012, 0.14, 8), 0, 0.32, 0);
  };
  candle(0, -0.5); candle(0.02, 0.7);
  const plate = (x, z) => F.geom('ceramic', LATHE([[0, 0], [0.07, 0], [0.12, 0.016], [0.118, 0.022], [0.07, 0.008], [0, 0.008]], 18), x, 0.795, z);
  plate(-0.32, -1.4); plate(0.32, -1.38); plate(-0.33, 0.1); plate(0.3, 1.3); plate(-0.3, 1.5);
  F.geom('ceramic', LATHE([[0, 0], [0.035, 0], [0.045, 0.06], [0.04, 0.16], [0.016, 0.21], [0.016, 0.27], [0.02, 0.28]], 12), 0.28, 0.825, 0.15, { rx: 1.5708, ry: 0.6, color: [0.25, 0.45, 0.3] });
  // only the top collides: the dark space underneath stays open
  F.solid(0, 0.72, 0, W, 0.14, L);
}

export function sideboard(F, o = {}) {
  const W = o.w || 1.6, D = 0.48, Ht = 0.92, wood = o.wood || 'wood';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.geom(wood, turnedLeg(0.14, 0.03), sx * (W / 2 - 0.06), 0, sz * (D / 2 - 0.06));
  F.box(wood, 0, Ht / 2 + 0.07, 0, W, Ht - 0.14, D, { chamfer: 0.008, grain: 1 });
  F.box(wood, 0, Ht + 0.02, 0, W + 0.06, 0.04, D + 0.05, { chamfer: 0.014, grain: 0 });
  const n = 3, dw = (W - 0.08) / n;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + 0.04 + dw / 2 + i * dw;
    F.box('woodLight', x, 0.77, D / 2 + 0.004, dw - 0.03, 0.14, 0.014, { chamfer: 0.005, grain: 0 });
    F.geom('brass', SPH(0.016, 8, 6), x, 0.77, D / 2 + 0.022);
    F.box(wood, x, 0.4, D / 2 + 0.004, dw - 0.03, 0.5, 0.014, { chamfer: 0.005, grain: 1, color: [1.2, 1.15, 1.1] });
    panels(F, wood, x, 0.4, D / 2 + 0.014, dw - 0.03, 0.5, 1, 1, { gap: 0.06 });
  }
  if (o.dress !== false) {
    F.geom('ceramic', LATHE([[0, 0], [0.05, 0], [0.085, 0.07], [0.09, 0.15], [0.05, 0.25], [0.03, 0.3], [0.045, 0.33]], 14), -W / 2 + 0.3, Ht + 0.04, 0, { color: [0.5, 0.62, 0.7] });
    for (let i = 0; i < 4; i++) F.geom('ceramic', CYL(0.11, 0.07, 0.012, 16), 0.1, Ht + 0.046 + i * 0.013, 0.02);
    F.box('wood', W / 2 - 0.3, Ht + 0.14, -0.08, 0.22, 0.2, 0.1, { chamfer: 0.01, grain: 1 });
    F.box('clock', W / 2 - 0.3, Ht + 0.15, -0.028, 0.14, 0.14, 0.004, { fit: true });
  }
  F.solid(0, Ht / 2 + 0.02, 0, W + 0.04, Ht + 0.04, D + 0.04);
}

const BOOK_COLORS = [[0.28, 0.07, 0.06], [0.07, 0.14, 0.11], [0.08, 0.1, 0.2], [0.3, 0.22, 0.1], [0.16, 0.13, 0.1], [0.06, 0.06, 0.07], [0.34, 0.3, 0.22], [0.2, 0.09, 0.14]];

export function bookshelf(F, rng, o = {}) {
  const W = o.w || 1.8, D = 0.32, Ht = o.h || 2.1, wood = 'wood';
  for (const sx of [-1, 1]) F.box(wood, sx * (W / 2 - 0.015), Ht / 2, 0, 0.03, Ht, D, { grain: 1, chamfer: 0.004 });
  F.box(wood, 0, Ht - 0.015, 0, W, 0.03, D, { grain: 0 });
  F.box(wood, 0, Ht + 0.03, 0.01, W + 0.08, 0.06, D + 0.06, { grain: 0, chamfer: 0.016 });
  F.box(wood, 0, 0.05, 0, W, 0.1, D, { grain: 0 });
  F.box('woodBlack', 0, Ht / 2, -D / 2 + 0.008, W - 0.04, Ht - 0.1, 0.012);
  const shelves = o.shelves || 5;
  const sh = (Ht - 0.13) / shelves;
  for (let s = 0; s < shelves; s++) {
    const y0 = 0.1 + s * sh;
    if (s > 0) F.box(wood, 0, y0, 0, W - 0.06, 0.022, D - 0.02, { grain: 0 });
    let x = -W / 2 + 0.05;
    const fill = 0.35 + rng() * 0.6;
    const end = -W / 2 + 0.05 + (W - 0.1) * fill;
    while (x < end) {
      const t = 0.022 + rng() * 0.035, h = (0.16 + rng() * 0.1) * Math.min(1, sh / 0.34), d = 0.16 + rng() * 0.07;
      const c = BOOK_COLORS[Math.floor(rng() * BOOK_COLORS.length)];
      const k = 0.6 + rng() * 0.6;
      const lean = x + t + 0.08 > end ? 0.22 + rng() * 0.2 : 0;
      F.box('plain', x + t / 2 + (lean ? h * 0.12 : 0), y0 + 0.012 + h / 2 * Math.cos(lean), D / 2 - 0.04 - d / 2, t, h, d, { color: [c[0] * k, c[1] * k, c[2] * k], rot: lean ? [0, 0, -lean] : undefined, chamfer: 0.003 });
      x += t + 0.002 + (rng() < 0.08 ? 0.03 : 0);
    }
    if (rng() < 0.5 && fill < 0.75) {
      // a toppled stack in the empty part
      const sx = end + 0.2 + rng() * 0.1;
      for (let i = 0; i < 3; i++) {
        const c = BOOK_COLORS[Math.floor(rng() * BOOK_COLORS.length)];
        F.box('plain', sx, y0 + 0.03 + i * 0.034, 0, 0.16, 0.03, 0.22, { color: c, rot: (rng() - 0.5) * 0.5, chamfer: 0.003 });
      }
    }
  }
  F.solid(0, Ht / 2, 0, W + 0.04, Ht + 0.1, D + 0.04);
}

export function piano(F) {
  const W = 1.5, D = 0.62, Ht = 1.26, m = 'woodBlack';
  F.box(m, 0, 0.06, -0.04, W, 0.12, D - 0.1, { chamfer: 0.01, grain: 0 });
  F.box(m, 0, Ht / 2 + 0.06, -D / 2 + 0.17, W, Ht - 0.12, 0.34, { chamfer: 0.012, grain: 0 });
  F.box(m, 0, Ht + 0.015, -D / 2 + 0.18, W + 0.05, 0.035, 0.4, { chamfer: 0.014, grain: 0 });
  // key bed and fallboard
  F.box(m, 0, 0.70, 0.12, W, 0.07, 0.36, { chamfer: 0.012, grain: 0 });
  F.box('keys', 0, 0.742, 0.19, W - 0.14, 0.014, 0.15, { fit: true });
  F.box(m, 0, 0.80, 0.07, W - 0.1, 0.11, 0.02, { rot: [-0.25, 0, 0], grain: 0 });
  for (const sx of [-1, 1]) {
    F.box(m, sx * (W / 2 - 0.035), 0.42, 0.14, 0.07, 0.62, 0.3, { chamfer: 0.012, grain: 1 });
    F.geom(m, turnedLeg(0.64, 0.045), sx * (W / 2 - 0.09), 0.02, 0.26);
  }
  // music desk with a forgotten score
  F.box(m, 0, 1.0, 0.02, 0.7, 0.26, 0.012, { rot: [-0.3, 0, 0], grain: 0 });
  F.box('plain', 0.08, 1.0, 0.035, 0.42, 0.28, 0.004, { rot: [-0.3, 0, 0.03], color: [0.55, 0.52, 0.44] });
  for (const dx of [-0.07, 0.07]) F.box('brass', dx, 0.05, 0.3, 0.035, 0.012, 0.09, { chamfer: 0.004 });
  panels(F, m, 0, 0.36, 0.006, W - 0.3, 0.44, 2, 1, { gap: 0.06 });
  F.solid(0, Ht / 2, -0.04, W + 0.04, Ht + 0.04, D);
  // stool
  const S = F.sub(0.1, 0, 0.72, 0.2);
  S.geom('fabricRed', RB(0.36, 0.07, 0.36, 0.03), 0, 0.5, 0, { uvMul: 2 });
  S.box(m, 0, 0.45, 0, 0.34, 0.04, 0.34, { chamfer: 0.008 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.geom(m, turnedLeg(0.43, 0.03), sx * 0.13, 0, sz * 0.13);
  S.solid(0, 0.27, 0, 0.36, 0.54, 0.36);
}

export function crate(F, s = 0.5, h = 0.45, tint = [1, 1, 1]) {
  F.box('woodRaw', 0, h / 2, 0, s, h, s, { chamfer: 0.006, grain: 0, color: tint });
  const n = 3;
  for (let i = 0; i < n; i++) {
    const y = h * (0.17 + i * 0.33);
    for (const sz of [-1, 1]) F.box('woodRaw', 0, y, sz * (s / 2 + 0.008), s + 0.01, h * 0.24, 0.016, { grain: 0, chamfer: 0.004, color: [tint[0] * 1.15, tint[1] * 1.12, tint[2] * 1.1] });
    for (const sx of [-1, 1]) F.box('woodRaw', sx * (s / 2 + 0.008), y, 0, 0.016, h * 0.24, s + 0.01, { grain: 2, chamfer: 0.004, color: [tint[0] * 1.15, tint[1] * 1.12, tint[2] * 1.1] });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box('woodRaw', sx * (s / 2 + 0.01), h / 2, sz * (s / 2 + 0.01), 0.05, h + 0.01, 0.05, { grain: 1, chamfer: 0.006, color: tint });
  F.solid(0, h / 2, 0, s + 0.05, h, s + 0.05);
}

export function coatStand(F) {
  F.geom('wood', CYL(0.02, 0.028, 1.74, 10), 0, 0.89, 0);
  F.geom('wood', SPH(0.04), 0, 1.78, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    F.box('wood', Math.sin(a) * 0.17, 0.035, Math.cos(a) * 0.17, 0.05, 0.04, 0.36, { rot: a, chamfer: 0.01, grain: 2 });
    F.box('wood', Math.sin(a) * 0.08, 1.66, Math.cos(a) * 0.08, 0.02, 0.02, 0.18, { rot: [-0.6, a, 0], grain: 2 });
    F.box('wood', Math.sin(a + 1) * 0.08, 1.5, Math.cos(a + 1) * 0.08, 0.02, 0.02, 0.18, { rot: [-0.6, a + 1, 0], grain: 2 });
  }
  // a long coat and a hat: reads as a figure at a glance
  F.geom('fabricDark', RB(0.44, 1.05, 0.2, 0.09), 0.02, 1.05, 0.12, { uvMul: 4, rx: 0.04 });
  F.geom('fabricDark', RB(0.13, 0.7, 0.13, 0.06), -0.25, 1.18, 0.1, { uvMul: 3, rz: 0.1 });
  F.geom('fabricDark', RB(0.13, 0.7, 0.13, 0.06), 0.29, 1.18, 0.1, { uvMul: 3, rz: -0.1 });
  F.geom('fabricDark', CYL(0.085, 0.095, 0.11, 14), 0.0, 1.86, 0.02, { color: [0.6, 0.6, 0.6] });
  F.geom('fabricDark', CYL(0.16, 0.16, 0.012, 16), 0.0, 1.805, 0.02, { color: [0.6, 0.6, 0.6] });
  F.solid(0, 0.9, 0.05, 0.42, 1.8, 0.36);
}

export function consoleTable(F) {
  const W = 1.3, D = 0.38;
  F.box('woodRed', 0, 0.8, 0, W, 0.035, D, { chamfer: 0.012, grain: 0 });
  F.box('woodRed', 0, 0.72, 0, W - 0.08, 0.12, D - 0.06, { grain: 0, chamfer: 0.004 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.geom('woodRed', turnedLeg(0.67, 0.035), sx * (W / 2 - 0.07), 0, sz * (D / 2 - 0.06));
  F.box('woodLight', 0, 0.72, D / 2 - 0.026, 0.5, 0.085, 0.012, { chamfer: 0.004, grain: 0 });
  F.geom('brass', SPH(0.015, 8, 6), 0, 0.72, D / 2 - 0.012);
  // bowl with keys, dead flowers
  F.geom('brass', LATHE([[0, 0], [0.05, 0], [0.1, 0.045], [0.095, 0.05], [0.05, 0.012], [0, 0.012]], 14), 0.35, 0.818, 0.02);
  F.geom('ceramic', LATHE([[0, 0], [0.045, 0], [0.07, 0.08], [0.06, 0.18], [0.03, 0.24], [0.04, 0.27]], 14), -0.38, 0.818, -0.02, { color: [0.75, 0.7, 0.55] });
  for (let i = 0; i < 5; i++) F.box('woodRaw', -0.38 + (i - 2) * 0.012, 1.2, -0.02 + (i % 2) * 0.014, 0.004, 0.36, 0.004, { rot: [(i - 2) * 0.09, i, (i - 2) * 0.11], color: [0.35, 0.3, 0.2] });
  F.solid(0, 0.42, 0, W, 0.84, D);
}

/** Wall mirror or picture. Frame is centred at local origin, facing +z, hung on a wall behind it. */
export function wallFrame(F, w, h, inner, o = {}) {
  const fw = o.fw || 0.06, mat = o.frame || 'brass';
  F.box(mat, 0, h / 2 - fw / 2, 0.02, w, fw, 0.04, { chamfer: 0.012, grain: 0 });
  F.box(mat, 0, -h / 2 + fw / 2, 0.02, w, fw, 0.04, { chamfer: 0.012, grain: 0 });
  F.box(mat, -w / 2 + fw / 2, 0, 0.02, fw, h - fw * 2, 0.04, { chamfer: 0.012, grain: 1 });
  F.box(mat, w / 2 - fw / 2, 0, 0.02, fw, h - fw * 2, 0.04, { chamfer: 0.012, grain: 1 });
  F.box(inner, 0, 0, 0.012, w - fw * 2 + 0.01, h - fw * 2 + 0.01, 0.008, { fit: true });
}

export function grandfatherClock(F) {
  const m = 'woodRed';
  F.box(m, 0, 0.26, 0, 0.5, 0.52, 0.3, { chamfer: 0.012, grain: 1 });
  F.box(m, 0, 0.03, 0, 0.54, 0.06, 0.34, { chamfer: 0.01, grain: 0 });
  F.box(m, 0, 1.02, 0, 0.36, 1.0, 0.24, { chamfer: 0.01, grain: 1 });
  F.box('black', 0, 1.02, 0.121, 0.2, 0.74, 0.004);
  F.geom('brass', CYL(0.006, 0.006, 0.5, 6), 0.02, 1.12, 0.1, { rz: 0.05 });
  F.geom('brass', CYL(0.06, 0.06, 0.012, 16), 0.008, 0.86, 0.1, { rx: 1.5708 });
  for (const sx of [-1, 1]) F.box(m, sx * 0.12, 1.02, 0.126, 0.04, 0.82, 0.012, { grain: 1, chamfer: 0.004 });
  for (const y of [0.63, 1.41]) F.box(m, 0, y, 0.126, 0.28, 0.04, 0.012, { grain: 0, chamfer: 0.004 });
  F.box(m, 0, 1.52, 0, 0.42, 0.04, 0.28, { chamfer: 0.012, grain: 0 });
  F.box(m, 0, 1.8, 0, 0.5, 0.52, 0.3, { chamfer: 0.012, grain: 1 });
  F.box('clock', 0, 1.8, 0.152, 0.36, 0.36, 0.004, { fit: true });
  F.box(m, 0, 2.08, 0, 0.56, 0.05, 0.34, { chamfer: 0.016, grain: 0 });
  F.box(m, 0, 2.16, 0, 0.36, 0.12, 0.2, { chamfer: 0.03, grain: 0 });
  F.geom('brass', SPH(0.03), 0, 2.25, 0);
  F.solid(0, 1.1, 0, 0.54, 2.2, 0.34);
}

export function bench(F, o = {}) {
  const W = o.w || 1.4, D = 0.38;
  F.box('wood', 0, 0.45, 0, W, 0.04, D, { chamfer: 0.012, grain: 0 });
  for (const sx of [-1, 1]) {
    F.box('wood', sx * (W / 2 - 0.08), 0.215, 0, 0.04, 0.43, D - 0.06, { chamfer: 0.008, grain: 1 });
  }
  F.box('wood', 0, 0.2, 0, W - 0.2, 0.03, 0.05, { grain: 0 });
  // boots
  const boot = (x, z, ry, tip) => {
    const Bt = F.sub(x, 0, z, ry, 0, tip);
    Bt.geom('fabricDark', RB(0.1, 0.07, 0.27, 0.03), 0, 0.035, 0.03, { uvMul: 1, color: [0.5, 0.4, 0.3] });
    Bt.geom('fabricDark', RB(0.095, 0.26, 0.11, 0.035), 0, 0.16, -0.06, { uvMul: 1, color: [0.5, 0.4, 0.3] });
  };
  boot(-0.3, 0.32, 0.2, 0); boot(-0.15, 0.3, -0.1, 0); boot(0.42, 0.36, 1.2, 1.45);
  F.solid(0, 0.24, 0, W, 0.48, D);
}

export function radiator(F, n = 9) {
  const sp = 0.062;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * sp;
    F.geom('trim', RB(0.04, 0.62, 0.13, 0.019, 2), x, 0.43, 0, { uvMul: 1 });
  }
  const W = n * sp;
  F.geom('iron', CYL(0.014, 0.014, W + 0.16, 8), 0, 0.17, 0, { rz: 1.5708 });
  F.geom('iron', CYL(0.014, 0.014, 0.17, 8), W / 2 + 0.08, 0.085, 0);
  F.geom('brass', CYL(0.022, 0.022, 0.05, 8), -W / 2 - 0.04, 0.7, 0, { rz: 1.5708 });
  for (const sx of [-1, 1]) F.box('iron', sx * (W / 2 - 0.05), 0.06, 0, 0.03, 0.12, 0.1);
  F.solid(0, 0.4, 0, W + 0.04, 0.8, 0.16);
}

export function rug(F, w, d, mat = 'rug') {
  F.box(mat, 0, 0.007, 0, w, 0.012, d, { fit: true });
}

export function floorLamp(F) {
  F.geom('brass', CYL(0.13, 0.15, 0.03, 16), 0, 0.015, 0);
  F.geom('brass', CYL(0.012, 0.014, 1.45, 8), 0, 0.75, 0);
  F.geom('fabricCurtain', LATHE([[0.13, 0], [0.2, -0.26]], 18), 0, 1.66, 0, { rz: 0.12, color: [1.1, 1.0, 0.8] });
  F.solid(0, 0.8, 0, 0.26, 1.6, 0.26, { occlude: false });
}

export function tallCabinet(F) {
  wardrobe(F, { w: 0.95, h: 1.9, ajar: 0.0, wood: 'woodRaw' });
}

export function shelfUnit(F, rng) {
  const W = 1.6, D = 0.42, Ht = 1.9;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box('iron', sx * (W / 2 - 0.02), Ht / 2, sz * (D / 2 - 0.02), 0.035, Ht, 0.035, { chamfer: 0.004 });
  for (let s = 0; s < 4; s++) {
    const y = 0.12 + s * 0.56;
    F.box('woodRaw', 0, y, 0, W - 0.02, 0.025, D, { grain: 0 });
    let x = -W / 2 + 0.16;
    while (x < W / 2 - 0.15) {
      const k = rng();
      if (k < 0.35) {
        const s2 = 0.24 + rng() * 0.1;
        F.box('woodRaw', x, y + 0.013 + s2 * 0.4, 0, s2, s2 * 0.8, s2 * 0.9, { rot: (rng() - 0.5) * 0.3, chamfer: 0.006, color: [0.8 + rng() * 0.3, 0.8, 0.75], grain: 0 });
        x += s2 + 0.06;
      } else if (k < 0.75) {
        const r = 0.04 + rng() * 0.03, h = 0.12 + rng() * 0.14;
        F.geom(rng() < 0.5 ? 'ceramic' : 'metal', CYL(r, r, h, 12), x, y + 0.013 + h / 2, (rng() - 0.5) * 0.15, { color: [0.5 + rng() * 0.4, 0.5 + rng() * 0.3, 0.4 + rng() * 0.3] });
        x += r * 2 + 0.03;
      } else x += 0.12 + rng() * 0.2;
    }
  }
  F.solid(0, Ht / 2, 0, W, Ht, D);
}

export function coatRail(F) {
  F.box('wood', 0, 0, 0.012, 1.3, 0.11, 0.024, { chamfer: 0.008, grain: 0 });
  for (let i = 0; i < 5; i++) {
    const x = -0.52 + i * 0.26;
    F.box('brass', x, -0.01, 0.05, 0.016, 0.016, 0.07, { chamfer: 0.004 });
    F.geom('brass', SPH(0.014, 8, 6), x, -0.005, 0.088);
  }
  F.geom('fabricDark', RB(0.4, 0.95, 0.14, 0.06), -0.52, -0.5, 0.11, { uvMul: 4, color: [0.9, 0.8, 0.6] });
  F.geom('fabricGreen', RB(0.36, 0.72, 0.12, 0.05), 0.26, -0.39, 0.1, { uvMul: 4, rz: 0.03 });
  F.geom('fabricDark', CYL(0.15, 0.15, 0.01, 14), 0.0, -0.06, 0.12, { rx: 1.2, color: [0.5, 0.5, 0.5] });
}

export function umbrellaStand(F) {
  F.geom('iron', new THREE.CylinderGeometry(0.13, 0.11, 0.5, 14, 1, true), 0, 0.25, 0);
  F.geom('iron', CYL(0.11, 0.11, 0.015, 14), 0, 0.008, 0);
  F.geom('fabricDark', CYL(0.022, 0.012, 0.82, 8), 0.03, 0.44, 0.02, { rz: 0.1 });
  F.geom('wood', CYL(0.012, 0.012, 0.16, 6), 0.075, 0.9, 0.02, { rz: 0.1 });
  F.geom('fabricDark', CYL(0.02, 0.012, 0.78, 8), -0.04, 0.42, -0.03, { rx: 0.12, color: [0.3, 0.1, 0.1] });
  F.solid(0, 0.3, 0, 0.28, 0.6, 0.28);
}

export function drapedChair(F) {
  sofa(F, { w: 0.92, fabric: 'fabricRed' });
  F.geom('fabricSheet', RB(1.04, 0.5, 1.02, 0.2), 0, 0.72, -0.02, { uvMul: 6, rx: -0.06 });
  F.geom('fabricSheet', RB(1.08, 0.5, 1.06, 0.12), 0, 0.3, 0.0, { uvMul: 6 });
  F.geom('fabricSheet', RB(0.9, 0.5, 0.4, 0.16), 0, 0.92, -0.3, { uvMul: 6, rx: -0.1 });
}

export function writingDesk(F) {
  const W = 1.2, D = 0.56;
  F.box('wood', 0, 0.75, 0, W, 0.035, D, { chamfer: 0.012, grain: 0 });
  F.box('wood', 0, 0.67, 0, W - 0.08, 0.12, D - 0.06, { grain: 0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box('wood', sx * (W / 2 - 0.05), 0.31, sz * (D / 2 - 0.05), 0.05, 0.62, 0.05, { chamfer: 0.008, grain: 1 });
  for (const sx of [-1, 1]) { F.box('woodLight', sx * 0.3, 0.67, D / 2 - 0.026, 0.4, 0.085, 0.012, { chamfer: 0.004, grain: 0 }); F.geom('brass', SPH(0.014, 8, 6), sx * 0.3, 0.67, D / 2 - 0.012); }
  // scattered letters, an inkwell, a dead lamp
  for (let i = 0; i < 5; i++) F.box('plain', -0.2 + i * 0.09, 0.769 + i * 0.0012, 0.03 - (i % 2) * 0.08, 0.2, 0.002, 0.28, { rot: i * 0.5 - 0.8, color: [0.55, 0.52, 0.44] });
  F.geom('ceramic', CYL(0.03, 0.035, 0.05, 10), 0.42, 0.793, -0.12, { color: [0.1, 0.1, 0.15] });
  F.geom('brass', CYL(0.07, 0.08, 0.02, 14), -0.44, 0.778, -0.12);
  F.geom('brass', CYL(0.01, 0.01, 0.3, 8), -0.44, 0.93, -0.12);
  F.geom('enamel', LATHE([[0.04, 0], [0.11, -0.09]], 16), -0.44, 1.14, -0.12);
  F.solid(0, 0.4, 0, W, 0.8, D);
}

/** Rubble: broken plaster and lath. yAt(x,z) lets pieces land on furniture. */
export function debris(batch, rng, cx, cz, radius, count, yAt) {
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2, r = Math.pow(rng(), 0.7) * radius;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const y = yAt ? yAt(x, z) : 0;
    if (rng() < 0.68) {
      const s = 0.035 + Math.pow(rng(), 2) * 0.2;
      const hgt = s * (0.2 + rng() * 0.35);
      const k = 0.7 + rng() * 0.5;
      batch.box('plasterRim', x, y + hgt * 0.5, z, s, hgt, s * (0.5 + rng() * 0.6), { rot: [(rng() - 0.5) * 0.4, rng() * 6.28, (rng() - 0.5) * 0.4], chamfer: Math.min(0.01, hgt * 0.3), color: [k, k, k] });
    } else {
      const len = 0.18 + rng() * 0.5;
      batch.box('woodRaw', x, y + 0.012, z, 0.035, 0.008, len, { rot: [(rng() - 0.5) * 0.2, rng() * 6.28, 0], color: [0.8, 0.75, 0.65] });
    }
  }
}

/** Gathered curtain panel hanging in the local XY plane. */
export function curtain(F, w, h, gather, seed, mat = 'fabricCurtain') {
  const g = new THREE.PlaneGeometry(w, h, 28, 8);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i);
    const u = x / w + 0.5, v = y / h + 0.5;
    const fold = Math.sin(u * gather * Math.PI * 2 + seed) * 0.045 + Math.sin(u * gather * 4.1 + seed * 2.0) * 0.012;
    const sway = (1 - v) * Math.sin(u * 3.0 + seed) * 0.03;
    P.setZ(i, fold * (0.6 + 0.4 * (1 - v)) + sway);
    // ragged hem
    if (v < 0.01) P.setY(i, y + Math.abs(Math.sin(u * 23.0 + seed * 3.0)) * 0.09);
  }
  g.computeVertexNormals();
  F.geom(mat, g, 0, 0, 0, { uvMul: 4 });
}

/** Bare tree made of tapering branch segments. */
export function tree(batch, rng, x, y, z, height, mat = 'roof') {
  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), mid = new THREE.Vector3();
  const grow = (base, dir, len, rad, depth) => {
    const tip = base.clone().addScaledVector(dir, len);
    q.setFromUnitVectors(up, dir);
    mid.copy(base).add(tip).multiplyScalar(0.5);
    m.compose(mid, q, new THREE.Vector3(1, 1, 1));
    batch.geom(mat, new THREE.CylinderGeometry(rad * 0.68, rad, len, depth > 2 ? 5 : 7, 1, true), m, { uvMul: 2 });
    if (depth >= 5 || rad < 0.012) return;
    const n = depth === 0 ? 3 : rng() < 0.6 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const d2 = dir.clone();
      const ax = new THREE.Vector3(rng() - 0.5, (rng() - 0.5) * 0.4, rng() - 0.5).normalize();
      d2.applyAxisAngle(ax, 0.35 + rng() * 0.55);
      d2.y += 0.12; d2.normalize();
      grow(tip, d2, len * (0.62 + rng() * 0.2), rad * (0.55 + rng() * 0.15), depth + 1);
    }
  };
  const lean = new THREE.Vector3((rng() - 0.5) * 0.2, 1, (rng() - 0.5) * 0.2).normalize();
  grow(new THREE.Vector3(x, y, z), lean, height * 0.36, height * 0.035, 0);
}
