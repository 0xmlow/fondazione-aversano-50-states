/* THE FIELD — Fondazione Aversano's 50 States, installed across a walkable map of America on the
   Marfa desert floor.

   The reimagined landmark is Donald Judd's Chinati Foundation. Judd set fifteen concrete works in a
   line across a kilometre of grass and turned two artillery sheds into vaulted halls of aluminum.
   Here the line becomes the map: every state is a Judd concrete box standing where the state is,
   open at both ends, the bigger collections in Quonset vaulted sheds, and the arrival is a reborn
   artillery shed in Marfa itself, its fifty four aluminum boxes a directory of the whole country.

   Voices: Wright owns the walk (low lintel, high skylit box, open end to the horizon); Judd's
   seriality is the ground rule; Hadid takes the one tower at the middle of the country; Arsham gets
   one moment (a concrete unit excavated a thousand years from now); Abloh owns every word. */
import * as T from 'three';
import { Kit, v } from './kit';
import * as X from './textures';
import { D, PLACES, WORKS, Place, Work, media } from './data';

export type Hung = {
  i: number;
  work: Work;
  place: Place;
  g: T.Group;
  art: T.Mesh;
  mat: T.MeshBasicMaterial;
  w: number;
  h: number;
  pos: T.Vector3;
  target: T.Vector3;
  label: T.Mesh | null;
  labelAt: { x: number; y: number; w: number; h: number };
  lod: number;            // 0 placeholder, 1 small image, 2 full image, 3 moving
  want: number;
  busy: boolean;
  stop: (() => void) | null;
  url: string | null;
};
export type Pav = { place: Place; x: number; z: number; w: number; l: number; kind: 'box' | 'shed'; mouth: T.Vector3; enter: T.Vector3; look: T.Vector3; pick: T.Mesh; hung: Hung[]; decor: T.Object3D[] };
export type DirBox = { mesh: T.Mesh; top: T.Mesh; place: Place };
export type WorldBuild = {
  hung: Hung[];
  pavs: Pav[];
  dir: DirBox[];
  lookoutPick: T.Mesh;
  lookout: T.Vector3;
  hallDecor: T.Object3D[];
  hall: { x: number; z: number; w: number; l: number };
  spawn: T.Vector3;
  look: T.Vector3;
  bounds: [number, number, number, number];
  eye: number;
  sky: SkyRig;
  train: { box: () => { x0: number; x1: number; z0: number; z1: number }; x: () => number; z: number };
  follow: (cam: T.Vector3) => void;
};

const INK = '#1a1a1a', BONE = '#fbfaf7', SIENNA = '#a0522d', MUTED = '#6b6a64';
const Q = (s: string) => '“' + s.toUpperCase() + '”';

/* ---------- canvases ---------- */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
type Line = { t: string; size: number; color?: string; weight?: string; gap?: number; track?: number };
function card(lines: Line[], w: number, h: number, bg = BONE, rule = SIENNA, pad = 0.07) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (rule) { g.fillStyle = rule; g.fillRect(0, 0, w, Math.max(4, h * 0.012)); }
    let y = h * 0.1;
    g.textBaseline = 'top';
    for (const l of lines) {
      g.fillStyle = l.color || INK;
      g.font = `${l.weight || '500'} ${l.size}px ${SANS}`;
      if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = (l.track || 0) + 'px';
      // wrap to the card width
      const words = l.t.split(' ');
      let line = '';
      const maxW = w * (1 - pad * 2);
      for (const wd of words) {
        const test = line ? line + ' ' + wd : wd;
        if (g.measureText(test).width > maxW && line) {
          g.fillText(line, w * pad, y);
          y += l.size * 1.22;
          line = wd;
        } else line = test;
      }
      if (line) g.fillText(line, w * pad, y);
      y += l.size * 1.22 + (l.gap ?? l.size * 0.35);
    }
  });
}
function word(text: string, w: number, h: number, fg: string, size: number, opts: { bg?: string; weight?: string; track?: number; align?: CanvasTextAlign } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = opts.bg || 'rgba(0,0,0,0)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = `${opts.weight || '700'} ${size}px ${SANS}`;
    if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = (opts.track || 0) + 'px';
    g.textAlign = opts.align || 'center';
    g.textBaseline = 'middle';
    g.fillText(text, opts.align === 'left' ? w * 0.03 : w / 2, h / 2, w * 0.96);
  });
}
function radial(inner: string, outer: string, size = 128) {
  return canvasTex(size, size, (g) => {
    const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    r.addColorStop(0, inner);
    r.addColorStop(0.25, inner);
    r.addColorStop(1, outer);
    g.fillStyle = r;
    g.fillRect(0, 0, size, size);
  });
}

