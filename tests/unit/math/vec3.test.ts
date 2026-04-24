import { describe, it, expect } from 'vitest';
import * as vec3 from '../../../src/math/vec3.js';

describe('vec3', () => {
    it('should compute dot product', () => {
        expect(vec3.dot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
    });

    it('should compute cross product', () => {
        const result = vec3.cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
        expect(result.x).toBeCloseTo(0);
        expect(result.y).toBeCloseTo(0);
        expect(result.z).toBeCloseTo(1);
    });

    it('should normalize a vector', () => {
        const result = vec3.normalize({ x: 3, y: 0, z: 0 });
        expect(result.x).toBeCloseTo(1);
        expect(result.y).toBeCloseTo(0);
        expect(result.z).toBeCloseTo(0);
    });

    it('should compute length', () => {
        expect(vec3.length({ x: 3, y: 4, z: 0 })).toBeCloseTo(5);
    });

    it('should subtract vectors', () => {
        const result = vec3.sub({ x: 5, y: 3, z: 1 }, { x: 1, y: 1, z: 1 });
        expect(result).toEqual({ x: 4, y: 2, z: 0 });
    });

    it('should add vectors', () => {
        const result = vec3.add({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
        expect(result).toEqual({ x: 5, y: 7, z: 9 });
    });

    it('should scale a vector', () => {
        const result = vec3.scale({ x: 1, y: 2, z: 3 }, 2);
        expect(result).toEqual({ x: 2, y: 4, z: 6 });
    });

    it('should handle zero vector normalization', () => {
        const result = vec3.normalize({ x: 0, y: 0, z: 0 });
        expect(result).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('should handle near-parallel vectors in cross product', () => {
        const a = { x: 1, y: 0, z: 0 };
        const b = { x: 1, y: 1e-10, z: 0 };
        const result = vec3.cross(a, b);
        expect(vec3.length(result)).toBeLessThan(1e-9);
    });

    it('should compare equality within epsilon', () => {
        expect(vec3.equals({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 })).toBe(true);
        expect(vec3.equals({ x: 1, y: 2, z: 3 }, { x: 1.1, y: 2, z: 3 })).toBe(false);
    });

    it('should lerp between vectors', () => {
        const result = vec3.lerp({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }, 0.5);
        expect(result).toEqual({ x: 5, y: 5, z: 5 });
    });
});
