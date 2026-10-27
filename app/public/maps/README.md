# Salmon Run stage map data

The initial preview was `Cop_Shakedent`. Its `cop-shakedent-markers.json` contains 39 fixed actor positions extracted from the
owned Splatoon 3 11.3.0 RomFS. It is a small derived coordinate index, not a
redistribution of the game's scene, model, textures, collision, or NavMesh.

The source is `Pack/Scene/Cop_Shakedent.pack.zs` (SHA-256
`638af73f3da4b39f7f5e5c41abb8093551f0f3d58b9a0bfa4285952fd6700500`),
entry `Banc/Cop_Shakedent.bcett.byml`. Each marker retains its Banc actor index,
actor name, layer, 64-bit hash, six-decimal `Translate` and `Rotate` values, and
their exact float32 bit patterns in `positionBits` and `rotationBits`.
`rotationRaw` is left uninterpreted; its angle convention has not been verified.
The Shakedent JSON records source hashes for its field actor pack, BFRES model,
and Phive NavMesh. The other stage marker files record scene and Banc hashes;
`stages.json` records their field actor pack and BFRES hashes.

Coordinates are labelled `[x, y, z]`; a viewer may use Y as its vertical axis
and X–Z as its ground plane. The scale in meters, handedness, mesh-to-Banc
alignment, and the meaning of `Rotate` are not established here. Rotating a
camera by 90 degrees or zooming does not change these source values.

`StartPos` and `StartPosForCoopBossRound` are fixed spawn anchors suitable for
testing a camera jump, not observed player positions. `CoopSpawnPointEnemy*`
are fixed candidates, not evidence that an enemy spawned there. Bank markers
are candidates with tide layers; the active layer and Bank versus Base marker
center still need runtime confirmation. Live player XYZ and peer identity are
not decoded.

The actual field geometry exists locally as
`Model/Fld_Shakedent00.bfres.zs` (BFRES, SHA-256
`bcd6de03d598b450cd8adaf0c9cfa725b84bb110793e244c4c9536f0c3602334`),
referenced by the `Fld_Shakedent00` actor's ModelInfo. The pack also contains a
MiniMapModel component.

## Local 3D terrain preview

`tools/convert-stage-map.ts` converts the owned field BFRES into a GLB that the
browser can load at `/maps/local/cop-shakedent.glb`. The output and its manifest
are stored under `app/public/maps/local/`, which this folder's `.gitignore`
excludes from Git. The Vite build removes this local directory from `app/dist`,
and the loopback Hono server serves the source file from the ignored path.
Do not publish the local source asset. The source BFRES and converted geometry
remain local to the asset owner's machine.

