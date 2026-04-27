# Step 4 — Triangulation & UV Generation

[← Back to main spec](../spec.md)

---

## Overview

Convert all surviving convex polygons into triangles and compute per-vertex attributes (position, normal, texture UVs).

> **Precondition:** Polygons with `textureName === 'clip'` are excluded by the compiler before this step. Only visible geometry reaches triangulation.

**Input:** `ConvexPolygon[]` (from [Step 3](03-world-csg.md)), `textureSizes: Map<string, [number, number]>` (from `CompileOptions`)
**Output:** `TriangulatedMesh` (vertices, triangle indices, per-triangle material names)

---

## Triangulation

All convex polygons are triangulated using **fan decomposition** from vertex 0:

For a polygon with vertices {v₀, v₁, …, vₙ₋₁}, emit triangles: (v₀, vᵢ, vᵢ₊₁) for i ∈ [1, n−2].

Fan decomposition is correct here because all input polygons are convex (guaranteed by the Sutherland-Hodgman clipping in Steps 2–3). Non-convex polygons cannot arise from this pipeline.

---

## Vertex Format

```typescript
interface Vertex {
    position: Vec3;   // world space
    normal: Vec3;     // face normal (flat shading)
    uv: Vec2;         // base material texture coordinates
}
```

---

## Normal Generation

All normals are **flat** (one normal per face, shared by all vertices of that face). The normal is the face plane normal from the originating `ParsedFace`. This matches the planar brush geometry and avoids ambiguous smooth-shading decisions on hard architectural edges.

---

## Texture UV Generation

For each vertex at world position **p** on a face with `ParsedFace` data, texture coordinates are computed using the Valve 220 axes stored in the face definition:

```
u = ( dot(p, face.texAxisU) + face.texOffsetU ) / face.texScaleU / textureWidth
v = ( dot(p, face.texAxisV) + face.texOffsetV ) / face.texScaleV / textureHeight
```

`textureWidth` and `textureHeight` are the pixel dimensions of the texture identified by `face.textureName`, resolved from a material database at compile time. If the texture cannot be resolved, a default size of 64×64 is used and a warning is emitted.

---

## Output Data Structure

```typescript
interface TriangulatedMesh {
    vertices: Vertex[];              // all vertices across all triangulated polygons
    indices: number[];               // triangle indices into vertices[] (length is multiple of 3)
    triangleMaterials: string[];     // texture name per triangle (length = indices.length / 3)
    triangleEntityIndices: number[]; // entity index per triangle (0 = worldspawn)
    triangleBrushIndices: number[];  // global brush index per triangle
}
```

Each group of 3 consecutive indices defines one triangle. `triangleMaterials[i]` is the texture name for the triangle defined by `indices[i*3]`, `indices[i*3+1]`, `indices[i*3+2]`. The `triangleEntityIndices` and `triangleBrushIndices` arrays propagate provenance from the source `ConvexPolygon` for use by the clustering step. The total triangle count is `indices.length / 3`.

---

## Verification

### Unit Tests

1. **Quad triangulation:** Triangulate a single 4-vertex convex polygon. Assert exactly 2 triangles (6 indices) are emitted, and every index is in range [0, 3].
2. **Triangle pass-through:** Triangulate a 3-vertex polygon. Assert exactly 1 triangle (3 indices) is emitted, with vertices unchanged.
3. **N-gon fan correctness:** Triangulate a regular hexagon (6 vertices). Assert 4 triangles are emitted. Verify the total triangle area equals the polygon area (analytically known for a regular hexagon).
4. **Normal assignment:** For each emitted triangle, assert all 3 vertices share the same normal, and that normal equals `face.normal` of the source polygon.
5. **UV computation — axis-aligned face:** For a face on the XY plane with identity texture axes (U = X, V = Y), scale = 1, offset = 0, and a 64×64 texture: a vertex at (32, 32, 0) should produce UV = (0.5, 0.5). Assert within ε.
6. **UV computation — rotated axes:** For a face with 45° rotated Valve 220 axes, compute expected UVs by hand and assert they match within ε.
7. **Default texture fallback:** Provide a polygon with an unresolvable texture name. Assert a warning is emitted and UVs are computed using the 64×64 default size.
8. **Index validity:** Assert every index in `indices[]` is in range [0, vertices.length − 1].

### Integration Smoke Test

Triangulate all polygons from the box brush in `tests/fixtures/box.map` (6 quads → 12 triangles). Assert 12 triangles total. Recompute each triangle's face normal from vertex positions and assert it matches the stored `normal` attribute.

Triangulate all polygons from the wedge brush in `tests/fixtures/wedge.map` (2 triangles + 3 quads → 2 + 6 = 8 triangles). Assert 8 triangles total. Verify that the triangular face polygons produce exactly 1 triangle each (no degenerate fan edges) and the quad face polygons produce exactly 2 triangles each.

Run Steps 1–4 on `tests/fixtures/textured-room.map` (3+ distinct textures). Assert that every triangle's UV coordinates are finite and that at least 3 distinct `triangleMaterials` entries are present.
---

## Implementation

### Exported Function

```typescript
// pipeline/04-triangulation.ts
export function triangulate(
    polygons: ConvexPolygon[],
    textureSizes: Map<string, [number, number]>,
    diagnostics?: Diagnostics
): TriangulatedMesh
```

> **Implementation note:** The `diagnostics` parameter is optional. When provided, a warning is emitted for each unresolved texture name (falling back to the hardcoded 64×64 default).

### Algorithm

```typescript
function triangulate(
    polygons: ConvexPolygon[],
    textureSizes: Map<string, [number, number]>
): TriangulatedMesh {
    const vertices: Vertex[] = [];
    const indices: number[] = [];
    const triangleMaterials: string[] = [];

    const defaultSize: [number, number] = [64, 64];

    for (const poly of polygons) {
        const face = poly.face;
        const [texW, texH] = textureSizes.get(face.textureName.toLowerCase()) ?? defaultSize;
        // Emit a warning via diagnostics if texture not found

        const baseIndex = vertices.length;

        // Create vertices with UV
        for (const p of poly.vertices) {
            const u = (dot(p, face.texAxisU) + face.texOffsetU) / face.texScaleU / texW;
            const v = (dot(p, face.texAxisV) + face.texOffsetV) / face.texScaleV / texH;
            vertices.push({
                position: p,
                normal: face.normal,
                uv: { x: u, y: v }
            });
        }

        // Fan triangulation from vertex 0
        for (let i = 1; i < poly.vertices.length - 1; i++) {
            indices.push(baseIndex, baseIndex + i, baseIndex + i + 1);
            triangleMaterials.push(face.textureName);
        }
    }

    return { vertices, indices, triangleMaterials };
}
```

### Texture Size Resolution

The `textureSizes` map is provided by the caller (via `CompileOptions`). Keys are lowercase texture names. If a texture name is not found, the default size of 64×64 is used and a diagnostic warning is emitted. Scale values of 0 are treated as 1 (see Step 1 clamping).