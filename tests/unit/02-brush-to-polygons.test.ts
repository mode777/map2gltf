import { describe, it, expect } from 'vitest';
import { brushToPolygons } from '../../src/pipeline/02-brush-to-polygons.js';
import { parseMap } from '../../src/pipeline/01-map-parsing.js';
import * as vec3 from '../../src/math/vec3.js';
import type { ParsedBrush, Vec3 } from '../../src/types.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname!, '..', 'fixtures');
const EPS = 1e-4;

function makeBoxBrush(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): ParsedBrush {
    const src = `
{
"classname" "worldspawn"
{
( ${minX} ${minY} ${maxZ} ) ( ${minX} ${maxY} ${maxZ} ) ( ${maxX} ${minY} ${maxZ} ) top [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( ${maxX} ${minY} ${minZ} ) ( ${maxX} ${maxY} ${minZ} ) ( ${minX} ${minY} ${minZ} ) bottom [ -1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( ${minX} ${minY} ${minZ} ) ( ${minX} ${maxY} ${minZ} ) ( ${minX} ${minY} ${maxZ} ) left [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( ${maxX} ${minY} ${maxZ} ) ( ${maxX} ${maxY} ${maxZ} ) ( ${maxX} ${minY} ${minZ} ) right [ 0 -1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( ${minX} ${maxY} ${maxZ} ) ( ${minX} ${maxY} ${minZ} ) ( ${maxX} ${maxY} ${maxZ} ) front [ -1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( ${minX} ${minY} ${minZ} ) ( ${minX} ${minY} ${maxZ} ) ( ${maxX} ${minY} ${minZ} ) back [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
}
}`;
    const entities = parseMap(src);
    return entities[0]!.brushes[0]!;
}

function polygonArea(vertices: Vec3[]): number {
    if (vertices.length < 3) return 0;
    let crossSum: Vec3 = { x: 0, y: 0, z: 0 };
    const v0 = vertices[0]!;
    for (let i = 1; i < vertices.length - 1; i++) {
        const edge1 = vec3.sub(vertices[i]!, v0);
        const edge2 = vec3.sub(vertices[i + 1]!, v0);
        crossSum = vec3.add(crossSum, vec3.cross(edge1, edge2));
    }
    return 0.5 * vec3.length(crossSum);
}

describe('02-brush-to-polygons', () => {
    it('should produce 6 polygons for an axis-aligned box', () => {
        const brush = makeBoxBrush(0, 0, 0, 64, 64, 64);
        const polys = brushToPolygons(brush, 0);
        expect(polys).toHaveLength(6);
        for (const poly of polys) {
            expect(poly.vertices).toHaveLength(4);
        }
    });

    it('should produce CCW winding order', () => {
        const brush = makeBoxBrush(0, 0, 0, 64, 64, 64);
        const polys = brushToPolygons(brush, 0);
        for (const poly of polys) {
            const winding = vec3.dot(
                vec3.cross(
                    vec3.sub(poly.vertices[1]!, poly.vertices[0]!),
                    vec3.sub(poly.vertices[2]!, poly.vertices[0]!),
                ),
                poly.face.normal,
            );
            expect(winding).toBeGreaterThan(0);
        }
    });

    it('should place all vertices on the face plane', () => {
        const brush = makeBoxBrush(0, 0, 0, 64, 64, 64);
        const polys = brushToPolygons(brush, 0);
        for (const poly of polys) {
            for (const v of poly.vertices) {
                const d = Math.abs(vec3.dot(v, poly.face.normal) - poly.face.distance);
                expect(d).toBeLessThan(EPS);
            }
        }
    });

    it('should handle a wedge/prism brush (5 faces)', () => {
        const content = readFileSync(resolve(FIXTURES, 'wedge.map'), 'utf-8');
        const entities = parseMap(content);
        const brush = entities[0]!.brushes[0]!;
        const polys = brushToPolygons(brush, 0);
        expect(polys).toHaveLength(5);

        const vertCounts = polys.map(p => p.vertices.length).sort();
        // Should have 2 triangles and 3 quads
        expect(vertCounts.filter(c => c === 3)).toHaveLength(2);
        expect(vertCounts.filter(c => c === 4)).toHaveLength(3);
    });

    it('should not produce degenerate polygons', () => {
        const brush = makeBoxBrush(0, 0, 0, 64, 64, 64);
        const polys = brushToPolygons(brush, 0);
        for (const poly of polys) {
            expect(poly.vertices.length).toBeGreaterThanOrEqual(3);
            expect(polygonArea(poly.vertices)).toBeGreaterThan(0);
        }
    });

    it('should handle a brush near the edge of map space', () => {
        const brush = makeBoxBrush(32000, 32000, 32000, 32064, 32064, 32064);
        const polys = brushToPolygons(brush, 0);
        expect(polys).toHaveLength(6);
        for (const poly of polys) {
            expect(poly.vertices).toHaveLength(4);
            for (const v of poly.vertices) {
                expect(v.x).toBeGreaterThanOrEqual(32000 - EPS);
                expect(v.x).toBeLessThanOrEqual(32064 + EPS);
            }
        }
    });

    it('should preserve face references', () => {
        const brush = makeBoxBrush(0, 0, 0, 64, 64, 64);
        const polys = brushToPolygons(brush, 0);
        for (const poly of polys) {
            expect(poly.face.textureName).toBeDefined();
            expect(vec3.length(poly.face.normal)).toBeCloseTo(1, 4);
            expect(poly.brushIndex).toBe(0);
            expect(poly.entityIndex).toBe(0);
        }
    });

    it('should produce correct total surface area for box.map', () => {
        const content = readFileSync(resolve(FIXTURES, 'box.map'), 'utf-8');
        const entities = parseMap(content);
        const brush = entities[0]!.brushes[0]!;
        const polys = brushToPolygons(brush, 0);

        // Box from fixture: (-64,-64,-16) to (64,64,16), size 128x128x32
        const totalArea = polys.reduce((sum, p) => sum + polygonArea(p.vertices), 0);
        // 2*(128*128) + 4*(128*32) = 32768 + 16384 = 49152
        expect(totalArea).toBeCloseTo(49152, -1);
    });

    it('should propagate entityIndex parameter', () => {
        const brush = makeBoxBrush(0, 0, 0, 64, 64, 64);
        const polys = brushToPolygons(brush, 3, 2);
        for (const poly of polys) {
            expect(poly.entityIndex).toBe(2);
            expect(poly.brushIndex).toBe(3);
        }
    });

    it('should default entityIndex to 0 (worldspawn)', () => {
        const brush = makeBoxBrush(0, 0, 0, 64, 64, 64);
        const polys = brushToPolygons(brush, 0);
        for (const poly of polys) {
            expect(poly.entityIndex).toBe(0);
        }
    });
});
