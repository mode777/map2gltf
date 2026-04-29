import { imageSize } from 'image-size';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { TextureProvider, TextureInfo } from '../types.js';

export class NodeTextureProvider implements TextureProvider {
    private readonly basePath: string;
    private readonly cache = new Map<string, TextureInfo | null>();

    constructor(basePath: string) {
        this.basePath = basePath;
    }

    async resolve(textureName: string): Promise<TextureInfo | null> {
        if (this.cache.has(textureName)) return this.cache.get(textureName)!;

        const relativePath = `${textureName}.png`;
        const fullPath = join(this.basePath, relativePath);

        if (!existsSync(fullPath)) {
            this.cache.set(textureName, null);
            return null;
        }

        try {
            const buffer = readFileSync(fullPath);
            const dimensions = imageSize(buffer);
            if (!dimensions.width || !dimensions.height) {
                this.cache.set(textureName, null);
                return null;
            }
            const info: TextureInfo = {
                relativePath,
                size: [dimensions.width, dimensions.height],
            };
            this.cache.set(textureName, info);
            return info;
        } catch {
            this.cache.set(textureName, null);
            return null;
        }
    }
}
