# Step 6 — Spatial Cluster Generation

[← Back to main spec](../spec.md)

---

## Overview

Group triangles within each material batch into spatially coherent clusters that serve as the fundamental culling and draw-call unit.

**Input:** `MaterialBatch[]` (from [Step 5](05-material-merge.md))
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

> **Implementation note:** The original design used index ranges (`firstIndex`, `indexCount`) into a shared material batch buffer. The implementation instead stores **independent, compacted vertex and index buffers per cluster**. This simplifies the GLB exporter — each cluster can be written as an independent glTF primitive without computing offsets into a shared buffer. The `triangleIndices` field records which source triangles belong to this cluster (for debugging and traceability).

---

## Algorithm

### 1. Spatial Grid Binning

Clustering uses a uniform 3D grid over the map's world-space AABB:

1. Compute the global AABB of all geometry.
2. Subdivide into a grid with cell size of **16 world units** per axis.
3. Assign each triangle to the grid cell containing its centroid (average of its three vertex positions).
4. Each non-empty (materialID, cellCoord) pair becomes a candidate cluster.

### 2. Cluster Size Limits

If a candidate cluster exceeds **512 triangles**, split it by recursive bisection along the longest axis of its AABB (sort triangles by centroid along that axis, split at the median). Repeat until all clusters contain ≤ 512 triangles.

Clusters with fewer than **24 triangles** are merged into the nearest neighboring cluster of the same material (nearest by AABB centroid distance), provided the merged result does not exceed 512 triangles.

### 3. Index Reordering

Within each cluster, triangle indices are reordered to maximize vertex cache utilization using the **Forsyth algorithm** (linear-speed vertex cache optimization). This improves post-transform vertex cache hit rates during rendering.

> **Implementation note:** Forsyth vertex cache optimization **is implemented** in the current version. Triangle indices within each cluster are reordered using the Forsyth algorithm with a 32-entry simulated vertex cache.

> **Implementation note — configurable constants:** The grid cell size (16), max cluster size (512), and min cluster size (24) are defaults in the implementation and can be overridden via `ClusterOptions` passed to `clusterGeometry()`. The compiler forwards `CompileOptions.gridCellSize`, `maxClusterSize`, and `minClusterSize` to the clustering step.

---

## Verification

### Unit Tests

1. **Single-cell cluster:** Provide a `MaterialBatch` whose triangles all fall within one 16-unit grid cell. Assert exactly 1 cluster is emitted containing all triangles.
2. **Multi-cell splitting:** Provide triangles spanning 3 distinct grid cells with the same material. Assert 3 clusters are emitted, one per cell.
3. **Max size enforcement:** Fill a single grid cell with 600 triangles (above the 512 limit). Assert the cell is recursively bisected into 2 clusters, each ≤ 512 triangles.
4. **Min size merging:** Create clusters below 24 triangles. Assert they are merged into the nearest neighbor, resulting in fewer clusters, each ≥ 24 triangles (or a single cluster if total ≤ 512).
5. **AABB correctness:** For each emitted cluster, compute the AABB from vertex positions. Assert it matches `cluster.bounds` within ε.
6. **Index range validity:** For each cluster, assert all indices in `cluster.indices` are within range [0, `cluster.vertices.length − 1`].
7. **Material preservation:** Assert every cluster's `materialID` matches the source `MaterialBatch.materialID` it was derived from.

### Integration Smoke Test

Run Steps 1–6 on `tests/fixtures/large-map.map` (50+ brushes). Assert: (a) every cluster has between 8 and 512 triangles (inclusive), (b) the sum of all cluster triangle counts across all clusters equals the total triangle count from Step 5, and (c) cluster AABBs do not extend beyond the global map AABB.

---

## Implementation

### Exported Function

```typescript
// pipeline/06-clustering.ts
export function clusterGeometry(batches: MaterialBatch[]): Cluster[]
```

### Algorithm

```typescript
function clusterGeometry(batches: MaterialBatch[]): Cluster[] {
    const allClusters: Cluster[] = [];

    for (const batch of batches) {
        // 1. Compute global AABB of this batch
        const globalAABB = computeAABB(batch.vertices);

        // 2. Assign each triangle to a grid cell
        const cellMap = new Map<string, number[]>(); // cellKey → triangle indices
        for (let tri = 0; tri < batch.indices.length / 3; tri++) {
            const centroid = triangleCentroid(batch, tri);
            const cellKey = getCellKey(centroid, GRID_CELL_SIZE);
            let list = cellMap.get(cellKey);
            if (!list) { list = []; cellMap.set(cellKey, list); }
            list.push(tri);
        }

        // 3. Build candidate clusters per cell
        for (const [, triangles] of cellMap) {
            const candidates = enforceMaxSize(triangles, batch, MAX_CLUSTER_SIZE);
            allClusters.push(...candidates.map(tris =>
                buildCluster(tris, batch)
            ));
        }
    }

    // 4. Merge undersized clusters
    return mergeUndersized(allClusters, MIN_CLUSTER_SIZE, MAX_CLUSTER_SIZE);
}
```

### Grid Cell Key

```typescript
function getCellKey(centroid: Vec3, cellSize: number): string {
    const cx = Math.floor(centroid.x / cellSize);
    const cy = Math.floor(centroid.y / cellSize);
    const cz = Math.floor(centroid.z / cellSize);
    return `${cx},${cy},${cz}`;
}
```

### Max Size Enforcement (Recursive Bisection)

If a candidate cluster exceeds `MAX_CLUSTER_SIZE`:
1. Compute the cluster AABB.
2. Find the longest axis.
3. Sort triangle indices by centroid along that axis.
4. Split at the median into two halves.
5. Recurse on each half until all clusters ≤ `MAX_CLUSTER_SIZE`.

### Min Size Merging

For each cluster with `triangleCount < MIN_CLUSTER_SIZE`:
1. Find the nearest cluster of the **same material** by AABB centroid Euclidean distance.
2. If merging would not exceed `MAX_CLUSTER_SIZE`, merge (concatenate triangle lists, recompute AABB).
3. If no valid merge target exists, keep the undersized cluster as-is.

> **Implementation note:** Min-size merging is applied iteratively (loop until convergence) to handle cascading merges where a merge creates a new undersized cluster.
