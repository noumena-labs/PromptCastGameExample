# VFX Textures

Procedural textures consumed by three.quarks particle systems.
Generate them with the dev tool at `/dev/vfx-textures` (Next.js dev server),
then save the PNGs into this directory.

## Expected files

| Filename                  | Size       | Use                                                          |
| ------------------------- | ---------- | ------------------------------------------------------------ |
| `smoke_puff_soft.png`     | 256×256    | Soft smoke puff sprite (smoke_plume_dark, smoke_plume_dust). |
| `smoke_noise_tile.png`    | 256×256    | Tileable fbm for distortion / detail UVs.                    |
| `ember_dot.png`           | 64×64      | Hot ember radial dot (additive).                             |
| `spark_streak.png`        | 128×32     | Velocity-aligned spark streak.                               |
| `fire_flipbook_4x4.png`   | 1024×1024  | 16-frame flame flipbook (fire_core).                         |
| `dust_puff.png`           | 256×256    | Lighter dust puff (earth alignment, ground impacts).         |
| `debris_chunk_albedo.png` | 256×256    | Rocky albedo/noise tile for debris_chunks mesh particles.    |
| `crack_glow.png`          | 512×512    | Branching crack glow decal (ground_eruption hotspots).       |

## Workflow

1. `npm run dev`
2. Open `http://localhost:3000/dev/vfx-textures`
3. Tweak per-texture seeds, click **Download All** (or per-card **Download**).
4. Move the resulting PNGs into this directory.
5. Optionally save `vfx-textures.manifest.json` here as a record of seeds used.

If a PNG is missing at runtime, the loader falls back to a 2×2 white texture
so the scene still renders (without the intended look).
