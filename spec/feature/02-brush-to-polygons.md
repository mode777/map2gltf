# Feature 2 — Brush → Convex Face Polygons

[← Back to main spec](../spec.md)

---

## Overview

Convert each brush (defined as an intersection of half-planes) into a set of convex face polygons by clipping a seed polygon against all sibling planes.

**Input:** `ParsedBrush` (from [Feature 1](01-map-parsing.md))
**Output:** `ConvexPolygon[]` per brush

**Primary code file:** `src/pipeline/02-brush-to-polygons.ts`

---

## Algorithm

> **Implementation note:** The `EPSILON` (1e-5) and `SEED_EXTENT` (65536) values are hardcoded constants in the implementation rather than read from `CompileOptions`.

For each brush, for each face plane, produce one convex polygon:

### 1. Seed Polygon Construction

For a face plane with normal **n** and distance *d*, construct a large axis-aligned quad lying on that plane. Choose the dominant axis of **n** to determine the initial quad orientation:

- If |n.z| is maximal: seed axes are world X and Y.
- If |n.x| is maximal: seed axes are world Y and Z.
- If |n.y| is maximal: seed axes are world X and Z.

The quad extent is **65536 world units** (large enough to encompass any map geometry).

### 2. Sutherland-Hodgman Clipping

Clip the seed polygon against every *other* plane in the same brush, one plane at a time. For each clipping plane with normal **cn** and distance *cd*:

- Classify each vertex **v** of the current polygon:
  - *Inside:* dot(v, cn) − cd ≤ +ε
  - *Outside:* dot(v, cn) − cd > +ε
- Walk each edge (A → B):
  - Both inside → emit B.
  - A inside, B outside → compute intersection, emit intersection.
  - A outside, B inside → compute intersection, emit intersection, then emit B.
  - Both outside → emit nothing.
- **Intersection formula:** t = (cd − dot(A, cn)) / dot(B − A, cn); point = A + t × (B − A).
- **Plane snap:** After interpolation, snap the result onto the clip plane: point = point − (dot(point, cn) − cd) × cn. This eliminates floating-point drift and prevents T-junction cracks.

### 3. Degeneracy Rejection

Discard any resulting polygon with fewer than 3 vertices or with area below ε² (where ε = 1e-5). Area is computed as 0.5 × ‖Σ(vᵢ × vᵢ₊₁)‖ over the polygon's fan triangulation.

### 4. Winding Order Enforcement

All emitted polygons use counter-clockwise winding when viewed from the front face (the direction of the plane normal). If the clipping process produces reversed winding, reverse the vertex array.

---

## Numerical Robustness

Plane classification uses a thick-plane test with tolerance ε = 1e-5:

- **Front:** dot(v, n) − d > +ε
- **Back:** dot(v, n) − d < −ε
- **On-plane:** otherwise

---

## Complexity

For a brush with *F* faces: O(F²) per brush (each of F seed polygons clipped against F−1 planes). Acceptable for offline processing.

---

## Output Data Structure

Each emitted polygon retains a reference to its originating `ParsedFace`, which carries the texture name and Valve 220 texture axes needed for UV computation in [Feature 4](04-triangulation.md).

```typescript
interface ConvexPolygon {
    vertices: Vec3[];       // CCW winding, length ≥ 3
    face: ParsedFace;       // originating face (for normal, texture axes, material)
    brushIndex: number;     // index of the source brush (for CSG self-exclusion in Feature 3)
    entityIndex: number;    // 0 = worldspawn, 1+ = non-worldspawn entity index
}
```

---

## Verification

### Unit Tests

1. **Axis-aligned box:** Process a 6-face axis-aligned box brush (e.g. (0,0,0)→(64,64,64)). Assert exactly 6 polygons are emitted, each with 4 vertices forming a rectangle, and that all vertex positions lie on the brush boundary.
2. **Winding order:** For each emitted polygon, verify CCW winding: compute `cross(v1−v0, v2−v0)` and assert it points in the same direction as `face.normal` (dot product > 0).
3. **Vertex on-plane:** For every vertex of every emitted polygon, assert `|dot(v, face.normal) − face.distance| < ε`.
4. **Wedge/prism brush:** Process a 5-face triangular prism brush. Assert 5 polygons are emitted — two triangles and three quads — with correct vertex counts.
5. **Degenerate face removal:** Construct a brush where one face is entirely clipped away by the other faces (e.g. an unreachable plane). Assert the degenerate face produces no polygon.
6. **Seed polygon extent:** Use a brush near the edge of map space (e.g. origin at 32000 units). Assert the seed polygon is large enough that all vertices lie within the 65536-unit extent and clipping produces a valid polygon.
7. **Face reference integrity:** Assert that every emitted `ConvexPolygon.face` references the correct `ParsedFace` (same `textureName`, same plane normal).

### Integration Smoke Test

Process the box brush from `tests/fixtures/box.map`. Assert 6 quads are emitted. Compute the total surface area of all polygons and compare against the known analytic value (6 × side²).

Process the wedge brush from `tests/fixtures/wedge.map`. Assert 5 polygons are emitted — two triangles and three quads. Verify that the triangular face polygons have exactly 3 vertices and the quad face polygons have exactly 4 vertices. Compute the total surface area and compare against the analytic value for the triangular prism.

---

## Implementation

### Exported Function

```typescript
// pipeline/02-brush-to-polygons.ts
export function brushToPolygons(brush: ParsedBrush, brushIndex: number, entityIndex?: number): ConvexPolygon[]
```

The `brushIndex` is assigned by the caller and stored on every emitted `ConvexPolygon` for use by Feature 3 (CSG self-exclusion). The `entityIndex` defaults to 0 (worldspawn) and is propagated to every output polygon for use by Feature 6 (clustering).

### Algorithm (per brush)

```
result = []
for each face F in brush.faces:
    poly = buildSeedPolygon(F.normal, F.distance, SEED_EXTENT)
    for each other face G in brush.faces where G ≠ F:
        poly = clipPolygonToPlane(poly, G.normal, G.distance)
        if poly has < 3 vertices:
            break   // face fully clipped away
    if poly is valid (≥ 3 vertices, area > ε²):
        enforce CCW winding relative to F.normal
        result.push({ vertices: poly, face: F })
return result
```

### Seed Polygon Construction Detail

1. Pick two tangent vectors **t1**, **t2** perpendicular to the face normal **n**:
   - If |n.z| ≥ |n.x| and |n.z| ≥ |n.y|: **t1** = normalize(cross(n, (0,1,0))), **t2** = cross(n, t1)
   - If |n.x| is maximal: **t1** = normalize(cross(n, (0,0,1))), **t2** = cross(n, t1)
   - If |n.y| is maximal: **t1** = normalize(cross(n, (1,0,0))), **t2** = cross(n, t1)
2. Compute the plane origin: **o** = n × distance.
3. Emit 4 vertices: o ± t1 × extent ± t2 × extent (extent = 65536).

### Plane Snap After Intersection

After computing an edge-plane intersection point, snap it back onto the clip plane:

```
point = point − (dot(point, cn) − cd) × cn
```

This ensures vertices lie exactly on plane boundaries and prevents T-junction cracks between adjacent faces.

### Winding Check

Compute `dot(cross(v1−v0, v2−v0), face.normal)`. If negative, reverse the vertex array.
