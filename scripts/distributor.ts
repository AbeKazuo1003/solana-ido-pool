import {clusterApiUrl, Connection, Keypair, PublicKey, Signer} from "@solana/web3.js";
import {ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID, u64} from "@solana/spl-token";
import {program} from 'commander';
import fs from "fs";
import {AnchorProvider, Program} from '@project-serum/anchor';
import {getAssocTokenAddress, loadWalletKey, toPublicKey} from "./solana";
import {IDL, SstarsIdoContract} from '../target/types/sstars_ido_contract';
import * as anchor from "@project-serum/anchor";
import BN from "bn.js";
import {MerkleTree} from "./utils/merkleTree";
import * as bs58 from 'bs58';
import {DbService} from "./db";
import {createClient, SupabaseClient} from '@supabase/supabase-js';

program.version('0.0.1');

const IDO_PROGRAM_ID = '7jcTKW1gzgwywcBsMp9TSZn5XDfKrWquEMJNnwSu2YUY';
const SUPABASE_URL_DEV = 'https://nkttaoiiinjhysdwvxes.supabase.co';
const SUPABASE_ANON_KEY_DEV = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTYzOTA3NTU5MSwiZXhwIjoxOTU0NjUxNTkxfQ.QDwEZW76OQ8xIDE1Mb-IwMgiMu-jPS1dycZB11swxms';

const SUPABASE_URL = 'https://peltpvlsvukbcsopbxhy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTY0MDg4Mzg4OSwiZXhwIjoxOTU2NDU5ODg5fQ.O-wCJDZc6rp7RQ1G9aYq83cqPB-raJNFdE1CsXdtTnc';

let db = null;

