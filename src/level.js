// Authored level: six rooms on a 3 x 2 grid, their doors, windows, ceiling breaches,
// fixtures, furniture and the exterior deck that leads to the landing.
//
//        north                         A  B  D      doors:   A-B  A-C  B-D  B-E  C-E  D-F  E-F  F-out
//   x →  0 .. 9.3 .. 18.6 .. 27.9      C  E  F      ceiling: B-C  B-D  C-E  D-E  D-F  E-F
//   z ↓  0 .. 11.3 .. 22.6
import * as THREE from 'three';
import { Batcher, frame } from './batch.js';
import { CFG } from './config.js';
import { mulberry32 } from './util.js';
import * as P from './props.js';

export const H = CFG.world.H;
export const T = CFG.world.T;
export const HR = H + 1.5; // underside of the roof

export const ROOMS = {
  A: { id: 'A', name: 'Entry', landmark: 'A bay window looking along the house to a lamplit landing', x0: 0, x1: 9.3, z0: 0, z1: 11.3, wall: 'wallA', wains: 'wainsA', floor: 'floorTile', trim: 'trim' },
  B: { id: 'B', name: 'Bedroom', landmark: 'A bed beneath a broken ceiling edge', x0: 9.3, x1: 18.6, z0: 0, z1: 11.3, wall: 'wallB', floor: 'floorWood', trim: 'trim' },
  C: { id: 'C', name: 'Sitting room', landmark: 'A low table before a broad window', x0: 0, x1: 9.3, z0: 11.3, z1: 22.6, wall: 'wallC', floor: 'floorWood', trim: 'trim' },
  D: { id: 'D', name: 'Junction', landmark: 'Two tall windows over a bare floor, and a piano', x0: 18.6, x1: 27.9, z0: 0, z1: 11.3, wall: 'wallD', floor: 'floorWoodDark', trim: 'trim' },
  E: { id: 'E', name: 'Dining room', landmark: 'A long table with scattered chairs', x0: 9.3, x1: 18.6, z0: 11.3, z1: 22.6, wall: 'wallE', wains: 'wainsE', floor: 'floorWood', trim: 'trimDark' },
  F: { id: 'F', name: 'Exit room', landmark: 'Cold daylight around a heavy door', x0: 18.6, x1: 27.9, z0: 11.3, z1: 22.6, wall: 'wallF', wains: 'wainsF', floor: 'floorTile', trim: 'trim' },
};
export const BAY = { x0: 5.0, x1: 9.3, z0: -3.3, z1: 0 };

export function roomAt(x, z) {
  if (x > 28.05) return 'OUT';
  if (z < 0) return x >= BAY.x0 && x <= BAY.x1 && z >= BAY.z0 ? 'A' : 'OUT';
  if (x < 0 || z > 22.6) return 'OUT';
  const col = x < 9.3 ? 0 : x < 18.6 ? 1 : 2;
  return (z < 11.3 ? ['A', 'B', 'D'] : ['C', 'E', 'F'])[col];
}

const win = (t, w, o = {}) => ({ kind: 'win', t, w, y0: 1.0, y1: 2.6, ...o });
const door = (id, t, o = {}) => ({
  kind: 'door', id, t,
  w: (o.exit ? CFG.door.exitWidth : CFG.door.width) + 0.06,
  y0: 0, y1: o.exit ? 2.92 : CFG.door.height + 0.035, hinge: 'a', ...o,
});

// axis 'x': wall runs along x at z = c.  axis 'z': runs along z at x = c.
// neg / pos: the room on the negative / positive side of the wall normal (+z or +x).
const WALLS = [
  { axis: 'x', c: 0, a: 0, b: 5.0, neg: 'EXT', pos: 'A', open: [], trim: { pos: [0.15, 5.15] } },
  { axis: 'x', c: 0, a: 9.3, b: 18.6, neg: 'EXT', pos: 'B', open: [win(13.2, 1.6, { curtain: 'both' })] },
  { axis: 'x', c: 0, a: 18.6, b: 27.9, neg: 'EXT', pos: 'D', open: [] },
  { axis: 'z', c: 5.0, a: -3.3, b: 0, neg: 'EXT', pos: 'A', open: [], trim: { pos: [-3.15, 0.15] } },
  { axis: 'x', c: -3.3, a: 5.0, b: 9.3, neg: 'EXT', pos: 'A', open: [win(7.15, 1.9, { curtain: 'left' })] },
  { axis: 'z', c: 9.3, a: -3.3, b: 0, neg: 'A', pos: 'EXT', open: [win(-1.65, 1.9)], trim: { neg: [-3.15, 0] } },
  { axis: 'x', c: 11.3, a: 0, b: 9.3, neg: 'A', pos: 'C', open: [door('AC', 3.0)] },
  { axis: 'x', c: 11.3, a: 9.3, b: 18.6, neg: 'B', pos: 'E', open: [door('BE', 14.5)] },
  { axis: 'x', c: 11.3, a: 18.6, b: 27.9, neg: 'D', pos: 'F', open: [door('DF', 24.5, { hinge: 'b' })] },
  { axis: 'x', c: 22.6, a: 0, b: 9.3, neg: 'C', pos: 'EXT', open: [win(4.6, 3.4, { curtain: 'both' })] },
  { axis: 'x', c: 22.6, a: 9.3, b: 18.6, neg: 'E', pos: 'EXT', open: [win(11.9, 1.4, { boards: 3 }), win(16.2, 1.4, { curtain: 'right' })] },
  { axis: 'x', c: 22.6, a: 18.6, b: 27.9, neg: 'F', pos: 'EXT', open: [win(22.2, 1.4, { boards: 2 })] },
  { axis: 'z', c: 0, a: 0, b: 11.3, neg: 'EXT', pos: 'A', open: [win(4.2, 1.5, { curtain: 'right' })] },
  { axis: 'z', c: 0, a: 11.3, b: 22.6, neg: 'EXT', pos: 'C', open: [win(15.2, 1.5, { boards: 2 })] },
  { axis: 'z', c: 9.3, a: 0, b: 11.3, neg: 'A', pos: 'B', open: [door('AB', 7.0)], trim: { neg: [0, 11.15] } },
  { axis: 'z', c: 9.3, a: 11.3, b: 22.6, neg: 'C', pos: 'E', open: [door('CE', 18.0)] },
  { axis: 'z', c: 18.6, a: 0, b: 11.3, neg: 'B', pos: 'D', open: [door('BD', 6.0, { hinge: 'b' })] },
  { axis: 'z', c: 18.6, a: 11.3, b: 22.6, neg: 'E', pos: 'F', open: [door('EF', 15.0)] },
  { axis: 'z', c: 27.9, a: 0, b: 11.3, neg: 'D', pos: 'EXT', open: [win(3.0, 1.5, { curtain: 'left' }), win(7.6, 1.5)] },
  { axis: 'z', c: 27.9, a: 11.3, b: 22.6, neg: 'F', pos: 'EXT', open: [door('EXIT', 18.5, { exit: true })] },
];

