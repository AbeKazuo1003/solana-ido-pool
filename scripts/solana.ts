import {Keypair, PublicKey} from "@solana/web3.js";
import fs from "fs";
import {ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID} from "@solana/spl-token";

const PubKeysInternedMap = new Map<string, PublicKey>();
export const toPublicKey = (key: string | PublicKey) => {
  if (typeof key !== 'string') {
    return key;
  }

  let result = PubKeysInternedMap.get(key);
  if (!result) {
    result = new PublicKey(key);
    PubKeysInternedMap.set(key, result);
  }

  return result;
};

export function loadWalletKey(keypair: any): Keypair {
  if (!keypair || keypair == '') {
    throw new Error('Keypair is required!');
  }
  const loaded = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(keypair).toString())),
  );

  console.log(`wallet public key: ${loaded.publicKey}`);
  return loaded;
}

export async function getAssocTokenAddress(
  tokenAddress: string | PublicKey,
  wallet: string | PublicKey,
) {
  return await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    toPublicKey(tokenAddress),
    toPublicKey(wallet),
  );
}