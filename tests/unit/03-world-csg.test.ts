import { describe, it, expect } from 'vitest';
import { worldCSG } from '../../src/pipeline/03-world-csg.js';
import { brushToPolygons } from '../../src/pipeline/02-brush-to-polygons.js';
import { parseMap } from '../../src/pipeline/01-map-parsing.js';
import * as vec3 from '../../src/math/vec3.js';
import type { ConvexPolygon, Vec3 } from '../../src/types.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname!, '..', 'fixtures');
const EPS = 1e-4;

function makeBoxPolygons(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, brushIdx: number): ConvexPolygon[] {
    const src = `
{
"classname" "worldspawn"
{
( ${minX} ${minY} ${maxZ} ) ( ${minX} ${maxY} ${maxZ} ) ( ${maxX} ${minY} ${maxZ} ) t [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( ${maxX} ${minY} ${minZ} ) ( ${maxX} ${maxY} ${minZ} ) ( ${minX} ${minY} ${minZ} ) t [ -1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( ${minX} ${minY} ${minZ} ) ( ${minX} ${maxY} ${minZ} ) ( ${minX} ${minY} ${maxZ} ) t [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( ${maxX} ${minY} ${maxZ} ) ( ${maxX} ${maxY} ${maxZ} ) ( ${maxX} ${minY} ${minZ} ) t [ 0 -1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( ${minX} ${maxY} ${maxZ} ) ( ${minX} ${maxY} ${minZ} ) ( ${maxX} ${maxY} ${maxZ} ) t [ -1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( ${minX} ${minY} ${minZ} ) ( ${minX} ${minY} ${maxZ} ) ( ${maxX} ${minY} ${minZ} ) t [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
}
}`;
    const entities = parseMap(src);
    return brushToPolygons(entities[0]!.brushes[0]!, brushIdx);
}

function polygonArea(vertices: Vec3[]): number {
    if (vertices.length < 3) return 0;
    let crossSum: Vec3 = { x: 0, y: 0, z: 0 };
    const v0 = vertices[0]!;
    for (let i = 1; i < vertices.length - 1; i++) {
        crossSum = vec3.add(crossSum, vec3.cross(vec3.sub(vertices[i]!, v0), vec3.sub(vertices[i + 1]!, v0)));
    }
    return 0.5 * vec3.length(crossSum);
}

describe('03-world-csg', () => {
    it('should remove shared face between two touching boxes', () => {
        const polysA = makeBoxPolygons(0, 0, 0, 64, 64, 64, 0);
        const polysB = makeBoxPolygons(64, 0, 0, 128, 64, 64, 1);
        expect(polysA).toHaveLength(6);
        expect(polysB).toHaveLength(6);

        const result = worldCSG([...polysA, ...polysB]);
        // Each box loses its shared face → 5+5 = 10
        expect(result.length).toBe(10);
    });

    it('should not change non-overlapping brushes', () => {
        const polysA = makeBoxPolygons(0, 0, 0, 64, 64, 64, 0);
        const polysB = makeBoxPolygons(128, 0, 0, 192, 64, 64, 1);
        const result = worldCSG([...polysA, ...polysB]);
        expect(result).toHaveLength(12);
    });

    it('should discard fully enclosed brush', () => {
        const outer = makeBoxPolygons(0, 0, 0, 128, 128, 128, 0);
        const inner = makeBoxPolygons(32, 32, 32, 96, 96, 96, 1);
        const result = worldCSG([...outer, ...inner]);
        // Inner box fully inside outer → all inner polys discarded
        // Outer should keep all 6 faces
        const outerPolys = result.filter(p => p.brushIndex === 0);
        const innerPolys = result.filter(p => p.brushIndex === 1);
        expect(outerPolys.length).toBe(6);
        expect(innerPolys.length).toBe(0);
    });

    it('should handle partial overlap with fragment survival', () => {
        const polysA = makeBoxPolygons(0, 0, 0, 64, 64, 64, 0);
        const polysB = makeBoxPolygons(32, 0, 0, 96, 64, 64, 1);
        const result = worldCSG([...polysA, ...polysB]);
        // Some hidden portions are removed; total area should decrease
        const totalAreaBefore = [...polysA, ...polysB].reduce(
            (sum, p) => sum + polygonArea(p.vertices), 0,
        );
        const totalAreaAfter = result.reduce(
            (sum, p) => sum + polygonArea(p.vertices), 0,
        );
        expect(totalAreaAfter).toBeLessThan(totalAreaBefore);
        expect(result.length).toBeGreaterThan(0);
    });

    it('should maintain polygon integrity', () => {
        const polysA = makeBoxPolygons(0, 0, 0, 64, 64, 64, 0);
        const polysB = makeBoxPolygons(64, 0, 0, 128, 64, 64, 1);
        const result = worldCSG([...polysA, ...polysB]);

        for (const poly of result) {
            // CCW winding
            const w = vec3.dot(
                vec3.cross(
                    vec3.sub(poly.vertices[1]!, poly.vertices[0]!),
                    vec3.sub(poly.vertices[2]!, poly.vertices[0]!),
                ),
                poly.face.normal,
            );
            expect(w).toBeGreaterThan(-EPS);

            // >= 3 vertices
            expect(poly.vertices.length).toBeGreaterThanOrEqual(3);

            // Vertices on plane
            for (const v of poly.vertices) {
                const d = Math.abs(vec3.dot(v, poly.face.normal) - poly.face.distance);
                expect(d).toBeLessThan(0.01);
            }
        }
    });

    it('should preserve face references', () => {
        const polysA = makeBoxPolygons(0, 0, 0, 64, 64, 64, 0);
        const polysB = makeBoxPolygons(64, 0, 0, 128, 64, 64, 1);
        const result = worldCSG([...polysA, ...polysB]);

        for (const poly of result) {
            expect(poly.face).toBeDefined();
            expect(poly.face.textureName).toBeDefined();
            expect(vec3.length(poly.face.normal)).toBeCloseTo(1, 4);
        }
    });

    it('should produce 10 polygons for two-boxes.map', () => {
        const content = readFileSync(resolve(FIXTURES, 'two-boxes.map'), 'utf-8');
        const entities = parseMap(content);
        let brushIdx = 0;
        const polys = entities[0]!.brushes.flatMap(b => brushToPolygons(b, brushIdx++));
        const result = worldCSG(polys);
        expect(result.length).toBe(10);
    });
});
