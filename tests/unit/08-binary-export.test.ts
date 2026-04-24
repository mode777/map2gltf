import { describe, it, expect } from 'vitest';
import { exportGLB } from '../../src/pipeline/08-binary-export.js';
import { Document, NodeIO } from '@gltf-transform/core';
import type { MaterialBatch, Cluster, BVHNode, Vertex } from '../../src/types.js';

function makeVertex(x: number, y: number, z: number): Vertex {
    return {
        position: { x, y, z },
        normal: { x: 0, y: 0, z: 1 },
        uv: { x: 0, y: 0 },
    };
}

describe('08-binary-export', () => {
    it('should produce valid GLB bytes', async () => {
        const batches: MaterialBatch[] = [{
            materialID: 0,
            textureName: 'brick',
            vertices: [makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0)],
            indices: [0, 1, 2],
        }];
        const clusters: Cluster[] = [{
            materialID: 0,
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
            triangleIndices: [0],
            vertices: batches[0]!.vertices,
            indices: [0, 1, 2],
        }];
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: 1,
        }];

        const glb = await exportGLB(batches, clusters, bvh);

        // GLB magic: 0x46546C67 ("glTF" in ASCII)
        expect(glb[0]).toBe(0x67); // 'g'
        expect(glb[1]).toBe(0x6C); // 'l'
        expect(glb[2]).toBe(0x54); // 'T'
        expect(glb[3]).toBe(0x46); // 'F'
    });

    it('should be parseable by glTF IO', async () => {
        const batches: MaterialBatch[] = [{
            materialID: 0,
            textureName: 'stone',
            vertices: [makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(0, 1, 0)],
            indices: [0, 1, 2],
        }];
        const clusters: Cluster[] = [{
            materialID: 0,
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
            triangleIndices: [0],
            vertices: batches[0]!.vertices,
            indices: [0, 1, 2],
        }];
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: 1,
        }];

        const glb = await exportGLB(batches, clusters, bvh);
        const io = new NodeIO();
        const doc = await io.readBinary(glb);
        const scene = doc.getRoot().listScenes()[0];
        expect(scene).toBeTruthy();

        const materials = doc.getRoot().listMaterials();
        expect(materials.length).toBeGreaterThanOrEqual(1);
    });

    it('should apply coordinate conversion (Z-up to Y-up)', async () => {
        // A vertex at (1, 2, 3) in Quake → (1, 3, -2) in glTF
        const v: Vertex = {
            position: { x: 1, y: 2, z: 3 },
            normal: { x: 0, y: 0, z: 1 },
            uv: { x: 0, y: 0 },
        };
        const clusters: Cluster[] = [{
            materialID: 0,
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 2, z: 3 } },
            triangleIndices: [0],
            vertices: [v, { ...v, position: { x: 2, y: 2, z: 3 } }, { ...v, position: { x: 1, y: 3, z: 3 } }],
            indices: [0, 1, 2],
        }];
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 3, z: 3 } },
            left: -1, right: -1, firstCluster: 0, clusterCount: 1,
        }];
        const batches: MaterialBatch[] = [{
            materialID: 0,
            textureName: 'test',
            vertices: clusters[0]!.vertices,
            indices: [0, 1, 2],
        }];

        const glb = await exportGLB(batches, clusters, bvh);
        const io = new NodeIO();
        const doc = await io.readBinary(glb);

        const meshes = doc.getRoot().listMeshes();
        expect(meshes.length).toBe(1);
        const primitives = meshes[0]!.listPrimitives();
        expect(primitives.length).toBe(1);
        const posAccessor = primitives[0]!.getAttribute('POSITION');
        expect(posAccessor).toBeTruthy();

        // First vertex: (1,2,3) → (1, 3, -2)
        const pos = posAccessor!.getElement(0, [0, 0, 0]);
        expect(pos[0]).toBeCloseTo(1, 4);
        expect(pos[1]).toBeCloseTo(3, 4);
        expect(pos[2]).toBeCloseTo(-2, 4);
    });

    it('should include BVH AABB in node extras', async () => {
        const clusters: Cluster[] = [{
            materialID: 0,
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
            triangleIndices: [0],
            vertices: [makeVertex(0, 0, 0), makeVertex(10, 0, 0), makeVertex(5, 10, 10)],
            indices: [0, 1, 2],
        }];
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
            left: -1, right: -1, firstCluster: 0, clusterCount: 1,
        }];
        const batches: MaterialBatch[] = [{
            materialID: 0, textureName: 'x',
            vertices: clusters[0]!.vertices,
            indices: [0, 1, 2],
        }];

        const glb = await exportGLB(batches, clusters, bvh);
        const io = new NodeIO();
        const doc = await io.readBinary(glb);
        const nodes = doc.getRoot().listNodes();
        expect(nodes.length).toBeGreaterThanOrEqual(1);

        const rootExtras = nodes[0]!.getExtras();
        expect(rootExtras).toHaveProperty('aabb');
    });

    it('should handle empty geometry gracefully', async () => {
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
            left: -1, right: -1, firstCluster: 0, clusterCount: 0,
        }];
        const glb = await exportGLB([], [], bvh);
        // Should still produce valid GLB header
        expect(glb.length).toBeGreaterThan(12);
        expect(glb[0]).toBe(0x67);
    });
});
