import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_BYTES,
  safeStorageFilename,
  sha256,
  validateDocumentUpload,
  validateEvidenceImage,
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

  it("gera SHA-256 determinístico", () => {
    expect(sha256(new TextEncoder().encode("SiloNR"))).toBe(
      "3698b15f2e27b47e8381fb9cb63b90ed94d3f67825d1db8d487889d47e7148d9",
    );
  });

  it("normaliza nome para chave segura", () => {
    expect(safeStorageFilename("Laúdo do Silo 03 (final).pdf")).toBe("Laudo-do-Silo-03-final-.pdf");
  });
});