The tested converter was [`quatric/nintoolbox`](https://github.com/quatric/nintoolbox)
commit `01bb2ff5c19bf8abe7ad7ca15b0ea5fbc20a06d2`, built on macOS arm64 with
`make NO_SENTRY=1 wmdlt -j8`. Its `wmdlt` executable is an external prerequisite;
the Visualizer repository does not bundle it. With a locally owned RomFS:

```sh
bun tools/convert-stage-map.ts \
  /path/to/romfs/Model/Fld_Shakedent00.bfres.zs \
  /path/to/nintoolbox/project/bin/wmdlt
```

The tool refuses a source whose SHA-256 differs from the 11.3.0 asset above,
checks that the output path is ignored by Git, and writes the GLB and a manifest
only after conversion succeeds. The source converter emits `TANGENT` as VEC3
and some `COLOR_0` values outside the glTF color range. For this geometry-only
preview, the tool removes those two display attributes while preserving the
binary geometry chunk byte for byte. The converted file has material entries
but no images or textures, so a neutral viewer material is appropriate.

The tested GLB had 133 meshes, 282,549 vertices, and 94,183 triangles. Its
full bounds are X `[-881.54, 827.09]`, Y `[-23.37, 251.52]`, and Z
`[-587.79, 858.55]`; distant background geometry contributes to that range.
All mesh nodes have no local transform. The nearest vertices to the Cmn bank
`(2.5, 9, 40)`, Low bank `(0, 1.5, -24)`, and first `StartPos` `(6, 7.5, 45.5)`
are 6.46, 1.87, and 2.75 game coordinate units away. This supports placing
markers and mesh in the same XYZ frame, but a nearest vertex is not a surface
intersection or proof of exact alignment. The scale in meters and camera
heading convention still need verification.

The repaired local GLB was checked with Khronos `gltf-validator` 2.0.0-dev.3.10:
0 errors and 0 warnings. Informational findings are unused source accessors,
missing optional bufferView targets, and one empty node. The exact source,
converter, output hashes, geometry counts, bounds, and nearest marker vertices
are recorded in the ignored `local/cop-shakedent.manifest.json`.

## Enemy-related static anchors

`cop-shakedent-enemy-anchors.json` contains 76 additional positions from the same
owned 11.3.0 scene pack's `Banc/Cop_Shakedent.bcett.byml` entry (entry SHA-256
`bcdeb6a54428b1a72ae7dbc79168e5927c06e9ee1babedf1d415081b0598f4b8`).
It is a derived coordinate index; the source scene and actor packs are not
redistributed. The JSON retains Banc `Actors` indices and hashes, source layers,
exact float32 position bits, and raw rotation when present. Its `position` values
are rounded to six decimal places for display. Compare the current file hash
directly when checking it against a source extraction.

| `kind` | Source `Gyaml` | High / Mid / Low | Meaning |
| --- | --- | --- | --- |
| `geyser` | `CoopSpawnGeyser` | 4 / 4 / 0 | Fixed Geyser objects used as event source candidates; opening, selection, and any resulting enemy location depend on runtime state. |
| `towerArrival` | `CoopArrivalPointEnemyTower0/1/2` | 9 / 9 / 9 | Tower arrival candidates; the selected arrival is not necessarily its spawn position. |
| `artilleryGun` | `CoopSakeArtilleryGunPoint0/1/2` | 0 / 3 / 3 | Artillery gun placement candidates, not confirmed Big Shot enemy spawn positions. |
| `jumpRoute` | `CoopSakerocketJumpPoint` | 5 / 11 / 19 | Sakerocket jump route nodes, not Flyfish spawn positions. |

The `directionGroup` field preserves the `0/1/2` suffix of Tower and Artillery
actor names; it does not assign a compass bearing. For `jumpRoute`,
`linkedActorIndices` resolves each source `JumpPoints` hash link to another
same-layer jump node. All 57 links resolve, but the links alone do not establish
movement direction, timing, or a live route. The raw `Layer` values do not state
which tide or event is active.

The existing `cop-shakedent-markers.json` already contains the 23
`CoopSpawnPointEnemy0/1/2` generic enemy candidate actors. Their coordinates
must not be relabelled as a specific boss species' spawn points. The scene Banc
contains no separately named Sakerocket spawn actor. Its jump nodes are route
data, while actual species selection, spawn request XYZ, and movement require
runtime packet/state evidence. The raw scene actors alone do not prove which
candidate or placement path was used in a particular WAVE.

## All owned Salmon Run stages

`stages.json` catalogs all 15 `Cop_*.pack.zs` Scene packs in the owned Splatoon 3
11.3.0 RomFS. Each entry records the exact compressed Scene pack, Banc entry,
field actor pack, and BFRES model paths and SHA-256 hashes, plus source actor
counts, the field actor's ModelInfo, and URLs for a fixed marker file, an
enemy-related anchor file, and a local-only GLB. The 15 scene IDs use 14 unique
Banc/model sets: `Cop_Tutorial` contains the same
`Banc/Cop_Shakespiral.bcett.byml` bytes as `Cop_Shakespiral` and uses its field
model. The catalog marks Tutorial with `aliasOf: Cop_Shakespiral` and points
both IDs to one local Shakespiral GLB. Tutorial is a scene ID in the owned
RomFS; the catalog does not claim it is a selectable rotation stage.

