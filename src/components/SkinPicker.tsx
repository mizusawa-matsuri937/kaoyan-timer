import { MODES, setMode, setSkin, SKINS, useMode, useSkin } from '../skin'
import { clickOrigin, Segmented } from './ui'

/** 外观设置：皮肤 + 明暗。每个皮肤小块用 data-skin 局部套用对应令牌，点击时从指尖位置整屏过渡 */
export function SkinPicker() {
  const skin = useSkin()
  const mode = useMode()
  return (
    <>
      <div className="grid grid-cols-3 gap-2.5">
        {SKINS.map((s) => (
          <button
            key={s.id}
            onClick={(e) => setSkin(s.id, clickOrigin(e))}
            aria-pressed={skin === s.id}
            className="skin-tile"
          >
            <span data-skin={s.id} className="skin-preview" aria-hidden>
              25:00
              <i />
            </span>
            <span className="px-0.5">
              <span className="block text-[13px] font-semibold">{s.name}</span>
              <span className="block text-[11px] text-muted">{s.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-2.5">
        <Segmented value={mode} options={MODES} onChange={(m, origin) => setMode(m, origin)} />
      </div>
    </>
  )
}
