// Room fixtures, their authored protection volumes, wall switches and the failure cycle
// (working → warning → failed → resetting → working). Real shadow-casting lights are pooled:
// only the fixtures nearest the hero own one, so the shader light count stays constant.
import * as THREE from 'three';
import { Batcher } from './batch.js';
import { CFG } from './config.js';
import { H } from './level.js';
import { clamp, damp, noise1 } from './util.js';

const WARM = new THREE.Color(1.0, 0.66, 0.36);
const POOL = 4;

class Fixture {
  constructor(game, spec) {
    this.game = game;
    this.spec = spec;
    this.id = spec.id;
    this.room = spec.room;
    this.dependable = !!spec.dependable;
    this.state = spec.startFailed ? 'failed' : 'working';
    this.level = spec.startFailed ? 0 : 1; // visual brightness 0..1
    this.timer = 0;
    this.stableUntil = 0;
    this.failAt = Infinity; // scheduled by the director
    this.resetProgress = 0;
    this.everReset = false;
    this.flickerSeed = Math.random() * 100;

    this.group = new THREE.Group();
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0x25221c, emissive: WARM.clone(), emissiveIntensity: 0, roughness: 0.6, side: THREE.DoubleSide });
    const b = new Batcher(game.mats);

    if (spec.kind === 'pendant') {
      this.lightPos = new THREE.Vector3(spec.x, spec.y, spec.z);
      this.target = new THREE.Vector3(spec.x, 0, spec.z);
      this.angle = Math.min(1.25, Math.atan(spec.r / spec.y) + 0.05);
      this.penumbra = 0.22;
      this.px = spec.x; this.pz = spec.z; this.pr = spec.r;
      // rose, flex, enamel shade
      b.geom('brass', new THREE.CylinderGeometry(0.07, 0.085, 0.035, 16), new THREE.Matrix4().setPosition(spec.x, H - 0.018, spec.z));
      b.geom('fabricDark', new THREE.CylinderGeometry(0.006, 0.006, H - spec.y - 0.2, 6), new THREE.Matrix4().setPosition(spec.x, (H + spec.y + 0.2) / 2, spec.z));
      b.geom('brass', new THREE.CylinderGeometry(0.022, 0.03, 0.09, 10), new THREE.Matrix4().setPosition(spec.x, spec.y + 0.16, spec.z));
      const prof = [[0.03, 0.2], [0.045, 0.165], [0.12, 0.1], [0.215, 0.03], [0.235, 0.012]].map(([x, y]) => new THREE.Vector2(x, y));
      b.geom('enamel', new THREE.LatheGeometry(prof, 28), new THREE.Matrix4().setPosition(spec.x, spec.y - 0.02, spec.z));
      const inner = new THREE.Mesh(new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p.x * 0.97, p.y - 0.004)), 28), this.glowMat);
      inner.position.set(spec.x, spec.y - 0.02, spec.z);
      this.group.add(inner);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 10), this.bulbMat);
      bulb.position.set(spec.x, spec.y + 0.045, spec.z);
      bulb.scale.set(1, 1.3, 1);
      this.group.add(bulb);
    } else {
      // wall sconce: back plate, swan neck, caged bulb
      const nx = spec.nx, nz = spec.nz;
      const bx = spec.x + nx * 0.2, bz = spec.z + nz * 0.2;
      this.lightPos = new THREE.Vector3(bx, spec.y - 0.02, bz);
      if (spec.rect) {
        const [x0, x1, z0, z1] = spec.rect;
        this.target = new THREE.Vector3((x0 + x1) / 2 + nx * 0.25, 0, (z0 + z1) / 2 + nz * 0.25);
        this.angle = 1.02;
      } else {
        this.target = new THREE.Vector3(spec.cx, 0, spec.cz);
        this.angle = 0.72;
        this.px = spec.cx; this.pz = spec.cz; this.pr = spec.r;
      }
      this.penumbra = 0.3;
      const yaw = Math.atan2(nx, nz);
      const M = (x, y, z, rx = 0) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, yaw, 0, 'YXZ')).setPosition(spec.x + nx * z + nz * x, spec.y + y, spec.z + nz * z - nx * x);
      b.geom('brass', new THREE.CylinderGeometry(0.06, 0.06, 0.02, 14), M(0, 0.06, 0.012, Math.PI / 2));
      b.geom('brass', new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), M(0, 0.06, 0.1, Math.PI / 2));
      b.geom('brass', new THREE.CylinderGeometry(0.035, 0.028, 0.06, 10), M(0, 0.03, 0.2));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.geom('iron', new THREE.CylinderGeometry(0.004, 0.004, 0.17, 5), M(Math.cos(a) * 0.055, -0.08, 0.2 + Math.sin(a) * 0.055));
      }
      b.geom('iron', new THREE.TorusGeometry(0.055, 0.005, 6, 16), M(0, -0.165, 0.2, Math.PI / 2));
      b.geom('iron', new THREE.TorusGeometry(0.055, 0.005, 6, 16), M(0, -0.005, 0.2, Math.PI / 2));
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), this.bulbMat);
      bulb.position.set(bx, spec.y - 0.07, bz);
      bulb.scale.set(1, 1.35, 1);
      this.group.add(bulb);
      this.lightPos.set(bx, spec.y - 0.07, bz);
    }
    this.intensity = spec.kind === 'pendant' ? 13 + spec.r * 2.6 : 15;

    // wall switch with pilot lamp
    if (spec.sw) {
      const s = spec.sw;
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      this.sw = { x: s.x + fx * 0.03, y: s.y, z: s.z + fz * 0.03, fx, fz };
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = s.yaw;
      const sb = new Batcher(game.mats);
      sb.box('iron', 0, 0, 0.02, 0.13, 0.2, 0.04, { chamfer: 0.008 });
      sb.box('brass', 0, 0, 0.042, 0.1, 0.16, 0.006, { chamfer: 0.003 });
      sb.box('iron', 0, 0.13, 0.02, 0.03, 0.08, 0.03, { chamfer: 0.004 });
      g.add(sb.build('switch'));
      this.lever = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.085, 0.022), game.mats.ivory);
      this.lever.geometry.translate(0, 0.035, 0);
      this.lever.position.set(0, -0.01, 0.05);
      g.add(this.lever);
      this.pilotMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      // the pilot is a small triangle when failed-safe is needed: shape differs from the round bulbs
      const pilot = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.012, 3), this.pilotMat);
      pilot.rotation.x = Math.PI / 2;
      pilot.position.set(0, -0.055, 0.047);
      g.add(pilot);
      this.group.add(g);
    }
    const mesh = b.build('fixture' + spec.id);
    mesh.traverse((o) => { o.castShadow = false; });
    this.group.add(mesh);
    game.scene.add(this.group);
    this._applyVisual(0);
  }

  get protects() { return this.state === 'working' || this.state === 'warning'; }

  contains(x, z, margin = 0) {
    const s = this.spec;
    if (s.rect) return x >= s.rect[0] - margin && x <= s.rect[1] + margin && z >= s.rect[2] - margin && z <= s.rect[3] + margin;
    const dx = x - this.px, dz = z - this.pz;
    const r = this.pr + margin;
    return dx * dx + dz * dz <= r * r;
  }

  /** Distance from a point to the edge of the volume (negative inside). */
  edgeDistance(x, z) {
    const s = this.spec;
    if (s.rect) {
      const dx = Math.max(s.rect[0] - x, 0, x - s.rect[1]), dz = Math.max(s.rect[2] - z, 0, z - s.rect[3]);
      if (dx > 0 || dz > 0) return Math.hypot(dx, dz);
      return -Math.min(x - s.rect[0], s.rect[1] - x, z - s.rect[2], s.rect[3] - z);
    }
    return Math.hypot(x - this.px, z - this.pz) - this.pr;
  }

  beginWarning() {
    if (this.state !== 'working' || this.dependable) return false;
    this.state = 'warning';
    this.timer = CFG.light.warn + Math.random() * 0.8;
    this.game.audio.startBuzz(this);
    this.game.ui.caption('electrical buzzing', this.lightPos);
    return true;
  }

  fail() {
    this.state = 'failed';
    this.failedAtTime = this.game.time;
    this.failAt = Infinity;
    this.game.audio.stopBuzz(this);
    this.game.audio.play('snap', this.lightPos);
    this.game.ui.caption('electrical snap', this.lightPos, true);
    this.game.director.onLightFailed(this);
  }

  reset() {
    this.state = 'working';
    this.timer = 0;
    this.resetProgress = 0;
    this.everReset = true;
    this.level = 0.15;
    this.stableUntil = this.game.time + CFG.light.stableAfterReset;
    this.failAt = Infinity;
    this.game.audio.play('switch', new THREE.Vector3(this.sw.x, this.sw.y, this.sw.z));
    this.game.audio.play('lampOn', this.lightPos);
    this.game.director.onLightReset(this);
  }

  update(dt, time) {
    const reduced = this.game.settings.reducedFlashing;
    let target = 1;
    if (this.state === 'warning') {
      this.timer -= dt;
      if (reduced) {
        // steady visual warning: a slow, shallow dip instead of strobing
        target = 0.72 + 0.1 * Math.sin(time * 3.0);
      } else {
        const n = noise1(time * 17 + this.flickerSeed), n2 = noise1(time * 5.3 + this.flickerSeed * 2);
        const urgency = 1 - clamp(this.timer / CFG.light.warn, 0, 1);
        target = n > 0.25 - urgency * 0.35 ? 0.2 + 0.25 * n2 : 1.0;
      }
      if (this.timer <= 0) this.fail();
    } else if (this.state === 'failed') target = 0;
    const rate = this.state === 'warning' && !reduced ? 60 : this.state === 'failed' ? 30 : 9;
    this.level = damp(this.level, target, rate, dt);
    if (this.level < 0.002) this.level = 0;
    // lever eases toward its state; a failed breaker drops
    if (this.lever) {
      const want = this.state === 'failed' ? 0.9 - this.resetProgress * 1.5 : -0.6;
      this.lever.rotation.x = damp(this.lever.rotation.x, want, 16, dt);
    }
    this._applyVisual(time);
  }

  _applyVisual(time) {
    const L = this.level;
    this.bulbMat.color.setRGB(WARM.r * 4.2 * L + 0.02, WARM.g * 4.2 * L + 0.015, WARM.b * 4.2 * L + 0.01);
    this.glowMat.emissiveIntensity = 1.3 * L;
    if (this.pilotMat) {
      if (this.state === 'failed') {
        const blink = 0.55 + 0.45 * Math.sin(time * 4.0);
        this.pilotMat.color.setRGB(2.4 * blink, 0.22 * blink, 0.08 * blink);
      } else this.pilotMat.color.setRGB(0.02, 0.05, 0.02);
    }
  }
}

