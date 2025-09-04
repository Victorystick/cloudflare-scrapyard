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
    spawnSync('npx vite build', {
      shell: true,
      stdio: 'pipe',
    });
  });

  beforeEach(async () => {
    worker = new Miniflare({
      modules: [
        { type: 'ESModule', path: './dist/cloudflare_scrapyard/worker.js' },
      ],
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

    const data = new Uint8Array([4, 5, 6]);

    const response = await worker.dispatchFetch('http://example.com/', {
      method: 'POST',
      body: data,
      headers: {
        'Content-Type': 'application/scrap',
      },
    });
    const key = await response.text();

    expect(key).toBe(await toSha256String(data.buffer));
    expect(
      new Uint8Array(await bindings.scraps.get(key, 'arrayBuffer'))
    ).toEqual(data);
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

  afterEach(async () => {
    await worker.dispose();
  });
});
