#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { compile, compileWithDiagnostics } from './compiler.js';

function printUsage(): void {
    console.log(`Usage: map2gltf <input.map> [options]

Options:
  -o, --output <file>        Output .glb path (default: <input>.glb)
  --default-texture-size     Default texture dimensions (default: 64)
  --grid-cell-size           Clustering grid cell size (default: 16)
  --max-cluster-size         Max triangles per cluster (default: 512)
  --min-cluster-size         Min triangles per cluster (default: 8)
  --bvh-leaf-threshold       BVH leaf cluster threshold (default: 4)
  --no-clustering            Skip spatial clustering (one cluster per material)
  -v, --verbose              Print diagnostics to stderr
  -h, --help                 Show help`);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
        printUsage();
        process.exit(0);
    }

    let inputFile = '';
    let outputFile = '';
    let verbose = false;
    let skipClustering = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '-o' || arg === '--output') {
            outputFile = args[++i] ?? '';
        } else if (arg === '-v' || arg === '--verbose') {
            verbose = true;
        } else if (arg === '--no-clustering') {
            skipClustering = true;
        } else if (!arg.startsWith('-')) {
            inputFile = arg;
        }
    }

    if (!inputFile) {
        console.error('Error: No input file specified');
        process.exit(1);
    }

    const inputPath = resolve(inputFile);
    if (!outputFile) {
        outputFile = inputPath.replace(/\.map$/i, '.glb');
    }

    try {
        const mapSource = readFileSync(inputPath, 'utf-8');

        if (verbose) {
            const { glb, diagnostics } = await compileWithDiagnostics(mapSource, { skipClustering });
            for (const w of diagnostics.warnings) {
                console.error(`[WARN] [${w.step}] ${w.message}${w.location ? ` (${w.location})` : ''}`);
            }
            for (const e of diagnostics.errors) {
                console.error(`[ERR] [${e.step}] ${e.message}${e.location ? ` (${e.location})` : ''}`);
            }
            writeFileSync(outputFile, glb);
        } else {
            const glb = await compile(mapSource, { skipClustering });
            writeFileSync(outputFile, glb);
        }

        console.log(`Wrote ${outputFile}`);
    } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

main();
