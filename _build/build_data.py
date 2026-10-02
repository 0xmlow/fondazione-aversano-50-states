"""Build site/assets/data.js (window.FA_DATA) from the Foundation's own 50 States data.

Sources, all in _source/: data.json (window.DATA lifted from fondazioneaversano.org/50-states),
map.svg (the site's own Albers USA map, 975 x 610) and the media folder downloaded beside the site.

World frame: one map pixel = S metres. x grows east, z grows south, so north is -z and the visitor
looking down -z is looking north. The map origin (487.5, 305) is the world origin.
"""
import json, math, re, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '_source')
SITE = os.path.join(HERE, '..', 'site')
S = 1.15                     # metres per map pixel: the map is 1,121 m east to west
OX, OY = 487.5, 305.0

D = json.load(open(os.path.join(SRC, 'data.json')))
svg = open(os.path.join(SRC, 'map.svg')).read()

def w(px, py):
    return [round((px - OX) * S, 2), round((py - OY) * S, 2)]

# ---- d3.geoAlbersUsa lower-48 projection (scale 1300, translate 487.5 305) for places not on the map
def albers(lon, lat):
    r = math.radians
    p0, p1 = r(29.5), r(45.5)
    n = (math.sin(p0) + math.sin(p1)) / 2
    c = 1 + math.sin(p0) * (2 * n - math.sin(p0))
    r0 = math.sqrt(c) / n
    def raw(l, f):
        rr = math.sqrt(c - 2 * n * math.sin(f)) / n
        return rr * math.sin(l * n), r0 - rr * math.cos(l * n)
    k = 1300
    cx, cy = raw(r(-0.6), r(38.7))
    tx, ty = 487.5 - k * cx, 305 + k * cy
    x, y = raw(r(lon + 96), r(lat))
    return tx + k * x, ty - k * y

# ---- state outlines
paths = dict(re.findall(r'<path[^>]*?id="p-([A-Z]{2})"[^>]*?d="([^"]+)"', svg))
if len(paths) < 50:
    paths = {u: d for d, u in re.findall(r'<path[^>]*?d="([^"]+)"[^>]*?id="p-([A-Z]{2})"', svg)}
labels = {t: (float(x), float(y)) for x, y, t in re.findall(r'<text x="([\d.]+)" y="([\d.]+)">([A-Z]{2})</text>', svg)}

def rings_of(d):
    out = []
    for part in re.findall(r'M[^M]+', d):
        pts = [(float(a), float(b)) for a, b in re.findall(r'(-?[\d.]+)[ ,](-?[\d.]+)', part)]
        if len(pts) >= 3:
            out.append(pts)
    return out

def area(r):
    return 0.5 * sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))

def centroid(r):
    a = area(r) or 1e-9
    cx = cy = 0
    for i in range(len(r)):
        x0, y0 = r[i]; x1, y1 = r[(i + 1) % len(r)]
        f = x0 * y1 - x1 * y0
        cx += (x0 + x1) * f; cy += (y0 + y1) * f
    return cx / (6 * a), cy / (6 * a)

def simplify(pts, tol):
    # Douglas-Peucker on a closed ring (split at the far point)
    def dp(p):
        if len(p) < 3: return p
        (x0, y0), (x1, y1) = p[0], p[-1]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, 0
        for i in range(1, len(p) - 1):
            d = abs(dy * p[i][0] - dx * p[i][1] + x1 * y0 - y1 * x0) / L
            if d > best: best, bi = d, i
        if best > tol:
            return dp(p[:bi + 1])[:-1] + dp(p[bi:])
        return [p[0], p[-1]]
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    a = dp(pts[:far + 1]); b = dp(pts[far:] + [pts[0]])
    return a[:-1] + b[:-1]

# Places the map does not draw. DC sits on the Potomac between MD and VA; the territories ride in a
# row of islands along the southern edge, the way every US wall map insets them.
EXTRA_PX = {
    'DC': albers(-77.03, 38.9),
    'PR': (905.0, 572.0),
    'GU': (205.0, 596.0),
    'UM': (262.0, 548.0),
}

# ---- artworks: one record per token (a token is one thing on one wall)
works, aspect = [], {}
def ar_of(rel):
    p = os.path.join(SITE, 'media', os.path.basename(rel))
    try:
        with Image.open(p) as im:
            return round(im.width / im.height, 4)
    except Exception:
        return 1.0

