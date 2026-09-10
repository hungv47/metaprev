import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { fetchPage, probeImage } from '../src/fetch.ts'

let server: ReturnType<typeof Bun.serve>
let base = ''
let ogRequests = 0
let xRequests = 0

function pngHeader(width: number, height: number): ArrayBuffer {
  const bytes = Buffer.alloc(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function cleanHtml(): string {
  return `<!doctype html><html><head>
    <title>Fallback title</title>
    <meta property="og:type" content="website">
    <meta property="og:title" content="A concise product title">
    <meta property="og:description" content="A factual description that does not need padding to satisfy an arbitrary count.">
    <meta property="og:url" content="${base}/clean">
    <meta property="og:image" content="${base}/og.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="A blue product card">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="${base}/x.png">
  </head><body></body></html>`
}

async function runCli(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, 'bin/metaprev.ts', ...args], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      if (path === '/clean') return new Response(cleanHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } })
      if (path === '/broken') return new Response('<title>Only a title</title>', { headers: { 'content-type': 'text/html' } })
      if (path === '/large-broken') {
        const title = 'x'.repeat(200_000)
        return new Response(`<meta property="og:title" content="${title}"><meta property="og:description" content="Description">`, {
          headers: { 'content-type': 'text/html' },
        })
      }
      if (path === '/not-html') return new Response('{}', { headers: { 'content-type': 'application/json' } })
      if (path === '/og.png') {
        ogRequests++
        return new Response(pngHeader(1200, 630), { headers: { 'content-type': 'application/octet-stream' } })
      }
      if (path === '/x.png') {
        xRequests++
        return new Response(pngHeader(1200, 630), { headers: { 'content-type': 'image/png' } })
      }
      if (path === '/card.svg') {
        return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"></svg>', { headers: { 'content-type': 'image/svg+xml' } })
      }
      return new Response('not found', { status: 404 })
    },
  })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(() => server.stop(true))

describe('CLI compatibility', () => {
  test('preserves exits 0 for clean, 1 for findings, and 2 for fetch/runtime failure', async () => {
    const clean = await runCli('issues', `${base}/clean`, '--json')
    expect(clean.exitCode).toBe(0)
    expect(JSON.parse(clean.stdout)).toEqual([])

    const broken = await runCli('issues', `${base}/broken`, '--json')
    expect(broken.exitCode).toBe(1)
    expect(JSON.parse(broken.stdout).some((issue: { code: string }) => issue.code === 'missing-og-image')).toBe(true)

    const fullJsonBroken = await runCli(`${base}/broken`, '--json')
    expect(fullJsonBroken.exitCode).toBe(1)
    expect(JSON.parse(fullJsonBroken.stdout).issues.some((issue: { level: string }) => issue.level === 'error')).toBe(true)

    const failed = await runCli(`${base}/not-html`, '--json')
    expect(failed.exitCode).toBe(2)
    expect(failed.stderr).toContain('not HTML')
  }, 15_000)

  test('keeps facts/JSON on one image probe and omits embedded bytes', async () => {
    ogRequests = 0
    xRequests = 0
    const result = await runCli('facts', `${base}/clean`, '--json')
    const facts = JSON.parse(result.stdout)
    expect(result.exitCode).toBe(0)
    expect(facts).toMatchObject({ status: 200, image: { width: 1200, height: 630, detectedContentType: 'image/png' } })
    expect(facts.image.dataUri).toBeUndefined()
    expect(ogRequests).toBe(1)
    expect(xRequests).toBe(0)
  }, 15_000)

  test('flushes large JSON reports before returning a non-zero CI exit', async () => {
    const result = await runCli(`${base}/large-broken`, '--json')
    expect(result.exitCode).toBe(1)
    expect(result.stdout.length).toBeGreaterThan(200_000)
    const report = JSON.parse(result.stdout)
    expect(report.meta.ogTitle).toHaveLength(200_000)
    expect(report.issues.some((issue: { code: string }) => issue.code === 'missing-og-image')).toBe(true)
  }, 15_000)

  test('fails unknown flags as a usage error with exit 2', async () => {
    const result = await runCli('issues', `${base}/clean`, '--no-such-flag')
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("unknown option '--no-such-flag'")
    expect(result.stderr).toContain('--help')
  }, 15_000)

  test('facts stays exempt from the findings exit code (diagnostic dump exits 0)', async () => {
    const facts = await runCli('facts', `${base}/broken`)
    // /broken has error-level findings, yet the facts dump is pipeline-friendly.
    expect(facts.exitCode).toBe(0)
    expect(facts.stdout).toContain('title')
    const issues = await runCli('issues', `${base}/broken`)
    expect(issues.exitCode).toBe(1)
  }, 15_000)
})

describe('fetch hardening', () => {
  test('rejects non-HTTP page protocols before fetching them', async () => {
    expect(fetchPage('file:///etc/passwd')).rejects.toThrow('Page URL must use HTTP or HTTPS')
  })

  test('rejects a successful non-HTML page response', async () => {
    expect(fetchPage(`${base}/not-html`)).rejects.toThrow('not HTML')
  })

  test('uses detected bytes, not an unsafe response MIME, for embedded images', async () => {
    const image = await probeImage(`${base}/og.png`, `${base}/clean`, { withDataUri: true })
    expect(image.contentType).toBe('application/octet-stream')
    expect(image.detectedContentType).toBe('image/png')
    expect(image.dataUri).toStartWith('data:image/png;base64,')

    const svg = await probeImage(`${base}/card.svg`, `${base}/clean`, { withDataUri: true })
    expect(svg.detectedContentType).toBe('image/svg+xml')
    expect(svg.dataUri).toBeUndefined()
  })

  test('rejects non-HTTP image protocols before fetching them', async () => {
    const image = await probeImage('file:///etc/passwd', `${base}/clean`, { withDataUri: true })
    expect(image).toMatchObject({ ok: false, status: 0, error: 'Image URL must use HTTP or HTTPS' })
    expect(image.dataUri).toBeUndefined()
  })
})
