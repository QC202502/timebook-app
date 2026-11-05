import type { Metadata } from 'next'
import './globals.css'
import './collaboration.css'
import './protection.css'

export const metadata: Metadata = {
  title: '时间账本',
  description: '精确到分钟，记录并行活动，看见每一类时间投入。'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
