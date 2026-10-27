# Scrapyard

A Cloudflare Worker that stores scraps in KV, keyed by the SHA-256 of their
source, for the `scrap` CLI in
[Victorystick/scrapscript](https://github.com/Victorystick/scrapscript). It
serves https://scraps.oseg.dev.

- That implementation has diverged substantially from scrapscript.org and is
  not affiliated with it. Don't present this site as part of Scrapscript or
  borrow its branding; link to the GitHub repository instead, and take
  language and hash syntax (`$source:<hex>`) from its SPEC.md.
- Examples on the homepage must reference scraps that are in the yard. Run
  them verbatim against scraps.oseg.dev before shipping. `scrap hash` (or
  `sha256sum`) gives a scrap's key and `scrap push` uploads it.
- The Worker only handles `GET /<sha256>` and `POST /`. `POST /` stores only
  scraps that type check, against the scraps they refer to by hash, which
  must be in the yard: else 422 with the error, or 424 with the missing
  hashes.
- `GET /<sha256>` lets caches keep a scrap forever (`immutable`), as its
  hash names it, and varies by `Accept`. A 404 stays uncached, since the
  scrap may be pushed later.
- `scrap-wasm.wasm` is the scrap tool as WebAssembly, which checks and
  evaluates scraps. `npm run build` builds it from `cmd/scrap-wasm` in the
  scrapscript repository at the version that `go.mod` pins, so building
  needs Go. Bump it, and the `scrap` CLI with it, with
  `go get -tool github.com/Victorystick/scrapscript/cmd/scrap-wasm@<commit>`.
  `scrap-wasm.ts` runs it, with just enough of WASI for Go, in the Worker
  (`checker.ts`, which only checks), the browser and tests.
- Everything else is a static asset (`index.html`, `tutorial.html`,
  `play.html`, `web.html`, `style.css`, the link preview image
  `public/og.png` that their Open Graph tags name, rendered from
  `og-image.html`, and the browser's copies of `scrap-wasm.wasm` and
  `scrap-web.wasm`),
  built by the Cloudflare Vite plugin. A new page must be listed in
  `vite.config.ts`.
- `repl.ts` makes the `.example`s of a page editable and runs them in the
  browser: `repl-worker.ts` evaluates them (or runs their tests, with
  `data-run="test"`) with `scrap-wasm.wasm` in a Web
  Worker, fetching the scraps they refer to from the yard, and the page
  stops it after 5 seconds. The `.example`s are highlighted with the CSS
  Custom Highlight API: building gives each its ranges as
  `data-highlights` (`highlightExamples` in `vite.config.ts`, with the
  wasm `highlight` command), `repl.ts` registers them by tree-sitter
  capture name and asks the worker again as they are edited, and
  `style.css` colours them with `::highlight()`.
- `web.html` is a playground for little websites: apps of the web
  platform, in the Elm architecture, which `scrap-web.wasm` hosts. `npm run
  build` builds it from `cmd/example/scrap-web` in the scrapscript
  repository (see its README.md), at the version that `go.mod` pins, as it
  builds `scrap-wasm.wasm`; `scrap-web.ts` has its requests. `web-play.ts`
  edits the page's `.draft`s, which refer to each other by path, and has
  `web-worker.ts` load `main.scrap` with them into the host, which keeps the
  app, its model and its view. The page applies the host's patches of the
  view in a sandboxed frame, sends the host the events that it posts back,
  and keeps the messages that they led to, which it loads a changed app
  with, from the state it started from, so that the host replays them. Once
  the updates settle, it asks for the model and shows it in `state.scrap`.
  `web.test.ts` runs the page's drafts as it does, and checks that the
  interface that the page shows is the host's `app.scrap`.
- `wasm-worker.ts` runs the requests of `repl-worker.ts` and `web-worker.ts`
  in their modules, fetching the scraps that they lack from the yard, and
  `runner.ts` holds what `repl.ts` and `web-play.ts` share, such as the
  `Runner` that stops a worker after 5 seconds.
- `tutorial.html` teaches the language as the pinned `scrap` CLI implements
  it, which lags SPEC.md (no `/` or `==` yet, for instance). Each
  `.example` is a scrap with what `scrap eval` and `scrap type` print, and
  `tutorial.test.ts` runs them all with the CLI at the version `go.mod`
  pins, and as the browser would: write an example, then paste in what the
  CLI prints.
- `npm run dev` serves locally, `npm test` builds and tests, and
  `npx wrangler types` generates `worker-configuration.d.ts`.