const BREACHES = [
  { id: 'B', room: 'B', x: 16.7, z: 3.0, rx: 1.0, rz: 0.8, drop: [17.0, 4.7] },
  { id: 'C', room: 'C', x: 2.0, z: 20.5, rx: 0.95, rz: 0.85, drop: [3.3, 20.1] },
  { id: 'D', room: 'D', x: 23.6, z: 2.8, rx: 1.0, rz: 0.85, drop: [23.6, 4.6] },
  { id: 'E', room: 'E', x: 11.2, z: 13.2, rx: 0.95, rz: 0.85, drop: [11.6, 15.0] },
  { id: 'Fa', room: 'F', x: 22.4, z: 13.6, rx: 0.9, rz: 0.8, drop: [22.6, 15.3] },
  { id: 'Fb', room: 'F', x: 20.8, z: 18.4, rx: 0.85, rz: 0.9, drop: [22.3, 18.5] },
];
// creature ceiling passages (design doc section 7), plus the short attic hop between F's two breaches
const PASSAGES = [['B', 'C'], ['B', 'D'], ['C', 'E'], ['D', 'E'], ['D', 'Fa'], ['E', 'Fb'], ['Fa', 'Fb']];

const FIXTURES = [
  { id: 'A1', room: 'A', kind: 'pendant', x: 5.0, z: 7.6, y: 2.72, r: 3.9, dependable: true, label: 'entry lamp' },
  { id: 'B1', room: 'B', kind: 'pendant', x: 11.6, z: 7.0, y: 2.62, r: 1.9, dependable: true, label: 'bedroom lamp' },
  { id: 'C1', room: 'C', kind: 'pendant', x: 6.4, z: 17.0, y: 2.66, r: 2.8, dependable: false, label: 'sitting room lamp', sw: { x: 4.7, y: 1.35, z: 11.45, yaw: 0 } },
  { id: 'DN', room: 'D', kind: 'sconce', x: 18.75, z: 6.0, y: 2.44, nx: 1, nz: 0, rect: [18.75, 20.05, 4.79, 7.21], dependable: true, checkpoint: true, label: 'doorway lamp' },
  { id: 'E1', room: 'E', kind: 'pendant', x: 16.7, z: 15.0, y: 2.66, r: 2.2, dependable: false, startFailed: true, label: 'dining room lamp', sw: { x: 14.1, y: 1.35, z: 22.45, yaw: Math.PI } },
  { id: 'EN', room: 'E', kind: 'sconce', x: 9.45, z: 18.0, y: 2.44, nx: 1, nz: 0, rect: [9.45, 10.75, 16.79, 19.21], dependable: true, checkpoint: true, label: 'doorway lamp' },
  { id: 'F1', room: 'F', kind: 'sconce', x: 25.2, z: 22.45, y: 2.36, nx: 0, nz: -1, cx: 25.2, cz: 21.25, r: 1.75, dependable: true, label: 'side lamp' },
];

// Creature floor waypoints and hiding places per room.
const NAV = {
  A: { pts: [[2.0, 2.6], [6.9, 2.3], [7.3, -1.5], [1.6, 6.2], [5.0, 7.6]], hides: [] },
  B: {
    pts: [[11.6, 7.0], [11.3, 4.6], [13.6, 3.7], [13.5, 8.9], [16.0, 6.4], [16.2, 9.4], [11.4, 9.3]],
    hides: [{ x: 15.6, z: 1.3, kind: 'under', link: [13.6, 3.7] }, { x: 17.9, z: 0.9, kind: 'corner', link: [17.0, 4.7] }],
  },
  C: {
    pts: [[3.0, 13.2], [6.6, 13.5], [1.6, 15.4], [4.4, 19.9], [7.3, 20.4], [7.2, 17.0], [6.9, 15.0]],
    hides: [{ x: 0.9, z: 21.7, kind: 'corner', link: [3.3, 20.1] }, { x: 1.1, z: 16.9, kind: 'corner', link: [1.6, 15.4] }],
  },
  D: {
    pts: [[20.9, 6.0], [21.4, 3.0], [25.8, 3.0], [25.6, 7.6], [23.0, 8.2], [24.5, 9.5], [21.0, 8.3]],
    hides: [{ x: 27.2, z: 0.8, kind: 'corner', link: [25.8, 3.0] }, { x: 27.3, z: 10.75, kind: 'corner', link: [25.6, 7.6] }],
  },
  E: {
    pts: [[14.5, 13.2], [11.6, 18.0], [11.6, 20.9], [14.6, 21.2], [16.4, 20.6], [16.2, 17.6], [16.7, 15.0], [16.6, 13.4]],
    hides: [{ x: 13.5, z: 17.6, kind: 'under', link: [11.6, 18.0] }, { x: 17.8, z: 21.8, kind: 'corner', link: [16.4, 20.6] }],
  },
  F: {
    pts: [[24.5, 13.0], [20.4, 15.0], [22.6, 20.6], [25.9, 18.5], [25.6, 15.4], [20.3, 21.9]],
    hides: [{ x: 19.5, z: 12.2, kind: 'corner', link: [20.4, 15.0] }, { x: 21.6, z: 22.0, kind: 'corner', link: [22.6, 20.6] }],
  },
};

