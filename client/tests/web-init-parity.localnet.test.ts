import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
} from "@solana/web3.js";
import { FiveProgram, FiveSDK, loadDefaultPayerKeypair, resolveFiveArtifactPath } from "@5ive-tech/sdk";
import { resolveClientRuntimeConfig } from "../src/runtime-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..", "..");

function hasLocalnet(rpcUrl: string): boolean {
  return rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost");
}

function toIx(
  encoded: { programId: string; keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>; data: string },
  initSignerPubkeys: string[] = []
) {
  const initSignerSet = new Set(initSignerPubkeys);
  return new TransactionInstruction({
    programId: new PublicKey(encoded.programId),
    keys: encoded.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: !!k.isSigner || initSignerSet.has(k.pubkey),
      isWritable: !!k.isWritable || initSignerSet.has(k.pubkey),
    })),
    data: Buffer.from(encoded.data, "base64"),
  });
}

test("web parity localnet: init_profile and create_open+start_single succeed", async (t) => {
  const runtime = await resolveClientRuntimeConfig(projectRoot, "localnet", process.env);
  if (!hasLocalnet(runtime.rpcUrl)) {
    t.skip("localnet-only test");
    return;
  }
  const connection = new Connection(runtime.rpcUrl, "confirmed");
  try {
    await connection.getVersion();
  } catch {
    t.skip("localnet RPC not reachable");
    return;
  }

  const payer = await loadDefaultPayerKeypair();
  const artifactPath = await resolveFiveArtifactPath(projectRoot);
  const artifactText = await (await import("node:fs/promises")).readFile(artifactPath, "utf8");
  const loaded = await FiveSDK.loadFiveFile(artifactText);
  const program = FiveProgram.fromABI(runtime.tictactoeScriptAccount, loaded.abi, {
    fiveVMProgramId: runtime.fiveProgramId,
  });

  const configInfo = await connection.getAccountInfo(new PublicKey(runtime.tictactoeConfigAccount), "confirmed");
  assert.ok(configInfo, "configured tictactoeConfigAccount must exist on localnet");

  const owner = payer.publicKey.toBase58();
  const profile = Keypair.generate();
  const profileIx = await program
    .function("init_profile")
    .payer(owner)
    .accounts({ profile: profile.publicKey.toBase58(), owner })
    .instruction();

  const profileTx = new Transaction().add(toIx(profileIx, [profile.publicKey.toBase58()]));
  profileTx.feePayer = payer.publicKey;
  profileTx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const profileSig = await connection.sendTransaction(profileTx, [payer, profile], {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const latestA = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: profileSig, ...latestA }, "confirmed");
  const profileMeta = await connection.getTransaction(profileSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  assert.equal(profileMeta?.meta?.err ?? null, null, `init_profile failed: ${JSON.stringify(profileMeta?.meta?.err ?? null)}`);

  const matchState = Keypair.generate();
  const createOpenIx = await program
    .function("create_open_match")
    .payer(owner)
    .accounts({
      config: runtime.tictactoeConfigAccount,
      match_state: matchState.publicKey.toBase58(),
      player1: owner,
    })
    .instruction();
  const startSingleIx = await program
    .function("start_single_player")
    .payer(owner)
    .accounts({
      match_state: matchState.publicKey.toBase58(),
      caller: owner,
      __session: runtime.fiveProgramId,
    })
    .instruction();

  const gameTx = new Transaction().add(
    toIx(createOpenIx, [matchState.publicKey.toBase58()]),
    toIx(startSingleIx)
  );
  gameTx.feePayer = payer.publicKey;
  gameTx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const gameSig = await connection.sendTransaction(gameTx, [payer, matchState], {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const latestB = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: gameSig, ...latestB }, "confirmed");
  const gameMeta = await connection.getTransaction(gameSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  assert.equal(gameMeta?.meta?.err ?? null, null, `create_open+start_single failed: ${JSON.stringify(gameMeta?.meta?.err ?? null)}`);
});
