export type AgentBuilderBackendMode = 'local' | 'supabase' | 'n8n'

export type AgentBuilderChatMessage = {
  role: 'user' | 'agent' | 'assistant'
  text: string
}

export type AgentBuilderVersionRecord = {
  id: string
  versionNumber: number
  masterPrompt: string
  openingMessage?: string
  additionalInformation: string
  createdAt: string
  isActive: boolean
}

export type AgentBuilderConfigSnapshot = {
  tenantKey: string
  displayName: string
  locked: boolean
  activeVersion: AgentBuilderVersionRecord
  versions: AgentBuilderVersionRecord[]
}

export type SaveAgentBuilderConfigInput = {
  tenantKey: string
  displayName: string
  masterPrompt: string
  openingMessage: string
  additionalInformation?: string
  locked: boolean
  versionNumber?: number
  versionId?: string
}

export type TestAgentBuilderInput = {
  tenantKey: string
  masterPrompt: string
  messages: AgentBuilderChatMessage[]
}

export type TestAgentBuilderResult = {
  reply: string
  mode: 'demo' | 'n8n'
  versionNumber?: number
}

const LOCAL_CONFIG_KEY = 'wasup-k1-agent-builder-config-v1'
const K1_TENANT_KEY = 'k1_katsastus_demo'

const SUPABASE_URL = import.meta.env.VITE_K1_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_K1_SUPABASE_ANON_KEY as string | undefined
const SUPABASE_DIRECT_ENABLED = import.meta.env.VITE_K1_SUPABASE_DIRECT_ENABLED === 'true'
const N8N_BUILDER_BASE_URL = import.meta.env.VITE_N8N_BUILDER_BASE_URL as string | undefined
const N8N_BUILDER_PUBLIC_TOKEN = import.meta.env.VITE_N8N_BUILDER_PUBLIC_TOKEN as string | undefined

export function getAgentBuilderBackendMode(): AgentBuilderBackendMode {
  if (SUPABASE_DIRECT_ENABLED && SUPABASE_URL && SUPABASE_ANON_KEY) return 'supabase'
  if (N8N_BUILDER_BASE_URL) return 'n8n'
  return 'local'
}

export function getK1TenantKey() {
  return K1_TENANT_KEY
}

function supabaseHeaders() {
  if (!SUPABASE_ANON_KEY) throw new Error('missing_supabase_anon_key')
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
}

function n8nHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(N8N_BUILDER_PUBLIC_TOKEN ? { Authorization: `Bearer ${N8N_BUILDER_PUBLIC_TOKEN}` } : {}),
  }
}

function localLoad(): AgentBuilderConfigSnapshot | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(LOCAL_CONFIG_KEY)
  if (!raw) return null
  return JSON.parse(raw) as AgentBuilderConfigSnapshot
}

function localSave(snapshot: AgentBuilderConfigSnapshot) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(snapshot))
}

export async function loadAgentBuilderConfig(): Promise<AgentBuilderConfigSnapshot | null> {
  const mode = getAgentBuilderBackendMode()

  if (mode === 'supabase') {
    const url = new URL('/rest/v1/agent_builder_active_config', SUPABASE_URL)
    url.searchParams.set('tenant_key', `eq.${K1_TENANT_KEY}`)
    url.searchParams.set('select', '*')

    const response = await fetch(url, { headers: supabaseHeaders() })
    if (!response.ok) throw new Error(`supabase_load_failed:${response.status}`)
    const rows = await response.json() as Array<{
      agent_id: string
      tenant_key: string
      display_name: string
      locked: boolean
      version_id: string
      version_number: number
      master_prompt: string
      additional_information: string
      opening_message: string
      version_created_at: string
    }>
    const row = rows[0]
    if (!row) return null
    const versionsUrl = new URL('/rest/v1/agent_builder_versions', SUPABASE_URL)
    versionsUrl.searchParams.set('agent_id', `eq.${row.agent_id}`)
    versionsUrl.searchParams.set('select', 'id,version_number,is_active,master_prompt,additional_information,opening_message,created_at')
    versionsUrl.searchParams.set('order', 'version_number.desc')

    const versionsResponse = await fetch(versionsUrl, { headers: supabaseHeaders() })
    if (!versionsResponse.ok) throw new Error(`supabase_versions_failed:${versionsResponse.status}`)
    const versionRows = await versionsResponse.json() as Array<{
      id: string
      version_number: number
      is_active: boolean
      master_prompt: string
      additional_information: string
      opening_message: string
      created_at: string
    }>
    const versions = versionRows.map((version) => ({
      id: version.id,
      versionNumber: version.version_number,
      masterPrompt: version.master_prompt,
      additionalInformation: version.additional_information,
      openingMessage: version.opening_message,
      createdAt: version.created_at,
      isActive: version.is_active,
    }))

    return {
      tenantKey: row.tenant_key,
      displayName: row.display_name,
      locked: row.locked,
      activeVersion: {
        id: row.version_id,
        versionNumber: row.version_number,
        masterPrompt: row.master_prompt,
        additionalInformation: row.additional_information,
        openingMessage: row.opening_message,
        createdAt: row.version_created_at,
        isActive: true,
      },
      versions,
    }
  }

  if (mode === 'n8n') {
    const response = await fetch(`${N8N_BUILDER_BASE_URL}/config?tenantKey=${encodeURIComponent(K1_TENANT_KEY)}`, {
      headers: n8nHeaders(),
    })
    if (!response.ok) throw new Error(`n8n_load_failed:${response.status}`)
    return await response.json() as AgentBuilderConfigSnapshot
  }

  return localLoad()
}

