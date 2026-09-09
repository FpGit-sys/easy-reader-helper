import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

function requiredArgument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Argumento --${name} ausente.`);
  return value;
}

const privateKeyEncoded = process.env.SILONR_UPDATE_SIGNING_PRIVATE_KEY?.trim();
if (!privateKeyEncoded) throw new Error("Secret SILONR_UPDATE_SIGNING_PRIVATE_KEY ausente.");
const version = requiredArgument("version");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("A versão deve usar o formato 0.0.0.");
const installer = requiredArgument("installer");
const url = requiredArgument("url");
if (!url.startsWith("https://github.com/")) throw new Error("A URL do instalador deve ser HTTPS no GitHub Releases.");
const output = requiredArgument("output");
const notes = requiredArgument("notes");
const bytes = await readFile(installer);
const payload = Buffer.from(JSON.stringify({
  version,
  url,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  notes,
  publishedAt: new Date().toISOString(),
  mandatory: process.argv.includes("--mandatory"),
}), "utf8");
const privateKey = createPrivateKey({
  key: Buffer.from(privateKeyEncoded, "base64"),
  format: "der",
  type: "pkcs8",
});
const signature = sign(null, payload, privateKey);
await writeFile(output, `${JSON.stringify({
  payload: payload.toString("base64url"),
  signature: signature.toString("base64url"),
}, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(`Manifesto assinado criado em ${output}.`);
