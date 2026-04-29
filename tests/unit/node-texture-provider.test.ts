import { describe, it, expect } from 'vitest';
import { NodeTextureProvider } from '../../src/providers/node-texture-provider.js';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const fixtureDir = join(import.meta.dirname!, '..', 'fixtures', 'textures');

describe('NodeTextureProvider', () => {
    it('should resolve an existing PNG and return its dimensions', async () => {
        const provider = new NodeTextureProvider(fixtureDir);
        const info = await provider.resolve('brick_wall');

        expect(info).not.toBeNull();
        expect(info!.relativePath).toBe('brick_wall.png');
        expect(info!.size[0]).toBe(128);
        expect(info!.size[1]).toBe(64);
    });

    it('should return null for a nonexistent texture', async () => {
        const provider = new NodeTextureProvider(fixtureDir);
        const info = await provider.resolve('nonexistent_texture');

        expect(info).toBeNull();
    });

    it('should return null for a corrupt file without throwing', async () => {
        const corruptDir = join(fixtureDir, '..', 'textures_corrupt');
        if (!existsSync(corruptDir)) mkdirSync(corruptDir, { recursive: true });
        writeFileSync(join(corruptDir, 'bad.png'), Buffer.from([0, 1, 2, 3]));

        const provider = new NodeTextureProvider(corruptDir);
        const info = await provider.resolve('bad');

        expect(info).toBeNull();
    });

    it('should cache results across multiple calls', async () => {
        const provider = new NodeTextureProvider(fixtureDir);

        const first = await provider.resolve('brick_wall');
        const second = await provider.resolve('brick_wall');

        expect(first).toBe(second); // Same reference from cache
    });
});
