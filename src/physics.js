// Minimal collision world: yaw-rotated boxes. Used for hero movement (circle vs box),
// camera collision, torch exposure occlusion and creature line-of-sight / path checks.
export class Physics {
  constructor() {
    this.boxes = [];
  }

  addBox(cx, cy, cz, sx, sy, sz, yaw = 0, flags = {}) {
    const b = {
      cx, cy, cz, hx: sx / 2, hy: sy / 2, hz: sz / 2,
      yaw, cos: Math.cos(yaw), sin: Math.sin(yaw),
      solid: flags.solid !== false,
      occlude: flags.occlude !== false,
      cam: flags.cam !== false,
      tag: flags.tag || null,
      enabled: true,
    };
    b.rad = Math.hypot(b.hx, b.hz);
    this.boxes.push(b);
    return b;
  }

  setBox(b, cx, cy, cz, yaw) {
    b.cx = cx; b.cy = cy; b.cz = cz;
    if (yaw !== undefined) { b.yaw = yaw; b.cos = Math.cos(yaw); b.sin = Math.sin(yaw); }
  }

  /** Push a circle (x,z,radius) spanning heights y0..y1 out of all solid boxes. Mutates p. */
  resolveCircle(p, r, y0, y1) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (let i = 0; i < this.boxes.length; i++) {
        const b = this.boxes[i];
        if (!b.solid || !b.enabled) continue;
        if (b.cy - b.hy >= y1 || b.cy + b.hy <= y0) continue;
        const dx = p.x - b.cx, dz = p.z - b.cz;
        const reach = b.rad + r;
        if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
        let lx = dx * b.cos - dz * b.sin;
        let lz = dx * b.sin + dz * b.cos;
        const qx = lx < -b.hx ? -b.hx : lx > b.hx ? b.hx : lx;
        const qz = lz < -b.hz ? -b.hz : lz > b.hz ? b.hz : lz;
        const ex = lx - qx, ez = lz - qz;
        const d2 = ex * ex + ez * ez;
        if (d2 >= r * r) continue;
        let nx, nz, push;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          nx = ex / d; nz = ez / d; push = r - d;
        } else {
          const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz);
          if (px < pz) { nx = lx >= 0 ? 1 : -1; nz = 0; push = px + r; } else { nx = 0; nz = lz >= 0 ? 1 : -1; push = pz + r; }
        }
        lx += nx * push; lz += nz * push;
        p.x = b.cx + lx * b.cos + lz * b.sin;
        p.z = b.cz - lx * b.sin + lz * b.cos;
        any = true; hit = true;
      }
      if (!any) break;
    }
    return hit;
  }

  /** Ray vs world. mask: 'occlude' | 'solid' | 'cam'. Returns distance or Infinity. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, mask = 'occlude', floor = true) {
    let best = maxDist;
    this.hitBox = null;
    if (floor && dy < -1e-6) {
      const t = -oy / dy;
      if (t > 0 && t < best) best = t;
    }
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b[mask] || !b.enabled) continue;
      const rx = ox - b.cx, rz = oz - b.cz;
      const lox = rx * b.cos - rz * b.sin, loz = rx * b.sin + rz * b.cos, loy = oy - b.cy;
      const ldx = dx * b.cos - dz * b.sin, ldz = dx * b.sin + dz * b.cos;
      let t0 = 0, t1 = best;
      // x slab
      if (Math.abs(ldx) < 1e-9) { if (lox < -b.hx || lox > b.hx) continue; } else {
        let a = (-b.hx - lox) / ldx, c = (b.hx - lox) / ldx;
        if (a > c) { const s = a; a = c; c = s; }
        if (a > t0) t0 = a; if (c < t1) t1 = c;
        if (t0 > t1) continue;
      }
      if (Math.abs(dy) < 1e-9) { if (loy < -b.hy || loy > b.hy) continue; } else {
        let a = (-b.hy - loy) / dy, c = (b.hy - loy) / dy;
        if (a > c) { const s = a; a = c; c = s; }
        if (a > t0) t0 = a; if (c < t1) t1 = c;
        if (t0 > t1) continue;
      }
      if (Math.abs(ldz) < 1e-9) { if (loz < -b.hz || loz > b.hz) continue; } else {
        let a = (-b.hz - loz) / ldz, c = (b.hz - loz) / ldz;
        if (a > c) { const s = a; a = c; c = s; }
        if (a > t0) t0 = a; if (c < t1) t1 = c;
        if (t0 > t1) continue;
      }
      if (t0 < best) { best = t0; this.hitBox = b; }
    }
    return best < maxDist ? best : Infinity;
  }

  /** True when the straight segment a→b is unobstructed. */
  los(ax, ay, az, bx, by, bz, mask = 'occlude') {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.02, mask, false) === Infinity;
  }

  /** Floor-level corridor test for a body of the given radius. */
  segmentClear(ax, az, bx, bz, radius = 0.3, y = 0.45) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return true;
    const ux = dx / len, uz = dz / len;
    const px = -uz * radius, pz = ux * radius;
    for (const s of [0, 1, -1]) {
      if (this.raycast(ax + px * s, y, az + pz * s, ux, 0, uz, len, 'solid', false) !== Infinity) return false;
    }
    return true;
  }
}
