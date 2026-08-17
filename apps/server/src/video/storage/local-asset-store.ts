import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { VideoDomainError } from "@tibao/video-core";

export interface StoredUpload {
  tempKey: string;
  bytes: number;
  sha256: string;
}

export interface StoredGeneratedAsset {
  storageKey: string;
  bytes: number;
  sha256: string;
}

export class LocalVideoAssetStore {
  constructor(
    readonly root: string,
    readonly tempRoot: string,
    private readonly namespaceKey: string,
  ) {}

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.root, { recursive: true, mode: 0o700 }),
      mkdir(this.tempRoot, { recursive: true, mode: 0o700 }),
    ]);
  }

  tempKey(uploadId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new Error("Invalid upload id");
    return `${uploadId}.part`;
  }

  async writeUpload(
    uploadId: string,
    stream: Readable,
    maxBytes: number,
  ): Promise<StoredUpload> {
    const tempKey = this.tempKey(uploadId);
    const path = this.resolveTemp(tempKey);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    const handle = await open(path, "wx", 0o600);
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        bytes += buffer.length;
        if (bytes > maxBytes) {
          throw new VideoDomainError({
            code: "UPLOAD_TOO_LARGE",
            message: `Upload exceeds the ${maxBytes} byte limit`,
            statusCode: 413,
          });
        }
        hash.update(buffer);
        await handle.write(buffer);
      }
    } catch (error) {
      await handle.close();
      await unlink(path).catch(() => undefined);
      throw error;
    }
    await handle.sync();
    await handle.close();
    return { tempKey, bytes, sha256: hash.digest("hex") };
  }

  async detectMime(tempKey: string): Promise<string | null> {
    const handle = await open(this.resolveTemp(tempKey), "r");
    const prefix = Buffer.alloc(16);
    let bytesRead = 0;
    try {
      ({ bytesRead } = await handle.read(prefix, 0, prefix.length, 0));
    } finally {
      await handle.close();
    }
    const header = prefix.subarray(0, bytesRead);
    if (header.length >= 12 && header.subarray(4, 8).toString("ascii") === "ftyp") {
      const brand = header.subarray(8, 12).toString("ascii");
      return brand.startsWith("qt") ? "video/quicktime" : "video/mp4";
    }
    if (header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      return "video/webm";
    }
    if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return "image/png";
    }
    if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return "image/jpeg";
    }
    if (
      header.length >= 12 &&
      header.subarray(0, 4).toString("ascii") === "RIFF" &&
      header.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return "image/webp";
    }
    return null;
  }

  async commit(ownerId: string, tempKey: string, sha256: string): Promise<string> {
    const ownerNamespace = createHmac(
      "sha256",
      this.namespaceKey || "tibao-video-local-owner-namespace",
    )
      .update(ownerId, "utf8")
      .digest("hex");
    const storageKey = join("owners", ownerNamespace, sha256);
    const destination = this.resolveStorage(storageKey);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    try {
      await rename(this.resolveTemp(tempKey), destination);
    } catch (error) {
      const candidate = error as NodeJS.ErrnoException;
      if (candidate.code !== "EEXIST") throw error;
      await unlink(this.resolveTemp(tempKey)).catch(() => undefined);
    }
    return storageKey.split(sep).join("/");
  }

  createReadStream(storageKey: string) {
    return createReadStream(this.resolveStorage(storageKey));
  }

  tempPath(tempKey: string): string {
    return this.resolveTemp(tempKey);
  }

  storagePath(storageKey: string): string {
    return this.resolveStorage(storageKey);
  }

  async size(storageKey: string): Promise<number> {
    return (await stat(this.resolveStorage(storageKey))).size;
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveStorage(storageKey));
  }

  async putGenerated(ownerId: string, data: Buffer): Promise<StoredGeneratedAsset> {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const ownerNamespace = createHmac(
      "sha256",
      this.namespaceKey || "tibao-video-local-owner-namespace",
    )
      .update(ownerId, "utf8")
      .digest("hex");
    const storageKey = join("owners", ownerNamespace, sha256);
    const destination = this.resolveStorage(storageKey);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    let handle;
    try {
      handle = await open(destination, "wx", 0o600);
      await handle.writeFile(data);
      await handle.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await handle?.close();
    }
    return { storageKey: storageKey.split(sep).join("/"), bytes: data.length, sha256 };
  }

  async discardTemp(tempKey: string): Promise<void> {
    await unlink(this.resolveTemp(tempKey)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  private resolveTemp(key: string): string {
    return this.safeResolve(this.tempRoot, key);
  }

  private resolveStorage(key: string): string {
    return this.safeResolve(this.root, key);
  }

  private safeResolve(root: string, key: string): string {
    const base = resolve(root);
    const candidate = resolve(base, key);
    if (candidate !== base && !candidate.startsWith(`${base}${sep}`)) throw new Error("Unsafe storage key");
    return candidate;
  }
}
