/// <reference lib="webworker" />
// Runs apps with scrap-web.wasm for web-play.ts. The module keeps the app
// that it loaded between requests, until the page stops the worker.
import { serve } from './wasm-worker.ts';

serve(new URL('./scrap-web.wasm', import.meta.url));
