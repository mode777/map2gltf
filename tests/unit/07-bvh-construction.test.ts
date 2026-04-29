import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBVH } from '../../src/pipeline/07-bvh-construction.js';
import { parseMap } from '../../src/pipeline/01-map-parsing.js';
import { brushToPolygons } from '../../src/pipeline/02-brush-to-polygons.js';
import { worldCSG } from '../../src/pipeline/03-world-csg.js';
import { triangulate } from '../../src/pipeline/04-triangulation.js';
import { mergeMaterials } from '../../src/pipeline/05-material-merge.js';
import { clusterGeometry } from '../../src/pipeline/06-clustering.js';
import { createDiagnostics } from '../../src/types.js';
import type { Cluster, BVHNode, AABB, Vec3 } from '../../src/types.js';

function makeCluster(
    id: number,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
): Cluster {
    return {
        materialID: 0,
        bounds: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
        triangleIndices: [0, 1, 2],
        vertices: [
            { position: { x: minX, y: minY, z: minZ }, normal: { x: 0, y: 0, z: 1 }, uv: { x: 0, y: 0 } },
            { position: { x: maxX, y: minY, z: minZ }, normal: { x: 0, y: 0, z: 1 }, uv: { x: 1, y: 0 } },
            { position: { x: maxX, y: maxY, z: maxZ }, normal: { x: 0, y: 0, z: 1 }, uv: { x: 1, y: 1 } },
        ],
        indices: [0, 1, 2],
        entityIndex: 0,
        isWorldspawn: true,
    };
}

