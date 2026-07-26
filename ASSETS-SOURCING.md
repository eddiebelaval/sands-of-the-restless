# Asset Sourcing Manifest and Integration Plan

Research date: 2026-07-25. Target: three.js 0.185.1 (r185) via the unpkg import map
already in `index.html`.

Every URL in this document was hit with `curl` or an HTTP client during research and
the real status recorded. Every three.js import path was fetched at the pinned version
0.185.1 and the byte count recorded. Every license quoted was read from the live page,
not recalled. Anything I could not confirm is marked **UNVERIFIED** in bold.

Nothing was downloaded by this research pass.

---

## BLUF: the three acquisitions that change the look most

Ranked by visual change per megabyte, not by how impressive the asset is.

### 1. HDRI environment map for image-based lighting - 1.0 MB

**`qwantani_noon_puresky` at 1k .hdr, 1.0 MB.** Poly Haven, CC0.
`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/qwantani_noon_puresky_1k.hdr` - **HTTP 200**

This is the single highest-impact acquisition and it is also the cheapest. It is not
close. See the "what IBL does that three point lights cannot" section below for the
mechanism, but the short version is visible in `shots/02-courtyard.png`: the pistol
viewmodel is a near-black slab. It is `metalness: 0.90` with nothing in the scene to
reflect, and a metal with nothing to reflect is a black mirror. No amount of light
tuning fixes that, because the problem is not light quantity, it is the absence of an
environment to sample. One 1 MB file fixes every metal in the game simultaneously.

**Note: the repo currently ships this at 2k (4,184,949 bytes). That is 4x the bytes for
no gain, and three.js's own source says so.** Verified from the r185 build,
`PMREMGenerator.fromEquirectangular` docstring:

> "The ideal input image size is 1k (1024 x 512), as this matches best with the 256 x 256
> cubemap output."

and the sizing line, `three.module.js:2865`:

```js
} else { // Equirectangular
    this._setSize( texture.image.width / 4 );
}
```

A 2048-wide input produces a 512 cubemap; a 1024-wide input produces the documented 256.
Since this project has its own procedural sky dome (`src/world/sky.js`) and does **not**
need the HDRI as a visible background, the HDRI is a pure light probe and 1k is correct.
**Switching the existing file from 2k to 1k saves 3.2 MB and loses nothing.**

### 2. Scanned PBR material sets to replace Sobel-derived normals - 5.7 MB measured

Five 1K ambientCG sets, CC0, already on disk at `assets/materials-1k/` totalling
**5.7 MB measured**. This is the correct tier and it is already done.

The reason this matters is stated correctly in the project's own `src/world/assets.js`
header: a Sobel filter over your own albedo infers *shape* from *colour*. A dark stain
becomes a dent; a light patch becomes a bump. It is wrong everywhere the two disagree,
which is everywhere interesting. A scanned normal map is baked from real geometry.

The upgrade to make here is not more materials, it is **better-chosen** materials.
`Bricks083` is a European medieval sandstone brick and `Tiles139` is a bathroom
limestone tile. Both are serviceable stand-ins. ambientCG shipped a dedicated desert
scan series (`Ground092`-`Ground098`) that is a much closer match and is not currently
used. See Section 2.

### 3. Rigged animated undead characters - 10 to 25 MB

This is where procedural generation is genuinely, unfixably bad, and it is the only
category where the honest answer is "you cannot code your way out of this."

The recommendation is **Quaternius, not Mixamo**, and the reasoning is licensing plus
format, not quality:

- **Quaternius Zombie Apocalypse Kit** - CC0, verified verbatim, rigged, animated, and
  **ships glTF**, which drops straight into `GLTFLoader` with no conversion.
