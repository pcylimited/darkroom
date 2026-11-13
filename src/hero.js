// The hero: a procedurally built and procedurally animated figure (pale shirt, dark trousers,
// torch in the right hand). Limbs are solved with two-bone IK every frame, so walking, strafing,
// crouching, aiming, door pushing and collapsing all blend without authored clips.
import * as THREE from 'three';
import { clamp, damp, lerp, noise1 } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler();

function ik(out, S, Tg, la, lb, pole) {
  _a.subVectors(Tg, S);
  let L = _a.length();
  const dir = _a.multiplyScalar(1 / Math.max(L, 1e-5));
  L = clamp(L, Math.abs(la - lb) + 0.01, la + lb - 0.004);
  const cosA = clamp((la * la + L * L - lb * lb) / (2 * la * L), -1, 1);
  _b.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1);
  _b.normalize();
  out.mid.copy(S).addScaledVector(dir, la * cosA).addScaledVector(_b, la * Math.sqrt(1 - cosA * cosA));
  out.end.copy(S).addScaledVector(dir, L);
}

export class Hero {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.rig = new THREE.Group();
    this.group.add(this.rig);
    const tex = game.tex;
    const fab = (color, rough = 1) => new THREE.MeshStandardMaterial({
      map: tex.fabric.map, normalMap: tex.fabric.normalMap, roughnessMap: tex.fabric.ormMap, color, roughness: rough, transparent: true,
    });
    const M = this.mats = {
      shirt: fab(new THREE.Color(0.86, 0.84, 0.79)),
      trouser: fab(new THREE.Color(0.075, 0.075, 0.09)),
      skin: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.52, 0.34, 0.26), roughness: 0.58, transparent: true }),
      hair: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.03, 0.022, 0.018), roughness: 0.5, transparent: true }),
      shoe: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.035, 0.028, 0.022), roughness: 0.38, transparent: true }),
      torch: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.05, 0.055), roughness: 0.35, metalness: 0.9, transparent: true }),
    };
    for (const m of [M.shirt, M.trouser]) { m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping; }
    this.lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const add = (geo, mat, parent = this.rig) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const scaleUV = (g, s) => { const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * s, u.getY(i) * s); return g; };
    const seg = (rTop, rBot, mat) => add(scaleUV(new THREE.CylinderGeometry(rTop, rBot, 1, 12, 1), 3), mat);
    const ball = (r, mat, parent) => add(scaleUV(new THREE.SphereGeometry(r, 12, 9), 2), mat, parent);

    // torso (lathe, flattened front to back)
    this.torso = new THREE.Group();
    this.rig.add(this.torso);
    const lathe = (pts) => scaleUV(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 20), 5);
    const pelvis = add(lathe([[0.001, -0.04], [0.11, -0.025], [0.165, 0.06], [0.16, 0.17], [0.001, 0.17]]), M.trouser, this.torso);
    pelvis.scale.set(1, 1, 0.66);
    const shirt = add(lathe([[0.001, 0.03], [0.178, 0.03], [0.174, 0.1], [0.168, 0.2], [0.18, 0.36], [0.205, 0.5], [0.215, 0.575], [0.19, 0.635], [0.1, 0.675], [0.055, 0.69], [0.052, 0.705], [0.001, 0.705]]), M.shirt, this.torso);
    shirt.scale.set(1, 1, 0.64);
    // collar, neck, head, hair
    const neck = add(new THREE.CylinderGeometry(0.043, 0.05, 0.11, 12), M.skin, this.torso);
    neck.position.set(0, 0.74, 0);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.79, -0.01);
    this.torso.add(this.head);
    const skull = ball(1, M.skin, this.head); skull.scale.set(0.092, 0.118, 0.104); skull.position.y = 0.085;
    const jaw = ball(1, M.skin, this.head); jaw.scale.set(0.078, 0.07, 0.085); jaw.position.set(0, 0.03, -0.018);
    const hair = ball(1, M.hair, this.head); hair.scale.set(0.098, 0.112, 0.112); hair.position.set(0, 0.107, 0.016);
    const fringe = ball(1, M.hair, this.head); fringe.scale.set(0.09, 0.05, 0.06); fringe.position.set(0, 0.175, -0.05);
    for (const s of [-1, 1]) { const ear = ball(1, M.skin, this.head); ear.scale.set(0.014, 0.03, 0.02); ear.position.set(s * 0.092, 0.08, 0.005); }
    const nose = ball(1, M.skin, this.head); nose.scale.set(0.014, 0.022, 0.02); nose.position.set(0, 0.07, -0.106);

    // limbs
    this.arm = [-1, 1].map((s) => ({
      s, shoulder: ball(0.058, M.shirt), upper: seg(0.046, 0.056, M.shirt), elbow: ball(0.046, M.shirt), fore: seg(0.035, 0.045, M.shirt),
      cuff: seg(0.037, 0.037, M.shirt), hand: ball(1, M.skin), S: new THREE.Vector3(), mid: new THREE.Vector3(), end: new THREE.Vector3(), target: new THREE.Vector3(),
    }));
    for (const a of this.arm) a.hand.scale.set(0.038, 0.052, 0.045);
    this.leg = [-1, 1].map((s) => ({
      s, hip: ball(0.082, M.trouser), upper: seg(0.062, 0.08, M.trouser), knee: ball(0.06, M.trouser), lower: seg(0.045, 0.058, M.trouser),
      foot: add(new THREE.BoxGeometry(0.095, 0.075, 0.27, 2, 2, 3), M.shoe), S: new THREE.Vector3(), mid: new THREE.Vector3(), end: new THREE.Vector3(), target: new THREE.Vector3(),
      plant: 0,
    }));
    for (const l of this.leg) {
      // round the shoe a little
      const p = l.foot.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i), y = p.getY(i), x = p.getX(i);
        const k = z < -0.05 ? 1 - (Math.abs(z + 0.05) / 0.085) * 0.35 : 1;
        p.setXYZ(i, x * k * (y > 0 ? 0.85 : 1), y * (z < -0.05 ? 0.8 : 1), z);
      }
      l.foot.geometry.computeVertexNormals();
    }

    // torch
    this.torchGroup = new THREE.Group();
    const body = add(new THREE.CylinderGeometry(0.017, 0.017, 0.15, 12), M.torch, this.torchGroup);
    body.rotation.x = Math.PI / 2; body.position.z = -0.03;
    const headM = add(new THREE.CylinderGeometry(0.031, 0.02, 0.055, 14), M.torch, this.torchGroup);
    headM.rotation.x = Math.PI / 2; headM.position.z = 0.07;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.027, 16), this.lensMat);
    lens.position.z = 0.099;
    this.torchGroup.add(lens);
    this.torchGroup.traverse((o) => { o.castShadow = false; });
    this.rig.add(this.torchGroup);

    // state
    this.phase = 0;
    this.pelvisY = 0.93;
    this.lean = 0; this.twist = 0; this.sway = 0;
    this.kick = new THREE.Vector3();
    this.kickVel = new THREE.Vector3();
    this.breath = 0;
    this.focusBlend = 0; this.pushBlend = 0; this.crouchBlend = 0; this.deadBlend = 0;
    this.torchPos = new THREE.Vector3();
    this.torchDir = new THREE.Vector3(0, 0, -1);
    this.headWorld = new THREE.Vector3();
    this.stepped = false;
    this.opacity = 1;
    this._ik = { mid: new THREE.Vector3(), end: new THREE.Vector3() };
    this._pole = new THREE.Vector3();
    game.scene.add(this.group);
  }

  hit(dirX, dirZ) {
    this.kickVel.set(dirX * 2.2, 0, dirZ * 2.2);
  }

  setOpacity(o) {
    if (Math.abs(o - this.opacity) < 0.01) return;
    this.opacity = o;
    for (const m of Object.values(this.mats)) m.opacity = o;
    this.group.visible = o > 0.03;
  }

  _place(mesh, A, B) {
    _c.subVectors(B, A);
    const len = _c.length();
    mesh.position.copy(A).addScaledVector(_c, 0.5);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(UP, _c.multiplyScalar(1 / Math.max(len, 1e-5)));
  }

  /**
   * p: { x, z, yaw, speed, vx, vz (world velocity), crouch, focus, pitch, aim (world point), torchOn,
   *      push: null | { hx, hy, hz } (world point on the door), sprint, dead, strained }
   */
  update(dt, time, p) {
    const g = this.group;
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.yaw;
    const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    // world → local
    const toLocal = (v, wx, wy, wz) => { const dx = wx - p.x, dz = wz - p.z; return v.set(dx * cs - dz * sn, wy, dx * sn + dz * cs); };
    const lvx = p.vx * cs - p.vz * sn, lvz = p.vx * sn + p.vz * cs;
    const speed = Math.hypot(lvx, lvz);

    this.focusBlend = damp(this.focusBlend, p.focus ? 1 : 0, 10, dt);
    this.pushBlend = damp(this.pushBlend, p.push ? 1 : 0, 9, dt);
    this.crouchBlend = damp(this.crouchBlend, p.crouch ? 1 : 0, 8, dt);
    this.deadBlend = damp(this.deadBlend, p.dead ? 1 : 0, p.dead ? 2.6 : 30, dt);
    const D = this.deadBlend, PB = this.pushBlend, CB = this.crouchBlend, FB = this.focusBlend;

    // gait
    const cadence = 0.95 + 0.17 * speed;
    const moving = speed > 0.12 ? 1 : 0;
    this.stepped = false;
    if (moving) {
      const prev = this.phase;
      this.phase += dt * cadence * Math.PI * 2;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI)) this.stepped = true;
    } else {
      // settle onto both feet
      const rest = Math.round(this.phase / Math.PI) * Math.PI + Math.PI / 2;
      this.phase = damp(this.phase, rest, 8, dt);
    }
    const A = moving ? Math.min(0.62, speed / (4 * cadence)) : 0;
    this._amp = damp(this._amp || 0, A, 10, dt);
    const amp = this._amp;
    const ux = speed > 0.05 ? lvx / speed : 0, uz = speed > 0.05 ? lvz / speed : -1;

    // spring for hit reactions
    this.kickVel.addScaledVector(this.kick, -90 * dt).multiplyScalar(Math.exp(-9 * dt));
    this.kick.addScaledVector(this.kickVel, dt);

    this.breath += dt * (p.strained ? 2.6 : 1.25);
    const br = Math.sin(this.breath * Math.PI) * (p.strained ? 0.012 : 0.005);
    const strain = PB * (noise1(time * 13) * 0.006);

    // pelvis
    const bob = amp > 0.02 ? -0.035 * (amp / 0.4) * (0.5 - 0.5 * Math.cos(this.phase * 2)) : 0;
    const baseY = lerp(lerp(0.925, 0.60, CB), 0.84, PB * (1 - CB));
    this.pelvisY = lerp(baseY + bob + br * 0.3, 0.2, D);
    const pelX = Math.sin(this.phase) * 0.022 * (amp / 0.4) + this.kick.x * 0.25;
    const pelZ = lerp(0, 0.16, PB) + lerp(0, 0.05, CB) + this.kick.z * 0.25 + lerp(0, 0.25, D);
    // torso orientation
    const leanT = lerp(lerp(0.03 + speed * 0.028, 0.42, CB), 0.5, PB) + (p.sprint ? 0.1 : 0);
    this.lean = damp(this.lean, lerp(leanT, 1.42, D), 9, dt);
    this.twist = damp(this.twist, Math.sin(this.phase) * 0.09 * (amp / 0.4) * (1 - FB * 0.6) - FB * 0.22 - (1 - FB) * (1 - PB) * 0.1, 9, dt);
    this.sway = damp(this.sway, -lvx * 0.03 + this.kick.x * 0.6, 8, dt);
    _e.set(-this.lean - this.kick.z * 0.5 + strain, this.twist, this.sway, 'YXZ');
    this.torso.quaternion.setFromEuler(_e);
    this.torso.position.set(pelX, this.pelvisY - 0.02, pelZ);
    this.torso.scale.set(1, 1 + br, 1 + br * 2);
    // head looks where the camera looks
    const hp = clamp(p.pitch * 0.55, -0.7, 0.6) * (1 - PB * 0.6);
    this.head.rotation.set(lerp(hp + this.lean * 0.75 - PB * 0.25, 0.5, D), -this.twist * 0.8, 0, 'YXZ');
    this.torso.updateMatrix();

    // legs
    for (const l of this.leg) {
      const ph = this.phase + (l.s > 0 ? 0 : Math.PI);
      const fwd = Math.cos(ph) * amp;
      const lift = Math.max(0, -Math.sin(ph)) * (0.05 + amp * 0.2);
      let tx = l.s * 0.105 + ux * fwd, tz = uz * fwd + 0.02;
      // pushing: braced stance; crouch: wider, one knee forward
      tx += PB * l.s * 0.05; tz += PB * (l.s > 0 ? 0.5 : 0.12) + CB * (l.s > 0 ? 0.2 : -0.12);
      tz += D * (l.s > 0 ? 0.5 : 0.35); tx += D * l.s * 0.12;
      l.target.set(tx, 0.075 + lift, tz);
      l.S.set(l.s * 0.095, 0, 0).applyMatrix4(this.torso.matrix);
      this._pole.set(l.s * 0.18, 0.15, -1);
      ik(l, l.S, l.target, 0.44, 0.44, this._pole);
      l.hip.position.copy(l.S);
      this._place(l.upper, l.S, l.mid);
      l.knee.position.copy(l.mid);
      this._place(l.lower, l.mid, l.end);
      const pitch = lift > 0.001 ? clamp(Math.cos(ph) * 0.5, -0.4, 0.5) : 0;
      l.foot.position.set(l.end.x, l.end.y - 0.04, l.end.z - 0.06);
      l.foot.rotation.set(pitch * (uz < 0 ? 1 : -1) + D * 0.9, Math.atan2(-ux, -uz) * 0.25 * moving - l.s * 0.08, 0, 'YXZ');
    }

    // aim direction in local space
    const aim = toLocal(_d, p.aim.x, p.aim.y, p.aim.z);
    // right arm: torch. left arm: swing, brace on the door, or steady the aim
    const R = this.arm[1], Lf = this.arm[0];
    for (const a of this.arm) a.S.set(a.s * 0.195, 0.595, 0.0).applyMatrix4(this.torso.matrix);
    const pitchUp = clamp(p.pitch, -1.2, 1.3);
    const sw = Math.sin(this.phase) * amp * 0.45;
    // torch hand
    const sprintShake = p.sprint ? 1 : 0;
    R.target.set(
      lerp(0.27, 0.2, FB) + sprintShake * Math.sin(this.phase) * 0.05,
      lerp(1.08, 1.34, FB) + Math.sin(pitchUp) * lerp(0.16, 0.24, FB) - CB * 0.36 + br + sprintShake * Math.abs(Math.cos(this.phase)) * 0.05,
      lerp(-0.3, -0.5, FB) + Math.max(0, pitchUp) * 0.12 + pelZ * 0.5,
    );
    Lf.target.set(-0.25 - Math.abs(sw) * 0.05, this.pelvisY - 0.12 + Math.abs(sw) * 0.06 + CB * 0.1, pelZ + sw * -uz + 0.04);
    if (FB > 0.01) {
      // support hand comes up beside the torch arm
      _a.set(0.05, R.target.y - 0.06, R.target.z + 0.1);
      Lf.target.lerp(_a, FB * 0.85);
    }
    if (p.push) {
      toLocal(_a, p.push.hx, p.push.hy, p.push.hz);
      _b.set(_a.x + 0.17, _a.y + 0.08, _a.z);
      R.target.lerp(_b, PB);
      _b.set(_a.x - 0.19, _a.y, _a.z);
      Lf.target.lerp(_b, PB);
    }
    if (D > 0.01) {
      _a.set(0.38, 0.06, -0.35); R.target.lerp(_a, D);
      _a.set(-0.34, 0.06, -0.15); Lf.target.lerp(_a, D);
    }
    for (const a of this.arm) {
      this._pole.set(a.s * 0.5, -1, 0.55);
      ik(a, a.S, a.target, 0.29, 0.27, this._pole);
      a.shoulder.position.copy(a.S);
      this._place(a.upper, a.S, a.mid);
      a.elbow.position.copy(a.mid);
      this._place(a.fore, a.mid, a.end);
      _a.subVectors(a.end, a.mid).normalize();
      a.cuff.position.copy(a.end).addScaledVector(_a, -0.02); a.cuff.scale.set(1, 0.05, 1);
      a.cuff.quaternion.copy(a.fore.quaternion);
      a.hand.position.copy(a.end).addScaledVector(_a, 0.04);
      a.hand.quaternion.copy(a.fore.quaternion);
    }

    // torch orientation: toward the aim point; hangs down while pushing
    const hand = R.hand.position;
    _a.subVectors(aim, hand);
    if (_a.lengthSq() < 0.04) _a.set(0, 0, -1);
    _a.normalize();
    if (p.sprint) { _a.x += noise1(time * 6.1) * 0.16; _a.y += noise1(time * 7.3 + 9) * 0.13; _a.normalize(); }
    _b.set(0.1, -0.92, -0.38).normalize();
    _a.lerp(_b, Math.max(PB, D)).normalize();
    this._tdir = this._tdir || new THREE.Vector3(0, 0, -1);
    this._tdir.lerp(_a, 1 - Math.exp(-22 * dt)).normalize();
    this.torchGroup.position.copy(hand).addScaledVector(this._tdir, 0.02);
    this.torchGroup.quaternion.setFromUnitVectors(_b.set(0, 0, 1), this._tdir);
    this.lensMat.color.setScalar(p.torchOn ? 0.4 + 2.2 * (p.torchPower ?? 1) : 0.05);

    // world-space outputs
    g.updateMatrixWorld(true);
    this.torchPos.copy(this.torchGroup.position).addScaledVector(this._tdir, 0.115).applyMatrix4(g.matrixWorld);
    this.torchDir.copy(this._tdir).transformDirection(g.matrixWorld);
    this.headWorld.set(0, 0.09, 0).applyMatrix4(this.head.matrixWorld);
  }
}
