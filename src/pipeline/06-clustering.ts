import type { MaterialBatch, Cluster, Vertex, Vec3, Diagnostics } from '../types.js';
import { aabbFromPoints } from '../math/aabb.js';
import * as vec3 from '../math/vec3.js';

export interface ClusterOptions {
    gridCellSize: number;
    maxClusterSize: number;
    minClusterSize: number;
    skipWorldspawnClustering?: boolean;
}

const DEFAULT_GRID_CELL_SIZE = 16;
const DEFAULT_MAX_CLUSTER_SIZE = 512;
const DEFAULT_MIN_CLUSTER_SIZE = 24;
const VERTEX_CACHE_SIZE = 32;

// Forsyth vertex cache optimization — score tables
const CACHE_SCORE_TABLE: number[] = [];
const VALENCE_SCORE_TABLE: number[] = [];

function initForsythTables(): void {
    if (CACHE_SCORE_TABLE.length > 0) return;
    // Cache position score: higher score for more recently used vertices
    for (let i = 0; i < VERTEX_CACHE_SIZE; i++) {
        if (i < 3) {
            CACHE_SCORE_TABLE.push(0.75);
        } else {
            const t = (i - 3) / (VERTEX_CACHE_SIZE - 3);
            CACHE_SCORE_TABLE.push(Math.pow(1 - t, 1.5));
        }
    }
    // Valence score: bonus for vertices with few remaining triangles
    VALENCE_SCORE_TABLE.push(0); // valence 0 = no score
    for (let i = 1; i <= 32; i++) {
        VALENCE_SCORE_TABLE.push(2 * Math.pow(i, -0.5));
    }
}

function forsythReorder(indices: number[], vertexCount: number): number[] {
    initForsythTables();
    const triCount = indices.length / 3;
    if (triCount <= 1) return indices;

    // Build adjacency: for each vertex, list of triangle indices
    const vertTriangles: number[][] = Array.from({ length: vertexCount }, () => []);
    for (let t = 0; t < triCount; t++) {
        vertTriangles[indices[t * 3]!]!.push(t);
        vertTriangles[indices[t * 3 + 1]!]!.push(t);
        vertTriangles[indices[t * 3 + 2]!]!.push(t);
    }

    // Active triangle count per vertex
    const liveTriCount = new Int32Array(vertexCount);
    for (let v = 0; v < vertexCount; v++) {
        liveTriCount[v] = vertTriangles[v]!.length;
    }

    // Simulated vertex cache (stores vertex indices, -1 = empty)
    const cache = new Int32Array(VERTEX_CACHE_SIZE).fill(-1);
    let cacheCount = 0;

    // Track whether each triangle has been emitted
    const emitted = new Uint8Array(triCount);

    // Vertex scores
    const vertexScore = new Float64Array(vertexCount);

    function computeVertexScore(v: number): number {
        if (liveTriCount[v] === 0) return 0;
        let score = 0;
        // Cache position score
        for (let i = 0; i < cacheCount; i++) {
            if (cache[i] === v) {
                score += CACHE_SCORE_TABLE[i]!;
                break;
            }
        }
        // Valence score
        const valence = liveTriCount[v]!;
        score += valence < VALENCE_SCORE_TABLE.length
            ? VALENCE_SCORE_TABLE[valence]!
            : VALENCE_SCORE_TABLE[VALENCE_SCORE_TABLE.length - 1]!;
        return score;
    }

    // Initial scores
    for (let v = 0; v < vertexCount; v++) {
        vertexScore[v] = computeVertexScore(v);
    }

    const result: number[] = [];

    for (let emittedCount = 0; emittedCount < triCount;) {
        // Find the best triangle (highest score sum)
        let bestTri = -1;
        let bestScore = -1;

        // Check triangles adjacent to cached vertices first
        for (let ci = 0; ci < cacheCount; ci++) {
            const v = cache[ci]!;
            for (const t of vertTriangles[v]!) {
                if (emitted[t]) continue;
                const s = vertexScore[indices[t * 3]!]!
                    + vertexScore[indices[t * 3 + 1]!]!
                    + vertexScore[indices[t * 3 + 2]!]!;
                if (s > bestScore) {
                    bestScore = s;
                    bestTri = t;
                }
            }
        }

        // If no triangle found from cache, scan all
        if (bestTri === -1) {
            for (let t = 0; t < triCount; t++) {
                if (emitted[t]) continue;
                const s = vertexScore[indices[t * 3]!]!
                    + vertexScore[indices[t * 3 + 1]!]!
                    + vertexScore[indices[t * 3 + 2]!]!;
                if (s > bestScore) {
                    bestScore = s;
                    bestTri = t;
                }
            }
        }

        if (bestTri === -1) break;

        // Emit the triangle
        emitted[bestTri] = 1;
        emittedCount++;

        const v0 = indices[bestTri * 3]!;
        const v1 = indices[bestTri * 3 + 1]!;
        const v2 = indices[bestTri * 3 + 2]!;
        result.push(v0, v1, v2);

        // Update live counts
        liveTriCount[v0]!--;
        liveTriCount[v1]!--;
        liveTriCount[v2]!--;

        // Update cache: push v0, v1, v2 to front
        const newVerts = [v0, v1, v2];
        const oldCache = cache.slice(0, cacheCount);
        cacheCount = 0;
        // Add new verts first
        for (const nv of newVerts) {
            cache[cacheCount++] = nv;
        }
        // Then old cache entries (skip duplicates and overflow)
        for (let i = 0; i < oldCache.length && cacheCount < VERTEX_CACHE_SIZE; i++) {
            if (oldCache[i] !== v0 && oldCache[i] !== v1 && oldCache[i] !== v2) {
                cache[cacheCount++] = oldCache[i]!;
            }
        }

        // Recompute scores for affected vertices
        for (let ci = 0; ci < cacheCount; ci++) {
            vertexScore[cache[ci]!] = computeVertexScore(cache[ci]!);
        }
    }

    return result;
}

