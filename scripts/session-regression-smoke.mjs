#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '../../five-cli/node_modules/@solana/web3.js/lib/index.cjs.js';
import { FiveProgram, FiveSDK } from '../../five-sdk/dist/index.js';

const DEFAULT_VM_PROGRAM_ID = '5ive5hbC3aRsvq37MP5m4sHtTSFxT4Cq1smS4ddyWJ6h';
const DEFAULT_SESSION_SCOPE_HASH = scopeHashForFunctions([
  'start_single_player',
  'play_ttt_single',
]);

const SESSION_MANAGER_ABI = {
  name: 'SessionManager',
  functions: [
    {
      name: 'create_session',
      index: 0,
      parameters: [
        { name: 'session', type: 'Account', is_account: true, attributes: ['mut'] },
        { name: 'authority', type: 'Account', is_account: true, attributes: ['signer'] },
        { name: 'delegate', type: 'Account', is_account: true, attributes: [] },
        { name: 'target_program', type: 'pubkey', is_account: false, attributes: [] },
        { name: 'expires_at_slot', type: 'u64', is_account: false, attributes: [] },
        { name: 'scope_hash', type: 'u64', is_account: false, attributes: [] },
        { name: 'bind_account', type: 'pubkey', is_account: false, attributes: [] },
        { name: 'nonce', type: 'u64', is_account: false, attributes: [] },
      ],
      return_type: null,
      is_public: true,
      bytecode_offset: 0,
    },
  ],
};

function scopeHashForFunctions(functions) {
  const sorted = [...functions].sort();
  let acc = 0n;
  const mask = (1n << 64n) - 1n;
  for (const ch of sorted.join('|')) {
    acc = (acc * 131n + BigInt(ch.charCodeAt(0))) & mask;
  }
  return acc.toString();
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = '1';
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function canonicalSessionManagerScriptAccount(vmProgramId) {
  const [scriptPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('session_v1', 'utf-8')],
    new PublicKey(vmProgramId)
  );
  return scriptPda.toBase58();
}

async function loadPayer(pathArg) {
  const keypairPath = pathArg || join(homedir(), '.config/solana/id.json');
  const secret = JSON.parse(await readFile(keypairPath, 'utf8'));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

async function sendNamedIx(connection, signer, name, encoded, extraSigners = []) {
  const ix = new TransactionInstruction({
    programId: new PublicKey(encoded.programId),
    keys: encoded.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(encoded.data, 'base64'),
  });
  const tx = new Transaction().add(ix);

  try {
    const signature = await connection.sendTransaction(tx, [signer, ...extraSigners], {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });
    const latest = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
    const txInfo = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    const err = txInfo?.meta?.err ?? null;
    return {
      name,
      signature,
      err,
      computeUnits: txInfo?.meta?.computeUnitsConsumed ?? null,
      logsTail: err ? (txInfo?.meta?.logMessages || []).slice(-8) : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const logs = Array.isArray(error?.logs) ? error.logs.slice(-8) : [];
    return {
      name,
      signature: error?.signature || null,
      err: message,
      computeUnits: null,
      logsTail: logs,
    };
  }
}

async function setupAccounts(connection, payer, vmProgramId) {
  const ownerProgram = new PublicKey(vmProgramId);
  const config = Keypair.generate();
  const match = Keypair.generate();
  const profile = Keypair.generate();

  const configRent = await connection.getMinimumBalanceForRentExemption(256);
  const matchRent = await connection.getMinimumBalanceForRentExemption(2048);
  const profileRent = await connection.getMinimumBalanceForRentExemption(256);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: config.publicKey,
      lamports: configRent,
      space: 256,
      programId: ownerProgram,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: match.publicKey,
      lamports: matchRent,
      space: 2048,
      programId: ownerProgram,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: profile.publicKey,
      lamports: profileRent,
      space: 256,
      programId: ownerProgram,
    })
  );

  const signature = await connection.sendTransaction(tx, [payer, config, match, profile], {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  const latest = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({ signature, ...latest }, 'confirmed');

  return {
    setupSignature: signature,
    config,
    match,
    profile,
  };
}

async function runMode({
  mode,
  connection,
  payer,
  program,
  sessionProgram,
  vmProgramId,
  sessionManagerScriptAccount,
  scriptAccount,
  sessionScopeHash,
  seed,
}) {
  const owner = payer.publicKey.toBase58();
  const setup = await setupAccounts(connection, payer, vmProgramId);

  const summary = {
    mode,
    setup: {
      signature: setup.setupSignature,
      config: setup.config.publicKey.toBase58(),
      match: setup.match.publicKey.toBase58(),
      profile: setup.profile.publicKey.toBase58(),
    },
    steps: [],
  };

  const runCall = async (fnName, args, accounts, extraSigners = []) => {
    const encoded = await program
      .function(fnName)
      .payer(owner)
      .accounts(accounts)
      .args(args || {})
      .instruction();
    const step = await sendNamedIx(connection, payer, fnName, encoded, extraSigners);
    summary.steps.push(step);
    return step;
  };

  await runCall(
    'init_config',
    { turn_timeout_secs: 120, allow_open_matches: 1, allow_invites: 1 },
    { config: setup.config.publicKey.toBase58(), authority: owner }
  );

  await runCall(
    'init_profile',
    {},
    { profile: setup.profile.publicKey.toBase58(), owner }
  );

  await runCall(
    'create_open_match',
    {},
    {
      config: setup.config.publicKey.toBase58(),
      match_state: setup.match.publicKey.toBase58(),
      player1: owner,
    }
  );

  let caller = owner;
  let sessionAccount = vmProgramId;
  let callerSigners = [];

  if (mode === 'delegated') {
    const delegate = Keypair.generate();
    const session = Keypair.generate();
    const sessionRent = await connection.getMinimumBalanceForRentExemption(256);

    const createSessionAccountTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: session.publicKey,
        lamports: sessionRent,
        space: 256,
        programId: new PublicKey(vmProgramId),
      })
    );

    const createSig = await connection.sendTransaction(createSessionAccountTx, [payer, session], {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });
    const latest = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({ signature: createSig, ...latest }, 'confirmed');

    summary.steps.push({
      name: 'create_session_account',
      signature: createSig,
      err: null,
      computeUnits: null,
      logsTail: [],
    });

    const slot = await connection.getSlot('confirmed');
    const createSessionIx = await sessionProgram
      .function('create_session')
      .payer(owner)
      .accounts({
        session: session.publicKey.toBase58(),
        authority: owner,
        delegate: delegate.publicKey.toBase58(),
      })
      .args({
        target_program: scriptAccount,
        expires_at_slot: slot + 3000,
        scope_hash: sessionScopeHash,
        bind_account: setup.match.publicKey.toBase58(),
        nonce: 0,
      })
      .instruction();

    const createSessionStep = await sendNamedIx(connection, payer, 'create_session', createSessionIx);
    summary.steps.push(createSessionStep);

    caller = delegate.publicKey.toBase58();
    sessionAccount = session.publicKey.toBase58();
    callerSigners = [delegate];
    summary.delegate = delegate.publicKey.toBase58();
    summary.session = session.publicKey.toBase58();
  }

  await runCall(
    'start_single_player',
    {},
    {
      match_state: setup.match.publicKey.toBase58(),
      caller,
      __session: sessionAccount,
    },
    callerSigners
  );

  await runCall(
    'play_ttt_single',
    { cell_index: Number(seed) % 9 },
    {
      match_state: setup.match.publicKey.toBase58(),
      caller,
      __session: sessionAccount,
    },
    callerSigners
  );

  return summary;
}

