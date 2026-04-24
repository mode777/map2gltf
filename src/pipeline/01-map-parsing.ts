import type { ParsedEntity, ParsedBrush, ParsedFace, Vec3, Diagnostics } from '../types.js';
import * as vec3 from '../math/vec3.js';

function tokenize(source: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    const len = source.length;

    while (i < len) {
        const ch = source[i]!;

        // Skip whitespace
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
            i++;
            continue;
        }

        // Skip comments
        if (ch === '/' && i + 1 < len && source[i + 1] === '/') {
            while (i < len && source[i] !== '\n') i++;
            continue;
        }

        // Braces
        if (ch === '{' || ch === '}') {
            tokens.push(ch);
            i++;
            continue;
        }

        // Brackets
        if (ch === '(' || ch === ')' || ch === '[' || ch === ']') {
            tokens.push(ch);
            i++;
            continue;
        }

        // Quoted string
        if (ch === '"') {
            let str = '';
            i++; // skip opening quote
            while (i < len && source[i] !== '"') {
                str += source[i];
                i++;
            }
            i++; // skip closing quote
            tokens.push('"' + str + '"');
            continue;
        }

        // Unquoted word / number
        let word = '';
        while (i < len) {
            const c = source[i]!;
            if (c === ' ' || c === '\t' || c === '\r' || c === '\n' ||
                c === '{' || c === '}' || c === '(' || c === ')' ||
                c === '[' || c === ']' || c === '"') {
                break;
            }
            word += c;
            i++;
        }
        if (word.length > 0) {
            tokens.push(word);
        }
    }

    return tokens;
}

function parsePlaneNormal(p1: Vec3, p2: Vec3, p3: Vec3): { normal: Vec3; distance: number } {
    const v1 = vec3.sub(p3, p1);
    const v2 = vec3.sub(p2, p1);
    const normal = vec3.normalize(vec3.cross(v1, v2));
    const distance = vec3.dot(normal, p1);
    return { normal, distance };
}

export function parseMap(source: string, diagnostics?: Diagnostics): ParsedEntity[] {
    const tokens = tokenize(source);
    const entities: ParsedEntity[] = [];
    let pos = 0;

    function peek(): string | undefined {
        return tokens[pos];
    }

    function next(): string {
        const t = tokens[pos];
        if (t === undefined) throw new Error('Unexpected end of input');
        pos++;
        return t;
    }

    function expect(token: string): void {
        const t = next();
        if (t !== token) throw new Error(`Expected '${token}', got '${t}'`);
    }

    function parseVec3FromParens(): Vec3 {
        expect('(');
        const x = parseFloat(next());
        const y = parseFloat(next());
        const z = parseFloat(next());
        expect(')');
        return { x, y, z };
    }

    function parseFaceLine(): ParsedFace {
        const p1 = parseVec3FromParens();
        const p2 = parseVec3FromParens();
        const p3 = parseVec3FromParens();

        const textureName = next().toLowerCase();

        let texAxisU: Vec3;
        let texOffsetU: number;
        let texAxisV: Vec3;
        let texOffsetV: number;
        let texScaleU: number;
        let texScaleV: number;

        if (peek() === '[') {
            // Valve 220 format: [ Ux Uy Uz Uoffset ] [ Vx Vy Vz Voffset ] rotation Uscale Vscale
            expect('[');
            const ux = parseFloat(next());
            const uy = parseFloat(next());
            const uz = parseFloat(next());
            texOffsetU = parseFloat(next());
            expect(']');
            texAxisU = { x: ux, y: uy, z: uz };

            expect('[');
            const vx = parseFloat(next());
            const vy = parseFloat(next());
            const vz = parseFloat(next());
            texOffsetV = parseFloat(next());
            expect(']');
            texAxisV = { x: vx, y: vy, z: vz };

            next(); // rotation (discarded)
            texScaleU = parseFloat(next());
            texScaleV = parseFloat(next());
        } else {
            // Standard format: texture offsetX offsetY rotation scaleX scaleY
            // Derive texture axes from the face normal
            texOffsetU = parseFloat(next());
            texOffsetV = parseFloat(next());
            next(); // rotation (discarded for now - proper rotation handling would be more complex)
            texScaleU = parseFloat(next());
            texScaleV = parseFloat(next());

            // Derive texture axes from plane normal (standard Quake convention)
            const { normal } = parsePlaneNormal(p1, p2, p3);
            const absX = Math.abs(normal.x);
            const absY = Math.abs(normal.y);
            const absZ = Math.abs(normal.z);

            if (absZ >= absX && absZ >= absY) {
                texAxisU = { x: 1, y: 0, z: 0 };
                texAxisV = { x: 0, y: -1, z: 0 };
            } else if (absX >= absY) {
                texAxisU = { x: 0, y: 1, z: 0 };
                texAxisV = { x: 0, y: 0, z: -1 };
            } else {
                texAxisU = { x: 1, y: 0, z: 0 };
                texAxisV = { x: 0, y: 0, z: -1 };
            }
        }

        // Clamp zero scales to 1
        if (texScaleU === 0) {
            texScaleU = 1;
            if (diagnostics) {
                diagnostics.warnings.push({
                    step: '01-map-parsing',
                    message: 'U scale of 0 clamped to 1',
                });
            }
        }
        if (texScaleV === 0) {
            texScaleV = 1;
            if (diagnostics) {
                diagnostics.warnings.push({
                    step: '01-map-parsing',
                    message: 'V scale of 0 clamped to 1',
                });
            }
        }

        const { normal, distance } = parsePlaneNormal(p1, p2, p3);

        return {
            planePoints: [p1, p2, p3],
            normal,
            distance,
            textureName,
            texAxisU,
            texOffsetU,
            texAxisV,
            texOffsetV,
            texScaleU,
            texScaleV,
        };
    }

    function parseBrush(entityIndex: number, brushIndex: number): ParsedBrush | null {
        expect('{');
        const faces: ParsedFace[] = [];
        while (peek() !== '}') {
            faces.push(parseFaceLine());
        }
        expect('}');

        if (faces.length < 4) {
            if (diagnostics) {
                diagnostics.warnings.push({
                    step: '01-map-parsing',
                    message: `Brush with ${faces.length} faces rejected (minimum 4)`,
                    location: `entity ${entityIndex}, brush ${brushIndex}`,
                });
            }
            return null;
        }

        return { faces };
    }

    function parseEntity(entityIndex: number): ParsedEntity {
        expect('{');
        const properties: Record<string, string> = {};
        const brushes: ParsedBrush[] = [];
        let brushIndex = 0;

        while (peek() !== '}') {
            if (peek() === '{') {
                const brush = parseBrush(entityIndex, brushIndex++);
                if (brush !== null) {
                    brushes.push(brush);
                }
            } else {
                // key-value pair
                const rawKey = next();
                const key = rawKey.startsWith('"') ? rawKey.slice(1, -1) : rawKey;
                const rawVal = next();
                const val = rawVal.startsWith('"') ? rawVal.slice(1, -1) : rawVal;
                properties[key] = val;
            }
        }
        expect('}');

        return { properties, brushes };
    }

    while (pos < tokens.length) {
        if (peek() === '{') {
            entities.push(parseEntity(entities.length));
        } else {
            pos++; // skip unexpected tokens
        }
    }

    // Validate entity 0 is worldspawn
    if (entities.length > 0 && entities[0]!.properties['classname'] !== 'worldspawn') {
        if (diagnostics) {
            diagnostics.errors.push({
                step: '01-map-parsing',
                message: 'Entity 0 is not worldspawn',
            });
        }
    }

    return entities;
}