function triangleCentroid(verts: Vertex[], indices: number[], triIdx: number): Vec3 {
    const i0 = indices[triIdx * 3]!;
    const i1 = indices[triIdx * 3 + 1]!;
    const i2 = indices[triIdx * 3 + 2]!;
    const a = verts[i0]!.position;
    const b = verts[i1]!.position;
    const c = verts[i2]!.position;
    return {
        x: (a.x + b.x + c.x) / 3,
        y: (a.y + b.y + c.y) / 3,
        z: (a.z + b.z + c.z) / 3,
    };
}

function getCellKey(centroid: Vec3, cellSize: number): string {
    const cx = Math.floor(centroid.x / cellSize);
    const cy = Math.floor(centroid.y / cellSize);
    const cz = Math.floor(centroid.z / cellSize);
    return `${cx},${cy},${cz}`;
}

interface PendingCluster {
    materialID: number;
    triangles: number[]; // triangle indices into the batch
    batch: MaterialBatch;
    entityIndex: number;
    isWorldspawn: boolean;
}

function enforceMaxSize(triangles: number[], batch: MaterialBatch, maxSize: number): number[][] {
    if (triangles.length <= maxSize) return [triangles];

    // Recursive bisection along longest AABB axis
    const centroids = triangles.map(ti => triangleCentroid(batch.vertices, batch.indices, ti));
    const aabb = aabbFromPoints(centroids);
    const dx = aabb.max.x - aabb.min.x;
    const dy = aabb.max.y - aabb.min.y;
    const dz = aabb.max.z - aabb.min.z;

    let axis: 'x' | 'y' | 'z' = 'x';
    if (dy >= dx && dy >= dz) axis = 'y';
    else if (dz >= dx && dz >= dy) axis = 'z';

    // Sort by centroid along axis
    const sorted = triangles.map((ti, idx) => ({ ti, c: centroids[idx]! }))
        .sort((a, b) => a.c[axis] - b.c[axis]);

    const mid = Math.floor(sorted.length / 2);
    const left = sorted.slice(0, mid).map(s => s.ti);
    const right = sorted.slice(mid).map(s => s.ti);

    return [
        ...enforceMaxSize(left, batch, maxSize),
        ...enforceMaxSize(right, batch, maxSize),
    ];
}

// --- Brush-intact variants for worldspawn clustering ---

interface BrushGroup {
    brushIndex: number;
    triangles: number[];
    centroid: Vec3;
}

