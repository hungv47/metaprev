import type { MetaTags } from './types.ts'

// ── twitter:card vocabulary ───────────────────────────────────────────────
// Shared by the validator, the repair snippet, and the renderer so the set of
// known card treatments lives in exactly one place.

export const CARD_SUMMARY = 'summary'
export const CARD_SUMMARY_LARGE_IMAGE = 'summary_large_image'
/** Card types X documents for twitter:card. */
export const KNOWN_TWITTER_CARDS = [CARD_SUMMARY, CARD_SUMMARY_LARGE_IMAGE, 'app', 'player'] as const
/** Card treatments this workspace renders faithfully. */
export const RENDERED_TWITTER_CARDS: ReadonlySet<string> = new Set([CARD_SUMMARY, CARD_SUMMARY_LARGE_IMAGE])

export function isKnownTwitterCard(value: string): boolean {
  return (KNOWN_TWITTER_CARDS as readonly string[]).includes(value)
}

// ── canonical input fallback policy ───────────────────────────────────────
// One precedence ladder per surface; CLI output, HTML render, and repair text
// all resolve through these helpers.

export type PlatformName = 'Open Graph' | 'X'
export type TextField = 'title' | 'description'
export type InputSource =
  | 'og:title' | 'twitter:title' | '<title>' | 'none'
  | 'og:description' | 'twitter:description' | 'meta description'

export type ResolvedInputValue = {
  value?: string
  source: InputSource
  /** True when the winning source is a fallback rather than the platform's own tag. */
  fallback: boolean
}

const TITLE_SOURCES: Record<PlatformName, Array<{ key: keyof MetaTags; source: InputSource }>> = {
  // Open Graph consumers do not read twitter:* copy as a fallback.
  'Open Graph': [{ key: 'ogTitle', source: 'og:title' }, { key: 'title', source: '<title>' }],
  X: [
    { key: 'twitterTitle', source: 'twitter:title' },
    { key: 'ogTitle', source: 'og:title' },
    { key: 'title', source: '<title>' },
  ],
}

const DESCRIPTION_SOURCES: Record<PlatformName, Array<{ key: keyof MetaTags; source: InputSource }>> = {
  'Open Graph': [{ key: 'ogDescription', source: 'og:description' }, { key: 'description', source: 'meta description' }],
  X: [
    { key: 'twitterDescription', source: 'twitter:description' },
    { key: 'ogDescription', source: 'og:description' },
    { key: 'description', source: 'meta description' },
  ],
}

function resolveFrom(m: MetaTags, ladder: Array<{ key: keyof MetaTags; source: InputSource }>): ResolvedInputValue {
  for (const step of ladder) {
    const value = m[step.key]
    if (value) return { value, source: step.source, fallback: step.source !== ladder[0]!.source }
  }
  return { value: undefined, source: 'none', fallback: true }
}

export function resolvePlatformInput(m: MetaTags, platform: PlatformName, field: TextField): ResolvedInputValue {
  return field === 'title'
    ? resolveFrom(m, TITLE_SOURCES[platform])
    : resolveFrom(m, DESCRIPTION_SOURCES[platform])
}

/**
 * Primary share copy shown at the top of terminal/facts/report output and used
 * as the starting value in the repair snippet: the protocol's own og:* value
 * first, then X-specific copy, then the page-level tag.
 */
const PRIMARY_TITLE_LADDER: Array<{ key: keyof MetaTags; source: InputSource }> = [
  { key: 'ogTitle', source: 'og:title' },
  { key: 'twitterTitle', source: 'twitter:title' },
  { key: 'title', source: '<title>' },
]

const PRIMARY_DESCRIPTION_LADDER: Array<{ key: keyof MetaTags; source: InputSource }> = [
  { key: 'ogDescription', source: 'og:description' },
  { key: 'twitterDescription', source: 'twitter:description' },
  { key: 'description', source: 'meta description' },
]

/**
 * Primary share copy shown at the top of terminal/facts/report output and used
 * as the starting value in the repair snippet: the protocol's own og:* value
 * first, then X-specific copy, then the page-level tag.
 */
export function resolvePrimaryInput(m: MetaTags, field: TextField): ResolvedInputValue {
  return field === 'title'
    ? resolveFrom(m, PRIMARY_TITLE_LADDER)
    : resolveFrom(m, PRIMARY_DESCRIPTION_LADDER)
}
