// Player controller: close third person camera, movement, the torch (broad / focused beam),
// interaction (pushing doors, resetting switches), health and noise.
import * as THREE from 'three';
import { CFG } from './config.js';
import { Hero } from './hero.js';
import { clamp, damp, dampAngle, angleDelta, lerp, noise1 } from './util.js';

const _v = new THREE.Vector3();

export class Player {
  constructor(game) {
    this.game = game;
    this.hero = new Hero(game);
    this.pos = { x: 0, z: 0 };
    this.vel = { x: 0, z: 0 };
    this.yaw = 0; this.pitch = 0; this.heroYaw = 0;
    this.crouch = false; this.torchOn = true; this.focusing = false; this.focus = 0; this.sprinting = false;
    this.battery = 1; this.torchDead = false; this.torchPower = 1;
    this.health = CFG.hero.health;
    this.invulnUntil = 0;
    this.pushing = null; this.pushLatch = false; this.pushSide = 1;
    this.room = 'A';
    this.dead = false;
    this.escaped = false;
    this.protectedBy = null;
    this.interactTarget = null;
    this.trauma = 0; this.damageFlash = 0;
    this.aim = new THREE.Vector3();
    this.camDist = 2;
    this.stats = { hits: 0, repels: 0, time: 0 };

    const t = this.torch = new THREE.SpotLight(new THREE.Color(1.0, 0.93, 0.80), 0, 0, 0.5, 0.5, 2);
    t.castShadow = true;
    t.shadow.mapSize.set(game.quality.torchShadow, game.quality.torchShadow);
    t.shadow.camera.near = 0.1; t.shadow.camera.far = 26;
    t.shadow.bias = -0.0018; t.shadow.normalBias = 0.03;
    t.map = game.tex.cookie;
    game.scene.add(t, t.target);
  }

  spawn(x, z, yaw) {
    this.pos.x = x; this.pos.z = z; this.vel.x = this.vel.z = 0;
    this.yaw = this.heroYaw = yaw; this.pitch = -0.02;
    this.pushing = null; this.dead = false; this.crouch = false; this.focusing = false;
    this.room = this.game.level.roomAt(x, z);
  }

  get height() { return this.crouch ? CFG.hero.crouchHeight : CFG.hero.standHeight; }

  takeHit(fromX, fromZ) {
    const g = this.game;
    if (this.dead || g.time < this.invulnUntil) return false;
    this.health -= 1;
    this.stats.hits++;
    this.invulnUntil = g.time + CFG.hero.invuln;
    this.pushing = null; this.pushLatch = true;
    g.input.clearToggle('interact');
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    const cs = Math.cos(this.heroYaw), sn = Math.sin(this.heroYaw);
    this.hero.hit((dx / l) * cs - (dz / l) * sn, (dx / l) * sn + (dz / l) * cs);
    this.vel.x += (dx / l) * 2.2; this.vel.z += (dz / l) * 2.2;
    this.trauma = 1; this.damageFlash = 1;
    g.audio.play('hit');
    g.ui.setHealth(this.health);
    if (this.health <= 0) { this.dead = true; g.onDeath(); }
    return true;
  }

  update(dt) {
    const g = this.game, inp = g.input, phys = g.physics, time = g.time;
    const alive = !this.dead && (g.state === 'playing');
    this.stats.time += alive ? dt : 0;

    // ---- look
    if (g.state === 'playing') {
      const sens = 0.0022 * g.settings.sensitivity;
      this.yaw -= inp.mdx * sens + inp.pad.lx * 2.6 * dt * g.settings.sensitivity;
      this.pitch -= inp.mdy * sens * (g.settings.invertY ? -1 : 1) + inp.pad.ly * 1.9 * dt * g.settings.sensitivity;
      this.pitch = clamp(this.pitch, -1.2, 1.35);
    }

    // ---- actions
    let mv = { x: 0, y: 0 };
    let wantFocus = false, wantInteract = false;
    if (alive) {
      mv = inp.moveVector();
      wantFocus = inp.sustained('focus') && this.torchOn;
      wantInteract = inp.sustained('interact');
      if (inp.pressed('crouch')) this.crouch = !this.crouch;
      if (inp.pressed('torch')) {
        g.audio.play('click');
        if (this.torchDead) g.ui.hint('The torch is still recharging.', 2.5);
        else { this.torchOn = !this.torchOn; g.director.noise(this.pos.x, this.pos.z, 2.5); }
      }
      if (!wantInteract) this.pushLatch = false;
    }

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // camera forward on the floor
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);

