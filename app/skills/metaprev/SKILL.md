---
name: metaprev
description: Preview, validate, and debug OpenGraph cards and social link previews locally via the metaprev CLI. Use whenever the user asks about how their site looks when shared on Facebook, X, LinkedIn, Discord, or Slack — including og:image, og:title, og:description, twitter:card, "broken share preview", "link preview not loading", "test my OG card", "OpenGraph validator", "social meta tags", or whenever they reference seeing issues from OpenGraph.xyz, metatags.io, Facebook Sharing Debugger, or similar third-party validators. Also use proactively when a Vercel/Next/Astro deploy is being checked for share-readiness, when og:image meta tags are added or modified, or when social-share thumbnails appear broken in chats. Prefer this over pointing the user at a third-party validator.
---

# metaprev — local OpenGraph preview

`metaprev` is a CLI that fetches a URL, parses Open Graph and X metadata, validates the selected image and fallbacks, then opens a local preview-and-repair workspace with representative Facebook, X, LinkedIn, and Discord cards. Slack classic unfurls use the same inspected Open Graph and X metadata, but metaprev does not present Discord UI as a Slack screenshot. It works against any `localhost` dev server and public URLs with no validator service.

- Repo: https://github.com/forsvn-labs/metaprev
- Package: `@forsvn/metaprev`
- Author intent: replace the workflow of "paste URL into OpenGraph.xyz / metatags.io / Facebook Debugger" with a local CLI you can run before shipping.

## When this skill applies

Use `metaprev` instead of pointing the user at a third-party debugger when the task involves:

- "How does this link look when shared?" "Why is my preview broken?"
- Adding or fixing `og:image`, `og:title`, `og:description`, `og:url`, `twitter:card`
- Validating image dimensions, file size, absolute-URL-ness
- Debugging Slack/Discord/iMessage embeds that don't render
- The user pasted a screenshot from OpenGraph.xyz, metatags.io, Twitter Card Validator, or Facebook Sharing Debugger
- A deploy is being readied and someone wants to check share-card health
- A new OG image was generated and needs validation

Don't reach for it when the task is: favicon work, PWA manifests, OG image *generation* (different problem — this skill validates an existing image), pure SEO meta (search-result `description`/`keywords`), or schema.org / JSON-LD.

## How to invoke

The default invocation is `npx` so no install is needed. Bun is required on `PATH` because the package ships TypeScript and runs it via Bun.

```bash
# Any URL — deployed or local dev (any framework, any port)
npx @forsvn/metaprev https://example.com
npx @forsvn/metaprev http://localhost:3000   # Next, Vite, Bun.serve, Rails…
npx @forsvn/metaprev http://localhost:4321   # Astro
npx @forsvn/metaprev http://localhost:5173   # Vite default
# (no URL → prints help)

# Subcommands — scoped text/JSON output, no browser
npx @forsvn/metaprev issues https://example.com          # just the issue list
npx @forsvn/metaprev facts  https://example.com          # just the parsed meta facts
npx @forsvn/metaprev facts  https://example.com --json   # pipe into another tool

# CI / scripting — JSON to stdout, no browser
npx @forsvn/metaprev https://example.com --json

# Don't auto-open the browser
npx @forsvn/metaprev https://example.com --no-open

# Write the preview HTML to a specific file
npx @forsvn/metaprev https://example.com -o ./og-preview.html

# Local self-signed TLS (auto-on for *.localhost / *.test / 127.0.0.1; otherwise pass explicitly)
npx @forsvn/metaprev https://staging.internal --insecure
```

Exit codes: `0` clean, `1` at least one error-level issue, `2` fetch failure. Use exit code `1` to fail a CI check.

## Reading the output

Three issue levels:

- **error** — share is visibly broken. No `og:image`, image returns 404, `og:image` is a relative URL like `/og.png` (most validators fetch the URL standalone and fail), or the URL returns a non-image response that can't be decoded (points at an HTML/error page).
- **warn** — real compatibility or presentation risk. Examples: missing `og:title`, off-ratio or low-resolution image, image above LinkedIn's documented 5 MB limit, SVG image, or declared dimensions that differ from the decoded asset.
- **info** — standards, accessibility, or resilience improvement. Examples: missing `og:image:alt`, `og:type`, dimensions, canonical URL, or `twitter:card`.

Address errors first. Use each finding's impact and evidence to judge warnings. Info findings do not fail CI, but accessibility and standards notes can still be worth fixing.

Every issue includes a stable code, impact, observed evidence, and a concrete fix. The HTML workspace also shows Open Graph versus X inputs, source fallbacks, cover-versus-fit crop evidence, and copy-ready metadata, repair brief, and guarded coding-agent prompt.

## Common fixes (in order of leverage)

1. **`og:image` must be an absolute URL.** Many template engines emit `/og-default.png`, but Open Graph defines the property as a URL. Fix: produce `https://yourdomain.com/og-default.png`.
   - Astro: `new URL(image, Astro.site).toString()` (requires `site` in `astro.config`)
   - Next.js: build with `process.env.NEXT_PUBLIC_SITE_URL` or `metadata.metadataBase`
   - SvelteKit: `${$page.url.origin}${image}`
   - Plain HTML: hardcode the full URL
