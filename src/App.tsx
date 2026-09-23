import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Dispatch, FormEvent, KeyboardEvent as ReactKeyboardEvent, SetStateAction, SVGProps, useEffect, useMemo, useRef, useState } from 'react'
import { getAgentBuilderBackendMode, getK1TenantKey, loadAgentBuilderConfig, saveAgentBuilderConfig, testAgentBuilderMessage, type AgentBuilderVersionRecord } from './lib/agentBuilderService'
import {
  applyFreshTest,
  applySavedConfig,
  beginFreshTest,
  captureSaveSnapshot,
  hasMeaningfulChanges,
  lastCustomerQuestion,
  renderWithSampleData,
  restorePlan,
  shouldAcceptTestReply,
  starterMessages,
  versionScope,
  type AgentDraft,
  type ChatMessage,
  type PromptVersion,
  type SaveSnapshot,
} from './lib/refinement'

type DialogState =
  | { kind: 'save-lock' }
  | { kind: 'sign-out' }
  | { kind: 'restore'; versionId: string }
  | { kind: 'use-last-question' }
  | { kind: 'discard' }

type SheetState = {
  kind: 'opener' | 'prompt'
  title: string
  value: string
  readOnly: boolean
}

type Feedback = 'idle' | 'ready' | 'locked'

type AppState = {
  authed: boolean
  username: string
  password: string
  showPassword: boolean
  signingIn: boolean
  loginError: string | null
  agent: AgentDraft
  historyOpen: boolean
  historyLimited: boolean
  selectedVersionId: string
  masterOpen: boolean
  openerOpen: boolean
  refineOpen: boolean
  panelExpanded: boolean
  accountOpen: boolean
  instructionDraft: string
  saving: boolean
  saveError: string | null
  pendingSaveId: string | null
  feedback: Feedback
  composer: string
  sending: boolean
  pendingResponseId: string | null
  testError: string | null
  retryingTest: boolean
  dialog: DialogState | null
  sheet: SheetState | null
  copiedMessageId: string | null
  toast: string | null
  versionConfirmed: boolean
}

const STORAGE_KEY = 'wasup-agent-builder-v1'
const ease = [0.4, 0, 0.2, 1] as const

function focusableIn(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('button, [href], textarea, input, select')]
    .filter((node) => !node.hasAttribute('disabled') && node.tabIndex !== -1)
}

function useOverlayChrome(onClose: () => void) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const closingRef = useRef(false)
  onCloseRef.current = onClose
  const requestClose = () => {
    if (closingRef.current) return
    closingRef.current = true
    onCloseRef.current()
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        requestClose()
        return
      }
      if (event.key !== 'Tab' || !rootRef.current) return
      const nodes = focusableIn(rootRef.current)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus?.()
    }
  }, [])
  return { rootRef, requestClose }
}
// Prototype gate only. This is not production authentication.
const LOGIN_USERNAME = 'K1Admin'
const LOGIN_PASSWORD = 'Wasup@123'

const OLD_BASE_PROMPT = `You are the booking assistant for Booklapland.

Answer in two sentences or fewer. Ask one follow-up question when a date, party size or destination is missing.

Never invent availability or pricing. If a fact is not in context, say so and hand off to a human.

Tone: warm, direct, no filler.`
const OLD_PROMPT_V29 = `You are the booking assistant for Booklapland.

Never invent availability or pricing. If a fact is not in context, say so and hand off to a human.`
const OLD_PROMPT_V28 = `You are the booking assistant for Booklapland. Help leads plan winter trips and collect their dates, party size and destination.`
const BASE_PROMPT = `You are the appointment-booking assistant for K1 Katsastus, a Finnish vehicle inspection company.

Ask whether the customer wants to book an inspection and collect the details needed to check availability: registration number, preferred K1 station, preferred date or time window, and contact details when needed.

Use connected workflow results for available appointments and booking outcomes. Do not invent inspection deadlines, prices, available appointments, or booking confirmations.

If a required detail is missing, ask one clear follow-up question. If workflow data is unavailable, say so and hand off to staff.`
const PROMPT_V29 = `You are the appointment-booking assistant for K1 Katsastus.

Do not invent inspection deadlines, prices, available appointments, or booking confirmations. Use connected workflow results before confirming anything.`
const PROMPT_V28 = `You are the appointment-booking assistant for K1 Katsastus. Help customers prepare for vehicle inspection and collect appointment preferences.`
const LEGACY_SAMPLE_NAME = 'Bas' + 'hir'
const OLD_OPENER = `Hi ${LEGACY_SAMPLE_NAME} — ready to plan your trip?`
const OLD_VARIABLE_OPENER = 'Hi {{first_name}} — ready to plan your trip?'
const OPENER = 'Hi {{first_name}}, this is K1 Katsastus. Your vehicle with registration {{registration_number}} is due for inspection soon. Would you like to book an appointment?'
const REPLIES = [
  'I can help with that. Which K1 station and date or time window would you prefer?',
  'Please share the registration number first so the live workflow can check the right vehicle record.',
  'This prototype cannot confirm prices or appointment availability. In production I would wait for the connected workflow result before confirming.',
  'Using the sample due-soon record for ABC-123, I can ask for your preferred station and time before checking appointments.',
]
const OLD_REPLIES = [
  'I can check that. Which destination are you thinking of, and are the dates flexible?',
  'The winter package covers accommodation, transfers and two guided activities. Would you prefer December or January dates?',
  "I don't have live pricing for that week. I’ll pass this to a colleague who can confirm it today.",
  'Two adults, five nights, late December. Shall I hold that while you check with your travel companion?',
]

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function migrateDefaultPrompt(value: string) {
  if (value === OLD_BASE_PROMPT) return BASE_PROMPT
  if (value === OLD_PROMPT_V29) return PROMPT_V29
  if (value === OLD_PROMPT_V28) return PROMPT_V28
  if (value.startsWith(`${OLD_BASE_PROMPT}\n\nAdditional guidance:`)) return value.replace(OLD_BASE_PROMPT, BASE_PROMPT)
  if (value.startsWith(`${OLD_PROMPT_V29}\n\nAdditional guidance:`)) return value.replace(OLD_PROMPT_V29, PROMPT_V29)
  if (value.startsWith(`${OLD_PROMPT_V28}\n\nAdditional guidance:`)) return value.replace(OLD_PROMPT_V28, PROMPT_V28)
  return value
}

function migrateDefaultOpener(value: string) {
  if (value === OLD_OPENER || value === OLD_VARIABLE_OPENER) return OPENER
  if (value === `Hello ${LEGACY_SAMPLE_NAME}, I can help plan a winter trip.`) {
    return 'Hi {{first_name}}, this is K1 Katsastus. I can help book a vehicle inspection for {{registration_number}}.'
  }
  return value
}

function migrateDefaultMessage(value: string) {
  if (value === renderWithSampleData(OLD_OPENER) || value === renderWithSampleData(OLD_VARIABLE_OPENER)) return renderWithSampleData(OPENER)
  const oldReplyIndex = OLD_REPLIES.indexOf(value)
  return oldReplyIndex >= 0 ? REPLIES[oldReplyIndex] : value
}

