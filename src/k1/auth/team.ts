import { useAuth, useOrganizationList } from '@clerk/react'
import { useEffect, useRef, useState } from 'react'

export const TEAM_NAME = 'K1 Katsastus'
// Everyone invited through the app joins as an admin, so they can invite the next person.
export const TEAM_ROLE = 'org:admin'

export type TeamStatus = 'loading' | 'member' | 'none'

// Accepts pending invites, opens the user's team, and reports whether they belong to one.
export function useJoinTeam(): TeamStatus {
  const { isSignedIn, orgId, sessionId } = useAuth()
  const { isLoaded, setActive, userInvitations, userMemberships } = useOrganizationList({
    userInvitations: { status: 'pending' },
    userMemberships: true,
  })
  const accepting = useRef(new Set<string>())
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (!isSignedIn || !isLoaded) return
    const pending = (userInvitations.data ?? []).filter((invitation) => !accepting.current.has(invitation.id))
    if (!pending.length) return
    pending.forEach((invitation) => accepting.current.add(invitation.id))
    setJoining(true)
    void Promise.allSettled(pending.map((invitation) => invitation.accept())).then(async (results) => {
      const joined = results.find((result) => result.status === 'fulfilled')
      await Promise.all([userInvitations.revalidate?.(), userMemberships.revalidate?.()])
      if (joined && joined.status === 'fulfilled' && !orgId) await setActive({ session: sessionId, organization: joined.value.publicOrganizationData.id })
    }).finally(() => setJoining(false))
  }, [isLoaded, isSignedIn, orgId, sessionId, setActive, userInvitations, userMemberships])

  useEffect(() => {
    if (!isSignedIn || !isLoaded || orgId) return
    const first = userMemberships.data?.[0]
    if (first) void setActive({ session: sessionId, organization: first.organization.id })
  }, [isLoaded, isSignedIn, orgId, sessionId, setActive, userMemberships.data])

  if (orgId) return 'member'
  if (!isSignedIn || !isLoaded || joining || userMemberships.isLoading || userInvitations.isLoading) return 'loading'
  if (userMemberships.data?.length || userInvitations.data?.length) return 'loading'
  return 'none'
}
