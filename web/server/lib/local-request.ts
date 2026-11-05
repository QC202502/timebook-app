/** This prototype is loopback-only. Cloud deployment requires authentication first. */
export function localRequestAllowed(request: Request) {
  try {
    const url = new URL(request.url)
    const host = request.headers.get('host') || url.host
    const parsed = new URL('http://' + host)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) return false
    const origin = request.headers.get('origin')
    if (origin && new URL(origin).host !== host) return false
    return request.headers.get('sec-fetch-site') !== 'cross-site'
  } catch { return false }
}
