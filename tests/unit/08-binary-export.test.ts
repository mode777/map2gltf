import { describe, it, expect } from 'vitest';
import { exportGLB } from '../../src/pipeline/08-binary-export.js';
import { NodeIO } from '@gltf-transform/core';
import type { MaterialBatch, Cluster, BVHNode, Vertex, ParsedEntity } from '../../src/types.js';

function makeVertex(x: number, y: number, z: number): Vertex {
    return {
        position: { x, y, z },
        normal: { x: 0, y: 0, z: 1 },
        uv: { x: 0, y: 0 },
    };
}

function makeBatch(materialID: number, textureName: string, vertices: Vertex[]): MaterialBatch {
    return {
        materialID,
        textureName,
        vertices,
        indices: [0, 1, 2],
        triangleEntityIndices: [0],
        triangleBrushIndices: [0],
    };
}

function makeCluster(materialID: number, vertices: Vertex[], entityIndex: number, isWorldspawn: boolean): Cluster {
    return {
        materialID,
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
        triangleIndices: [0],
        vertices,
        indices: [0, 1, 2],
        entityIndex,
        isWorldspawn,
    };
}

function makeEntities(): ParsedEntity[] {
    return [
        { properties: { classname: 'worldspawn' }, brushes: [] },
        { properties: { classname: 'func_geo', targetname: 'mover_a' }, brushes: [] },
        { properties: { classname: 'func_geo', targetname: 'mover_b' }, brushes: [] },
    ];
}

describe('08-binary-export', () => {
    it('should produce valid GLB bytes', async () => {
        const vertices = [makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0)];
        const batches: MaterialBatch[] = [makeBatch(0, 'brick', vertices)];
        const clusters: Cluster[] = [makeCluster(0, vertices, 0, true)];
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: 1,
        }];

        const glb = await exportGLB(batches, clusters, bvh, [], makeEntities());

        // GLB magic: 0x46546C67 ("glTF" in ASCII)
        expect(glb[0]).toBe(0x67); // 'g'
        expect(glb[1]).toBe(0x6C); // 'l'
        expect(glb[2]).toBe(0x54); // 'T'
        expect(glb[3]).toBe(0x46); // 'F'
    });

    it('should be parseable by glTF IO', async () => {
        const vertices = [makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(0, 1, 0)];
        const batches: MaterialBatch[] = [makeBatch(0, 'stone', vertices)];
        const clusters: Cluster[] = [makeCluster(0, vertices, 0, true)];
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: 1,
        }];

        const glb = await exportGLB(batches, clusters, bvh, [], makeEntities());
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
            ...makeCluster(0, [v, { ...v, position: { x: 2, y: 2, z: 3 } }, { ...v, position: { x: 1, y: 3, z: 3 } }], 0, true),
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 2, z: 3 } },
        }];
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 3, z: 3 } },
            left: -1, right: -1, firstCluster: 0, clusterCount: 1,
        }];
        const batches: MaterialBatch[] = [makeBatch(0, 'test', clusters[0]!.vertices)];

        const glb = await exportGLB(batches, clusters, bvh, [], makeEntities());
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
            ...makeCluster(0, [makeVertex(0, 0, 0), makeVertex(10, 0, 0), makeVertex(5, 10, 10)], 0, true),
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
        }];
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
            left: -1, right: -1, firstCluster: 0, clusterCount: 1,
        }];
        const batches: MaterialBatch[] = [makeBatch(0, 'x', clusters[0]!.vertices)];

        const glb = await exportGLB(batches, clusters, bvh, [], makeEntities());
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
        const glb = await exportGLB([], [], bvh, [], makeEntities());
        // Should still produce valid GLB header
        expect(glb.length).toBeGreaterThan(12);
        expect(glb[0]).toBe(0x67);
    });

    it('should export one entity mesh and node per entity', async () => {
        const batches: MaterialBatch[] = [makeBatch(0, 'brick', [makeVertex(0, 0, 0), makeVertex(1, 0, 0), makeVertex(1, 1, 0)])];
        const worldClusters: Cluster[] = [makeCluster(0, batches[0]!.vertices, 0, true)];
        const entityClusters: Cluster[] = [
            makeCluster(0, [makeVertex(2, 0, 0), makeVertex(3, 0, 0), makeVertex(3, 1, 0)], 1, false),
            makeCluster(0, [makeVertex(4, 0, 0), makeVertex(5, 0, 0), makeVertex(5, 1, 0)], 2, false),
        ];
        const bvh: BVHNode[] = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: 1,
        }];

        const glb = await exportGLB(batches, worldClusters, bvh, entityClusters, makeEntities());
        const io = new NodeIO();
        const doc = await io.readBinary(glb);
        const entityNodes = doc.getRoot().listNodes().filter(node => {
            const extras = node.getExtras() as { entityIndex?: number } | null;
            return typeof extras?.entityIndex === 'number' && extras.entityIndex > 0;
        });
        expect(entityNodes).toHaveLength(2);

        const entityMeshes = doc.getRoot().listMeshes().filter(mesh => mesh.getName().startsWith('entity_'));
        expect(entityMeshes).toHaveLength(2);
    });

    it('should keep per-material primitives within a single entity mesh and preserve metadata', async () => {
        const verticesA = [makeVertex(2, 0, 0), makeVertex(3, 0, 0), makeVertex(3, 1, 0)];
        const verticesB = [makeVertex(2, 2, 0), makeVertex(3, 2, 0), makeVertex(3, 3, 0)];
        const batches: MaterialBatch[] = [
            makeBatch(0, 'brick', verticesA),
            makeBatch(1, 'stone', verticesB),
        ];
        const entityClusters: Cluster[] = [
            makeCluster(0, verticesA, 1, false),
            makeCluster(1, verticesB, 1, false),
        ];

        const glb = await exportGLB(batches, [], [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: 0,
        }], entityClusters, makeEntities());
        const io = new NodeIO();
        const doc = await io.readBinary(glb);

        const entityMesh = doc.getRoot().listMeshes().find(mesh => mesh.getName().startsWith('entity_1'));
        expect(entityMesh).toBeTruthy();
        expect(entityMesh!.listPrimitives()).toHaveLength(2);

        const entityNode = doc.getRoot().listNodes().find(node => node.getName().startsWith('entity_1'));
        const extras = entityNode!.getExtras() as { entityIndex?: number; classname?: string; targetname?: string };
        expect(extras.entityIndex).toBe(1);
        expect(extras.classname).toBe('func_geo');
        expect(extras.targetname).toBe('mover_a');
    });
});
