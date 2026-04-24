import type { TriangulatedMesh, MaterialBatch, Vertex } from '../types.js';

function quantizeVertex(v: Vertex): string {
    const qPx = Math.round(v.position.x * 10000);
    const qPy = Math.round(v.position.y * 10000);
    const qPz = Math.round(v.position.z * 10000);
    const qNx = Math.round(v.normal.x * 10000);
    const qNy = Math.round(v.normal.y * 10000);
    const qNz = Math.round(v.normal.z * 10000);
    const qU = Math.round(v.uv.x * 10000);
    const qV = Math.round(v.uv.y * 10000);
    return `${qPx},${qPy},${qPz},${qNx},${qNy},${qNz},${qU},${qV}`;
}

export function mergeMaterials(mesh: TriangulatedMesh): MaterialBatch[] {
    const { vertices, indices, triangleMaterials } = mesh;

    // Collect unique texture names and assign sorted IDs
    const uniqueNames = [...new Set(triangleMaterials)].sort();
    const nameToID = new Map(uniqueNames.map((name, i) => [name, i]));

    // Bucket triangles by material
    const buckets = new Map<number, { texName: string; srcIndices: number[] }>();
    for (let tri = 0; tri < triangleMaterials.length; tri++) {
        const texName = triangleMaterials[tri]!;
        const matID = nameToID.get(texName)!;
        let bucket = buckets.get(matID);
        if (!bucket) {
            bucket = { texName, srcIndices: [] };
            buckets.set(matID, bucket);
        }
        bucket.srcIndices.push(
            indices[tri * 3]!, indices[tri * 3 + 1]!, indices[tri * 3 + 2]!,
        );
    }

    // Build deduplicated vertex/index buffers per material
    const result: MaterialBatch[] = [];
    for (const [matID, bucket] of buckets) {
        const batchVertices: Vertex[] = [];
        const batchIndices: number[] = [];
        const dedupMap = new Map<string, number>();

        for (const srcIdx of bucket.srcIndices) {
            const v = vertices[srcIdx]!;
            const key = quantizeVertex(v);
            let idx = dedupMap.get(key);
            if (idx === undefined) {
                idx = batchVertices.length;
                batchVertices.push(v);
                dedupMap.set(key, idx);
            }
            batchIndices.push(idx);
        }

        result.push({
            materialID: matID,
            textureName: bucket.texName,
            vertices: batchVertices,
            indices: batchIndices,
        });
    }

    return result.sort((a, b) => a.materialID - b.materialID);
}
