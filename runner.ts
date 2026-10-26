/// <reference lib="dom" />
// Runs scraps in the browser, off the page's thread, for repl.ts and
// web-play.ts, and highlights them and shows what they print.
import type { ScrapRequest } from './repl-worker.ts';
import { printTests, type WasmResult } from './scrap-wasm.ts';
import type { RunRequest, RunResponse } from './wasm-worker.ts';

// How long a scrap may run before the page stops it.
const timeout = 5000;

// A Runner runs requests in a Web Worker that wasm-worker.ts serves them
// in, which it replaces when a request runs too long. The new worker has
// none of the old one's state. A Result may be an error, { error: "…" },
// as when the worker fails.
export class Runner<Request, Result extends { error?: string } | object> {
  #start: () => Worker;
  #worker: Worker | null = null;
  #ready: Promise<void> = Promise.resolve();
  #next = 0;
  #pending = new Map<number, (result: Result) => void>();
  // Called when a request runs too long, and the worker with it is stopped.
  stopped?: () => void;

  constructor(start: () => Worker) {
    this.#start = start;
  }

  async run(request: Request): Promise<Result> {
    const worker = (this.#worker ??= this.#begin());
    try {
      await this.#ready;
    } catch (e) {
      this.#worker = null;
      return { error: String(e) } as Result;
    }
    const id = this.#next++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#stop(`Stopped after ${timeout / 1000} seconds.`);
      }, timeout);
      this.#pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      worker.postMessage({ id, request } satisfies RunRequest<Request>);
    });
  }

  #begin(): Worker {
    const worker = this.#start();
    this.#ready = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<RunResponse<Result>>) => {
        if ('id' in data) {
          this.#pending.get(data.id)?.(data.result);
          this.#pending.delete(data.id);
        } else if (data.ready) {
          resolve();
        } else {
          reject(new Error('Starting scrap failed: ' + data.error));
        }
      };
      worker.onerror = (e) => {
        reject(new Error('Starting scrap failed: ' + e.message));
      };
    });
    return worker;
  }

  // stop stops the worker, failing every scrap it was running.
  #stop(error: string) {
    this.#worker?.terminate();
    this.#worker = null;
    for (const resolve of this.#pending.values()) resolve({ error } as Result);
    this.#pending.clear();
    this.stopped?.();
  }
}

// scrapRunner returns a Runner of scraps, with scrap-wasm.wasm.
export function scrapRunner(): Runner<ScrapRequest, WasmResult> {
  return new Runner(
    () =>
      new Worker(new URL('./repl-worker.ts', import.meta.url), {
        type: 'module',
      })
  );
}

// editable makes code editable as a scrap, which it highlights anew as it is
// edited, and calls edited on each edit and run on runKeys. It returns what
// highlights code as it is, as after replacing its text.
export function editable(
  runner: Runner<ScrapRequest, WasmResult>,
  code: HTMLElement,
  edited: () => void,
  run: () => void
): () => Promise<void> {
  try {
    code.contentEditable = 'plaintext-only';
  } catch {
    code.contentEditable = 'true';
  }
  code.spellcheck = false;
  code.setAttribute('aria-label', 'Scrap');

  let timer: ReturnType<typeof setTimeout> | undefined;
  code.addEventListener('input', () => {
    edited();
    clearTimeout(timer);
    timer = setTimeout(rehighlight, 150);
  });
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run();
    }
  });

  // rehighlight highlights the code as it is, if it hasn't changed by the
  // time the worker answers. Until then, the last highlights move with the
  // edits.
  async function rehighlight() {
    const source = code.textContent!;
    const result = await runner.run({ source, command: 'highlight' });
    if ('highlights' in result && code.textContent === source) {
      highlight(code, result.highlights);
    }
  }
  return rehighlight;
}

// The keys that run a scrap that is being edited.
export const runKeys = navigator.platform.startsWith('Mac') ? '⌘↵' : 'Ctrl+↵';

// highlight replaces the highlights of code with spans: start and end
// offsets into its text, by the tree-sitter capture name that style.css
// colors with ::highlight(). It needs the CSS Custom Highlight API.
export function highlight(code: HTMLElement, spans: Record<string, number[]>) {
  if (!('highlights' in CSS)) return;
  // Ranges whose text was replaced have moved to code itself.
  for (const ranges of CSS.highlights.values()) {
    for (const range of ranges) {
      if (code.contains(range.startContainer)) ranges.delete(range);
    }
  }
  // Editing may split the text into several nodes.
  const texts: Text[] = [];
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  const at = (offset: number): [Text, number] => {
    for (const text of texts) {
      if (offset <= text.length) return [text, offset];
      offset -= text.length;
    }
    throw new RangeError('offset past the code');
  };
  for (const [name, offsets] of Object.entries(spans)) {
    let ranges = CSS.highlights.get(name);
    if (!ranges) CSS.highlights.set(name, (ranges = new Highlight()));
    for (let i = 0; i < offsets.length; i += 2) {
      const range = new Range();
      range.setStart(...at(offsets[i]));
      range.setEnd(...at(offsets[i + 1]));
      ranges.add(range);
    }
  }
}

export function button(label: string, onclick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

// show shows result in out, as the static examples do.
export function show(out: HTMLElement, result: WasmResult) {
  const samps: HTMLElement[] = [];
  const samp = (kind: string, text: string) => {
    const s = document.createElement('samp');
    s.className = kind;
    s.textContent = text;
    samps.push(s);
  };
  if ('results' in result && result.results != null) {
    // As `scrap test` prints them, without the type.
    samp('output', printTests(result.results));
  } else {
    if ('value' in result && result.value != null) samp('value', result.value);
    if ('error' in result && result.error != null) samp('error', result.error);
    if ('type' in result) samp('type', result.type);
  }
  out.replaceChildren(...samps);
  out.classList.remove('stale');
}
