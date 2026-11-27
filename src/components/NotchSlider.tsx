import { useState, type CSSProperties } from 'react'

/**
 * 方案 6A · 磁吸刻度滑杆（参考 UI Moments Notch Slider）：
 * - 基于原生 <input type="range">，完整支持触屏拖拽、点击跳转、键盘方向键与无障碍读屏；
 * - 拖拽时胶囊滑块动态捏宽，松手弹簧磁吸至最近刻度，上方对应标签向上浮起高亮。
 */
export function NotchSlider<T extends number | string>({
  options,
  value,
  onChange,
  formatLabel = (v) => String(v),
  ariaLabel,
}: {
  options: readonly T[]
  value: T
  onChange: (next: T) => void
  formatLabel?: (v: T) => string
  ariaLabel: string
}) {
  const [dragging, setDragging] = useState(false)
  const rawIdx = options.indexOf(value)
  const idx = rawIdx >= 0 ? rawIdx : 0
  const maxIdx = Math.max(1, options.length - 1)

  return (
    <div
      className="notch-slider"
      data-drag={dragging ? '' : undefined}
      style={{ '--nv': idx, '--nmax': maxIdx } as CSSProperties}
    >
      <div className="notch-labels num" aria-hidden>
        {options.map((opt, i) => (
          <span key={String(opt)} data-on={i === idx ? '' : undefined}>
            {formatLabel(opt)}
          </span>
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={maxIdx}
        step={1}
        value={idx}
        aria-label={ariaLabel}
        aria-valuetext={formatLabel(options[idx])}
        onChange={(e) => {
          const next = options[Number(e.target.value)]
          if (next !== undefined && next !== value) onChange(next)
        }}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onBlur={() => setDragging(false)}
      />
      <div className="notch-track" aria-hidden>
        <span className="notch-fill" />
        {options.map((opt, i) => (
          <i key={String(opt)} style={{ '--ni': i } as CSSProperties} />
        ))}
        <span className="notch-thumb" />
      </div>
    </div>
  )
}
