import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../server/files/policy";

describe("native private download endpoint", () => {
  let root: string;
  beforeEach(async () => {
    vi.resetModules();
    root = await mkdtemp(path.join(tmpdir(), "silonr-download-"));
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-session-secret-with-at-least-32-characters");
    vi.stubEnv("APP_URL", "https://silonr.local");
    vi.stubEnv("STORAGE_DRIVER", "filesystem");
    vi.stubEnv("FILE_STORAGE_PATH", root);
    vi.stubEnv("FILE_DOWNLOAD_SIGNING_SECRET", "test-download-secret-with-at-least-32-characters");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(root, { recursive: true, force: true });
  });
  it("serves only signed bytes and disables shared caching", async () => {
    const storage = await import("../server/files/storage");
    const body = new TextEncoder().encode("%PDF-1.7 private");
    const key = "organization/facility/report.pdf";
    await storage.putPrivateObject({
      key,
      body,
      contentType: "application/pdf",
      sha256: sha256(body),
    });
    const url = await storage.createPrivateDownloadUrl(key, 180);
    const response = await storage.servePrivateFile(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
    const changed = new URL(url);
    changed.searchParams.set("key", "another-organization/report.pdf");
    expect((await storage.servePrivateFile(new Request(changed))).status).toBe(403);
    await storage.deletePrivateObject(key);
    expect((await storage.servePrivateFile(new Request(url))).status).toBe(404);
  });
  it.each(["", "?key=../config/server.env", "?key=anything&expires=NaN&signature=bad"])(
    "rejects unsigned or malformed request %s",
    async (query) => {
      const { servePrivateFile } = await import("../server/files/storage");
      expect(
        (await servePrivateFile(new Request("https://silonr.local/api/files/private" + query)))
          .status,
      ).toBe(403);
    },
  );
  it("does not expose a filesystem route in S3 mode", async () => {
    vi.stubEnv("STORAGE_DRIVER", "s3");
    const { servePrivateFile } = await import("../server/files/storage");
    expect(
      (await servePrivateFile(new Request("https://silonr.local/api/files/private"))).status,
    ).toBe(404);
  });
  it("fails closed when signing configuration is absent", async () => {
    vi.stubEnv("FILE_DOWNLOAD_SIGNING_SECRET", "");
    const { servePrivateFile, checkPrivateStorage } = await import("../server/files/storage");
    await expect(checkPrivateStorage()).rejects.toThrow("OBJECT_STORAGE_NOT_CONFIGURED");
    expect(
      (await servePrivateFile(new Request("https://silonr.local/api/files/private"))).status,
    ).toBe(503);
  });
});
