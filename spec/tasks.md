# Implementation Tasks

Checklist for building the Brush/CSG Map Compiler (`map2gltf`).

**All 143 tasks complete.**

---

## Task Summary

| Phase | Description | Tasks | Status |
|-------|-------------|-------|--------|
| 0 | Project Scaffolding | 7 | ✅ |
| 1 | Math Utilities | 6 | ✅ |
| 2 | Map Parsing | 6 | ✅ |
| 3 | Brush → Polygons | 6 | ✅ |
| 4 | World CSG | 6 | ✅ |
| 5 | Triangulation & UVs | 4 | ✅ |
| 6 | Material Merge | 3 | ✅ |
| 7 | Clustering | 7 | ✅ |
| 8 | BVH Construction | 6 | ✅ |
| 9 | glTF/GLB Export | 7 | ✅ |
| 10 | Orchestrator & Diagnostics | 5 | ✅ |
| 11 | CLI & npm Package | 5 | ✅ |
| 12 | Web Application | 12 | ✅ |
| 13 | Polish & CI | 9 | ✅ |
| 14 | Web Visualization & Inspection | 12 | ✅ |
| 15 | Entity-Aware Brush-Intact Clustering | 24 | ✅ |
| 16 | CLIP Texture Filtering | 5 | ✅ |
| 17 | Optional Clustering | 8 | ✅ |
| 18 | Web Clustering Toggle | 5 | ✅ |
| **Total** | | **143** | |

---

## Phase 16 — CLIP Texture Filtering

> Reference: [proposal.md §1](proposal.md#1-clip-texture--suppress-geometry-generation)

- [x] **16.1** Add CLIP polygon filter in `src/compiler.ts` — filter `allPolygons` to exclude `face.textureName === 'clip'` after CSG, before triangulation (both `compileWithDiagnostics` and `compileDetailed`)
- [x] **16.2** Add "Special Texture Names" section to `spec/spec.md` documenting `clip` as a reserved name
- [x] **16.3** Add precondition note to `spec/steps/04-triangulation.md` stating CLIP polygons are excluded upstream
- [x] **16.4** Create fixture `tests/fixtures/clip-brush.map` — one visible box brush + one CLIP box brush (adjacent/overlapping)
- [x] **16.5** Add unit test in `tests/unit/04-triangulation.test.ts`: CLIP polygons produce no triangles, non-CLIP polygons unaffected; integration test in `tests/integration/compiler.test.ts`: compile clip-brush fixture, assert no `clip` material in output, verify CSG still removes shared face

---

## Phase 17 — Optional Clustering

> Reference: [proposal.md §2](proposal.md#2-optional-spatial-clustering-skip-clustering--bvh)

- [x] **17.1** Add `skipClustering: boolean` to `CompileOptions` in `src/types.ts` (default `false`), update `DEFAULT_OPTIONS`
- [x] **17.2** Add `skipClustering?: boolean` to `ClusterOptions` in `src/pipeline/06-clustering.ts`; implement early-return path that creates one cluster per batch (Forsyth reorder still applied)
- [x] **17.3** Pass `skipClustering` through `resolveOptions()` in `src/compiler.ts`; forward to `clusterGeometry()` in both `compileWithDiagnostics` and `compileDetailed`
- [x] **17.4** Add `--no-clustering` CLI flag in `src/index.ts`, mapping to `skipClustering: true`
- [x] **17.5** Add unit tests in `tests/unit/06-clustering.test.ts`: (a) one cluster per material, (b) all triangles preserved, (c) Forsyth still applied, (d) grid/split/merge options ignored
- [x] **17.6** Add unit test in `tests/unit/07-bvh-construction.test.ts`: BVH from ≤4 clusters produces single leaf or minimal tree
- [x] **17.7** Add integration tests in `tests/integration/compiler.test.ts`: full pipeline with `skipClustering: true` — cluster count = material count, minimal BVH, valid GLB; same triangle count as non-skip run
- [x] **17.8** Update spec docs: add `skipClustering` to parameters table in `spec/spec.md`, document behaviour in `spec/steps/06-clustering.md` and `spec/steps/07-bvh-construction.md`

---

## Phase 18 — Web Clustering Toggle

> Reference: [proposal.md §3](proposal.md#3-web-application--clustering-toggle)

- [x] **18.1** Add `#enable-clustering` checkbox + `.options` styling to `web/index.html` between drop zone and status area
- [x] **18.2** Read checkbox state in `handleFile()` in `web/src/main.ts`; pass `{ skipClustering: !checked }` in worker `postMessage`
- [x] **18.3** Disable checkbox during compilation (in `showCompiling`), re-enable on result/error (in `showResult`/`showError` in `web/src/ui.ts`)
- [x] **18.4** Add test `tests/web/clustering-toggle.test.ts`: checked → `skipClustering` false, unchecked → `skipClustering` true in worker message
- [x] **18.5** Document clustering checkbox in `spec/steps/10-web-application.md`