/* ---------- the light over Marfa ---------- */
export class SkyRig {
  dome: T.Mesh;
  hemi: T.HemisphereLight;
  sun: T.DirectionalLight;
  night = 0;
  dusk = 0;
  hour = 12;
  dir = new T.Vector3(0, 1, 0);
  private rt: T.WebGLRenderTarget | null = null;
  private pmrem: T.PMREMGenerator;
  /* everything that brightens after dark: [material, opacity by day, opacity by night] */
  glows: [T.Material & { opacity: number }, number, number][] = [];
  nightOnly: T.Object3D[] = [];
  constructor(private scene: T.Scene, private renderer: T.WebGLRenderer, private high: boolean) {
    this.dome = new T.Mesh(new T.SphereGeometry(900, 48, 24), new T.MeshBasicMaterial({ side: T.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    this.dome.renderOrder = -10;
    scene.add(this.dome);
    this.hemi = new T.HemisphereLight(0xcfe0ff, 0xb08a5c, 1);
    scene.add(this.hemi);
    this.sun = new T.DirectionalLight(0xffffff, 3);
    scene.add(this.sun, this.sun.target);
    if (high) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const s = this.sun.shadow.camera;
      s.near = 10; s.far = 600; s.left = s.bottom = -70; s.right = s.top = 70;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.05;
    }
    this.pmrem = new T.PMREMGenerator(renderer);
  }
  setHour(h: number) {
    this.hour = h;
    const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    /* early October in Marfa: sunrise about 7:40, sunset about 19:20 */
    const rise = 7.6, set = 19.3;
    const phi = Math.PI * (h - rise) / (set - rise);
    const el = Math.sin(phi) * 0.98;
    this.night = 1 - sm(-0.14, 0.04, el);
    this.dusk = (1 - this.night) * (1 - sm(0.04, 0.38, el));
    const n = this.night, d = this.dusk;
    if (el > -0.02) {
      const hx = Math.cos(phi), hz = Math.sin(Math.max(0.0, Math.min(Math.PI, phi)));
      const ce = Math.cos(Math.max(0.03, el));
      this.dir.set(hx * ce, Math.sin(Math.max(0.03, el)), hz * ce * 0.85).normalize();
    } else this.dir.set(-0.35, 0.8, 0.4).normalize();      // the moon, high in the south west
    const mix = (a: number, b: number, t: number) => new T.Color(a).lerp(new T.Color(b), t).getHex();
    const top = mix(mix(0x1f5fbf, 0x3f4f99, d), 0x03060f, n);
    const horizon = mix(mix(0xb9cfe3, 0xf2a064, d * 0.9), 0x141b30, n);
    const ground = mix(mix(0xc2a27a, 0x9a6a4a, d), 0x0b0c10, n);
    const phiSky = Math.atan2(this.dir.z, -this.dir.x);
    const sunDraw = n > 0.6 ? { az: phiSky, el: 0.75, color: 0xdfe8ff, size: 5 } : { az: phiSky, el: Math.max(0.03, el), color: mix(0xfff1d0, 0xff8a40, d), size: 9 + d * 8 };
    const tex = X.skyCanvas(top, horizon, ground, { sun: sunDraw, stars: Math.round(1400 * Math.max(0, n - 0.15)), haze: 0.22 * (1 - n) });
    const dm = this.dome.material as T.MeshBasicMaterial;
    dm.map?.dispose();
    dm.map = tex;
    dm.needsUpdate = true;
    this.scene.background = new T.Color(horizon);
    this.scene.fog = new T.FogExp2(horizon, 0.00078 * (1 + 0.5 * n));
    this.rt?.dispose();
    this.rt = this.pmrem.fromEquirectangular(tex);
    this.scene.environment = this.rt.texture;
    this.scene.environmentIntensity = 0.75 * (1 - 0.75 * n);
    this.hemi.color.set(mix(mix(0xcfe0ff, 0xffc49a, d), 0x3a4a7a, n));
    this.hemi.groundColor.set(mix(0xb08a5c, 0x1a1410, n));
    this.hemi.intensity = 1.15 * (1 - 0.72 * n);
    this.sun.color.set(n > 0.6 ? 0xa9bbff : mix(0xfff0d8, 0xff9a50, d));
    this.sun.intensity = n > 0.6 ? 0.55 : 3.1 * (1 - 0.4 * d) * (1 - n);
    for (const [m, a, b] of this.glows) m.opacity = a + (b - a) * n;
    for (const o of this.nightOnly) o.visible = n > 0.35;
  }
  follow(cam: T.Vector3) {
    this.dome.position.copy(cam);
    /* the haze is for the walker; from the air the whole map has to read */
    const f = this.scene.fog as T.FogExp2 | null;
    if (f) f.density = 0.00078 * (1 + 0.5 * this.night) * (1 - 0.82 * Math.min(1, Math.max(0, (cam.y - 20) / 300)));
    this.sun.target.position.set(cam.x, 0, cam.z);
    this.sun.position.set(cam.x + this.dir.x * 300, this.dir.y * 300, cam.z + this.dir.z * 300);
  }
}

/* ---------- build ---------- */
export function buildWorld(k: Kit, renderer: T.WebGLRenderer, opts: { quality: 'high' | 'low'; reduced: boolean }): WorldBuild {
  const high = opts.quality === 'high';
  const sky = new SkyRig(k.scene, renderer, high);
  const rnd = X.mulberry(2026);
  const [bx0, bx1, bz0, bz1] = D.bounds;
  const HALL = D.hall;
  const LK = D.lookout;

  /* ---------- materials ---------- */
  const soil = k.pbr('soil', X.soil(0xc4a27a, 31), 0.085, { roughness: 1 });
  const conc = k.pbr('bconc', X.boardConcrete(0xbfb8ab, 41), 0.42, { roughness: 0.92 });
  const floor = k.pbr('floorc', X.concrete(0xa9a398, 61), 0.25, { roughness: 0.55 });
  const brick = k.pbr('brick', X.brick(0x8d4b37, 3), 1.0, { roughness: 0.95 });
  const plaster = k.pbr('plaster', X.plaster(0xece8df, 11), 0.5, { roughness: 0.9 });
  const steel = k.flat(0x5d6168, 0.7, 0.4);
  const corten = k.flat(0x6e3b22, 0.45, 0.62, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const alu = k.flat(0xe4e7ea, 0.95, 0.2);
  const ink = k.flat(0x1a1a1a, 0.1, 0.6);
  const sienna = k.flat(0xa0522d, 0.05, 0.75);
  const bone = k.flat(0xf0ede6, 0, 0.72);
  const glass = k.glass(0xbfd6dd, 0.18, 0.08);
  const glowWarm = k.glow(0xfff1d8);
  const pool = X.pool();

  /* ---------- the desert ---------- */
  const groundSize = 5200;
  k.box(groundSize, 0.2, groundSize, (bx0 + bx1) / 2, -0.1, (bz0 + bz1) / 2, soil);

  /* the map drawn into the ground: each state an inlay of its own gravel, every line Cor-ten */
  const REG: Record<string, number[]> = {
    West: [0xd0a679, 0xc59a6c, 0xd8b388],
    South: [0xc08562, 0xb57a58, 0xcb916c],
    Midwest: [0xd6bf90, 0xcbb283, 0xdcc89c],
    Northeast: [0xb2a99a, 0xa79e8f, 0xbdb4a6],
  };
  const inlay = new Map<number, T.Material>();
  const inlayMat = (tint: number) => {
    let m = inlay.get(tint);
    if (!m) {
      m = k.pbr('inlay' + tint, X.soil(tint, 33 + (tint % 17)), 0.085, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      inlay.set(tint, m);
    }
    return m;
  };
  const linePos: number[] = [];
  const strip = (a: number[], b: number[], wdt: number, out: number[], y = 0.0) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * wdt / 2, nz = (dx / L) * wdt / 2;
    const p = [[a[0] + nx, a[1] + nz], [a[0] - nx, a[1] - nz], [b[0] - nx, b[1] - nz], [b[0] + nx, b[1] + nz]];
    for (const i of [0, 2, 1, 0, 3, 2]) out.push(p[i][0], y, p[i][1]);
  };
  PLACES.forEach((p, pi) => {
    const pal = REG[p.region] || REG.West;
    const tint = pal[(pi * 7 + p.usps.charCodeAt(0)) % pal.length];
    for (const ring of p.rings) {
      const sh = new T.Shape(ring.map(([x, z]) => new T.Vector2(x, -z)));
      const g = new T.ShapeGeometry(sh);
      g.rotateX(-Math.PI / 2);
      k.mesh(g, inlayMat(tint), 0, 0.0, 0);
      for (let i = 0; i < ring.length; i++) strip(ring[i], ring[(i + 1) % ring.length], 0.42, linePos);
    }
    if (!p.rings.length) {
      /* a territory: a round inlay with a Cor-ten edge, the way a wall map insets an island */
      const g = new T.CircleGeometry(19, 48);
      g.rotateX(-Math.PI / 2);
      k.mesh(g, inlayMat(pal[1]), p.cx, 0, p.cz);
      const ring: number[][] = [];
      for (let i = 0; i < 48; i++) ring.push([p.cx + Math.cos((i / 48) * Math.PI * 2) * 19, p.cz + Math.sin((i / 48) * Math.PI * 2) * 19]);
      for (let i = 0; i < ring.length; i++) strip(ring[i], ring[(i + 1) % ring.length], 0.42, linePos);
    }
  });
  /* the inset frames around Alaska, Hawaii and the territories, labelled */
  const insets: [number, number, number, number, string][] = [];
  const ak = PLACES.find((p) => p.usps === 'AK')!, hi = PLACES.find((p) => p.usps === 'HI')!;
  const ext = (p: Place) => {
    const xs = p.rings.flat().map((q) => q[0]), zs = p.rings.flat().map((q) => q[1]);
    return [Math.min(...xs) - 10, Math.max(...xs) + 10, Math.min(...zs) - 10, Math.max(...zs) + 10];
  };
  if (ak.rings.length) { const e = ext(ak); insets.push([e[0], e[1], e[2], e[3], Q('Alaska') + '  NOT TO SCALE']); }
  if (hi.rings.length) { const e = ext(hi); insets.push([e[0], e[1], e[2], e[3], Q('Hawaii') + '  NOT TO SCALE']); }
  for (const [x0, x1, z0, z1, txt] of insets) {
    const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s < L; s += 6) {          // dashed, like the printed map
        const t0 = s / L, t1 = Math.min(1, (s + 3.2) / L);
        strip([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1], 0.35, linePos);
      }
    }
    const lbl = k.mesh(new T.PlaneGeometry(26, 2.4), new T.MeshBasicMaterial({ map: word(txt, 1024, 96, '#3b2416', 54, { track: 6 }), transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), x0 + 14, 0.02, z1 + 2.2, true);
    lbl.rotation.x = -Math.PI / 2;
  }
  {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(linePos, 3));
    g.computeVertexNormals();
    k.mesh(g, corten, 0, 0.0, 0);
  }

  /* ---------- the walking lines: a minimum spanning tree over every door on the map ---------- */
  const nodes: { x: number; z: number }[] = [
    { x: HALL.x, z: HALL.z - HALL.l / 2 - 4 },
    { x: LK.x, z: LK.z + 9 },
    ...PLACES.map((p) => ({ x: p.x, z: p.z + p.l / 2 + 3 })),
  ];
  const edges: [number, number][] = [];
  {
    const inT = new Set([0]);
    const best = nodes.map((n) => Math.hypot(n.x - nodes[0].x, n.z - nodes[0].z));
    const from = nodes.map(() => 0);
    while (inT.size < nodes.length) {
      let bi = -1, bd = Infinity;
      for (let i = 0; i < nodes.length; i++) if (!inT.has(i) && best[i] < bd) { bd = best[i]; bi = i; }
      inT.add(bi);
      edges.push([from[bi], bi]);
      for (let i = 0; i < nodes.length; i++) {
        const d = Math.hypot(nodes[i].x - nodes[bi].x, nodes[i].z - nodes[bi].z);
        if (!inT.has(i) && d < best[i]) { best[i] = d; from[i] = bi; }
      }
    }
  }
  const pathPos: number[] = [];
  for (const [a, b] of edges) strip([nodes[a].x, nodes[a].z], [nodes[b].x, nodes[b].z], 2.4, pathPos, 0.0);
  {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pathPos, 3));
    g.computeVertexNormals();
    const dg = k.pbr('dg', X.soil(0xe2d2b4, 37), 0.2, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 });
    k.mesh(g, dg, 0, 0, 0);
  }
  /* bollards along the lines, glowing tops after dark */
  {
    const tops: T.Matrix4[] = [], posts: T.Matrix4[] = [];
    for (const [a, b] of edges) {
      const L = Math.hypot(nodes[b].x - nodes[a].x, nodes[b].z - nodes[a].z);
      const nx = (nodes[b].z - nodes[a].z) / L, nz = -(nodes[b].x - nodes[a].x) / L;
      for (let s = 12; s < L - 8; s += 26) {
        const t = s / L, x = nodes[a].x + (nodes[b].x - nodes[a].x) * t + nx * 1.7, z = nodes[a].z + (nodes[b].z - nodes[a].z) * t + nz * 1.7;
        posts.push(new T.Matrix4().makeTranslation(x, 0.45, z));
        tops.push(new T.Matrix4().makeTranslation(x, 0.93, z));
      }
    }
    k.instances(new T.CylinderGeometry(0.09, 0.11, 0.9, 8), k.flat(0x2a2522, 0.5, 0.5), posts);
    const topMat = new T.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.35 });
    sky.glows.push([topMat, 0.35, 1]);
    k.instances(new T.CylinderGeometry(0.1, 0.1, 0.07, 8), topMat, tops);
  }

  /* ---------- hanging ---------- */
  const hung: Hung[] = [];
  const washMat = new T.MeshBasicMaterial({ map: pool, transparent: true, opacity: 0.25, blending: T.AdditiveBlending, depthWrite: false });
  sky.glows.push([washMat, 0.18, 0.75]);
  const hang = (place: Place, wi: number, at: T.Vector3, target: T.Vector3, mw: number, mh: number, frame: 'gap' | 'steel' | 'none') => {
    const work = WORKS[wi];
    const ar = work.ar || 1;
    let w = Math.min(mw, mh * ar);
    let h = w / ar;
    if (h > mh) { h = mh; w = h * ar; }
    const g = new T.Group();
    g.position.copy(at);
    g.rotation.y = Math.atan2(target.x - at.x, target.z - at.z);
    let z = 0.02;
    if (frame === 'gap') {
      const back = new T.Mesh(new T.BoxGeometry(w + 0.06, h + 0.06, 0.05), k.flat(0x1c1b19, 0.1, 0.7));
      back.position.z = 0.025;
      g.add(back);
      z = 0.056;
    } else if (frame === 'steel') {
      const f = new T.Mesh(new T.BoxGeometry(w + 0.1, h + 0.1, 0.06), k.flat(0x2b2d31, 0.7, 0.35));
      f.position.z = 0.03;
      g.add(f);
      z = 0.062;
    }
    const col = new T.Color().setHSL((work.hue || 20) / 360, 0.22, 0.3);
    const mat = new T.MeshBasicMaterial({ color: col, toneMapped: false });
    const art = new T.Mesh(new T.PlaneGeometry(w, h), mat);
    art.position.z = z;
    art.userData.hung = hung.length;
    g.add(art);
    const wash = new T.Mesh(new T.PlaneGeometry(Math.min(w * 1.7, mw + 0.6), Math.min(h * 1.9, mh + 0.8)), washMat);
    wash.position.z = 0.006;
    wash.renderOrder = 1;
    g.add(wash);
    k.add(g);
    const lx = w / 2 + 0.42;
    const H: Hung = { i: wi, work, place, g, art, mat, w, h, pos: at.clone(), target: target.clone(), label: null, labelAt: { x: lx, y: 1.32 - at.y, w: 0.52, h: 0.36 }, lod: 0, want: 0, busy: false, stop: null, url: null };
    hung.push(H);
    return H;
  };

  /* ---------- pavilions ---------- */
  const pavs: Pav[] = [];
  const pickMat = new T.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
  const mouthPools: T.Matrix4[] = [];
  const R = 0.42;   // the visitor's body, added to every wall's block

  /* signs and labels are many small draw calls; each belongs to a place so it can sleep when nobody is near */
  let sink: T.Object3D[] | null = null;
  const hallDecor: T.Object3D[] = [];
  const signAt = (tex: T.Texture, w: number, h: number, x: number, y: number, z: number, rotY: number) => {
    const m = k.mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, transparent: true, color: 0xdedede }), x, y, z, true);
    m.rotation.y = rotY;
    sink?.push(m);
    return m;
  };
  const plaque = (p: Place, x: number, z: number, rotY: number) => {
    const n = p.works.length;
    k.cyl(0.05, 1.1, x, 0.55, z, steel);
    const tex = card([
      { t: Q(p.name), size: 46, weight: '700', gap: 6 },
      { t: `${p.artists.length} ${p.artists.length === 1 ? 'ARTIST' : 'ARTISTS'}  ·  ${n} ${n === 1 ? 'WORK' : 'WORKS'}`, size: 22, color: SIENNA, weight: '600', gap: 18, track: 2 },
      ...p.artists.slice(0, 9).map((a) => ({ t: a, size: 25, color: INK, gap: 4 })),
      ...(p.artists.length > 9 ? [{ t: `+ ${p.artists.length - 9} more`, size: 22, color: MUTED }] : []),
      { t: 'FONDAZIONE AVERSANO · 50 STATES', size: 17, color: MUTED, weight: '600', gap: 0, track: 2 },
    ], 512, 600);
    const b = k.box(0.86, 1.0, 0.05, x, 1.55, z, ink);
    b.rotation.y = rotY;
    const f = signAt(tex, 0.82, 0.96, x + Math.sin(rotY) * 0.03, 1.55, z + Math.cos(rotY) * 0.03, rotY);
    void f;
    k.keepOut.push({ x, z, r: 0.55 });
  };

  for (const p of PLACES) {
    const { x, z, w: W, l: L } = p;
    const n = p.works.length;
    const pav: Pav = { place: p, x, z, w: W, l: L, kind: p.kind, mouth: v(x, 0, z + L / 2 + 5), enter: v(x, 0, z + L / 2 - 1.5), look: v(x, 1.6, z - L), pick: null as unknown as T.Mesh, hung: [], decor: [] };
    sink = pav.decor;
    const isBox = p.kind === 'box';
    const t = isBox ? 0.3 : 0.5, H = isBox ? 3.4 : 4.2;
    if (isBox) {
      const lin = 0.8, slot = 1.1, half = (W - slot) / 2;
      k.box(t, H, L, x - W / 2 + t / 2, H / 2, z, conc);
      k.box(t, H, L, x + W / 2 - t / 2, H / 2, z, conc);
      k.box(half, 0.3, L, x - slot / 2 - half / 2, H + 0.15, z, conc);
      k.box(half, 0.3, L, x + slot / 2 + half / 2, H + 0.15, z, conc);
      for (const s of [-1, 1]) k.box(W - 2 * t, lin, t, x, H - lin / 2, z + s * (L / 2 - t / 2), conc);
      k.box(W - 2 * t, 0.06, L, x, 0.03, z, floor);
      for (const s of [-1, 1]) k.box(0.12, 0.04, L - 0.6, x + s * (slot / 2 + 0.12), H - 0.02, z, glowWarm);
      k.block(x - W / 2 - R, x - W / 2 + t + R, z - L / 2 - R, z + L / 2 + R);
      k.block(x + W / 2 - t - R, x + W / 2 + R, z - L / 2 - R, z + L / 2 + R);
      /* the name cut into each lintel, outside */
      for (const s of [-1, 1]) {
        signAt(word(Q(p.name), 1024, 128, '#2a2622', 70, { track: 6 }), W * 0.86, W * 0.86 * 0.125, x, H - lin / 2, z + s * (L / 2 + 0.012), s > 0 ? 0 : Math.PI);
      }
      if (!p.bays.some((b) => b.side > 0)) signAt(word(Q(p.name), 1024, 160, '#2a2622', 96, { track: 4 }), Math.min(4.6, L - 2), Math.min(4.6, L - 2) / 6.4, x + W / 2 - t - 0.01, 2.0, z, -Math.PI / 2);
      plaque(p, x + W / 2 + 1.3, z + L / 2 + 1.6, 0.35);
    } else {
      /* an artillery shed: brick walls, a Quonset vault, an open nave lined with artist alcoves */
      const rise = 4.4, door = 6.4, doorH = 3.4;
      k.box(t, H, L, x - W / 2 + t / 2, H / 2, z, brick);
      k.box(t, H, L, x + W / 2 - t / 2, H / 2, z, brick);
      for (const s of [-1, 1]) {
        const ez = z + s * (L / 2 - t / 2), pw = (W - door) / 2;
        k.box(pw, H, t, x - door / 2 - pw / 2, H / 2, ez, brick);
        k.box(pw, H, t, x + door / 2 + pw / 2, H / 2, ez, brick);
        k.box(door, H - doorH, t, x, (H + doorH) / 2, ez, brick);
        const sh = new T.Shape();
        sh.absellipse(0, 0, W / 2, rise, 0, Math.PI, false);
        const gg = k.mesh(new T.ShapeGeometry(sh, 32), glass, x, H, ez, true);
        gg.rotation.y = s > 0 ? 0 : Math.PI;
        for (let m = -3; m <= 3; m++) {
          const mx = (m / 3.6) * (W / 2), my = rise * Math.sqrt(Math.max(0, 1 - (mx / (W / 2)) ** 2));
          if (my > 0.2) k.box(0.08, my, 0.08, x + mx, H + my / 2, ez, steel);
        }
        k.block(x - W / 2 - R, x - door / 2 + R, ez - t / 2 - R, ez + t / 2 + R);
        k.block(x + door / 2 - R, x + W / 2 + R, ez - t / 2 - R, ez + t / 2 + R);
        signAt(word(Q(p.name), 1024, 128, BONE, 72, { track: 6 }), door * 0.95, door * 0.95 * 0.125, x, (H + doorH) / 2, ez + s * (t / 2 + 0.012), s > 0 ? 0 : Math.PI);
      }
      vault(x, z, W, L, H, rise);
      k.box(W - 2 * t, 0.06, L - 2 * t, x, 0.03, z, floor);
      k.block(x - W / 2 - R, x - W / 2 + t + R, z - L / 2, z + L / 2);
      k.block(x + W / 2 - t - R, x + W / 2 + R, z - L / 2, z + L / 2);
      for (const dx of [-W / 4, 0, W / 4]) k.box(0.18, 0.05, L - 4, x + dx, H + (dx === 0 ? rise - 0.12 : rise * 0.82), z, glowWarm);
      /* the introduction wall just inside the south door: every artist in the room, by name */
      const iz = z + L / 2 - 3.6;
      k.box(4.4, 2.9, 0.24, x, 1.45, iz, plaster);
      k.block(x - 2.2 - R, x + 2.2 + R, iz - 0.12 - R, iz + 0.12 + R);
      const intro = card([
        { t: Q(p.name), size: 70, weight: '700', gap: 8 },
        { t: `${p.artists.length} ${p.artists.length === 1 ? 'ARTIST' : 'ARTISTS'}  \u00B7  ${n} WORKS`, size: 30, color: SIENNA, weight: '600', gap: 26, track: 3 },
        { t: p.artists.join('  \u00B7  '), size: p.artists.length > 12 ? 30 : 36, gap: 20 },
        { t: 'EACH ARTIST HAS A BAY OF THEIR OWN. WALK THE NAVE.', size: 20, color: MUTED, weight: '600', track: 3 },
      ], 1024, 680, BONE, SIENNA);
      for (const s of [-1, 1]) signAt(intro, 4.0, 4.0 * 680 / 1024, x, 1.55, iz + s * 0.125, s > 0 ? 0 : Math.PI);
      plaque(p, x + door / 2 + 1.6, z + L / 2 + 2.0, 0.3);
    }

    /* ---------- the artists' bays ---------- */
    const finD = isBox ? 0.9 : 2.2, finH = isBox ? H : 3.9, slot = isBox ? 3.9 : 4.6, pad = isBox ? 0.9 : 1.2;
    const artY = isBox ? 1.62 : 1.95, mh = isBox ? 2.0 : 2.5, headY = isBox ? 2.98 : 3.62, headH = isBox ? 0.4 : 0.5;
    const finMat = isBox ? conc : plaster;
    const finsDone = new Set<string>();
    const zOf = (s: number) => z + L / 2 - s;
    for (const b of p.bays) {
      const side = b.side;
      const wx = side < 0 ? x - W / 2 + t : x + W / 2 - t;
      const zs = zOf(b.s0), zn = zOf(b.s1);
      for (const zf of [zs, zn]) {
        const key = side + ':' + zf.toFixed(2);
        if (finsDone.has(key)) continue;
        finsDone.add(key);
        const fx = wx - side * finD / 2;
        k.box(finD, finH, 0.2, fx, finH / 2, zf, finMat);
        k.block(fx - finD / 2 - R, fx + finD / 2 + R, zf - 0.1 - R, zf + 0.1 + R);
      }
      const rotY = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      b.works.forEach((wi, j) => {
        const zz = zs - pad / 2 - slot / 2 - j * slot;
        pav.hung.push(hang(p, wi, v(wx - side * 0.005, artY, zz), v(wx - side * 3.2, 1.6, zz), slot - 1.2, mh, isBox ? 'gap' : 'steel'));
      });
      /* the artist's name over their work, in the house title panel */
      const bw = Math.min(zs - zn - pad - 0.2, isBox ? 3.6 : 4.4);
      const nWorks = p.works.filter((wi) => WORKS[wi].artist === b.artist).length;
      const head = canvasTex(1024, Math.round(1024 * headH / bw), (g) => {
        const hh = g.canvas.height;
        g.fillStyle = BONE;
        g.fillRect(0, 0, 1024, hh);
        g.fillStyle = SIENNA;
        g.fillRect(0, 0, 1024, Math.max(4, hh * 0.04));
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = INK;
        let size = Math.min(hh * 0.46, 92);
        g.font = `700 ${size}px ${SANS}`;
        while (g.measureText(b.artist).width > 940 && size > 20) { size -= 2; g.font = `700 ${size}px ${SANS}`; }
        g.fillText(b.artist, 512, hh * 0.42);
        g.fillStyle = SIENNA;
        g.font = `600 ${Math.min(hh * 0.17, 30)}px ${SANS}`;
        if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '4px';
        g.fillText(`${nWorks} ${nWorks === 1 ? 'WORK' : 'WORKS'}  \u00B7  ${p.name.toUpperCase()}`, 512, hh * 0.8);
      });
      signAt(head, bw, headH, wx - side * 0.02, headY, (zs + zn) / 2, rotY);
    }
    if (!isBox) { pav.enter = v(x, 0, z + L / 2 - 2); pav.look = v(x, 1.6, z - L); }
    /* light spilling out of both mouths after dark */
    for (const s of [-1, 1]) {
      const m = new T.Matrix4().compose(v(x, 0.02, z + s * (L / 2 + 2.4)), new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0)), v(W * 0.9, 4.8, 1));
      mouthPools.push(m);
    }
    /* an invisible box the overview can click */
    const pick = new T.Mesh(new T.BoxGeometry(W + 6, 10, L + 6), pickMat);
    pick.position.set(x, 4, z);
    pick.visible = false;
    pick.userData.pav = pavs.length;
    k.scene.add(pick);
    pav.pick = pick;
    pavs.push(pav);
  }
  {
    const m = new T.MeshBasicMaterial({ map: pool, color: 0xffcf8a, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
    sky.glows.push([m, 0.0, 0.8]);
    k.instances(new T.PlaneGeometry(1, 1), m, mouthPools).renderOrder = 2;
  }

  function vault(x: number, z: number, W: number, L: number, H: number, rise: number) {
    const g = new T.CylinderGeometry(W / 2, W / 2, L, 48, 1, true, Math.PI / 2, Math.PI);
    g.rotateX(Math.PI / 2);
    g.scale(1, rise / (W / 2), 1);
    const s = X.corrugated(0xaab2b6, 51);
    const map = s.map.clone(), nrm = s.normalMap!.clone();
    for (const t of [map, nrm]) { t.repeat.set(1, L / 1.6); t.needsUpdate = true; }
    const m = new T.MeshStandardMaterial({ map, normalMap: nrm, metalness: 0.55, roughness: 0.42, side: T.DoubleSide });
    k.mesh(g, m, x, H, z, true);
  }

  /* ---------- the hall: an artillery shed in Marfa, reborn as the arrival ---------- */
  const dir: DirBox[] = [];
  sink = null;
  {
    const { x, z, w: W, l: L } = HALL;
    const t = 0.5, H = 4.8, rise = 5.2, sill = 0.9, door = 8;
    // long walls: brick sill, then Judd's continuous glazing
    for (const s of [-1, 1]) {
      const wx = x + s * (W / 2 - t / 2);
      k.box(t, sill, L, wx, sill / 2, z, brick);
      k.box(t, 0.5, L, wx, H - 0.25, z, brick);
      const pane = k.mesh(new T.PlaneGeometry(L, H - sill - 0.5), glass, wx, (H - 0.5 + sill) / 2, z, true);
      pane.rotation.y = Math.PI / 2;
      for (let m = 0; m <= Math.round(L / 3); m++) k.box(0.1, H - sill - 0.5, 0.1, wx, (H - 0.5 + sill) / 2, z - L / 2 + m * (L / Math.round(L / 3)), steel);
      k.block(x + s * (W / 2) - R - (s > 0 ? t : 0), x + s * (W / 2) + R + (s < 0 ? t : 0), z - L / 2, z + L / 2);
    }
    // ends: brick piers either side of a wide door, glass over everything
    for (const s of [-1, 1]) {
      const ez = z + s * (L / 2 - t / 2), pw = (W - door) / 2;
      k.box(pw, H, t, x - door / 2 - pw / 2, H / 2, ez, brick);
      k.box(pw, H, t, x + door / 2 + pw / 2, H / 2, ez, brick);
      k.box(door, 1.1, t, x, H - 0.55, ez, brick);
      const sh = new T.Shape();
      sh.absellipse(0, 0, W / 2, rise, 0, Math.PI, false);
      const gg = k.mesh(new T.ShapeGeometry(sh, 40), glass, x, H, ez, true);
      gg.rotation.y = s > 0 ? 0 : Math.PI;
      for (let m = -4; m <= 4; m++) {
        const mx = (m / 4.5) * (W / 2), my = rise * Math.sqrt(Math.max(0, 1 - (mx / (W / 2)) ** 2));
        if (my > 0.2) k.box(0.1, my, 0.1, x + mx, H + my / 2, ez, steel);
      }
      k.block(x - W / 2 - R, x - door / 2 + R, ez - t / 2 - R, ez + t / 2 + R);
      k.block(x + door / 2 - R, x + W / 2 + R, ez - t / 2 - R, ez + t / 2 + R);
    }
    vault(x, z, W, L, H, rise);
    k.box(W - 2 * t, 0.06, L - 2 * t, x, 0.03, z, floor);
    for (const dx of [-W / 3, 0, W / 3]) k.box(0.2, 0.05, L - 4, x + dx, H + (dx === 0 ? rise - 0.15 : rise * 0.74), z, glowWarm);

    // outside the south door: the Foundation's crest and name on the fascia
    const fasZ = z + L / 2 + 0.02;
    const crest = k.mesh(new T.PlaneGeometry(3.3, 3.2), k.image('assets/brand/fa_ink.png'), x, H + 2.0, fasZ + 0.06, true);
    void crest;
    k.mesh(new T.CircleGeometry(2.05, 64), bone, x, H + 2.0, fasZ + 0.04, true);
    signAt(word('FONDAZIONE AVERSANO', 1024, 120, BONE, 80, { track: 14 }), door * 0.96, door * 0.96 * 0.117, x, H - 0.55, fasZ + 0.26, 0);
    signAt(word(Q('50 States') + '  ·  THE FIELD  ·  MARFA, TEXAS', 1024, 80, '#3b2416', 40, { track: 8 }), 9.5, 0.74, x, 0.55, z + L / 2 + 0.28 + 0.01, 0);

    // inside, over the north door: the sienna beam and its line, and the crest in the glass
    const bz = z - L / 2 + t + 0.3;
    k.box(door + 1.2, 0.9, 0.36, x, H - 1.55, bz, sienna);
    signAt(word(Q('America, seen through its artists'), 1024, 110, BONE, 64, { track: 5 }), door + 0.9, (door + 0.9) * 0.107, x, H - 1.55, bz + 0.19, 0);
    k.mesh(new T.CircleGeometry(1.75, 64), bone, x, H + 2.15, bz - 0.25, true);
    k.mesh(new T.PlaneGeometry(2.85, 2.76), k.image('assets/brand/fa_ink.png'), x, H + 2.15, bz - 0.23, true);

    // the wall behind the arrival: who, what, how many
    const st = D.stats;
    const credits = card([
      { t: 'FONDAZIONE AVERSANO', size: 58, weight: '700', gap: 4, track: 6 },
      { t: 'PROGRAM ONE  ·  50 STATES', size: 30, color: SIENNA, weight: '600', gap: 30, track: 4 },
      { t: `${st.artists} artists. ${st.works} works. ${st.states} of 50 states, with Washington DC, Puerto Rico, Guam and Midway. Every acquisition recorded on ${st.chains.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`, size: 34, gap: 26 },
      { t: '“My family’s foundation is rooted in the power of art to care, connect, and heal.”', size: 34, weight: '600', gap: 6 },
      { t: 'JUSTIN AVERSANO, FOUNDER AND PRESIDENT', size: 22, color: MUTED, weight: '600', gap: 34, track: 3 },
      { t: 'ART LEADS THE WAY.', size: 30, weight: '700', color: SIENNA, gap: 8, track: 4 },
      { t: 'THE FIELD  ·  A VIRTUAL GALLERY BY MLOW', size: 20, color: MUTED, weight: '600', track: 4 },
    ], 1024, 800);
    const cw = 6.4;
    signAt(credits, cw, cw * 800 / 1024, x - door / 2 - (W - door) / 4, 2.6, z + L / 2 - t - 0.012, Math.PI);
    signAt(word('WALK NORTH  →  ALL FIFTY', 1024, 90, SIENNA, 56, { track: 8 }), 5.0, 0.44, x + door / 2 + (W - door) / 4, 2.6, z + L / 2 - t - 0.012, Math.PI);

    /* the directory: Judd's aluminum boxes, one per place, its first work under glass on the lid */
    const byName = PLACES.slice().sort((a, b) => a.name.localeCompare(b.name));
    /* Lecterns, after the client's sketch: low at the front, high at the back, the work laid on the
       slope so it faces you as you walk the nave. Nothing rises above 1.25 m, so the hall stays open
       end to end. Two rows face a clear central nave; A to M on the west, the rest on the east. */
    const plinth = k.flat(0xeeebe5, 0, 0.82);
    const per = Math.ceil(byName.length / 2), pitchZ = 1.55, LO = 0.78, HI = 1.25, DEP = 0.9, WID = 1.3;
    const lect = (f: number) => {
      const sh = new T.Shape([new T.Vector2(-DEP / 2, 0), new T.Vector2(DEP / 2, 0), new T.Vector2(DEP / 2, f > 0 ? LO : HI), new T.Vector2(-DEP / 2, f > 0 ? HI : LO)]);
      const g = new T.ExtrudeGeometry(sh, { depth: WID, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 });
      g.translate(0, 0, -WID / 2);
      return g;
    };
    const COLS = 4, CW = 512, CH = 200, rowsA = Math.ceil(byName.length / COLS);
    const atlas = canvasTex(CW * COLS, CH * rowsA, (g) => {
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      byName.forEach((p, i) => {
        const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
        g.fillStyle = '#262626';
        let size = 50;
        g.font = `700 ${size}px ${SANS}`;
        if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '5px';
        while (g.measureText(p.name.toUpperCase()).width > CW * 0.92 && size > 24) { size -= 2; g.font = `700 ${size}px ${SANS}`; }
        g.fillText(p.name.toUpperCase(), cx + CW / 2, cy + CH * 0.36);
        g.fillStyle = SIENNA;
        g.font = `600 28px ${SANS}`;
        if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '3px';
        const na = p.artists.length, nw = p.works.length;
        g.fillText(`${na} ${na === 1 ? 'ARTIST' : 'ARTISTS'}  \u00B7  ${nw} ${nw === 1 ? 'WORK' : 'WORKS'}`, cx + CW / 2, cy + CH * 0.72);
      });
    });
    const lp: number[] = [], lu: number[] = [];
    const quad = (c: T.Vector3[], u0: number, v0: number, u1: number, v1: number) => {
      for (const [i, uu, vv] of [[0, u0, v1], [1, u0, v0], [2, u1, v0], [0, u0, v1], [2, u1, v0], [3, u1, v1]] as [number, number, number][]) {
        lp.push(c[i].x, c[i].y, c[i].z);
        lu.push(uu, vv);
      }
    };
    const rows = [
      { f: 1, x: x - 3.4, mesh: new T.InstancedMesh(lect(1), plinth, per), ids: [] as number[] },
      { f: -1, x: x + 3.4, mesh: new T.InstancedMesh(lect(-1), plinth, byName.length - per), ids: [] as number[] },
    ];
    const slopeLen = Math.hypot(DEP, HI - LO);
    byName.forEach((p, i) => {
      const row = rows[i < per ? 0 : 1], j = i < per ? i : i - per, f = row.f;
      const bx = row.x, bzz = z + L / 2 - 6 - j * pitchZ;
      row.mesh.setMatrixAt(j, new T.Matrix4().makeTranslation(bx, 0, bzz));
      row.ids.push(dir.length);
      /* the work on the slope: right is along -f z, up runs up the slope toward the back */
      const right = v(0, 0, -f), up = v(-f * DEP, HI - LO, 0).normalize(), nrm = new T.Vector3().crossVectors(right, up);
      const top = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: new T.Color().setHSL(((WORKS[p.works[0]]?.hue) || 20) / 360, 0.2, 0.3), toneMapped: false }));
      top.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(right, up, nrm));
      top.position.set(bx, (LO + HI) / 2 + 0.02, bzz).addScaledVector(nrm, 0.012);
      const fw = WID - 0.14, fh = slopeLen - 0.16;
      top.scale.set(fw, fh, 1);
      top.userData.dir = dir.length;
      top.userData.fit = [fw, fh];
      k.add(top);
      hallDecor.push(top);
      /* the name and the count on the low front face, read from the nave */
      const xf = bx + f * (DEP / 2 + 0.018), zl = bzz + f * 0.6, zr = bzz - f * 0.6;
      const cu = (i % COLS) / COLS, cu1 = cu + 1 / COLS, rr = Math.floor(i / COLS);
      const v1 = 1 - rr / rowsA, v0 = 1 - (rr + 1) / rowsA;
      quad([v(xf, 0.68, zl), v(xf, 0.21, zl), v(xf, 0.21, zr), v(xf, 0.68, zr)], cu, v0, cu1, v1);
      k.block(bx - DEP / 2 - 0.3, bx + DEP / 2 + 0.3, bzz - WID / 2 - 0.3, bzz + WID / 2 + 0.3);
      dir.push({ mesh: row.mesh as unknown as T.Mesh, top, place: p });
    });
    for (const r of rows) {
      r.mesh.instanceMatrix.needsUpdate = true;
      r.mesh.userData.ids = r.ids;
      r.mesh.computeBoundingSphere();
      k.add(r.mesh);
    }
    {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(lp, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(lu, 2));
      g.computeVertexNormals();
      const words = new T.Mesh(g, new T.MeshBasicMaterial({ map: atlas, transparent: true, side: T.DoubleSide, color: 0xdedede }));
      k.add(words);
      hallDecor.push(words);
    }
    // practicals so the hall reads at night
    for (const dz of [-L / 3, 0, L / 3]) {
      const l = k.point(x, H + 2, z + dz, 0xffe2b8, 0, 26, 1.6);
      sky.nightOnly.push(l);
      l.intensity = 22;
    }
  }

  /* ---------- Arsham: one of Judd's concrete units, excavated a thousand years from now ---------- */
  {
    const cx = HALL.x, cz = HALL.z - HALL.l / 2 - 13;
    const vox = 0.25, nx = 10, ny = 10, nz = 20;           // 2.5 x 2.5 x 5 m, Judd's unit
    const mats: T.Matrix4[] = [], cryst: T.Matrix4[] = [];
    const corner = v(1.6, 2.6, -1.4);
    const rr = X.mulberry(3026);
    for (let ix = 0; ix < nx; ix++)
      for (let iy = 0; iy < ny; iy++)
        for (let iz = 0; iz < nz; iz++) {
          const shell = ix === 0 || ix === nx - 1 || iy === 0 || iy === ny - 1;
          if (!shell) continue;
          const px = (ix - (nx - 1) / 2) * vox, py = iy * vox + vox / 2, pz = (iz - (nz - 1) / 2) * vox;
          const d = Math.hypot(px - corner.x, py - corner.y, (pz - corner.z) * 0.7);
          const n = Math.sin(px * 5.1 + pz * 2.3) * 0.25 + Math.sin(py * 4.7 - pz * 3.1) * 0.25 + rr() * 0.35;
          const erode = 2.2 - d + n;
          if (erode > 0.55) {
            if (erode < 0.85 && rr() > 0.35) {
              const q = new T.Quaternion().setFromEuler(new T.Euler(rr() * 2 - 1, rr() * 6, rr() * 2 - 1));
              const sc = 0.45 + rr() * 0.7;
              cryst.push(new T.Matrix4().compose(v(cx + px * 0.92, py - 0.05, cz + pz), q, v(sc, sc * (0.8 + rr() * 0.7), sc)));
            }
            continue;
          }
          const s = erode > 0.25 ? 0.6 + rr() * 0.35 : 1;
          mats.push(new T.Matrix4().compose(v(cx + px, py, cz + pz), new T.Quaternion(), v(s, s, s)));
        }
    k.instances(new T.BoxGeometry(vox, vox, vox), k.flat(0xc4beb2, 0, 0.95), mats);
    const cg = new T.CylinderGeometry(0.0, 0.07, 0.42, 6);
    cg.translate(0, 0.21, 0);
    k.instances(cg, k.flat(0x7fd4ff, 0.1, 0.18, { emissive: 0x2f9be0, emissiveIntensity: 0.9 }), cryst);
    k.block(cx - 1.25 - R, cx + 1.25 + R, cz - 2.5 - R, cz + 2.5 + R);
    const tex = card([
      { t: Q('Untitled (concrete), 3026'), size: 40, weight: '700', gap: 10 },
      { t: 'One of the fifty, as it will be found a thousand years from now: the concrete worn through to blue calcite.', size: 25, gap: 12 },
      { t: 'AFTER JUDD, CHINATI, 1980–84  ·  AFTER ARSHAM', size: 18, color: MUTED, weight: '600', track: 2 },
    ], 512, 400);
    k.cyl(0.05, 1.05, cx + 2.6, 0.52, cz + 2.8, steel);
    k.box(0.74, 0.58, 0.05, cx + 2.6, 1.3, cz + 2.8, ink);
    signAt(tex, 0.7, 0.55, cx + 2.6, 1.3, cz + 2.83, 0);
    k.keepOut.push({ x: cx + 2.6, z: cz + 2.8, r: 0.5 });
  }

  /* ---------- Hadid: the ribbon at the middle of the country ---------- */
  const lookout = v(LK.x, 0, LK.z);
  let lookoutPick: T.Mesh;
  {
    const { x, z } = LK;
    const white = k.flat(0xf3f1ec, 0, 0.55, { side: T.DoubleSide });
    k.cyl(1.5, 34, x, 17, z, white, 1.1, 32);
    const turns = 3.25, rise = 30, inner = 1.9, outer = 6.6, seg = 320;
    const pos: number[] = [], idx: number[] = [];
    const edge: T.Vector3[] = [];
    for (let i = 0; i <= seg; i++) {
      const u = i / seg, a = u * turns * Math.PI * 2, y = 2.5 + u * rise;
      const swell = 1 + 0.18 * Math.sin(u * Math.PI * 3);
      pos.push(Math.cos(a) * inner + x, y, Math.sin(a) * inner + z);
      pos.push(Math.cos(a) * outer * swell + x, y + 0.9, Math.sin(a) * outer * swell + z);
      if (i % 4 === 0) edge.push(v(Math.cos(a) * outer * swell + x, y + 0.95, Math.sin(a) * outer * swell + z));
      if (i < seg) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    k.mesh(g, white, 0, 0, 0, true);
    k.curve(edge, 0.14, k.flat(0xf3f1ec, 0, 0.5), 400);
    k.cyl(7.4, 0.5, x, 33.2, z, white, 7.4, 48);
    k.torus(7.3, 0.06, x, 34.3, z, steel, 64).rotation.x = Math.PI / 2;
    k.cyl(7.8, 0.3, x, 0.15, z, conc, 7.8, 48);
    k.keepOut.push({ x, z, r: 8.3 });
    const tex = card([
      { t: Q('The middle'), size: 52, weight: '700', gap: 8 },
      { t: 'The geographic center of the contiguous United States, near Lebanon, Kansas.', size: 27, gap: 14 },
      { t: 'TAP THE TOWER TO SEE ALL FIFTY FROM ABOVE', size: 20, color: SIENNA, weight: '700', track: 3 },
    ], 512, 320);
    k.cyl(0.05, 1.05, x, 0.52, z + 9.4, steel);
    k.box(0.9, 0.58, 0.05, x, 1.32, z + 9.4, ink);
    signAt(tex, 0.86, 0.54, x, 1.32, z + 9.43, 0);
    k.keepOut.push({ x, z: z + 9.4, r: 0.5 });
    lookoutPick = new T.Mesh(new T.CylinderGeometry(7.5, 7.5, 36, 12), pickMat);
    lookoutPick.position.set(x, 18, z);
    lookoutPick.visible = false;
    k.scene.add(lookoutPick);
  }

  /* ---------- the Union Pacific Sunset Route, which really does run through Marfa ---------- */
  const TRACK_Z = 292;
  const trackX0 = bx0 - 500, trackX1 = bx1 + 500;
  {
    k.box(trackX1 - trackX0, 0.18, 4.2, (trackX0 + trackX1) / 2, 0.09, TRACK_Z, k.pbr('ballast', X.soil(0x6f6a64, 71), 0.6, { roughness: 1 }));
    for (const s of [-0.72, 0.72]) k.box(trackX1 - trackX0, 0.14, 0.09, (trackX0 + trackX1) / 2, 0.3, TRACK_Z + s, k.flat(0x6a6058, 0.8, 0.4));
    const ties: T.Matrix4[] = [];
    for (let tx = Math.max(trackX0, bx0 - 200); tx < Math.min(trackX1, bx1 + 200); tx += 0.7) ties.push(new T.Matrix4().makeTranslation(tx, 0.2, TRACK_Z));
    k.instances(new T.BoxGeometry(0.24, 0.1, 2.6), k.flat(0x3e342c, 0, 0.95), ties);
  }
  const train = new T.Group();
  {
    const yellow = k.flat(0xd8ad38, 0.2, 0.55), grey = k.flat(0x8d918f, 0.4, 0.5), rust = k.flat(0x7a3b28, 0.3, 0.8), dark = k.flat(0x232323, 0.5, 0.6);
    const boxc = [0x7a3b28, 0x2f4f6f, 0x9a8a5a, 0x5a2a2a, 0x3b5a3b, 0xb0471f, 0x6d6d6d, 0x1f3550];
    const add = (geo: T.BufferGeometry, m: T.Material, px: number, py: number, pz = 0) => { const o = new T.Mesh(geo, m); o.position.set(px, py, pz); o.castShadow = high; train.add(o); };
    let off = 0;
    for (let l = 0; l < 2; l++) {
      add(new T.BoxGeometry(21, 3.4, 3.1), yellow, off + 10.5, 2.6);
      add(new T.BoxGeometry(4, 1.0, 3.1), grey, off + 2.6, 4.75);
      add(new T.BoxGeometry(21, 0.9, 2.6), dark, off + 10.5, 0.75);
      off += 22;
    }
    const cr = X.mulberry(7);
    for (let c = 0; c < 34; c++) {
      const col = k.flat(boxc[Math.floor(cr() * boxc.length)], 0.25, 0.75);
      if (cr() > 0.45) {
        add(new T.BoxGeometry(18, 2.6, 2.6), col, off + 9, 1.9);
        add(new T.BoxGeometry(16, 2.6, 2.6), k.flat(boxc[Math.floor(cr() * boxc.length)], 0.25, 0.75), off + 9, 4.55);
      } else add(new T.BoxGeometry(18, 3.6, 3.0), c % 3 === 0 ? rust : col, off + 9, 2.4);
      add(new T.BoxGeometry(18, 0.7, 2.4), dark, off + 9, 0.6);
      off += 19.4;
    }
    train.position.set(trackX1, 0, TRACK_Z);
    k.add(train);
    if (!opts.reduced) k.ticks.push((_t, dt) => {
      train.position.x -= 13 * Math.min(dt, 0.1);
      if (train.position.x < trackX0 - off) train.position.x = trackX1;
    });
  }
  const trainLen = 22 * 2 + 34 * 19.4;

  /* ---------- the Marfa lights, to the south, after dark ---------- */
  {
    const tex = radial('rgba(255,250,235,1)', 'rgba(255,200,140,0)');
    const lights: { s: T.Sprite; x: number; y: number; z: number; ph: number; sp: number }[] = [];
    const lr = X.mulberry(1883);
    for (let i = 0; i < 9; i++) {
      const m = new T.SpriteMaterial({ map: tex, color: [0xfff4e0, 0xcfe0ff, 0xffd0b0][i % 3], transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false });
      const s = new T.Sprite(m);
      const L = { s, x: HALL.x - 260 + lr() * 520, y: 3 + lr() * 14, z: HALL.z + 560 + lr() * 180, ph: lr() * 10, sp: 0.2 + lr() * 0.5 };
      s.scale.setScalar(5 + lr() * 6);
      k.add(s);
      sky.nightOnly.push(s);
      lights.push(L);
    }
    k.ticks.push((t) => {
      if (sky.night < 0.35) return;
      for (const L of lights) {
        L.s.position.set(L.x + Math.sin(t * L.sp * 0.3 + L.ph) * 30, L.y + Math.sin(t * L.sp + L.ph * 2) * 3, L.z + Math.cos(t * L.sp * 0.21 + L.ph) * 20);
        const blink = Math.max(0, Math.sin(t * L.sp * 0.7 + L.ph));
        (L.s.material as T.SpriteMaterial).opacity = Math.min(1, blink * 1.6) * sky.night;
      }
    });
    // the viewing area, a concrete pad and a sign facing south
    const vx = HALL.x + 58, vz = TRACK_Z + 24;
    k.box(14, 0.3, 6, vx, 0.15, vz, conc);
    /* a low parapet to lean on facing the lights, and the sign on the north edge facing whoever arrives */
    k.box(14, 0.55, 0.3, vx, 0.575, vz + 2.85, conc);
    k.block(vx - 7 - R, vx + 7 + R, vz + 2.7 - R, vz + 3.0 + R);
    for (const sx of [-2.6, 2.6]) k.cyl(0.05, 1.2, vx + sx, 0.6, vz - 3.4, steel);
    k.box(7.2, 0.7, 0.06, vx, 1.45, vz - 3.4, bone);
    signAt(word(Q('Marfa lights viewing area') + '  \u2193  LOOK SOUTH AFTER DARK', 1024, 90, '#2a2622', 40, { track: 5 }), 7, 0.6, vx, 1.45, vz - 3.44, Math.PI);
    k.block(vx - 3.6 - R, vx + 3.6 + R, vz - 3.5 - R, vz - 3.3 + R);
  }

  /* ---------- an Aermotor windmill beside the hall ---------- */
  {
    const wx = HALL.x + HALL.w / 2 + 16, wz = HALL.z - 4, H = 13;
    const galv = k.flat(0x9aa0a4, 0.75, 0.4);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.beam(v(wx + sx * 1.6, 0, wz + sz * 1.6), v(wx + sx * 0.25, H, wz + sz * 0.25), 0.06, galv, 6);
    for (let r = 1; r < 5; r++) {
      const y = (r / 5) * H, s = 1.6 - (r / 5) * 1.35;
      for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) k.beam(v(wx + a[0] * s, y, wz + a[1] * s), v(wx + b[0] * s, y, wz + b[1] * s), 0.035, galv, 5);
    }
    const head = new T.Group();
    head.position.set(wx, H + 0.4, wz);
    const wheel = new T.Group();
    for (let b = 0; b < 18; b++) {
      const blade = new T.Mesh(new T.BoxGeometry(0.42, 1.9, 0.03), galv);
      const a = (b / 18) * Math.PI * 2;
      blade.position.set(Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0);
      blade.rotation.set(0, 0.5, a - Math.PI / 2);
      wheel.add(blade);
    }
    const hub = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.4, 10), galv);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    wheel.position.z = 0.7;
    head.add(wheel);
    const tail = new T.Mesh(new T.BoxGeometry(0.04, 1.1, 2.0), k.flat(0xb83a26, 0.3, 0.6));
    tail.position.set(0, 0.2, -2.0);
    head.add(tail);
    head.rotation.y = -Math.PI / 2 - 0.25;      // the wind comes out of the west
    k.add(head);
    if (!opts.reduced) k.ticks.push((t, dt) => { wheel.rotation.z -= dt * (1.6 + Math.sin(t * 0.13) * 0.6); });
    k.keepOut.push({ x: wx, z: wz, r: 2.3 });
  }

  /* ---------- mountains: the Chinatis, the Davis range, a ring of blue ridges ---------- */
  {
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, N = 220;
    const pos: number[] = [], idx: number[] = [];
    const mr = X.mulberry(88);
    const ridge = Array.from({ length: N }, (_, i) => {
      const a = (i / N) * Math.PI * 2;
      const big = Math.max(0, Math.cos(a - 1.75)) ** 2;      // tallest toward the south west: the Chinati peaks
      return 40 + 90 * Math.abs(Math.sin(a * 3.1) * Math.sin(a * 7.3 + 1)) + 160 * big + mr() * 30;
    });
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, j = i % N;
      const r = 1750 + Math.sin(a * 5) * 120;
      pos.push(cx + Math.cos(a) * (r - 260), -2, cz + Math.sin(a) * (r - 260));
      pos.push(cx + Math.cos(a) * r, ridge[j], cz + Math.sin(a) * r);
      pos.push(cx + Math.cos(a) * (r + 300), -2, cz + Math.sin(a) * (r + 300));
      if (i < N) { const b = i * 3; idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    k.mesh(g, k.flat(0x8a7766, 0, 1, { flatShading: true, side: T.DoubleSide }), 0, 0, 0, true);
  }

  /* ---------- flora: creosote, sotol, grama grass, kept off every door, wall and line ---------- */
  {
    const rects = [...PLACES.map((p) => [p.x - p.w / 2 - 5, p.x + p.w / 2 + 5, p.z - p.l / 2 - 8, p.z + p.l / 2 + 8]),
      [HALL.x - HALL.w / 2 - 10, HALL.x + HALL.w / 2 + 24, HALL.z - HALL.l / 2 - 22, HALL.z + HALL.l / 2 + 14],
      [LK.x - 14, LK.x + 14, LK.z - 14, LK.z + 16], [bx0 - 600, bx1 + 600, TRACK_Z - 5, TRACK_Z + 5]];
    const nearLine = (x: number, z: number) => {
      for (const [a, b] of edges) {
        const ax = nodes[a].x, az = nodes[a].z, dx = nodes[b].x - ax, dz = nodes[b].z - az;
        const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < 3.4) return true;
      }
      return false;
    };
    const ok = (x: number, z: number) => !rects.some((r) => x > r[0] && x < r[1] && z > r[2] && z < r[3]) && !nearLine(x, z);
    const area = [bx0 - 250, bx1 + 250, bz0 - 250, bz1 + 250];
    const bush: T.Matrix4[] = [], sotol: T.Matrix4[] = [], grass: T.Matrix4[] = [];
    const nBush = high ? 1700 : 700, nSotol = high ? 700 : 300, nGrass = high ? 3200 : 1200;
    const at = () => [area[0] + rnd() * (area[1] - area[0]), area[2] + rnd() * (area[3] - area[2])];
    /* creosote grows as a loose clump: three or four small crowns per plant */
    for (let i = 0; i < nBush * 1.3 && bush.length < nBush * 3; i++) {
      const [x, z] = at();
      if (!ok(x, z)) continue;
      const s = 0.3 + rnd() * 0.45, parts = 3 + Math.floor(rnd() * 2);
      for (let b = 0; b < parts; b++) {
        const a = rnd() * 6.28, o = s * 0.7 * rnd(), ss = s * (0.6 + rnd() * 0.5);
        bush.push(new T.Matrix4().compose(v(x + Math.cos(a) * o, ss * 0.55, z + Math.sin(a) * o), new T.Quaternion().setFromEuler(new T.Euler(rnd(), rnd() * 6, rnd())), v(ss, ss * 1.15, ss)));
      }
    }
    for (let i = 0; i < nSotol * 1.3 && sotol.length < nSotol * 6; i++) {
      const [x, z] = at();
      if (!ok(x, z)) continue;
      const s = 0.7 + rnd() * 0.7;
      for (let b = 0; b < 6; b++) {
        const q = new T.Quaternion().setFromEuler(new T.Euler((rnd() - 0.5) * 0.9, rnd() * 6, (rnd() - 0.5) * 0.9));
        sotol.push(new T.Matrix4().compose(v(x, 0.5 * s, z), q, v(s, s * (0.8 + rnd() * 0.6), s)));
      }
    }
    for (let i = 0; i < nGrass * 1.3 && grass.length < nGrass; i++) {
      const [x, z] = at();
      if (!ok(x, z)) continue;
      const s = 0.6 + rnd() * 0.9;
      grass.push(new T.Matrix4().compose(v(x, 0.22 * s, z), new T.Quaternion().setFromEuler(new T.Euler((rnd() - 0.5) * 0.3, rnd() * 6, 0)), v(s, s, s)));
    }
    const ico = new T.IcosahedronGeometry(1, 0);
    k.instances(ico, k.flat(0x4f5a31, 0, 0.95, { flatShading: true }), bush);
    k.instances(new T.ConeGeometry(0.09, 1.1, 4), k.flat(0x8a9a5a, 0, 0.8), sotol);
    k.instances(new T.ConeGeometry(0.16, 0.45, 5), k.flat(0xcdb27a, 0, 1), grass);
  }

  /* ---------- life ---------- */
  const people = [0x2f3e5a, 0xe9e2d2, 0x7a3b28, 0x1c1c1c, 0xa0522d, 0x51607a, 0xcdb27a, 0x3e4b3a, 0xd8d0c0, 0x6a4a3a];
  {
    const hx = HALL.x, hz = HALL.z, hl = HALL.l;
    const tx = PLACES.find((p) => p.usps === 'TX')!;
    k.crowd([v(hx + 1.4, 0, hz + hl / 2 + 40), v(hx + 1.4, 0, hz + hl / 2 - 2), v(hx + 1.4, 0, hz), v(hx + 1.4, 0, hz - hl / 2 + 2), v(hx + 4, 0, hz - hl / 2 - 6), v(hx + 9, 0, hz - hl / 2 - 20), v(tx.x, 0, tx.z + tx.l / 2 + 4)], 22, { seed: 11, spread: 1.4, colors: people });
    k.crowd([v(hx - 7.0, 0, hz + hl / 2 - 3), v(hx - 7.0, 0, hz - hl / 2 + 3)], 7, { seed: 12, spread: 0.6, speed: 0.6, colors: people });
    k.crowd([v(LK.x - 11, 0, LK.z), v(LK.x, 0, LK.z - 11), v(LK.x + 11, 0, LK.z), v(LK.x, 0, LK.z + 11)], 12, { seed: 13, spread: 1.0, closed: true, colors: people });
    for (const p of PLACES) {
      if (p.kind !== 'shed') continue;
      const ax = p.x - 4.3, bxx = p.x + 4.3;
      k.crowd([v(p.x, 0, p.z + p.l / 2 + 6), v(ax, 0, p.z + p.l / 2 - 3), v(ax, 0, p.z - p.l / 2 + 3), v(p.x, 0, p.z - p.l / 2 - 5), v(bxx, 0, p.z - p.l / 2 + 3), v(bxx, 0, p.z + p.l / 2 - 3)], Math.min(16, 4 + p.works.length), { seed: p.usps.charCodeAt(0) * 3 + p.usps.charCodeAt(1), spread: 1.1, speed: 0.7, closed: true, colors: people });
    }
    /* a handful of walkers along the lines nearest the hall and in the north east */
    const busy = edges.filter(([a, b]) => {
      const mx = (nodes[a].x + nodes[b].x) / 2, mz = (nodes[a].z + nodes[b].z) / 2;
      return Math.hypot(mx - HALL.x, mz - HALL.z) < 260 || mx > 300;
    }).slice(0, 14);
    busy.forEach(([a, b], i) => k.crowd([v(nodes[a].x, 0, nodes[a].z), v(nodes[b].x, 0, nodes[b].z)], 5, { seed: 40 + i, spread: 1.2, colors: people }));
  }
  /* turkey vultures riding the thermals */
  {
    const birdMat = k.flat(0x1e1a18, 0, 0.9, { side: T.DoubleSide });
    const birds: { g: T.Group; cx: number; cz: number; r: number; y: number; sp: number; ph: number; wl: T.Mesh; wr: T.Mesh }[] = [];
    const br = X.mulberry(5);
    const centres = [[HALL.x, HALL.z - 60], [LK.x, LK.z], [200, -120], [-400, -100], [380, -150], [-60, 150]];
    for (let i = 0; i < 9; i++) {
      const c = centres[i % centres.length];
      const g = new T.Group();
      const body = new T.Mesh(new T.BoxGeometry(0.22, 0.18, 0.75), birdMat);
      g.add(body);
      const wl = new T.Mesh(new T.PlaneGeometry(1.0, 0.42), birdMat), wr = new T.Mesh(new T.PlaneGeometry(1.0, 0.42), birdMat);
      wl.rotation.x = wr.rotation.x = -Math.PI / 2;
      wl.position.x = -0.55;
      wr.position.x = 0.55;
      g.add(wl, wr);
      k.add(g);
      birds.push({ g, cx: c[0] + (br() - 0.5) * 60, cz: c[1] + (br() - 0.5) * 60, r: 30 + br() * 40, y: 38 + br() * 30, sp: 0.08 + br() * 0.06, ph: br() * 6, wl, wr });
    }
    k.ticks.push((t) => {
      for (const b of birds) {
        const a = t * b.sp + b.ph;
        b.g.position.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(t * 0.3 + b.ph) * 3, b.cz + Math.sin(a) * b.r);
        b.g.rotation.set(0, -a, 0.35);
        const dih = 0.18 + Math.sin(t * 1.3 + b.ph) * 0.05;
        b.wl.rotation.y = dih;
        b.wr.rotation.y = -dih;
      }
    });
  }
  /* tumbleweeds on the west wind, recycled around whoever is walking */
  const camAt = v(0, 0, 0);
  {
    const N = 26;
    const tw = new T.InstancedMesh(new T.IcosahedronGeometry(0.5, 1), new T.MeshStandardMaterial({ color: 0x9c7b4f, wireframe: true }), N);
    tw.frustumCulled = false;
    k.add(tw);
    const st = Array.from({ length: N }, () => ({ x: 0, z: 0, v: 2 + rnd() * 3, ph: rnd() * 6, s: 0.6 + rnd() * 0.7, alive: false }));
    const inside = (x: number, z: number) => PLACES.some((p) => Math.abs(x - p.x) < p.w / 2 + 2 && Math.abs(z - p.z) < p.l / 2 + 2) ||
      (Math.abs(x - HALL.x) < HALL.w / 2 + 2 && Math.abs(z - HALL.z) < HALL.l / 2 + 2);
    const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler();
    k.ticks.push((t, dt) => {
      for (let i = 0; i < N; i++) {
        const a = st[i];
        if (!a.alive || Math.hypot(a.x - camAt.x, a.z - camAt.z) > 150 || inside(a.x, a.z)) {
          a.x = camAt.x - 60 - rnd() * 80;
          a.z = camAt.z + (rnd() - 0.5) * 220;
          a.alive = !inside(a.x, a.z);
        }
        a.x += a.v * Math.min(dt, 0.1);
        const y = a.s * 0.5 + Math.abs(Math.sin(t * 2.2 + a.ph)) * 0.55;
        e.set(0, a.ph, -a.x / (a.s * 0.5));
        m.compose(v(a.x, a.alive ? y : -10, a.z), q.setFromEuler(e), v(a.s, a.s, a.s));
        tw.setMatrixAt(i, m);
      }
      tw.instanceMatrix.needsUpdate = true;
    });
  }

  /* ---------- arrival ---------- */
  const spawn = v(HALL.x, 0, HALL.z + HALL.l / 2 - 3.2);
  const look = v(HALL.x, 1.65, HALL.z - 200);

  return {
    hung, pavs, dir, lookoutPick: lookoutPick!, lookout, hallDecor, hall: HALL, spawn, look, bounds: D.bounds, eye: 1.68, sky,
    train: {
      z: TRACK_Z,
      x: () => train.position.x,
      box: () => ({ x0: train.position.x - 1, x1: train.position.x + trainLen + 1, z0: TRACK_Z - 2.4, z1: TRACK_Z + 2.4 }),
    },
    follow: (cam: T.Vector3) => { camAt.copy(cam); sky.follow(cam); },
  };
}

