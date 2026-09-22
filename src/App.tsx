import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { FormEvent, KeyboardEvent, SVGProps, useEffect, useMemo, useState } from 'react'
import { getK1TenantKey, loadAgentBuilderConfig, saveAgentBuilderConfig, testAgentBuilderMessage, type AgentBuilderVersionRecord } from './lib/agentBuilderService'

type InstanceName = 'Original' | 'Copy'
type Role = 'agent' | 'user'
type MobileTab = 'edit' | 'playground'
type ConfigTab = 'prompt' | 'opening'
type SheetKind = 'opener' | 'prompt'

type Message = {
  id: string
  role: Role
  text: string
}

type Version = {
  id: string
  meta: string
  prompt: string
  opener?: string
}

type AgentInstance = {
  locked: boolean
  conversationId: string
  savedPrompt: string
  savedOpener: string
  draftPrompt: string
  draftOpener: string
  versions: Version[]
  activeVersion: string
  messages: Message[]
  replyIndex: number
  savedBanner: string | null
}

type DialogState =
  | { kind: 'save-lock' }
  | { kind: 'sign-out' }
  | { kind: 'restore'; versionId: string }

type SheetState = {
  kind: SheetKind
  title: string
  value: string
}

type AppState = {
  authed: boolean
  username: string
  password: string
  showPassword: boolean
  signingIn: boolean
  loginError: string | null
  instance: InstanceName
  instances: Record<InstanceName, AgentInstance>
  historyOpen: boolean
  selectedVersionId: string
  mobileTab: MobileTab
  configTab: ConfigTab
  instructionDraft: string
  applyingAI: boolean
  saving: boolean
  saveError: string | null
  pendingSaveId: string | null
  composer: string
  sending: boolean
  pendingResponseId: string | null
  dialog: DialogState | null
  sheet: SheetState | null
  copiedMessageId: string | null
  toast: string | null
}

const STORAGE_KEY = 'wasup-agent-builder-v1'
const ease = [0.16, 1, 0.3, 1] as const
const LOGIN_USERNAME = 'K1Admin'
const LOGIN_PASSWORD = 'Wasup@123'

// Legacy demo values are used only to migrate exact old defaults.
// They must not be applied to arbitrary user-saved/custom prompts.
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

const OLD_OPENER = 'Hi Bashir — ready to plan your trip?'
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

function renderWithSampleData(value: string) {
  return value
    .replace(/{{\s*first[-_\s]?name\s*}}/gi, 'Bashir')
    .replace(/{{\s*registration[-_\s]?number\s*}}/gi, 'ABC-123')
}

function renderOpener(opener: string) {
  return renderWithSampleData(opener)
}

function migrateDefaultPrompt(value: string) {
  if (value === OLD_BASE_PROMPT) return BASE_PROMPT
  if (value === OLD_PROMPT_V29) return PROMPT_V29
  if (value === OLD_PROMPT_V28) return PROMPT_V28
  if (value.startsWith(`${OLD_BASE_PROMPT}\n\nAdditional guidance:`)) {
    return value.replace(OLD_BASE_PROMPT, BASE_PROMPT)
  }
  if (value.startsWith(`${OLD_PROMPT_V29}\n\nAdditional guidance:`)) {
    return value.replace(OLD_PROMPT_V29, PROMPT_V29)
  }
  if (value.startsWith(`${OLD_PROMPT_V28}\n\nAdditional guidance:`)) {
    return value.replace(OLD_PROMPT_V28, PROMPT_V28)
  }
  return value
}

function migrateDefaultOpener(value: string) {
  if (value === OLD_OPENER || value === OLD_VARIABLE_OPENER) return OPENER
  if (value === 'Hello Bashir, I can help plan a winter trip.') {
    return 'Hi {{first_name}}, this is K1 Katsastus. I can help book a vehicle inspection for {{registration_number}}.'
  }
  return value
}

function migrateDefaultMessage(value: string) {
  if (value === renderWithSampleData(OLD_OPENER) || value === renderWithSampleData(OLD_VARIABLE_OPENER)) {
    return renderWithSampleData(OPENER)
  }
  const oldReplyIndex = OLD_REPLIES.indexOf(value)
  return oldReplyIndex >= 0 ? REPLIES[oldReplyIndex] : value
}

function starterMessages(opener: string): Message[] {
  const text = renderOpener(opener).trim()
  return text ? [{ id: uid('msg'), role: 'agent', text }] : []
}

function makeInstance(seed: number): AgentInstance {
  return {
    locked: false,
    conversationId: uid('thread'),
    savedPrompt: BASE_PROMPT,
    savedOpener: OPENER,
    draftPrompt: BASE_PROMPT,
    draftOpener: OPENER,
    versions: [
      { id: 'v30', meta: '21 Sep, 14:02 · Shorter answers', prompt: BASE_PROMPT, opener: OPENER },
      { id: 'v29', meta: '20 Sep, 09:41 · Handoff rule', prompt: PROMPT_V29, opener: OPENER },
      { id: 'v28', meta: '18 Sep, 16:20 · Initial context', prompt: PROMPT_V28, opener: 'Hi {{first_name}}, this is K1 Katsastus. I can help book a vehicle inspection for {{registration_number}}.' },
    ],
    activeVersion: 'v30',
    messages: starterMessages(OPENER),
    replyIndex: seed,
    savedBanner: null,
  }
}

