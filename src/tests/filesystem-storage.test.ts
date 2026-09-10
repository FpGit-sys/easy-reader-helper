import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemStorage, resolveObjectPath } from "../server/files/filesystem-storage";
import { sha256 } from "../server/files/policy";

describe("private native storage", () => {
  let root: string;
  let storage: FilesystemStorage;
  const key = "organization/facility/documents/entity/report.pdf";
  const body = new TextEncoder().encode("%PDF-1.7 example");
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "silonr-storage-"));
    storage = new FilesystemStorage(root, "unit-test-secret-with-at-least-32-characters");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("writes privately, does not overwrite, and reads raw Docker-compatible objects", async () => {
    expect(await storage.ready()).toBe(true);
    const input = { key, body, sha256: sha256(body), contentType: "application/pdf" };
    await storage.put(input);
    expect(await readFile(path.join(root, key))).toEqual(Buffer.from(body));
    const file = await storage.read(key);
    expect(file.contentType).toBe("application/pdf");
    expect(file.sha256).toBe(input.sha256);
    await expect(storage.put(input)).rejects.toMatchObject({ code: "EEXIST" });
    await storage.delete(key);
    await storage.delete(key);
    await expect(storage.read(key)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([
    "../secret",
    "/secret",
    "a\\b",
    "a/../b",
    "a//b",
    "C:/secret",
    "a/file:stream",
    "NUL",
    "a./b",
    "a/%2e%2e/b",
  ])("rejects unsafe Windows path %s", (value) => {
    expect(() => resolveObjectPath(root, value)).toThrow();
  });
  it("refuses hash mismatch and link traversal", async () => {
    await expect(
      storage.put({ key, body, sha256: "bad", contentType: "application/pdf" }),
    ).rejects.toThrow("FILE_HASH_MISMATCH");
    await writeFile(path.join(root, "outside.pdf"), body);
    await symlink(path.join(root, "outside.pdf"), path.join(root, "link.pdf"));
    await expect(storage.read("link.pdf")).rejects.toThrow("INVALID_STORAGE_LINK");
  });
  it("binds URL signature to key, expiry and installation secret", () => {
    const now = 1_800_000_000;
    const expiry = now + 180;
    const signed = storage.sign(key, expiry);
    expect(storage.verify(key, expiry, signed, now)).toBe(true);
    expect(storage.verify(key + "x", expiry, signed, now)).toBe(false);
    expect(storage.verify(key, expiry + 1, signed, now)).toBe(false);
    expect(storage.verify(key, expiry, signed, expiry)).toBe(false);
    expect(storage.verify(key, now + 901, storage.sign(key, now + 901), now)).toBe(false);
    expect(storage.verify(key, NaN, signed, now)).toBe(false);
    expect(
      new FilesystemStorage(root, "another-secret-with-at-least-32-characters").verify(
        key,
        expiry,
        signed,
        now,
      ),
    ).toBe(false);
  });
});
