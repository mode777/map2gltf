import * as THREE from 'three';
import type { BVHTreeNode } from './bvh-tree.js';

const CLUSTER_COLORS = [
    0xff4444, 0x44ff44, 0x4488ff, 0xffaa00,
    0xff44ff, 0x44ffff, 0xff8844, 0x88ff44,
    0x4444ff, 0xffff44, 0xff4488, 0x44ffaa,
];

export interface ClusterHighlighter {
    highlight(nodes: THREE.Object3D[]): void;
    clear(): void;
    showAABB(aabb: { min: number[]; max: number[] }): void;
    hideAABB(): void;
    dispose(): void;
}

export function initClusterHighlighter(scene: THREE.Scene): ClusterHighlighter {
    const originalMaterials = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const highlightedMeshes: THREE.Mesh[] = [];
    let wireframe: THREE.LineSegments | null = null;

    function collectMeshes(obj: THREE.Object3D): THREE.Mesh[] {
        const meshes: THREE.Mesh[] = [];
        obj.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                meshes.push(child);
            }
        });
        return meshes;
    }

    function collectLeafObjects(node: THREE.Object3D): THREE.Object3D[] {
        // Collect all objects that are leaf BVH nodes or have meshes
        const result: THREE.Object3D[] = [];
        result.push(node);
        return result;
    }

    return {
        highlight(nodes: THREE.Object3D[]): void {
            this.clear();
            let colorIdx = 0;
            for (const node of nodes) {
                const meshes = collectMeshes(node);
                for (const mesh of meshes) {
                    if (!originalMaterials.has(mesh)) {
                        originalMaterials.set(mesh, mesh.material);
                    }
                    const color = CLUSTER_COLORS[colorIdx % CLUSTER_COLORS.length]!;
                    mesh.material = new THREE.MeshBasicMaterial({
                        color,
                        opacity: 0.85,
                        transparent: true,
                    });
                    highlightedMeshes.push(mesh);
                    colorIdx++;
                }
            }
        },

        clear(): void {
            for (const mesh of highlightedMeshes) {
                const original = originalMaterials.get(mesh);
                if (original) {
                    mesh.material = original;
                }
            }
            highlightedMeshes.length = 0;
        },

        showAABB(aabb: { min: number[]; max: number[] }): void {
            this.hideAABB();
            const min = aabb.min;
            const max = aabb.max;
            const size = new THREE.Vector3(
                max[0]! - min[0]!,
                max[1]! - min[1]!,
                max[2]! - min[2]!,
            );
            const center = new THREE.Vector3(
                (min[0]! + max[0]!) / 2,
                (min[1]! + max[1]!) / 2,
                (min[2]! + max[2]!) / 2,
            );
            const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
            const edges = new THREE.EdgesGeometry(geometry);
            wireframe = new THREE.LineSegments(
                edges,
                new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 }),
            );
            wireframe.position.copy(center);
            scene.add(wireframe);
        },

        hideAABB(): void {
            if (wireframe) {
                scene.remove(wireframe);
                wireframe.geometry.dispose();
                (wireframe.material as THREE.Material).dispose();
                wireframe = null;
            }
        },

        dispose(): void {
            this.clear();
            this.hideAABB();
        },
    };
}

export function collectLeafDescendants(node: BVHTreeNode): THREE.Object3D[] {
    const result: THREE.Object3D[] = [];
    function walk(n: BVHTreeNode): void {
        if (n.nodeType === 'leaf') {
            result.push(n.threeObject);
        } else {
            for (const child of n.children) {
                walk(child);
            }
        }
    }
    walk(node);
    return result;
}
