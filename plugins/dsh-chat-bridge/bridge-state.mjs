/**
 * PURPOSE
 *   Own the chat bridge's durable state and the cryptography that protects it, so the HTTP
 *   surface in `index.js` never touches a file or a key directly. Two things live here: the
 *   server secret that signs device cookies, and the list of paired devices. Watermarks arrive
 *   with the read path and will be added here rather than in the router.
 *
 *   The security property this module exists to hold: the plaintext device token NEVER reaches
 *   the disk. What is stored is the device identity; what is on the phone is a cookie signed
 *   with the server secret. A stolen state directory therefore cannot be replayed as a device,
 *   and a device can be revoked by removing its row.
 *
 * INPUTS
 *   A state directory (absolute path). Functions take and return plain values; none of them
 *   reads configuration or the environment, because the caller owns that policy.
 *
 * OUTPUTS
 *   `loadOrCreateSecret(dir)` returns a 32-byte `Buffer`, creating it mode 0600 on first use.
 *   `readDevices(dir)` returns `{version, devices: []}` — an empty list when the file is absent,
 *   never null and never a throw for absence.
 *   `signCookie(secret, payload)` returns an opaque `v1.<body>.<sig>` string.
 *   `verifyCookie(secret, token)` returns the decoded payload, or `undefined` for a token that is
 *   malformed, wrongly signed, expired, or missing a device id.
 *   `constantTimeEquals(a, b)` returns a boolean and is safe on undefined/empty inputs.
 *
 * KEYWORDS
 *   chat bridge, state directory, hmac, signed cookie, device pairing, revocation, atomic write,
 *   mode 0600, base64url
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Absent state directory: created recursively on first write.
 *   - Absent or unreadable device file: treated as "no paired devices", never as an error, so a
 *     corrupt file locks the phone out rather than crashing the harness.
 *   - Secret file shorter than 32 bytes or unreadable: throws, because a short secret is a
 *     weakened signature and silently regenerating it would invalidate every paired device
 *     without saying so. The caller decides how to report that.
 *   - Writes are tmp-file + rename, so a killed process cannot leave a half-written file.
 *   - A cookie whose payload is valid JSON but lacks `deviceId`: rejected.
 *   - `constantTimeEquals` with mismatched lengths returns false without throwing.
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Bytes in the server secret. 32 is the HMAC-SHA256 key size. */
const SECRET_BYTES = 32

/** Cookie payload version, so a future change can invalidate old cookies deliberately. */
const COOKIE_VERSION = 1

/** File mode for everything this module writes: owner-only. */
const PRIVATE_MODE = 0o600

/**
 * Resolve a path inside the state directory, creating the directory if needed.
 *
 * @param dir - Absolute state directory.
 * @param name - File name inside it.
 * @returns The absolute path of the named file.
 */
export function statePath(dir, name) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return join(dir, name)
}

/**
 * Write JSON atomically: a sibling tmp file, fsync-free but rename-atomic, then rename over.
 *
 * @param path - Destination file.
 * @param value - JSON-serializable value.
 * @returns Nothing.
 */
export function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: PRIVATE_MODE })
  try {
    chmodSync(temporary, PRIVATE_MODE)
  } catch {
    // A filesystem without POSIX modes (or Windows) is not a failure: the rename is what
    // makes the write atomic, and the mode is defence in depth on the platforms that have it.
  }
  renameSync(temporary, path)
}

/**
 * Read the server secret, creating it on first use.
 *
 * @param dir - Absolute state directory.
 * @returns The 32-byte secret.
 * @throws When an existing secret file is unreadable or too short.
 */
