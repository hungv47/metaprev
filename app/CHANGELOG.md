# Changelog

## 0.5.0 — 2026-08-23

### Added
- Responsive local repair workspace with separate Open Graph and X input resolution, representative platform cards, source-fallback labels, and cover-versus-fit crop inspection.
- Actionable issue objects with stable `code`, `impact`, `evidence`, and `fix` fields. Existing `level`, `field`, and `message` JSON keys remain compatible.
- Reviewable, copy-ready metadata starting point, repair brief, and guarded coding-agent prompt. Missing facts remain explicit comments instead of invented values.
- `og:type`, `og:image:alt`, and `twitter:image:alt` parsing, plus validation for required Open Graph fields and image alternative text.
- Focused local HTTP, CLI exit-code, fallback, render, crop, and injection regression coverage.

### Changed
- Removed generic title and description length advice. metaprev now reports observed breakage and compatibility risk instead of encouraging padded copy.
- Image guidance now cites first-party Open Graph and LinkedIn requirements. File-size warnings use LinkedIn's documented 5 MB sharing-module limit.
- A distinct `twitter:image` is fetched only for the interactive preview. Scoped and JSON commands keep the single-image, non-base64 path.
- Full-preview `--json` now follows the CI exit contract (`1` when the report contains errors), and JSON paths flush stdout before returning so large reports stay complete.
- Non-success and explicitly non-HTML page responses are runtime failures (exit `2`) instead of producing misleading missing-tag reports.
- Platform cards are labeled as representative because experiments, viewport differences, and caches can change the final unfurl.

### Security
- Generated reports use a per-report Content Security Policy nonce, escape all page-controlled values, admit only strict raster data URIs into image styles, and never embed SVG.
- Image probes reject non-HTTP(S) protocols before fetching. Repair snippets leave localhost and private-network URLs as review comments instead of presenting them as public metadata.
- Multi-image parsing keeps structured width, height, and alt evidence attached to the selected first `og:image`.

## 0.4.1 — 2026-05-29

### Changed
- Upgraded `image-size` to v2 (ESM, smaller); the named `imageSize(buf)` import is unchanged.
- Bundled agent skill (`skills/metaprev/`) updated for 0.4.0 — light/dark toggle, content-type / SVG checks, 2026-accurate platform mocks.

### Docs
- Rewrote the README around the tool's value propositions ("What you get"), with a numbered quick-start, a Troubleshooting section (bun-missing, self-signed TLS, timeouts), and a Contributing & release section.

## 0.4.0 — 2026-05-29

### Added
- **Light / dark preview toggle** in the HTML report — see how the card renders in each platform's actual light *and* dark theme (Facebook, X, LinkedIn, Discord).
- `og:image` content-type checks: warns when the image is an **SVG** (Facebook, X, and LinkedIn don't render SVG share images) and errors when a **non-image** response also fails to decode as an image (catches an `og:image` pointing at an HTML/error page that returns 200; a real image served as `application/octet-stream` still passes).
- "Copy" on the parsed-meta panel, alongside the existing issues copy.
- Test suite (`bun test`) covering parsing, validation, and rendering.

### Fixed
- **Entity decoding** now handles numeric (`&#8217;`), hex (`&#x2764;`), and common named (`&mdash;`, `&hellip;`) references. Char-count validation was previously inflated by raw entities (e.g. `Ben & Jerry’s` measured 19 chars instead of 13) and cards/facts showed raw entity text.
- **Double-escaped** values in the parsed-meta panel (`&amp;amp;`) now render correctly.
- **Hardened the preview against CSS injection** — only the validated, locally-fetched image data URI is ever placed into a CSS `url()`; a failed image probe shows a placeholder instead of injecting the remote (page-controlled) URL into inline styles.

### Changed
- Redesigned the HTML preview: OKLCH design tokens, sharper type hierarchy, platform-accurate card mocks updated for 2026 (X shows image + domain overlay with no body text; LinkedIn drops the in-feed description; Discord auto-embeds render without a color bar), full mobile responsiveness, and `prefers-reduced-motion` support.
- Faster non-preview runs: `issues` / `facts` / `--json` no longer base64-encode the image. Page (4 MB) and image (32 MB) downloads are now size-capped against hostile/misconfigured responses, and timeouts report a clear `timed out after Ns` message.

## 0.3.2 — 2026-05-12

### Fixed
- `metaprev --version` now matches the published package version.
- Shared byte formatting between terminal and HTML output so image byte display stays consistent.

### Compared to 0.3.1
- Publish-ready maintenance release for the cleanup pass.

## 0.3.0 — 2026-05-11

### Fixed
- `og:image:width`/`og:image:height` now validates against actual image dimensions. Warns when declared dimensions don't match real file dimensions — Slack and Discord trust the declared values for first-paint and will mis-crop when they don't match.

### Compared to 0.2.0
- `src/validate.ts`: +18 lines — new dimension consistency check

## 0.2.0 — 2025-11-19

### Added
- `issues` subcommand — CI-friendly, exits 1 on errors, no browser
- `facts` subcommand — raw parsed meta, plain or JSON
- `data-URI` cache-bust — og:image embedded as base64 so regenerating the asset always shows the fresh image
- Auto-relax TLS for `*.localhost` / `*.test` / `127.0.0.1` (`--insecure` still available)
- Framework-agnostic defaults (no hardcoded og:type)

## 0.1.0 — 2025-09-27

### Added
- Core preview: fetches URL, parses og:* / twitter:* meta, validates char counts and image dimensions, opens side-by-side mock for Facebook, X, LinkedIn, Discord/Slack
- `-o, --output` flag to write preview HTML to a specific path
- `--no-open` and `--json` flags
- `image-size` dep for PNG/JPEG/WebP dimension reading
