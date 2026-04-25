# Step 5 — Material Merge

[← Back to main spec](../spec.md)

---

## Overview

Group all triangles by material and build deduplicated per-material vertex and index buffers.

**Input:** `TriangulatedMesh` (from [Step 4](04-triangulation.md))
**Output:** `MaterialBatch[]`

---

## Grouping

After triangulation, all triangles are grouped by texture name using the `triangleMaterials` array from `TriangulatedMesh`. Each unique texture name is assigned a **materialID** based on **sorted insertion order**: collect all unique texture names, sort them lexicographically, and assign IDs 0, 1, 2, … in that order. This ensures deterministic, reproducible output regardless of triangle processing order.

Per material, a single contiguous vertex buffer and index buffer are built.

```typescript
interface MaterialBatch {
    materialID: number;
    textureName: string;           // the texture name this batch corresponds to
    vertices: Vertex[];            // all vertices for this material
    indices: number[];             // triangle indices into vertices[]
    triangleEntityIndices: number[]; // entity index per triangle (propagated from TriangulatedMesh)
    triangleBrushIndices: number[];  // brush index per triangle (propagated from TriangulatedMesh)
}
```

> **Implementation note:** The `textureName` field is stored alongside `materialID` so that the GLB exporter (Step 8) can create named glTF materials without reverse-mapping IDs to names. The `triangleEntityIndices` and `triangleBrushIndices` arrays are propagated from `TriangulatedMesh` for use by the clustering step (Step 6).

---

## Vertex Deduplication

Vertex deduplication is applied within each material batch: vertices with identical position, normal, and uv (within ε per component) share a single index.

Use a `Map` keyed on quantized vertex attributes (snap each component to a 1e-4 grid) for O(1) average-case dedup. The quantized key is used only for bucketing; the original vertex values are stored in the output buffer.

---

## Verification

### Unit Tests

1. **Single-material grouping:** Provide triangles all using the same texture. Assert output is a single `MaterialBatch` containing all triangles.
2. **Multi-material grouping:** Provide triangles using 3 different textures. Assert output is 3 `MaterialBatch` entries, one per material, and that triangle counts sum to the input total.
3. **Vertex deduplication — shared vertices:** Provide two adjacent triangles sharing an edge (2 shared vertices). Assert the output batch has 4 unique vertices (not 6) and indices reference the shared vertices correctly.
4. **Dedup tolerance boundary:** Provide two vertices differing by exactly 1e-4 in one component. Assert they are merged. Provide two vertices differing by 1.1e-4. Assert they remain separate.
5. **Index correctness:** For every `MaterialBatch`, iterate all indices and assert each is in range [0, vertices.length − 1]. Rebuild triangles from indices and assert positions match expected values.
6. **Material ID consistency:** Assert each batch's `materialID` maps to a known texture name and that no two batches share the same `materialID`.

### Integration Smoke Test

Run Steps 1–5 on `tests/fixtures/hollow-room.map` (6 brushes forming a hollow room, 2 different textures — e.g. floor and walls). Assert the output contains exactly 2 material batches. Verify that the total triangle count across both batches matches the expected count from Step 4.

Run Steps 1–5 on `tests/fixtures/textured-room.map` (3+ distinct textures). Assert the output contains at least 3 material batches — one per unique texture. Verify that each batch's `materialID` is unique and triangle counts sum to the total from Step 4.

---

## Implementation

### Exported Function

```typescript
// pipeline/05-material-merge.ts
export function mergeMaterials(mesh: TriangulatedMesh): MaterialBatch[]
```

### Algorithm

```typescript
function mergeMaterials(mesh: TriangulatedMesh): MaterialBatch[] {
    const { vertices, indices, triangleMaterials } = mesh;

    // 1. Collect unique texture names and assign sorted IDs
    const uniqueNames = [...new Set(triangleMaterials)].sort();
    const nameToID = new Map(uniqueNames.map((name, i) => [name, i]));

    // 2. Bucket triangles by material
    const buckets = new Map<number, { srcIndices: number[] }>();
    for (let tri = 0; tri < triangleMaterials.length; tri++) {
        const matID = nameToID.get(triangleMaterials[tri]!)!;
        let bucket = buckets.get(matID);
        if (!bucket) { bucket = { srcIndices: [] }; buckets.set(matID, bucket); }
        bucket.srcIndices.push(
            indices[tri * 3]!, indices[tri * 3 + 1]!, indices[tri * 3 + 2]!
        );
    }

    // 3. Build deduplicated vertex/index buffers per material
    const result: MaterialBatch[] = [];
    for (const [matID, bucket] of buckets) {
        const batchVertices: Vertex[] = [];
        const batchIndices: number[] = [];
        const dedupMap = new Map<string, number>();  // quantized key → index

        for (const srcIdx of bucket.srcIndices) {
            const v = vertices[srcIdx]!;
            const key = quantizeVertex(v);  // snap to 1e-4 grid
            let idx = dedupMap.get(key);
            if (idx === undefined) {
                idx = batchVertices.length;
                batchVertices.push(v);
                dedupMap.set(key, idx);
            }
            batchIndices.push(idx);
        }

        result.push({ materialID: matID, vertices: batchVertices, indices: batchIndices });
    }

    return result.sort((a, b) => a.materialID - b.materialID);
}
```

### Vertex Quantization Key

Snap each float component to a 1e-4 grid via `Math.round(value * 10000)`. The key is a string concatenation of all quantized components:

```
`${qPx},${qPy},${qPz},${qNx},${qNy},${qNz},${qU},${qV}`
```

The quantized key is used only for bucketing; the original vertex values are stored in the output buffer.
