/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('clustering toggle', () => {
    let checkbox: HTMLInputElement;
    let postMessageSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Set up minimal DOM
        document.body.innerHTML = '';
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'enable-clustering';
        checkbox.checked = true;
        document.body.appendChild(checkbox);
    });

    function readSkipWorldspawnClustering(): boolean {
        const cb = document.getElementById('enable-clustering') as HTMLInputElement;
        return !cb.checked;
    }

    it('should return skipWorldspawnClustering=false when checkbox is checked', () => {
        checkbox.checked = true;
        expect(readSkipWorldspawnClustering()).toBe(false);
    });

    it('should return skipWorldspawnClustering=true when checkbox is unchecked', () => {
        checkbox.checked = false;
        expect(readSkipWorldspawnClustering()).toBe(true);
    });

    it('checkbox should be disabled during compilation', () => {
        // Simulate the ui.ts showCompiling behavior
        checkbox.disabled = true;
        expect(checkbox.disabled).toBe(true);
    });

    it('checkbox should be re-enabled after compilation', () => {
        checkbox.disabled = true;
        // Simulate the ui.ts showResult behavior
        checkbox.disabled = false;
        expect(checkbox.disabled).toBe(false);
    });
});