function formatStamp(value: string | Date) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function makeAgent(): AgentDraft {
  return {
    locked: false,
    savedLocked: false,
    conversationId: uid('thread'),
    testingVersionId: null,
    savedBase: BASE_PROMPT,
    savedAdditional: '',
    savedOpener: OPENER,
    draftBase: BASE_PROMPT,
    draftAdditional: '',
    draftOpener: OPENER,
    versions: [
      { id: 'v30', meta: '21 Sep, 14:02 · Shorter answers', prompt: BASE_PROMPT, opener: OPENER, sample: true },
      { id: 'v29', meta: '20 Sep, 09:41 · Handoff rule', prompt: PROMPT_V29, opener: OPENER, sample: true },
      { id: 'v28', meta: '18 Sep, 16:20 · Initial context', prompt: PROMPT_V28, opener: 'Hi {{first_name}}, this is K1 Katsastus. I can help book a vehicle inspection for {{registration_number}}.', sample: true },
    ],
    activeVersion: 'v30',
    messages: starterMessages(OPENER, uid('msg')),
    previousTest: null,
    replyIndex: 0,
  }
}

function versionNumber(id: string) {
  const numeric = Number(id.replace(/^v/, ''))
  return Number.isFinite(numeric) ? numeric : 0
}

function normalizeAgent(raw: Partial<AgentDraft> & { savedPrompt?: string; draftPrompt?: string } | undefined): AgentDraft {
  const fresh = makeAgent()
  if (!raw) return fresh
  const savedBase = migrateDefaultPrompt(raw.savedBase ?? raw.savedPrompt ?? fresh.savedBase)
  const draftBase = migrateDefaultPrompt(raw.draftBase ?? raw.draftPrompt ?? savedBase)
  const savedOpener = migrateDefaultOpener(raw.savedOpener ?? fresh.savedOpener)
  const draftOpener = migrateDefaultOpener(raw.draftOpener ?? savedOpener)
  const versions = (raw.versions?.length ? raw.versions : fresh.versions).map((version) => ({
    ...version,
    prompt: migrateDefaultPrompt(version.prompt),
    opener: typeof version.opener === 'string' ? migrateDefaultOpener(version.opener) : version.opener,
  }))
  return {
    ...fresh,
    ...raw,
    locked: Boolean(raw.locked),
    savedLocked: typeof raw.savedLocked === 'boolean' ? raw.savedLocked : Boolean(raw.locked),
    conversationId: raw.conversationId || fresh.conversationId,
    testingVersionId: raw.testingVersionId ?? null,
    savedBase,
    savedAdditional: raw.savedAdditional ?? '',
    savedOpener,
    draftBase,
    draftAdditional: raw.draftAdditional ?? raw.savedAdditional ?? '',
    draftOpener,
    versions,
    activeVersion: raw.activeVersion || versions[0]?.id || fresh.activeVersion,
    messages: (raw.messages ?? fresh.messages).map((message) => ({ ...message, text: migrateDefaultMessage(message.text) })),
    previousTest: raw.previousTest
      ? { ...raw.previousTest, messages: raw.previousTest.messages.map((message) => ({ ...message, text: migrateDefaultMessage(message.text) })) }
      : null,
    replyIndex: raw.replyIndex ?? 0,
  }
}

function initialState(): AppState {
  return {
    authed: false,
    username: '',
    password: '',
    showPassword: false,
    signingIn: false,
    loginError: null,
    agent: makeAgent(),
    historyOpen: false,
    historyLimited: false,
    selectedVersionId: 'v30',
    masterOpen: false,
    openerOpen: false,
    refineOpen: false,
    panelExpanded: false,
    accountOpen: false,
    instructionDraft: '',
    saving: false,
    saveError: null,
    pendingSaveId: null,
    feedback: 'idle',
    composer: '',
    sending: false,
    pendingResponseId: null,
    testError: null,
    retryingTest: false,
    dialog: null,
    sheet: null,
    copiedMessageId: null,
    toast: null,
    versionConfirmed: false,
  }
}

function loadInitialState(): AppState {
  if (typeof window === 'undefined') return initialState()
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return initialState()
    const parsed = JSON.parse(saved) as Partial<AppState> & { instances?: { Original?: AgentDraft & { savedPrompt?: string; draftPrompt?: string } } }
    const fresh = initialState()
    return {
      ...fresh,
      authed: Boolean(parsed.authed),
      username: typeof parsed.username === 'string' ? parsed.username : '',
      agent: normalizeAgent(parsed.agent ?? parsed.instances?.Original),
      selectedVersionId: parsed.selectedVersionId || fresh.selectedVersionId,
      instructionDraft: typeof parsed.instructionDraft === 'string' ? parsed.instructionDraft : '',
      composer: typeof parsed.composer === 'string' ? parsed.composer : '',
    }
  } catch {
    return initialState()
  }
}

function versionFromRecord(record: AgentBuilderVersionRecord, label: string): PromptVersion {
  return {
    id: `v${record.versionNumber}`,
    meta: `${formatStamp(record.createdAt)} · ${label}`,
    prompt: record.masterPrompt,
    opener: record.openingMessage ?? '',
    additionalInformation: record.additionalInformation ?? '',
  }
}

function changesOf(state: AppState) {
  const agent = state.agent
  return hasMeaningfulChanges({
    instructionDraft: state.instructionDraft,
    draftBase: agent.draftBase,
    savedBase: agent.savedBase,
    draftOpener: agent.draftOpener,
    savedOpener: agent.savedOpener,
    draftAdditional: agent.draftAdditional,
    savedAdditional: agent.savedAdditional,
    locked: agent.locked,
    savedLocked: agent.savedLocked,
  })
}

function focusVisibleComposer() {
  const nodes = document.querySelectorAll<HTMLTextAreaElement>('[data-composer="true"]')
  const visible = [...nodes].find((node) => node.getClientRects().length > 0)
  visible?.focus()
}

function focusVisibleTester() {
  const nodes = document.querySelectorAll<HTMLElement>('[data-tester-heading="true"]')
  const visible = [...nodes].find((node) => node.getClientRects().length > 0)
  visible?.focus()
}

function focusAfterSave() {
  if (window.matchMedia('(min-width: 900px)').matches) focusVisibleComposer()
  else focusVisibleTester()
}