- **Mixamo** is royalty-free for commercial games (verified from Adobe's own FAQ), but
  it exports **FBX and Collada only, no glTF** (verified by grepping the live app
  bundle for "gltf" and "glb": zero occurrences), requires a free Adobe ID that
  Enterprise and Federated IDs cannot use, and its license is a four-sentence FAQ last
  updated September 2021 with no stated term. Details and quotes in Section 4.

**There is no CC0 mummy anywhere.** Not on Quaternius, not on Kenney, not on Mixamo
(108 stock characters, includes six zombie variants, no mummy). The mummy is a retexture
job on a CC0 humanoid rig.

**Combined minimal cost of all three: roughly 20 to 32 MB.** Full recommended minimal
set in the last section, under 50 MB.

---

## Verification: three.js 0.185.1 import paths

All fetched from `https://unpkg.com/three@0.185.1/` on 2026-07-25. The import map in
`index.html` maps `three/addons/` to `examples/jsm/`, so the `three/addons/...` specifier
in the left column resolves to the URL that was tested.

| Import specifier | HTTP | Size |
|---|---|---|
| `three` (build/three.module.js) | **200** | 650,153 B |
| `three/addons/loaders/HDRLoader.js` | **200** | 12,079 B |
| `three/addons/loaders/RGBELoader.js` | **200** | 268 B (deprecation shim) |
| `three/addons/loaders/EXRLoader.js` | **200** | 86,154 B |
| `three/addons/loaders/UltraHDRLoader.js` | **200** | 19,696 B |
| `three/addons/loaders/GLTFLoader.js` | **200** | 114,959 B |
| `three/addons/loaders/FBXLoader.js` | **200** | 111,266 B |
| `three/addons/loaders/OBJLoader.js` | **200** | 22,916 B |
| `three/addons/loaders/MTLLoader.js` | **200** | 11,356 B |
| `three/addons/loaders/KTX2Loader.js` | **200** | 36,567 B |
| `three/addons/loaders/DRACOLoader.js` | **200** | 19,030 B |
| `three/addons/loaders/HDRCubeTextureLoader.js` | **200** | 3,731 B |
| `three/addons/libs/meshopt_decoder.module.js` | **200** | 29,256 B |
| `three/addons/utils/SkeletonUtils.js` | **200** | 11,535 B |
| `three/addons/utils/BufferGeometryUtils.js` | **200** | 37,621 B |
| `three/addons/environments/RoomEnvironment.js` | **200** | 4,960 B |
| `three/addons/postprocessing/EffectComposer.js` | **200** | 8,501 B |
| `three/addons/libs/draco/draco_decoder.js` | **200** | 703 KB |
| `three/addons/libs/draco/draco_decoder.wasm` | **200** | 279 KB |
| `three/addons/libs/draco/draco_wasm_wrapper.js` | **200** | 57 KB |
| `three/addons/libs/draco/gltf/draco_decoder.wasm` | **200** | 188 KB |
| `three/addons/libs/draco/gltf/draco_wasm_wrapper.js` | **200** | 57 KB |
| `three/addons/libs/basis/basis_transcoder.js` | **200** | 56 KB |
| `three/addons/libs/basis/basis_transcoder.wasm` | **200** | 515 KB |

Present in the **core** build (no addon import needed), confirmed by grepping
`three.module.js` at 0.185.1: `PMREMGenerator`, `EquirectangularReflectionMapping`,
`ACESFilmicToneMapping`, `DataTexture`, `TextureLoader`, `CompressedTextureLoader`.

### BUG FOUND: `src/world/assets.js` imports a deprecated loader

Line 26 currently reads:

```js
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
```

At 0.185.1 that file is a 268-byte shim. Its **entire contents**, fetched live:

```js
import { HDRLoader } from './HDRLoader.js';

// @deprecated, r180

class RGBELoader extends HDRLoader {

	constructor( manager ) {

		console.warn( 'RGBELoader has been deprecated. Please use HDRLoader instead.' );
		super( manager );

	}

}

export { RGBELoader };
```

It works, but it fires a `console.warn` on every construction. The README states the test
harness "fails on any console error" - a `warn` is not an `error`, so this probably does
not currently break `test/shot.mjs`, but it is noise in exactly the channel the harness
watches, and it will be removed in a future three.js release.

**Fix, one line:**

```js
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
// ... and rename the two call sites: new HDRLoader().loadAsync(HDRI_URL)
```

`HDRLoader` is the same class. Confirmed from its own docstring at 0.185.1:
`"A loader for the RGBE HDR texture format."`

### Can you load an HDRI without an addon loader?

Practically, the question dissolves. `HDRLoader.js` is **12,079 bytes** and its import
list is `{ DataTextureLoader, DataUtils, FloatType, HalfFloatType, LinearFilter,
LinearSRGBColorSpace }` - **all from `'three'` and nothing else**. There are zero
transitive addon dependencies. It is one small self-contained file.

Three options, honestly ranked:

1. **Import `HDRLoader` from `three/addons/`.** 12 KB over the network, cached, zero
   dependency graph. This is the right answer. The project's "no asset loaders"
   constraint was written to keep out `GLTFLoader` and its Draco/KTX2 dependency tree;
   `HDRLoader` is not that.
2. **Vendor the 12 KB into `src/`.** Removes the CDN dependency at the cost of pinning a
   copy you now have to maintain. Reasonable if the self-contained-file goal is
   load-bearing.
3. **Avoid HDR entirely: `RoomEnvironment` (4,960 B, core-adjacent addon) generates a
   synthetic studio environment in code with zero downloaded bytes.** This is a real
   option and it would fix the black-metal problem. But it produces a neutral indoor
   studio box, which is exactly wrong for a bleached desert noon: the whole point of the
   HDRI here is that the sky is a huge bright dome and the sand is a huge warm bounce
   card, and the resulting light has a directional character a synthetic room does not.
   Use it as the fallback when the HDRI 404s, not as the plan.

There is no way to parse `.hdr` with core three alone. `DataTextureLoader` is in core but
the RGBE parser is not.

### What IBL does that three point lights cannot

Concretely, four things, all visible in the current screenshot:

1. **Metals become metal.** A `MeshStandardMaterial` with `metalness = 1` has *no diffuse
   response at all*. Its entire appearance is the environment reflected through a
   roughness-dependent lobe. With `scene.environment = null` that lobe samples nothing
   and the result is black. This is why `gunmetal` (`metalness: 0.90`) renders as a dark
   slab in `shots/02-courtyard.png` and why `src/world/assets.js` notes the weapons
   "needed a hand-built fake studio to be visible at all." Point lights do not help,
   because a point light is a zero-area emitter: it contributes a single specular dot,
   not a reflected world.

2. **Shadowed faces get correctly-coloured fill.** `sky.js` currently approximates this
   with a `HemisphereLight` (sky blue over sand tan) plus a hand-placed `bounce`
   directional. That is a good approximation and it was the right call without an
   environment. But it is two colours; a real environment carries the full angular
   distribution, so a face tilted toward the horizon picks up warm sand bounce and a face
   tilted up picks up cool zenith, continuously, without you authoring it.

3. **Roughness starts meaning something.** `PMREMGenerator` prefilters the equirect into
   a mip chain where each level is convolved to a different GGX lobe width. Rough
   surfaces sample blurry mips, polished surfaces sample sharp ones. Without it, the
   `roughness` channel on every scanned material is doing almost nothing except
   modulating a few specular dots. You have already paid the bytes for five roughness
   maps; IBL is what makes them legible.

4. **Fresnel rim response.** Grazing angles on any surface, metal or not, go reflective.
   That is what gives sandstone its slight sheen at raking sun angles and it is
   physically driven by the environment.

The existing code already gets the PMREM step right (`src/world/assets.js:90-92`), and
its inline comment about mirror-sharp reflections at every roughness value is correct.

---

## 1. HDRI environment maps

Source: **Poly Haven**, CC0, confirmed already, no attribution, commercial use fine.

API used: `https://api.polyhaven.com/assets?t=hdris` -> **HTTP 200**, 980 HDRIs.
`https://api.polyhaven.com/files/<id>` -> **HTTP 200**.
Note: the Poly Haven API returns **HTTP 403** to Python `urllib`'s default user agent.
Use `curl` or set a UA.

URL pattern, verified resolving with HTTP 200 for every asset listed:

```
https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/{res}/{id}_{res}.hdr
https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/{res}/{id}_{res}.exr
```

### Bleached Egyptian noon

| ID | Name | 1k .hdr | 2k .hdr | 4k .hdr | Why |
|---|---|---|---|---|---|
| **`goegap`** | Goegap | **1.3 MB** | 5.2 MB | 21.3 MB | Tags: sand, dirt, rock, **desert**, desolate, sun. Categories: midday, clear, high contrast. This is an actual desert at actual noon. Closest match on the site to the brief. |
| **`qwantani_noon_puresky`** | Qwantani Noon (Pure Sky) | **1.0 MB** | 4.0 MB | 17.0 MB | Pure sky, no ground clutter. Midday, clear, high contrast. **Currently in the repo at 2k.** Cheapest 1k on this list. Pure-sky variants are smaller because the lower hemisphere is a smooth gradient that compresses well. |
| `kiara_5_noon` | Kiara 5 Noon | 1.4 MB | 5.7 MB | 24.1 MB | Midday, clear, high contrast. Part of a 9-stage same-location time-of-day series (`kiara_1_dawn` through `kiara_9_dusk`) - if you ever want a time-of-day system, this series gives you a consistent set. |
| `kloofendal_43d_clear` | Kloofendal 43d Clear | 1.5 MB | 5.9 MB | 24.0 MB | Midday, clear, high contrast, rock and grass. Slightly greener. |
| `valley_of_desolation` | Valley Of Desolation | 1.4 MB | 5.8 MB | 23.8 MB | Tags: desert canyon, mesa, rocky outcrop, cliff edge. Clear, high contrast, morning-afternoon. Strong for a canyon-mouth or exterior-approach scene. |

### Golden hour

| ID | Name | 1k .hdr | 2k .hdr | 4k .hdr | Why |
|---|---|---|---|---|---|
| **`rogland_sunset`** | Rogland Sunset | **1.4 MB** | 5.9 MB | 24.4 MB | Tags: rocky, **arid**, **desert**, sun. Clear, high contrast, sunrise-sunset. The desert golden hour on this site. |
| `klippad_sunrise_2` | Klippad Sunrise 2 | 1.5 MB | 6.0 MB | 24.6 MB | Arid, hilltop, rocky, desolate, desert, mountain, valley. Medium contrast, partly cloudy. Softer than Rogland. |
| `quarry_04` | Quarry 04 | 1.4 MB | 5.7 MB | 23.2 MB | Sand. Sunrise-sunset, low contrast, partly cloudy. Flatter, hazier light. |
| `quarry_01` | Quarry 01 | 1.4 MB | 5.7 MB | 23.8 MB | Sun, sand, tracks. Sunrise-sunset, clear, high contrast. Harder raking light than quarry_04. |
| `the_lost_city` | The Lost City | 1.4 MB | 5.7 MB | 23.3 MB | Rock formation, path. Sunrise-sunset, high contrast. Name is a coincidence but the light fits a necropolis exterior. |

### Night, for later waves or an interior-tomb pass

| ID | Name | 1k .hdr | 2k .hdr | Why |
|---|---|---|---|---|
| `rogland_moonlit_night` | Rogland Moonlit Night | 1.6 MB | 6.4 MB | Rocky, arid, desert, moon, stars. High contrast night. The correct fill for a moonlit desert. |
| `rogland_clear_night` | Rogland Clear Night | 1.6 MB | 6.5 MB | Milky way, stars, low contrast. Darker; needs its own light rig. |
| `qwantani_moon_noon_puresky` | Qwantani Moon Noon (Pure Sky) | see API | see API | Night pure-sky, same location family as the current noon pick, so a day/night swap stays tonally consistent. |

### `.hdr` vs `.exr`, decided

**Use `.hdr`.** Reasons, all verified:

- Poly Haven offers both. For most assets the `.exr` is **3 to 4 times larger** at the
  same resolution (`rogland_sunset` 1k: .hdr 1.4 MB vs .exr 5.8 MB). For a minority the
  `.exr` is marginally smaller (`goegap` 1k: .hdr 1.3 MB vs .exr 1.2 MB) - compression
  varies with content.
- `HDRLoader` is **12,079 B**. `EXRLoader` is **86,154 B**, seven times the code, and
  carries its own zlib inflate path.
- `.hdr` is RGBE, 8 bits per channel plus a shared exponent. `.exr` here is half-float.
  For a light probe that PMREM immediately convolves down to a 256 cubemap, the extra
  precision is not recoverable.
- `.exr` matters when you need to preserve extreme sun-disc intensity for a visible
  background. You are not using the HDRI as a background.

**`UltraHDRLoader` (19,696 B, HTTP 200) is worth knowing about.** UltraHDR is a
JPEG-based HDR format with a gain map, typically a fraction of the `.hdr` size. Poly
Haven does **not** currently serve UltraHDR, so using it means converting the `.hdr`
yourself with `libultrahdr`. Not worth it at 1.0 MB. Worth revisiting if you ever ship
4k backgrounds.

### Full available resolutions per HDRI

Every Poly Haven HDRI listed above offers 1k, 2k, 4k, 8k, and 16k in both `.hdr` and
`.exr`. For scale: `goegap` 8k .hdr is 85.3 MB and 16k .hdr is 312.8 MB. **Do not.**
Above 2k there is no use case for this project.

---

## 2. PBR material sets

Source: **ambientCG**, CC0. License text read live from `https://ambientcg.com/license`
(**HTTP 200**), verbatim:

> "All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal
> License. This applies to the downloadable asset files and the material preview renders
> shown for each asset on the site."
>
> "You can copy, modify, distribute and perform the assets, even for commercial purposes,
> all without asking permission. **You can include the raw files in your project, for
> example a video game.**"

Attribution explicitly not required.

API: `https://ambientcg.com/api/v2/full_json?type=Material&id=<id>&include=downloadData,mapData`
-> **HTTP 200**.

Download URL pattern, verified **HTTP 200**, `content-type: application/zip`:

```
https://ambientcg.com/get?file={AssetID}_{Res}-JPG.zip
```

Map key: **C**=color, **N**=normal (GL and DX both shipped), **R**=roughness,
**A**=ambient occlusion, **D**=displacement, **M**=metalness.

### Desert sand and dry ground

ambientCG shipped a dedicated desert scan series (`Ground092` through `Ground098`) that
is a much closer match to this game than the generic beach-sand sets. **None of it is
currently used.**

| ID | Name | Maps | 1K zip | 2K zip | 4K zip | Tags | Replaces |
|---|---|---|---|---|---|---|---|
| **`Ground093C`** | Ground 093 C | CNRAD | **4.9 MB** | 17.8 MB | 85.0 MB | accumulation, beach, beige, coastal, **desert**, **dune** | procedural sand |
| **`Ground098`** | Ground 098 | CNRAD | **5.8 MB** | 20.6 MB | 88.5 MB | beach, beige, brown, **desert**, **dry** | procedural sand |
| `Ground093A` | Ground 093 A | CNRAD | 5.4 MB | 19.4 MB | 87.6 MB | beach, beige, coastal, cream, desert | sand variant |
| `Ground093B` | Ground 093 B | CNRAD | 4.8 MB | 17.4 MB | - | accumulation, coastal, desert, dune | sand variant |
| `Ground095A` | Ground 095 A | CNRAD | 5.2 MB | 17.1 MB | 76.6 MB | beige, brown, coastal, dark, desert | darker sand |
| **`Ground096B`** | Ground 096 B | CNRAD | **6.4 MB** | 24.3 MB | 106.9 MB | beige, **desert**, **dry**, earthy, **eroded** | wind-scoured hardpan |
| `Ground054` | Ground 054 | CNRAD | 8.3 MB | 31.5 MB | 128.1 MB | beach, dirt, ground, mud, sand | **currently in repo as `sand`** |
| `Ground033` | Ground 033 | CNRAD | 6.6 MB | 25.3 MB | 114.8 MB | beach, dirt, ground, light, sand | lighter, more bleached |
| `Ground080` | Ground 080 | CNRAD | 6.6 MB | 23.7 MB | 96.1 MB | beach, brown, dirt, ground, sand | warmer |

**`Ground092A`, `Ground096A`, `Ground096C`, and `Ground097` appear in search results but
their API records return no JPG download entries.** They may be Patreon early-access or
PNG-only. **UNVERIFIED - do not plan around these four.**

**Call: swap `sand` from `Ground054` to `Ground093C`.** Ground054 is a wet-looking beach
mud tagged `mud`; Ground093C is an actual desert dune accumulation, and it is 3.4 MB
smaller at 1K. Straight upgrade in both directions.

### Sandstone and limestone blocks

| ID | Name | Maps | 1K zip | 2K zip | 4K zip | Tags | Replaces |
|---|---|---|---|---|---|---|---|
| **`Bricks084`** | Bricks 084 | CNRAD | **4.8 MB** | 14.4 MB | 52.3 MB | beige, bricks, **sandstone**, yellow | `limestone` (bulk masonry) |
| `Bricks083` | Bricks 083 | CNRAD | 5.0 MB | 15.0 MB | 53.5 MB | beige, bricks, medieval, **sandstone** | **currently in repo as `limestone`** |
| `Bricks075A` | Bricks 075 A | CNRAD | 5.3 MB | 16.3 MB | 57.4 MB | beige, bricks, yellow | warmer masonry variant |
| **`Travertine009`** | Travertine 009 | CNRAD | **3.1 MB** | 8.7 MB | 31.3 MB | beige, light, marble, stone, travertine | `carved` (dressed facade stone) |
| `Tiles143` | Tiles 143 | CNRD | 4.9 MB | 16.2 MB | 68.8 MB | beige, flooring, grid, **limestone** | dressed floor |
| `Tiles139` | Tiles 139 | CNRD | 4.6 MB | 15.5 MB | 67.1 MB | bathroom, beige, checkered, classic, cream | **currently in repo as `carved`** |
| `Tiles144` | Tiles 144 | CNRD | 4.8 MB | 16.4 MB | 70.9 MB | aged, beige, flooring, **golden**, grid | gilded chamber floor |
| `Concrete012` | Concrete 012 | CNRD | 7.8 MB | 26.0 MB | 92.6 MB | brown, **church**, old, plaster | weathered plastered wall |

**Call: swap `carved` from `Tiles139` to `Travertine009`.** Travertine is the actual
stone family Egyptian alabaster vessels and dressed facing stone come from, it has an AO
map that Tiles139 lacks, and it is **1.5 MB smaller at 1K and 6.8 MB smaller at 2K**.
Tiles139 is a modern bathroom tile with a checkered grid; that grid will read as
tiling on a large facade.

### Weathered and cracked stone

| ID | Name | Maps | 1K zip | 2K zip | 4K zip | Tags | Replaces |
|---|---|---|---|---|---|---|---|
| **`Rock063`** | Rock 063 | CNRAD | **4.7 MB** | 14.2 MB | 48.3 MB | aged, cliff, **cracked**, damaged, dirty | weathered stone / broken masonry |
| `Rock062` | Rock 062 | CNRAD | 7.8 MB | 25.4 MB | 90.7 MB | **cracked**, **eroded**, grey, natural | eroded outcrop |
| `Rock029` | Rock 029 | CNRAD | 9.2 MB | 31.9 MB | 119.2 MB | cliff, **desert**, orange, red, rock | desert cliff face |
| `Rock030` | Rock 030 | CNRAD | 9.2 MB | 31.9 MB | 119.3 MB | cliff, grey, rock, stone, wall | grey rock wall |
| `Rock023` | Rock 023 | CNRAD | see API | see API | see API | **currently in repo as `rock`** |
| `PavingStones142` | Paving Stones 142 | CNRAD | 8.1 MB | 27.6 MB | 101.0 MB | city, dark, floor, grey, **medival** [sic] | courtyard paving |
| `PavingStones128` | Paving Stones 128 | CNRAD | 8.0 MB | 30.4 MB | 122.0 MB | blocks, floor, paving, stone | large flagstones |

### Cracked mud and clay

| ID | Name | Maps | 1K zip | 2K zip | Tags |
|---|---|---|---|---|---|
| **`Ground026`** | Ground 026 | CNRAD | **9.0 MB** | 31.5 MB | **clay**, flat, ground, **mud**, smooth |
| `Ground025` | Ground 025 | CNRAD | 8.9 MB | 29.6 MB | brown, clay, dirt, ground, mud |
| `Clay001` | Clay 001 | CNRAD | 6.9 MB | 25.8 MB | brown, clay |
| `Ground036` | Ground 036 | CNRAD | 9.9 MB | 34.2 MB | dirt, ground, mud, soil |

Honest note: ambientCG has **no true cracked-playa material**. Search `cracked` returns
32 results and they are almost entirely cracked *asphalt* (`Road008`-`Road015`,
`Asphalt026C`). The two non-road hits are `Rock062` and `Rock063`. If you want the classic
dried-lakebed hexagonal crack pattern, **that is a case where procedural generation wins**
- a Voronoi/Worley cell pattern with a distance-to-edge crack mask is a 30-line shader
and is fully parameterizable. Do not buy this one.

### Granite

| ID | Name | Maps | 1K zip | 2K zip | Tags |
|---|---|---|---|---|---|
| `Granite002A` | Granite 002 A | CNRD | 4.2 MB | 11.6 MB | countertop, granite |
| `Granite003A` | Granite 003 A | CNRD | 4.9 MB | 15.1 MB | countertop, granite - **currently in repo as `granite`** |
| `Granite001A` | Granite 001 A | CNRD | 4.9 MB | 14.9 MB | countertop, granite |
| `Granite005A` | Granite 005 A | CNRD | 5.0 MB | 15.9 MB | countertop, granite |

**All 14 ambientCG granites are tagged `countertop` and none has an AO map.** They are
scanned kitchen slabs: flat, polished, uniform, with a fine speckle. The game uses
granite for the sealed doorway, which `materials.js` correctly describes as "the one cold
object in a hot scene." A polished countertop slab is arguably right for a dressed
granite portal, but it will not read as *carved* granite. If the doorway needs relief,
that stays procedural or comes from a mesh.

### Gold and brass

| ID | Name | Maps | 1K zip | 2K zip | 4K zip | Tags | Replaces |
|---|---|---|---|---|---|---|---|
| **`Metal048A`** | Metal 048 A | CNRDM | **2.5 MB** | 6.1 MB | 20.4 MB | clean, **gold**, metal, smooth | polished gold inlay |
| **`Metal034`** | Metal 034 | CNRDM | **2.9 MB** | 8.3 MB | 33.2 MB | **gold**, metal, smooth, yellow | gold leaf |
| `Metal048C` | Metal 048 C | CNRDM | 4.3 MB | 12.4 MB | 41.8 MB | **gold**, **impure**, metal, **rough** | tarnished tomb gold - best fit |
| `Metal048B` | Metal 048 B | CNRDM | 3.1 MB | 8.5 MB | 29.3 MB | dirty, fingerprints, gold, metal | handled gold |
| `Metal042B` | Metal 042 B | CNRDM | 5.9 MB | 18.9 MB | 70.8 MB | dirty, gold, metal | grimy gold |
| `Metal035` | Metal 035 | CNRDM | 3.6 MB | 11.6 MB | 51.8 MB | brown, **copper**, metal, orange | bronze/copper fittings |
| `Metal007` | Metal 007 | CNRDM | 4.7 MB | 16.2 MB | 69.8 MB | bumpy, gold, metal, **scratches**, silver | worn metal |

These are the **only sets in this manifest with a metalness map**, and they are the ones
that will look most dramatically different once IBL is on. `Metal048C` (impure, rough) is
the best single pick for a tomb: tarnished gold, not jewellery gold.

### Gravel and pebbles

| ID | Name | Maps | 1K zip | 2K zip | Tags |
|---|---|---|---|---|---|
| `Gravel041` | Gravel 041 | CNRAD | 9.7 MB | 30.5 MB | beach, gravel, ground, pebbles, stone |
| `Rocks022` | Rocks 022 | CNRAD | 8.9 MB | 28.7 MB | gravel, **pebble**, **pebbles**, rocks, small |
| `Ground079S` | Ground 079 S | CNRAD | 9.5 MB | 32.7 MB | brown, dirt, gravel, ground, rocks |
| `Ground062S` | Ground 062 S | CNRAD | 9.8 MB | 33.7 MB | brown, dirt, gravel, ground, pebbles |
| `Gravel023` | Gravel 023 | CNRAD | 9.4 MB | 29.9 MB | bright, dirt, gravel, ground, light |

Honest note: the courtyard already scatters hundreds of individual pebble meshes
(`src/world/scatter.js`). A pebble *texture* under a field of pebble *meshes* is
redundant and will fight the geometry at close range. Skip this category. If anything,
`Ground079S` as a blend layer where the pebble meshes thin out.

### Displacement maps and parallax occlusion

**Every ambientCG material in this manifest ships a displacement map.** Confirmed from
the `maps` array in the API response for each ID listed. The creation method on all of
them reads `"Height field photogrammetry"`, described by ambientCG as *"Displacement
generated using photogrammetry"* - so the height data is measured, not derived from
albedo.

The repo has already downloaded `displacement.jpg` for all five current sets. **It is not
being used**: `src/world/assets.js` maps `displacement` to `displacementMap` in its `SLOT`
table but never lists it in `MATERIAL_SETS`. So you are not paying for it either. Fine.

Three ways to spend it, cheapest first:

1. **Do not.** `MeshStandardMaterial.displacementMap` performs real vertex displacement,
   which needs geometry dense enough to displace. Your walls are chamfered boxes with
   maybe 24 vertices. It will do nothing except waste a texture unit.
2. **Parallax occlusion mapping via `onBeforeCompile`.** This is the actual win and the
   reason to have kept the maps. POM ray-marches the height field in the fragment shader
   and produces genuine self-occluding depth on flat geometry - deep mortar joints in the
   masonry, real depth in the sand ripples, at grazing angles where a normal map visibly
   collapses. three.js has **no built-in POM material**; you inject it. The project
   already has the exact machinery for this in `src/world/weathering.js`, which injects
   world-space grime into the standard material via shader patching. Same pattern.
   Budget 60 to 120 lines of GLSL. Costs 8 to 32 texture samples per pixel, so gate it
   behind the existing fidelity toggle.
3. **Bake AO from it offline** for the two sets that lack an AO map (`Tiles139`,
   `Granite003A`). Cheap, one-time, no runtime cost.

**Recommendation: option 2, and only after IBL is in.** POM on a scene with no
environment lighting is polishing a surface nobody can see the shape of.

---

## 3. 3D models

### The headline finding

**There is no CC0 ancient-Egyptian 3D art on any of the major CC0 asset sites.**

Poly Haven, all 521 models scanned by substring across id + name + tags + categories:

| Term | Hits |
|---|---|
| egypt | **0** |
| sarcophagus | **0** |
| obelisk | **0** |
| pyramid | **0** |
| hieroglyph | **0** |
| sphinx | **0** |
| anubis | **0** |
| mummy | **0** |
| column / pillar | **0** |
| brazier | **0** |
| amphora | **0** |
| temple / tomb | **0** |
| rubble / ruin | **0** |
| palm | **0** |

Quaternius: no Egyptian pack. Kenney: no Egyptian pack. Poly Pizza: has Egyptian content
and **100 percent of it is CC-BY, not CC0** (see below).

**Consequence: the necropolis architecture stays procedural.** That is not a defeat. It
is the correct hybrid split, and it is the split the project's own `assets.js` header
already argues for. Downloaded assets buy you *surfaces* and *characters*; the *layout*
was always going to be code.

### Poly Haven models - CC0 (already confirmed)

API: `https://api.polyhaven.com/assets?t=models` -> **HTTP 200**, 521 models.
Pattern: `https://dl.polyhaven.org/file/ph-assets/Models/gltf/{res}/{id}/{id}_{res}.gltf`

Sizes below are **total** for the asset at that texture resolution (.gltf + .bin + all
maps). Important: **the `.bin` is shared across resolutions and always served from the 8k
path**, so mesh cost is identical at 1k and 2k; only textures shrink.

**Desert rock and rubble - the strongest category here.** The `namaqualand_*` set is
photogrammetry of the South African Karoo, which is an actual arid desert.

| ID | Name | 1k | 2k | What it replaces |
|---|---|---|---|---|
| `namaqualand_boulder_02` | Namaqualand Boulder 02 | 4.9 MB | 12.4 MB | procedural chamfered-box boulder |
| `namaqualand_boulder_03` | Namaqualand Boulder 03 | 3.6 MB | 9.7 MB | " |
| `namaqualand_boulder_04` | Namaqualand Boulder 04 | 3.5 MB | 9.7 MB | " |
| `namaqualand_boulder_05` | Namaqualand Boulder 05 | 4.5 MB | 11.4 MB | " |
| `namaqualand_boulder_06` | Namaqualand Boulder 06 | 5.0 MB | 12.6 MB | " |
| `namaqualand_boulders_01` | Namaqualand Boulders 01 | 3.5 MB | 10.0 MB | rubble cluster |
| `namaqualand_rocks_01` | Namaqualand Rocks 01 | 4.6 MB | 11.5 MB | scatter rocks |
| `namaqualand_stones_01` | Namaqualand Stones 01 | 4.0 MB | 10.2 MB | small scatter |
| `namaqualand_cliff_01` | Namaqualand Cliff 01 | 4.3 MB | 10.7 MB | boundary cliff |
| `namaqualand_cliff_02` | Namaqualand Cliff 02 | 8.0 MB | 14.8 MB | " |
| `rock_07` | Rock 07 | **2.1 MB** | 6.0 MB | cheapest good boulder |
| `rock_09` | Rock 09 | **1.9 MB** | 5.6 MB | cheapest good boulder |
| `stone_01` | Stone 01 | 3.6 MB | 9.7 MB | gravel/pebble cluster |
| `rock_face_01` | Rock Face 01 | 2.9 MB | 9.7 MB | wall backdrop |
| `moon_rock_01` .. `_07` | Moon Rock 01-07 | ~2-4 MB | ~6-10 MB | grey dusty tomb debris |

**Vessels - the closest thing to canopic jars and urns.**

| ID | Name | 1k | 2k | Note |
|---|---|---|---|---|
| `brass_vase_01` | Brass Vase 01 | **0.8 MB** | 1.7 MB | Tags literally include **ancient, artifact**. Best single prop pick. |
| `brass_vase_02` | Brass Vase 02 | 1.7 MB | 5.6 MB | Tags: ancient, ornate, pattern |
| `brass_vase_04` | Brass Vase 04 | **0.4 MB** | 1.1 MB | Cheapest |
| `antique_ceramic_vase_01` | Antique Ceramic Vase 01 | **0.5 MB** | 1.1 MB | Ceramic, not metal |
| `ceramic_vase_01` .. `_04` | Ceramic Vase 01-04 | 0.4-0.7 MB | 0.7-2.1 MB | Set of four, good scatter variety |
| `planter_pot_clay` | Planter Pot Clay | 1.7 MB | 5.7 MB | Worn clay |
| `metal_jug` | Metal Jug | 1.7 MB | 6.0 MB | |

**Statuary - all Western or gothic. Nothing Egyptian. Silhouette stand-ins only.**

| ID | Name | 1k | 2k | Honest read |
|---|---|---|---|---|
| `lion_head` | Lion Head | 3.1 MB | 8.4 MB | Could pass as a Sekhmet fragment with a sandstone material swap. Judgment call, not a claim. |
| `concrete_cat_statue` | Concrete Cat Statue | 3.0 MB | 10.4 MB | Bastet stand-in, same caveat. |
| `gothic_statue` | Gothic Statue | 3.8 MB | 10.6 MB | Wrong period, wrong continent. |
| `marble_bust_01` | Marble Bust 01 | 0.9 MB | 1.9 MB | Classical Roman. |

**Containers, firelight, structure.**

| ID | 1k | 2k | Note |
|---|---|---|---|
| `stone_fire_pit` | 2.4 MB | 9.2 MB | **Best brazier stand-in on the site.** No brazier exists. |
| `vintage_oil_lamp` | 2.0 MB | 6.3 MB | |
| `wooden_crate_01` / `_02` | 2.1-2.2 MB | 7.8-7.9 MB | Supply crates for the wall-buy economy |
| `wicker_basket_01` / `_02` | 2.6-2.9 MB | 8.0-9.8 MB | Reads more period-appropriate than crates |
| `barrel_03` | **0.5 MB** | 2.0 MB | Cheapest container |
| `treasure_chest` | 5.2 MB | 12.4 MB | Mystery box candidate |
| `modular_fort_01` | 10.1 MB | 35.9 MB | Tags: fort, modular, wall, ramparts, stone, **ancient**. The only modular stone-wall kit on the site. |
| `large_castle_door` | 3.1 MB | 11.0 MB | |

**Vegetation.** **No palm tree exists on Poly Haven** (`palm` -> 0 hits). The current
procedural palm stays. Karoo desert flora available as substitutes: `quiver_tree_01`
(8.5 MB / 20.6 MB), `quiver_tree_02` (4.3 / 10.6), `dead_quiver_trunk` (2.2 / 7.0),
`dry_quiver_leaf` (4.3 / 10.8). Right biome, wrong continent.

Also: `street_rat` (3.4 MB / 9.2 MB) is the only asset in Poly Haven's `creature`
category. Necropolis vermin.

### Quaternius - CC0, verified verbatim

`https://quaternius.com/` -> **HTTP 200**. `https://quaternius.com/faq.html` -> **HTTP 200**.

License, quoted from the live FAQ:

> "**Can these assets be used in commercial projects?** Yes, these assets can be used for
> free without the need for attribution in commercial, educational, and personal projects.
> **All models are under the CC0 License.**"
>
> "**Am I allowed to modify the models?** Yes, you are free to modify the models in any
> way you like, including combining them with other asset packs."

Each pack page additionally carries an inline `License: CC0` field.

| Pack | Models | Formats | glTF? | Relevance |
|---|---|---|---|---|
| **Ultimate Modular Ruins Pack** | 90 | FBX, OBJ, Blend | **NO** | Tags: statues, columns, doors, crates, barrels. **Closest fit in the whole sweep, and it has no glTF.** |
| Fantasy Props MegaKit | 211 | FBX, OBJ, Blend, glTF | yes | Props, urns, barrels |
| Modular Dungeon Pack | 41 | FBX, OBJ, Blend | **NO** | Interior tomb corridors |
| Stylized Nature MegaKit | 116 | FBX, OBJ, Blend, glTF | yes | Rocks, dead trees |
| Ultimate Nature Pack | 150 | FBX, OBJ, Blend | **NO** | |
| Zombie Apocalypse Kit | 60 | FBX, OBJ, Blend, glTF | yes | See Section 4 |
| Ultimate Guns Pack | 40 | FBX, OBJ, Blend | **NO** | See Section 5 |
| Sci-Fi Modular Gun Pack | 78 | FBX, OBJ, Blend, glTF | yes | Wrong genre |

**glTF coverage is inconsistent, and it is missing on exactly the packs you would most
want.** Modular Ruins, Modular Dungeon, Ultimate Nature, and Ultimate Guns are all
FBX/OBJ/Blend only. Using them means either shipping `FBXLoader` (111,266 B, roughly the
same as `GLTFLoader`) or running a one-time Blender conversion to glb. **Convert offline.**

**UNVERIFIED: Quaternius pack byte sizes.** The pages state model counts and formats but
not download sizes.

### Kenney - CC0, verified verbatim, and it ships GLB

`https://kenney.nl/` -> **HTTP 200**. `https://kenney.nl/support` -> **HTTP 200**.

> "**Can I use the game assets in a (commercial) project?** Yes, all game assets on the
> asset pages are **public domain licensed (CC0)**. You're free to use them, even in
> commercial projects."
>
> "**Is attribution required?** Attribution is not required, but if you choose to give
> credit you can do so by mentioning 'Kenney'. **Do not use our logo**, as it is reserved
> for official projects by our studio."

Each 3D asset page carries the structured field `License: Creative Commons CC0`.
Note: kenney.nl has no site-wide license page; the license is declared per asset. The
site-wide ToS (dated 2024-01-06) says materials are protected "unless marked otherwise" -
the per-asset CC0 field is the "marked otherwise".

Formats, quoted from Kenney's own knowledge-base article "Importing 3D models into game
engines" (**HTTP 200**):

> "Refrain from using OBJ unless it's the only supported file format. FBX and GLB (glTF)
> files are equal in features but GLB is smaller in size. **The glTF file format is
> distributed as GLB in Kenney game assets.**"

So every Kenney 3D pack ships OBJ + FBX + **GLB**. GLB drops straight into `GLTFLoader`
with no conversion. This is Kenney's practical advantage over Quaternius for this stack.

Zip sizes below were obtained by HTTP HEAD against the real download URLs.

| Pack | Files | Zip | License | Relevance |
|---|---|---|---|---|
| **`graveyard-kit`** | 90 | **3.6 MB** | CC0 verified | graveyard, horror, monster, spooky. Includes animation. **Most on-theme Kenney pack for a necropolis.** |
| `nature-kit` | 330 | 10.1 MB | CC0 verified | trees, rocks, foliage |
| `castle-kit` | 75 | 2.1 MB | CC0 verified | stone walls, arches |
| `modular-dungeon-kit` | 40 | 6.6 MB | CC0 verified | tomb interiors |
| `modular-cave-kit` | 40 | 6.7 MB | CC0 verified | rough-cut passages |
| `tower-defense-kit` | 160 | 5.2 MB | CC0 verified | |
| `prototype-kit` | 145 | 2.8 MB | CC0 verified | greybox blockout |
| `blaster-kit` | 40 | 1.6 MB | CC0 verified | See Section 5 |

**Honest style caveat**: Kenney assets are flat-shaded, atlas-coloured, deliberately
low-poly toy geometry. Your current screenshot is semi-realistic - photogrammetric
material tiers, real shadow work, a bleached-noon palette. **A Kenney graveyard kit will
not blend into that.** It is the right choice only if you pivot the whole game to that
style. Listed because it is genuinely CC0 and genuinely well-made, flagged because the
style clash is real and would be visible immediately.

### Poly Pizza - MIXED LICENSE, handle with care

`https://poly.pizza/` -> **HTTP 200**. `https://api.poly.pizza/v1/...` -> **HTTP 401**
(key required).

Poly Pizza is largely the rehosted Google Poly archive plus newer creator uploads. Exactly
two licenses appear: **CC0 1.0** (safe) and **CC-BY 3.0** (attribution legally required).

**FLAG: the CC0 URL filter does not work.** `?licence=CC0`, `?license=CC0`,
`?licence=CC0+1.0`, and `?Licence=CC0` were each tested against `/search/statue` and all
four returned **HTTP 200 with the identical unfiltered result set**. The filter is
client-side only. You must check each model. Each search page does embed a
`window.__SERVER_APP_STATE__` JSON blob with a per-model `"licence"` field, so it is
machine-checkable if you script it.

**FLAG, loudly: every Egyptian model on Poly Pizza is CC-BY 3.0. Zero are CC0.**

| Model | Creator | URL | License |
|---|---|---|---|
| Pyramid | Poly by Google | `poly.pizza/m/c-tEGK9e49p` | **CC-BY 3.0 - FLAG** |
| Pyramid | Poly by Google | `poly.pizza/m/7Df4CP5wicB` | **CC-BY 3.0 - FLAG** |
| Pyramid | Poly by Google | `poly.pizza/m/3pabPM-VTTH` | **CC-BY 3.0 - FLAG** (license line read directly on the page) |
| Pyramid | Poly by Google | `poly.pizza/m/62oCD2veCi8` | **CC-BY 3.0 - FLAG** |
| Step Pyramid | Jarlan Perez | `poly.pizza/m/5fksyItujX1` | **CC-BY 3.0 - FLAG** |
| Lotus | Nadja Haldimann | `poly.pizza/m/bunaVqCTDSZ` | **CC-BY 3.0 - FLAG** |

Genuinely CC0 and genuinely useful here:

| Model | Creator | URL | License |
|---|---|---|---|
| Coffin | Kay Lousberg | `poly.pizza/m/ySERERWPgE` | CC0 |
| Coffin | Kay Lousberg | `poly.pizza/m/WqqeFNrp0e` | CC0 |
| Crypt | Kay Lousberg | `poly.pizza/m/iV5x01FYAl` | CC0 |
| Column | Quaternius | `poly.pizza/m/wLubNpOTX4` | CC0 |
| Column | Quaternius | `poly.pizza/m/6y1EFzpRI9` | CC0 |
| Column Round | Quaternius | `poly.pizza/m/n8ZvVFcJhl` | CC0 |
| Pedestal | Quaternius | `poly.pizza/m/wUeoDKnFBF` | CC0 |
| Modular Ruins Pack | Quaternius | `poly.pizza/m/F2LAK03B0r` | CC0 |
| Debris Pile | Quaternius | `poly.pizza/m/WrIiMMxyEP` | CC0 |
| Bricks | Quaternius | `poly.pizza/m/Tvlvh8AAbs` | CC0 |

Search-by-search CC0/CC-BY split: `column` 18/14 (best ratio), `rubble` 16/16,
`sarcophagus` 7/19, `statue` 6/20, `obelisk` 14/18 (no actual obelisk among the CC0),
`pyramid` 2/29 (**no CC0 pyramid exists**), `vase` 5/27, `amphora` 16/16 (the one
actually named Amphora is **CC-BY**). `urn` and `mummy` return **0 results**.

**Practical heuristic, not a guarantee:** everything by Quaternius, Kenney, Kay Lousberg,
CreativeTrio, and iPoly3D came back CC0 in every query run. Everything by "Poly by
Google" came back CC-BY 3.0 in every query run. Check the `licence` field per model
before shipping anyway.

### Sketchfab CC0 - the best Egyptian source, and the most work

**FLAG: the CC0 filter UUID that circulates on forums is wrong.**
`322a749bcfa841b29dff1e8a1bb74b0b` is **CC Attribution, not CC0**. Confirmed from
`https://api.sketchfab.com/v3/licenses` (**HTTP 200**), verbatim:

```json
{"uri":".../322a749bcfa841b29dff1e8a1bb74b0b","label":"CC Attribution",
 "requirements":"Author must be credited. Commercial use is allowed.","slug":"by"}
```

The real CC0 UUID is **`7c23a1ba438d4306920229c12afcb5f9`**:

```json
{"uri":".../7c23a1ba438d4306920229c12afcb5f9","label":"CC0 Public Domain",
 "requirements":"Credit is not mandatory. Commercial use is allowed.","slug":"cc0"}
```

Correct web search URL (**HTTP 200**):
```
https://sketchfab.com/search?features=downloadable&licenses=7c23a1ba438d4306920229c12afcb5f9&q=egyptian&type=models
```

Better, the public API takes a readable slug and needs no auth for search (**HTTP 200**):
```
https://api.sketchfab.com/v3/search?type=models&q=egyptian&downloadable=true&license=cc0
```

One model's license was individually fetched and read:
`https://api.sketchfab.com/v3/models/ffe4b699e75849d59d8efe47d3538f03` returned
`"label":"CC0 Public Domain"`, `"slug":"cc0"`, `isDownloadable: true`. So
**"Egyptian false door, about 2400 BCE" is CC0** and that is a read, not an inference.

Other results from the CC0-filtered query, which are museum photogrammetry and exactly
what this game needs:

Carved Wooden Female Figure - Egyptian Travertine Cylindrical Jar - Udjat Eye of Ra
(1297-1185 BCE) - Goddess Sekhmet (1320-656 BCE) - Statue fragment of Amenhotep III -
Limestone Statue of Thoth as a Baboon - Bronze Statue of Horus - Canopic jar with lid -
Aset-iri-khet-es mummy sarcophagus and cartonnage - Sarcophagus lid - Alabaster amphora.

**UNVERIFIED for every one of those except the false door.** They came from a
`license=cc0` filtered query, which is strong evidence, but no individual license line was
read. **Fetch `api.sketchfab.com/v3/models/<uid>` and read `.license.slug` before using
each one.**

Honest caveats: Sketchfab requires a free account to download (search API is open,
download endpoint is not). Uploader mislabelling is possible and Sketchfab does not audit
it. And these are raw museum scans - high polycount, single-object, unoptimized, often
100k+ triangles with 8k textures. **They will need decimation and retexturing before they
go anywhere near a browser FPS.** This is by far the best Egyptian source found and also
the one with the most work attached.

### Khronos glTF Sample Assets - a rendering test harness, not an art source

**Which repo:** `KhronosGroup/glTF-Sample-Assets` -> **HTTP 200**, `archived: false`.
`KhronosGroup/glTF-Sample-Models` -> **HTTP 200**, `archived: true`. The old repo still
resolves rather than redirecting, so a stale link silently gives you the frozen version.

Licenses are **per model**, listed in `Models/Models.md` (**HTTP 200**).

**Safe, CC0:** `SciFiHelmet` (© 2017, Public, CC0 1.0 Universal), `FlightHelmet` (CC0
1.0), `WaterBottle` (CC0 1.0, Microsoft), `BoomBox` (CC0 1.0, Microsoft), `Lantern` (CC0
1.0, Microsoft - also has a Draco variant, also CC0), `AntiqueCamera` (CC0 1.0),
`ToyCar` (CC0 1.0), `Suzanne` (CC0 1.0).

**FLAG, do not ship:**

- **`Sponza`** - `© 2016, Crytek. Cryengine Limited License Agreement`. **This is a
  proprietary EULA, not a Creative Commons license at all.** It is very widely assumed to
  be free. It is not.
- **`DamagedHelmet`** - `© 2018, ctxwing. CC BY 4.0 International` **plus** `© 2016,
  theblueturtle_. CC BY-NC 4.0 International` for an earlier version of the model. The
  single most-copied glTF asset on the internet, and it carries a **non-commercial**
  ancestor.
- **`BrainStem`** (skinned character) - `Poser EULA`. Proprietary.
- **`CesiumMan`** (skinned character) - `CC-BY 4.0 with Trademark Limitations`.
- **`RiggedFigure`, `RiggedSimple`** - `CC BY 4.0`. Attribution required.
- **`Fox`** (skinned, 3 animation cycles) - **split license**: model `© 2014, PixelMannen.
  CC0 1.0 Universal`, but **rigging and animation `© 2014, tomkranis. CC BY 4.0
  International`**, and the glTF conversion is CC-BY 4.0 as well. The mesh is CC0; the
  animated asset you would actually use is not.

**Conclusion: there is no CC0 rigged humanoid in the Khronos sample set.** Use
`SciFiHelmet` or `FlightHelmet` to validate your PBR and IBL pipeline is correct. That is
what this repo is for.

---

## 4. Characters and animation

This is the category where procedural generation genuinely loses, and the game needs
mummies, husks, armoured undead, and five boss gods.

### Mixamo - actual current terms, read live

| URL | Status | Note |
|---|---|---|
| `https://www.mixamo.com/` | **200** | SPA |
| `https://www.mixamo.com/faq` | **404** | Mixamo has no on-site FAQ |
| `https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html` | **200** (browser); curl gets `000` - Adobe bot-blocks curl | The official FAQ |
| `https://www.adobe.com/legal/terms.html` | **200** (browser) | General Terms of Use |
| `https://www.adobe.com/go/fuseterms` | **200** -> `Fuse-Product-Specific-Terms-en_US-20240618.pdf` | |

**Official Adobe FAQ, page stamped "Last updated on Sep 14, 2021", quoted verbatim:**

> "What type of projects can I create with Mixamo? You can use both characters and
> animations **royalty free for personal, commercial, and non-profit projects** including:
> Incorporate characters into illustrations and graphic art. 3D print characters. Create
> films. **Create video games.**"

> "Mixamo is available **free for anyone with an Adobe ID** and does not require a
> subscription to Creative Cloud. The following restrictions apply: **Mixamo is not
> available for Enterprise and Federated IDs. Mixamo is not available for users who have
> a country code from China.**"

**Adobe General Terms of Use, published 2025-10-03, section 3.6 Content Files, verbatim:**

> "...we grant you a personal, non-exclusive, non-sublicensable ... and non-transferable
> license to use the Content Files to create your end use ... into which the Content
> Files, or derivations thereof, are embedded for your use ('End Use'). You may modify
> the Content Files prior to embedding them in the End Use. You may reproduce and
> distribute Content Files only in connection with your End Use, however, **under no
> circumstances can you distribute the Content Files on a stand-alone basis, outside of
> the End Use.**"

**Fuse Product Specific Terms (2024-06-18), the nearest thing to Mixamo-specific terms,
verbatim:**

> "**Animation Data** means 1) animation files in BVH, FBX, OBJ or Collada formats
> containing data owned by or licensed to Adobe..."
>
> "**Redistribution, republication or commercialization of Animation Data separate from
> or outside of the End Use is strictly prohibited.**"

**Verified gap worth knowing:** Adobe's Product Specific Terms index (General Terms
section 1.2) lists Acrobat, Express, Fonts, Stock, Substance 3D Assets, **Fuse**, and
about twenty others. **There is no "Mixamo" entry.** Mixamo's own footer links "Terms of
Use" to `adobe.com/legal/terms.html`, so General Terms 3.6 is the operative clause.

