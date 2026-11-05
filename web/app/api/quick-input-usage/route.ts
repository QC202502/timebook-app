import { NextResponse } from 'next/server'
import { validUsageBatch } from '@/shared/lib/quick-usage'
import { appendUsage } from '@/server/lib/quick-usage-store'

export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get('content-length')) > 24000) return NextResponse.json({ error: 'usage_too_large' }, { status: 413 })
    const reader = request.body?.getReader()
    if (!reader) return NextResponse.json({ error: 'invalid_usage' }, { status: 400 })
    const parts: Uint8Array[] = []; let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > 24000) { await reader.cancel(); return NextResponse.json({ error: 'usage_too_large' }, { status: 413 }) }
      parts.push(value)
    }
    const body: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'))
    if (!validUsageBatch(body)) return NextResponse.json({ error: 'invalid_usage' }, { status: 400 })
    const now = Date.now()
    if (body.events.some(e => e.at > now + 86400000)) return NextResponse.json({ error: 'invalid_usage_time' }, { status: 400 })
    return NextResponse.json(await appendUsage(body.events), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? 'invalid_usage' : 'usage_unavailable' }, { status: error instanceof SyntaxError ? 400 : 503 })
  }
}