export function buildLevel(game) {
  const { mats, physics } = game;
  const rng = mulberry32(20261113);
  const batches = {};
  const bf = (room) => (batches[room] ||= new Batcher(mats));
  const level = {
    rooms: ROOMS, roomAt, breaches: [], doors: [], fixtures: FIXTURES, passages: PASSAGES, nav: NAV,
    windows: [], spawn: { x: 5.6, z: 4.6, yaw: -0.535 }, group: new THREE.Group(),
    exitX: 28.08, lampPost: { x: 31.35, y: 2.5, z: -4.4 },
  };

  // ---------------------------------------------------------------- floors
  for (const r of Object.values(ROOMS)) {
    bf(r.id).quad(r.floor, [r.x0, 0, r.z0], [r.x1, 0, r.z0], [r.x1, 0, r.z1], [r.x0, 0, r.z1], [0, 1, 0]);
  }
  bf('A').quad('floorTile', [BAY.x0, 0, BAY.z0], [BAY.x1, 0, BAY.z0], [BAY.x1, 0, BAY.z1], [BAY.x0, 0, BAY.z1], [0, 1, 0]);

  // ---------------------------------------------------------------- ceilings + breaches
  const subtractRect = (rects, h) => {
    const out = [];
    for (const r of rects) {
      if (h.x1 <= r.x0 || h.x0 >= r.x1 || h.z1 <= r.z0 || h.z0 >= r.z1) { out.push(r); continue; }
      if (h.z0 > r.z0) out.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: h.z0 });
      if (h.z1 < r.z1) out.push({ x0: r.x0, x1: r.x1, z0: h.z1, z1: r.z1 });
      const za = Math.max(r.z0, h.z0), zb = Math.min(r.z1, h.z1);
      if (h.x0 > r.x0) out.push({ x0: r.x0, x1: h.x0, z0: za, z1: zb });
      if (h.x1 < r.x1) out.push({ x0: h.x1, x1: r.x1, z0: za, z1: zb });
    }
    return out;
  };

  for (const r of Object.values(ROOMS)) {
    const shape = new THREE.Shape();
    shape.moveTo(r.x0, r.z0); shape.lineTo(r.x1, r.z0); shape.lineTo(r.x1, r.z1); shape.lineTo(r.x0, r.z1); shape.closePath();
    let rects = [{ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 }];
    for (const br of BREACHES.filter((b) => b.room === r.id)) {
      const n = 15, poly = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const k = 0.80 + rng() * 0.38;
        poly.push([br.x + Math.cos(a) * br.rx * k, br.z + Math.sin(a) * br.rz * k]);
      }
      const hole = new THREE.Path();
      hole.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < n; i++) hole.lineTo(poly[i][0], poly[i][1]);
      hole.closePath();
      shape.holes.push(hole);
      rects = subtractRect(rects, { x0: br.x - br.rx * 0.78, x1: br.x + br.rx * 0.78, z0: br.z - br.rz * 0.78, z1: br.z + br.rz * 0.78 });
      level.breaches.push({ ...br, poly });
      buildBreach(bf(r.id), br, poly);
    }
    bf(r.id).flat('ceiling', shape, H, true);
    for (const c of rects) physics.addBox((c.x0 + c.x1) / 2, H + 0.125, (c.z0 + c.z1) / 2, c.x1 - c.x0, 0.25, c.z1 - c.z0, 0, { solid: false });
  }
  {
    const s = new THREE.Shape();
    s.moveTo(BAY.x0, BAY.z0); s.lineTo(BAY.x1, BAY.z0); s.lineTo(BAY.x1, BAY.z1); s.lineTo(BAY.x0, BAY.z1); s.closePath();
    bf('A').flat('ceiling', s, H, true);
    physics.addBox((BAY.x0 + BAY.x1) / 2, H + 0.125, (BAY.z0 + BAY.z1) / 2, BAY.x1 - BAY.x0, 0.25, BAY.z1 - BAY.z0, 0, { solid: false });
  }

  function buildBreach(b, br, poly) {
    const n = poly.length;
    // broken edge of the lath-and-plaster ceiling
    for (let i = 0; i < n; i++) {
      const p0 = poly[i], p1 = poly[(i + 1) % n];
      const mx = (p0[0] + p1[0]) / 2 - br.x, mz = (p0[1] + p1[1]) / 2 - br.z;
      const l = Math.hypot(mx, mz) || 1;
      b.quad('plasterRim', [p0[0], H, p0[1]], [p1[0], H, p1[1]], [p1[0], H + 0.25, p1[1]], [p0[0], H + 0.25, p0[1]], [-mx / l, 0, -mz / l]);
      // ragged chunks still clinging to the rim
      if (rng() < 0.75) {
        const t = rng();
        const x = p0[0] + (p1[0] - p0[0]) * t, z = p0[1] + (p1[1] - p0[1]) * t;
        const s = 0.05 + rng() * 0.14;
        b.box('plasterRim', x + (mx / l) * 0.02, H - 0.01 - rng() * 0.03, z + (mz / l) * 0.02, s, 0.03 + rng() * 0.04, s * (0.5 + rng()), { rot: [(rng() - 0.5) * 0.7, rng() * 6.28, (rng() - 0.5) * 0.7], chamfer: 0.008 });
      }
    }
    // snapped laths reaching into the hole, some drooping
    for (let i = 0; i < 16; i++) {
      const p = poly[Math.floor(rng() * n)];
      const dx = br.x - p[0] + (rng() - 0.5) * 0.8, dz = br.z - p[1] + (rng() - 0.5) * 0.8;
      const yaw = Math.atan2(dx, dz);
      const len = 0.25 + rng() * 0.75;
      const droop = rng() < 0.45 ? 0.25 + rng() * 0.9 : (rng() - 0.5) * 0.15;
      const F = frame(b, null, p[0] - Math.sin(yaw) * 0.15, H + 0.03, p[1] - Math.cos(yaw) * 0.15, yaw, droop, 0);
      F.box('woodRaw', 0, 0, len / 2, 0.038, 0.008, len, { grain: 2, color: [0.75, 0.7, 0.6] });
    }
    // ceiling joists crossing the opening; one has cracked through
    const jl = br.rx * 2 + 1.8;
    [-0.62, 0.02, 0.6].forEach((dz, i) => {
      const z = br.z + dz * (br.rz / 0.85);
      if (i === 1) {
        b.box('roof', br.x - jl / 2 + jl * 0.19, H + 0.35, z, jl * 0.38, 0.2, 0.065, { grain: 0, chamfer: 0.006 });
        const F = frame(b, null, br.x + jl / 2, H + 0.35, z, 0, 0, 0.16);
        F.box('roof', -jl * 0.2, 0, 0, jl * 0.4, 0.2, 0.065, { grain: 0, chamfer: 0.006 });
      } else b.box('roof', br.x, H + 0.35, z, jl, 0.2, 0.065, { grain: 0, chamfer: 0.006 });
    });
    // fallen plaster and settled dust beneath
    const yAt = br.id === 'B' ? (x, z) => (x > 14.85 && x < 16.35 && z > 0.3 && z < 2.4 ? 0.73 : 0) : null;
    P.debris(b, rng, br.x, br.z + 0.1, br.rx * 1.5, 34, yAt);
    const s = br.rx * 2.9;
    b.quad('decalDust', [br.x - s / 2, 0.006, br.z - s / 2], [br.x + s / 2, 0.006, br.z - s / 2], [br.x + s / 2, 0.006, br.z + s / 2], [br.x - s / 2, 0.006, br.z + s / 2], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }

  // ---------------------------------------------------------------- walls
  for (const w of WALLS) buildWall(w);

  function buildWall(w) {
    const along = w.axis === 'x';
    const ga = along ? 0 : 2;
    const ext = w.neg === 'EXT' || w.pos === 'EXT';
    const top = ext ? HR : H + 0.25;
    const pos = (t, y, s) => (along ? [t, y, w.c + s] : [w.c + s, y, t]);
    const nrm = (s) => (along ? [0, 0, s] : [s, 0, 0]);
    const boxAt = (b, mat, t, y, s, lt, ly, ls, o = {}) => (along ? b.box(mat, t, y, w.c + s, lt, ly, ls, o) : b.box(mat, w.c + s, y, t, ls, ly, lt, o));
    const faceYaw = (side) => (along ? (side > 0 ? 0 : Math.PI) : side * Math.PI / 2);
    const faceFrame = (roomId, side, t, y, off = 0) => {
      const p = pos(t, y, side * (T / 2 + off));
      return frame(bf(roomId), physics, p[0], p[1], p[2], faceYaw(side));
    };
    const opens = [...w.open].sort((a, b) => a.t - b.t);

    // faces and colliders
    for (const side of [-1, 1]) {
      const room = side < 0 ? w.neg : w.pos;
      const mat = room === 'EXT' ? 'siding' : ROOMS[room].wall;
      const b = bf(room);
      const s = side * T / 2;
      const rect = (t0, t1, y0, y1) => {
        if (t1 - t0 < 1e-4 || y1 - y0 < 1e-4) return;
        b.quad(mat, pos(t0, y0, s), pos(t1, y0, s), pos(t1, y1, s), pos(t0, y1, s), nrm(side));
      };
      let cur = w.a - T / 2;
      for (const o of opens) {
        const o0 = o.t - o.w / 2, o1 = o.t + o.w / 2;
        rect(cur, o0, 0, top); rect(o0, o1, 0, o.y0); rect(o0, o1, o.y1, top);
        cur = o1;
      }
      rect(cur, w.b + T / 2, 0, top);
    }
    {
      const col = (t0, t1, y0, y1) => {
        if (t1 - t0 < 1e-3 || y1 - y0 < 1e-3) return;
        if (along) physics.addBox((t0 + t1) / 2, (y0 + y1) / 2, w.c, t1 - t0, y1 - y0, T);
        else physics.addBox(w.c, (y0 + y1) / 2, (t0 + t1) / 2, T, y1 - y0, t1 - t0);
      };
      let cur = w.a - T / 2;
      for (const o of opens) {
        const o0 = o.t - o.w / 2, o1 = o.t + o.w / 2;
        col(cur, o0, 0, top); col(o0, o1, 0, o.y0); col(o0, o1, o.y1, top);
        cur = o1;
      }
      col(cur, w.b + T / 2, 0, top);
    }

    // trim on interior faces
    for (const side of [-1, 1]) {
      const roomId = side < 0 ? w.neg : w.pos;
      if (roomId === 'EXT') continue;
      const room = ROOMS[roomId];
      const b = bf(roomId);
      const ov = w.trim && w.trim[side < 0 ? 'neg' : 'pos'];
      const a = ov ? ov[0] : w.a + T / 2, e = ov ? ov[1] : w.b - T / 2;
      const face = side * T / 2;
      const strip = (t0, t1, yc, hgt, dep, mat, ch) => {
        if (t1 - t0 < 0.03) return;
        boxAt(b, mat, (t0 + t1) / 2, yc, face + side * dep / 2, t1 - t0, hgt, dep, { grain: ga, chamfer: ch });
      };
      const iv = [];
      let cur = a;
      for (const o of opens) if (o.kind === 'door') { iv.push([cur, o.t - o.w / 2 - 0.106]); cur = o.t + o.w / 2 + 0.106; }
      iv.push([cur, e]);
      for (const [t0, t1] of iv) {
        strip(t0, t1, 0.08, 0.16, 0.022, room.trim, 0.007);
        if (room.wains) {
          strip(t0, t1, 0.55, 0.78, 0.012, room.wains, 0);
          strip(t0, t1, 0.965, 0.055, 0.032, room.trim, 0.012);
        }
      }
      strip(a, e, H - 0.055, 0.11, 0.07, room.trim, 0.024);
      strip(a, e, H - 0.15, 0.035, 0.028, room.trim, 0.008);
    }

    for (const o of opens) {
      const o0 = o.t - o.w / 2, o1 = o.t + o.w / 2;
      if (o.kind === 'door') {
        const b = bf(w.neg !== 'EXT' ? w.neg : w.pos);
        const y1 = o.y1;
        const dm = o.exit ? 'woodRaw' : 'door';
        boxAt(b, dm, o0 + 0.012, y1 / 2, 0, 0.024, y1, T + 0.03, { grain: 1, chamfer: 0.004 });
        boxAt(b, dm, o1 - 0.012, y1 / 2, 0, 0.024, y1, T + 0.03, { grain: 1, chamfer: 0.004 });
        boxAt(b, dm, o.t, y1 - 0.012, 0, o.w, 0.024, T + 0.03, { grain: ga, chamfer: 0.004 });
        for (const side of [-1, 1]) {
          const room = side < 0 ? w.neg : w.pos;
          const bb = bf(room);
          const s = side * (T / 2 + 0.012);
          boxAt(bb, dm, o0 - 0.05, (y1 + 0.1) / 2, s, 0.11, y1 + 0.1, 0.026, { grain: 1, chamfer: 0.008 });
          boxAt(bb, dm, o1 + 0.05, (y1 + 0.1) / 2, s, 0.11, y1 + 0.1, 0.026, { grain: 1, chamfer: 0.008 });
          boxAt(bb, dm, o.t, y1 + 0.06, s, o.w + 0.28, 0.13, 0.032, { grain: ga, chamfer: 0.012 });
          for (const tt of [o0 - 0.05, o1 + 0.05]) boxAt(bb, dm, tt, 0.11, s + side * 0.004, 0.125, 0.22, 0.034, { grain: 1, chamfer: 0.008 });
        }
        boxAt(b, 'wood', o.t, 0.008, 0, o.w, 0.016, T + 0.09, { grain: ga, chamfer: 0.006 });
        if (o.exit) {
          // transom light above the heavy door
          const ty = CFG.door.height + 0.09;
          boxAt(b, dm, o.t, ty, 0, o.w - 0.04, 0.1, T * 0.6, { grain: ga, chamfer: 0.01 });
          for (const k of [-1, 0, 1]) boxAt(b, dm, o.t + k * (o.w / 3 - 0.01), (ty + 0.05 + y1) / 2, 0, 0.035, y1 - ty - 0.05, 0.05, { grain: 1 });
          bf('F').quad('glass', pos(o0, ty + 0.05, 0.01), pos(o1, ty + 0.05, 0.01), pos(o1, y1 - 0.02, 0.01), pos(o0, y1 - 0.02, 0.01), nrm(-1));
          physics.addBox(w.c, (ty + y1) / 2, o.t, 0.06, y1 - ty, o.w, 0, { occlude: false });
        }
        level.doors.push({ id: o.id, a: w.neg, b: w.pos === 'EXT' ? 'OUT' : w.pos, axis: w.axis, c: w.c, t: o.t, w: o.w, hinge: o.hinge, exit: !!o.exit });
      } else buildWindow(w, o, { along, ga, pos, nrm, boxAt, faceFrame });
    }
  }

  function buildWindow(w, o, h) {
    const { along, ga, pos, nrm, boxAt, faceFrame } = h;
    const inside = w.neg === 'EXT' ? 1 : -1;
    const roomId = inside > 0 ? w.pos : w.neg;
    const b = bf(roomId), eb = bf('EXT');
    const o0 = o.t - o.w / 2, o1 = o.t + o.w / 2, y0 = o.y0, y1 = o.y1, wm = o.w, hm = y1 - y0, yc = (y0 + y1) / 2;
    const tm = ROOMS[roomId].trim;
    // reveals and stool
    boxAt(b, tm, o0 + 0.01, yc, 0, 0.02, hm, T + 0.02, { grain: 1 });
    boxAt(b, tm, o1 - 0.01, yc, 0, 0.02, hm, T + 0.02, { grain: 1 });
    boxAt(b, tm, o.t, y1 - 0.01, 0, wm, 0.02, T + 0.02, { grain: ga });
    boxAt(b, tm, o.t, y0 + 0.014, inside * 0.045, wm + 0.14, 0.036, T + 0.13, { grain: ga, chamfer: 0.012 });
    // interior casing
    const s = inside * (T / 2 + 0.012);
    boxAt(b, tm, o0 - 0.045, yc + 0.02, s, 0.1, hm + 0.1, 0.026, { grain: 1, chamfer: 0.008 });
    boxAt(b, tm, o1 + 0.045, yc + 0.02, s, 0.1, hm + 0.1, 0.026, { grain: 1, chamfer: 0.008 });
    boxAt(b, tm, o.t, y1 + 0.075, s, wm + 0.26, 0.14, 0.034, { grain: ga, chamfer: 0.014 });
    boxAt(b, tm, o.t, y0 - 0.075, s, wm + 0.1, 0.11, 0.022, { grain: ga, chamfer: 0.007 });
    // exterior casing
    const se = -inside * (T / 2 + 0.014);
    boxAt(eb, 'trim', o0 - 0.05, yc, se, 0.11, hm + 0.22, 0.03, { grain: 1, chamfer: 0.008 });
    boxAt(eb, 'trim', o1 + 0.05, yc, se, 0.11, hm + 0.22, 0.03, { grain: 1, chamfer: 0.008 });
    boxAt(eb, 'trim', o.t, y1 + 0.06, se, wm + 0.22, 0.12, 0.034, { grain: ga, chamfer: 0.01 });
    boxAt(eb, 'trim', o.t, y0 - 0.03, se - inside * 0.02, wm + 0.2, 0.06, 0.07, { grain: ga, chamfer: 0.012 });
    // sash and glazing bars
    const ss = -inside * 0.05;
    boxAt(b, tm, o0 + 0.045, yc, ss, 0.05, hm - 0.04, 0.045, { grain: 1, chamfer: 0.006 });
    boxAt(b, tm, o1 - 0.045, yc, ss, 0.05, hm - 0.04, 0.045, { grain: 1, chamfer: 0.006 });
    boxAt(b, tm, o.t, y1 - 0.045, ss, wm - 0.04, 0.05, 0.045, { grain: ga, chamfer: 0.006 });
    boxAt(b, tm, o.t, y0 + 0.055, ss, wm - 0.04, 0.05, 0.045, { grain: ga, chamfer: 0.006 });
    boxAt(b, tm, o.t, yc + 0.02, ss, wm - 0.04, 0.045, 0.05, { grain: ga, chamfer: 0.006 });
    const nV = Math.max(1, Math.round(wm / 0.52) - 1);
    for (let i = 1; i <= nV; i++) {
      const thick = nV >= 4 && i % 2 === 0 ? 0.05 : 0.024;
      boxAt(b, tm, o0 + (wm * i) / (nV + 1), yc, ss, thick, hm - 0.08, 0.03, { grain: 1 });
    }
    for (const f of [0.26, 0.76]) boxAt(b, tm, o.t, y0 + hm * f, ss, wm - 0.08, 0.022, 0.028, { grain: ga });
    b.quad('glass', pos(o0, y0, ss), pos(o1, y0, ss), pos(o1, y1, ss), pos(o0, y1, ss), nrm(inside));
    if (along) physics.addBox(o.t, yc, w.c, wm, hm, 0.06, 0, { occlude: false });
    else physics.addBox(w.c, yc, o.t, 0.06, hm, wm, 0, { occlude: false });

    // planks nailed across
    for (let i = 0; i < (o.boards || 0); i++) {
      const y = y0 + hm * (0.22 + (i * 0.62) / Math.max(1, o.boards - 1 || 1)) + (rng() - 0.5) * 0.12;
      const ang = (rng() - 0.5) * 0.28;
      const len = wm + 0.34 + rng() * 0.2;
      boxAt(b, 'woodRaw', o.t + (rng() - 0.5) * 0.1, y, inside * (T / 2 + 0.05), len, 0.15 + rng() * 0.04, 0.022, { rot: along ? [0, 0, ang] : [ang, 0, 0], grain: ga, chamfer: 0.004, color: [0.8, 0.76, 0.7] });
    }
    // curtains on a brass rod
    if (o.curtain) {
      const F = faceFrame(roomId, inside, o.t, 0, 0.1);
      F.geom('brass', new THREE.CylinderGeometry(0.012, 0.012, wm + 0.5, 8), 0, y1 + 0.2, 0, { rz: Math.PI / 2 });
      for (const sx of [-1, 1]) F.geom('brass', new THREE.SphereGeometry(0.024, 8, 6), sx * (wm / 2 + 0.25), y1 + 0.2, 0);
      const ch = y1 + 0.18 - 0.28;
      const mk = (sx, frac, seed) => {
        const cw = wm * frac;
        const C = F.sub(sx * (wm / 2 + 0.12 - cw / 2), 0.28 + ch / 2, 0.0);
        P.curtain(C, cw, ch, 3.5 + frac * 4, seed);
      };
      if (o.curtain === 'both' || o.curtain === 'left') mk(-1, o.curtain === 'both' ? 0.3 : 0.42, o.t * 3.1);
      if (o.curtain === 'both' || o.curtain === 'right') mk(1, o.curtain === 'both' ? 0.26 : 0.4, o.t * 5.3 + 1);
    }
    const c = pos(o.t, yc, 0);
    level.windows.push({ x: c[0], y: yc, z: c[2], nx: along ? 0 : inside, nz: along ? inside : 0, w: wm, h: hm, room: roomId, along });
  }

  // ---------------------------------------------------------------- doorway niches (checkpoints)
  const niche = (roomId, x0, x1, zA, zB) => {
    const b = bf(roomId), room = ROOMS[roomId];
    const len = x1 - x0, th = 0.18;
    for (const z of [zA, zB]) {
      b.box(room.wall, x0 + len / 2, H / 2, z, len, H, th, { chamfer: 0.012 });
      physics.addBox(x0 + len / 2, H / 2, z, len, H, th);
      for (const sz of [-1, 1]) b.box(room.trim, x0 + len / 2, 0.08, z + sz * (th / 2 + 0.011), len, 0.16, 0.022, { grain: 0, chamfer: 0.007 });
      b.box(room.trim, x1 + 0.011, 0.08, z, 0.022, 0.16, th + 0.044, { grain: 2, chamfer: 0.007 });
    }
    const hb = 2.5;
    b.box(room.wall, x1 - th / 2, (hb + H) / 2, (zA + zB) / 2, th, H - hb, zB - zA + th, { chamfer: 0.012 });
    b.box(room.trim, x1 - th / 2, hb - 0.03, (zA + zB) / 2, th + 0.04, 0.07, zB - zA - th, { grain: 2, chamfer: 0.012 });
    physics.addBox(x1 - th / 2, (hb + H) / 2, (zA + zB) / 2, th, H - hb, zB - zA + th, 0, { solid: false });
  };
  niche('D', 18.75, 20.1, 4.7, 7.3);
  niche('E', 9.45, 10.8, 16.7, 19.3);

  // ---------------------------------------------------------------- wiring from switches to fixtures
  const conduit = (roomId, pts) => {
    const b = bf(roomId);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      b.box('iron', (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, Math.abs(d[0]) + 0.02, Math.abs(d[1]) + 0.02, Math.abs(d[2]) + 0.02, { chamfer: 0.005 });
      b.box('iron', c[0], c[1], c[2], 0.05, 0.05, 0.05, { chamfer: 0.008 });
      // saddle clips
      const len = Math.hypot(d[0], d[1], d[2]);
      for (let s = 0.6; s < len - 0.3; s += 1.1) {
        const k = s / len;
        b.box('brass', a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k, 0.034 + Math.abs(d[0]) * 0, 0.034, 0.034, { chamfer: 0.006 });
      }
    }
  };
  conduit('C', [[4.7, 1.5, 11.475], [4.7, H - 0.02, 11.475], [4.7, H - 0.02, 17.0], [6.4, H - 0.02, 17.0]]);
  conduit('E', [[14.1, 1.5, 22.425], [14.1, H - 0.02, 22.425], [14.1, H - 0.02, 15.0], [16.7, H - 0.02, 15.0]]);

  // ---------------------------------------------------------------- furniture
  const Fr = (room, x, z, yaw = 0, y = 0, rx = 0, rz = 0) => frame(bf(room), physics, x, y, z, yaw, rx, rz);
  const NX = Math.PI / 2, PX = -Math.PI / 2; // yaw that turns a prop's front to face +x / -x
  const hang = (room, x, y, z, yaw, w, h, inner, o) => P.wallFrame(Fr(room, x, z, yaw, y), w, h, inner, o);

  // --- A: entry
  P.rug(Fr('A', 4.9, 7.4), 3.0, 4.4, 'rug');
  P.consoleTable(Fr('A', 0.42, 8.2, NX));
  hang('A', 0.16, 1.62, 8.2, NX, 0.8, 1.1, 'mirror', { frame: 'brass', fw: 0.07 });
  P.radiator(Fr('A', 0.3, 4.2, NX), 10);
  P.grandfatherClock(Fr('A', 2.2, 0.36, 0));
  P.coatStand(Fr('A', 8.5, 10.45, -2.2));
  P.bench(Fr('A', 6.6, 10.9, Math.PI));
  P.crate(Fr('A', 0.75, 0.9, 0.2), 0.6, 0.5);
  P.crate(Fr('A', 0.8, 0.92, -0.3, 0.5), 0.45, 0.38, [0.85, 0.8, 0.75]);
  P.crate(Fr('A', 1.45, 0.62, 0.9), 0.42, 0.36, [0.9, 0.9, 0.85]);
  P.writingDesk(Fr('A', 7.15, -2.8, 0));
  P.chair(Fr('A', 6.6, -2.05, Math.PI + 0.5));
  hang('A', 3.9, 1.75, 0.16, 0, 0.7, 0.9, 'painting1', { frame: 'brass' });
  hang('A', 9.14, 1.7, 3.3, PX, 1.0, 0.75, 'painting0', { frame: 'woodLight' });
  hang('A', 6.6, 1.8, 11.14, Math.PI, 0.6, 0.76, 'painting2', { frame: 'woodBlack' });
  level.clock = { x: 2.2, y: 1.6, z: 0.4 };

  // --- B: bedroom
  P.bed(Fr('B', 15.6, 1.35, 0));
  P.nightstand(Fr('B', 14.42, 0.42, 0));
  P.wardrobe(Fr('B', 9.78, 3.0, NX));
  P.radiator(Fr('B', 13.2, 0.28, 0), 9);
  P.chair(Fr('B', 11.9, 1.2, 0.5));
  P.dresser(Fr('B', 11.3, 10.87, Math.PI));
  P.rug(Fr('B', 13.7, 5.5, 0.05), 2.2, 3.2, 'rugBlue');
  P.crate(Fr('B', 17.75, 10.45, 0.3), 0.5, 0.42);
  P.chair(Fr('B', 16.9, 10.3, 2.6, 0.22, 1.5, 0), { solid: false });
  hang('B', 9.46, 1.75, 5.0, NX, 0.62, 0.8, 'painting1', { frame: 'woodBlack' });
  hang('B', 18.44, 1.7, 8.7, PX, 0.9, 0.7, 'painting2', { frame: 'brass' });

  // --- C: sitting room
  P.rug(Fr('C', 4.4, 17.7), 3.8, 3.2, 'rug');
  P.sofa(Fr('C', 4.4, 16.3, 0), { throwCushion: true });
  P.lowTable(Fr('C', 4.4, 17.9, 0.04));
  P.sofa(Fr('C', 2.0, 18.1, NX + 0.25), { w: 0.92 });
  P.bookshelf(Fr('C', 0.33, 13.0, NX), rng);
  P.sideboard(Fr('C', 8.88, 13.7, PX));
  P.floorLamp(Fr('C', 5.95, 15.95));
  P.radiator(Fr('C', 4.6, 22.3, Math.PI), 14);
  hang('C', 6.6, 1.75, 11.46, 0, 1.1, 0.8, 'painting0', { frame: 'brass', fw: 0.08 });
  hang('C', 9.14, 1.7, 20.6, PX, 0.6, 0.78, 'painting1', { frame: 'woodLight' });

  // --- D: junction
  P.piano(Fr('D', 27.4, 5.3, PX));
  P.sideboard(Fr('D', 21.2, 0.42, 0), { wood: 'woodRaw', dress: false });
  P.drapedChair(Fr('D', 26.85, 10.15, -2.3));
  P.crate(Fr('D', 19.3, 10.5, 0.1), 0.62, 0.55);
  P.crate(Fr('D', 20.05, 10.55, -0.25), 0.5, 0.42, [0.85, 0.82, 0.8]);
  P.crate(Fr('D', 19.35, 10.48, 0.5, 0.55), 0.44, 0.36, [0.9, 0.86, 0.8]);
  P.chair(Fr('D', 21.3, 9.3, 0.9, 0.22, 1.52, 0.1), { solid: false });
  hang('D', 23.6, 1.8, 11.14, Math.PI, 1.2, 0.85, 'painting0', { frame: 'woodBlack', fw: 0.08 });

  // --- E: dining room
  P.rug(Fr('E', 13.5, 17.6), 2.7, 5.6, 'rug');
  P.longTable(Fr('E', 13.5, 17.6, 0));
  P.chair(Fr('E', 12.55, 16.3, NX), { wood: 'woodRed', cushion: 'fabricRed' });
  P.chair(Fr('E', 12.5, 17.65, NX + 0.1), { wood: 'woodRed', cushion: 'fabricRed' });
  P.chair(Fr('E', 12.15, 19.0, NX - 0.7), { wood: 'woodRed', cushion: 'fabricRed' });
  P.chair(Fr('E', 14.45, 16.3, PX), { wood: 'woodRed', cushion: 'fabricRed' });
  P.chair(Fr('E', 14.5, 18.95, PX + 0.15), { wood: 'woodRed', cushion: 'fabricRed' });
  P.chair(Fr('E', 15.2, 17.75, 0.6, 0.22, 1.5, 0.05), { wood: 'woodRed', solid: false });
  P.chair(Fr('E', 13.6, 20.25, Math.PI - 0.3), { wood: 'woodRed', cushion: 'fabricRed' });
  P.sideboard(Fr('E', 16.9, 11.87, 0), { wood: 'woodRed' });
  P.wardrobe(Fr('E', 18.12, 20.0, PX), { w: 1.2, h: 2.0, ajar: 0.3, wood: 'woodRed' });
  hang('E', 12.0, 1.8, 11.46, 0, 1.3, 0.9, 'painting2', { frame: 'brass', fw: 0.09 });
  hang('E', 18.44, 1.75, 17.6, PX, 0.62, 0.8, 'painting1', { frame: 'brass' });

  // --- F: exit room
  P.bench(Fr('F', 26.4, 11.76, 0), { w: 1.5 });
  P.coatRail(Fr('F', 21.6, 11.46, 0, 1.72));
  P.tallCabinet(Fr('F', 27.42, 14.0, PX));
  P.shelfUnit(Fr('F', 19.0, 21.2, NX), rng);
  P.crate(Fr('F', 27.2, 21.9, 0.15), 0.6, 0.5);
  P.crate(Fr('F', 26.5, 22.0, -0.4), 0.46, 0.4, [0.85, 0.82, 0.78]);
  P.crate(Fr('F', 27.22, 21.92, 0.7, 0.5), 0.4, 0.34, [0.9, 0.85, 0.8]);
  P.umbrellaStand(Fr('F', 27.35, 16.9));
  P.rug(Fr('F', 26.3, 18.5, NX), 2.0, 1.3, 'rugBlue');
  P.radiator(Fr('F', 22.2, 22.3, Math.PI), 8);

  // ---------------------------------------------------------------- exterior
  buildExterior();

  function buildExterior() {
    const eb = bf('EXT');
    eb.quad('ground', [-90, -0.5, -90], [120, -0.5, -90], [120, -0.5, 110], [-90, -0.5, 110], [0, 1, 0]);
    // foundation skirt
    const sk = (x0, x1, z0, z1) => eb.box('plasterRim', (x0 + x1) / 2, -0.3, (z0 + z1) / 2, x1 - x0, 0.5, z1 - z0, { color: [0.5, 0.5, 0.5] }); // top sits below the floors: coplanar faces flicker
    sk(-0.2, 28.1, -0.2, 22.8); sk(4.8, 9.5, -3.5, 0);
    // roof slab: its underside is what a torch finds through a ceiling breach
    eb.box('roof', 13.95, HR + 0.12, 9.65, 29.5, 0.24, 27.4, { grain: 0 });
    for (let z = -3.0; z < 23; z += 1.2) eb.box('roof', 13.95, HR - 0.09, z, 28.2, 0.18, 0.07, { grain: 0 });

    // deck along the east side, ending in the landing the entry window looks at
    const dk = (x0, x1, z0, z1) => {
      eb.box('deck', (x0 + x1) / 2, -0.045, (z0 + z1) / 2, x1 - x0, 0.07, z1 - z0, { grain: 0, chamfer: 0.006 });
      eb.box('roof', (x0 + x1) / 2, -0.29, (z0 + z1) / 2, x1 - x0 - 0.1, 0.42, z1 - z0 - 0.1);
    };
    dk(28.05, 30.4, -0.8, 21.0);
    dk(28.05, 32.0, -5.0, -0.8);
    const rail = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      eb.box('trim', cx, 0.98, cz, alongX ? len : 0.085, 0.05, alongX ? 0.085 : len, { grain: alongX ? 0 : 2, chamfer: 0.012 });
      eb.box('trim', cx, 0.14, cz, alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, { grain: alongX ? 0 : 2 });
      const n = Math.floor(len / 0.15);
      for (let i = 1; i < n; i++) {
        const k = i / n;
        eb.box('trim', x0 + (x1 - x0) * k, 0.56, z0 + (z1 - z0) * k, 0.03, 0.8, 0.03, { grain: 1 });
      }
      physics.addBox(cx, 0.5, cz, alongX ? len : 0.1, 1.0, alongX ? 0.1 : len, 0, { occlude: false });
    };
    rail(30.33, -0.8, 30.33, 21.0);
    rail(28.05, 20.95, 30.4, 20.95);
    rail(28.05, -4.95, 32.0, -4.95);
    rail(31.95, -5.0, 31.95, -3.4);
    rail(31.95, -1.9, 31.95, -0.8);
    rail(30.4, -0.85, 32.0, -0.85);
    physics.addBox(32.3, 0.5, -2.65, 0.1, 1.0, 1.6, 0, { occlude: false }); // top of the steps
    for (let i = 0; i < 3; i++) eb.box('deck', 32.2 + i * 0.3, -0.16 - i * 0.16, -2.65, 0.32, 0.05, 1.5, { grain: 2, chamfer: 0.006 });
    // porch roof and posts
    eb.box('roof', 29.35, 3.2, 8.0, 3.0, 0.1, 26.6, { grain: 2 });
    eb.box('trim', 30.33, 3.06, 10.1, 0.12, 0.18, 22.0, { grain: 2, chamfer: 0.012 });
    for (let z = -0.8; z <= 21.01; z += 3.1143) {
      eb.box('trim', 30.33, 1.5, z, 0.13, 3.05, 0.13, { grain: 1, chamfer: 0.014 });
      physics.addBox(30.33, 1.5, z, 0.15, 3.0, 0.15);
    }
    // lamp post on the landing
    const lp = level.lampPost;
    eb.box('iron', lp.x, 1.3, lp.z, 0.09, 2.7, 0.09, { chamfer: 0.012 });
    eb.box('iron', lp.x, 0.1, lp.z, 0.2, 0.2, 0.2, { chamfer: 0.02 });
    eb.box('iron', lp.x - 0.2, 2.72, lp.z, 0.5, 0.045, 0.045, { chamfer: 0.008 });
    eb.box('iron', lp.x - 0.4, lp.y + 0.16, lp.z, 0.26, 0.03, 0.26, { chamfer: 0.008 });
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) eb.box('iron', lp.x - 0.4 + dx * 0.1, lp.y, lp.z + dz * 0.1, 0.018, 0.3, 0.018);
    eb.box('iron', lp.x - 0.4, lp.y - 0.16, lp.z, 0.24, 0.025, 0.24, { chamfer: 0.006 });
    physics.addBox(lp.x, 1.3, lp.z, 0.14, 2.7, 0.14);
    level.lampPost = { x: lp.x - 0.4, y: lp.y, z: lp.z };

    // bare trees
    const tr = mulberry32(77);
    let placed = 0, guard = 0;
    while (placed < 30 && guard++ < 500) {
      const x = -45 + tr() * 125, z = -50 + tr() * 115;
      if (x > -5 && x < 37 && z > -10 && z < 28) continue;
      P.tree(eb, tr, x, -0.5, z, 7 + tr() * 7);
      placed++;
    }
    // a few close to the bay window and the landing for parallax
    P.tree(eb, tr, 13.5, -0.5, -8.5, 9);
    P.tree(eb, tr, 24.0, -0.5, -10.5, 11);
    P.tree(eb, tr, 37.5, -0.5, -9.0, 10);
    P.tree(eb, tr, 39.0, -0.5, 6.0, 12);
    P.tree(eb, tr, 37.0, -0.5, 19.0, 9);
    // fence line beyond the landing
    for (let x = 33; x < 60; x += 2.2) {
      eb.box('roof', x, 0.1, -13 + Math.sin(x) * 0.3, 0.1, 1.3, 0.1, { rot: [0.05 * Math.sin(x * 3), 0, 0.06 * Math.cos(x * 2)] });
      eb.box('roof', x + 1.1, 0.35, -13, 2.2, 0.08, 0.03);
    }
  }

  for (const [id, b] of Object.entries(batches)) level.group.add(b.build('room' + id));
  return level;
}
