/* THE FIELD — the visitor, the camera, the streaming of two hundred works, the panels. */
import * as T from 'three';
import { Kit } from './kit';
import * as X from './textures';
import { Fx } from './fx';
import { D, PLACES, WORKS, TRIP, TRIP_WORKS, byUsps, media, liveHour, PINNED_HOUR, clockLabel, Place } from './data';
import { buildWorld, makeLabel, dropLabel, WorldBuild, Hung, Pav } from './world';
import { audit } from './audit';

const $ = <E extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as E;
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches;
const quality: 'high' | 'low' = params.get('q') === 'low' || (touch && innerWidth < 900) || (navigator.hardwareConcurrency || 8) <= 4 ? 'low' : params.get('q') === 'high' ? 'high' : 'high';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || params.get('motion') === 'off';

let renderer: T.WebGLRenderer;
let camera: T.PerspectiveCamera;
let scene: T.Scene;
let kit: Kit;
let W: WorldBuild;
let fx: Fx | null = null;

/* ---------- the visitor ---------- */
let yaw = 0, pitch = 0;
const keys = new Set<string>();
const stickDir = { f: 0, s: 0 };
let goal: T.Vector3 | null = null;
let goalLook: T.Vector3 | null = null;
type Flight = { from: T.Vector3; to: T.Vector3; y0: number; p0: number; y1: number; p1: number; t: number; dur: number; arc: number; done?: () => void };
let flight: Flight | null = null;
let mapMode = false;
let mapReturn: { pos: T.Vector3; yaw: number; pitch: number } | null = null;
let tour = false, tourIdx = -1, tourClock = 0;
let current = -1;      // the hung work in front of the visitor
const HUNG_BY_WORK = new Map<number, Hung>();

function constrain() {
  const p = camera.position;
  const [x0, x1, z0, z1] = W.bounds;
  p.x = T.MathUtils.clamp(p.x, x0, x1);
  p.z = T.MathUtils.clamp(p.z, z0, z1);
  for (const k of kit.keepOut) {
    const dx = p.x - k.x, dz = p.z - k.z, d = Math.hypot(dx, dz);
    if (d < k.r && d > 1e-4) { p.x = k.x + (dx / d) * k.r; p.z = k.z + (dz / d) * k.r; }
  }
  const push = (b: { x0: number; x1: number; z0: number; z1: number }) => {
    if (p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1) {
      const a = p.x - b.x0, c = b.x1 - p.x, d = p.z - b.z0, e = b.z1 - p.z, m = Math.min(a, c, d, e);
      if (m === a) p.x = b.x0; else if (m === c) p.x = b.x1; else if (m === d) p.z = b.z0; else p.z = b.z1;
    }
  };
  for (const b of kit.blocks) push(b);
  push(W.train.box());
  p.y = W.eye;
}
function standable(x: number, z: number) {
  const [x0, x1, z0, z1] = W.bounds;
  if (x < x0 || x > x1 || z < z0 || z > z1) return false;
  for (const b of kit.blocks) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return false;
  for (const k of kit.keepOut) if (Math.hypot(x - k.x, z - k.z) < k.r) return false;
  return true;
}
const anglesTo = (from: T.Vector3, to: T.Vector3) => {
  const d = to.clone().sub(from);
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
};
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/* Fly anywhere: lift, cross, settle. Short hops stay low; a coast to coast trip rises over the map. */
function fly(to: T.Vector3, lookAt: T.Vector3, done?: () => void, opts: { dur?: number; arc?: number } = {}) {
  goal = null;
  const from = camera.position.clone();
  const dist = from.distanceTo(to);
  const a = anglesTo(to, lookAt);
  flight = {
    from, to: to.clone(), y0: yaw, p0: pitch, y1: yaw + wrapPi(a.yaw - yaw), p1: a.pitch, t: 0,
    dur: opts.dur ?? T.MathUtils.clamp(0.8 + dist / 160, 0.9, 3.6),
    arc: opts.arc ?? (dist < 20 ? 0 : Math.min(260, dist * 0.32)), done,
  };
}
function viewpointOf(h: Hung) {
  const n = new T.Vector3(h.target.x - h.pos.x, 0, h.target.z - h.pos.z).normalize();
  const want = T.MathUtils.clamp(Math.max(h.w, h.h * 1.2) * 0.95 + 0.9, 2.6, 4.3);
  for (let d = want; d >= 1.6; d -= 0.3) {
    const x = h.pos.x + n.x * d, z = h.pos.z + n.z * d;
    if (standable(x, z)) return new T.Vector3(x, W.eye, z);
  }
  return new T.Vector3(h.pos.x + n.x * 2, W.eye, h.pos.z + n.z * 2);
}
function goToWork(h: Hung, open = false) {
  const vp = viewpointOf(h);
  const c = h.pos.clone();
  c.y = Math.min(h.pos.y, W.eye + 0.25);
  if (mapMode) leaveMap(false);
  fly(vp, c, () => { current = HUNG_BY_WORK.get(h.i) ? W.hung.indexOf(h) : -1; if (open) openDetail(h); });
}
function goToPlace(p: Pav) {
  if (mapMode) leaveMap(false);
  const vp = new T.Vector3(p.x + (p.kind === 'shed' ? -4.3 : 0), W.eye, p.z + p.l / 2 + 4.5);
  fly(vp, new T.Vector3(vp.x, 1.7, p.z - p.l / 2));
  flash(p.place.name);
}

