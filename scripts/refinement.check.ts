import {
  appendAdditionalInstruction,
  applyFreshTest,
  applySavedConfig,
  captureSaveSnapshot,
  composeEffectivePrompt,
  hasMeaningfulChanges,
  restorePlan,
  shouldAcceptTestReply,
  type AgentDraft,
  type PromptVersion,
} from '../src/lib/refinement.ts'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

const base = 'Base prompt'
const agent: AgentDraft = {
  locked: false,
  savedLocked: false,
  conversationId: 'thread-1',
  testingVersionId: null,
  savedBase: base,
  savedAdditional: '',
  savedOpener: 'Hi',
  draftBase: base,
  draftAdditional: '',
  draftOpener: 'Hi',
  versions: [],
  activeVersion: 'v30',
  messages: [{ id: 'm1', role: 'user', text: 'Can I book Saturday?' }],
  previousTest: null,
  replyIndex: 0,
}

const instruction = 'If the customer asks for a Saturday appointment, explain that this station is open Monday to Friday only.'
assert(!hasMeaningfulChanges({
  instructionDraft: '   ',
  draftBase: base,
  savedBase: base,
  draftOpener: 'Hi',
  savedOpener: 'Hi',
  draftAdditional: '',
  savedAdditional: '',
  locked: false,
  savedLocked: false,
}), 'whitespace is not a change')

assert(hasMeaningfulChanges({
  instructionDraft: instruction,
  draftBase: base,
  savedBase: base,
  draftOpener: 'Hi',
  savedOpener: 'Hi',
  draftAdditional: '',
  savedAdditional: '',
  locked: true,
  savedLocked: true,
}), 'locked base still allows additional information')

const first = captureSaveSnapshot({
  draftBase: base,
  draftOpener: 'Hi',
  draftAdditional: '',
  instructionDraft: instruction,
  locked: true,
})
const second = captureSaveSnapshot({
  draftBase: base,
  draftOpener: 'Hi',
  draftAdditional: first.additional,
  instructionDraft: instruction,
  locked: true,
})
assert(first.additional === `- ${instruction}`, 'instruction is appended once')
assert(appendAdditionalInstruction(first.additional, instruction) === first.additional, 'retry does not duplicate')
assert(second.additional === first.additional, 'the same instruction is not appended again')
assert(composeEffectivePrompt(base, first.additional) === `${base}\n\nAdditional guidance:\n- ${instruction}`, 'effective prompt appends instructions')
assert(!composeEffectivePrompt(base, first.additional).includes(`${instruction}\n- ${instruction}`), 'composed prompt includes the instruction once')

const version: PromptVersion = {
  id: 'v31',
  meta: 'Saved config',
  prompt: base,
  opener: 'Hi',
  additionalInformation: first.additional,
}
const saved = applySavedConfig({
  agent,
  snapshot: first,
  version,
  current: { draftBase: base, draftOpener: 'Hi', draftAdditional: '', instructionDraft: instruction, locked: true },
  started: null,
})
assert(saved.testStarted === false, 'failed test start does not replace the conversation')
assert(saved.agent.messages === agent.messages, 'previous conversation stays')
assert(saved.agent.conversationId === 'thread-1', 'conversation id stays')
assert(saved.agent.activeVersion === 'v31', 'the saved version remains active')
assert(saved.instructionDraft === '', 'pending text clears only after a successful save')

const editedDuringSave = applySavedConfig({
  agent,
  snapshot: first,
  version,
  current: { draftBase: base, draftOpener: 'Hi', draftAdditional: '', instructionDraft: `${instruction} more`, locked: true },
  started: { conversationId: 'thread-2', messages: [{ id: 'opener', role: 'agent', text: 'Hi' }] },
})
assert(editedDuringSave.instructionDraft === `${instruction} more`, 'text entered during save is kept')
assert(editedDuringSave.agent.messages[0]?.text === 'Hi', 'fresh test replaces the thread only after it starts')
assert(editedDuringSave.agent.previousTest?.messages[0]?.text === 'Can I book Saturday?', 'previous test is kept')

const retried = applyFreshTest(saved.agent, { conversationId: 'thread-3', messages: [{ id: 'opener-2', role: 'agent', text: 'Hi' }] })
assert(retried.activeVersion === 'v31', 'retrying a test does not create a version')
assert(retried.versions.length === 1, 'retry keeps the same history')
assert(!shouldAcceptTestReply({
  responseRequestId: 'reply-old',
  pendingResponseId: null,
  responseConversationId: 'thread-1',
  currentConversationId: retried.conversationId,
}), 'an old reply cannot enter the new test')

const lockedRestore = restorePlan({ id: 'v28', meta: '', prompt: 'Other base', opener: 'Hello' }, base, true)
assert(lockedRestore.ok === false, 'a locked base cannot be replaced until unlock')
const openerRestore = restorePlan({ id: 'v29', meta: '', prompt: base, opener: 'Hello there' }, base, true)
assert(openerRestore.ok && openerRestore.opener === 'Hello there', 'opening message can restore while the base is locked')
const promptOnly = restorePlan({ id: 'v28', meta: '', prompt: 'Other base' }, 'Other base', false)
assert(promptOnly.ok && promptOnly.opener === undefined && promptOnly.additional === undefined, 'missing historical fields are not invented')

console.log('refinement checks passed')
