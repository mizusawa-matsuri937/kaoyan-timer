import { useSyncExternalStore } from 'react'

/** 计时页把当前科目颜色和计时状态告诉背景环境光（纯视觉状态，不落盘） */
export interface Ambient {
  color: string | null
  running: boolean
}

let ambient: Ambient = { color: null, running: false }
const listeners = new Set<() => void>()

export function setAmbient(next: Ambient) {
  if (next.color === ambient.color && next.running === ambient.running) return
  ambient = next
  for (const l of listeners) l()
}

export function useAmbient(): Ambient {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => ambient,
  )
}
