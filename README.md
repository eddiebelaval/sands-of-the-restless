# Sands of the Restless

A first-person shooter. Call of Duty pacing, ancient Egyptian setting, Treyarch
zombies economy. Three.js, no build step, no downloaded assets: every mesh,
texture, and sound is generated procedurally in code.

## Run it

ES modules and import maps do not work over `file://`, so it needs a static
server. Any will do.

```bash
cd sands-of-the-restless
python3 -m http.server 4177
# open http://127.0.0.1:4177/index.html
```

## Test it

The known weakness of generated game code is that nobody runs it. The harness
boots the real thing in Chromium with WebGL, drives the simulation, writes
screenshots to `shots/`, and fails on any console error.

```bash
node test/shot.mjs                    # against http://127.0.0.1:4177
CHROME_BIN=/path/to/chrome node test/shot.mjs
```

## Milestones

| | Scope | State |
|---|---|---|
| M1 | Stage, post chain, procedural materials, courtyard, player | **done** |
| M2 | Room graph, colliders, portals, doors, power | next |
| M3 | Weapons, ADS, viewmodels, enemies, wave director | |
| M4 | Economy, wall buys, mystery box, shrines, upgrade altar | |
| M5 | Audio, bosses, puzzle chain, HUD, bundler | |

## Architecture notes

**The map will be data, not geometry.** From M2 on, `world/rooms.js` holds room
records (bounds, portals, lighting profile, spawn points, prop slots) and
`world/build.js` is the only thing that turns them into meshes and colliders.

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

- No asset loaders. `GLTFLoader` and friends stay out. Nothing is downloaded.
- No `CapsuleGeometry` (too new for older builds).
- No browser storage. All state in memory.
- No image, audio, or font files.
- Frame-rate independent: every rate is per second, multiplied by a delta
  clamped to 1/20s so a backgrounded tab cannot teleport the player.
- Pointer lock falls back to raw `movementX/Y` within 400ms if denied, so the
  game stays playable inside an iframe.
- A fidelity toggle that genuinely disables post and shadows.
