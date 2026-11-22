import crypto from 'node:crypto';

const FALLBACK_SECRET = crypto.randomBytes(32);

export class CredentialDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialDecryptionError';
  }
}

function getAesKey(): Buffer {
  const explicitKey =
    process.env.DATASOURCE_ENCRYPTION_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim();
  if (explicitKey) {
    return crypto.createHash('sha256').update(explicitKey).digest();
  }
  if (process.env.DB_PASSWORD) {
    const material = `dblens-ds:${process.env.DB_HOST || ''}:${process.env.DB_USER || ''}:${process.env.DB_PASSWORD}`;
    return crypto.createHash('sha256').update(material).digest();
  }
  return FALLBACK_SECRET;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function encryptSecret(plaintext: string): string {
  const key = getAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new CredentialDecryptionError(
      'Stored datasource credentials are invalid. Please re-enter the password.',
    );
  }
  const [ivHex, tagHex, dataHex] = parts;
  const key = getAesKey();
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    throw new CredentialDecryptionError(
      'Stored datasource password could not be unlocked after a server restart. Please re-enter the password (and optionally set DATASOURCE_ENCRYPTION_KEY in Secrets).',
    );
  }
}
