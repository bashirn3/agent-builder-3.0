import { useEffect, useRef, useState } from 'react'
import { AccessError, fetchMusterDay, type LeadRow } from './builderApi'

export const MUSTER_MAX_DAYS = 15

// Days already fetched this session, per station. Customer data stays in memory only.
const cache = new Map<string, LeadRow[]>()
const keyOf = (stationId: number, day: string) => `${stationId}:${day}`

export function daysBetween(from: string, to: string, max = MUSTER_MAX_DAYS) {
  const days: string[] = []
  const cursor = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cursor <= end && days.length < max) {
    days.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

export type MusterState = {
  rows: LeadRow[]
  loading: boolean
  progress: { done: number; total: number; day: string }
  failed: string[]
  blocked: AccessError['reason'] | null
  retry: () => void
}

function collect(stationId: number, days: string[]) {
  const byPlate = new Map<string, LeadRow>()
  for (const day of days) for (const row of cache.get(keyOf(stationId, day)) ?? []) byPlate.set(row.PlateNumber.toUpperCase(), row)
  return [...byPlate.values()].sort((a, b) => a.NextInspectionDateRangeEnd.localeCompare(b.NextInspectionDateRangeEnd) || a.PlateNumber.localeCompare(b.PlateNumber))
}

export function useMusterLeads(stationId: number, from: string | null, to: string | null, enabled = true): MusterState {
  const [rows, setRows] = useState<LeadRow[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, day: '' })
  const [failed, setFailed] = useState<string[]>([])
  const [blocked, setBlocked] = useState<AccessError['reason'] | null>(null)
  const [attempt, setAttempt] = useState(0)
  const running = useRef<AbortController | null>(null)

  useEffect(() => {
    running.current?.abort()
    if (!enabled || !from || !to) {
      setRows([])
      setLoading(false)
      setFailed([])
      return
    }
    const days = daysBetween(from, to)
    const missing = days.filter((day) => !cache.has(keyOf(stationId, day)))
    setRows(collect(stationId, days))
    setFailed([])
    setBlocked(null)
    if (!missing.length) {
      setLoading(false)
      setProgress({ done: days.length, total: days.length, day: days[days.length - 1] ?? '' })
      return
    }
    const controller = new AbortController()
    running.current = controller
    setLoading(true)
    void (async () => {
      const missed: string[] = []
      for (const [index, day] of missing.entries()) {
        if (controller.signal.aborted) return
        setProgress({ done: days.length - missing.length + index, total: days.length, day })
        let result: LeadRow[] | null = null
        for (let tries = 0; tries < 2 && !result; tries += 1) {
          try {
            result = (await fetchMusterDay(day, [stationId], 'all', controller.signal)).items
          } catch (error) {
            if (controller.signal.aborted) return
            if (error instanceof AccessError) {
              setBlocked(error.reason)
              setLoading(false)
              return
            }
          }
        }
        if (result) {
          cache.set(keyOf(stationId, day), result)
          setRows(collect(stationId, days))
        } else {
          missed.push(day)
        }
      }
      if (controller.signal.aborted) return
      setProgress({ done: days.length, total: days.length, day: days[days.length - 1] })
      setFailed(missed)
      setLoading(false)
    })()
    return () => controller.abort()
  }, [stationId, from, to, enabled, attempt])

  return { rows, loading, progress, failed, blocked, retry: () => setAttempt((value) => value + 1) }
}
