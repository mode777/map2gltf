import type { CompileStats } from '../../src/compiler.js';

const panel = document.getElementById('metadata-panel')!;

const STAT_LABELS: Array<[keyof CompileStats, string, (v: number) => string]> = [
    ['entityCount', 'Entities', String],
    ['brushCount', 'Brushes', String],
    ['polygonsAfterCSG', 'Polygons (after CSG)', String],
    ['triangleCount', 'Triangles', String],
    ['materialCount', 'Materials', String],
    ['clusterCount', 'Clusters', String],
    ['bvhNodeCount', 'BVH Nodes', String],
    ['bvhDepth', 'BVH Depth', String],
    ['glbSizeBytes', 'GLB Size', formatBytes],
    ['compileTimeMs', 'Compile Time', v => `${v.toFixed(1)} ms`],
    ['warnings', 'Warnings', String],
];

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function renderMetadata(stats: CompileStats): void {
    panel.innerHTML = '';
    const dl = document.createElement('dl');
    dl.className = 'metadata-list';
    for (const [key, label, fmt] of STAT_LABELS) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = fmt(stats[key]);
        dl.appendChild(dt);
        dl.appendChild(dd);
    }
    panel.appendChild(dl);
    panel.hidden = false;
}

export function hideMetadata(): void {
    panel.hidden = true;
}
