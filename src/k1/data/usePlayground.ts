import { useCallback, useEffect, useMemo, useState } from 'react'
import { describeError, draftTarget, loadConfig, sameDraft, saveConfig, type AgentConfig, type Draft, type TestLead } from './agentConfig'
import { listLeads, type UploadedLead } from './builderApi'
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
  sample,
})

const SAMPLE_OPTIONS: LeadOption[] = LEADS.filter((lead) => !lead.isClosed).map((lead) => toOption(lead, true))

export function usePlayground(notify: Notify) {
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploaded, setUploaded] = useState<UploadedLead[]>([])
  const [leadId, setLeadId] = useState<string | null>(null)

  const load = useCallback(() => {
    let cancelled = false
    setLoadError(null)
    loadConfig()
      .then((next) => {
        if (cancelled) return
        setConfig(next)
        setDraft(toDraft(next))
        setVersionId(next.versions.find((item) => item.active)?.id ?? next.versions[0]?.id ?? null)
      })
      .catch((error: Error) => { if (!cancelled) setLoadError(describeError(error)) })
    return () => { cancelled = true }
  }, [])

  useEffect(load, [load])

  const refreshLeads = useCallback(() => {
    void listLeads().then(setUploaded).catch(() => setUploaded([]))
  }, [])
  useEffect(refreshLeads, [refreshLeads])

  const leads: LeadOption[] = useMemo(() => [
    ...uploaded.filter((lead) => !lead.isClosed).map((lead) => toOption(lead, false)),
    ...SAMPLE_OPTIONS,
  ], [uploaded])
  const lead = leads.find((option) => option.id === leadId) ?? leads[0]

  const refresh = useCallback(async () => {
    try {
      const next = await loadConfig()
      setConfig(next)
      return next
    } catch {
      return null
    }
  }, [])

  const saved: Draft | null = config ? toDraft(config) : null
  const dirty = Boolean(draft && saved && !sameDraft(draft, saved))

  const target = useMemo(() => (config && draft ? draftTarget(config, draft) : null), [config, draft])
  const chat = useTestChat(target, 'playground', lead)

  const edit = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current))

  const discard = () => {
    if (!saved || !config) return
    setDraft(saved)
    setVersionId(config.versions.find((item) => item.active)?.id ?? null)
  }

  const loadVersion = (id: string) => {
    if (!config || !draft) return
    const version = config.versions.find((item) => item.id === id)
    if (!version) return
    if (draft.locked && version.masterPrompt !== draft.masterPrompt) {
      notify({ tone: 'error', title: 'Base prompt is locked', body: `Unlock the base prompt before loading v${version.number}.` })
      return
    }
    setVersionId(id)
    setDraft({ ...draft, masterPrompt: version.masterPrompt, additional: version.additional, opener: version.opener, reminders: version.reminders, translations: version.translations })
  }

  const save = async () => {
    if (!config || !draft || saving) return
    setSaving(true)
    try {
      const next = await saveConfig(config, draft)
      setConfig(next)
      setDraft(toDraft(next))
      setVersionId(next.versions[0]?.id ?? null)
      notify({ title: `Saved as v${next.versions[0]?.number ?? ''}`.trim(), body: 'The live WhatsApp agent is unchanged until you request a deployment.' })
    } catch (error) {
      notify({ tone: 'error', title: 'Save failed', body: `Nothing was saved (${describeError(error)}). Your draft is still here.` })
    } finally {
      setSaving(false)
    }
  }

  return {
    config, loadError, reload: load, refresh, draft, dirty, saving, versionId,
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
