// Heavy doors. Progress is stored continuously and never lost; the swinging leaf is a real
// collider, so the hero (and the creature on the floor) can only pass once the gap is wide enough.
import * as THREE from 'three';
import { Batcher } from './batch.js';
import { CFG } from './config.js';
import { clamp, pointSegDist2D } from './util.js';

export class Door {
  constructor(game, spec) {
    this.game = game;
    this.id = spec.id;
    this.spec = spec;
    this.exit = spec.exit;
    this.rooms = [spec.a, spec.b];
    this.W = spec.w - 0.06;
    this.Hd = CFG.door.height;
    this.th = spec.exit ? 0.075 : 0.048;
    this.maxAngle = CFG.door.maxAngle;
    this.ease = spec.exit ? CFG.door.exitEase : CFG.door.ease;
    this.tFull = (spec.exit ? CFG.door.exitTimeToPassable : CFG.door.timeToPassable) / CFG.door.passFrac;

    const dirT = spec.hinge === 'a' ? 1 : -1;
    const hingeT = spec.t - dirT * (spec.w / 2 - 0.03);
    if (spec.axis === 'x') { this.hx = hingeT; this.hz = spec.c; this.dx = dirT; this.dz = 0; }
    else { this.hx = spec.c; this.hz = hingeT; this.dx = 0; this.dz = dirT; }
    this.theta0 = Math.atan2(-this.dz, this.dx);
    // doorway centre and the two standing points either side of it
    this.cx = spec.axis === 'x' ? spec.t : spec.c;
    this.cz = spec.axis === 'x' ? spec.c : spec.t;
    this.nx = spec.axis === 'x' ? 0 : 1;
    this.nz = spec.axis === 'x' ? 1 : 0;

    this.s = 0; // signed progress -1..1
    this.phi = 0;
    this.pushRate = 0; // smoothed, drives audio
    this.pushedThisFrame = false;

    this.pivot = new THREE.Group();
    this.pivot.position.set(this.hx, 0, this.hz);
    this._build();
    this.collider = game.physics.addBox(0, 0, 0, this.W, this.Hd, this.th, 0, { tag: 'door' });
    this._apply();
    game.scene.add(this.pivot);
  }