export function loadOrCreateSecret(dir) {
  const path = statePath(dir, 'secret')
  let raw
  try {
    raw = readFileSync(path)
  } catch {
    raw = undefined
  }
  if (raw !== undefined) {
    if (raw.byteLength < SECRET_BYTES) {
      throw new Error(
        `chat-bridge: the server secret at ${path} is ${String(raw.byteLength)} bytes, shorter than the ${String(SECRET_BYTES)} required; refusing to weaken every paired device silently`,
      )
    }
    return raw
  }
  const created = randomBytes(SECRET_BYTES)
  writeFileSync(path, created, { mode: PRIVATE_MODE })
  return created
}

/**
 * Read the paired-device list.
 *
 * @param dir - Absolute state directory.
 * @returns A record with a `devices` array, always usable; a missing or corrupt file reads as
 *   empty so the bridge never crashes on state it can also recreate.
 */
export function readDevices(dir) {
  const path = statePath(dir, 'devices.json')
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return {
      version: 1,
      devices: Array.isArray(parsed?.devices) ? parsed.devices : [],
    }
  } catch {
    return { version: 1, devices: [] }
  }
}

/**
 * Append one paired device and persist the list.
 *
 * @param dir - Absolute state directory.
 * @param label - Human-readable label for the device, e.g. `Pixel`.
 * @returns The created device record, whose `id` is also the cookie's subject.
 */
export function addDevice(dir, label) {
  const record = {
    id: randomUUID(),
    label: typeof label === 'string' && label.trim() !== '' ? label.trim().slice(0, 64) : 'phone',
    createdAt: Date.now(),
  }
  const current = readDevices(dir)
  writeJsonAtomic(statePath(dir, 'devices.json'), {
    version: 1,
    devices: [...current.devices, record],
  })
  return record
}

/**
 * Whether a device id is still paired.
 *
 * @param dir - Absolute state directory.
 * @param id - Device id from a cookie payload.
 * @returns True only when the id is present, so deleting the row revokes the device.
 */
export function hasDevice(dir, id) {
  return readDevices(dir).devices.some((device) => device?.id === id)
}

/**
 * Constant-time string comparison that never throws on odd inputs.
 *
 * @param a - First value; not required to be a string.
 * @param b - Second value; not required to be a string.
 * @returns True only when both are strings of equal length and equal bytes.
 */
export function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.byteLength !== right.byteLength) return false
  return timingSafeEqual(left, right)
}

/** Base64url-encode a buffer. */
function encode(value) {
  return Buffer.from(value).toString('base64url')
}

/**
 * Sign a cookie payload.
 *
 * @param secret - The server secret.
 * @param payload - JSON-serializable payload.
 * @returns `v1.<base64url(body)>.<base64url(hmac)>`.
 */
export function signCookie(secret, payload) {
  const body = encode(Buffer.from(JSON.stringify({ version: COOKIE_VERSION, ...payload })))
  const signature = encode(createHmac('sha256', secret).update(body).digest())
  return `v1.${body}.${signature}`
}

/**
 * Verify a cookie and return its payload.
 *
 * @param secret - The server secret.
 * @param token - The cookie value.
 * @param now - Current epoch milliseconds, injectable so expiry is testable without waiting.
 * @returns The decoded payload, or `undefined` when the token is unusable for any reason.
 */
export function verifyCookie(secret, token, now = Date.now()) {
  if (typeof token !== 'string') return undefined
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  const [version, body, signature] = parts
  if (version !== 'v1' || body === undefined || signature === undefined) return undefined
  const expected = encode(createHmac('sha256', secret).update(body).digest())
  if (!constantTimeEquals(signature, expected)) return undefined
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (payload === null || typeof payload !== 'object') return undefined
  if (payload.version !== COOKIE_VERSION) return undefined
  if (typeof payload.deviceId !== 'string' || payload.deviceId === '') return undefined
  if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now) return undefined
  return payload
}

/**
 * Generate a short, human-typable pairing code.
 *
 * @returns Six digits as a string, drawn from a uniform random 0-999999.
 */
export function newPairingCode() {
  const value = randomBytes(4).readUInt32BE(0) % 1000000
  return String(value).padStart(6, '0')
}
