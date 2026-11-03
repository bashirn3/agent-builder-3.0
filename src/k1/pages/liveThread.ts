import { useEffect, useRef } from 'react'

// One open chat, a few seconds apart, and nothing while the tab is hidden.
export const LIVE_THREAD_MS = 3000

export function sameMessages<T extends { id: string; text: string; role: string }>(current: T[], next: T[]) {
  if (current.length !== next.length) return false
  for (let index = 0; index < current.length; index += 1) {
    const left = current[index]
    const right = next[index]
    if (left.id !== right.id || left.text !== right.text || left.role !== right.role) return false
  }
  return true
}

export function useLiveReload(enabled: boolean, load: () => void) {
  const saved = useRef(load)
  saved.current = load
  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      if (document.hidden) return
      saved.current()
    }
    const timer = window.setInterval(tick, LIVE_THREAD_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [enabled])
}

export function noteStick(node: HTMLElement | null, stick: { current: boolean }) {
  if (!node) return
  stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
}

export function scrollIfStuck(node: HTMLElement | null, stick: { current: boolean }) {
  if (!node || !stick.current) return
  node.scrollTop = node.scrollHeight
}
