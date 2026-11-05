import { clock, duration } from '@/shared/lib/ledger-v2'
import type { DayShare } from '@/shared/lib/day-share'

const WIDTH = 1080, SCALE = 2, MARGIN = 56, GRID_X = 140, GRID_WIDTH = WIDTH - GRID_X - MARGIN, ROW = 88, GRID_Y = 348
const PAPER = '#fafaf5', INK = '#2d453b', MUTED = '#7a8575', LINE = '#dfe5d7'
const SANS = '"PingFang SC", "Microsoft YaHei", sans-serif'
const SERIF = '"Songti SC", "Noto Serif CJK SC", serif'
const MONO = '"SFMono-Regular", Menlo, monospace'

// Canvas wrapping also measures Latin text and URLs, without relying on a DOM screenshot.
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = []
  let line = ''
  for (const char of Array.from(text.replace(/\s+/g, ' '))) {
    if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = char }
    else line += char
  }
  if (line) lines.push(line)
  return lines
}

export async function renderDayShare(data: DayShare): Promise<{ blob: Blob; width: number; height: number }> {
  await document.fonts.ready
  const privateShare = data.labels === 'selected'
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法生成图片，请换一个浏览器再试。')
  ctx.font = `19px ${SANS}`
  const detailRows = data.details.map(r => ({ ...r, lines: wrap(ctx, `${r.approximate ? '≈ ' : ''}${r.label}`, 690) }))
  const detailHeight = detailRows.reduce((sum, r) => sum + Math.max(50, r.lines.length * 28 + 24), 0)
  const categoryRows = data.categories.map(c => ({ ...c, lines: wrap(ctx, c.name, 275) }))
  const categoryHeight = categoryRows.reduce((sum, c) => sum + Math.max(40, c.lines.length * 24 + 12), 0)
  const gridEnd = GRID_Y + data.hours.length * ROW
  const height = gridEnd + (privateShare ? 120 : 200) + categoryHeight + (detailRows.length ? 88 + detailHeight : 0) + (data.count === 0 ? 42 : 0)
  if (height * SCALE > 30000) throw new Error('这天的明细较长，请取消“附活动明细”后再生成。')
  canvas.width = WIDTH * SCALE; canvas.height = height * SCALE
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, WIDTH, height)
  const text = (value: string, x: number, y: number, size = 19, color = INK, family = SANS, weight = '400') => {
    ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${family}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(value, x, y)
  }
  const rule = (x: number, y: number, width: number, color = LINE) => { ctx.fillStyle = color; ctx.fillRect(x, y, width, 1) }

  text('TIME LEDGER  /  一日时间账本', MARGIN, 57, 15, MUTED, MONO)
  text('我的一天', MARGIN, 120, 44, INK, SERIF, '600')
  const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' }).format(new Date(data.date + 'T12:00:00Z'))
  text(date, MARGIN, 158, 21)
  text(`${data.demo ? '示例日程  ·  ' : ''}${data.rangeLabel}  ·  ${privateShare ? '仅公开 ' : ''}${data.count} 条记录${data.labels === 'primary' ? '  ·  仅一级分类' : ''}`, MARGIN, 189, 16, MUTED)
  rule(MARGIN, 213, WIDTH - MARGIN * 2)
  ;[[privateShare ? '公开覆盖' : '记录覆盖', data.covered, '同一分钟只计一次'], [privateShare ? '公开活动累计' : '活动累计', data.total, '并行活动分别计时'], [privateShare ? '公开活动并行' : '并行时段', data.parallel, privateShare ? '只计算所选活动' : '同时进行两件或三件事']].forEach(([label, value, hint], i) => {
    const x = MARGIN + i * 335
    text(String(label), x, 245, 16, MUTED)
    text(String(value), x, 288, 36, INK, MONO)
    const numberWidth = ctx.measureText(String(value)).width
    text('分', x + numberWidth + 9, 288, 16, MUTED)
    text(String(hint), x, 312, 13, MUTED)
  })
  if (data.hours.length) for (const minute of [0, 15, 30, 45, 60]) text(String(minute).padStart(2, '0'), GRID_X + GRID_WIDTH * minute / 60 - (minute === 60 ? 22 : 0), GRID_Y - 12, 13, MUTED, MONO)
  data.hours.forEach(({ hour, blocks }, index) => {
    const y = GRID_Y + index * ROW
    const minutes = Math.min(60, data.end - hour * 60), rowWidth = GRID_WIDTH * minutes / 60
    text(`${String(hour).padStart(2, '0')}:00`, MARGIN, y + 26, 18, MUTED, MONO)
    for (let minute = 0; minute <= minutes; minute += 5) { ctx.fillStyle = minute % 15 === 0 ? LINE : '#edf0e7'; ctx.fillRect(GRID_X + GRID_WIDTH * minute / 60, y, 1, ROW) }
    ctx.fillStyle = LINE; ctx.fillRect(GRID_X + rowWidth, y, 1, ROW)
    rule(GRID_X, y, rowWidth)
    for (const block of blocks) {
      const x = GRID_X + (block.start - hour * 60) / 60 * GRID_WIDTH
      const by = y + block.slot / block.slots * ROW, w = (block.end - block.start) / 60 * GRID_WIDTH, h = ROW / block.slots
      ctx.save(); ctx.beginPath(); ctx.rect(x, by, w, h); ctx.clip()
      ctx.fillStyle = PAPER; ctx.fillRect(x, by, w, h)
      ctx.fillStyle = block.color; ctx.globalAlpha = .23; ctx.fillRect(x, by, w, h); ctx.globalAlpha = 1
      ctx.fillStyle = block.color; ctx.fillRect(x, by, 2, h)
      rule(x, by + h - 1, w, '#fafaf5')
      if (privateShare && !block.hidden) { ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.strokeRect(x + 1, by + 1, Math.max(0, w - 2), h - 2) }
      if (block.showLabel && w >= 23) {
        ctx.font = `15px ${SANS}`
        const lines = wrap(ctx, `${block.approximate ? '≈ ' : ''}${block.label}`, w - 14)
        const maxLines = Math.max(1, Math.floor((h - 10) / 20)), visible = lines.slice(0, maxLines)
        if (lines.length > maxLines) {
          let last = visible[maxLines - 1]
          while (last && ctx.measureText(last + '…').width > w - 14) last = Array.from(last).slice(0, -1).join('')
          visible[maxLines - 1] = last + '…'
        }
        visible.forEach((line, n) => text(line, x + 7, by + (h - visible.length * 20) / 2 + 16 + n * 20, 15))
      }
      ctx.restore()
    }
  })
  if (data.hours.length) rule(GRID_X, gridEnd, GRID_WIDTH * (data.end - data.hours[data.hours.length - 1].hour * 60) / 60)
  let y = gridEnd + 33
  if (data.hours.length) text(privateShare ? '只公开选中的活动，其余活动仅保留色块与时段。' : '时间块按分钟排列，同一时段的并行活动上下均分。', GRID_X, y, 14, MUTED)
  if (!data.count) { y += 40; text(privateShare ? '尚未选择公开活动。' : data.range === 'from-six' ? '这个时段还没有记录。' : '这一天还没有记录。', MARGIN, y, 22, MUTED, SERIF) }
  if (!privateShare) {
    y += 57
    text('时间花在哪里', MARGIN, y, 23, INK, SERIF, '600')
    text('一级分类 · 同类去重', 816, y, 14, MUTED)
    y += 24
    categoryRows.forEach(c => {
      const rowHeight = Math.max(40, c.lines.length * 24 + 12)
      ctx.fillStyle = c.color; ctx.fillRect(MARGIN, y + 12, 8, 8)
      c.lines.forEach((line, i) => text(line, MARGIN + 20, y + 23 + i * 24, 19))
      ctx.fillStyle = '#e9ede3'; ctx.fillRect(390, y + 12, 425, 9)
      ctx.fillStyle = c.color; ctx.fillRect(390, y + 12, 425 * c.minutes / Math.max(1, data.categories[0].minutes), 9)
      text(duration(c.minutes), 841, y + 23, 16)
      y += rowHeight
    })
  }
  if (detailRows.length) {
    y += 45; text(privateShare ? '这次想分享的事' : '当天活动明细', MARGIN, y, 23, INK, SERIF, '600'); y += 25
    for (const row of detailRows) {
      rule(MARGIN, y, WIDTH - MARGIN * 2)
      text(`${clock(row.start)}—${clock(row.end)}`, MARGIN, y + 29, 16, MUTED, MONO)
      ctx.fillStyle = row.color; ctx.fillRect(242, y + 16, 4, 17)
      row.lines.forEach((line, i) => text(line, 263, y + 29 + i * 28, 19))
      text(`${row.end - row.start}分`, 957, y + 29, 14, MUTED)
      y += Math.max(50, row.lines.length * 28 + 24)
    }
  }
  y += 29; rule(MARGIN, y, WIDTH - MARGIN * 2)
  text(`${data.demo ? '示例数据 · ' : ''}北京时间 · ${privateShare ? '统计仅含公开活动 · ' : ''}${data.range === 'from-six' ? `${data.rangeLabel} · ` : ''}按已填写时段计算${data.futureCount ? ` · 含 ${data.futureCount} 条提前记录` : ''}`, MARGIN, y + 28, 13, MUTED)
  text('时间账本', WIDTH - MARGIN - 65, y + 28, 13, MUTED)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片生成失败，请重试。')), 'image/png'))
  return { blob, width: canvas.width, height: canvas.height }
}
