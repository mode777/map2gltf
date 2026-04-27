import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, compileWithDiagnostics, compileDetailed } from '../../src/compiler.js';
import { NodeIO } from '@gltf-transform/core';

const fixtures = resolve(import.meta.dirname, '../fixtures');

function readFixture(name: string): string {
    return readFileSync(resolve(fixtures, name), 'utf-8');
}

describe('integration: compile()', () => {
    it('should compile box.map to valid GLB', async () => {
        const source = readFixture('box.map');
        const glb = await compile(source);
        expect(glb.length).toBeGreaterThan(12);

        // Parse back
        const io = new NodeIO();
        const doc = await io.readBinary(glb);
        const meshes = doc.getRoot().listMeshes();
        expect(meshes.length).toBeGreaterThanOrEqual(1);
    });

    it('should compile two-boxes.map to valid GLB with CSG', async () => {
        const source = readFixture('two-boxes.map');
        const glb = await compile(source);
        const io = new NodeIO();
        const doc = await io.readBinary(glb);
        const meshes = doc.getRoot().listMeshes();
        expect(meshes.length).toBeGreaterThanOrEqual(1);
    });

    it('should compile hollow-room.map', async () => {
        const source = readFixture('hollow-room.map');
        const glb = await compile(source);
        expect(glb.length).toBeGreaterThan(12);

        const io = new NodeIO();
        const doc = await io.readBinary(glb);
        expect(doc.getRoot().listScenes().length).toBeGreaterThanOrEqual(1);
    });

    it('should compile textured-room.map and produce materials', async () => {
        const source = readFixture('textured-room.map');
        const glb = await compile(source);

        const io = new NodeIO();
        const doc = await io.readBinary(glb);
        const materials = doc.getRoot().listMaterials();
        expect(materials.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce diagnostics without throwing', async () => {
        const source = readFixture('box.map');
        const { glb, diagnostics } = await compileWithDiagnostics(source);
        expect(glb.length).toBeGreaterThan(12);
        expect(diagnostics).toBeDefined();
        expect(diagnostics.errors).toBeDefined();
        expect(diagnostics.warnings).toBeDefined();
    });

    it('should compile large-map.map within reasonable limits', async () => {
        const source = readFixture('large-map.map');
        const glb = await compile(source);
        expect(glb.length).toBeGreaterThan(12);
    });

    it('should set generator field in asset', async () => {
        const source = readFixture('box.map');
        const glb = await compile(source);
        const io = new NodeIO();
        const doc = await io.readBinary(glb);
        expect(doc.getRoot().getAsset().generator).toBeTruthy();
    });

    it('should produce BVH hierarchy with AABB extras', async () => {
        const source = readFixture('box.map');
        const glb = await compile(source);
        const io = new NodeIO();
        const doc = await io.readBinary(glb);
        const nodes = doc.getRoot().listNodes();
        const withAabb = nodes.filter(n => {
            const extras = n.getExtras();
            return extras && typeof extras === 'object' && 'aabb' in extras;
        });
        expect(withAabb.length).toBeGreaterThanOrEqual(1);
    });

    it('should exclude CLIP-textured geometry from output', async () => {
        const source = readFixture('clip-brush.map');
        const glb = await compile(source);
        const io = new NodeIO();
        const doc = await io.readBinary(glb);
        const materials = doc.getRoot().listMaterials();
        const materialNames = materials.map(m => m.getName());
        expect(materialNames).not.toContain('clip');
        // Should still have the brick material
        expect(materialNames.some(n => n === 'brick')).toBe(true);
    });

    it('should compile with skipClustering producing one cluster per material', async () => {
        const source = readFixture('two-rooms.map');
        const { stats } = await compileDetailed(source, { skipClustering: true });
        // One cluster per material
        expect(stats.clusterCount).toBe(stats.materialCount);
        // Single BVH node when clustering is skipped
        expect(stats.bvhNodeCount).toBe(1);
        expect(stats.bvhLeafCount).toBe(1);
        expect(stats.bvhDepth).toBe(1);
    });

    it('skipClustering should not change triangle count', async () => {
        const source = readFixture('two-rooms.map');
        const normal = await compileDetailed(source);
        const skipped = await compileDetailed(source, { skipClustering: true });
        expect(skipped.stats.triangleCount).toBe(normal.stats.triangleCount);
    });
});
