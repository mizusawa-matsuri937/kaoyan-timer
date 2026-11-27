import type { CSSProperties } from 'react'
import { useSkin } from '../skin'

const SNAKE_CELLS = Array.from({ length: 16 }, (_, idx) => {
  const row = Math.floor(idx / 4)
  const col = idx % 4
  const order = row * 4 + (row % 2 ? 3 - col : col)
  return ((order / 16) - 1).toFixed(4)
})

/**
 * #08 · 三皮肤专属纯 CSS 原创加载器（参考 UI Moments Original Loaders）：
 * - 纸感文艺 → Paper Fold（纸张对角掀折）
 * - 终端极客 → Pixel Snake（4×4 方阵蛇）
 * - 新粗野   → Stack Blocks（三块硬边叠块落压）
 */
export function SkinLoader({ size = 56, label = '加载中…' }: { size?: number; label?: string }) {
  const skin = useSkin()

  return (
    <div className="skin-loader-wrap" role="status" aria-label={label}>
      {skin === 'terminal' ? (
        <span className="um-loader um-pixel-snake" style={{ '--um-size': `${size}px` } as CSSProperties} aria-hidden>
          {SNAKE_CELLS.map((delay, i) => (
            <i key={i} style={{ '--d': delay } as CSSProperties} />
          ))}
        </span>
      ) : skin === 'brutal' ? (
        <span className="um-loader um-stack-blocks" style={{ '--um-size': `${size}px` } as CSSProperties} aria-hidden>
          <i className="b1" />
          <i className="b2" />
          <i className="b3" />
        </span>
      ) : (
        <span className="um-loader um-paper-fold" style={{ '--um-size': `${size}px` } as CSSProperties} aria-hidden>
          <span className="leaf leaf-back" />
          <span className="leaf leaf-middle" />
          <span className="leaf leaf-front" />
        </span>
      )}
      {label && <span className="skin-loader-label">{label}</span>}
    </div>
  )
}
