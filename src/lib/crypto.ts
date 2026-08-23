import crypto from "node:crypto";

// The LLM API key is the one secret here that costs money if it leaks, so it is
// encrypted at rest. The master secret lives in .env.local.
const ALGORITHM = "aes-256-gcm";

function masterKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new Error("APP_SECRET is missing from .env.local. See .env.example.");
  }
  // A hex secret is used as raw bytes; anything else is hashed to 32 bytes.
  if (/^[0-9a-f]{64}$/i.test(secret)) return Buffer.from(secret, "hex");
  return crypto.createHash("sha256").update(secret).digest();
}

/** Returns iv.tag.ciphertext, all base64, joined by dots. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64")).join(".");
}

/** Returns null when the stored value cannot be read, such as after APP_SECRET changed. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const [iv, tag, encrypted] = stored.split(".").map((part) => Buffer.from(part, "base64"));
    if (!iv || !tag || !encrypted) return null;
    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
