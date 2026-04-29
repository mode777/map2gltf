import { describe, it, expect } from 'vitest';
import { exportGLB } from '../../src/pipeline/08-binary-export.js';
import type { MaterialBatch, Cluster, BVHNode, Vertex, ParsedEntity, TextureMap } from '../../src/types.js';

/** Extract the JSON chunk from a GLB binary without any resource resolution */
function extractGLBJson(glb: Uint8Array): Record<string, unknown> {
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    // Skip 12-byte header (magic + version + length)
    const jsonChunkLength = view.getUint32(12, true);
    // Skip chunk type (4 bytes at offset 16)
    const jsonBytes = glb.slice(20, 20 + jsonChunkLength);
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(jsonBytes)) as Record<string, unknown>;
}

function makeVertex(x: number, y: number, z: number): Vertex {
    return {
        position: { x, y, z },
        normal: { x: 0, y: 0, z: 1 },
        uv: { x: 0, y: 0 },
    };
}

function makeBatch(materialID: number, textureName: string): MaterialBatch {
    const vertices = [makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0)];
    return {
        materialID,
        textureName,
        vertices,
        indices: [0, 1, 2],
        triangleEntityIndices: [0],
        triangleBrushIndices: [0],
    };
}

function makeCluster(materialID: number): Cluster {
    const vertices = [makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0)];
    return {
        materialID,
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
        triangleIndices: [0],
        vertices,
        indices: [0, 1, 2],
        entityIndex: 0,
        isWorldspawn: true,
    };
}

const defaultBVH: BVHNode[] = [{
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
    left: -1,
    right: -1,
    firstCluster: 0,
    clusterCount: 1,
}];

const defaultEntities: ParsedEntity[] = [
    { properties: { classname: 'worldspawn' }, brushes: [] },
];

describe('08-binary-export materials', () => {
    it('should set baseColorTexture when textureMap has a resolved entry', async () => {
        const textureMap: TextureMap = new Map([
            ['brick', { relativePath: 'brick.png', size: [128, 128] }],
        ]);
        const batches = [makeBatch(0, 'brick')];
        const clusters = [makeCluster(0)];

        const glb = await exportGLB(batches, clusters, defaultBVH, [], defaultEntities, textureMap);
        const json = extractGLBJson(glb) as any;

        expect(json.materials).toHaveLength(1);
        const mat = json.materials![0]!;
        // Should have a baseColorTexture referencing a texture index
        expect(mat.pbrMetallicRoughness?.baseColorTexture).toBeDefined();
        const texIdx = mat.pbrMetallicRoughness!.baseColorTexture!.index;
        // The texture should reference an image with our name
        const imgIdx = json.textures![texIdx]!.source;
        expect(json.images![imgIdx!]!.name).toBe('brick.png');
        expect(json.images![imgIdx!]!.mimeType).toBe('image/png');
    });

    it('should set magenta baseColorFactor when textureMap entry is null', async () => {
        const textureMap: TextureMap = new Map([
            ['brick', null],
        ]);
        const batches = [makeBatch(0, 'brick')];
        const clusters = [makeCluster(0)];

        const glb = await exportGLB(batches, clusters, defaultBVH, [], defaultEntities, textureMap);
        const json = extractGLBJson(glb) as any;

        expect(json.materials).toHaveLength(1);
        const mat = json.materials![0]!;
        expect(mat.pbrMetallicRoughness?.baseColorTexture).toBeUndefined();
        expect(mat.pbrMetallicRoughness?.baseColorFactor).toEqual([1, 0, 1, 1]);
    });

    it('should set magenta when textureMap is undefined', async () => {
        const batches = [makeBatch(0, 'stone')];
        const clusters = [makeCluster(0)];

        const glb = await exportGLB(batches, clusters, defaultBVH, [], defaultEntities, undefined);
        const json = extractGLBJson(glb) as any;

        expect(json.materials).toHaveLength(1);
        const mat = json.materials![0]!;
        expect(mat.pbrMetallicRoughness?.baseColorTexture).toBeUndefined();
        expect(mat.pbrMetallicRoughness?.baseColorFactor).toEqual([1, 0, 1, 1]);
    });

    it('should deduplicate textures shared across multiple materials', async () => {
        const textureMap: TextureMap = new Map([
            ['brick', { relativePath: 'brick.png', size: [128, 128] }],
        ]);
        // Two batches with different materialIDs but same texture name
        const batches = [makeBatch(0, 'brick'), makeBatch(1, 'brick')];
        const clusters = [makeCluster(0), makeCluster(1)];
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: 2,
        }];

        const glb = await exportGLB(batches, clusters, bvh, [], defaultEntities, textureMap);
        const json = extractGLBJson(glb) as any;

        // Only one image entry despite two materials referencing the same texture
        expect(json.images).toHaveLength(1);
        expect(json.images![0]!.name).toBe('brick.png');
        expect(json.textures).toHaveLength(1);
    });

    it('should handle mixed resolved and unresolved textures', async () => {
        const textureMap: TextureMap = new Map([
            ['brick', { relativePath: 'brick.png', size: [128, 128] }],
            ['missing', null],
        ]);
        const batches = [makeBatch(0, 'brick'), makeBatch(1, 'missing')];
        const clusters = [makeCluster(0), makeCluster(1)];
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: 2,
        }];

        const glb = await exportGLB(batches, clusters, bvh, [], defaultEntities, textureMap);
        const json = extractGLBJson(glb) as any;

        expect(json.materials).toHaveLength(2);
        // One material should have a texture, the other should have magenta
        const brickMat = json.materials!.find(m => m.name === 'brick')!;
        expect(brickMat.pbrMetallicRoughness?.baseColorTexture).toBeDefined();
        const missingMat = json.materials!.find(m => m.name === 'missing')!;
        expect(missingMat.pbrMetallicRoughness?.baseColorFactor).toEqual([1, 0, 1, 1]);
    });
});
