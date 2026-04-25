# Step 6 — Spatial Cluster Generation

[← Back to main spec](../spec.md)

---

## Overview

Group triangles within each material batch into spatially coherent clusters that serve as the fundamental culling and draw-call unit. Clustering is **entity-aware** and **brush-intact**:

- **Worldspawn** (entity index 0) brushes are spatially clustered using a uniform 3D grid, but a single brush is never split across clusters.
- **Non-worldspawn entities** (entity index ≥ 1) produce one cluster per entity per material batch — no spatial subdivision.

**Input:** `MaterialBatch[]` (from [Step 5](05-material-merge.md)), each batch carrying `triangleEntityIndices` and `triangleBrushIndices` metadata arrays.
**Output:** `Cluster[]`

---

## Cluster Structure

```typescript
interface Cluster {
    bounds: AABB;               // world-space axis-aligned bounding box
    materialID: number;
    triangleIndices: number[];  // indices of source triangles (for traceability)
    vertices: Vertex[];         // compacted vertex buffer for this cluster
    indices: number[];          // triangle indices into this cluster's vertex buffer
}
```

> **Implementation note:** Each cluster stores independent, compacted vertex and index buffers. This simplifies the GLB exporter — each cluster can be written as an independent glTF primitive without computing offsets into a shared buffer.

---

## Algorithm

### 1. Partition by Entity

For each material batch, triangles are partitioned into two groups using `triangleEntityIndices`:

- **Worldspawn triangles** (entityIndex === 0) → spatial grid clustering (below)
- **Entity triangles** (entityIndex ≥ 1) → one cluster per entity per batch

### 2. Worldspawn: Brush-Intact Spatial Grid Clustering

1. Group worldspawn triangles by `brushIndex` using `triangleBrushIndices`, forming **brush groups**. Each brush group tracks its triangle indices and centroid (average of all triangle centroids in the group).
2. Assign each brush group to a grid cell based on the brush group centroid. Cell size defaults to **16 world units**.
3. Each non-empty cell becomes a candidate cluster containing all brush groups assigned to it.

### 3. Cluster Size Limits (Worldspawn Only)

If a candidate cluster exceeds **512 triangles**, split it by recursive bisection of brush groups along the longest axis of its AABB (sort brush groups by centroid, split at the median). If a single brush group alone exceeds 512 triangles, it is kept intact and a diagnostic warning is emitted.

Clusters with fewer than **24 triangles** are merged into the nearest neighboring **worldspawn** cluster of the same material (nearest by centroid distance), provided the merged result does not exceed 512 triangles.

Min-size merging is **not** applied to entity clusters.

### 4. Entity Clusters

All triangles with the same non-zero entityIndex within a batch form a single cluster. No spatial subdivision or size merging is performed.

### 5. Index Reordering

Within each cluster, triangle indices are reordered using the **Forsyth algorithm** (linear-speed vertex cache optimization with a 32-entry simulated vertex cache).

> **Implementation note — configurable constants:** The grid cell size (16), max cluster size (512), and min cluster size (24) are defaults and can be overridden via `ClusterOptions` passed to `clusterGeometry()`.

---

## Verification

### Unit Tests

1. **Single-cell cluster:** Provide a `MaterialBatch` whose worldspawn triangles all fall within one 16-unit grid cell. Assert exactly 1 cluster.
2. **Multi-cell splitting:** Provide worldspawn triangles spanning 3 distinct grid cells. Assert 3 clusters.
3. **Max size enforcement:** Fill a single grid cell with >512 worldspawn triangles from multiple brushes. Assert bisection into ≤ 512-triangle clusters.
4. **Min size merging:** Create worldspawn clusters below 24 triangles. Assert they are merged into the nearest neighbor.
5. **AABB correctness:** For each cluster, assert computed AABB matches `cluster.bounds` within ε.
6. **Index range validity:** For each cluster, assert all indices are within `[0, cluster.vertices.length − 1]`.
7. **Material preservation:** Assert every cluster's `materialID` matches its source batch.
8. **Entity triangles → one cluster per entity:** Provide a batch with triangles from entity 1 and entity 2. Assert exactly 2 entity clusters, one per entity.
9. **Mixed batch:** A batch with both worldspawn and entity triangles. Assert worldspawn is spatially clustered and entity triangles produce separate clusters.
10. **Brush integrity:** No brush's triangles appear in more than one cluster.

### Integration Smoke Test

Run Steps 1–6 on `tests/fixtures/large-map.map` (50+ brushes). Assert: (a) every worldspawn cluster has between 8 and 512 triangles, (b) the sum of all cluster triangle counts equals the total from Step 5, and (c) cluster AABBs do not extend beyond the global map AABB.

---

## Implementation

### Exported Function

```typescript
// pipeline/06-clustering.ts
export function clusterGeometry(
    batches: MaterialBatch[],
    options?: Partial<ClusterOptions>,
    diagnostics?: Diagnostics
): Cluster[]
```

### Algorithm (pseudocode)

```
for each batch:
    partition triangles into worldspawn vs entity groups by triangleEntityIndices

    // Worldspawn: brush-intact spatial clustering
    brushGroups = groupTrianglesByBrush(worldspawnTriangles, triangleBrushIndices)
    cellMap = assign brushGroups to grid cells by centroid
    for each cell:
        candidate = all brush groups in cell
        if triangle count > MAX_CLUSTER_SIZE:
            split by recursive bisection of brush groups (not triangles)
        emit clusters

    // Entities: one cluster per entity
    for each unique entityIndex ≥ 1:
        emit one cluster with all triangles of that entity

    merge undersized worldspawn clusters into nearest same-material neighbor
```

### Min Size Merging

For each cluster with `triangleCount < MIN_CLUSTER_SIZE`:
1. Find the nearest cluster of the **same material** by AABB centroid Euclidean distance.
2. If merging would not exceed `MAX_CLUSTER_SIZE`, merge (concatenate triangle lists, recompute AABB).
3. If no valid merge target exists, keep the undersized cluster as-is.

> **Implementation note:** Min-size merging is applied iteratively (loop until convergence) to handle cascading merges where a merge creates a new undersized cluster.
