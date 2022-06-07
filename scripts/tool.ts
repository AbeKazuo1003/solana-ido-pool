import {clusterApiUrl, Connection, Keypair, PublicKey, Signer} from "@solana/web3.js";
import {ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID, u64} from "@solana/spl-token";
import {program} from 'commander';
import fs from "fs";
import {AnchorProvider, Program} from '@project-serum/anchor';
import {getAssocTokenAddress, loadWalletKey, toPublicKey} from "./solana";
import {IDL, SstarsIdoContract} from '../target/types/sstars_ido_contract';
import * as anchor from "@project-serum/anchor";

program.version('0.0.1');

const IDO_PROGRAM_ID_DEV = '7jcTKW1gzgwywcBsMp9TSZn5XDfKrWquEMJNnwSu2YUY';
const IDO_PROGRAM_ID = '7jcTKW1gzgwywcBsMp9TSZn5XDfKrWquEMJNnwSu2YUY'; // TODO UPDATE!!

const USDC_TOKEN_ADDRESS_DEV = '92gc5sL8rFairDTcb9EdmQ22ip3abNgC5Wt3umsqNJJZ'; // Test USDC
const USDT_TOKEN_ADDRESS_DEV = 'FHQg3Vx7chj1PoANhDmLdZBPD6J684BvUdppzBwCxR7h'; // Test USDT

const USDC_TOKEN_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_TOKEN_ADDRESS = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const NATIVE_TOKEN_ADDRESS = new PublicKey('So11111111111111111111111111111111111111112');

async function createPool(
  provider: AnchorProvider,
  program: Program<SstarsIdoContract>,
  name,
  type,
  token_address: PublicKey,
  vaultOwner: PublicKey,
  vaultAccount: PublicKey
) {
  console.log(`Create pool ${name} ${type}: start`);
  console.log(`Token address: ${token_address.toString()}`)
  const [idoPubKey, idoBump] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from(name), Buffer.from([type])],
    program.programId
  );

  const ixs = [];
  if (!token_address.equals(NATIVE_TOKEN_ADDRESS)) {
    const tokenAccount = await provider.connection.getAccountInfo(vaultAccount);
    if (!tokenAccount) {
      const ix = await Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        token_address,
        vaultAccount,
        toPublicKey(vaultOwner),
        provider.wallet.publicKey,
      );
      ixs.push(ix);
    }
  }

  await program.methods
    .initialize(name, type, idoBump, true)
    .accounts({
      idoAuthority: provider.wallet.publicKey,
      idoAccount: idoPubKey,
      tokenMint: token_address,
      serviceVault: vaultAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .preInstructions(ixs)
    .rpc();
  console.log(`Create pool ${name} ${type}: success`);
}

program
  .command('create-ido')
  .requiredOption('-k, --keypair <path>', `Solana wallet location`)
  .option(
    '-e, --env <string>',
    'Solana cluster env name. One of: mainnet-beta, testnet, devnet',
    'mainnet-beta',
  )
  .requiredOption('-n --name <string>', 'IDO name')
  .requiredOption('--vault <string>', 'Service wallet for vault')
  .action(async (_directory: any, cmd: any) => {
    const {
      keypair,
      env,
      name,
      vault,
    } = cmd.opts();

    const serviceKeypair = loadWalletKey(keypair);
    const provideOptions = AnchorProvider.defaultOptions();
    const connection = new Connection(
      clusterApiUrl(env),
      provideOptions.commitment,
    );

    const walletWrapper = new anchor.Wallet(serviceKeypair);
    const provider = new AnchorProvider(connection, walletWrapper, {
      preflightCommitment: 'recent',
    });
    const isDev = env != 'mainnet-beta';
    const programId = new PublicKey(isDev? IDO_PROGRAM_ID_DEV:IDO_PROGRAM_ID);
    const program = new Program<SstarsIdoContract>(
      IDL,
      programId,
      provider,
    );

    const usdcTokenAddress = new PublicKey(isDev? USDC_TOKEN_ADDRESS_DEV:USDC_TOKEN_ADDRESS);
    const usdtTokenAddress = new PublicKey(isDev? USDT_TOKEN_ADDRESS_DEV:USDT_TOKEN_ADDRESS);
    const nativeTokenAddress = NATIVE_TOKEN_ADDRESS;

    const vaultKey = new PublicKey(vault.trim());
    const idoName = name.trim();
    const vaultAddressUSDC = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      usdcTokenAddress,
      vaultKey
    );
    const vaultAddressUSDT = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      usdtTokenAddress,
      vaultKey
    );
    await createPool(provider, program, idoName, 1, nativeTokenAddress, vaultKey, vaultKey);
    await createPool(provider, program, idoName, 2, usdcTokenAddress, vaultKey, vaultAddressUSDC);
    await createPool(provider, program, idoName, 3, usdtTokenAddress, vaultKey, vaultAddressUSDT);
  });

program.parse(process.argv);