for wid, wk in D['works'].items():
    for i, t in enumerate(wk['tokens']):
        img = os.path.basename(t['image']) if t.get('image') else None
        works.append({
            'id': f'{wid}-{i + 1}', 'work': wid, 'usps': wk['usps'], 'state': wk['state'],
            'artist': wk['artist'], 'artist_url': wk.get('artist_url'),
            'title': t.get('name') or wk['title'], 'series': wk['title'],
            'chain': t.get('chain_label') or wk.get('chain_label'),
            'img': img, 'img2': os.path.basename(t['image_2x']) if t.get('image_2x') else img,
            'anim': os.path.basename(t['anim']) if t.get('anim') else None, 'kind': t.get('anim_kind'),
            'ar': ar_of(t['image_2x'] or t['image']) if t.get('image') else 1.0,
            'desc': (t.get('description') or wk.get('description') or '')[:1400],
            'acq': t.get('acquired_at'), 'from': t.get('acquired_from_name'), 'from_url': t.get('acquired_from_url'),
            'by_artist': t.get('from_artist'), 'donated': wk.get('donated'),
            'tx': t.get('tx_url'), 'explorer': t.get('explorer_url'), 'market': t.get('external_url'),
            'contract': t.get('contract'), 'token_id': t.get('token_id'), 'edition': wk.get('edition'),
            'hue': wk.get('hue', 20),
        })
idx = {}
for i, wk in enumerate(works):
    idx.setdefault(wk['work'], []).append(i)

# ---- pavilions
# Every artist gets a bay of their own: a stretch of wall between two short fins, their name over
# their work. An artist with four or more works gets a facing pair of bays, a room of their own.
BAY = {'box':  {'slot': 3.9, 'pad': 0.9, 'end': 2.6, 'w': 8.4, 'min': 10.0},
       'shed': {'slot': 4.6, 'pad': 1.2, 'end': 6.5, 'w': 18.0, 'min': 26.0}}

