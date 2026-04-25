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

function makeMesh(overrides: Partial<TriangulatedMesh> & Pick<TriangulatedMesh, 'vertices' | 'indices' | 'triangleMaterials'>): TriangulatedMesh {
    const triCount = overrides.triangleMaterials.length;
    return {
        triangleEntityIndices: overrides.triangleEntityIndices ?? new Array(triCount).fill(0),
        triangleBrushIndices: overrides.triangleBrushIndices ?? new Array(triCount).fill(0),
        ...overrides,
    };
}

describe('05-material-merge', () => {
    it('should group into a single batch for one material', () => {
        const mesh = makeMesh({
            vertices: [
                makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0),
                makeVertex(0, 0, 0), makeVertex(1, 1, 0), makeVertex(0, 1, 0),
            ],
            indices: [0, 1, 2, 3, 4, 5],
            triangleMaterials: ['brick', 'brick'],
        });
        const batches = mergeMaterials(mesh);
        expect(batches).toHaveLength(1);
        expect(batches[0]!.indices.length).toBe(6);
    });

    it('should create multiple batches for multiple materials', () => {
        const mesh = makeMesh({
            vertices: [
                makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0),
                makeVertex(2, 0, 0), makeVertex(3, 0, 0), makeVertex(3, 1, 0),
                makeVertex(4, 0, 0), makeVertex(5, 0, 0), makeVertex(5, 1, 0),
            ],
            indices: [0, 1, 2, 3, 4, 5, 6, 7, 8],
            triangleMaterials: ['brick', 'stone', 'wood'],
        });
        const batches = mergeMaterials(mesh);
        expect(batches).toHaveLength(3);
        const total = batches.reduce((s, b) => s + b.indices.length / 3, 0);
        expect(total).toBe(3);
    });

    it('should deduplicate shared vertices', () => {
        const shared0 = makeVertex(0, 0, 0);
        const shared1 = makeVertex(1, 0, 0);
        const mesh = makeMesh({
            vertices: [
                shared0, shared1, makeVertex(1, 1, 0),
                shared0, makeVertex(1, 1, 0), makeVertex(0, 1, 0),
            ],
            indices: [0, 1, 2, 3, 4, 5],
            triangleMaterials: ['a', 'a'],
        });
        const batches = mergeMaterials(mesh);
        expect(batches).toHaveLength(1);
        expect(batches[0]!.vertices.length).toBe(4);
    });

    it('should quantize vertex keys for dedup', () => {
        const v1 = makeVertex(1.0, 2.0, 3.0);
        const v2 = makeVertex(1.00009, 2.0, 3.0);
        const mesh = makeMesh({
            vertices: [v1, makeVertex(2, 0, 0), makeVertex(3, 0, 0), v2, makeVertex(2, 0, 0), makeVertex(3, 0, 0)],
            indices: [0, 1, 2, 3, 4, 5],
            triangleMaterials: ['a', 'a'],
        });
        const batches = mergeMaterials(mesh);
        expect(batches[0]!.vertices.length).toBeLessThan(6);
    });

    it('should produce valid indices', () => {
        const mesh = makeMesh({
            vertices: [
                makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0),
            ],
            indices: [0, 1, 2],
            triangleMaterials: ['tex'],
        });
        const batches = mergeMaterials(mesh);
        for (const batch of batches) {
            for (const idx of batch.indices) {
                expect(idx).toBeGreaterThanOrEqual(0);
                expect(idx).toBeLessThan(batch.vertices.length);
            }
        }
    });

    it('should assign unique material IDs', () => {
        const mesh = makeMesh({
            vertices: [
                makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0),
                makeVertex(2, 0, 0), makeVertex(3, 0, 0), makeVertex(3, 1, 0),
            ],
            indices: [0, 1, 2, 3, 4, 5],
            triangleMaterials: ['alpha', 'beta'],
        });
        const batches = mergeMaterials(mesh);
        const ids = batches.map(b => b.materialID);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('should propagate triangleEntityIndices and triangleBrushIndices', () => {
        const mesh = makeMesh({
            vertices: [
                makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0),
                makeVertex(2, 0, 0), makeVertex(3, 0, 0), makeVertex(3, 1, 0),
                makeVertex(4, 0, 0), makeVertex(5, 0, 0), makeVertex(5, 1, 0),
                makeVertex(6, 0, 0), makeVertex(7, 0, 0), makeVertex(7, 1, 0),
            ],
            indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
            triangleMaterials: ['alpha', 'alpha', 'beta', 'beta'],
            triangleEntityIndices: [0, 0, 1, 1],
            triangleBrushIndices: [0, 1, 2, 3],
        });
        const batches = mergeMaterials(mesh);
        expect(batches).toHaveLength(2);
        const alpha = batches.find(b => b.textureName === 'alpha')!;
        const beta = batches.find(b => b.textureName === 'beta')!;
        expect(alpha.triangleEntityIndices).toEqual([0, 0]);
        expect(alpha.triangleBrushIndices).toEqual([0, 1]);
        expect(beta.triangleEntityIndices).toEqual([1, 1]);
        expect(beta.triangleBrushIndices).toEqual([2, 3]);
    });

    it('should preserve metadata through vertex deduplication', () => {
        const mesh = makeMesh({
            vertices: [
                makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0),
                makeVertex(0, 0, 0), makeVertex(1, 1, 0), makeVertex(0, 1, 0),
            ],
            indices: [0, 1, 2, 3, 4, 5],
            triangleMaterials: ['a', 'a'],
            triangleEntityIndices: [0, 0],
            triangleBrushIndices: [10, 20],
        });
        const batches = mergeMaterials(mesh);
        expect(batches).toHaveLength(1);
        // Vertices are deduped (4 instead of 6) but per-triangle metadata preserved
        expect(batches[0]!.vertices.length).toBe(4);
        expect(batches[0]!.triangleBrushIndices).toEqual([10, 20]);
        expect(batches[0]!.triangleEntityIndices).toEqual([0, 0]);
    });
});
