export interface DropZoneOptions {
    element: HTMLElement;
    onFile: (file: File) => void;
    onError: (message: string) => void;
}

export function initDropZone(options: DropZoneOptions): void {
    const { element, onFile, onError } = options;

    element.addEventListener('dragenter', (e) => {
        e.preventDefault();
        element.classList.add('drop-zone--active');
    });

    element.addEventListener('dragover', (e) => {
        e.preventDefault();
        element.classList.add('drop-zone--active');
    });

    element.addEventListener('dragleave', () => {
        element.classList.remove('drop-zone--active');
    });

    element.addEventListener('drop', (e) => {
        e.preventDefault();
        element.classList.remove('drop-zone--active');
        const file = e.dataTransfer?.files[0];
        if (!file) return;
        if (!file.name.endsWith('.map')) {
            onError('Only .map files are supported');
            return;
        }
        onFile(file);
    });

    // Keyboard accessibility
    element.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const input = element.querySelector<HTMLInputElement>('input[type="file"]');
            input?.click();
        }
    });

    // File input fallback
    const fileInput = element.querySelector<HTMLInputElement>('input[type="file"]');
    fileInput?.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.map')) {
            onError('Only .map files are supported');
            return;
        }
        onFile(file);
    });
}
