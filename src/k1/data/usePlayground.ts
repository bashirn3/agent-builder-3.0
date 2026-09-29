import { copy } from '../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { describeError, draftTarget, loadConfig, sameDraft, saveConfig, withContent, type AgentConfig, type Draft, type TestLead } from './agentConfig'
import { getVersionContent, listLeads, type UploadedLead } from './builderApi'
import { LEADS } from './fixtures'
import { useTestChat } from './useTestChat'

export type { TestMessage } from './useTestChat'

type Notify = (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void

const toDraft = (config: AgentConfig): Draft => ({ locked: config.locked, masterPrompt: config.masterPrompt, additional: config.additional, opener: config.opener, reminders: config.reminders, translations: config.translations })

export type LeadOption = TestLead & { id: string; sample: boolean }

// Leads at closed stations must not be contacted, so they are not offered for testing.
const toOption = (lead: TestLead & { id: string; isClosed: boolean }, sample: boolean): LeadOption => ({
  id: lead.id,
  plateNumber: lead.plateNumber,
  stationName: lead.stationName,
  nextInspection: lead.nextInspection,
  lastInspection: lead.lastInspection,
  language: lead.language,
  phoneNumber: lead.phoneNumber,
  product: lead.product,
  vehicleCategory: lead.vehicleCategory,
  sample,
})

const SAMPLE_OPTIONS: LeadOption[] = LEADS.filter((lead) => !lead.isClosed).map((lead) => toOption(lead, true))

const REFRESH_GAP = 15_000
const LEAD_KEY = 'k1-test-lead'

// A stored copy of the configuration showed stale text that was then swapped out, so it is no longer kept.
try { localStorage.removeItem('k1-config-cache-v1') } catch { /* storage blocked */ }

function readLeadId() {
  try { return localStorage.getItem(LEAD_KEY) } catch { return null }
}

export function usePlayground(notify: Notify) {
  const [config, setConfigState] = useState<AgentConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)
  const configRef = useRef(config)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const lastLoaded = useRef(0)

  const setConfig = useCallback((next: AgentConfig) => {
    configRef.current = next
    lastLoaded.current = Date.now()
    setConfigState(next)
  }, [])

  // Replace the configuration without discarding edits: the draft follows only if it was unchanged.
  const adopt = useCallback((next: AgentConfig) => {
    const previous = configRef.current
    const untouched = !previous || !draftRef.current || sameDraft(draftRef.current, toDraft(previous))
    setConfig(next)
    if (untouched) {
      setDraft(toDraft(next))
      setVersionId(next.versions.find((item) => item.active)?.id ?? next.versions[0]?.id ?? null)
    }
  }, [setConfig])
  const [saving, setSaving] = useState(false)
  const [uploaded, setUploaded] = useState<UploadedLead[]>([])
  const [leadsReady, setLeadsReady] = useState(false)
  const [leadId, setLeadIdState] = useState<string | null>(readLeadId)
  const setLeadId = useCallback((id: string | null) => {
    setLeadIdState(id)
    try { if (id) localStorage.setItem(LEAD_KEY, id); else localStorage.removeItem(LEAD_KEY) } catch { /* storage blocked */ }
  }, [])

  const load = useCallback(() => {
    let cancelled = false
    setLoadError(null)
    loadConfig()
      .then((next) => { if (!cancelled) adopt(next) })
      .catch((error: Error) => { if (!cancelled && !configRef.current) setLoadError(describeError(error)) })
    return () => { cancelled = true }
  }, [adopt])

  useEffect(load, [load])

  const refreshLeads = useCallback(() => {
    void listLeads().then(setUploaded).catch(() => setUploaded([])).finally(() => setLeadsReady(true))
  }, [])
  useEffect(refreshLeads, [refreshLeads])

  const leads: LeadOption[] = useMemo(() => [
    ...uploaded.filter((lead) => !lead.isClosed).map((lead) => toOption(lead, false)),
    ...SAMPLE_OPTIONS,
  ], [uploaded])
  // Without a pick the first sample lead is used, so leads arriving later never change it.
  const lead = leads.find((option) => option.id === leadId) ?? SAMPLE_OPTIONS[0]
  // Pages wait for both the configuration and the leads so nothing changes once they show.
  const ready = Boolean(config) && leadsReady

  const refresh = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!force && configRef.current && Date.now() - lastLoaded.current < REFRESH_GAP) return configRef.current
    try {
      const next = await loadConfig()
      adopt(next)
      return next
    } catch {
      return null
    }
  }, [adopt])

  // Versions in the light state carry no prompt text until they are opened.
  const ensureVersion = useCallback(async (id: string) => {
    const current = configRef.current?.versions.find((item) => item.id === id)
    if (!current || current.loaded) return current ?? null
    const content = await getVersionContent(id)
    const loaded = withContent(current, content)
    const latest = configRef.current
    if (latest) setConfig({ ...latest, versions: latest.versions.map((item) => (item.id === id ? loaded : item)) })
    return loaded
  }, [setConfig])

  const saved: Draft | null = config ? toDraft(config) : null
  const dirty = Boolean(draft && saved && !sameDraft(draft, saved))

  const target = useMemo(() => (ready && config && draft ? draftTarget(config, draft) : null), [ready, config, draft])
  const chat = useTestChat(target, 'playground', lead)

  const edit = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current))

  const discard = () => {
    if (!saved || !config) return
    setDraft(saved)
    setVersionId(config.versions.find((item) => item.active)?.id ?? null)
  }

  const [opening, setOpening] = useState<string | null>(null)
  const loadVersion = async (id: string) => {
    if (!config || !draft) return
    const known = config.versions.find((item) => item.id === id)
    if (known && !known.loaded) setOpening(id)
    let version
    try {
      version = await ensureVersion(id)
    } catch (error) {
      notify({ tone: 'error', title: copy().playground.openFailed, body: copy().playground.openFailedBody(describeError(error)) })
      return
    } finally {
      setOpening(null)
    }
    const current = draftRef.current
    if (!version || !current) return
    if (current.locked && version.masterPrompt !== current.masterPrompt) {
      notify({ tone: 'error', title: copy().playground.lockedToast, body: copy().playground.lockedToastBody(version.number) })
      return
    }
    setVersionId(id)
    setDraft({ ...current, masterPrompt: version.masterPrompt, additional: version.additional, opener: version.opener, reminders: version.reminders, translations: version.translations })
  }

  const save = async () => {
    if (!config || !draft || saving) return
    setSaving(true)
    try {
      const next = await saveConfig(config, draft)
      setConfig(next)
      setDraft(toDraft(next))
      setVersionId(next.versions[0]?.id ?? null)
      notify({ title: copy().playground.savedToast(next.versions[0]?.number ?? ''), body: copy().playground.savedToastBody })
    } catch (error) {
      notify({ tone: 'error', title: copy().playground.saveFailed, body: copy().playground.saveFailedBody(describeError(error)) })
    } finally {
      setSaving(false)
    }
  }

  return {
    config: ready ? config : null, loadError, reload: load, refresh, ensureVersion, draft, dirty, saving, versionId, opening,
    edit, discard, save, loadVersion,
    messages: chat.messages,
    pending: chat.pending,
    testError: chat.error,
    composer: chat.composer,
    setComposer: chat.setComposer,
    send: chat.send,
    retry: chat.retry,
    resetConversation: chat.reset,
    rate: chat.rate,
    sendReminder: chat.sendReminder,
    leads,
    lead,
    setLeadId,
    refreshLeads,
  }
}

export type PlaygroundStore = ReturnType<typeof usePlayground>
