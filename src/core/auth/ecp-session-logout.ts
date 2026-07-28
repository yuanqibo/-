type EcpSessionLogoutAuth = {
  api: {
    requestApiJson: (path: string, options: { method: 'POST' }) => Promise<unknown>
  }
  session: {
    clear: () => void
  }
}

export const revokeEcpSession = async (auth: EcpSessionLogoutAuth | null | undefined): Promise<void> => {
  if (!auth) return
  try {
    await auth.api.requestApiJson('/public/session/logout', { method: 'POST' })
  } catch (error) {
    console.warn('[asset-portal] ECP server session logout failed', error)
  } finally {
    auth.session.clear()
  }
}
