import { describe, it, expect } from 'vitest';
import { planeFromPoints, classifyVertex, Classification, linePlaneIntersection } from '../../../src/math/plane.js';

describe('plane', () => {
    it('should create a plane from 3 points', () => {
        const p = planeFromPoints(
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
            { x: 1, y: 0, z: 0 },
        );
        expect(p.normal.x).toBeCloseTo(0);
        expect(p.normal.y).toBeCloseTo(0);
        expect(Math.abs(p.normal.z)).toBeCloseTo(1);
        expect(p.distance).toBeCloseTo(0);
    });

    it('should classify vertices as front/back/on', () => {
        const n = { x: 0, y: 0, z: 1 };
        const d = 0;
        const eps = 1e-5;
        expect(classifyVertex({ x: 0, y: 0, z: 1 }, n, d, eps)).toBe(Classification.Front);
        expect(classifyVertex({ x: 0, y: 0, z: -1 }, n, d, eps)).toBe(Classification.Back);
        expect(classifyVertex({ x: 0, y: 0, z: 0 }, n, d, eps)).toBe(Classification.On);
    });

    it('should compute line-plane intersection', () => {
        const n = { x: 0, y: 0, z: 1 };
        const d = 5;
        const result = linePlaneIntersection(
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 10 },
            n, d,
        );
        expect(result).not.toBeNull();
        expect(result!.x).toBeCloseTo(0);
        expect(result!.y).toBeCloseTo(0);
        expect(result!.z).toBeCloseTo(5);
    });

    it('should return null for parallel lines', () => {
        const result = linePlaneIntersection(
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 }, 5,
        );
        expect(result).toBeNull();
    });

    it('should derive correct plane from offset points', () => {
        const p = planeFromPoints(
            { x: 0, y: 0, z: 10 },
            { x: 0, y: 1, z: 10 },
            { x: 1, y: 0, z: 10 },
        );
        expect(Math.abs(p.normal.z)).toBeCloseTo(1);
        expect(Math.abs(p.distance)).toBeCloseTo(10);
    });
});
