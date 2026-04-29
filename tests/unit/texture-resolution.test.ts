import { describe, it, expect, vi } from 'vitest';
import { resolveTextures } from '../../src/pipeline/texture-resolution.js';
import type { ConvexPolygon, TextureProvider, TextureInfo, Diagnostics } from '../../src/types.js';
import { createDiagnostics } from '../../src/types.js';

function makePoly(textureName: string): ConvexPolygon {
    return {
        vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }],
        face: {
            planePoints: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }],
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
        brushIndex: 0,
        entityIndex: 0,
    };
}

function mockProvider(results: Record<string, TextureInfo | null>): TextureProvider {
    return {
        resolve: vi.fn(async (name: string) => results[name] ?? null),
    };
}

describe('texture-resolution', () => {
    it('should return resolved texture info from provider', async () => {
        const provider = mockProvider({
            brick: { relativePath: 'brick.png', size: [128, 128] },
        });
        const diag = createDiagnostics();
        const result = await resolveTextures([makePoly('brick')], provider, diag);

        expect(result.get('brick')).toEqual({ relativePath: 'brick.png', size: [128, 128] });
        expect(diag.info).toEqual([
            {
                step: 'texture-resolution',
                message: "Texture 'brick' resolved to 'brick.png'",
            },
        ]);
        expect(diag.warnings).toHaveLength(0);
    });

    it('should return null and warn for unresolved texture', async () => {
        const provider = mockProvider({});
        const diag = createDiagnostics();
        const result = await resolveTextures([makePoly('missing')], provider, diag);

        expect(result.get('missing')).toBeNull();
        expect(diag.info).toHaveLength(0);
        expect(diag.warnings).toHaveLength(1);
        expect(diag.warnings[0]!.step).toBe('texture-resolution');
        expect(diag.warnings[0]!.message).toContain('missing');
    });

    it('should set all textures to null and warn when no provider', async () => {
        const diag = createDiagnostics();
        const polys = [makePoly('brick'), makePoly('stone')];
        const result = await resolveTextures(polys, undefined, diag);

        expect(result.get('brick')).toBeNull();
        expect(result.get('stone')).toBeNull();
        expect(diag.info).toHaveLength(0);
        expect(diag.warnings).toHaveLength(2);
    });

    it('should resolve unique texture names only once', async () => {
        const provider = mockProvider({
            brick: { relativePath: 'brick.png', size: [64, 64] },
        });
        const diag = createDiagnostics();
        // 3 polygons all using 'brick'
        const polys = [makePoly('brick'), makePoly('brick'), makePoly('brick')];
        await resolveTextures(polys, provider, diag);

        expect(provider.resolve).toHaveBeenCalledTimes(1);
        expect(diag.info).toHaveLength(1);
    });

    it('should resolve all textures in parallel', async () => {
        const names = Array.from({ length: 10 }, (_, i) => `tex_${i}`);
        const results: Record<string, TextureInfo> = {};
        for (const name of names) {
            results[name] = { relativePath: `${name}.png`, size: [64, 64] };
        }
        const provider = mockProvider(results);
        const diag = createDiagnostics();
        const polys = names.map(n => makePoly(n));

        const map = await resolveTextures(polys, provider, diag);

        expect(map.size).toBe(10);
        expect(provider.resolve).toHaveBeenCalledTimes(10);
        expect(diag.info).toHaveLength(10);
        expect(diag.warnings).toHaveLength(0);
    });
});
