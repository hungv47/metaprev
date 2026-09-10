import { describe, expect, test } from 'bun:test'
import { parseMeta } from '../src/parse.ts'
import { resolvePrimaryInput, resolvePlatformInput, isKnownTwitterCard, CARD_SUMMARY, CARD_SUMMARY_LARGE_IMAGE } from '../src/inputs.ts'
import { buildAgentPrompt, buildMetaSnippet, buildFindingsText, buildRepairBrief, resolveInputs } from '../src/repair.ts'
import { classifyHost, classifyUrlHost } from '../src/host.ts'
import { readCappedBytes } from '../src/fetch.ts'
import { renderHtml } from '../src/render.ts'
import type { ImageProbe, MetaTags, Report } from '../src/types.ts'
import { validate } from '../src/validate.ts'

function report(over: Partial<Report>): Report {
  return {
    source: 'http://x',
    fetchedAt: '2026-01-01T00:00:00Z',
    finalUrl: 'http://x/',
    status: 200,
    meta: {},
    image: undefined,
    issues: [],
    ...over,
  }
}

function okImage(over: Partial<ImageProbe> = {}): ImageProbe {
  return { url: 'https://x/og.png', resolved: 'https://x/og.png', status: 200, ok: true, contentType: 'image/png', byteLength: 50_000, width: 1200, height: 630, ...over }
}

describe('parseMeta', () => {
  test('extracts title, og:*, twitter:*, and canonical', () => {
    const m = parseMeta(`<head>
      <title>Page Title</title>
      <meta property="og:title" content="OG Title">
      <meta property="og:type" content="website">
      <meta property="og:description" content="OG desc">
      <meta property="og:image" content="https://x/og.png">
      <meta property="og:image:alt" content="A quiet blue card">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:image" content="https://x/tw.png">
      <meta name="twitter:image:alt" content="An X-specific crop">
      <link rel="canonical" href="https://x/canonical">
    </head>`)
    expect(m.title).toBe('Page Title')
    expect(m.ogTitle).toBe('OG Title')
    expect(m.ogType).toBe('website')
    expect(m.ogImage).toBe('https://x/og.png')
    expect(m.ogImageAlt).toBe('A quiet blue card')
    expect(m.twitterCard).toBe('summary_large_image')
    expect(m.twitterImage).toBe('https://x/tw.png')
    expect(m.twitterImageAlt).toBe('An X-specific crop')
    expect(m.canonical).toBe('https://x/canonical')
  })

  test('decodes named, numeric, and hex entities; char count reflects decoded length', () => {
    const m = parseMeta(`<head><meta property="og:title" content="Ben &amp; Jerry&#8217;s &mdash; &#x2764;"></head>`)
    expect(m.ogTitle).toBe("Ben & Jerry’s — ❤")
    // 13 + " — ❤" = "Ben & Jerry's — ❤" is 17 code units; the point is it is NOT the
    // raw-entity length (which would be much longer).
    expect(m.ogTitle!.length).toBeLessThan(20)
    expect(m.ogTitle).not.toContain('&#')
    expect(m.ogTitle).not.toContain('&amp;')
  })

  test('leaves unknown / malformed entities untouched', () => {
    const m = parseMeta(`<head><meta property="og:title" content="100% &notreal; &#999999999;"></head>`)
    expect(m.ogTitle).toContain('&notreal;')
    expect(m.ogTitle).toContain('100%')
  })

  test('entity names that collide with Object.prototype do not leak prototype members', () => {
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
      const m = parseMeta(`<head><meta property="og:title" content="&${name};"></head>`)
      expect(m.ogTitle).toBe(`&${name};`)
    }
  })

  test('handles single quotes and unquoted attributes', () => {
    const m = parseMeta(`<head><meta property='og:title' content='  Single  '><meta property=og:description content=Bare></head>`)
    expect(m.ogTitle).toBe('Single')
    expect(m.ogDescription).toBe('Bare')
  })

  test('first og:image wins; og:image:secure_url is an alias', () => {
    const m = parseMeta(`<head><meta property="og:image" content="https://x/a.png"><meta property="og:image:secure_url" content="https://x/b.png"></head>`)
    expect(m.ogImage).toBe('https://x/a.png')
  })

  test('keeps structured properties attached to the selected first image', () => {
    const m = parseMeta(`<head>
      <meta property="og:image" content="https://x/first.png">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
      <meta property="og:image:alt" content="First asset">
      <meta property="og:image" content="https://x/second.png">
      <meta property="og:image:width" content="400">
      <meta property="og:image:height" content="400">
      <link rel="alternate canonical" href="https://x/canonical">
    </head>`)
    expect(m.ogImage).toBe('https://x/first.png')
    expect(m.ogImageWidth).toBe('1200')
    expect(m.ogImageHeight).toBe('630')
    expect(m.ogImageAlt).toBe('First asset')
    expect(m.canonical).toBe('https://x/canonical')
  })

  test('attaches structured properties declared before the first og:image root tag', () => {
    const m = parseMeta(`<head>
      <meta property="og:image:alt" content="Early alt">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
      <meta property="og:image" content="https://x/first.png">
    </head>`)
    expect(m.ogImage).toBe('https://x/first.png')
    expect(m.ogImageAlt).toBe('Early alt')
    expect(m.ogImageWidth).toBe('1200')
    expect(m.ogImageHeight).toBe('630')
  })

  test('a later og:image:url alias group does not steal structured props for the first image', () => {
    const m = parseMeta(`<head>
      <meta property="og:image" content="https://x/a.png">
      <meta property="og:image:url" content="https://x/b.png">
      <meta property="og:image:width" content="99">
    </head>`)
    expect(m.ogImage).toBe('https://x/a.png')
    // The width belongs to the b.png group, which the preview does not select.
    expect(m.ogImageWidth).toBeUndefined()
  })
})