/* ---------- the overview ---------- */
const CENTER = new T.Vector3((D.bounds[0] + D.bounds[1]) / 2, 0, (D.bounds[2] + D.bounds[3]) / 2 - 30);
function enterMap() {
  if (mapMode || flight) return;
  stopTour();
  mapReturn = { pos: camera.position.clone(), yaw, pitch };
  mapMode = true;
  document.body.classList.add('mapmode');
  fly(new T.Vector3(CENTER.x, 720, CENTER.z + 470), CENTER, undefined, { dur: 2.6, arc: 0 });
  paintMapLabels(true);
}
function leaveMap(back = true) {
  if (!mapMode) return;
  mapMode = false;
  document.body.classList.remove('mapmode');
  paintMapLabels(false);
  if (back && mapReturn) {
    const r = mapReturn;
    const look = r.pos.clone().add(new T.Vector3(-Math.sin(r.yaw) * 10, Math.sin(r.pitch) * 10, -Math.cos(r.yaw) * 10));
    fly(r.pos, look, undefined, { dur: 2.2, arc: 0 });
  }
}
const mapLabels: HTMLElement[] = [];
function paintMapLabels(on: boolean) {
  const host = $('#maplabels');
  if (!mapLabels.length) {
    for (const p of W.pavs) {
      const a = document.createElement('button');
      a.className = 'ml' + (p.place.works.length >= 8 ? ' big' : '');
      a.innerHTML = `<b>${esc(p.place.usps)}</b><span>${esc(p.place.name)} · ${p.place.works.length}</span>`;
      a.addEventListener('click', () => goToPlace(p));
      host.appendChild(a);
      mapLabels.push(a);
    }
  }
  host.hidden = !on;
}
const proj = new T.Vector3();
function placeMapLabels() {
  const host = $('#maplabels');
  if (host.hidden) return;
  const w = host.clientWidth, h = host.clientHeight;
  W.pavs.forEach((p, i) => {
    proj.set(p.x, 6, p.z).project(camera);
    const el = mapLabels[i];
    if (proj.z > 1) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = `translate(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px) translate(-50%, -50%)`;
  });
}

/* ---------- streaming the collection ---------- */
type Tex = { p: Promise<T.Texture>; t: T.Texture | null; refs: number };
const texCache = new Map<string, Tex>();
const loader = new T.TextureLoader();
function acquire(url: string): Promise<T.Texture> {
  let e = texCache.get(url);
  if (!e) {
    const entry: Tex = { p: null as unknown as Promise<T.Texture>, t: null, refs: 0 };
    entry.p = new Promise((res, rej) => loader.load(url, (t) => {
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 8;
      entry.t = t;
      res(t);
    }, undefined, rej));
    texCache.set(url, entry);
    e = entry;
  }
  e.refs++;
  return e.p;
}
function release(url: string | null) {
  if (!url) return;
  const e = texCache.get(url);
  if (!e) return;
  if (--e.refs <= 0) {
    e.t?.dispose();
    texCache.delete(url);
  }
}
let inflight = 0;
const MAX_INFLIGHT = 8;
let playing = 0;
const MAX_PLAYING = quality === 'high' ? 6 : 3;

