import type { ConvexPolygon, TriangulatedMesh, Vertex, TextureMap } from '../types.js';
import * as vec3 from '../math/vec3.js';

export function triangulate(
    polygons: ConvexPolygon[],
    textureMap: TextureMap,
    defaultTextureSize = 64,
): TriangulatedMesh {
    const vertices: Vertex[] = [];
    const indices: number[] = [];
    const triangleMaterials: string[] = [];
    const triangleEntityIndices: number[] = [];
    const triangleBrushIndices: number[] = [];

    const defaultSize: [number, number] = [defaultTextureSize, defaultTextureSize];

    for (const poly of polygons) {
        const face = poly.face;
        const texKey = face.textureName.toLowerCase();
        const info = textureMap.get(texKey);
        const [texW, texH] = info?.size ?? defaultSize;

        const baseIndex = vertices.length;

        for (const p of poly.vertices) {
            const u = (vec3.dot(p, face.texAxisU) + face.texOffsetU) / face.texScaleU / texW;
            const v = (vec3.dot(p, face.texAxisV) + face.texOffsetV) / face.texScaleV / texH;
            vertices.push({
                position: p,
                normal: face.normal,
                uv: { x: u, y: v },
            });
        }

        // Fan triangulation from vertex 0
        for (let i = 1; i < poly.vertices.length - 1; i++) {
            indices.push(baseIndex, baseIndex + i, baseIndex + i + 1);
            triangleMaterials.push(face.textureName);
            triangleEntityIndices.push(poly.entityIndex);
            triangleBrushIndices.push(poly.brushIndex);
        }
    }

    return { vertices, indices, triangleMaterials, triangleEntityIndices, triangleBrushIndices };
}
