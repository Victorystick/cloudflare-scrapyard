import { isSha256String, toSha256String } from './sha256.ts';

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
