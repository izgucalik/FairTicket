import nacl from "tweetnacl";
import bs58 from "bs58";
const kp = nacl.sign.keyPair();
console.log("ADRES:", bs58.encode(kp.publicKey));
console.log("GIZLI:", bs58.encode(kp.secretKey));