export class Lights {
  constructor(game) {
    this.game = game;
    this.fixtures = game.level.fixtures.map((s) => new Fixture(game, s));
    this.byId = Object.fromEntries(this.fixtures.map((f) => [f.id, f]));
    this.slots = [];
    const size = game.quality.fixtureShadow;
    for (let i = 0; i < POOL; i++) {
      const spot = new THREE.SpotLight(WARM, 0, 16, 1, 0.25, 1.1);
      spot.castShadow = true;
      spot.shadow.mapSize.set(size, size);
      spot.shadow.camera.near = 0.12;
      spot.shadow.camera.far = 9;
      spot.shadow.bias = -0.0012;
      spot.shadow.normalBias = 0.02;
      spot.shadow.autoUpdate = false;
      spot.position.set(0, -50, i * 3);
      spot.target.position.set(0, -60, i * 3);
      const bounce = new THREE.PointLight(WARM, 0, 12, 1.7);
      bounce.position.copy(spot.position);
      game.scene.add(spot, spot.target, bounce);
      this.slots.push({ spot, bounce, fixture: null, dirty: true });
    }
    this.frame = 0;
  }

  /** The working fixture protecting this point, if any. */
  protectedAt(x, z, margin = 0) {
    for (const f of this.fixtures) if (f.protects && f.contains(x, z, margin)) return f;
    return null;
  }

