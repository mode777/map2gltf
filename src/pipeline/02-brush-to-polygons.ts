import type { ParsedBrush, ParsedFace, ConvexPolygon, Vec3 } from '../types.js';
import * as vec3 from '../math/vec3.js';

const EPSILON = 1e-5;
const SEED_EXTENT = 65536;

function buildSeedPolygon(normal: Vec3, distance: number): Vec3[] {
    // Choose tangent vectors based on dominant axis
    const absX = Math.abs(normal.x);
    const absY = Math.abs(normal.y);
    const absZ = Math.abs(normal.z);

    let t1: Vec3;
    if (absZ >= absX && absZ >= absY) {
        t1 = vec3.normalize(vec3.cross(normal, { x: 0, y: 1, z: 0 }));
    } else if (absX >= absY) {
        t1 = vec3.normalize(vec3.cross(normal, { x: 0, y: 0, z: 1 }));
    } else {
        t1 = vec3.normalize(vec3.cross(normal, { x: 1, y: 0, z: 0 }));
    }
    const t2 = vec3.cross(normal, t1);

    // Plane origin
    const origin = vec3.scale(normal, distance);

    const s1p = vec3.scale(t1, SEED_EXTENT);
    const s1n = vec3.scale(t1, -SEED_EXTENT);
    const s2p = vec3.scale(t2, SEED_EXTENT);
    const s2n = vec3.scale(t2, -SEED_EXTENT);

    return [
        vec3.add(origin, vec3.add(s1p, s2p)),
        vec3.add(origin, vec3.add(s1n, s2p)),
        vec3.add(origin, vec3.add(s1n, s2n)),
        vec3.add(origin, vec3.add(s1p, s2n)),
    ];
}

function clipPolygonToPlane(
    vertices: Vec3[],
    clipNormal: Vec3,
    clipDistance: number,
): Vec3[] {
    if (vertices.length < 3) return [];

    const result: Vec3[] = [];
    const len = vertices.length;

    for (let i = 0; i < len; i++) {
        const a = vertices[i]!;
        const b = vertices[(i + 1) % len]!;

        const dA = vec3.dot(a, clipNormal) - clipDistance;
        const dB = vec3.dot(b, clipNormal) - clipDistance;

        const aInside = dA <= EPSILON;
        const bInside = dB <= EPSILON;

        if (aInside && bInside) {
            result.push(b);
        } else if (aInside && !bInside) {
            // A inside, B outside - emit intersection
            const t = (clipDistance - vec3.dot(a, clipNormal)) / vec3.dot(vec3.sub(b, a), clipNormal);
            let intersection = vec3.add(a, vec3.scale(vec3.sub(b, a), t));
            // Plane snap
            const snapDist = vec3.dot(intersection, clipNormal) - clipDistance;
            intersection = vec3.sub(intersection, vec3.scale(clipNormal, snapDist));
            result.push(intersection);
        } else if (!aInside && bInside) {
            // A outside, B inside - emit intersection then B
            const t = (clipDistance - vec3.dot(a, clipNormal)) / vec3.dot(vec3.sub(b, a), clipNormal);
            let intersection = vec3.add(a, vec3.scale(vec3.sub(b, a), t));
            // Plane snap
            const snapDist = vec3.dot(intersection, clipNormal) - clipDistance;
            intersection = vec3.sub(intersection, vec3.scale(clipNormal, snapDist));
            result.push(intersection);
            result.push(b);
        }
        // Both outside: emit nothing
    }

    return result;
}

function polygonArea(vertices: Vec3[]): number {
    if (vertices.length < 3) return 0;
    let crossSum: Vec3 = { x: 0, y: 0, z: 0 };
    const v0 = vertices[0]!;
    for (let i = 1; i < vertices.length - 1; i++) {
        const edge1 = vec3.sub(vertices[i]!, v0);
        const edge2 = vec3.sub(vertices[i + 1]!, v0);
        crossSum = vec3.add(crossSum, vec3.cross(edge1, edge2));
    }
    return 0.5 * vec3.length(crossSum);
}

export function brushToPolygons(brush: ParsedBrush, brushIndex: number, entityIndex: number = 0): ConvexPolygon[] {
    const result: ConvexPolygon[] = [];

    for (let fi = 0; fi < brush.faces.length; fi++) {
        const face = brush.faces[fi]!;
        let poly = buildSeedPolygon(face.normal, face.distance);

        for (let gi = 0; gi < brush.faces.length; gi++) {
            if (gi === fi) continue;
            const other = brush.faces[gi]!;
            poly = clipPolygonToPlane(poly, other.normal, other.distance);
            if (poly.length < 3) break;
        }

        // Degeneracy rejection
        if (poly.length < 3) continue;
        if (polygonArea(poly) < EPSILON * EPSILON) continue;

        // Winding order enforcement: ensure CCW relative to face normal
        const windCheck = vec3.dot(
            vec3.cross(vec3.sub(poly[1]!, poly[0]!), vec3.sub(poly[2]!, poly[0]!)),
            face.normal,
        );
        if (windCheck < 0) {
            poly.reverse();
        }

        result.push({
            vertices: poly,
            face,
            brushIndex,
            entityIndex,
        });
    }

    return result;
}
