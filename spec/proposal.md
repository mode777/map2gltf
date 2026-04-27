# Change Proposal: CLIP Texture Filtering & Optional Clustering

---

## 1. CLIP Texture — Suppress Geometry Generation

### Motivation

Quake `.map` files use the texture name `CLIP` (case-insensitive; lowercased to `clip` at parse time) on brush faces that define invisible collision volumes. These brushes should participate in CSG (they still occlude hidden faces on neighbouring brushes) but must **not** produce any visible triangles in the output `.glb`.

### Change Summary

Filter out all `ConvexPolygon` instances whose `face.textureName === 'clip'` **after** Step 3 (World CSG) and **before** Step 4 (Triangulation). This ensures:

- CLIP brushes still participate in CSG — their volumes subtract hidden faces from adjacent visible brushes.
- No triangles, vertices, materials, clusters, or BVH leaves are generated for CLIP-textured faces.

### Affected Files

| File | Change |
|------|--------|
| `src/compiler.ts` | After `worldCSG()` and entity polygon collection, filter `allPolygons` to remove entries where `face.textureName === 'clip'`. Apply the same filter in `compileDetailed()`. |
| `spec/steps/04-triangulation.md` | Add a precondition note: _"Polygons with `textureName === 'clip'` are excluded before this step."_ |
| `spec/spec.md` | Add `CLIP` to a new "Special Texture Names" section documenting reserved texture names. |

### Implementation Detail

In `compiler.ts`, after computing `allPolygons`:

```typescript
// Remove CLIP-textured polygons — they define collision volumes, not visible geometry
const visiblePolygons = allPolygons.filter(p => p.face.textureName !== 'clip');
```

Pass `visiblePolygons` (instead of `allPolygons`) to `triangulate()`.

### New Unit Test — `tests/unit/04-triangulation.test.ts`

**CLIP faces produce no geometry:**

Create a set of `ConvexPolygon[]` containing both regular-textured polygons and polygons with `textureName === 'clip'`. Run the filtering logic (or triangulate only visible polygons). Assert:

1. No triangle in the output has material `'clip'`.
2. The total triangle count matches only the non-CLIP polygons.
3. CLIP polygons are excluded regardless of casing at source (parser lowercases, so the filter checks `'clip'`).

Suggested test location: add to the existing triangulation test file, or add a dedicated test in `tests/unit/04-triangulation.test.ts`.

### Integration Test Update — `tests/integration/compiler.test.ts`

Create a fixture `tests/fixtures/clip-brush.map` containing:

- One visible box brush (e.g. texture `brick`).
- One CLIP box brush overlapping or adjacent to the visible brush.

Assert:

1. The compiled `.glb` contains geometry only for the `brick` material.
2. No `clip` material appears in the glTF output.
3. The CLIP brush still affects CSG — if it overlaps the visible brush, the shared face of the visible brush should be removed.

---

## 2. Optional Spatial Clustering (Skip Clustering + BVH)

### Motivation

Spatial clustering and BVH construction add complexity and are unnecessary for small maps or use cases that don't require frustum culling (e.g. full-scene rendering, static thumbnails). Making clustering optional simplifies the output: one cluster per material, a flat glTF node hierarchy, and no BVH overhead.

### Change Summary

Add a `skipClustering?: boolean` option. When `true`:

- **Step 6 (Clustering):** Instead of spatial grid clustering, each `MaterialBatch` produces exactly **one `Cluster`** containing all its triangles. No grid assignment, no size-based splitting/merging. Forsyth index reordering is still applied.
- **Step 7 (BVH Construction):** Still called, but on the reduced cluster set. With only a few clusters (one per material), the BVH degenerates to a single leaf node (since cluster count ≤ `bvhLeafThreshold` in most cases).
- **Step 8 (GLB Export):** The single-leaf BVH produces a **single root node** with **one mesh** whose primitives correspond to the per-material clusters. This is the "flat hierarchy" — one glTF node, one mesh, N primitives.

The pipeline shape is preserved — the same functions are called in the same order. Only the clustering behaviour changes internally.

### Affected Files

