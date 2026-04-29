# map2gltf

Quake `.map` → glTF 2.0 Binary (`.glb`) compiler written in TypeScript.

Reads Standard and Valve 220 format `.map` files (as exported by TrenchBroom) and produces optimised `.glb` files ready for GPU frustum culling.

## Features

- **Full CSG** — inter-brush clipping removes hidden faces between worldspawn brushes
- **Valve 220 UV mapping** — texture coordinates derived from per-face texture axes (Standard format auto-derives axes)
- **Material batching** — triangles grouped by texture, then merged into indexed draw-call ranges
- **Spatial clustering** — geometry split into clusters of 8–512 triangles via a uniform spatial grid
- **BVH acceleration** — SAH-built bounding volume hierarchy over clusters for fast CPU frustum culling
- **Coordinate conversion** — Quake Z-up → glTF Y-up (−90° rotation around X)

## Pipeline

```
.map parse → brush→polygons → world CSG → triangulation → material merge → clustering → BVH → GLB
```

Each step is a pure function with no shared mutable state. Only `@gltf-transform/core` is a runtime dependency; all math and CSG are implemented from scratch.

## Installation

```bash
npm install map2gltf
```

Requires Node.js ≥ 18.

## Library Usage

```typescript
import { compile, compileWithDiagnostics } from 'map2gltf';

// Simple
const glb = await compile(mapSource);

// With diagnostics and options
const { glb, diagnostics } = await compileWithDiagnostics(mapSource, {
    defaultTextureSize: 128,
    textureSizes: new Map([['brick_wall', [256, 256]]]),
});

for (const w of diagnostics.warnings) {
    console.warn(`[${w.step}] ${w.message}`);
}
```

## CLI Usage

```bash
# Basic conversion
npx map2gltf input.map

# Specify output file
npx map2gltf input.map -o output.glb

# Verbose mode (prints diagnostics)
npx map2gltf input.map -v

# Override fallback UV dimensions for unresolved textures
npx map2gltf input.map --default-texture-size 128

# Tune clustering and BVH generation
npx map2gltf input.map --grid-cell-size 32 --max-cluster-size 256 --min-cluster-size 16 --bvh-leaf-threshold 8

# Skip worldspawn clustering
npx map2gltf input.map --no-clustering
```

Supported CLI options:

| Flag | Description |
|------|-------------|
| `-o`, `--output <file>` | Write the output GLB to an explicit path |
| `--default-texture-size <n>` | Use `<n>x<n>` as the UV fallback size when a texture is missing from `textureSizes` |
| `--grid-cell-size <n>` | Override the worldspawn clustering grid cell size |
| `--max-cluster-size <n>` | Override the maximum worldspawn cluster size |
| `--min-cluster-size <n>` | Override the minimum worldspawn cluster size |
| `--bvh-leaf-threshold <n>` | Override the BVH leaf cutoff |
| `--no-clustering` | Disable worldspawn spatial clustering |
| `-v`, `--verbose` | Print compiler warnings and errors to stderr |
| `-h`, `--help` | Show CLI usage |

CLI contract:

- Exactly one positional input file is accepted.
- Unknown options are rejected.
- Options that require values fail fast when the value is missing or not a positive integer.
- `--default-texture-size` changes fallback UV normalization only; it does not load texture metadata from disk.

## Web Application

A browser-based converter with drag-and-drop, 3D preview (three.js), BVH tree viewer, cluster highlighting, and metadata panel:

```bash
npm run dev:web      # development server
npm run build:web    # production build
```

## glTF Output Structure

The output is a standard glTF 2.0 Binary file. Any compliant viewer (Blender, VS Code glTF Tools, three.js) can open it. The BVH and cluster metadata are stored in the `extras` fields described below.

### Node Hierarchy (BVH)

The glTF node tree **is** the BVH. Each `BVHNode` becomes a glTF node with its AABB and type stored in `extras`:

**Interior node:**

```json
{
    "name": "bvh_0",
    "children": [1, 2],
    "extras": {
        "nodeType": "interior",
        "aabb": { "min": [-128, 0, -128], "max": [128, 64, 128] }
    }
}
```

**Leaf node:**

```json
{
    "name": "bvh_leaf_5",
    "mesh": 2,
    "extras": {
        "nodeType": "leaf",
        "aabb": { "min": [0, 0, 0], "max": [16, 8, 16] }
    }
}
```

| `extras` field | Type | Description |
|----------------|------|-------------|
| `nodeType` | `"interior"` \| `"leaf"` | Whether the node has children or references geometry |
| `aabb.min` | `[x, y, z]` | Minimum corner of the axis-aligned bounding box (Y-up) |
| `aabb.max` | `[x, y, z]` | Maximum corner of the axis-aligned bounding box (Y-up) |

Leaf nodes reference a glTF mesh whose primitives contain the cluster geometry. Interior nodes have only `children`.

### Meshes & Primitives

Each leaf mesh has **one primitive per cluster**. Every primitive provides:

| Attribute | Accessor type | Description |
|-----------|---------------|-------------|
| `POSITION` | `VEC3` / `FLOAT` | Vertex positions (Y-up) |
| `NORMAL` | `VEC3` / `FLOAT` | Face normals (flat shading) |
| `TEXCOORD_0` | `VEC2` / `FLOAT` | Texture coordinates |
| `indices` | `SCALAR` / `UNSIGNED_INT` | Triangle index buffer |

### Materials

Each unique texture name from the `.map` file becomes a glTF material with `metallicFactor: 0` and `roughnessFactor: 1`. The material `name` is the texture lookup key — resolve actual texture images at load time.

### Runtime Loading

To reconstruct the BVH at runtime:

1. Walk the glTF node tree depth-first.
2. Read `extras.nodeType` and `extras.aabb` from each node.
3. Build a flat `BVHNode[]` array for frustum culling.
4. Map each leaf's mesh primitives to draw call parameters (`firstIndex`, `indexCount`, `material`).

## Development

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # coverage report
npm run typecheck     # type check without emitting
npm run lint          # eslint
npm run build         # tsc production build
```

## License

MIT