function getDb(isDev = true) {
  if (db) {
    return db;
  }
  if (isDev) {
    db = createClient(SUPABASE_URL_DEV, SUPABASE_ANON_KEY_DEV);
  } else {
    db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return db;
}

async function getWhiteList(isDev = true) {
  const dbService = getDb(isDev);

  const allRecords: any[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const result = await dbService
      .from('sstars_ido_whitelist')
      .select(`wallet_address, sstars_ido_allocation(usd_allocation)`)
      .order(`id`)
      .range(offset, offset + limit);
    if (result.error) {
      return {success: false, error: result.error};
    }
    if (result.data.length === 0) {
      break;
    }
    result.data.forEach((item) => {
      allRecords.push(item);
    });
    offset += limit;
  }
  return {success: true, data: allRecords};
}

async function upsertMerkleInfos(isDev = true, data) {
  const dbService = getDb(isDev);
  await dbService.from('sstars_ido_merkle_infos')
    .upsert(data, {onConflict: 'wallet_address', ignoreDuplicates: false})
}

program
  .command('create')
  .requiredOption('-k, --keypair <path>', `Solana wallet location`)
  .requiredOption('-n, --name <string>', `IDO name`)
  .option(
    '-e, --env <string>',
    'Solana cluster env name. One of: mainnet-beta, testnet, devnet',
    'mainnet-beta',
  )
  .action(async (_directory: any, cmd: any) => {
    const {
      keypair,
      env,
      name: idoName,
    } = cmd.opts();

    const UNIT_ALLOCATION = 1_000_000_000;
    const WHITELIST_PDA_SEED = "whitelist";
    const serviceKeypair = loadWalletKey(keypair);
    const provideOptions = AnchorProvider.defaultOptions();
    const connection = new Connection(
      clusterApiUrl(env),
      provideOptions.commitment,
    );

    const walletWrapper = new anchor.Wallet(serviceKeypair);
    const provider = new AnchorProvider(connection, walletWrapper, {
      preflightCommitment: 'confirmed',
    });
    const programId = new PublicKey(IDO_PROGRAM_ID);
    const program = new Program<SstarsIdoContract>(
      IDL,
      programId,
      provider,
    );

    const isDev = env !== 'mainnet-beta';

    const ret = await getWhiteList(isDev);
    if (!ret.success) {
      console.log(`Error: Can't fetch whitelist`);
      return;
    }
    const whitelist = [];
    for(let item of ret.data) {
      const walletAddress = item.wallet_address;
      const amount = item.sstars_ido_allocation.usd_allocation;
      try {
        const pubkeyItem = new PublicKey(walletAddress);
      } catch (err) {
        console.log(`address: ${walletAddress} is wrong address!!`);
        continue;
      }
      whitelist.push({
        wallet_address: walletAddress,
        amount: amount * UNIT_ALLOCATION
      })
    }

    const leafs: Array<Buffer> = [];
    for (let idx = 0; idx < whitelist.length; idx++) {
      const item = whitelist[idx];
      const {wallet_address, amount} = item;
      leafs.push(
        Buffer.from([
          ...new BN(idx).toArray('le', 8),
          ...toPublicKey(wallet_address).toBuffer(),
          ...new BN(amount).toArray('le', 8),
        ]),
      );
    }

    const tree = new MerkleTree(leafs);
    const root = tree.getRoot();

    const rootKey = bs58.encode(root);
    // console.log(`tree`, tree);
    console.log(`root`, root);
    console.log(`rootKey`, rootKey);

    let merkle_infos = [];
    for (let idx = 0; idx < whitelist.length; ++idx) {
      const item = whitelist[idx];
      const {wallet_address, amount} = item;

      const proof = tree.getProof(idx);
      const verified = tree.verifyProof(idx, proof, root);
      if (!verified) {
        throw new Error('Gumdrop merkle tree verification failed');
      } else {
        // console.log(`proof=${proof.map(b => bs58.encode(b))}`);
        // console.log(`${idx}: Ok`);
        merkle_infos.push(
          {
            wallet_address: wallet_address,
            merkle_index: idx,
            merkle_value: amount,
            merkle_proof: `${proof.map(b => bs58.encode(b))}`,
          }
        )
      }
    }

    const token_type = 1;
    const [idoPubKey, idoBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(idoName), Buffer.from([token_type])],
      program.programId
    );

    const [whitelistPubKey] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(idoName), Buffer.from(WHITELIST_PDA_SEED)],
      program.programId
    );

    console.log(`Writing merkle root on the contract`);
    await program.methods
      .setWhitelist(bs58.decode(rootKey))
      .accounts({
        idoAuthority: provider.wallet.publicKey,
        idoAccount: idoPubKey,
        whitelistAccount: whitelistPubKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // save
    console.log(`Writing merkle root on the DB`);
    await upsertMerkleInfos(isDev, merkle_infos);
  });

program
  .command('verify')
  .action(async (_directory: any, _cmd: any) => {
    const root = "FwAaVWAnN49iL6qbH3nfF9C7jSeT2tSmMVfDNYS9W1ke";
    const merkle_proof = "DAzUSmg1g9ADomc7oJp5TJutw54uZN8CqyuoKxZruSWD,VcNa8Sgbx7tyo8yVUXMrbaT5BAs7JB6D5sTUzj1wykM";
    const merkle_wallet = '3kcBCxCeR5RXzEnsuXQk1nBXUM6w4RoJLrcHG8N1KePR';
    const merkle_value = 1;
    const merkle_index = 0;

    const proof = merkle_proof.split(',').map((b) => {
      const ret = Buffer.from(bs58.decode(b));
      if (ret.length !== 32)
        throw new Error(
          `Invalid URL (error)`,
        );
      return ret;
    });

    const leaf = Buffer.from([
      ...new BN(merkle_index).toArray('le', 8),
      // @ts-ignore
      ...toPublicKey(merkle_wallet).toBuffer(),
      // @ts-ignore
      ...new BN(merkle_value).toArray('le', 8),
    ]);

    const matches = MerkleTree.verifyClaim(
      leaf,
      proof,
      Buffer.from(bs58.decode(root)),
    );

    if (matches) {
      console.log('Ok');
    } else {
      console.log('No');
    }
  });
program.parse(process.argv);