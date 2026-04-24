import { describe, it, expect } from 'vitest';
import { aabbFromPoints, mergeAABBs, surfaceArea, contains, centroid } from '../../../src/math/aabb.js';

describe('aabb', () => {
    it('should construct from point set', () => {
        const aabb = aabbFromPoints([
            { x: -1, y: -2, z: -3 },
            { x: 4, y: 5, z: 6 },
            { x: 0, y: 0, z: 0 },
        ]);
        expect(aabb.min).toEqual({ x: -1, y: -2, z: -3 });
        expect(aabb.max).toEqual({ x: 4, y: 5, z: 6 });
    });

    it('should merge two AABBs', () => {
        const a = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
        const b = { min: { x: -1, y: -1, z: -1 }, max: { x: 2, y: 2, z: 2 } };
        const merged = mergeAABBs(a, b);
        expect(merged.min).toEqual({ x: -1, y: -1, z: -1 });
        expect(merged.max).toEqual({ x: 2, y: 2, z: 2 });
    });

    it('should compute surface area', () => {
        const aabb = { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 3, z: 4 } };
        // 2*(2*3 + 3*4 + 2*4) = 2*(6+12+8) = 52
        expect(surfaceArea(aabb)).toBeCloseTo(52);
    });

    it('should check containment', () => {
        const outer = { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } };
        const inner = { min: { x: 1, y: 1, z: 1 }, max: { x: 5, y: 5, z: 5 } };
        const outside = { min: { x: -1, y: 0, z: 0 }, max: { x: 5, y: 5, z: 5 } };
        expect(contains(outer, inner)).toBe(true);
        expect(contains(outer, outside)).toBe(false);
    });

    it('should compute centroid', () => {
        const aabb = { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 6, z: 8 } };
        const c = centroid(aabb);
        expect(c).toEqual({ x: 2, y: 3, z: 4 });
    });
});
