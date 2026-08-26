import { generateKeyPairSync, randomBytes } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateDer = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const publicDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");

console.log("LICENSE_SIGNING_PRIVATE_KEY=" + privateDer);
console.log("LICENSE_SIGNING_PUBLIC_KEY=" + publicDer);
console.log("LICENSE_CLIENT_API_KEY=" + randomBytes(32).toString("base64url"));
console.log("LICENSE_INSTALLATION_ENCRYPTION_KEY=" + randomBytes(32).toString("base64"));
console.log("\nA chave PRIVADA vai somente nos secrets das Edge Functions; nunca no app local ou no Git.");
