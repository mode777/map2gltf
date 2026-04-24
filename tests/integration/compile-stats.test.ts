import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileDetailed } from '../../src/compiler.js';
import type { CompileStats } from '../../src/types.js';

const fixtures = resolve(import.meta.dirname, '../fixtures');

function readFixture(name: string): string {
    return readFileSync(resolve(fixtures, name), 'utf-8');
}

describe('CompileStats extraction (14.12)', () => {
    it('should produce valid CompileStats from compileDetailed()', async () => {
        const source = readFixture('box.map');
        const { glb, stats } = await compileDetailed(source);

        expect(stats.entityCount).toBeGreaterThanOrEqual(1);
        expect(stats.brushCount).toBeGreaterThanOrEqual(1);
        expect(stats.polygonsBeforeCSG).toBeGreaterThan(0);
        expect(stats.polygonsAfterCSG).toBeGreaterThan(0);
        expect(stats.triangleCount).toBeGreaterThan(0);
        expect(stats.materialCount).toBeGreaterThanOrEqual(1);
        expect(stats.clusterCount).toBeGreaterThanOrEqual(1);
        expect(stats.bvhNodeCount).toBeGreaterThanOrEqual(1);
        expect(stats.bvhLeafCount).toBeGreaterThanOrEqual(1);
        expect(stats.bvhDepth).toBeGreaterThanOrEqual(1);
        expect(stats.glbSizeBytes).toBe(glb.byteLength);
        expect(stats.compileTimeMs).toBeGreaterThanOrEqual(0);
        expect(stats.warnings).toBeGreaterThanOrEqual(0);
    });

    it('should have consistent stats for large-map.map', async () => {
        const source = readFixture('large-map.map');
        const { stats } = await compileDetailed(source);

        expect(stats.brushCount).toBeGreaterThan(10);
        expect(stats.triangleCount).toBeGreaterThan(stats.materialCount);
        expect(stats.bvhNodeCount).toBeGreaterThanOrEqual(stats.bvhLeafCount);
        expect(stats.bvhDepth).toBeGreaterThanOrEqual(1);
        expect(stats.bvhDepth).toBeLessThan(50); // reasonable depth
    });

    it('should include compileTimeMs as positive number', async () => {
        const source = readFixture('box.map');
        const { stats } = await compileDetailed(source);
        expect(stats.compileTimeMs).toBeGreaterThan(0);
    });

    it('should count warnings from diagnostics', async () => {
        const source = readFixture('box.map');
        const { stats, diagnostics } = await compileDetailed(source);
        expect(stats.warnings).toBe(diagnostics.warnings.length);
    });
});
