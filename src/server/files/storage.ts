import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerEnv } from "@/server/env";

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
  const expiresIn = Math.max(30, Math.min(expiresInSeconds, 900));
  return getSignedUrl(
    getDownloadStorageClient(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn },
  );
}

export async function deletePrivateObject(key: string) {
  await getStorageClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
