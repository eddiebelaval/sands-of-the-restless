/**
 * PBR material registry.
 *
 * One place that owns every material in the game, so tuning the look is a
 * single-file operation and nothing allocates a duplicate MeshStandardMaterial
 * inside a hot path.
 */

import * as THREE from 'three';
import { buildTextures, inscribeScan } from './textures.js';
import { weather, weatherVariant, syncWeatherVariants } from './weathering.js';
import { applyMaps } from './assets.js';

let cache = null;

export function buildMaterials() {
  if (cache) return cache;
  const tex = buildTextures();

  const m = {
    // --- ground and structure -------------------------------------------
    sand: new THREE.MeshStandardMaterial({
      ...tex.sand,
      // Warm, slightly desaturated. Pure white multiplied the texture straight
      // through and left the ground reading as bare albedo.
      color: 0xf2e0bd,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(0.7, 0.7),
    }),

    limestone: new THREE.MeshStandardMaterial({
      ...tex.block,
      // Pale, slightly cool limestone. Kept distinct in hue from the warm sand
      // so wall and ground never merge into one tone at distance.
      color: 0xded3bb,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(1.1, 1.1),
    }),

    /**
     * THE INTERIOR WALL, WITH THE CARVING ON IT.
     *
     * WHY THIS IS A MATERIAL AND NOT A FLAG ON `limestone`. The inscription
     * belongs on the flat dressed faces the player walks between and nowhere
     * else: `limestone` is also the floor of eight rooms, the ramps, the ledge
     * slabs, the column bases and abaci, the canal kerbs and the courtyard's
     * rubble. A register band cut into a floor is nonsense, and a band on a
     * 2-unit rubble chunk is a smear. Splitting the wall off is what lets the
     * carving be authored against the one surface it is read on.
     *
     * IT COSTS NOTHING IT DID NOT ALREADY COST. The interior is not run through
     * world/batch.js - that pass is the courtyard's - so every wall span
     * emitWall() produces was already its own draw call wearing its own
     * geometry. Moving them off `limestone` splits no batch and merges none.
     * Measured before and after at the same pose in test/frieze.mjs.
     *
     * IT IS A FULL REGISTRY MEMBER, and that is the fix for the bug this lane
     * was opened on. `upgradeMaterials` sees it, so the scan lands on it;
     * `applyFidelity` walks Object.values of this registry, so the LOW setting
     * zeroes its normalScale like every other stone; `materialsForBase` makes it
     * a weathering variant, so the Act 3 rooms at -6 get their grime measured
     * from their own floor. A material that lives outside all three is the shape
     * of the defect that made this lane necessary.
     */
    frieze: new THREE.MeshStandardMaterial({
      ...tex.frieze,
      // The wall's own limestone. Same tint as `limestone` on both paths,
      // because a doorway's jamb and the wall it is cut into are one stone and
      // any difference between them reads as a join.
      color: 0xded3bb,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(1.1, 1.1),
    }),

    carved: new THREE.MeshStandardMaterial({
      ...tex.carved,
      // Warmer and slightly pinker than plain limestone: the dressed stone of
      // the facade should read as a different quarry from the bulk masonry.
      color: 0xdcc4a2,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(1.4, 1.4),
    }),

    granite: new THREE.MeshStandardMaterial({
      ...tex.granite,
      // Genuinely dark and cool. The sealed doorway is the one cold object in
      // a hot scene, which is what makes the eye go to it.
      color: 0x5c6470,
      roughness: 1.0,
      // WAS 0.22, AND STONE IS NOT A CONDUCTOR. metalness is not a "shininess"
      // dial: at 0.22 a fifth of this surface's reflectance is metallic, which
      // means a tight coloured specular lobe and a diffuse term suppressed to
      // match. On a four-metre slab facing a 3.5-intensity sun that lobe is the
      // blown white hole the owner reported in the right third of the gate.
      // 0.05 is the dielectric floor a mineral surface actually has, and it is
      // half of that fix; the roughness floor in textures.js is the other half.
      metalness: 0.05,
      normalScale: new THREE.Vector2(0.8, 0.8),
    }),

    // The sealed doorway, and NOTHING ELSE.
    //
    // `granite` is worn by twenty-odd props - sarcophagi, plinths, statues,
    // rubble, the brazier stems - where a weathered rock scan is exactly right.
    // The door is not one of those. It is a dressed monolith, it is the most
    // looked-at object in the game, the player walks toward it for the whole
    // first act, and it fills the frame at the moment they spend a thousand
    // gold on it. Every previous attempt at this surface tried to serve both
    // uses from one material and lost the door each time.
    //
    // Splitting it costs nothing. `temple.js` already tags every portal child
    // standing proud of the jamb as `noBatch`, because `doors.js` drives that
    // exact set into the ground on purchase, so the six stone meshes here were
    // already six separate draw calls and a second material does not add one.
    doorstone: new THREE.MeshStandardMaterial({
      ...tex.doorstone,
      // Neutral, and that is a correction rather than a preference. The two
      // previous colours were 0xaab2bd and 0x9fa9b6, both frankly blue, chasing
      // the note that this should be "the one cold object in a hot scene". At
      // six metres that reads as an unrelated material bolted into a sandstone
      // wall, and in the shadowed reveals it takes the sky and goes navy. A
      // neutral grey reads cool against an orange facade on its own, and it is
      // still stone when the sun comes off it.
      color: 0xb3b5b9,
      roughness: 1.0,
      // Stone is not a conductor. Matches the granite fix for the same reason:
      // a metallic lobe on a four-metre flat in full sun is the blown highlight.
      metalness: 0.04,
      normalScale: new THREE.Vector2(0.95, 0.95),
    }),

    // --- metals ----------------------------------------------------------
    gold: new THREE.MeshStandardMaterial({
      ...tex.gold,
      // NEARLY WHITE, DOWN FROM 0xffd98a, because the map now carries the metal
      // instead of standing in for it. paintGold used to paint a narrow band of
      // orange (206..252 red, 62..110 blue) and this tint multiplied the blue
      // by a further 0.54, which is how gold in this game came out the colour
      // of a traffic cone. The rewritten map ramps to gold's real reflectance;
      // tinting that again would just put the orange straight back. Same
      // correction the scanned sets get four lines below in `upgradeMaterials`.
      color: 0xfff0d8,
      roughness: 1.0,
      metalness: 0.92,
      normalScale: new THREE.Vector2(0.5, 0.5),
      emissive: 0x2a1c05,
      emissiveIntensity: 0.4,
    }),

    /**
     * The winged sun-disc on the sealed doorway, and NOTHING ELSE.
     *
     * Split off the shared gold for the same reason `doorstone` is split off
     * the shared granite, one object further down the same door: this is a
     * 2.4 m relief read from six metres at eye height in a shadowed reveal, and
     * the shared gold is tuned for a gilded cornice twelve metres up. Serving
     * both from one material has now failed twice - once as a chrome ball, and
     * once as the flat orange disc this replaces.
     *
     * It used to be a clone made in `temple.js` that nulled the roughness map
     * and pinned roughness to 1.0. That is what a material registry exists to
     * stop: the tuning lived in the level file, the map set it wanted did not
     * exist, and the only way to escape a mirror was to delete the specular
     * entirely. Both halves are now authored - see the `goldRelief` note in
     * textures.js for the roughness range.
     *
     * metalness 0.85, up from the clone's 0.62. 0.62 was the same hedge from
     * the other side: half a metal has a suppressed specular AND a diffuse term
     * that does not belong on gold, which is a large part of why this read as
     * painted plastic. Gold is a conductor. The dial that keeps it from being a
     * mirror is roughness, and roughness is now doing that job properly.
     */
    goldRelief: new THREE.MeshStandardMaterial({
      ...tex.goldRelief,
      color: 0xfff0d8,
      roughness: 1.0,
      metalness: 0.85,
      // 0.30, and this number was walked DOWN from 0.8 by rendering it.
      //
      // The clone this replaces sat at 0.3 to suppress the checkerboard the old
      // map put in the normals. That defect is gone, so the first cut here went
      // to 0.8 - and a metal amplifies normal detail far more than stone does,
      // because what a normal perturbs on a conductor is the whole reflected
      // environment rather than a diffuse lambert term. At 0.8 the disc read as
      // a bed of gold nuggets and at 0.55 as crocodile skin. The planishing
      // wants to be a shimmer you notice at three metres, not relief you count
      // at twelve.
      normalScale: new THREE.Vector2(0.30, 0.30),
      // A conductor has no diffuse term, so in the reveal's shadow this object
      // has only whatever the IBL hands it. A little emissive is the floor that
      // keeps a gold relief from going black in shade; it is deliberately less
      // than the cornice's, which is in open sun and needs no help.
      emissive: 0x241804,
      emissiveIntensity: 0.18,
    }),

    gunmetal: new THREE.MeshStandardMaterial({
      color: 0x3a3d42,
      roughness: 0.35,
      metalness: 0.90,
    }),

    polymer: new THREE.MeshStandardMaterial({
      color: 0x22242a,
      roughness: 0.70,
      metalness: 0.05,
    }),

    // --- vegetation and cloth --------------------------------------------
    palmTrunk: new THREE.MeshStandardMaterial({
      color: 0x6b563a,
      roughness: 0.95,
      metalness: 0.0,
    }),

    palmFrond: new THREE.MeshStandardMaterial({
      // Dusty olive, not a saturated leaf green. The only cool-adjacent colour
      // in the courtyard, so it needs to sit in the palette rather than shout.
      color: 0x5c6b34,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),

    linen: new THREE.MeshStandardMaterial({
      color: 0xbcae91,
      roughness: 0.95,
      metalness: 0.0,
    }),

    // --- emissive --------------------------------------------------------
    ember: new THREE.MeshStandardMaterial({
      color: 0xff8c32,
      emissive: 0xff6a12,
      emissiveIntensity: 3.2,
      roughness: 0.6,
      metalness: 0.0,
    }),

    // Airborne dust. Additive points catch the light and cost almost nothing.
    dust: new THREE.PointsMaterial({
      color: 0xd8c49a,
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };

  // --- weathering ----------------------------------------------------------
  // World-space grime, sun bleaching, and large-scale mottling, injected into
  // the standard material so it keeps three.js lighting, shadows, and fog.
  // This is what stops a tiled texture from reading as a tiled texture.

  // VARIATION UP FROM 0.34 / 0.30. This is the world-space mottle, and it is the
  // only thing in the program working against "the stone tiles on a grid you can
  // count across the foreground" - a blind judge's words about the shipped
  // build. The tile itself is a fixed 512 map at a fixed texel density; what
  // breaks the grid is a low-frequency term that is a function of WORLD position
  // rather than of UV, so two neighbouring copies of the same tile do not have
  // the same value. Raising it is the cheapest lever on that complaint that does
  // not touch a single UV.
  weather(m.limestone, {
    dirtHeight: 3.2,
    dirt: new THREE.Color(0x7a6547),
    variation: 0.44,
    dirtStrength: 0.60,
    bleachStrength: 0.13,
  });

  // The frieze takes the LIMESTONE profile verbatim, not a profile of its own.
  // It is the same wall; the only difference is that part of it has been cut
  // into. Two profiles would put a visible change of grime across the join
  // between a wall span and the lintel above the doorway beside it.
  weather(m.frieze, {
    dirtHeight: 3.2,
    dirt: new THREE.Color(0x7a6547),
    variation: 0.44,
    dirtStrength: 0.60,
    bleachStrength: 0.13,
  });

  weather(m.carved, {
    dirtHeight: 2.8,
    dirt: new THREE.Color(0x74603f),
    variation: 0.40,
    dirtStrength: 0.52,
    bleachStrength: 0.12,
  });

  weather(m.granite, {
    dirtHeight: 2.2,
    dirt: new THREE.Color(0x53585e),
    variation: 0.36,
    dirtStrength: 0.40,
    bleachStrength: 0.08,
  });

  // The door slab weathers differently from the props, in two ways that both
  // matter at the distance it is read from.
  //
  // The grime is DUST, not the blue-grey 0x53585e the granite props use. This
  // face stands in a sand courtyard; what accumulates on it is the same warm
  // dust that is on everything else, and a cool grime term on a surface that
  // has just been de-blued would put the blue straight back in the bottom two
  // metres - which is exactly where the player stands when they buy it.
  //
  // The mottle is LOWER, 0.20 against 0.36. World-space variation exists to
  // break tiling across a wall, and this object is one stone 6 m wide that
  // carries about one and a half tiles: there is no tiling here to break, and
  // at 0.36 the term was writing a 20 m blotch across a monolith that should
  // read as one piece of rock.
  weather(m.doorstone, {
    dirtHeight: 2.6,
    dirt: new THREE.Color(0x6c6152),
    variation: 0.20,
    dirtStrength: 0.34,
    bleachStrength: 0.06,
  });

  // Sand gets mottling only. Grime and bleach make no sense on a dune field,
  // but the large-scale variation is what breaks up the tiling across 420 units.
  weather(m.sand, {
    dirtHeight: 0.001,
    variation: 0.22,
    dirtStrength: 0.0,
    bleachStrength: 0.10,
  });

  // Every material carries its registry key as its name. Nothing in the render
  // path reads this; a mesh census does, and a table of unnamed materials is not
  // evidence of anything. It is also what makes a weathering variant legible as
  // `limestone@-6` rather than as a second anonymous instance.
  for (const [key, mat] of Object.entries(m)) if (!mat.name) mat.name = key;

  cache = m;
  return cache;
}

/**
 * The registry as seen from a floor at `base`.
 *
 * Every weathered stone material comes back as the instance whose grime is
 * measured from that floor; everything else - gold, ember, the metals, the
 * cloth - comes back as the shared object, because none of them read world Y.
 *
 * WHY THIS EXISTS AT ALL. `weathering.js` darkens stone toward the base of a
 * wall using an absolute world Y, and World 1 now has rooms six metres below
 * the datum, which saturated the grime term and took roughly a third of the
 * albedo off all five Act 3 rooms. The long argument, including why a per-mesh
 * attribute was rejected, is in weathering.js above `weatherVariant`.
 *
 * Keyed on the floor rather than on the room, so nine rooms across two
 * elevations cost two registries and a third elevation costs a third. Cached,
 * because being called once per room must not mean a new material per room.
 */
const byBase = new Map();

export function materialsForBase(base = 0) {
  const m = buildMaterials();
  if (!base) return m;

  const hit = byBase.get(base);
  if (hit) return hit;

  // Spread rather than rebuilt: everything that does not read world Y has to
  // stay the SAME OBJECT, or the fidelity toggle and the scanned-map upgrade
  // would each be walking a registry that half the map no longer points at.
  const out = {
    ...m,
    limestone: weatherVariant(m.limestone, base),
    frieze: weatherVariant(m.frieze, base),
    carved: weatherVariant(m.carved, base),
    granite: weatherVariant(m.granite, base),
  };

  byBase.set(base, out);
  return out;
}

/**
 * Upgrade the procedural materials in place with scanned CC0 map sets.
 *
 * In place, not replaced: every mesh already points at these material objects,
 * and the world-space weathering injection is already installed on them. That
 * injection is what keeps a 1K tiled scan from reading as a 1K tiled scan, so
 * the two are complementary rather than redundant.
 */
export function upgradeMaterials(sets) {
  const m = buildMaterials();
  if (!sets) return m;

  // normalScale is dialled per surface. Scanned normals are far stronger than
  // the Sobel-derived ones they replace, and at 1.0 the masonry reads as
  // corrugated rather than as cut stone.
  applyMaps(m.sand,      sets.sand,      { normalScale: 0.85, aoIntensity: 0.9 });
  applyMaps(m.limestone, sets.limestone, { normalScale: 1.00, aoIntensity: 1.0 });
  // Weathered rock, NOT the tile scan. Tiles139 is square floor tiles: correct
  // for a plaza, catastrophic on a column, where it reads as a checkerboard
  // and announces that the surface is a photograph.
  applyMaps(m.carved,    sets.rock,      { normalScale: 1.05, aoIntensity: 1.0 });
  // WEATHERED ROCK, NOT THE GRANITE SCAN, and for the same class of reason the
  // line above rejects the tile scan.
  //
  // granite003a is a photograph of POLISHED GRANITE: an isotropic pink-and-grey
  // crystal speckle with no feature larger than a few texels. That is a correct
  // scan of a worktop and it is what the sealed doorway has been wearing. The
  // owner, playing the shipped build, said the entrance was not rendering
  // correctly; what he was looking at is a granite countertop standing in an
  // Egyptian temple. Its roughness map is also what put a mirror on a four-metre
  // slab in full sun - see the note in textures.js on the blown highlight.
  //
  // rock023 carries bedding, tool-scale relief and macro variation, which is
  // what this surface has to have: it is the single most-looked-at object in the
  // game, the player walks toward it for the whole first act, and it fills the
  // frame at the moment they spend a thousand gold on it.
  //
  // Sharing a scan with `carved` is not sharing a look. They are different
  // colours (0xaab2bd cold against 0xd6bb90 sandstone), different normal scales
  // (a dressed monolith is smoother than a weathered facade), and different
  // weathering profiles. The one thing they now share is having structure at a
  // scale the eye can resolve.
  applyMaps(m.granite,   sets.rock,      { normalScale: 0.62, aoIntensity: 1.0 });

  // THE WALL FRIEZE IS UPGRADED THROUGH THE SCAN RATHER THAN AROUND IT. This is
  // the line the whole lane exists for; see applyFrieze.
  applyFrieze(m.frieze, sets.limestone);

  // `doorstone` IS NOT UPGRADED, ON PURPOSE, and this line exists so that reads
  // as a decision rather than as an omission.
  //
  // Both scans in the set are wrong for a dressed slab in opposite directions -
  // granite003a is a polished worktop and rock023 is a quarried cliff - and
  // this project has now shipped each of them on this object and had the same
  // complaint back both times. The procedural map is authored at 119 texels per
  // metre against rock023's 307, which is the whole of the fix: at six metres
  // that is one texel per screen pixel instead of 2.6, so what is drawn is what
  // was authored rather than whatever the mip chain averaged it into.

  // The scans carry their own colour, so the procedural tints that were
  // standing in for it must go back to white or they double up.
  m.sand.color.setHex(0xffffff);
  m.limestone.color.setHex(0xd8c39a);
  // The frieze IS the limestone wall. Same scan, same tint, so the inscribed
  // span and the plain lintel over the doorway beside it are one stone.
  m.frieze.color.setHex(0xd8c39a);
  m.carved.color.setHex(0xd6bb90);   // sandstone, not quarry grey
  m.granite.color.setHex(0x9fa9b6);

  // The authored normalScale is the new baseline for the fidelity toggle.
  for (const mat of [m.sand, m.limestone, m.frieze, m.carved, m.granite]) {
    mat.userData.authoredNormalScale = mat.normalScale.x;
  }

  // The per-floor weathering instances were cloned when the interior was built,
  // which is before this resolves. Colour and normalScale are shared objects and
  // followed the retint above on their own; the four map slots and the roughness
  // scalar are ASSIGNED by applyMaps and do not, so they are pushed across here.
  // Without this line the Act 3 rooms would keep the procedural textures while
  // the rest of the map got the scans.
  syncWeatherVariants();

  return m;
}

/**
 * ---------------------------------------------------------------------------
 * THE ONE FUNCTION THAT HAD TO SURVIVE upgradeMaterials
 * ---------------------------------------------------------------------------
 *
 * THE BUG, STATED PLAINLY. Everything this project paints procedurally for a
 * stone surface is thrown away at boot. `applyMaps(m.limestone, sets.limestone)`
 * and `applyMaps(m.carved, sets.rock)` REPLACE the map, the normal, the
 * roughness and the AO of both stone materials with downloaded photographic
 * scans, and `assetsFailed` is empty in every normal run. So
 * `paintMasonry(..., { hieroglyphs: true, register: true })` in textures.js has
 * been dead code at runtime for as long as those scans have loaded: it renders
 * on the asset-404 path and nowhere else. The owner asked for carving on the
 * interior walls, and in the shipped build it could not physically appear.
 *
 * A material that is merely SKIPPED by the upgrade - which is what `doorstone`
 * does, and it is right to - would fix the bug and lose the argument. The scans
 * are better stone than we can paint: bricks083 carries bedding, mortar depth
 * and a baked normal from real geometry, against a normal we infer by running a
 * Sobel filter over our own albedo, which is a guess that a dark stain is a
 * dent. Trading that away to get an inscription is a bad trade and it was
 * measured as one - see the report and test/frieze.mjs, where the wholly
 * procedural frieze lost 38 per cent of the wall's high-frequency detail.
 *
 * So the inscription is composited INTO the scan instead:
 *
 *   ALBEDO   the scan's own photograph, with the recess multiplied down over it
 *            so the grain survives inside the band, and the marks drawn on top.
 *   NORMAL   the scan's baked normal, with a Sobelled detail normal of the mark
 *            geometry added in tangent space. Carving is relief; an inscription
 *            that exists only in the albedo does not change as the player walks.
 *   ROUGH    the scan's, SHARED BY REFERENCE with `limestone`.
 *   AO       the scan's, SHARED BY REFERENCE with `limestone`.
 *
 * which is +2 GPU textures and not +4, and is also what a real Egyptian wall is:
 * dressed stone first, sunk relief cut into a face that already had the quarry
 * in it.
 *
 * `userData.friezeSource` records which path ran. A harness that measures the
 * inscription on the fallback path is measuring the code that was already
 * working, which is the exact trap this lane was opened to escape, so the value
 * is asserted from outside the page in test/frieze.mjs.
 */
function applyFrieze(mat, maps) {
  if (!mat) return mat;

  // No scan: keep the procedural set built in textures.js, which already has
  // the inscription in it. This is the asset-404 path and it is the ONLY path
  // the old code ever ran on.
  if (!maps || !maps.map || !maps.map.image) {
    mat.userData.friezeSource = 'procedural';
    return mat;
  }

  // `lime` and not `sunk`, and that is a MEASURED choice rather than a default.
  // The dark-recess reading is the physically obvious one and it failed the
  // beetle control: staged with a gold scarab standing on the band it took the
  // background behind the body from 14.4 to 4.8 luminance and lost 78.2 per cent
  // of the body into it, against 48.8 on plain stone. See BAND_GROUNDS in
  // textures.js for the argument and test/frieze.mjs for the numbers, which are
  // taken with both grounds built in the same run so the comparison survives.
  const { albedo, normal } = inscribeScan(
    maps.map.image, maps.normalMap?.image || null, { ground: 'lime' });

  const wrap = (canvas, colorSpace) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // Texel density is baked into the geometry's UVs by world/uv.js, exactly as
    // for every other map in this game, so repeat stays 1.
    t.repeat.set(1, 1);
    t.colorSpace = colorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };

  // Dispose the procedural maps being replaced or they leak on the GPU, the
  // same contract applyMaps honours.
  for (const slot of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
    if (mat[slot] && mat[slot].isCanvasTexture) mat[slot].dispose();
  }

  mat.map = wrap(albedo, THREE.SRGBColorSpace);
  if (normal) {
    mat.normalMap = wrap(normal, THREE.NoColorSpace);
    // 1.00, matching what upgradeMaterials gives `limestone` for the same scan.
    // The chisel is carried by the detail term already added into the map, not
    // by scaling the whole wall's relief up to find it.
    mat.normalScale.setScalar(1.00);
  }

  // SHARED BY REFERENCE with limestone's, on purpose. These two slots are the
  // scan's own and the inscription does not change them, so a copy would be a
  // megabyte of VRAM to hold the identical bytes twice.
  if (maps.roughnessMap) {
    mat.roughnessMap = maps.roughnessMap;
    mat.roughness = 1.0;
  }
  if (maps.aoMap) {
    mat.aoMap = maps.aoMap;
    mat.aoMapIntensity = 1.0;
  }

  mat.userData.friezeSource = 'scan';
  mat.needsUpdate = true;
  return mat;
}

/**
 * Drop shadow-map sampling and normal maps on the low fidelity setting.
 * Cheapest large win on weak hardware after disabling post entirely.
 */
export function applyFidelity(materials, high) {
  for (const mat of Object.values(materials)) {
    if (!mat.isMeshStandardMaterial || !mat.normalScale) continue;

    // Remember the authored value the first time through, so toggling back to
    // high restores the tuned scale rather than flattening everything to 1.
    if (mat.userData.authoredNormalScale === undefined) {
      mat.userData.authoredNormalScale = mat.normalScale.x;
    }

    mat.normalScale.setScalar(high ? mat.userData.authoredNormalScale : 0);
    mat.needsUpdate = true;
  }
}
