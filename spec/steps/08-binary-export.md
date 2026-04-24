# Step 8 — glTF/GLB Export

[← Back to main spec](../spec.md)

---

## Overview

Serialize all compiled data into a single **GLB** (glTF Binary) file. The BVH is encoded as the glTF node hierarchy, clusters map to mesh primitives, and vertex/index data is stored in the GLB binary chunk for direct GPU upload.

**Input:** All compiled data from Steps 5–7 (`MaterialBatch[]`, `Cluster[]`, `BVHNode[]`)
**Output:** `.glb` file (glTF 2.0 Binary)

---

## Why glTF

| Concern | glTF answer |
|---------|-------------|
| BVH storage | Node hierarchy with `children` arrays maps 1-to-1 to BVH tree structure |
| AABB metadata | `node.extras.aabb` stores `{ min: [x,y,z], max: [x,y,z] }` per node |
| Cluster geometry | Each cluster becomes a mesh primitive with its own material and index range |
| GPU-ready buffers | GLB binary chunk stores tightly packed vertex/index data (little-endian) |
| Debugging | Standard tools (Blender, VS Code glTF viewer, three.js) can inspect output |
| TypeScript ecosystem | Libraries like `@gltf-transform/core` simplify GLB construction |

**Trade-off:** The runtime reconstructs a flat BVH array from the node tree at load time. This is a one-time cost, not per-frame, and is minor compared to the interop and debugging benefits.

---

## Coordinate System

Quake uses **Z-up, right-handed**. glTF uses **Y-up, right-handed**. The exporter applies a coordinate conversion: rotate **-90° around X** on all vertex positions and normals before writing. This ensures the output renders correctly in any standard glTF viewer.

---

## BVH → Node Hierarchy

Each `BVHNode` from Step 7 becomes a glTF node. The tree structure is encoded via the `children` property.

### Interior Node

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

No `mesh` reference. The `children` array contains the indices of the left and right child nodes.

### Leaf Node

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

The `mesh` property references a glTF mesh whose primitives contain the leaf's cluster geometry.

---

## Clusters → Meshes & Primitives

Each BVH leaf node references **one glTF mesh**. That mesh contains **one primitive per cluster** in the leaf's cluster range. Each primitive has its own material and index range.

```mermaid
graph TD
    L["BVH Leaf Node (mesh: 2)"]
    M["Mesh 2"]
    P0["Primitive 0: material=brick, 48 indices"]
    P1["Primitive 1: material=stone, 36 indices"]

    L --> M
    M --> P0
    M --> P1
```

### Primitive Structure

Each primitive specifies:

| Property | Accessor type | Description |
|----------|---------------|-------------|
| `POSITION` | `VEC3` / `FLOAT` | Vertex positions (Y-up, after coordinate conversion) |
| `NORMAL` | `VEC3` / `FLOAT` | Face normals (flat shading) |
| `TEXCOORD_0` | `VEC2` / `FLOAT` | Valve 220 texture coordinates |
| `indices` | `SCALAR` / `UNSIGNED_INT` | Triangle index buffer |

`POSITION` accessors **must** define `min` and `max` per the glTF spec. These values double as the primitive-level AABB.

---

## Materials

Each unique texture name from the `.map` file becomes a glTF material:

```json
{
    "name": "brick_wall",
    "pbrMetallicRoughness": {
        "baseColorFactor": [1, 1, 1, 1],
        "metallicFactor": 0,
        "roughnessFactor": 1
    }
}
```

Materials are non-PBR placeholders. The renderer resolves texture names at load time; the glTF material `name` is the lookup key. If texture images are available at compile time, they may optionally be embedded as `baseColorTexture` in the GLB, but this is not required.

---

## Buffer Layout

All binary data is packed into a **single GLB buffer** (the BIN chunk). Buffer views are created for each data type:

| BufferView | Target | Contents |
|------------|--------|----------|
| 0 | `ARRAY_BUFFER` (34962) | All vertex positions (tightly packed `VEC3` floats) |
| 1 | `ARRAY_BUFFER` (34962) | All vertex normals (tightly packed `VEC3` floats) |
| 2 | `ARRAY_BUFFER` (34962) | All texture coordinates (tightly packed `VEC2` floats) |
| 3 | `ELEMENT_ARRAY_BUFFER` (34963) | All triangle indices (`UNSIGNED_INT`) |

Vertex attributes are stored in **separate buffer views** (non-interleaved / struct-of-arrays layout). This matches the pipeline output from Steps 5–6 and allows the renderer to bind each attribute buffer independently.

