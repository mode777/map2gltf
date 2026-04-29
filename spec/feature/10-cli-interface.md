# Feature 10 — CLI Interface

[← Back to main spec](../spec.md)

---

## Overview

Provide a Node.js command-line interface that wraps the library from [Feature 9](09-npm-package.md), reads a `.map` file from disk, invokes the compiler, and writes a `.glb` file to disk. The CLI is a thin shell around the library rather than a separate compilation path.

**Input:** CLI arguments (`process.argv`), an input `.map` file path, and the npm package runtime from [Feature 9](09-npm-package.md)
**Output:** `.glb` file written to disk, optional diagnostics on stderr, and process exit status

**Primary code file:** `src/index.ts`

---

## Command Contract

The CLI is installed as the `map2gltf` binary via the package manifest's `bin` field and is intended for direct terminal usage.

### Help Output

```text
Usage: map2gltf <input.map> [options]

Options:
  -o, --output <file>        Output .glb path (default: <input>.glb)
  --default-texture-size <n> Default texture dimensions (default: 64)
  --grid-cell-size <n>       Clustering grid cell size (default: 16)
  --max-cluster-size <n>     Max triangles per cluster (default: 512)
  --min-cluster-size <n>     Min triangles per cluster (default: 8)
  --bvh-leaf-threshold <n>   BVH leaf cluster threshold (default: 4)
  --no-clustering            Skip worldspawn spatial clustering
  --texture-path <dir>       Base directory for texture lookup
  -v, --verbose              Print diagnostics to stderr
  -h, --help                 Show help
```

The help output is the source of truth for the supported CLI surface. Every documented flag must be recognized by the parser with the behaviour described below.

### Parsed Flags

The current implementation actively handles these options:

| Flag | Behaviour |
|------|-----------|
| `-o`, `--output <file>` | Sets the output path |
| `--default-texture-size <n>` | Sets `defaultTextureSize` |
| `--grid-cell-size <n>` | Sets `gridCellSize` |
| `--max-cluster-size <n>` | Sets `maxClusterSize` |
| `--min-cluster-size <n>` | Sets `minClusterSize` |
| `--bvh-leaf-threshold <n>` | Sets `bvhLeafThreshold` |
| `--no-clustering` | Sets `skipWorldspawnClustering: true` |
| `--texture-path <dir>` | Creates a `NodeTextureProvider` with the given directory and sets it as `textureProvider` on `CompileOptions` |
| `-v`, `--verbose` | Switches from `compile()` to `compileWithDiagnostics()` |
| `-h`, `--help` | Prints usage and exits `0` |

### Positional Input

The implementation accepts exactly one positional input file.

- If the CLI is invoked with **no arguments**, it prints usage text and exits with status `0`.
- If arguments are present but no non-flag input path is found after parsing, it prints `Error: No input file specified` and exits with status `1`.
- If more than one positional input is provided, it prints `Error: Multiple input files provided` and exits with status `1`.

Unrecognized dash-prefixed arguments are rejected with `Error: Unknown option <flag>` and exit status `1`.

### Output Path Resolution

If `-o` / `--output` is provided, that value is used as the output path. Otherwise the CLI resolves the input path to an absolute path and then applies `inputPath.replace(/\.map$/i, '.glb')`. If the resolved path does not end in `.map`, the output path is left unchanged by that replacement.

---

## Runtime Behaviour

### Happy Path

1. Parse `process.argv.slice(2)`.
2. If there are no arguments, or if `-h` / `--help` is present, print usage text and exit with status `0`.
3. Parse recognized flags and their required values, rejecting unsupported options and missing values.
4. Resolve the input path and read the `.map` source with `fs.readFileSync(..., 'utf-8')`.
5. Invoke either `compile()` or `compileWithDiagnostics()` from the library, depending on `--verbose`, forwarding the parsed `CompileOptions` overrides.
6. Write the resulting GLB bytes to disk with `fs.writeFileSync()`.
7. Print `Wrote <outputPath>` to stdout and exit with status `0`.

### Verbose Mode

When `-v` / `--verbose` is present, the CLI calls `compileWithDiagnostics()` and prints warnings and errors to stderr in the following format:

```text
[WARN] [<step>] <message> (<location>)
[ERR] [<step>] <message> (<location>)
```

The location suffix is included only when present in the diagnostic record.

### Clustering Flag

`--no-clustering` maps directly to `skipWorldspawnClustering: true` in `CompileOptions`. It only disables worldspawn spatial clustering and must not change entity separation behavior.

### Numeric Compile Options

The CLI forwards numeric overrides directly into the compiler options object:

