import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

/** Versioned scrypt storage: scrypt$v=1$N=...$r=...$p=1$<salt>$<key> */
export const SCRYPT_VERSION = 1
export const SCRYPT_N = 32_768
export const SCRYPT_R = 8
export const SCRYPT_P = 1
export const SCRYPT_SALT_BYTES = 16
export const SCRYPT_KEY_BYTES = 32
export const SCRYPT_MAXMEM = 64 * 1024 * 1024

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

const PARAM_BOUNDS = {
  N: { min: 16_384, max: 1_048_576 },
  r: { min: 1, max: 32 },
  p: { min: 1, max: 16 },
} as const

type ParsedScryptHash = {
  version: number
  N: number
  r: number
  p: number
  salt: Buffer
  hash: Buffer
}

/**
 * Dummy hash used only to equalize login timing when the email is unknown.
 * Generated once at module load with the current parameters.
 */
let dummyHashPromise: Promise<string> | undefined

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('pulse-dummy-password-not-a-real-user')
  }
  return dummyHashPromise
}

function encodeBase64Url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

function formatScryptHash(params: {
  N: number
  r: number
  p: number
  salt: Buffer
  hash: Buffer
}): string {
  return [
    'scrypt',
    `v=${SCRYPT_VERSION}`,
    `N=${params.N}`,
    `r=${params.r}`,
    `p=${params.p}`,
    encodeBase64Url(params.salt),
    encodeBase64Url(params.hash),
  ].join('$')
}

function parseScryptHash(stored: string): ParsedScryptHash | null {
  const parts = stored.split('$')
  if (parts.length !== 7 || parts[0] !== 'scrypt') {
    return null
  }

  const versionMatch = /^v=(\d+)$/.exec(parts[1] ?? '')
  const nMatch = /^N=(\d+)$/.exec(parts[2] ?? '')
  const rMatch = /^r=(\d+)$/.exec(parts[3] ?? '')
  const pMatch = /^p=(\d+)$/.exec(parts[4] ?? '')
  const saltPart = parts[5]
  const hashPart = parts[6]

  if (!versionMatch || !nMatch || !rMatch || !pMatch || !saltPart || !hashPart) {
    return null
  }

  const version = Number(versionMatch[1])
  const N = Number(nMatch[1])
  const r = Number(rMatch[1])
  const p = Number(pMatch[1])

  if (version !== SCRYPT_VERSION) {
    return null
  }
  if (N < PARAM_BOUNDS.N.min || N > PARAM_BOUNDS.N.max) {
    return null
  }
  if (r < PARAM_BOUNDS.r.min || r > PARAM_BOUNDS.r.max) {
    return null
  }
  if (p < PARAM_BOUNDS.p.min || p > PARAM_BOUNDS.p.max) {
    return null
  }
  // N must be a power of two for scrypt.
  if ((N & (N - 1)) !== 0) {
    return null
  }

  let salt: Buffer
  let hash: Buffer
  try {
    salt = decodeBase64Url(saltPart)
    hash = decodeBase64Url(hashPart)
  } catch {
    return null
  }

  if (salt.length !== SCRYPT_SALT_BYTES || hash.length !== SCRYPT_KEY_BYTES) {
    return null
  }

  return { version, N, r, p, salt, hash }
}

function deriveKey(
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      SCRYPT_KEY_BYTES,
      { N, r, p, maxmem: SCRYPT_MAXMEM },
      (error, derivedKey) => {
        if (error) {
          reject(error)
          return
        }
        resolve(derivedKey)
      },
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES)
  const hash = await deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)
  return formatScryptHash({ N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, salt, hash })
}

/**
 * Verifies a password against a stored scrypt hash.
 * Malformed stored values fail closed (return false) without throwing.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parsed = parseScryptHash(storedHash)
  if (!parsed) {
    return false
  }

  try {
    const derived = await deriveKey(password, parsed.salt, parsed.N, parsed.r, parsed.p)
    if (derived.length !== parsed.hash.length) {
      return false
    }
    return timingSafeEqual(derived, parsed.hash)
  } catch {
    return false
  }
}

/**
 * Login path helper: always perform a scrypt verify so unknown emails and
 * wrong passwords take a similar amount of work before INVALID_CREDENTIALS.
 */
export async function verifyPasswordForLogin(
  password: string,
  storedHash: string | null,
): Promise<boolean> {
  if (storedHash) {
    return verifyPassword(password, storedHash)
  }
  await verifyPassword(password, await getDummyHash())
  return false
}
