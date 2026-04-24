import type { AABB, Vec3 } from '../types.js';

export function aabbFromPoints(points: Vec3[]): AABB {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.z < minZ) minZ = p.z;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        if (p.z > maxZ) maxZ = p.z;
    }
    return {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
    };
}

export function mergeAABBs(a: AABB, b: AABB): AABB {
    return {
        min: {
            x: Math.min(a.min.x, b.min.x),
            y: Math.min(a.min.y, b.min.y),
            z: Math.min(a.min.z, b.min.z),
        },
        max: {
            x: Math.max(a.max.x, b.max.x),
            y: Math.max(a.max.y, b.max.y),
            z: Math.max(a.max.z, b.max.z),
        },
    };
}

export function surfaceArea(aabb: AABB): number {
    const dx = aabb.max.x - aabb.min.x;
    const dy = aabb.max.y - aabb.min.y;
    const dz = aabb.max.z - aabb.min.z;
    return 2 * (dx * dy + dy * dz + dz * dx);
}

export function contains(outer: AABB, inner: AABB): boolean {
    return (
        inner.min.x >= outer.min.x && inner.max.x <= outer.max.x &&
        inner.min.y >= outer.min.y && inner.max.y <= outer.max.y &&
        inner.min.z >= outer.min.z && inner.max.z <= outer.max.z
    );
}

export function centroid(aabb: AABB): Vec3 {
    return {
        x: (aabb.min.x + aabb.max.x) * 0.5,
        y: (aabb.min.y + aabb.max.y) * 0.5,
        z: (aabb.min.z + aabb.max.z) * 0.5,
    };
}

export function aabbOverlaps(a: AABB, b: AABB): boolean {
    return (
        a.min.x <= b.max.x && a.max.x >= b.min.x &&
        a.min.y <= b.max.y && a.max.y >= b.min.y &&
        a.min.z <= b.max.z && a.max.z >= b.min.z
    );
}
