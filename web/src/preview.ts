import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface PreviewController {
    loadGLB(glb: Uint8Array): Promise<THREE.Group>;
    getScene(): THREE.Scene;
    dispose(): void;
}

export function initPreview(canvas: HTMLCanvasElement): PreviewController {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(0x1a1a1a);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 10000);
    camera.position.set(0, 50, 100);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    scene.add(directionalLight);

    let animationId = 0;
    let currentModel: THREE.Group | null = null;

    function resize(): void {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
    }

    function animate(): void {
        animationId = requestAnimationFrame(animate);
        controls.update();
        resize();
        renderer.render(scene, camera);
    }
    animate();

    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);

    const loader = new GLTFLoader();

    return {
        loadGLB(glb: Uint8Array): Promise<THREE.Group> {
            if (currentModel) {
                scene.remove(currentModel);
                currentModel.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                        child.geometry.dispose();
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }

            return new Promise((resolve, reject) => {
                const blob = new Blob([glb], { type: 'model/gltf-binary' });
                const url = URL.createObjectURL(blob);
                loader.load(url, (gltf) => {
                    URL.revokeObjectURL(url);
                    currentModel = gltf.scene;
                    scene.add(currentModel);

                    // Auto-fit camera
                    const box = new THREE.Box3().setFromObject(currentModel);
                    const center = box.getCenter(new THREE.Vector3());
                    const sphere = box.getBoundingSphere(new THREE.Sphere());
                    const dist = sphere.radius * 1.5;

                    camera.position.copy(center).add(new THREE.Vector3(dist * 0.5, dist * 0.5, dist));
                    camera.lookAt(center);
                    controls.target.copy(center);
                    controls.update();
                    resolve(currentModel);
                }, undefined, reject);
            });
        },

        getScene(): THREE.Scene {
            return scene;
        },

        dispose(): void {
            cancelAnimationFrame(animationId);
            observer.disconnect();
            controls.dispose();
            renderer.dispose();
        },
    };
}
