import type { Cluster, BVHNode, AABB, Vec3 } from '../types.js';
import { mergeAABBs, surfaceArea, centroid as aabbCentroid } from '../math/aabb.js';

const BVH_LEAF_THRESHOLD = 4;
const SAH_CANDIDATES = 12;

function mergeClusterAABBs(clusters: Cluster[], indices: number[]): AABB {
    let result = clusters[indices[0]!]!.bounds;
    for (let i = 1; i < indices.length; i++) {
        result = mergeAABBs(result, clusters[indices[i]!]!.bounds);
    }
    return result;
}

function centroidComponent(c: Vec3, axis: number): number {
    if (axis === 0) return c.x;
    if (axis === 1) return c.y;
    return c.z;
}

function findBestSplit(
    clusterIndices: number[],
    clusters: Cluster[],
    parentBounds: AABB,
): { axis: number; splitPos: number; cost: number } | null {
    const parentSA = surfaceArea(parentBounds);
    const leafCost = parentSA * clusterIndices.length;

    let bestCost = leafCost;
    let bestAxis = -1;
    let bestPos = 0;

    for (let axis = 0; axis < 3; axis++) {
        const centroids = clusterIndices.map(ci => centroidComponent(aabbCentroid(clusters[ci]!.bounds), axis));
        const minC = Math.min(...centroids);
        const maxC = Math.max(...centroids);

        if (maxC - minC < 1e-10) continue;

        for (let k = 1; k <= SAH_CANDIDATES; k++) {
            const splitPos = minC + (maxC - minC) * (k / (SAH_CANDIDATES + 1));

            const leftIndices: number[] = [];
            const rightIndices: number[] = [];
            for (let i = 0; i < clusterIndices.length; i++) {
                if (centroids[i]! < splitPos) {
                    leftIndices.push(clusterIndices[i]!);
                } else {
                    rightIndices.push(clusterIndices[i]!);
                }
            }

            if (leftIndices.length === 0 || rightIndices.length === 0) continue;

            const leftBounds = mergeClusterAABBs(clusters, leftIndices);
            const rightBounds = mergeClusterAABBs(clusters, rightIndices);
            const cost = surfaceArea(leftBounds) * leftIndices.length +
                surfaceArea(rightBounds) * rightIndices.length;

            if (cost < bestCost) {
                bestCost = cost;
                bestAxis = axis;
                bestPos = splitPos;
            }
        }
    }

    if (bestAxis === -1) return null;
    return { axis: bestAxis, splitPos: bestPos, cost: bestCost };
}

export interface BVHOptions {
    skipClustering?: boolean;
}

export function buildBVH(clusters: Cluster[], options?: BVHOptions): BVHNode[] {
    if (clusters.length === 0) {
        return [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: 0,
        }];
    }

    // When clustering is skipped, produce a single leaf wrapping all clusters
    if (options?.skipClustering) {
        const allIndices = [...Array(clusters.length).keys()];
        const bounds = mergeClusterAABBs(clusters, allIndices);
        return [{
            bounds,
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: clusters.length,
        }];
    }

    const nodes: BVHNode[] = [];
    // Track the reordered cluster list
    const orderedClusters: number[] = [];

    function build(clusterIndices: number[]): number {
        const nodeIndex = nodes.length;
        const bounds = mergeClusterAABBs(clusters, clusterIndices);

        // Leaf case
        if (clusterIndices.length <= BVH_LEAF_THRESHOLD) {
            const firstCluster = orderedClusters.length;
            for (const ci of clusterIndices) {
                orderedClusters.push(ci);
            }
            nodes.push({
                bounds,
                left: -1,
                right: -1,
                firstCluster,
                clusterCount: clusterIndices.length,
            });
            return nodeIndex;
        }

        // Find best split via SAH
        const split = findBestSplit(clusterIndices, clusters, bounds);

        if (!split) {
            const firstCluster = orderedClusters.length;
            for (const ci of clusterIndices) {
                orderedClusters.push(ci);
            }
            nodes.push({
                bounds,
                left: -1,
                right: -1,
                firstCluster,
                clusterCount: clusterIndices.length,
            });
            return nodeIndex;
        }

        // Partition
        const leftIndices: number[] = [];
        const rightIndices: number[] = [];
        for (const ci of clusterIndices) {
            const c = centroidComponent(aabbCentroid(clusters[ci]!.bounds), split.axis);
            if (c < split.splitPos) {
                leftIndices.push(ci);
            } else {
                rightIndices.push(ci);
            }
        }

        // Degenerate partition fallback
        if (leftIndices.length === 0 || rightIndices.length === 0) {
            const firstCluster = orderedClusters.length;
            for (const ci of clusterIndices) {
                orderedClusters.push(ci);
            }
            nodes.push({
                bounds,
                left: -1,
                right: -1,
                firstCluster,
                clusterCount: clusterIndices.length,
            });
            return nodeIndex;
        }

        // Reserve this node's slot
        nodes.push({
            bounds,
            left: -1,
            right: -1,
            firstCluster: -1,
            clusterCount: 0,
        });

        const leftChild = build(leftIndices);   // always nodeIndex + 1
        const rightChild = build(rightIndices);
        nodes[nodeIndex]!.left = leftChild;
        nodes[nodeIndex]!.right = rightChild;

        return nodeIndex;
    }

    build([...Array(clusters.length).keys()]);

    // Reorder clusters in-place to match BVH leaf references.
    // After this, firstCluster indexes directly into the clusters array.
    const reordered = orderedClusters.map(i => clusters[i]!);
    for (let i = 0; i < reordered.length; i++) {
        clusters[i] = reordered[i]!;
    }

    return nodes;
}
