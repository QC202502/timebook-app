import { NextResponse } from 'next/server'
import { localRequestAllowed } from '@/server/lib/local-request'
import { readSourceCandidates, receiptCandidate } from '@/server/lib/codex-sources'
import { validDate } from '@/shared/lib/ledger-v2'
export const dynamic = 'force-dynamic'
let lastScan = 0
export async function GET(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: '仅限本机同源访问。' }, { status: 403 })
  if (process.env.TIME_LEDGER_CODEX_ENABLED !== '1' || !process.env.TIME_LEDGER_CODEX_SESSIONS || !process.env.TIME_LEDGER_CODEX_MEMORY) return NextResponse.json({ error: 'Codex 来源未启用。' }, { status: 503 })
  const date = new URL(request.url).searchParams.get('date')
  if (!validDate(date)) return NextResponse.json({ error: '日期无效。' }, { status: 400 })
  if (Date.now() - lastScan < 3000) return NextResponse.json({ error: '请稍候再扫描。' }, { status: 429 })
  lastScan = Date.now()
  try { return NextResponse.json(await readSourceCandidates(date), { headers: { 'Cache-Control': 'no-store' } }) }
  catch { return NextResponse.json({ error: '来源读取失败，账本未改动。' }, { status: 500 }) }
}
export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: '仅限本机同源访问。' }, { status: 403 })
  try {
    const raw = await request.text()
    if (raw.length > 64000) return NextResponse.json({ error: '回执超过64KB。' }, { status: 413 })
    const value = JSON.parse(raw), rows = Array.isArray(value) ? value : [value]
    if (rows.length > 50) return NextResponse.json({ error: '每次最多50条回执。' }, { status: 400 })
    return NextResponse.json({ candidates: rows.map(r => receiptCandidate(r, 'codex', 'Codex结构化回执')), warnings: [] }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '回执格式不正确。' }, { status: 400 }) }
}
