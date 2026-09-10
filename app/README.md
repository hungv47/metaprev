# metaprev

[![skills.sh](https://skills.sh/b/forsvn-labs/metaprev)](https://skills.sh/forsvn-labs/metaprev)

![metaprev demo](https://github.com/forsvn-labs/metaprev/raw/main/demo.gif)

**Inspect how your share metadata is likely to render — locally, before you ship.**

Broken share cards are invisible until they're live. The page looks fine; the link looks broken — a blank thumbnail, the wrong image, or a damaging crop — and you only find out after sharing it. metaprev fetches your URL, parses its Open Graph and X metadata, validates the selected asset, and opens a local repair workspace with representative **Facebook**, **X**, **LinkedIn**, and **Discord** cards. Its fallback inspection also covers the common Open Graph and X metadata used by [Slack classic unfurls](https://api.slack.com/reference/messaging/link-unfurling).

No account, no upload, no copy-pasting into a third-party debugger. Point it at your local dev server (any framework — Next, Astro, Vite, SvelteKit, Bun.serve, Rails, Django…) or a deployed page.

```bash
npx @forsvn/metaprev https://your-site.com
npx @forsvn/metaprev http://localhost:3000   # your dev server, whatever the port
```

## What you get

- **Platform-aware, without fake certainty.** The workspace separates Open Graph values from X-specific overrides and labels every fallback it used. The mocks are representative: platform experiments, viewport changes, and cached unfurls can still differ.
- **Light and dark inspection.** A toggle lets you check the same inputs against representative light and dark card treatments.
- **Crop evidence, not guesswork.** Cover and fit views place the fetched asset in the same 1.91:1 frame, show decoded dimensions and byte size, and estimate which edges a centered cover crop hides.
- **What you validated is what you saw.** The `og:image` is fetched and embedded as a data URI in the preview, so regenerating your asset never shows a stale, browser-cached image.
- **Catches silent breaks.** A relative `og:image` such as `/og.png` is not a valid Open Graph URL and can fail when a crawler fetches the asset. metaprev flags that plus broken or missing images, harmful crops, oversized files, non-image or SVG responses, and declared dimensions that do not match the decoded file.
- **Runs where you work.** Against `localhost` on any framework and port, before you deploy — somewhere OpenGraph.xyz, metatags.io, and the Facebook Debugger can't reach.
- **CI-ready.** Exit codes (`0` clean / `1` error / `2` fetch failure) plus `--json` and scoped `issues` / `facts` subcommands let you fail a build the moment a share card breaks.
- **Actionable findings.** Every issue has a stable code plus impact, observed evidence, and a concrete fix. Errors come first; warnings and notes cannot bury them.
- **Copy-ready repair output.** Review and copy a safe metadata starting point, an evidence-led repair brief, or a guarded prompt for a coding agent. Missing facts and local-only URLs stay explicit comments instead of becoming invented public metadata.
- **Safer local reports.** Page values are escaped, image probes accept only HTTP(S), only validated raster data URIs enter image styles, SVG is never embedded, and a per-report CSP nonce limits script execution.
- **Tiny and fast.** One dependency, no network round-trip to a third party, instant open.
- **Teaches your AI agent.** Ships a [skill](#agent-skill) so coding agents reach for metaprev (not a third-party validator) and know which warnings to ignore.

## Quick start

1. **Run it against your page** — a local dev server or a deployed URL:
   ```bash
   npx @forsvn/metaprev http://localhost:3000
   ```
   Requires `bun` on PATH ([install](https://bun.sh/install)); the package ships TypeScript and runs it via Bun.
2. **Read the terminal summary.** You get the resolved title, description, `og:image`, image dimensions, and the issues found — errors first, then warnings, then info.
3. **Open the workspace.** Compare platform inputs, cover-versus-fit crop, prioritized validation, parsed facts, resolved fallbacks, and repair output in one responsive report.
4. **Fix what's flagged and re-run.** The exit code stays `1` while any error remains and drops to `0` once the card is clean — so the same command works as a pre-ship check.

## What it checks
<!-- synced: 2026-08-23 -->

| Check | Why |
|---|---|
| Share title and description | Errors only when no usable value exists; metaprev does not pad copy to generic SEO character targets |
| Required Open Graph fields | Flags a missing `og:title`, `og:type`, `og:image`, or canonical share URL with the exact fallback observed |
| `og:image` is absolute URL | Crawlers fetch the URL standalone and fail on relative paths |
| `og:image` returns a successful response | Catches stale or wrong URLs |
| `og:image` content-type | Errors when a non-image response cannot be decoded; warns on SVG and never embeds it in the report |
| Image dimensions and crop | Uses a 1200×630 (1.91:1) workspace target; LinkedIn documents 1200×627 for its sharing module |
| Image file size | Warns above LinkedIn's documented 5 MB sharing-module limit |
| `og:image:width` / `:height` | Shows whether declared dimensions match the decoded asset |
| `og:image:alt` | Notes when the image lacks the description recommended by the Open Graph protocol |
| `twitter:card` | Distinguishes `summary_large_image` from the compact `summary` treatment |
| `og:url` / canonical | Helps platforms dedupe shares |

Three severity levels: **error** (broken input), **warn** (real compatibility or presentation risk), and **info** (standards or resilience improvement). Each issue in text and JSON includes `level`, `code`, `field`, `message`, `impact`, `evidence`, and `fix`. The original `level` / `field` / `message` keys remain available for existing scripts.

The rules use the [Open Graph protocol](https://ogp.me/) and current [LinkedIn sharing requirements](https://www.linkedin.com/help/linkedin/answer/a521928) for factual requirements. The report says when a card is representative rather than presenting a mock as a guaranteed platform screenshot.

## Install

Run via `npx` (no install):

```bash
npx @forsvn/metaprev <url>
```

Or install globally for instant repeat runs:

```bash
bun add -g @forsvn/metaprev
# or
npm install -g @forsvn/metaprev
```

Requires `bun` on PATH ([install](https://bun.sh/install)) — the package ships TypeScript source and runs it via Bun.

## Usage

```bash
metaprev                                 # no URL → show help
metaprev http://localhost:3000           # check your local dev server (any port, any framework)
metaprev https://forsvn.com              # check a deployed page
metaprev https://forsvn.com --json       # CI-friendly JSON output
metaprev https://forsvn.com --no-open    # don't auto-open the preview
metaprev https://forsvn.com -o ./og.html # write the preview to a specific path

# Subcommands — same data, no browser, scoped output
metaprev issues http://localhost:3000    # just the issue list (exits 1 on errors — CI-friendly)
metaprev facts  https://forsvn.com       # just the parsed meta facts (title, dims, bytes, etc.)
metaprev facts  https://forsvn.com --json # pipe parsed meta into another tool
```

## Options

| Flag | Effect | Default |
|---|---|---|
| `-o, --output <file>` | Write preview HTML to `<file>` (preview command only) | a temp file |
| `--no-open` | Don't auto-open the preview in your browser | opens |
| `--json` | Print machine-readable JSON to stdout (implies `--no-open`) | off |
| `-k, --insecure` | Skip TLS verification | auto-on for `*.localhost` / `*.test` / `127.0.0.1` |
| `-v, --version` | Print version | — |
| `-h, --help` | Show help | — |

## Exit codes
<!-- synced: 2026-08-23 -->

- `0` — no errors (warnings allowed)
- `1` — at least one error-level issue (broken image, missing `og:image`, etc.)
- `2` — fetch/runtime failure or usage error (unknown flags fail instead of being ignored)

Exception: `facts` always exits `0` once a report was produced. It is a diagnostic
dump for pipelines, not a CI gate — use `issues` or the default command when you
need the exit code to reflect findings.

Useful in CI — fail the build when a share card breaks:

```bash
npx @forsvn/metaprev issues https://staging.example.com --json || exit 1
```

## Troubleshooting

- **`metaprev: requires bun on PATH` (exit 127).** The package runs its TypeScript via Bun. Install Bun: `curl -fsSL https://bun.sh/install | bash`, then re-run.
- **`failed to fetch … self-signed certificate` (exit 2).** A staging server with a self-signed cert. Re-run with `--insecure`. (It's auto-on for `*.localhost`, `*.test`, and `127.0.0.1`.)
- **`timed out after 10s` (exit 2).** The page or image didn't respond in time — check the server is up and the URL is reachable from your machine.
- **The card looks right in metaprev but stale on a platform.** metaprev validates the source response, not platform caches. Use the platform's own refresh or inspection tool where one exists, such as the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) or [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/).

## Agent skill

This repo ships a skill at [`skills/metaprev/`](./skills/metaprev/) that teaches coding agents to run the local validator, interpret impact/evidence/fix findings, respect metadata fallbacks, and reject generic SEO padding or invented calls to action.

Install via the [skills](https://skills.sh) CLI:

```bash
# Globally — available across all projects
npx skills add forsvn-labs/metaprev -g

# Or per-project — committed with your repo, shared with your team
npx skills add forsvn-labs/metaprev
```

Works with Claude Code, Cursor, Codex, OpenCode, and other agents supported by the [skills CLI](https://github.com/vercel-labs/skills#supported-agents).

## Contributing & release
<!-- synced: 2026-08-23 -->

```bash
bun install
bun test            # parse / validate / render regressions
bun run typecheck   # bunx tsc --noEmit
bun run dev <url>   # run the CLI from source
```

Before publishing, sync `version` in `package.json` with `VERSION` in `bin/metaprev.ts`, then:

```bash
bun run typecheck
npm pack --dry-run
npm publish --access public
```

If npm 11 reports `Invalid time value` / `before=null`, check that any user-level `min-release-age` config is numeric seconds, not shorthand like `3d`.

## License

MIT © Le Vinh Hung