function App() {
  const [state, setState] = useState<AppState>(() => loadInitialState())
  const agent = state.agent
  const dirty = changesOf(state)
  const selectedVersion = agent.versions.find((version) => version.id === state.selectedVersionId) ?? agent.versions[0]
  const isolatedTester = getAgentBuilderBackendMode() === 'n8n'
  const accountRef = useRef<HTMLDivElement>(null)
  const refineCloseRef = useRef<HTMLButtonElement>(null)
  const focusedOnce = useRef(false)

  useEffect(() => {
    if (!state.refineOpen) return
    const previous = document.activeElement as HTMLElement | null
    refineCloseRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setState((prev) => {
          if (prev.dialog || prev.sheet) return prev
          return { ...prev, refineOpen: false }
        })
        return
      }
      if (event.key !== 'Tab' || state.dialog || state.sheet) return
      const root = document.querySelector<HTMLElement>('.refine-sheet')
      if (!root) return
      const nodes = focusableIn(root)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [state.refineOpen, state.dialog, state.sheet])

  useEffect(() => {
    const persisted = {
      authed: state.authed,
      username: state.username,
      agent: state.agent,
      selectedVersionId: state.selectedVersionId,
      instructionDraft: state.instructionDraft,
      composer: state.composer,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  }, [state.authed, state.username, state.agent, state.selectedVersionId, state.instructionDraft, state.composer])

  useEffect(() => {
    if (!state.authed || focusedOnce.current) return
    focusedOnce.current = true
    if (window.matchMedia('(min-width: 900px)').matches) focusVisibleComposer()
  }, [state.authed])

  useEffect(() => {
    if (!state.authed) return
    let cancelled = false
    void loadAgentBuilderConfig()
      .then((snapshot) => {
        if (cancelled || !snapshot) return
        const remoteVersions = (snapshot.versions.length ? snapshot.versions : [snapshot.activeVersion]).map((version, index) => (
          versionFromRecord(version, version.isActive || index === 0 ? 'Active config' : 'Saved config')
        ))
        setState((prev) => {
          if (prev.saving || prev.pendingSaveId || prev.feedback === 'ready') return prev
          const current = prev.agent
          const localDirty = hasMeaningfulChanges({
            instructionDraft: prev.instructionDraft,
            draftBase: current.draftBase,
            savedBase: current.savedBase,
            draftOpener: current.draftOpener,
            savedOpener: current.savedOpener,
            draftAdditional: current.draftAdditional,
            savedAdditional: current.savedAdditional,
            locked: current.locked,
            savedLocked: current.savedLocked,
          })
          const active = versionFromRecord(snapshot.activeVersion, 'Active config')
          const versions = (remoteVersions.length ? remoteVersions : [active]).sort((a, b) => versionNumber(b.id) - versionNumber(a.id))
          const savedBase = snapshot.activeVersion.masterPrompt
          const savedAdditional = snapshot.activeVersion.additionalInformation ?? ''
          const savedOpener = snapshot.activeVersion.openingMessage ?? ''
          return {
            ...prev,
            historyLimited: versions.length <= 1,
            selectedVersionId: active.id,
            agent: {
              ...current,
              locked: snapshot.locked,
              savedLocked: snapshot.locked,
              savedBase,
              savedAdditional,
              savedOpener,
              draftBase: localDirty ? current.draftBase : savedBase,
              draftAdditional: localDirty ? current.draftAdditional : savedAdditional,
              draftOpener: localDirty ? current.draftOpener : savedOpener,
              activeVersion: active.id,
              versions,
              testingVersionId: prev.versionConfirmed ? current.testingVersionId : null,
            },
          }
        })
      })
      .catch(() => {
        if (cancelled) return
        setState((prev) => ({ ...prev, toast: 'Could not load saved config. Using this device’s copy.' }))
        window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 2200)
      })
    return () => {
      cancelled = true
    }
  }, [state.authed])

  useEffect(() => {
    if (!state.accountOpen) return
    const close = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setState((prev) => ({ ...prev, accountOpen: false }))
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setState((prev) => ({ ...prev, accountOpen: false }))
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [state.accountOpen])

  const patchAgent = (patch: Partial<AgentDraft>, extra?: Partial<AppState>) => {
    setState((prev) => ({
      ...prev,
      ...extra,
      agent: { ...prev.agent, ...patch },
    }))
  }

  const signIn = (event?: FormEvent) => {
    event?.preventDefault()
    const username = state.username.trim()
    if (!username || !state.password.trim()) {
      setState((prev) => ({ ...prev, loginError: 'Enter a username and password to open the workspace.' }))
      return
    }
    if (username !== LOGIN_USERNAME || state.password !== LOGIN_PASSWORD) {
      setState((prev) => ({ ...prev, loginError: 'Incorrect username or password.', password: '' }))
      return
    }
    setState((prev) => ({ ...prev, signingIn: true, loginError: null }))
    window.setTimeout(() => {
      setState((prev) => ({ ...prev, authed: true, signingIn: false, refineOpen: false }))
    }, 520)
  }

  const signOut = () => {
    if (dirty) {
      setState((prev) => ({ ...prev, dialog: { kind: 'sign-out' }, accountOpen: false }))
      return
    }
    setState((prev) => ({ ...prev, authed: false, accountOpen: false, historyOpen: false, refineOpen: false, dialog: null, sheet: null }))
  }

  const runSave = (snapshot: SaveSnapshot, startTest: boolean) => {
    if (state.saving) return
    if (!startTest && !dirty && snapshot.locked === agent.locked) return
    if (startTest && !dirty) return
    const saveRequestId = uid('save')
    setState((prev) => ({ ...prev, saving: true, saveError: null, pendingSaveId: saveRequestId, dialog: null, feedback: 'idle' }))
    const nextNumber = Math.max(0, ...agent.versions.map((version) => versionNumber(version.id))) + 1
    void saveAgentBuilderConfig({
      tenantKey: getK1TenantKey(),
      displayName: 'K1 Katsastus',
      masterPrompt: snapshot.base,
      openingMessage: snapshot.opener,
      additionalInformation: snapshot.additional,
      locked: snapshot.locked,
      versionNumber: nextNumber,
      versionId: `v${nextNumber}`,
    }).then((saved) => {
      let started: { conversationId: string; messages: ChatMessage[] } | null = null
      let testFailed = false
      if (startTest) {
        try {
          started = beginFreshTest(snapshot.opener, uid)
        } catch {
          testFailed = true
        }
      }
      const version = versionFromRecord({ ...saved, openingMessage: snapshot.opener, additionalInformation: snapshot.additional, masterPrompt: snapshot.base }, startTest ? 'Saved config' : 'Locked base prompt')
      setState((prev) => {
        if (prev.pendingSaveId !== saveRequestId) return prev
        const applied = applySavedConfig({
          agent: prev.agent,
          snapshot,
          version,
          current: {
            draftBase: prev.agent.draftBase,
            draftOpener: prev.agent.draftOpener,
            draftAdditional: prev.agent.draftAdditional,
            instructionDraft: prev.instructionDraft,
            locked: prev.agent.locked,
          },
          started,
        })
        return {
          ...prev,
          saving: false,
          saveError: null,
          pendingSaveId: null,
          instructionDraft: applied.instructionDraft,
          agent: startTest && !testFailed ? { ...applied.agent, replyIndex: prev.agent.replyIndex } : applied.agent,
          selectedVersionId: version.id,
          feedback: testFailed ? 'idle' : startTest ? 'ready' : 'locked',
          testError: testFailed ? `${version.id} saved. Could not start a new test.` : null,
          versionConfirmed: false,
          refineOpen: startTest && !testFailed ? false : prev.refineOpen,
          sending: startTest && !testFailed ? false : prev.sending,
          pendingResponseId: startTest && !testFailed ? null : prev.pendingResponseId,
        }
      })
      if (startTest && !testFailed) window.setTimeout(focusAfterSave, 0)
    }).catch(() => {
      setState((prev) => (
        prev.pendingSaveId === saveRequestId
          ? { ...prev, saving: false, pendingSaveId: null, saveError: 'Could not save. Your changes are still here.' }
          : prev
      ))
    })
  }

  const saveAndTest = () => {
    if (state.saving || !dirty) return
    runSave(captureSaveSnapshot({
      draftBase: agent.draftBase,
      draftOpener: agent.draftOpener,
      draftAdditional: agent.draftAdditional,
      instructionDraft: state.instructionDraft,
      locked: agent.locked,
    }), true)
  }

  const saveAndLock = () => {
    if (state.saving) return
    runSave(captureSaveSnapshot({
      draftBase: agent.draftBase,
      draftOpener: agent.draftOpener,
      draftAdditional: agent.draftAdditional,
      instructionDraft: state.instructionDraft,
      locked: agent.locked,
      persistLocked: true,
    }), false)
  }

  const requestLock = () => {
    if (dirty) {
      setState((prev) => ({ ...prev, dialog: { kind: 'save-lock' } }))
      return
    }
    saveAndLock()
  }

  const unlock = () => {
    patchAgent({ locked: false })
  }

  const retryTest = () => {
    if (state.retryingTest || state.saving) return
    setState((prev) => ({ ...prev, retryingTest: true }))
    try {
      const started = beginFreshTest(agent.savedOpener, uid)
      setState((prev) => ({
        ...prev,
        retryingTest: false,
        testError: null,
        feedback: 'ready',
        versionConfirmed: false,
        refineOpen: false,
        sending: false,
        pendingResponseId: null,
        agent: applyFreshTest(prev.agent, started),
      }))
      window.setTimeout(focusAfterSave, 0)
    } catch {
      setState((prev) => ({ ...prev, retryingTest: false }))
    }
  }

  const newTest = () => {
    const started = beginFreshTest(agent.savedOpener, uid)
    setState((prev) => ({
      ...prev,
      testError: null,
      feedback: prev.feedback === 'ready' ? 'idle' : prev.feedback,
      versionConfirmed: false,
      sending: false,
      pendingResponseId: null,
      agent: applyFreshTest(prev.agent, started),
    }))
    window.setTimeout(focusAfterSave, 0)
  }

  const performRestore = (versionId: string) => {
    setState((prev) => {
      const version = prev.agent.versions.find((item) => item.id === versionId)
      if (!version) return prev
      const plan = restorePlan(version, prev.agent.savedBase, prev.agent.locked)
      if (!plan.ok) return { ...prev, toast: 'Unlock the base prompt before restoring a version that changes it.' }
      const notes = [
        typeof version.additionalInformation === 'string' ? null : 'Additional instructions were not in this version and were left unchanged.',
        typeof version.opener === 'string' ? null : 'The opening message was not in this version and was left unchanged.',
        `${version.id} is in the draft. Save & test to use it.`,
      ].filter(Boolean)
      return {
        ...prev,
        historyOpen: false,
        dialog: null,
        selectedVersionId: versionId,
        masterOpen: true,
        openerOpen: typeof version.opener === 'string',
        refineOpen: window.matchMedia('(max-width: 899px)').matches,
        sheet: window.matchMedia('(max-width: 899px)').matches && plan.base !== prev.agent.draftBase
          ? { kind: 'prompt', title: 'Master prompt', value: plan.base, readOnly: false }
          : window.matchMedia('(max-width: 899px)').matches && plan.opener !== undefined && plan.opener !== prev.agent.draftOpener
            ? { kind: 'opener', title: 'Opening message', value: plan.opener, readOnly: false }
            : null,
        toast: notes.join(' '),
        agent: {
          ...prev.agent,
          draftBase: plan.base,
          ...(plan.opener !== undefined ? { draftOpener: plan.opener } : {}),
          ...(plan.additional !== undefined ? { draftAdditional: plan.additional } : {}),
        },
      }
    })
    window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 2800)
  }

  const restoreVersion = (versionId: string) => {
    const version = agent.versions.find((item) => item.id === versionId)
    if (!version) return
    const plan = restorePlan(version, agent.savedBase, agent.locked)
    if (!plan.ok) {
      setState((prev) => ({ ...prev, masterOpen: true, refineOpen: true, toast: 'Unlock the base prompt before restoring a version that changes it.' }))
      window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 2400)
      return
    }
    if (dirty) {
      setState((prev) => ({ ...prev, dialog: { kind: 'restore', versionId } }))
      return
    }
    performRestore(versionId)
  }

  const sendMessage = () => {
    const text = state.composer.trim()
    if (!text || state.sending) return
    const userMessage: ChatMessage = { id: uid('msg'), role: 'user', text }
    const responseRequestId = uid('reply')
    const conversationId = agent.conversationId
    const reply = REPLIES[agent.replyIndex % REPLIES.length]
    const history = [...agent.messages, userMessage]
    setState((prev) => ({
      ...prev,
      composer: '',
      sending: true,
      pendingResponseId: responseRequestId,
      feedback: prev.feedback === 'ready' ? 'idle' : prev.feedback,
      agent: { ...prev.agent, messages: history, replyIndex: prev.agent.replyIndex + 1 },
    }))
    void testAgentBuilderMessage({
      tenantKey: getK1TenantKey(),
      masterPrompt: agent.savedBase,
      additionalInformation: agent.savedAdditional,
      messages: history,
    }, reply).then((result) => {
      setState((prev) => {
        if (!shouldAcceptTestReply({
          responseRequestId,
          pendingResponseId: prev.pendingResponseId,
          responseConversationId: conversationId,
          currentConversationId: prev.agent.conversationId,
        })) return prev
        const confirmedVersion = Number(result.versionNumber)
        const testingVersionId = Number.isInteger(confirmedVersion) && confirmedVersion > 0
          ? `v${confirmedVersion}`
          : null
        return {
          ...prev,
          sending: false,
          pendingResponseId: null,
          versionConfirmed: testingVersionId != null,
          agent: {
            ...prev.agent,
            testingVersionId,
            messages: [...prev.agent.messages, { id: uid('msg'), role: 'agent', text: result.reply, mocked: result.mode === 'demo' }],
          },
        }
      })
    }).catch(() => {
      setState((prev) => {
        if (!shouldAcceptTestReply({
          responseRequestId,
          pendingResponseId: prev.pendingResponseId,
          responseConversationId: conversationId,
          currentConversationId: prev.agent.conversationId,
        })) return prev
        return { ...prev, sending: false, pendingResponseId: null, toast: 'Test reply failed. Your message is still in the thread.' }
      })
      window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 2200)
    })
  }

  const onComposerKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.text)
      setState((prev) => ({ ...prev, copiedMessageId: message.id }))
      window.setTimeout(() => setState((prev) => ({ ...prev, copiedMessageId: null })), 1200)
    } catch {
      setState((prev) => ({ ...prev, toast: 'Could not copy in this browser.' }))
      window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 1800)
    }
  }

  const useLastQuestion = () => {
    const question = lastCustomerQuestion(agent.previousTest?.messages ?? [])
    if (!question) return
    if (state.composer.trim()) {
      setState((prev) => ({ ...prev, dialog: { kind: 'use-last-question' } }))
      return
    }
    setState((prev) => ({ ...prev, composer: question }))
    window.setTimeout(focusVisibleComposer, 0)
  }

  const dialogContent = useMemo(() => {
    const dialog = state.dialog
    if (!dialog) return null
    if (dialog.kind === 'discard') {
      return {
        title: 'Discard unsaved changes?',
        body: 'Additional information, opening message, and base-prompt edits that are not saved will be reverted. The current test is unchanged.',
        confirm: 'Discard changes',
      }
    }
    if (dialog.kind === 'save-lock') {
      return {
        title: 'Save changes before locking?',
        body: 'Locking stops direct editing of the base master prompt. Additional information, testing, and version history stay available. Save and lock stores the current edits as a new version, then locks the base.',
        confirm: 'Save and lock',
      }
    }
    if (dialog.kind === 'sign-out') {
      return {
        title: 'Sign out with unsaved changes?',
        body: 'These edits have not been saved as a new version. Cancel to keep working, or sign out without saving.',
        confirm: 'Sign out',
      }
    }
    if (dialog.kind === 'use-last-question') {
      return {
        title: 'Replace the typed message?',
        body: 'Use last question replaces the text already in the composer. It is not sent until you send it.',
        confirm: 'Replace message',
      }
    }
    const version = agent.versions.find((item) => item.id === dialog.versionId)
    return {
      title: 'Replace the current draft?',
      body: version
        ? `Restoring loads ${versionScope(version)} into the draft for review. It does not become the saved agent until you Save & test. Unsaved edits will be replaced.`
        : 'Restoring loads this version into the draft. It is not saved until you Save & test.',
      confirm: 'Restore to draft',
    }
  }, [agent.versions, state.dialog])

  const confirmDialog = () => {
    const dialog = state.dialog
    if (!dialog) return
    if (dialog.kind === 'discard') {
      setState((prev) => ({
        ...prev,
        dialog: null,
        saveError: null,
        instructionDraft: '',
        agent: {
          ...prev.agent,
          draftBase: prev.agent.savedBase,
          draftOpener: prev.agent.savedOpener,
          draftAdditional: prev.agent.savedAdditional,
          locked: prev.agent.savedLocked,
        },
      }))
    }
    if (dialog.kind === 'save-lock') saveAndLock()
    if (dialog.kind === 'sign-out') setState((prev) => ({ ...prev, authed: false, historyOpen: false, dialog: null, sheet: null, refineOpen: false, accountOpen: false }))
    if (dialog.kind === 'restore') performRestore(dialog.versionId)
    if (dialog.kind === 'use-last-question') {
      const question = lastCustomerQuestion(agent.previousTest?.messages ?? [])
      setState((prev) => ({ ...prev, dialog: null, composer: question || prev.composer }))
      window.setTimeout(focusVisibleComposer, 0)
    }
  }

  const statusText = state.saving
    ? 'Saving…'
    : state.saveError
      ? state.saveError
      : dirty
        ? 'Not saved yet.'
        : state.testError
          ? state.testError
          : state.feedback === 'ready'
            ? 'Saved. New test ready.'
            : 'Saved'

  const contextLabel = isolatedTester && agent.testingVersionId
    ? `Testing ${agent.testingVersionId}`
    : `Last saved version: ${agent.activeVersion}`

  if (!state.authed) {
    return <AuthScreen state={state} setState={setState} signIn={signIn} />
  }

  const refinement = (
    <RefinementPanel
      state={state}
      dirty={dirty}
      statusText={statusText}
      setState={setState}
      onSaveAndTest={saveAndTest}
      onDiscard={() => setState((prev) => ({ ...prev, dialog: { kind: 'discard' } }))}
      onTogglePanel={() => setState((prev) => ({ ...prev, panelExpanded: !prev.panelExpanded }))}
      onLock={requestLock}
      onUnlock={unlock}
    />
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <Brand />
          <span className="divider" />
          <div className="agent-lockup">
            <span className="agent-avatar">K</span>
            <span className="agent-name">K1 Katsastus assistant</span>
          </div>
        </div>
        <div className="topbar-right">
          <button className="secondary-button history-trigger" onClick={() => setState((prev) => ({ ...prev, historyOpen: true, selectedVersionId: prev.agent.activeVersion, accountOpen: false }))}>
            <HistoryIcon /><span>Versions</span>
          </button>
          <div className="account-menu" ref={accountRef}>
            <button className="account-button" aria-haspopup="menu" aria-expanded={state.accountOpen} onClick={() => setState((prev) => ({ ...prev, accountOpen: !prev.accountOpen }))}>
              <span>K</span>Account
            </button>
            {state.accountOpen && (
              <div className="account-popover" role="menu">
                <button role="menuitem" onClick={signOut}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={state.panelExpanded ? 'workspace workspace--expanded' : 'workspace'}>
        <section className="refine-panel desktop-pane">{refinement}</section>
        <section className="playground-panel desktop-pane">
          <Tester
            state={state}
            dirty={dirty}
            contextLabel={contextLabel}
            isolatedTester={isolatedTester}
            setState={setState}
            onNewTest={newTest}
            onRetryTest={retryTest}
            onSend={sendMessage}
            onComposerKey={onComposerKey}
            onCopy={copyMessage}
            onUseLastQuestion={useLastQuestion}
            onRefine={() => setState((prev) => ({ ...prev, refineOpen: true }))}
          />
        </section>
        <section className="mobile-shell">
          <Tester
            compact
            state={state}
            dirty={dirty}
            contextLabel={contextLabel}
            isolatedTester={isolatedTester}
            setState={setState}
            onNewTest={newTest}
            onRetryTest={retryTest}
            onSend={sendMessage}
            onComposerKey={onComposerKey}
            onCopy={copyMessage}
            onUseLastQuestion={useLastQuestion}
            onRefine={() => setState((prev) => ({ ...prev, refineOpen: true }))}
          />
        </section>
      </main>

      {state.refineOpen && (
        <div className="refine-sheet mobile-only" role="presentation">
          <div className="refine-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="refine-title">
            <header className="refine-sheet__bar">
              <h2 id="refine-title">Refine agent</h2>
              <button ref={refineCloseRef} className="secondary-button" type="button" onClick={() => setState((prev) => ({ ...prev, refineOpen: false }))}>Close</button>
            </header>
            {refinement}
          </div>
        </div>
      )}

      {state.historyOpen && selectedVersion && (
        <VersionHistory
          versions={agent.versions}
          activeVersion={agent.activeVersion}
          selectedVersion={selectedVersion}
          historyLimited={state.historyLimited}
          onClose={() => setState((prev) => ({ ...prev, historyOpen: false }))}
          onSelect={(versionId) => setState((prev) => ({ ...prev, selectedVersionId: versionId }))}
          onRestore={restoreVersion}
        />
      )}

      {state.dialog && dialogContent && (
        <ConfirmDialog
          title={dialogContent.title}
          body={dialogContent.body}
          confirmLabel={dialogContent.confirm}
          loading={state.saving}
          onCancel={() => setState((prev) => ({ ...prev, dialog: null }))}
          onConfirm={confirmDialog}
        />
      )}

      {state.sheet && (
        <FieldSheet
          sheet={state.sheet}
          locked={agent.locked}
          onChange={(value) => setState((prev) => ({ ...prev, sheet: prev.sheet ? { ...prev.sheet, value } : null }))}
          onCancel={() => setState((prev) => ({ ...prev, sheet: null }))}
          onDone={() => {
            if (!state.sheet || state.sheet.readOnly) {
              setState((prev) => ({ ...prev, sheet: null }))
              return
            }
            const sheet = state.sheet
            patchAgent(sheet.kind === 'opener' ? { draftOpener: sheet.value } : { draftBase: sheet.value }, { sheet: null })
          }}
          onUnlock={() => setState((prev) => ({
            ...prev,
            agent: { ...prev.agent, locked: false },
            sheet: prev.sheet?.kind === 'prompt' ? { ...prev.sheet, readOnly: false } : prev.sheet,
          }))}
        />
      )}

      <AnimatePresence>
        {state.toast && (
          <motion.div className="toast" role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2, ease }}>
            {state.toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AuthScreen({ state, setState, signIn }: {
  state: AppState
  setState: Dispatch<SetStateAction<AppState>>
  signIn: (event?: FormEvent) => void
}) {
  return (
    <main className="auth-shell">
      <header className="auth-header"><Brand /></header>
      <motion.form className="auth-card" onSubmit={signIn} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.34, ease }}>
        <div className="auth-copy">
          <p className="microcopy">K1 Katsastus assistant</p>
          <h1>Welcome back</h1>
          <p>Test the saved agent, describe what it should do differently, then save and try again.</p>
        </div>
        <label className="field">
          <span>Username</span>
          <input value={state.username} autoComplete="username" onChange={(event) => setState((prev) => ({ ...prev, username: event.target.value }))} placeholder="username" />
        </label>
        <label className="field">
          <span>Password</span>
          <span className="password-field">
            <input value={state.password} autoComplete="current-password" onChange={(event) => setState((prev) => ({ ...prev, password: event.target.value }))} type={state.showPassword ? 'text' : 'password'} placeholder="password" />
            <button type="button" onClick={() => setState((prev) => ({ ...prev, showPassword: !prev.showPassword }))}>{state.showPassword ? 'Hide' : 'Show'}</button>
          </span>
        </label>
        <AnimatePresence>
          {state.loginError && <motion.div className="inline-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{state.loginError}</motion.div>}
        </AnimatePresence>
        <motion.button className="primary-button auth-button" type="submit" disabled={state.signingIn} whileTap={{ scale: 0.985 }}>
          {state.signingIn && <Spinner />}
          {state.signingIn ? 'Opening agent' : 'Continue'}
        </motion.button>
      </motion.form>
    </main>
  )
}

function RefinementPanel({ state, dirty, statusText, setState, onSaveAndTest, onDiscard, onTogglePanel, onLock, onUnlock }: {
  state: AppState
  dirty: boolean
  statusText: string
  setState: Dispatch<SetStateAction<AppState>>
  onSaveAndTest: () => void
  onDiscard: () => void
  onTogglePanel: () => void
  onLock: () => void
  onUnlock: () => void
}) {
  const agent = state.agent
  const additionalPreview = agent.draftAdditional.trim()
  const openerPreview = renderWithSampleData(agent.draftOpener).trim()
  const openerDirty = agent.draftOpener !== agent.savedOpener

  return (
    <div className="refine-content">
      <div className="refine-body">
      <section className="refine-block">
        <div className="field-header">
          <div>
            <h2>Additional information</h2>
            <p>Tell the agent what to do differently.</p>
          </div>
          <button className="secondary-button refine-expand" type="button" onClick={onTogglePanel}>
            {state.panelExpanded ? 'Collapse panel' : 'Expand panel'}
          </button>
        </div>
        <textarea
          className="instruction-input"
          aria-label="Additional information"
          value={state.instructionDraft}
          onChange={(event) => setState((prev) => ({ ...prev, instructionDraft: event.target.value, saveError: null }))}
          placeholder="Describe what the agent should know or do differently…"
        />
        <p className="example-hint">Example: Saturday bookings are Monday to Friday only.</p>
      </section>

      <section className={`disclosure ${state.masterOpen ? 'open' : ''}`}>
        <div className="disclosure-bar">
          <button type="button" className="disclosure-toggle" aria-expanded={state.masterOpen} onClick={() => setState((prev) => ({ ...prev, masterOpen: !prev.masterOpen }))}>
            <ChevronIcon />
            <span>Master prompt</span>
            <em>{agent.locked ? 'Locked' : 'Unlocked'}</em>
          </button>
          {agent.locked
            ? <button type="button" className="secondary-button" onClick={onUnlock}>Unlock full editor</button>
            : <button type="button" className="secondary-button" onClick={onLock} disabled={state.saving}><LockIcon />Lock base prompt</button>}
        </div>
        {state.masterOpen && (
          <div className="disclosure-body">
            <div className="saved-extra">
              <span>{agent.draftAdditional === agent.savedAdditional ? 'Saved additional instructions' : 'Additional instructions in this draft'}</span>
              {additionalPreview ? <pre>{agent.draftAdditional.trim()}</pre> : <p>None saved yet.</p>}
              <p>The tester appends these after the base prompt. Older instructions stay until you edit them here.</p>
            </div>
            <div className="field-header">
              <h3>{agent.locked ? 'Base prompt preview' : 'Base prompt'}</h3>
              <span className="char-count">{agent.draftBase.length.toLocaleString()} chars</span>
            </div>
            {agent.locked ? (
              <pre className="prompt-preview">{agent.draftBase}</pre>
            ) : (
              <textarea className="prompt-input" aria-label="Base master prompt" value={agent.draftBase} onChange={(event) => setState((prev) => ({ ...prev, agent: { ...prev.agent, draftBase: event.target.value }, saveError: null }))} />
            )}
            <button type="button" className="secondary-button mobile-editor-link" onClick={() => setState((prev) => ({ ...prev, sheet: { kind: 'prompt', title: 'Master prompt', value: agent.draftBase, readOnly: agent.locked } }))}>
              {agent.locked ? 'Open read-only prompt' : 'Open full editor'}
            </button>
          </div>
        )}
      </section>

      <section className={`disclosure ${state.openerOpen ? 'open' : ''}`}>
        <div className="disclosure-bar">
          <button type="button" className="disclosure-toggle" aria-expanded={state.openerOpen} onClick={() => setState((prev) => ({ ...prev, openerOpen: !prev.openerOpen }))}>
            <ChevronIcon />
            <span>Opening message</span>
          </button>
        </div>
        {state.openerOpen && (
          <div className="disclosure-body">
            <textarea className="opener-input" aria-label="Opening message" value={agent.draftOpener} onChange={(event) => setState((prev) => ({ ...prev, agent: { ...prev.agent, draftOpener: event.target.value }, saveError: null }))} />
            <div className="opening-preview">
              <span>{openerDirty ? 'Draft preview' : 'Saved preview'}</span>
              <small>Sample data: first_name = Rasmus · registration_number = ABC-123</small>
              {openerPreview ? <p>{openerPreview}</p> : <p className="empty-preview">No opening message. A new test starts when the first customer message is sent.</p>}
            </div>
            <button type="button" className="secondary-button mobile-editor-link" onClick={() => setState((prev) => ({ ...prev, sheet: { kind: 'opener', title: 'Opening message', value: agent.draftOpener, readOnly: false } }))}>
              Edit in full screen
            </button>
          </div>
        )}
      </section>
      </div>
      <div className="savebar">
        {(dirty || state.saving || state.saveError) && (
          <div className="savebar-actions">
            {dirty && (
              <button className="secondary-button" type="button" onClick={onDiscard} disabled={state.saving}>Discard</button>
            )}
            <button className="primary-button save-test-button" type="button" onClick={onSaveAndTest} disabled={!dirty || state.saving}>
              {state.saving && <Spinner />}
              {state.saving ? 'Saving…' : state.saveError ? 'Retry save' : 'Save & test'}
            </button>
          </div>
        )}
        <p className={`save-state ${state.saveError ? 'error' : state.saving ? 'saving' : dirty ? 'draft' : 'saved'}`} role="status"><span />{statusText}</p>
        {dirty && !state.saving && !state.saveError && <p className="save-help">Saves a new version and starts a fresh test.</p>}
      </div>
    </div>
  )
}

function Tester({ state, dirty, contextLabel, isolatedTester, compact = false, setState, onNewTest, onRetryTest, onSend, onComposerKey, onCopy, onUseLastQuestion, onRefine }: {
  state: AppState
  dirty: boolean
  contextLabel: string
  isolatedTester: boolean
  compact?: boolean
  setState: Dispatch<SetStateAction<AppState>>
  onNewTest: () => void
  onRetryTest: () => void
  onSend: () => void
  onComposerKey: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onCopy: (message: ChatMessage) => void
  onUseLastQuestion: () => void
  onRefine: () => void
}) {
  const reducedMotion = useReducedMotion()
  const agent = state.agent
  const previousQuestion = lastCustomerQuestion(agent.previousTest?.messages ?? [])
  const ready = state.feedback === 'ready' && !dirty && !state.testError
  const usesSample = agent.messages.some((message) => message.sample)

  return (
    <div className={`playground-content ${compact ? 'compact' : ''}`}>
      <div className="context-row">
        <span className="tester-title" tabIndex={-1} data-tester-heading="true">
          <span className="tester-k" aria-hidden="true">K</span>
          <span className="tester-meta">
            <strong>Agent tester</strong>
            <em>{contextLabel}</em>
          </span>
        </span>
        <span className="tester-actions">
          {compact && (
            <button className="secondary-button" type="button" onClick={onRefine} aria-label={dirty ? 'Refine agent, unsaved changes' : 'Refine agent'}>
              Refine agent
              {dirty && <i className="pending-dot" aria-hidden="true" />}
            </button>
          )}
          <button className="secondary-button" type="button" onClick={onNewTest} aria-label="Start a new test">New test</button>
        </span>
      </div>
      {usesSample && <p className="sample-note">Sample customer: Rasmus · ABC-123</p>}
      {dirty && <div className="draft-banner">Unsaved refinements are not included in this test.</div>}
      {ready && <div className="success-banner" role="status"><span><i className="dot" />{agent.testingVersionId && isolatedTester ? `${agent.testingVersionId} saved · Ready to test.` : `${agent.activeVersion} saved · Ready to test.`}</span></div>}
      {state.testError && (
        <div className="error-banner" role="status">
          <span>{state.testError}</span>
          <button className="secondary-button" type="button" onClick={onRetryTest} disabled={state.retryingTest}>{state.retryingTest ? 'Retrying…' : 'Retry test'}</button>
        </div>
      )}
      <div className="messages" aria-live="polite">
        {agent.previousTest && (
          <details className="previous-test">
            <summary>Previous test</summary>
            <div className="previous-log">
              {agent.previousTest.messages.map((message) => (
                <p key={message.id} className={message.role}>{message.text}</p>
              ))}
            </div>
            {previousQuestion && <button type="button" className="secondary-button" onClick={onUseLastQuestion}>Use last question</button>}
          </details>
        )}
        {agent.messages.length === 0 && (
          <div className="empty-thread">
            <strong>No opening message is saved.</strong>
            <span>Send a test message to start the thread.</span>
          </div>
        )}
        <AnimatePresence initial={false}>
          {agent.messages.map((message) => (
            <motion.article
              key={message.id}
              className={`message ${message.role}`}
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reducedMotion ? 0.01 : 0.2, ease }}
            >
              <div>{message.text}</div>
              {message.mocked && <span className="mock-tag">Mocked</span>}
              {message.role === 'agent' && (
                <button className="message-action" type="button" onClick={() => onCopy(message)} aria-label={state.copiedMessageId === message.id ? 'Copied' : 'Copy reply'}><CopyIcon />{state.copiedMessageId === message.id ? 'Copied' : 'Copy'}</button>
              )}
            </motion.article>
          ))}
        </AnimatePresence>
        {state.sending && <TypingDots />}
      </div>
      <div className="composer-wrap">
        <div className="composer">
          <textarea
            data-composer="true"
            value={state.composer}
            onChange={(event) => setState((prev) => ({ ...prev, composer: event.target.value }))}
            onKeyDown={onComposerKey}
            placeholder="Ask the saved agent a test question…"
            aria-label="Test message"
          />
          <motion.button className="send-button" type="button" onClick={onSend} disabled={!state.composer.trim() || state.sending} whileTap={{ scale: 0.94 }} aria-label="Send message">
            <ArrowUpIcon />
          </motion.button>
        </div>
        <p>{isolatedTester
          ? 'Last saved version only. Nothing is sent to customers.'
          : 'Mocked replies. Nothing is sent to customers.'}
        </p>
      </div>
    </div>
  )
}

function VersionHistory({ versions, activeVersion, selectedVersion, historyLimited, onClose, onSelect, onRestore }: {
  versions: PromptVersion[]
  activeVersion: string
  selectedVersion: PromptVersion
  historyLimited: boolean
  onClose: () => void
  onSelect: (versionId: string) => void
  onRestore: (versionId: string) => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [leaving, setLeaving] = useState(false)
  const startClose = () => {
    if (leaving) return
    setLeaving(true)
    window.setTimeout(onClose, 220)
  }
  const { rootRef, requestClose } = useOverlayChrome(startClose)
  useEffect(() => { closeRef.current?.focus() }, [])
  return (
    <motion.div
      ref={rootRef}
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.2, ease }}
      style={leaving ? { pointerEvents: 'none' } : undefined}
      onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}
    >
      <motion.aside className="history-drawer" role="dialog" aria-modal="true" aria-labelledby="versions-title" initial={{ x: '100%' }} animate={{ x: leaving ? '100%' : 0 }} transition={{ duration: 0.22, ease }}>
        <header>
          <h2 id="versions-title">Versions</h2>
          <button ref={closeRef} className="icon-button" type="button" onClick={requestClose} aria-label="Close versions"><CloseIcon /></button>
        </header>
        {historyLimited && <p className="history-note">Only the current saved version is available. Older versions appear here when they can be loaded.</p>}
        <div className="version-list">
          {versions.map((version) => (
            <button key={version.id} type="button" className={version.id === selectedVersion.id ? 'version-row active' : 'version-row'} onClick={() => onSelect(version.id)}>
              <span><strong>{version.id}</strong><em>{version.id === activeVersion ? version.meta : version.meta.replace(' · Active config', '')}</em></span>
              {version.id === activeVersion ? <small>Active</small> : <small>View</small>}
            </button>
          ))}
        </div>
        <section className="version-preview">
          <p>Read-only preview. Selecting a version does not change the saved agent.</p>
          <p>{versionScope(selectedVersion)}</p>
          {typeof selectedVersion.opener === 'string' ? (
            <div className="version-opener"><span>Opening message</span><p>{renderWithSampleData(selectedVersion.opener) || 'Empty opening message.'}</p></div>
          ) : (
            <div className="version-opener muted"><span>Opening message</span><p>Not stored on this version. Restoring it leaves the current opening message unchanged.</p></div>
          )}
          {typeof selectedVersion.additionalInformation === 'string' ? (
            <div className="version-opener"><span>Additional instructions</span><p>{selectedVersion.additionalInformation.trim() || 'None on this version.'}</p></div>
          ) : (
            <div className="version-opener muted"><span>Additional instructions</span><p>Not stored separately. The base prompt is shown as it was saved. Restoring it does not change current additional instructions.</p></div>
          )}
          <pre>{selectedVersion.prompt}</pre>
        </section>
        <footer>
          <button className="secondary-button" type="button" onClick={requestClose}>Close</button>
          <button className="primary-button" type="button" onClick={() => onRestore(selectedVersion.id)}>Restore {selectedVersion.id}</button>
        </footer>
      </motion.aside>
    </motion.div>
  )
}