  _build() {
    const b = new Batcher(this.game.mats);
    const W = this.W, Hd = this.Hd, th = this.th;
    const y0 = 0.012;
    if (!this.exit) {
      const m = 'door';
      // recessed field, then stiles and rails proud of it
      b.box(m, W / 2, y0 + Hd / 2, 0, W - 0.01, Hd - 0.01, th * 0.55, { grain: 1 });
      const st = 0.115;
      b.box(m, st / 2, y0 + Hd / 2, 0, st, Hd, th, { grain: 1, chamfer: 0.005 });
      b.box(m, W - st / 2, y0 + Hd / 2, 0, st, Hd, th, { grain: 1, chamfer: 0.005 });
      const rails = [[0.11, 0.22], [0.98, 0.17], [1.52, 0.1], [Hd - 0.06, 0.12]];
      for (const [y, h] of rails) b.box(m, W / 2, y0 + y, 0, W - st * 2 + 0.004, h, th, { grain: 0, chamfer: 0.005 });
      b.box(m, W / 2, y0 + Hd / 2, 0, 0.1, Hd - 0.3, th, { grain: 1, chamfer: 0.005 });
      // raised panel centres
      const xs = [st + (W / 2 - st - 0.05) / 2, W - st - (W / 2 - st - 0.05) / 2];
      const pw = W / 2 - st - 0.05 - 0.07;
      const rows = [[0.22, 0.895], [1.065, 1.47], [1.57, Hd - 0.12]];
      for (const x of xs) for (const [ya, yb] of rows) {
        b.box(m, x, y0 + (ya + yb) / 2, 0, pw, yb - ya - 0.07, th * 0.8, { grain: 1, chamfer: 0.012, color: [1.1, 1.06, 1.02] });
      }
      // knob and escutcheon both sides, hinges
      for (const sz of [-1, 1]) {
        b.box('brass', W - 0.06, y0 + 1.0, sz * (th / 2 + 0.003), 0.045, 0.2, 0.006, { chamfer: 0.003 });
        b.geom('brass', new THREE.CylinderGeometry(0.011, 0.014, 0.04, 10), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(W - 0.06, y0 + 1.03, sz * (th / 2 + 0.025)));
        b.geom('brass', new THREE.SphereGeometry(0.028, 12, 10), new THREE.Matrix4().makeScale(1, 1, 0.75).setPosition(W - 0.06, y0 + 1.03, sz * (th / 2 + 0.05)));
      }
      for (const y of [0.22, 1.05, 1.88]) b.geom('brass', new THREE.CylinderGeometry(0.011, 0.011, 0.1, 8), new THREE.Matrix4().setPosition(-0.004, y0 + y, 0));
    } else {
      // exit: thick boarded door with iron straps
      const n = 6, bw = W / n;
      for (let i = 0; i < n; i++) {
        const k = 0.82 + ((i * 37) % 10) * 0.03;
        b.box('wood', bw / 2 + i * bw, y0 + Hd / 2, 0, bw - 0.006, Hd, th, { grain: 1, chamfer: 0.006, color: [k * 1.3, k * 1.25, k * 1.2] });
      }
      for (const sz of [-1, 1]) {
        for (const y of [0.3, 1.08, 1.86]) {
          b.box('iron', W / 2 - 0.02, y0 + y, sz * (th / 2 + 0.005), W - 0.05, 0.085, 0.01, { chamfer: 0.004 });
          for (let i = 0; i < 6; i++) b.geom('iron', new THREE.SphereGeometry(0.014, 8, 6), new THREE.Matrix4().setPosition(0.08 + i * (W - 0.16) / 5, y0 + y, sz * (th / 2 + 0.012)));
        }
        b.box('iron', W - 0.11, y0 + 1.08, sz * (th / 2 + 0.014), 0.14, 0.22, 0.02, { chamfer: 0.006 });
        const ring = new THREE.TorusGeometry(0.06, 0.011, 8, 18);
        b.geom('iron', ring, new THREE.Matrix4().makeRotationX(0.25 * sz).setPosition(W - 0.11, y0 + 1.03, sz * (th / 2 + 0.04)));
      }
      // diagonal brace on the inside face
      b.box('wood', W / 2, y0 + 0.69, -(th / 2 + 0.012), 0.11, 1.05, 0.022, { rot: [0, 0, -0.78], grain: 1, chamfer: 0.006 });
      b.box('wood', W / 2, y0 + 1.47, -(th / 2 + 0.012), 0.11, 1.05, 0.022, { rot: [0, 0, 0.78], grain: 1, chamfer: 0.006 });
      for (const y of [0.3, 1.08, 1.86]) b.geom('iron', new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8), new THREE.Matrix4().setPosition(-0.006, y0 + y, 0));

      // cold daylight leaking around the closed door (fixed to the frame, hidden once it opens)
      const lb = new Batcher(this.game.mats);
      lb.box('leak', W / 2, 0.011, 0, W - 0.02, 0.006, 0.012);
      lb.box('leak', W + 0.008, y0 + Hd / 2, 0, 0.004, Hd - 0.06, 0.012);
      lb.box('leak', W / 2, y0 + Hd + 0.006, 0, W - 0.04, 0.004, 0.012);
      this.leak = lb.build('leak');
      this.leak.position.set(this.hx, 0, this.hz);
      this.leak.rotation.y = this.theta0;
      this.game.scene.add(this.leak);
    }
    this.mesh = b.build('door' + this.id);
    this.pivot.add(this.mesh);
  }

  _apply() {
    const a = Math.abs(this.s);
    this.phi = Math.sign(this.s) * this.maxAngle * Math.pow(a, this.ease);
    const th = this.theta0 + this.phi;
    this.pivot.rotation.y = th;
    const lx = Math.cos(th), lz = -Math.sin(th);
    this.lx = lx; this.lz = lz;
    this.tipX = this.hx + lx * this.W; this.tipZ = this.hz + lz * this.W;
    this.game.physics.setBox(this.collider, this.hx + lx * this.W / 2, this.Hd / 2, this.hz + lz * this.W / 2, th);
    if (this.leak) this.leak.visible = a < 0.015;
  }

  get frac() { return Math.abs(this.s); }
  get passable() { return Math.abs(this.s) >= CFG.door.passFrac - 1e-4; }
  get stateLabel() {
    const a = Math.abs(this.s);
    if (a < 0.004) return 'Closed';
    if (a >= 0.999) return 'Fully open';
    if (a >= CFG.door.passFrac) return 'Passable';
    return 'Partly open';
  }

  /** Which side of the wall a point is on: -1 = room a, +1 = room b. */
  sideOf(x, z) {
    return (x - this.cx) * this.nx + (z - this.cz) * this.nz >= 0 ? 1 : -1;
  }

  /** Can the hero push from here? Returns null or { dir, closing, dist, px, pz }. */
  pushInfo(x, z) {
    const q = pointSegDist2D(x, z, this.hx, this.hz, this.tipX, this.tipZ);
    if (q.d > CFG.door.reach) return null;
    // direction the leaf surface moves when s increases
    const th = this.theta0 + this.phi;
    const mx = -Math.sin(th), mz = -Math.cos(th);
    const side = (x - q.cx) * mx + (z - q.cz) * mz;
    if (Math.abs(side) < 0.05 && q.d < 0.05) return null;
    let dir = side < 0 ? 1 : -1;
    if (this.exit) {
      // the exit only swings outward
      const out = this._outSign();
      if (Math.abs(this.s) < 0.004 && dir !== out) return null;
    }
    const closing = Math.abs(this.s) > 0.004 && Math.sign(this.s) !== dir;
    if (!closing && Math.abs(this.s) >= 0.999) return null;
    // a comfortable standing point behind the leaf, about two thirds along it
    const k = 0.62;
    const px = this.hx + this.lx * this.W * k - mx * dir * 0.5;
    const pz = this.hz + this.lz * this.W * k - mz * dir * 0.5;
    return { dir, closing, dist: q.d, px, pz, fx: mx * dir, fz: mz * dir };
  }

  _outSign() {
    // sign of s that swings the leaf toward the outside (+x for the exit)
    const mx = -Math.sin(this.theta0);
    return mx * this.nx + (-Math.cos(this.theta0)) * this.nz > 0 ? 1 : -1;
  }

  /** Advance the push. Returns 'moving' | 'closed' | 'open'. */
  push(dt, dir) {
    const prev = this.s;
    let s = prev + (dir * dt) / this.tFull;
    let res = 'moving';
    if (prev !== 0 && Math.sign(s) !== Math.sign(prev)) { s = 0; res = 'closed'; }
    if (s >= 1) { s = 1; res = 'open'; }
    if (s <= -1) { s = -1; res = 'open'; }
    this.s = s;
    this.pushedThisFrame = true;
    this._apply();
    return res;
  }

  setProgress(s) {
    this.s = clamp(s, -1, 1);
    this._apply();
  }

  update(dt) {
    const target = this.pushedThisFrame ? 1 : 0;
    this.pushRate += (target - this.pushRate) * Math.min(1, dt * (target ? 6 : 10));
    this.pushedThisFrame = false;
  }
}
