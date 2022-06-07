import * as anchor from "@project-serum/anchor";
import { Provider } from "@project-serum/anchor";

const { TOKEN_PROGRAM_ID, Token, MintLayout } = require("@solana/spl-token");

async function mintToAccount(provider, mint, destination, amount) {
  const tx = new anchor.web3.Transaction();
  tx.add(
    Token.createMintToInstruction(
      TOKEN_PROGRAM_ID,
      mint,
      destination,
      provider.wallet.publicKey,
      [],
      amount
    )
  );
  await provider.sendAndConfirm(tx);
}

async function sendLamports(provider, destination, amount) {
  const tx = new anchor.web3.Transaction();
  tx.add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      lamports: amount,
      toPubkey: destination,
    })
  );
  await provider.send(tx);
}

async function createMint(
  mintAccount,
  provider,
  mintAuthority,
  freezeAuthority,
  decimals,
  programId
) {
  const token = new Token(
    provider.connection,
    mintAccount.publicKey,
    programId,
    provider.wallet.payer
  );

  // Allocate memory for the account
  const balanceNeeded = await Token.getMinBalanceRentForExemptMint(
    provider.connection
  );

  const transaction = new anchor.web3.Transaction();
  transaction.add(
    anchor.web3.SystemProgram.createAccount({
      fromPubkey: provider.wallet.payer.publicKey,
      newAccountPubkey: mintAccount.publicKey,
      lamports: balanceNeeded,
      space: MintLayout.span,
      programId,
    })
  );

  transaction.add(
    Token.createInitMintInstruction(
      programId,
      mintAccount.publicKey,
      decimals,
      mintAuthority,
      freezeAuthority
    )
  );

  await provider.sendAndConfirm(transaction, [mintAccount]);
  return token;
}

async function getTokenBalance(
  provider: Provider,
  pubKey: anchor.web3.PublicKey
) {
  return parseInt(
    (await provider.connection.getTokenAccountBalance(pubKey)).value.amount
  );
}

module.exports = {
  createMint,
  mintToAccount,
  sendLamports,
  getTokenBalance,
};
