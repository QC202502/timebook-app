import { NextResponse } from 'next/server'
import { localRequestAllowed } from '@/server/lib/local-request'
import { protectionStatus, readVersion, validVersionId } from '@/server/lib/ledger-protection'
import { previewRecovery, restoreLedgerVersion, LedgerError } from '@/server/lib/ledger-v2-store'
import { validId } from '@/shared/lib/ledger-v2'
import { readFile } from 'node:fs/promises'
import { ledgerFile, archiveVersion } from '@/server/lib/ledger-protection'

export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export async function GET(request: Request) {
  if (!localRequestAllowed(request)) return json({ error: '仅限本机同源访问。' }, 403)
  try {
    const query = new URL(request.url).searchParams, versionId = query.get('version'), recordId = query.get('record') || undefined
    if (!versionId) return json(await protectionStatus())
    if (!validVersionId(versionId) || recordId && !validId(recordId)) return json({ error: '版本或记录编号不正确。' }, 400)
    if (query.get('preview') === '1') return json(await previewRecovery(versionId, recordId))
    const { data, meta } = await readVersion(versionId)
    return json({ meta, records: data.records })
  } catch { return json({ error: '版本读取或校验失败。原账本未改动，请检查数据目录。' }, 500) }
}
export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return json({ error: '仅限本机同源操作。' }, 403)
  try {
    const raw = await request.text()
    if (raw.length > 4096) return json({ error: '请求过大。' }, 413)
    const body = JSON.parse(raw)
    if (body.action === 'retry') {
      await archiveVersion(await readFile(ledgerFile()), 'manual-retry')
      return json({ archived: true })
    }
    if (body.action !== 'restore' || !validVersionId(body.versionId || '') || body.recordId && !validId(body.recordId) || !Number.isSafeInteger(body.revision) || !/^[a-f0-9]{64}$/.test(body.currentHash || '') || !validId(body.operationId) || body.confirm !== (body.recordId ? 'restore-record' : 'restore-ledger')) return json({ error: '请先预览并明确确认恢复范围。' }, 400)
    return json(await restoreLedgerVersion(body.versionId, body.recordId || undefined, body.revision, body.currentHash, body.operationId))
  } catch (e) {
    if (e instanceof LedgerError) return json({ error: e.message }, e.status)
    return json({ error: e instanceof Error && !('code' in e) ? e.message : '恢复未完成，请重新读取账本核对。' }, 400)
  }
}