**Summary of what is and is not established:**

| Claim | Status |
|---|---|
| Royalty-free | **VERIFIED** - exact phrase in the official Adobe FAQ |
| Commercial use, including video games | **VERIFIED** - "Create video games" in the official FAQ |
| No attribution required | Verified only in the unofficial community FAQ, not in Adobe legal text |
| Cannot redistribute raw FBX/DAE as the product | **VERIFIED** - General Terms 3.6 and Fuse PST |
| Embedding in a shipped game is fine | **VERIFIED** - that is the definition of "End Use" |
| **Perpetual** | **UNVERIFIED. The word "perpetual" appears in no Adobe-authored Mixamo license text.** The grant has no stated term and General Terms 3.7 lets Adobe terminate free access at its sole discretion. **Do not represent Mixamo as perpetual.** |
| Free Adobe ID required to download | **VERIFIED** - tested live: browsing works logged out, clicking Download produces "Please sign in to download" |
| Cannot be used to train ML models | Stated in the community FAQ only |

**Formats and rig, extracted from the live app bundle `mixamo.min.1295a6f5.js` (HTTP 200):**

```
FBX Binary (.fbx) [fbx7_2019] | FBX ASCII (.fbx) | FBX for Unity (.fbx)
FBX 7.4 (.fbx) | FBX 6.1 (.fbx) | Collada (.dae)
skin: With Skin / Without Skin    fps: 24 / 30 / 60
```

