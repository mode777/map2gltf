# Step 7 — BVH Construction

[← Back to main spec](../spec.md)

---

## Overview

Build a bounding volume hierarchy over clusters to provide a spatial acceleration structure for frustum culling.

> **Note:** When `skipClustering` is enabled, the cluster count equals the material count. For typical maps with ≤ 4 materials this falls at or below the BVH leaf threshold, producing a single leaf node wrapping all clusters.

**Input:** `Cluster[]` (from [Step 6](06-clustering.md))
**Output:** `BVHNode[]` (flat array, depth-first order)

---

## Node Structure

```typescript
interface BVHNode {
    bounds: AABB;
    left: number;          // index of left child, or -1 for leaf
    right: number;         // index of right child, or -1 for leaf
    firstCluster: number;  // valid only for leaf nodes
    clusterCount: number;  // valid only for leaf nodes
}
```

---

## Build Algorithm (SAH)

> **Implementation note:** `BVH_LEAF_THRESHOLD` (4) and `SAH_CANDIDATES` (12) are hardcoded constants in the implementation rather than read from `CompileOptions`.

The BVH is built top-down using the **Surface Area Heuristic**:

1. **Leaf threshold:** if the current set contains ≤ 4 clusters, create a leaf node.
2. **Split candidate evaluation:** for each of the 3 axes, evaluate *K* = 12 uniformly spaced split planes across the cluster centroids' extent on that axis.
3. **SAH cost:** for each candidate split, compute cost = SA(left) × count(left) + SA(right) × count(right), where SA is the surface area of the child AABB.
4. **Select** the split with the lowest cost across all 3 axes.
5. **Partition** clusters into left and right sets. Recurse.

If no split reduces cost below the leaf cost (SA(parent) × count), create a leaf regardless of count.

---

## Flattened Layout

The BVH is stored as a flat array in **depth-first order**. For an interior node at index *i*, the left child is at index *i* + 1, and the right child index is stored explicitly. This layout maximizes cache coherence during traversal, as left-child descent requires no indirection.

```typescript
const nodes: BVHNode[];      // flat array, depth-first order
const clusters: Cluster[];   // ordered so that each leaf's clusters are contiguous
```

---

## Verification

### Unit Tests

1. **Leaf-only tree:** Provide ≤ 4 clusters. Assert the BVH contains exactly 1 node, which is a leaf, and `clusterCount` equals the input count.
2. **Single split:** Provide 8 clusters. Assert the BVH has 3 nodes (1 root interior + 2 leaf children). Assert both leaf nodes' cluster ranges are disjoint and cover all 8 clusters.
3. **AABB containment:** For every interior node, assert its `bounds` fully contains the `bounds` of both children (i.e. `child.bounds.min ≥ parent.bounds.min` and `child.bounds.max ≤ parent.bounds.max` per component).
4. **Root AABB covers all clusters:** Assert the root node's `bounds` contains the AABB of every cluster.
5. **Depth-first layout:** Assert that for every interior node at index *i*, the left child is at index *i* + 1, and the right child index stored in `right` is a valid index > *i* + 1.
6. **Cluster coverage:** Collect all `(firstCluster, clusterCount)` ranges from leaf nodes. Assert they are non-overlapping and their union covers all input clusters exactly once.
7. **SAH cost validity:** After building, compute the total SAH cost and assert it is ≤ the cost of a single leaf containing all clusters (i.e. the tree actually improves or equals naive cost).
8. **Leaf threshold:** Assert no leaf node has `clusterCount` > 4 (the configured threshold), unless no beneficial split was found.

### Integration Smoke Test

Build a BVH from 100+ clusters (from `tests/fixtures/large-map.map`). Implement a brute-force frustum test (test every cluster) and a BVH-accelerated frustum test. For 10 random frustums, assert both methods return identical visible cluster sets. This validates that the BVH partitioning does not lose or duplicate clusters.

---

## Implementation

### Exported Function

```typescript
// pipeline/07-bvh-construction.ts
export function buildBVH(clusters: Cluster[]): BVHNode[]
```

### Algorithm (Top-Down SAH Build)

```typescript
function buildBVH(clusters: Cluster[]): BVHNode[] {
    const nodes: BVHNode[] = [];

    function build(clusterIndices: number[]): number {
        const nodeIndex = nodes.length;
        const bounds = mergeAABBs(clusterIndices.map(i => clusters[i]!.bounds));

        // Leaf case
        if (clusterIndices.length <= BVH_LEAF_THRESHOLD) {
            nodes.push({
                bounds,
                left: -1,
                right: -1,
                firstCluster: clusterIndices[0]!,
                clusterCount: clusterIndices.length
            });
            return nodeIndex;
        }

        // Find best split via SAH
        const { axis, splitPos } = findBestSplit(clusterIndices, clusters, bounds);

        // Partition
        const leftIndices: number[] = [];
        const rightIndices: number[] = [];
        for (const ci of clusterIndices) {
            const centroid = aabbCentroid(clusters[ci]!.bounds);
            if (centroidComponent(centroid, axis) < splitPos) {
                leftIndices.push(ci);
            } else {
                rightIndices.push(ci);
            }
        }

        // Fallback: if partition is degenerate, split at midpoint
        if (leftIndices.length === 0 || rightIndices.length === 0) {
            nodes.push({
                bounds,
                left: -1, right: -1,
                firstCluster: clusterIndices[0]!,
                clusterCount: clusterIndices.length
            });
            return nodeIndex;
        }

        // Reserve this node’s slot, then recurse
        nodes.push({ bounds, left: -1, right: -1, firstCluster: -1, clusterCount: 0 });
        const leftChild = build(leftIndices);    // always nodeIndex + 1
        const rightChild = build(rightIndices);
        nodes[nodeIndex]!.left = leftChild;
        nodes[nodeIndex]!.right = rightChild;

        return nodeIndex;
    }

    build([...Array(clusters.length).keys()]);
    return nodes;
}
```

### SAH Split Candidate Evaluation

For each axis (X, Y, Z):
1. Compute the centroid extent (min/max centroid coordinate along the axis).
2. Generate `SAH_CANDIDATES` (12) uniformly spaced split positions.
3. For each candidate, partition clusters into left/right, compute child AABBs and their surface areas.
4. Cost = SA(left) × count(left) + SA(right) × count(right).
5. Track the global minimum cost across all axes and candidates.

If the best split cost ≥ SA(parent) × count (leaf cost), create a leaf.

### Surface Area Computation

```typescript
function surfaceArea(aabb: AABB): number {
    const dx = aabb.max.x - aabb.min.x;
    const dy = aabb.max.y - aabb.min.y;
    const dz = aabb.max.z - aabb.min.z;
    return 2 * (dx * dy + dy * dz + dz * dx);
}
```

### Cluster Reordering

After the tree is built, reorder the `clusters` array so that each leaf’s clusters are contiguous (matching `firstCluster` + `clusterCount`). This is done by collecting leaf ranges during the build and rearranging the cluster array in a single pass.
> **Implementation note — cluster reordering not performed:** Because clusters store independent vertex/index buffers (see Step 6), the clusters array is **not** physically reordered. The BVH references cluster indices into the original array, which is valid since each cluster is self-contained. The `orderedClusters` tracking is computed during the build but the original array is left as-is.

> **Implementation note — empty clusters:** If `clusters` is empty, a single degenerate leaf node with zero-volume AABB is returned to ensure the BVH always has at least one node.