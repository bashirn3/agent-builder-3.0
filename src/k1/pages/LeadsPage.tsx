import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Download, Link2, MessagesSquare, RefreshCw } from 'lucide-react'
import { ease } from '../../lib/motion'
import { downloadCsv, fixtureLeads, toCsv, type Lead } from '../data/fixtures'
import { go, href } from '../routes'
import { DetailPane, Facts, formatStamp, ListPane, MobileSwap, relativeTime, SampleBadge, Thread } from './SplitView'

export function LeadsPage({ id, compact, notify }: {
  id: string | null
  compact: boolean
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
}) {
  const [items, setItems] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [spin, setSpin] = useState(0)
  const [tab, setTab] = useState<'details' | 'chat'>('details')

  const refresh = () => {
    setLoading(true)
    void fixtureLeads.list().then((list) => { setItems(list); setLoading(false) })
  }
  useEffect(refresh, [])

  useEffect(() => {
    if (!compact && !id && items[0]) go({ page: 'leads', id: items[0].id }, true)
  }, [compact, id, items])

  const selected = id ? fixtureLeads.get(id) : null
  const conversations = selected ? fixtureLeads.conversationsFor(selected) : []

  const exportCsv = () => {
    downloadCsv('k1-leads-sample.csv', toCsv(items.map((lead) => ({
      name: lead.name,
      registration: lead.registration,
      phone: lead.phone,
      email: lead.email,
      station: lead.station,
      status: lead.status,
      submitted: lead.submittedAt,
    }))))
    notify({ title: 'Export ready', body: `${items.length} sample leads downloaded as CSV.` })
  }

  const list = (
    <ListPane
      title="Leads"
      badge={<SampleBadge />}
      loading={loading}
      selectedId={id}
      actions={(
        <>
          <button type="button" className="k1-icon-btn k1-icon-btn--boxed k1-icon-btn--lg" aria-label="Refresh" onClick={() => { setSpin((turns) => turns + 1); refresh() }}>
            <motion.span animate={{ rotate: spin * 360 }} transition={{ duration: 0.5, ease }} style={{ display: 'inline-flex' }}>
              <RefreshCw size={16} strokeWidth={1.75} />
            </motion.span>
          </button>
          <button type="button" className="k1-icon-btn k1-icon-btn--solid k1-icon-btn--lg" aria-label="Export as CSV" onClick={exportCsv} disabled={!items.length}>
            <Download size={16} strokeWidth={1.75} />
          </button>
        </>
      )}
      items={items.map((lead) => ({
        id: lead.id,
        title: lead.name,
        subtitle: `${lead.registration} · ${lead.status}`,
        meta: relativeTime(lead.submittedAt),
        href: href({ page: 'leads', id: lead.id }),
      }))}
      empty={<p><strong>No leads yet</strong></p>}
    />
  )

  const detail = selected ? (
    <DetailPane
      paneKey={selected.id}
      title={`${selected.name} · ${selected.registration}`}
      tabs={[{ value: 'details', label: 'Details' }, { value: 'chat', label: 'Chat' }]}
      tab={tab}
      onTab={setTab}
      onBack={compact ? () => go({ page: 'leads', id: null }) : undefined}
      menu={[
        ...(conversations[0] ? [{ label: 'Open in Chat logs', icon: <MessagesSquare size={14} strokeWidth={1.75} />, onSelect: () => go({ page: 'chats', id: conversations[0].id }) }] : []),
        {
          label: 'Copy link',
          icon: <Link2 size={14} strokeWidth={1.75} />,
          onSelect: () => {
            void navigator.clipboard?.writeText(window.location.href)
              .then(() => notify({ title: 'Link copied', body: 'The link to this sample lead is on your clipboard.' }))
              .catch(() => notify({ tone: 'error', title: 'Copy failed', body: 'Your browser blocked clipboard access.' }))
          },
        },
      ]}
    >
      {tab === 'details' ? (
        <Facts rows={[
          ['Status', <span className={`k1-status k1-status--${selected.status.toLowerCase().replace(/\s+/g, '-')}`}>{selected.status}</span>],
          ['Name', selected.name],
          ['Registration', selected.registration],
          ['Vehicle', selected.vehicle],
          ['Phone', selected.phone],
          ['Email', selected.email],
          ['Station', selected.station],
          ['Preferred time', selected.preferredTime],
          ['Submitted', formatStamp(selected.submittedAt)],
          ['Note', selected.note],
        ]} />
      ) : conversations.length ? (
        <>
          {conversations.map((conversation) => (
            <div key={conversation.id} className="k1-lead-thread">
              <p className="k1-hint">
                {formatStamp(conversation.startedAt)} · {conversation.channel} ·{' '}
                <a className="k1-link" href={href({ page: 'chats', id: conversation.id })}>Open in Chat logs</a>
              </p>
              <Thread messages={conversation.messages} />
            </div>
          ))}
        </>
      ) : <p className="k1-hint">No conversation is linked to this lead.</p>}
    </DetailPane>
  ) : (
    <div className="k1-detail k1-detail--empty"><p>{id ? 'This lead was not found.' : 'Select a lead'}</p></div>
  )

  return compact
    ? <div className="k1-split k1-split--compact"><MobileSwap showDetail={Boolean(id)} list={list} detail={detail} /></div>
    : <div className="k1-split">{list}{detail}</div>
}
