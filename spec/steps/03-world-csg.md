# Step 3 — World CSG: Inter-Brush Face Removal

[← Back to main spec](../spec.md)

---

## Overview

Remove hidden faces between touching or overlapping brushes by clipping each polygon against all other brushes and discarding occluded fragments.

**Input:** All `ConvexPolygon[]` from all brushes (from [Step 2](02-brush-to-polygons.md))
**Output:** Clipped `ConvexPolygon[]` with no hidden inter-brush faces

---

## Algorithm

The algorithm operates on every polygon produced in Step 2. Only **worldspawn** brushes participate in CSG (see [compiler orchestration](../spec.md)).

### Per-Polygon Subtraction

For each polygon *P* belonging to brush *B*, subtract the volume of every other brush *B′* from *P*. The result is zero or more polygon fragments representing the portions of *P* not occluded by any other brush.

### Subtraction of One Brush

To subtract brush *B′* (with planes {C₁, C₂, …, Cₖ}) from polygon fragment *F*:

1. Initialise `remaining = F`.
2. For each plane Cᵢ of B′ (with normal **cn** and distance *cd*):
   a. **Split** `remaining` against Cᵢ into a **front fragment** (outside the half-space) and a **back fragment** (inside the half-space), using the Sutherland-Hodgman clip from [Step 2](02-brush-to-polygons.md):
      - **Front fragment:** vertices where dot(v, cn) − cd ≥ −ε (the portion on the *outside* of this plane). This portion is **definitely not inside B′** and is emitted to the output immediately.
      - **Back fragment:** vertices where dot(v, cn) − cd ≤ +ε (the portion on the *inside* of this plane). This portion *might* be inside B′ and must be tested against the remaining planes.
   b. Set `remaining = back fragment`.
   c. If `remaining` is degenerate (< 3 vertices), stop — nothing left to subtract.
3. After testing all planes: if `remaining` is non-degenerate, it is **fully inside B′** and is **discarded**.

The key insight: at each clip plane, the *front* side is guaranteed to be outside B′ (it fails at least one half-space test), so it is safe to keep. Only the *back* side (inside all planes tested so far) needs further testing.

### Multi-Brush Subtraction

For polygon *P*, subtract each brush B′ in sequence. After subtracting B′, the surviving fragments replace *P* for the next brush test. Maintain a **fragment list** initialised with [P]:

```
fragments = [P]
for each brush B′ ≠ B:
    nextFragments = []
    for each fragment F in fragments:
        nextFragments.push(...subtractBrush(F, B′))
    fragments = nextFragments
return fragments
```

Where `subtractBrush(F, B′)` returns the surviving (outside) fragments of F after removing the volume of B′, as described above.

---

## Acceleration

Brute-force complexity is O(P × B × F) where *P* is total polygon count, *B* is brush count, and *F* is average face count per brush.

**Spatial hashing** is used to reduce the test set: build a uniform grid with a fixed cell size of **64 world units**. Each polygon is tested only against brushes whose AABBs overlap the same grid cells. This reduces effective complexity to near-linear in practice.

> **Implementation note:** The cell size is hardcoded to 64 units rather than derived from the largest brush extent as in the general algorithm. Brush faces within each brush group are also deduplicated by normal+distance (using string keys with fixed precision) to avoid redundant plane tests.

---

## Output

The output is the same `ConvexPolygon[]` type as the input. Each surviving polygon (or fragment) retains its `ParsedFace` reference and `brushIndex` for downstream UV computation and tracing.

```typescript
// Same type as Step 2 output — re-stated here for clarity
interface ConvexPolygon {
    vertices: Vec3[];       // CCW winding, length ≥ 3
    face: ParsedFace;       // originating face (for normal, texture axes, material)
    brushIndex: number;     // index of the source brush
}
```

---

## Verification

### Unit Tests

1. **Two touching boxes — shared face removal:** Create two axis-aligned boxes sharing a face (e.g. box A: (0,0,0)→(64,64,64), box B: (64,0,0)→(128,64,64)). Assert the shared face is fully removed from both brushes (each box emits 5 polygons, not 6).
2. **Non-overlapping brushes — no change:** Create two boxes with a gap between them. Assert all 12 polygons (6 per box) survive unchanged.
3. **Fully enclosed brush:** Place a small box completely inside a larger box. Assert the small box's polygons are entirely discarded and the large box's polygons survive.
4. **Partial overlap — fragment survival:** Create two overlapping boxes where one partially intersects the other. Assert that the exposed portions survive and the occluded portions are removed. Verify the total surviving polygon area equals the analytically known visible area.
5. **Polygon integrity:** For every surviving polygon, assert: (a) CCW winding, (b) ≥ 3 vertices, (c) all vertices lie on the originating face plane within ε.
6. **Face reference preservation:** Assert every surviving `ConvexPolygon.face` still references a valid `ParsedFace` with correct texture data.

