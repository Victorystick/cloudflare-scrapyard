
export async function toSha256String(data: ArrayBuffer): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isSha256String(hash: string): boolean {
  if (hash.length != 64) return false;

  for (let i = 0; i < hash.length; i++) {
    const code = hash.charCodeAt(i);
    if ((code < 48 || 57 < code) && (code < 97 || 102 < code)) return false;
  }

  return true;
}

const index = `<!doctype html>
<html>
<head><title>Scrapyard</title></head>
<body>
  A scrapyard for <a href="https://scrapscript.org">Scrapscript</a>.
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

          const contentType = 'application/scrap';

          return new Response(stream, {
            status: 200,
            headers: {
              'Content-Type': contentType,
            }
          });
        }
      }

      return new Response('Unsupported method', { status: 400 });
    } catch (e: unknown) {
      return new Response(String(e), { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;