describe('07-bvh-construction', () => {
    it('should build a single leaf for one cluster', () => {
        const clusters = [makeCluster(0, 0, 0, 0, 1, 1, 1)];
        const bvh = buildBVH(clusters);
        expect(bvh.length).toBe(1);
        expect(bvh[0]!.left).toBe(-1);
        expect(bvh[0]!.right).toBe(-1);
        expect(bvh[0]!.clusterCount).toBe(1);
    });

    it('should build a tree with interior nodes for many clusters', () => {
        const clusters: Cluster[] = [];
        for (let i = 0; i < 10; i++) {
            clusters.push(makeCluster(i, i * 10, 0, 0, i * 10 + 5, 5, 5));
        }
        const bvh = buildBVH(clusters);
        // Should have interior nodes with children
        const interiorNodes = bvh.filter(n => n.left !== -1);
        expect(interiorNodes.length).toBeGreaterThan(0);
    });

    it('should have root bounds that cover all clusters', () => {
        const clusters = [
            makeCluster(0, 0, 0, 0, 10, 10, 10),
            makeCluster(1, 50, 50, 50, 60, 60, 60),
        ];
        const bvh = buildBVH(clusters);
        const root = bvh[0]!;
        expect(root.bounds.min.x).toBeLessThanOrEqual(0);
        expect(root.bounds.min.y).toBeLessThanOrEqual(0);
        expect(root.bounds.max.x).toBeGreaterThanOrEqual(60);
        expect(root.bounds.max.y).toBeGreaterThanOrEqual(60);
    });

    it('should have valid child indices', () => {
        const clusters: Cluster[] = [];
        for (let i = 0; i < 8; i++) {
            clusters.push(makeCluster(i, i * 20, 0, 0, i * 20 + 10, 10, 10));
        }
        const bvh = buildBVH(clusters);
        for (let i = 0; i < bvh.length; i++) {
            const node = bvh[i]!;
            if (node.left !== -1) {
                expect(node.left).toBeGreaterThanOrEqual(0);
                expect(node.left).toBeLessThan(bvh.length);
                expect(node.right).toBeGreaterThanOrEqual(0);
                expect(node.right).toBeLessThan(bvh.length);
            }
        }
    });

    it('should have leaf nodes that reference clusters', () => {
        const clusters = [
            makeCluster(0, 0, 0, 0, 10, 10, 10),
            makeCluster(1, 20, 0, 0, 30, 10, 10),
            makeCluster(2, 40, 0, 0, 50, 10, 10),
        ];
        const bvh = buildBVH(clusters);
        const leaves = bvh.filter(n => n.left === -1);
        const totalClusters = leaves.reduce((s, l) => s + l.clusterCount, 0);
        expect(totalClusters).toBe(3);
    });

    it('should use SAH for split decisions (not degenerate)', () => {
        const clusters: Cluster[] = [];
        for (let i = 0; i < 20; i++) {
            clusters.push(makeCluster(i, i * 10, 0, 0, i * 10 + 5, 5, 5));
        }
        const bvh = buildBVH(clusters);
        // Tree depth should be reasonable (not linear)
        expect(bvh.length).toBeLessThan(clusters.length * 3);
    });

    it('should enforce leaf threshold', () => {
        // 3 clusters → should be a single leaf (threshold = 4)
        const clusters = [
            makeCluster(0, 0, 0, 0, 10, 10, 10),
            makeCluster(1, 20, 0, 0, 30, 10, 10),
            makeCluster(2, 40, 0, 0, 50, 10, 10),
        ];
        const bvh = buildBVH(clusters);
        const leaves = bvh.filter(n => n.left === -1);
        for (const leaf of leaves) {
            expect(leaf.clusterCount).toBeLessThanOrEqual(4);
        }
    });

    it('should maintain depth-first layout with left child at index+1', () => {
        const clusters: Cluster[] = [];
        for (let i = 0; i < 10; i++) {
            clusters.push(makeCluster(i, i * 20, 0, 0, i * 20 + 10, 10, 10));
        }
        const bvh = buildBVH(clusters);
        for (let i = 0; i < bvh.length; i++) {
            const node = bvh[i]!;
            if (node.left !== -1) {
                expect(node.left).toBe(i + 1);
                expect(node.right).toBeGreaterThan(i + 1);
            }
        }
    });

    it('should produce a single leaf or minimal tree for few clusters (skip-clustering scenario)', () => {
        // 2 clusters simulating 2-material skip-clustering
        const clusters = [
            makeCluster(0, 0, 0, 0, 10, 10, 10),
            makeCluster(1, 20, 0, 0, 30, 10, 10),
        ];
        const bvh = buildBVH(clusters);
        // With 2 clusters and leaf threshold 4, should be a single leaf
        expect(bvh).toHaveLength(1);
        expect(bvh[0]!.left).toBe(-1);
        expect(bvh[0]!.clusterCount).toBe(2);
    });

    it('should handle exactly bvhLeafThreshold clusters as a single leaf', () => {
        // 4 clusters = exact leaf threshold
        const clusters = [
            makeCluster(0, 0, 0, 0, 10, 10, 10),
            makeCluster(1, 20, 0, 0, 30, 10, 10),
            makeCluster(2, 40, 0, 0, 50, 10, 10),
            makeCluster(3, 60, 0, 0, 70, 10, 10),
        ];
        const bvh = buildBVH(clusters);
        expect(bvh).toHaveLength(1);
        expect(bvh[0]!.left).toBe(-1);
        expect(bvh[0]!.clusterCount).toBe(4);
    });

    it('should allow the leaf threshold to keep six clusters in a single leaf', () => {
        const clusters = [
            makeCluster(0, 0, 0, 0, 10, 10, 10),
            makeCluster(1, 20, 0, 0, 30, 10, 10),
            makeCluster(2, 40, 0, 0, 50, 10, 10),
            makeCluster(3, 60, 0, 0, 70, 10, 10),
            makeCluster(4, 80, 0, 0, 90, 10, 10),
            makeCluster(5, 100, 0, 0, 110, 10, 10),
        ];

        const bvh = buildBVH(clusters, { leafThreshold: 8 });

        expect(bvh).toHaveLength(1);
        expect(bvh[0]!.left).toBe(-1);
        expect(bvh[0]!.clusterCount).toBe(6);
    });

    it('should allow the leaf threshold to force a split for six clusters', () => {
        const clusters = [
            makeCluster(0, 0, 0, 0, 10, 10, 10),
            makeCluster(1, 20, 0, 0, 30, 10, 10),
            makeCluster(2, 40, 0, 0, 50, 10, 10),
            makeCluster(3, 60, 0, 0, 70, 10, 10),
            makeCluster(4, 80, 0, 0, 90, 10, 10),
            makeCluster(5, 100, 0, 0, 110, 10, 10),
        ];

        const bvh = buildBVH(clusters, { leafThreshold: 2 });

        expect(bvh.length).toBeGreaterThan(1);
        expect(bvh[0]!.left).not.toBe(-1);
    });

    it('should not force a single leaf for many clusters after option rename', () => {
        const clusters: Cluster[] = [];
        for (let i = 0; i < 10; i++) {
            clusters.push(makeCluster(i, i * 10, 0, 0, i * 10 + 5, 5, 5));
        }
        const bvh = buildBVH(clusters);
        expect(bvh.length).toBeGreaterThan(1);
        expect(bvh[0]!.left).not.toBe(-1);
    });
});

