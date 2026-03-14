import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { PublicKey, Transaction } from '@solana/web3.js';
import { LocalnetTicTacToeEngine, type Role } from './src/localnet-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..', '..');
const htmlPath = resolve(projectRoot, 'client', 'gui', 'index.html');

let enginePromise: Promise<LocalnetTicTacToeEngine> | null = null;
let lastAction: unknown = null;

function getEngine(): Promise<LocalnetTicTacToeEngine> {
  if (!enginePromise) {
    enginePromise = LocalnetTicTacToeEngine.create(projectRoot);
  }
  return enginePromise;
}

function json(res: any, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function parseBody(req: any): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>;
}

function asRole(v: unknown): Role {
  if (v === 'p2') return 'p2';
  if (v === 'p3') return 'p3';
  return 'p1';
}

async function handler(req: any, res: any) {
  try {
    if (req.method === 'GET' && req.url === '/') {
      const html = await readFile(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method !== 'POST' || !req.url.startsWith('/api/')) {
      json(res, 404, { error: 'not found' });
      return;
    }

    const engine = await getEngine();
    const body = await parseBody(req);

    if (req.url === '/api/state') {
      json(res, 200, {
        message: 'state loaded',
        state: engine.getState(),
        addresses: engine.getAddresses(),
        lastAction,
      });
      return;
    }

    if (req.url === '/api/ready') {
      const addresses = engine.getAddresses();
      const wallet = String(body.wallet || '');
      const minSol = Number(body.minSol || 0.1);
      const minLamports = Math.max(1, Math.floor(minSol * 1_000_000_000));

      const [latestBlockhash, vmInfo, scriptInfo] = await Promise.all([
        engine.connection.getLatestBlockhash('confirmed'),
        engine.connection.getAccountInfo(new PublicKey(addresses.fiveVmProgramId), 'confirmed'),
        engine.connection.getAccountInfo(new PublicKey(addresses.scriptAccount), 'confirmed'),
      ]);

      let walletInfo = null as null | { address: string; lamports: number; balanceSol: number; minSol: number; hasMinFunds: boolean };
      if (wallet) {
        const lamports = await engine.connection.getBalance(new PublicKey(wallet), 'confirmed');
        walletInfo = {
          address: wallet,
          lamports,
          balanceSol: lamports / 1_000_000_000,
          minSol,
          hasMinFunds: lamports >= minLamports,
        };
      }

      const ok = Boolean(latestBlockhash?.blockhash && vmInfo && scriptInfo && (walletInfo ? walletInfo.hasMinFunds : true));
      json(res, 200, {
        ok,
        validator: { ok: Boolean(latestBlockhash?.blockhash), blockhash: latestBlockhash?.blockhash || null },
        vmProgram: { ok: Boolean(vmInfo), address: addresses.fiveVmProgramId },
        scriptAccount: { ok: Boolean(scriptInfo), address: addresses.scriptAccount },
        wallet: walletInfo,
      });
      return;
    }

    if (req.url === '/api/mock-wallet') {
      json(res, 200, {
        ok: true,
        mode: 'mock',
        address: engine.payer.publicKey.toBase58(),
      });
      return;
    }

    if (req.url === '/api/build-wallet-action') {
      const wallet = String(body.wallet || '');
      if (!wallet) {
        json(res, 400, { error: 'wallet is required' });
        return;
      }

      const action = String(body.action || '');
      let functionName = '';
      let role: Role = asRole(body.role);
      let args: Record<string, any> = {};

      if (action === 'init') {
        functionName = 'init_config';
        role = 'p1';
        args = {
          turn_timeout_secs: Number(body.turnTimeoutSecs || 120),
          allow_open_matches: 1,
          allow_invites: 1,
        };
      } else if (action === 'create-open') {
        functionName = 'create_open_match';
        role = 'p1';
      } else if (action === 'create-invite') {
        functionName = 'create_invite_match';
        role = 'p1';
      } else if (action === 'join') {
        functionName = 'join_match';
      } else if (action === 'start-single') {
        functionName = 'start_single_player';
        role = 'p1';
      } else if (action === 'move') {
        functionName = 'play_ttt';
        args = { cell_index: Number(body.row || 0) * 3 + Number(body.col || 0) };
      } else if (action === 'single-move') {
        functionName = 'play_ttt_single';
        role = 'p1';
        args = { cell_index: Number(body.row || 0) * 3 + Number(body.col || 0) };
      } else if (action === 'cpu-move') {
        functionName = 'play_cpu_random';
        role = 'p1';
      } else if (action === 'claim-timeout') {
        functionName = 'claim_timeout';
      } else if (action === 'resign') {
        functionName = 'resign';
      } else if (action === 'cancel') {
        functionName = 'cancel_waiting_match';
        role = 'p1';
      } else {
        json(res, 400, { error: `unsupported action: ${action}` });
        return;
      }

      const txBase64 = await engine.buildUnsignedTx(functionName, role, args, wallet);
      json(res, 200, { action, functionName, txBase64 });
      return;
    }

    if (req.url === '/api/mock-send') {
      const txBase64 = String(body.txBase64 || '');
      if (!txBase64) {
        json(res, 400, { error: 'txBase64 is required' });
        return;
      }
      const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
      try {
        const signature = await engine.connection.sendTransaction(tx, [engine.payer], {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
        const latest = await engine.connection.getLatestBlockhash('confirmed');
        await engine.connection.confirmTransaction({ signature, ...latest }, 'confirmed');
        const confirmedSlot = await engine.connection.getSlot('confirmed');
        json(res, 200, { ok: true, signature, confirmedSlot, simulated: false });
      } catch (err) {
        // Mock wallet mode is for fast UX iteration; keep flow moving even when
        // localnet VM rejects instruction payloads on this environment.
        const confirmedSlot = await engine.connection.getSlot('confirmed');
        const signature = `mock-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
        json(res, 200, {
          ok: true,
          signature,
          confirmedSlot,
          simulated: true,
          warning: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (req.url === '/api/commit-wallet-action') {
      const action = String(body.action || '');
      const signature = String(body.signature || '');
      const simulated = Boolean(body.simulated);
      if (!signature) {
        json(res, 400, { error: 'signature is required for commit' });
        return;
      }
      if (simulated) {
        json(res, 400, { error: 'simulated commits are not allowed in strict on-chain mode' });
        return;
      }
      await engine.applyLocalAction(action, body);
      lastAction = { kind: 'wallet-action', action, signature };
      json(res, 200, { ok: true, state: engine.getState(), addresses: engine.getAddresses(), lastAction });
      return;
    }

    if (req.url === '/api/init') {
      const timeout = Number(body.turnTimeoutSecs || 120);
      const result = await engine.initGame(timeout);
      lastAction = { kind: 'init', result };
      json(res, 200, { message: 'initialized', result, state: engine.getState(), addresses: engine.getAddresses() });
      return;
    }

    if (req.url === '/api/create-open') {
      const result = await engine.createOpen();
      lastAction = { kind: 'create-open', result };
      json(res, 200, { message: 'open match created', result, state: engine.getState(), addresses: engine.getAddresses() });
      return;
    }

    if (req.url === '/api/create-invite') {
      const result = await engine.createInvite();
      lastAction = { kind: 'create-invite', result };
      json(res, 200, { message: 'invite match created', result, state: engine.getState(), addresses: engine.getAddresses() });
      return;
    }

    if (req.url === '/api/join') {
      const role = asRole(body.role);
      const result = await engine.join(role);
      lastAction = { kind: 'join', role, result };
      json(res, 200, { message: 'join submitted', result, state: engine.getState(), addresses: engine.getAddresses() });
      return;
    }

    if (req.url === '/api/start-single') {
      const result = await engine.startSingle();
      lastAction = { kind: 'start-single', result };
      json(res, 200, { message: 'single-player started', result, state: engine.getState(), addresses: engine.getAddresses() });
      return;
    }

    if (req.url === '/api/move') {
      const role = asRole(body.role);
      const result = await engine.playTTT(role, Number(body.row || 0), Number(body.col || 0));
      lastAction = { kind: 'move', role, mode: 'ttt', result };
      json(res, 200, { message: 'move submitted', result, state: engine.getState(), addresses: engine.getAddresses() });
      return;
    }

    if (req.url === '/api/single-move') {
      const row = Number(body.row || 0);
      const col = Number(body.col || 0);
      const result = await engine.playTTTSingle(row, col);
      lastAction = { kind: 'single-move', row, col, result };
      json(res, 200, { message: 'single-player move submitted', result, state: engine.getState(), addresses: engine.getAddresses() });
      return;
    }

    if (req.url === '/api/move-vs-cpu') {
      const row = Number(body.row || 0);
      const col = Number(body.col || 0);
      const playerMove = await engine.playTTT('p1', row, col);
      const cpu = playerMove.ok ? await engine.playCpuRandom() : { attempted: false, cell: null, result: null };
      lastAction = { kind: 'move-vs-cpu', playerMove, cpu };
      json(res, 200, {
        message: 'single-player move submitted',
        playerMove,
        cpu,
        state: engine.getState(),
        addresses: engine.getAddresses(),
      });
      return;
    }

    if (req.url === '/api/cpu-move') {
      const cpu = await engine.playCpuRandom();
      lastAction = { kind: 'cpu-move', cpu };
      json(res, 200, {
        message: 'cpu move submitted',
        cpu,
        state: engine.getState(),
        addresses: engine.getAddresses(),
      });
      return;
    }

    if (req.url === '/api/claim-timeout') {
      const role = asRole(body.role);
      const result = await engine.claimTimeout(role);
      lastAction = { kind: 'claim-timeout', role, result };
      json(res, 200, { message: 'timeout claimed', result, state: engine.getState(), addresses: engine.getAddresses() });
      return;
    }

    if (req.url === '/api/resign') {
      const role = asRole(body.role);
      const result = await engine.resign(role);
      lastAction = { kind: 'resign', role, result };
      json(res, 200, { message: 'resigned', result, state: engine.getState(), addresses: engine.getAddresses() });
      return;
    }

    if (req.url === '/api/cancel') {
      const result = await engine.cancel();
      lastAction = { kind: 'cancel', result };
      json(res, 200, { message: 'waiting match cancelled', result, state: engine.getState(), addresses: engine.getAddresses() });
      return;
    }

    json(res, 404, { error: 'unknown endpoint' });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

const port = Number(process.env.PORT || 4178);
createServer(handler).listen(port, '127.0.0.1', () => {
  console.log(`TicTacToe GUI server listening on http://127.0.0.1:${port}`);
});
