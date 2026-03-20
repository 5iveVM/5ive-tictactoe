#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import web3 from '../../five-cli/node_modules/@solana/web3.js/lib/index.cjs.js';
import {
  FiveProgram,
  FiveSDK,
  SessionClient,
  loadDefaultPayerKeypair,
  resolveFiveArtifactPath,
} from '../../five-sdk/dist/index.js';
import { loadDeploymentConfig } from './lib/runtime-config.mjs';

const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } = web3;

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const network = 'localnet';
function toIx(encoded) {
  const initSignerSet = new Set();
  for (const key of encoded.keys) {
    if (key.isWritable && !key.isSigner && key.pubkey !== '11111111111111111111111111111111') {
      initSignerSet.add(key.pubkey);
      break;
    }
  }
  return new TransactionInstruction({
    programId: new PublicKey(encoded.programId),
    keys: encoded.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: !!k.isSigner || initSignerSet.has(k.pubkey),
      isWritable: !!k.isWritable || initSignerSet.has(k.pubkey),
    })),
    data: Buffer.from(encoded.data, 'base64'),
  });
}

async function main() {
  const cfg = await loadDeploymentConfig(projectRoot, network);
  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  await connection.getVersion();

  const payer = await loadDefaultPayerKeypair();
  const vmProgram = new PublicKey(cfg.fiveProgramId);
  const vmInfo = await connection.getAccountInfo(vmProgram, 'confirmed');
  if (!vmInfo) throw new Error(`VM program ${cfg.fiveProgramId} not found on ${cfg.rpcUrl}`);

  const scriptInfo = await connection.getAccountInfo(new PublicKey(cfg.tictactoeScriptAccount), 'confirmed');
  if (!scriptInfo) throw new Error(`script account ${cfg.tictactoeScriptAccount} not found on ${cfg.rpcUrl}`);

  // Ensure canonical session manager service is deployed for delegated session auth flows.
  const sessionManagerScriptAccount = SessionClient.canonicalManagerScriptAccount(cfg.fiveProgramId);
  const sessionManagerInfo = await connection.getAccountInfo(new PublicKey(sessionManagerScriptAccount), 'confirmed');
  let sessionManagerDeploySignature = null;
  if (!sessionManagerInfo) {
    const sessionTemplatePath = resolve(projectRoot, '..', 'five-templates', 'session-manager', 'build', 'five-session-manager-template.five');
    const sessionTemplateText = await readFile(sessionTemplatePath, 'utf8');
    const loadedSession = await FiveSDK.loadFiveFile(sessionTemplateText);
    const deployed = await FiveSDK.deployToSolana(loadedSession.bytecode, connection, payer, {
      fiveVMProgramId: cfg.fiveProgramId,
      service: 'session_v1',
    });
    if (!deployed.success) {
      throw new Error(`session manager deploy failed: ${deployed.error || 'unknown error'}`);
    }
    sessionManagerDeploySignature = deployed.transactionId || null;
  }

  const artifactPath = await resolveFiveArtifactPath(projectRoot);
  const artifactText = await readFile(artifactPath, 'utf8');
  const loaded = await FiveSDK.loadFiveFile(artifactText);
  const program = FiveProgram.fromABI(cfg.tictactoeScriptAccount, loaded.abi, {
    fiveVMProgramId: cfg.fiveProgramId,
  });

  const config = Keypair.generate();
  const owner = payer.publicKey.toBase58();
  const initConfigIx = await program
    .function('init_config')
    .payer(owner)
    .accounts({ config: config.publicKey.toBase58(), authority: owner })
    .args({ turn_timeout_secs: 120, allow_open_matches: 1, allow_invites: 1 })
    .instruction();

  const tx = new Transaction().add(toIx(initConfigIx));
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  const sig = await connection.sendTransaction(tx, [payer, config], {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  const latest = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
  const meta = await connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  const err = meta?.meta?.err ?? null;
  if (err) {
    throw new Error(`init_config failed: ${JSON.stringify(err)}`);
  }

  const configPath = resolve(projectRoot, 'deployment-config.localnet.json');
  const current = JSON.parse(await readFile(configPath, 'utf8'));
  const next = {
    ...current,
    network,
    rpcUrl: cfg.rpcUrl,
    fiveProgramId: cfg.fiveProgramId,
    tictactoeScriptAccount: cfg.tictactoeScriptAccount,
    tictactoeConfigAccount: config.publicKey.toBase58(),
    sessionManagerScriptAccount,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    network,
    configAccount: config.publicKey.toBase58(),
    sessionManagerScriptAccount,
    sessionManagerDeploySignature,
    initConfigSignature: sig,
    deploymentConfigPath: configPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
