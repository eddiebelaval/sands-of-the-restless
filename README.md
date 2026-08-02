# Sands of the Restless

A first-person wave shooter that runs in a browser tab. Call of Duty pacing,
ancient Egyptian setting, Treyarch zombies economy. Three.js, ES modules, an
import map, and no build step.

Almost everything is generated in code: every mesh, every animation, every
sound, and most textures. The exceptions are one HDRI for image-based lighting
and five scanned PBR material sets, all CC0 from Poly Haven and ambientCG and
committed to the repo so it runs offline. See `ASSETS-SOURCING.md` for the
provenance of each file.

Built over a weekend with Claude Code. `STATE.md` is the honest account of what
works, what does not, and the bugs that cost the most to find.

## Play it

ES modules and import maps do not work over `file://`, so it needs a static
server. Any will do.

```bash
git clone https://github.com/eddiebelaval/sands-of-the-restless
cd sands-of-the-restless
python3 -m http.server 4177
# open http://127.0.0.1:4177/index.html
```

Click to lock the pointer. `WASD` move, `shift` sprint, `space` jump, left mouse
fire, right mouse aim, `R` reload, `1`-`7` weapons, `F` to buy.

You start with 500 gold and a pistol. Kills pay 60, headshots 100. The sealed
doorway at the end of the avenue costs 1000 and everything else is inside.

## Test it

The known weakness of generated game code is that nobody runs it. The harness
boots the real thing in Chromium with WebGL, drives the simulation, writes
screenshots to `shots/`, and fails on console errors, console warnings, or a
frame that is too dark to be a real render.

```bash
npm install          # playwright and sharp, for the harness only
npm start            # serve on 4177, in another terminal
npm test             # all six suites
```

The Chrome resolver in `test/chrome.mjs` scans the macOS Playwright cache and
`/Applications`. On any other platform, or an unusual install, point it at a
binary:

```bash
CHROME_BIN=/path/to/chrome npm run test:shot
```

## What is built

| Scope | State |
|---|---|
| Stage, post chain, procedural materials, courtyard, player | done |
| Room graph, colliders, portals, buy-doors, the power gate | done |
| Weapons, ADS, viewmodels, enemies, wave director | done |
| Economy, wall buys, shrines, the upgrade altar | done |
| Audio, five bosses with telegraphed abilities | done |
| The mystery box | partial |
| The canopic-jar puzzle chain and the Serdab | not built |

## Architecture notes

**The map is data, not geometry.** `world/rooms.js` holds room records (bounds,
portals, lighting profile, spawn points, prop slots) and `world/build.js` is the
only thing that turns them into meshes and colliders.

**Winding order is load-bearing.** `world/geometry.js` builds a chamfered box as
6 face quads, 12 edge bevels and 8 corner triangles, non-indexed so every facet
gets a flat normal. For two days it emitted 28 of those 44 triangles wound
inside out, which made the bevels back faces and culled them, so the chamfer
that the module exists to draw was never drawn once. If you touch that file,
audit it: recompute each triangle's normal from vertex order and dot it against
the outward direction. All 44 must be positive.

**Collision has one representation.** A flat array of `{x, z, r, h}` cylinders
that every system resolves against. There is no second collision path.

**Texture density is baked into UVs, not `map.repeat`.** See `world/uv.js`. The
alternative is cloning a material per mesh, which destroys batching. Building a
`BoxGeometry` directly instead of via `uv.js` is a bug: it gets exactly one
texture tile stretched across whatever size it happens to be.

**Post-processing owns tone mapping.** Once `EffectComposer` is in the pipeline,
`OutputPass` performs tone mapping and sRGB conversion, not the renderer. Pass
order is deliberate: bloom before tone mapping (in linear HDR), grain and
vignette and aberration after it, SMAA last.

## Constraints

Held from the original design, and checked before each milestone closes.

- No asset loaders for geometry. `GLTFLoader` and friends stay out; every mesh
  in the game is built in code. The HDRI and the PBR maps are the one deliberate
  exception to the no-files rule, taken to fix lighting that procedural
  materials could not.
- No `CapsuleGeometry` (too new for older builds).
- No browser storage, with ONE amendment: **key and button bindings persist**,
  under `sands.keys.v1`, owned solely by `src/core/keymap.js`. Everything else
  is still in memory and still resets on reload, including every slider in the
  settings panel. The exception was the owner's call when he asked for a control
  centre, and the reasoning is worth keeping: a rebind that does not survive a
  reload is a rebind the player performs again every session, which is worse
  than not shipping the editor. The blob is schema-versioned and validated per
  action on the way in, so a stale or hand-edited value costs one binding rather
  than booting into a broken scheme.
- No image, audio, or font files.
- Frame-rate independent: every rate is per second, multiplied by a delta
  clamped to 1/20s so a backgrounded tab cannot teleport the player.
- Pointer lock falls back to raw `movementX/Y` within 400ms if denied, so the
  game stays playable inside an iframe.
- A fidelity toggle that genuinely disables post and shadows.
