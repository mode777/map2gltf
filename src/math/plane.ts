import type { Vec3 } from '../types.js';
import * as vec3 from './vec3.js';

export interface Plane {
    readonly normal: Vec3;
    readonly distance: number;
}

export function planeFromPoints(p1: Vec3, p2: Vec3, p3: Vec3): Plane {
    const v1 = vec3.sub(p3, p1);
    const v2 = vec3.sub(p2, p1);
    const normal = vec3.normalize(vec3.cross(v1, v2));
    const distance = vec3.dot(normal, p1);
    return { normal, distance };
}

export const enum Classification {
    Front = 1,
    Back = -1,
    On = 0,
}

export function classifyVertex(
    point: Vec3,
    normal: Vec3,
    distance: number,
    epsilon: number,
): Classification {
    const d = vec3.dot(point, normal) - distance;
    if (d > epsilon) return Classification.Front;
    if (d < -epsilon) return Classification.Back;
    return Classification.On;
}

export function linePlaneIntersection(
    a: Vec3,
    b: Vec3,
    normal: Vec3,
    distance: number,
): Vec3 | null {
    const dir = vec3.sub(b, a);
    const denom = vec3.dot(dir, normal);
    if (Math.abs(denom) < 1e-10) return null;
    const t = (distance - vec3.dot(a, normal)) / denom;
    return vec3.add(a, vec3.scale(dir, t));
}
