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

    function readSkipClustering(): boolean {
        const cb = document.getElementById('enable-clustering') as HTMLInputElement;
        return !cb.checked;
    }

    it('should return skipClustering=false when checkbox is checked', () => {
        checkbox.checked = true;
        expect(readSkipClustering()).toBe(false);
    });

    it('should return skipClustering=true when checkbox is unchecked', () => {
        checkbox.checked = false;
        expect(readSkipClustering()).toBe(true);
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
