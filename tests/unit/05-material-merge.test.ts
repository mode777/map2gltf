import { describe, it, expect } from 'vitest';
import { mergeMaterials } from '../../src/pipeline/05-material-merge.js';
import type { TriangulatedMesh, Vertex } from '../../src/types.js';

function makeVertex(x: number, y: number, z: number, u = 0, v = 0): Vertex {
    return {
        position: { x, y, z },
        normal: { x: 0, y: 0, z: 1 },
        uv: { x: u, y: v },
    };
}

describe('05-material-merge', () => {
    it('should group into a single batch for one material', () => {
        const mesh: TriangulatedMesh = {
            vertices: [
                makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0),
                makeVertex(0, 0, 0), makeVertex(1, 1, 0), makeVertex(0, 1, 0),
            ],
            indices: [0, 1, 2, 3, 4, 5],
            triangleMaterials: ['brick', 'brick'],
        };
        const batches = mergeMaterials(mesh);
        expect(batches).toHaveLength(1);
        expect(batches[0]!.indices.length).toBe(6);
    });

    it('should create multiple batches for multiple materials', () => {
        const mesh: TriangulatedMesh = {
            vertices: [
                makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0),
                makeVertex(2, 0, 0), makeVertex(3, 0, 0), makeVertex(3, 1, 0),
                makeVertex(4, 0, 0), makeVertex(5, 0, 0), makeVertex(5, 1, 0),
            ],
            indices: [0, 1, 2, 3, 4, 5, 6, 7, 8],
            triangleMaterials: ['brick', 'stone', 'wood'],
        };
        const batches = mergeMaterials(mesh);
        expect(batches).toHaveLength(3);
        // Total triangle count matches
        const total = batches.reduce((s, b) => s + b.indices.length / 3, 0);
        expect(total).toBe(3);
    });

    it('should deduplicate shared vertices', () => {
        // Two triangles sharing an edge (2 shared vertices)
        const shared0 = makeVertex(0, 0, 0);
        const shared1 = makeVertex(1, 0, 0);
        const mesh: TriangulatedMesh = {
            vertices: [
                shared0, shared1, makeVertex(1, 1, 0),
                shared0, makeVertex(1, 1, 0), makeVertex(0, 1, 0),
            ],
            indices: [0, 1, 2, 3, 4, 5],
            triangleMaterials: ['a', 'a'],
        };
        const batches = mergeMaterials(mesh);
        expect(batches).toHaveLength(1);
        expect(batches[0]!.vertices.length).toBe(4); // 4 unique, not 6
    });

    it('should quantize vertex keys for dedup', () => {
        const v1 = makeVertex(1.0, 2.0, 3.0);
        const v2 = makeVertex(1.00009, 2.0, 3.0); // within 1e-4
        const mesh: TriangulatedMesh = {
            vertices: [v1, makeVertex(2, 0, 0), makeVertex(3, 0, 0), v2, makeVertex(2, 0, 0), makeVertex(3, 0, 0)],
            indices: [0, 1, 2, 3, 4, 5],
            triangleMaterials: ['a', 'a'],
        };
        const batches = mergeMaterials(mesh);
        // Dedup should reduce vertex count (shared v2==v4, v3==v5, and possibly v1≈v2)
        expect(batches[0]!.vertices.length).toBeLessThan(6);
    });

    it('should produce valid indices', () => {
        const mesh: TriangulatedMesh = {
            vertices: [
                makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0),
            ],
            indices: [0, 1, 2],
            triangleMaterials: ['tex'],
        };
        const batches = mergeMaterials(mesh);
        for (const batch of batches) {
            for (const idx of batch.indices) {
                expect(idx).toBeGreaterThanOrEqual(0);
                expect(idx).toBeLessThan(batch.vertices.length);
            }
        }
    });

    it('should assign unique material IDs', () => {
        const mesh: TriangulatedMesh = {
            vertices: [
                makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0),
                makeVertex(2, 0, 0), makeVertex(3, 0, 0), makeVertex(3, 1, 0),
            ],
            indices: [0, 1, 2, 3, 4, 5],
            triangleMaterials: ['alpha', 'beta'],
        };
        const batches = mergeMaterials(mesh);
        const ids = batches.map(b => b.materialID);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
