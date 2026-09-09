import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateDer = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const publicDer = publicKey.export({ format: "der", type: "spki" });
const publicRaw = publicDer.subarray(publicDer.length - 32).toString("base64url");

console.log(`SILONR_UPDATE_SIGNING_PRIVATE_KEY=${privateDer}`);
console.log(`SILONR_UPDATE_PUBLIC_KEY=${publicRaw}`);
console.log("\nGuarde a chave PRIVADA somente no secret do GitHub; a chave pública pode entrar na compilação.");
