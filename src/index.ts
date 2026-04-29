#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile, compileWithDiagnostics } from './compiler.js';
import type { CompileOptions, Diagnostics } from './compiler.js';

export const USAGE_TEXT = `Usage: map2gltf <input.map> [options]

Options:
  -o, --output <file>        Output .glb path (default: <input>.glb)
  --default-texture-size <n> Default texture dimensions (default: 64)
  --grid-cell-size <n>       Clustering grid cell size (default: 16)
  --max-cluster-size <n>     Max triangles per cluster (default: 512)
  --min-cluster-size <n>     Min triangles per cluster (default: 8)
  --bvh-leaf-threshold <n>   BVH leaf cluster threshold (default: 4)
  --no-clustering            Skip worldspawn spatial clustering
  -v, --verbose              Print diagnostics to stderr
  -h, --help                 Show help`;

export type CliCommand =
    | { kind: 'help' }
    | {
        kind: 'compile';
        inputFile: string;
        outputFile?: string;
        verbose: boolean;
        compileOptions: Partial<CompileOptions>;
    };

type CompileFn = (mapSource: string, options?: Partial<CompileOptions>) => Promise<Uint8Array>;
type CompileWithDiagnosticsFn = (
    mapSource: string,
    options?: Partial<CompileOptions>,
) => Promise<{ glb: Uint8Array; diagnostics: Diagnostics }>;

export interface CliRuntime {
    readFile(path: string): string;
    writeFile(path: string, data: Uint8Array): void;
    compile: CompileFn;
    compileWithDiagnostics: CompileWithDiagnosticsFn;
    resolvePath(path: string): string;
    stdout(message: string): void;
    stderr(message: string): void;
}

const defaultRuntime: CliRuntime = {
    readFile: path => readFileSync(path, 'utf-8'),
    writeFile: (path, data) => writeFileSync(path, data),
    compile,
    compileWithDiagnostics,
    resolvePath: path => resolve(path),
    stdout: message => console.log(message),
    stderr: message => console.error(message),
};

function readValueFlag(args: string[], index: number, flag: string): string {
    const raw = args[index + 1];
    if (!raw || raw.startsWith('-')) {
        throw new Error(`Missing value for ${flag}`);
    }
    return raw;
}

function readIntegerFlag(args: string[], index: number, flag: string): number {
    const raw = readValueFlag(args, index, flag);
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid value for ${flag}: ${raw}`);
    }
    return value;
}

export function parseCliArgs(args: string[]): CliCommand {
    if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
        return { kind: 'help' };
    }

    const compileOptions: Partial<CompileOptions> = {};
    let inputFile = '';
    let outputFile: string | undefined;
    let verbose = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        switch (arg) {
            case '-o':
            case '--output':
                outputFile = readValueFlag(args, i, arg);
                i++;
                break;
            case '-v':
            case '--verbose':
                verbose = true;
                break;
            case '--no-clustering':
                compileOptions.skipWorldspawnClustering = true;
                break;
            case '--default-texture-size':
                compileOptions.defaultTextureSize = readIntegerFlag(args, i, arg);
                i++;
                break;
            case '--grid-cell-size':
                compileOptions.gridCellSize = readIntegerFlag(args, i, arg);
                i++;
                break;
            case '--max-cluster-size':
                compileOptions.maxClusterSize = readIntegerFlag(args, i, arg);
                i++;
                break;
            case '--min-cluster-size':
                compileOptions.minClusterSize = readIntegerFlag(args, i, arg);
                i++;
                break;
            case '--bvh-leaf-threshold':
                compileOptions.bvhLeafThreshold = readIntegerFlag(args, i, arg);
                i++;
                break;
            default:
                if (arg.startsWith('-')) {
                    throw new Error(`Unknown option ${arg}`);
                }
                if (inputFile) {
                    throw new Error('Multiple input files provided');
                }
                inputFile = arg;
                break;
        }
    }

    if (!inputFile) {
        throw new Error('No input file specified');
    }

    return {
        kind: 'compile',
        inputFile,
        ...(outputFile ? { outputFile } : {}),
        verbose,
        compileOptions,
    };
}

export async function runCli(args: string[], runtime: CliRuntime = defaultRuntime): Promise<number> {
    try {
        const command = parseCliArgs(args);
        if (command.kind === 'help') {
            runtime.stdout(USAGE_TEXT);
            return 0;
        }

        const inputPath = runtime.resolvePath(command.inputFile);
        const outputFile = command.outputFile ?? inputPath.replace(/\.map$/i, '.glb');
        const mapSource = runtime.readFile(inputPath);

        if (command.verbose) {
            const { glb, diagnostics } = await runtime.compileWithDiagnostics(mapSource, command.compileOptions);
            for (const w of diagnostics.warnings) {
                runtime.stderr(`[WARN] [${w.step}] ${w.message}${w.location ? ` (${w.location})` : ''}`);
            }
            for (const e of diagnostics.errors) {
                runtime.stderr(`[ERR] [${e.step}] ${e.message}${e.location ? ` (${e.location})` : ''}`);
            }
            runtime.writeFile(outputFile, glb);
        } else {
            const glb = await runtime.compile(mapSource, command.compileOptions);
            runtime.writeFile(outputFile, glb);
        }

        runtime.stdout(`Wrote ${outputFile}`);
        return 0;
    } catch (err) {
        runtime.stderr(`Error: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

async function main(): Promise<void> {
    process.exit(await runCli(process.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void main();
}
