import { describe, expect, it, vi } from 'vitest'
import { revokeEcpSession } from '../../src/core/auth/ecp-session-logout'

describe('ECP session logout', () => {
  it('revokes the server session before clearing the browser session', async () => {
    const calls: string[] = []
    await revokeEcpSession({
      api: {
        requestApiJson: vi.fn(async () => { calls.push('server') })
      },
      session: {
        clear: vi.fn(() => { calls.push('browser') })
      }
    })

    expect(calls).toEqual(['server', 'browser'])
  })

  it('still clears the browser session when server revocation fails', async () => {
    const clear = vi.fn()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await revokeEcpSession({
      api: {
        requestApiJson: vi.fn().mockRejectedValue(new Error('offline'))
      },
      session: { clear }
    })

    expect(clear).toHaveBeenCalledOnce()
    warning.mockRestore()
  })
})