**Zero occurrences of "gltf" or "glb" in the entire 962 KB bundle. FBX and Collada only.**

Skeleton LOD options, verbatim: "Standard Skeleton (65)" - "complete joint chains and
fully articulating fingers, for a total of 65 joints"; "3 Chain Fingers (49)"; "2 Chain
Fingers (41)"; "No Fingers". The 65-joint figure is Adobe-verified. The `mixamorig:` bone
prefix is generated server-side and is **UNVERIFIED from an Adobe primary source**,
though heavily corroborated by third parties.

**Library size, counted live:** 108 characters, 2,484 animations. Undead-relevant stock
characters present: Skeletonzombie T Avelange, Warzombie F Pedroso, Zombiegirl W
Kurniawan, Copzombie L Actisdato, Vampire A Lusth, Parasite L Starkie, Mutant, Romero,
Demon T Wiezzorek, Maw J Laygo, Ganfaul M Aure. **No mummy.**

**Maintenance status: alive but frozen.** No deprecation or sunset announcement exists.
But the official FAQ has not been touched since September 2021, there is no Mixamo entry
in Adobe's Product Specific Terms, the companion product (Fuse CC) was discontinued years
ago, and the community FAQ still describes Mixamo as a "limited duration technology
preview." Adjacent signal: Adobe announced it will cease selling Adobe Animate on
2026-03-01. Treat Mixamo as an unsupported legacy service with a thin, stale license.

