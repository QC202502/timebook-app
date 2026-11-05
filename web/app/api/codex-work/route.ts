import { NextResponse } from 'next/server'
import { localRequestAllowed } from '@/server/lib/local-request'
import { codexCommand, refreshCodex, CodexWorkError } from '@/server/lib/codex-work-store'
import { validDate } from '@/shared/lib/ledger-v2'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'no-store' }
function range(request: Request) {
  const p = new URL(request.url).searchParams, start = p.get('start'), end = p.get('end')
  if (!validDate(start) || !validDate(end) || start >= end || Date.parse(end) - Date.parse(start) > 32 * 86400000) throw new CodexWorkError(400, '请选择有效的日、周或月范围。')
  return { start, end }
}
function failure(e: unknown) { return NextResponse.json({ error: e instanceof CodexWorkError ? e.message : '请求无效。' }, { status: e instanceof CodexWorkError ? e.status : 400, headers }) }
export async function GET(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: '仅限本机同源访问。' }, { status: 403, headers })
  try { const { start, end } = range(request); const backup = new URL(request.url).searchParams.get('backup') === '1'; return NextResponse.json(await codexCommand(backup ? 'backup' : 'read', start, end), { headers }) } catch (e) { return failure(e) }
}
export async function POST(request: Request) {
  if (!localRequestAllowed(request) || !request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: '仅限本机同源JSON请求。' }, { status: 403, headers })
  try {
    const { start, end } = range(request)
    const raw = await request.text()
    if (raw.length > 2 * 1024 * 1024) throw new CodexWorkError(413, '备份或请求过大。')
    const body = JSON.parse(raw)
    if (body.action === 'refresh') return NextResponse.json(await refreshCodex(start, end), { headers })
    if (body.action === 'patch' && raw.length <= 64000) return NextResponse.json(await codexCommand('patch', start, end, body), { headers })
    if (body.action === 'restore') return NextResponse.json(await codexCommand('restore', start, end, body), { headers })
    throw new CodexWorkError(400, '请求操作无效。')
  } catch (e) { return failure(e) }
}