function groupByBrush(triangles: number[], batch: MaterialBatch): BrushGroup[] {
    const map = new Map<number, number[]>();
    for (const ti of triangles) {
        const bi = batch.triangleBrushIndices[ti]!;
        let list = map.get(bi);
        if (!list) { list = []; map.set(bi, list); }
        list.push(ti);
    }

    const groups: BrushGroup[] = [];
    for (const [brushIndex, tris] of map) {
        const centroids = tris.map(ti => triangleCentroid(batch.vertices, batch.indices, ti));
        let sum: Vec3 = { x: 0, y: 0, z: 0 };
        for (const c of centroids) sum = vec3.add(sum, c);
        const centroid = vec3.scale(sum, 1 / centroids.length);
        groups.push({ brushIndex, triangles: tris, centroid });
    }
    return groups;
}

function enforceMaxSizeByBrush(
    brushGroups: BrushGroup[],
    maxSize: number,
    diagnostics?: Diagnostics,
): BrushGroup[][] {
    const totalTris = brushGroups.reduce((s, bg) => s + bg.triangles.length, 0);
    if (totalTris <= maxSize) return [brushGroups];

    // If only one brush group, it can't be split further — keep as-is
    if (brushGroups.length <= 1) {
        if (diagnostics && totalTris > maxSize) {
            diagnostics.warnings.push({
                step: '06-clustering',
                message: `Single brush (index ${brushGroups[0]?.brushIndex ?? '?'}) has ${totalTris} triangles, exceeding maxClusterSize ${maxSize}. Keeping intact.`,
            });
        }
        return [brushGroups];
    }

    // Bisect brush groups along longest axis
    const allCentroids = brushGroups.map(bg => bg.centroid);
    const aabb = aabbFromPoints(allCentroids);
    const dx = aabb.max.x - aabb.min.x;
    const dy = aabb.max.y - aabb.min.y;
    const dz = aabb.max.z - aabb.min.z;

    let axis: 'x' | 'y' | 'z' = 'x';
    if (dy >= dx && dy >= dz) axis = 'y';
    else if (dz >= dx && dz >= dy) axis = 'z';

    const sorted = [...brushGroups].sort((a, b) => a.centroid[axis] - b.centroid[axis]);
    const mid = Math.floor(sorted.length / 2);
    const left = sorted.slice(0, mid);
    const right = sorted.slice(mid);

    return [
        ...enforceMaxSizeByBrush(left, maxSize, diagnostics),
        ...enforceMaxSizeByBrush(right, maxSize, diagnostics),
    ];
}

function buildCluster(
    triangles: number[],
    batch: MaterialBatch,
    entityIndex: number,
    isWorldspawn: boolean,
): Cluster {
    // Collect unique vertices referenced by these triangles
    const vertexMap = new Map<number, number>();
    const clusterVerts: Vertex[] = [];
    const clusterIndices: number[] = [];

    for (const ti of triangles) {
        for (let j = 0; j < 3; j++) {
            const srcIdx = batch.indices[ti * 3 + j]!;
            let newIdx = vertexMap.get(srcIdx);
            if (newIdx === undefined) {
                newIdx = clusterVerts.length;
                clusterVerts.push(batch.vertices[srcIdx]!);
                vertexMap.set(srcIdx, newIdx);
            }
            clusterIndices.push(newIdx);
        }
    }

    // Apply Forsyth vertex cache optimization
    const optimizedIndices = forsythReorder(clusterIndices, clusterVerts.length);

    const positions = clusterVerts.map(v => v.position);
    const bounds = aabbFromPoints(positions);

    return {
        bounds,
        materialID: batch.materialID,
        triangleIndices: triangles,
        vertices: clusterVerts,
        indices: optimizedIndices,
        entityIndex,
        isWorldspawn,
    };
}

function clusterWorldspawn(
    worldTriangles: number[],
    batch: MaterialBatch,
    gridCellSize: number,
    maxClusterSize: number,
    minClusterSize: number,
    diagnostics?: Diagnostics,
): PendingCluster[] {
    if (worldTriangles.length === 0) return [];

    // Group triangles by brush
    const brushGroups = groupByBrush(worldTriangles, batch);

    // Assign each brush group to a grid cell based on brush centroid
    const cellMap = new Map<string, BrushGroup[]>();
    for (const bg of brushGroups) {
        const key = getCellKey(bg.centroid, gridCellSize);
        let list = cellMap.get(key);
        if (!list) { list = []; cellMap.set(key, list); }
        list.push(bg);
    }

    // Build candidate clusters per cell, enforcing max size at brush boundaries
    const pending: PendingCluster[] = [];
    for (const [, cellBrushGroups] of cellMap) {
        const splits = enforceMaxSizeByBrush(cellBrushGroups, maxClusterSize, diagnostics);
        for (const brushGroupSet of splits) {
            const triangles = brushGroupSet.flatMap(bg => bg.triangles);
            pending.push({
                materialID: batch.materialID,
                triangles,
                batch,
                entityIndex: 0,
                isWorldspawn: true,
            });
        }
    }

    return pending;
}

