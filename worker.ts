import { isSha256String, toSha256String } from './sha256.ts';

const index = `<!doctype html>
<html>
<head>
  <title>Scrapyard</title>
  <style>code, pre { background: #f0f0f0; padding: 2px 4px; border-radius: 4px; }</style>
</head>
<body>
  A scrapyard for <a href="https://scrapscript.org">Scrapscript</a>.

  <h2>GET /$sha256</h2>
  <p>Retrieve a scrap by its SHA-256 hash.</p>
  <p>If requested via <code>Accept: application/scrap</code> such will be its response type, otherwise <code>text/plain</code>.</p>

  <h3>Example</h3>
  <p><a href="/5784ceb93d8e863632b123fbf082ba217525464b85893b564cdf94e2811a0166">This scrap</a>
  from the <a href="https://scrapscript.org">Scrapscript</a> website (simplified) can be
  <a href="https://github.com/Victorystick/scrapscript">evaluated</a> like so:</p>
  <pre>$ echo '$sha256~~5784ceb93d8e863632b123fbf082ba217525464b85893b564cdf94e2811a0166' | scrap eval
"hi aaaron"</pre>

  <h2>POST /</h2>
  <p>Stores a scrap passed in the request body, returning its SHA-256 hash.</p>
  <p>Uploads will only be accepted if sent with the <code>Content-Type: application/scrap</code> header.</p>
</body>
</html>`;

export default {
  async fetch(request, env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === 'GET' && pathname === '/') {
      return new Response(index, { headers: { 'Content-Type': 'text/html' } });
    }

    try {
      switch (request.method) {
        case 'POST': {
          if (request.headers.get('Content-Type') !== 'application/scrap') {
            return new Response('Missing/wrong content-type', { status: 400 });
          }

          const data = await request.arrayBuffer();
          const key = await toSha256String(data);
          await env.scraps.put(key, data);
          return new Response(key, { status: 200 });
        }

        case 'GET': {
          const key = pathname.slice(1);

          // Don't hit the KV store without a valid sha256.
          if (!isSha256String(key)) {
            return new Response('Invalid sha256: ' + key, { status: 400 });
          }

          const stream = await env.scraps.get(key, 'stream');
          if (stream == null) {
            return new Response('No scrap with sha256:' + key, { status: 404 });
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