function ConfirmDialog({ title, body, confirmLabel, loading, onCancel, onConfirm }: {
  title: string
  body: string
  confirmLabel: string
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const { rootRef, requestClose } = useOverlayChrome(onCancel)
  useEffect(() => { cancelRef.current?.focus() }, [])
  return (
    <motion.div
      ref={rootRef}
      className="modal-backdrop"
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}
      onKeyDown={(event) => { if (event.key === 'Escape') requestClose() }}
    >
      <motion.div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-body" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.2, ease }}>
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-body">{body}</p>
        <div>
          <button className="secondary-button" type="button" ref={cancelRef} onClick={requestClose}>Cancel</button>
          <button className="primary-button" type="button" onClick={onConfirm} disabled={loading}>{loading && <Spinner />}{confirmLabel}</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function FieldSheet({ sheet, locked, onChange, onCancel, onDone, onUnlock }: {
  sheet: SheetState
  locked: boolean
  onChange: (value: string) => void
  onCancel: () => void
  onDone: () => void
  onUnlock: () => void
}) {
  const openerPreview = sheet.kind === 'opener' ? renderWithSampleData(sheet.value).trim() : ''
  const cancelRef = useRef<HTMLButtonElement>(null)
  const { rootRef, requestClose } = useOverlayChrome(onCancel)
  useEffect(() => { cancelRef.current?.focus() }, [])
  return (
    <motion.div ref={rootRef} className="field-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.2, ease }}>
      <header>
        <button ref={cancelRef} type="button" onClick={requestClose}>Cancel</button>
        <h2 id="sheet-title">{sheet.title}</h2>
        <button type="button" onClick={onDone}>{sheet.readOnly ? 'Close' : 'Done'}</button>
      </header>
      {sheet.kind === 'opener' && (
        <div className="sheet-preview">
          <span>Draft preview · sample data</span>
          <small>first_name = Rasmus · registration_number = ABC-123</small>
          {openerPreview ? <p>{openerPreview}</p> : <p className="empty-preview">No opening message. A new test starts when the first customer message is sent.</p>}
        </div>
      )}
      {sheet.kind === 'prompt' && locked && (
        <div className="sheet-lock-row">
          <span>The base prompt is locked. Additional information stays editable from Refine agent.</span>
          <button type="button" className="secondary-button" onClick={onUnlock}>Unlock full editor</button>
        </div>
      )}
      <textarea aria-label={sheet.title} value={sheet.value} readOnly={sheet.readOnly} onChange={(event) => onChange(event.target.value)} />
      <footer>
        <span>{sheet.readOnly ? 'Read-only preview.' : sheet.kind === 'opener' ? 'Done keeps this opening message in the draft.' : 'Done keeps this base prompt in the draft.'}</span>
        <span>{sheet.value.length.toLocaleString()} chars</span>
      </footer>
    </motion.div>
  )
}

function Brand() {
  return <div className="brand"><span>w</span><strong>wasup</strong></div>
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}

function TypingDots() {
  return <motion.div className="typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><span /><span /><span /></motion.div>
}

function Svg(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...props} />
}

function ChevronIcon() { return <Svg><path d="M4 6.25 8 10l4-3.75" /></Svg> }
function HistoryIcon() { return <Svg><circle cx="8" cy="8" r="5.4" /><path d="M8 5v3.1l2.2 1.3" /></Svg> }
function LockIcon() { return <Svg><rect x="3.6" y="7" width="8.8" height="6.2" rx="1.6" /><path d="M5.8 7V5.3a2.2 2.2 0 0 1 4.4 0V7" /></Svg> }
function CopyIcon() { return <Svg><rect x="5.4" y="5.4" width="7" height="7" rx="1.5" /><path d="M10.2 5.4v-.8a1.1 1.1 0 0 0-1.1-1.1H4.6a1.1 1.1 0 0 0-1.1 1.1v4.5a1.1 1.1 0 0 0 1.1 1.1h.8" /></Svg> }
function CloseIcon() { return <Svg><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></Svg> }
function ArrowUpIcon() { return <Svg><path d="M8 13V4M8 4 4.4 7.6M8 4l3.6 3.6" /></Svg> }

export default App
