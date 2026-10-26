/// <reference lib="webworker" />
// Runs scraps with scrap-wasm.wasm for repl.ts and web-play.ts.
import type { WasmRequest } from './scrap-wasm.ts';
import { serve } from './wasm-worker.ts';

// What the page asks the worker to run: a request but for the sources of
// the scraps that it refers to, which the worker fetches.
export type ScrapRequest = Omit<WasmRequest, 'sources'>;

serve(new URL('./scrap-wasm.wasm', import.meta.url));
