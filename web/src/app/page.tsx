"use client";

import { useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type ConfirmOptions,
} from "@solana/web3.js";
import { FiveProgram, FiveSDK, SessionClient, scopeHashForFunctions } from "@5ive-tech/sdk";
import { Navbar } from "@/components/layout/Navbar";

type GameAccounts = {
  config: string;
  match_state: string;
  profile: string;
};

type SessionState = {
  delegate: Keypair | null;
  sessionAccount: Keypair | null;
  status: "unknown" | "active" | "revoked" | "expired";
  nonce: number;
  expiresAtSlot: number | null;
  managerScriptAccount: string;
};

type MatchView = {
  status: number;
  currentTurn: number;
  winner: number;
  moveCount: number;
  board: number[];
};

type PlayMode = "direct" | "session";

const MATCH_WAITING = 0;
const MATCH_ACTIVE = 1;
const MATCH_P1_WIN = 2;
const MATCH_P2_WIN = 3;
const MATCH_DRAW = 4;
const MATCH_CANCELLED = 5;

const TURN_P1 = 1;
const TURN_P2 = 2;
const SESSION_ACCOUNT_SPACE = 256;
const ACCOUNT_SPACE_CONFIG = 256;
const ACCOUNT_SPACE_MATCH = 2048;
const ACCOUNT_SPACE_PROFILE = 256;

const SESSION_TTL_SLOTS = Number(process.env.NEXT_PUBLIC_SESSION_TTL_SLOTS || "3000");
const SESSION_DELEGATE_MIN_FEE_LAMPORTS = 500_000;
const SESSION_DELEGATE_TOPUP_LAMPORTS = 2_000_000;

const DEFAULT_VM_PROGRAM_ID =
  process.env.NEXT_PUBLIC_FIVE_VM_PROGRAM_ID || "5ive5uKDkc3Yhyfu1Sk7i3eVPDQUmG2GmTm2FnUZiTJd";
const DEFAULT_SCRIPT_ACCOUNT = process.env.NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT || "";
const DEFAULT_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

const CONFIRM_OPTS: ConfirmOptions = {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
  skipPreflight: false,
};

const DEFAULT_SESSION_SCOPE_HASH = scopeHashForFunctions(["start_single_player", "play_ttt_single"]);
const SESSION_SCOPE_HASH = process.env.NEXT_PUBLIC_SESSION_SCOPE_HASH || DEFAULT_SESSION_SCOPE_HASH;

function parseEnvAccounts(): GameAccounts | null {
  const config = process.env.NEXT_PUBLIC_TTT_CONFIG_ACCOUNT || "";
  const match_state = process.env.NEXT_PUBLIC_TTT_MATCH_ACCOUNT || "";
  const profile = process.env.NEXT_PUBLIC_TTT_PROFILE_ACCOUNT || "";
  if (!config || !match_state || !profile) return null;
  return { config, match_state, profile };
}

async function loadProgram(scriptAccount: string, vmProgramId: string) {
  const artifactText = await fetch("/main.five", { cache: "no-store" }).then(async (res) => {
    if (!res.ok) throw new Error("Missing /main.five. Run npm run build in 5ive-tictactoe first.");
    return res.text();
  });
  const loaded = await FiveSDK.loadFiveFile(artifactText);
  return FiveProgram.fromABI(scriptAccount, loaded.abi, { fiveVMProgramId: vmProgramId });
}

function isDelegatedSessionActive(sessionState?: SessionState): boolean {
  return !!sessionState?.delegate && !!sessionState?.sessionAccount && sessionState.status === "active";
}

function detectWinner(board: number[]): number {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] !== 0 && board[a] === board[b] && board[b] === board[c]) {
      return board[a];
    }
  }
  return 0;
}

function statusLabel(status: number): string {
  if (status === MATCH_WAITING) return "waiting";
  if (status === MATCH_ACTIVE) return "active";
  if (status === MATCH_P1_WIN) return "p1 win";
  if (status === MATCH_P2_WIN) return "p2 win";
  if (status === MATCH_DRAW) return "draw";
  if (status === MATCH_CANCELLED) return "cancelled";
  return `status:${status}`;
}

function shortSig(sig: string): string {
  return sig.length > 14 ? `${sig.slice(0, 6)}...${sig.slice(-6)}` : sig;
}

