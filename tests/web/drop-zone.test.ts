/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initDropZone } from '../../web/src/drop-zone.js';

describe('drop-zone', () => {
    let element: HTMLDivElement;
    let fileInput: HTMLInputElement;
    let onFile: ReturnType<typeof vi.fn>;
    let onError: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        element = document.createElement('div');
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.map';
        element.appendChild(fileInput);
        document.body.appendChild(element);

        onFile = vi.fn();
        onError = vi.fn();

        initDropZone({ element, onFile, onError });
    });

    it('should add active class on dragenter', () => {
        const event = new Event('dragenter', { bubbles: true });
        Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
        element.dispatchEvent(event);
        expect(element.classList.contains('drop-zone--active')).toBe(true);
    });

    it('should add active class on dragover', () => {
        const event = new Event('dragover', { bubbles: true });
        Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
        element.dispatchEvent(event);
        expect(element.classList.contains('drop-zone--active')).toBe(true);
    });

    it('should remove active class on dragleave', () => {
        element.classList.add('drop-zone--active');
        element.dispatchEvent(new Event('dragleave'));
        expect(element.classList.contains('drop-zone--active')).toBe(false);
    });

    it('should call onFile for .map files on drop', () => {
        const file = new File(['content'], 'test.map', { type: 'text/plain' });
        const event = new Event('drop', { bubbles: true }) as Event & { dataTransfer: DataTransfer };
        Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
        Object.defineProperty(event, 'dataTransfer', {
            value: { files: [file] },
        });
        element.dispatchEvent(event);
        expect(onFile).toHaveBeenCalledWith(file);
        expect(onError).not.toHaveBeenCalled();
    });

    it('should call onError for non-.map files on drop', () => {
        const file = new File(['content'], 'test.txt', { type: 'text/plain' });
        const event = new Event('drop', { bubbles: true }) as Event & { dataTransfer: DataTransfer };
        Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
        Object.defineProperty(event, 'dataTransfer', {
            value: { files: [file] },
        });
        element.dispatchEvent(event);
        expect(onError).toHaveBeenCalledWith('Only .map files are supported');
        expect(onFile).not.toHaveBeenCalled();
    });

    it('should handle file input change for .map files', () => {
        const file = new File(['content'], 'level.map', { type: 'text/plain' });
        Object.defineProperty(fileInput, 'files', {
            value: [file],
            configurable: true,
        });
        fileInput.dispatchEvent(new Event('change'));
        expect(onFile).toHaveBeenCalledWith(file);
    });

    it('should reject non-.map files from file input', () => {
        const file = new File(['content'], 'level.bsp', { type: 'text/plain' });
        Object.defineProperty(fileInput, 'files', {
            value: [file],
            configurable: true,
        });
        fileInput.dispatchEvent(new Event('change'));
        expect(onError).toHaveBeenCalledWith('Only .map files are supported');
        expect(onFile).not.toHaveBeenCalled();
    });

    it('should trigger file input click on Enter key', () => {
        const clickSpy = vi.spyOn(fileInput, 'click');
        const event = new KeyboardEvent('keydown', { key: 'Enter' });
        Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
        element.dispatchEvent(event);
        expect(clickSpy).toHaveBeenCalled();
    });
});
