import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transaction } from '@solana/web3.js';
import { LocalnetTicTacToeEngine } from '../src/localnet-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..', '..', '..');

function txFromBase64(txBase64: string): Transaction {
  return Transaction.from(Buffer.from(txBase64, 'base64'));
}

test('new game on-chain (single-player): create-open + start-single in one tx succeeds', async () => {
  const engine = await LocalnetTicTacToeEngine.create(projectRoot);
  const wallet = engine.payer.publicKey.toBase58();

  const createOpenTxBase64 = await engine.buildUnsignedTx('create_open_match', 'p1', {}, wallet);
  const startSingleTxBase64 = await engine.buildUnsignedTx('start_single_player', 'p1', {}, wallet);

  const createOpenTx = txFromBase64(createOpenTxBase64);
  const startSingleTx = txFromBase64(startSingleTxBase64);

  assert.ok(createOpenTx.instructions.length > 0, 'create_open_match has no instructions');
  assert.ok(startSingleTx.instructions.length > 0, 'start_single_player has no instructions');

  const tx = new Transaction();
  for (const ix of createOpenTx.instructions) tx.add(ix);
  for (const ix of startSingleTx.instructions) tx.add(ix);
  tx.feePayer = engine.payer.publicKey;
  tx.recentBlockhash = (await engine.connection.getLatestBlockhash('confirmed')).blockhash;

  const signature = await engine.connection.sendTransaction(tx, [engine.payer], {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  const latest = await engine.connection.getLatestBlockhash('confirmed');
  await engine.connection.confirmTransaction({ signature, ...latest }, 'confirmed');

  const landed = await engine.connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  assert.ok(landed, 'transaction not found after confirmation');
  assert.equal(landed.meta?.err ?? null, null, `on-chain failure: ${JSON.stringify(landed.meta?.err ?? null)}`);
});

