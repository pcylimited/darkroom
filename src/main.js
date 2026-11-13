// Dark room — entry point and game loop.
import * as THREE from 'three';
import { bakeTextures } from './textures.js';
import { makeMaterials, makeEnvironment } from './materials.js';
import { Physics } from './physics.js';
import { buildLevel } from './level.js';
import { Door } from './door.js';
import { Lights } from './lights.js';
import { Player } from './player.js';
import { Env } from './env.js';
import { NavGraph } from './navgraph.js';
import { Creature } from './creature.js';
import { Director } from './director.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { Input, DEFAULT_BINDS } from './input.js';
import { PostFX } from './postfx.js';
import { damp, lerp, clamp } from './util.js';

const QUALITY = {
  low: { scale: 0.7, maxDpr: 1, texShift: 1, torchShadow: 1024, fixtureShadow: 512, dirShadow: 2048, ao: false, aoSamples: 8, volumetric: true, volScale: 0.4, torchSteps: 14, spotSteps: 5, dirSteps: 8, bloom: true, motes: 400 },
  medium: { scale: 0.85, maxDpr: 1, texShift: 1, torchShadow: 1024, fixtureShadow: 1024, dirShadow: 2048, ao: true, aoSamples: 8, volumetric: true, volScale: 0.5, torchSteps: 20, spotSteps: 8, dirSteps: 12, bloom: true, motes: 700 },
  high: { scale: 1, maxDpr: 1.25, texShift: 0, torchShadow: 2048, fixtureShadow: 1024, dirShadow: 4096, ao: true, aoSamples: 12, volumetric: true, volScale: 0.5, torchSteps: 28, spotSteps: 10, dirSteps: 18, bloom: true, motes: 1100 },
  ultra: { scale: 1, maxDpr: 2, texShift: 0, torchShadow: 2048, fixtureShadow: 2048, dirShadow: 4096, ao: true, aoSamples: 16, volumetric: true, volScale: 0.6, torchSteps: 40, spotSteps: 14, dirSteps: 26, bloom: true, motes: 1600 },
};

const DEFAULT_SETTINGS = {
  brightness: 1.0, volume: 0.8, sensitivity: 1.0, invertY: false, reducedFlashing: false, subtitles: true, directional: true,
  holdFocus: true, holdPush: true, quality: 'high', binds: { ...DEFAULT_BINDS },
};

const params = new URLSearchParams(location.search);

