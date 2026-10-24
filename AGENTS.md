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
- `scrap-check.wasm` is the type checker, which `npm run build` builds from
  `cmd/scrap-check` in the scrapscript repository at the version that
  `go.mod` pins, so building needs Go. Bump it with
  `go get -tool github.com/Victorystick/scrapscript/cmd/scrap-check@<commit>`.
  `checker.ts` runs it, with just enough of WASI for Go.
- Everything else is a static asset (`index.html`, `style.css`), built by
  the Cloudflare Vite plugin.
- `npm run dev` serves locally, `npm test` builds and tests, and
  `npx wrangler types` generates `worker-configuration.d.ts`.
