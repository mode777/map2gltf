import * as THREE from 'three';

export interface BVHTreeNode {
    name: string;
    nodeType: 'interior' | 'leaf';
    aabb: { min: number[]; max: number[] };
    depth: number;
    clusterCount: number;
    triangleCount: number;
    children: BVHTreeNode[];
    threeObject: THREE.Object3D;
}

export function extractBVHTree(gltfScene: THREE.Group): BVHTreeNode | null {
    // Find the root BVH node (first child of scene with extras.nodeType)
    let rootObject: THREE.Object3D | null = null;
    gltfScene.traverse((obj) => {
        if (!rootObject && obj.userData && typeof obj.userData === 'object' && 'nodeType' in obj.userData) {
            rootObject = obj;
        }
    });
    if (!rootObject) return null;

    function buildNode(obj: THREE.Object3D, depth: number): BVHTreeNode {
        const userData = obj.userData as { nodeType?: string; aabb?: { min: number[]; max: number[] } };
        const nodeType = userData.nodeType === 'leaf' ? 'leaf' as const : 'interior' as const;
        const aabb = userData.aabb ?? { min: [0, 0, 0], max: [0, 0, 0] };

        const children: BVHTreeNode[] = [];
        for (const child of obj.children) {
            if (child.userData && typeof child.userData === 'object' && 'nodeType' in child.userData) {
                children.push(buildNode(child, depth + 1));
            }
        }

        let clusterCount = 0;
        let triangleCount = 0;
        if (nodeType === 'leaf' && obj instanceof THREE.Object3D) {
            const mesh = (obj as THREE.Object3D & { children: THREE.Object3D[] }).children.find(
                c => c instanceof THREE.Mesh,
            ) as THREE.Mesh | undefined;
            if (!mesh && (obj as THREE.Object3D & { type: string }).type === 'Mesh') {
                // obj itself could be mesh-bearing
            }
            // Count primitives from the mesh attached to this node
            obj.traverse((c) => {
                if (c instanceof THREE.Mesh) {
                    const geom = c.geometry;
                    if (geom) {
                        if (Array.isArray(c.material)) {
                            clusterCount += c.material.length;
                        } else {
                            clusterCount += geom.groups.length || 1;
                        }
                        const idx = geom.index;
                        triangleCount += idx ? idx.count / 3 : (geom.attributes['position']?.count ?? 0) / 3;
                    }
                }
            });
        }

        return {
            name: obj.name || `node_${depth}`,
            nodeType,
            aabb,
            depth,
            clusterCount,
            triangleCount: Math.floor(triangleCount),
            children,
            threeObject: obj,
        };
    }

    return buildNode(rootObject, 0);
}

export interface BVHTreeController {
    build(root: BVHTreeNode): void;
    onSelect(callback: (node: BVHTreeNode) => void): void;
    clearSelection(): void;
    destroy(): void;
}

export function initBVHTree(container: HTMLElement): BVHTreeController {
    let selectCallback: ((node: BVHTreeNode) => void) | null = null;
    let selectedEl: HTMLElement | null = null;
    let selectedNode: BVHTreeNode | null = null;
    let hoverCallback: ((node: BVHTreeNode | null) => void) | null = null;

    function renderNode(node: BVHTreeNode): HTMLElement {
        const row = document.createElement('div');
        row.className = 'bvh-node';
        row.dataset['depth'] = String(node.depth);
        row.style.paddingLeft = `${node.depth * 16}px`;

        const toggle = document.createElement('span');
        toggle.className = 'bvh-toggle';
        toggle.textContent = node.children.length > 0 ? '▾' : ' ';
        row.appendChild(toggle);

        const icon = document.createElement('span');
        icon.className = 'bvh-icon';
        icon.textContent = node.nodeType === 'leaf' ? '🟩' : '🔲';
        row.appendChild(icon);

        const label = document.createElement('span');
        label.className = 'bvh-label';
        let text = node.name;
        if (node.nodeType === 'leaf') {
            text += ` · ${node.clusterCount} cluster${node.clusterCount !== 1 ? 's' : ''}`;
            text += ` · ${node.triangleCount} tri`;
        }
        label.textContent = text;
        row.appendChild(label);

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'bvh-children';
        for (const child of node.children) {
            childrenContainer.appendChild(renderNode(child));
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'bvh-node-wrapper';
        wrapper.appendChild(row);
        wrapper.appendChild(childrenContainer);

        // Collapse/expand
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (node.children.length === 0) return;
            const collapsed = childrenContainer.hidden;
            childrenContainer.hidden = !collapsed;
            toggle.textContent = collapsed ? '▾' : '▸';
        });

        // Selection
        row.addEventListener('click', () => {
            if (selectedEl === row) {
                // Deselect
                row.classList.remove('bvh-selected');
                selectedEl = null;
                selectedNode = null;
                selectCallback?.(null as unknown as BVHTreeNode);
            } else {
                if (selectedEl) selectedEl.classList.remove('bvh-selected');
                row.classList.add('bvh-selected');
                selectedEl = row;
                selectedNode = node;
                selectCallback?.(node);
            }
        });

        // Hover for AABB wireframe
        row.addEventListener('mouseenter', () => hoverCallback?.(node));
        row.addEventListener('mouseleave', () => hoverCallback?.(null));

        return wrapper;
    }

    return {
        build(root: BVHTreeNode): void {
            container.innerHTML = '';
            container.appendChild(renderNode(root));
        },
        onSelect(callback: (node: BVHTreeNode) => void): void {
            selectCallback = callback;
        },
        onHover(callback: (node: BVHTreeNode | null) => void): void {
            hoverCallback = callback;
        },
        clearSelection(): void {
            if (selectedEl) {
                selectedEl.classList.remove('bvh-selected');
                selectedEl = null;
                selectedNode = null;
            }
        },
        destroy(): void {
            container.innerHTML = '';
            selectCallback = null;
            hoverCallback = null;
        },
    } as BVHTreeController & { onHover(cb: (node: BVHTreeNode | null) => void): void };
}