describe('host classification', () => {
  test('classifies loopback, dev names, and unspecified hosts as local/non-public', () => {
    expect(classifyHost('localhost')).toBe('local')
    expect(classifyHost('app.localhost')).toBe('local')
    expect(classifyHost('shop.test')).toBe('local')
    expect(classifyHost('127.0.0.1')).toBe('loopback')
    expect(classifyHost('127.8.8.8')).toBe('loopback')
    expect(classifyHost('0.0.0.0')).toBe('unspecified')
    expect(classifyHost('::1')).toBe('loopback')
  })

  test('classifies IPv4-mapped IPv6 addresses by their embedded IPv4 range', () => {
    expect(classifyHost('::ffff:127.0.0.1')).toBe('loopback')
    expect(classifyHost('::ffff:10.0.0.5')).toBe('private')
    expect(classifyHost('::ffff:192.168.1.1')).toBe('private')
    expect(classifyHost('::ffff:8.8.8.8')).toBe('public')
    expect(classifyHost('::ffff:a00:1')).toBe('private') // ::ffff:10.0.0.1 in hex form
  })

  test('classifies CGNAT and other non-public IPv4 ranges', () => {
    expect(classifyHost('100.64.0.1')).toBe('private')
    expect(classifyHost('100.127.255.254')).toBe('private')
    expect(classifyHost('100.128.0.1')).toBe('public')
    expect(classifyHost('10.1.2.3')).toBe('private')
    expect(classifyHost('172.16.0.9')).toBe('private')
    expect(classifyHost('172.32.0.9')).toBe('public')
    expect(classifyHost('192.168.0.1')).toBe('private')
    expect(classifyHost('169.254.1.1')).toBe('private')
    expect(classifyHost('198.51.100.7')).toBe('reserved')
    expect(classifyHost('203.0.113.9')).toBe('reserved')
    expect(classifyHost('224.0.0.1')).toBe('reserved')
    expect(classifyHost('250.1.2.3')).toBe('reserved')
    expect(classifyHost('8.8.8.8')).toBe('public')
    expect(classifyHost('140.82.121.4')).toBe('public')
  })

  test('classifies IPv6 private and reserved ranges', () => {
    expect(classifyHost('fd00::1')).toBe('private')
    expect(classifyHost('fe80::1')).toBe('private')
    expect(classifyHost('ff02::1')).toBe('reserved')
    expect(classifyHost('2001:db8::1')).toBe('reserved')
    expect(classifyHost('2606:4700::6810:84e5')).toBe('public')
  })

  test('exposes two policies from one classifier', () => {
    expect(classifyUrlHost('http://localhost:3000/page').isLocalDevHost).toBe(true)
    expect(classifyUrlHost('http://127.0.0.1:3000').isLocalDevHost).toBe(true)
    expect(classifyUrlHost('http://localhost:3000/page').isPublicHost).toBe(false)
    expect(classifyUrlHost('https://hungv.io').isPublicHost).toBe(true)
    // A mapped-IPv6 private host is neither local-dev nor public.
    expect(classifyUrlHost('http://[::ffff:10.0.0.1]/').isLocalDevHost).toBe(false)
    expect(classifyUrlHost('http://[::ffff:10.0.0.1]/').isPublicHost).toBe(false)
    // Malformed input fails closed.
    expect(classifyUrlHost('not a url').isPublicHost).toBe(false)
  })
})