All data is **little-endian** and **4-byte aligned** per the glTF spec. The GLB binary chunk is padded with trailing zeros to 4-byte alignment.

---

## GLB File Structure

The output is a single `.glb` file following the glTF 2.0 Binary container spec:

```
┌──────────────────────────────┐
│ GLB Header (12 bytes)        │
│   magic: 0x46546C67 "glTF"  │
│   version: 2                 │
│   length: total file size    │
├──────────────────────────────┤
│ JSON Chunk                   │
│   scene, nodes, meshes,      │
│   materials, accessors,      │
│   bufferViews, buffer        │
├──────────────────────────────┤
│ BIN Chunk                    │
│   positions | normals |      │
│   texcoords | indices        │
└──────────────────────────────┘
```

---

## Scene Root

The glTF scene contains a **single root node** which is the BVH root. All other BVH nodes are descendants.

```json
{
    "scene": 0,
    "scenes": [{ "name": "map", "nodes": [0] }],
    "asset": {
        "version": "2.0",
        "generator": "map2gltf"
    }
}
```

> **Implementation note — generator field:** The code sets `generator = 'map2gltf'` on the document asset, but `@gltf-transform/core` overrides this with its own generator string (e.g. `"glTF-Transform v4.x.x"`) during `writeBinary()`. The output GLB will contain the library's generator string, not `"map2gltf"`.

> **Implementation note — default scene:** `@gltf-transform/core` does not persist the default scene index in the output. `getDefaultScene()` returns `null` when reading back the GLB, even though a scene exists. Consumers should use `getRoot().listScenes()[0]` instead.

---

## Runtime Loading

At load time, the renderer:

1. Parses the GLB and extracts the JSON chunk.
2. Uploads buffer views 0–3 directly to GPU vertex/index buffers (zero-copy where supported).
3. Walks the node tree, reading `extras.aabb` from each node to rebuild a flat depth-first `BVHNode[]` array for frustum culling.
4. Maps each mesh primitive's accessor offsets to draw call parameters (`firstIndex`, `indexCount`, `material`).

The node tree → flat array conversion is O(N) where N is the number of BVH nodes.

---

## Verification

### Unit Tests

1. **Valid GLB header:** Write a minimal GLB. Assert the first 12 bytes contain magic `0x46546C67`, version `2`, and correct total file length.
2. **JSON chunk validity:** Parse the JSON chunk from the output GLB. Assert it is valid JSON and contains required top-level properties: `asset`, `scene`, `scenes`, `nodes`, `meshes`, `accessors`, `bufferViews`, `buffers`.
3. **Asset metadata:** Assert `asset.version` is `"2.0"` and `asset.generator` is `"map2gltf"`.
4. **Coordinate conversion:** Export a vertex at Quake position (X, Y, Z). Read back from the GLB buffer and assert it matches the Y-up conversion: (X, Z, −Y).
5. **Node hierarchy matches BVH:** Rebuild the BVH tree from the glTF node hierarchy (`children` arrays). Assert it is isomorphic to the input `BVHNode[]` tree — same structure, same AABB values in `extras.aabb`.
6. **AABB extras round-trip:** For every node, read `extras.aabb.min` and `extras.aabb.max`. Assert they match the original `BVHNode.bounds` (after coordinate conversion) within ε.
7. **Primitive accessor ranges:** For every mesh primitive, assert: (a) `POSITION`, `NORMAL`, `TEXCOORD_0` accessors have matching element counts, (b) `indices` accessor count is a multiple of 3, and (c) all byte offsets + lengths fit within the BIN chunk size.
8. **POSITION min/max:** For every `POSITION` accessor, assert `min` and `max` are defined and correctly bound all vertex positions in that accessor.
9. **Material count:** Assert the number of glTF materials equals the number of unique texture names from the input.
10. **4-byte alignment:** Assert every `bufferView.byteOffset` is a multiple of 4, and the BIN chunk length is a multiple of 4.

### Integration Smoke Test

Run the full pipeline (Steps 1–8) on `tests/fixtures/two-rooms.map`. Load the output `.glb` in a third-party glTF validator (e.g. `gltf-validator` npm package). Assert zero errors. Optionally load in three.js or Blender and confirm geometry is visually correct and materials are named as expected.

---

## Implementation

### Exported Function

