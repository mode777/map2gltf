import { initDropZone } from './drop-zone.js';
import { showCompiling, showResult, showError } from './ui.js';
import { initPreview } from './preview.js';
import { renderMetadata } from './metadata-panel.js';
import { extractBVHTree, initBVHTree } from './bvh-tree.js';
import { initClusterHighlighter, collectLeafDescendants } from './cluster-highlight.js';
import type { CompileStats } from '../../src/compiler.js';

const worker = new Worker(new URL('./compiler-worker.ts', import.meta.url), { type: 'module' });
const canvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
const preview = initPreview(canvas);
const highlighter = initClusterHighlighter(preview.getScene());
const bvhTree = initBVHTree(document.getElementById('bvh-tree-panel')!);

bvhTree.onSelect((node) => {
    if (!node) {
        highlighter.clear();
        return;
    }
    const leaves = collectLeafDescendants(node);
    highlighter.highlight(leaves);
});

// AABB wireframe on hover
const treeWithHover = bvhTree as unknown as { onHover(cb: (n: { aabb: { min: number[]; max: number[] } } | null) => void): void };
treeWithHover.onHover((node) => {
    if (node) {
        highlighter.showAABB(node.aabb);
    } else {
        highlighter.hideAABB();
    }
});

let currentFileName = 'output.map';

worker.onmessage = async (event: MessageEvent) => {
    const data = event.data as { type: string; glb?: Uint8Array; stats?: CompileStats; message?: string };
    if (data.type === 'result' && data.glb) {
        showResult(data.glb, currentFileName);
        if (data.stats) {
            renderMetadata(data.stats);
        }
        const group = await preview.loadGLB(data.glb);
        const bvhRoot = extractBVHTree(group);
        if (bvhRoot) {
            bvhTree.build(bvhRoot);
        }
    } else if (data.type === 'error') {
        showError(data.message ?? 'Unknown error');
    }
};

worker.onerror = (err) => {
    showError(`Worker error: ${err.message}`);
};

async function handleFile(file: File): Promise<void> {
    currentFileName = file.name;
    showCompiling(file.name);
    highlighter.clear();
    bvhTree.clearSelection();
    const mapSource = await file.text();
    worker.postMessage({ mapSource });
}

initDropZone({
    element: document.getElementById('drop-zone')!,
    onFile: (file) => { void handleFile(file); },
    onError: showError,
});
