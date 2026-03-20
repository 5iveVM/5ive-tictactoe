#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import web3 from '../../five-cli/node_modules/@solana/web3.js/lib/index.cjs.js';
import { FiveProgram, FiveSDK, loadDefaultPayerKeypair, resolveFiveArtifactPath } from '../../five-sdk/dist/index.js';
import { loadDeploymentConfig } from './lib/runtime-config.mjs';

const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } = web3;

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const network = 'localnet';
const DEFAULT_PROFILE_SPACE = 256;
const OUT_PATH = resolve(projectRoot, '.reports', 'diagnose-init-profile.localnet.json');

function toIx(encoded) {
  return new TransactionInstruction({
    programId: new PublicKey(encoded.programId),
    keys: encoded.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: !!k.isSigner,
      isWritable: !!k.isWritable,
    })),
    data: Buffer.from(encoded.data, 'base64'),
  });
}

function markInitAccountSigner(ix, pubkey) {
  for (const key of ix.keys) {
    if (key.pubkey.toBase58() === pubkey) {
      key.isSigner = true;
      key.isWritable = true;
    }
  }
}

function keySigList(keys) {
  return keys.map((k) => `${k.pubkey.toBase58()}:${k.isSigner ? 's' : '-'}${k.isWritable ? 'w' : '-'}`);
}

function diffLists(a, b) {
  const max = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < max; i += 1) {
    if (a[i] !== b[i]) out.push({ index: i, builder: a[i] || null, generator: b[i] || null });
  }
  return out;
}

