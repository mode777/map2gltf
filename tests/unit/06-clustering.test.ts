import { describe, it, expect } from 'vitest';
import { clusterGeometry } from '../../src/pipeline/06-clustering.js';
import type { MaterialBatch, Vertex } from '../../src/types.js';

function makeVertex(x: number, y: number, z: number): Vertex {
    return {
        position: { x, y, z },
        normal: { x: 0, y: 0, z: 1 },
        uv: { x: 0, y: 0 },
    };
}

/**
 * Create a batch with triangles, each assigned to a specific entity/brush.
 * `triDefs` is an array of { x, y, entityIndex, brushIndex } per triangle.
 */
function makeBatchWithMeta(
    materialID: number,
    triDefs: Array<{ x: number; y: number; entityIndex: number; brushIndex: number }>,
): MaterialBatch {
    const vertices: Vertex[] = [];
    const indices: number[] = [];
    const triangleEntityIndices: number[] = [];
    const triangleBrushIndices: number[] = [];
    for (const def of triDefs) {
        const base = vertices.length;
        vertices.push(
            makeVertex(def.x, def.y, 0),
            makeVertex(def.x + 2, def.y, 0),
            makeVertex(def.x + 1, def.y + 2, 0),
        );
        indices.push(base, base + 1, base + 2);
        triangleEntityIndices.push(def.entityIndex);
        triangleBrushIndices.push(def.brushIndex);
    }
    return { materialID, textureName: `tex_${materialID}`, vertices, indices, triangleEntityIndices, triangleBrushIndices };
}

function makeBatch(materialID: number, triCount: number, offset = 0): MaterialBatch {
    const defs = [];
    for (let i = 0; i < triCount; i++) {
        defs.push({
            x: offset + (i % 10) * 4,
            y: Math.floor(i / 10) * 4,
            entityIndex: 0,
            brushIndex: 0,
        });
    }
    return makeBatchWithMeta(materialID, defs);
}

