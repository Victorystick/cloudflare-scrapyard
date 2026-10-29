import { check } from './checker.ts';
import { isSha256String, toSha256String } from './sha256.ts';

// The most scraps that a scrap may refer to, directly or not.
const maxImports = 256;

// The playground and tutorial on GitHub Pages fetch scraps from the yard.
// CORS names an origin, not a path, so this lets any of the account's
// Pages read them, which is harmless as scraps are public anyway.
const pagesOrigin = 'https://victorystick.github.io';

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export default {
  async fetch(request, env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === 'GET' && pathname === '/') {
      return env.ASSETS.fetch(request);
    }

    try {
      switch (request.method) {
        case 'POST': {
          if (request.headers.get('Content-Type') !== 'application/scrap') {
            return new Response('Missing/wrong content-type', { status: 400 });
          }

          const data = await request.arrayBuffer();
          const key = await toSha256String(data);
          // The yard checked a scrap it has when it was first pushed.
          if ((await env.scraps.get(key, 'arrayBuffer')) != null) {
            return new Response(key, { status: 200 });
          }
          const rejection = await typeCheck(data, env.scraps);
          if (rejection) return rejection;
          await env.scraps.put(key, data);
          return new Response(key, { status: 201 });
        }

        case 'GET': {
          const key = pathname.slice(1);

          // Don't hit the KV store without a valid sha256.
          if (!isSha256String(key)) {
            return new Response('Invalid sha256: ' + key, { status: 400 });
          }

          const stream = await env.scraps.get(key, 'stream');
          if (stream == null) {
            return new Response('No scrap with sha256:' + key, {
              status: 404,
              headers: { 'Access-Control-Allow-Origin': pagesOrigin },
            });
          }

          const requestedScraps = request.headers
            .get('Accept')
            ?.split(',')
            .includes('application/scrap');

          return new Response(stream, {
            status: 200,
            headers: {
              'Content-Type': requestedScraps
                ? 'application/scrap'
                : 'text/plain',
              // A hash names one source forever, so caches may keep it as
              // long as they like. Not so a 404: the scrap may be pushed.
              'Cache-Control': 'public, max-age=31536000, immutable',
              Vary: 'Accept',
              'Access-Control-Allow-Origin': pagesOrigin,
            },
          });
        }
      }

      return new Response('Unsupported method', { status: 400 });
    } catch (e: unknown) {
      return new Response(String(e), { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

// typeCheck returns the response that rejects data, unless it is a scrap that
// type checks against the scraps it refers to, which must be in the yard.
async function typeCheck(
  data: ArrayBuffer,
  scraps: KVNamespace
): Promise<Response | null> {
  let source: string;
  try {
    source = utf8.decode(data);
  } catch {
    return new Response('A scrap must be UTF-8', { status: 422 });
  }

  const sources: Record<string, string> = {};
  let count = 0;
  for (;;) {
    const result = check(source, sources);
    if ('type' in result) return null;
    if ('error' in result) return new Response(result.error, { status: 422 });

    count += result.missing.length;
    if (count > maxImports) {
      return new Response(
        `A scrap may refer to at most ${maxImports} scraps`,
        { status: 422 }
      );
    }
    const fetched = await Promise.all(
      result.missing.map((key) => scraps.get(key, 'text'))
    );
    const absent = result.missing.filter((_, i) => fetched[i] == null);
    if (absent.length > 0) {
      return new Response(
        'Push the scraps it refers to first; the yard lacks:\n' +
          absent.map((key) => `$source:${key}\n`).join(''),
        { status: 424 }
      );
    }
    result.missing.forEach((key, i) => (sources[key] = fetched[i]!));
  }
}