export function clusterGeometry(
    batches: MaterialBatch[],
    options?: Partial<ClusterOptions>,
    diagnostics?: Diagnostics,
): Cluster[] {
    const gridCellSize = options?.gridCellSize ?? DEFAULT_GRID_CELL_SIZE;
    const maxClusterSize = options?.maxClusterSize ?? DEFAULT_MAX_CLUSTER_SIZE;
    const minClusterSize = options?.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;
    const skipWorldspawnClustering = options?.skipWorldspawnClustering ?? false;

    const allPending: PendingCluster[] = [];

    for (const batch of batches) {
        const triCount = batch.indices.length / 3;

        // Partition triangles by entity
        const worldTriangles: number[] = [];
        const entityGroups = new Map<number, number[]>();

        for (let tri = 0; tri < triCount; tri++) {
            const entityIdx = batch.triangleEntityIndices[tri];
            if (entityIdx === 0 || entityIdx === undefined) {
                worldTriangles.push(tri);
            } else {
                let list = entityGroups.get(entityIdx);
                if (!list) { list = []; entityGroups.set(entityIdx, list); }
                list.push(tri);
            }
        }

        // A) Worldspawn: brush-intact spatial grid clustering, unless explicitly skipped.
        if (skipWorldspawnClustering) {
            if (worldTriangles.length > 0) {
                allPending.push({
                    materialID: batch.materialID,
                    triangles: worldTriangles,
                    batch,
                    entityIndex: 0,
                    isWorldspawn: true,
                });
            }
        } else {
            const worldPending = clusterWorldspawn(
                worldTriangles, batch, gridCellSize, maxClusterSize, minClusterSize, diagnostics,
            );
            allPending.push(...worldPending);
        }

        // B) Non-worldspawn: one cluster per entity per material (no splitting)
        for (const [entityIndex, triangles] of entityGroups) {
            allPending.push({
                materialID: batch.materialID,
                triangles,
                batch,
                entityIndex,
                isWorldspawn: false,
            });
        }
    }

    // Merge undersized worldspawn clusters into nearest same-material neighbor
    // (only worldspawn clusters participate in merging)
    if (!skipWorldspawnClustering) {
        let changed = true;
        while (changed) {
            changed = false;
            for (let i = 0; i < allPending.length; i++) {
                const cluster = allPending[i]!;
                if (cluster.triangles.length >= minClusterSize || !cluster.isWorldspawn) continue;

                // Find nearest same-material worldspawn neighbor
                let bestDist = Infinity;
                let bestIdx = -1;
                const cA = pendingClusterCentroid(cluster);

                for (let j = 0; j < allPending.length; j++) {
                    if (i === j) continue;
                    const other = allPending[j]!;
                    if (other.materialID !== cluster.materialID || !other.isWorldspawn) continue;
                    if (other.triangles.length + cluster.triangles.length > maxClusterSize) continue;

                    const cB = pendingClusterCentroid(other);
                    const dist = vec3.length(vec3.sub(cA, cB));
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestIdx = j;
                    }
                }

                if (bestIdx >= 0) {
                    allPending[bestIdx]!.triangles.push(...cluster.triangles);
                    allPending.splice(i, 1);
                    changed = true;
                    break; // restart loop after mutation
                }
            }
        }
    }

    return allPending.map(p => buildCluster(p.triangles, p.batch, p.entityIndex, p.isWorldspawn));
}

function pendingClusterCentroid(c: PendingCluster): Vec3 {
    const centroids = c.triangles.map(ti =>
        triangleCentroid(c.batch.vertices, c.batch.indices, ti),
    );
    let sum: Vec3 = { x: 0, y: 0, z: 0 };
    for (const p of centroids) {
        sum = vec3.add(sum, p);
    }
    return vec3.scale(sum, 1 / centroids.length);
}
