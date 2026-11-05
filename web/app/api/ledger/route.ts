import { localRequestAllowed } from '@/server/lib/local-request'
import { NextResponse } from 'next/server'
import { changeLedger, LedgerError, readLedger } from '@/server/lib/ledger-v2-store'
import { validRecordShape, validId } from '@/shared/lib/ledger-v2'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: '仅限本机同源访问。' }, { status: 403 })
  try { return NextResponse.json(await readLedger(), { headers: { 'Cache-Control': 'no-store' } }) }
  catch { return NextResponse.json({ error: '本机账本读取失败，原文件未覆盖。' }, { status: 500 }) }
}
export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: '仅限本机同源保存。' }, { status: 403 })
  try {
    const raw = await request.text()
    if (raw.length > 200000) return NextResponse.json({ error: '提交内容过大。' }, { status: 413 })
    const body = JSON.parse(raw)
    if (body?.createIds !== undefined && (!Array.isArray(body.createIds) || !body.createIds.length || body.createIds.length > 3 || !body.createIds.every(validId) || new Set(body.createIds).size !== body.createIds.length)) return NextResponse.json({ error: '成组新增格式不正确。' }, { status: 400 })
    if (body?.recordIntent !== undefined && (!body.recordIntent || !['create', 'update'].includes(body.recordIntent.kind) || !validId(body.recordIntent.id))) return NextResponse.json({ error: '保存意图格式不正确。' }, { status: 400 })
    if (body?.confirmedReplacementIds !== undefined && (!Array.isArray(body.confirmedReplacementIds) || body.confirmedReplacementIds.length > 100 || !body.confirmedReplacementIds.every(validId))) return NextResponse.json({ error: '修改确认格式不正确。' }, { status: 400 })
    if (!body || !Number.isInteger(body.revision) || body.revision < 0 || typeof body.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.operationId) ||
      !Array.isArray(body.upserts) || body.upserts.length > 100 || !body.upserts.every(validRecordShape) ||
      !Array.isArray(body.deleteIds) || body.deleteIds.length > 100 || !body.deleteIds.every((id: unknown) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id))) {
      return NextResponse.json({ error: '记录格式不正确。' }, { status: 400 })
    }
    return NextResponse.json(await changeLedger(body.revision, body.operationId, body))
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: '提交内容不是有效 JSON。' }, { status: 400 })
    if (error instanceof LedgerError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: '保存失败，请重试；输入内容仍保留。' }, { status: 500 })
  }
}