describe('bounded null-body reads', () => {
  function nullBodyResponse(headers: Record<string, string>, body?: ArrayBuffer): Response {
    return { body: null, headers: new Headers(headers), arrayBuffer: async () => body ?? new ArrayBuffer(0) } as unknown as Response
  }

  test('reads a small declared null-body response within the cap', async () => {
    const data = new TextEncoder().encode('hello').buffer as ArrayBuffer
    const { bytes, truncated } = await readCappedBytes(nullBodyResponse({ 'content-length': '5' }, data), 1024)
    expect(bytes.toString()).toBe('hello')
    expect(truncated).toBe(false)
  })

  test('rejects a null-body response whose declared length exceeds the cap', async () => {
    await expect(readCappedBytes(nullBodyResponse({ 'content-length': String(10 * 1024 * 1024) }), 1024))
      .rejects.toThrow('readable size limit')
  })

  test('rejects a null-body response with no declared length instead of reading unbounded', async () => {
    await expect(readCappedBytes(nullBodyResponse({}), 1024)).rejects.toThrow('readable size limit')
  })
})

describe('canonical input fallback policy', () => {
  test('Open Graph text never falls back to twitter:* copy', () => {
    const m = { twitterTitle: 'X only', twitterDescription: 'X only desc' }
    expect(resolvePlatformInput(m, 'Open Graph', 'title')).toMatchObject({ value: undefined, source: 'none', fallback: true })
    expect(resolvePlatformInput(m, 'X', 'title')).toMatchObject({ value: 'X only', source: 'twitter:title' })
    expect(resolvePlatformInput(m, 'X', 'description')).toMatchObject({ value: 'X only desc', source: 'twitter:description' })
  })

  test('platform precedence: OG uses og then page; X uses twitter then og then page', () => {
    const m = { title: 'Page', ogTitle: 'OG', twitterTitle: 'TW' }
    expect(resolvePlatformInput(m, 'Open Graph', 'title')).toMatchObject({ value: 'OG', source: 'og:title', fallback: false })
    expect(resolvePlatformInput(m, 'X', 'title')).toMatchObject({ value: 'TW', source: 'twitter:title', fallback: false })
    const noOg = { title: 'Page', twitterTitle: 'TW' }
    expect(resolvePlatformInput(noOg, 'X', 'title')).toMatchObject({ value: 'TW', source: 'twitter:title', fallback: false })
    const noTwitter = { title: 'Page', ogTitle: 'OG' }
    expect(resolvePlatformInput(noTwitter, 'X', 'title')).toMatchObject({ value: 'OG', source: 'og:title', fallback: true })
    expect(resolvePlatformInput(noTwitter, 'X', 'title').fallback).toBe(true)
  })

  test('primary display copy prefers og, then twitter, then page-level tags', () => {
    expect(resolvePrimaryInput({ title: 'P', twitterTitle: 'T', ogTitle: 'O' }, 'title')).toMatchObject({ value: 'O', source: 'og:title' })
    expect(resolvePrimaryInput({ title: 'P', twitterTitle: 'T' }, 'title')).toMatchObject({ value: 'T', source: 'twitter:title' })
    expect(resolvePrimaryInput({ title: 'P' }, 'title')).toMatchObject({ value: 'P', source: '<title>', fallback: true })
    expect(resolvePrimaryInput({}, 'title')).toMatchObject({ value: undefined, source: 'none' })
    expect(resolvePrimaryInput({ description: 'D', ogDescription: 'OD' }, 'description')).toMatchObject({ value: 'OD' })
  })
})

