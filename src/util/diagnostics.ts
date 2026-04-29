import type { Diagnostics, DiagnosticMessage } from '../types.js';
import { createDiagnostics } from '../types.js';

export { createDiagnostics };

export function addInfo(diag: Diagnostics, step: string, message: string, location?: string): void {
    const msg: DiagnosticMessage = location !== undefined
        ? { step, message, location }
        : { step, message };
    diag.info.push(msg);
}

export function addDebug(diag: Diagnostics, step: string, message: string, location?: string): void {
    const msg: DiagnosticMessage = location !== undefined
        ? { step, message, location }
        : { step, message };
    diag.debug.push(msg);
}

export function addWarning(diag: Diagnostics, step: string, message: string, location?: string): void {
    const msg: DiagnosticMessage = location !== undefined
        ? { step, message, location }
        : { step, message };
    diag.warnings.push(msg);
}

export function addError(diag: Diagnostics, step: string, message: string, location?: string): void {
    const msg: DiagnosticMessage = location !== undefined
        ? { step, message, location }
        : { step, message };
    diag.errors.push(msg);
}
