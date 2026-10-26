import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ScrapWeb,
  type View,
  type ViewElement,
  type WebEvent,
  type WebResponse,
} from './scrap-web.ts';

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

  // npm test builds scrap-web.wasm before running the tests.
  const module = new WebAssembly.Module(readFileSync('./scrap-web.wasm'));

  // load loads the app in a new host, as the page does.
  function load(drafts: Record<string, string>) {
    const host = new ScrapWeb(module);
    const res = host.run({
      op: 'load',
      source: '$"./main.scrap"',
      drafts,
      state: drafts['state.scrap'] ? '$"./state.scrap"' : undefined,
    });
    expect(res.error).toBeUndefined();
    return { host, res };
  }

  // send sends the event of the handler of the view.
  function send(
    host: ScrapWeb,
    res: WebResponse,
    el: ViewElement,
    event: string,
    input?: string
  ) {
    const e: WebEvent = { generation: res.generation!, handler: el.on![event].handler };
    if (input != null) e.input = input;
    const next = host.run({ op: 'send', events: [e] });
    expect(next.error).toBeUndefined();
    return next;
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
    const { host } = load({ ...start, 'state.scrap': '' });
    expect(host.run({ op: 'state' })).toEqual({ state: start['state.scrap'] });
  });

  test('runs the app as the page does', () => {
    let { host, res } = load(start);
    expect(find(res.view!, (e) => e.tag === 'h1')).toEqual({
      tag: 'h1',
      children: ['Todos'],
    });

    // Cross off the first todo.
    res = send(host, res, find(res.view!, (e) => e.tag === 'span')!, 'click');
    expect(res.steps).toEqual([{ step: 1, message: '#toggle 1' }]);
    expect(find(res.view!, (e) => e.tag === 'li')!.attrs).toEqual({
      class: 'done',
    });

    // Type a todo, and add it.
    const input = find(res.view!, (e) => e.tag === 'input')!;
    expect(input.on!.input.value).toBe(true);
    res = send(host, res, input, 'input', 'Buy "milk"');
    expect(res.steps).toEqual([{ step: 2, message: '#edit "Buy \\"milk\\""' }]);
    res = send(host, res, find(res.view!, (e) => e.tag === 'form')!, 'submit');
    expect(text(find(res.view!, (e) => e.tag === 'ul')!)).toBe(
      'Write a scrap×Click me to cross me off×Buy "milk"×'
    );
    expect(text(find(res.view!, (e) => e.attrs?.class === 'left')!)).toBe(
      '2 left'
    );
    const { state } = host.run({ op: 'state' });
    expect(state).toBe(
      '{ draft = "", next = 4, todos = [ ' +
        '{ done = #true, id = 1, text = "Write a scrap" }, ' +
        '{ done = #false, id = 2, text = "Click me to cross me off" }, ' +
        '{ done = #false, id = 3, text = "Buy \\"milk\\"" } ] }'
    );

    // A new version of the app starts from the state.
    const changed = start['main.scrap'].replace('"Todos"', '"Things"');
    ({ host, res } = load({ ...start, 'main.scrap': changed, 'state.scrap': state! }));
    expect(text(find(res.view!, (e) => e.tag === 'h1')!)).toBe('Things');
    expect(text(find(res.view!, (e) => e.attrs?.class === 'left')!)).toBe(
      '2 left'
    );
  });

  test('shows the interface that apps are checked against', () => {
    const dir = spawnSync(
      'go',
      ['list', '-m', '-f', '{{.Dir}}', 'github.com/Victorystick/scrapscript'],
      { encoding: 'utf8' }
    ).stdout.trim();
    const iface = readFileSync(join(dir, 'cmd/example/scrap-web/app.scrap'), 'utf8');
    const shown = page.match(/<details>[\s\S]*<pre><code>([\s\S]*?)<\/code><\/pre>/)!;
    expect(unescape(shown[1])).toBe(iface.trimEnd());
  });
});