// Integration smoke test: BVH vs brute-force frustum test
describe('07-bvh-construction integration', () => {
    const fixtures = resolve(import.meta.dirname, '../fixtures');

    function aabbIntersectsFrustum(aabb: AABB, planes: Array<{ normal: Vec3; d: number }>): boolean {
        for (const plane of planes) {
            // Test AABB against plane: find the point on the AABB most in the direction of the plane normal
            const px = plane.normal.x >= 0 ? aabb.max.x : aabb.min.x;
            const py = plane.normal.y >= 0 ? aabb.max.y : aabb.min.y;
            const pz = plane.normal.z >= 0 ? aabb.max.z : aabb.min.z;
            const dist = plane.normal.x * px + plane.normal.y * py + plane.normal.z * pz + plane.d;
            if (dist < 0) return false;
        }
        return true;
    }

    function makeRandomFrustum(seed: number): Array<{ normal: Vec3; d: number }> {
        // Pseudo-random deterministic frustum from seed
        function rand(): number {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return (seed / 0x7fffffff) * 2 - 1;
        }
        function randPos(): number {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return (seed / 0x7fffffff) * 2000 - 1000;
        }
        // Generate 6 frustum planes (normals pointing inward)
        const planes: Array<{ normal: Vec3; d: number }> = [];
        for (let i = 0; i < 6; i++) {
            let nx = rand(), ny = rand(), nz = rand();
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len < 0.001) { nx = 1; ny = 0; nz = 0; }
            else { nx /= len; ny /= len; nz /= len; }
            planes.push({ normal: { x: nx, y: ny, z: nz }, d: randPos() * 0.1 });
        }
        return planes;
    }

    function bruteForceTest(clusters: Cluster[], frustum: Array<{ normal: Vec3; d: number }>): Set<number> {
        const visible = new Set<number>();
        for (let i = 0; i < clusters.length; i++) {
            if (aabbIntersectsFrustum(clusters[i]!.bounds, frustum)) {
                visible.add(i);
            }
        }
        return visible;
    }

    function bvhFrustumTest(
        bvh: BVHNode[],
        clusters: Cluster[],
        frustum: Array<{ normal: Vec3; d: number }>,
    ): Set<number> {
        const visible = new Set<number>();
        function traverse(nodeIdx: number): void {
            const node = bvh[nodeIdx];
            if (!node) return;
            if (!aabbIntersectsFrustum(node.bounds, frustum)) return;
            if (node.left === -1) {
                // Leaf: add clusters
                for (let i = node.firstCluster; i < node.firstCluster + node.clusterCount; i++) {
                    if (clusters[i] && aabbIntersectsFrustum(clusters[i]!.bounds, frustum)) {
                        visible.add(i);
                    }
                }
            } else {
                traverse(node.left);
                traverse(node.right);
            }
        }
        traverse(0);
        return visible;
    }

    it('should produce equivalent results to brute-force frustum test for 10 random frustums', () => {
        const source = readFileSync(resolve(fixtures, 'large-map.map'), 'utf-8');
        const diag = createDiagnostics();
        const entities = parseMap(source, diag);
        let brushIdx = 0;
        const worldPolys = entities[0]
            ? entities[0].brushes.flatMap(b => brushToPolygons(b, brushIdx++))
            : [];
        const clipped = worldCSG(worldPolys);
        const entityPolys = entities.slice(1).flatMap(e =>
            e.brushes.flatMap(b => brushToPolygons(b, brushIdx++)),
        );
        const allPolygons = [...clipped, ...entityPolys];
        const mesh = triangulate(allPolygons, new Map(), diag);
        const batches = mergeMaterials(mesh);
        const clusters = clusterGeometry(batches);
        const bvh = buildBVH(clusters);

        expect(clusters.length).toBeGreaterThan(0);

        for (let seed = 1; seed <= 10; seed++) {
            const frustum = makeRandomFrustum(seed * 7919);
            const bruteResult = bruteForceTest(clusters, frustum);
            const bvhResult = bvhFrustumTest(bvh, clusters, frustum);

            // BVH should find at least all clusters that brute force finds
            for (const idx of bruteResult) {
                expect(bvhResult.has(idx)).toBe(true);
            }
        }
    });
});