  /** Nearest fixture volume (working or not) containing the point. */
  volumeAt(x, z) {
    for (const f of this.fixtures) if (f.contains(x, z)) return f;
    return null;
  }

  /** Does the straight segment cross any working protection volume? */
  segmentBlocked(ax, az, bx, bz) {
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      if (this.protectedAt(ax + (bx - ax) * k, az + (bz - az) * k, 0.25)) return true;
    }
    return false;
  }

  update(dt, time) {
    const hero = this.game.player.pos;
    const room = this.game.player.room;
    for (const f of this.fixtures) f.update(dt, time);

    // assign real lights to the most relevant fixtures
    const ranked = this.fixtures
      .map((f) => {
        const d = Math.hypot(f.lightPos.x - hero.x, f.lightPos.z - hero.z);
        return { f, score: d + (f.room === room ? -30 : 0) + (f.level <= 0 && f.state === 'failed' ? 12 : 0) };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, POOL)
      .map((r) => r.f);
    for (const s of this.slots) if (s.fixture && !ranked.includes(s.fixture)) s.fixture = null;
    for (const f of ranked) {
      if (this.slots.some((s) => s.fixture === f)) continue;
      const free = this.slots.find((s) => !s.fixture);
      if (!free) break;
      free.fixture = f;
      free.dirty = true;
      free.spot.position.copy(f.lightPos);
      free.spot.target.position.copy(f.target);
      free.spot.target.updateMatrixWorld();
      free.spot.angle = f.angle;
      free.spot.penumbra = f.penumbra;
      free.spot.shadow.camera.far = f.lightPos.y / Math.cos(Math.min(1.2, f.angle)) + 3;
      free.bounce.position.set(f.lightPos.x * 0.7 + f.target.x * 0.3, f.lightPos.y - 0.45, f.lightPos.z * 0.7 + f.target.z * 0.3);
    }
    this.frame++;
    this.slots.forEach((s, i) => {
      const f = s.fixture;
      const L = f ? f.level : 0;
      s.spot.intensity = f ? f.intensity * L : 0;
      s.bounce.intensity = f ? f.intensity * 0.55 * L : 0;
      // static lights: refresh their shadow maps on a stagger (moving casters are slow)
      // the hero's own room refreshes every frame so their shadow never stutters across the floor
      if (f && (s.dirty || f.room === room || (this.frame + i) % 3 === 0) && L > 0) {
        s.spot.shadow.needsUpdate = true;
        s.dirty = false;
      }
    });
  }
}
