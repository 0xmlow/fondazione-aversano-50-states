/* The Foundation's 50 States collection as the gallery sees it: window.FA_DATA from assets/data.js,
   built by _build/build_data.py out of fondazioneaversano.org's own record. */

export type Work = {
  id: string;
  work: string;
  usps: string;
  state: string;
  artist: string;
  artist_url: string | null;
  title: string;
  series: string;
  chain: string;
  img: string | null;
  img2: string | null;
  anim: string | null;
  kind: 'video' | 'gif' | null;
  ar: number;
  desc: string;
  acq: string | null;
  from: string | null;
  from_url: string | null;
  by_artist: boolean | null;
  donated: unknown;
  tx: string | null;
  explorer: string | null;
  market: string | null;
  contract: string | null;
  token_id: string | null;
  edition: string | null;
  hue: number;
};
/* kit.ts calls a hung thing a Piece; here every Piece is a Work */
export type Piece = Work;

export type Place = {
  usps: string;
  name: string;
  region: 'West' | 'South' | 'Midwest' | 'Northeast' | string;
  extra: boolean;
  cx: number;
  cz: number;
  x: number;
  z: number;
  kind: 'box' | 'shed';
  w: number;
  l: number;
  works: number[];
  bays: { artist: string; side: -1 | 1; s0: number; s1: number; works: number[]; pair: boolean }[];
  rings: [number, number][][];
  artists: string[];
};

type FAData = {
  scale: number;
  bounds: [number, number, number, number];
  marfa: [number, number];
  hall: { x: number; z: number; w: number; l: number };
  lookout: { x: number; z: number; r: number };
  states: Place[];
  works: Work[];
  stats: { artists: number; works: number; states: number; chains: string[] };
};

declare global {
  interface Window {
    FA_DATA: FAData;
  }
}

export const D = window.FA_DATA;
export const WORKS = D.works;
export const PLACES = D.states;
export const byUsps = new Map(PLACES.map((p) => [p.usps, p]));
export const media = (f: string) => 'media/' + f;

/* Marfa keeps Central time. ?hour=H pins the light; ?day=YYYY-MM-DD is kept for the record. */
const params = new URLSearchParams(location.search);
function marfaHour() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value || 12) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return h + m / 60;
}
export const liveHour = marfaHour;
export const PINNED_HOUR = params.has('hour') ? Number(params.get('hour')) : null;
export const clockLabel = (h: number) => {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
};

/* The road trip: every place in one continuous drive, starting in Marfa and always taking the nearest
   place not yet seen. This is the order of the tour and of J for the next work. */
export const TRIP: Place[] = (() => {
  const left = PLACES.slice();
  const out: Place[] = [];
  let x = D.hall.x, z = D.hall.z;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((p, i) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; bi = i; } });
    const p = left.splice(bi, 1)[0];
    out.push(p);
    x = p.x; z = p.z;
  }
  return out;
})();
export const TRIP_WORKS: number[] = TRIP.flatMap((p) => p.works);
