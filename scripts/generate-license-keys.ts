import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

function argument(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function licenseKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(25);
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `SLNR-${body.match(/.{1,5}/g)!.join("-")}`;
}

const count = Number(argument("count", "50"));
const output = argument("output", `license-keys-${new Date().toISOString().slice(0, 10)}.csv`);
const supabaseOutput = output.toLowerCase().endsWith(".csv")
  ? `${output.slice(0, -4)}-supabase.csv`
  : `${output}-supabase.csv`;
if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("--count deve ficar entre 1 e 1000.");

const keys = new Set<string>();
while (keys.size < count) keys.add(licenseKey());
const records = Array.from(keys, (key) => ({
  key,
  keyHash: createHash("sha256").update(key.replaceAll("-", ""), "utf8").digest("hex"),
}));
const privateRows = [
  "license_key,key_hash",
  ...records.map(({ key, keyHash }) => `${key},${keyHash}`),
];
const supabaseRows = [
  "key_hash,plan,status,valid_until,offline_grace_days,max_facilities,max_users,max_installations,provider",
  ...records.map(({ keyHash }) => [
    keyHash,
    "professional",
    "available",
    "",
    "7",
    "1",
    "5",
    "3",
    "asaas",
  ].join(",")),
];
await writeFile(output, `${privateRows.join("\n")}\n`, { mode: 0o600, flag: "wx" });
await writeFile(supabaseOutput, `${supabaseRows.join("\n")}\n`, { mode: 0o600, flag: "wx" });
console.log(`Arquivo privado com as chaves: ${output}`);
console.log(`Arquivo sem as chaves, pronto para importar no Supabase: ${supabaseOutput}`);
