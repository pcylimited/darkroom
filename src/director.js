// Encounter scheduling, tutorials, light-failure gating and checkpoints.
// It tracks pressure to prevent impossible overlaps; it never changes hit rules.
import * as THREE from 'three';
import { CFG } from './config.js';
import { H } from './level.js';

export class Director {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.stage = 'intro'; // intro → contact → free
    this.firstRepel = false;
    this.lightTut = 'pending'; // pending → active → done
    this.contactAt = 0; this.repelAt = -100; this.tellAt = -100; this.hitAt = -100; this.hintAt = -100;
    this.graceUntil = 0;
    this.introCue = 5.5;
    this.visited = new Set(['A']);
    this.pushPool = new Map();
    this.inNiche = null;
    this.snapshot = null;
    this.flags = {};
  }

  start() {
    const g = this.game;
    this.reset();
    g.ui.objective('Find a way out.');
    g.ui.hint('Room lights shelter you. Focus the torch to drive it back.', 9, 2.5);
    this.save(true);
  }

  // ------------------------------------------------------------ queries used by the creature
  creatureMayHunt() { return this.stage === 'free' && this.game.time >= this.graceUntil; }
  creatureMayAttack() {
    const t = this.game.time;
    if (t < this.graceUntil) return false;
    if (this.stage === 'contact' && t < this.contactAt + 7) return false; // let the focus hint land first
    if (t < this.hintAt + 2.5) return false;
    return true;
  }
  hideTime() { return this.flags.justFirstRepel ? ((this.flags.justFirstRepel = false), 10) : 6 + Math.random() * 6; }

  // ------------------------------------------------------------ events
  noise(x, z, loud) {
    const g = this.game;
    if (g.creature) g.creature.hear(x, z, loud, g.level.roomAt(x, z));
  }

  onRoomChange(prev, next) {
    const g = this.game;
    if (next === 'OUT') return;
    if (!this.visited.has(next)) {
      this.visited.add(next);
      g.ui.toast(g.level.rooms[next].name, g.level.rooms[next].landmark);
    }
    if (this.stage === 'intro' && (next === 'B' || next === 'C')) {
      // first contact happens at whichever breach the player reaches first
      this.stage = 'contact';
      this.contactRoom = next;
      this.contactAt = g.time + 2.2; // a few quiet seconds to read the room
      this.contactSent = false;
    }
    if (next === 'E' && !this.flags.eHint && g.lights.byId.E1.state === 'failed') {
      this.flags.eHint = true;
      g.ui.hint('The lamp by the far door is dead. Its switch is on the south wall.', 7, 1.5);
      this.hintAt = g.time;
    }
    if (next === 'F' && !this.flags.fHint) {
      this.flags.fHint = true;
      g.ui.hint('Daylight around the heavy door. It will take longer to push.', 6, 1.0);
    }
  }

  onArrive(c) {
    const g = this.game;
    if (this.stage === 'contact' && !this.flags.focusHint) {
      this.flags.focusHint = true;
      g.ui.hint(`Hold ${g.ui.key('focus')} to focus the torch. Keep the beam on its body.`, 14, 0.4);
      this.hintAt = g.time - 1.5;
      this.contactAt = g.time;
    }
  }

  onRepel() {
    const g = this.game;
    this.repelAt = g.time;
    if (!this.firstRepel) {
      this.firstRepel = true;
      this.flags.justFirstRepel = true;
      g.ui.hint('It is not dead. The torch only buys time.', 6, 0.8);
      this.hintAt = g.time;
    }
    this.stage = 'free';
  }
  onTell() { this.tellAt = this.game.time; }
  onHit() {
    this.hitAt = this.game.time;
    if (this.stage === 'contact') this.stage = 'free';
  }

  onPushStart(door) {
    if (!this.flags.pushHint) {
      this.flags.pushHint = true;
      this.game.ui.hint('Progress stays if you let go. Release, turn and defend, then push again.', 7, 1.2);
    }
  }
  onPush(door, dt) {
    const g = this.game;
    // remember which protective pool covers this push, so it cannot fail mid-push
    const f = g.player.protectedBy;
    if (f) this.pushPool.set(f, g.time);
    this._pushNoise = (this._pushNoise || 0) - dt;
    if (this._pushNoise <= 0) { this._pushNoise = 0.5; this.noise(door.cx, door.cz, 13); }
  }

  onLightFailed(f) {
    const g = this.game;
    if (this.lightTut === 'active' && f.id === 'C1') {
      g.ui.hint(`The lamp has failed. Hold ${g.ui.key('interact')} at its wall switch, or fall back to the entry.`, 10, 0.3);
      this.hintAt = g.time;
    }
  }
  onLightReset(f) {
    if (this.lightTut === 'active' && f.id === 'C1') this.lightTut = 'done';
    this.game.ui.hint('The lamp holds again, for a while.', 4, 0.2);
  }

  // ------------------------------------------------------------ update
  update(dt) {
    const g = this.game, t = g.time, pl = g.player, c = g.creature;
    if (g.state !== 'playing') return;

    // opening: something crosses the ceiling toward the bedroom
    if (this.introCue > 0) {
      this.introCue -= dt;
      if (this.introCue <= 0) {
        for (let i = 0; i < 9; i++) {
          const k = i / 8;
          setTimeout(() => { if (g.state === 'playing') g.audio.play('scratch', new THREE.Vector3(3 + k * 9, H + 0.4, 5.5 - k * 2), { attic: true, gain: 1.0 }); }, i * 320);
        }
        g.ui.caption('scratching crosses the ceiling', new THREE.Vector3(9, H, 4), true);
      }
    }

    // first contact
    if (this.stage === 'contact') {
      if (!this.contactSent && t >= this.contactAt && pl.room === this.contactRoom) {
        this.contactSent = true;
        c.scriptArrive(this.contactRoom, 13);
      } else if (!this.contactSent && pl.room !== this.contactRoom && (pl.room === 'B' || pl.room === 'C')) {
        this.contactRoom = pl.room; this.contactAt = t + 1.5;
      }
      if (this.contactSent && (c.state === c.S.STALK || c.state === c.S.TELL)) this.stage = 'free';
      if (this.contactSent && c.state === c.S.HIDDEN && !c.edge && t > this.contactAt + 20) this.stage = 'free';
    }

    // first warned failure: in the sitting room, only after the torch lesson has landed
    const C1 = g.lights.byId.C1;
    if (this.lightTut === 'pending' && this.firstRepel && pl.room === 'C' && C1.state === 'working' && t > this.repelAt + 5.5
      && c.room !== 'C' && c.state !== c.S.TELL && c.state !== c.S.ATTACK && !pl.pushing && t > this.hintAt + 4) {
      if (C1.beginWarning()) {
        this.lightTut = 'active';
        g.ui.hint('The lamp is failing. It still shelters you until the snap.', 5, 0.2);
        this.hintAt = t;
      }
    }

    // later failures: authored gates plus a little timing variation, never a per-frame dice roll
    if (this.stage === 'free' && this.lightTut !== 'active') {
      for (const f of g.lights.fixtures) {
        if (f.dependable || f.state !== 'working') continue;
        if (f.id === 'C1' && this.lightTut === 'pending') continue; // its first failure is the tutorial
        if (f.failAt === Infinity) f.failAt = Math.max(t, f.stableUntil) + 22 + Math.random() * 40;
        if (t < f.failAt) continue;
        const near = pl.room === f.room || g.acoustic(pl.room, f.room) >= 0.7;
        const lastPush = this.pushPool.get(f) ?? -100;
        const pushing = t - lastPush < CFG.light.doorGrace;
        const retreat = g.lights.fixtures.some((o) => o !== f && o.protects && Math.hypot(o.lightPos.x - pl.pos.x, o.lightPos.z - pl.pos.z) < 12 && (o.room === pl.room || g.acoustic(pl.room, o.room) >= 0.7));
        const calm = c.state !== c.S.TELL && c.state !== c.S.ATTACK && t > this.hintAt + 5 && t > this.hitAt + 4;
        const others = g.lights.fixtures.some((o) => o !== f && o.state === 'warning');
        if (near && !pushing && retreat && calm && !others) f.beginWarning();
        else f.failAt = t + 3 + Math.random() * 3;
      }
    }

    // checkpoints: the protected doorway niches in D and E
    const niche = g.lights.fixtures.find((f) => f.spec.checkpoint && f.contains(pl.pos.x, pl.pos.z));
    if (niche && this.inNiche !== niche && c.state !== c.S.TELL && c.state !== c.S.ATTACK) {
      this.save(false, niche);
      g.ui.toast('Checkpoint', 'The lamp in this doorway does not fail.');
      g.audio.play('checkpoint');
    }
    this.inNiche = niche || null;

    // escape
    if (!pl.escaped && pl.pos.x > g.level.exitX + 0.25) g.onEscape();
  }

  // ------------------------------------------------------------ persistence
  save(initial, niche) {
    const g = this.game, pl = g.player;
    // wake up standing well inside the niche, not on its threshold
    const r = niche && niche.spec.rect;
    this.snapshot = {
      x: r ? (r[0] + r[1]) / 2 + 0.15 : pl.pos.x, z: r ? (r[2] + r[3]) / 2 : pl.pos.z, yaw: r ? -Math.PI / 2 : pl.yaw,
      doors: Object.fromEntries(g.doors.map((d) => [d.id, d.s])),
      lights: Object.fromEntries(g.lights.fixtures.map((f) => [f.id, f.state === 'warning' ? 'working' : f.state])),
      stage: initial ? 'intro' : 'free',
      firstRepel: this.firstRepel, lightTut: this.lightTut === 'active' ? 'pending' : this.lightTut,
      visited: [...this.visited], flags: { ...this.flags },
    };
  }

  restore() {
    const g = this.game, s = this.snapshot, pl = g.player, t = g.time;
    for (const d of g.doors) d.setProgress(s.doors[d.id] ?? 0);
    g.audio.stopAllBuzz();
    for (const f of g.lights.fixtures) {
      f.state = s.lights[f.id]; f.timer = 0; f.resetProgress = 0; f.failAt = Infinity;
      f.stableUntil = t + CFG.light.stableAfterReset;
      f.level = f.state === 'failed' ? 0 : 1;
    }
    this.stage = s.stage; this.firstRepel = s.firstRepel; this.lightTut = s.lightTut;
    this.visited = new Set(s.visited); this.flags = { ...s.flags, justFirstRepel: false };
    this.pushPool.clear();
    this.contactSent = false; this.introCue = s.stage === 'intro' ? 4 : 0;
    this.hintAt = -100; this.repelAt = t - 6; this.hitAt = -100;
    this.graceUntil = t + 9; // arrival grace period
    pl.health = CFG.hero.health; pl.invulnUntil = 0; pl.damageFlash = 0; pl.trauma = 0;
    pl.battery = 1; pl.torchDead = false; pl.torchOn = true; pl.lowWarned = false;
    pl.spawn(s.x, s.z, s.yaw);
    g.ui.setHealth(pl.health);
    this.inNiche = g.lights.fixtures.find((f) => f.spec.checkpoint && f.contains(pl.pos.x, pl.pos.z)) || null;
    // the creature returns to a legal dark node away from the protected area
    const c = g.creature, nav = g.nav;
    if (s.stage === 'intro') { c.placeAt(nav.attic.B, Infinity); c.confined = true; c.hiddenUntil = Infinity; }
    else {
      const cands = nav.nodes.filter((n) => n.type === 'attic' && n.room !== pl.room);
      cands.sort((a, b) => Math.hypot(b.x - pl.pos.x, b.z - pl.pos.z) - Math.hypot(a.x - pl.pos.x, a.z - pl.pos.z));
      c.placeAt(cands[Math.floor(Math.random() * Math.min(3, cands.length))], 9 + Math.random() * 4);
      c.confined = false;
    }
  }
}