/* The museum label beside a work, made only when someone is close enough to read it. */
export function makeLabel(h: Hung) {
  const w = h.work;
  const tex = card([
    { t: h.place.name.toUpperCase(), size: 22, color: SIENNA, weight: '700', gap: 10, track: 3 },
    { t: w.title, size: 34, weight: '700', gap: 6 },
    { t: w.artist, size: 28, gap: 14 },
    { t: [w.chain, w.acq ? 'Acquired ' + w.acq : '', w.kind ? (w.kind === 'video' ? 'Moving image' : 'Animation') : ''].filter(Boolean).join('  ·  '), size: 19, color: MUTED, weight: '600', gap: 0 },
  ], 512, 352, BONE, SIENNA, 0.08);
  const m = new T.Mesh(new T.PlaneGeometry(h.labelAt.w, h.labelAt.h), new T.MeshBasicMaterial({ map: tex, color: 0xe4e4e4 }));
  m.position.set(h.labelAt.x, h.labelAt.y, 0.012);
  m.userData.hung = h.art.userData.hung;
  h.g.add(m);
  h.label = m;
}
export function dropLabel(h: Hung) {
  if (!h.label) return;
  h.g.remove(h.label);
  const mat = h.label.material as T.MeshBasicMaterial;
  mat.map?.dispose();
  mat.dispose();
  h.label.geometry.dispose();
  h.label = null;
}
export { media };
