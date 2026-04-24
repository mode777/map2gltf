import type { AABB } from '../types.js';

export class SpatialHash<T> {
    private readonly cells = new Map<string, T[]>();
    private readonly cellSize: number;

    constructor(cellSize: number) {
        this.cellSize = cellSize;
    }

    private key(cx: number, cy: number, cz: number): string {
        return `${cx},${cy},${cz}`;
    }

    insert(item: T, bounds: AABB): void {
        const minCX = Math.floor(bounds.min.x / this.cellSize);
        const minCY = Math.floor(bounds.min.y / this.cellSize);
        const minCZ = Math.floor(bounds.min.z / this.cellSize);
        const maxCX = Math.floor(bounds.max.x / this.cellSize);
        const maxCY = Math.floor(bounds.max.y / this.cellSize);
        const maxCZ = Math.floor(bounds.max.z / this.cellSize);

        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                for (let cz = minCZ; cz <= maxCZ; cz++) {
                    const k = this.key(cx, cy, cz);
                    let list = this.cells.get(k);
                    if (!list) {
                        list = [];
                        this.cells.set(k, list);
                    }
                    list.push(item);
                }
            }
        }
    }

    query(bounds: AABB): Set<T> {
        const result = new Set<T>();
        const minCX = Math.floor(bounds.min.x / this.cellSize);
        const minCY = Math.floor(bounds.min.y / this.cellSize);
        const minCZ = Math.floor(bounds.min.z / this.cellSize);
        const maxCX = Math.floor(bounds.max.x / this.cellSize);
        const maxCY = Math.floor(bounds.max.y / this.cellSize);
        const maxCZ = Math.floor(bounds.max.z / this.cellSize);

        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                for (let cz = minCZ; cz <= maxCZ; cz++) {
                    const list = this.cells.get(this.key(cx, cy, cz));
                    if (list) {
                        for (const item of list) {
                            result.add(item);
                        }
                    }
                }
            }
        }

        return result;
    }
}
