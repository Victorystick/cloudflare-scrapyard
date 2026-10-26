// The requests of scrap-web.wasm, the host of the web platform that
// cmd/example/scrap-web in Victorystick/scrapscript builds (see its
// README.md), which runs an app in the Elm architecture, and keeps it
// between requests.
import { WasiModule } from './scrap-wasm.ts';

export type WebRequest =
  // Loads the app in source, with the model in state, a scrap, if not
  // init, and numbers its views from generation.
  | {
      op: 'load';
      source: string;
      drafts?: Record<string, string>;
      sources?: Record<string, string>;
      state?: string;
      generation?: number;
    }
  // Updates the model with the messages of the events.
  | { op: 'send'; events: WebEvent[] }
  // Asks for the model, as a scrap.
  | { op: 'state' }
  // Goes back to the model after a step.
  | { op: 'goto'; step: number };

// An event that a handler of an element of the view of a generation
// handled, with the value of its target if the handler takes it.
export interface WebEvent {
  generation: number;
  handler: number;
  input?: string;
}

export interface WebResponse {
  missing?: string[];
  error?: string;
  // Whether no app is loaded, as after the module restarted.
  unloaded?: boolean;
  view?: View;
  generation?: number;
  steps?: Step[];
  state?: string;
}

// An update of the model by a message, as a scrap.
export interface Step {
  step: number;
  message: string;
}

// The view of an app: text, or an element.
export type View = string | ViewElement;

export interface ViewElement {
  tag: string;
  attrs?: Record<string, string>;
  on?: Record<string, Handler>;
  children?: View[];
}

// A handler of an event, which the page sends back by its index.
export interface Handler {
  handler: number;
  // Whether it takes the value of the event's target.
  value?: boolean;
}

// A ScrapWeb runs apps with an instance of scrap-web.wasm.
export class ScrapWeb extends WasiModule<WebRequest, WebResponse> {}
