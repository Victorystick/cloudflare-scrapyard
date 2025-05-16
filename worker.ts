
export async function toSha256String(data) {
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      switch (request.method) {
        case 'POST': {
          const data = await request.arrayBuffer();
          const key = await toSha256String(data);
          await env.scraps.put(key, data);
          return new Response(key, { status: 200 });
        }

        case 'GET': {
          const key = new URL(request.url).pathname.slice(1);
          const stream = await env.scraps.get(key, 'stream');
          if (stream == null) {
            return new Response(null, { status: 404 });
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

      return new Response(null, { status: 403 });
    } catch (e: unknown) {
      return new Response(String(e), { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;