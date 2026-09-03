import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerEnv } from "@/server/env";
import { FilesystemStorage } from "./filesystem-storage";

function localStorage() {
  const env = getServerEnv();
  return env.STORAGE_DRIVER === "filesystem"
    ? new FilesystemStorage(env.FILE_STORAGE_PATH, env.FILE_DOWNLOAD_SIGNING_SECRET)
    : null;
}

export async function checkPrivateStorage() {
  const local = localStorage();
  if (local) return local.ready();
  const env = getServerEnv();
  return Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

export async function servePrivateFile(request: Request): Promise<Response> {
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
  try {
    const local = localStorage();
    if (!local) return new Response("Not found", { status: 404, headers });
    const url = new URL(request.url);
    const key = url.searchParams.get("key") ?? "";
    if (
      !local.verify(
        key,
        Number(url.searchParams.get("expires")),
        url.searchParams.get("signature") ?? "",
      )
    ) {
      return new Response("Invalid or expired download", { status: 403, headers });
    }
    const file = await local.read(key);
    return new Response(new Uint8Array(file.body), {
      headers: {
        ...headers,
        "content-type": file.contentType,
        "content-length": String(file.body.length),
        "x-content-type-options": "nosniff",
        "content-disposition": `inline; filename="${key.split("/").at(-1)}"`,
        "x-silonr-sha256": file.sha256,
      },
    });
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return new Response(missing ? "Not found" : "File unavailable", {
      status: missing ? 404 : 503,
      headers,
    });
  }
}

let client: S3Client | null = null;
let downloadClient: S3Client | null = null;

function createStorageClient(endpoint?: string) {
  const env = getServerEnv();

  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error("OBJECT_STORAGE_NOT_CONFIGURED");
  }

  return new S3Client({
    region: env.S3_REGION,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}

function getStorageClient() {
  if (client) return client;
  const env = getServerEnv();
  client = createStorageClient(env.S3_ENDPOINT || undefined);
  return client;
}

function getDownloadStorageClient() {
  if (downloadClient) return downloadClient;
  const env = getServerEnv();
  const endpoint = env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT || undefined;
  downloadClient = createStorageClient(endpoint);
  return downloadClient;
}

function bucket() {
  return getServerEnv().S3_BUCKET;
}

export function makePrivateObjectKey(input: {
  organizationId: string;
  facilityId: string;
  category: "documents" | "evidence";
  entityId: string;
  filename: string;
}) {
  const safe = input.filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 140) || "arquivo";
  return `${input.organizationId}/${input.facilityId}/${input.category}/${input.entityId}/${crypto.randomUUID()}-${safe}`;
}

export async function putPrivateObject(input: {
  key: string;
  body: Uint8Array;
  contentType: string;
  sha256: string;
}) {
  const local = localStorage();
  if (local) return local.put(input);
  await getStorageClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      Metadata: {
        sha256: input.sha256,
      },
      CacheControl: "private, no-store",
    }),
  );
}

export async function createPrivateDownloadUrl(key: string, expiresInSeconds = 300) {
  const expiresIn = Math.max(30, Math.min(Math.floor(expiresInSeconds), 900));
  const local = localStorage();
  if (local) {
    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const url = new URL("/api/files/private", getServerEnv().APP_URL);
    url.searchParams.set("key", key);
    url.searchParams.set("expires", String(expires));
    url.searchParams.set("signature", local.sign(key, expires));
    return url.toString();
  }
  return getSignedUrl(
    getDownloadStorageClient(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn },
  );
}

export async function deletePrivateObject(key: string) {
  const local = localStorage();
  if (local) return local.delete(key);
  await getStorageClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
