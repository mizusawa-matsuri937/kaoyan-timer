import { useAmbient } from '../ambient'
import { mix, THEME_GREEN, THEME_INDIGO } from '../lib/color'
import type { TabId } from './TabBar'

/**
 * 背景弥散环境光：3 个大光斑。
 * 用「纯色 + 径向遮罩」而不是 filter: blur，颜色过渡只改 background-color，
 * 呼吸动画只改 transform/opacity，全部走合成层，手机上也不掉帧。
 */
export function AmbientGlow({ tab }: { tab: TabId }) {
  const { color, running } = useAmbient()

  let c1: string, c2: string, c3: string
  if (tab === 'timer') {
    const base = color ?? THEME_GREEN
    c1 = base
    // 只和靛蓝混合（相邻色相），避免互补色混出灰色
    c2 = mix(base, THEME_INDIGO, 0.4)
    c3 = base
  } else if (tab === 'stats') {
    c1 = THEME_INDIGO
    c2 = THEME_GREEN
    c3 = '#06b6d4'
  } else if (tab === 'heat') {
    c1 = THEME_GREEN
    c2 = '#10b981'
    c3 = THEME_INDIGO
  } else {
    c1 = '#818cf8'
    c2 = '#34d399'
    c3 = '#a78bfa'
  }
  const breathe = tab === 'timer' && running

  const blob = (style: React.CSSProperties, cls: string) => (
    <div
      className={`absolute rounded-full ${cls}`}
      style={{
        WebkitMaskImage: 'radial-gradient(closest-side, #000 0%, rgba(0,0,0,.45) 45%, transparent 100%)',
        maskImage: 'radial-gradient(closest-side, #000 0%, rgba(0,0,0,.45) 45%, transparent 100%)',
        transition: 'background-color 1.2s ease',
        willChange: 'transform, opacity',
        ...style,
      }}
    />
  )

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: 'var(--ambient-opacity)' }}
    >
      {blob({ width: '115vmax', height: '115vmax', top: '-55vmax', left: '-40vmax', backgroundColor: c1 }, breathe ? 'ambient-breathe' : 'ambient-drift')}
      {blob({ width: '95vmax', height: '95vmax', top: '-30vmax', right: '-55vmax', backgroundColor: c2, animationDelay: '-3s' }, breathe ? 'ambient-breathe' : 'ambient-drift')}
      {blob({ width: '100vmax', height: '100vmax', bottom: '-60vmax', left: '-25vmax', backgroundColor: c3, opacity: 0.55, animationDelay: '-9s' }, 'ambient-drift')}
    </div>
  )
}