    // ---- interaction target
    this.interactTarget = null;
    if (alive) {
      let best = null, bd = 1e9;
      for (const d of g.doors) {
        const info = d.pushInfo(this.pos.x, this.pos.z);
        if (!info) continue;
        const facing = info.fx * fx + info.fz * fz;
        if (facing < 0.15 && this.pushing !== d) continue;
        if (info.dist < bd) { bd = info.dist; best = { type: 'door', door: d, info }; }
      }
      for (const f of g.lights.fixtures) {
        if (!f.sw || f.state !== 'failed') continue;
        const dx = f.sw.x - this.pos.x, dz = f.sw.z - this.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1.3 || (dx * fx + dz * fz) / (dist || 1) < 0.1) continue;
        if (dist - 0.4 < bd) { bd = dist - 0.4; best = { type: 'switch', fixture: f }; }
      }
      this.interactTarget = best;
    }

    // ---- pushing a door
    if (this.pushing) {
      const d = this.pushing;
      const info = d.pushInfo(this.pos.x, this.pos.z);
      const away = info ? mv.y * (fx * info.fx + fz * info.fz) + mv.x * (rx * info.fx + rz * info.fz) : 0;
      if (!wantInteract || !info || wantFocus || away < -0.35 || info.dir !== this.pushDir) {
        this.pushing = null;
        if (wantFocus) inp.clearToggle('interact');
      } else {
        const res = d.push(dt, info.dir);
        g.director.onPush(d, dt);
        if (res !== 'moving') {
          this.pushing = null; this.pushLatch = true; inp.clearToggle('interact');
          g.audio.play(res === 'closed' ? 'doorShut' : 'doorStop', new THREE.Vector3(d.cx, 1, d.cz));
          g.director.noise(d.cx, d.cz, 10);
        }
      }
    } else if (alive && wantInteract && !this.pushLatch && this.interactTarget && !wantFocus) {
      const tg = this.interactTarget;
      if (tg.type === 'door') {
        this.pushing = tg.door; this.pushDir = tg.info.dir;
        this.pushSide = tg.door.sideOf(this.pos.x, this.pos.z);
        g.audio.play('latch', new THREE.Vector3(tg.door.cx, 1, tg.door.cz));
        g.director.onPushStart(tg.door);
      } else if (tg.type === 'switch') {
        const f = tg.fixture;
        f.resetProgress += dt / CFG.light.resetHold;
        if (f.resetProgress >= 1) { f.reset(); this.pushLatch = true; inp.clearToggle('interact'); g.director.noise(f.sw.x, f.sw.z, 6); }
      }
    }
    for (const f of g.lights.fixtures) {
      if (f.sw && f.state === 'failed' && !(this.interactTarget && this.interactTarget.fixture === f && wantInteract)) f.resetProgress = Math.max(0, f.resetProgress - dt * 3);
    }

    // ---- movement
    this.focusing = wantFocus && !this.pushing;
    // ---- torch battery: runs down while lit, recovers while dark
    if (alive) {
      const B = CFG.torch;
      if (this.torchOn) {
        this.battery -= dt / (this.focusing ? B.focusLife : B.broadLife);
        if (this.battery <= 0) {
          this.battery = 0; this.torchOn = false; this.torchDead = true; this.focusing = false;
          inp.clearToggle('focus');
          g.audio.play('click');
          g.ui.hint('The torch has died. Find a lamp and wait for it to recharge.', 6);
        } else if (this.battery < 0.25 && !this.lowWarned) {
          this.lowWarned = true;
          g.ui.hint(`The torch is fading. Switch it off with ${g.ui.key('torch')} to let it recharge.`, 6);
        }
      } else {
        this.battery = Math.min(1, this.battery + dt / B.rechargeTime);
        if (this.battery > 0.45) this.lowWarned = false;
        if (this.torchDead && this.battery >= B.restartAt) { this.torchDead = false; this.torchOn = true; g.audio.play('click'); }
      }
    }
    const low = clamp(this.battery / 0.25, 0, 1);
    this.torchPower = (0.28 + 0.72 * low) * (this.battery < 0.12 && this.torchOn ? 0.72 + 0.28 * Math.abs(noise1(time * 19)) : 1);
    this.focus = damp(this.focus, this.focusing ? 1 : 0, 11, dt);
    const moving = Math.hypot(mv.x, mv.y) > 0.1;
    this.sprinting = alive && inp.held('sprint') && moving && mv.y > 0.3 && !this.focusing && !this.pushing;
    if (this.sprinting) this.crouch = false;
    let speed = CFG.hero.walk;
    if (this.focusing) speed = CFG.hero.focusWalk;
    else if (this.crouch) speed = CFG.hero.crouchWalk;
    else if (this.sprinting) speed = CFG.hero.sprint;
    let tvx = (fx * mv.y + rx * mv.x) * speed, tvz = (fz * mv.y + rz * mv.x) * speed;
    if (this.pushing) {
      // lean into the door: follow the leaf, but stay on our side of the wall
      const info = this.pushing.pushInfo(this.pos.x, this.pos.z);
      tvx = tvz = 0;
      if (info) {
        const dx = info.px - this.pos.x, dz = info.pz - this.pos.z;
        const dl = Math.hypot(dx, dz);
        if (dl > 0.06) { tvx = (dx / dl) * 0.8; tvz = (dz / dl) * 0.8; }
      }
    }
    if (!alive) { tvx = tvz = 0; }
    this.vel.x = damp(this.vel.x, tvx, 11, dt); this.vel.z = damp(this.vel.z, tvz, 11, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (this.pushing) {
      const d = this.pushing;
      const s = (this.pos.x - d.cx) * d.nx + (this.pos.z - d.cz) * d.nz;
      if (s * this.pushSide < 0.24) { const fix = 0.24 * this.pushSide - s; this.pos.x += d.nx * fix; this.pos.z += d.nz * fix; }
    }
    phys.resolveCircle(this.pos, CFG.hero.radius, 0.2, this.height);
    const prevRoom = this.room;
    this.room = g.level.roomAt(this.pos.x, this.pos.z);
    if (this.room !== prevRoom) g.director.onRoomChange(prevRoom, this.room);
    this.protectedBy = g.lights.protectedAt(this.pos.x, this.pos.z);

    // ---- hero facing
    let wantYaw = this.yaw;
    if (this.pushing) {
      const info = this.pushing.pushInfo(this.pos.x, this.pos.z);
      if (info) wantYaw = Math.atan2(-info.fx, -info.fz);
      // limited glance over either shoulder
      const dlt = angleDelta(wantYaw, this.yaw);
      if (Math.abs(dlt) > 1.9) this.yaw = wantYaw + Math.sign(dlt) * 1.9;
    }
    this.heroYaw = dampAngle(this.heroYaw, wantYaw, 12, dt);

    // ---- camera
    const cam = g.camera;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dirx = fx * cp, diry = sp, dirz = fz * cp;
    // looking up, the camera drops less than a pure orbit would, keeping the hero small in frame
    const ky = sp > 0 ? 0.45 : 1.0;
    const up01 = Math.max(0, sp);
    const eye = lerp(1.56, 1.04, this.hero.crouchBlend) - this.hero.deadBlend * 0.8;
    const wantShoulder = lerp(0.56, 0.5, this.focus) + up01 * 0.35;
    const wantDist = this.pushing ? 2.15 : lerp(2.05, 1.3, this.focus) + this.hero.deadBlend * 1.2;
    const px = this.pos.x, py = eye, pz = this.pos.z;
    let sh = wantShoulder;
    const hs = phys.raycast(px, py, pz, rx, 0, rz, wantShoulder + 0.25, 'cam', false);
    if (hs !== Infinity) sh = Math.max(0.05, hs - 0.25);
    const ox = px + rx * sh, oz = pz + rz * sh, oy = py + 0.1;
    let dist = wantDist;
    const hb = phys.raycast(ox, oy, oz, -dirx, -diry * ky, -dirz, wantDist + 0.3, 'cam', true);
    if (hb !== Infinity) dist = Math.max(0.12, hb - 0.3);
    this.camDist = dist < this.camDist ? dist : damp(this.camDist, dist, 6, dt);
    this.shoulder = damp(this.shoulder ?? sh, sh, 12, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const tr = this.trauma * this.trauma;
    const shx = noise1(time * 31) * 0.05 * tr, shy = noise1(time * 37 + 5) * 0.05 * tr;
    cam.position.set(px + rx * this.shoulder - dirx * this.camDist, Math.max(0.18, oy - diry * ky * this.camDist + shy), pz + rz * this.shoulder - dirz * this.camDist);
    cam.rotation.set(this.pitch + shy * 0.5, this.yaw + shx * 0.5, shx * 0.4, 'YXZ');
    const fov = lerp(62, 50, this.focus);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    this.hero.setOpacity(clamp((this.camDist - 0.35) / 0.45, 0, 1));
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.2);

    // ---- aim point: what the centre of the screen is looking at
    const start = this.camDist + 0.45;
    const sx = cam.position.x + dirx * start, sy = cam.position.y + diry * start, sz = cam.position.z + dirz * start;
    let ad = phys.raycast(sx, sy, sz, dirx, diry, dirz, 40, 'occlude', true);
    if (ad === Infinity) ad = 40;
    ad = Math.max(ad, 0.6);
    this.aim.set(sx + dirx * ad, sy + diry * ad, sz + dirz * ad);

    // ---- hero pose
    let push = null;
    if (this.pushing) {
      const d = this.pushing, k = 0.6;
      const off = d.th / 2 + 0.03;
      const info = d.pushInfo(this.pos.x, this.pos.z);
      const sgn = info ? 1 : 1;
      push = { hx: d.hx + d.lx * d.W * k - (info ? info.fx : 0) * off * sgn, hy: 1.22, hz: d.hz + d.lz * d.W * k - (info ? info.fz : 0) * off * sgn };
    }
    this.hero.update(dt, time, {
      x: this.pos.x, z: this.pos.z, yaw: this.heroYaw, vx: this.vel.x, vz: this.vel.z,
      crouch: this.crouch, focus: this.focusing, pitch: this.pitch, aim: this.aim, torchOn: this.torchOn, torchPower: this.torchPower,
      push, sprint: this.sprinting, dead: this.dead, strained: this.health <= 1,
    });
    if (this.hero.stepped && alive) {
      const loud = this.sprinting ? 15 : this.crouch ? 2.2 : this.focusing ? 3.5 : 5.5;
      g.audio.play('step', null, { gain: this.sprinting ? 1 : this.crouch ? 0.3 : 0.6 });
      g.director.noise(this.pos.x, this.pos.z, loud);
    }

    // ---- torch light
    const t = this.torch, F = this.focus;
    t.position.copy(this.hero.torchPos);
    t.target.position.copy(this.hero.torchPos).addScaledVector(this.hero.torchDir, 4);
    t.target.updateMatrixWorld();
    // rendered cone is a touch wider than the 18° gameplay cone so the soft edge sits outside it
    t.angle = lerp(CFG.torch.broadAngle / 2, CFG.torch.focusAngle / 2 + 0.035, F);
    t.penumbra = lerp(0.55, 0.42, F);
    const on = this.torchOn ? 1 : 0;
    const flick = 1 - 0.035 * Math.max(0, noise1(time * 23)) - (this.pushing ? 0.0 : 0);
    t.intensity = on * lerp(62, 430, F * F) * flick * this.torchPower;
  }
}