**Verdict: usable, and the animation library is genuinely unmatched at 2,484 clips. But
the FBX-only export plus the thin license plus the account gate makes it the second
choice, not the first.**

### CC0 rigged characters - the actual recommendation

**Quaternius.** CC0 verified verbatim (quoted in Section 3). Rigged and animated.

| Pack | Models | Animated | Formats | glTF |
|---|---|---|---|---|
| **Zombie Apocalypse Kit** | 60 | yes | FBX, OBJ, Blend, **glTF** | **yes** |
| **Universal Base Characters** | 26 | yes | FBX, OBJ, Blend, **glTF** | **yes** |
| **Universal Animation Library** | 1 rig, 120+ anims | yes | FBX, **GLB**, Blend | **yes** |
| Ultimate Animated Character Pack | 52 | yes | FBX, OBJ, Blend | no |
| Ultimate Monsters | 50 | yes | FBX, OBJ, Blend, **glTF** | **yes** (tags include `skeleton`) |
| Animated Zombie Pack | 2 | yes | FBX, OBJ, Blend | no |

Universal Base Characters, quoted verbatim:

> "includes 6 game-ready character models in Superhero, Regular, and Teen proportions
> (male and female). Designed with optimized, animation-friendly topology and **rigged
> with a Humanoid rig allowing easy retargeting in any engine**."

