import { describe, it, expect } from 'vitest';
import { parseMap } from '../../src/pipeline/01-map-parsing.js';
import { createDiagnostics } from '../../src/types.js';
import * as vec3 from '../../src/math/vec3.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname!, '..', 'fixtures');

describe('01-map-parsing', () => {
    it('should parse a minimal valid brush (6-sided box)', () => {
        const src = `
{
"classname" "worldspawn"
{
( 0 0 64 ) ( 0 64 64 ) ( 64 0 64 ) top [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 64 0 0 ) ( 64 64 0 ) ( 0 0 0 ) bottom [ -1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 0 0 0 ) ( 0 64 0 ) ( 0 0 64 ) left [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 64 0 64 ) ( 64 64 64 ) ( 64 0 0 ) right [ 0 -1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 64 64 ) ( 0 64 0 ) ( 64 64 64 ) front [ -1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 0 0 ) ( 0 0 64 ) ( 64 0 0 ) back [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
}
}`;
        const entities = parseMap(src);
        expect(entities).toHaveLength(1);
        expect(entities[0]!.brushes).toHaveLength(1);
        expect(entities[0]!.brushes[0]!.faces).toHaveLength(6);

        for (const face of entities[0]!.brushes[0]!.faces) {
            expect(vec3.length(face.normal)).toBeCloseTo(1, 4);
        }
    });

    it('should parse entity key-value pairs', () => {
        const src = `
{
"classname" "worldspawn"
"message" "Hello"
}`;
        const entities = parseMap(src);
        expect(entities[0]!.properties['classname']).toBe('worldspawn');
        expect(entities[0]!.properties['message']).toBe('Hello');
    });

    it('should derive correct plane normal and distance', () => {
        // Face on the z=64 plane: normal should be (0,0,1), distance 64
        const src = `
{
"classname" "worldspawn"
{
( 0 0 64 ) ( 0 64 64 ) ( 64 0 64 ) top [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 64 0 0 ) ( 64 64 0 ) ( 0 0 0 ) bottom [ -1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 0 0 0 ) ( 0 64 0 ) ( 0 0 64 ) left [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 64 0 64 ) ( 64 64 64 ) ( 64 0 0 ) right [ 0 -1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 64 64 ) ( 0 64 0 ) ( 64 64 64 ) front [ -1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 0 0 ) ( 0 0 64 ) ( 64 0 0 ) back [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
}
}`;
        const entities = parseMap(src);
        const topFace = entities[0]!.brushes[0]!.faces[0]!;
        // Check the face's normal is axis-aligned z
        expect(Math.abs(topFace.normal.z)).toBeCloseTo(1, 4);
        expect(Math.abs(topFace.distance)).toBeCloseTo(64, 4);
    });

    it('should preserve Valve 220 texture axes', () => {
        const src = `
{
"classname" "worldspawn"
{
( 0 0 64 ) ( 0 64 64 ) ( 64 0 64 ) brick [ 0.707 0.707 0 16 ] [ 0 0 -1 32 ] 0 0.5 0.5
( 64 0 0 ) ( 64 64 0 ) ( 0 0 0 ) brick [ -1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 0 0 0 ) ( 0 64 0 ) ( 0 0 64 ) brick [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 64 0 64 ) ( 64 64 64 ) ( 64 0 0 ) brick [ 0 -1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 64 64 ) ( 0 64 0 ) ( 64 64 64 ) brick [ -1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 0 0 ) ( 0 0 64 ) ( 64 0 0 ) brick [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
}
}`;
        const entities = parseMap(src);
        const face = entities[0]!.brushes[0]!.faces[0]!;
        expect(face.texAxisU.x).toBeCloseTo(0.707);
        expect(face.texAxisU.y).toBeCloseTo(0.707);
        expect(face.texOffsetU).toBeCloseTo(16);
        expect(face.texAxisV.z).toBeCloseTo(-1);
        expect(face.texOffsetV).toBeCloseTo(32);
        expect(face.texScaleU).toBeCloseTo(0.5);
        expect(face.texScaleV).toBeCloseTo(0.5);
    });

    it('should parse multi-entity in file order', () => {
        const src = `
{
"classname" "worldspawn"
}
{
"classname" "func_wall"
}
{
"classname" "light"
}`;
        const entities = parseMap(src);
        expect(entities).toHaveLength(3);
        expect(entities[0]!.properties['classname']).toBe('worldspawn');
        expect(entities[1]!.properties['classname']).toBe('func_wall');
        expect(entities[2]!.properties['classname']).toBe('light');
    });

    it('should reject degenerate brush with fewer than 4 faces', () => {
        const diag = createDiagnostics();
        const src = `
{
"classname" "worldspawn"
{
( 0 0 0 ) ( 0 1 0 ) ( 1 0 0 ) a [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 0 0 0 ) ( 1 0 0 ) ( 0 0 1 ) b [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 0 0 ) ( 0 0 1 ) ( 0 1 0 ) c [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
}
}`;
        const entities = parseMap(src, diag);
        expect(entities[0]!.brushes).toHaveLength(0);
        expect(diag.warnings.length).toBeGreaterThan(0);
    });

    it('should handle comment lines', () => {
        const src = `
// This is a comment
{
"classname" "worldspawn"
// Another comment
{
// comment inside brush
( 0 0 64 ) ( 0 64 64 ) ( 64 0 64 ) top [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 64 0 0 ) ( 64 64 0 ) ( 0 0 0 ) bottom [ -1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 0 0 0 ) ( 0 64 0 ) ( 0 0 64 ) left [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 64 0 64 ) ( 64 64 64 ) ( 64 0 0 ) right [ 0 -1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 64 64 ) ( 0 64 0 ) ( 64 64 64 ) front [ -1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 0 0 ) ( 0 0 64 ) ( 64 0 0 ) back [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
}
}`;
        const entities = parseMap(src);
        expect(entities).toHaveLength(1);
        expect(entities[0]!.brushes).toHaveLength(1);
        expect(entities[0]!.brushes[0]!.faces).toHaveLength(6);
    });

    it('should parse non-integer coordinates', () => {
        const src = `
{
"classname" "worldspawn"
{
( 0.5 1.25 -3.75 ) ( 0.5 2.25 -3.75 ) ( 1.5 1.25 -3.75 ) t [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 1.5 1.25 -4.75 ) ( 1.5 2.25 -4.75 ) ( 0.5 1.25 -4.75 ) t [ -1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 0.5 1.25 -4.75 ) ( 0.5 2.25 -4.75 ) ( 0.5 1.25 -3.75 ) t [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 1.5 1.25 -3.75 ) ( 1.5 2.25 -3.75 ) ( 1.5 1.25 -4.75 ) t [ 0 -1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0.5 2.25 -3.75 ) ( 0.5 2.25 -4.75 ) ( 1.5 2.25 -3.75 ) t [ -1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0.5 1.25 -4.75 ) ( 0.5 1.25 -3.75 ) ( 1.5 1.25 -4.75 ) t [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
}
}`;
        const entities = parseMap(src);
        const face = entities[0]!.brushes[0]!.faces[0]!;
        expect(face.planePoints[0].x).toBe(0.5);
        expect(face.planePoints[0].y).toBe(1.25);
        expect(face.planePoints[0].z).toBe(-3.75);
    });

    it('should parse box.map fixture and round-trip normals', () => {
        const content = readFileSync(resolve(FIXTURES, 'box.map'), 'utf-8');
        const entities = parseMap(content);
        expect(entities).toHaveLength(1);
        expect(entities[0]!.brushes.length).toBeGreaterThanOrEqual(1);

        for (const brush of entities[0]!.brushes) {
            for (const face of brush.faces) {
                // Re-derive plane from planePoints
                const [p1, p2, p3] = face.planePoints;
                const v1 = vec3.sub(p3, p1);
                const v2 = vec3.sub(p2, p1);
                const n = vec3.normalize(vec3.cross(v1, v2));
                const d = vec3.dot(n, p1);
                expect(Math.abs(vec3.dot(n, face.normal))).toBeCloseTo(1, 4);
                expect(Math.abs(d - face.distance)).toBeLessThan(0.001);
            }
        }
    });
});
