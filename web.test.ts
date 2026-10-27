import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Op, ScrapWeb, type Patch, type WebEvent, type WebResponse } from './scrap-web.ts';

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

// A node of a frame: an element, or text, without a tag.
interface Node {
  id: number;
  tag?: string;
  text?: string;
  attrs: Record<string, string>;
  events: string[];
  children: Node[];
  parent?: Node;
}

// A Frame applies patches as the page's frame does, to nodes of its own.
class Frame {
  body: Node = { id: 0, tag: 'body', attrs: {}, events: [], children: [] };
  nodes = new Map<number, Node>([[0, this.body]]);

  apply(patch: Patch) {
    let i = 0;
    const num = () => patch[i++] as number;
    const str = () => patch[i++] as string;
    const get = (id: number) => {
      const node = this.nodes.get(id);
      if (!node) throw new Error(`no node ${id}`);
      return node;
    };
    const place = (parent: Node, after: number, node: Node) => {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = parent;
      parent.children.splice(after ? parent.children.indexOf(get(after)) + 1 : 0, 0, node);
    };
    const build = (): Node => {
      const node: Node = { id: num(), attrs: {}, events: [], children: [] };
      this.nodes.set(node.id, node);
      if (patch[i] === null) {
        i++;
        node.text = str();
        return node;
      }
      node.tag = str();
      for (let n = num(); n > 0; n--) node.attrs[str()] = str();
      for (let n = num(); n > 0; n--) node.events.push(str());
      for (let n = num(); n > 0; n--) place(node, node.children.at(-1)?.id ?? 0, build());
      return node;
    };
    const forget = (node: Node) => {
      this.nodes.delete(node.id);
      node.children.forEach(forget);
    };
    while (i < patch.length) {
      switch (num()) {
        case Op.clear:
          this.body.children = [];
          this.nodes = new Map([[0, this.body]]);
          break;
        case Op.insert: {
          const parent = get(num());
          const after = num();
          place(parent, after, build());
          break;
        }
        case Op.move: {
          const parent = get(num());
          const after = num();
          place(parent, after, get(num()));
          break;
        }
        case Op.remove: {
          const node = get(num());
          node.parent!.children.splice(node.parent!.children.indexOf(node), 1);
          forget(node);
          break;
        }
        case Op.text:
          get(num()).text = str();
          break;
        case Op.set:
          get(num()).attrs[str()] = str();
          break;
        case Op.unset:
          delete get(num()).attrs[str()];
          break;
        case Op.on:
          get(num()).events.push(str());
          break;
        case Op.off: {
          const node = get(num());
          const event = str();
          node.events = node.events.filter((e) => e !== event);
          break;
        }
        default:
          throw new Error(`bad patch ${JSON.stringify(patch)}`);
      }
    }
  }

  // find returns the first element that matches.
  find(matches: (node: Node) => boolean, node = this.body): Node | undefined {
    if (node.tag && matches(node)) return node;
    for (const child of node.children) {
      const found = this.find(matches, child);
      if (found) return found;
    }
  }
}

function text(node: Node): string {
  return node.text ?? node.children.map(text).join('');
}

