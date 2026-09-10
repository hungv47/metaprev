export type MetaTags = {
  title?: string
  description?: string
  canonical?: string
  ogSiteName?: string
  ogType?: string
  ogTitle?: string
  ogDescription?: string
  ogUrl?: string
  ogImage?: string
  ogImageAlt?: string
  ogImageWidth?: string
  ogImageHeight?: string
  twitterCard?: string
  twitterSite?: string
  twitterTitle?: string
  twitterDescription?: string
  twitterImage?: string
  twitterImageAlt?: string
}

export type ImageProbe = {
  url: string
  resolved: string
  status: number
  ok: boolean
  contentType?: string
  detectedContentType?: string
  byteLength?: number
  width?: number
  height?: number
  error?: string
  // base64 data URI of the fetched image bytes. Embedded in the HTML preview so the
  // browser renders exactly what was validated, not whatever stale copy it has cached
  // for the og:image URL. Stripped from --json output.
  dataUri?: string
}

export type Issue = {
  level: 'error' | 'warn' | 'info'
  code: string
  field: string
  message: string
  impact: string
  evidence: string
  fix: string
}

export type Report = {
  source: string
  fetchedAt: string
  finalUrl: string
  status: number
  meta: MetaTags
  image?: ImageProbe
  // Preview-only probe when twitter:image differs from og:image. JSON and scoped
  // commands stay on the original single-image path, so their cost and shape remain stable.
  twitterImage?: ImageProbe
  issues: Issue[]
}
