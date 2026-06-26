import "server-only";
import crypto from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Symmetric encryption for OAuth access tokens at rest.
 *
 * We never store a raw Shopify / Meta access token in Postgres. Tokens are
 * encrypted with AES-256-GCM using TOKEN_ENCRYPTION_KEY (32 bytes / 64 hex
 * chars) before being persisted, and decrypted only on the server when a
 * sync needs to call the upstream API.
 *
 * Stored format:  <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = serverEnv.tokenEncryptionKey;
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars). " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Malformed encrypted token payload.");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Constant-time comparison of two hex/utf8 strings (for HMAC checks). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Random URL-safe state token for OAuth CSRF protection. */
export function randomState(): string {
  return crypto.randomBytes(24).toString("base64url");
}