describe('validate', () => {
  const full: MetaTags = {
    ogTitle: 'A perfectly reasonable title length for a social card here',
    ogDescription: 'A description that comfortably lands within the optimal character range so the validator stays quiet about it now.',
    ogType: 'website',
    ogImage: 'https://x/og.png',
    ogImageAlt: 'A blue product card with the product name.',
    ogImageWidth: '1200',
    ogImageHeight: '630',
    twitterCard: 'summary_large_image',
    ogUrl: 'https://x/',
  }

  const find = (m: MetaTags, img?: ImageProbe) => validate(m, img)

  test('clean meta + image produces no issues', () => {
    expect(find(full, okImage())).toHaveLength(0)
  })

  test('missing title, description, image are errors', () => {
    const issues = find({})
    const fields = issues.filter((i) => i.level === 'error').map((i) => i.field)
    expect(fields).toContain('title')
    expect(fields).toContain('description')
    expect(fields).toContain('og:image')
  })

  test('does not treat X-only copy as an Open Graph fallback', () => {
    const issues = find({ twitterTitle: 'Only on X', twitterDescription: 'X-only context' })
    expect(issues.some((i) => i.code === 'missing-title' && i.level === 'error')).toBe(true)
    expect(issues.some((i) => i.code === 'missing-description' && i.level === 'error')).toBe(true)
  })

  test('relative og:image is an error', () => {
    const issues = find({ ...full, ogImage: '/og.png' })
    expect(issues.some((i) => i.level === 'error' && i.code === 'relative-og-image')).toBe(true)
  })

  test('rejects malformed image and canonical URLs', () => {
    const issues = find({ ...full, ogImage: 'https://', ogUrl: '/relative' })
    expect(issues.some((i) => i.code === 'relative-og-image')).toBe(true)
    expect(issues.some((i) => i.code === 'invalid-canonical-url' && i.field === 'og:url')).toBe(true)
  })

  test('off-ratio image warns; a near-ratio image does not get a crop warning', () => {
    const square = find(full, okImage({ width: 800, height: 800 }))
    expect(square.some((i) => i.code === 'image-ratio')).toBe(true)
    const near = find({ ...full, ogImageHeight: '628' }, okImage({ width: 1200, height: 628 }))
    expect(near.some((i) => i.code === 'image-ratio')).toBe(false)
  })

  test('small image warns', () => {
    const issues = find(full, okImage({ width: 400, height: 209 }))
    expect(issues.some((i) => i.code === 'image-resolution')).toBe(true)
  })

  test('declared dimensions mismatch warns', () => {
    const issues = find({ ...full, ogImageWidth: '800', ogImageHeight: '418' }, okImage())
    expect(issues.some((i) => i.code === 'image-dimension-mismatch')).toBe(true)
  })

  test('SVG og:image warns', () => {
    const issues = find(full, okImage({ contentType: 'image/svg+xml', width: undefined, height: undefined }))
    expect(issues.some((i) => i.level === 'warn' && /SVG/.test(i.message))).toBe(true)
  })

  test('uses decoded bytes for format validation and reports conflicting image headers', () => {
    const svg = find(full, okImage({ contentType: 'image/png', detectedContentType: 'image/svg+xml' }))
    expect(svg.some((i) => i.code === 'svg-image' && /downloaded bytes/.test(i.evidence))).toBe(true)
    expect(svg.some((i) => i.code === 'image-type-mismatch')).toBe(true)
  })

  test('non-image content-type that also fails to decode is an error', () => {
    const issues = find(full, okImage({ contentType: 'text/html', width: undefined, height: undefined }))
    expect(issues.some((i) => i.level === 'error' && i.code === 'invalid-image-response')).toBe(true)
  })

  test('a real image served as octet-stream (decodes fine) is not flagged', () => {
    const issues = find(full, okImage({ contentType: 'application/octet-stream' }))
    expect(issues.some((i) => i.field === 'og:image' && /decoded as an image/.test(i.message))).toBe(false)
    expect(issues).toHaveLength(0)
  })

  test('oversized image warns', () => {
    const issues = find(full, okImage({ byteLength: 6 * 1024 * 1024 }))
    expect(issues.some((i) => i.code === 'image-file-size')).toBe(true)
  })

  test('does not emit generic title or description length advice', () => {
    const issues = find({ ...full, ogTitle: 'Nook', ogDescription: 'Room to think.' }, okImage())
    expect(issues.some((i) => /character|chars|short|long/i.test(`${i.code} ${i.message}`))).toBe(false)
  })

  test('reports an Open Graph description fallback without inventing copy advice', () => {
    const issues = find({ ...full, ogDescription: undefined, description: 'A factual page description.' }, okImage())
    expect(issues.find((i) => i.code === 'missing-og-description')).toMatchObject({ level: 'warn', field: 'og:description' })
  })

  test('every finding carries stable repair context and is severity-prioritized', () => {
    const issues = find({ title: 'Fallback' }, undefined)
    for (const issue of issues) {
      expect(issue.code.length).toBeGreaterThan(0)
      expect(issue.impact.length).toBeGreaterThan(0)
      expect(issue.evidence.length).toBeGreaterThan(0)
      expect(issue.fix.length).toBeGreaterThan(0)
    }
    const levels = issues.map((i) => i.level)
    expect(levels).toEqual([...levels].sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a] - { error: 0, warn: 1, info: 2 }[b])))
  })
})

