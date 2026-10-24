import {
  afterEach,
  beforeEach,
  describe,
  test,
  expect,
  beforeAll,
} from 'vitest';
import { Miniflare } from 'miniflare';
import { toSha256String } from './sha256.ts';
import { spawnSync } from 'node:child_process';

describe('worker', () => {
  let worker: Miniflare;

  beforeAll(() => {
    // Vitest loads the Worker before this runs, so npm test builds
    // scrap-check.wasm first.
    const build = spawnSync('npx vite build', {
      shell: true,
      stdio: 'pipe',
    });
    if (build.status !== 0) {
      throw new Error('vite build failed:\n' + build.stderr);
    }
  });

  beforeEach(async () => {
    worker = new Miniflare({
      scriptPath: './dist/cloudflare_scrapyard/index.js',
      modules: true,
      modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
      kvNamespaces: ['scraps'],
    });
    await worker.ready;

    const bindings = await worker.getBindings<{ scraps: any }>();
    await bindings.scraps.delete('key');
  });

  test('read with accept text/html', async () => {
    const bindings = await worker.getBindings<{ scraps: any }>();

    const data = new Uint8Array([1, 2, 3]);
    const key = await toSha256String(data.buffer);
    await bindings.scraps.put(key, data.buffer);

    const response = await worker.dispatchFetch('http://example.com/' + key, {
      headers: { Accept: 'text/html' },
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(data);
  });

  test('read with accept application/scrap', async () => {
    const bindings = await worker.getBindings<{ scraps: any }>();

    const data = new Uint8Array([1, 2, 3]);
    const key = await toSha256String(data.buffer);
    await bindings.scraps.put(key, data.buffer);

    const response = await worker.dispatchFetch('http://example.com/' + key, {
      headers: { Accept: 'application/scrap' },
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(data);
  });

  test('write with without/wrong content-type', async () => {
    const bindings = await worker.getBindings<{ scraps: any }>();

    const data = new Uint8Array([4, 5, 6]);

    const response = await worker.dispatchFetch('http://example.com/', {
      method: 'POST',
      body: data,
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Missing/wrong content-type');
  });

  test('write with correct content-type', async () => {
    const bindings = await worker.getBindings<{ scraps: any }>();

    const data = new TextEncoder().encode('1 + 2');
    const response = await push(data);
    const key = await response.text();

    expect(response.status).toBe(200);
    expect(key).toBe(await toSha256String(data.buffer));
    expect(
      new Uint8Array(await bindings.scraps.get(key, 'arrayBuffer'))
    ).toEqual(data);
  });

  test('write a scrap that does not type check', async () => {
    const bindings = await worker.getBindings<{ scraps: any }>();

    const data = new TextEncoder().encode('1 + "a"');
    const response = await push(data);

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("cannot unify 'text' with 'int'");
    expect(await bindings.scraps.get(await toSha256String(data.buffer))).toBe(
      null
    );
  });

  test('write a scrap that does not parse', async () => {
    const response = await push(new TextEncoder().encode('1 +'));
    expect(response.status).toBe(422);
    expect(await response.text()).toContain('parse error');
  });

  test('write a scrap that is not UTF-8', async () => {
    const response = await push(new Uint8Array([4, 5, 0xff]));
    expect(response.status).toBe(422);
    expect(await response.text()).toContain('UTF-8');
  });

  test('write a scrap that refers to a path', async () => {
    const response = await push(new TextEncoder().encode('$"./inc.scrap" 1'));
    expect(response.status).toBe(422);
    expect(await response.text()).toContain('cannot refer to a path here');
  });

  test('write a scrap that refers to scraps the yard lacks', async () => {
    const inc = new TextEncoder().encode('x -> x + 1');
    const key = await toSha256String(inc.buffer);

    const response = await push(new TextEncoder().encode(`$source:${key} 1`));
    expect(response.status).toBe(424);
    expect(await response.text()).toContain(`$source:${key}`);
  });

  test('write scraps that refer to others', async () => {
    const enc = new TextEncoder();
    const inc = enc.encode('x -> x + 1');
    const incKey = await (await push(inc)).text();
    const twice = enc.encode(`f -> x -> f (f x)`);
    const twiceKey = await (await push(twice)).text();
    const use = enc.encode(`$source:${twiceKey} $source:${incKey}`);
    const useKey = await (await push(use)).text();

    let response = await push(enc.encode(`$source:${useKey} 1`));
    expect(response.status).toBe(200);

    // The check reaches through the scraps it refers to.
    response = await push(enc.encode(`$source:${useKey} "a"`));
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("cannot unify 'int' with 'text'");
  });

  test('other', async () => {
    const bindings = await worker.getBindings<{ scraps: any }>();

    const data = new Uint8Array([4, 5, 6]);

    const response = await worker.dispatchFetch('http://example.com/', {
      method: 'PUT',
      body: data,
    });

    expect(response.status).toBe(400);
  });

  function push(data: Uint8Array): Promise<Response> {
    return worker.dispatchFetch('http://example.com/', {
      method: 'POST',
      body: data,
      headers: { 'Content-Type': 'application/scrap' },
    }) as unknown as Promise<Response>;
  }

  afterEach(async () => {
    await worker.dispose();
  });
});
