// Keyboard, mouse and gamepad input with rebindable actions and hold/toggle alternatives.
export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  focus: 'Mouse2', interact: 'KeyE', sprint: 'ShiftLeft', crouch: 'KeyC', torch: 'KeyF', pause: 'Escape',
};
export const ACTION_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right',
  focus: 'Focus torch', interact: 'Interact / push', sprint: 'Sprint', crouch: 'Crouch', torch: 'Toggle torch', pause: 'Pause',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse1') return 'MMB';
  if (code === 'Mouse2') return 'RMB';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'Escape') return 'Esc';
  if (code === 'Space') return 'Space';
  return code;
}

export class Input {
  constructor(game) {
    this.game = game;
    this.down = new Set();
    this.pressedNow = new Set();
    this.sim = new Set(); // debug / automation holds
    this.mdx = 0; this.mdy = 0;
    this.locked = false;
    this.rebinding = null;
    this.toggleState = { focus: false, interact: false };
    this.pad = { mx: 0, my: 0, lx: 0, ly: 0, held: new Set(), prev: new Set() };
    const el = game.renderer.domElement;

    window.addEventListener('keydown', (e) => {
      if (this.rebinding) { e.preventDefault(); this._finishRebind(e.code); return; }
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) { this.down.add(e.code); this.pressedNow.add(e.code); }
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    el.addEventListener('mousedown', (e) => {
      const code = 'Mouse' + e.button;
      if (this.rebinding) { this._finishRebind(code); return; }
      this.down.add(code); this.pressedNow.add(code);
      if (!this.locked && game.state === 'playing') this.lock();
    });
    window.addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragLook) { this.mdx += e.movementX || 0; this.mdy += e.movementY || 0; }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked && game.state === 'playing' && !game.debug) game.pause();
    });
    document.addEventListener('pointerlockerror', () => { this.dragLook = true; });
  }

  lock() {
    try {
      const p = this.game.renderer.domElement.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.dragLook = true; });
    } catch (e) { this.dragLook = true; }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  startRebind(action, done) { this.rebinding = { action, done }; }
  _finishRebind(code) {
    const { action, done } = this.rebinding;
    this.rebinding = null;
    if (code !== 'Escape' || action === 'pause') {
      const b = this.game.settings.binds;
      for (const k of Object.keys(b)) if (b[k] === code && k !== action) b[k] = b[action];
      b[action] = code;
      this.game.saveSettings();
    }
    this.down.clear(); this.pressedNow.clear();
    done();
  }

  _padButton(name) {
    return this.pad.held.has(name);
  }

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p) => p && p.connected && p.mapping === 'standard');
    const pad = this.pad;
    pad.prev = pad.held; pad.held = new Set();
    pad.mx = pad.my = pad.lx = pad.ly = 0;
    if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
    pad.mx = dz(gp.axes[0]); pad.my = dz(gp.axes[1]);
    pad.lx = dz(gp.axes[2]); pad.ly = dz(gp.axes[3]);
    const map = { focus: 6, interact: 2, sprint: 10, crouch: 1, torch: 12, pause: 9 };
    for (const [name, idx] of Object.entries(map)) if (gp.buttons[idx] && gp.buttons[idx].value > 0.4) pad.held.add(name);
  }

  held(action) {
    const code = this.game.settings.binds[action];
    return this.down.has(code) || this.sim.has(action) || this.pad.held.has(action);
  }
  pressed(action) {
    const code = this.game.settings.binds[action];
    return this.pressedNow.has(code) || (this.pad.held.has(action) && !this.pad.prev.has(action));
  }

  /** Sustained actions honour the hold/toggle accessibility setting. */
  sustained(action) {
    const hold = action === 'focus' ? this.game.settings.holdFocus : this.game.settings.holdPush;
    if (hold) return this.held(action);
    if (this.pressed(action)) this.toggleState[action] = !this.toggleState[action];
    return this.toggleState[action] || this.sim.has(action);
  }
  clearToggle(action) { this.toggleState[action] = false; }

  moveVector() {
    let x = 0, y = 0;
    if (this.held('forward')) y += 1;
    if (this.held('back')) y -= 1;
    if (this.held('right')) x += 1;
    if (this.held('left')) x -= 1;
    x += this.pad.mx; y -= this.pad.my;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  endFrame() {
    this.pressedNow.clear();
    this.mdx = 0; this.mdy = 0;
  }
}
