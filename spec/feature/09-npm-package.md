# Feature 9 — npm Package

[← Back to main spec](../spec.md)

---

## Overview

Package the compiler as a publishable **npm library** that exposes the `compile()` function as its public API. The package is the primary distribution artefact for Node.js and bundler consumers and serves as the foundation for the CLI interface (Feature 10) and the web application (Feature 11).

**Input:** Compiled TypeScript source (Features 1–8)
**Output:** Publishable npm package with library entry point, TypeScript declarations, and package metadata

**Primary code file:** `package.json`

---

## Package Identity

```jsonc
{
    "name": "map2gltf",
    "version": "0.1.0",
    "description": "Quake .map (Standard & Valve 220) to glTF/GLB compiler",
    "license": "MIT",
    "type": "module"
}
```

---

## Entry Points

### Library Entry Point

The package exposes `compiler.ts` as the main entry point. Consumers import the `compile()` function directly:

```typescript
import { compile } from 'map2gltf';

const mapSource = fs.readFileSync('level.map', 'utf-8');
const glb = await compile(mapSource, { textureSizes: new Map() });
fs.writeFileSync('level.glb', glb);
```

### Package Exports

```jsonc
{
    "main": "dist/compiler.js",
    "types": "dist/compiler.d.ts",
    "exports": {
        ".": {
            "import": "./dist/compiler.js",
            "types": "./dist/compiler.d.ts"
        }
    }
}
```

Only the top-level `compile()` function and the `CompileOptions` / `Diagnostics` types are part of the public API. Internal pipeline features, math utilities, and types are implementation details and are **not** exported from the package entry point.

The package manifest also exposes the CLI binary via its `bin` field, but the CLI behavior itself is specified separately in [Feature 10](10-cli-interface.md).

### Public API Surface

```typescript
// Public API — re-exported from compiler.ts
export async function compile(mapSource: string, options?: Partial<CompileOptions>): Promise<Uint8Array>;
export async function compileWithDiagnostics(
    mapSource: string,
    options?: Partial<CompileOptions>
): Promise<{ glb: Uint8Array; diagnostics: Diagnostics }>;

export interface CompileOptions { /* as defined in spec.md */ }
export interface Diagnostics { /* as defined in spec.md */ }
export interface DiagnosticMessage { /* as defined in spec.md */ }
```

> **Implementation note — async API:** Both `compile()` and `compileWithDiagnostics()` are `async` functions returning Promises. This is because the GLB export feature uses `@gltf-transform/core`'s async `writeBinary()`. All callers must `await` the result.

The `compile()` function applies default values for all omitted `CompileOptions` fields. The `compileWithDiagnostics()` variant returns both the GLB output and accumulated warnings/errors.

## Published Files

The `files` field restricts what is included in the published tarball:

```jsonc
{
    "files": [
        "dist",
        "README.md",
        "LICENSE"
    ]
}
```

This excludes `src/`, `tests/`, `web/`, `spec/`, and configuration files from the published package. Only compiled JavaScript, declaration files, source maps, and documentation are shipped.

---

## TypeScript Declarations

The build emits `.d.ts` and `.d.ts.map` files (enabled by `declaration` and `declarationMap` in `tsconfig.json`). Consumers get full IntelliSense and go-to-definition support in their editors.

---

## Browser Compatibility

The core library (`compiler.ts` and all pipeline features) does **not** use Node.js-specific APIs (`fs`, `path`, `process`, `Buffer`, etc.) in its compilation logic. The `compile()` function accepts a `string` and returns a `Uint8Array` — both are platform-neutral types. This makes the library directly importable in browser bundles (as used by Feature 11's Web Worker).

The only Node.js dependency is in `src/index.ts` (the CLI entry point described in [Feature 10](10-cli-interface.md)), which uses `fs` and `process.argv`. This file is excluded from browser builds.

---

## Build

```bash
# Compile TypeScript → JavaScript + declarations
npm run build

# Verify the package contents before publishing
npm pack --dry-run
```

The `prepublishOnly` script ensures a fresh build before every `npm publish`:

```jsonc
{
    "scripts": {
        "prepublishOnly": "npm run build"
    }
}
```

---

## Verification

### Unit Tests

1. **Public export surface:** Import `map2gltf` from the built `dist/` output. Assert that `compile`, `compileWithDiagnostics`, and the option/diagnostic types are accessible.
2. **Default options:** Call `compile(mapSource)` with no options argument. Assert it produces a valid GLB (non-zero `Uint8Array`) without throwing.
3. **Partial options:** Call `compile(mapSource, { maxClusterSize: 256 })` with a subset of options. Assert defaults are applied for omitted fields and compilation succeeds.
4. **Diagnostics passthrough:** Call `compileWithDiagnostics()` with a map containing a missing texture reference. Assert `diagnostics.warnings` contains at least one entry.
5. **No Node.js APIs in core:** Static analysis (grep or lint rule): assert that no file in `src/pipeline/` or `src/math/` imports from `node:fs`, `node:path`, or other Node built-in modules.

### Integration Test

Import `compile` from the package entry point (using the `exports` map), compile `tests/fixtures/hollow-room.map`, and assert the output is a valid GLB with the expected structure (as verified in the Feature 8 integration tests).
