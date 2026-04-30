import { Document, NodeIO } from '@gltf-transform/core';
import type { MaterialBatch, Cluster, BVHNode, Vec3, ParsedEntity, TextureMap, ExportFormat } from '../types.js';
import { mergeAABBs } from '../math/aabb.js';

type JSONDocument = Awaited<ReturnType<NodeIO['writeJSON']>>;
type SerializableImage = { uri?: string; name?: string; bufferView?: number };

const GLB_HEADER_LENGTH = 12;
const GLB_CHUNK_HEADER_LENGTH = 8;
const GLB_JSON_CHUNK_TYPE = 0x4E4F534A;
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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

function encodeBase64(bytes: Uint8Array): string {
    let output = '';

    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i]!;
        const b = bytes[i + 1];
        const c = bytes[i + 2];
        const chunk = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);

        output += BASE64_ALPHABET[(chunk >> 18) & 0x3f]!;
        output += BASE64_ALPHABET[(chunk >> 12) & 0x3f]!;
        output += b === undefined ? '=' : BASE64_ALPHABET[(chunk >> 6) & 0x3f]!;
        output += c === undefined ? '=' : BASE64_ALPHABET[chunk & 0x3f]!;
    }

    return output;
}

function inlineBufferResources(jsonDoc: JSONDocument): void {
    for (const buffer of jsonDoc.json.buffers ?? []) {
        const uri = buffer.uri;
        if (!uri || uri.startsWith('data:')) {
            continue;
        }

        const resource = jsonDoc.resources[uri];
        if (!resource) {
            continue;
        }

        buffer.uri = `data:application/octet-stream;base64,${encodeBase64(resource)}`;
        delete jsonDoc.resources[uri];
    }
}

function normalizeRelativeURI(uri: string, label: string): string {
    const normalized = uri.replace(/\\/g, '/').replace(/\/$/, '');
    if (/^(?:[a-zA-Z][a-zA-Z\d+.-]*:|\/)/.test(normalized)) {
        throw new Error(`${label} must be a relative URI, got '${uri}'`);
    }
    return normalized;
}

function resolveTextureURI(textureBasePath: string | undefined, relativePath: string): string {
    const normalizedPath = normalizeRelativeURI(relativePath, 'Texture path');
    if (!textureBasePath || textureBasePath === '.') {
        return normalizedPath;
    }

    const normalizedBase = normalizeRelativeURI(textureBasePath, 'Texture base path');
    return `${normalizedBase}/${normalizedPath}`;
}

function patchExternalImageURIs(json: { images?: SerializableImage[] }): void {
    for (const image of json.images ?? []) {
        if (!image.uri && typeof image.name === 'string') {
            image.uri = normalizeRelativeURI(image.name, 'Texture URI');
        }

        delete image.bufferView;
    }
}

function createPaddedChunk(bytes: Uint8Array, paddingByte: number): Uint8Array {
    const paddedLength = (bytes.length + 3) & ~3;
    const padded = new Uint8Array(paddedLength);
    padded.fill(paddingByte);
    padded.set(bytes);
    return padded;
}

function patchGLBExternalImageURIs(glb: Uint8Array): Uint8Array {
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    if (view.getUint32(0, true) !== GLB_MAGIC) {
        throw new Error('Invalid GLB header');
    }

    const jsonChunkLength = view.getUint32(GLB_HEADER_LENGTH, true);
    const jsonChunkType = view.getUint32(GLB_HEADER_LENGTH + 4, true);
    if (jsonChunkType !== GLB_JSON_CHUNK_TYPE) {
        throw new Error('Missing GLB JSON chunk');
    }

    const jsonStart = GLB_HEADER_LENGTH + GLB_CHUNK_HEADER_LENGTH;
    const jsonEnd = jsonStart + jsonChunkLength;
    const jsonText = new TextDecoder().decode(glb.slice(jsonStart, jsonEnd)).replace(/[\u0000\u0020]+$/u, '');
    const json = JSON.parse(jsonText) as { images?: SerializableImage[] };
    patchExternalImageURIs(json);

    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const paddedJson = createPaddedChunk(jsonBytes, 0x20);
    const remainingChunks = glb.slice(jsonEnd);
    const patched = new Uint8Array(GLB_HEADER_LENGTH + GLB_CHUNK_HEADER_LENGTH + paddedJson.length + remainingChunks.length);
    patched.set(paddedJson, GLB_HEADER_LENGTH + GLB_CHUNK_HEADER_LENGTH);
    patched.set(remainingChunks, GLB_HEADER_LENGTH + GLB_CHUNK_HEADER_LENGTH + paddedJson.length);

    const patchedView = new DataView(patched.buffer);
    patchedView.setUint32(0, GLB_MAGIC, true);
    patchedView.setUint32(4, GLB_VERSION, true);
    patchedView.setUint32(8, patched.length, true);
    patchedView.setUint32(GLB_HEADER_LENGTH, paddedJson.length, true);
    patchedView.setUint32(GLB_HEADER_LENGTH + 4, GLB_JSON_CHUNK_TYPE, true);

    return patched;
}

async function writeGLTF(doc: Document): Promise<Uint8Array> {
    const io = new NodeIO();
    const jsonDoc = await io.writeJSON(doc);
    inlineBufferResources(jsonDoc);
    patchExternalImageURIs(jsonDoc.json as { images?: SerializableImage[] });
    return new TextEncoder().encode(JSON.stringify(jsonDoc.json, null, 2));
}

