import { useAuth, useOrganization, useOrganizationList, useUser } from '@clerk/react'
import type { OrganizationInvitationResource, OrganizationMembershipResource } from '@clerk/react/types'
import { AnimatePresence, motion } from 'motion/react'
import { FormEvent, useId, useRef, useState } from 'react'
import { ease } from '../../lib/motion'
import { authError } from '../auth/flow'
import { useSession } from '../auth/session'
import { TEAM_NAME, TEAM_ROLE } from '../auth/team'
import { Skeleton, Spinner } from '../ui/controls'
import { UserAdd } from '../ui/icons'
import { Dialog } from '../ui/overlay'
import { formatStamp } from './SplitView'

type Notify = (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function initialsOf(name: string) {
  const words = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase() || '?'
}

function PersonAvatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  return (
    <span className="k1-avatar k1-member__avatar" aria-hidden="true">
      {imageUrl ? <img className="k1-avatar__img" src={imageUrl} alt="" referrerPolicy="no-referrer" /> : initialsOf(name)}
    </span>
  )
}

function memberName(member: OrganizationMembershipResource) {
  const data = member.publicUserData
  const full = [data?.firstName, data?.lastName].filter(Boolean).join(' ').trim()
  return { name: full || data?.identifier || 'Member', email: data?.identifier ?? '', imageUrl: data?.hasImage ? data.imageUrl : undefined, userId: data?.userId }
}

