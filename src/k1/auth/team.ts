import { useAuth, useOrganizationList } from '@clerk/react'
import { useEffect, useRef } from 'react'

export const TEAM_NAME = 'K1 Katsastus'
export const TEAM_ROLE = 'org:admin'

export function useJoinTeam() {
  const { isSignedIn, orgId, sessionId } = useAuth()
  const { isLoaded, setActive, userInvitations, userMemberships } = useOrganizationList({
    userInvitations: { status: 'pending' },
    userMemberships: true,
  })
  const accepting = useRef(new Set<string>())

  useEffect(() => {
    if (!isSignedIn || !isLoaded) return
    const pending = (userInvitations.data ?? []).filter((invitation) => !accepting.current.has(invitation.id))
    if (!pending.length) return
    pending.forEach((invitation) => accepting.current.add(invitation.id))
    void Promise.allSettled(pending.map((invitation) => invitation.accept())).then(async (results) => {
      const joined = results.find((result) => result.status === 'fulfilled')
      await Promise.all([userInvitations.revalidate?.(), userMemberships.revalidate?.()])
      if (joined && joined.status === 'fulfilled' && !orgId) await setActive({ session: sessionId, organization: joined.value.publicOrganizationData.id })
    })
  }, [isLoaded, isSignedIn, orgId, sessionId, setActive, userInvitations, userMemberships])

  useEffect(() => {
    if (!isSignedIn || !isLoaded || orgId) return
    const first = userMemberships.data?.[0]
    if (first) void setActive({ session: sessionId, organization: first.organization.id })
  }, [isLoaded, isSignedIn, orgId, sessionId, setActive, userMemberships.data])
}