async function simulateAndSend({ connection, payer, tx, signers }) {
  const sim = await connection.simulateTransaction(tx, signers, true);
  const simErr = sim.value.err || null;
  const simLogs = sim.value.logs || [];
  let send = { ok: false, signature: null, err: null, logs: [] };
  try {
    const signature = await connection.sendTransaction(tx, signers, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    const latest = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
    const meta = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    const err = meta?.meta?.err ?? null;
    send = {
      ok: !err,
      signature,
      err: err ? JSON.stringify(err) : null,
      logs: meta?.meta?.logMessages || [],
    };
  } catch (e) {
    send = {
      ok: false,
      signature: e?.signature || null,
      err: e instanceof Error ? e.message : String(e),
      logs: Array.isArray(e?.logs) ? e.logs : [],
    };
  }
  return { sim: { err: simErr, logs: simLogs }, send };
}

async function deployVia(method, { bytecode, connection, payer, fiveProgramId }) {
  if (method === 'deployment-config') return null;
  if (method === 'sdk-deploy') {
    try {
      const res = await FiveSDK.deployToSolana(bytecode, connection, payer, { fiveVMProgramId: fiveProgramId });
      if (!res?.success || !res?.scriptAccount) return { scriptAccount: null, error: `deployToSolana failed: ${res?.error || 'unknown'}` };
      return { scriptAccount: res.scriptAccount, error: null };
    } catch (error) {
      return { scriptAccount: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (method === 'sdk-deploy-large') {
    try {
      const res = await FiveSDK.deployLargeProgramToSolana(bytecode, connection, payer, { fiveVMProgramId: fiveProgramId, forceChunkedSmallProgram: true });
      if (!res?.success || !res?.scriptAccount) return { scriptAccount: null, error: `deployLargeProgramToSolana failed: ${res?.error || 'unknown'}` };
      return { scriptAccount: res.scriptAccount, error: null };
    } catch (error) {
      return { scriptAccount: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
  throw new Error(`unsupported deploy method: ${method}`);
}

async function main() {
  const cfg = await loadDeploymentConfig(projectRoot, network);
  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  await connection.getVersion();
  const payer = await loadDefaultPayerKeypair();

  const artifactPath = await resolveFiveArtifactPath(projectRoot);
  const artifactText = await readFile(artifactPath, 'utf8');
  const loaded = await FiveSDK.loadFiveFile(artifactText);

  const deployMethods = ['deployment-config', 'sdk-deploy', 'sdk-deploy-large'];
  const initPatterns = [
    { id: 'precreate-vm-owner', precreate: true, owner: cfg.fiveProgramId, profileSigner: true },
    { id: 'precreate-system-owner', precreate: true, owner: SystemProgram.programId.toBase58(), profileSigner: true },
    { id: 'no-precreate-no-profile-signer', precreate: false, owner: null, profileSigner: false },
    { id: 'no-precreate-with-profile-signer', precreate: false, owner: null, profileSigner: true },
  ];

  const report = {
    network,
    rpcUrl: cfg.rpcUrl,
    fiveProgramId: cfg.fiveProgramId,
    vmStatePda: cfg.vmStatePda || null,
    deploymentConfigScriptAccount: cfg.tictactoeScriptAccount,
    timestamp: new Date().toISOString(),
    runs: [],
  };

  for (const deployMethod of deployMethods) {
    const deployResult =
      deployMethod === 'deployment-config'
        ? { scriptAccount: cfg.tictactoeScriptAccount, error: null }
        : await deployVia(deployMethod, {
            bytecode: loaded.bytecode,
            connection,
            payer,
            fiveProgramId: cfg.fiveProgramId,
          });

    const run = { deployMethod, scriptAccount: deployResult.scriptAccount, deployError: deployResult.error, cases: [] };
    if (!deployResult.scriptAccount) {
      report.runs.push(run);
      continue;
    }

    const program = FiveProgram.fromABI(deployResult.scriptAccount, loaded.abi, {
      fiveVMProgramId: cfg.fiveProgramId,
    });

    for (const pattern of initPatterns) {
      const owner = payer.publicKey;
      const profile = Keypair.generate();
      const ownerB58 = owner.toBase58();
      const profileB58 = profile.publicKey.toBase58();

      const builderEncoded = await program
        .function('init_profile')
        .payer(ownerB58)
        .accounts({ profile: profileB58, owner: ownerB58 })
        .instruction();

      const metaMap = new Map();
      for (const k of builderEncoded.keys) {
        metaMap.set(k.pubkey, {
          isSigner: !!k.isSigner,
          isWritable: !!k.isWritable,
          isSystemAccount: k.pubkey === SystemProgram.programId.toBase58(),
        });
      }
      const orderedMeta = builderEncoded.keys
        .slice(2, builderEncoded.keys.length - 3)
        .map((k) => ({
          isSigner: !!k.isSigner,
          isWritable: !!k.isWritable,
          isSystemAccount: k.pubkey === SystemProgram.programId.toBase58(),
        }));

      const generated = await FiveSDK.generateExecuteInstruction(
        deployResult.scriptAccount,
        'init_profile',
        [],
        [profileB58, ownerB58],
        connection,
        {
          fiveVMProgramId: cfg.fiveProgramId,
          abi: loaded.abi,
          accountMetadata: metaMap,
          orderedAccountMetadata: orderedMeta,
          payerAccount: ownerB58,
        }
      );

      const builderIx = toIx(builderEncoded);
      const generatedIx = new TransactionInstruction({
        programId: new PublicKey(generated.instruction.programId),
        keys: generated.instruction.accounts.map((k) => ({
          pubkey: new PublicKey(k.pubkey),
          isSigner: !!k.isSigner,
          isWritable: !!k.isWritable,
        })),
        data: Buffer.from(generated.instruction.data, 'base64'),
      });
      if (pattern.profileSigner) {
        markInitAccountSigner(builderIx, profileB58);
        markInitAccountSigner(generatedIx, profileB58);
      }

      const lamports = await connection.getMinimumBalanceForRentExemption(DEFAULT_PROFILE_SPACE);
      const builderTx = new Transaction();
      const generatedTx = new Transaction();
      const builderSigners = [payer];
      const generatedSigners = [payer];

      if (pattern.precreate) {
        const ownerProgram = new PublicKey(pattern.owner);
        const createIx = SystemProgram.createAccount({
          fromPubkey: owner,
          newAccountPubkey: profile.publicKey,
          lamports,
          space: DEFAULT_PROFILE_SPACE,
          programId: ownerProgram,
        });
        builderTx.add(createIx);
        generatedTx.add(createIx);
      }

      builderTx.add(builderIx);
      generatedTx.add(generatedIx);

      if (pattern.profileSigner) {
        builderSigners.push(profile);
        generatedSigners.push(profile);
      }

      const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
      builderTx.feePayer = owner;
      generatedTx.feePayer = owner;
      builderTx.recentBlockhash = blockhash;
      generatedTx.recentBlockhash = blockhash;

      const builderResult = await simulateAndSend({
        connection,
        payer,
        tx: builderTx,
        signers: builderSigners,
      });
      const generatedResult = await simulateAndSend({
        connection,
        payer,
        tx: generatedTx,
        signers: generatedSigners,
      });

      const builderKeys = keySigList(builderIx.keys);
      const generatedKeys = keySigList(generatedIx.keys);
      run.cases.push({
        pattern: pattern.id,
        encodedDataEqual: builderEncoded.data === generated.instruction.data,
        keyOrderDiff: diffLists(builderKeys, generatedKeys),
        builder: {
          keys: builderKeys,
          result: builderResult,
        },
        generated: {
          keys: generatedKeys,
          result: generatedResult,
        },
      });
    }

    report.runs.push(run);
  }

  await writeFile(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[diagnose-init-profile] wrote ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