export async function saveAgentBuilderConfig(input: SaveAgentBuilderConfigInput): Promise<AgentBuilderVersionRecord> {
  const mode = getAgentBuilderBackendMode()

  if (mode === 'supabase') {
    if (!SUPABASE_URL) throw new Error('missing_supabase_url')
    const response = await fetch(new URL('/rest/v1/rpc/save_agent_builder_version', SUPABASE_URL), {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        p_tenant_key: input.tenantKey,
        p_master_prompt: input.masterPrompt,
        p_opening_message: input.openingMessage,
        p_additional_information: input.additionalInformation ?? '',
        p_locked: input.locked,
      }),
    })
    if (!response.ok) throw new Error(`supabase_save_failed:${response.status}`)
    const [row] = await response.json() as Array<{ version_id: string; version_number: number }>
    return {
      id: row.version_id,
      versionNumber: row.version_number,
      masterPrompt: input.masterPrompt,
      openingMessage: input.openingMessage,
      additionalInformation: input.additionalInformation ?? '',
      createdAt: new Date().toISOString(),
      isActive: true,
    }
  }

  if (mode === 'n8n') {
    const response = await fetch(`${N8N_BUILDER_BASE_URL}/config/save`, {
      method: 'POST',
      headers: n8nHeaders(),
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(`n8n_save_failed:${response.status}`)
    return await response.json() as AgentBuilderVersionRecord
  }

  const existing = localLoad()
  const versionNumber = input.versionNumber ?? (existing?.versions[0]?.versionNumber ?? 0) + 1
  const version: AgentBuilderVersionRecord = {
    id: input.versionId ?? `local-v${versionNumber}`,
    versionNumber,
    masterPrompt: input.masterPrompt,
    openingMessage: input.openingMessage,
    additionalInformation: input.additionalInformation ?? '',
    createdAt: new Date().toISOString(),
    isActive: true,
  }
  localSave({
    tenantKey: input.tenantKey,
    displayName: input.displayName,
    locked: input.locked,
    activeVersion: version,
    versions: [version, ...(existing?.versions ?? []).map((item) => ({ ...item, isActive: false }))],
  })
  await new Promise((resolve) => window.setTimeout(resolve, 450))
  return version
}

export async function testAgentBuilderMessage(input: TestAgentBuilderInput, fallbackReply: string): Promise<TestAgentBuilderResult> {
  if (!N8N_BUILDER_BASE_URL) {
    await new Promise((resolve) => window.setTimeout(resolve, 450))
    return { reply: fallbackReply, mode: 'demo' }
  }

  const response = await fetch(`${N8N_BUILDER_BASE_URL}/chat/test`, {
    method: 'POST',
    headers: n8nHeaders(),
    body: JSON.stringify({
      ...input,
      messages: input.messages.map((message) => ({
        role: message.role === 'agent' ? 'assistant' : message.role,
        content: message.text,
      })),
    }),
  })
  if (!response.ok) throw new Error(`n8n_test_failed:${response.status}`)
  return await response.json() as TestAgentBuilderResult
}
