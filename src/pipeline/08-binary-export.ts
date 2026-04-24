import { Document, NodeIO, Buffer as GltfBuffer } from '@gltf-transform/core';
import type { MaterialBatch, Cluster, BVHNode, Vec3 } from '../types.js';

function convertCoord(v: Vec3): [number, number, number] {
    // Quake Z-up → glTF Y-up: rotate -90° around X
    // (x, y, z) → (x, z, -y)
    return [v.x, v.z, -v.y];
}

function convertAABB(aabb: { min: Vec3; max: Vec3 }): { min: number[]; max: number[] } {
    const corners = [
        convertCoord(aabb.min),
        convertCoord(aabb.max),
        convertCoord({ x: aabb.min.x, y: aabb.min.y, z: aabb.max.z }),
        convertCoord({ x: aabb.max.x, y: aabb.max.y, z: aabb.min.z }),
        convertCoord({ x: aabb.min.x, y: aabb.max.y, z: aabb.min.z }),
        convertCoord({ x: aabb.max.x, y: aabb.min.y, z: aabb.max.z }),
        convertCoord({ x: aabb.min.x, y: aabb.max.y, z: aabb.max.z }),
        convertCoord({ x: aabb.max.x, y: aabb.min.y, z: aabb.min.z }),
    ];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const c of corners) {
        for (let i = 0; i < 3; i++) {
            if (c[i]! < min[i]!) min[i] = c[i]!;
            if (c[i]! > max[i]!) max[i] = c[i]!;
        }
    }
    return { min, max };
}

export async function exportGLB(
    batches: MaterialBatch[],
    clusters: Cluster[],
    bvh: BVHNode[],
): Promise<Uint8Array> {
    const doc = new Document();
    doc.getRoot().getAsset().generator = 'map2gltf';

    const scene = doc.createScene('map');
    const buf = doc.createBuffer();

    // Create materials (one per batch, named by texture)
    const materialMap = new Map<number, ReturnType<Document['createMaterial']>>();
    for (const batch of batches) {
        if (!materialMap.has(batch.materialID)) {
            const mat = doc.createMaterial(batch.textureName)
                .setBaseColorFactor([1, 1, 1, 1])
                .setMetallicFactor(0)
                .setRoughnessFactor(1);
            materialMap.set(batch.materialID, mat);
        }
    }

    // Build glTF nodes for each BVH node
    const gltfNodes: Array<ReturnType<Document['createNode']>> = [];

    for (let ni = 0; ni < bvh.length; ni++) {
        const bvhNode = bvh[ni]!;
        const isLeaf = bvhNode.left === -1;
        const name = isLeaf ? `bvh_leaf_${ni}` : `bvh_${ni}`;
        const gNode = doc.createNode(name);

        const aabb = convertAABB(bvhNode.bounds);
        gNode.setExtras({
            nodeType: isLeaf ? 'leaf' : 'interior',
            aabb: { min: aabb.min, max: aabb.max },
        });

        if (isLeaf && bvhNode.clusterCount > 0) {
            const mesh = doc.createMesh(`mesh_${ni}`);

            for (let ci = bvhNode.firstCluster; ci < bvhNode.firstCluster + bvhNode.clusterCount; ci++) {
                const cluster = clusters[ci];
                if (!cluster) continue;

                const positions: number[] = [];
                const normals: number[] = [];
                const texcoords: number[] = [];

                for (const vert of cluster.vertices) {
                    const [px, py, pz] = convertCoord(vert.position);
                    positions.push(px, py, pz);
                    const [nx, ny, nz] = convertCoord(vert.normal);
                    normals.push(nx, ny, nz);
                    texcoords.push(vert.uv.x, vert.uv.y);
                }

                const posAccessor = doc.createAccessor()
                    .setType('VEC3')
                    .setArray(new Float32Array(positions))
                    .setBuffer(buf);

                const normAccessor = doc.createAccessor()
                    .setType('VEC3')
                    .setArray(new Float32Array(normals))
                    .setBuffer(buf);

                const uvAccessor = doc.createAccessor()
                    .setType('VEC2')
                    .setArray(new Float32Array(texcoords))
                    .setBuffer(buf);

                const indexAccessor = doc.createAccessor()
                    .setType('SCALAR')
                    .setArray(new Uint32Array(cluster.indices))
                    .setBuffer(buf);

                const prim = doc.createPrimitive()
                    .setAttribute('POSITION', posAccessor)
                    .setAttribute('NORMAL', normAccessor)
                    .setAttribute('TEXCOORD_0', uvAccessor)
                    .setIndices(indexAccessor);

                const mat = materialMap.get(cluster.materialID);
                if (mat) {
                    prim.setMaterial(mat);
                }

                mesh.addPrimitive(prim);
            }

            gNode.setMesh(mesh);
        }

        gltfNodes.push(gNode);
    }

    // Wire up parent-child relationships
    for (let ni = 0; ni < bvh.length; ni++) {
        const bvhNode = bvh[ni]!;
        if (bvhNode.left !== -1) {
            const leftNode = gltfNodes[bvhNode.left];
            const rightNode = gltfNodes[bvhNode.right];
            if (leftNode) gltfNodes[ni]!.addChild(leftNode);
            if (rightNode) gltfNodes[ni]!.addChild(rightNode);
        }
    }

    // Add root to scene
    if (gltfNodes.length > 0) {
        scene.addChild(gltfNodes[0]!);
    }

    // Write GLB
    const io = new NodeIO();
    return await io.writeBinary(doc);
}
