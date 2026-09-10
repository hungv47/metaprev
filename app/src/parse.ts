import type { MetaTags } from './types.ts'

const META_RE = /<meta\s+([^>]+?)\/?>/gi
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i
const LINK_RE = /<link\s+([^>]+?)\/?>/gi

const ATTR_RE = /(\w[\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  let m: RegExpExecArray | null
  ATTR_RE.lastIndex = 0
  while ((m = ATTR_RE.exec(raw)) !== null) {
    const key = m[1]?.toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    if (key) out[key] = decodeEntities(value).trim()
  }
  return out
}

// Curated named entities common in titles/descriptions. HTML defines ~2100 named
// refs; shipping the full table isn't worth the bytes for a meta-tag parser, so this
// covers punctuation and symbols that actually show up in og:* content. Numeric
// refs (decimal + hex) are handled generally below.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', minus: '−',
  lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  bull: '•', middot: '·', dagger: '†', Dagger: '‡',
  deg: '°', plusmn: '±', times: '×', divide: '÷',
  euro: '€', pound: '£', cent: '¢', yen: '¥',
  sect: '§', para: '¶', permil: '‰',
  frac12: '½', frac14: '¼', frac34: '¾',
  hearts: '♥', star: '★',
}

const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi

function decodeEntities(s: string): string {
  if (!s || s.indexOf('&') === -1) return s
  return s.replace(ENTITY_RE, (match, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      // Skip NUL, out-of-range, and invalid code points; leave the raw text intact.
      if (!Number.isFinite(cp) || cp < 1 || cp > 0x10ffff) return match
      try {
        return String.fromCodePoint(cp)
      } catch {
        return match
      }
    }
    // Named refs are case-sensitive in HTML; fall back to the lowercase form so
    // `&AMP;` / `&Amp;` still resolve for the common entities. Use hasOwn so names
    // that collide with Object.prototype members (constructor, toString, valueOf, …)
    // don't resolve up the prototype chain and corrupt the text.
    if (Object.hasOwn(NAMED_ENTITIES, body)) return NAMED_ENTITIES[body]!
    const lower = body.toLowerCase()
    if (Object.hasOwn(NAMED_ENTITIES, lower)) return NAMED_ENTITIES[lower]!
    return match
  })
}

export function parseMeta(html: string): MetaTags {
  const head = extractHead(html)
  const tags: MetaTags = {}
  // Open Graph arrays attach structured properties to the root image they follow.
  // metaprev previews the first image, so later images' dimensions/alt must never
  // overwrite the selected image's evidence.
  let selectedOgImageIsActive = false
  let pendingStructured: Record<string, string> = {}

  const titleMatch = TITLE_RE.exec(head)
  if (titleMatch?.[1]) tags.title = decodeEntities(titleMatch[1].trim())

  const selectImage = (content: string): void => {
    if (!tags.ogImage) {
      tags.ogImage = content
      selectedOgImageIsActive = true
      // Structured props declared before the first root tag belong to it; attach them now.
      for (const [key, value] of Object.entries(pendingStructured)) assign(tags, key, value)
      pendingStructured = {}
    } else {
      // A second root tag starts a new group the preview does not use.
      selectedOgImageIsActive = false
      pendingStructured = {}
    }
  }

  let m: RegExpExecArray | null
  META_RE.lastIndex = 0
  while ((m = META_RE.exec(head)) !== null) {
    const a = attrs(m[1] ?? '')
    const key = (a['property'] ?? a['name'] ?? '').toLowerCase()
    const content = a['content']
    if (!key || content === undefined) continue
    if (key === 'og:image') {
      selectImage(content)
      continue
    }
    if (key === 'og:image:url' || key === 'og:image:secure_url') {
      selectImage(content)
      continue
    }
    if (key === 'og:image:width' || key === 'og:image:height' || key === 'og:image:alt') {
      if (selectedOgImageIsActive) assign(tags, key, content)
      else if (!tags.ogImage) pendingStructured[key] ??= content
      continue
    }
    assign(tags, key, content)
  }

  LINK_RE.lastIndex = 0
  while ((m = LINK_RE.exec(head)) !== null) {
    const a = attrs(m[1] ?? '')
    const rels = (a['rel'] ?? '').toLowerCase().split(/\s+/)
    if (rels.includes('canonical') && a['href']) {
      tags.canonical ??= a['href']
    }
  }

  return tags
}

function extractHead(html: string): string {
  const match = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)
  return match?.[1] ?? html
}

function assign(tags: MetaTags, key: string, value: string): void {
  switch (key) {
    case 'description':
      tags.description ??= value
      break
    case 'og:site_name':
      tags.ogSiteName = value
      break
    case 'og:type':
      tags.ogType = value
      break
    case 'og:title':
      tags.ogTitle = value
      break
    case 'og:description':
      tags.ogDescription = value
      break
    case 'og:url':
      tags.ogUrl = value
      break
    case 'og:image:width':
      tags.ogImageWidth = value
      break
    case 'og:image:height':
      tags.ogImageHeight = value
      break
    case 'og:image:alt':
      tags.ogImageAlt = value
      break
    case 'twitter:card':
      tags.twitterCard = value
      break
    case 'twitter:site':
      tags.twitterSite = value
      break
    case 'twitter:title':
      tags.twitterTitle = value
      break
    case 'twitter:description':
      tags.twitterDescription = value
      break
    case 'twitter:image':
    case 'twitter:image:src':
      tags.twitterImage ??= value
      break
    case 'twitter:image:alt':
      tags.twitterImageAlt = value
      break
  }
}
