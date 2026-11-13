// Tuning values. These mirror the prototype defaults in section 10 of the design document.
import { DEG } from './util.js';

export const CFG = {
  hero: {
    health: 3,
    invuln: 1.5, // damage protection after a hit
    walk: 2.0,
    sprint: 3.5,
    focusWalk: 1.2,
    crouchWalk: 1.15,
    radius: 0.36,
    standHeight: 1.76,
    crouchHeight: 1.1,
  },
  door: {
    timeToPassable: 5.0,
    exitTimeToPassable: 6.0,
    passFrac: 0.85, // push progress at which the gap is wide enough
    maxAngle: 78 * DEG,
    width: 0.92,
    exitWidth: 1.15,
    height: 2.12,
    thick: 0.06,
    ease: 1.5,
    exitEase: 2.6,
    reach: 1.05,
  },
  torch: {
    range: 8.0, // effective focus range
    focusAngle: 18 * DEG, // full beam angle when focused
    broadAngle: 64 * DEG,
    exposeTime: 0.8, // accumulated exposure that triggers retreat
    decayTime: 0.5,
    decayDelay: 0.14,
    // battery: drains while the torch is on (faster when focused), recovers while it is off
    broadLife: 80, // seconds of continuous broad beam from full
    focusLife: 26, // seconds of continuous focused beam from full
    rechargeTime: 16, // seconds from empty to full while switched off
    restartAt: 0.3, // a dead torch relights by itself at this charge
  },
  creature: {
    repelCooldown: 4.0, // earliest attack after a repulsion starts
    hitRecovery: 3.2, // minimum withdrawal after a successful hit
    tellMin: 1.25,
    ceilMinEdge: 2.0, // minimum ceiling passage travel time
    atticSpeed: 4.2,
    stalkSpeed: 2.35,
    fleeSpeed: 5.2,
    reach: 1.55,
    rimReach: 2.3,
    radius: 0.34,
    arrivalPause: 1.6,
  },
  light: {
    warn: 3.4, // flicker + buzz before protection fails
    resetHold: 1.0,
    stableAfterReset: 25,
    doorGrace: 3.0,
  },
  world: {
    H: 3.6, // ceiling height
    T: 0.3, // wall thickness
  },
};
