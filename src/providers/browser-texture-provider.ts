import type { TextureProvider, TextureInfo } from '../types.js';

export class BrowserTextureProvider implements TextureProvider {
    private readonly baseUrl: string;
    private readonly cache = new Map<string, TextureInfo | null>();

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    }

    async resolve(textureName: string): Promise<TextureInfo | null> {
        if (this.cache.has(textureName)) return this.cache.get(textureName)!;

        const relativePath = `${textureName}.png`;
        const url = new URL(relativePath, this.baseUrl).href;

        try {
            const info = await new Promise<TextureInfo | null>((resolve) => {
                const img = new Image();
                img.onload = () => {
                    resolve({
                        relativePath,
                        size: [img.naturalWidth, img.naturalHeight],
                    });
                };
                img.onerror = () => resolve(null);
                img.src = url;
            });
            this.cache.set(textureName, info);
            return info;
        } catch {
            this.cache.set(textureName, null);
            return null;
        }
    }
}
