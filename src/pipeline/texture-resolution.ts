import type { ConvexPolygon, TextureProvider, TextureMap, Diagnostics } from '../types.js';

export async function resolveTextures(
    polygons: ConvexPolygon[],
    provider: TextureProvider | undefined,
    diagnostics: Diagnostics,
): Promise<TextureMap> {
    const uniqueNames = new Set<string>();
    for (const poly of polygons) {
        uniqueNames.add(poly.face.textureName);
    }

    const result: TextureMap = new Map();

    if (!provider) {
        for (const name of uniqueNames) {
            result.set(name, null);
        }
    } else {
        const entries = [...uniqueNames];
        const resolved = await Promise.all(
            entries.map(name => provider.resolve(name)),
        );
        for (let i = 0; i < entries.length; i++) {
            result.set(entries[i]!, resolved[i]!);
            if (resolved[i] !== null) {
                diagnostics.info.push({
                    step: 'texture-resolution',
                    message: `Texture '${entries[i]}' resolved to '${resolved[i]!.relativePath}'`,
                });
            }
        }
    }

    for (const [name, info] of result) {
        if (info === null) {
            diagnostics.warnings.push({
                step: 'texture-resolution',
                message: `Texture '${name}' could not be resolved; using default size and placeholder material`,
            });
        }
    }

    return result;
}
