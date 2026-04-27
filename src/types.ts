export interface Vec2 {
    readonly x: number;
    readonly y: number;
}

export interface Vec3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface AABB {
    readonly min: Vec3;
    readonly max: Vec3;
}

export interface CompileOptions {
    readonly epsilon: number;
    readonly seedExtent: number;
    readonly vertexDedup: number;
    readonly defaultTextureSize: number;
    readonly gridCellSize: number;
    readonly maxClusterSize: number;
    readonly minClusterSize: number;
    readonly bvhLeafThreshold: number;
    readonly sahCandidates: number;
    readonly textureSizes: Map<string, [number, number]>;
    readonly skipClustering: boolean;
}

export const DEFAULT_OPTIONS: CompileOptions = {
    epsilon: 1e-5,
    seedExtent: 65536,
    vertexDedup: 1e-4,
    defaultTextureSize: 64,
    gridCellSize: 16,
    maxClusterSize: 512,
    minClusterSize: 24,
    bvhLeafThreshold: 4,
    sahCandidates: 12,
    textureSizes: new Map(),
    skipClustering: false,
};

export interface DiagnosticMessage {
    readonly step: string;
    readonly message: string;
    readonly location?: string | undefined;
}

export interface Diagnostics {
    readonly warnings: DiagnosticMessage[];
    readonly errors: DiagnosticMessage[];
}

export function createDiagnostics(): Diagnostics {
    return { warnings: [], errors: [] };
}

export interface ParsedFace {
    readonly planePoints: [Vec3, Vec3, Vec3];
    readonly normal: Vec3;
    readonly distance: number;
    readonly textureName: string;
    readonly texAxisU: Vec3;
    readonly texOffsetU: number;
    readonly texAxisV: Vec3;
    readonly texOffsetV: number;
    readonly texScaleU: number;
    readonly texScaleV: number;
}

export interface ParsedBrush {
    readonly faces: ParsedFace[];
}

export interface ParsedEntity {
    readonly properties: Record<string, string>;
    readonly brushes: ParsedBrush[];
}

export interface ConvexPolygon {
    readonly vertices: Vec3[];
    readonly face: ParsedFace;
    readonly brushIndex: number;
    readonly entityIndex: number;
}

export interface Vertex {
    readonly position: Vec3;
    readonly normal: Vec3;
    readonly uv: Vec2;
}

export interface TriangulatedMesh {
    readonly vertices: Vertex[];
    readonly indices: number[];
    readonly triangleMaterials: string[];
    readonly triangleEntityIndices: number[];
    readonly triangleBrushIndices: number[];
}

export interface MaterialBatch {
    readonly materialID: number;
    readonly textureName: string;
    readonly vertices: Vertex[];
    readonly indices: number[];
    readonly triangleEntityIndices: number[];
    readonly triangleBrushIndices: number[];
}

export interface Cluster {
    readonly bounds: AABB;
    readonly materialID: number;
    readonly triangleIndices: number[];
    readonly vertices: Vertex[];
    readonly indices: number[];
}

export interface BVHNode {
    bounds: AABB;
    left: number;
    right: number;
    firstCluster: number;
    clusterCount: number;
}

export interface CompileStats {
    readonly entityCount: number;
    readonly brushCount: number;
    readonly polygonsBeforeCSG: number;
    readonly polygonsAfterCSG: number;
    readonly triangleCount: number;
    readonly materialCount: number;
    readonly clusterCount: number;
    readonly bvhNodeCount: number;
    readonly bvhLeafCount: number;
    readonly bvhDepth: number;
    readonly glbSizeBytes: number;
    readonly compileTimeMs: number;
    readonly warnings: number;
}
