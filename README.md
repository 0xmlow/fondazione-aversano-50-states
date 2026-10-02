# 50 States · The Field

A walkable virtual gallery for Fondazione Aversano's 50 States collection: 145 artists, 200 works, 54 places. It is built on the NEW YORKERS museum engine (three 0.185, esbuild, the same kit).

**The idea.** It reimagines Donald Judd's Chinati Foundation in Marfa. A walkable map of America (1.1 km coast to coast) is drawn into the desert floor, with each state an inlay of gravel edged in Cor-ten. Every state has a Judd concrete pavilion standing where the state is. Each pavilion is open at both ends, with a low lintel and a skylight slot that throws a stripe of sun down the floor. The five largest collections (New York, California, Wyoming, New Jersey and Texas) hang in Quonset-vaulted artillery sheds. You arrive in Marfa in a reborn artillery shed. Its 54 mill-aluminum boxes, one per place, each carry that place's first work under the lid, and you tap one to travel there.

Other features:
- **The middle:** a Hadid ribbon tower stands at the geographic centre near Lebanon, Kansas. Tap it to see all fifty from above.
- **The Arsham moment:** one Judd concrete unit, eroded to blue calcite, set outside the hall's north door.
- **The light** follows the Marfa clock. After dark, look south from the viewing area for the Marfa lights.
- **Life on the map:** the Union Pacific freight runs along the southern edge, and there are a windmill, turkey vultures, tumbleweeds and visitors.

## v2 (2026-10-02, after client feedback)

- **Lecterns in the hall:** the 54 directory boxes are now white lecterns, following Justin's sketch. They are 0.78 m at the front and 1.25 m at the back, with each place's work laid on the slope facing you. They stand in two rows either side of a clear central nave, so the hall can be seen end to end.
- **Every artist has their own bay:** a stretch of wall between two short fins, with a title panel carrying their name, number of works and state over their work. An artist with four or more works gets a facing pair of bays, a room of their own (Wyoming is Jacob Vandervelde's room). The sheds lose their spine and become an open nave of alcoves, with an intro wall inside the door naming every artist. The bays are planned in `build_data.py` (`plan()`), and the pavilions lengthen to fit (New York is now 80 m).
- **Location chip:** names the artist whose bay you are facing.
- **Road trip and J:** go bay by bay, artist by artist.

## Run it

```bash
cd "50 STATES GALLERY/site" && python3 -m http.server 4290
```

Open http://localhost:4290. You can add these to the URL:
- `?hour=22` pins the light.
- `#state=NY` starts you at a state.
- `#work=<id>` starts you in front of a work.
- `?tour` starts the road trip.
- `?audit` runs the hang audit (the result appears on `window.__faAudit`).
- `?q=low` uses the phone path.

Controls:

| Key | Action |
|---|---|
| Drag | Look |
| W A S D / stick | Walk |
| Shift | Run |
| Click a work | Read it |
| M | Map |
| J / K | Next / previous work |
| T | Road trip |
| L | Change the light |
| H | Back to Marfa |

## Rebuild

```bash
cd "50 STATES GALLERY/_build"
python3 build_data.py                      # _source/data.json + map.svg -> site/assets/data.js
npx tsc --noEmit -p tsconfig.json && node build.mjs
python3 shot.py <outdir> shots_day.json    # headless Chrome review shots (needs the server on :4290)
```

The data comes from `fondazioneaversano.org/50-states`. Its `window.DATA` is lifted into `_source/data.json`, and its Albers map goes into `_source/map.svg`. The 447 media files (1200 px stills, mp4 and animated GIF/WebP) live in `site/media/`.

To refresh after new acquisitions: re-download the page, then run `build_data.py` and `build.mjs`. The pavilions size themselves from the work count.

## Status (2026-10-02)

- **Audit:** 0 faults. All 200 works are reachable, face their viewer and have clear sightlines, and none is hung twice. All 54 pavilions can be walked through in both directions, the sheds down both aisles.
- **Streaming:** works load by distance (480 px, then 1200 px within 24 m). Video and animation play within 17 m, at most 6 at a time.
- **Not done yet:** hosting, GLB export per pavilion, and a mint kit per state. The NEW YORKERS export and mint chain can carry over.
