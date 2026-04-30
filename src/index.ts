#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile, compileWithDiagnostics } from './compiler.js';
import type { CompileOptions, Diagnostics } from './compiler.js';
import { NodeTextureProvider } from './providers/node-texture-provider.js';
import type { ExportFormat } from './types.js';

export const USAGE_TEXT = `Usage: map2gltf <input.map> [options]

Options:
  -o, --output <file>        Output .glb path (default: <input>.glb)
    --format <glb|gltf>        Output format (default: glb)
  --default-texture-size <n> Default texture dimensions (default: 64)
  --grid-cell-size <n>       Clustering grid cell size (default: 16)
  --max-cluster-size <n>     Max triangles per cluster (default: 512)
  --min-cluster-size <n>     Min triangles per cluster (default: 8)
  --bvh-leaf-threshold <n>   BVH leaf cluster threshold (default: 4)
  --no-clustering            Skip worldspawn spatial clustering
  --texture-path <dir>       Base directory for texture lookup
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

type MutableCompileOptions = {
    -readonly [K in keyof CompileOptions]?: CompileOptions[K];
};

export interface CliRuntime {
    readFile(path: string): string;
    writeFile(path: string, data: Uint8Array): void;
    compile: CompileFn;
    compileWithDiagnostics: CompileWithDiagnosticsFn;
    resolvePath(path: string): string;
    stdout(message: string): void;
    stderr(message: string): void;
}

function toPosixPath(path: string): string {
    return path.replace(/\\/g, '/');
}

function computeTextureBasePath(outputFile: string, textureBasePath: string, runtime: CliRuntime): string | undefined {
    const resolvedOutputFile = isAbsolute(outputFile) ? outputFile : runtime.resolvePath(outputFile);
    const resolvedTextureBasePath = isAbsolute(textureBasePath) ? textureBasePath : runtime.resolvePath(textureBasePath);
    const relativeTexturePath = toPosixPath(relative(dirname(resolvedOutputFile), resolvedTextureBasePath));

    if (!relativeTexturePath || relativeTexturePath === '.') {
        return undefined;
    }

    if (/^(?:[a-zA-Z][a-zA-Z\d+.-]*:|\/)/.test(relativeTexturePath)) {
        throw new Error(`Texture path must resolve to a relative URI from the output file: ${textureBasePath}`);
    }

    return relativeTexturePath;
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

function readFormatFlag(args: string[], index: number, flag: string): ExportFormat {
    const raw = readValueFlag(args, index, flag);
    const value = raw.toLowerCase();
    if (value !== 'glb' && value !== 'gltf') {
        throw new Error(`Invalid value for ${flag}: ${raw}`);
    }
    return value;
}

export function parseCliArgs(args: string[]): CliCommand {
    if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
        return { kind: 'help' };
    }

    const compileOptions: MutableCompileOptions = {};
    let inputFile = '';
    let outputFile: string | undefined;
    let verbose = false;
    let texturePath: string | undefined;
    let exportFormat: ExportFormat | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        switch (arg) {
            case '-o':
            case '--output':
                outputFile = readValueFlag(args, i, arg);
                i++;
                break;
            case '--format':
                exportFormat = readFormatFlag(args, i, arg);
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
            case '--texture-path':
                texturePath = readValueFlag(args, i, arg);
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

    let textureProvider: import('./types.js').TextureProvider | undefined;
    if (texturePath) {
        textureProvider = new NodeTextureProvider(texturePath);
    }

    const compileOptionsWithFormat = exportFormat
        ? { ...compileOptions, exportFormat }
        : compileOptions;

    return {
        kind: 'compile',
        inputFile,
        ...(outputFile ? { outputFile } : {}),
        verbose,
        compileOptions: textureProvider
            ? { ...compileOptionsWithFormat, textureProvider, textureBasePath: texturePath }
            : compileOptionsWithFormat,
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
        const exportFormat = command.compileOptions.exportFormat ?? 'glb';
        const defaultExtension = exportFormat === 'gltf' ? '.gltf' : '.glb';
        const outputFile = command.outputFile ?? inputPath.replace(/\.map$/i, defaultExtension);
        const mapSource = runtime.readFile(inputPath);
        const compileOptions = { ...command.compileOptions };

        if (compileOptions.textureProvider && compileOptions.textureBasePath) {
            compileOptions.textureBasePath = computeTextureBasePath(outputFile, compileOptions.textureBasePath, runtime);
        }

        if (command.verbose) {
            const { glb, diagnostics } = await runtime.compileWithDiagnostics(mapSource, compileOptions);
            for (const info of diagnostics.info) {
                runtime.stderr(`[INFO] [${info.step}] ${info.message}${info.location ? ` (${info.location})` : ''}`);
            }
            for (const debug of diagnostics.debug) {
                runtime.stderr(`[DEBUG] [${debug.step}] ${debug.message}${debug.location ? ` (${debug.location})` : ''}`);
            }
            for (const w of diagnostics.warnings) {
                runtime.stderr(`[WARN] [${w.step}] ${w.message}${w.location ? ` (${w.location})` : ''}`);
            }
            for (const e of diagnostics.errors) {
                runtime.stderr(`[ERR] [${e.step}] ${e.message}${e.location ? ` (${e.location})` : ''}`);
            }
            runtime.writeFile(outputFile, glb);
        } else {
            const glb = await runtime.compile(mapSource, compileOptions);
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

function isMainModule(): boolean {
    const entryPath = process.argv[1];
    if (!entryPath) {
        return false;
    }

    try {
        return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return import.meta.url === pathToFileURL(entryPath).href;
    }
}

if (isMainModule()) {
    void main();
}