| File | Change |
|------|--------|
| `src/types.ts` | Add `skipClustering?: boolean` to `CompileOptions` and `DEFAULT_OPTIONS`. |
| `src/pipeline/06-clustering.ts` | Add `skipClustering?: boolean` to `ClusterOptions`. When `true`, bypass grid assignment, splitting, and merging — create one cluster per batch directly. |
| `src/compiler.ts` | Pass `skipClustering` from `CompileOptions` through to `clusterGeometry()`. Update `resolveOptions()` and `compileDetailed()`. |
| `src/index.ts` | Add `--no-clustering` CLI flag mapping to `skipClustering: true`. |
| `spec/steps/06-clustering.md` | Document the `skipClustering` option and its behaviour. |
| `spec/steps/07-bvh-construction.md` | Note that with `skipClustering`, the BVH degenerates to a single leaf. |
| `spec/spec.md` | Add `skipClustering` to the Compile-Time Parameters table. |

### Implementation Detail

In `pipeline/06-clustering.ts`, at the top of `clusterGeometry()`:

```typescript
export function clusterGeometry(
    batches: MaterialBatch[],
    options?: Partial<ClusterOptions>,
    diagnostics?: Diagnostics,
): Cluster[] {
    // --- NEW: skip spatial clustering ---
    if (options?.skipClustering) {
        return batches.map(batch => {
            const triCount = batch.indices.length / 3;
            const allTriangles = Array.from({ length: triCount }, (_, i) => i);
            return buildCluster(allTriangles, batch);
        });
    }

    // ... existing spatial clustering logic unchanged ...
}
```

In `src/types.ts`:

```typescript
export interface CompileOptions {
    // ... existing fields ...
    readonly skipClustering: boolean;
}

export const DEFAULT_OPTIONS: CompileOptions = {
    // ... existing defaults ...
    skipClustering: false,
};
```

In `compiler.ts`, pass through to clustering:

```typescript
const clusters = clusterGeometry(batches, {
    gridCellSize: opts.gridCellSize,
    maxClusterSize: opts.maxClusterSize,
    minClusterSize: opts.minClusterSize,
    skipClustering: opts.skipClustering,
}, diagnostics);
const bvh = buildBVH(clusters); // still called — degenerates to single leaf
```

### GLB Output With Skip-Clustering

With N materials, `buildBVH()` receives N clusters. If N ≤ `bvhLeafThreshold` (default 4), the BVH is a single leaf node. The exporter creates:

- **1 root glTF node** (leaf) with `extras.nodeType = 'leaf'`
- **1 mesh** with N primitives (one per material)

If N > `bvhLeafThreshold`, the BVH will still produce a shallow tree (one split level), but no spatial clustering. This is expected and correct.

### New / Updated Tests

#### Unit Tests — `tests/unit/06-clustering.test.ts`

1. **`skipClustering` produces one cluster per material:**
   Provide 3 `MaterialBatch` entries (different materials) with `skipClustering: true`. Assert exactly 3 clusters are returned, one per batch. Assert each cluster's `materialID` matches its source batch.

2. **`skipClustering` preserves all triangles:**
   Provide a batch with 100 triangles. With `skipClustering: true`, assert the single cluster contains all 100 triangles (indices.length / 3 === 100).

3. **`skipClustering` still applies Forsyth reordering:**
   With `skipClustering: true`, assert that the cluster's index buffer is a valid permutation of all triangles (same triangle set, possibly reordered).

4. **`skipClustering` ignores grid/splitting/merging options:**
   Provide spread-out geometry that would normally produce multiple clusters. With `skipClustering: true`, assert exactly one cluster per batch regardless of `gridCellSize`, `maxClusterSize`, or `minClusterSize`.

#### Unit Tests — `tests/unit/07-bvh-construction.test.ts`

5. **BVH with few clusters (skip-clustering scenario):**
   Build a BVH from 2 clusters (simulating 2-material skip-clustering). Assert the BVH has ≤ 3 nodes (either 1 leaf or 1 root + 2 leaves). This test may already pass — verify and add if missing.

#### Integration Tests — `tests/integration/compiler.test.ts`

