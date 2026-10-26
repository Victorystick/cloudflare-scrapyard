/// <reference lib="dom" />
// The web playground: drafts of a little website, which scrap-web.wasm runs
// as an app of the web platform, in the Elm architecture, in a Web Worker
// (web-worker.ts). main.scrap is the app, which the page shows in a
// sandboxed frame, and sends the events of back to the host, which keeps the
// app and its model. Once the updates settle, the page asks the host for the
// model, as a scrap, and keeps it in state.scrap, which the host loads a
// changed app with. So editing any draft keeps the state, and the address
// bar keeps the drafts, the state among them.
import { button, editable, highlight, Runner, runKeys, scrapRunner, show } from './runner.ts';
import type { Handler, Step, View, WebEvent, WebRequest, WebResponse } from './scrap-web.ts';

// The draft that is the app, and the draft that holds its model.
const app = 'main.scrap';
const state = 'state.scrap';

// What drafts may be named: a draft refers to another as $"./name.scrap".
const draftName = /^[\w-]+\.scrap$/;

// How long after an edit the site reloads, and after an update the page
// asks for the model.
const delay = 400;
const settle = 300;

interface Draft {
  name: string;
  pane: HTMLElement;
  code: HTMLElement;
  rehighlight: () => Promise<void>;
}

// The runner of scraps highlights and evaluates drafts; the host runs the
// app.
const runner = scrapRunner();
const host = new Runner<WebRequest, WebResponse>(
  () => new Worker(new URL('./web-worker.ts', import.meta.url), { type: 'module' })
);
const drafts: Draft[] = [];
const list = document.querySelector<HTMLElement>('.drafts')!;
const site = document.querySelector<HTMLElement>('.site')!;
const frame = site.querySelector('iframe')!;
const out = site.querySelector<HTMLElement>('pre.out')!;
const log = site.querySelector<HTMLOListElement>('.history')!;

// draft adds a pane that edits the draft with the code, or makes one of
// pane, which has its code.
function draft(name: string, source: string | null, pane?: HTMLElement) {
  if (!pane) {
    pane = document.createElement('div');
    pane.className = 'example draft';
    pane.innerHTML = '<pre><code></code></pre>';
    newDraft.before(pane);
  }
  const code = pane.querySelector<HTMLElement>('pre > code')!;
  if (source == null) {
    // The page is built with its code's highlights.
    highlight(code, JSON.parse(code.dataset.highlights ?? '{}'));
  } else {
    code.textContent = source;
  }
  pane.classList.add('live');
  const d: Draft = {
    name,
    pane,
    code,
    rehighlight: editable(runner, code, () => edited(d), reload),
  };
  if (source != null) d.rehighlight();

  const head = document.createElement('div');
  head.className = 'draft-head';
  const label = document.createElement('input');
  label.value = name;
  label.spellcheck = false;
  label.setAttribute('aria-label', 'Name');
  label.readOnly = name === app || name === state;
  label.onchange = () => {
    const taken = drafts.some((o) => o !== d && o.name === label.value);
    if (!draftName.test(label.value) || taken) {
      label.value = d.name;
      return;
    }
    d.name = pane.dataset.draft = label.value;
    reload();
  };
  head.append(label);
  if (name === app || name === state) {
    const role = document.createElement('span');
    role.className = 'role';
    role.textContent = name === app ? 'the app' : 'its model, once updates settle';
    head.append(role);
  }
  const result = document.createElement('pre');
  result.className = 'out';
  head.append(
    button('Eval', async () => {
      result.classList.add('stale');
      show(result, await runner.run({ source: path(d.name), command: 'eval', drafts: sources() }));
    })
  );
  if (name !== app && name !== state) {
    head.append(
      button('Delete', () => {
        drafts.splice(drafts.indexOf(d), 1);
        pane.remove();
        reload();
      })
    );
  }
  pane.dataset.draft = name;
  pane.prepend(head);
  pane.append(result);
  drafts.push(d);
}

function path(name: string): string {
  return `$"./${name}"`;
}

function sources(): Record<string, string> {
  return Object.fromEntries(drafts.map((d) => [d.name, d.code.textContent!]));
}

function find(name: string): Draft | undefined {
  return drafts.find((d) => d.name === name);
}

const newDraft = button('New draft', () => {
  let name = 'draft.scrap';
  for (let i = 2; find(name); i++) name = `draft-${i}.scrap`;
  draft(name, `-- Other drafts refer to this one as ${path(name)}.\n()`);
  drafts.at(-1)!.code.focus();
  save();
});
newDraft.className = 'new-draft';
list.append(newDraft);

