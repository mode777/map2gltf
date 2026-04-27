import type { CompileOptions, Diagnostics, CompileStats } from './types.js';
import { DEFAULT_OPTIONS, createDiagnostics } from './types.js';
import { parseMap } from './pipeline/01-map-parsing.js';
import { brushToPolygons } from './pipeline/02-brush-to-polygons.js';
import { worldCSG } from './pipeline/03-world-csg.js';
import { triangulate } from './pipeline/04-triangulation.js';
import { mergeMaterials } from './pipeline/05-material-merge.js';
import { clusterGeometry } from './pipeline/06-clustering.js';
import { buildBVH } from './pipeline/07-bvh-construction.js';
import { exportGLB } from './pipeline/08-binary-export.js';

export type { CompileOptions, Diagnostics, CompileStats };
export type { DiagnosticMessage } from './types.js';

function resolveOptions(partial?: Partial<CompileOptions>): CompileOptions {
    if (!partial) return { ...DEFAULT_OPTIONS, textureSizes: new Map(DEFAULT_OPTIONS.textureSizes) };
    return {
        epsilon: partial.epsilon ?? DEFAULT_OPTIONS.epsilon,
        seedExtent: partial.seedExtent ?? DEFAULT_OPTIONS.seedExtent,
        vertexDedup: partial.vertexDedup ?? DEFAULT_OPTIONS.vertexDedup,
        defaultTextureSize: partial.defaultTextureSize ?? DEFAULT_OPTIONS.defaultTextureSize,
        gridCellSize: partial.gridCellSize ?? DEFAULT_OPTIONS.gridCellSize,
        maxClusterSize: partial.maxClusterSize ?? DEFAULT_OPTIONS.maxClusterSize,
        minClusterSize: partial.minClusterSize ?? DEFAULT_OPTIONS.minClusterSize,
        bvhLeafThreshold: partial.bvhLeafThreshold ?? DEFAULT_OPTIONS.bvhLeafThreshold,
        sahCandidates: partial.sahCandidates ?? DEFAULT_OPTIONS.sahCandidates,
        textureSizes: partial.textureSizes ?? new Map(DEFAULT_OPTIONS.textureSizes),
        skipClustering: partial.skipClustering ?? DEFAULT_OPTIONS.skipClustering,
    };
}

export async function compile(mapSource: string, options?: Partial<CompileOptions>): Promise<Uint8Array> {
    const { glb } = await compileWithDiagnostics(mapSource, options);
    return glb;
}

export async function compileWithDiagnostics(
    mapSource: string,
    options?: Partial<CompileOptions>,
): Promise<{ glb: Uint8Array; diagnostics: Diagnostics }> {
    const opts = resolveOptions(options);
    const diagnostics = createDiagnostics();

    const entities = parseMap(mapSource, diagnostics);

    // World geometry (entity 0 / worldspawn): all brushes merged for CSG
    const worldEntity = entities[0];
    let brushIdx = 0;
    const worldPolys = worldEntity
        ? worldEntity.brushes.flatMap(b => brushToPolygons(b, brushIdx++, 0))
        : [];
    const clipped = worldCSG(worldPolys);

    // Non-world entities (func_wall, func_door, …): compiled per-entity, no inter-entity CSG
    let entityIdx = 1;
    const entityPolys = entities.slice(1).flatMap(e => {
        const polys = e.brushes.flatMap(b => brushToPolygons(b, brushIdx++, entityIdx));
        entityIdx++;
        return polys;
    });

    const allPolygons = [...clipped, ...entityPolys];

    // Remove CLIP-textured polygons — they define collision volumes, not visible geometry
    const visiblePolygons = allPolygons.filter(p => p.face.textureName !== 'clip');

    if (visiblePolygons.length === 0) {
        // Empty map — return minimal GLB
        const glb = await exportGLB([], [], [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: 0,
        }]);
        return { glb, diagnostics };
    }

    const mesh = triangulate(visiblePolygons, opts.textureSizes, diagnostics);
    const batches = mergeMaterials(mesh);
    const clusters = clusterGeometry(batches, {
        gridCellSize: opts.gridCellSize,
        maxClusterSize: opts.maxClusterSize,
        minClusterSize: opts.minClusterSize,
        skipClustering: opts.skipClustering,
    }, diagnostics);
    const bvh = buildBVH(clusters, { skipClustering: opts.skipClustering });
    const glb = await exportGLB(batches, clusters, bvh);
    return { glb, diagnostics };
}