```typescript
// pipeline/08-binary-export.ts
import { Document, NodeIO } from '@gltf-transform/core';

export async function exportGLB(
    batches: MaterialBatch[],
    clusters: Cluster[],
    bvh: BVHNode[]
): Promise<Uint8Array>
```

> **Implementation note — async:** `exportGLB` is `async` and returns `Promise<Uint8Array>` because `@gltf-transform/core`'s `NodeIO.writeBinary()` returns a Promise. This propagates up to `compile()` and `compileWithDiagnostics()`, making them async as well.

> **Implementation note — AABB conversion:** When converting AABBs from Z-up to Y-up, the implementation converts all 8 corner points of the AABB and recomputes min/max, rather than simply swapping axes. This correctly handles the axis flip where min/max may swap.

### Algorithm

```typescript
function exportGLB(
    batches: MaterialBatch[],
    clusters: Cluster[],
    bvh: BVHNode[]
): Uint8Array {
    const doc = new Document();
    doc.getRoot().getAsset().generator = 'map2gltf';

    const scene = doc.createScene('map');
    const buf = doc.createBuffer();

    // 1. Create materials (one per batch, named by texture)
    const materials = batches.map(b =>
        doc.createMaterial(getTextureName(b.materialID))
            .setBaseColorFactor([1, 1, 1, 1])
            .setMetallicFactor(0)
            .setRoughnessFactor(1)
    );

    // 2. Build glTF meshes for each BVH leaf
    //    Each leaf's clusters become primitives of a single mesh
    const meshes = new Map<number, GltfMesh>(); // leafNodeIndex → mesh

    for (let ni = 0; ni < bvh.length; ni++) {
        const node = bvh[ni]!;
        if (node.left !== -1) continue; // interior node

        const mesh = doc.createMesh(`leaf_${ni}`);
        for (let ci = node.firstCluster; ci < node.firstCluster + node.clusterCount; ci++) {
            const cluster = clusters[ci]!;
            const batch = batches.find(b => b.materialID === cluster.materialID)!;

            // Extract cluster's vertex/index slice, apply coordinate conversion
            const prim = buildPrimitive(doc, buf, batch, cluster, materials);
            mesh.addPrimitive(prim);
        }
        meshes.set(ni, mesh);
    }

    // 3. Build node hierarchy (depth-first traversal of BVH)
    const gltfNodes: GltfNode[] = [];
    for (let ni = 0; ni < bvh.length; ni++) {
        const bvhNode = bvh[ni]!;
        const gNode = doc.createNode(bvhNode.left === -1 ? `bvh_leaf_${ni}` : `bvh_${ni}`);

        // Store AABB in extras (after coordinate conversion)
        gNode.setExtras({
            nodeType: bvhNode.left === -1 ? 'leaf' : 'interior',
            aabb: convertAABB(bvhNode.bounds)
        });

        if (bvhNode.left === -1) {
            gNode.setMesh(meshes.get(ni)!);
        }

        gltfNodes.push(gNode);
    }

    // 4. Wire up parent-child relationships
    for (let ni = 0; ni < bvh.length; ni++) {
        const bvhNode = bvh[ni]!;
        if (bvhNode.left !== -1) {
            gltfNodes[ni]!.addChild(gltfNodes[bvhNode.left]!);
            gltfNodes[ni]!.addChild(gltfNodes[bvhNode.right]!);
        }
    }

    // 5. Add root to scene
    scene.addChild(gltfNodes[0]!);

    // 6. Serialize to GLB
    const io = new NodeIO();
    return io.writeBinary(doc);
}
```

### Coordinate Conversion (Z-up → Y-up)

Rotate −90° around X on all positions and normals:

```typescript
function convertVec3(v: Vec3): [number, number, number] {
    return [v.x, v.z, -v.y];
}

function convertAABB(aabb: AABB): { min: number[], max: number[] } {
    // After rotation, min/max may swap on Y/Z
    const a = convertVec3(aabb.min);
    const b = convertVec3(aabb.max);
    return {
        min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
        max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]
    };
}
```

### Primitive Construction

For each cluster, extract the relevant slice of the batch's vertex and index buffers. Create typed arrays for positions, normals, UVs (as `Float32Array`), and indices (as `Uint32Array`). Apply coordinate conversion to positions and normals before writing. Use `@gltf-transform/core` accessor API to attach data to the buffer.

### Buffer View Layout

The library handles buffer view creation internally. The specification requires 4 conceptual buffer views (positions, normals, UVs, indices), but `@gltf-transform/core` manages byte offsets and alignment automatically. All data ends up in a single BIN chunk.
