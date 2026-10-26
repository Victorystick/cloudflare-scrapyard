/// <reference lib="dom" />
// The web playground: drafts of a little website, which scrap-wasm.wasm runs
// as an app of the web platform, in the Elm architecture. main.scrap is the
// app, which the page shows in a sandboxed frame. Each message that the site
// sends updates the app's model, which state.scrap then holds, as a scrap,
// for the next update to start from. So editing any draft keeps the state,
// and the address bar keeps the drafts, the state among them.
import { button, editable, highlight, Runner, runKeys, show } from './runner.ts';
import type { Handler, View, WasmResult } from './scrap-wasm.ts';

// The draft that is the app, and the draft that holds its model.
const app = 'main.scrap';
const state = 'state.scrap';

// What drafts may be named: a draft refers to another as $"./name.scrap".
const draftName = /^[\w-]+\.scrap$/;

// How long after an edit the site reloads.
const delay = 400;

interface Draft {
  name: string;
  pane: HTMLElement;
  code: HTMLElement;
  rehighlight: () => Promise<void>;
}

const runner = new Runner();
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
    role.textContent = name === app ? 'the app' : 'its model, after each update';
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

// The site reloads a while after the last edit, and keeps its state.
let timer: ReturnType<typeof setTimeout> | undefined;
function edited(d: Draft) {
  d.pane.querySelector('pre.out')!.classList.add('stale');
  out.classList.add('stale');
  clearTimeout(timer);
  timer = setTimeout(reload, delay);
}

function reload() {
  clearTimeout(timer);
  enqueue(() => step());
}

// Steps run one after another, each from the state that the last left.
let queue = Promise.resolve();
function enqueue(step: () => Promise<void>) {
  queue = queue.then(step);
}

interface Message {
  message: string;
  input?: string;
}

// step runs the app with the state, or its init if the state is blank, and
// the message that the site sent, if any, and shows its view.
async function step(event?: Message) {
  save();
  const blank = !find(state)?.code.textContent!.trim();
  const result: WasmResult = await runner.run({
    command: 'web',
    source: path(app),
    drafts: sources(),
    state: blank ? undefined : path(state),
    ...event,
  });
  if (!('view' in result)) {
    if (event) post({ reply: true });
    show(out, result);
    return;
  }
  out.replaceChildren();
  out.classList.remove('stale');
  setState(result.state);
  post({ view: result.view, reply: !!event });
  if (event) record(result.message!, result.state);
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

// record notes the message that the site sent in the history, with the
// state it led to, which clicking it goes back to.
function record(message: string, model: string) {
  const entry = document.createElement('li');
  entry.append(
    button(message, () => {
      setState(model);
      reload();
    })
  );
  log.prepend(entry);
  while (log.childElementCount > 100) log.lastElementChild!.remove();
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
// The page posts it each view to show, and it posts each message back.
let shown: unknown = null;
function post(data: { view?: View; reply: boolean }) {
  if ('view' in data) shown = data.view;
  frame.contentWindow?.postMessage(data, '*');
}
frame.addEventListener('load', () => {
  if (shown != null) post({ view: shown as View, reply: false });
});
frame.srcdoc = `<!doctype html><meta charset="utf-8"><script>(${render})()</script>`;
addEventListener('message', ({ source, data }) => {
  if (source !== frame.contentWindow || typeof data?.message !== 'string') return;
  const event: Message = { message: data.message };
  if (typeof data.input === 'string') event.input = data.input;
  enqueue(() => step(event));
});

// render runs in the frame, where it shows each view that the page posts it,
// changing as little of the last as it can, as Elm does, so that an input
// keeps its focus. It must refer to nothing outside itself.
function render() {
  interface Node extends HTMLElement {
    view?: { tag: string; attrs: Record<string, string>; on: Record<string, Handler> };
    // The events that it listens for, which its view's handlers handle.
    events?: Set<string>;
  }
  // The messages that the page has yet to reply to. Until it has, an input
  // that has the focus keeps the value that was typed into it.
  let pending = 0;
  addEventListener('message', ({ source, data }) => {
    if (source !== parent) return;
    if (data.reply) pending--;
    if (data.view != null) patch(document.body, 0, data.view);
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
      parent.postMessage({ message: handler.message, input }, '*');
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
    log.replaceChildren();
    reload();
  }),
  button('Run', reload)
);
reload();