function summarize(results) {
  const failures = [];
  for (const run of results) {
    for (const step of run.steps) {
      if (step.err) {
        failures.push({ mode: run.mode, step: step.name, signature: step.signature, err: step.err });
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rpcUrl = args['rpc-url'] || process.env.FIVE_RPC_URL || 'https://api.devnet.solana.com';
  const vmProgramId = args['vm-program-id'] || process.env.FIVE_VM_PROGRAM_ID || DEFAULT_VM_PROGRAM_ID;
  const sessionManagerScriptAccount =
    args['session-manager-script-account'] ||
    process.env.FIVE_SESSION_MANAGER_SCRIPT_ACCOUNT ||
    canonicalSessionManagerScriptAccount(vmProgramId);
  const sessionScopeHash =
    args['session-scope-hash'] || process.env.FIVE_SESSION_SCOPE_HASH || DEFAULT_SESSION_SCOPE_HASH;
  const scriptAccount = args['script-account'] || process.env.FIVE_SCRIPT_ACCOUNT;
  if (!scriptAccount) {
    throw new Error('Missing --script-account (or FIVE_SCRIPT_ACCOUNT)');
  }

  const artifactPath = resolve(args.artifact || './build/5ive-tictactoe.five');
  const keypairPath = args.keypair || join(homedir(), '.config/solana/id.json');
  const seed = Number(args.seed || process.env.FIVE_SEED || '1337');

  const connection = new Connection(rpcUrl, 'confirmed');
  const payer = await loadPayer(keypairPath);
  const artifact = await readFile(artifactPath, 'utf8');
  const loaded = await FiveSDK.loadFiveFile(artifact);

  const program = FiveProgram.fromABI(scriptAccount, loaded.abi, { fiveVMProgramId: vmProgramId });
  const sessionProgram = FiveProgram.fromABI(sessionManagerScriptAccount, SESSION_MANAGER_ABI, {
    fiveVMProgramId: vmProgramId,
  });

  const direct = await runMode({
    mode: 'direct',
    connection,
    payer,
    program,
    sessionProgram,
    vmProgramId,
    sessionManagerScriptAccount,
    scriptAccount,
    sessionScopeHash,
    seed,
  });

  const delegated = await runMode({
    mode: 'delegated',
    connection,
    payer,
    program,
    sessionProgram,
    vmProgramId,
    sessionManagerScriptAccount,
    scriptAccount,
    sessionScopeHash,
    seed: seed + 1,
  });

  const results = [direct, delegated];
  const summary = summarize(results);
  const payload = {
    rpcUrl,
    vmProgramId,
    sessionManagerScriptAccount,
    sessionScopeHash,
    scriptAccount,
    artifactPath,
    generatedAt: new Date().toISOString(),
    results,
    summary,
  };

  if (args.output) {
    const outputPath = resolve(args.output);
    await mkdir(resolve(outputPath, '..'), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify(payload, null, 2));
  if (!summary.ok) process.exit(2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