class Game {
  constructor() {
    this.state = 'loading';
    this.time = 0; this.frame = 0;
    this.debug = params.has('debug');
    this.settings = this.loadSettings();
    if (params.get('q') && QUALITY[params.get('q')]) this.settings.quality = params.get('q');
    this.quality = QUALITY[this.settings.quality] || QUALITY.high;
    this.fadeV = 1; this.exposure = 1.15;
    this.escapeT = 0; this.deadT = 0;
  }

  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('darkroom.settings') || '{}');
      return { ...DEFAULT_SETTINGS, ...s, binds: { ...DEFAULT_BINDS, ...(s.binds || {}) } };
    } catch (e) { return { ...DEFAULT_SETTINGS, binds: { ...DEFAULT_BINDS } }; }
  }
  saveSettings() { try { localStorage.setItem('darkroom.settings', JSON.stringify(this.settings)); } catch (e) { /* storage unavailable */ } }

  init() {
    const canvas = document.getElementById('c');
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 1);
    renderer.info.autoReset = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.06, 320);
    this.camera.rotation.order = 'YXZ';

    this.tex = bakeTextures(renderer, this.quality.texShift);
    this.mats = makeMaterials(this.tex);
    this.scene.environment = makeEnvironment(renderer);
    this.scene.environmentIntensity = 0.55;

    this.physics = new Physics();
    this.level = buildLevel(this);
    this.scene.add(this.level.group);
    this.doors = this.level.doors.map((spec) => new Door(this, spec));
    this.doorById = Object.fromEntries(this.doors.map((d) => [d.id, d]));
    this.input = new Input(this);
    this.audio = new AudioSys(this);
    this.ui = new UI(this);
    this.player = new Player(this);
    this.lights = new Lights(this);
    this.env = new Env(this);
    this.nav = new NavGraph(this);
    this.creature = new Creature(this);
    this.director = new Director(this);
    this.post = new PostFX(this);

    this.player.spawn(this.level.spawn.x, this.level.spawn.z, this.level.spawn.yaw);
    this.ui.setHealth(this.player.health);
    window.addEventListener('resize', () => this.resize());
    this.resize();

    // which rooms share a door, and which share a ceiling passage (for sound and hearing)
    this.doorLinks = {};
    for (const d of this.doors) { const k = [d.rooms[0], d.rooms[1]].sort().join('|'); this.doorLinks[k] = d; }
    this.ceilLinks = new Set();
    for (const [a, b] of this.level.passages) {
      const ra = this.level.breaches.find((x) => x.id === a).room, rb = this.level.breaches.find((x) => x.id === b).room;
      if (ra !== rb) this.ceilLinks.add([ra, rb].sort().join('|'));
    }

    this.clock = new THREE.Clock();
    this.state = 'title';
    this.ui.show('screen-title');
    this.ui.fade(false);
    if (params.has('autostart')) this.begin();
    // a hidden preview pane never fires animation frames; debug runs fall back to a timer
    if (this.debug) setInterval(() => this.tick(), 16); else renderer.setAnimationLoop(() => this.tick());
  }

  /** 1 = same space, lower = more walls in the way. Closed doors muffle; they never silence. */
  acoustic(a, b) {
    if (a === b) return 1;
    const k = [a, b].sort().join('|');
    const d = this.doorLinks[k];
    if (d) return d.passable ? 0.8 : d.frac > 0.1 ? 0.6 : 0.42;
    if (this.ceilLinks.has(k)) return 0.36;
    return 0.22;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxDpr) * this.quality.scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(Math.max(2, Math.round(w * dpr)), Math.max(2, Math.round(h * dpr)));
  }

  // ------------------------------------------------------------------ flow
  begin() {
    this.audio.init();
    this.ui.show(null);
    this.state = 'playing';
    this.director.start();
    if (!this.debug) this.input.lock();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.unlock();
    this.ui.pauseList();
    this.ui.show('screen-pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.init();
    this.ui.show(null);
    this.state = 'playing';
    this.clock.getDelta();
    if (!this.debug) this.input.lock();
  }

  onDeath() {
    this.state = 'dead';
    this.deadT = 0;
    this.audio.play('death');
    this.ui.clearHint();
  }

  restartFromCheckpoint() {
    this.director.restore();
    this.player.escaped = false;
    this.env.dawn = 0;
    this.fadeV = 0;
    this.ui.fade(false);
    this.ui.show(null);
    this.state = 'playing';
    this.audio.init();
    this.clock.getDelta();
    if (!this.debug) this.input.lock();
  }

  restartLevel() {
    for (const d of this.doors) d.setProgress(0);
    for (const f of this.lights.fixtures) { f.state = f.spec.startFailed ? 'failed' : 'working'; f.level = f.spec.startFailed ? 0 : 1; f.failAt = Infinity; f.resetProgress = 0; }
    this.audio.stopAllBuzz();
    const p = this.player;
    p.spawn(this.level.spawn.x, this.level.spawn.z, this.level.spawn.yaw);
    p.health = 3; p.escaped = false; p.invulnUntil = 0; p.torchOn = true; p.battery = 1; p.torchDead = false; p.lowWarned = false;
    p.stats = { hits: 0, repels: 0, time: 0 };
    this.ui.setHealth(3);
    this.env.dawn = 0;
    this.creature.placeAt(this.nav.attic.B, Infinity);
    this.creature.confined = true;
    this.fadeV = 0;
    this.ui.fade(false);
    this.ui.show(null);
    this.state = 'playing';
    this.director.start();
    this.audio.init();
    this.clock.getDelta();
    if (!this.debug) this.input.lock();
  }

  onEscape() {
    // crossing the exterior threshold is the win; control continues briefly in the dawn
    this.player.escaped = true;
    this.state = 'escaping';
    this.escapeT = 0;
    this.ui.clearHint();
    this.ui.toast('Outside', 'Cold air. First light.');
    this.creature._fleeToHiding(999);
  }

  // ------------------------------------------------------------------ loop
  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.frame++;
    const st = this.state;
    this.input.poll();
    if (st === 'playing' && this.input.pressed('pause')) this.pause();

    const live = st === 'playing' || st === 'escaping' || st === 'dead';
    if (live || st === 'title') {
      this.time += dt;
      this.player.update(dt);
      for (const d of this.doors) d.update(dt);
      this.lights.update(dt, this.time);
      if (live) {
        this.creature.update(dt);
        this.director.update(dt);
      }
      this.env.update(dt, this.time);
      this.audio.update(dt);
      this.ui.update(dt);
    }
    if (st === 'title') {
      // slow drift on the title
      this.player.yaw = this.level.spawn.yaw + Math.sin(this.time * 0.12) * 0.12;
      this.player.pitch = 0.03 + Math.sin(this.time * 0.09) * 0.03;
    }
    if (st === 'dead') {
      this.deadT += dt;
      if (this.deadT > 1.6) this.ui.fade(true);
      if (this.deadT > 3.2 && document.getElementById('screen-dead').classList.contains('hidden')) {
        this.input.unlock();
        this.ui.show('screen-dead');
      }
    }
    if (st === 'escaping') {
      this.escapeT += dt;
      this.env.dawn = clamp(this.escapeT / 5.5, 0, 1);
      if (this.escapeT > 6.2) this.ui.fade(true, true);
      if (this.escapeT > 8.0) {
        this.state = 'complete';
        this.input.unlock();
        this.ui.complete(this.player.stats);
      }
    }

    // grade
    const u = this.post.grade.uniforms, pl = this.player;
    this.exposure = damp(this.exposure, lerp(1.15, 0.5, this.env.dawn), 2, dt);
    u.uExposure.value = this.exposure;
    u.uGamma.value = this.settings.brightness;
    u.uDamage.value = pl.damageFlash;
    u.uLowHealth.value = pl.health <= 1 && !pl.dead ? 0.22 + 0.1 * Math.sin(this.time * 8) : 0;
    u.uFocus.value = pl.focus;
    u.uDesat.value = pl.dead ? Math.min(0.7, this.deadT * 0.5) : 0;
    this.post.render(this.time);
    this.input.endFrame();
  }
}

