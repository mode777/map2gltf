import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, compileWithDiagnostics } from '../../src/compiler.js';

const fixtures = resolve(import.meta.dirname, '../fixtures');

function readFixture(name: string): string {
    return readFileSync(resolve(fixtures, name), 'utf-8');
}

describe('npm package verification', () => {
    it('should export compile and compileWithDiagnostics from entry point', async () => {
        expect(typeof compile).toBe('function');
        expect(typeof compileWithDiagnostics).toBe('function');
    });

    it('should compile with default options (no options argument)', async () => {
        const source = readFixture('box.map');
        const glb = await compile(source);
        expect(glb).toBeInstanceOf(Uint8Array);
        expect(glb.length).toBeGreaterThan(12);
    });

    it('should compile with partial options', async () => {
        const source = readFixture('box.map');
        const glb = await compile(source, { maxClusterSize: 256 });
        expect(glb).toBeInstanceOf(Uint8Array);
        expect(glb.length).toBeGreaterThan(12);
    });

    it('should return diagnostics from compileWithDiagnostics', async () => {
        const source = readFixture('box.map');
        const { glb, diagnostics } = await compileWithDiagnostics(source);
        expect(glb.length).toBeGreaterThan(12);
        expect(diagnostics).toBeDefined();
        expect(Array.isArray(diagnostics.warnings)).toBe(true);
        expect(Array.isArray(diagnostics.errors)).toBe(true);
    });

    it('should not import Node.js APIs in core pipeline files', () => {
        const pipelineDir = resolve(import.meta.dirname, '../../src/pipeline');
        const mathDir = resolve(import.meta.dirname, '../../src/math');

        const dirs = [pipelineDir, mathDir];
        const nodeModulePattern = /from\s+['"]node:/;

        for (const dir of dirs) {
            const files = readdirSync(dir).filter(f => f.endsWith('.ts'));
            for (const file of files) {
                const content = readFileSync(resolve(dir, file), 'utf-8');
                const hasNodeImport = nodeModulePattern.test(content);
                expect(hasNodeImport, `${file} should not import Node.js built-in modules`).toBe(false);
            }
        }
    });
});