- `--default-texture-size <n>` controls the fallback texture dimensions used by [Feature 4](04-triangulation.md) when a texture is unresolved in the `TextureMap`.
- `--texture-path <dir>` creates a `NodeTextureProvider` (from [Feature 12](12-texture-resolution.md)) that looks for textures as `<dir>/<name>.png`. When omitted, no provider is used and all textures receive the default size and magenta placeholder materials.
- `--grid-cell-size <n>`, `--max-cluster-size <n>`, and `--min-cluster-size <n>` flow through to [Feature 6](06-clustering.md).
- `--bvh-leaf-threshold <n>` controls the leaf cutoff used by [Feature 7](07-bvh-construction.md).

These overrides must be forwarded consistently to both `compile()` and `compileWithDiagnostics()`.

---

## Error Handling

The CLI reports operational failures as human-readable terminal errors and exits non-zero. Non-error control paths such as help output and zero-argument invocation exit with status `0`.

| Condition | Behaviour |
|-----------|-----------|
| No arguments provided | Print usage, exit `0` |
| Arguments provided but no parsed input file | Print `Error: No input file specified`, exit `1` |
| Multiple positional input files | Print `Error: Multiple input files provided`, exit `1` |
| Missing required option value | Print `Error: Missing value for <flag>`, exit `1` |
| Invalid numeric option value | Print `Error: Invalid value for <flag>: <value>`, exit `1` |
| File read/write failure | Print `Error: <message>`, exit `1` |
| Compiler exception | Print `Error: <message>`, exit `1` |
| Help requested | Print usage, exit `0` |
| Unknown dash-prefixed option | Print `Error: Unknown option <flag>`, exit `1` |

The CLI does not attempt recovery after a fatal error. Library diagnostics remain non-fatal and are printed only in verbose mode.

---

## Verification

### Unit Tests

1. **Help flag:** Invoke the CLI with `--help`. Assert usage text is printed and the process exits with status `0`.
2. **No arguments:** Invoke the CLI with no arguments. Assert usage text is printed and the process exits with status `0`.
3. **Missing input after flag parsing:** Invoke the CLI with flags but no positional input (for example `--no-clustering`). Assert the expected error message is printed and the process exits with status `1`.
4. **Output path override:** Invoke the CLI with `-o custom.glb`. Assert the output is written to the provided path.
5. **Verbose mode:** Mock `compileWithDiagnostics()` to return warnings and errors. Assert they are printed to stderr using the documented format.
6. **No-clustering flag:** Invoke the CLI with `--no-clustering`. Assert the library receives `skipWorldspawnClustering: true`.
7. **Numeric flag forwarding:** Invoke the CLI with numeric overrides such as `--grid-cell-size 32` and `--bvh-leaf-threshold 8`. Assert they are forwarded into `CompileOptions`.
8. **Unknown option handling:** Invoke the CLI with `--unknown-flag`. Assert the CLI exits with status `1` and prints an `Unknown option` message.
9. **Duplicate positional input:** Invoke the CLI with two input files. Assert the CLI exits with status `1`.
10. **Missing option value:** Invoke the CLI with `--output` or `--grid-cell-size` and no following value. Assert the CLI exits with status `1` and prints a clear error.

### Integration Test

Execute the built `map2gltf` binary against `tests/fixtures/hollow-room.map`. Assert a `.glb` file is written, the process exits with status `0`, and the output is structurally valid as defined by the Feature 8 export tests.

Run the CLI with `--bvh-leaf-threshold 8` on a fixture that normally produces a split BVH. Assert the emitted stats or derived structure reflect the larger threshold.

Run the CLI with `--default-texture-size 128` on a map with unresolved textures in verbose mode. Assert diagnostics report `128x128` fallback behaviour.
Run the CLI with `--texture-path ./textures` pointing to a directory containing matching PNGs. Assert the output GLB contains texture-referencing materials rather than magenta placeholders.
---

## Implementation

### Entry Point

The CLI file remains the process entrypoint script, but it now exports `parseCliArgs()` and `runCli()` so the parsing contract can be tested without spawning a subprocess. Filesystem I/O and terminal output remain within the CLI boundary.

Implementation reference: [src/index.ts](../../src/index.ts).

### Control Flow

The CLI bootstraps by parsing `process.argv`, delegating execution to `runCli()`, and exiting with its numeric status code when invoked as the process entrypoint.

Implementation reference: [src/index.ts](../../src/index.ts).

### Dependency Boundary

All compile logic remains in the library from [Feature 9](09-npm-package.md). The CLI owns only:

- process argument handling
- input/output path resolution
- file I/O
- terminal output formatting
- process exit codes

This keeps the command-line interface thin and ensures browser and programmatic consumers continue to share the same compiler implementation.