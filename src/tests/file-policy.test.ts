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
      "537c4e921bb32cbb0910441de452b1131770f6302b485454a3615d1b54dbb854",
    );
  });

  it("normaliza nome para chave segura", () => {
    expect(safeStorageFilename("Laúdo do Silo 03 (final).pdf")).toBe("Laudo-do-Silo-03-final-.pdf");
  });
});
