import { describe, expect, it } from 'vitest'
import {
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  SCRYPT_VERSION,
  hashPassword,
  verifyPassword,
  verifyPasswordForLogin,
} from '../shared/password'

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const stored = await hashPassword('correct-horse-battery')
    expect(
      stored.startsWith(`scrypt$v=${SCRYPT_VERSION}$N=${SCRYPT_N}$r=${SCRYPT_R}$p=${SCRYPT_P}$`),
    ).toBe(true)
    await expect(verifyPassword('correct-horse-battery', stored)).resolves.toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const stored = await hashPassword('correct-horse-battery')
    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false)
  })

  it('fails safely on a malformed stored hash', async () => {
    await expect(verifyPassword('anything', 'not-a-valid-hash')).resolves.toBe(false)
    await expect(verifyPassword('anything', 'scrypt$v=1$N=1$r=8$p=1$aa$bb')).resolves.toBe(false)
  })

  it('runs a dummy verify for unknown login emails', async () => {
    await expect(verifyPasswordForLogin('guess', null)).resolves.toBe(false)
  })

  it('does not trim passwords when verifying', async () => {
    const stored = await hashPassword(' spaced ')
    await expect(verifyPassword(' spaced ', stored)).resolves.toBe(true)
    await expect(verifyPassword('spaced', stored)).resolves.toBe(false)
  })
})