function InviteDialog({ open, onClose, onSent, invite }: {
  open: boolean
  onClose: () => void
  onSent: (emails: string[]) => void
  invite: (emails: string[]) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [sending, setSending] = useState(false)
  const [serverError, setServerError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const ids = { input: useId(), hint: useId(), error: useId() }

  const emails = [...new Set(value.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))]
  const invalid = emails.filter((email) => !EMAIL.test(email))
  const error = !emails.length ? 'Enter an email address.' : invalid.length ? `“${invalid[0]}” is not a valid email address.` : ''
  const shown = (attempted && error) || serverError

  const close = () => {
    if (sending) return
    setValue('')
    setAttempted(false)
    setServerError('')
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    setServerError('')
    if (error) return
    setSending(true)
    try {
      await invite(emails)
      onSent(emails)
      setValue('')
      setAttempted(false)
      onClose()
    } catch (failure) {
      setServerError(authError(failure))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} title="Invite people" onClose={close} width={440} initialFocus={inputRef}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <div className="k1-form-stack">
          <div className="k1-field">
            <label htmlFor={ids.input}>Email addresses</label>
            <input
              ref={inputRef}
              id={ids.input}
              className="k1-input"
              type="text"
              inputMode="email"
              autoComplete="off"
              value={value}
              placeholder="name@k1katsastus.fi"
              aria-invalid={Boolean(shown) || undefined}
              aria-describedby={shown ? `${ids.hint} ${ids.error}` : ids.hint}
              onChange={(event) => setValue(event.target.value)}
            />
            <p id={ids.hint} className="k1-hint">Separate several addresses with commas. Each person gets an email with a link to join {TEAM_NAME}.</p>
          </div>
          {shown && <p id={ids.error} className="k1-auth__error" role="alert">{shown}</p>}
        </div>
        <footer className="k1-dialog__foot">
          <button type="button" className="k1-btn k1-btn--outline" onClick={close} disabled={sending}>Cancel</button>
          <button type="submit" className="k1-btn k1-btn--primary" disabled={sending} aria-busy={sending}>
            {sending && <Spinner />}{emails.length > 1 ? `Send ${emails.length} invites` : 'Send invite'}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}

function ConfirmRemove({ target, onClose, onConfirm }: { target: { name: string } | null; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      onClose()
    } catch (failure) {
      setError(authError(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={Boolean(target)} title={`Remove ${target?.name ?? ''}?`} onClose={() => { if (!busy) { setError(''); onClose() } }} width={420}>
      <div className="k1-form-stack">
        <p className="k1-dialog__text">They will no longer be part of the {TEAM_NAME} team. You can invite them again later.</p>
        {error && <p className="k1-auth__error" role="alert">{error}</p>}
      </div>
      <footer className="k1-dialog__foot">
        <button type="button" className="k1-btn k1-btn--outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="k1-btn k1-btn--danger" onClick={() => void confirm()} disabled={busy} aria-busy={busy}>{busy && <Spinner />}Remove</button>
      </footer>
    </Dialog>
  )
}

function ClerkTeam({ notify }: { notify: Notify }) {
  const { user } = useUser()
  const { sessionId } = useAuth()
  const { isLoaded, organization, memberships, invitations } = useOrganization({
    memberships: { infinite: true, pageSize: 50, keepPreviousData: true },
    invitations: { infinite: true, pageSize: 50, status: ['pending'], keepPreviousData: true },
  })
  const { createOrganization, setActive } = useOrganizationList()
  const [inviting, setInviting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ member: OrganizationMembershipResource; name: string } | null>(null)

  if (!isLoaded || (organization && (!memberships?.data || !invitations?.data))) {
    return <div className="k1-table__skeleton">{[0, 1, 2].map((key) => <Skeleton key={key} height={64} />)}</div>
  }

  if (!organization) {
    const create = async () => {
      if (!createOrganization || !setActive) return
      setCreating(true)
      try {
        const created = await createOrganization({ name: TEAM_NAME })
        await setActive({ session: sessionId, organization: created.id })
      } catch (failure) {
        notify({ tone: 'error', title: 'Team not created', body: authError(failure) })
      } finally {
        setCreating(false)
      }
    }
    return (
      <div className="k1-team__empty">
        <strong>No team yet</strong>
        <p>Create the {TEAM_NAME} team, then invite people by email. If someone invited you, sign in with the invited email and you’ll join automatically.</p>
        <button type="button" className="k1-btn k1-btn--primary k1-btn--sm" onClick={() => void create()} disabled={creating} aria-busy={creating}>
          {creating && <Spinner />}Create team
        </button>
      </div>
    )
  }

  const members = memberships?.data ?? []
  const pending = invitations?.data ?? []

  const invite = async (emails: string[]) => {
    await organization.inviteMembers({ emailAddresses: emails, role: TEAM_ROLE })
    await invitations?.revalidate?.()
  }

  const revoke = async (invitation: OrganizationInvitationResource) => {
    setRevoking(invitation.id)
    try {
      await invitation.revoke()
      await invitations?.revalidate?.()
      notify({ title: 'Invite revoked', body: `${invitation.emailAddress} can no longer use the link to join.` })
    } catch (failure) {
      notify({ tone: 'error', title: 'Invite not revoked', body: authError(failure) })
    } finally {
      setRevoking(null)
    }
  }

  return (
    <>
      <section className="k1-team__section" aria-labelledby="k1-members-title">
        <div className="k1-team__head">
          <h2 id="k1-members-title" className="k1-section-title">Members <span className="k1-team__count">{members.length}</span></h2>
          <button type="button" className="k1-btn k1-btn--primary k1-btn--sm" aria-haspopup="dialog" onClick={() => setInviting(true)}>
            <UserAdd size={16} />Invite
          </button>
        </div>
        <ul className="k1-versions">
          <AnimatePresence initial={false}>
            {members.map((member) => {
              const person = memberName(member)
              const you = person.userId === user?.id
              return (
                <motion.li key={member.id} className="k1-version k1-member" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease }}>
                  <PersonAvatar name={person.name} imageUrl={person.imageUrl} />
                  <div className="k1-version__main">
                    <div className="k1-version__title">
                      <strong>{person.name}</strong>
                      {you && <span className="k1-vtag">You</span>}
                    </div>
                    {person.email && person.email !== person.name && <p className="k1-version__note">{person.email}</p>}
                    <p className="k1-version__meta">Joined {formatStamp(member.createdAt.toISOString())}</p>
                  </div>
                  {!you && (
                    <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" aria-haspopup="dialog" onClick={() => setRemoving({ member, name: person.name })}>Remove</button>
                  )}
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      </section>

      {pending.length > 0 && (
        <section className="k1-team__section" aria-labelledby="k1-invites-title">
          <h2 id="k1-invites-title" className="k1-section-title">Invitations <span className="k1-team__count">{pending.length}</span></h2>
          <ul className="k1-versions">
            <AnimatePresence initial={false}>
              {pending.map((invitation) => (
                <motion.li key={invitation.id} className="k1-version k1-member" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease }}>
                  <PersonAvatar name={invitation.emailAddress} />
                  <div className="k1-version__main">
                    <div className="k1-version__title">
                      <strong>{invitation.emailAddress}</strong>
                      <span className="k1-vtag is-draft">Invited</span>
                    </div>
                    <p className="k1-version__meta">Sent {formatStamp(invitation.createdAt.toISOString())}</p>
                  </div>
                  <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={() => void revoke(invitation)} disabled={revoking === invitation.id} aria-busy={revoking === invitation.id}>
                    {revoking === invitation.id && <Spinner />}Revoke
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}

      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        invite={invite}
        onSent={(emails) => notify({
          title: emails.length > 1 ? `${emails.length} invites sent` : 'Invite sent',
          body: `${emails.length > 1 ? 'They get' : `${emails[0]} gets`} an email with a link to join ${TEAM_NAME}.`,
        })}
      />
      <ConfirmRemove
        target={removing}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await removing.member.destroy()
          await memberships?.revalidate?.()
          notify({ title: 'Member removed', body: `${removing.name} is no longer in ${TEAM_NAME}.` })
        }}
      />
    </>
  )
}

export function TeamPage({ notify }: { notify: Notify }) {
  const session = useSession()
  return (
    <div className="k1-deploy">
      <header className="k1-deploy__head">
        <h1 className="k1-deploy__title">Team</h1>
      </header>
      <div className="k1-deploy__body k1-team">
        {session.mode === 'clerk'
          ? <ClerkTeam notify={notify} />
          : <p className="k1-hint">Team members can be managed once Clerk sign-in is connected. The development preview has no accounts.</p>}
      </div>
    </div>
  )
}
