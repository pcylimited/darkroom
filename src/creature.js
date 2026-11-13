// The shadow creature. One body, always at a real position on the navigation graph.
// States follow section 6 of the design: hidden, investigating, stalking, telegraphing,
// attacking, repelled, traversing and recovering.
import * as THREE from 'three';
import { CFG } from './config.js';
import { H } from './level.js';
import { clamp, damp, lerp, noise1, dampAngle } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3(), _bn = new THREE.Vector3();

class Tube {
  constructor(segs, rad, material) {
    this.segs = segs; this.rad = rad;
    const n = (segs + 1) * rad;
    this.pos = new Float32Array(n * 3); this.nor = new Float32Array(n * 3);
    const idx = [];
    for (let i = 0; i < segs; i++) for (let j = 0; j < rad; j++) {
      const a = i * rad + j, b = i * rad + ((j + 1) % rad), c = a + rad, d = b + rad;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.pts = Array.from({ length: segs + 1 }, () => new THREE.Vector3());
    this.radii = new Float32Array(segs + 1);
    this._nrm = new THREE.Vector3(0, 1, 0);
  }
  update() {
    const { pts, segs, rad, pos, nor } = this;
    _n.copy(this._nrm);
    for (let i = 0; i <= segs; i++) {
      if (i === 0) _t.subVectors(pts[1], pts[0]); else if (i === segs) _t.subVectors(pts[i], pts[i - 1]); else _t.subVectors(pts[i + 1], pts[i - 1]);
      if (_t.lengthSq() < 1e-10) _t.set(0, 1, 0);
      _t.normalize();
      _n.addScaledVector(_t, -_n.dot(_t));
      if (_n.lengthSq() < 1e-6) { _n.set(1, 0, 0).addScaledVector(_t, -_t.x); if (_n.lengthSq() < 1e-6) _n.set(0, 0, 1); }
      _n.normalize();
      _bn.crossVectors(_t, _n);
      const r = this.radii[i];
      for (let j = 0; j < rad; j++) {
        const a = (j / rad) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
        const k = (i * rad + j) * 3;
        const nx = _n.x * cs + _bn.x * sn, ny = _n.y * cs + _bn.y * sn, nz = _n.z * cs + _bn.z * sn;
        pos[k] = pts[i].x + nx * r; pos[k + 1] = pts[i].y + ny * r; pos[k + 2] = pts[i].z + nz * r;
        nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
}

const S = { HIDDEN: 'hidden', TRAVEL: 'traversing', ARRIVE: 'arriving', STALK: 'stalking', TELL: 'telegraphing', ATTACK: 'attacking', REPELLED: 'repelled', RECOVER: 'recovering' };

export class Creature {
  constructor(game) {
    this.game = game;
    this.S = S;
    const nav = game.nav;
    this.node = nav.attic.B;
    this.pos = new THREE.Vector3(this.node.x, this.node.y, this.node.z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.state = S.HIDDEN;
    this.stateT = 0;
    this.path = null; this.edge = null; this.edgeT = 0; this.edgeDur = 1;
    this.fleeing = false;
    this.goal = 'idle';
    this.hiddenUntil = Infinity;
    this.nextAttackAt = 0;
    this.exposure = 0; this.lastLit = -10; this.stage = 0;
    this.lastKnown = null;
    this.confined = true; // stays in the ceiling network until first contact
    this.arrivePause = CFG.creature.arrivalPause;
    this.tellDur = CFG.creature.tellMin;
    this.attackFrom = 'floor';
    this.sndT = 0; this.capT = 0; this.thinkT = 0; this.giveUpAt = 0; this.circle = 0;
    this.visible = false;
    this.rear = 0; this.flat = 0; this.lunge = 0; this.recoil = 0;
    this.heading = new THREE.Vector3(0, 0, 1);

    // ---- body
    this.group = new THREE.Group();
    const mat = this.mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.0035, 0.0035, 0.005), roughness: 0.36, metalness: 0.0, envMapIntensity: 0.0 });
    this.spine = new Tube(12, 10, mat);
    this.group.add(this.spine.mesh);
    this.limbs = [];
    for (let i = 0; i < 6; i++) {
      const t = new Tube(9, 6, mat);
      this.group.add(t.mesh);
      this.limbs.push({ tube: t, side: i % 2 ? 1 : -1, row: Math.floor(i / 2), foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), stepT: 1, init: false });
    }
    this.tendrils = [];
    for (let i = 0; i < 9; i++) {
      const t = new Tube(10, 5, mat);
      this.group.add(t.mesh);
      const chain = Array.from({ length: 11 }, () => new THREE.Vector3());
      this.tendrils.push({ tube: t, chain, seed: i * 7.31, len: 0.07 + (i % 3) * 0.025, init: false });
    }
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.eyes = [-1, 1].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), this.eyeMat); this.group.add(m); return m; });
    // smoke wisps
    this.smoke = [];
    const dark = new THREE.SpriteMaterial({ map: game.tex.smoke, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
    const pale = new THREE.SpriteMaterial({ map: game.tex.smoke, color: new THREE.Color(0.9, 0.85, 0.75), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 40; i++) {
      const sp = new THREE.Sprite((i % 5 === 4 ? pale : dark).clone());
      sp.visible = false; sp.renderOrder = 3;
      this.group.add(sp);
      this.smoke.push({ sp, life: 0, max: 1, vel: new THREE.Vector3(), pale: i % 5 === 4, size: 0.3 });
    }
    this.smokeT = 0;
    this.group.visible = false;
    game.scene.add(this.group);
    this.bodyPts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.spineCtl = Array.from({ length: 5 }, () => new THREE.Vector3());
  }

  get room() { return this.edge ? (this.edgeT / this.edgeDur > 0.5 ? this.edge.to.room : this.edge.from.room) : this.node.room; }
  get inAttic() { return this.pos.y > H + 0.2; }
  get onFloor() { return this.pos.y < 1.2; }

  // ------------------------------------------------------------------ control
  setState(s) { this.state = s; this.stateT = 0; }

  follow(path, flee = false) {
    if (!path || !path.length) { this.path = null; return false; }
    this.path = path.slice();
    this.fleeing = flee;
    if (!this.edge) {
      // free-roaming on the floor: walk to the first node rather than snapping onto it
      const f = this.path[0].from;
      const d = Math.hypot(f.x - this.pos.x, f.z - this.pos.z);
      if (d > 0.25 && this.pos.y < 1.2) {
        const pseudo = { x: this.pos.x, y: 0, z: this.pos.z, type: 'floor', room: f.room, edges: [] };
        this.path.unshift({ from: pseudo, to: f, kind: 'floor', dist: d });
      }
      this._nextEdge();
    }
    return true;
  }

  _nextEdge() {
    if (!this.path || !this.path.length) { this.edge = null; this.path = null; return false; }
    const e = this.path.shift();
    if (!this.game.nav.edgeOpen(e, this.fleeing)) { this.edge = null; this.path = null; return false; }
    this.edge = e; this.edgeT = 0;
    this.edgeDur = Math.max(0.05, this.game.nav.edgeTime(e, this.fleeing));
    return true;
  }

  /** Reset to a legal hiding node (checkpoint restore). */
  placeAt(node, hiddenFor) {
    this.node = node; this.edge = null; this.path = null;
    this.pos.set(node.x, this._nodeY(node), node.z);
    this.setState(S.HIDDEN);
    this.hiddenUntil = this.game.time + hiddenFor;
    this.exposure = 0; this.lastKnown = null;
    this.nextAttackAt = this.game.time + hiddenFor;
    for (const l of this.limbs) l.init = false;
    for (const t of this.tendrils) t.init = false;
  }

  _nodeY(n) {
    if (n.type === 'attic' || n.type === 'rim') return n.y;
    if (n.type === 'hide') return n.under ? 0.17 : 0.3;
    return 0.42;
  }

  hear(x, z, loud, room) {
    if (this.state === S.REPELLED || this.state === S.RECOVER || this.fleeing) return;
    const g = this.game;
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    let f = 1;
    if (room !== this.room) f = g.acoustic(room, this.room);
    if (d > loud * f) return;
    this.lastKnown = { x, z, room, t: g.time };
    if (this.state === S.HIDDEN && this.hiddenUntil !== Infinity) this.hiddenUntil = Math.min(this.hiddenUntil, g.time + 2.5 + Math.random() * 2);
  }

  /** Scripted first contact: come to this breach and hang there, exposed. */
  scriptArrive(breachId, pause) {
    const nav = this.game.nav;
    const target = nav.rim[breachId];
    const p = nav.path(this.edge ? this.edge.to : this.node, (n) => n === target, { ignoreLight: true });
    this.arrivePause = pause;
    this.goal = 'contact';
    this.confined = false;
    if (p) { this.follow(p); this.setState(S.TRAVEL); }
  }

  repel() {
    const g = this.game;
    this.setState(S.REPELLED);
    this.exposure = 0; this.stage = 0;
    this.nextAttackAt = g.time + CFG.creature.repelCooldown;
    this.recoil = 1;
    this.path = null;
    g.audio.play('hiss', this.pos, { room: this.room });
    g.ui.caption('recoiling hiss', this.pos, true);
    this._burst(16, true);
    g.player.stats.repels++;
    g.director.onRepel(this);
  }

  _fleeToHiding(minHide) {
    const g = this.game, nav = g.nav, heroRoom = g.player.room;
    const start = this.edge ? this.edge.to : this.node;
    // a reachable dark node away from the hero: another room's attic or hiding place
    const p = nav.path(start, (n) => {
      if (n === start) return false;
      if (n.type !== 'attic' && n.type !== 'hide') return false;
      if (g.lights.protectedAt(n.x, n.z)) return false;
      const dHero = Math.hypot(n.x - g.player.pos.x, n.z - g.player.pos.z);
      if (n.room === heroRoom && dHero < 5.5) return false;
      return (n.room === heroRoom ? 3 : 0) + (n.type === 'attic' ? 0 : 1.5) + Math.random() * 2.5;
    }, { flee: true, ignoreLight: true });
    this.hiddenUntil = g.time + minHide;
    this.goal = 'hide';
    if (p) { this.follow(p, true); this.setState(S.TRAVEL); }
    else { this.setState(S.RECOVER); }
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game, time = g.time, pl = g.player, nav = g.nav, C = CFG.creature;
    this.stateT += dt;
    const hx = pl.pos.x, hz = pl.pos.z;
    const dHero = Math.hypot(hx - this.pos.x, hz - this.pos.z);
    const heroSafe = !!pl.protectedBy || pl.escaped || pl.dead;
    const prevPos = _c.copy(this.pos);

    // senses: line of sight from any exposed position
    if (!this.inAttic && dHero < 16 && g.physics.los(this.pos.x, this.pos.y + 0.2, this.pos.z, hx, 1.2, hz)) {
      this.lastKnown = { x: hx, z: hz, room: pl.room, t: time };
      this.seesHero = true;
    } else this.seesHero = false;

    // ---- movement along the current edge
    let arrived = false;
    if (this.edge) {
      const e = this.edge;
      if (!nav.edgeOpen(e, true) && this.edgeT / this.edgeDur < 0.2) { this.edge = null; this.path = null; }
      else {
        this.edgeT += dt;
        const k = clamp(this.edgeT / this.edgeDur, 0, 1);
        const ya = this._nodeY(e.from), yb = this._nodeY(e.to);
        const s = e.kind === 'floor' || e.kind === 'door' || e.kind === 'attic' ? k : k * k * (3 - 2 * k);
        this.pos.set(lerp(e.from.x, e.to.x, s), lerp(ya, yb, e.kind === 'climb' ? Math.pow(k, e.from.type === 'rim' ? 1.6 : 0.6) : s), lerp(e.from.z, e.to.z, s));
        if (k >= 1) { this.node = e.to; arrived = true; if (!this._nextEdge()) { this.edge = null; } }
      }
    }
    const still = !this.edge;

    switch (this.state) {
      case S.HIDDEN: {
        if (pl.escaped || pl.dead) break;
        if (time >= this.hiddenUntil && !this.confined && g.director.creatureMayHunt()) this._plan();
        break;
      }
      case S.TRAVEL: {
        if (arrived && this.node.type === 'rim' && this.edge && this.edge.kind === 'climb' && !this.fleeing) {
          // just emerged at a breach on the way down: stop and hang there, exposed
          this.path = [this.edge, ...(this.path || [])]; this.edge = null;
          this.setState(S.ARRIVE);
          g.audio.play('emerge', this.pos, { room: this.room });
          g.ui.caption('something drags itself through the ceiling', this.pos, true);
          g.director.onArrive(this);
          break;
        }
        if (arrived && this.node.type === 'rim' && still && !this.fleeing) {
          this.setState(S.ARRIVE);
          g.audio.play('emerge', this.pos, { room: this.room });
          g.ui.caption('something drags itself through the ceiling', this.pos, true);
          g.director.onArrive(this);
          break;
        }
        if (still) {
          if (this.goal === 'hide' || this.fleeing) { this.fleeing = false; this.setState(S.HIDDEN); }
          else if (this.goal === 'investigate') { this.setState(S.HIDDEN); this.hiddenUntil = time + 3 + Math.random() * 4; }
          else { this.setState(S.STALK); this.giveUpAt = time + 16; }
        } else if (this.onFloor && !this.fleeing && this.node.room === pl.room && this.seesHero && this.goal === 'stalk' && this.node.type === 'floor' && arrived) {
          this.path = null; this.edge = null;
          this.setState(S.STALK); this.giveUpAt = time + 16;
        }
        break;
      }
      case S.ARRIVE: {
        // hang at the rim. If the hero stands within reach beneath, strike from here.
        const rimD = Math.hypot(hx - this.node.x, hz - this.node.z);
        if (this.stateT > Math.min(1.2, this.arrivePause) && rimD < C.rimReach && !heroSafe && time >= this.nextAttackAt && time >= pl.invulnUntil && g.director.creatureMayAttack()) {
          this.attackFrom = 'rim'; this._tell();
        } else if (this.stateT >= this.arrivePause) {
          this.arrivePause = C.arrivalPause + Math.random() * 0.8;
          if (heroSafe && pl.room === this.node.room && Math.random() < 0.5) { this._retreatUp(5 + Math.random() * 4); break; }
          this.goal = 'stalk';
          if (this.path && this.path.length) { this._nextEdge(); this.setState(S.TRAVEL); }
          else {
            const p = nav.path(this.node, (n) => n === nav.drop[this.node.breach.id]);
            if (p) { this.follow(p); this.setState(S.TRAVEL); } else this._retreatUp(4);
          }
        }
        break;
      }
      case S.STALK: {
        this.thinkT -= dt;
        if (pl.escaped || pl.dead) { this._fleeToHiding(6); break; }
        if (pl.room !== this.room && this.thinkT <= 0) {
          // follow through a doorway or go back up and around
          this.thinkT = 0.6;
          if (!this._planTo(pl.room)) { this._fleeToHiding(4); }
          break;
        }
        let tx = hx, tz = hz, hold = false;
        if (heroSafe && pl.protectedBy) {
          // circle the edge of the light looking for a way in
          const f = pl.protectedBy;
          this.circle += dt * 0.35;
          const cx = f.px ?? (f.spec.rect[0] + f.spec.rect[1]) / 2, cz = f.pz ?? (f.spec.rect[2] + f.spec.rect[3]) / 2;
          const r = (f.pr ?? 1.6) + 1.1;
          const base = Math.atan2(this.pos.z - cz, this.pos.x - cx);
          tx = cx + Math.cos(base + 0.5) * r; tz = cz + Math.sin(base + 0.5) * r;
          hold = true;
          if (time > this.giveUpAt - 8) { this._fleeToHiding(5 + Math.random() * 5); break; }
        }
        const dx = tx - this.pos.x, dz = tz - this.pos.z, dl = Math.hypot(dx, dz);
        const want = hold ? 0.3 : C.reach * 0.8;
        if (dl > want) {
          const sp = C.stalkSpeed * (hold ? 0.55 : 1);
          const nx = this.pos.x + (dx / dl) * sp * dt, nz = this.pos.z + (dz / dl) * sp * dt;
          const blockedL = g.lights.protectedAt(nx, nz, 0.45);
          const clear = g.physics.segmentClear(this.pos.x, this.pos.z, nx + (dx / dl) * 0.3, nz + (dz / dl) * 0.3, C.radius * 0.8, 0.5);
          if (!blockedL && clear) { this.pos.x = nx; this.pos.z = nz; this.stuckT = 0; }
          else {
            // slide around: try the two tangents
            let moved = false;
            for (const sgn of [1, -1]) {
              const sx = this.pos.x + (-dz / dl) * sgn * sp * dt, sz = this.pos.z + (dx / dl) * sgn * sp * dt;
              if (!g.lights.protectedAt(sx, sz, 0.45) && g.physics.segmentClear(this.pos.x, this.pos.z, sx + (-dz / dl) * sgn * 0.3, sz + (dx / dl) * sgn * 0.3, C.radius * 0.8, 0.5)) { this.pos.x = sx; this.pos.z = sz; moved = true; break; }
            }
            this.stuckT = (this.stuckT || 0) + dt;
            if (!moved || this.stuckT > 2.5) {
              // route through the waypoint graph instead
              const near = nav.nearest(this.pos.x, this.pos.z, (n) => n.room === this.room && n.type === 'floor');
              const goalN = nav.nearest(hx, hz, (n) => n.room === pl.room && n.type === 'floor' && !g.lights.protectedAt(n.x, n.z));
              if (near && goalN && near !== goalN) {
                this.node = near;
                const p = nav.path(near, (n) => n === goalN);
                if (p) { this.goal = 'stalk'; this.follow(p); this.setState(S.TRAVEL); this.stuckT = 0; break; }
              }
              if (this.stuckT > 4) { this._fleeToHiding(4); break; }
            }
          }
          this.pos.y = damp(this.pos.y, 0.42, 8, dt);
          this.node = nav.nearest(this.pos.x, this.pos.z, (n) => n.room === this.room && n.type === 'floor') || this.node;
        }
        if (!heroSafe && dHero < C.reach + 0.25 && this.seesHero && time >= this.nextAttackAt && time >= pl.invulnUntil && g.director.creatureMayAttack()) {
          this.attackFrom = 'floor'; this._tell();
        } else if (time > this.giveUpAt && !this.seesHero) this._fleeToHiding(5 + Math.random() * 6);
        break;
      }
      case S.TELL: {
        const reach = this.attackFrom === 'rim' ? C.rimReach : C.reach;
        const d = this.attackFrom === 'rim' ? Math.hypot(hx - this.node.x, hz - this.node.z) : dHero;
        if (heroSafe) { this.nextAttackAt = time + 1.5; this.setState(this.attackFrom === 'rim' ? S.ARRIVE : S.STALK); this.giveUpAt = time + 14; break; }
        if (d > reach * 1.75) { this.nextAttackAt = time + 0.8; this.setState(this.attackFrom === 'rim' ? S.ARRIVE : S.STALK); this.giveUpAt = time + 14; break; }
        if (this.stateT >= this.tellDur) { this.setState(S.ATTACK); this.struck = false; g.audio.play('strike', this.pos, { room: this.room }); }
        break;
      }
      case S.ATTACK: {
        if (!this.struck && this.stateT >= 0.16) {
          this.struck = true;
          const reach = (this.attackFrom === 'rim' ? C.rimReach : C.reach) + 0.55;
          const d = this.attackFrom === 'rim' ? Math.hypot(hx - this.node.x, hz - this.node.z) : dHero;
          // one strike, through clear space only, never into a protected volume
          const clear = g.physics.los(this.pos.x, this.pos.y + 0.2, this.pos.z, hx, 1.1, hz);
          if (d <= reach && clear && !g.lights.protectedAt(hx, hz) && !pl.escaped) {
            this.didHit = pl.takeHit(this.pos.x, this.pos.z);
          } else this.didHit = false;
        }
        if (this.stateT >= 0.5) {
          if (this.didHit) { this.nextAttackAt = time + C.hitRecovery + 1.5; this._fleeToHiding(C.hitRecovery + 2 + Math.random() * 3); g.director.onHit(); }
          else { this.nextAttackAt = time + 2.2; this.setState(S.RECOVER); }
        }
        break;
      }
      case S.REPELLED: {
        if (this.stateT >= 0.55) this._fleeToHiding(g.director.hideTime());
        break;
      }
      case S.RECOVER: {
        if (this.stateT >= 1.6) {
          if (this.attackFrom === 'rim' && this.node.type === 'rim') { this.setState(S.ARRIVE); this.arrivePause = 1.2; }
          else if (this.onFloor) { this.setState(S.STALK); this.giveUpAt = time + 12; }
          else this._fleeToHiding(4);
        }
        break;
      }
    }

    // ---- torch exposure (design section 3)
    this._exposure(dt);

    // ---- velocity, heading, sounds
    this.vel.subVectors(this.pos, prevPos).multiplyScalar(1 / Math.max(dt, 1e-4));
    const sp2 = Math.hypot(this.vel.x, this.vel.z);
    let wantYaw = this.yaw;
    if (this.state === S.ARRIVE || this.state === S.TELL || this.state === S.ATTACK || this.state === S.STALK) wantYaw = Math.atan2(hx - this.pos.x, hz - this.pos.z);
    else if (sp2 > 0.2) wantYaw = Math.atan2(this.vel.x, this.vel.z);
    this.yaw = dampAngle(this.yaw, wantYaw, 7, dt);
    this._sounds(dt, sp2);
    this._visual(dt, time, sp2);
  }

  _plan() {
    const g = this.game, time = g.time, pl = g.player;
    const lk = this.lastKnown && time - this.lastKnown.t < 45 ? this.lastKnown : null;
    if (lk) {
      this.goal = 'stalk';
      if (this._planTo(lk.room)) return;
    }
    // nothing sensed: drift through the ceiling toward where it last heard anything, or simply roam
    const start = this.node;
    const opts = start.edges.filter((e) => e.kind === 'attic' || (start.type !== 'attic' && g.nav.edgeOpen(e, false)));
    if (start.type !== 'attic') {
      const p = g.nav.path(start, (n) => n.type === 'attic', { ignoreLight: true });
      if (p) { this.goal = 'investigate'; this.follow(p); this.setState(S.TRAVEL); return; }
    }
    if (opts.length) {
      // bias toward the hero's side of the house so pressure never disappears for long
      opts.sort((a, b) => Math.hypot(a.to.x - pl.pos.x, a.to.z - pl.pos.z) - Math.hypot(b.to.x - pl.pos.x, b.to.z - pl.pos.z));
      const e = opts[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * opts.length)];
      this.goal = 'investigate';
      this.follow([e]); this.setState(S.TRAVEL);
      if (e.to.room === pl.room) this.lastKnown = { x: pl.pos.x, z: pl.pos.z, room: pl.room, t: time - 20 };
    } else this.hiddenUntil = time + 3;
  }

  /** Route to a room: prefer whichever legal approach is quickest (door on the floor, or a breach). */
  _planTo(room) {
    const g = this.game, nav = g.nav;
    if (room === 'A' || room === 'OUT') {
      // the entry has no breach: only an opened door lets it in, and the lamp there keeps it at bay
      this.hiddenUntil = g.time + 4;
      return false;
    }
    const start = this.edge ? this.edge.to : this.node;
    if (start.room === room && (start.type === 'floor' || start.type === 'hide')) {
      this.goal = 'stalk';
      if (start.type === 'hide') { const p = nav.path(start, (n) => n.type === 'floor' && n.room === room); if (p) { this.follow(p); this.setState(S.TRAVEL); return true; } }
      this.setState(S.STALK); this.giveUpAt = g.time + 16; return true;
    }
    const p = nav.path(start, (n) => {
      if (n.room !== room) return false;
      if (n.type === 'floor' && !n.breach && !n.door) return 0;
      if (n.type === 'floor') return 0.5;
      return false;
    });
    if (!p) return false;
    this.goal = 'stalk';
    this.follow(p); this.setState(S.TRAVEL);
    return true;
  }

  _retreatUp(hideFor) {
    const nav = this.game.nav;
    const p = nav.path(this.node, (n) => n.type === 'attic', { ignoreLight: true, flee: true });
    this.hiddenUntil = this.game.time + hideFor;
    this.goal = 'hide';
    if (p) { this.follow(p, true); this.setState(S.TRAVEL); } else this.setState(S.HIDDEN);
  }

  _tell() {
    const g = this.game;
    this.setState(S.TELL);
    this.tellDur = CFG.creature.tellMin + Math.random() * 0.35;
    this.path = null; this.edge = null;
    g.audio.play('tell', this.pos, { room: this.room });
    g.ui.caption('sharp unfolding crack', this.pos, true);
    g.director.onTell();
  }

  _exposure(dt) {
    const g = this.game, pl = g.player, T = CFG.torch, time = g.time;
    const exposable = this.visible && this.state !== S.REPELLED && !this.fleeing && this.state !== S.RECOVER;
    let lit = 0;
    if (exposable && pl.focusing && pl.torchOn && pl.focus > 0.6) {
      const tp = pl.hero.torchPos, td = pl.hero.torchDir;
      const cosHalf = Math.cos(T.focusAngle / 2);
      for (const p of this.bodyPts) {
        _a.subVectors(p, tp);
        const d = _a.length();
        if (d > T.range || d < 0.05) continue;
        if (_a.dot(td) / d < cosHalf) continue;
        if (!g.physics.los(tp.x, tp.y, tp.z, p.x, p.y, p.z)) continue;
        lit++;
      }
    }
    this.litNow = lit > 0;
    if (lit > 0) {
      this.exposure += dt * (0.75 + 0.25 * Math.min(1, lit / 3));
      this.lastLit = time;
      if (Math.random() < dt * 14) this._burst(1, true);
    } else if (time - this.lastLit > T.decayDelay) {
      this.exposure = Math.max(0, this.exposure - dt * (T.exposeTime / T.decayTime));
    }
    const st = Math.min(3, Math.floor((this.exposure / T.exposeTime) * 3));
    if (st > this.stage && st < 3) g.audio.play('sizzle', this.pos, { room: this.room, gain: 0.5 + st * 0.2 });
    this.stage = st;
    if (this.exposure >= T.exposeTime && exposable) this.repel();
  }

  _sounds(dt, speed) {
    const g = this.game;
    this.sndT -= dt; this.capT -= dt;
    if (this.sndT > 0) return;
    const room = this.room;
    if (this.edge && (this.edge.kind === 'attic' || this.inAttic)) {
      g.audio.play('scratch', this.pos, { room, attic: true, gain: this.fleeing ? 1 : 0.8 });
      this.sndT = this.fleeing ? 0.16 + Math.random() * 0.12 : 0.3 + Math.random() * 0.3;
      if (this.capT <= 0) { g.ui.caption(this.fleeing ? 'scratching retreats overhead' : 'slow scratching overhead', this.pos); this.capT = 3.5; }
    } else if (this.edge && (this.edge.kind === 'emerge' || this.edge.kind === 'climb')) {
      g.audio.play('scratch', this.pos, { room, gain: 0.9 });
      this.sndT = 0.2 + Math.random() * 0.15;
    } else if (speed > 0.4 && this.onFloor) {
      g.audio.play('skitter', this.pos, { room, gain: this.fleeing ? 1 : 0.7 });
      this.sndT = this.fleeing ? 0.09 : 0.2 + Math.random() * 0.1;
      if (this.capT <= 0) { g.ui.caption('claws on the floor', this.pos); this.capT = 4; }
    } else if (this.state === S.HIDDEN && !this.inAttic) {
      g.audio.play('breath', this.pos, { room });
      this.sndT = 3.5 + Math.random() * 3.5;
      if (this.capT <= 0) { g.ui.caption('low breathing', this.pos); this.capT = 9; }
    } else if (this.state === S.ARRIVE || this.state === S.STALK) {
      g.audio.play('breath', this.pos, { room, gain: 1.2 });
      this.sndT = 2.2 + Math.random() * 1.5;
    } else if (this.state === S.HIDDEN && this.inAttic && !this.confined) {
      if (Math.random() < 0.35) g.audio.play('scratch', this.pos, { room, attic: true, gain: 0.35 });
      this.sndT = 2.5 + Math.random() * 4;
    } else this.sndT = 0.3;
  }

  _burst(n, pale) {
    for (let i = 0; i < n; i++) this._spawnSmoke(pale && i % 2 === 0, 1.6);
  }

  _spawnSmoke(pale, speed = 1) {
    const s = this.smoke.find((q) => q.life <= 0 && q.pale === !!pale);
    if (!s) return;
    const p = this.bodyPts[Math.floor(Math.random() * this.bodyPts.length)];
    s.sp.position.set(p.x + (Math.random() - 0.5) * 0.3, p.y + (Math.random() - 0.5) * 0.25, p.z + (Math.random() - 0.5) * 0.3);
    s.vel.set((Math.random() - 0.5) * 0.4 * speed, (0.15 + Math.random() * 0.3) * speed * (this.pos.y > 2 ? -0.4 : 1), (Math.random() - 0.5) * 0.4 * speed);
    s.max = s.life = (pale ? 0.45 : 1.1) + Math.random() * 0.6;
    s.size = (pale ? 0.16 : 0.34) + Math.random() * 0.3;
    s.sp.material.rotation = Math.random() * 6.28;
    s.sp.visible = true;
  }

  // ------------------------------------------------------------------ visuals
  _visual(dt, time, speed) {
    const g = this.game, pl = g.player;
    const attic = this.pos.y > H + 0.45;
    this.visible = !attic;
    this.group.visible = this.visible || this.smoke.some((s) => s.life > 0);
    const st = this.state;
    // posture blends
    this.rear = damp(this.rear, st === S.TELL ? 1 : st === S.ATTACK ? 0.5 : 0, st === S.TELL ? 5 : 12, dt);
    this.lunge = damp(this.lunge, st === S.ATTACK && this.stateT < 0.26 ? 1 : 0, 26, dt);
    this.recoil = damp(this.recoil, st === S.REPELLED ? 1 : 0, st === S.REPELLED ? 20 : 5, dt);
    const hiding = st === S.HIDDEN && this.node.type === 'hide' && !this.edge;
    this.flat = damp(this.flat, hiding ? 1 : 0, 5, dt);
    const shy = clamp(this.stage / 3 + (this.litNow ? 0.25 : 0), 0, 1); // shields, twists away under the beam
    const hang = clamp((this.pos.y - 1.6) / 1.4, 0, 1); // 1 when up at a breach

    const fwd = _a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.heading.copy(fwd);
    const side = _b.set(fwd.z, 0, -fwd.x);
    const P = this.pos;
    const jit = this.recoil * 0.08 + shy * 0.035;
    const jx = noise1(time * 31) * jit, jy = noise1(time * 37 + 3) * jit, jz = noise1(time * 29 + 7) * jit;
    const breathe = Math.sin(time * 2.1) * 0.02;
    // spine control points (tail → head). Hanging from a breach, the body dangles head-down.
    const len = lerp(0.95, 1.25, this.rear) * (1 - this.recoil * 0.25);
    for (let i = 0; i < 5; i++) {
      const k = i / 4; // 0 tail, 1 head
      const along = (k - 0.45) * len;
      const sway = Math.sin(time * 2.6 - i * 0.9) * 0.05 * (1 + speed * 0.3);
      const c = this.spineCtl[i];
      c.copy(P).addScaledVector(fwd, along * (1 - hang * 0.75) + this.lunge * k * 0.9 - this.recoil * k * 0.35 - shy * k * 0.18)
        .addScaledVector(side, sway + shy * Math.sin(k * 3.0) * 0.14);
      const arch = Math.sin(k * Math.PI) * (0.1 + breathe) * (1 - this.flat * 0.9);
      const rearUp = this.rear * k * k * 0.85;
      const dangle = hang * (0.25 - k * 0.75);
      c.y += arch + rearUp + dangle - this.flat * 0.05 + jy * k;
      c.x += jx * k; c.z += jz * k;
      if (c.y < 0.09) c.y = 0.09;
    }
    // resample to the tube
    const sp = this.spine;
    const R = [0.03, 0.13, 0.21, 0.25, 0.22, 0.17, 0.135, 0.12, 0.13, 0.15, 0.14, 0.095, 0.02];
    for (let i = 0; i <= sp.segs; i++) {
      const u = (i / sp.segs) * 4;
      const i1 = Math.min(3, Math.floor(u)), f = u - i1;
      const p0 = this.spineCtl[Math.max(0, i1 - 1)], p1 = this.spineCtl[i1], p2 = this.spineCtl[i1 + 1], p3 = this.spineCtl[Math.min(4, i1 + 2)];
      const f2 = f * f, f3 = f2 * f;
      sp.pts[i].set(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * f + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3),
        0.5 * (2 * p1.z + (-p0.z + p2.z) * f + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * f2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * f3),
      );
      sp.radii[i] = R[i] * (1 - this.flat * 0.35) * (1 + breathe * 2) * (1 - this.recoil * 0.2);
    }
    sp.update();
    const head = sp.pts[sp.segs - 1], neck = sp.pts[sp.segs - 3];
    this.bodyPts[0].copy(head); this.bodyPts[1].copy(sp.pts[6]); this.bodyPts[2].copy(sp.pts[2]);

    // eyes
    _t.subVectors(head, neck).normalize();
    const eg = st === S.TELL ? 3.5 + Math.sin(time * 40) * 1.2 : st === S.ATTACK ? 4 : this.litNow ? 0.25 : 0.9 * (1 - this.recoil);
    this.eyeMat.color.setRGB(0.75 * eg, 0.85 * eg, 1.0 * eg);
    this.eyes.forEach((e, i) => {
      e.position.copy(head).addScaledVector(_t, 0.07).addScaledVector(side, (i ? 1 : -1) * 0.055);
      e.position.y += 0.035;
    });

    // limbs: procedural stepping gait toward anchors on the supporting surface
    const breach = this.node.breach || (this.edge && (this.edge.from.breach || this.edge.to.breach));
    this.limbs.forEach((l, i) => {
      const k = [0.72, 0.5, 0.26][l.row];
      const sIdx = Math.round(k * sp.segs);
      const sh = sp.pts[sIdx];
      // where this foot wants to be
      const reach = lerp(0.78, 0.42, this.flat) * (l.row === 1 ? 1.1 : 1);
      const ahead = (l.row === 0 ? 0.55 : l.row === 1 ? 0.05 : -0.5);
      const rest = _c.copy(P).addScaledVector(side, l.side * reach).addScaledVector(fwd, ahead + this.vel.dot(fwd) * 0.12);
      rest.x += this.vel.x * 0.1; rest.z += this.vel.z * 0.1;
      let ry = 0;
      if (hang > 0.5 && breach) {
        // grip the broken rim
        const poly = breach.poly;
        let best = poly[0], bd = 1e9;
        const ang = this.yaw + (i / 6) * Math.PI * 2;
        const wx = breach.x + Math.sin(ang) * 2, wz = breach.z + Math.cos(ang) * 2;
        for (const q of poly) { const d = Math.hypot(q[0] - wx, q[1] - wz); if (d < bd) { bd = d; best = q; } }
        rest.set(best[0], 0, best[1]); ry = H + 0.02;
      }
      if (!l.init) { l.foot.set(rest.x, ry, rest.z); l.from.copy(l.foot); l.to.copy(l.foot); l.stepT = 1; l.init = true; }
      const far = Math.hypot(l.to.x - rest.x, l.to.z - rest.z) + Math.abs(l.to.y - ry) * 0.5;
      const other = this.limbs[i ^ 1];
      if (l.stepT >= 1 && far > (hang > 0.5 ? 0.3 : 0.42) && other.stepT >= 0.6) {
        l.from.copy(l.foot); l.to.set(rest.x, ry, rest.z); l.stepT = 0;
      }
      if (l.stepT < 1) {
        l.stepT = Math.min(1, l.stepT + dt * (5.5 + speed * 2.2));
        const e = l.stepT;
        l.foot.lerpVectors(l.from, l.to, e * e * (3 - 2 * e));
        l.foot.y += Math.sin(e * Math.PI) * 0.22 * (ry > 1 ? -1 : 1);
      }
      const tip = _t.copy(l.foot);
      // front limbs: raised for the tell, thrown forward in the strike, pulled in when shielding
      if (l.row === 0) {
        if (this.rear > 0.02) {
          tip.lerp(_n.copy(head).addScaledVector(side, l.side * 0.9).addScaledVector(fwd, 0.15).setY(head.y + 0.75), this.rear * (1 - this.lunge));
        }
        if (this.lunge > 0.02) {
          const ty = this.attackFrom === 'rim' ? 1.3 : 1.15;
          tip.lerp(_n.set(pl.pos.x, ty, pl.pos.z).addScaledVector(side, l.side * 0.12), this.lunge);
        }
        if (shy > 0.02) tip.lerp(_n.copy(head).addScaledVector(fwd, 0.25).addScaledVector(side, l.side * 0.12), shy * 0.8);
      }
      // two-bone chain with the elbow thrown outward and up (down when hanging)
      const d = _n.subVectors(tip, sh);
      const L = d.length();
      const la = 0.62, lb = 0.72;
      const Lc = clamp(L, 0.15, la + lb - 0.01);
      const cosA = clamp((la * la + Lc * Lc - lb * lb) / (2 * la * Lc), -1, 1);
      d.multiplyScalar(1 / Math.max(L, 1e-4));
      const pole = _bn.copy(side).multiplyScalar(l.side * 0.6);
      pole.y += hang > 0.5 ? -0.2 : 1.0;
      pole.addScaledVector(d, -pole.dot(d)).normalize();
      const elbow = _c.copy(sh).addScaledVector(d, la * cosA).addScaledVector(pole, la * Math.sqrt(1 - cosA * cosA));
      const end = tip.copy(sh).addScaledVector(d, Lc);
      const tb = l.tube;
      for (let j = 0; j <= tb.segs; j++) {
        const u = j / tb.segs;
        // quadratic bezier that passes near the elbow
        const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c2 = u * u;
        tb.pts[j].set(sh.x * a + (elbow.x * 2 - (sh.x + end.x) / 2) * b + end.x * c2, sh.y * a + (elbow.y * 2 - (sh.y + end.y) / 2) * b + end.y * c2, sh.z * a + (elbow.z * 2 - (sh.z + end.z) / 2) * b + end.z * c2);
        tb.radii[j] = lerp(0.062, 0.006, Math.pow(u, 0.8)) * (1 + 0.5 * Math.exp(-Math.pow((u - 0.5) * 7, 2)));
      }
      tb.update();
      if (i < 2) this.bodyPts[3 + i].copy(elbow);
    });

    // tendrils: trailing chains with follow-through
    this.tendrils.forEach((t, i) => {
      const sIdx = 1 + (i % 6);
      const root = sp.pts[sIdx];
      const ch = t.chain;
      const a0 = (i / this.tendrils.length) * Math.PI * 2;
      if (!t.init) { for (const c of ch) c.copy(root); t.init = true; }
      ch[0].copy(root);
      for (let j = 1; j < ch.length; j++) {
        const w = time * (1.3 + (i % 4) * 0.35) + t.seed + j * 0.55;
        // each link drifts toward a swaying target and then keeps its distance from the previous one
        const tgt = _n.copy(ch[j - 1]);
        tgt.x += Math.cos(a0 + Math.sin(w) * 0.9) * t.len * 0.8 - this.vel.x * 0.02;
        tgt.z += Math.sin(a0 + Math.cos(w * 0.8) * 0.9) * t.len * 0.8 - this.vel.z * 0.02;
        tgt.y += (hang > 0.5 ? -1 : 0.55 + Math.sin(w * 1.3) * 0.5) * t.len * (1 - this.flat * 0.8) + this.recoil * 0.05;
        ch[j].lerp(tgt, 1 - Math.exp(-(9 - j * 0.5) * dt));
        _bn.subVectors(ch[j], ch[j - 1]);
        const dl = _bn.length() || 1e-4;
        ch[j].copy(ch[j - 1]).addScaledVector(_bn, t.len / dl);
        if (ch[j].y < 0.03) ch[j].y = 0.03;
      }
      const tb = t.tube;
      for (let j = 0; j <= tb.segs; j++) { tb.pts[j].copy(ch[j]); tb.radii[j] = lerp(0.034, 0.003, j / tb.segs); }
      tb.update();
    });

    // smoke
    this.smokeT -= dt;
    if (this.visible && this.smokeT <= 0) { this._spawnSmoke(false); this.smokeT = 0.07 + Math.random() * 0.06; }
    for (const s of this.smoke) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.sp.visible = false; continue; }
      const k = s.life / s.max;
      s.sp.position.addScaledVector(s.vel, dt);
      const sc = s.size * (1.6 - k * 0.8);
      s.sp.scale.set(sc, sc, 1);
      s.sp.material.opacity = (s.pale ? 0.5 : 0.42) * Math.sin(k * Math.PI);
    }
    for (const m of [this.spine.mesh, ...this.limbs.map((l) => l.tube.mesh), ...this.tendrils.map((t) => t.tube.mesh), ...this.eyes]) m.visible = this.visible;
  }
}