function setStill(h: Hung, level: 1 | 2) {
  const w = h.work;
  const url = level === 2 ? (w.img2 || w.img) : (w.img || w.img2);
  if (!url) return;
  const full = media(url);
  if (h.url === full) { h.lod = level; return; }
  h.busy = true;
  inflight++;
  acquire(full).then((t) => {
    const old = h.url;
    h.url = full;
    if (!h.stop) {                 // a moving image keeps the screen; the still waits underneath it
      h.mat.map = t;
      h.mat.color.set(0xffffff);
      h.mat.needsUpdate = true;
      h.lod = level;
    }
    release(old);
  }).catch(() => release(full)).finally(() => { h.busy = false; inflight--; });
}
function setPlaceholder(h: Hung) {
  stopMotion(h);
  if (h.url) {
    h.mat.map = null;
    h.mat.color.setHSL((h.work.hue || 20) / 360, 0.22, 0.3);
    h.mat.needsUpdate = true;
    release(h.url);
    h.url = null;
  }
  h.lod = 0;
}
function stopMotion(h: Hung) {
  if (!h.stop) return;
  h.stop();
  h.stop = null;
  playing--;
  if (h.url) {
    const t = texCache.get(h.url)?.t;
    if (t) { h.mat.map = t; h.mat.needsUpdate = true; }
  }
  if (h.lod === 3) h.lod = 2;
}
function startMotion(h: Hung) {
  const w = h.work;
  if (!w.anim || h.stop) return;
  const src = media(w.anim);
  if (w.kind === 'video' || /\.mp4$/i.test(w.anim)) {
    const vEl = document.createElement('video');
    vEl.muted = true;
    vEl.loop = true;
    vEl.playsInline = true;
    vEl.preload = 'auto';
    vEl.src = src;
    const tex = new T.VideoTexture(vEl);
    tex.colorSpace = T.SRGBColorSpace;
    let live = true;
    vEl.addEventListener('playing', () => { if (!live) return; h.mat.map = tex; h.mat.color.set(0xffffff); h.mat.needsUpdate = true; }, { once: true });
    vEl.play().catch(() => { /* autoplay refused: the still stays up */ });
    h.stop = () => {
      live = false;
      vEl.pause();
      vEl.removeAttribute('src');
      vEl.load();
      tex.dispose();
    };
  } else {
    /* animated GIF and WebP: decode frame by frame where the browser can, otherwise keep the still */
    const ID = (window as unknown as { ImageDecoder?: new (o: { data: ReadableStream | ArrayBuffer; type: string }) => { tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null }; decode: (o: { frameIndex: number }) => Promise<{ image: VideoFrame }>; close: () => void } }).ImageDecoder;
    if (!ID) return;
    let live = true;
    let timer = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    let dec: InstanceType<typeof ID> | null = null;
    fetch(src).then((r) => r.arrayBuffer()).then(async (buf) => {
      if (!live) return;
      dec = new ID({ data: buf, type: /\.gif$/i.test(src) ? 'image/gif' : 'image/webp' });
      await dec.tracks.ready;
      const count = dec.tracks.selectedTrack?.frameCount || 1;
      let i = 0;
      const next = async () => {
        if (!live || !dec) return;
        try {
          const { image } = await dec.decode({ frameIndex: i });
          if (!live) { image.close(); return; }
          const s = Math.min(1, 900 / Math.max(image.displayWidth, image.displayHeight));
          if (!canvas.width) {
            canvas.width = Math.round(image.displayWidth * s);
            canvas.height = Math.round(image.displayHeight * s);
            h.mat.map = tex;
            h.mat.color.set(0xffffff);
            h.mat.needsUpdate = true;
          }
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          tex.needsUpdate = true;
          const ms = Math.max(30, (image.duration || 80000) / 1000);
          image.close();
          i = (i + 1) % count;
          timer = window.setTimeout(next, ms);
        } catch { /* a bad frame ends the loop and the still stays */ }
      };
      next();
    }).catch(() => { /* network or decode failure: still image */ });
    h.stop = () => {
      live = false;
      clearTimeout(timer);
      try { dec?.close(); } catch { /* already closed */ }
      tex.dispose();
    };
  }
  playing++;
  h.lod = 3;
}

let streamClock = 0;
function stream() {
  const c = camera.position;
  const order = W.hung.map((h) => ({ h, d: Math.hypot(h.pos.x - c.x, h.pos.z - c.z) + (c.y > 30 ? 1e6 : 0) })).sort((a, b) => a.d - b.d);
  let moving = 0;
  const air = c.y > 40;
  for (const p of W.pavs) {
    const d = Math.hypot(p.x - c.x, p.z - c.z), on = !air && d < 200;
    if (p.decor.length && p.decor[0].visible !== on) for (const o of p.decor) o.visible = on;
  }
  {
    const on = !air && Math.hypot(W.hall.x - c.x, W.hall.z - c.z) < 160;
    if (W.hallDecor[0] && W.hallDecor[0].visible !== on) for (const o of W.hallDecor) o.visible = on;
  }
  for (const { h, d } of order) {
    const show = !air && d < 170;
    if (h.g.visible !== show) h.g.visible = show;
    const wantAnim = !!h.work.anim && d < 17 && !reduced && moving < MAX_PLAYING;
    if (wantAnim) moving++;
    const want = wantAnim ? 3 : d < 24 ? 2 : d < 140 ? 1 : d > 230 ? 0 : Math.min(1, h.lod);
    if (h.lod === 3 && want < 3) stopMotion(h);
    if (want === 0 && h.lod > 0) setPlaceholder(h);
    else if (want >= 1 && !h.busy && inflight < MAX_INFLIGHT) {
      const stillWant = want === 3 ? 2 : want;
      if (h.lod < stillWant || (h.lod === 2 && stillWant === 1 && d > 40)) setStill(h, stillWant as 1 | 2);
    }
    if (want === 3 && !h.stop && playing < MAX_PLAYING && h.url) startMotion(h);
    if (d < 13 && !h.label) makeLabel(h);
    else if (d > 20 && h.label) dropLabel(h);
  }
}

/* ---------- where the visitor is ---------- */
function inRing(x: number, z: number, ring: [number, number][]) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
let whereLast = '';
function where() {
  const { x, z } = camera.position;
  let txt = '';
  const H = W.hall;
  if (mapMode) txt = 'ALL FIFTY, FROM ABOVE';
  else if (Math.abs(x - H.x) < H.w / 2 + 1 && Math.abs(z - H.z) < H.l / 2 + 1) txt = 'MARFA · THE HALL';
  else {
    const pv = W.pavs.find((p) => Math.abs(x - p.x) < p.w / 2 + 1 && Math.abs(z - p.z) < p.l / 2 + 1);
    if (pv) txt = 'IN ' + pv.place.name.toUpperCase() + ' · ' + pv.place.works.length + (pv.place.works.length === 1 ? ' WORK' : ' WORKS');
    else {
      const st = PLACES.find((p) => p.rings.some((r) => inRing(x, z, r)));
      txt = st ? 'CROSSING ' + st.name.toUpperCase() : Math.hypot(x - W.lookout.x, z - W.lookout.z) < 30 ? 'THE MIDDLE' : 'OPEN DESERT';
    }
  }
  if (txt !== whereLast) { $('#where').textContent = txt; whereLast = txt; }
}