describe('web playground', () => {
  const page = readFileSync('./web.html', 'utf8');
  const start = drafts(page);

  // npm test builds scrap-web.wasm before running the tests.
  const module = new WebAssembly.Module(readFileSync('./scrap-web.wasm'));

  // A page loads the app in a new host, and sends it events, as the page
  // does, and keeps the messages.
  class Page {
    host = new ScrapWeb(module);
    frame = new Frame();
    generation = 0;
    messages: string[] = [];
    loaded: WebResponse;

    constructor(drafts: Record<string, string>, base?: string, messages: string[] = []) {
      const res = (this.loaded = this.run({
        op: 'load',
        source: '$"./main.scrap"',
        drafts,
        state: base,
        messages,
      }));
      expect(res.patch).toBeDefined();
      this.messages = messages.slice(0, res.replayed ?? 0);
    }

    run(req: Parameters<ScrapWeb['run']>[0]): WebResponse {
      const res = this.host.run(req);
      if (res.patch) {
        this.frame.apply(res.patch);
        this.generation = res.generation!;
      }
      for (const step of res.steps ?? []) this.messages.push(step.message);
      return res;
    }

    // send sends the event of the element.
    send(node: Node, event: string, input?: string) {
      expect(node.events).toContain(event);
      const e: WebEvent = { generation: this.generation, node: node.id, event };
      if (input != null) e.input = input;
      const res = this.run({ op: 'send', events: [e] });
      expect(res.error).toBeUndefined();
      return res;
    }

    find(matches: (node: Node) => boolean): Node {
      return this.frame.find(matches)!;
    }
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
    const page = new Page(start);
    expect(page.host.run({ op: 'state' })).toEqual({ state: start['state.scrap'] });
  });

  test('runs the app as the page does', () => {
    const page = new Page(start, start['state.scrap']);
    expect(text(page.find((e) => e.tag === 'h1'))).toBe('Todos');

    // Cross off the first todo, which sets the class of its item and the
    // count of those left, and patches nothing else.
    let res = page.send(page.find((e) => e.tag === 'span'), 'click');
    expect(res.steps).toEqual([{ step: 1, message: '#toggle 1' }]);
    const li = page.find((e) => e.tag === 'li');
    expect(li.attrs).toEqual({ class: 'done' });
    const left = page.find((e) => e.attrs.class === 'left').children[0];
    expect(res.patch).toEqual([Op.set, li.id, 'class', 'done', Op.text, left.id, '1 left']);

    // Type a todo, and add it.
    res = page.send(page.find((e) => e.tag === 'input'), 'input', 'Buy "milk"');
    expect(res.steps).toEqual([{ step: 2, message: '#edit "Buy \\"milk\\""' }]);
    page.send(page.find((e) => e.tag === 'form'), 'submit');
    expect(text(page.find((e) => e.tag === 'ul'))).toBe(
      'Write a scrap×Click me to cross me off×Buy "milk"×'
    );
    expect(text(page.find((e) => e.attrs.class === 'left'))).toBe('2 left');
    const { state } = page.host.run({ op: 'state' });
    expect(state).toBe(
      '{ draft = "", next = 4, todos = [ ' +
        '{ done = #true, id = 1, text = "Write a scrap" }, ' +
        '{ done = #false, id = 2, text = "Click me to cross me off" }, ' +
        '{ done = #false, id = 3, text = "Buy \\"milk\\"" } ] }'
    );

    // A new version of the app replays the messages, from the state that
    // they started from, rather than starting from the model they led to.
    const changed = start['main.scrap']
      .replace('"Todos"', '"Things"')
      .replace('{ ..t, done = not t.done }', '{ ..t, text = "Done!" }');
    const again = new Page({ ...start, 'main.scrap': changed }, start['state.scrap'], page.messages);
    expect(again.loaded.error).toBeUndefined();
    expect(again.messages).toEqual(page.messages);
    expect(text(again.find((e) => e.tag === 'h1'))).toBe('Things');
    expect(text(again.find((e) => e.tag === 'ul'))).toBe(
      'Done!×Click me to cross me off×Buy "milk"×'
    );
  });

  test('replays as many messages as fit the app', () => {
    const changed = start['main.scrap'].replaceAll('#toggle', '#flip');
    const page = new Page({ ...start, 'main.scrap': changed }, undefined, [
      '#edit "a"',
      '#toggle 1',
      '#add',
    ]);
    expect(page.messages).toEqual(['#edit "a"']);
    expect(page.loaded.error).toMatch(/^message 2 is not a message of the app/);
    expect(text(page.find((e) => e.tag === 'input'))).toBe('');
    expect(page.find((e) => e.tag === 'input').attrs.value).toBe('a');
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
