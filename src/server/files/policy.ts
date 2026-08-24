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

/**
 * Validates the actual bytes against the MIME type supplied by the browser.
 * Filename and Content-Type are user-controlled and are not sufficient security checks.
 * This is a format-signature check, not an antivirus scanner.
 */
export function validateFileContent(bytes: Uint8Array, declaredMimeType: string): void {
  const mimeType = declaredMimeType.toLowerCase();
  if (!ALLOWED_DOCUMENT_MIME.has(mimeType)) throw new Error("FILE_TYPE_NOT_ALLOWED");

  const detected = detectSupportedMimeType(bytes);
  if (!detected || detected !== mimeType) {
    throw new Error("FILE_CONTENT_MISMATCH");
  }
}

export function detectSupportedMimeType(bytes: Uint8Array): string | null {
  if (isJpeg(bytes)) return "image/jpeg";
  if (isPng(bytes)) return "image/png";
  if (isWebp(bytes)) return "image/webp";
  if (isPdf(bytes)) return "application/pdf";
  return null;
}

function isJpeg(bytes: Uint8Array) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function isWebp(bytes: Uint8Array) {
  if (bytes.length < 12) return false;
  return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
}

function isPdf(bytes: Uint8Array) {
  // ISO 32000 readers commonly tolerate a short prefix before %PDF-. Limit the
  // scan so arbitrary binary data containing the token later in the file is rejected.
  const maxOffset = Math.min(Math.max(0, bytes.length - 5), 1024);
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    if (
      bytes[offset] === 0x25 &&
      bytes[offset + 1] === 0x50 &&
      bytes[offset + 2] === 0x44 &&
      bytes[offset + 3] === 0x46 &&
      bytes[offset + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
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
