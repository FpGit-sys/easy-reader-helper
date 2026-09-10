import { appendFile } from "node:fs/promises";
import { createPrivateKey, createPublicKey } from "node:crypto";

const encoded = process.env.SILONR_UPDATE_SIGNING_PRIVATE_KEY?.trim();
if (!encoded) throw new Error("Secret SILONR_UPDATE_SIGNING_PRIVATE_KEY ausente.");
const privateKey = createPrivateKey({ key: Buffer.from(encoded, "base64"), format: "der", type: "pkcs8" });
const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
const publicRaw = publicDer.subarray(publicDer.length - 32).toString("base64url");

if (process.argv.includes("--github-env")) {
  const githubEnv = process.env.GITHUB_ENV;
  if (!githubEnv) throw new Error("GITHUB_ENV ausente.");
  await appendFile(githubEnv, `SILONR_UPDATE_PUBLIC_KEY=${publicRaw}\n`, { encoding: "utf8" });
  console.log("Chave pública de atualizações derivada para esta compilação.");
} else {
  console.log(`SILONR_UPDATE_PUBLIC_KEY=${publicRaw}`);
}
