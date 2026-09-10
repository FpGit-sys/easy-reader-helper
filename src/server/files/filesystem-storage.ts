import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { detectSupportedMimeType, MAX_DOCUMENT_BYTES, sha256 } from "./policy";

// Keep the raw object layout identical to S3/MinIO backups. Metadata lives in
// PostgreSQL, so restoring an older Docker backup needs no sidecar conversion.
export function resolveObjectPath(root: string, key: string) {
  if (!path.isAbsolute(root)) throw new Error("OBJECT_STORAGE_NOT_CONFIGURED");
  const parts = key.split("/");
  if (
    key.length > 900 ||
    parts.some(
      (part) =>
        !part ||
        !/^[a-zA-Z0-9._-]+$/.test(part) ||
        part === "." ||
        part === ".." ||
        part.endsWith(".") ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw new Error("INVALID_STORAGE_KEY");
  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("INVALID_STORAGE_KEY");
  }
  return target;
}

async function assertNoLinks(root: string, target: string) {
  const segments = path.relative(root, target).split(path.sep);
  let current = root;
  for (const segment of ["", ...segments]) {
    if (segment) current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("INVALID_STORAGE_LINK");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export class FilesystemStorage {
  constructor(
    readonly root: string,
    readonly secret: string,
  ) {
    if (!path.isAbsolute(root) || secret.length < 32)
      throw new Error("OBJECT_STORAGE_NOT_CONFIGURED");
  }

  async ready() {
    await assertNoLinks(this.root, this.root);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const probe = path.join(this.root, `.health-${randomUUID()}`);
    const file = await open(probe, "wx", 0o600);
    await file.close();
    await unlink(probe);
    return true;
  }

  async put(input: { key: string; body: Uint8Array; contentType: string; sha256: string }) {
    if (!input.body.length || input.body.length > MAX_DOCUMENT_BYTES)
      throw new Error("FILE_SIZE_NOT_ALLOWED");
    if (sha256(input.body) !== input.sha256) throw new Error("FILE_HASH_MISMATCH");
    const target = resolveObjectPath(this.root, input.key);
    await assertNoLinks(this.root, target);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const file = await open(target, "wx", 0o600);
    try {
      await file.writeFile(input.body);
      await file.sync();
    } catch (error) {
      await file.close();
      await unlink(target).catch(() => undefined);
      throw error;
    }
    await file.close();
  }

  async read(key: string) {
    const target = resolveObjectPath(this.root, key);
    await assertNoLinks(this.root, target);
    const info = await lstat(target);
    if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) throw new Error("INVALID_STORED_FILE");
    const body = await readFile(target);
    return {
      body,
      contentType: detectSupportedMimeType(body) ?? "application/octet-stream",
      sha256: sha256(body),
    };
  }

  async delete(key: string) {
    const target = resolveObjectPath(this.root, key);
    await assertNoLinks(this.root, target);
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  sign(key: string, expires: number) {
    resolveObjectPath(this.root, key);
    if (!Number.isSafeInteger(expires)) throw new Error("INVALID_DOWNLOAD_EXPIRY");
    return createHmac("sha256", this.secret)
      .update(`silonr-download-v1\n${expires}\n${key}`)
      .digest("base64url");
  }

  verify(key: string, expires: number, signature: string, now = Math.floor(Date.now() / 1000)) {
    try {
      if (expires <= now || expires > now + 900 || !/^[A-Za-z0-9_-]{43}$/.test(signature))
        return false;
      return timingSafeEqual(Buffer.from(this.sign(key, expires)), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}
