// Browser shims for the wallet packages (they expect Node's Buffer and process).
import { Buffer } from 'buffer';
const process = globalThis.process ?? { env: {}, browser: true, version: '', versions: {}, nextTick: (f, ...a) => queueMicrotask(() => f(...a)) };
globalThis.Buffer ??= Buffer; globalThis.process ??= process;
export { Buffer, process };
