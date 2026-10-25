// The type checker, as the Worker runs it.
import wasmModule from './scrap-wasm.wasm';
import { ScrapWasm, type WasmResult } from './scrap-wasm.ts';

// Each isolate starts one checker and reuses it.
const scrap = new ScrapWasm(wasmModule);

// check checks source, given the sources of the scraps it refers to by hash.
export function check(
  source: string,
  sources: Record<string, string>
): WasmResult {
  return scrap.run({ source, sources });
}