function normalizeInstance(instance: AgentInstance): AgentInstance {
  return {
    ...instance,
    conversationId: instance.conversationId ?? uid('thread'),
    savedPrompt: migrateDefaultPrompt(instance.savedPrompt),
    draftPrompt: migrateDefaultPrompt(instance.draftPrompt),
    savedOpener: migrateDefaultOpener(instance.savedOpener),
    draftOpener: migrateDefaultOpener(instance.draftOpener),
    versions: instance.versions.map((version) => ({
      ...version,
      prompt: migrateDefaultPrompt(version.prompt),
      opener: typeof version.opener === 'string' ? migrateDefaultOpener(version.opener) : version.opener,
    })),
    messages: instance.messages.map((message) => ({
      ...message,
      text: migrateDefaultMessage(message.text),
    })),
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
    instance: 'Original',
    instances: {
      Original: makeInstance(0),
      Copy: makeInstance(2),
    },
    historyOpen: false,
    selectedVersionId: 'v30',
    mobileTab: 'edit',
    configTab: 'prompt',
    instructionDraft: '',
    applyingAI: false,
    saving: false,
    saveError: null,
    pendingSaveId: null,
    composer: '',
    sending: false,
    pendingResponseId: null,
    dialog: null,
    sheet: null,
    copiedMessageId: null,
    toast: null,
  }
}

function loadInitialState(): AppState {
  if (typeof window === 'undefined') return initialState()
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return initialState()
    const parsed = JSON.parse(saved) as Partial<AppState>
    const fresh = initialState()
    const merged = {
      ...fresh,
      ...parsed,
      signingIn: false,
      applyingAI: false,
      saving: false,
      saveError: null,
      pendingSaveId: null,
      sending: false,
      pendingResponseId: null,
      historyOpen: false,
      dialog: null,
      sheet: null,
      copiedMessageId: null,
      toast: null,
    }
    return {
      ...merged,
      instances: {
        Original: normalizeInstance({ ...fresh.instances.Original, ...(merged.instances?.Original ?? {}) }),
        Copy: normalizeInstance({ ...fresh.instances.Copy, ...(merged.instances?.Copy ?? {}) }),
      },
    }
  } catch {
    return initialState()
  }
}

function nextVersionId(versions: Version[]) {
  const highest = versions.reduce((max, version) => {
    const numeric = Number(version.id.replace(/^v/, ''))
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max
  }, 0)
  return `v${highest + 1}`
}

function saveStateClass(state: AppState, dirty: boolean) {
  if (state.saveError) return 'error'
  if (state.saving) return 'saving'
  return dirty ? 'draft' : 'saved'
}

function saveStateText(state: AppState, dirty: boolean) {
  if (state.saveError) return state.saveError
  if (state.saving) return 'Saving…'
  return dirty ? 'Draft not saved' : 'Saved'
}

function versionFromRecord(record: AgentBuilderVersionRecord, label = 'Loaded config'): Version {
  return {
    id: `v${record.versionNumber}`,
    meta: `${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(record.createdAt))} · ${label}`,
    prompt: record.masterPrompt,
    opener: record.openingMessage,
  }
}