const game = new Game();
window.DR = game;
// let the loading text paint before the synchronous build
setTimeout(() => {
  try { game.init(); } catch (e) {
    console.error(e);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('fatal').classList.remove('hidden');
    document.getElementById('fatalmsg').textContent = String(e && e.message ? e.message : e);
  }
}, 60);

// automation / debugging helpers
game.dbg = {
  tp(x, z, yaw, pitch) { game.player.pos.x = x; game.player.pos.z = z; if (yaw !== undefined) game.player.yaw = game.player.heroYaw = yaw; if (pitch !== undefined) game.player.pitch = pitch; },
  hold(action, on = true) { if (on) game.input.sim.add(action); else game.input.sim.delete(action); },
  door(id, s) { game.doorById[id].setProgress(s); },
  aimAt(x, y, z) {
    const c = game.camera.position, dx = x - c.x, dy = y - c.y, dz = z - c.z;
    game.player.yaw = Math.atan2(-dx, -dz); game.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  },
  track(on = true) { clearInterval(game.dbg._tr); if (on) game.dbg._tr = setInterval(() => { const p = game.creature.bodyPts[1]; game.dbg.aimAt(p.x, p.y, p.z); }, 30); },
  info() {
    const c = game.creature, p = game.player;
    return { state: game.state, t: +game.time.toFixed(1), room: p.room, pos: [+p.pos.x.toFixed(2), +p.pos.z.toFixed(2)], hp: p.health, prot: p.protectedBy ? p.protectedBy.id : null,
      bat: +p.battery.toFixed(2), torch: p.torchOn,
      creature: { state: c.state, room: c.room, node: c.node.id, pos: c.pos.toArray().map((v) => +v.toFixed(2)), exp: +c.exposure.toFixed(2), vis: c.visible }, stage: game.director.stage,
      calls: game.renderer.info.render.calls, tris: game.renderer.info.render.triangles };
  },
};
