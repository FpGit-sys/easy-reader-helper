import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  detectSupportedMimeType,
  safeStorageFilename,
  sha256,
  validateDocumentUpload,
  validateEvidenceImage,
  validateFileContent,
  validateRequestContentLength,
} from "@/server/files/policy";

describe("política de uploads", () => {
  it("aceita PDF dentro do limite", () => {
    expect(() =>
      validateDocumentUpload({
        filename: "laudo.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).not.toThrow();
  });

  it("rejeita executável disfarçado por nome", () => {
    expect(() =>
      validateDocumentUpload({
        filename: "laudo.pdf.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 1024,
      }),
    ).toThrow("FILE_TYPE_NOT_ALLOWED");
  });

  it("rejeita arquivos acima do limite", () => {
    expect(() =>
      validateDocumentUpload({
        filename: "grande.pdf",
        mimeType: "application/pdf",
        sizeBytes: MAX_DOCUMENT_BYTES + 1,
      }),
    ).toThrow("FILE_SIZE_NOT_ALLOWED");
  });

  it("aceita apenas imagens permitidas no fluxo de foto", () => {
    expect(() =>
      validateEvidenceImage({ filename: "silo.webp", mimeType: "image/webp", sizeBytes: 5000 }),
    ).not.toThrow();
    expect(() =>
      validateEvidenceImage({ filename: "evidencia.pdf", mimeType: "application/pdf", sizeBytes: 5000 }),
    ).toThrow("FILE_TYPE_NOT_ALLOWED");
  });

  it("rejeita multipart declarado acima do teto antes de materializar formData", () => {
    const request = new Request("https://silonr.local/upload", {
      method: "POST",
      headers: {
        "content-length": String(MAX_DOCUMENT_BYTES + MULTIPART_OVERHEAD_BYTES + 1),
      },
    });

    expect(() => validateRequestContentLength(request, MAX_DOCUMENT_BYTES)).toThrow(
      "REQUEST_BODY_TOO_LARGE",
    );
  });

  it("não depende de Content-Length quando o transporte não o informa", () => {
    const request = new Request("https://silonr.local/upload", { method: "POST" });
    expect(() => validateRequestContentLength(request, MAX_DOCUMENT_BYTES)).not.toThrow();
  });

  it("valida assinatura real de PDF, JPEG, PNG e WebP", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

    expect(detectSupportedMimeType(pdf)).toBe("application/pdf");
    expect(detectSupportedMimeType(jpeg)).toBe("image/jpeg");
    expect(detectSupportedMimeType(png)).toBe("image/png");
    expect(detectSupportedMimeType(webp)).toBe("image/webp");

    expect(() => validateFileContent(pdf, "application/pdf")).not.toThrow();
    expect(() => validateFileContent(jpeg, "image/jpeg")).not.toThrow();
    expect(() => validateFileContent(png, "image/png")).not.toThrow();
    expect(() => validateFileContent(webp, "image/webp")).not.toThrow();
  });

  it("rejeita conteúdo executável mesmo quando o cliente declara PDF", () => {
    const executable = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(() => validateFileContent(executable, "application/pdf")).toThrow("FILE_CONTENT_MISMATCH");
  });

  it("rejeita MIME declarado diferente da assinatura dos bytes", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(() => validateFileContent(png, "image/jpeg")).toThrow("FILE_CONTENT_MISMATCH");
  });

  it("gera SHA-256 determinístico", () => {
    expect(sha256(new TextEncoder().encode("SiloNR"))).toBe(
      "537c4e921bb32cbb0910441de452b1131770f6302b485454a3615d1b54dbb854",
    );
  });

  it("normaliza nome para chave segura", () => {
    expect(safeStorageFilename("Laúdo do Silo 03 (final).pdf")).toBe("Laudo-do-Silo-03-final-.pdf");
  });
});