def plan(ids):
    kind = 'shed' if len(ids) >= 8 else 'box'
    B = BAY[kind]
    groups = {}
    for i in ids:
        groups.setdefault(works[i]['artist'], []).append(i)
    order = sorted(groups.items(), key=lambda g: (-len(g[1]), g[0].lower()))
    cur = {-1: 0.0, 1: 0.0}
    bays = []
    for artist, ws in order:
        k = len(ws)
        if k >= 4 or (len(order) == 1 and k >= 2):
            a, b = ws[:(k + 1) // 2], ws[(k + 1) // 2:]
            width = max(len(a), len(b)) * B['slot'] + B['pad']
            start = max(cur[-1], cur[1])
            bays.append({'artist': artist, 'side': -1, 's0': start, 's1': start + width, 'works': a, 'pair': True})
            bays.append({'artist': artist, 'side': 1, 's0': start, 's1': start + width, 'works': b, 'pair': True})
            cur[-1] = cur[1] = start + width
        else:
            side = -1 if cur[-1] <= cur[1] else 1
            width = k * B['slot'] + B['pad']
            bays.append({'artist': artist, 'side': side, 's0': cur[side], 's1': cur[side] + width, 'works': ws, 'pair': False})
            cur[side] += width
    run = max(cur.values())
    L = max(B['min'], run + 2 * B['end'])
    # centre the run in the pavilion; s runs from the south end northward
    off = (L - run) / 2
    for b in bays:
        b['s0'] = round(b['s0'] + off, 3); b['s1'] = round(b['s1'] + off, 3)
    return kind, B['w'], round(L, 2), bays

states = []
for s in D['states']:
    u = s['usps']
    ids = [i for wid in s['works'] for i in idx.get(wid, [])]
    if u in paths:
        rings = rings_of(paths[u])
        big = max(rings, key=lambda r: abs(area(r)))
        c = labels.get(u) or centroid(big)
        outline = [[w(*p) for p in simplify(r, 0.6)] for r in rings if abs(area(r)) > 4]
    else:
        c = EXTRA_PX[u]; outline = []
    kind, W, L, bays = plan(ids)
    ids = [i for b in bays for i in b['works']]
    x, z = w(*c)
    states.append({'usps': u, 'name': s['name'], 'region': s['region'], 'extra': s['extra'],
                   'cx': x, 'cz': z, 'x': x, 'z': z, 'kind': kind, 'w': W, 'l': L, 'works': ids, 'bays': bays, 'rings': outline,
                   'artists': sorted({works[i]['artist'] for i in ids})})

MARFA = w(*albers(-104.02, 30.31))
CENTER = w(*albers(-98.58, 39.83))        # Lebanon, Kansas: geographic centre of the contiguous states
HALL = {'x': MARFA[0], 'z': MARFA[1] + 6, 'w': 22.0, 'l': 54.0}
LOOKOUT = {'x': CENTER[0], 'z': CENTER[1], 'r': 9.0}

# Relax the pavilions so none overlap (the north east is dense: at this scale Rhode Island is six metres
# across). Each one springs back toward its own state so the map still reads.
fixed = [(HALL['x'], HALL['z'], HALL['w'] / 2 + 6, HALL['l'] / 2 + 6), (LOOKOUT['x'], LOOKOUT['z'], 16, 16)]
GAP = 7.0
for it in range(900):
    moved = 0
    for i, a in enumerate(states):
        fx = (a['cx'] - a['x']) * 0.02; fz = (a['cz'] - a['z']) * 0.02
        boxes = [(b['x'], b['z'], b['w'] / 2 + GAP / 2, b['l'] / 2 + GAP / 2) for j, b in enumerate(states) if j != i] + fixed
        for bx, bz, bw, bl in boxes:
            ox = (a['w'] / 2 + GAP / 2 + bw) - abs(a['x'] - bx)
            oz = (a['l'] / 2 + GAP / 2 + bl) - abs(a['z'] - bz)
            if ox > 0 and oz > 0:
                if ox < oz: fx += math.copysign(ox * 0.5, a['x'] - bx or 1)
                else: fz += math.copysign(oz * 0.5, a['z'] - bz or 1)
        a['x'] += fx; a['z'] += fz
        moved = max(moved, abs(fx) + abs(fz))
    if moved < 0.01 and it > 50: break
for a in states:
    a['x'] = round(a['x'], 2); a['z'] = round(a['z'], 2)
print('relaxed in', it, 'iterations; largest drift',
      round(max(math.hypot(a['x'] - a['cx'], a['z'] - a['cz']) for a in states), 1), 'm')

# overlap check
bad = 0
for i, a in enumerate(states):
    for b in states[i + 1:]:
        if abs(a['x'] - b['x']) < (a['w'] + b['w']) / 2 + 2 and abs(a['z'] - b['z']) < (a['l'] + b['l']) / 2 + 2:
            bad += 1; print('overlap', a['usps'], b['usps'])
print('overlaps', bad)

xs = [p[0] for s in states for r in s['rings'] for p in r]; zs = [p[1] for s in states for r in s['rings'] for p in r]
bounds = [min(xs) - 90, max(xs) + 90, min(zs) - 90, max(zs) + 120]

# brand marks derived from the Foundation's crest: ink on clear, bone on clear
src = Image.open(os.path.join(SITE, 'assets/brand/fa_logo.png')).convert('RGBA')
px = src.load()
ink = Image.new('RGBA', src.size); bone = Image.new('RGBA', src.size)
pi, pb = ink.load(), bone.load()
for yy in range(src.height):
    for xx in range(src.width):
        r, g, b, a = px[xx, yy]
        lum = (r + g + b) / 3
        alpha = int(min(a, 255 - lum))       # dark line work becomes opaque, white ground goes clear
        pi[xx, yy] = (13, 13, 13, alpha)
        pb[xx, yy] = (246, 242, 234, alpha)
ink.save(os.path.join(SITE, 'assets/brand/fa_ink.png')); bone.save(os.path.join(SITE, 'assets/brand/fa_bone.png'))

stats = D['stats']
out = {'scale': S, 'bounds': bounds, 'marfa': MARFA, 'hall': HALL, 'lookout': LOOKOUT, 'states': states, 'works': works,
       'stats': {'artists': stats['artists'], 'works': len(works), 'states': stats['states_collected'], 'chains': stats['chains']}}
js = 'window.FA_DATA=' + json.dumps(out, separators=(',', ':')) + ';\n'
open(os.path.join(SITE, 'assets/data.js'), 'w').write(js)
print('works', len(works), 'states', len(states), 'bounds', [round(b) for b in bounds], 'marfa', MARFA, 'center', CENTER,
      'data.js', len(js) // 1024, 'KB')
