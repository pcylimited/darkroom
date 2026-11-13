// HUD, prompts, hints, sound captions and menu screens.
import * as THREE from 'three';
import { ACTION_LABELS, DEFAULT_BINDS, keyLabel } from './input.js';
import { CFG } from './config.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), reticle: $('reticle'), health: $('health'), shelter: $('shelter'), objective: $('objective'), toast: $('toast'),
      prompt: $('prompt'), hint: $('hint'), captions: $('captions'), fade: $('fade'), lampwarn: $('lampwarn'), battery: $('battery'),
    };
    this.caps = [];
    this.hintTimer = null; this.toastTimer = null;
    this.promptFill = this.el.prompt.querySelector('.fill');
    this.batFill = this.el.battery.querySelector('i'); this.batLbl = this.el.battery.querySelector('.lbl');
    const lan = typeof __LAN_URLS__ !== 'undefined' ? __LAN_URLS__ : [];
    if (lan.length && $('lan')) $('lan').innerHTML = 'Play from another device on this network: ' + lan.map((u) => `<b>${u}</b>`).join(' or ');
    this.settingsReturn = 'pause';
    this._wire();
  }

  key(action) { return keyLabel(this.game.settings.binds[action]); }

  show(name) {
    for (const s of ['loading', 'screen-title', 'screen-pause', 'screen-settings', 'screen-dead', 'screen-complete']) $(s).classList.toggle('hidden', s !== name);
    this.el.hud.classList.toggle('hidden', !(name === null));
  }

  fade(on, white = false) {
    this.el.fade.classList.toggle('white', white);
    this.el.fade.classList.toggle('on', on);
  }

  objective(text) {
    const o = this.el.objective;
    o.textContent = text; o.classList.add('on');
    clearTimeout(this._objT);
    this._objT = setTimeout(() => o.classList.remove('on'), 9000);
  }

  hint(text, seconds = 6, delay = 0) {
    clearTimeout(this.hintTimer); clearTimeout(this._hintDelay);
    this._hintDelay = setTimeout(() => {
      this.el.hint.textContent = text; this.el.hint.classList.add('on');
      this.hintTimer = setTimeout(() => this.el.hint.classList.remove('on'), seconds * 1000);
    }, delay * 1000);
  }
  clearHint() { clearTimeout(this.hintTimer); clearTimeout(this._hintDelay); this.el.hint.classList.remove('on'); }

  toast(title, sub) {
    const t = this.el.toast;
    t.querySelector('b').textContent = title; t.querySelector('span').textContent = sub || '';
    t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('on'), 5200);
  }

  setHealth(n) {
    const marks = this.el.health.children;
    for (let i = 0; i < marks.length; i++) marks[i].classList.toggle('lost', i >= n);
    this.el.health.classList.toggle('last', n === 1);
  }

  /** Sound caption with a direction relative to the camera. */
  caption(text, pos, important = false) {
    const g = this.game;
    if (!g.settings.subtitles || g.state !== 'playing') return;
    const now = performance.now();
    const same = this.caps.find((c) => c.text === text);
    if (same) { same.until = now + 3200; if (pos) same.pos.copy(pos); return; }
    const div = document.createElement('div');
    if (important) div.className = 'imp';
    const c = { text, pos: pos ? new THREE.Vector3(pos.x, pos.y, pos.z) : null, until: now + 3400, div };
    this.caps.push(c);
    this.el.captions.appendChild(div);
    while (this.caps.length > 3) { const old = this.caps.shift(); old.div.remove(); }
  }

  _direction(pos) {
    const g = this.game, cam = g.camera;
    _v.copy(pos).sub(cam.position);
    const up = _v.y;
    const yaw = g.player.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const f = _v.x * fx + _v.z * fz, r = _v.x * rx + _v.z * rz;
    const flat = Math.hypot(f, r);
    const parts = [];
    if (up > 1.2 && up > flat * 0.55) parts.push('above');
    if (flat > 0.8) {
      const a = Math.atan2(r, f);
      if (Math.abs(a) < 0.5) parts.push('ahead ↑');
      else if (Math.abs(a) > 2.5) parts.push('behind ↓');
      else parts.push(a > 0 ? 'right →' : '← left');
    }
    return parts.join(', ');
  }

  update(dt) {
    const g = this.game, pl = g.player, el = this.el;
    // reticle
    el.reticle.classList.toggle('focus', pl.focusing);
    el.reticle.classList.toggle('lit', !!(g.creature && g.creature.litNow));
    el.reticle.classList.toggle('off', !pl.torchOn);
    el.shelter.classList.toggle('off', !pl.protectedBy);
    // torch battery
    const b = pl.battery;
    this.batFill.style.width = Math.round(b * 100) + '%';
    const charging = !pl.torchOn && b < 0.999;
    el.battery.classList.toggle('dead', pl.torchDead);
    el.battery.classList.toggle('low', !pl.torchDead && pl.torchOn && b < 0.25);
    el.battery.classList.toggle('charging', charging && !pl.torchDead);
    const lbl = pl.torchDead ? 'Recharging' : charging ? 'Charging' : !pl.torchOn ? 'Torch off' : b < 0.25 ? 'Torch low' : pl.focusing ? 'Focused' : '';
    if (this._batLbl !== lbl) { this.batLbl.textContent = lbl; this._batLbl = lbl; }

    // steady lamp warning (always shown; essential when reduced flashing is on)
    const warn = g.lights.fixtures.find((f) => f.state === 'warning' && (f.room === pl.room));
    const failedHere = !warn && g.lights.fixtures.find((f) => f.state === 'failed' && f.contains(pl.pos.x, pl.pos.z) && f.everFailedShown !== true && g.time - (f.failedAtTime || 0) < 4);
    el.lampwarn.classList.toggle('off', !warn && !failedHere);
    el.lampwarn.classList.toggle('failed', !!failedHere);
    if (warn) el.lampwarn.querySelector('.txt').textContent = 'Lamp failing — still sheltering';
    else if (failedHere) el.lampwarn.querySelector('.txt').textContent = 'Lamp failed — no shelter';

    // context prompt
    const tg = pl.interactTarget;
    const hold = g.settings.holdPush ? 'Hold' : 'Press';
    if (tg && g.state === 'playing') {
      el.prompt.classList.remove('off');
      el.prompt.querySelector('.key').textContent = this.key('interact');
      let label, state, frac;
      if (tg.type === 'door') {
        const d = tg.door;
        frac = d.frac;
        state = `${d.stateLabel} · ${Math.round(frac * 100)}%`;
        if (pl.pushing === d) label = tg.info.closing ? 'Pushing it shut' : d.exit ? 'Pushing the heavy door' : 'Pushing';
        else label = `${hold} — ${tg.info.closing ? 'push the door shut' : d.exit ? 'push the heavy door' : 'push the door'}`;
        el.prompt.classList.remove('nomark');
      } else {
        const f = tg.fixture;
        frac = f.resetProgress;
        label = `${hold} — reset the ${f.spec.label}`;
        state = 'Wall switch';
        el.prompt.classList.add('nomark');
      }
      el.prompt.querySelector('.label').textContent = label;
      el.prompt.querySelector('.state').textContent = state;
      this.promptFill.style.strokeDashoffset = String(119.4 * (1 - Math.min(1, frac)));
    } else el.prompt.classList.add('off');

    // captions
    const now = performance.now();
    for (let i = this.caps.length - 1; i >= 0; i--) {
      const c = this.caps[i];
      if (now > c.until) { c.div.remove(); this.caps.splice(i, 1); continue; }
      const dir = c.pos && g.settings.directional ? this._direction(c.pos) : '';
      const html = `[${c.text}]` + (dir ? `<span class="dir">${dir}</span>` : '');
      if (c.html !== html) { c.div.innerHTML = html; c.html = html; }
      c.div.style.opacity = c.until - now < 500 ? String((c.until - now) / 500) : '1';
    }
  }

  // ------------------------------------------------------------------ menus
  _wire() {
    const g = this.game;
    $('btn-begin').onclick = () => g.begin();
    $('btn-title-settings').onclick = () => this.openSettings('screen-title');
    $('btn-resume').onclick = () => g.resume();
    $('btn-settings').onclick = () => this.openSettings('screen-pause');
    $('btn-checkpoint').onclick = () => g.restartFromCheckpoint();
    $('btn-restart').onclick = () => g.restartLevel();
    $('btn-continue').onclick = () => g.restartFromCheckpoint();
    $('btn-again').onclick = () => g.restartLevel();
    $('btn-settings-back').onclick = () => { this.show(this.settingsReturn); };
    $('btn-binds-reset').onclick = () => { g.settings.binds = { ...DEFAULT_BINDS }; g.saveSettings(); this._binds(); };

    const s = g.settings;
    const bind = (id, key, apply, isCheck) => {
      const e = $(id);
      if (isCheck) e.checked = s[key]; else e.value = s[key];
      e.oninput = () => { s[key] = isCheck ? e.checked : parseFloat(e.value); g.saveSettings(); if (apply) apply(s[key]); };
    };
    bind('set-brightness', 'brightness');
    bind('set-volume', 'volume', (v) => g.audio.setVolume(v));
    bind('set-sens', 'sensitivity');
    bind('set-flash', 'reducedFlashing', null, true);
    bind('set-subs', 'subtitles', null, true);
    bind('set-dir', 'directional', null, true);
    bind('set-invert', 'invertY', null, true);
    bind('set-holdfocus', 'holdFocus', null, true);
    bind('set-holdpush', 'holdPush', null, true);
    const q = $('set-quality');
    q.value = s.quality;
    q.onchange = () => { s.quality = q.value; g.saveSettings(); location.reload(); };
    this._binds();
  }

  openSettings(from) {
    this.settingsReturn = from;
    this.show('screen-settings');
  }

  _binds() {
    const g = this.game, box = $('binds');
    box.innerHTML = '';
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      const span = document.createElement('span'); span.textContent = label;
      const b = document.createElement('button'); b.textContent = keyLabel(g.settings.binds[action]);
      b.onclick = (e) => {
        e.stopPropagation();
        b.textContent = 'Press…'; b.classList.add('listen');
        // rebinding listens on the next key or mouse button
        const onMouse = (ev) => { if (g.input.rebinding) { ev.preventDefault(); g.input._finishRebind('Mouse' + ev.button); } };
        setTimeout(() => window.addEventListener('mousedown', onMouse, { once: true }), 0);
        g.input.startRebind(action, () => { window.removeEventListener('mousedown', onMouse); this._binds(); });
      };
      box.append(span, b);
    }
  }

  pauseList() {
    const g = this.game, ul = $('roomlist');
    ul.innerHTML = '';
    for (const id of g.director.visited) {
      const r = g.level.rooms[id];
      if (!r) continue;
      const li = document.createElement('li');
      li.innerHTML = `<b>${r.name}</b><span>${r.landmark}</span>`;
      ul.appendChild(li);
    }
  }

  complete(stats) {
    const m = Math.floor(stats.time / 60), s = Math.floor(stats.time % 60);
    $('stats').innerHTML = `Time ${m}:${String(s).padStart(2, '0')}<br>Hits taken ${stats.hits} of ${CFG.hero.health}<br>Times driven back ${stats.repels}`;
    this.show('screen-complete');
  }
}