Universal Animation Library, verbatim:

> "is a kit of 120+ animations, created using a **universal humanoid rig, which is
> compatible with Unreal Engine, Godot and Unity, ready for retargeting**."

**This is the pairing to use: Universal Base Characters (the rigged bodies, glTF) +
Universal Animation Library (120+ clips on a matching rig, GLB).** One skeleton, many
bodies, many clips, all CC0, all glTF, no account, no attribution, no license ambiguity.

**Building the roster on top of that:**

| Enemy | Source | Work required |
|---|---|---|
| Mummy | Universal Base Character + custom bandage texture | **Retexture. No CC0 mummy exists anywhere.** Albedo + normal for wrappings; the silhouette is already right. |
| Husk | Universal Base Character, thinned proportions | Retexture, optional mesh edit |
| Zombie / risen | Zombie Apocalypse Kit or Ultimate Monsters | Drop in |
| Armoured undead | Ultimate Monsters (`skeleton` tag) + prop armour | Composite |
| Five boss gods | Custom, or Sketchfab CC0 museum scans as reference | **The genuinely expensive one.** Jackal/falcon/lioness heads are not in any CC0 pack. |

**Kenney** is also CC0-verified and has `animated-characters-survivors` (8 files, tags
include zombie and survivor, with an Animation feature flag). Format is GLB per Kenney's
own KB statement. Same style-clash caveat as Section 3.

### Animation formats and loaders in three.js at 0.185.1

| Format | Loader | Path | HTTP | Size | Verdict |
|---|---|---|---|---|---|
| **glTF / GLB with skinning** | `GLTFLoader` | `three/addons/loaders/GLTFLoader.js` | **200** | 114,959 B | **Use this.** Skinning, morph targets, and animation clips are all first-class in the spec. Parses to `THREE.SkinnedMesh` + `THREE.AnimationClip[]` with no conversion. |
| **FBX** | `FBXLoader` | `three/addons/loaders/FBXLoader.js` | **200** | 111,266 B | Works, produces `SkinnedMesh` + clips. But FBX is a proprietary binary with a large surface area, files are much bigger than GLB, and there is no compression story. Use only if you must load Mixamo output at runtime. |
| **Collada / DAE** | `ColladaLoader` | `three/addons/loaders/ColladaLoader.js` | not tested this pass - **UNVERIFIED** | | Mixamo's other export. XML, verbose, no reason to prefer it over FBX. |
| Retargeting between skeletons | `SkeletonUtils` | `three/addons/utils/SkeletonUtils.js` | **200** | 11,535 B | `retargetClip` and `clone` for `SkinnedMesh`. Needed to drive Quaternius bodies with Quaternius library clips if the bone names differ, and essential if you mix Mixamo clips onto a non-Mixamo rig. |

**The pipeline call: convert everything to GLB offline. Ship only `GLTFLoader`.**

For FBX sources (Mixamo, Quaternius Modular Ruins, Ultimate Guns), run one Blender pass:
import FBX, export glTF 2.0 binary, with Draco or meshopt on. This costs you a build step
you run once per asset, and it saves 111 KB of `FBXLoader` plus a large chunk of asset
bytes on **every single page load, for every player, forever.** That trade is not close.

---

## 5. Weapon models

Weapons are the highest-risk licensing category on every asset site, because ripped
commercial game assets get re-uploaded with invented licenses.

| Model | Source | License | URL | 1k | 2k | Note |
|---|---|---|---|---|---|---|
| **Service Pistol** | Poly Haven | **CC0** | `polyhaven.com/a/service_pistol` | **3.1 MB** | 9.0 MB | Tags: vintage, semi-automatic, metal, cold war, handgun. Photogrammetry, PBR. |
| **Bolt Action Rifle 7.62** | Poly Haven | **CC0** | `polyhaven.com/a/bolt_action_rifle_7_62` | 5.8 MB | 20.5 MB | Tags: vintage, worn, weathered, gun, scope. |
| Stick Grenade | Poly Haven | **CC0** | `polyhaven.com/a/stick_grenade` | 1.8 MB | 7.0 MB | WW2 German. |
| Cannon 01 | Poly Haven | **CC0** | `polyhaven.com/a/cannon_01` | 3.4 MB | 9.6 MB | In the `rigged` category. |
| **High-poly AK-47** | OpenGameArt (Lamoot) | **CC0** - license field read directly on the page | `opengameart.org/content/high-poly-ak-47` | **UNVERIFIED** | | Strongest modern-firearm CC0 lead found. |
| Two Pistols | OpenGameArt (mrpoly) | **CC0** - read | `opengameart.org/content/two-pistols` | **UNVERIFIED** | | |
| Oldschool AFPS Weapons | OpenGameArt (Drummyfish) | **CC0** - read | `opengameart.org/content/oldschool-afps-weapons` | **UNVERIFIED** | | |
| Low Poly Guns Pack | OpenGameArt (Quaternius) | **CC0** - read | `opengameart.org/content/low-poly-guns-pack` | **UNVERIFIED** | | Same as the Quaternius site pack |
| Various Small Arms | OpenGameArt (Tabasco) | **dual-listed CC-BY 3.0 AND CC0** - read | `opengameart.org/content/various-small-arms-assault-rifles-sniper-pistol` | **UNVERIFIED** | | Usable under the CC0 grant, but note the dual listing |
| Ultimate Guns Pack (40) | Quaternius | **CC0** verified | `quaternius.com` | **UNVERIFIED** | | FBX/OBJ/Blend, **no glTF** |
| blaster-kit (40 files) | Kenney | **CC0** verified | `kenney.nl/assets/blaster-kit` | **1.6 MB** | | Stylized sci-fi, ships GLB |
| Anything on Sketchfab | Sketchfab | **UNVERIFIED - no specific weapon model's license was read** | | | | **Highest mislicensing risk on the site. Read `.license.slug` per model.** |

**Poly Haven honest limitations, verified:** neither `service_pistol` nor
`bolt_action_rifle_7_62` appears in Poly Haven's `rigged` category (only `cannon_01`
does). They are **static scanned meshes**. Whether the slide, trigger, magazine, and bolt
are separate submeshes you can animate is **UNVERIFIED** - the geometry was not
downloaded or inspected. For a viewmodel with a reload animation, check that first. Also,
these are Cold War and WW2 era, not modern; if "modern firearm" means M4 or Glock, Poly
Haven does not have it.

### Honest judgment: should the viewmodel be a downloaded asset at all?

**No. Keep the procedural viewmodel.** Three reasons.

1. **Screen area is the entire argument.** A viewmodel occupies 20 to 35 percent of the
   frame, permanently, at roughly 30 cm from the near plane. Kenney and Quaternius weapons
   are flat-shaded, atlas-coloured, few-hundred-triangle props authored to be legible at
   10 to 50 metres in third person. Every economy that makes them good there - no normal
   map, no roughness variation, chunky silhouette - becomes a defect at viewmodel
   distance. `src/player/viewmodel.js` is 2,128 lines and produces seven weapons with
   correct proportions and controllable edge density exactly where the camera is.

2. **Style coherence beats asset fidelity.** The screenshot shows a semi-realistic
   necropolis with photogrammetric material tiers and real shadow work. A flat-shaded toy
   blaster in the bottom-right of that frame does not read as stylised, it reads as
   broken.

3. **The viewmodel is the one asset you cannot cheaply outsource.** It needs a correct
   pivot at the hand, separated slide/bolt/magazine/trigger for reload and fire
   animations, and a muzzle transform for the flash and tracer origin. None of the packs
   ship a viewmodel rig. Cutting one apart costs more than building geometry you control.

**The real upgrade the weapons need is IBL, not a new mesh.** The pistol in
`shots/02-courtyard.png` looks like a dark slab because it is `metalness: 0.90` reflecting
an empty environment. Fix that with the 1 MB HDRI and the same geometry will read as
gunmetal. After that, spend time on recoil curves, muzzle flash, shell ejection, and
bob/sway - motion sells a weapon far more than polycount does.

If you want a real mesh anyway: **Poly Haven `service_pistol` at 1k, 3.1 MB, CC0** is the
only option that matches the existing photogrammetric material pipeline, and check mesh
separation before committing.

---

## 6. Audio

**The current Web Audio synthesis (`src/core/audio.js`, 1,622 lines) works and should
stay as the default layer.** This section recommends buying four things, not replacing
the system.

### Sources

**Freesound CC0 filter** - **HTTP 200**:
```
https://freesound.org/search/?q=<query>&f=license%3A%22Creative+Commons+0%22
```
Real CC0 result counts pulled live: gunshot **872**, impact 6,981, stone 1,389, footstep
5,074, wind 10,338, ambience 17,356, scream 2,870, growl 2,173.

**Account required, verified not assumed:** an unauthenticated download URL
(`freesound.org/people/qubodup/sounds/187677/download/`) redirected to the login page.
The API (`freesound.org/apiv2/`) returns **HTTP 401** without a key. Browsing and
searching are open; downloading is not.

**Kenney audio packs** - **HTTP 200**, same verbatim `Creative Commons CC0` per-asset
field as the 3D packs, **no account at all**, direct zip: `impact-sounds`, `rpg-audio`,
`sci-fi-sounds`, `interface-sounds`, `ui-audio`, `voiceover-pack`. `impact-sounds` and
`rpg-audio` are directly relevant and are the lowest-friction CC0 audio available.

**OpenGameArt sound effects** (`field_art_type_tid[]=13` + CC0 license facet) - **HTTP
200**, no account needed.

**Sonniss GDC bundle** - `https://sonniss.com/gameaudiogdc` returned **HTTP 403** to curl.
**UNVERIFIED. Its license is a custom royalty-free grant, not CC0. Do not rely on it
without checking.**

### Honest judgment: where recordings genuinely beat synthesis

**Recordings win decisively - buy these four:**

- **Gunshot tails and reflections.** The transient crack is easy to synthesise; the 200 to
  800 ms decay - early reflections off stone, flutter echo down a corridor, the room's
  actual modal response - is very hard. This is the single biggest audible upgrade
  available and it is exactly what a necropolis interior needs.