/* ---------- the clock ---------- */
type TimeMode = 'live' | 'day' | 'golden' | 'night';
let timeMode: TimeMode = PINNED_HOUR != null ? 'day' : 'live';
const PRESET: Record<Exclude<TimeMode, 'live'>, number> = { day: 13, golden: 18.6, night: 22.5 };
function hourNow() {
  if (PINNED_HOUR != null && timeMode === 'day') return PINNED_HOUR;
  return timeMode === 'live' ? liveHour() : PRESET[timeMode];
}
function applyHour() {
  const h = hourNow();
  W.sky.setHour(h);
  const mood = W.sky.night > 0.6 ? 'NIGHT' : W.sky.dusk > 0.3 ? (h < 12 ? 'DAWN' : 'GOLDEN HOUR') : 'DAYLIGHT';
  $('#clock').textContent = `MARFA ${clockLabel(h)} · ${mood}`;
  $('#timebtn').textContent = timeMode === 'live' ? 'LIVE LIGHT' : timeMode.toUpperCase();
}
function cycleTime() {
  const order: TimeMode[] = ['live', 'day', 'golden', 'night'];
  timeMode = order[(order.indexOf(timeMode) + 1) % order.length];
  if (PINNED_HOUR != null && timeMode === 'day') timeMode = 'golden';
  applyHour();
  flash(timeMode === 'live' ? 'Light follows the Marfa clock' : timeMode === 'golden' ? 'Golden hour' : timeMode === 'night' ? 'Night. Look south for the Marfa lights.' : 'Midday');
}

/* ---------- sound: wind always, a horn when the freight passes ---------- */
let audio: AudioContext | null = null;
let windGain: GainNode | null = null;
let soundOn = false;
let hornCool = 0;
function startSound() {
  if (!audio) {
    audio = new AudioContext();
    const len = audio.sampleRate * 4, buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = audio.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    windGain = audio.createGain();
    windGain.gain.value = 0;
    const lfo = audio.createOscillator(), lfoG = audio.createGain();
    lfo.frequency.value = 0.07;
    lfoG.gain.value = 0.12;
    lfo.connect(lfoG).connect(windGain.gain);
    src.connect(lp).connect(windGain).connect(audio.destination);
    src.start();
    lfo.start();
  }
  audio.resume();
  windGain!.gain.setTargetAtTime(0.22, audio.currentTime, 0.8);
}
function stopSound() {
  if (audio && windGain) windGain.gain.setTargetAtTime(0, audio.currentTime, 0.3);
}
function horn(dist: number) {
  if (!audio || !soundOn) return;
  const t0 = audio.currentTime, g = audio.createGain();
  const vol = T.MathUtils.clamp(1 - dist / 320, 0.05, 0.5);
  g.gain.value = 0;
  const lp = audio.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1500;
  g.connect(lp).connect(audio.destination);
  const pattern = [[0, 1.3], [1.5, 1.3], [3.0, 0.5], [3.7, 1.9]];
  for (const [s, l] of pattern) {
    g.gain.setTargetAtTime(vol, t0 + s, 0.04);
    g.gain.setTargetAtTime(0, t0 + s + l, 0.06);
  }
  for (const f of [311, 370, 466, 554, 622]) {
    const o = audio.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const og = audio.createGain();
    og.gain.value = 0.12;
    o.connect(og).connect(g);
    o.start(t0);
    o.stop(t0 + 6);
  }
}

