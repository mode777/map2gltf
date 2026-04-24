const statusEl = document.getElementById('status')!;
const statusText = document.getElementById('status-text')!;
const errorEl = document.getElementById('error')!;
const resultEl = document.getElementById('result')!;
const downloadLink = document.getElementById('download-link') as HTMLAnchorElement;
const dropZone = document.getElementById('drop-zone')!;
const bvhTreePanel = document.getElementById('bvh-tree-panel')!;
const metadataPanel = document.getElementById('metadata-panel')!;
const toggleBvhBtn = document.getElementById('toggle-bvh-tree') as HTMLButtonElement;
const toggleMetaBtn = document.getElementById('toggle-metadata') as HTMLButtonElement;

let currentObjectUrl: string | null = null;

toggleBvhBtn.addEventListener('click', () => {
    const show = bvhTreePanel.hidden;
    bvhTreePanel.hidden = !show;
    toggleBvhBtn.classList.toggle('active', show);
});

toggleMetaBtn.addEventListener('click', () => {
    const show = metadataPanel.hidden;
    metadataPanel.hidden = !show;
    toggleMetaBtn.classList.toggle('active', show);
});

export function showCompiling(fileName: string): void {
    statusEl.hidden = false;
    statusText.textContent = `Compiling ${fileName}…`;
    errorEl.hidden = true;
    resultEl.hidden = true;
    dropZone.style.pointerEvents = 'none';
    dropZone.style.opacity = '0.5';
}

export function showResult(glb: Uint8Array, fileName: string): void {
    if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
    }
    const blob = new Blob([glb], { type: 'model/gltf-binary' });
    currentObjectUrl = URL.createObjectURL(blob);
    downloadLink.href = currentObjectUrl;
    downloadLink.download = fileName.replace(/\.map$/i, '.glb');

    statusEl.hidden = true;
    errorEl.hidden = true;
    resultEl.hidden = false;
    dropZone.style.pointerEvents = '';
    dropZone.style.opacity = '';
}

export function showError(message: string): void {
    errorEl.textContent = message;
    statusEl.hidden = true;
    errorEl.hidden = false;
    resultEl.hidden = true;
    dropZone.style.pointerEvents = '';
    dropZone.style.opacity = '';
}

export function resetUI(): void {
    statusEl.hidden = true;
    errorEl.hidden = true;
    resultEl.hidden = true;
    bvhTreePanel.hidden = true;
    metadataPanel.hidden = true;
    toggleBvhBtn.classList.remove('active');
    toggleMetaBtn.classList.remove('active');
    dropZone.style.pointerEvents = '';
    dropZone.style.opacity = '';
}
