import type { Diagnostics, DiagnosticMessage } from '../types.js';
import { createDiagnostics } from '../types.js';

export { createDiagnostics };

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