2. **Use a deliberate 1.91:1 asset.** The workspace target is 1200×630. LinkedIn documents 1200×627 for its sharing module. Use the crop inspection instead of assuming every platform will frame it identically.
3. **Add accurate `og:image:width`, `og:image:height`, and `og:image:alt`.** The dimensions must match the decoded file. Alt describes what is in the image, not a slogan.
4. **Choose the X treatment explicitly.** Use `summary_large_image` for a wide card or `summary` for the compact card.
5. **Set `og:url` or a `<link rel="canonical">`** so platforms dedupe shares from URLs with `?utm_*` query strings.

## Copy rule

metaprev intentionally emits no generic title-length or description-length warnings. Preserve concise, truthful copy. Do not add keywords, claims, calls to action, or padding just to resemble an SEO score. Treat the metadata snippet as a safe starting point: adapt it to the framework and review every value. A local or private-network URL remains a comment because it is not a valid public repair value.

## Workflow patterns

### Pattern A — User just changed OG meta and wants to verify

1. Run `npx @forsvn/metaprev <url>` (local or deployed).
2. Read the terminal output: title, description, image URL, image dims, issue list.
3. Surface errors first with the recommended fix.
4. Surface warnings with their evidence and concrete fix.
5. Skip info-level unless it fits the user's current pass.

### Pattern B — User says the link preview is broken on a specific platform

1. Run `metaprev` against the page they're sharing.
2. Diagnose from evidence in this order: (a) `og:image` missing or not absolute? (b) image request fails? (c) decoded bytes and response type disagree? (d) image too large or framed poorly?
3. If everything looks fine in `metaprev`, the platform may be serving cached metadata. Use an official refresh tool where one exists:
   - Facebook: scrape again via the Sharing Debugger (https://developers.facebook.com/tools/debug/)
   - LinkedIn: use the Post Inspector (https://www.linkedin.com/post-inspector/)
   - X, Slack, and Discord cache behavior can change; do not promise a refresh time.

### Pattern C — Pre-deploy CI check

Add a smoke test to a pre-deploy script:

```bash
npx @forsvn/metaprev https://staging.example.com --json > /dev/null || exit 1
```

Exit code `1` fails the deploy when any error-level issue exists. The `--json` output is machine-readable for further checks (e.g., assert image content-type is `image/png`).

### Pattern D — User pastes a screenshot from OpenGraph.xyz or similar

Third-party validators may overlap with metaprev and may also add generic heuristics such as "missing CTA in image" or "title 50–60 chars." Run metaprev against the same URL to confirm the source evidence, then review each claim:

- "Image is 2400×1260" → the ratio is already correct; do not resize only to hit an exact pixel count.
- "Image is broken in preview" → inspect the resolved URL, HTTP result, response type, and decoded bytes before choosing a fix.
- "Missing CTA in image" → push back. Editorial OG cards (clean typography, brand name, tagline) don't need "Visit example.com →" buttons. The buttons make the card look like an ad. The tagline IS the CTA.
- "Title is short, description is short" → user's call. Recommend keeping if intentional.

## Output reading reference

Terminal:

```
metaprev — https://example.com/
HTTP 200 · fetched 2026-05-10T16:45:13Z

  title        Example Inc. (12 chars)
  description  We build... (58 chars)
  og:image     https://example.com/og.png
  image dims   1200×630px

  WRN og:image     The image does not match the 1.91:1 share frame.
      impact       Depending on the platform and viewport, the asset can be cropped or padded.
      evidence     The decoded asset is 1200×1200px (1.00:1); the workspace frame is 1.91:1.
      fix          Export a 1200×630px version and keep important content away from the edges.
  ...
  preview → /var/folders/.../preview.html
```

`--json` output has parsed metadata, the image probe, and a typed `issues[]` array. Existing `level`, `field`, and `message` keys remain; `code`, `impact`, `evidence`, and `fix` add repair context.

The HTML report is a responsive local workspace with four representative card mocks, light/dark treatments, explicit source fallbacks, crop-versus-fit image inspection, prioritized validation, parsed facts, and reviewed repair outputs. Platform experiments, viewport differences, and cached unfurls can differ from the mocks.

## Limitations to know

- Bun must be on `PATH`; users without Bun get a clear error pointing to https://bun.sh/install.
- Currently parses meta tags via regex on the `<head>` substring. Handles standard cases; pages that use `<base href>` or that emit meta tags outside `<head>` may parse imperfectly. If a page has weird structure, fall back to viewing raw HTML.
- The platform cards are representative and can differ from live UI experiments, viewport treatments, and cached unfurls. The report makes that uncertainty explicit.
- No JavaScript rendering. If the page sets meta tags via client-side JS (rare; bad practice for shared content), `metaprev` won't see them. Recommend the user emit meta tags server-side / at build.
