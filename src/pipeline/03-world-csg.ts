import type { ConvexPolygon, ParsedBrush, Vec3 } from '../types.js';
import * as vec3 from '../math/vec3.js';
import { aabbFromPoints, aabbOverlaps } from '../math/aabb.js';
import { SpatialHash } from '../util/spatial-hash.js';

const EPSILON = 1e-5;

interface SplitResult {
    front: ConvexPolygon | null;
    back: ConvexPolygon | null;
}

function splitPolygon(
    poly: ConvexPolygon,
    clipNormal: Vec3,
    clipDistance: number,
): SplitResult {
    const verts = poly.vertices;
    const len = verts.length;

    // Classify all vertices
    const dists: number[] = [];
    let numFront = 0;
    let numBack = 0;
    let numOn = 0;
    for (let i = 0; i < len; i++) {
        const d = vec3.dot(verts[i]!, clipNormal) - clipDistance;
        dists.push(d);
        if (d > EPSILON) numFront++;
        else if (d < -EPSILON) numBack++;
        else numOn++;
    }

    // All on-plane: use normal direction to classify
    if (numFront === 0 && numBack === 0) {
        const facing = vec3.dot(poly.face.normal, clipNormal);
        if (facing > 0) {
            // Same direction → front (outside)
            return { front: poly, back: null };
        } else {
            // Opposite direction → back (inside)
            return { front: null, back: poly };
        }
    }

    // All front
    if (numBack === 0) return { front: poly, back: null };
    // All back
    if (numFront === 0) return { front: null, back: poly };

    const frontVerts: Vec3[] = [];
    const backVerts: Vec3[] = [];

    for (let i = 0; i < len; i++) {
        const a = verts[i]!;
        const b = verts[(i + 1) % len]!;

        const dA = dists[i]!;
        const dB = dists[(i + 1) % len]!;

        const aFront = dA > EPSILON;
        const aBack = dA < -EPSILON;
        const bFront = dB > EPSILON;
        const bBack = dB < -EPSILON;

        if (aFront) {
            frontVerts.push(a);
        } else if (aBack) {
            backVerts.push(a);
        } else {
            frontVerts.push(a);
            backVerts.push(a);
        }

        if ((aFront && bBack) || (aBack && bFront)) {
            const dir = vec3.sub(b, a);
            const denom = vec3.dot(dir, clipNormal);
            if (Math.abs(denom) > 1e-10) {
                const t = (clipDistance - vec3.dot(a, clipNormal)) / denom;
                let intersection = vec3.add(a, vec3.scale(dir, t));
                // Plane snap
                const snapDist = vec3.dot(intersection, clipNormal) - clipDistance;
                intersection = vec3.sub(intersection, vec3.scale(clipNormal, snapDist));
                frontVerts.push(intersection);
                backVerts.push(intersection);
            }
        }
    }

    const front = frontVerts.length >= 3
        ? { vertices: frontVerts, face: poly.face, brushIndex: poly.brushIndex, entityIndex: poly.entityIndex }
        : null;
    const back = backVerts.length >= 3
        ? { vertices: backVerts, face: poly.face, brushIndex: poly.brushIndex, entityIndex: poly.entityIndex }
        : null;

    return { front, back };
}

interface BrushInfo {
    index: number;
    faces: Array<{ normal: Vec3; distance: number }>;
    aabb: { min: Vec3; max: Vec3 };
}

function subtractBrush(fragment: ConvexPolygon, brush: BrushInfo): ConvexPolygon[] {
    const survivors: ConvexPolygon[] = [];
    let remaining: ConvexPolygon | null = fragment;

    for (const face of brush.faces) {
        if (remaining === null) break;

        const { front, back } = splitPolygon(remaining, face.normal, face.distance);

        if (front !== null && front.vertices.length >= 3) {
            survivors.push(front);
        }

        remaining = (back !== null && back.vertices.length >= 3) ? back : null;
    }

    // remaining is fully inside the brush → discard it
    return survivors;
}

export function worldCSG(polygons: ConvexPolygon[]): ConvexPolygon[] {
    if (polygons.length === 0) return [];

    // Group polygons by brush index and build brush info
    const brushFacesMap = new Map<number, Array<{ normal: Vec3; distance: number }>>();
    const brushPolysMap = new Map<number, ConvexPolygon[]>();

    for (const poly of polygons) {
        if (!brushFacesMap.has(poly.brushIndex)) {
            brushFacesMap.set(poly.brushIndex, []);
            brushPolysMap.set(poly.brushIndex, []);
        }
        brushPolysMap.get(poly.brushIndex)!.push(poly);
    }

    // Collect unique brush face planes from the first polygon's originating brush
    // We need the original brush face data for subtraction
    const brushInfos: BrushInfo[] = [];
    for (const [brushIdx, polys] of brushPolysMap) {
        const faces: Array<{ normal: Vec3; distance: number }> = [];
        const seenNormals = new Set<string>();
        for (const poly of polys) {
            const key = `${poly.face.normal.x.toFixed(6)},${poly.face.normal.y.toFixed(6)},${poly.face.normal.z.toFixed(6)},${poly.face.distance.toFixed(6)}`;
            if (!seenNormals.has(key)) {
                seenNormals.add(key);
                faces.push({ normal: poly.face.normal, distance: poly.face.distance });
            }
        }
        const allVerts = polys.flatMap(p => p.vertices);
        const aabb = aabbFromPoints(allVerts);
        brushInfos.push({ index: brushIdx, faces, aabb });
    }

    // Build spatial hash
    const grid = new SpatialHash<BrushInfo>(64);
    for (const info of brushInfos) {
        grid.insert(info, info.aabb);
    }

    const result: ConvexPolygon[] = [];

    for (const [brushIdx, polys] of brushPolysMap) {
        const brushAABB = aabbFromPoints(polys.flatMap(p => p.vertices));
        const candidates = [...grid.query(brushAABB)].filter(b => b.index !== brushIdx);

        for (const poly of polys) {
            let fragments: ConvexPolygon[] = [poly];

            for (const otherBrush of candidates) {
                if (fragments.length === 0) break;

                const polyAABB = aabbFromPoints(fragments.flatMap(f => f.vertices));
                if (!aabbOverlaps(polyAABB, otherBrush.aabb)) continue;

                const nextFragments: ConvexPolygon[] = [];
                for (const frag of fragments) {
                    nextFragments.push(...subtractBrush(frag, otherBrush));
                }
                fragments = nextFragments;
            }

            result.push(...fragments);
        }
    }

    return result;
}
