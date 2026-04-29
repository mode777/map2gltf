import { compileDetailed } from '../../src/compiler.js';
import type { CompileOptions, CompileStats } from '../../src/compiler.js';
import { BrowserTextureProvider } from '../../src/providers/browser-texture-provider.js';

interface WorkerRequest {
    mapSource: string;
    options?: Partial<CompileOptions>;
    textureBaseUrl?: string;
}

type WorkerResponse =
    | { type: 'result'; glb: Uint8Array; stats: CompileStats }
    | { type: 'error'; message: string };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const { mapSource, options, textureBaseUrl } = event.data;
    try {
        const compileOptions: Partial<CompileOptions> = { ...options };
        if (textureBaseUrl) {
            compileOptions.textureProvider = new BrowserTextureProvider(textureBaseUrl);
        }
        const { glb, stats } = await compileDetailed(mapSource, compileOptions);
        (self as unknown as Worker).postMessage(
            { type: 'result', glb, stats } satisfies WorkerResponse,
            { transfer: [glb.buffer] },
        );
    } catch (err) {
        (self as unknown as Worker).postMessage({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
        } satisfies WorkerResponse);
    }
};
