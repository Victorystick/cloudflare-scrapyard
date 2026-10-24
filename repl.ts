/// <reference lib="dom" />
// Makes the examples on a page editable, and runs them in the browser with
// scrap-check.wasm, which prints what `scrap eval` and `scrap type` do.
// Without this script, the examples show what they print as they are.
import type { RunRequest, RunResponse } from './repl-worker.ts';
import type { CheckResult } from './scrap-check.ts';

// How long a scrap may run before the page stops it.
const timeout = 5000;

// A Runner runs scraps in a Web Worker, which it replaces when a scrap
// runs too long.
class Runner {
  #worker: Worker | null = null;
  #ready: Promise<void> = Promise.resolve();
  #next = 0;
  #pending = new Map<number, (result: CheckResult) => void>();

  async run(source: string): Promise<CheckResult> {
    const worker = (this.#worker ??= this.#start());
    try {
      await this.#ready;
    } catch (e) {
      this.#worker = null;
      return { error: String(e) };
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
      worker.postMessage({ id, source } satisfies RunRequest);
    });
  }

  #start(): Worker {
    const worker = new Worker(new URL('./repl-worker.ts', import.meta.url), {
      type: 'module',
    });
    this.#ready = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<RunResponse>) => {
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
    for (const resolve of this.#pending.values()) resolve({ error });
    this.#pending.clear();
  }
}

const runner = new Runner();

// enhance makes an example editable, with a button that runs it.
function enhance(example: HTMLElement) {
  const code = example.querySelector<HTMLElement>('pre:first-child > code')!;
  const out = example.querySelector<HTMLElement>('pre.out')!;
  const original = code.textContent!;

  try {
    code.contentEditable = 'plaintext-only';
  } catch {
    code.contentEditable = 'true';
  }
  code.spellcheck = false;
  code.setAttribute('aria-label', 'Scrap');

  const actions = document.createElement('div');
  actions.className = 'actions';
  const hint = document.createElement('span');
  hint.textContent = navigator.platform.startsWith('Mac') ? '⌘↵' : 'Ctrl+↵';
  const reset = button('Reset', () => {
    code.textContent = original;
    edited();
    run();
  });
  reset.hidden = true;
  const runButton = button('Run', () => run());
  actions.append(hint, reset, runButton);
  code.parentElement!.after(actions);

  const share = example.hasAttribute('data-share');
  if (share && location.hash.length > 1) {
    code.textContent = decodeURIComponent(location.hash.slice(1));
    edited();
    run();
  }

  code.addEventListener('input', edited);
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run();
    }
  });

  function edited() {
    reset.hidden = code.textContent === original;
    out.classList.add('stale');
  }

  async function run() {
    const source = code.textContent!;
    if (share) {
      history.replaceState(null, '', '#' + encodeURIComponent(source));
    }
    runButton.disabled = true;
    out.classList.add('stale');
    const result = await runner.run(source);
    runButton.disabled = false;
    // Show only the latest run.
    if (code.textContent === source) {
      show(out, result);
    }
  }
}

function button(label: string, onclick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

// show shows result in out, as the static examples do.
function show(out: HTMLElement, result: CheckResult) {
  const samps: HTMLElement[] = [];
  const samp = (kind: string, text: string) => {
    const s = document.createElement('samp');
    s.className = kind;
    s.textContent = text;
    samps.push(s);
  };
  if ('value' in result && result.value != null) samp('value', result.value);
  if ('error' in result && result.error != null) samp('error', result.error);
  if ('type' in result) samp('type', result.type);
  out.replaceChildren(...samps);
  out.classList.remove('stale');
}

for (const example of document.querySelectorAll<HTMLElement>(
  '.example:not([data-run])'
)) {
  enhance(example);
}