### Integration Smoke Test

Run the CSG pass on `tests/fixtures/two-boxes.map` (two touching axis-aligned boxes sharing a face). Assert the shared face is fully removed from both brushes, each box emits 5 polygons instead of 6, and the total surviving polygon count is 10.

Run the CSG pass on `tests/fixtures/room-with-pillar.map` (6 brushes forming walls/floor/ceiling with a pillar brush in the center). Assert that: (a) no polygon exists that is entirely inside another brush, (b) the pillar's faces touching the floor/walls are removed, and (c) the total surviving polygon count is less than the pre-CSG count.

---

## Implementation

### Exported Function

```typescript
// pipeline/03-world-csg.ts
export function worldCSG(polygons: ConvexPolygon[]): ConvexPolygon[]
```

### Algorithm (pseudocode)

```typescript
function worldCSG(polygons: ConvexPolygon[]): ConvexPolygon[] {
    // Group polygons by their source brush
    const brushPolygons: Map<ParsedBrush, ConvexPolygon[]> = groupByBrush(polygons);
    const allBrushes = [...brushPolygons.keys()];

    // Build spatial hash for acceleration
    const grid = buildSpatialHash(allBrushes, gridCellSize);

    const result: ConvexPolygon[] = [];

    for (const [brush, polys] of brushPolygons) {
        // Find candidate brushes whose AABBs overlap this brush’s AABB
        const candidates = grid.query(computeBrushAABB(brush))
            .filter(b => b !== brush);

        for (const poly of polys) {
            let fragments = [poly];
            for (const otherBrush of candidates) {
                const nextFragments: ConvexPolygon[] = [];
                for (const frag of fragments) {
                    nextFragments.push(...subtractBrush(frag, otherBrush));
                }
                fragments = nextFragments;
                if (fragments.length === 0) break;
            }
            result.push(...fragments);
        }
    }

    return result;
}
```

### `subtractBrush` Detail

```typescript
function subtractBrush(fragment: ConvexPolygon, brush: ParsedBrush): ConvexPolygon[] {
    const survivors: ConvexPolygon[] = [];
    let remaining: ConvexPolygon | null = fragment;

    for (const face of brush.faces) {
        if (remaining === null) break;

        const { front, back } = splitPolygon(remaining, face.normal, face.distance);

        if (front !== null && front.vertices.length >= 3) {
            survivors.push(front);   // outside this plane → safe
        }

        remaining = (back !== null && back.vertices.length >= 3) ? back : null;
    }

    // remaining is fully inside the brush → discard it (do not push)
    return survivors;
}
```

### `splitPolygon`

Extends the Sutherland-Hodgman clipper from Step 2 to return **both** sides of the split:

- Walk each edge (A → B), classify vertices against the plane.
- Emit to `frontVerts` or `backVerts` depending on classification.
- At crossing edges, compute the intersection and emit to both lists.
- Apply plane-snap to intersection points (same as Step 2).
- Return `{ front: ConvexPolygon | null, back: ConvexPolygon | null }`.

**Coplanar face handling:** When all vertices lie on the clip plane (all classified as "on"), the polygon's face normal is compared against the clip plane normal via dot product. If the dot product is positive (same direction), the polygon is assigned to the **front** side; if negative (opposite direction), it is assigned to the **back** side. This ensures that coplanar touching faces between two brushes are correctly removed — the face belonging to the other brush falls into the "inside" region and is discarded.

### Spatial Hash

Use the `util/spatial-hash.ts` module. Cell size should match the largest brush extent (or use the configurable `gridCellSize` parameter). Each brush is inserted into all cells its AABB overlaps. For a polygon, query the cell(s) containing the polygon’s AABB to get the candidate brush set.

### Brush Identity Tracking

To group polygons by source brush and exclude self-testing, add a `brushIndex: number` field to `ConvexPolygon` (assigned in Step 2, preserved through CSG):

```typescript
interface ConvexPolygon {
    vertices: Vec3[];       // CCW winding, length ≥ 3
    face: ParsedFace;       // originating face (for normal, texture axes, material)
    brushIndex: number;     // index of the source brush (for CSG self-exclusion)
}
```