// The generation of the last view, whether the host has the app, whether
// state.scrap holds its model, and whether state.scrap was edited since the
// app was last loaded, which the next load starts from.
let generation = 0;
let loaded = false;
let synced = true;
let stateEdited = false;

// The page asks the host one thing at a time.
let queue = Promise.resolve();
function enqueue(task: () => Promise<void>) {
  queue = queue.then(task);
}

// The site reloads a while after the last edit, and keeps its state.
let timer: ReturnType<typeof setTimeout> | undefined;
function edited(d: Draft) {
  d.pane.querySelector('pre.out')!.classList.add('stale');
  out.classList.add('stale');
  if (d.name === state) stateEdited = true;
  clearTimeout(timer);
  timer = setTimeout(reload, delay);
}

function reload() {
  clearTimeout(timer);
  enqueue(() => load());
}

// load loads the app, with the model that the host has, unless state.scrap
// was edited, or its init if state.scrap is blank. If it fails, the host
// keeps the app it has. It clears the last error, unless asked not to.
async function load(clear = true) {
  if (!stateEdited && loaded) await sync();
  stateEdited = false;
  save();
  const blank = !find(state)?.code.textContent!.trim();
  const res = await host.run({
    op: 'load',
    source: path(app),
    drafts: sources(),
    state: blank ? undefined : path(state),
    generation: generation + 1,
  });
  if (!res.view) {
    show(out, { error: res.error ?? 'The host failed to load the app.' });
    return;
  }
  loaded = true;
  synced = !blank;
  log.replaceChildren();
  shown(res);
  if (clear) out.replaceChildren();
  if (blank) await sync();
}

// The events that the site sent, which the host takes together once it is
// free, and draws one view for, as Elm draws once per frame.
let events: WebEvent[] = [];
function send(event: WebEvent) {
  events.push(event);
  enqueue(flush);
}

async function flush() {
  if (events.length == 0) return;
  const batch = events;
  events = [];
  const res = await host.run({ op: 'send', events: batch });
  post({ reply: batch.length });
  if (res.unloaded) return lost();
  for (const step of res.steps ?? []) record(step);
  if (res.view) shown(res);
  if (res.error) show(out, { error: res.error });
  else if (res.view) out.replaceChildren();
  if (res.steps?.length) settled();
}

// lost loads the app again, from state.scrap, as the host lost it.
async function lost() {
  loaded = false;
  stateEdited = true;
  await load();
}
// A host that runs too long is stopped, and loses its app, which the page
// loads again, keeping the error.
host.stopped = () => {
  loaded = false;
  stateEdited = true;
  enqueue(() => load(false));
};

// shown shows a view that the host answered with.
function shown(res: WebResponse) {
  generation = res.generation!;
  post({ view: res.view, generation });
  out.classList.remove('stale');
}

// Once updates settle, the page asks for the model, to keep it.
let syncTimer: ReturnType<typeof setTimeout> | undefined;
function settled() {
  synced = false;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => enqueue(sync), settle);
}

// sync makes state.scrap hold the host's model, unless it was edited since.
async function sync() {
  clearTimeout(syncTimer);
  if (synced || stateEdited) return;
  const res = await host.run({ op: 'state' });
  if (res.unloaded) return lost();
  if (res.state == null) return;
  setState(res.state);
  synced = true;
  save();
}

// setState makes state.scrap hold the model, as a scrap.
function setState(source: string) {
  let d = find(state);
  if (!d) {
    draft(state, source);
    d = drafts.at(-1)!;
  }
  if (d.code.textContent !== source) {
    d.code.textContent = source;
    d.rehighlight();
  }
}

// record notes a step in the history, which clicking goes back to.
function record({ step, message }: Step) {
  const entry = document.createElement('li');
  entry.append(button(message, () => enqueue(() => goTo(step))));
  log.prepend(entry);
  while (log.childElementCount > 100) log.lastElementChild!.remove();
}

async function goTo(step: number) {
  const res = await host.run({ op: 'goto', step });
  if (res.unloaded) return lost();
  if (!res.view) {
    show(out, { error: res.error! });
    return;
  }
  shown(res);
  out.replaceChildren();
  settled();
}

// save keeps the drafts in the address bar, to share.
function save() {
  history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(sources())));
}

// shared returns the drafts in the address bar, if any.
function shared(): Record<string, string> | null {
  try {
    const found = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    const ok =
      typeof found[app] === 'string' &&
      Object.entries(found).every(([k, v]) => draftName.test(k) && typeof v === 'string');
    return ok ? found : null;
  } catch {
    return null;
  }
}

