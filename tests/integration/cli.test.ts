import { describe, it, expect, vi } from 'vitest';
import { createDiagnostics } from '../../src/types.js';
import { parseCliArgs, runCli, type CliRuntime } from '../../src/index.js';

function createRuntime(overrides: Partial<CliRuntime> = {}): CliRuntime {
    return {
        readFile: () => 'map source',
        writeFile: () => undefined,
        compile: vi.fn(async () => new Uint8Array([1, 2, 3])),
        compileWithDiagnostics: vi.fn(async () => ({
            glb: new Uint8Array([4, 5, 6]),
            diagnostics: createDiagnostics(),
        })),
        resolvePath: path => `D:/resolved/${path}`,
        stdout: () => undefined,
        stderr: () => undefined,
        ...overrides,
    };
}

describe('CLI parsing', () => {
    it('should parse and forward supported numeric flags', () => {
        const command = parseCliArgs([
            'input.map',
            '--default-texture-size', '128',
            '--grid-cell-size', '32',
            '--max-cluster-size', '256',
            '--min-cluster-size', '16',
            '--bvh-leaf-threshold', '8',
            '--no-clustering',
            '-v',
            '-o', 'out.glb',
        ]);

        expect(command).toEqual({
            kind: 'compile',
            inputFile: 'input.map',
            outputFile: 'out.glb',
            verbose: true,
            compileOptions: {
                defaultTextureSize: 128,
                gridCellSize: 32,
                maxClusterSize: 256,
                minClusterSize: 16,
                bvhLeafThreshold: 8,
                skipWorldspawnClustering: true,
            },
        });
    });

    it('should reject unknown options', () => {
        expect(() => parseCliArgs(['input.map', '--unknown-flag'])).toThrow('Unknown option --unknown-flag');
    });

    it('should reject multiple positional inputs', () => {
        expect(() => parseCliArgs(['one.map', 'two.map'])).toThrow('Multiple input files provided');
    });

    it('should reject missing output values', () => {
        expect(() => parseCliArgs(['input.map', '--output'])).toThrow('Missing value for --output');
    });

    it('should reject invalid numeric values', () => {
        expect(() => parseCliArgs(['input.map', '--grid-cell-size', 'nope']))
            .toThrow('Invalid value for --grid-cell-size: nope');
    });
});

describe('CLI execution', () => {
    it('should forward parsed compile options to compile()', async () => {
        const compile = vi.fn(async () => new Uint8Array([1, 2, 3]));
        const writeFile = vi.fn();
        const runtime = createRuntime({ compile, writeFile });

        const exitCode = await runCli([
            'input.map',
            '--grid-cell-size', '32',
            '--max-cluster-size', '256',
            '--min-cluster-size', '16',
            '--default-texture-size', '128',
            '--bvh-leaf-threshold', '8',
        ], runtime);

        expect(exitCode).toBe(0);
        expect(compile).toHaveBeenCalledWith('map source', {
            gridCellSize: 32,
            maxClusterSize: 256,
            minClusterSize: 16,
            defaultTextureSize: 128,
            bvhLeafThreshold: 8,
        });
        expect(writeFile).toHaveBeenCalledWith('D:/resolved/input.glb', expect.any(Uint8Array));
    });

    it('should use compileWithDiagnostics in verbose mode and print diagnostics', async () => {
        const diagnostics = createDiagnostics();
        diagnostics.warnings.push({ step: '04-triangulation', message: 'warning' });
        diagnostics.errors.push({ step: '07-bvh-construction', message: 'error' });
        const compileWithDiagnostics = vi.fn(async () => ({
            glb: new Uint8Array([7, 8, 9]),
            diagnostics,
        }));
        const stderr = vi.fn();
        const runtime = createRuntime({ compileWithDiagnostics, stderr });

        const exitCode = await runCli(['input.map', '--no-clustering', '--verbose'], runtime);

        expect(exitCode).toBe(0);
        expect(compileWithDiagnostics).toHaveBeenCalledWith('map source', {
            skipWorldspawnClustering: true,
        });
        expect(stderr).toHaveBeenCalledWith('[WARN] [04-triangulation] warning');
        expect(stderr).toHaveBeenCalledWith('[ERR] [07-bvh-construction] error');
    });

    it('should return exit code 1 and print parser errors', async () => {
        const stderr = vi.fn();
        const runtime = createRuntime({ stderr });

        const exitCode = await runCli(['--grid-cell-size'], runtime);

        expect(exitCode).toBe(1);
        expect(stderr).toHaveBeenCalledWith('Error: Missing value for --grid-cell-size');
    });
});