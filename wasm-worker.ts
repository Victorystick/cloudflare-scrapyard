/// <reference lib="webworker" />
// Runs a page's requests to a module of Victorystick/scrapscript in a Web
// Worker, off the page's thread, so that a scrap that loops forever doesn't
// freeze the page: the page stops the worker instead (see Runner, in
// runner.ts). It fetches the scraps that a request lacks from the yard.
import { WasiModule } from './scrap-wasm.ts';

type Message = Record<string, unknown>;

export interface RunRequest<Request> {
  id: number;
  request: Request;
}

// The worker says once whether it started, and then answers each request.
export type RunResponse<Result> =
  | { ready: true }
  | { ready: false; error: string }
  | { id: number; result: Result };

// The sources of the scraps fetched from the yard so far, by hash. A hash
// names one source forever, so they never go stale.
const sources: Record<string, string> = {};

// The most scraps that a scrap may refer to, as the yard allows.
const maxImports = 256;

// serve answers the page's requests with the module at url.
export function serve(url: URL) {
  const module = WebAssembly.compileStreaming(fetch(url)).then(
    (module) => new WasiModule<Message, Message>(module)
  );
  module.then(
    () => post({ ready: true }),
    (e) => post({ ready: false, error: String(e) })
  );
  self.onmessage = async ({ data }: MessageEvent<RunRequest<Message>>) => {
    let result: Message;
    try {
      result = await run(await module, data.request);
    } catch (e) {
      result = { error: String(e) };
    }
    post({ id: data.id, result });
  };
}

function post(response: RunResponse<Message>) {
  self.postMessage(response);
}

// run runs the request, and again with the scraps that it lacks, which it
// only then passes, as most requests lack none.
async function run(
  module: WasiModule<Message, Message>,
  request: Message
): Promise<Message> {
  let count = 0;
  for (;;) {
    const result = module.run(count == 0 ? request : { ...request, sources });
    const missing = result.missing as string[] | undefined;
    if (!missing) return result;

    count += missing.length;
    if (count > maxImports) {
      return { error: `A scrap may refer to at most ${maxImports} scraps` };
    }
    const wanted = missing.filter((key) => !(key in sources));
    const fetched = await Promise.all(wanted.map(fetchScrap));
    const absent = wanted.filter((_, i) => fetched[i] == null);
    if (absent.length > 0) {
      return {
        error:
          'The yard lacks the scraps it refers to:\n' +
          absent.map((key) => `$source:${key}`).join('\n'),
      };
    }
    wanted.forEach((key, i) => (sources[key] = fetched[i]!));
  }
}

// fetchScrap fetches a scrap from this yard, which serves this page, or
// returns null if the yard lacks it.
async function fetchScrap(key: string): Promise<string | null> {
  const response = await fetch('/' + key, {
    headers: { Accept: 'application/scrap' },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Fetching $source:${key} failed: ${response.status}`);
  }
  return response.text();
}
