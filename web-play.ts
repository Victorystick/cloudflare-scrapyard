/// <reference lib="dom" />
// The web playground: drafts of a little website, which scrap-web.wasm runs
// as an app of the web platform, in the Elm architecture, in a Web Worker
// (web-worker.ts). main.scrap is the app, which the page shows in a
// sandboxed frame, as the host patches its view, and sends the events of
// back to the host, which keeps the app and its model. The page keeps the
// messages that updated the model since the state it was loaded with, and
// loads a changed app with them, as Elm's debugger replays them, so editing
// any draft keeps the state, and the steps. Once the updates settle, the
// page asks the host for the model, as a scrap, and shows it in
// state.scrap, and the address bar keeps the drafts, the state among them.
import { button, editable, highlight, Runner, runKeys, scrapRunner, show } from './runner.ts';
import type { Patch, WebEvent, WebRequest, WebResponse } from './scrap-web.ts';

// The draft that is the app, and the draft that holds its model.
const app = 'main.scrap';
const state = 'state.scrap';

// What drafts may be named: a draft refers to another as $"./name.scrap".
const draftName = /^[\w-]+\.scrap$/;

// How long after an edit the site reloads, and after an update the page
// asks for the model.
const delay = 400;
const settle = 300;

// The most messages that the page keeps, as each costs an update when the
// app reloads, and how many it keeps when it has more, starting from the
// model before them.
const maxLog = 500;
const keepLog = 250;

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

// The model that the messages start from, as a scrap, or "" for init, the
// messages, as scraps, the step of the host that the first follows, and
// how many of them the model shown follows, if not all, as after going
// back. The app loads with the model after them, replayed.
let base = '';
let messages: string[] = [];
let shift = 0;
let at: number | null = null;

// The generation of the last view, whether the host has the app, whether
// state.scrap holds its model, and whether state.scrap was edited since the
// app was last loaded, which the next load starts from, as it does first.
let generation = 0;
let loaded = false;
let synced = true;
let stateEdited = true;

// The page asks the host one thing at a time, and notes whether it is
// loading the app.
let queue = Promise.resolve();
let loading = false;
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

// load loads the app with the messages, from the base, or from state.scrap
// if it was edited, which drops them, or init if it is blank. If it fails,
// the host keeps the app it has. It clears the last error, unless asked
// not to.
async function load(clear = true) {
  if (stateEdited) {
    base = find(state)?.code.textContent!.trim() ?? '';
    forget();
    stateEdited = false;
  }
  save();
  loading = true;
  const res = await host.run({
    op: 'load',
    source: path(app),
    drafts: sources(),
    state: base || undefined,
    messages,
    step: at ?? undefined,
    generation: generation + 1,
  }).finally(() => (loading = false));
  if (!res.patch) {
    show(out, { error: res.error ?? 'The host failed to load the app.' });
    return;
  }
  loaded = true;
  // The messages that no longer fit the app go.
  messages.length = res.replayed ?? 0;
  shift = 0;
  if (at != null && at > messages.length) at = null;
  shown(res);
  showSteps();
  if (res.error) show(out, { error: res.error });
  else if (clear) out.replaceChildren();
  settled();
}

// forget forgets the messages, as the model starts anew.
function forget() {
  messages = [];
  shift = 0;
  at = null;
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
  for (const { step, message } of res.steps ?? []) {
    // An update after going back drops the messages after it.
    messages.length = step - shift - 1;
    messages.push(message);
    at = null;
  }
  if (res.patch) shown(res);
  if (res.error) show(out, { error: res.error });
  else if (res.patch) out.replaceChildren();
  if (res.steps?.length) {
    showSteps();
    settled();
  }
}

// lost loads the app again, with the messages, as the host lost it.
async function lost() {
  loaded = false;
  await load();
}
// A host that runs too long is stopped, and loses its app, which the page
// loads again with the messages, keeping the error. The update that ran
// too long isn't among them, but if loading did, they may be what does, so
// the page tries once more without them, and then waits for an edit.
host.stopped = () => {
  loaded = false;
  if (!loading) {
    enqueue(() => load(false));
  } else if (messages.length > 0) {
    forget();
    showSteps();
    enqueue(() => load(false));
  }
};

// shown shows the patch of the view that the host answered with.
function shown(res: WebResponse) {
  generation = res.generation!;
  post({ patch: res.patch, generation });
  out.classList.remove('stale');
}

// Once updates settle, the page asks for the model, to show it, and keeps
// fewer messages if it has too many.
let syncTimer: ReturnType<typeof setTimeout> | undefined;
function settled() {
  synced = false;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => enqueue(sync), settle);
}