export default function Home() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [status, setStatus] = useState("ready");
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<GameAccounts | null>(parseEnvAccounts());
  const [sigs, setSigs] = useState<string[]>([]);
  const [match, setMatch] = useState<MatchView>({
    status: MATCH_WAITING,
    currentTurn: TURN_P1,
    winner: 0,
    moveCount: 0,
    board: new Array(9).fill(0),
  });
  const [session, setSession] = useState<SessionState>({
    delegate: null,
    sessionAccount: null,
    status: "unknown",
    nonce: 0,
    expiresAtSlot: null,
    managerScriptAccount: "",
  });
  const [playMode, setPlayMode] = useState<PlayMode>("direct");

  const vmProgramId = useMemo(() => DEFAULT_VM_PROGRAM_ID, []);
  const scriptAccount = useMemo(() => DEFAULT_SCRIPT_ACCOUNT, []);
  const explorerPrefix = useMemo(() => {
    const explicit = process.env.NEXT_PUBLIC_EXPLORER_BASE || "";
    if (explicit) return explicit;
    if (DEFAULT_RPC_URL.includes("devnet") || DEFAULT_RPC_URL.includes("mainnet")) {
      return "https://explorer.solana.com/tx/";
    }
    return "";
  }, []);
  const explorerSuffix = useMemo(() => {
    if (DEFAULT_RPC_URL.includes("devnet")) return "?cluster=devnet";
    return "";
  }, []);

  const walletConnected = !!wallet.connected && !!wallet.publicKey;

  const pushSig = (sig: string) => setSigs((prev) => [sig, ...prev].slice(0, 6));
  const errText = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const rec = err as Record<string, unknown>;
      if (typeof rec.message === "string") return rec.message;
      try {
        return JSON.stringify(rec);
      } catch {
        return String(err);
      }
    }
    return String(err);
  };

  function resolveSessionManagerScriptAccount(): string {
    const explicit = process.env.NEXT_PUBLIC_SESSION_MANAGER_SCRIPT_ACCOUNT || "";
    if (explicit) return explicit;
    return SessionClient.canonicalManagerScriptAccount(vmProgramId);
  }

  async function sendAndConfirm(
    tx: Transaction,
    extraSigners: Keypair[] = [],
    options?: { feePayer?: PublicKey; requireWalletSignature?: boolean }
  ) {
    if (!wallet.publicKey && !options?.feePayer) throw new Error("Connect wallet first.");
    tx.feePayer = options?.feePayer || wallet.publicKey || undefined;
    const latest = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    if (extraSigners.length > 0) tx.partialSign(...extraSigners);

    let sig = "";
    const requireWalletSignature = options?.requireWalletSignature ?? true;

    if (!requireWalletSignature) {
      sig = await connection.sendRawTransaction(tx.serialize(), { ...CONFIRM_OPTS, maxRetries: 3 });
    } else if (wallet.signTransaction) {
      const signed = await wallet.signTransaction(tx);
      sig = await connection.sendRawTransaction(signed.serialize(), { ...CONFIRM_OPTS, maxRetries: 3 });
    } else if (wallet.sendTransaction) {
      sig = await wallet.sendTransaction(tx, connection, CONFIRM_OPTS);
    } else {
      throw new Error("Wallet does not support signTransaction/sendTransaction.");
    }

    await connection.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed"
    );
    pushSig(sig);
    return sig;
  }

  async function provisionAccounts(): Promise<GameAccounts> {
    if (!wallet.publicKey) throw new Error("Connect wallet first.");
    const owner = new PublicKey(vmProgramId);
    const config = Keypair.generate();
    const match_state = Keypair.generate();
    const profile = Keypair.generate();

    const lamportsConfig = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SPACE_CONFIG);
    const lamportsMatch = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SPACE_MATCH);
    const lamportsProfile = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SPACE_PROFILE);
    const neededLamports = lamportsConfig + lamportsMatch + lamportsProfile;
    const balance = await connection.getBalance(wallet.publicKey, "confirmed");
    if (balance < neededLamports) {
      throw new Error(
        `insufficient SOL for account creation: need ${(neededLamports / 1e9).toFixed(4)} SOL, have ${(balance / 1e9).toFixed(4)} SOL`
      );
    }

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: config.publicKey,
        lamports: lamportsConfig,
        space: ACCOUNT_SPACE_CONFIG,
        programId: owner,
      }),
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: match_state.publicKey,
        lamports: lamportsMatch,
        space: ACCOUNT_SPACE_MATCH,
        programId: owner,
      }),
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: profile.publicKey,
        lamports: lamportsProfile,
        space: ACCOUNT_SPACE_PROFILE,
        programId: owner,
      })
    );

    await sendAndConfirm(tx, [config, match_state, profile]);

    const next = {
      config: config.publicKey.toBase58(),
      match_state: match_state.publicKey.toBase58(),
      profile: profile.publicKey.toBase58(),
    };
    setAccounts(next);
    return next;
  }

  async function buildInstruction(
    functionName: string,
    accountMap: Record<string, string>,
    args: Record<string, unknown>,
    payerPubkey: string
  ): Promise<TransactionInstruction> {
    const program = await loadProgram(scriptAccount, vmProgramId);
    let builder = program
      .function(functionName)
      .payer(payerPubkey)
      .accounts(accountMap);

    if (Object.keys(args).length > 0) {
      builder = builder.args(args);
    }

    const encoded = await builder.instruction();
    return new TransactionInstruction({
      programId: new PublicKey(encoded.programId),
      keys: encoded.keys.map((k: any) => ({
        pubkey: new PublicKey(k.pubkey),
        isSigner: !!k.isSigner,
        isWritable: !!k.isWritable,
      })),
      data: Buffer.from(encoded.data, "base64"),
    });
  }

  async function initializeGame() {
    if (!wallet.publicKey) throw new Error("Connect wallet first.");
    if (!scriptAccount) throw new Error("Set NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT in web/.env.local.");

    const resolved = accounts || (await provisionAccounts());

    const initConfigIx = await buildInstruction(
      "init_config",
      { config: resolved.config, authority: wallet.publicKey.toBase58() },
      { turn_timeout_secs: 120, allow_open_matches: 1, allow_invites: 1 },
      wallet.publicKey.toBase58()
    );

    const initProfileIx = await buildInstruction(
      "init_profile",
      { profile: resolved.profile, owner: wallet.publicKey.toBase58() },
      {},
      wallet.publicKey.toBase58()
    );

    await sendAndConfirm(new Transaction().add(initConfigIx, initProfileIx));
  }

  async function createSingleMatch() {
    if (!wallet.publicKey) throw new Error("Connect wallet first.");
    if (!accounts) throw new Error("Provision/initialize accounts first.");

    const createIx = await buildInstruction(
      "create_open_match",
      {
        config: accounts.config,
        match_state: accounts.match_state,
        player1: wallet.publicKey.toBase58(),
      },
      {},
      wallet.publicKey.toBase58()
    );

    const startIx = await buildInstruction(
      "start_single_player",
      {
        match_state: accounts.match_state,
        caller: wallet.publicKey.toBase58(),
        __session: vmProgramId,
      },
      {},
      wallet.publicKey.toBase58()
    );

    await sendAndConfirm(new Transaction().add(createIx, startIx));

    setMatch({
      status: MATCH_ACTIVE,
      currentTurn: TURN_P1,
      winner: 0,
      moveCount: 0,
      board: new Array(9).fill(0),
    });
  }

  async function createSession() {
    if (!wallet.publicKey) throw new Error("Connect wallet first.");
    if (!accounts) throw new Error("Provision/initialize accounts first.");

    const managerScriptAccount = resolveSessionManagerScriptAccount();
    const delegate = Keypair.generate();
    const sessionAccount = Keypair.generate();

    const walletLamports = await connection.getBalance(wallet.publicKey, "confirmed");
    const sessionRent = await connection.getMinimumBalanceForRentExemption(SESSION_ACCOUNT_SPACE);
    const needed = sessionRent + SESSION_DELEGATE_TOPUP_LAMPORTS + SESSION_DELEGATE_MIN_FEE_LAMPORTS;
    if (walletLamports < needed) {
      throw new Error(
        `insufficient SOL for session setup: need ${(needed / 1e9).toFixed(4)} SOL, have ${(walletLamports / 1e9).toFixed(4)} SOL`
      );
    }

    const slot = await connection.getSlot("confirmed");
    const sessionClient = new SessionClient({
      vmProgramId,
      managerScriptAccount,
    });
    await sessionClient.createSessionWithCompat(
      {
        authority: wallet.publicKey.toBase58(),
        delegate: delegate.publicKey.toBase58(),
        targetProgram: scriptAccount,
        expiresAtSlot: slot + Math.max(1, SESSION_TTL_SLOTS),
        scopeHash: SESSION_SCOPE_HASH,
        bindAccount: accounts.match_state,
        nonce: session.nonce,
      },
      async (sessionIx) => {
        const setupTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey!,
            toPubkey: delegate.publicKey,
            lamports: SESSION_DELEGATE_TOPUP_LAMPORTS,
          }),
          SystemProgram.createAccount({
            fromPubkey: wallet.publicKey!,
            newAccountPubkey: sessionAccount.publicKey,
            lamports: sessionRent,
            space: SESSION_ACCOUNT_SPACE,
            programId: new PublicKey(vmProgramId),
          }),
          sessionIx
        );
        return sendAndConfirm(setupTx, [sessionAccount]);
      }
    );

    setSession((prev) => ({
      ...prev,
      delegate,
      sessionAccount,
      status: "active",
      nonce: prev.nonce + 1,
      expiresAtSlot: slot + Math.max(1, SESSION_TTL_SLOTS),
      managerScriptAccount,
    }));
  }

  async function revokeSession() {
    if (!wallet.publicKey || !session.delegate) throw new Error("Connect wallet first.");
    if (!session.sessionAccount) throw new Error("No active session to revoke.");
    const sessionClient = new SessionClient({
      vmProgramId,
      managerScriptAccount: resolveSessionManagerScriptAccount(),
    });
    const ix = await sessionClient.revokeSessionIx({
      authority: wallet.publicKey.toBase58(),
      delegate: session.delegate.publicKey.toBase58(),
      targetProgram: scriptAccount,
      payer: wallet.publicKey.toBase58(),
    });
    await sendAndConfirm(new Transaction().add(ix));

    setSession((prev) => ({
      ...prev,
      status: "revoked",
      delegate: null,
      sessionAccount: null,
      expiresAtSlot: null,
    }));
  }

  async function playSingle(cell: number) {
    if (!wallet.publicKey) throw new Error("Connect wallet first.");
    if (!accounts) throw new Error("Provision/initialize accounts first.");
    if (match.status !== MATCH_ACTIVE) throw new Error("Match is not active.");
    if (match.currentTurn !== TURN_P1) throw new Error("Not your turn.");
    if (match.board[cell] !== 0) throw new Error("Cell already occupied.");

    const delegated = playMode === "session" && isDelegatedSessionActive(session);
    if (playMode === "session" && !delegated) {
      throw new Error("Session mode selected, but no active session. Click Create Session first.");
    }
    const caller = delegated && session.delegate ? session.delegate.publicKey.toBase58() : wallet.publicKey.toBase58();
    const sessionShadow = delegated && session.sessionAccount ? session.sessionAccount.publicKey.toBase58() : vmProgramId;

    const ix = await buildInstruction(
      "play_ttt_single",
      {
        match_state: accounts.match_state,
        caller,
        __session: sessionShadow,
      },
      { cell_index: cell },
      wallet.publicKey.toBase58()
    );

    const signers = delegated && session.delegate ? [session.delegate] : [];
    await sendAndConfirm(new Transaction().add(ix), signers);

    const nextBoard = [...match.board];
    nextBoard[cell] = 1;
    let nextMoveCount = match.moveCount + 1;

    let winner = detectWinner(nextBoard);
    let nextStatus = MATCH_ACTIVE;
    let nextTurn = TURN_P2;

    if (winner === 1) {
      nextStatus = MATCH_P1_WIN;
      nextTurn = TURN_P1;
    } else if (nextMoveCount >= 9) {
      nextStatus = MATCH_DRAW;
      nextTurn = TURN_P1;
    } else {
      const cpuCell = (cell + 1) % 9;
      nextBoard[cpuCell] = 2;
      nextMoveCount += 1;
      winner = detectWinner(nextBoard);
      if (winner === 2) {
        nextStatus = MATCH_P2_WIN;
      } else if (nextMoveCount >= 9) {
        nextStatus = MATCH_DRAW;
      }
      nextTurn = TURN_P1;
    }

    setMatch({
      status: nextStatus,
      currentTurn: nextTurn,
      winner: winner,
      moveCount: nextMoveCount,
      board: nextBoard,
    });
  }

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setStatus(`${label}...`);
    try {
      await fn();
      setStatus(`${label} ok`);
    } catch (err) {
      setStatus(`${label} failed: ${errText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      <Navbar />
      <section className="mx-auto max-w-5xl px-4 pt-28 pb-10">
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5 shadow-xl">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
            <span>rpc: {DEFAULT_RPC_URL}</span>
            <span>vm: {vmProgramId}</span>
            <span>script: {scriptAccount || "MISSING NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT"}</span>
          </div>

          <div className="mb-4 text-sm">
            <div className="text-zinc-300">status: {status}</div>
            <div className="text-zinc-300">wallet: {wallet.publicKey?.toBase58() || "not connected"}</div>
            <div className="text-zinc-300">accounts: {accounts ? JSON.stringify(accounts) : "not provisioned"}</div>
            <div className="text-zinc-300">
              session: {session.status}
              {session.delegate ? ` delegate=${session.delegate.publicKey.toBase58()}` : ""}
              {session.sessionAccount ? ` session=${session.sessionAccount.publicKey.toBase58()}` : ""}
            </div>
            <div className="text-zinc-300">play mode: {playMode}</div>
            <div className="text-zinc-300">match: {statusLabel(match.status)} turn={match.currentTurn} moves={match.moveCount}</div>
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            <button
              className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-50"
              disabled={!walletConnected || busy}
              onClick={() => run("provision", async () => { await provisionAccounts(); })}
            >
              Provision Accounts
            </button>
            <button
              className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-50"
              disabled={!walletConnected || busy}
              onClick={() => run("initialize", initializeGame)}
            >
              Init Config/Profile
            </button>
            <button
              className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-50"
              disabled={!walletConnected || busy}
              onClick={() => run("new single match", createSingleMatch)}
            >
              New Single Match
            </button>
            <button
              className={`rounded-lg px-3 py-2 text-sm disabled:opacity-50 ${
                playMode === "direct" ? "bg-cyan-500/30 hover:bg-cyan-500/40" : "bg-white/10 hover:bg-white/20"
              }`}
              disabled={busy}
              onClick={() => setPlayMode("direct")}
            >
              Use Direct Calls
            </button>
            <button
              className={`rounded-lg px-3 py-2 text-sm disabled:opacity-50 ${
                playMode === "session" ? "bg-cyan-500/30 hover:bg-cyan-500/40" : "bg-white/10 hover:bg-white/20"
              }`}
              disabled={busy}
              onClick={() => setPlayMode("session")}
            >
              Use Session Calls
            </button>
            <button
              className="rounded-lg bg-emerald-500/25 px-3 py-2 text-sm hover:bg-emerald-500/35 disabled:opacity-50"
              disabled={!walletConnected || busy || !accounts}
              onClick={() => run("create session", createSession)}
            >
              Create Session
            </button>
            <button
              className="rounded-lg bg-amber-500/25 px-3 py-2 text-sm hover:bg-amber-500/35 disabled:opacity-50"
              disabled={!walletConnected || busy || !session.sessionAccount}
              onClick={() => run("revoke session", revokeSession)}
            >
              Revoke Session
            </button>
          </div>

          <div className="grid w-[300px] grid-cols-3 gap-2">
            {match.board.map((v, idx) => (
              <button
                key={idx}
                className="h-24 rounded-xl border border-white/15 bg-white/5 text-3xl font-bold text-white hover:bg-white/10 disabled:opacity-60"
                disabled={busy || !walletConnected || match.status !== MATCH_ACTIVE}
                onClick={() => run(`move ${idx}`, async () => { await playSingle(idx); })}
              >
                {v === 1 ? "X" : v === 2 ? "O" : ""}
              </button>
            ))}
          </div>

          {sigs.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold text-zinc-300">Recent Signatures</h3>
              <div className="space-y-1 text-sm">
                {sigs.map((sig) => (
                  <div key={sig} className="font-mono text-zinc-300">
                    {explorerPrefix ? (
                      <a
                        className="text-cyan-300 hover:underline"
                        href={`${explorerPrefix}${sig}${explorerSuffix}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortSig(sig)}
                      </a>
                    ) : (
                      shortSig(sig)
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
