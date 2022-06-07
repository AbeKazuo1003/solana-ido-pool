import * as anchor from "@project-serum/anchor";
import {Program} from "@project-serum/anchor";
import {SstarsIdoContract} from "../target/types/sstars_ido_contract";
import {Token, TOKEN_PROGRAM_ID} from "@solana/spl-token";

const utils = require("./utils");
import * as fs from "fs";
import * as assert from "assert";
import * as bs58 from 'bs58';
import {toPublicKey} from "../scripts/solana";
import {PublicKey} from "@solana/web3.js";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace
  .SstarsIdoContract as Program<SstarsIdoContract>;

describe("sstars_ido_contract", () => {
  let stableCoinMintKeyPair: anchor.web3.Keypair;
  let stableCoinMintObject: Token;
  let stableCoinMintPubKey: anchor.web3.PublicKey;

  let client: anchor.web3.Keypair;
  let clientStableCoinWallet: anchor.web3.PublicKey;

  let service: anchor.web3.Keypair;
  let serviceStableCoinWallet: anchor.web3.PublicKey;

  // the program's ido_account account
  let idoPubKey: anchor.web3.PublicKey;
  let idoBump: number;

  let idoName = "sstar";
  let tokenType = 1;
  const WHITELIST_PDA_SEED = "whitelist";
  const USER_DEPOSIT_PDA_SEED = "user_deposit";
  const root = "Q4MtH9omsnj4QVdrPfLuk8p8qe7tZd15GnMkghqTSx6";
  const merkle_proof = "DAzUSmg1g9ADomc7oJp5TJutw54uZN8CqyuoKxZruSWD,VcNa8Sgbx7tyo8yVUXMrbaT5BAs7JB6D5sTUzj1wykM";
  const merkle_wallet = '7Qiag7acsNA4zc9KS9V8ejofCZd4kD7iSV8iMGqYpxy8';
  const merkle_value = 100_000_000;
  const merkle_index = 0;
  const proof = merkle_proof.split(',').map((b) => {
    const ret = Buffer.from(bs58.decode(b));
    if (ret.length !== 32)
      throw new Error(
        `Invalid URL (error)`,
      );
    return ret;
  });

  it("Prepare", async () => {
    //Create StableCoin
    let keyPairFile = fs.readFileSync(
      "tests/keys/stablecoin.json",
      "utf-8"
    );
    let keyPairData = JSON.parse(keyPairFile);
    stableCoinMintKeyPair = anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(keyPairData)
    );
    stableCoinMintObject = await utils.createMint(
      stableCoinMintKeyPair,
      provider,
      provider.wallet.publicKey,
      null,
      9,
      TOKEN_PROGRAM_ID
    );
    stableCoinMintPubKey = stableCoinMintObject.publicKey;
    console.log(stableCoinMintPubKey.toString());

    // Load Client
    let clientPairFile = fs.readFileSync(
      "tests/keys/client.json",
      "utf-8"
    );
    let clientPairData = JSON.parse(clientPairFile);
    client = anchor.web3.Keypair.fromSecretKey(new Uint8Array(clientPairData));
    console.log(`client: ${client.publicKey.toString()}`);
    // Airdrop 10 SOL to client
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        client.publicKey,
        10_000_000_000
      ),
      "confirmed"
    );

    // Load service
    let servicePairFile = fs.readFileSync(
      "tests/keys/service.json",
      "utf-8"
    );
    let servicePairData = JSON.parse(servicePairFile);
    service = anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(servicePairData)
    );

    // create stable token wallet for client and service
    clientStableCoinWallet =
      await stableCoinMintObject.createAssociatedTokenAccount(client.publicKey);
    serviceStableCoinWallet =
      await stableCoinMintObject.createAssociatedTokenAccount(
        service.publicKey
      );

    // Airdrop stableCoin to client for test
    await utils.mintToAccount(
      provider,
      stableCoinMintPubKey,
      clientStableCoinWallet,
      1000_000_000_000
    );

    assert.strictEqual(
      await utils.getTokenBalance(provider, clientStableCoinWallet),
      1000_000_000_000
    );
    assert.strictEqual(
      await utils.getTokenBalance(provider, serviceStableCoinWallet),
      0
    );
  });

  const initialize = async(name: string, type: number) => {
    const [idoPubKey, idoBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(name), Buffer.from([type])],
      program.programId
    );

    await program.methods
      .initialize(name, tokenType, idoBump, true)
      .accounts({
        idoAuthority: provider.wallet.publicKey,
        idoAccount: idoPubKey,
        tokenMint: stableCoinMintPubKey,
        serviceVault: serviceStableCoinWallet,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      // @ts-ignore
      .signers([provider.wallet.payer])
      .rpc();
    const fetch = await program.account.idoAccount.fetch(idoPubKey);
    assert.strictEqual(
      fetch.tokenMint.toString(),
      stableCoinMintPubKey.toString()
    );
    assert.strictEqual(fetch.totalAmount.toNumber(), 0);
  }
  const setWhiteList = async (name, type) => {
    const [idoPubKey, idoBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(name), Buffer.from([type])],
      program.programId
    );

    const [whitelistPubKey] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(name), Buffer.from(WHITELIST_PDA_SEED)],
      program.programId
    );

    await program.methods
      .setWhitelist(bs58.decode(root))
      .accounts({
        idoAuthority: provider.wallet.publicKey,
        idoAccount: idoPubKey,
        whitelistAccount: whitelistPubKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  }
  const verify_merkle = async (name, type) => {
    [idoPubKey, idoBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(name), Buffer.from([type])],
      program.programId
    );

    const [whitelistPubKey] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(name), Buffer.from(WHITELIST_PDA_SEED)],
      program.programId
    );

    await program.methods
      .verify(
        new anchor.BN(merkle_index),
        new anchor.BN(merkle_value),
        new PublicKey(merkle_wallet),
        proof
      )
      .accounts({
        idoAuthority: provider.wallet.publicKey,
        idoAccount: idoPubKey,
        whitelistAccount: whitelistPubKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  }

  const deposit = async (name, type, index, max, allocationAmount, amount) => {
    const bnAmount = new anchor.BN(amount);
    const bnAllocationAmount = new anchor.BN(allocationAmount);
    const [user_deposit] =
      await anchor.web3.PublicKey.findProgramAddress(
        [
          client.publicKey.toBuffer(),
          Buffer.from(name), Buffer.from([type]),
          Buffer.from(USER_DEPOSIT_PDA_SEED),
        ],
        program.programId
      );
    const [user_allocation] =
      await anchor.web3.PublicKey.findProgramAddress(
        [
          client.publicKey.toBuffer(),
          Buffer.from(name),
          Buffer.from(USER_DEPOSIT_PDA_SEED),
        ],
        program.programId
      );
    const [whitelistPubKey] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(idoName), Buffer.from(WHITELIST_PDA_SEED)],
      program.programId
    );

    const userDeposit = await program.provider.connection.getAccountInfo(user_deposit);
    const ixs = [];
    if (!userDeposit) {
      const instruction = await program.methods
        .initUserDeposit()
        .accounts({
          userAuthority: client.publicKey,
          userDeposit: user_deposit,
          idoAccount: idoPubKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([client])
        .instruction();
      ixs.push(instruction);
    }
    const userAllocation = await program.provider.connection.getAccountInfo(user_allocation);
    if (!userAllocation) {
      const instruction = await program.methods
        .initUserAllocation()
        .accounts({
          userAuthority: client.publicKey,
          userAllocation: user_allocation,
          idoAccount: idoPubKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([client])
        .instruction();
      ixs.push(instruction);
    }
    await program.methods
      .deposit(
        new anchor.BN(index),
        new anchor.BN(max),
        bnAllocationAmount,
        bnAmount,
        proof,
      )
      .accounts({
        userAuthority: client.publicKey,
        idoAccount: idoPubKey,
        tokenMint: stableCoinMintPubKey,
        serviceVault: serviceStableCoinWallet,
        userDeposit: user_deposit,
        userAllocation: user_allocation,
        userTokenWallet: clientStableCoinWallet,
        whitelistAccount: whitelistPubKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([client])
      .preInstructions(ixs)
      .rpc();

    console.log(`checking service vault`);
    assert.strictEqual(
      await utils.getTokenBalance(provider, serviceStableCoinWallet),
      amount
    );
    console.log(`checking ido amount`);
    const idoFetch = await program.account.idoAccount.fetch(idoPubKey);
    assert.strictEqual(idoFetch.totalAmount.toNumber(), amount);

    console.log(`checking user amount`);
    const userDepositAccount = await program.account.userDeposit.fetch(user_deposit);
    assert.strictEqual(userDepositAccount.amount.toNumber(), amount);

    const userAllocationAccount = await program.account.userAllocation.fetch(user_allocation);
    assert.strictEqual(userAllocationAccount.allocationAmount.toNumber(), allocationAmount);
  }

  it("Initialize", async () => {
    await initialize(idoName, tokenType);
  });

  it("Set whitelist", async() => {
    await setWhiteList(idoName, tokenType);
    await setWhiteList(idoName, tokenType);
  });

  it ("verify merkle", async () => {
    await verify_merkle(idoName, tokenType);
  });

  // it("Deposit Not started Error", async () => {
  //   const [user_deposit, user_deposit_bump] =
  //     await anchor.web3.PublicKey.findProgramAddress(
  //       [
  //         client.publicKey.toBuffer(),
  //         Buffer.from(idoName),
  //         Buffer.from(USER_DEPOSIT_PDA_SEED),
  //       ],
  //       program.programId
  //     );
  //   await assert.rejects(async () => {
  //     await program.methods
  //       .initUserDeposit()
  //       .accounts({
  //         userAuthority: client.publicKey,
  //         userDeposit: user_deposit,
  //         idoAccount: idoPubKey,
  //         systemProgram: anchor.web3.SystemProgram.programId,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //         rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  //       })
  //       .signers([client])
  //       .rpc();
  //   });
  // });
  // it("Open Deposit", async () => {
  //   await program.methods
  //     .toggleFreezeProgram(idoName)
  //     .accounts({
  //       initializer: provider.wallet.publicKey,
  //       idoAccount: idoPubKey,
  //     })
  //     // @ts-ignore
  //     .signers([provider.wallet.payer])
  //     .rpc();
  //   const fetch = await program.account.idoAccount.fetch(idoPubKey);
  //   assert.strictEqual(fetch.freezeProgram, false);
  // });
  // it("Deposit Low Token Error", async () => {
  //   const error_deposit = new anchor.BN(2000_000_000_000);
  //   const [user_deposit, user_deposit_bump] =
  //     await anchor.web3.PublicKey.findProgramAddress(
  //       [
  //         client.publicKey.toBuffer(),
  //         Buffer.from(idoName),
  //         Buffer.from(USER_DEPOSIT_PDA_SEED),
  //       ],
  //       program.programId
  //     );
  //   try {
  //     const instruction = await program.methods
  //       .initUserDeposit()
  //       .accounts({
  //         userAuthority: client.publicKey,
  //         userDeposit: user_deposit,
  //         idoAccount: idoPubKey,
  //         systemProgram: anchor.web3.SystemProgram.programId,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //         rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  //       })
  //       .signers([client])
  //       .rpc();
  //     await assert.rejects(async () => {
  //       await program.methods
  //         .depositToken(error_deposit)
  //         .accounts({
  //           userAuthority: client.publicKey,
  //           idoAccount: idoPubKey,
  //           tokenMint: stableCoinMintPubKey,
  //           serviceVault: serviceStableCoinWallet,
  //           userDeposit: user_deposit,
  //           userTokenWallet: clientStableCoinWallet,
  //           tokenProgram: TOKEN_PROGRAM_ID,
  //         })
  //         .signers([client])
  //         .rpc();
  //     });
  //   } catch (err) {
  //     console.log("This is the error message", err.toString());
  //   }
  // });
  it("Deposit Test", async () => {
    await deposit(idoName, tokenType, merkle_index, merkle_value, 12_000_000, 10_000_000);
  });
});
