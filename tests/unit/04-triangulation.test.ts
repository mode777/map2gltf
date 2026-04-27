import { describe, it, expect } from 'vitest';
import { triangulate } from '../../src/pipeline/04-triangulation.js';
import type { ConvexPolygon, Vec3 } from '../../src/types.js';
import { createDiagnostics } from '../../src/types.js';
import * as vec3 from '../../src/math/vec3.js';

function makePoly(vertices: Vec3[], textureName = 'test', brushIndex = 0, entityIndex = 0): ConvexPolygon {
    return {
        vertices,
        face: {
            planePoints: [vertices[0]!, vertices[1]!, vertices[2]!],
            normal: { x: 0, y: 0, z: 1 },
            distance: 0,
            textureName,
            texAxisU: { x: 1, y: 0, z: 0 },
            texOffsetU: 0,
            texAxisV: { x: 0, y: -1, z: 0 },
            texOffsetV: 0,
            texScaleU: 1,
            texScaleV: 1,
        },
        brushIndex,
        entityIndex,
    };
}

describe('04-triangulation', () => {
    it('should triangulate a quad into 2 triangles', () => {
        const poly = makePoly([
            { x: 0, y: 0, z: 0 },
            { x: 64, y: 0, z: 0 },
            { x: 64, y: 64, z: 0 },
            { x: 0, y: 64, z: 0 },
        ]);
        const mesh = triangulate([poly], new Map());
        expect(mesh.indices.length).toBe(6);
        expect(mesh.triangleMaterials).toHaveLength(2);
    });

    it('should pass through a triangle as-is', () => {
        const poly = makePoly([
            { x: 0, y: 0, z: 0 },
            { x: 64, y: 0, z: 0 },
            { x: 32, y: 64, z: 0 },
        ]);
        const mesh = triangulate([poly], new Map());
        expect(mesh.indices.length).toBe(3);
        expect(mesh.triangleMaterials).toHaveLength(1);
    });

    it('should fan-triangulate a hexagon into 4 triangles', () => {
        const r = 32;
        const verts: Vec3[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            verts.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r, z: 0 });
        }
        const poly = makePoly(verts);
        const mesh = triangulate([poly], new Map());
        expect(mesh.indices.length).toBe(12); // 4 triangles * 3
        expect(mesh.triangleMaterials).toHaveLength(4);
    });

    it('should assign flat normals from face normal', () => {
        const normal = { x: 0, y: 0, z: 1 };
        const poly: ConvexPolygon = {
            vertices: [
                { x: 0, y: 0, z: 5 },
                { x: 64, y: 0, z: 5 },
                { x: 64, y: 64, z: 5 },
            ],
            face: {
                planePoints: [{ x: 0, y: 0, z: 5 }, { x: 64, y: 0, z: 5 }, { x: 64, y: 64, z: 5 }],
                normal,
                distance: 5,
                textureName: 'test',
                texAxisU: { x: 1, y: 0, z: 0 },
                texOffsetU: 0,
                texAxisV: { x: 0, y: -1, z: 0 },
                texOffsetV: 0,
                texScaleU: 1,
                texScaleV: 1,
            },
            brushIndex: 0,
            entityIndex: 0,
        };
        const mesh = triangulate([poly], new Map());
        for (const v of mesh.vertices) {
            expect(v.normal).toEqual(normal);
        }
    });

    it('should compute UVs for axis-aligned face', () => {
        const poly = makePoly([
            { x: 0, y: 0, z: 0 },
            { x: 64, y: 0, z: 0 },
            { x: 64, y: 64, z: 0 },
            { x: 0, y: 64, z: 0 },
        ]);
        // texAxisU = (1,0,0), texAxisV = (0,-1,0), scale=1, offset=0, default tex 64x64
        const mesh = triangulate([poly], new Map());
        // Vertex at (32, 32, 0): u = 32/1/64 = 0.5, v = -32/1/64 = -0.5
        const v = mesh.vertices[0]!; // (0,0,0)
        expect(v.uv.x).toBeCloseTo(0);
        expect(v.uv.y).toBeCloseTo(0);
    });

    it('should compute UVs with rotated axes', () => {
        const s = Math.SQRT1_2; // ~0.707
        const poly: ConvexPolygon = {
            vertices: [{ x: 0, y: 0, z: 0 }, { x: 64, y: 0, z: 0 }, { x: 64, y: 64, z: 0 }],
            face: {
                planePoints: [{ x: 0, y: 0, z: 0 }, { x: 64, y: 0, z: 0 }, { x: 64, y: 64, z: 0 }],
                normal: { x: 0, y: 0, z: 1 },
                distance: 0,
                textureName: 'test',
                texAxisU: { x: s, y: s, z: 0 },
                texOffsetU: 0,
                texAxisV: { x: -s, y: s, z: 0 },
                texOffsetV: 0,
                texScaleU: 1,
                texScaleV: 1,
            },
            brushIndex: 0,
            entityIndex: 0,
        };
        const mesh = triangulate([poly], new Map());
        // At (64, 0, 0): u = dot((64,0,0), (s,s,0))/1/64 = 64*s/64 = s ≈ 0.707
        const v = mesh.vertices[1]!;
        expect(v.uv.x).toBeCloseTo(s, 3);
    });

    it('should emit warning and use default for unknown texture', () => {
        const diag = createDiagnostics();
        const poly = makePoly([
            { x: 0, y: 0, z: 0 },
            { x: 64, y: 0, z: 0 },
            { x: 64, y: 64, z: 0 },
        ], 'unknown_tex');
        triangulate([poly], new Map(), diag);
        expect(diag.warnings.length).toBeGreaterThan(0);
    });

    it('should produce valid indices', () => {
        const poly = makePoly([
            { x: 0, y: 0, z: 0 },
            { x: 64, y: 0, z: 0 },
            { x: 64, y: 64, z: 0 },
            { x: 0, y: 64, z: 0 },
        ]);
        const mesh = triangulate([poly], new Map());
        for (const idx of mesh.indices) {
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(mesh.vertices.length);
        }
    });

    it('should produce triangleEntityIndices and triangleBrushIndices arrays', () => {
        const poly1 = makePoly(
            [{ x: 0, y: 0, z: 0 }, { x: 64, y: 0, z: 0 }, { x: 64, y: 64, z: 0 }, { x: 0, y: 64, z: 0 }],
            'test', 0, 0,
        );
        const poly2 = makePoly(
            [{ x: 100, y: 0, z: 0 }, { x: 164, y: 0, z: 0 }, { x: 164, y: 64, z: 0 }],
            'test', 1, 1,
        );
        const poly3 = makePoly(
            [{ x: 200, y: 0, z: 0 }, { x: 264, y: 0, z: 0 }, { x: 264, y: 64, z: 0 }],
            'test', 2, 2,
        );
        const mesh = triangulate([poly1, poly2, poly3], new Map());
        const triCount = mesh.indices.length / 3;
        expect(mesh.triangleEntityIndices).toHaveLength(triCount);
        expect(mesh.triangleBrushIndices).toHaveLength(triCount);
    });

    it('should assign correct entityIndex per triangle', () => {
        const poly0 = makePoly(
            [{ x: 0, y: 0, z: 0 }, { x: 64, y: 0, z: 0 }, { x: 64, y: 64, z: 0 }],
            'test', 0, 0,
        );
        const poly1 = makePoly(
            [{ x: 100, y: 0, z: 0 }, { x: 164, y: 0, z: 0 }, { x: 164, y: 64, z: 0 }],
            'test', 1, 1,
        );
        const mesh = triangulate([poly0, poly1], new Map());
        expect(mesh.triangleEntityIndices[0]).toBe(0);
        expect(mesh.triangleEntityIndices[1]).toBe(1);
    });

    it('should assign correct brushIndex per triangle', () => {
        const poly0 = makePoly(
            [{ x: 0, y: 0, z: 0 }, { x: 64, y: 0, z: 0 }, { x: 64, y: 64, z: 0 }],
            'test', 5, 0,
        );
        const poly1 = makePoly(
            [{ x: 100, y: 0, z: 0 }, { x: 164, y: 0, z: 0 }, { x: 164, y: 64, z: 0 }],
            'test', 7, 0,
        );
        const poly2 = makePoly(
            [{ x: 200, y: 0, z: 0 }, { x: 264, y: 0, z: 0 }, { x: 264, y: 64, z: 0 }],
            'test', 5, 0,
        );
        const mesh = triangulate([poly0, poly1, poly2], new Map());
        expect(mesh.triangleBrushIndices[0]).toBe(5);
        expect(mesh.triangleBrushIndices[1]).toBe(7);
        expect(mesh.triangleBrushIndices[2]).toBe(5);
    });

    it('should not produce geometry for CLIP-textured polygons when filtered', () => {
        const visible = makePoly(
            [{ x: 0, y: 0, z: 0 }, { x: 64, y: 0, z: 0 }, { x: 64, y: 64, z: 0 }, { x: 0, y: 64, z: 0 }],
            'brick', 0, 0,
        );
        const clipPoly = makePoly(
            [{ x: 100, y: 0, z: 0 }, { x: 164, y: 0, z: 0 }, { x: 164, y: 64, z: 0 }, { x: 100, y: 64, z: 0 }],
            'clip', 1, 0,
        );
        // The compiler filters CLIP polygons before triangulation;
        // verify that triangulating only non-CLIP polygons works correctly
        const allPolygons = [visible, clipPoly];
        const visiblePolygons = allPolygons.filter(p => p.face.textureName !== 'clip');
        const mesh = triangulate(visiblePolygons, new Map());
        // Only the brick quad should produce triangles (2 triangles)
        expect(mesh.indices.length / 3).toBe(2);
        expect(mesh.triangleMaterials.every(m => m === 'brick')).toBe(true);
        expect(mesh.triangleMaterials).not.toContain('clip');
    });
});