Every stage has `cop-<stage-name>-markers.json` and
`cop-<stage-name>-enemy-anchors.json`, preserving Banc actor order, index, hash,
raw layer, rounded XYZ, and exact float32 bits. The `markers` arrays contain
only actors with an explicit Banc `Translate`; `positionlessActors` records
omissions. Specifically, `Cop_Manbou00` actor 443 is a Low
`CoopWaterLevelLocator` without `Translate`, so neither its marker position nor
its `waterLevelLocators.Low.y` is inferred. The omission might mean an engine
default, but that interpretation is unverified. The catalog records `null`
and the actor under `positionlessActors`. Generic enemy candidates are in the
marker files. Enemy-related anchor files contain Geyser objects, Tower arrival
candidates, Artillery gun positions, and Sakerocket jump-route nodes. No
species-specific spawn XYZ is inferred from these static actor bases.

### Tide layer evidence and limits

The owned 11.3.0 game's `Layer` parser maps `Low` to 0, `Mid` to 1, and `High`
to 2 (`0x34f6210..0x34f6220`). Its ordinary enemy point builder groups
`CoopSpawnPointEnemy0/1/2` by `3 * direction + layer`, and the spawn request
uses `tide + 3 * direction` with the scene's selected tide. Thus those Banc
layer names correspond to low, normal, and high tide candidate groups in this
version. `Cmn` identifies common actors rather than one of the three tide
groups. Geyser source actors have a separate `layer >= tide` admission rule;
they must not be filtered by exact equality as ordinary enemy points are.

As an independent asset check, each of the 15 Scene packs contains Low, Mid,
and High `CoopWaterLevelLocator` actors. In the 14 packs where all three have
explicit Y coordinates, `High.y > Mid.y > Low.y`. The Manbou Low locator has
no `Translate`. These are source locators, not a measured live water surface.
The current WAVE's tide and event still require runtime data; the catalog
does not guess either one. `tideLayerEvidence` describes the static mapping;
`waterLevelLocators` are fixed reference heights, not measured live water.
Source code trace details are recorded in the owned
NXCTF `docs/security/2026-10-25-s3-salmon-scenario-rng-audit.md` and
`tools/ocean-calc/src/stage_data.rs`.

### Local terrain previews

All 14 distinct field BFRES models have local GLB previews under the ignored
`app/public/maps/local/` directory. The catalog's `modelUrl` is a potential
local path, not proof that the asset is installed. Its `modelAssetPolicy` is
`local_optional`; a clean clone receives 404 and the map shows its coordinate
grid. The Tutorial URL intentionally uses the Shakespiral filename. The Vite
build excludes `local/` from `app/dist`, and the
loopback Hono server serves the ignored source files for local viewing. The
original BFRES, converted geometry, and local manifests must not be published.

The previews were decoded with `quatric/nintoolbox` `wmdlt` commit
`01bb2ff5c19bf8abe7ad7ca15b0ea5fbc20a06d2`. Invalid converter-generated
`TANGENT` and `COLOR_0` display attributes were removed while retaining each
GLB's geometry BIN chunk. The `Cop_Shakehighway` output additionally required
omitting one converter animation with invalid quaternion samples and replacing
six zero-scale joint matrices with translation-only transforms. Both skinned
meshes' positively weighted vertices use only root joint 0, so those six joints
do not influence the static geometry; animation and any resulting movement are
absent from that preview. Local manifests record this repair, source and output
hashes, geometry counts, bounds, and converter version. All 14 preview GLBs
passed Khronos `gltf-validator` 2.0.0-dev.3.10 with 0 errors and 0 warnings.
The models contain no image textures; a neutral display material is appropriate.
Carousel, Shakehighway, and Shakerail contain nonidentity glTF node transforms,
which a GLB loader must apply. Marker-to-surface alignment and game units have
not been verified stage by stage.
