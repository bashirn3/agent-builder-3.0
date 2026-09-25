import { useSyncExternalStore } from 'react'
import { en, fi, type Copy } from './i18n/copy'

export type UiLang = 'fi' | 'en'

const STORAGE_KEY = 'k1.lang'
const COPY: Record<UiLang, Copy> = { fi, en }
const listeners = new Set<() => void>()

let current: UiLang = readStored()

function readStored(): UiLang {
  if (typeof window === 'undefined') return 'en'
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'fi'
  } catch {
    return 'fi'
  }
}

if (typeof document !== 'undefined') document.documentElement.lang = current

export const uiLang = () => current

export function setUiLang(lang: UiLang) {
  if (lang === current) return
  current = lang
  try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* private mode */ }
  document.documentElement.lang = lang
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useUiLang() {
  return useSyncExternalStore(subscribe, uiLang)
}

export function useCopy(): Copy {
  return COPY[useUiLang()]
}

// For code that runs outside render, such as toasts raised from event handlers.
export function copy(): Copy {
  return COPY[current]
}

export const locale = (lang: UiLang = current) => (lang === 'fi' ? 'fi-FI' : 'en-GB')

export function plural(count: number, one: string, many: string) {
  return (count === 1 ? one : many).replace('{n}', String(count))
}

export type { Copy }
