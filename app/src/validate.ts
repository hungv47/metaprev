import { CARD_SUMMARY, CARD_SUMMARY_LARGE_IMAGE, isKnownTwitterCard, RENDERED_TWITTER_CARDS } from './inputs.ts'
import type { ImageProbe, Issue, MetaTags } from './types.ts'

const TARGET = { width: 1200, height: 630, ratio: 1200 / 630 } as const
const RATIO_TOLERANCE = 0.02
const LINKEDIN_IMAGE_MAX_BYTES = 5 * 1024 * 1024

type Finding = Pick<Issue, 'level' | 'code' | 'field' | 'message' | 'impact' | 'evidence' | 'fix'>

function finding(value: Finding): Issue {
  return value
}

function probeEvidence(image: ImageProbe): string {
  if (image.status > 0) return `The image request returned HTTP ${image.status}.`
  const error = image.error?.replace(/[\r\n\t]+/g, ' ').slice(0, 180)
  return error ? `The image probe failed: ${error}.` : 'The image probe did not receive a response.'
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function validate(meta: MetaTags, image: ImageProbe | undefined): Issue[] {
  const issues: Issue[] = []
  // Open Graph consumers do not generally use twitter:* as a fallback. Validate the
  // shared OG/page path independently; the X card resolves its own overrides in render.
  const title = meta.ogTitle ?? meta.title
  const description = meta.ogDescription ?? meta.description

  if (!title) issues.push(finding({
    level: 'error', code: 'missing-title', field: 'title', message: 'No share title was found.',
    impact: 'The card can render without a useful headline or use an unpredictable platform fallback.',
    evidence: meta.twitterTitle
      ? 'twitter:title exists for X, but neither og:title nor <title> is present for Open Graph consumers.'
      : 'Neither og:title nor <title> is present in the fetched HTML.',
    fix: 'Add a truthful og:title. Also set twitter:title only when X needs different copy.',
  }))
  else if (!meta.ogTitle) issues.push(finding({
    level: 'warn', code: 'missing-og-title', field: 'og:title', message: 'The Open Graph title is missing.',
    impact: 'Consumers that do not use page-title or X-tag fallbacks can omit the intended headline.',
    evidence: 'The preview falls back to <title>; the Open Graph protocol lists og:title as required metadata.',
    fix: 'Add og:title with the existing truthful share title.',
  }))

  if (!description) issues.push(finding({
    level: 'error', code: 'missing-description', field: 'description', message: 'No share description was found.',
    impact: 'Cards that show supporting copy will have no context below the title.',
    evidence: meta.twitterDescription
      ? 'twitter:description exists for X, but neither og:description nor meta description is present for Open Graph consumers.'
      : 'Neither og:description nor meta description is present in the fetched HTML.',
    fix: 'Add a concise, factual og:description. Do not pad it to meet an arbitrary character target.',
  }))
  else if (!meta.ogDescription) issues.push(finding({
    level: 'warn', code: 'missing-og-description', field: 'og:description', message: 'The Open Graph description is missing.',
    impact: 'LinkedIn and other Open Graph consumers may omit the supporting copy instead of using a page or X fallback.',
    evidence: 'The preview falls back to meta description; LinkedIn lists og:description among the tags that must exist for a share preview.',
    fix: 'Add og:description with the existing concise, factual description.',
  }))

  if (!meta.ogImage) issues.push(finding({
    level: 'error', code: 'missing-og-image', field: 'og:image', message: 'No og:image meta tag was found.',
    impact: 'Facebook, LinkedIn, and chat unfurls can render without a large visual or choose an unrelated fallback.',
    evidence: 'The fetched HTML has no og:image value.',
    fix: 'Add an absolute HTTPS og:image URL for the intended share asset.',
  }))
  else if (!isAbsoluteHttpUrl(meta.ogImage)) issues.push(finding({
    level: 'error', code: 'relative-og-image', field: 'og:image', message: 'og:image is not an absolute HTTP(S) URL.',
    impact: 'A crawler that fetches the image independently may fail to resolve it, leaving the card blank.',
    evidence: 'The og:image value does not begin with http:// or https://.',
    fix: 'Resolve the asset against the public site origin and emit the full URL in og:image.',
  }))

  if (image && !image.ok) issues.push(finding({
    level: 'error', code: 'image-unreachable', field: 'og:image', message: 'The selected share image did not load.',
    impact: 'Crawlers cannot render the intended image, so the card will be blank or fall back.',
    evidence: probeEvidence(image),
    fix: 'Make the image URL publicly reachable with a 2xx response, then rerun metaprev.',
  }))

  if (image?.ok) {
    const contentType = (image.contentType?.split(';')[0] ?? '').trim().toLowerCase()
    const detectedType = image.detectedContentType?.toLowerCase()
    const effectiveType = detectedType ?? contentType
    const decoded = Boolean(image.width && image.height)
    if (effectiveType === 'image/svg+xml') issues.push(finding({
      level: 'warn', code: 'svg-image', field: 'og:image', message: 'The share image is SVG.',
      impact: 'LinkedIn does not list SVG among the formats supported by its sharing module, so rendering is not dependable.',
      evidence: detectedType === 'image/svg+xml'
        ? 'The downloaded bytes decode as SVG.'
        : 'The image response content type is image/svg+xml.',
      fix: 'Export the asset as PNG or JPEG and update og:image to that file.',
    }))
    else if (!decoded) issues.push(finding({
      level: 'error', code: 'invalid-image-response', field: 'og:image', message: 'The og:image response is not a decodable image.',
      impact: 'Platforms receive a document or error body instead of an image and cannot build the visual card.',
      evidence: `The response${contentType ? ` content type is ${contentType} and it` : ''} has no supported image dimensions.`,
      fix: 'Point og:image at the image file itself and serve it with an image content type.',
    }))

    if (detectedType && contentType.startsWith('image/') && detectedType !== contentType) issues.push(finding({
      level: 'warn', code: 'image-type-mismatch', field: 'og:image', message: 'The image response type does not match its bytes.',
      impact: 'Crawlers that trust the response header can handle the asset differently from clients that sniff its contents.',
      evidence: `The response declares ${contentType}, but the downloaded bytes decode as ${detectedType}.`,
      fix: `Serve the asset with Content-Type: ${detectedType}.`,
    }))

    if (image.width && image.height) {
      const ratio = image.width / image.height
      if (Math.abs(ratio - TARGET.ratio) / TARGET.ratio > RATIO_TOLERANCE) issues.push(finding({
        level: 'warn', code: 'image-ratio', field: 'og:image', message: 'The image does not match the 1.91:1 share frame.',
        impact: 'Depending on the platform and viewport, the asset can be cropped or padded.',
        evidence: `The decoded asset is ${image.width}×${image.height}px (${ratio.toFixed(2)}:1); the workspace frame is 1.91:1.`,
        fix: `Export a ${TARGET.width}×${TARGET.height}px version and keep important content away from the edges.`,
      }))
      if (image.width < 1200 || image.height < 627) issues.push(finding({
        level: 'warn', code: 'image-resolution', field: 'og:image', message: 'The image is below the cross-platform high-resolution target.',
        impact: 'The card can look soft when enlarged, and the asset falls below LinkedIn’s published sharing-module dimensions.',
        evidence: `The decoded asset is ${image.width}×${image.height}px; LinkedIn lists 1200×627px for its sharing module.`,
        fix: `Export at least ${TARGET.width}×${TARGET.height}px without upscaling a low-resolution source.`,
      }))
    }

    if (image.byteLength != null && image.byteLength > LINKEDIN_IMAGE_MAX_BYTES) issues.push(finding({
      level: 'warn', code: 'image-file-size', field: 'og:image', message: 'The share image exceeds LinkedIn’s documented file-size limit.',
      impact: 'LinkedIn may omit the image even when another platform accepts it.',
      evidence: `The response is ${(image.byteLength / 1024 / 1024).toFixed(2)} MB; LinkedIn’s sharing module lists a 5 MB maximum.`,
      fix: 'Compress or simplify the image to 5 MB or less while preserving its dimensions.',
    }))
  }

  if (meta.ogImage && !meta.ogImageAlt) issues.push(finding({
    level: 'info', code: 'missing-image-alt', field: 'og:image:alt', message: 'The share image has no alternative text.',
    impact: 'People using assistive technology may not receive a useful description when a client exposes image alt text.',
    evidence: 'og:image exists, but og:image:alt is absent; the Open Graph protocol says an image should include it.',
    fix: 'Add og:image:alt that describes what is in the image, not marketing copy or a duplicate caption.',
  }))

  if (meta.ogImage && (!meta.ogImageWidth || !meta.ogImageHeight)) issues.push(finding({
    level: 'info', code: 'missing-image-dimensions', field: 'og:image', message: 'Declared image dimensions are missing.',
    impact: 'A crawler cannot know the image shape from metadata before downloading it.',
    evidence: 'og:image exists, but og:image:width or og:image:height is absent.',
    fix: 'Add og:image:width and og:image:height using the decoded asset dimensions.',
  }))

  if (image?.ok && image.width && image.height && meta.ogImageWidth && meta.ogImageHeight) {
    const validWidth = /^\d+$/.test(meta.ogImageWidth)
    const validHeight = /^\d+$/.test(meta.ogImageHeight)
    const declaredWidth = Number(meta.ogImageWidth)
    const declaredHeight = Number(meta.ogImageHeight)
    if (!validWidth || !validHeight || declaredWidth <= 0 || declaredHeight <= 0) issues.push(finding({
      level: 'warn', code: 'invalid-image-dimensions', field: 'og:image', message: 'Declared image dimensions are not positive integers.',
      impact: 'Crawlers may ignore the dimensions and choose a fallback layout.',
      evidence: 'At least one of og:image:width or og:image:height is not a positive whole number.',
      fix: `Set og:image:width to ${image.width} and og:image:height to ${image.height}.`,
    }))
    else if (declaredWidth !== image.width || declaredHeight !== image.height) issues.push(finding({
      level: 'warn', code: 'image-dimension-mismatch', field: 'og:image', message: 'Declared image dimensions do not match the fetched asset.',
      impact: 'A crawler can reserve the wrong frame before the image loads, causing a layout or crop mismatch.',
      evidence: `Metadata declares ${declaredWidth}×${declaredHeight}px; the decoded asset is ${image.width}×${image.height}px.`,
      fix: `Update the tags to ${image.width}×${image.height}, or replace the asset with the declared size.`,
    }))
  }

  if (!meta.twitterCard) issues.push(finding({
    level: 'info', code: 'missing-twitter-card', field: 'twitter:card', message: 'No twitter:card meta tag was found.',
    impact: 'X must infer a card treatment instead of following an explicit choice.',
    evidence: 'The fetched HTML has no twitter:card value.',
    fix: `Add twitter:card="${CARD_SUMMARY_LARGE_IMAGE}" for a wide image card, or "${CARD_SUMMARY}" for a compact card.`,
  }))
  else if (!isKnownTwitterCard(meta.twitterCard) || !RENDERED_TWITTER_CARDS.has(meta.twitterCard)) issues.push(finding({
    level: 'info', code: 'unusual-twitter-card', field: 'twitter:card', message: 'twitter:card uses an uncommon value.',
    impact: 'The X preview may not match either card treatment shown in this workspace.',
    evidence: 'The value is neither summary_large_image nor summary.',
    fix: 'Use summary_large_image or summary unless the page intentionally targets another supported card type.',
  }))

  const canonical = meta.ogUrl ?? meta.canonical
  if (!canonical) issues.push(finding({
    level: 'info', code: 'missing-canonical-url', field: 'og:url', message: 'No canonical share URL was found.',
    impact: 'Shares of tracking or alternate URLs can be treated as separate pages.',
    evidence: 'Neither og:url nor a canonical link is present in the fetched HTML.',
    fix: 'Add og:url or a canonical link that points to the preferred public page URL.',
  }))
  else if (!isAbsoluteHttpUrl(canonical)) issues.push(finding({
    level: 'warn', code: 'invalid-canonical-url', field: meta.ogUrl ? 'og:url' : 'canonical', message: 'The canonical share URL is not an absolute HTTP(S) URL.',
    impact: 'A crawler may fail to identify the permanent page URL or may treat alternate URLs as separate shares.',
    evidence: `${meta.ogUrl ? 'og:url' : 'The canonical link'} is present but is not a valid absolute HTTP(S) URL.`,
    fix: `Replace ${meta.ogUrl ? 'og:url' : 'the canonical link'} with the preferred absolute public page URL.`,
  }))

  if (!meta.ogType) issues.push(finding({
    level: 'info', code: 'missing-og-type', field: 'og:type', message: 'The Open Graph object type is missing.',
    impact: 'Consumers must infer the page type instead of receiving an explicit Open Graph object type.',
    evidence: 'The fetched HTML has no og:type; the Open Graph protocol lists it as required metadata.',
    fix: 'Add og:type="website" for a general page, or the correct specific type such as "article".',
  }))

  const rank = { error: 0, warn: 1, info: 2 } as const
  return issues.sort((a, b) => rank[a.level] - rank[b.level])
}