/* ---------- panels ---------- */
function openDetail(h: Hung) {
  const w = h.work;
  const p = h.place;
  const media2 = w.kind === 'video' && w.anim
    ? `<video src="${esc(media(w.anim))}" poster="${esc(media(w.img2 || w.img || ''))}" autoplay muted loop playsinline controls></video>`
    : `<img src="${esc(media(w.anim && w.kind !== 'video' ? w.anim : (w.img2 || w.img || '')))}" alt="${esc(w.title + ' by ' + w.artist)}">`;
  const link = (u: string | null, t: string) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a>` : '');
  const siblings = p.works.length > 1 ? `<div class="sib">${p.works.map((wi) => `<button data-w="${wi}" class="${wi === h.i ? 'on' : ''}" title="${esc(WORKS[wi].title)}"><img src="${esc(media(WORKS[wi].img || ''))}" alt=""></button>`).join('')}</div>` : '';
  $('#detail-body').innerHTML = `
    <div class="dmedia">${media2}</div>
    <div class="dtext">
      <p class="kicker">${esc(p.name)} · ${esc(w.chain)}</p>
      <h2>${esc(w.title)}</h2>
      <p class="artist">${w.artist_url ? `<a href="${esc(w.artist_url)}" target="_blank" rel="noopener">${esc(w.artist)}</a>` : esc(w.artist)}</p>
      ${w.series && w.series !== w.title ? `<p class="muted small">From “${esc(w.series)}”</p>` : ''}
      ${w.desc ? `<p class="desc">${esc(w.desc).replace(/\n/g, '<br>')}</p>` : ''}
      <dl class="prov">
        ${w.acq ? `<dt>Acquired</dt><dd>${esc(w.acq)}${w.by_artist ? ', directly from the artist' : ''}</dd>` : ''}
        ${w.from ? `<dt>From</dt><dd>${w.from_url ? `<a href="${esc(w.from_url)}" target="_blank" rel="noopener">${esc(w.from)}</a>` : esc(w.from)}</dd>` : ''}
        <dt>Held by</dt><dd>Fondazione Aversano</dd>
        ${w.token_id ? `<dt>Token</dt><dd>#${esc(w.token_id)}</dd>` : ''}
      </dl>
      <p class="links">${link(w.tx, 'Chain record')} ${link(w.explorer, 'Explorer')} ${link(w.market, 'Marketplace')}</p>
      ${siblings}
    </div>`;
  $('#detail-body').querySelectorAll<HTMLButtonElement>('.sib button').forEach((b) => b.addEventListener('click', () => {
    const hh = HUNG_BY_WORK.get(Number(b.dataset.w));
    if (hh) { openDetail(hh); goToWork(hh); }
  }));
  $('#detail').classList.add('open');
  $('#detail').setAttribute('aria-hidden', 'false');
}
function closeDetail() {
  $('#detail').classList.remove('open');
  $('#detail').setAttribute('aria-hidden', 'true');
  const vEl = $('#detail-body').querySelector('video');
  if (vEl) { vEl.pause(); vEl.removeAttribute('src'); vEl.load(); }
}
function buildStates() {
  const regions = ['Northeast', 'South', 'Midwest', 'West'];
  const list = $('#states-list');
  const extras = PLACES.filter((p) => p.extra);
  const sec = (title: string, ps: Place[]) => `<h3>${esc(title)}</h3><ul>${ps.sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
    const w0 = WORKS[p.works[0]];
    return `<li><button data-u="${p.usps}"><img src="${esc(media(w0?.img || ''))}" alt="" loading="lazy"><span><b>${esc(p.name)}</b><i>${esc(p.artists.slice(0, 3).join(', '))}${p.artists.length > 3 ? ' +' + (p.artists.length - 3) : ''}</i></span><em>${p.works.length}</em></button></li>`;
  }).join('')}</ul>`;
  list.innerHTML = regions.map((r) => sec(r, PLACES.filter((p) => p.region === r && !p.extra))).join('') + sec('Beyond the fifty', extras);
  list.querySelectorAll<HTMLButtonElement>('button[data-u]').forEach((b) => b.addEventListener('click', () => {
    const pv = W.pavs.find((p) => p.place.usps === b.dataset.u);
    closePanel();
    if (pv) goToPlace(pv);
  }));
  const q = $<HTMLInputElement>('#states-q');
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase();
    list.querySelectorAll<HTMLElement>('li').forEach((li) => { li.hidden = !!s && !li.textContent!.toLowerCase().includes(s); });
  });
}
function openPanel(id: string) {
  document.querySelectorAll('.panel.open').forEach((p) => p.classList.remove('open'));
  $(id).classList.add('open');
}
function closePanel() { document.querySelectorAll('.panel.open').forEach((p) => p.classList.remove('open')); }
let flashT = 0;
function flash(msg: string) {
  const el = $('#flash');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(flashT);
  flashT = window.setTimeout(() => el.classList.remove('on'), 2400);
}

/* ---------- the tour: the whole country in one drive ---------- */
function startTour() {
  tour = true;
  $('#tourbtn').classList.add('on');
  if (mapMode) leaveMap(false);
  tourIdx = current >= 0 ? TRIP_WORKS.indexOf(W.hung[current].i) : -1;
  nextTour();
}
function stopTour() {
  if (!tour) return;
  tour = false;
  $('#tourbtn').classList.remove('on');
}
function nextTour() {
  tourIdx = (tourIdx + 1) % TRIP_WORKS.length;
  const h = HUNG_BY_WORK.get(TRIP_WORKS[tourIdx]);
  tourClock = 0;
  if (h) goToWork(h);
}
function stepWork(dir: number) {
  stopTour();
  let i = current >= 0 ? TRIP_WORKS.indexOf(W.hung[current].i) : -1;
  if (i < 0) {
    // nearest work to the visitor, in trip order
    const c = camera.position;
    let best = 0, bd = Infinity;
    TRIP_WORKS.forEach((wi, j) => { const h = HUNG_BY_WORK.get(wi)!; const d = h.pos.distanceTo(c); if (d < bd) { bd = d; best = j; } });
    i = dir > 0 ? best - 1 : best + 1;
  }
  const j = (i + dir + TRIP_WORKS.length) % TRIP_WORKS.length;
  const h = HUNG_BY_WORK.get(TRIP_WORKS[j]);
  if (h) goToWork(h);
}

/* ---------- input ---------- */
const ray = new T.Raycaster();
function tap(nx: number, ny: number) {
  ray.setFromCamera(new T.Vector2(nx, ny), camera);
  const targets: T.Object3D[] = mapMode ? W.pavs.map((p) => p.pick) : [...W.hung.filter((h) => h.g.visible).map((h) => h.art), ...W.hung.filter((h) => h.label).map((h) => h.label!), W.dir[0].mesh, ...W.dir.map((d) => d.top), W.lookoutPick];
  const hits = ray.intersectObjects(targets, false);
  if (mapMode) {
    if (hits[0]) goToPlace(W.pavs[hits[0].object.userData.pav]);
    return;
  }
  // walls in front of a target win: compare with the static world
  const solid = ray.intersectObjects(scene.children.filter((o) => (o as T.Mesh).isMesh && !(o as T.Mesh).userData.hung && o !== W.lookoutPick && !W.pavs.some((p) => p.pick === o)), false)
    .filter((i) => !((i.object as T.Mesh).material as T.Material).transparent);
  const hit = hits[0];
  if (hit && (!solid[0] || solid[0].distance >= hit.distance - 0.05)) {
    const o = hit.object;
    if (o.userData.hung !== undefined) {
      const h = W.hung[o.userData.hung];
      stopTour();
      if (hit.distance < 7) openDetail(h);
      else goToWork(h, true);
      return;
    }
    if (o.userData.dir !== undefined || o.userData.dirInstanced) {
      const d = W.dir[o.userData.dirInstanced ? hit.instanceId! : o.userData.dir];
      const pv = W.pavs.find((p) => p.place === d.place);
      if (pv) goToPlace(pv);
      return;
    }
    if (o === W.lookoutPick) { enterMap(); return; }
  }
  // the floor: walk there
  const t = -camera.position.y / ray.ray.direction.y;
  if (ray.ray.direction.y < -0.02 && t < 80 && (!solid[0] || solid[0].distance > t - 0.5)) {
    goal = ray.ray.at(t, new T.Vector3());
    goal.y = W.eye;
    goalLook = null;
    stopTour();
  }
}
function bindControls(canvas: HTMLCanvasElement) {
  let id = -1, lx = 0, ly = 0, moved = 0;
  const sens = touch ? 1.35 : 1;
  canvas.addEventListener('pointerdown', (e) => {
    if (id !== -1) return;
    canvas.focus();
    id = e.pointerId; lx = e.clientX; ly = e.clientY; moved = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* webviews */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    moved += Math.abs(dx) + Math.abs(dy);
    lx = e.clientX; ly = e.clientY;
    if (flight) return;
    if (mapMode) {
      // drag the map
      const s = camera.position.y / 900;
      camera.position.x -= (dx * Math.cos(yaw) + dy * Math.sin(yaw)) * s * 1.6;
      camera.position.z -= (-dx * Math.sin(yaw) + dy * Math.cos(yaw)) * s * 1.6;
      return;
    }
    yaw -= dx * 0.0042 * sens;
    pitch = T.MathUtils.clamp(pitch - dy * 0.0032 * sens, -1.1, 1.1);
    if (moved > 4) { goal = null; stopTour(); }
  });
  canvas.addEventListener('pointercancel', (e) => { if (e.pointerId === id) id = -1; });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerId !== id) return;
    id = -1;
    if (moved > (touch ? 12 : 6)) return;
    const r = canvas.getBoundingClientRect();
    tap(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (mapMode) {
      camera.position.y = T.MathUtils.clamp(camera.position.y * (e.deltaY > 0 ? 1.08 : 0.92), 90, 1100);
      return;
    }
    const f = new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    camera.position.addScaledVector(f, e.deltaY < 0 ? 0.8 : -0.8);
    constrain();
  }, { passive: false });
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if ($('#detail').classList.contains('open')) closeDetail(); else if (document.querySelector('.panel.open')) closePanel(); else if (mapMode) leaveMap(); return; }
    if ($('#detail').classList.contains('open') && k !== 'j' && k !== 'k') return;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(k)) {
      e.preventDefault();
      keys.add(k);
      goal = null;
      stopTour();
      if (flight && !mapMode) flight = null;
    }
    if (k === 'm') mapMode ? leaveMap() : enterMap();
    if (k === 'j') { closeDetail(); stepWork(e.shiftKey ? -1 : 1); }
    if (k === 'k') { closeDetail(); stepWork(-1); }
    if (k === 't') tour ? stopTour() : startTour();
    if (k === 'l') cycleTime();
    if (k === 'h') { stopTour(); fly(W.spawn.clone().setY(W.eye), W.look); }
    if (k === 'enter' && current >= 0 && !t.closest('button,a')) openDetail(W.hung[current]);
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  // the thumb stick
  const stick = $('#stick'), knob = stick.querySelector('i') as HTMLElement;
  const R = 44;
  let sid = -1, cx = 0, cy = 0;
  const move = (e: PointerEvent) => {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    stickDir.s = Math.abs(dx / R) < 0.14 ? 0 : dx / R;
    stickDir.f = Math.abs(dy / R) < 0.14 ? 0 : -dy / R;
  };
  stick.addEventListener('pointerdown', (e) => {
    if (sid !== -1) return;
    e.preventDefault();
    sid = e.pointerId;
    try { stick.setPointerCapture(e.pointerId); } catch { /* as above */ }
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    goal = null; stopTour();
    move(e);
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) move(e); });
  const end = (e: PointerEvent) => { if (e.pointerId !== sid) return; sid = -1; stickDir.f = stickDir.s = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
}

/* ---------- frame ---------- */
let prev = performance.now();
let fxFrames = 0, fxAcc = 0, fxJudged = false;
let whereClock = 0, clockClock = 0;
function animate(now: number) {
  requestAnimationFrame(animate);
  frame(now);
}
function frame(now: number) {
  const dt = Math.min(0.1, Math.max(0, (now - prev) / 1000));
  prev = now;
  const t = now / 1000;

  if (flight) {
    flight.t += dt / flight.dur;
    const u = Math.min(1, flight.t), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    camera.position.lerpVectors(flight.from, flight.to, e);
    camera.position.y += Math.sin(Math.PI * e) * flight.arc;
    yaw = flight.y0 + (flight.y1 - flight.y0) * e;
    const lift = flight.arc > 0 ? Math.sin(Math.PI * e) * -0.55 : 0;
    pitch = flight.p0 + (flight.p1 - flight.p0) * e + lift;
    if (u >= 1) { const d = flight.done; flight = null; d?.(); }
  } else if (!mapMode) {
    const run = keys.has('shift') ? 10.5 : 4.4;
    let f = 0, s = 0;
    if (keys.has('w') || keys.has('arrowup')) f += 1;
    if (keys.has('s') || keys.has('arrowdown')) f -= 1;
    if (keys.has('a')) s -= 1;
    if (keys.has('d')) s += 1;
    if (keys.has('arrowleft') || keys.has('q')) yaw += 2.2 * dt;
    if (keys.has('arrowright') || keys.has('e')) yaw -= 2.2 * dt;
    f += stickDir.f; s += stickDir.s;
    const fwd = new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new T.Vector3(-fwd.z, 0, fwd.x);
    if (f || s) {
      const m = Math.min(1, Math.hypot(f, s));
      const dir = fwd.multiplyScalar(f).add(right.multiplyScalar(s)).normalize();
      camera.position.addScaledVector(dir, run * m * dt);
      current = -1;
    } else if (goal) {
      const d = goal.clone().sub(camera.position).setY(0);
      const L = d.length();
      if (L < 0.2) goal = null;
      else {
        const before = camera.position.clone();
        camera.position.addScaledVector(d.normalize(), Math.min(L, 4.4 * dt));
        constrain();
        if (camera.position.distanceTo(before) < 0.001) goal = null;     // walked into a wall
        const a = Math.atan2(-d.x, -d.z);
        yaw += wrapPi(a - yaw) * Math.min(1, dt * 3);
      }
    }
    constrain();
    if (tour) {
      tourClock += dt;
      if (tourClock > 7.5) nextTour();
    }
  } else {
    // in the overview, Q/E and the arrows still pan
    const s = camera.position.y / 600;
    if (keys.has('w') || keys.has('arrowup')) camera.position.z -= 260 * s * dt;
    if (keys.has('s') || keys.has('arrowdown')) camera.position.z += 260 * s * dt;
    if (keys.has('a') || keys.has('arrowleft')) camera.position.x -= 260 * s * dt;
    if (keys.has('d') || keys.has('arrowright')) camera.position.x += 260 * s * dt;
  }
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  W.follow(camera.position);

  kit.tick(t, dt);
  streamClock += dt;
  if (streamClock > 0.25) { streamClock = 0; stream(); }
  whereClock += dt;
  if (whereClock > 0.3) { whereClock = 0; where(); }
  clockClock += dt;
  if (clockClock > 60) { clockClock = 0; if (timeMode === 'live') applyHour(); }
  if (mapMode) placeMapLabels();
  if (soundOn) {
    hornCool -= dt;
    const tx = W.train.x(), dz = Math.abs(camera.position.z - W.train.z), dx = tx - camera.position.x;
    if (hornCool <= 0 && dz < 260 && dx > 40 && dx < 320) { horn(Math.hypot(dx, dz)); hornCool = 70; }
  }

  if (fx) fx.render();
  else renderer.render(scene, camera);

  if (fx && !fxJudged) {
    fxFrames++;
    if (fxFrames > 45) { fxAcc += dt * 1000; if (fxFrames > 135) { fxJudged = true; if (fxAcc / 90 > 24) { fx.dispose(); fx = null; console.info('[field] post effects off: frame time', (fxAcc / 90).toFixed(1), 'ms'); } } }
  }
}

/* ---------- boot ---------- */
function boot() {
  const host = $('#world');
  X.textureBudget(quality === 'low');
  renderer = new T.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.6 : 1.2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  if (quality === 'high') { renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; }
  host.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'The field: a walkable map of America. Drag to look, W A S D to walk, J for the next work, M for the map.');
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('#lost').hidden = false; });
  camera = new T.PerspectiveCamera(62, host.clientWidth / host.clientHeight, 0.3, 3200);
  scene = new T.Scene();
  kit = new Kit(scene, { renderer, quality, reduced, atlas: () => Promise.reject(new Error('no atlas')), atlasGrid: 1, perAtlas: 1, hour: 12, dynamic: false });
  W = buildWorld(kit, renderer, { quality, reduced });
  kit.batch();
  W.hung.forEach((h) => HUNG_BY_WORK.set(h.i, h));
  // the directory lids keep their pictures for the whole visit
  for (const d of W.dir) {
    const w0 = WORKS[d.place.works[0]];
    if (!w0?.img) continue;
    acquire(media(w0.img)).then((t) => { const m = d.top.material as T.MeshBasicMaterial; m.map = t; m.color.set(0xffffff); m.needsUpdate = true; }).catch(() => { /* stays a colour */ });
  }
  applyHour();
  if (quality === 'high' && params.get('fx') !== 'off') fx = new Fx(renderer, scene, camera, host.clientWidth, host.clientHeight);

  // arrival, or a place named in the hash
  camera.position.copy(W.spawn).setY(W.eye);
  const a = anglesTo(camera.position, W.look);
  yaw = a.yaw; pitch = a.pitch;
  const hash = new URLSearchParams(location.hash.slice(1));
  const hs = hash.get('state')?.toUpperCase();
  const hw = hash.get('work');
  if (hs && byUsps.has(hs)) {
    const pv = W.pavs.find((p) => p.place.usps === hs)!;
    camera.position.set(pv.x + (pv.kind === 'shed' ? -4.3 : 0), W.eye, pv.z + pv.l / 2 + 4.5);
    const b = anglesTo(camera.position, new T.Vector3(camera.position.x, 1.7, pv.z - pv.l / 2));
    yaw = b.yaw; pitch = b.pitch;
  } else if (hw) {
    const h = W.hung.find((x) => x.work.id === hw || x.work.work === hw);
    if (h) { const vp = viewpointOf(h); camera.position.copy(vp); const b = anglesTo(vp, h.pos); yaw = b.yaw; pitch = b.pitch; }
  }
  if (params.has('at')) {
    const [x, y, z] = params.get('at')!.split(',').map(Number);
    camera.position.set(x, y, z);
    if (params.has('yaw')) yaw = (Number(params.get('yaw')) * Math.PI) / 180;
    if (params.has('pitch')) pitch = (Number(params.get('pitch')) * Math.PI) / 180;
  }
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  stream();

  bindControls(renderer.domElement);
  addEventListener('resize', () => {
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
    fx?.setSize(host.clientWidth, host.clientHeight);
  });

  // HUD
  const st = D.stats;
  $('#gate-stats').textContent = `${st.artists} artists · ${st.works} works · ${st.states} of 50 states`;
  $('#mapbtn').addEventListener('click', () => (mapMode ? leaveMap() : enterMap()));
  $('#statesbtn').addEventListener('click', () => openPanel('#states'));
  $('#aboutbtn').addEventListener('click', () => openPanel('#about'));
  $('#tourbtn').addEventListener('click', () => (tour ? stopTour() : startTour()));
  $('#timebtn').addEventListener('click', cycleTime);
  $('#nextbtn').addEventListener('click', () => stepWork(1));
  $('#prevbtn').addEventListener('click', () => stepWork(-1));
  $('#homebtn').addEventListener('click', () => { stopTour(); if (mapMode) leaveMap(false); fly(W.spawn.clone().setY(W.eye), W.look); });
  $('#soundbtn').addEventListener('click', () => {
    soundOn = !soundOn;
    $('#soundbtn').classList.toggle('on', soundOn);
    $('#soundbtn').textContent = soundOn ? 'SOUND ON' : 'SOUND';
    if (soundOn) startSound(); else stopSound();
  });
  document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.close === 'detail') closeDetail(); else closePanel(); }));
  buildStates();
  const enter = () => {
    $('#gate').classList.add('gone');
    renderer.domElement.focus();
    if (params.has('tour')) startTour();
    setTimeout(() => flash('Drag to look · W A S D to walk · M for the map · J for the next work'), 900);
  };
  $('#enter').addEventListener('click', enter);
  if (params.has('auto')) enter();

  /* test hooks for the headless harness and the shot script */
  (window as unknown as { __fa: unknown }).__fa = {
    camera, scene, renderer, kit, world: W, PLACES, WORKS, TRIP,
    setHour: (h: number) => { W.sky.setHour(h); },
    goToPlace: (u: string) => { const pv = W.pavs.find((p) => p.place.usps === u); if (pv) goToPlace(pv); },
    goToWork: (i: number) => { const h = HUNG_BY_WORK.get(i); if (h) goToWork(h); },
    map: () => enterMap(),
    look: (x: number, y: number, z: number, yw: number, pt: number) => { flight = null; camera.position.set(x, y, z); yaw = (yw * Math.PI) / 180; pitch = (pt * Math.PI) / 180; },
    stats: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, tex: renderer.info.memory.textures, geo: renderer.info.memory.geometries, playing, loaded: W.hung.filter((h) => h.lod > 0).length }),
    standable, viewpointOf: (i: number) => viewpointOf(W.hung[i]), constrain, flying: () => !!flight,
    /* drive frames by hand when the page is hidden and rAF is paused */
    step: (n = 30, dt = 1 / 30) => { let now = prev; for (let i = 0; i < n; i++) { now += dt * 1000; frame(now); } },
    tap: (nx: number, ny: number) => tap(nx, ny),
    detail: (i: number) => openDetail(W.hung[i]),
  };
  if (params.has('audit')) audit(W, kit, (i) => viewpointOf(W.hung[i]), standable, constrain, camera);
  requestAnimationFrame(animate);
}
boot();
export type { Pav };