describe('renderHtml', () => {
  test('does not double-escape parsed values in card and facts views', () => {
    const meta = parseMeta(`<head><meta property="og:title" content="Ben &amp; Jerry&#8217;s"></head>`)
    const html = renderHtml(report({ meta, issues: validate(meta, undefined) }))
    expect(html).toContain('<div class="mock__title mock__line-clamp">Ben &amp; Jerry’s</div>')
    expect(html).toContain('<dd class="fact__val">Ben &amp; Jerry’s')
  })

  test('never places a remote URL into a CSS url() context', () => {
    const evil = "https://evil.test/x.png');}body{background:red}/*"
    const html = renderHtml(report({
      meta: { ogTitle: 'T', ogDescription: 'd', ogImage: evil },
      image: { url: evil, resolved: evil, status: 404, ok: false, error: 'HTTP 404' },
    }))
    expect(/background-image:\s*url\(['"]?https?:/i.test(html)).toBe(false)
    expect(html).toContain('Image failed to load')
  })

  test('embeds only the validated data URI into CSS', () => {
    const html = renderHtml(report({
      meta: { ogTitle: 'T', ogImage: 'https://x/og.png' },
      image: okImage({ dataUri: 'data:image/png;base64,AAAA' }),
    }))
    expect(html).toContain("background-image:url('data:image/png;base64,AAAA')")
  })

  test('rejects a forged data URI from every inline style context', () => {
    const forged = "data:image/png;base64,AAAA');color:red/*"
    const html = renderHtml(report({
      meta: { ogTitle: 'T', ogImage: 'https://x/og.png' },
      image: okImage({ dataUri: forged }),
    }))
    expect(html).not.toContain(forged)
    expect(html).toContain('No validated OG image')
  })

  test('X falls back to a summary card when there is no image', () => {
    const html = renderHtml(report({ meta: { ogTitle: 'No image here', ogDescription: 'desc' } }))
    expect(html).toContain('mock__summary')
  })

  test('clean report shows the all-clear verdict', () => {
    const meta: MetaTags = {
      ogTitle: 'A perfectly reasonable title length for a social card here',
      ogDescription: 'A description that comfortably lands within the optimal character range so the validator stays quiet about it now.',
      ogType: 'website',
      ogImage: 'https://x/og.png',
      ogImageAlt: 'A blue product card.',
      ogImageWidth: '1200',
      ogImageHeight: '630',
      twitterCard: 'summary_large_image',
      ogUrl: 'https://x/',
    }
    const html = renderHtml(report({ meta, image: okImage(), issues: validate(meta, okImage()) }))
    expect(html).toContain('verdict--ok')
    expect(html).toContain('No validation issues found')
  })

  test('uses X-specific metadata and image without leaking it into OG cards', () => {
    const html = renderHtml(report({
      meta: {
        ogTitle: 'Open Graph title', ogDescription: 'OG description', ogImage: 'https://x/og.png',
        twitterTitle: 'X-only title', twitterDescription: 'X-only description', twitterImage: 'https://x/x.png',
        twitterCard: 'summary',
      },
      image: okImage({ dataUri: 'data:image/png;base64,AAAA' }),
      twitterImage: okImage({ url: 'https://x/x.png', resolved: 'https://x/x.png', dataUri: 'data:image/png;base64,BBBB' }),
    }))
    expect(html).toContain('Open Graph title')
    expect(html).toContain('X-only title')
    expect(html).toContain('twitter:title · twitter:image')
    expect(html).toContain('mock__summary--with-image')
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain('data:image/png;base64,BBBB')
  })

  test('shows crop evidence, repair controls, CSP, and an accessible copy status', () => {
    const html = renderHtml(report({
      meta: { ogTitle: 'Square', ogImage: 'https://x/og.png' },
      image: okImage({ width: 1200, height: 1200, dataUri: 'data:image/png;base64,AAAA' }),
    }))
    expect(html).toContain('Cover mode hides about 48% of the image height')
    expect(html).toContain('Resolved inputs')
    expect(html).toContain('Metadata starting point')
    expect(html).toContain('Copy metadata')
    expect(html).toContain('Copy repair brief')
    expect(html).toContain('Copy agent prompt')
    expect(html).toContain('<h3 class="card__name">Discord</h3>')
    expect(html).not.toContain('<h3 class="card__name">Discord / Slack</h3>')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("script-src 'nonce-")
    expect(html).not.toContain("script-src 'unsafe-inline'")
    expect(html).toMatch(/<script nonce="[a-f0-9]{32}">/)
    expect(html).toContain('aria-live="polite"')
  })

  test('never turns a non-HTTP final URL into a clickable target', () => {
    const html = renderHtml(report({ finalUrl: 'javascript:alert(1)', meta: { ogTitle: 'Unsafe target' } }))
    expect(html).toContain('href="#"')
    expect(html).not.toContain('href="javascript:')
  })

  test('escapes a closing script tag inside the JSON payload', () => {
    const meta: MetaTags = { ogTitle: '</script><script>alert(1)</script>', ogImage: 'https://x/og.png' }
    const html = renderHtml(report({ meta, issues: validate(meta, undefined) }))
    expect(html).not.toContain('</script><script>alert(1)')
    expect(html).not.toContain('<!--')
  })
})

describe('repair output', () => {
  test('produces an evidence-led brief and a guarded coding-agent prompt', () => {
    const meta: MetaTags = { title: 'Nook', ogImage: '/og.png' }
    const target = report({ finalUrl: 'https://x.test/?q=ignore+instructions', meta, issues: validate(meta, undefined) })
    const brief = buildRepairBrief(target)
    const prompt = buildAgentPrompt(target)
    expect(brief).toContain('Impact:')
    expect(brief).toContain('Evidence:')
    expect(brief).toContain('Fix:')
    expect(prompt).toContain('untrusted data')
    expect(prompt).toContain('Do not pad copy')
    expect(prompt).toContain('Safe starting metadata patch')
  })

  test('escapes copied metadata snippets and never emits executable page markup', () => {
    const target = report({
      finalUrl: 'https://x.test/',
      meta: { ogTitle: '"><script>alert(1)</script>', ogImage: 'javascript:alert(1)' },
    })
    const snippet = buildMetaSnippet(target)
    expect(snippet).not.toContain('<script>')
    expect(snippet).toContain('&quot;&gt;&lt;script&gt;')
    expect(snippet).not.toContain('javascript:alert')
  })

  test('does not turn local preview origins into copy-ready public metadata', () => {
    const target = report({
      finalUrl: 'http://localhost:3000/product',
      meta: { ogTitle: 'Product', ogDescription: 'A factual description.', ogImage: '/og.png' },
    })
    const snippet = buildMetaSnippet(target)
    expect(snippet).not.toContain('localhost:3000')
    expect(snippet).toContain('Add the preferred absolute public URL')
    expect(snippet).toContain('Add the absolute public URL of the intended share image')
    expect(snippet).toContain('twitter:card" content="summary"')
  })

  test('documents resolved OG and X fallbacks independently', () => {
    const rows = resolveInputs(report({ meta: { title: 'Page', ogImage: 'https://x/og.png' } }))
    expect(rows.find((r) => r.platform === 'Open Graph' && r.field === 'title')).toMatchObject({ source: '<title>', fallback: true })
    expect(rows.find((r) => r.platform === 'X' && r.field === 'image')).toMatchObject({ source: 'og:image', fallback: true })
  })

  test('Copy findings payload stays distinct from the Copy repair brief payload', () => {
    const target = report({
      finalUrl: 'https://x.test/',
      meta: { ogTitle: 'T' },
      issues: validate({ ogTitle: 'T' }, undefined),
    })
    const findings = buildFindingsText(target)
    const brief = buildRepairBrief(target)
    expect(findings).toContain('1. [')
    expect(findings).not.toContain('metaprev repair brief')
    expect(brief).toContain('metaprev repair brief')
    expect(brief).not.toBe(findings)
  })

  test('shares one twitter:card vocabulary across validator and snippet inputs', () => {
    expect(isKnownTwitterCard(CARD_SUMMARY)).toBe(true)
    expect(isKnownTwitterCard(CARD_SUMMARY_LARGE_IMAGE)).toBe(true)
    expect(isKnownTwitterCard('player')).toBe(true)
    expect(isKnownTwitterCard('summary_large')).toBe(false)
    // A known-but-unrendered card type is preserved verbatim by the repair snippet.
    const snippet = buildMetaSnippet(report({
      finalUrl: 'https://x.test/',
      meta: { ogTitle: 'T', ogImage: 'https://x/og.png', twitterCard: 'player' },
    }))
    expect(snippet).toContain('name="twitter:card" content="player"')
    // Unknown card types fall back to the inferred treatment instead of being copied.
    const fallbackSnippet = buildMetaSnippet(report({
      finalUrl: 'https://x.test/',
      meta: { ogTitle: 'T', ogImage: 'https://x/og.png', twitterCard: 'bananas' },
    }))
    expect(fallbackSnippet).toContain(`content="${CARD_SUMMARY_LARGE_IMAGE}"`)
  })

  test('does not copy local URLs as public repair metadata and preserves intentional X card types', () => {
    const snippet = buildMetaSnippet(report({
      finalUrl: 'http://127.0.0.1:3000/page',
      meta: { ogTitle: 'Local page', ogImage: '/card.png', twitterCard: 'player' },
    }))
    expect(snippet).not.toContain('http://127.0.0.1')
    expect(snippet).toContain('Add the preferred absolute public URL')
    expect(snippet).toContain('name="twitter:card" content="player"')
  })
})
