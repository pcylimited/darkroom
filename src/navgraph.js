// Creature navigation: one graph spanning floor waypoints, door thresholds, hiding places,
// breach rims and the hidden ceiling passages. Travel is always along real edges with real
// durations: the creature can never appear in a room its path has not reached.
import { CFG } from './config.js';
import { H } from './level.js';

export class NavGraph {
  constructor(game) {
    this.game = game;
    this.nodes = [];
    const { level, physics } = game;
    const add = (n) => { n.edges = []; n.idx = this.nodes.length; this.nodes.push(n); return n; };
    const link = (a, b, kind, extra = {}) => {
      const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      a.edges.push({ from: a, to: b, kind, dist, ...extra });
      b.edges.push({ from: b, to: a, kind, dist, ...extra });
    };
    this.attic = {}; this.rim = {}; this.drop = {};

    for (const b of level.breaches) {
      const attic = add({ id: 'attic:' + b.id, room: b.room, type: 'attic', x: b.x, y: H + 0.8, z: b.z, breach: b });
      const rim = add({ id: 'rim:' + b.id, room: b.room, type: 'rim', x: b.x, y: H - 0.32, z: b.z, breach: b });
      const drop = add({ id: 'drop:' + b.id, room: b.room, type: 'floor', x: b.drop[0], y: 0, z: b.drop[1], breach: b });
      link(attic, rim, 'emerge');
      link(rim, drop, 'climb');
      this.attic[b.id] = attic; this.rim[b.id] = rim; this.drop[b.id] = drop;
    }
    for (const [a, b] of level.passages) link(this.attic[a], this.attic[b], 'attic');

    for (const [room, nav] of Object.entries(level.nav)) {
      const pts = nav.pts.map((p, i) => add({ id: `floor:${room}:${i}`, room, type: 'floor', x: p[0], y: 0, z: p[1] }));
      for (const h of nav.hides) {
        const hn = add({ id: `hide:${room}:${h.x}`, room, type: 'hide', x: h.x, y: 0, z: h.z, under: h.kind === 'under' });
        let best = null, bd = 1e9;
        for (const n of this.nodes) {
          if (n.room !== room || n.type !== 'floor') continue;
          const d = Math.hypot(n.x - h.link[0], n.z - h.link[1]);
          if (d < bd) { bd = d; best = n; }
        }
        if (best) link(hn, best, 'hide');
      }
      void pts;
    }
    this.doorNodes = {};
    for (const d of game.doors) {
      const mk = (side, room) => add({ id: `door:${d.id}:${room}`, room, type: 'floor', x: d.cx + d.nx * side * 1.0, y: 0, z: d.cz + d.nz * side * 1.0, door: d });
      if (d.exit) continue; // nothing follows the hero outside
      const na = mk(-1, d.rooms[0]), nb = mk(1, d.rooms[1]);
      link(na, nb, 'door', { door: d });
      this.doorNodes[d.id] = [na, nb];
    }
    // floor connectivity inside each room
    for (const room of Object.keys(level.rooms)) {
      const fl = this.nodes.filter((n) => n.room === room && n.type === 'floor');
      for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) {
        const a = fl[i], b = fl[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) > 9) continue;
        if (physics.segmentClear(a.x, a.z, b.x, b.z, CFG.creature.radius, 0.5)) link(a, b, 'floor');
      }
    }
  }

  edgeTime(e, flee) {
    const c = CFG.creature;
    switch (e.kind) {
      case 'attic': return Math.max(c.ceilMinEdge, e.dist / c.atticSpeed);
      case 'emerge': return 1.0;
      case 'climb': return flee ? 0.7 : 1.15;
      default: return e.dist / (flee ? c.fleeSpeed : c.stalkSpeed);
    }
  }

  edgeOpen(e, ignoreLight) {
    if (e.kind === 'door' && !e.door.passable) return false;
    if (!ignoreLight && (e.kind === 'floor' || e.kind === 'door' || e.kind === 'hide') && this.game.lights.segmentBlocked(e.from.x, e.from.z, e.to.x, e.to.z)) return false;
    return true;
  }

  /** Dijkstra from a node to the best node accepted by goal(node). Returns edge list or null. */
  path(from, goal, o = {}) {
    const N = this.nodes.length;
    const dist = new Float32Array(N).fill(Infinity);
    const prev = new Array(N).fill(null);
    const done = new Uint8Array(N);
    dist[from.idx] = 0;
    let bestGoal = null, bestCost = Infinity;
    for (;;) {
      let u = -1, ud = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && dist[i] < ud) { ud = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      const n = this.nodes[u];
      const gc = goal(n);
      if (gc !== false && gc !== undefined && gc !== null) {
        const total = ud + (typeof gc === 'number' ? gc : 0);
        if (total < bestCost) { bestCost = total; bestGoal = n; }
        if (typeof gc !== 'number') break;
      }
      if (ud > bestCost) break;
      for (const e of n.edges) {
        if (!this.edgeOpen(e, o.ignoreLight)) continue;
        if (o.avoid && o.avoid(e)) continue;
        const nd = ud + this.edgeTime(e, o.flee);
        if (nd < dist[e.to.idx]) { dist[e.to.idx] = nd; prev[e.to.idx] = e; }
      }
    }
    if (!bestGoal) return null;
    const out = [];
    let c = bestGoal;
    while (c !== from) { const e = prev[c.idx]; if (!e) return null; out.unshift(e); c = e.from; }
    out.cost = bestCost;
    return out;
  }

  nearest(x, z, filter) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      if (filter && !filter(n)) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
}