function App() {
  const [state, setState] = useState<AppState>(() => loadInitialState())
  const current = state.instances[state.instance]
  const dirty = current.draftPrompt !== current.savedPrompt || current.draftOpener !== current.savedOpener
  const selectedVersion = current.versions.find((version) => version.id === state.selectedVersionId) ?? current.versions[0]

  useEffect(() => {
    const persisted: AppState = {
      ...state,
      signingIn: false,
      applyingAI: false,
      saving: false,
      sending: false,
      historyOpen: false,
      dialog: null,
      sheet: null,
      copiedMessageId: null,
      toast: null,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  }, [state])

  useEffect(() => {
    if (!state.authed) return
    let cancelled = false

    void loadAgentBuilderConfig()
      .then((snapshot) => {
        if (cancelled || !snapshot) return
        const activeVersion = versionFromRecord(snapshot.activeVersion)
        const versions = snapshot.versions.length
          ? snapshot.versions.map((version) => versionFromRecord(version, version.isActive ? 'Active config' : 'Saved config'))
          : [activeVersion]

        setState((prev) => {
          const instance = prev.instances[prev.instance]
          return {
            ...prev,
            selectedVersionId: activeVersion.id,
            instances: {
              ...prev.instances,
              [prev.instance]: {
                ...instance,
                locked: snapshot.locked,
                savedPrompt: snapshot.activeVersion.masterPrompt,
                savedOpener: snapshot.activeVersion.openingMessage ?? '',
                draftPrompt: snapshot.activeVersion.masterPrompt,
                draftOpener: snapshot.activeVersion.openingMessage ?? '',
                activeVersion: activeVersion.id,
                versions,
                savedBanner: null,
              },
            },
          }
        })
      })
      .catch(() => {
        if (cancelled) return
        setState((prev) => ({ ...prev, toast: 'Could not load live config. Using local draft.' }))
        window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 2200)
      })

    return () => {
      cancelled = true
    }
  }, [state.authed])

  const updateCurrent = (patch: Partial<AgentInstance>, extra?: Partial<AppState>) => {
    setState((prev) => ({
      ...prev,
      ...extra,
      instances: {
        ...prev.instances,
        [prev.instance]: {
          ...prev.instances[prev.instance],
          ...patch,
        },
      },
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
      setState((prev) => ({ ...prev, authed: true, signingIn: false }))
    }, 520)
  }

  const signOut = () => {
    if (dirty) {
      setState((prev) => ({ ...prev, dialog: { kind: 'sign-out' } }))
      return
    }
    setState((prev) => ({ ...prev, authed: false, historyOpen: false }))
  }

  const resetPrototype = () => {
    window.localStorage.removeItem(STORAGE_KEY)
    setState(initialState())
  }

  const saveVersion = (lockAfter = false) => {
    const instanceName = state.instance
    const snapshot = state.instances[instanceName]
    const snapshotPrompt = snapshot.draftPrompt
    const snapshotOpener = snapshot.draftOpener
    const hasChanges = snapshotPrompt !== snapshot.savedPrompt || snapshotOpener !== snapshot.savedOpener
    if (state.saving || (!hasChanges && !lockAfter)) return

    const saveRequestId = uid('save')
    setState((prev) => ({ ...prev, saving: true, saveError: null, pendingSaveId: saveRequestId, dialog: null }))

    const fallbackId = hasChanges ? nextVersionId(snapshot.versions) : snapshot.activeVersion
    const fallbackVersionNumber = Number(fallbackId.replace(/^v/, ''))

    void saveAgentBuilderConfig({
      tenantKey: getK1TenantKey(),
      displayName: 'K1 Katsastus',
      masterPrompt: snapshotPrompt,
      openingMessage: snapshotOpener,
      additionalInformation: '',
      locked: lockAfter,
      versionId: fallbackId,
      versionNumber: Number.isFinite(fallbackVersionNumber) ? fallbackVersionNumber : undefined,
    }).then((saved) => {
      setState((prev) => {
        if (prev.pendingSaveId !== saveRequestId) return prev
        const instance = prev.instances[instanceName]
        const draftChangedAfterRequest = instance.draftPrompt !== snapshotPrompt || instance.draftOpener !== snapshotOpener
        const id = hasChanges ? `v${saved.versionNumber}` : instance.activeVersion
        const version: Version = {
          id,
          meta: `${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date())} · Saved config`,
          prompt: saved.masterPrompt,
          opener: saved.openingMessage,
        }
        const versions = hasChanges ? [version, ...instance.versions] : instance.versions
        const shouldLock = lockAfter && !draftChangedAfterRequest
        return {
          ...prev,
          saving: false,
          saveError: null,
          pendingSaveId: null,
          dialog: null,
          selectedVersionId: id,
          mobileTab: prev.mobileTab,
          toast: draftChangedAfterRequest ? `Saved ${id}. Newer edits are still in the draft.` : lockAfter ? `Saved and locked as ${id}` : `Saved locally as ${id}`,
          instances: {
            ...prev.instances,
            [instanceName]: {
              ...instance,
              locked: shouldLock ? true : instance.locked,
              savedPrompt: snapshotPrompt,
              savedOpener: snapshotOpener,
              activeVersion: id,
              versions,
              savedBanner: hasChanges ? `Saved locally as ${id}` : null,
            },
          },
        }
      })
      window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 2200)
    }).catch(() => {
      setState((prev) => (
        prev.pendingSaveId === saveRequestId
          ? { ...prev, saving: false, pendingSaveId: null, saveError: 'Save failed. Draft kept.' }
          : prev
      ))
    })
  }

  const applyAI = () => {
    if (!state.instructionDraft.trim()) {
      setState((prev) => ({ ...prev, toast: 'Add instruction text before adding it to the prompt.' }))
      window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 1800)
      return
    }
    const instruction = state.instructionDraft.trim()
    setState((prev) => ({ ...prev, applyingAI: true }))
    window.setTimeout(() => {
      setState((prev) => {
        const instance = prev.instances[prev.instance]
        return {
          ...prev,
          applyingAI: false,
          instructionDraft: '',
          toast: 'Text added to the prompt draft. Review it, then save a version.',
          instances: {
            ...prev.instances,
            [prev.instance]: {
              ...instance,
              draftPrompt: `${instance.draftPrompt.trim()}\n\nAdditional guidance:\n- ${instruction}`,
            },
          },
        }
      })
      window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 2200)
    }, 620)
  }

  const discardDraft = () => {
    updateCurrent(
      { draftPrompt: current.savedPrompt, draftOpener: current.savedOpener },
      {
        saveError: null,
        toast: 'Draft discarded.',
      },
    )
    window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 1600)
  }

  const lockClick = () => {
    if (dirty) {
      setState((prev) => ({ ...prev, dialog: { kind: 'save-lock' } }))
      return
    }
    updateCurrent({ locked: true }, { toast: 'Configuration locked.' })
    window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 1800)
  }

  const unlock = () => {
    updateCurrent({ locked: false }, { mobileTab: 'edit', toast: 'Configuration unlocked.' })
    window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 1800)
  }

  const openHistory = () => {
    setState((prev) => ({ ...prev, historyOpen: true, selectedVersionId: current.activeVersion }))
  }

  const performRestore = (versionId: string) => {
    setState((prev) => {
      const instance = prev.instances[prev.instance]
      const version = instance.versions.find((item) => item.id === versionId)
      if (!version) return prev
      return {
        ...prev,
        historyOpen: false,
        dialog: null,
        selectedVersionId: versionId,
        mobileTab: 'edit',
        configTab: 'prompt',
        toast: typeof version.opener === 'string'
          ? `${versionId} loaded into the draft. Save to activate it.`
          : `${versionId} loaded the prompt only. Opening message is unchanged.`,
        instances: {
          ...prev.instances,
          [prev.instance]: {
            ...instance,
            draftPrompt: version.prompt,
            ...(typeof version.opener === 'string' ? { draftOpener: version.opener } : {}),
          },
        },
      }
    })
    window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 2400)
  }

  const restoreVersion = (versionId: string) => {
    if (current.locked) {
      setState((prev) => ({ ...prev, toast: 'Unlock to edit before restoring a version.' }))
      window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 2200)
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
    const userMessage: Message = { id: uid('msg'), role: 'user', text }
    const responseRequestId = uid('reply')
    const instanceName = state.instance
    const conversationId = current.conversationId
    const reply = REPLIES[current.replyIndex % REPLIES.length]
    updateCurrent(
      { messages: [...current.messages, userMessage], replyIndex: current.replyIndex + 1 },
      { composer: '', sending: true, pendingResponseId: responseRequestId },
    )
    void testAgentBuilderMessage(
      {
        tenantKey: getK1TenantKey(),
        masterPrompt: current.savedPrompt,
        messages: [...current.messages, userMessage],
      },
      reply,
    ).then((result) => {
      setState((prev) => {
        if (prev.pendingResponseId !== responseRequestId) return prev
        const instance = prev.instances[instanceName]
        if (instance.conversationId !== conversationId) {
          return {
            ...prev,
            sending: false,
            pendingResponseId: null,
          }
        }
        const agentMessage: Message = { id: uid('msg'), role: 'agent', text: result.reply }
        return {
          ...prev,
          sending: false,
          pendingResponseId: null,
          instances: {
            ...prev.instances,
            [instanceName]: {
              ...instance,
              messages: [...instance.messages, agentMessage],
            },
          },
        }
      })
    }).catch(() => {
      setState((prev) => {
        if (prev.pendingResponseId !== responseRequestId) return prev
        const instance = prev.instances[instanceName]
        if (instance.conversationId !== conversationId) {
          return {
            ...prev,
            sending: false,
            pendingResponseId: null,
          }
        }
        return {
          ...prev,
          sending: false,
          pendingResponseId: null,
          toast: 'Test reply failed. Your message is still in the thread.',
        }
      })
      window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 2200)
    })
  }

  const newConversation = () => {
    updateCurrent(
      { conversationId: uid('thread'), messages: starterMessages(current.savedOpener), savedBanner: null },
      { composer: '', sending: false, pendingResponseId: null },
    )
  }

  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  const copyMessage = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.text)
      setState((prev) => ({ ...prev, copiedMessageId: message.id }))
      window.setTimeout(() => setState((prev) => ({ ...prev, copiedMessageId: null })), 1200)
    } catch {
      setState((prev) => ({ ...prev, toast: 'Could not copy in this browser.' }))
      window.setTimeout(() => setState((prev) => ({ ...prev, toast: null })), 1800)
    }
  }

  const openSheet = (kind: SheetKind) => {
    setState((prev) => ({
      ...prev,
      sheet: {
        kind,
        title: kind === 'opener' ? 'Opening message' : 'Master prompt',
        value: kind === 'opener' ? current.draftOpener : current.draftPrompt,
      },
    }))
  }

  const commitSheet = () => {
    if (!state.sheet) return
    const value = state.sheet.value
    updateCurrent(state.sheet.kind === 'opener' ? { draftOpener: value } : { draftPrompt: value }, { sheet: null })
  }

  const dialogContent = useMemo(() => {
    const dialog = state.dialog
    if (!dialog) return null
    if (dialog.kind === 'save-lock') {
      return {
        title: 'Save changes before locking?',
        body: 'Locking makes the master configuration read-only. Your current edits will be saved as a new version first.',
        confirm: 'Save and lock',
      }
    }
    if (dialog.kind === 'sign-out') {
      return {
        title: 'Sign out with unsaved changes?',
        body: 'Your edits are still a draft and have not been saved as a version. Cancel to keep working, or sign out without saving a new version.',
        confirm: 'Sign out',
      }
    }
    return {
      title: 'Replace current draft?',
      body: 'Restoring this version loads it into the editor as unsaved changes. Your current draft will be replaced.',
      confirm: 'Restore version',
    }
  }, [state.dialog])

  const confirmDialog = () => {
    const dialog = state.dialog
    if (!dialog) return
    if (dialog.kind === 'save-lock') saveVersion(true)
    if (dialog.kind === 'sign-out') setState((prev) => ({ ...prev, authed: false, historyOpen: false, dialog: null, sheet: null }))
    if (dialog.kind === 'restore') performRestore(dialog.versionId)
  }

  const shared = {
    state,
    current,
    dirty,
    selectedVersion,
    updateCurrent,
    restoreVersion,
    saveVersion,
    discardDraft,
    lockClick,
    unlock,
    applyAI,
    newConversation,
    sendMessage,
    onComposerKey,
    copyMessage,
    openSheet,
  }

  if (!state.authed) {
    return (
      <AuthScreen
        state={state}
        setState={setState}
        signIn={signIn}
        resetPrototype={resetPrototype}
      />
    )
  }

  return (
    <div className="app-shell">
      <TopBar
        current={current}
        dirty={dirty}
        onHistory={openHistory}
        onSignOut={signOut}
      />

      <main className={`workspace ${current.locked ? 'workspace--locked' : ''}`}>
        <section className={`editor-panel desktop-pane ${current.locked ? 'editor-panel--locked' : ''}`}>
          {current.locked ? <LockedEditorPanel {...shared} /> : <EditorPanel {...shared} />}
        </section>

        <section className="playground-panel desktop-pane">
          <PlaygroundPanel {...shared} />
        </section>

        <section className="mobile-shell">
          {state.mobileTab === 'edit' ? (
            current.locked ? <MobileLockedEditPanel {...shared} /> : <MobileEditPanel {...shared} />
          ) : (
            <PlaygroundPanel {...shared} compact />
          )}
          <nav className="mobile-tabs" aria-label="Workspace sections">
            <button className={state.mobileTab === 'edit' ? 'active' : ''} onClick={() => setState((prev) => ({ ...prev, mobileTab: 'edit' }))}>
              <EditIcon />
              Edit
            </button>
            <button className={state.mobileTab === 'playground' ? 'active' : ''} onClick={() => setState((prev) => ({ ...prev, mobileTab: 'playground' }))}>
              <ChatIcon />
              Test
            </button>
          </nav>
        </section>
      </main>

      <AnimatePresence>
        {state.historyOpen && (
          <VersionHistory
            current={current}
            selectedVersion={selectedVersion}
            selectedVersionId={state.selectedVersionId}
            locked={current.locked}
            onClose={() => setState((prev) => ({ ...prev, historyOpen: false }))}
            onSelect={(versionId) => setState((prev) => ({ ...prev, selectedVersionId: versionId }))}
            onRestore={restoreVersion}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
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
      </AnimatePresence>

      <AnimatePresence>
        {state.sheet && (
          <FieldSheet
            sheet={state.sheet}
            onChange={(value) => setState((prev) => ({ ...prev, sheet: prev.sheet ? { ...prev.sheet, value } : null }))}
            onCancel={() => setState((prev) => ({ ...prev, sheet: null }))}
            onDone={commitSheet}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {state.toast && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 10, filter: 'blur(8px)' }}
            transition={{ duration: 0.2, ease }}
          >
            {state.toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

type SharedProps = {
  state: AppState
  current: AgentInstance
  dirty: boolean
  selectedVersion: Version
  updateCurrent: (patch: Partial<AgentInstance>, extra?: Partial<AppState>) => void
  restoreVersion: (versionId: string) => void
  saveVersion: (lockAfter?: boolean) => void
  discardDraft: () => void
  lockClick: () => void
  unlock: () => void
  applyAI: () => void
  newConversation: () => void
  sendMessage: () => void
  onComposerKey: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  copyMessage: (message: Message) => void
  openSheet: (kind: SheetKind) => void
}

function AuthScreen({ state, setState, signIn, resetPrototype }: {
  state: AppState
  setState: React.Dispatch<React.SetStateAction<AppState>>
  signIn: (event?: FormEvent) => void
  resetPrototype: () => void
}) {
  return (
    <main className="auth-shell">
      <header className="auth-header">
        <Brand />
        <button className="quiet-button" onClick={resetPrototype}>Reset prototype</button>
      </header>
      <motion.form
        className="auth-card"
        onSubmit={signIn}
        initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.34, ease }}
      >
        <div className="auth-copy">
          <p className="microcopy">K1 Katsastus assistant</p>
          <h1>Welcome back</h1>
          <p>Review the inspection-booking prompt, save a version, and test replies before they reach customers.</p>
        </div>
        <label className="field">
          <span>Username</span>
          <input value={state.username} onChange={(event) => setState((prev) => ({ ...prev, username: event.target.value }))} placeholder="username" />
        </label>
        <label className="field">
          <span>Password</span>
          <span className="password-field">
            <input
              value={state.password}
              onChange={(event) => setState((prev) => ({ ...prev, password: event.target.value }))}
              type={state.showPassword ? 'text' : 'password'}
              placeholder="password"
            />
            <button type="button" onClick={() => setState((prev) => ({ ...prev, showPassword: !prev.showPassword }))}>
              {state.showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        <AnimatePresence>
          {state.loginError && (
            <motion.div className="inline-error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              {state.loginError}
            </motion.div>
          )}
        </AnimatePresence>
        <motion.button className="primary-button auth-button" type="submit" disabled={state.signingIn} whileTap={{ scale: 0.985 }}>
          {state.signingIn && <Spinner />}
          {state.signingIn ? 'Opening agent' : 'Continue'}
        </motion.button>
      </motion.form>
    </main>
  )
}

function TopBar({ current, dirty, onHistory, onSignOut }: {
  current: AgentInstance
  dirty: boolean
  onHistory: () => void
  onSignOut: () => void
}) {
  const reducedMotion = useReducedMotion()
  const statusText = dirty ? 'Unsaved changes' : current.locked ? `Locked · ${current.activeVersion}` : `Active · ${current.activeVersion}`

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Brand />
        <span className="divider" />
        <div className="breadcrumb">
          <span>Prompt workspace</span>
          <ChevronIcon />
        </div>
        <div className="agent-lockup">
          <span className="agent-avatar">K</span>
          <span className="agent-name">K1 Katsastus assistant</span>
        </div>
      </div>
      <div className="topbar-right">
        <motion.span
          className={`status-pill ${dirty ? 'draft' : current.locked ? 'locked' : 'saved'}`}
          aria-live="polite"
          animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: dirty ? 1.02 : 1 }}
          transition={{ duration: reducedMotion ? 0.01 : 0.16, ease }}
        >
          {statusText}
        </motion.span>
        <button className="secondary-button history-trigger" onClick={onHistory}><HistoryIcon /><span>Versions</span></button>
        <button className="account-button" onClick={onSignOut}><span>M</span>Sign out</button>
      </div>
    </header>
  )
}

function EditorPanel({ state, current, dirty, updateCurrent, saveVersion, discardDraft, lockClick, applyAI }: SharedProps) {
  const reducedMotion = useReducedMotion()
  const openerDirty = current.draftOpener !== current.savedOpener
  const openerPreview = renderOpener(current.draftOpener).trim()
  const paneMotion = {
    initial: reducedMotion ? false : { opacity: 0, y: 8, filter: 'blur(6px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    transition: { duration: reducedMotion ? 0.01 : 0.18, ease },
  }

  return (
    <div className="editor-content">
      <section className="editor-head">
        <div>
          <h1>Master configuration</h1>
          <p>Edit the saved instructions, test the exact saved version, then lock when it is ready.</p>
        </div>
        <LayoutGroup id="config-tabs">
          <div className="config-tabs" aria-label="Configuration sections">
            <button className={state.configTab === 'prompt' ? 'active' : ''} onClick={() => updateCurrent({}, { configTab: 'prompt' })}>
              {state.configTab === 'prompt' && <motion.span className="tab-active-indicator" layoutId="config-tab-active" transition={{ duration: reducedMotion ? 0.01 : 0.2, ease }} />}
              <span className="tab-label">Prompt</span>
            </button>
            <button className={state.configTab === 'opening' ? 'active' : ''} onClick={() => updateCurrent({}, { configTab: 'opening' })}>
              {state.configTab === 'opening' && <motion.span className="tab-active-indicator" layoutId="config-tab-active" transition={{ duration: reducedMotion ? 0.01 : 0.2, ease }} />}
              <span className="tab-label">Opening</span>
            </button>
          </div>
        </LayoutGroup>
      </section>
      {state.configTab === 'prompt' ? (
        <motion.div key="prompt-pane" className="config-pane" {...paneMotion}>
          <AdditionalInformationPanel state={state} updateCurrent={updateCurrent} applyAI={applyAI} />
            <section className="prompt-card">
              <div className="field-header prompt-header">
                <div>
                  <h2>Master prompt</h2>
                  <p>Behavior rules for the agent. The tester uses the last saved version.</p>
                </div>
                <span className="char-count">{current.draftPrompt.length.toLocaleString()} chars</span>
              </div>
              <textarea className="prompt-input" value={current.draftPrompt} onChange={(event) => updateCurrent({ draftPrompt: event.target.value })} />
            </section>
        </motion.div>
      ) : (
        <motion.div key="opening-pane" className="config-pane" {...paneMotion}>
            <section className="field-card opening-card">
              <div className="field-header">
                <div>
                  <h2>Opening message</h2>
                  <p>First message in a new test thread.</p>
                </div>
              </div>
              <textarea className="opener-input" value={current.draftOpener} onChange={(event) => updateCurrent({ draftOpener: event.target.value })} />
              <div className="opening-preview">
                <span>{openerDirty ? 'Draft preview — not in current test' : 'Saved preview'}</span>
                <small>Sample data: first_name = Bashir · registration_number = ABC-123</small>
                {openerPreview ? <p>{openerPreview}</p> : <p className="empty-preview">No opening message. New tests will start with the first user message.</p>}
              </div>
            </section>
        </motion.div>
      )}
      <div className="savebar">
        <span className={`save-state ${saveStateClass(state, dirty)}`}><span />{saveStateText(state, dirty)}</span>
        <div className="save-actions">
          <button className="secondary-button" onClick={lockClick}><LockIcon />Lock master</button>
          {dirty && <button className="secondary-button" onClick={discardDraft}>Discard draft</button>}
          <motion.button className="primary-button" onClick={() => saveVersion(false)} disabled={!dirty || state.saving} whileTap={{ scale: 0.98 }}>
            {state.saving && <Spinner />}
            Save version
          </motion.button>
        </div>
      </div>
    </div>
  )
}

function AdditionalInformationPanel({ state, updateCurrent, applyAI, compact = false }: Pick<SharedProps, 'state' | 'updateCurrent' | 'applyAI'> & { compact?: boolean }) {
  return (
    <section className={compact ? 'mobile-card additional-card additional-card--mobile' : 'additional-card'}>
      <div className="field-header">
        <div>
          <h2>Additional information</h2>
          <p>Add details for the next prompt version. This appends plain text to the draft for review.</p>
        </div>
      </div>
      <textarea
        className="instruction-input"
        value={state.instructionDraft}
        onChange={(event) => updateCurrent({}, { instructionDraft: event.target.value })}
        placeholder="Example: Customer wants the earliest inspection appointment near Helsinki."
      />
      <div className="instruction-actions">
        <p>No auto-save. Review the draft, then save a version.</p>
        <button className="primary-button" onClick={applyAI} disabled={state.applyingAI}>
          {state.applyingAI && <Spinner />}
          Add to prompt
        </button>
      </div>
    </section>
  )
}

function LockedEditorPanel(props: SharedProps) {
  const { state, current, dirty, saveVersion, discardDraft, unlock, applyAI, updateCurrent } = props

  return (
    <div className="editor-content locked-editor-content">
      <section className="editor-head">
        <div>
          <h1>Master locked</h1>
          <p>The saved master prompt is protected. Add information below to prepare the next version while you keep testing.</p>
        </div>
        <button className="secondary-button" onClick={unlock}>Unlock full editor</button>
      </section>
      <AdditionalInformationPanel state={state} updateCurrent={updateCurrent} applyAI={applyAI} />
      <section className="field-card locked-summary">
        <div className="field-header">
          <div>
            <h2>Saved master prompt</h2>
            <p>Read-only while locked. Use Unlock full editor for direct edits.</p>
          </div>
          <span className="char-count">{current.savedPrompt.length.toLocaleString()} chars</span>
        </div>
        <pre>{current.savedPrompt}</pre>
      </section>
      <div className="savebar">
        <span className={`save-state ${saveStateClass(state, dirty)}`}><span />{saveStateText(state, dirty)}</span>
        <div className="save-actions">
          {dirty && <button className="secondary-button" onClick={discardDraft}>Discard draft</button>}
          <motion.button className="primary-button" onClick={() => saveVersion(false)} disabled={!dirty || state.saving} whileTap={{ scale: 0.98 }}>
            {state.saving && <Spinner />}
            Save version
          </motion.button>
        </div>
      </div>
    </div>
  )
}

function MobileEditPanel(props: SharedProps) {
  const { state, current, dirty, saveVersion, discardDraft, lockClick, openSheet } = props
  const reducedMotion = useReducedMotion()

  return (
    <div className="mobile-edit-panel">
      <AdditionalInformationPanel {...props} compact />
      <section className="mobile-card rows">
        <button className="mobile-row detail" onClick={() => openSheet('opener')}>
          <span><strong>Opening message</strong><em>{current.draftOpener}</em></span>
          <span>Edit <ChevronIcon /></span>
        </button>
        <button className="mobile-row detail" onClick={() => openSheet('prompt')}>
          <span><strong>Master prompt</strong><em>{current.draftPrompt.length.toLocaleString()} chars</em></span>
          <span>Edit <ChevronIcon /></span>
        </button>
      </section>
      <section className="mobile-card lock-row">
        <span><strong>Lock master</strong><em>Freeze the saved prompt for tester-only work.</em></span>
        <button className="secondary-button" onClick={lockClick}><LockIcon />Lock</button>
      </section>
      {dirty && <button className="secondary-button mobile-discard" onClick={discardDraft}>Discard draft</button>}
      <AnimatePresence initial={false}>
        {(dirty || state.saving || state.saveError) && (
          <motion.div
            className="mobile-savebar"
            initial={reducedMotion ? false : { opacity: 0, y: 18, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, filter: 'blur(8px)' }}
            transition={{ duration: reducedMotion ? 0.01 : 0.2, ease }}
          >
            <span className={`save-state ${saveStateClass(state, dirty)}`}><span />{saveStateText(state, dirty)}</span>
            <button className="primary-button" onClick={() => saveVersion(false)} disabled={!dirty || state.saving}>{state.saving && <Spinner />}Save version</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MobileLockedEditPanel(props: SharedProps) {
  const { state, current, dirty, saveVersion, discardDraft, unlock } = props
  const reducedMotion = useReducedMotion()

  return (
    <div className="mobile-edit-panel">
      <section className="mobile-card lock-row">
        <span><strong>Master locked</strong><em>Add information for the next saved version, or unlock for direct edits.</em></span>
        <button className="secondary-button" onClick={unlock}>Unlock</button>
      </section>
      <AdditionalInformationPanel {...props} compact />
      <section className="mobile-card locked-summary">
        <div className="field-header">
          <div>
            <h2>Saved master prompt</h2>
            <p>Read-only while locked.</p>
          </div>
          <span className="char-count">{current.savedPrompt.length.toLocaleString()} chars</span>
        </div>
        <pre>{current.savedPrompt}</pre>
      </section>
      {dirty && <button className="secondary-button mobile-discard" onClick={discardDraft}>Discard draft</button>}
      <AnimatePresence initial={false}>
        {(dirty || state.saving || state.saveError) && (
          <motion.div
            className="mobile-savebar"
            initial={reducedMotion ? false : { opacity: 0, y: 18, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, filter: 'blur(8px)' }}
            transition={{ duration: reducedMotion ? 0.01 : 0.2, ease }}
          >
            <span className={`save-state ${saveStateClass(state, dirty)}`}><span />{saveStateText(state, dirty)}</span>
            <button className="primary-button" onClick={() => saveVersion(false)} disabled={!dirty || state.saving}>{state.saving && <Spinner />}Save version</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PlaygroundPanel({ state, current, dirty, updateCurrent, unlock, newConversation, sendMessage, onComposerKey, copyMessage, compact }: SharedProps & { compact?: boolean }) {
  const reducedMotion = useReducedMotion()

  return (
    <div className={`playground-content ${compact ? 'compact' : ''}`}>
      {current.locked && (
        <motion.div className="lock-strip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16, ease }}>
          <span><LockIcon />Master locked · {current.activeVersion}</span>
          <button className="primary-button small" onClick={unlock}>Unlock to edit</button>
        </motion.div>
      )}
      <div className="context-row">
        <span className="tester-title">
          <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
          <strong>Agent tester</strong>
          <em>{current.locked ? `Locked ${current.activeVersion}` : `Last saved ${current.activeVersion}`}</em>
        </span>
        <button className="secondary-button" onClick={newConversation}>{current.savedBanner ? 'Start fresh test' : 'New test'}</button>
      </div>
      {dirty && !current.locked && (
        <div className="draft-banner">Unsaved changes are not included in this test.</div>
      )}
      <motion.div
        key={current.conversationId}
        className="messages"
        aria-live="polite"
        initial={reducedMotion ? false : { opacity: 0, y: 8, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: reducedMotion ? 0.01 : 0.22, ease }}
      >
        {current.messages.length === 0 && (
          <div className="empty-thread">
            <strong>No opening message is saved.</strong>
            <span>Send a test message to start the thread.</span>
          </div>
        )}
        <AnimatePresence initial={false}>
          {current.messages.map((message) => (
            <motion.article
              layout
              key={message.id}
              className={`message ${message.role}`}
              initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.22, ease }}
            >
              <div>{message.text}</div>
              {message.role === 'agent' && (
                <button className="message-action" onClick={() => copyMessage(message)}><CopyIcon />{state.copiedMessageId === message.id ? 'Copied' : 'Copy'}</button>
              )}
            </motion.article>
          ))}
        </AnimatePresence>
        {state.sending && <TypingDots />}
      </motion.div>
      <div className="composer-wrap">
        <div className="composer">
          <textarea
            value={state.composer}
            onChange={(event) => updateCurrent({}, { composer: event.target.value })}
            onKeyDown={onComposerKey}
            placeholder="Ask the saved agent a test question…"
          />
          <motion.button className="send-button" onClick={sendMessage} disabled={!state.composer.trim() || state.sending} whileTap={{ scale: 0.94 }} aria-label="Send message">
            <ArrowUpIcon />
          </motion.button>
        </div>
        <p>Safe preview. Prototype replies are canned; nothing is sent to n8n or customers.</p>
      </div>
    </div>
  )
}

function VersionHistory({ current, selectedVersion, selectedVersionId, locked, onClose, onSelect, onRestore }: {
  current: AgentInstance
  selectedVersion: Version
  selectedVersionId: string
  locked: boolean
  onClose: () => void
  onSelect: (versionId: string) => void
  onRestore: (versionId: string) => void
}) {
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }}>
      <motion.aside className="history-drawer" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.28, ease }}>
        <header>
          <h2>Version history</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close version history"><CloseIcon /></button>
        </header>
        <div className="version-list">
          {current.versions.map((version) => (
            <button key={version.id} className={version.id === selectedVersionId ? 'version-row active' : 'version-row'} onClick={() => onSelect(version.id)}>
              <span><strong>{version.id}</strong><em>{version.meta}</em></span>
              {version.id === current.activeVersion ? <small>Active</small> : <small>View</small>}
            </button>
          ))}
        </div>
        <section className="version-preview">
          <p>Read-only · {selectedVersion.id} · {typeof selectedVersion.opener === 'string' ? 'Prompt and opening message' : 'Prompt only'}</p>
          {typeof selectedVersion.opener === 'string' ? (
            <div className="version-opener">
              <span>Opening message</span>
              <p>{renderOpener(selectedVersion.opener)}</p>
            </div>
          ) : (
            <div className="version-opener muted">
              <span>Opening message</span>
              <p>This older version has no opening-message record. Restoring it leaves the current draft opening unchanged.</p>
            </div>
          )}
          <pre>{selectedVersion.prompt}</pre>
        </section>
        <footer>
          <button className="secondary-button" onClick={onClose}>Close</button>
          <button className="primary-button" onClick={() => onRestore(selectedVersion.id)}>{locked ? 'Unlock to restore' : `Restore ${selectedVersion.id}`}</button>
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
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="confirm-dialog" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.2, ease }} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{title}</h2>
        <p>{body}</p>
        <div>
          <button className="secondary-button" onClick={onCancel}>Cancel</button>
          <button className="primary-button" onClick={onConfirm} disabled={loading}>{loading && <Spinner />}{confirmLabel}</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function FieldSheet({ sheet, onChange, onCancel, onDone }: {
  sheet: SheetState
  onChange: (value: string) => void
  onCancel: () => void
  onDone: () => void
}) {
  const openerPreview = sheet.kind === 'opener' ? renderOpener(sheet.value).trim() : ''

  return (
    <motion.div className="field-sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ duration: 0.26, ease }}>
      <header>
        <button onClick={onCancel}>Cancel</button>
        <h2>{sheet.title}</h2>
        <button onClick={onDone}>Done</button>
      </header>
      {sheet.kind === 'opener' && (
        <div className="sheet-preview">
          <span>Draft preview — sample data</span>
          <small>first_name = Bashir · registration_number = ABC-123</small>
          {openerPreview ? <p>{openerPreview}</p> : <p className="empty-preview">No opening message. New tests will start with the first user message.</p>}
        </div>
      )}
      <textarea value={sheet.value} onChange={(event) => onChange(event.target.value)} autoFocus />
      <footer>
        <span>{sheet.kind === 'opener' ? 'Done updates the draft opening message.' : 'Done updates the draft master prompt.'}</span>
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
  return (
    <motion.div className="typing" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <span /><span /><span />
    </motion.div>
  )
}

function Svg(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...props} />
}

function ChevronIcon() { return <Svg><path d="M4 6.25 8 10l4-3.75" /></Svg> }
function PlusIcon() { return <Svg><path d="M8 3.5v9M3.5 8h9" /></Svg> }
function HistoryIcon() { return <Svg><circle cx="8" cy="8" r="5.4" /><path d="M8 5v3.1l2.2 1.3" /></Svg> }
function LockIcon() { return <Svg><rect x="3.6" y="7" width="8.8" height="6.2" rx="1.6" /><path d="M5.8 7V5.3a2.2 2.2 0 0 1 4.4 0V7" /></Svg> }
function ChatIcon() { return <Svg><path d="M13 8.4c0 2.2-2.2 4-5 4-.7 0-1.3-.1-1.9-.3l-3 1 .9-2.2c-.7-.7-1-1.5-1-2.5 0-2.2 2.2-4 5-4s5 1.8 5 4Z" /></Svg> }
function EditIcon() { return <Svg><path d="M3.4 12.4h9.2M4.8 10.4l5.5-5.5 1.8 1.8-5.5 5.5H4.8v-1.8Z" /></Svg> }
function CopyIcon() { return <Svg><rect x="5.4" y="5.4" width="7" height="7" rx="1.5" /><path d="M10.2 5.4v-.8a1.1 1.1 0 0 0-1.1-1.1H4.6a1.1 1.1 0 0 0-1.1 1.1v4.5a1.1 1.1 0 0 0 1.1 1.1h.8" /></Svg> }
function CloseIcon() { return <Svg><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></Svg> }
function ArrowUpIcon() { return <Svg><path d="M8 13V4M8 4 4.4 7.6M8 4l3.6 3.6" /></Svg> }

export default App
