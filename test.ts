import assert from "node:assert";
import test, { after, before, describe } from "node:test";
import { Miniflare } from "miniflare";
import { toSha256String } from "./worker.ts";

describe("worker", () => {
  let worker: Miniflare;

  before(async () => {
    worker = new Miniflare({
      modules: [
        { type: "ESModule", path: "./worker.ts", },
      ],
      kvNamespaces: ["scraps"],
    });
    await worker.ready;

    const bindings = await worker.getBindings<{ scraps: any }>();
    await bindings.scraps.delete('key');
  });

  test("read", async () => {
    const bindings = await worker.getBindings<{ scraps: any }>();

    const data = new Uint8Array([1, 2, 3])
    const key = await toSha256String(data.buffer)
    await bindings.scraps.put(key, data.buffer);

    assert.deepEqual(
      new Uint8Array(await (await worker.dispatchFetch("http://example.com/" + key)).arrayBuffer()),
      data,
    );
  });

  test("write", async () => {
    const bindings = await worker.getBindings<{ scraps: any }>();

    const data = new Uint8Array([4, 5, 6])

    const key = await (await worker.dispatchFetch("http://example.com/", { method: 'POST', body: data })).text()

    assert.deepEqual(
      new Uint8Array(await bindings.scraps.get(key, 'arrayBuffer')),
      data,
    );
  });

  test("other", async () => {
    const bindings = await worker.getBindings<{ scraps: any }>();

    const data = new Uint8Array([4, 5, 6])

    const status = (await worker.dispatchFetch("http://example.com/", { method: 'Put', body: data })).status;

    assert.deepEqual(status, 403);
  });

  after(async () => {
    await worker.dispose();
  });
});