// Fully synthesized, spatialised audio (WebAudio). Every cue in the design's sound language is
// generated here: scratching, breathing, the unfolding tell, hiss, buzz and snap, door strain,
// wind. Closed doors muffle sounds without removing them.
import * as THREE from 'three';
import { clamp, damp } from './util.js';

export class AudioSys {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.buzz = new Map();
    this.tickT = 0; this.heartT = 0; this.breathT = 0; this.birdT = 3;
    this._f = new THREE.Vector3(); this._u = new THREE.Vector3();
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.game.settings.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // room reverb: exponentially decaying noise
    const rl = Math.floor(ctx.sampleRate * 1.7);
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const r = ir.getChannelData(c);
      for (let i = 0; i < rl; i++) r[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 2.6) * (i < 400 ? i / 400 : 1);
    }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.5;
    this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);

    // continuous beds
    this.wind = this._loopNoise('lowpass', 380, 0.7);
    this.wind2 = this._loopNoise('bandpass', 950, 9);
    this.tone = ctx.createGain(); this.tone.gain.value = 0.0;
    for (const [f, g] of [[47, 0.5], [70.5, 0.25], [94.3, 0.12]]) { const o = ctx.createOscillator(); o.frequency.value = f; const gg = ctx.createGain(); gg.gain.value = g; o.connect(gg); gg.connect(this.tone); o.start(); }
    this.tone.connect(this.master);
    // door strain: noise groan plus a stick-slip creak, placed at the door being pushed
    this.creakPan = this._panner();
    this.creakPan.connect(this.master); this.creakPan.connect(this.reverb);
    this.creakGain = ctx.createGain(); this.creakGain.gain.value = 0; this.creakGain.connect(this.creakPan);
    const gn = ctx.createBufferSource(); gn.buffer = this.noise; gn.loop = true;
    const gf = ctx.createBiquadFilter(); gf.type = 'bandpass'; gf.frequency.value = 240; gf.Q.value = 2.5;
    const g1 = ctx.createGain(); g1.gain.value = 0.9;
    gn.connect(gf); gf.connect(g1); g1.connect(this.creakGain); gn.start();
    this.creakOsc = ctx.createOscillator(); this.creakOsc.type = 'sawtooth'; this.creakOsc.frequency.value = 62;
    this.creakF = ctx.createBiquadFilter(); this.creakF.type = 'bandpass'; this.creakF.frequency.value = 820; this.creakF.Q.value = 7;
    this.creakAm = ctx.createGain(); this.creakAm.gain.value = 0;
    this.creakOsc.connect(this.creakF); this.creakF.connect(this.creakAm); this.creakAm.connect(this.creakGain); this.creakOsc.start();
    // dread: one low swell, used sparingly around the tell
    this.dread = ctx.createGain(); this.dread.gain.value = 0;
    const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 170;
    for (const f of [36.7, 55.2, 58.1]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(df); o.start(); }
    df.connect(this.dread); this.dread.connect(this.master); this.dread.connect(this.reverb);
  }

  setVolume(v) { if (this.master) this.master.gain.value = v; }

  _loopNoise(type, freq, Q) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = 0.6 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(this.master); s.start();
    return { f, g };
  }

  _panner() {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.8; p.rolloffFactor = 1.15; p.maxDistance = 45;
    return p;
  }

  /** Output chain for one voice. Returns a node to connect sources to. */
  _voice(pos, cutoff = 20000, gain = 1, dur = 3) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain;
    let out = g;
    if (cutoff < 18000) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; g.connect(lp); out = lp; }
    if (pos) { const p = this._panner(); p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; out.connect(p); out = p; }
    out.connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.28; out.connect(send); send.connect(this.reverb);
    setTimeout(() => { try { out.disconnect(); send.disconnect(); } catch (e) { /* voice already gone */ } }, (dur + 2.5) * 1000);
    return g;
  }

  _n(dest, t, dur, o) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    s.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.Q ?? 1;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    const g = ctx.createGain();
    const a = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 1, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  _o(dest, t, dur, o) {
    const ctx = this.ctx;
    const s = ctx.createOscillator(); s.type = o.type || 'sine';
    s.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) s.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 1, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let dst = dest;
    if (o.bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = o.bp; f.Q.value = o.Q ?? 2; f.connect(dest); dst = f; }
    s.connect(g); g.connect(dst);
    s.start(t); s.stop(t + dur + 0.05);
  }

  /** Play a one-shot. pos: Vector3 or null (non-spatial). opts: { gain, room, attic } */
  play(type, pos, opts = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const g = this.game;
    let cutoff = 20000, gain = opts.gain ?? 1;
    if (opts.room) {
      const f = opts.room === g.player.room ? 1 : g.acoustic(opts.room, g.player.room);
      cutoff = 450 + f * f * 17000;
      gain *= 0.4 + 0.6 * f;
    }
    if (opts.attic) { cutoff = Math.min(cutoff, 2600); gain *= 1.15; }
    const t = ctx.currentTime + 0.005;
    const R = Math.random;
    switch (type) {
      case 'scratch': {
        const v = this._voice(pos, cutoff, gain * 0.5, 0.6);
        const n = 2 + Math.floor(R() * 3);
        let tt = t;
        for (let i = 0; i < n; i++) {
          const d = 0.04 + R() * 0.09;
          this._n(v, tt, d, { freq: 1500 + R() * 2600, freqEnd: 900 + R() * 1200, Q: 2.5, gain: 0.5 + R() * 0.5, attack: 0.008 });
          tt += d * (0.6 + R() * 0.7);
        }
        this._n(v, t, 0.25, { type: 'lowpass', freq: 260, gain: 0.5 });
        break;
      }
      case 'skitter': {
        const v = this._voice(pos, cutoff, gain * 0.42, 0.3);
        this._n(v, t, 0.02, { freq: 2400 + R() * 2000, Q: 3, gain: 0.9, attack: 0.001 });
        this._n(v, t, 0.07, { type: 'lowpass', freq: 380, gain: 0.8, attack: 0.002 });
        if (R() < 0.4) this._n(v, t + 0.05 + R() * 0.04, 0.02, { freq: 3000, Q: 3, gain: 0.5, attack: 0.001 });
        break;
      }
      case 'breath': {
        const v = this._voice(pos, cutoff, gain * 0.34, 2.6);
        this._n(v, t, 1.1, { freq: 420, freqEnd: 640, Q: 1.6, gain: 0.8, attack: 0.5 });
        this._n(v, t + 1.15, 1.3, { freq: 560, freqEnd: 300, Q: 1.4, gain: 0.6, attack: 0.3 });
        this._n(v, t + 0.2, 0.5, { type: 'lowpass', freq: 140, gain: 0.5, attack: 0.2 });
        break;
      }
      case 'emerge': {
        const v = this._voice(pos, cutoff, gain * 0.7, 1.6);
        this._n(v, t, 0.9, { freq: 500, freqEnd: 1800, Q: 1.2, gain: 0.7, attack: 0.25 });
        for (let i = 0; i < 6; i++) this._n(v, t + i * 0.13 + R() * 0.05, 0.05, { freq: 1800 + R() * 2400, Q: 3, gain: 0.6, attack: 0.002 });
        this._n(v, t + 0.3, 0.6, { type: 'lowpass', freq: 200, gain: 0.9, attack: 0.05 });
        break;
      }
      case 'tell': {
        // sharp unfolding: accelerating joint cracks under a rising intake of breath
        const v = this._voice(pos, Math.max(cutoff, 2500), gain * 0.95, 1.6);
        let tt = t, gap = 0.2;
        for (let i = 0; i < 9; i++) {
          this._n(v, tt, 0.035, { freq: 2200 + i * 260, Q: 4, gain: 0.9, attack: 0.001 });
          this._o(v, tt, 0.05, { type: 'square', freq: 180 + i * 30, gain: 0.25 });
          tt += gap; gap *= 0.78;
        }
        this._n(v, t, 1.15, { type: 'highpass', freq: 500, freqEnd: 4200, Q: 0.8, gain: 0.5, attack: 0.9 });
        this._o(v, t, 1.2, { type: 'sawtooth', freq: 70, freqEnd: 150, gain: 0.3, attack: 0.9, bp: 400, Q: 1 });
        break;
      }
      case 'strike': {
        const v = this._voice(pos, Math.max(cutoff, 3000), gain * 1.0, 0.8);
        this._n(v, t, 0.24, { freq: 350, freqEnd: 3200, Q: 1.2, gain: 1.0, attack: 0.02 });
        this._o(v, t + 0.12, 0.3, { freq: 110, freqEnd: 42, gain: 0.9 });
        break;
      }
      case 'hiss': {
        const v = this._voice(pos, Math.max(cutoff, 3500), gain * 0.9, 1.6);
        this._n(v, t, 1.2, { type: 'highpass', freq: 2600, Q: 0.7, gain: 0.9, attack: 0.02 });
        this._o(v, t, 0.7, { type: 'sawtooth', freq: 980, freqEnd: 260, gain: 0.28, bp: 1300, Q: 3 });
        this._o(v, t + 0.03, 0.6, { type: 'sawtooth', freq: 1310, freqEnd: 340, gain: 0.16, bp: 1900, Q: 3 });
        break;
      }
      case 'sizzle': {
        const v = this._voice(pos, cutoff, gain * 0.4, 0.5);
        this._n(v, t, 0.3, { type: 'highpass', freq: 4200, gain: 0.7, attack: 0.01 });
        break;
      }
      case 'snap': {
        const v = this._voice(pos, 20000, gain * 1.0, 0.8);
        this._n(v, t, 0.012, { type: 'highpass', freq: 3000, gain: 1.4, attack: 0.0005 });
        this._n(v, t + 0.01, 0.16, { type: 'highpass', freq: 5200, gain: 0.5 });
        this._o(v, t, 0.3, { freq: 330, freqEnd: 52, gain: 0.7 });
        break;
      }
      case 'lampOn': {
        const v = this._voice(pos, 20000, gain * 0.45, 0.6);
        this._o(v, t, 0.4, { type: 'triangle', freq: 110, freqEnd: 122, gain: 0.5, attack: 0.05 });
        this._n(v, t, 0.05, { type: 'highpass', freq: 6000, gain: 0.4 });
        break;
      }
      case 'switch': {
        const v = this._voice(pos, 20000, gain * 0.8, 0.4);
        this._n(v, t, 0.018, { freq: 2600, Q: 5, gain: 1.2, attack: 0.0005 });
        this._n(v, t + 0.06, 0.03, { freq: 1500, Q: 4, gain: 1.0, attack: 0.0005 });
        this._o(v, t + 0.06, 0.08, { freq: 160, freqEnd: 90, gain: 0.5 });
        break;
      }
      case 'click': {
        const v = this._voice(null, 20000, gain * 0.3, 0.2);
        this._n(v, t, 0.012, { freq: 3400, Q: 5, gain: 1, attack: 0.0005 });
        break;
      }
      case 'latch': {
        const v = this._voice(pos, 20000, gain * 0.55, 0.5);
        this._n(v, t, 0.02, { freq: 1900, Q: 6, gain: 1, attack: 0.001 });
        this._n(v, t + 0.09, 0.03, { freq: 900, Q: 4, gain: 0.8, attack: 0.001 });
        this._o(v, t + 0.09, 0.14, { freq: 140, freqEnd: 70, gain: 0.5 });
        break;
      }
      case 'doorStop':
      case 'doorShut': {
        const v = this._voice(pos, 20000, gain * 0.9, 0.9);
        this._o(v, t, 0.35, { freq: type === 'doorShut' ? 95 : 70, freqEnd: 38, gain: 1.0 });
        this._n(v, t, 0.18, { type: 'lowpass', freq: 700, gain: 0.9, attack: 0.002 });
        if (type === 'doorShut') this._n(v, t + 0.02, 0.03, { freq: 1700, Q: 5, gain: 0.7 });
        break;
      }
      case 'step': {
        const v = this._voice(null, 20000, gain * 0.34, 0.3);
        const tile = g.player.room === 'A' || g.player.room === 'F';
        this._n(v, t, 0.07, { type: 'lowpass', freq: tile ? 1800 : 780, gain: 0.9, attack: 0.003 });
        this._o(v, t, 0.09, { freq: tile ? 190 : 105 + R() * 25, freqEnd: 60, gain: 0.5 });
        if (!tile && R() < 0.12) this._o(v, t + 0.03, 0.25, { type: 'sawtooth', freq: 300 + R() * 200, freqEnd: 240, gain: 0.07, bp: 900, Q: 8 });
        break;
      }
      case 'hit': {
        const v = this._voice(null, 20000, gain * 1.0, 1.2);
        this._o(v, t, 0.5, { freq: 150, freqEnd: 36, gain: 1.1 });
        this._n(v, t, 0.2, { type: 'lowpass', freq: 1400, gain: 1.0, attack: 0.002 });
        this._n(v, t + 0.12, 0.45, { freq: 700, freqEnd: 420, Q: 2.5, gain: 0.5, attack: 0.05 }); // sharp exhale
        break;
      }
      case 'death': {
        const v = this._voice(null, 20000, gain, 3.5);
        this._o(v, t, 3.0, { type: 'sawtooth', freq: 82, freqEnd: 30, gain: 0.5, attack: 0.3, bp: 300, Q: 1 });
        this._n(v, t, 2.6, { type: 'lowpass', freq: 500, freqEnd: 90, gain: 0.5, attack: 0.2 });
        break;
      }
      case 'tick': {
        const v = this._voice(pos, cutoff, gain * 0.12, 0.2);
        this._n(v, t, 0.012, { freq: opts.tock ? 1500 : 2100, Q: 8, gain: 1, attack: 0.0005 });
        break;
      }
      case 'bird': {
        const v = this._voice(pos, 20000, gain * 0.12, 1.2);
        const base = 2400 + R() * 1600;
        for (let i = 0; i < 3 + Math.floor(R() * 3); i++) this._o(v, t + i * (0.09 + R() * 0.05), 0.07, { freq: base * (1 + R() * 0.3), freqEnd: base * (0.8 + R() * 0.5), gain: 0.6, attack: 0.01 });
        break;
      }
      case 'checkpoint': {
        const v = this._voice(null, 20000, gain * 0.16, 2);
        this._o(v, t, 1.6, { freq: 196, gain: 0.5, attack: 0.3 });
        this._o(v, t + 0.1, 1.5, { freq: 293.7, gain: 0.3, attack: 0.4 });
        break;
      }
    }
  }

  startBuzz(fixture) {
    const ctx = this.ctx;
    if (!ctx || this.buzz.has(fixture)) return;
    const p = this._panner();
    p.positionX.value = fixture.lightPos.x; p.positionY.value = fixture.lightPos.y; p.positionZ.value = fixture.lightPos.z;
    const g = ctx.createGain(); g.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.9;
    const oscs = [[100, 'sawtooth', 0.5], [200, 'square', 0.22], [50, 'sawtooth', 0.3]].map(([fr, ty, ga]) => {
      const o = ctx.createOscillator(); o.type = ty; o.frequency.value = fr;
      const og = ctx.createGain(); og.gain.value = ga; o.connect(og); og.connect(f); o.start();
      return o;
    });
    f.connect(g); g.connect(p); p.connect(this.master); p.connect(this.reverb);
    this.buzz.set(fixture, { g, p, oscs });
  }

  stopBuzz(fixture) {
    const b = this.buzz.get(fixture);
    if (!b) return;
    b.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    setTimeout(() => { b.oscs.forEach((o) => o.stop()); try { b.p.disconnect(); } catch (e) { /* gone */ } }, 300);
    this.buzz.delete(fixture);
  }

  stopAllBuzz() { for (const f of [...this.buzz.keys()]) this.stopBuzz(f); }

  update(dt) {
    const ctx = this.ctx, g = this.game;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const cam = g.camera, L = ctx.listener;
    cam.getWorldDirection(this._f);
    this._u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z;
      L.forwardX.value = this._f.x; L.forwardY.value = this._f.y; L.forwardZ.value = this._f.z;
      L.upX.value = this._u.x; L.upY.value = this._u.y; L.upZ.value = this._u.z;
    } else {
      L.setPosition(cam.position.x, cam.position.y, cam.position.z);
      L.setOrientation(this._f.x, this._f.y, this._f.z, this._u.x, this._u.y, this._u.z);
    }
    const pl = g.player;
    const active = g.state === 'playing' || g.state === 'escaping';
    // wind: stronger near windows, in the exit room and outside
    let ext = 0.12;
    for (const w of g.level.windows) { const d = Math.hypot(w.x - pl.pos.x, w.z - pl.pos.z); ext = Math.max(ext, clamp(1 - d / 5, 0, 1) * 0.5); }
    if (pl.room === 'F') ext = Math.max(ext, 0.42 + 0.3 * clamp(1 - Math.hypot(27.9 - pl.pos.x, 18.5 - pl.pos.z) / 7, 0, 1));
    if (pl.room === 'OUT') ext = 1;
    const gust = 0.75 + 0.25 * Math.sin(now * 0.31) + 0.2 * Math.sin(now * 0.83 + 1.3);
    this.wind.g.gain.setTargetAtTime(active ? ext * 0.16 * gust : 0.01, now, 0.4);
    this.wind.f.frequency.setTargetAtTime(300 + 260 * gust + ext * 300, now, 0.5);
    this.wind2.g.gain.setTargetAtTime(active ? ext * 0.02 * Math.max(0, gust - 0.6) : 0, now, 0.5);
    this.wind2.f.frequency.setTargetAtTime(800 + 500 * gust, now, 0.8);
    this.tone.gain.setTargetAtTime(active ? 0.028 * (1 - ext * 0.6) : 0.01, now, 0.5);
    this.reverbGain.gain.setTargetAtTime(pl.room === 'OUT' ? 0.12 : 0.5, now, 0.6);

    // buzz volume tracks the lamp flicker
    for (const [f, b] of this.buzz) b.g.gain.setTargetAtTime(0.05 + 0.2 * (1 - f.level), now, 0.015);

    // door strain
    const d = pl.pushing;
    let rate = 0;
    for (const dd of g.doors) rate = Math.max(rate, dd.pushRate);
    if (d) { this.creakPan.positionX.value = d.cx; this.creakPan.positionY.value = 1.1; this.creakPan.positionZ.value = d.cz; }
    this.creakGain.gain.setTargetAtTime(rate * 0.5, now, 0.05);
    const slip = Math.max(0, Math.sin(now * 7.3) * Math.sin(now * 2.1 + 1) + 0.15 * Math.sin(now * 31));
    this.creakAm.gain.setTargetAtTime(rate * slip * 0.5, now, 0.02);
    this.creakOsc.frequency.setTargetAtTime(58 + 26 * Math.sin(now * 0.9) + (d ? d.frac * 30 : 0), now, 0.1);
    this.creakF.frequency.setTargetAtTime(700 + 500 * slip, now, 0.05);

    // dread swell only around an imminent attack
    const c = g.creature;
    const dr = active && c && (c.state === 'telegraphing' || c.state === 'attacking') ? 0.16 : 0;
    this.dread.gain.setTargetAtTime(dr, now, dr ? 0.25 : 1.2);

    if (!active) return;
    // clock in the entry
    this.tickT -= dt;
    if (this.tickT <= 0) { this.tickT += 1; this._tock = !this._tock; this.play('tick', g.level.clock, { room: 'A', tock: this._tock }); }
    // injury: strained breath and pulse, kept quiet enough not to mask warnings
    if (pl.health <= 1 && !pl.dead) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.78;
        const v = this._voice(null, 20000, 0.3, 0.5), t = ctx.currentTime + 0.01;
        this._o(v, t, 0.12, { freq: 62, freqEnd: 40, gain: 1 }); this._o(v, t + 0.2, 0.14, { freq: 54, freqEnd: 36, gain: 0.7 });
      }
    }
    if (pl.health <= 2 && !pl.dead) {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        this.breathT = pl.health <= 1 ? 1.5 : 2.6;
        const v = this._voice(null, 20000, pl.health <= 1 ? 0.13 : 0.07, 1.5), t = ctx.currentTime + 0.01;
        this._n(v, t, 0.55, { freq: 1100, freqEnd: 1700, Q: 1.5, gain: 0.8, attack: 0.25 });
        this._n(v, t + 0.6, 0.7, { freq: 900, freqEnd: 500, Q: 1.2, gain: 0.6, attack: 0.15 });
      }
    }
    // dawn chorus once outside
    if (pl.room === 'OUT') {
      this.birdT -= dt;
      if (this.birdT <= 0) { this.birdT = 0.5 + Math.random() * 1.6; this.play('bird', new THREE.Vector3(pl.pos.x + 6 + Math.random() * 14, 4 + Math.random() * 5, pl.pos.z + (Math.random() - 0.5) * 30)); }
    }
  }
}
