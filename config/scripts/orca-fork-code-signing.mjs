import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const ORCA_FORK_LOCAL_SIGNING_IDENTITY = 'Orca Fork Local Code Signing'

/**
 * Extracts exact identity labels from `security find-identity`.
 *
 * @param {string} output Raw `security find-identity` output.
 * @returns {string[]} Identity labels in Keychain order.
 */
export function codeSigningIdentityNames(output) {
  return [...output.matchAll(/^\s*\d+\)\s+[0-9A-F]+\s+"([^"]+)"$/gimu)].map((match) => match[1])
}

/**
 * Chooses the explicit signer or the managed local Fork identity.
 *
 * @param {object} input Signing discovery input.
 * @param {string | undefined} input.explicitIdentity Optional user-selected identity.
 * @param {string} input.identities Raw `security find-identity` output.
 * @returns {string} Exact Keychain identity label.
 */
export function resolveForkSigningIdentity({ explicitIdentity, identities }) {
  const available = codeSigningIdentityNames(identities)
  const requested = explicitIdentity || ORCA_FORK_LOCAL_SIGNING_IDENTITY
  if (!available.includes(requested)) {
    throw new Error(
      explicitIdentity
        ? `Code signing identity is unavailable: ${explicitIdentity}`
        : `Stable Orca Fork signing identity is unavailable. Run: pnpm fork:mac signing-setup --apply`
    )
  }
  return requested
}

/**
 * Resolves the current Keychain identity used by Fork builds.
 *
 * @param {string | undefined} explicitIdentity Optional user-selected identity.
 * @returns {string} Exact Keychain identity label.
 */
export function resolveCurrentForkSigningIdentity(explicitIdentity) {
  return resolveForkSigningIdentity({
    explicitIdentity,
    identities: captureCodeSigningIdentities()
  })
}

/**
 * Resolves a display-only signer without making status fail before setup.
 *
 * @param {object} input Signing discovery input.
 * @param {string | undefined} input.explicitIdentity Optional user-selected identity.
 * @param {string} input.identities Raw `security find-identity` output.
 * @returns {string | null} Resolved identity or null when setup is required.
 */
export function optionalForkSigningIdentity({ explicitIdentity, identities }) {
  try {
    return resolveForkSigningIdentity({ explicitIdentity, identities })
  } catch {
    return null
  }
}

/**
 * Reports whether a designated requirement survives app byte changes.
 *
 * @param {string} requirement Raw `codesign -d -r-` output.
 * @returns {boolean} True when a certificate anchor, rather than only a cdhash, owns identity.
 */
export function hasStableCodeRequirement(requirement) {
  return (
    requirement.includes('designated =>') &&
    !/designated\s*=>\s*cdhash\b/u.test(requirement) &&
    /\b(anchor|certificate)\b/u.test(requirement)
  )
}

/**
 * Creates one non-extractable, user-trusted local code-signing identity.
 *
 * @param {object} input Setup coordinates.
 * @param {string} input.keychainPath Login Keychain path.
 * @param {string} input.trustBackupPath Pre-change trust-settings backup path.
 * @param {(command: string, args: string[]) => unknown} [input.run] Command runner.
 * @returns {void}
 */
export function createForkSigningIdentity({
  keychainPath,
  trustBackupPath,
  run = (command, args) => execFileSync(command, args, { stdio: 'inherit' })
}) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'orca-fork-signing-'))
  const keyPath = join(temporaryDirectory, 'identity-key.pem')
  const certificatePath = join(temporaryDirectory, 'identity-certificate.pem')
  const archivePath = join(temporaryDirectory, 'identity.p12')
  const archivePassword = randomBytes(24).toString('hex')
  mkdirSync(dirname(trustBackupPath), { recursive: true })

  try {
    run('security', ['trust-settings-export', trustBackupPath])
    run('openssl', [
      'req',
      '-new',
      '-newkey',
      'rsa:3072',
      '-x509',
      '-sha256',
      '-days',
      '3650',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certificatePath,
      '-subj',
      `/CN=${ORCA_FORK_LOCAL_SIGNING_IDENTITY}/O=Local Development`,
      '-addext',
      'basicConstraints=critical,CA:FALSE',
      '-addext',
      'keyUsage=critical,digitalSignature',
      '-addext',
      'extendedKeyUsage=critical,codeSigning'
    ])
    run('openssl', [
      'pkcs12',
      '-export',
      '-out',
      archivePath,
      '-inkey',
      keyPath,
      '-in',
      certificatePath,
      '-name',
      ORCA_FORK_LOCAL_SIGNING_IDENTITY,
      '-passout',
      `pass:${archivePassword}`
    ])
    run('security', [
      'import',
      archivePath,
      '-k',
      keychainPath,
      '-f',
      'pkcs12',
      '-P',
      archivePassword,
      '-x',
      '-T',
      '/usr/bin/codesign'
    ])
    run('security', [
      'add-trusted-cert',
      '-r',
      'trustRoot',
      '-p',
      'codeSign',
      '-k',
      keychainPath,
      certificatePath
    ])
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

/**
 * Creates the managed identity only when the requested signer is unavailable.
 *
 * @param {object} input Setup coordinates.
 * @param {string | undefined} input.explicitIdentity Optional user-selected identity.
 * @param {string} input.stateDirectory Installer state directory.
 * @param {string} input.backupTimestamp Filesystem-safe timestamp for the trust backup.
 * @returns {{identity: string, trustBackupPath: string | null}} Setup result.
 */
export function setupForkSigningIdentity({ explicitIdentity, stateDirectory, backupTimestamp }) {
  try {
    return {
      identity: resolveCurrentForkSigningIdentity(explicitIdentity),
      trustBackupPath: null
    }
  } catch (error) {
    if (explicitIdentity) {
      throw error
    }
  }

  const trustBackupPath = join(
    stateDirectory,
    'signing-trust-backups',
    `${backupTimestamp}-user-trust-settings.plist`
  )
  createForkSigningIdentity({
    keychainPath: join(homedir(), 'Library', 'Keychains', 'login.keychain-db'),
    trustBackupPath
  })
  return {
    identity: resolveCurrentForkSigningIdentity(explicitIdentity),
    trustBackupPath
  }
}

/**
 * Reads valid code-signing identities from the current login Keychain search list.
 *
 * @returns {string} Combined command output, or an empty string on discovery failure.
 */
function captureCodeSigningIdentities() {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8'
  })
  if (result.error || result.status !== 0) {
    return ''
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
}
