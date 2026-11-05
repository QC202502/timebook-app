import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? ''
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return new NextResponse('Local use only', { status: 403 })
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin')
    if ((origin && origin !== `http://${host}`) || request.headers.get('sec-fetch-site') === 'cross-site' || !request.headers.get('content-type')?.startsWith('application/json')) {
      return new NextResponse('Invalid origin or content type', { status: 403 })
    }
  }
  const response = NextResponse.next()
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'same-origin')
  return response
}
export const config = { matcher: '/api/:path*' }