- **Environmental ambience beds.** Wind through stone, distant settling, low-frequency
  room tone. Dense, aperiodic, spectrally irregular. Synthesised ambience nearly always
  betrays itself as looping filtered noise within about 15 seconds.
- **Undead vocalisations.** Growls, rasps, screams. Human and animal vocal tracts produce
  chaotic subharmonics, jitter, and shimmer that no practical oscillator stack
  reproduces. A pitched-down, granulated real recording is dramatically more unsettling.
  This is a horror game's most important sound and synthesis is weakest here.
- **Complex material impacts.** Stone-on-stone, pottery shattering, sand and gravel
  scatter. Many-body granular collisions, hundreds of micro-transients. Synthesisable in
  principle, not economically. Kenney `impact-sounds` covers this with no account.

**Synthesis is equal or better - keep what you have:**

- **UI and feedback tones.** Hitmarkers, pickups, menu clicks. Synthesis is more
  consistent, instantly tunable, zero bytes, and can be pitch-mapped to game state (rising
  pitch on a combo) in a way samples cannot.
- **Low-frequency impact and explosion bodies.** A shaped sine sweep with a fast envelope
  is cleaner than most recordings, which arrive with baked-in room tone you then fight.
- **Weapon mechanicals** - bolt, slide, magazine clicks. Short, dry, transient-dominated.
  Filtered noise bursts are convincing and sync exactly to animation frames.
- **Anything needing continuous parametric control.** Wind intensity tied to player depth,
  a drone tracking enemy proximity, doppler on projectiles. Synthesis gives you a knob;
  samples give you crossfades and artifacts.
- **Footsteps** - genuinely a toss-up. Recordings sound better per step; synthesis avoids
  the machine-gun repetition artifact that kills sampled footsteps unless you have 8+
  variants per surface. With 5,074 CC0 options, take samples and randomise.

**Budget: 3 to 6 MB of Opus or AAC covers all four categories.** Encode to `.opus` at 64
to 96 kbps mono for effects; browser support is universal and it beats MP3 substantially
at that bitrate.

---

## 7. The integration cost - honest accounting

### Download totals

| Tier | Contents | Total |
|---|---|---|
| **Currently on disk (measured)** | 1 HDRI @ 2k (4.0 MB) + 5 material sets @ 1K (5.7 MB) + an unused 2K duplicate set (69 MB) | **79 MB on disk, 9.7 MB actually referenced** |
| **Minimal recommended** | See the last section | **28.5 MB** |
| **Generous** | 3 HDRIs @ 1k, 12 material sets @ 2K, 12 Poly Haven props @ 1k, character kit, audio | **~230 MB** |
| **Maximalist (do not)** | 4k materials, 4k HDRIs, 2k models, Sketchfab museum scans | **1.5 GB+** |

**Note: `assets/materials/` (2K, 69 MB) is currently on disk but `MATERIAL_ROOT` in
`assets.js` points at `assets/materials-1k/`. The 2K set is dead weight - 69 MB of
untracked files nothing loads. Either wire it to the fidelity toggle or delete it.**

### What this does to load time

Measured against the actual referenced set (9.7 MB) and the recommended minimal set
(28.5 MB), assuming a cold cache and no compression beyond what the files already have:

| Connection | Effective throughput | 9.7 MB | 28.5 MB | 230 MB |
|---|---|---|---|---|
| Fibre, 200 Mbps | ~22 MB/s | 0.4 s | 1.3 s | 10 s |
| Cable, 50 Mbps | ~5.5 MB/s | 1.8 s | 5.2 s | 42 s |
| Good 4G, 20 Mbps | ~2.2 MB/s | 4.4 s | 13 s | 105 s |
| Slow 4G, 5 Mbps | ~0.55 MB/s | 18 s | 52 s | 7 min |

Three things make the raw number worse than it looks:

1. **The JPEGs are already compressed.** `Content-Encoding: gzip` does nothing for them.
   The transfer size equals the disk size.
2. **The `.hdr` is not compressed at all.** RGBE with run-length encoding is barely
   compressed and gzip helps only marginally.
3. **Request count.** 23 material files + 1 HDRI = 24 requests. Over HTTP/1.1 that
   serialises into 6-connection batches. Over HTTP/2 or HTTP/3 it multiplexes and is
   fine. `python3 -m http.server`, which the README recommends, is **HTTP/1.1 and
   single-threaded** - it will serialise everything. **Local dev will feel far slower than
   production. Do not tune the loading screen against it.**

The existing code already does the two most important things right: `loadAssets` runs all
texture loads in `Promise.all` (`src/world/assets.js:105`), and it never rejects - a
missing asset degrades to the procedural path instead of a black screen. Keep both.

### Compression, and which loaders actually exist at 0.185.1

**Textures: KTX2 / Basis Universal.** `KTX2Loader` **HTTP 200, 36,567 B**. Transcoder at
`three/addons/libs/basis/basis_transcoder.js` **200, 56 KB** and
`basis_transcoder.wasm` **200, 515 KB**.

The honest tradeoff, which is routinely misrepresented:

- KTX2/Basis is usually **not smaller on disk than a well-tuned JPEG**. UASTC in
  particular is often *larger*. ETC1S is smaller but lossier.
- What it buys is **GPU memory and upload time**. A 1024x1024 JPEG decodes to 4 MB of
  uncompressed RGBA in VRAM. The same texture as KTX2 transcodes to a GPU-native
  compressed format (BC7, ASTC, ETC2) and stays at 1 MB or less **on the GPU**. With 23
  maps loaded, that is roughly 92 MB of VRAM as JPEG versus roughly 23 MB as KTX2.
- The cost is a **571 KB transcoder** download plus the KTX2Loader, and an offline
  `toktx`/`basisu` encoding step.

**Verdict: not yet.** At 23 textures and 5.7 MB, the 571 KB transcoder is 10 percent
overhead to save VRAM you are not short of. **Revisit when the material count passes
roughly 15 sets or you move to 2K, where the VRAM math flips hard.**

**Geometry: Draco and meshopt.** `DRACOLoader` **200, 19,030 B**; decoder at
`three/addons/libs/draco/gltf/draco_decoder.wasm` **200, 188 KB** plus
`draco_wasm_wrapper.js` **200, 57 KB** (245 KB total for the glTF-specific decoder; the
generic `draco_decoder.js` is 703 KB - use the `gltf/` path). `meshopt_decoder.module.js`
**200, 29,256 B**.

- **meshopt is the better default here.** 29 KB of decoder versus 245 KB, no WASM
  fetch coordination, and typically 4 to 6x geometry compression with faster decode.
- **Draco compresses harder** (up to 10x on dense meshes) at a much larger decoder cost
  and slower decode.
- **Neither matters until you load meshes.** The game currently loads zero geometry.

**Verdict: adopt meshopt at the same moment you adopt `GLTFLoader`, not before.** 29 KB
is cheap enough that there is no reason to ship uncompressed glTF.

**Cheap wins available immediately, before any of the above:**

1. **HDRI 2k -> 1k: saves 3.2 MB.** Documented as ideal by three.js itself. Do this first.
2. **Delete or gate `assets/materials/` (2K): 69 MB of dead files.**
3. **Drop the AO maps and use the alpha channel or a packed ORM texture.** ambientCG ships
   separate R/AO/M greyscale files; packing them into one RGB texture cuts three requests
   to one and roughly a third of the bytes. Requires an offline pack step and a shader
   tweak.
4. **Serve with Brotli.** Does nothing for JPEG but helps the `.hdr` and every `.js`.

### The self-contained HTML file dies. Here is what replaces it.

The README constraint list currently says:

> "No asset loaders. `GLTFLoader` and friends stay out. Nothing is downloaded."
> "No image, audio, or font files."

**Both are already false.** `assets/` exists on disk with an HDRI and 23 JPEGs;
`src/world/assets.js` imports `RGBELoader` and is wired into `main.js` at lines 100 and
134. The constraint was relaxed before this document was written. **Update the README so
it stops describing a build that no longer exists** - a stale constraint list is worse
than no constraint list, because the next person will believe it.

What is genuinely lost, and what replaces it:

| Was | Now | Mitigation |
|---|---|---|
| Open `index.html`, it runs | Needs a static server anyway (ES modules + import maps do not work over `file://`) | **Nothing lost. This was already true.** |
| Zero-byte first paint | 9.7 to 28.5 MB before full fidelity | Load screen with honest progress. `loadAssets` already reports `done/jobs` with a label - use it. |
| Cannot break from a 404 | An asset 404 is now a possible failure mode | **Already handled.** `loadAssets` never rejects; it collects `failed[]` and the game runs procedural. This is the single best design decision in the current asset code. Keep it and never regress it. |
| One file to email or paste | A directory | Ship a zip, or a Vercel/Netlify/GitHub Pages URL. |
| Trivially embeddable in an iframe | Same, plus asset hosting | Assets are relative paths; any static host works. |

**The replacement deliverable is a static directory, deployed to any static host, with
the procedural path as a guaranteed fallback.** Concretely:

```
sands-of-the-restless/
  index.html
  src/**.js
  assets/
    hdri/*.hdr
    materials-1k/<set>/{color,normalgl,roughness,ambientocclusion}.jpg
    models/*.glb          (later)
    audio/*.opus          (later)
```

The property worth protecting is **not** "one file." It is **"never breaks."** The
progressive-enhancement structure already in `assets.js` preserves that, and it is
strictly better than a single file: a single file that fails, fails completely.

### Is a hybrid sensible?

**Yes, and it is the only sensible answer.** The split, stated plainly:

**Buy (procedural loses):**

- **Surface detail.** Sobel-from-albedo normals infer shape from colour and are wrong
  wherever the two disagree. A photogrammetric normal is measured. Not a close call.
- **Environment lighting.** You cannot generate a plausible HDR sky-plus-bounce
  distribution from three lights. One 1 MB file replaces the entire problem.
- **Characters.** Rigged, skinned, animated humanoids with believable weight. This is the
  hardest thing in real-time graphics to fake procedurally and the game needs a dozen of
  them.
- **Vocalisations and ambience.** Chaotic, aperiodic, spectrally dense.

**Keep procedural (procedural wins, or ties at zero bytes):**

- **Layout and room graph.** `world/rooms.js` as data plus `world/build.js` as the single
  compiler is the right architecture and no asset improves it.
- **Scatter and variation.** 644 lines in `scatter.js` producing hundreds of unique
  pebbles and tufts at zero download cost. A downloaded rock is one rock; a generator is
  a distribution. **This is procedural's actual superpower and it is being used correctly.**
- **World-space weathering.** `weathering.js` injects grime, bleaching, and large-scale
  mottling into the standard material. **This is what stops a 1K tiled scan from reading
  as a 1K tiled scan.** It makes the bought assets better. The comment in
  `assets.js:18-20` making exactly this point is correct and worth keeping.
- **The sky dome.** `sky.js` is a cheap gradient plus sun-glow shader that already reads
  as bleached desert noon. It is also what lets the HDRI stay at 1k, because the HDRI
  never has to be visible.
- **The viewmodel.** Argued in Section 5.
- **Cracked-mud patterns.** ambientCG genuinely does not have this; a Worley/Voronoi
  distance-field crack mask does it better and parametrically.
