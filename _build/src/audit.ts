/* ?audit runs this after the world is built. It answers the questions the museum audit taught us
   to ask before anyone walks the build: can every work be stood in front of, does it face the
   person standing there, is anything between them, is any work hung twice, and can a visitor
   actually walk into every pavilion through each door. Results land on window.__faAudit. */
import * as T from 'three';
import type { Kit } from './kit';
import type { WorldBuild } from './world';
import { WORKS } from './data';

type Fault = { kind: string; where: string; detail: string };

export function audit(W: WorldBuild, kit: Kit, viewpointOf: (i: number) => T.Vector3, standable: (x: number, z: number) => boolean, constrain: () => void, camera: T.Camera) {
  const faults: Fault[] = [];
  const blocked = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
    for (let i = 1; i < n - 2; i++) {
      const x = a.x + ((b.x - a.x) * i) / n, z = a.z + ((b.z - a.z) * i) / n;
      // the visitor's radius is baked into every block, so test with the bare wall: shrink by it
      for (const k of kit.blocks) if (x > k.x0 + 0.43 && x < k.x1 - 0.43 && z > k.z0 + 0.43 && z < k.z1 - 0.43) return true;
    }
    return false;
  };

  // every token hung exactly once
  const seen = new Map<number, number>();
  for (const h of W.hung) seen.set(h.i, (seen.get(h.i) || 0) + 1);
  WORKS.forEach((w, i) => {
    const c = seen.get(i) || 0;
    if (c !== 1) faults.push({ kind: c ? 'hung twice' : 'not hung', where: w.usps, detail: w.id });
  });

  W.hung.forEach((h, idx) => {
    const where = h.place.usps + ' ' + h.work.id;
    const vp = viewpointOf(idx);
    if (!standable(vp.x, vp.z)) faults.push({ kind: 'unreachable', where, detail: `viewpoint ${vp.x.toFixed(1)},${vp.z.toFixed(1)}` });
    // the art plane's normal is local +z; it must point at the viewpoint
    const n = new T.Vector3(0, 0, 1).applyQuaternion(h.g.quaternion);
    const to = new T.Vector3(vp.x - h.pos.x, 0, vp.z - h.pos.z).normalize();
    if (n.dot(to) < 0.5) faults.push({ kind: 'faces away', where, detail: `dot ${n.dot(to).toFixed(2)}` });
    if (blocked(vp, h.pos)) faults.push({ kind: 'something in the way', where, detail: '' });
    // the work and its label must sit inside the wall it hangs on (no overlap with a neighbour)
    for (const o of h.place.works) {
      if (o === h.i) continue;
      const oh = W.hung.find((x) => x.i === o)!;
      if (oh.g.quaternion.angleTo(h.g.quaternion) > 0.1) continue;
      const d = Math.hypot(oh.pos.x - h.pos.x, oh.pos.z - h.pos.z);
      if (d > 0.05 && d < (oh.w + h.w) / 2 + h.labelAt.w + 0.5) faults.push({ kind: 'crowded wall', where, detail: `${oh.work.id} at ${d.toFixed(2)} m` });
    }
  });

  // walk into every pavilion through each door and out the other end
  const cam = camera.position as T.Vector3;
  const saved = cam.clone();
  const walk = (pts: { x: number; z: number }[]) => {
    cam.set(pts[0].x, 1.68, pts[0].z);
    constrain();
    for (const q of pts.slice(1)) {
      let s = 0;
      while (Math.hypot(q.x - cam.x, q.z - cam.z) > 0.3 && s++ < 900) {
        const d = Math.hypot(q.x - cam.x, q.z - cam.z);
        cam.x += ((q.x - cam.x) / d) * 0.12;
        cam.z += ((q.z - cam.z) / d) * 0.12;
        constrain();
      }
      if (Math.hypot(q.x - cam.x, q.z - cam.z) > 0.6) return `stuck at ${cam.x.toFixed(1)},${cam.z.toFixed(1)} heading for ${q.x.toFixed(1)},${q.z.toFixed(1)}`;
    }
    return '';
  };
  for (const p of W.pavs) {
    const S = p.z + p.l / 2 + 6, N = p.z - p.l / 2 - 6;
    const routes = p.kind === 'shed'
      ? [-1, 1].flatMap((side) => {
        const ax = p.x + side * 4.3, inS = p.z + p.l / 2 - 2.5, inN = p.z - p.l / 2 + 2.5;
        return [[{ x: p.x, z: S }, { x: p.x, z: inS }, { x: ax, z: inS - 0.5 }, { x: ax, z: inN + 0.5 }, { x: p.x, z: inN }, { x: p.x, z: N }]];
      })
      : [[{ x: p.x, z: S }, { x: p.x, z: N }]];
    for (const r of routes) {
      for (const pts of [r, r.slice().reverse()]) {
        const why = walk(pts);
        if (why) faults.push({ kind: 'cannot walk through', where: p.place.usps, detail: why });
      }
    }
  }
  // and the hall, from the arrival out the north door
  cam.set(W.spawn.x, 1.68, W.spawn.z);
  constrain();
  let out = false;
  for (let s = 0; s < 800; s++) { cam.z -= 0.12; constrain(); if (cam.z < W.hall.z - W.hall.l / 2 - 4) { out = true; break; } }
  if (!out) faults.push({ kind: 'cannot walk through', where: 'HALL', detail: `stuck at z ${cam.z.toFixed(1)}` });
  cam.copy(saved);

  const byKind: Record<string, number> = {};
  for (const f of faults) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  const result = { works: W.hung.length, pavilions: W.pavs.length, faults: faults.length, byKind, list: faults };
  (window as unknown as { __faAudit: unknown }).__faAudit = result;
  console.info('[field audit]', JSON.stringify({ works: result.works, pavilions: result.pavilions, faults: result.faults, byKind }));
  return result;
}