6. **Full pipeline with `skipClustering: true`:**
   Compile `tests/fixtures/two-rooms.map` (multi-material) with `skipClustering: true`. Assert:
   - Cluster count equals the number of unique materials.
   - The BVH has a minimal node count (≤ material count + 1).
   - The `.glb` is valid and contains the expected number of mesh primitives.
   - Total triangle count matches the non-skip-clustering output.

7. **`skipClustering` does not affect geometry correctness:**
   Compile the same `.map` with and without `skipClustering`. Assert the total triangle count and vertex positions are identical (only cluster/BVH structure differs).

---

## Summary of New `CompileOptions` Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `skipClustering` | `boolean` | `false` | When `true`, spatial clustering (Step 6) is bypassed. One cluster per material is generated. The BVH (Step 7) degenerates to a single leaf or shallow tree. |

## Summary of New CLI Flags

| Flag | Maps to |
|------|---------|
| `--no-clustering` | `skipClustering: true` |

## 3. Web Application — Clustering Toggle

### Motivation

The web application should expose the `skipClustering` option so users can choose whether to enable spatial clustering before compiling. This is useful for quick previews, small maps, or workflows that don't need frustum-culling acceleration.

### Change Summary

Add a checkbox to the drop zone area (visible before compilation starts). Its checked state is read at compile time and forwarded to the worker as part of the `CompileOptions`.

### Affected Files

| File | Change |
|------|--------|
| `web/index.html` | Add a `<label><input type="checkbox" id="enable-clustering" checked /> Enable spatial clustering</label>` element inside the drop zone or between the drop zone and the status area. |
| `web/src/main.ts` | Read `#enable-clustering` checked state in `handleFile()`. Pass `{ skipClustering: !checked }` in the worker message. |
| `web/src/compiler-worker.ts` | Already accepts `options?: Partial<CompileOptions>` in the `WorkerRequest` — no change needed. The worker passes `options` through to `compileDetailed()`. |
| `web/src/ui.ts` | No change needed — the checkbox is independent of the state machine. |
| `spec/steps/10-web-application.md` | Document the clustering checkbox in the UI section. |

### Implementation Detail

#### `web/index.html`

Add below the drop zone, before the status element:

```html
<div class="options">
    <label>
        <input type="checkbox" id="enable-clustering" checked />
        Enable spatial clustering
    </label>
</div>
```

With minimal styling:

```css
.options { margin-top: 1rem; text-align: center; color: #999; font-size: 0.9rem; }
.options label { cursor: pointer; }
.options input[type="checkbox"] { margin-right: 0.4rem; accent-color: #4af; }
```

#### `web/src/main.ts`

Update `handleFile()` to read the checkbox state:

```typescript
const clusteringCheckbox = document.getElementById('enable-clustering') as HTMLInputElement;

async function handleFile(file: File): Promise<void> {
    currentFileName = file.name;
    showCompiling(file.name);
    highlighter.clear();
    bvhTree.clearSelection();
    const mapSource = await file.text();
    const skipClustering = !clusteringCheckbox.checked;
    worker.postMessage({ mapSource, options: { skipClustering } });
}
```

No changes to the worker — it already destructures `options` from the message and passes it to `compileDetailed()`.

### UI Behaviour

- The checkbox defaults to **checked** (clustering enabled), preserving current behaviour.
- The checkbox is always visible and can be toggled between compilations.
- While compiling (status visible, drop zone dimmed), the checkbox is **disabled** to prevent mid-compilation changes.
- When `skipClustering` is active, the BVH tree panel shows only a single root leaf node. The toggle button remains functional but the tree is trivial.

### New Test — `tests/web/clustering-toggle.test.ts`

**Checkbox state is forwarded to worker:**

1. Create the DOM elements (`#enable-clustering` checkbox, drop zone, etc.).
2. Mock the `Worker` to capture `postMessage` calls.
3. Simulate a file drop with the checkbox **checked**. Assert the worker message contains `options.skipClustering === false` (or `options` is undefined / does not set `skipClustering`).
4. Simulate a file drop with the checkbox **unchecked**. Assert the worker message contains `options.skipClustering === true`.

---

## Reserved Texture Names

| Texture | Behaviour |
|---------|-----------|
| `clip` | No geometry generated. Brush still participates in CSG. |