export async function exportScene(
    batches: MaterialBatch[],
    worldClusters: Cluster[],
    bvh: BVHNode[],
    entityClusters: Cluster[] = [],
    entities: ParsedEntity[] = [],
    textureMap?: TextureMap,
    format: ExportFormat = 'glb',
    textureBasePath?: string,
): Promise<Uint8Array> {
    const doc = new Document();
    doc.getRoot().getAsset().generator = 'map2gltf';

    const scene = doc.createScene('map');
    const buf = doc.createBuffer();

    // Deduplicate glTF images/textures by relativePath
    // Deduplicate glTF images/textures by exported URI.
    const imageMap = new Map<string, ReturnType<Document['createTexture']>>();

    function getOrCreateTexture(textureInfo: NonNullable<TextureMap extends Map<string, infer TValue> ? Exclude<TValue, null> : never>): ReturnType<Document['createTexture']> {
        const textureURI = resolveTextureURI(textureBasePath, textureInfo.relativePath);
        let tex = imageMap.get(textureURI);
        if (!tex) {
            tex = doc.createTexture(textureURI)
                .setURI(textureURI)
                .setMimeType('image/png');
            imageMap.set(textureURI, tex);
        }
        return tex;
    }

    // Create materials (one per batch, named by texture)
    const materialMap = new Map<number, ReturnType<Document['createMaterial']>>();
    for (const batch of batches) {
        if (!materialMap.has(batch.materialID)) {
            const texName = batch.textureName;
            const texInfo = textureMap?.get(texName.toLowerCase()) ?? textureMap?.get(texName) ?? null;

            const mat = doc.createMaterial(texName)
                .setMetallicFactor(0)
                .setRoughnessFactor(1);

            if (texInfo) {
                const tex = getOrCreateTexture(texInfo);
                mat.setBaseColorTexture(tex);
            } else {
                mat.setBaseColorFactor([1, 0, 1, 1]);
            }

            materialMap.set(batch.materialID, mat);
        }
    }

    function createPrimitive(meshCluster: Cluster) {
        const positions: number[] = [];
        const normals: number[] = [];
        const texcoords: number[] = [];

        for (const vert of meshCluster.vertices) {
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
            .setArray(new Uint32Array(meshCluster.indices))
            .setBuffer(buf);

        const prim = doc.createPrimitive()
            .setAttribute('POSITION', posAccessor)
            .setAttribute('NORMAL', normAccessor)
            .setAttribute('TEXCOORD_0', uvAccessor)
            .setIndices(indexAccessor);

        const mat = materialMap.get(meshCluster.materialID);
        if (mat) {
            prim.setMaterial(mat);
        }

        return prim;
    }

    // Build glTF nodes for each worldspawn BVH node.
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
                const cluster = worldClusters[ci];
                if (!cluster) continue;
                mesh.addPrimitive(createPrimitive(cluster));
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

    // Add worldspawn BVH root to scene.
    if (gltfNodes.length > 0) {
        scene.addChild(gltfNodes[0]!);
    }

    // Export non-worldspawn entities as first-class meshes/nodes.
    const entityClusterMap = new Map<number, Cluster[]>();
    for (const cluster of entityClusters) {
        let list = entityClusterMap.get(cluster.entityIndex);
        if (!list) {
            list = [];
            entityClusterMap.set(cluster.entityIndex, list);
        }
        list.push(cluster);
    }

    if (entityClusterMap.size > 0) {
        const entitiesGroup = doc.createNode('entities');

        for (const [entityIndex, clustersForEntity] of [...entityClusterMap.entries()].sort((a, b) => a[0] - b[0])) {
            const entity = entities[entityIndex];
            const classname = entity?.properties['classname'];
            const targetname = entity?.properties['targetname'];
            const baseName = classname ? `entity_${entityIndex}_${classname}` : `entity_${entityIndex}`;

            const entityMesh = doc.createMesh(baseName);
            for (const cluster of clustersForEntity) {
                entityMesh.addPrimitive(createPrimitive(cluster));
            }

            const entityBounds = clustersForEntity
                .map(cluster => cluster.bounds)
                .reduce((merged, next) => mergeAABBs(merged, next));
            const entityNode = doc.createNode(baseName)
                .setMesh(entityMesh)
                .setExtras({
                    entityIndex,
                    classname,
                    targetname,
                    aabb: convertAABB(entityBounds),
                });

            entityMesh.setExtras({
                entityIndex,
                classname,
                targetname,
            });

            entitiesGroup.addChild(entityNode);
        }

        scene.addChild(entitiesGroup);
    }

    // Write GLB
    if (format === 'gltf') {
        return await writeGLTF(doc);
    }

    const io = new NodeIO();
    return patchGLBExternalImageURIs(await io.writeBinary(doc));
}

export async function exportGLB(
    batches: MaterialBatch[],
    worldClusters: Cluster[],
    bvh: BVHNode[],
    entityClusters: Cluster[] = [],
    entities: ParsedEntity[] = [],
    textureMap?: TextureMap,
    textureBasePath?: string,
): Promise<Uint8Array> {
    return await exportScene(batches, worldClusters, bvh, entityClusters, entities, textureMap, 'glb', textureBasePath);
}