// sync makes state.scrap hold the host's model, unless it was edited since,
// and moves the base past the first messages, if there are too many.
async function sync() {
  clearTimeout(syncTimer);
  if (!loaded) return;
  const drop = Math.min(messages.length - keepLog, at ?? Infinity);
  if (messages.length > maxLog && drop > 0) {
    const res = await host.run({ op: 'state', step: shift + drop });
    if (res.unloaded) return lost();
    if (res.state != null) {
      base = res.state;
      messages = messages.slice(drop);
      shift += drop;
      if (at != null) at -= drop;
      showSteps();
    }
  }
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

// showSteps shows the messages, the latest first, each of which clicking goes
// back to the model after, and marks the one shown.
function showSteps() {
  const shownAt = at ?? messages.length;
  const entries = messages.slice(-100).map((message, i, last) => {
    const n = messages.length - last.length + i + 1;
    const entry = document.createElement('li');
    entry.append(button(message, () => enqueue(() => goTo(n))));
    if (n === shownAt) entry.className = 'current';
    return entry;
  });
  log.replaceChildren(...entries.reverse());
}

// goTo shows the model after n messages.
async function goTo(n: number) {
  const res = await host.run({ op: 'goto', step: shift + n });
  if (res.unloaded) return lost();
  if (!res.patch) {
    show(out, { error: res.error! });
    return;
  }
  at = n === messages.length ? null : n;
  shown(res);
  showSteps();
  out.replaceChildren();
  synced = false;
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
// The page posts it each patch of the view, with its generation, and the
// number of events it sent that the host has taken, and it posts each
// event back. Until the frame has loaded, or once it loads anew, as after
// leaving the site, the page drops patches, and asks the host for the
// whole view.
let ready = false;
function post(data: { patch?: Patch; generation?: number; reply?: number }) {
  if (ready || data.patch == null) frame.contentWindow?.postMessage(data, '*');
}
frame.addEventListener('load', () => {
  ready = false;
  enqueue(async () => {
    // A host without the app shows the next whole.
    if (!loaded) {
      ready = true;
      return;
    }
    const res = await host.run({ op: 'view' });
    if (res.unloaded) return lost();
    ready = true;
    if (res.patch) shown(res);
  });
});
frame.srcdoc = `<!doctype html><meta charset="utf-8"><script>(${render})()</script>`;
addEventListener('message', ({ source, data }) => {
  if (source !== frame.contentWindow) return;
  const { generation, node, event, input } = data ?? {};
  if (typeof generation !== 'number' || typeof node !== 'number' || typeof event !== 'string') return;
  send(typeof input === 'string' ? { generation, node, event, input } : { generation, node, event });
});

// render runs in the frame, where it applies each patch of the view that
// the page posts it, and posts the page each event that an element listens
// for. It must refer to nothing outside itself.
function render() {
  // The nodes of the view, by id, but the body, 0, which the script runs
  // before, and their ids.
  const nodes = new Map<number, Node>();
  const ids = new WeakMap<Node, number>();
  // The events that the host has yet to take. Until it has, an input that
  // has the focus keeps the value that was typed into it.
  let pending = 0;
  // The generation of the view shown, which events are of.
  let generation = 0;
  addEventListener('message', ({ source, data }) => {
    if (source !== parent) return;
    pending -= data.reply ?? 0;
    if (data.patch != null) {
      generation = data.generation;
      apply(data.patch);
    }
  });
  // A form would leave the page.
  addEventListener('submit', (e) => e.preventDefault());

  // apply applies a patch, as cmd/example/scrap-web/dom.go describes.
  function apply(ops: (number | string | null)[]) {
    let i = 0;
    const num = () => ops[i++] as number;
    const str = () => ops[i++] as string;
    const get = (id: number) => (id === 0 ? document.body : nodes.get(id)!);
    const place = (parent: Node, after: number, node: Node) =>
      parent.insertBefore(node, after ? get(after).nextSibling : parent.firstChild);
    const build = (): Node => {
      const id = num();
      let node: Node;
      if (ops[i] === null) {
        i++;
        node = document.createTextNode(str());
      } else {
        const tag = str();
        let el: Element;
        try {
          el = document.createElement(tag);
        } catch {
          el = document.createElement('div');
        }
        for (let n = num(); n > 0; n--) set(el, str(), str());
        for (let n = num(); n > 0; n--) el.addEventListener(str(), handle);
        for (let n = num(); n > 0; n--) el.append(build());
        node = el;
      }
      nodes.set(id, node);
      ids.set(node, id);
      return node;
    };
    while (i < ops.length) {
      switch (num()) {
        case 0: // clear
          document.body.replaceChildren();
          nodes.clear();
          break;
        case 1: {
          // insert
          const parent = get(num());
          const after = num();
          place(parent, after, build());
          break;
        }
        case 2: {
          // move
          const parent = get(num());
          const after = num();
          place(parent, after, get(num()));
          break;
        }
        case 3: {
          // remove
          const node = get(num());
          node.parentNode?.removeChild(node);
          forget(node);
          break;
        }
        case 4: // text
          (get(num()) as Text).data = str();
          break;
        case 5: // set
          set(get(num()) as Element, str(), str());
          break;
        case 6: {
          // unset
          const el = get(num()) as HTMLInputElement;
          const name = str();
          el.removeAttribute(name);
          if (name === 'checked' && 'checked' in el) el.checked = false;
          break;
        }
        case 7: // on
          get(num()).addEventListener(str(), handle);
          break;
        case 8: // off
          get(num()).removeEventListener(str(), handle);
          break;
      }
    }
  }

  // set sets an attribute, and the property of an input that its attribute
  // only starts it with.
  function set(el: Element, name: string, value: string) {
    try {
      el.setAttribute(name, value);
    } catch {}
    const input = el as HTMLInputElement;
    if (name === 'value' && 'value' in input && input.value !== value) {
      if (!(pending > 0 && input === document.activeElement)) input.value = value;
    }
    if (name === 'checked' && 'checked' in input) input.checked = true;
  }

  function forget(node: Node) {
    nodes.delete(ids.get(node)!);
    node.childNodes.forEach(forget);
  }

  function handle(e: Event) {
    const node = ids.get(e.currentTarget as Node);
    if (node == null) return;
    pending++;
    const input = String((e.target as HTMLInputElement).value ?? '');
    parent.postMessage({ generation, node, event: e.type, input }, '*');
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
