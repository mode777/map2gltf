import { compileDetailed } from '../../src/compiler.js';
import type { CompileOptions, CompileStats } from '../../src/compiler.js';

interface WorkerRequest {
    mapSource: string;
    options?: Partial<CompileOptions>;
}

type WorkerResponse =
    | { type: 'result'; glb: Uint8Array; stats: CompileStats }
    | { type: 'error'; message: string };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const { mapSource, options } = event.data;
    try {
        const { glb, stats } = await compileDetailed(mapSource, options);
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
