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
- The Worker only handles `GET /<sha256>` and `POST /`. Everything else is a
  static asset (`index.html`, `style.css`), built by the Cloudflare Vite plugin.
- `npm run dev` serves locally, `npx vitest run` builds and tests, and
  `npx wrangler types` generates `worker-configuration.d.ts`.
