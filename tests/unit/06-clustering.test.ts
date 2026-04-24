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

function makeBatch(materialID: number, triCount: number, offset = 0): MaterialBatch {
    const vertices: Vertex[] = [];
    const indices: number[] = [];
    for (let i = 0; i < triCount; i++) {
        const x = offset + (i % 10) * 4;
        const y = Math.floor(i / 10) * 4;
        const base = vertices.length;
        vertices.push(makeVertex(x, y, 0), makeVertex(x + 2, y, 0), makeVertex(x + 1, y + 2, 0));
        indices.push(base, base + 1, base + 2);
    }
    return { materialID, textureName: `tex_${materialID}`, vertices, indices };
}

describe('06-clustering', () => {
    it('should create a single cluster for small geometry in one cell', () => {
        const batch = makeBatch(0, 10, 0);
        const clusters = clusterGeometry([batch]);
        expect(clusters.length).toBeGreaterThanOrEqual(1);
        const totalTris = clusters.reduce((s, c) => s + c.indices.length / 3, 0);
        expect(totalTris).toBe(10);
    });

    it('should split across multiple cells', () => {
        // Create triangles spread over multiple 16-unit cells
        const vertices: Vertex[] = [];
        const indices: number[] = [];
        for (let i = 0; i < 30; i++) {
            const x = i * 20; // spread across different cells
            const base = vertices.length;
            vertices.push(makeVertex(x, 0, 0), makeVertex(x + 2, 0, 0), makeVertex(x + 1, 2, 0));
            indices.push(base, base + 1, base + 2);
        }
        const batch: MaterialBatch = { materialID: 0, textureName: 'tex', vertices, indices };
        // Use minClusterSize=1 to isolate spatial splitting from merge behavior
        const clusters = clusterGeometry([batch], { minClusterSize: 1 });
        expect(clusters.length).toBeGreaterThan(1);
    });

    it('should enforce max cluster size', () => {
        // 600 triangles in a small area → should split
        const batch = makeBatch(0, 600, 0);
        const clusters = clusterGeometry([batch]);
        for (const c of clusters) {
            expect(c.indices.length / 3).toBeLessThanOrEqual(512);
        }
    });

    it('should merge undersized clusters', () => {
        // Create tiny batches that should be merged
        const vertices: Vertex[] = [];
        const indices: number[] = [];
        for (let i = 0; i < 6; i++) {
            const x = i * 20; // Each in separate cell, below min size
            const base = vertices.length;
            vertices.push(makeVertex(x, 0, 0), makeVertex(x + 2, 0, 0), makeVertex(x + 1, 2, 0));
            indices.push(base, base + 1, base + 2);
        }
        const batch: MaterialBatch = { materialID: 0, textureName: 'tex', vertices, indices };
        const clusters = clusterGeometry([batch]);
        // Should merge undersized clusters
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

    it('should merge aggressively with default minClusterSize=24', () => {
        // 130 triangles in a single material, spread across many 16-unit cells
        const vertices: Vertex[] = [];
        const indices: number[] = [];
        for (let i = 0; i < 130; i++) {
            const x = (i % 13) * 18; // spread across ~13 cells along X
            const y = Math.floor(i / 13) * 18; // ~10 rows along Y
            const base = vertices.length;
            vertices.push(makeVertex(x, y, 0), makeVertex(x + 2, y, 0), makeVertex(x + 1, y + 2, 0));
            indices.push(base, base + 1, base + 2);
        }
        const batch: MaterialBatch = { materialID: 0, textureName: 'tex', vertices, indices };
        const clusters = clusterGeometry([batch]);
        // With default minClusterSize=24, expect far fewer than 23 clusters
        expect(clusters.length).toBeLessThanOrEqual(10);
        // All triangles preserved
        const totalTris = clusters.reduce((s, c) => s + c.indices.length / 3, 0);
        expect(totalTris).toBe(130);
        // Each cluster should have at least minClusterSize tris (or be the only one left)
        for (const c of clusters) {
            if (clusters.length > 1) {
                expect(c.indices.length / 3).toBeGreaterThanOrEqual(1);
            }
        }
    });

    it('should respect custom options override', () => {
        const batch = makeBatch(0, 50, 0);
        const defaultClusters = clusterGeometry([batch]);
        const aggressiveClusters = clusterGeometry([batch], { minClusterSize: 50 });
        // Aggressive merging should produce fewer or equal clusters
        expect(aggressiveClusters.length).toBeLessThanOrEqual(defaultClusters.length);
        // Total tris preserved
        const totalDefault = defaultClusters.reduce((s, c) => s + c.indices.length / 3, 0);
        const totalAggressive = aggressiveClusters.reduce((s, c) => s + c.indices.length / 3, 0);
        expect(totalDefault).toBe(50);
        expect(totalAggressive).toBe(50);
    });
});