function computeBVHDepth(bvh: import('./types.js').BVHNode[]): number {
    if (bvh.length === 0) return 0;
    function depth(index: number): number {
        const node = bvh[index];
        if (!node || node.left === -1) return 1;
        return 1 + Math.max(depth(node.left), depth(node.right));
    }
    return depth(0);
}

export async function compileDetailed(
    mapSource: string,
    options?: Partial<CompileOptions>,
): Promise<{ glb: Uint8Array; diagnostics: Diagnostics; stats: CompileStats }> {
    const startTime = performance.now();
    const opts = resolveOptions(options);
    const diagnostics = createDiagnostics();

    const entities = parseMap(mapSource, diagnostics);

    const worldEntity = entities[0];
    let brushIdx = 0;
    const worldPolys = worldEntity
        ? worldEntity.brushes.flatMap(b => brushToPolygons(b, brushIdx++, 0))
        : [];

    const polygonsBeforeCSG = worldPolys.length;
    const clipped = worldCSG(worldPolys);

    let entityIdx = 1;
    const entityPolys = entities.slice(1).flatMap(e => {
        const polys = e.brushes.flatMap(b => brushToPolygons(b, brushIdx++, entityIdx));
        entityIdx++;
        return polys;
    });

    const allPolygons = [...clipped, ...entityPolys];

    // Remove CLIP-textured polygons — they define collision volumes, not visible geometry
    const visiblePolygons = allPolygons.filter(p => p.face.textureName !== 'clip');

    if (visiblePolygons.length === 0) {
        const emptyBVH = [{
            bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
            left: -1,
            right: -1,
            firstCluster: 0,
            clusterCount: 0,
        }] as import('./types.js').BVHNode[];
        const glb = await exportGLB([], [], emptyBVH);
        const compileTimeMs = performance.now() - startTime;
        const stats: CompileStats = {
            entityCount: entities.length,
            brushCount: entities.reduce((s, e) => s + e.brushes.length, 0),
            polygonsBeforeCSG,
            polygonsAfterCSG: 0,
            triangleCount: 0,
            materialCount: 0,
            clusterCount: 0,
            bvhNodeCount: 1,
            bvhLeafCount: 1,
            bvhDepth: 1,
            glbSizeBytes: glb.byteLength,
            compileTimeMs,
            warnings: diagnostics.warnings.length,
        };
        return { glb, diagnostics, stats };
    }

    const mesh = triangulate(visiblePolygons, opts.textureSizes, diagnostics);
    const batches = mergeMaterials(mesh);
    const clusters = clusterGeometry(batches, {
        gridCellSize: opts.gridCellSize,
        maxClusterSize: opts.maxClusterSize,
        minClusterSize: opts.minClusterSize,
        skipClustering: opts.skipClustering,
    }, diagnostics);
    const bvh = buildBVH(clusters, { skipClustering: opts.skipClustering });
    const glb = await exportGLB(batches, clusters, bvh);
    const compileTimeMs = performance.now() - startTime;

    const bvhLeafCount = bvh.filter(n => n.left === -1).length;
    const stats: CompileStats = {
        entityCount: entities.length,
        brushCount: entities.reduce((s, e) => s + e.brushes.length, 0),
        polygonsBeforeCSG,
        polygonsAfterCSG: visiblePolygons.length,
        triangleCount: mesh.indices.length / 3,
        materialCount: batches.length,
        clusterCount: clusters.length,
        bvhNodeCount: bvh.length,
        bvhLeafCount,
        bvhDepth: computeBVHDepth(bvh),
        glbSizeBytes: glb.byteLength,
        compileTimeMs,
        warnings: diagnostics.warnings.length,
    };

    return { glb, diagnostics, stats };
}
