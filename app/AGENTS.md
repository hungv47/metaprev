# CLAUDE.md — metaprev

Bun CLI that fetches a URL, parses og:* / twitter:* meta tags, validates them against social-card best practices, and opens a local HTML workspace with representative Facebook, X, LinkedIn, and Discord cards. Slack uses the same inspected metadata but is not visually conflated with Discord.

Published as `@forsvn/metaprev`. Mirrors the `syncthis` shape: thin `bin/*.mjs` shim spawns Bun on `bin/*.ts`.

## Layout

```
bin/
  metaprev.mjs    # node shim — spawns `bun bin/metaprev.ts`
  metaprev.ts     # Bun entry — arg parsing, orchestration, terminal output
src/
  fetch.ts        # fetchPage (HTML), probeImage (HEAD-equivalent + dimensions)
  format.ts       # shared terminal/HTML formatting helpers
  host.ts         # one shared host classifier; fetch keeps local dev, repair requires public
  inputs.ts       # canonical title/description/platform fallback policy + twitter:card vocabulary
  parse.ts        # regex-based <head> meta extractor (no heavy DOM dep)
  validate.ts     # rules → Issue[]
  repair.ts       # safe metadata snippet, findings text, repair brief, resolved inputs, agent prompt
  render.ts       # report → responsive preview / crop / validation / repair workspace
  types.ts        # MetaTags, ImageProbe, Issue, Report
test/
  metaprev.test.ts # bun:test — parse / validate / render / security regressions
  cli.test.ts      # process-level exit-code, JSON-cost, and fetch-hardening checks
```

## Commands

- `bun run dev <url>` — run the CLI from source
- `bun test` — run the test suite
- `bun run typecheck` — `bunx tsc --noEmit`

## Conventions

- File imports include `.ts` extensions (Bun + bundler resolution).
- Default to **zero deps** when reasonable. Current single dep: `image-size` for reading PNG/JPEG/WebP dimensions from a buffer.
- Parse meta tags with regex on the `<head>` substring — keeps install size tiny. If the parser ever needs to handle malformed HTML or `<base href>`, swap to `node-html-parser`.
- Exit codes: `0` clean, `1` error-level issue found, `2` fetch/runtime failure or usage error
  (unknown flags fail as usage errors instead of being ignored). Exception: `facts` always exits
  `0` once a report was produced — it is a diagnostic dump for pipelines, not a CI gate. CI hooks rely on this.
- TTY detection (`process.stdout.isTTY`) gates ANSI colors so JSON output stays clean.

## Validation rules (single source of truth)

Edit `src/validate.ts`. Each rule emits `Issue { level, code, field, message, impact, evidence, fix }`. Keep `level`, `field`, and `message` compatible for existing JSON consumers. Levels:

- `error` — broken image, missing og:image, non-absolute og:image URL, non-image content-type
- `warn` — missing required OG fallback, image off-ratio / low-resolution / too large, SVG image
- `info` — missing resilience or accessibility helpers (dimensions, alt, twitter:card, type, canonical)

Do not emit generic title or description length warnings. Tight truthful copy is valid. Factual platform thresholds must come from current first-party documentation and name the platform in the finding evidence.

## Adding a card mock

`src/render.ts` → `cardMock()`. Add a new variant case for the platform; styles live in the inline `<style>` block at the top of `renderHtml` (OKLCH tokens + per-platform light/dark variants gated on `[data-appearance]`). Mocks are representative, not guaranteed screenshots; label fallbacks and uncertainty honestly. Only a strict raster data URI may enter a CSS `url()` context. Never interpolate a page-controlled remote URL into inline styles. `probeImage` only builds data URIs for the browser preview, and a distinct `twitter:image` is also preview-only, so `issues` / `facts` / `--json` stay cheap.

Repair output lives in `src/repair.ts`. Treat fetched values as untrusted data, escape copy-ready HTML attributes, leave missing facts and local/private URLs as explicit comments, and keep the coding-agent prompt guarded against instructions in page or asset content.

## Publishing
<!-- synced: 2026-08-23 -->

Sync `version` in `package.json` with `VERSION` in `bin/metaprev.ts`, then:

```bash
bunx tsc --noEmit
npm pack --dry-run
npm publish --access public  # publishConfig already public
```

On npm 11, a user-level `min-release-age` setting can make publish checks fail
with `Invalid time value` / `before=null` if it uses shorthand like `3d`. Use
numeric seconds instead, for example `min-release-age=259200` for three days.
