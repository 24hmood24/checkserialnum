// Password hashing helpers (Node's built-in scrypt — no extra dependency,
// no native module to compile). Never store or return plaintext passwords.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(String(password), salt, 64).toString('hex');
    return { password_hash: hash, password_salt: salt };
}

export function verifyPassword(password, hash, salt) {
    if (!hash || !salt) return false;
    const candidate = scryptSync(String(password), salt, 64);
    const stored = Buffer.from(hash, 'hex');
    if (candidate.length !== stored.length) return false;
    return timingSafeEqual(candidate, stored);
}
