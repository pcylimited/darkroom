// Geometry batcher. Everything static in the level is emitted through here so that each room
// ends up as a handful of draw calls (one merged mesh per material). The box primitive has
// weighted-normal chamfers so edges catch light the way bevelled production assets do.
import * as THREE from 'three';

const _m4 = new THREE.Matrix4();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class Batcher {
  constructor(mats) {
    this.mats = mats;
    this.buckets = new Map();
  }

  _bucket(key) {
    let b = this.buckets.get(key);
    if (!b) {
      if (!this.mats[key]) throw new Error('Unknown material: ' + key);
      b = { pos: [], nor: [], uv: [], col: [], idx: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * Box centred at (cx,cy,cz) with full size (sx,sy,sz).
   * o.rot: yaw number or [rx,ry,rz]; o.chamfer: bevel size; o.grain: 0|1|2 axis the texture U runs along;
   * o.color: [r,g,b] vertex tint; o.uvScale; o.fit: map the top face 0..1 (rugs, decals)
   */
  box(mat, cx, cy, cz, sx, sy, sz, o = {}) {
    const B = this._bucket(mat);
    const tile = (this.mats[mat].userData.tile || 1) / (o.uvScale || 1);
    const h = [sx / 2, sy / 2, sz / 2];
    const c = Math.min(o.chamfer || 0, h[0] * 0.5, h[1] * 0.5, h[2] * 0.5);
    const col = o.color || [1, 1, 1];
    let rotated = false;
    if (o.rot !== undefined && o.rot !== 0) {
      if (typeof o.rot === 'number') _e.set(0, o.rot, 0); else _e.set(o.rot[0], o.rot[1], o.rot[2], 'YXZ');
      _m4.makeRotationFromEuler(_e);
      rotated = true;
    }
    // unrotated boxes use world-projected UVs so textures run continuously across pieces
    const off = rotated ? [(cx * 0.37 + cz * 0.11) % 1, (cy * 0.53) % 1, (cz * 0.29 + cx * 0.17) % 1] : [cx, cy, cz];
    const base = B.pos.length / 3;
    const local = [];
    for (let corner = 0; corner < 8; corner++) {
      const s = [corner & 1 ? 1 : -1, corner & 2 ? 1 : -1, corner & 4 ? 1 : -1];
      for (let axis = 0; axis < 3; axis++) {
        const p = [0, 0, 0];
        for (let k = 0; k < 3; k++) p[k] = s[k] * (h[k] - (k === axis ? 0 : c));
        local.push(p);
        let ua, va;
        if (axis === 0) { ua = 2; va = 1; } else if (axis === 1) { ua = 0; va = 2; } else { ua = 0; va = 1; }
        if (o.grain !== undefined && o.grain !== axis) { ua = o.grain; va = 3 - axis - o.grain; }
        let u, v;
        if (o.fit) { u = p[ua] / (2 * h[ua]) + 0.5; v = p[va] / (2 * h[va]) + 0.5; }
        else { u = (p[ua] + off[ua]) / tile; v = (p[va] + off[va]) / tile; }
        _v.set(p[0], p[1], p[2]);
        _n.set(0, 0, 0).setComponent(axis, s[axis]);
        if (rotated) { _v.applyMatrix4(_m4); _n.applyMatrix4(_m4); }
        B.pos.push(_v.x + cx, _v.y + cy, _v.z + cz);
        B.nor.push(_n.x, _n.y, _n.z);
        B.uv.push(u, v);
        B.col.push(col[0], col[1], col[2]);
      }
    }
    const V = (corner, axis) => corner * 3 + axis;
    const tri = (a, b, d) => {
      const pa = local[a], pb = local[b], pd = local[d];
      const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
      const vx = pd[0] - pa[0], vy = pd[1] - pa[1], vz = pd[2] - pa[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const gx = pa[0] + pb[0] + pd[0], gy = pa[1] + pb[1] + pd[1], gz = pa[2] + pb[2] + pd[2];
      if (nx * gx + ny * gy + nz * gz >= 0) B.idx.push(base + a, base + b, base + d);
      else B.idx.push(base + a, base + d, base + b);
    };
    // faces
    for (let axis = 0; axis < 3; axis++) {
      const b1 = (axis + 1) % 3, b2 = (axis + 2) % 3;
      for (let sgn = 0; sgn < 2; sgn++) {
        const cs = [];
        for (const [s1, s2] of [[0, 0], [1, 0], [1, 1], [0, 1]]) cs.push((sgn << axis) | (s1 << b1) | (s2 << b2));
        tri(V(cs[0], axis), V(cs[1], axis), V(cs[2], axis));
        tri(V(cs[0], axis), V(cs[2], axis), V(cs[3], axis));
      }
    }
    if (c > 0) {
      // edge strips
      for (let e = 0; e < 3; e++) {
        const a = (e + 1) % 3, b = (e + 2) % 3;
        for (let sa = 0; sa < 2; sa++) for (let sb = 0; sb < 2; sb++) {
          const c1 = (sa << a) | (sb << b), c2 = c1 | (1 << e);
          tri(V(c1, a), V(c2, a), V(c2, b));
          tri(V(c1, a), V(c2, b), V(c1, b));
        }
      }
      // corner caps
      for (let corner = 0; corner < 8; corner++) tri(V(corner, 0), V(corner, 1), V(corner, 2));
    }
  }

  /** Planar quad. Vertices as [x,y,z]; winding is fixed up against the supplied normal. */
  quad(mat, a, b, c, d, n, uvs, color) {
    const B = this._bucket(mat);
    const tile = this.mats[mat].userData.tile || 1;
    const col = color || [1, 1, 1];
    const base = B.pos.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const pts = [a, b, c, d];
    for (let i = 0; i < 4; i++) {
      const p = pts[i];
      B.pos.push(p[0], p[1], p[2]);
      B.nor.push(n[0], n[1], n[2]);
      if (uvs) B.uv.push(uvs[i][0], uvs[i][1]);
      else {
        // world-projected UVs on the dominant plane of the normal
        const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
        if (ay >= ax && ay >= az) B.uv.push(p[0] / tile, p[2] / tile);
        else if (ax >= az) B.uv.push(p[2] / tile, p[1] / tile);
        else B.uv.push(p[0] / tile, p[1] / tile);
      }
      B.col.push(col[0], col[1], col[2]);
    }
    if (flip) B.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Append an arbitrary BufferGeometry transformed by a matrix. */
  geom(mat, geometry, matrix, o = {}) {
    const B = this._bucket(mat);
    const col = o.color || [1, 1, 1];
    const uvMul = o.uvMul || 1;
    const base = B.pos.length / 3;
    const P = geometry.attributes.position, N = geometry.attributes.normal, U = geometry.attributes.uv;
    if (matrix) _nm.getNormalMatrix(matrix);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i);
      if (matrix) _v.applyMatrix4(matrix);
      B.pos.push(_v.x, _v.y, _v.z);
      if (N) { _n.fromBufferAttribute(N, i); if (matrix) _n.applyMatrix3(_nm).normalize(); } else _n.set(0, 1, 0);
      B.nor.push(_n.x, _n.y, _n.z);
      if (U) B.uv.push(U.getX(i) * uvMul, U.getY(i) * uvMul); else B.uv.push(0, 0);
      B.col.push(col[0], col[1], col[2]);
    }
    const flip = matrix ? matrix.determinant() < 0 : false;
    if (geometry.index) {
      const I = geometry.index;
      for (let i = 0; i < I.count; i += 3) {
        if (flip) B.idx.push(base + I.getX(i), base + I.getX(i + 2), base + I.getX(i + 1));
        else B.idx.push(base + I.getX(i), base + I.getX(i + 1), base + I.getX(i + 2));
      }
    } else {
      for (let i = 0; i < P.count; i += 3) {
        if (flip) B.idx.push(base + i, base + i + 2, base + i + 1);
        else B.idx.push(base + i, base + i + 1, base + i + 2);
      }
    }
    if (o.dispose !== false) geometry.dispose();
  }

  /** Triangulated 2D shape (x,y → x,z) laid flat at height y. Used for ceilings with breach holes. */
  flat(mat, shape, y, down = true, color) {
    const g = new THREE.ShapeGeometry(shape);
    const B = this._bucket(mat);
    const tile = this.mats[mat].userData.tile || 1;
    const col = color || [1, 1, 1];
    const base = B.pos.length / 3;
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), z = P.getY(i);
      B.pos.push(x, y, z);
      B.nor.push(0, down ? -1 : 1, 0);
      B.uv.push(x / tile, z / tile);
      B.col.push(col[0], col[1], col[2]);
    }
    const I = g.index;
    for (let i = 0; i < I.count; i += 3) {
      const a = I.getX(i), b = I.getX(i + 1), c = I.getX(i + 2);
      const ax = P.getX(a), az = P.getY(a), bx = P.getX(b), bz = P.getY(b), cx = P.getX(c), cz = P.getY(c);
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if ((ny < 0) === down) B.idx.push(base + a, base + b, base + c);
      else B.idx.push(base + a, base + c, base + b);
    }
    g.dispose();
  }

  build(name = 'batch') {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, B] of this.buckets) {
      if (!B.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
      g.setIndex(B.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(B.idx, 1) : new THREE.Uint16BufferAttribute(B.idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mat = this.mats[key];
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name + ':' + key;
      mesh.castShadow = mat.userData.cast !== false;
      mesh.receiveShadow = mat.userData.receive !== false;
      mesh.matrixAutoUpdate = false;
      if (mat.userData.renderOrder) mesh.renderOrder = mat.userData.renderOrder;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

/**
 * A local frame (position + orientation) for placing multi-part props.
 * Orientation is yaw with optional tilt (rx, rz), Euler order YXZ.
 */
export function frame(batch, physics, x, y, z, yaw = 0, rx = 0, rz = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ'));
  const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
  const tilted = rx !== 0 || rz !== 0;
  const v = new THREE.Vector3(), ql = new THREE.Quaternion(), e = new THREE.Euler();
  return {
    x, y, z, yaw, batch, physics,
    box(mat, lx, ly, lz, sx, sy, sz, o = {}) {
      v.set(lx, ly, lz).applyMatrix4(M);
      let rot;
      if (!tilted && o.rot === undefined) rot = yaw;
      else {
        if (o.rot === undefined) ql.identity();
        else if (typeof o.rot === 'number') ql.setFromEuler(e.set(0, o.rot, 0, 'YXZ'));
        else ql.setFromEuler(e.set(o.rot[0], o.rot[1], o.rot[2], 'YXZ'));
        ql.premultiply(q);
        e.setFromQuaternion(ql, 'YXZ');
        rot = [e.x, e.y, e.z];
      }
      batch.box(mat, v.x, v.y, v.z, sx, sy, sz, { ...o, rot });
    },
    geom(mat, geometry, lx, ly, lz, o = {}) {
      const m = new THREE.Matrix4();
      const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'));
      const s = o.scale || [1, 1, 1];
      m.compose(new THREE.Vector3(lx, ly, lz), qq, new THREE.Vector3(s[0], s[1], s[2])).premultiply(M);
      batch.geom(mat, geometry, m, o);
    },
    solid(lx, ly, lz, sx, sy, sz, flags) {
      if (!physics) return null;
      v.set(lx, ly, lz).applyMatrix4(M);
      return physics.addBox(v.x, v.y, v.z, sx, sy, sz, yaw, flags);
    },
    world(lx, ly, lz) { return new THREE.Vector3(lx, ly, lz).applyMatrix4(M); },
    sub(lx, ly, lz, dyaw = 0, drx = 0, drz = 0) {
      const p = this.world(lx, ly, lz);
      return frame(batch, physics, p.x, p.y, p.z, yaw + dyaw, rx + drx, rz + drz);
    },
  };
}
