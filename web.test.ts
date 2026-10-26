import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ScrapWasm,
  type View,
  type ViewElement,
  type WasmRequest,
} from './scrap-wasm.ts';

// drafts returns the drafts that a page starts with, by name: a .draft div
// holds one in a <pre><code>.
function drafts(html: string): Record<string, string> {
  const draft =
    /<div class="example draft" data-draft="([^"]+)">\s*<pre><code>([\s\S]*?)<\/code><\/pre>/g;
  return Object.fromEntries(
    [...html.matchAll(draft)].map(([, name, code]) => [name, unescape(code)])
  );
}

function unescape(html: string): string {
  return html
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}

// find returns the first element of view that matches.
function find(
  view: View,
  matches: (e: ViewElement) => boolean
): ViewElement | undefined {
  if (typeof view === 'string') return undefined;
  if (matches(view)) return view;
  for (const child of view.children ?? []) {
    const found = find(child, matches);
    if (found) return found;
  }
}

function text(view: View): string {
  if (typeof view === 'string') return view;
  return (view.children ?? []).map(text).join('');
}

describe('web playground', () => {
  const page = readFileSync('./web.html', 'utf8');
  const start = drafts(page);

  // npm test builds scrap-wasm.wasm before running the tests.
  const wasm = new ScrapWasm(
    new WebAssembly.Module(readFileSync('./scrap-wasm.wasm'))
  );

  // web runs the app with drafts as the page does, which keeps the state
  // in state.scrap.
  function web(
    drafts: Record<string, string>,
    event: Pick<WasmRequest, 'message' | 'input'> = {}
  ) {
    const result = wasm.run({
      command: 'web',
      source: '$"./main.scrap"',
      drafts,
      sources: {},
      state: drafts['state.scrap'] ? '$"./state.scrap"' : undefined,
      ...event,
    });
    if (!('view' in result)) throw new Error(JSON.stringify(result));
    return { result, drafts: { ...drafts, 'state.scrap': result.state } };
  }

  test('has the app and its state', () => {
    expect(Object.keys(start)).toEqual([
      'main.scrap',
      'state.scrap',
      'html.scrap',
      'style.scrap',
    ]);
  });

  test('starts in the state that init leads to', () => {
    const { result } = web({ ...start, 'state.scrap': '' });
    expect(result.state).toBe(start['state.scrap']);
  });

  test('runs the app as the page does', () => {
    let { result, drafts } = web(start);
    expect(find(result.view, (e) => e.tag === 'h1')).toEqual({
      tag: 'h1',
      children: ['Todos'],
    });

    // Cross off the first todo.
    const item = find(result.view, (e) => e.tag === 'span')!;
    expect(item.on!.click).toEqual({ message: '#toggle 1' });
    ({ result, drafts } = web(drafts, item.on!.click));
    expect(result.message).toBe('#toggle 1');
    expect(find(result.view, (e) => e.tag === 'li')!.attrs).toEqual({
      class: 'done',
    });

    // Type a todo, and add it.
    const input = find(result.view, (e) => e.tag === 'input')!;
    expect(input.on!.input.value).toBe(true);
    ({ result, drafts } = web(drafts, {
      message: input.on!.input.message,
      input: 'Buy "milk"',
    }));
    expect(result.message).toBe('#edit "Buy \\"milk\\""');
    const form = find(result.view, (e) => e.tag === 'form')!;
    ({ result, drafts } = web(drafts, form.on!.submit));
    expect(result.state).toBe(
      '{ draft = "", next = 4, todos = [ ' +
        '{ done = #true, id = 1, text = "Write a scrap" }, ' +
        '{ done = #false, id = 2, text = "Click me to cross me off" }, ' +
        '{ done = #false, id = 3, text = "Buy \\"milk\\"" } ] }'
    );
    expect(text(find(result.view, (e) => e.tag === 'ul')!)).toBe(
      'Write a scrap×Click me to cross me off×Buy "milk"×'
    );
    expect(text(find(result.view, (e) => e.attrs?.class === 'left')!)).toBe(
      '2 left'
    );
  });

  test('shows the interface that apps are checked against', () => {
    const dir = spawnSync(
      'go',
      ['list', '-m', '-f', '{{.Dir}}', 'github.com/Victorystick/scrapscript'],
      { encoding: 'utf8' }
    ).stdout.trim();
    const iface = readFileSync(join(dir, 'cmd/scrap-wasm/web.scrap'), 'utf8');
    const shown = page.match(/<details>[\s\S]*<pre><code>([\s\S]*?)<\/code><\/pre>/)!;
    expect(unescape(shown[1])).toBe(iface.trimEnd());
  });
});
