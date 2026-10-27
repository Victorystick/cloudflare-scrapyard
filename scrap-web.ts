// The requests of scrap-web.wasm, the host of the web platform that
// cmd/example/scrap-web in Victorystick/scrapscript builds (see its
// README.md), which runs an app in the Elm architecture, and keeps it
// between requests.
import { WasiModule } from './scrap-wasm.ts';

export type WebRequest =
  // Loads the app in source, with the model in state, a scrap, if not
  // init, updated with the messages, scraps of the steps that the host
  // answered with, which it replays as many of as fit the app, showing the
  // last or the step, and numbers its views from generation.
  | {
      op: 'load';
      source: string;
      drafts?: Record<string, string>;
      sources?: Record<string, string>;
      state?: string;
      messages?: string[];
      step?: number;
      generation?: number;
    }
  // Updates the model with the messages of the events.
  | { op: 'send'; events: WebEvent[] }
  // Asks for the model shown, or of the step, as a scrap.
  | { op: 'state'; step?: number }
  // Goes back to the model after a step.
  | { op: 'goto'; step: number }
  // Asks for a patch that shows the whole view, as to a page that lost it.
  | { op: 'view' };

// An event that an element of the view of a generation handled, with the
// value of its target, which an #on-value handler takes.
export interface WebEvent {
  generation: number;
  node: number;
  event: string;
  input?: string;
}

export interface WebResponse {
  missing?: string[];
  error?: string;
  // Whether no app is loaded, as after the module restarted.
  unloaded?: boolean;
  patch?: Patch;
  generation?: number;
  // How many of the messages that a load was given it replayed.
  replayed?: number;
  steps?: Step[];
  state?: string;
}

// An update of the model by a message, as a scrap.
export interface Step {
  step: number;
  message: string;
}

// A patch of the view that the page shows: op codes, each followed by its
// operands, as cmd/example/scrap-web/dom.go describes. Each node of the
// view has an id, the body 0.
export type Patch = (number | string | null)[];

export const Op = {
  // Empties the body.
  clear: 0,
  // parent, after, node: inserts a node after the child after, or first.
  insert: 1,
  // parent, after, id: moves a node after the child after, or first.
  move: 2,
  // id: removes a node.
  remove: 3,
  // id, text: sets a text node's text.
  text: 4,
  // id, name, value: sets an attribute.
  set: 5,
  // id, name: removes an attribute.
  unset: 6,
  // id, event: listens for an event.
  on: 7,
  // id, event: stops listening for an event.
  off: 8,
} as const;

// A ScrapWeb runs apps with an instance of scrap-web.wasm.
export class ScrapWeb extends WasiModule<WebRequest, WebResponse> {}