- **Muzzle flash, impacts, dust, tracers.** All motion and particle work. Zero bytes.

**The line, in one sentence: buy the things that are measurements of reality (scans,
probes, performances); generate the things that are distributions and arrangements.**

---

## 8. Recommended MINIMAL starter set - 28.5 MB

Maximum visual gain per megabyte. Every URL below returned **HTTP 200**. Every item is
CC0 with no attribution required.

### Tier 0 - do these first, they cost 1.0 MB and negative 3.2 MB

| Action | Delta |
|---|---|
| Replace `assets/hdri/qwantani_noon_puresky_2k.hdr` (4.0 MB) with `..._1k.hdr` (1.0 MB) | **-3.2 MB** |
| Change `src/world/assets.js:26` to import `HDRLoader` instead of the deprecated `RGBELoader` shim | 0 |
| Delete or fidelity-gate `assets/materials/` (2K duplicate) | **-69 MB on disk** |
| Update the README constraint list, which no longer describes this build | 0 |

`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/qwantani_noon_puresky_1k.hdr` - **200**

**Net after Tier 0: the game gets better and gets 3.2 MB smaller.**

### Tier 1 - environment, 3.7 MB

| Asset | Source | License | URL | Size |
|---|---|---|---|---|
| `qwantani_noon_puresky_1k.hdr` | Poly Haven | CC0 | `dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/qwantani_noon_puresky_1k.hdr` | **1.0 MB** |
| `goegap_1k.hdr` | Poly Haven | CC0 | `dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/goegap_1k.hdr` | **1.3 MB** |
| `rogland_sunset_1k.hdr` | Poly Haven | CC0 | `dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/rogland_sunset_1k.hdr` | **1.4 MB** |

Two spares at 1.3 and 1.4 MB give you a bleached-noon and a golden-hour look for
different waves or areas, swappable by re-running PMREM. Lazy-load them; only ship the
noon one in the critical path.

### Tier 2 - material sets, 1K JPG, 15.6 MB of zips

Ship only `color` + `normalgl` + `roughness` + `ambientocclusion`. Skip `displacement`
until POM is actually implemented, and skip `normaldx` entirely (three.js uses GL
convention).

| Role | Asset | URL | Zip | Replaces |
|---|---|---|---|---|
| sand | **`Ground093C`** | `ambientcg.com/get?file=Ground093C_1K-JPG.zip` | **4.9 MB** | `Ground054` - real desert dune vs beach mud, and 3.4 MB cheaper |
| limestone | **`Bricks084`** | `ambientcg.com/get?file=Bricks084_1K-JPG.zip` | **4.8 MB** | `Bricks083` - tagged sandstone, marginally cheaper |
| carved | **`Travertine009`** | `ambientcg.com/get?file=Travertine009_1K-JPG.zip` | **3.1 MB** | `Tiles139` - correct stone family, has AO, 1.5 MB cheaper |
| gold | **`Metal048C`** | `ambientcg.com/get?file=Metal048C_1K-JPG.zip` | **4.3 MB** | procedural gold. Impure/rough tomb gold, ships a metalness map. **This is the set that shows off the new IBL.** |
| granite | `Granite003A` | `ambientcg.com/get?file=Granite003A_1K-JPG.zip` | 4.9 MB | keep as-is |
| weathered | `Rock063` | `ambientcg.com/get?file=Rock063_1K-JPG.zip` | 4.7 MB | optional - aged, cracked, damaged |

**After extraction and dropping `displacement` + `normaldx`, expect roughly 55 to 65
percent of the zip weight to survive.** Measured against the existing on-disk set: the
`Ground054` 1K zip is 8.3 MB and the four kept maps total 1.7 MB on disk. **So 15.6 MB of
zips lands at roughly 5 to 7 MB of shipped JPEGs.**

**Shipped Tier 2: ~7 MB.**

### Tier 3 - characters, 10 to 20 MB (estimated)

| Asset | Source | License | Note |
|---|---|---|---|
| **Universal Base Characters** (26 models, rigged, glTF) | Quaternius | **CC0 verified verbatim** | The humanoid rig everything else retargets onto |
| **Universal Animation Library** (120+ clips, GLB) | Quaternius | **CC0 verified verbatim** | One skeleton, many clips |
| Zombie Apocalypse Kit (60 models, glTF) | Quaternius | **CC0 verified verbatim** | Drop-in risen/husk enemies |

**UNVERIFIED: Quaternius does not publish pack byte sizes.** Estimate 10 to 20 MB for all
three based on comparable low-poly glTF character kits. **Budget 20 MB and check on
download.** Ship one or two enemy types in the critical path and lazy-load the rest per
wave.

`GLTFLoader` (115 KB) + `meshopt_decoder` (29 KB) = **144 KB of loader**, one time.

### Tier 4 - audio, 3 to 6 MB

| Category | Source | License | Note |
|---|---|---|---|
| Impact and material sounds | Kenney `impact-sounds` | **CC0 verified** | No account needed, direct zip |
| Gunshot tails | Freesound CC0 filter (872 results) | CC0 | Free account required |
| Ambience beds | Freesound CC0 filter (17,356 results) | CC0 | " |
| Undead vocalisations | Freesound CC0 filter (growl 2,173 / scream 2,870) | CC0 | " |

Encode to `.opus` at 64-96 kbps mono. Everything else stays synthesised.

### Total

| Tier | Shipped bytes |
|---|---|
| Tier 1 - HDRIs (1 critical + 2 lazy) | 3.7 MB |
| Tier 2 - 6 material sets, 4 maps each | ~7 MB |
| Tier 3 - characters (estimated, **UNVERIFIED**) | ~15 MB |
| Tier 4 - audio | ~3 MB |
| three.js loaders (`GLTFLoader` + `meshopt` + `HDRLoader`) | 0.16 MB |
| **Total** | **~28.5 MB** |
| **Critical path (before first frame)** | **~8 MB** - noon HDRI + 6 material sets |

Everything past the first 8 MB lazy-loads behind the loading screen or per wave.

---

## Verified URL status appendix

Every external URL cited, with the real status recorded during research.

| URL | Status |
|---|---|
| `https://unpkg.com/three@0.185.1/build/three.module.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/HDRLoader.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/RGBELoader.js` | 200 (deprecation shim) |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/EXRLoader.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/UltraHDRLoader.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/GLTFLoader.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/FBXLoader.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/KTX2Loader.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/DRACOLoader.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/OBJLoader.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/MTLLoader.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/HDRCubeTextureLoader.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/libs/meshopt_decoder.module.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/libs/draco/gltf/draco_decoder.wasm` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/libs/basis/basis_transcoder.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/libs/basis/basis_transcoder.wasm` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/utils/SkeletonUtils.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/environments/RoomEnvironment.js` | 200 |
| `https://unpkg.com/three@0.185.1/examples/jsm/loaders/rgbe/RGBELoader.js` | **404** (old pre-r150 path, do not use) |
| `https://api.polyhaven.com/assets?t=hdris` | 200 (980 assets) |
| `https://api.polyhaven.com/assets?t=models` | 200 (521 assets) |
| `https://api.polyhaven.com/files/<id>` | 200 (**403** to Python urllib default UA) |
| `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/qwantani_noon_puresky_1k.hdr` | 200 |
| `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/qwantani_noon_puresky_2k.hdr` | 200 |
| `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/goegap_1k.hdr` | 200 |
| `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/goegap_2k.hdr` | 200 |
| `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/rogland_sunset_2k.hdr` | 200 |
| `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kiara_5_noon_2k.hdr` | 200 |
| `https://ambientcg.com/api/v2/full_json?type=Material&...` | 200 |
| `https://ambientcg.com/license` | 200 |
| `https://ambientcg.com/get?file=Ground054_1K-JPG.zip` | 200, `application/zip` |
| `https://ambientcg.com/get?file=Bricks084_1K-JPG.zip` | 200, `application/zip` |
| `https://ambientcg.com/get?file=Rock029_1K-JPG.zip` | 200, `application/zip` |
| `https://www.mixamo.com/` | 200 |
| `https://www.mixamo.com/faq` | **404** |
| `https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html` | 200 via browser; curl blocked |
| `https://www.adobe.com/legal/terms.html` | 200 via browser; curl blocked |
| `https://www.adobe.com/go/fuseterms` | 200 -> Fuse PST PDF |
| `https://quaternius.com/` , `/faq.html` | 200 |
| `https://quaternius.com/packs/ultimatecharacters.html` | **404** |
| `https://kenney.nl/` , `/support` , `/assets` | 200 |
| `https://kenney.nl/terms` | **404** |
| `https://poly.pizza/` , `/search/*` , `/m/*` | 200 |
| `https://api.poly.pizza/v1/...` | **401** (key required) |
| `https://api.sketchfab.com/v3/licenses` | 200 |
| `https://api.sketchfab.com/v3/search?type=models&q=egyptian&downloadable=true&license=cc0` | 200 |
| `https://api.sketchfab.com/v3/models/ffe4b699e75849d59d8efe47d3538f03` | 200 (license read: CC0) |
| `https://sketchfab.com/search?...` (HTML) | **202** (Cloudflare challenge to non-browser clients) |
| `https://github.com/KhronosGroup/glTF-Sample-Assets` | 200, `archived: false` |
| `https://github.com/KhronosGroup/glTF-Sample-Models` | 200, **`archived: true`** |
| `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Models.md` | 200 |
| `https://opengameart.org/` and CC0 advanced search | 200 |
| `https://freesound.org/search/?f=license%3A%22Creative+Commons+0%22` | 200 |
| `https://freesound.org/apiv2/` | **401** (key required) |
| `https://sonniss.com/gameaudiogdc` | **403** - **UNVERIFIED license** |

## Everything marked UNVERIFIED, collected

1. **Mixamo perpetuity.** The word "perpetual" appears in no Adobe-authored Mixamo license
   text. Do not represent the grant as perpetual.
2. **The `mixamorig:` bone prefix** is not in any Adobe primary source found; it is
   generated server-side and corroborated only by third parties. The 65-joint count IS
   Adobe-verified.
3. **Quaternius pack byte sizes** are not published anywhere on the site.
4. **Poly Haven `service_pistol` and `bolt_action_rifle_7_62` mesh separation.** Whether
   slide/trigger/magazine/bolt are separate submeshes was not inspected. Check before
   planning a reload animation.
5. **Every Sketchfab CC0 model except "Egyptian false door" (`ffe4b699...`).** They came
   from a `license=cc0` filtered query but no individual license line was read. Fetch
   `api.sketchfab.com/v3/models/<uid>` and read `.license.slug` per model.
6. **ambientCG `Ground092A`, `Ground096A`, `Ground096C`, `Ground097`** appear in search but
   return no JPG download entries. Possibly Patreon early-access. Do not plan around them.
7. **Sonniss GDC bundle license.** The site returned 403; its terms could not be read. It
   is a custom royalty-free grant, not CC0.
8. **OpenGameArt weapon model formats, polycounts, and texture quality.** Licenses were
   read per page; the files were not inspected.
9. **`ColladaLoader` import path at 0.185.1** was not tested this pass.
10. **All OpenGameArt and Sketchfab downloads require checking the specific model page.**
    Both are per-asset licensed by uploader with no platform audit. Weapons are the
    highest-risk category on both.