// The site runs in a frame of its own origin, which can't touch the page.
// The page posts it each view to show, with its generation, and the number
// of events it sent that the host has taken, and it posts each event back.
let last: { view?: View; generation: number } | null = null;
function post(data: { view?: View; generation?: number; reply?: number }) {
  if (data.view) last = { view: data.view, generation: data.generation! };
  frame.contentWindow?.postMessage(data, '*');
}
frame.addEventListener('load', () => {
  if (last) post(last);
});
frame.srcdoc = `<!doctype html><meta charset="utf-8"><script>(${render})()</script>`;
addEventListener('message', ({ source, data }) => {
  if (source !== frame.contentWindow) return;
  const { generation, handler, input } = data ?? {};
  if (typeof generation !== 'number' || typeof handler !== 'number') return;
  send(typeof input === 'string' ? { generation, handler, input } : { generation, handler });
});

// render runs in the frame, where it shows each view that the page posts it,
// changing as little of the last as it can, as Elm does, so that an input
// keeps its focus, and posts the page each event that a handler handles.
// It must refer to nothing outside itself.
function render() {
  interface Node extends HTMLElement {
    view?: { tag: string; attrs: Record<string, string>; on: Record<string, Handler> };
    // The events that it listens for, which its view's handlers handle.
    events?: Set<string>;
  }
  // The events that the host has yet to take. Until it has, an input that
  // has the focus keeps the value that was typed into it.
  let pending = 0;
  // The generation of the view shown, whose handlers events are of.
  let generation = 0;
  addEventListener('message', ({ source, data }) => {
    if (source !== parent) return;
    pending -= data.reply ?? 0;
    if (data.view != null) {
      generation = data.generation;
      patch(document.body, 0, data.view);
    }
  });
  // A form would leave the page.
  addEventListener('submit', (e) => e.preventDefault());

  // patch makes the i-th child of node show view.
  function patch(node: Node, i: number, view: View) {
    const old = node.childNodes[i] as ChildNode | undefined;
    if (typeof view === 'string') {
      if (old instanceof Text) {
        if (old.data !== view) old.data = view;
      } else {
        put(node, old, document.createTextNode(view));
      }
      return;
    }
    let el = old as Node;
    if (!(old instanceof HTMLElement) || el.view?.tag !== view.tag) {
      try {
        el = document.createElement(view.tag);
      } catch {
        el = document.createElement('div');
      }
      put(node, old, el);
    }
    const last = el.view ?? { tag: view.tag, attrs: {}, on: {} };
    const attrs = view.attrs ?? {};
    for (const name in last.attrs) if (!(name in attrs)) el.removeAttribute(name);
    for (const [name, value] of Object.entries(attrs)) {
      if (last.attrs[name] === value) continue;
      try {
        el.setAttribute(name, value);
      } catch {}
    }
    const on = view.on ?? {};
    el.events ??= new Set();
    for (const event in on) if (!el.events.has(event)) listen(el, event);
    el.view = { tag: view.tag, attrs, on };

    const children = view.children ?? [];
    children.forEach((child, j) => patch(el, j, child));
    while (el.childNodes.length > children.length) el.lastChild!.remove();

    // Once edited, an input's value is its own, not its attribute's.
    const input = el as HTMLInputElement;
    if ('value' in attrs && input.value !== attrs.value) {
      if (!(pending > 0 && el === document.activeElement)) input.value = attrs.value;
    }
    if (input.type === 'checkbox' || input.type === 'radio') {
      input.checked = 'checked' in attrs;
    }
  }

  function put(node: Node, old: ChildNode | undefined, child: globalThis.Node) {
    if (old) old.replaceWith(child);
    else node.append(child);
  }

  function listen(el: Node, event: string) {
    el.events!.add(event);
    el.addEventListener(event, (e) => {
      const handler = el.view?.on[event];
      if (!handler) return;
      pending++;
      const input = handler.value ? String((e.target as HTMLInputElement).value ?? '') : undefined;
      parent.postMessage({ generation, handler: handler.handler, input }, '*');
    });
  }
}

// Start with the drafts in the address bar, or the page's.
const panes = [...list.querySelectorAll<HTMLElement>('.draft')];
const found = shared();
if (found) {
  for (const pane of panes) pane.remove();
  for (const [name, source] of Object.entries(found)) draft(name, source);
} else {
  for (const pane of panes) draft(pane.dataset.draft!, null, pane);
}

const actions = site.querySelector<HTMLElement>('.actions')!;
const hint = document.createElement('span');
hint.textContent = runKeys;
actions.append(
  hint,
  button('Reset state', () => {
    setState('');
    stateEdited = true;
    reload();
  }),
  button('Run', reload)
);
reload();
