import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class TokenVault {
  private readonly key: Buffer | null;

  constructor(secret: string) {
    this.key = secret ? createHash("sha256").update(secret, "utf8").digest() : null;
  }

  get available(): boolean {
    return this.key !== null;
  }

  encrypt(value: string): string {
    if (!this.key) throw new Error("TOKEN_ENCRYPTION_KEY 未配置");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
  }

  decrypt(payload: string): string {
    if (!this.key) throw new Error("TOKEN_ENCRYPTION_KEY 未配置");
    const [version, encodedIv, encodedTag, encodedValue] = payload.split(":");
    if (version !== "v1" || !encodedIv || !encodedTag || !encodedValue) {
      throw new Error("无法识别的加密 Token 格式");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
