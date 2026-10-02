#!/usr/bin/env python3
"""shot.py <out dir> <shots.json> [--port 9341] [--w 1600 --h 900] [--query 'hour=14'] [--mobile]
Screenshot THE FIELD in headless Chrome against the local server on :4290, one Chrome for many shots.
shots.json is a list of {"name": "...", "eval": "js run on the page first (may await)", "wait": seconds}.
Rendering keeps going in headless Chrome, so the frame is real (rAF runs; the in-app pane pauses it)."""
import subprocess, time, os, sys, json, urllib.request, argparse, tempfile, base64, shutil
import websocket
ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('shots')
ap.add_argument('--port', type=int, default=9341); ap.add_argument('--w', type=int, default=1600); ap.add_argument('--h', type=int, default=900)
ap.add_argument('--query', default='hour=14'); ap.add_argument('--mobile', action='store_true'); ap.add_argument('--boot', type=float, default=7)
a = ap.parse_args()
if a.mobile: a.w, a.h = 390, 844
os.makedirs(a.out, exist_ok=True)
shots = json.load(open(a.shots))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
prof = tempfile.mkdtemp(prefix=f'field-{a.port}-')
chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={a.port}", f"--window-size={a.w},{a.h}", "--user-data-dir=" + prof,
                           "--use-angle=metal", "--disable-extensions", "--autoplay-policy=no-user-gesture-required", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
HOST = f'http://127.0.0.1:{a.port}'
for _ in range(80):
    try: urllib.request.urlopen(HOST + "/json/version"); break
    except Exception: time.sleep(0.25)
try:
    r = json.load(urllib.request.urlopen(urllib.request.Request(f'{HOST}/json/new?about:blank', method='PUT')))
    ws = websocket.create_connection(r['webSocketDebuggerUrl'], max_size=None, suppress_origin=True); n = [0]
    def send(method, **params):
        n[0] += 1; ws.send(json.dumps({'id': n[0], 'method': method, 'params': params}))
        while True:
            m = json.loads(ws.recv())
            if m.get('id') == n[0]: return m.get('result', {})
    send('Page.enable'); send('Runtime.enable')
    send('Emulation.setDeviceMetricsOverride', width=a.w, height=a.h, deviceScaleFactor=3 if a.mobile else 1, mobile=a.mobile)
    if a.mobile:
        send('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
    send('Page.navigate', url=f"http://127.0.0.1:4290/?auto&{a.query}&v={int(time.time())}")
    time.sleep(a.boot)
    for s in shots:
        if s.get('eval'):
            res = send('Runtime.evaluate', expression=s['eval'], returnByValue=True, awaitPromise=True)
            val = res.get('result', {}).get('value')
            if res.get('exceptionDetails'): print(s['name'], 'EXCEPTION', res['exceptionDetails'].get('text'), res['exceptionDetails'].get('exception', {}).get('description', '')[:300])
            elif val is not None: print(s['name'], 'eval ->', json.dumps(val)[:400])
        time.sleep(s.get('wait', 3))
        shot = send('Page.captureScreenshot', format='png', fromSurface=True)
        p = os.path.join(a.out, s['name'] + '.png')
        open(p, 'wb').write(base64.b64decode(shot['data']))
        print('saved', p)
finally:
    chrome.terminate()
    try: chrome.wait(timeout=10)
    except Exception: pass
    shutil.rmtree(prof, ignore_errors=True)
