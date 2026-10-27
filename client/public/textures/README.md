# Arena PBR textures

Free CC0 SD texture sets from https://3dtextures.me, converted by
`scripts/build-textures.mjs` in the sibling 3d-portfolio-website repo.

Format per set (1024x1024, WebP):
- `color.webp`  sRGB albedo
- `normal.webp` tangent-space normal (OpenGL convention)
- `orm.webp`   linear data: R = ambient occlusion, G = roughness, B = metalness

Sets shipped: `stone-floor` (arena floor), `wall-stone` (boundary wall),
`stone-column` (torch pillars), `marble-white` (platforms, ramps, cover walls).
Loaded at runtime by `src/utils/pbrMaterial.ts`.