describe('06-clustering', () => {
    // --- Existing tests (updated for new batch format) ---

    it('should create a single cluster for small geometry in one cell', () => {
        const batch = makeBatch(0, 10, 0);
        const clusters = clusterGeometry([batch]);
        expect(clusters.length).toBeGreaterThanOrEqual(1);
        const totalTris = clusters.reduce((s, c) => s + c.indices.length / 3, 0);
        expect(totalTris).toBe(10);
    });

    it('should split across multiple cells', () => {
        const defs = [];
        for (let i = 0; i < 30; i++) {
            defs.push({ x: i * 20, y: 0, entityIndex: 0, brushIndex: i });
        }
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch], { minClusterSize: 1 });
        expect(clusters.length).toBeGreaterThan(1);
    });

    it('should enforce max cluster size', () => {
        // 600 triangles spread across many brushes
        const defs = [];
        for (let i = 0; i < 600; i++) {
            defs.push({ x: (i % 10) * 4, y: Math.floor(i / 10) * 4, entityIndex: 0, brushIndex: i });
        }
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch]);
        for (const c of clusters) {
            expect(c.indices.length / 3).toBeLessThanOrEqual(512);
        }
    });

    it('should merge undersized clusters', () => {
        const defs = [];
        for (let i = 0; i < 6; i++) {
            defs.push({ x: i * 20, y: 0, entityIndex: 0, brushIndex: i });
        }
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch]);
        const totalTris = clusters.reduce((s, c) => s + c.indices.length / 3, 0);
        expect(totalTris).toBe(6);
    });

    it('should compute correct AABB for clusters', () => {
        const batch = makeBatch(0, 10, 0);
        const clusters = clusterGeometry([batch]);
        for (const c of clusters) {
            for (const v of c.vertices) {
                expect(v.position.x).toBeGreaterThanOrEqual(c.bounds.min.x - 1e-5);
                expect(v.position.x).toBeLessThanOrEqual(c.bounds.max.x + 1e-5);
                expect(v.position.y).toBeGreaterThanOrEqual(c.bounds.min.y - 1e-5);
                expect(v.position.y).toBeLessThanOrEqual(c.bounds.max.y + 1e-5);
            }
        }
    });

    it('should produce valid index ranges', () => {
        const batch = makeBatch(0, 20, 0);
        const clusters = clusterGeometry([batch]);
        for (const c of clusters) {
            for (const idx of c.indices) {
                expect(idx).toBeGreaterThanOrEqual(0);
                expect(idx).toBeLessThan(c.vertices.length);
            }
        }
    });

    it('should preserve material ID', () => {
        const batch = makeBatch(5, 10, 0);
        const clusters = clusterGeometry([batch]);
        for (const c of clusters) {
            expect(c.materialID).toBe(5);
        }
    });

    it('should respect custom options override', () => {
        const batch = makeBatch(0, 50, 0);
        const defaultClusters = clusterGeometry([batch]);
        const aggressiveClusters = clusterGeometry([batch], { minClusterSize: 50 });
        expect(aggressiveClusters.length).toBeLessThanOrEqual(defaultClusters.length);
        const totalDefault = defaultClusters.reduce((s, c) => s + c.indices.length / 3, 0);
        const totalAggressive = aggressiveClusters.reduce((s, c) => s + c.indices.length / 3, 0);
        expect(totalDefault).toBe(50);
        expect(totalAggressive).toBe(50);
    });

    // --- New tests: Entity clustering ---

    it('should produce one cluster per entity per material (single entity)', () => {
        const defs = [];
        for (let i = 0; i < 100; i++) {
            defs.push({ x: i * 20, y: 0, entityIndex: 1, brushIndex: 10 });
        }
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]!.indices.length / 3).toBe(100);
    });

    it('should produce separate clusters for multiple entities', () => {
        const defs = [
            ...Array.from({ length: 10 }, (_, i) => ({ x: i * 4, y: 0, entityIndex: 1, brushIndex: 1 })),
            ...Array.from({ length: 10 }, (_, i) => ({ x: i * 4, y: 20, entityIndex: 2, brushIndex: 2 })),
            ...Array.from({ length: 10 }, (_, i) => ({ x: i * 4, y: 40, entityIndex: 3, brushIndex: 3 })),
        ];
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch]);
        expect(clusters).toHaveLength(3);
    });

    it('should not split entity clusters even above maxClusterSize', () => {
        const defs = [];
        for (let i = 0; i < 800; i++) {
            defs.push({ x: (i % 20) * 4, y: Math.floor(i / 20) * 4, entityIndex: 1, brushIndex: 1 });
        }
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch], { maxClusterSize: 512 });
        expect(clusters).toHaveLength(1);
        expect(clusters[0]!.indices.length / 3).toBe(800);
    });

    // --- New tests: Brush integrity ---

    it('should keep brush triangles together in same cell (worldspawn)', () => {
        // Two brushes, all within one grid cell
        const defs = [
            ...Array.from({ length: 5 }, (_, i) => ({ x: i * 2, y: 0, entityIndex: 0, brushIndex: 0 })),
            ...Array.from({ length: 5 }, (_, i) => ({ x: i * 2, y: 4, entityIndex: 0, brushIndex: 1 })),
        ];
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch]);
        // Each cluster should contain only whole brushes
        for (const c of clusters) {
            const brushes = new Set(c.triangleIndices.map(ti => batch.triangleBrushIndices[ti]));
            for (const bi of brushes) {
                // All triangles of this brush should be in this cluster
                const allTrisOfBrush = batch.triangleBrushIndices
                    .map((b, i) => b === bi ? i : -1)
                    .filter(i => i >= 0);
                const inThisCluster = c.triangleIndices.filter(ti => batch.triangleBrushIndices[ti] === bi);
                expect(inThisCluster.length).toBe(allTrisOfBrush.length);
            }
        }
    });

    it('should keep brush triangles together across different cells (worldspawn)', () => {
        // Two brushes in different grid cells
        const defs = [
            ...Array.from({ length: 5 }, (_, i) => ({ x: i * 2, y: 0, entityIndex: 0, brushIndex: 0 })),
            ...Array.from({ length: 5 }, (_, i) => ({ x: 100 + i * 2, y: 0, entityIndex: 0, brushIndex: 1 })),
        ];
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch], { minClusterSize: 1 });
        // No brush should appear in more than one cluster
        const brushClusters = new Map<number, number>();
        for (let ci = 0; ci < clusters.length; ci++) {
            for (const ti of clusters[ci]!.triangleIndices) {
                const bi = batch.triangleBrushIndices[ti]!;
                if (brushClusters.has(bi)) {
                    expect(brushClusters.get(bi)).toBe(ci);
                } else {
                    brushClusters.set(bi, ci);
                }
            }
        }
    });

    it('should not tear brushes when splitting oversized cells', () => {
        // 10 brushes × 60 triangles each = 600 total in one cell → split required at max=512
        const defs = [];
        for (let b = 0; b < 10; b++) {
            for (let t = 0; t < 60; t++) {
                defs.push({ x: t * 0.1, y: b * 0.1, entityIndex: 0, brushIndex: b });
            }
        }
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch], { maxClusterSize: 512, minClusterSize: 1 });
        // No brush should appear in more than one cluster
        const brushClusters = new Map<number, number>();
        for (let ci = 0; ci < clusters.length; ci++) {
            for (const ti of clusters[ci]!.triangleIndices) {
                const bi = batch.triangleBrushIndices[ti]!;
                if (brushClusters.has(bi)) {
                    expect(brushClusters.get(bi)).toBe(ci);
                } else {
                    brushClusters.set(bi, ci);
                }
            }
        }
        const totalTris = clusters.reduce((s, c) => s + c.indices.length / 3, 0);
        expect(totalTris).toBe(600);
    });

    it('should keep oversized single brush intact', () => {
        const defs = [];
        for (let i = 0; i < 600; i++) {
            defs.push({ x: (i % 10) * 0.1, y: Math.floor(i / 10) * 0.1, entityIndex: 0, brushIndex: 0 });
        }
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch], { maxClusterSize: 512, minClusterSize: 1 });
        expect(clusters).toHaveLength(1);
        expect(clusters[0]!.indices.length / 3).toBe(600);
    });

    // --- New tests: Mixed worldspawn + entity ---

    it('should separate worldspawn and entity triangles into different clusters', () => {
        const defs = [
            ...Array.from({ length: 50 }, (_, i) => ({ x: i * 0.1, y: 0, entityIndex: 0, brushIndex: 0 })),
            ...Array.from({ length: 30 }, (_, i) => ({ x: i * 0.1, y: 10, entityIndex: 1, brushIndex: 1 })),
        ];
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch]);
        expect(clusters.length).toBeGreaterThanOrEqual(2);

        // Find entity-1 cluster
        const entityCluster = clusters.find(c =>
            c.triangleIndices.some(ti => batch.triangleEntityIndices[ti] === 1),
        )!;
        expect(entityCluster).toBeDefined();
        // All its triangles should be entity 1
        for (const ti of entityCluster.triangleIndices) {
            expect(batch.triangleEntityIndices[ti]).toBe(1);
        }
        // Entity-1 should have exactly 30 triangles
        expect(entityCluster.triangleIndices.length).toBe(30);

        const totalTris = clusters.reduce((s, c) => s + c.indices.length / 3, 0);
        expect(totalTris).toBe(80);
    });

    it('should merge undersized worldspawn clusters while respecting brush integrity', () => {
        // 5 brushes with 4 tris each in nearby but different cells
        const defs = [];
        for (let b = 0; b < 5; b++) {
            for (let t = 0; t < 4; t++) {
                defs.push({ x: b * 20 + t * 2, y: 0, entityIndex: 0, brushIndex: b });
            }
        }
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch], { minClusterSize: 24 });
        // Should be merged into fewer clusters
        expect(clusters.length).toBeLessThan(5);
        // No brush torn apart
        const brushClusters = new Map<number, number>();
        for (let ci = 0; ci < clusters.length; ci++) {
            for (const ti of clusters[ci]!.triangleIndices) {
                const bi = batch.triangleBrushIndices[ti]!;
                if (brushClusters.has(bi)) {
                    expect(brushClusters.get(bi)).toBe(ci);
                } else {
                    brushClusters.set(bi, ci);
                }
            }
        }
        const totalTris = clusters.reduce((s, c) => s + c.indices.length / 3, 0);
        expect(totalTris).toBe(20);
    });

    it('should cluster per-material independently for worldspawn', () => {
        const batch0 = makeBatchWithMeta(0, [
            ...Array.from({ length: 10 }, (_, i) => ({ x: i * 2, y: 0, entityIndex: 0, brushIndex: 0 })),
        ]);
        const batch1 = makeBatchWithMeta(1, [
            ...Array.from({ length: 10 }, (_, i) => ({ x: i * 2, y: 0, entityIndex: 0, brushIndex: 0 })),
        ]);
        const clusters = clusterGeometry([batch0, batch1]);
        const mat0 = clusters.filter(c => c.materialID === 0);
        const mat1 = clusters.filter(c => c.materialID === 1);
        expect(mat0.length).toBeGreaterThanOrEqual(1);
        expect(mat1.length).toBeGreaterThanOrEqual(1);
        // Both materials have all their triangles
        expect(mat0.reduce((s, c) => s + c.indices.length / 3, 0)).toBe(10);
        expect(mat1.reduce((s, c) => s + c.indices.length / 3, 0)).toBe(10);
    });

    // --- skipWorldspawnClustering tests ---

    it('skipWorldspawnClustering should produce one worldspawn cluster per material batch', () => {
        const batch0 = makeBatch(0, 20, 0);
        const batch1 = makeBatch(1, 15, 100);
        const batch2 = makeBatch(2, 10, 200);
        const clusters = clusterGeometry([batch0, batch1, batch2], { skipWorldspawnClustering: true });
        expect(clusters).toHaveLength(3);
        expect(clusters[0]!.materialID).toBe(0);
        expect(clusters[1]!.materialID).toBe(1);
        expect(clusters[2]!.materialID).toBe(2);
        expect(clusters.every(cluster => cluster.isWorldspawn)).toBe(true);
    });

    it('skipWorldspawnClustering should preserve all triangles', () => {
        const batch = makeBatch(0, 100, 0);
        const clusters = clusterGeometry([batch], { skipWorldspawnClustering: true });
        expect(clusters).toHaveLength(1);
        expect(clusters[0]!.indices.length / 3).toBe(100);
    });

    it('skipWorldspawnClustering should still apply Forsyth reordering (valid permutation)', () => {
        const batch = makeBatch(0, 30, 0);
        const clusters = clusterGeometry([batch], { skipWorldspawnClustering: true });
        const cluster = clusters[0]!;
        // All indices should be valid
        for (const idx of cluster.indices) {
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(cluster.vertices.length);
        }
        // Triangle count preserved
        expect(cluster.indices.length / 3).toBe(30);
    });

    it('skipWorldspawnClustering should ignore worldspawn grid/splitting/merging options', () => {
        // Spread geometry across many grid cells — normally produces multiple clusters
        const defs = [];
        for (let i = 0; i < 50; i++) {
            defs.push({ x: i * 100, y: 0, entityIndex: 0, brushIndex: i });
        }
        const batch = makeBatchWithMeta(0, defs);
        const clusters = clusterGeometry([batch], {
            skipWorldspawnClustering: true,
            gridCellSize: 16,
            maxClusterSize: 10,
            minClusterSize: 24,
        });
        expect(clusters).toHaveLength(1);
        expect(clusters[0]!.indices.length / 3).toBe(50);
    });

    it('skipWorldspawnClustering should preserve separate entity clusters for shared material', () => {
        const batch = makeBatchWithMeta(0, [
            ...Array.from({ length: 10 }, (_, i) => ({ x: i * 4, y: 0, entityIndex: 1, brushIndex: 1 })),
            ...Array.from({ length: 12 }, (_, i) => ({ x: i * 4, y: 20, entityIndex: 2, brushIndex: 2 })),
        ]);

        const clusters = clusterGeometry([batch], { skipWorldspawnClustering: true });
        expect(clusters).toHaveLength(2);
        expect(new Set(clusters.map(cluster => cluster.entityIndex))).toEqual(new Set([1, 2]));
        expect(clusters.every(cluster => !cluster.isWorldspawn)).toBe(true);
    });

    it('skipWorldspawnClustering should keep worldspawn and entities separated in mixed batches', () => {
        const batch = makeBatchWithMeta(0, [
            ...Array.from({ length: 10 }, (_, i) => ({ x: i * 100, y: 0, entityIndex: 0, brushIndex: i })),
            ...Array.from({ length: 8 }, (_, i) => ({ x: i * 4, y: 20, entityIndex: 1, brushIndex: 100 })),
            ...Array.from({ length: 8 }, (_, i) => ({ x: i * 4, y: 40, entityIndex: 2, brushIndex: 200 })),
        ]);

        const clusters = clusterGeometry([batch], { skipWorldspawnClustering: true });
        expect(clusters).toHaveLength(3);

        const worldCluster = clusters.find(cluster => cluster.isWorldspawn);
        expect(worldCluster).toBeDefined();
        expect(worldCluster!.entityIndex).toBe(0);
        expect(worldCluster!.triangleIndices.every(index => batch.triangleEntityIndices[index] === 0)).toBe(true);

        const entityClusters = clusters.filter(cluster => !cluster.isWorldspawn);
        expect(entityClusters).toHaveLength(2);
        for (const cluster of entityClusters) {
            const entityIndices = new Set(cluster.triangleIndices.map(index => batch.triangleEntityIndices[index]));
            expect(entityIndices.size).toBe(1);
            expect(entityIndices.has(0)).toBe(false);
        }
    });
});
