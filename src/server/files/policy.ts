import { createHash } from "node:crypto";

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const ALLOWED_DOCUMENT_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface FileDescriptor {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export function validateDocumentUpload(file: FileDescriptor): void {
  if (!file.filename.trim()) throw new Error("INVALID_FILE_NAME");
  if (file.sizeBytes <= 0 || file.sizeBytes > MAX_DOCUMENT_BYTES) {
    throw new Error("FILE_SIZE_NOT_ALLOWED");
  }
  if (!ALLOWED_DOCUMENT_MIME.has(file.mimeType.toLowerCase())) {
    throw new Error("FILE_TYPE_NOT_ALLOWED");
  }
}

export function validateEvidenceImage(file: FileDescriptor): void {
  if (!file.filename.trim()) throw new Error("INVALID_FILE_NAME");
  if (file.sizeBytes <= 0 || file.sizeBytes > MAX_IMAGE_BYTES) {
    throw new Error("FILE_SIZE_NOT_ALLOWED");
  }
  if (!ALLOWED_IMAGE_MIME.has(file.mimeType.toLowerCase())) {
    throw new Error("FILE_TYPE_NOT_ALLOWED");
  }
}

export function sha256(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function safeStorageFilename(filename: string): string {
  const base = filename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);

  return base || "arquivo";
}
