"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  type Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type ConfirmOptions,
} from "@solana/web3.js";
import {
  FiveProgram,
  FiveSDK,
  SessionClient,
  scopeHashForFunctions,
  type CreateSessionParams,
} from "@5ive-tech/sdk";
import { Navbar } from "@/components/layout/Navbar";
import { useNetworkConfig, type NetworkName } from "@/components/providers/WalletContextProvider";

type GameAccounts = {
  config: string;
  match_state: string | null;
  profile: string | null;
};

type SessionState = {
  delegate: Keypair | null;
  sessionAccount: PublicKey | null;
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
type SessionConfig = Parameters<FiveProgram["withSession"]>[0];
type SessionPlan = {
  schema: "legacy" | "minimal";
  sessionAddress: string;
  createSessionIx: TransactionInstruction;
  createSessionAccountIx: TransactionInstruction | null;
  topupDelegateIx: TransactionInstruction | null;
};
type SessionClientWithPlanBuilder = SessionClient & {
  buildCreateSessionPlan: (
    params: CreateSessionParams,
    options: {
      connection: Connection;
      payer: PublicKey;
      delegateMinLamports: number;
      delegateTopupLamports: number;
      rpcLabel?: string;
    }
  ) => Promise<SessionPlan>;
};

const MATCH_WAITING = 0;
const MATCH_ACTIVE = 1;
const MATCH_P1_WIN = 2;
const MATCH_P2_WIN = 3;
const MATCH_DRAW = 4;
const MATCH_CANCELLED = 5;

const TURN_P1 = 1;
const TURN_P2 = 2;
const ACCOUNT_SPACE_CONFIG = 128;
const ACCOUNT_SPACE_MATCH = 256;
const ACCOUNT_SPACE_PROFILE = 128;

const SESSION_TTL_SLOTS = Number(process.env.NEXT_PUBLIC_SESSION_TTL_SLOTS || "3000");
const SESSION_DELEGATE_MIN_FEE_LAMPORTS = 500_000;
const SESSION_DELEGATE_TOPUP_LAMPORTS = 2_000_000;

const DEFAULT_VM_PROGRAM_ID =
  process.env.NEXT_PUBLIC_FIVE_VM_PROGRAM_ID || "5ive5uKDkc3Yhyfu1Sk7i3eVPDQUmG2GmTm2FnUZiTJd";
const DEVNET_SCRIPT_ACCOUNT =
  process.env.NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT_DEVNET ||
  process.env.NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT ||
  "";
const MAINNET_SCRIPT_ACCOUNT =
  process.env.NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT_MAINNET ||
  process.env.NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT ||
  "";
const ACCOUNTS_STORAGE_PREFIX = "five-tictactoe-accounts";
const SESSION_STORAGE_PREFIX = "five-tictactoe-session";

const DEFAULT_SESSION_SCOPE_HASH = scopeHashForFunctions(["start_single_player", "play_ttt_single"]);
const SESSION_SCOPE_HASH = process.env.NEXT_PUBLIC_SESSION_SCOPE_HASH || DEFAULT_SESSION_SCOPE_HASH;

const CONFIRM_OPTS: ConfirmOptions = {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
  skipPreflight: false,
};

function parseEnvAccounts(network: NetworkName): GameAccounts | null {
  const config =
    (network === "mainnet"
      ? process.env.NEXT_PUBLIC_TTT_CONFIG_ACCOUNT_MAINNET
      : process.env.NEXT_PUBLIC_TTT_CONFIG_ACCOUNT_DEVNET) ||
    process.env.NEXT_PUBLIC_TTT_CONFIG_ACCOUNT ||
    "";
  const match_state = process.env.NEXT_PUBLIC_TTT_MATCH_ACCOUNT || null;
  const profile = process.env.NEXT_PUBLIC_TTT_PROFILE_ACCOUNT || null;
  if (!config) return null;
  return { config, match_state, profile };
}

function emptySessionState(): SessionState {
  return {
    delegate: null,
    sessionAccount: null,
    status: "unknown",
    nonce: 0,
    expiresAtSlot: null,
    managerScriptAccount: "",
  };
}

function initialMatchState(): MatchView {
  return {
    status: MATCH_WAITING,
    currentTurn: TURN_P1,
    winner: 0,
    moveCount: 0,
    board: new Array(9).fill(0),
  };
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
    if (board[a] !== 0 && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  return 0;
}

function statusLabel(status: number): string {
  if (status === MATCH_WAITING) return "waiting";
  if (status === MATCH_ACTIVE) return "active";
  if (status === MATCH_P1_WIN) return "you win";
  if (status === MATCH_P2_WIN) return "cpu wins";
  if (status === MATCH_DRAW) return "draw";
  if (status === MATCH_CANCELLED) return "cancelled";
  return `status:${status}`;
}

function shortSig(sig: string): string {
  return sig.length > 14 ? `${sig.slice(0, 6)}...${sig.slice(-6)}` : sig;
}

function shortKey(value: string | null | undefined): string {
  if (!value) return "none";
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-6)}` : value;
}

function isUserRejectedWalletAction(message: string): boolean {
  return /user rejected|rejected the request|declined|cancelled/i.test(message);
}

function accountsStorageKey(input: {
  network: NetworkName | "localnet";
  wallet: string;
  vmProgramId: string;
  scriptAccount: string;
}): string {
  return `${ACCOUNTS_STORAGE_PREFIX}:${input.network}:${input.wallet}:${input.vmProgramId}:${input.scriptAccount}`;
}

function sessionStorageKey(input: {
  network: NetworkName | "localnet";
  wallet: string;
  vmProgramId: string;
  scriptAccount: string;
}): string {
  return `${SESSION_STORAGE_PREFIX}:${input.network}:${input.wallet}:${input.vmProgramId}:${input.scriptAccount}`;
}

function readStoredAccounts(input: {
  network: NetworkName | "localnet";
  wallet: string | null;
  vmProgramId: string;
  scriptAccount: string;
}): GameAccounts | null {
  if (typeof window === "undefined") return null;
  if (input.network === "localnet" || !input.wallet || !input.scriptAccount) return null;
  const raw = window.localStorage.getItem(
    accountsStorageKey({
      network: input.network,
      wallet: input.wallet,
      vmProgramId: input.vmProgramId,
      scriptAccount: input.scriptAccount,
    })
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GameAccounts>;
    if (!parsed.config) return null;
    return {
      config: parsed.config,
      match_state: typeof parsed.match_state === "string" ? parsed.match_state : null,
      profile: typeof parsed.profile === "string" ? parsed.profile : null,
    };
  } catch {
    return null;
  }
}

function persistAccounts(input: {
  network: NetworkName | "localnet";
  wallet: string | null;
  vmProgramId: string;
  scriptAccount: string;
  accounts: GameAccounts;
}) {
  if (typeof window === "undefined") return;
  if (input.network === "localnet" || !input.wallet || !input.scriptAccount) return;
  window.localStorage.setItem(
    accountsStorageKey({
      network: input.network,
      wallet: input.wallet,
      vmProgramId: input.vmProgramId,
      scriptAccount: input.scriptAccount,
    }),
    JSON.stringify(input.accounts)
  );
}

function readStoredSession(input: {
  network: NetworkName | "localnet";
  wallet: string | null;
  vmProgramId: string;
  scriptAccount: string;
}): SessionState | null {
  if (typeof window === "undefined") return null;
  if (input.network === "localnet" || !input.wallet || !input.scriptAccount) return null;
  const raw = window.localStorage.getItem(
    sessionStorageKey({
      network: input.network,
      wallet: input.wallet,
      vmProgramId: input.vmProgramId,
      scriptAccount: input.scriptAccount,
    })
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      delegateSecretKey?: number[];
      sessionAccount?: string | null;
      status?: SessionState["status"];
      nonce?: number;
      expiresAtSlot?: number | null;
      managerScriptAccount?: string;
    };
    return {
      delegate:
        Array.isArray(parsed.delegateSecretKey) && parsed.delegateSecretKey.length > 0
          ? Keypair.fromSecretKey(Uint8Array.from(parsed.delegateSecretKey))
          : null,
      sessionAccount:
        typeof parsed.sessionAccount === "string" && parsed.sessionAccount.length > 0
          ? new PublicKey(parsed.sessionAccount)
          : null,
      status: parsed.status || "unknown",
      nonce: Number(parsed.nonce || 0),
      expiresAtSlot: parsed.expiresAtSlot ?? null,
      managerScriptAccount: parsed.managerScriptAccount || "",
    };
  } catch {
    return null;
  }
}

function persistSession(input: {
  network: NetworkName | "localnet";
  wallet: string | null;
  vmProgramId: string;
  scriptAccount: string;
  session: SessionState;
}) {
  if (typeof window === "undefined") return;
  if (input.network === "localnet" || !input.wallet || !input.scriptAccount) return;
  const key = sessionStorageKey({
    network: input.network,
    wallet: input.wallet,
    vmProgramId: input.vmProgramId,
    scriptAccount: input.scriptAccount,
  });
  const isEmpty =
    !input.session.delegate &&
    !input.session.sessionAccount &&
    input.session.status === "unknown" &&
    input.session.nonce === 0 &&
    !input.session.expiresAtSlot &&
    !input.session.managerScriptAccount;
  if (isEmpty) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(
    key,
    JSON.stringify({
      delegateSecretKey: input.session.delegate ? Array.from(input.session.delegate.secretKey) : null,
      sessionAccount: input.session.sessionAccount?.toBase58() || null,
      status: input.session.status,
      nonce: input.session.nonce,
      expiresAtSlot: input.session.expiresAtSlot,
      managerScriptAccount: input.session.managerScriptAccount,
    })
  );
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

export default function Home() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { network, endpoint } = useNetworkConfig();

  const [status, setStatus] = useState("ready");
  const [lastTxError, setLastTxError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<GameAccounts | null>(null);
  const [sigs, setSigs] = useState<string[]>([]);
  const [match, setMatch] = useState<MatchView>(initialMatchState());
  const [session, setSession] = useState<SessionState>(emptySessionState());
  const [playMode, setPlayMode] = useState<PlayMode>("direct");
  const previousNetworkRef = useRef(network);

  const vmProgramId = useMemo(() => DEFAULT_VM_PROGRAM_ID, []);
  const scriptAccount = useMemo(
    () => (network === "mainnet" ? MAINNET_SCRIPT_ACCOUNT : DEVNET_SCRIPT_ACCOUNT),
    [network]
  );
  const walletConnected = !!wallet.connected && !!wallet.publicKey;
  const walletBase58 = wallet.publicKey?.toBase58() || null;
  const solscanClusterSuffix = useMemo(() => (network === "devnet" ? "?cluster=devnet" : ""), [network]);

  useEffect(() => {
    const restoredAccounts = readStoredAccounts({
      network,
      wallet: walletBase58,
      vmProgramId,
      scriptAccount,
    });
    const restoredSession = readStoredSession({
      network,
      wallet: walletBase58,
      vmProgramId,
      scriptAccount,
    });
    setAccounts(restoredAccounts || parseEnvAccounts(network));
    setSession(restoredSession || emptySessionState());
  }, [network, walletBase58, vmProgramId, scriptAccount]);

  useEffect(() => {
    if (previousNetworkRef.current === network) return;
    previousNetworkRef.current = network;
    setSigs([]);
    setMatch(initialMatchState());
    setPlayMode("direct");
    setBusy(false);
    setStatus(`switched to ${network}`);
    setLastTxError(null);
  }, [network]);

  useEffect(() => {
    persistSession({
      network,
      wallet: walletBase58,
      vmProgramId,
      scriptAccount,
      session,
    });
  }, [network, walletBase58, vmProgramId, scriptAccount, session]);

  const pushSig = (sig: string) => setSigs((prev) => [sig, ...prev].slice(0, 6));
  const errText = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const rec = err as Record<string, unknown>;
      if (typeof rec.message === "string") return rec.message;
      if (typeof rec.error === "string") return rec.error;
      try {
        return JSON.stringify(rec);
      } catch {
        return String(err);
      }
    }
    return String(err);
  };
  const debugErrText = (err: unknown): string => {
    const message = errText(err);
    if (!err || typeof err !== "object") return message;
    const rec = err as Record<string, unknown>;
    const logs = rec.logs || rec.transactionLogs;
    if (Array.isArray(logs) && logs.length > 0) return `${message}\n${logs.map((l) => String(l)).join("\n")}`;
    return message;
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

    try {
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
    } catch (err) {
      const message = errText(err);
      if (isUserRejectedWalletAction(message)) throw new Error("wallet request cancelled");
      throw new Error(`transaction submit failed: ${message}`);
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
    const configPubkey = accounts?.config || parseEnvAccounts(network)?.config || "";
    if (!configPubkey) {
      throw new Error("Missing shared config account. Set NEXT_PUBLIC_TTT_CONFIG_ACCOUNT_DEVNET/MAINNET.");
    }
    const existingConfig = await connection.getAccountInfo(new PublicKey(configPubkey), "confirmed");
    if (!existingConfig) {
      throw new Error("Configured TicTacToe config account does not exist on this cluster.");
    }

    const profile = Keypair.generate();
    const lamportsConfig = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SPACE_CONFIG);
    const lamportsProfile = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SPACE_PROFILE);
    void lamportsConfig;

    const profileInitIx = await buildInstruction(
      "init_profile",
      { profile: profile.publicKey.toBase58(), owner: wallet.publicKey.toBase58() },
      {},
      wallet.publicKey.toBase58()
    );

    const neededLamports = lamportsProfile;
    const balance = await connection.getBalance(wallet.publicKey, "confirmed");
    if (balance < neededLamports) {
      throw new Error(
        `insufficient SOL for account creation: need ${(neededLamports / 1e9).toFixed(4)} SOL, have ${(balance / 1e9).toFixed(4)} SOL`
      );
    }

    const tx = new Transaction();
    const signers: Keypair[] = [];

    tx.add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: profile.publicKey,
        lamports: lamportsProfile,
        space: ACCOUNT_SPACE_PROFILE,
        programId: owner,
      })
    );
    tx.add(profileInitIx);
    signers.push(profile);
    await sendAndConfirm(tx, signers);
    const next = {
      config: configPubkey,
      match_state: null,
      profile: profile.publicKey.toBase58() as string | null,
    };
    setAccounts(next);
    persistAccounts({
      network,
      wallet: wallet.publicKey.toBase58(),
      vmProgramId,
      scriptAccount,
      accounts: next,
    });
    return next;
  }

  async function buildInstruction(
    functionName: string,
    accountMap: Record<string, string>,
    args: Record<string, unknown>,
    payerPubkey: string,
    sessionState?: SessionState
  ): Promise<TransactionInstruction> {
    if (!scriptAccount) {
      throw new Error("Set NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT_DEVNET/MAINNET in web/.env.local.");
    }
    let program = await loadProgram(scriptAccount, vmProgramId);
    const delegated = isDelegatedSessionActive(sessionState);
    if (delegated && functionName === "play_ttt_single") {
      program = program.withSession({
        mode: "auto",
        manager: { defaultTtlSlots: SESSION_TTL_SLOTS } as SessionConfig["manager"],
        sessionAccountByFunction: {
          [functionName]: sessionState!.sessionAccount!.toBase58(),
        },
        delegateSignerByFunction: {
          [functionName]: sessionState!.delegate!,
        },
      });
    }
    let builder = program.function(functionName).payer(payerPubkey).accounts(accountMap);
    if (Object.keys(args).length > 0) builder = builder.args(args);
    const encoded = await builder.instruction();
    return new TransactionInstruction({
      programId: new PublicKey(encoded.programId),
      keys: encoded.keys.map((k: { pubkey: string; isSigner: boolean; isWritable: boolean }) => ({
        pubkey: new PublicKey(k.pubkey),
        isSigner: !!k.isSigner,
        isWritable: !!k.isWritable,
      })),
      data: Buffer.from(encoded.data, "base64"),
    });
  }

  async function initializeGame() {
    if (!wallet.publicKey) throw new Error("Connect wallet first.");
    await provisionAccounts();
  }

  async function createSingleMatch() {
    if (!wallet.publicKey) throw new Error("Connect wallet first.");
    const resolved = accounts || (await provisionAccounts());
    const owner = new PublicKey(vmProgramId);
    const matchState = Keypair.generate();
    const lamportsMatch = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SPACE_MATCH);
    const balance = await connection.getBalance(wallet.publicKey, "confirmed");
    if (balance < lamportsMatch) {
      throw new Error(
        `insufficient SOL for match account: need ${(lamportsMatch / 1e9).toFixed(4)} SOL, have ${(balance / 1e9).toFixed(4)} SOL`
      );
    }

    const createIx = await buildInstruction(
      "create_open_match",
      {
        config: resolved.config,
        match_state: matchState.publicKey.toBase58(),
        player1: wallet.publicKey.toBase58(),
      },
      {},
      wallet.publicKey.toBase58()
    );
    const startIx = await buildInstruction(
      "start_single_player",
      {
        match_state: matchState.publicKey.toBase58(),
        caller: wallet.publicKey.toBase58(),
        __session: vmProgramId,
      },
      {},
      wallet.publicKey.toBase58()
    );
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: matchState.publicKey,
        lamports: lamportsMatch,
        space: ACCOUNT_SPACE_MATCH,
        programId: owner,
      }),
      createIx,
      startIx
    );
    await sendAndConfirm(tx, [matchState]);
    const updated = { ...resolved, match_state: matchState.publicKey.toBase58() };
    setAccounts(updated);
    persistAccounts({
      network,
      wallet: wallet.publicKey.toBase58(),
      vmProgramId,
      scriptAccount,
      accounts: updated,
    });
    setMatch(initialMatchState());
    setMatch((prev) => ({ ...prev, status: MATCH_ACTIVE }));
  }

  async function createSession() {
    if (!wallet.publicKey) throw new Error("Connect wallet first.");
    if (!accounts) throw new Error("Initialize accounts first.");
    if (!accounts.match_state) throw new Error("Start a match before creating a session.");

    const delegate = session.delegate || Keypair.generate();
    const managerScriptAccount = resolveSessionManagerScriptAccount();
    const sessionClient = new SessionClient({ vmProgramId, managerScriptAccount });
    const slot = await connection.getSlot("confirmed");
    const expiresAtSlot = slot + Math.max(1, SESSION_TTL_SLOTS);

    const delegateBalance = await connection.getBalance(delegate.publicKey, "confirmed");
    const topupIx =
      delegateBalance >= SESSION_DELEGATE_MIN_FEE_LAMPORTS
        ? null
        : SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: delegate.publicKey,
            lamports: SESSION_DELEGATE_TOPUP_LAMPORTS,
          });
    const legacySessionSigner = Keypair.generate();
    const sessionParams: CreateSessionParams & { sessionAccount?: string; rpcLabel?: string } = {
      authority: wallet.publicKey.toBase58(),
      delegate: delegate.publicKey.toBase58(),
      targetProgram: scriptAccount,
      sessionAccount: legacySessionSigner.publicKey.toBase58(),
      expiresAtSlot,
      scopeHash: SESSION_SCOPE_HASH,
      bindAccount: accounts.match_state,
      nonce: session.nonce,
      payer: wallet.publicKey.toBase58(),
      rpcLabel: endpoint,
    };

    const maybePlan = sessionClient as unknown as SessionClientWithPlanBuilder;
    if (typeof maybePlan.buildCreateSessionPlan === "function") {
      const plan = await maybePlan.buildCreateSessionPlan(sessionParams, {
        connection,
        payer: wallet.publicKey,
        delegateMinLamports: SESSION_DELEGATE_MIN_FEE_LAMPORTS,
        delegateTopupLamports: SESSION_DELEGATE_TOPUP_LAMPORTS,
        rpcLabel: endpoint,
      });
      const tx = new Transaction();
      if (plan.createSessionAccountIx) tx.add(plan.createSessionAccountIx);
      if (plan.topupDelegateIx) tx.add(plan.topupDelegateIx);
      tx.add(plan.createSessionIx);
      await sendAndConfirm(tx, plan.createSessionAccountIx ? [legacySessionSigner] : []);
      setSession((prev) => ({
        ...prev,
        delegate,
        sessionAccount: new PublicKey(plan.sessionAddress),
        status: "active",
        nonce: prev.nonce + 1,
        expiresAtSlot,
        managerScriptAccount,
      }));
      return;
    }

    const compatResult = await sessionClient.createSessionWithCompat(sessionParams, async (sessionIx, schema) => {
      const tx = new Transaction();
      let extraSigners: Keypair[] = [];
      if (schema === "legacy") {
        const prepared = await sessionClient.prepareSessionAccountTx({
          connection,
          payer: wallet.publicKey,
          sessionAccount: legacySessionSigner.publicKey,
          delegate: delegate.publicKey,
          delegateMinLamports: SESSION_DELEGATE_MIN_FEE_LAMPORTS,
          delegateTopupLamports: SESSION_DELEGATE_TOPUP_LAMPORTS,
        });
        if (prepared.createIx) {
          tx.add(prepared.createIx);
          extraSigners = [legacySessionSigner];
        }
        if (prepared.topupIx) tx.add(prepared.topupIx);
      } else if (topupIx) {
        tx.add(topupIx);
      }
      tx.add(sessionIx);
      return sendAndConfirm(tx, extraSigners);
    });
    const sessionAddress =
      compatResult.schema === "legacy"
        ? legacySessionSigner.publicKey.toBase58()
        : await sessionClient.deriveSessionAddress(
            wallet.publicKey.toBase58(),
            delegate.publicKey.toBase58(),
            scriptAccount
          );
    setSession((prev) => ({
      ...prev,
      delegate,
      sessionAccount: new PublicKey(sessionAddress),
      status: "active",
      nonce: prev.nonce + 1,
      expiresAtSlot,
      managerScriptAccount,
    }));
  }

  async function revokeSession() {
    if (!wallet.publicKey || !session.delegate || !session.sessionAccount) throw new Error("No session to revoke.");
    const managerScriptAccount = session.managerScriptAccount || resolveSessionManagerScriptAccount();
    const revokeAbi = {
      name: "SessionManager",
      functions: [
        {
          name: "revoke_session",
          index: 1,
          parameters: [
            { name: "session", type: "Account", is_account: true, attributes: ["mut"] },
            { name: "authority", type: "Account", is_account: true, attributes: ["signer"] },
          ],
          return_type: null,
          visibility: "public",
          is_public: true,
          bytecode_offset: 0,
        },
      ],
    };
    const authority = wallet.publicKey.toBase58();
    const program = FiveProgram.fromABI(
      managerScriptAccount,
      revokeAbi as Parameters<typeof FiveProgram.fromABI>[1],
      { fiveVMProgramId: vmProgramId }
    );
    const encoded = await program
      .function("revoke_session")
      .accounts({ session: session.sessionAccount.toBase58(), authority })
      .payer(authority)
      .instruction();
    const revokeIx = new TransactionInstruction({
      programId: new PublicKey(encoded.programId),
      keys: encoded.keys.map((k: { pubkey: string; isSigner: boolean; isWritable: boolean }) => ({
        pubkey: new PublicKey(k.pubkey),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(encoded.data, "base64"),
    });
    await sendAndConfirm(new Transaction().add(revokeIx));
    setSession((prev) => ({ ...prev, status: "revoked", delegate: null, sessionAccount: null, expiresAtSlot: null }));
  }

  async function playSingle(cell: number) {
    if (!wallet.publicKey) throw new Error("Connect wallet first.");
    if (!accounts) throw new Error("Initialize accounts first.");
    if (!accounts.match_state) throw new Error("Start a match first.");
    if (match.status !== MATCH_ACTIVE) throw new Error("Match is not active.");
    if (match.currentTurn !== TURN_P1) throw new Error("Not your turn.");
    if (match.board[cell] !== 0) throw new Error("Cell already occupied.");

    const delegated = playMode === "session" && isDelegatedSessionActive(session);
    if (playMode === "session" && !delegated) {
      throw new Error("Session mode selected, but no active session. Click Create Session first.");
    }
    const caller = delegated && session.delegate ? session.delegate.publicKey.toBase58() : wallet.publicKey.toBase58();
    const sessionShadow = delegated && session.sessionAccount ? session.sessionAccount.toBase58() : vmProgramId;
    const ix = await buildInstruction(
      "play_ttt_single",
      {
        match_state: accounts.match_state,
        caller,
        __session: sessionShadow,
      },
      { cell_index: cell },
      caller,
      delegated ? session : undefined
    );
    const signers = delegated && session.delegate ? [session.delegate] : [];
    const requireWalletSignature = !delegated;
    await sendAndConfirm(new Transaction().add(ix), signers, {
      feePayer: delegated && session.delegate ? session.delegate.publicKey : wallet.publicKey,
      requireWalletSignature,
    });

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
      const open = nextBoard.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
      const cpuCell = open[Math.floor(Math.random() * open.length)] ?? -1;
      if (cpuCell >= 0) {
        nextBoard[cpuCell] = 2;
        nextMoveCount += 1;
      }
      winner = detectWinner(nextBoard);
      if (winner === 2) nextStatus = MATCH_P2_WIN;
      else if (nextMoveCount >= 9) nextStatus = MATCH_DRAW;
      nextTurn = TURN_P1;
    }

    setMatch({
      status: nextStatus,
      currentTurn: nextTurn,
      winner,
      moveCount: nextMoveCount,
      board: nextBoard,
    });
  }

  async function runAction(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setStatus(`${label}...`);
    try {
      await fn();
      setStatus(`${label} complete`);
    } catch (err) {
      const message = errText(err);
      setLastTxError(`[${label}] ${debugErrText(err)}`);
      if (isUserRejectedWalletAction(message)) {
        setStatus(`${label} cancelled in wallet`);
      } else {
        setStatus(`${label} failed: ${message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const modeBlocked = playMode === "session" && !isDelegatedSessionActive(session);
  const canMove = walletConnected && !busy && match.status === MATCH_ACTIVE && !modeBlocked;
  const resultBanner =
    match.status === MATCH_P1_WIN
      ? "You win."
      : match.status === MATCH_P2_WIN
      ? "CPU wins."
      : match.status === MATCH_DRAW
      ? "Draw."
      : match.status === MATCH_ACTIVE
      ? "Your turn."
      : "Start a match.";

  return (
    <div className="h-[100dvh] relative overflow-hidden flex flex-col bg-cyan-950">
      <Navbar status={status} moveCount={match.moveCount} mode={playMode} />

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(34,211,238,0.15)_0%,_rgba(8,47,73,1)_100%)] pointer-events-none z-0" />
      <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/black-paper.png')] pointer-events-none mix-blend-overlay z-0" />

      <main className="flex-1 w-full max-w-7xl mx-auto px-3 md:px-6 pt-20 pb-3 relative z-10 min-h-0 overflow-hidden">
        <div className="grid h-full min-h-0 gap-3 grid-rows-[minmax(0,1fr)_auto] md:grid-rows-1 md:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="rounded-3xl border border-cyan-300/15 bg-black/35 backdrop-blur-xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.45)] flex flex-col items-center justify-center min-h-0">
            <h2 className="text-3xl font-black uppercase tracking-[0.2em] text-cyan-100">TicTacToe</h2>
            <p className="mt-2 text-xs uppercase tracking-widest text-cyan-200/75">{resultBanner}</p>
            <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3 w-[280px] sm:w-[340px]">
              {match.board.map((v, idx) => (
                <button
                  key={idx}
                  className="aspect-square rounded-xl border border-cyan-300/20 bg-cyan-500/10 text-4xl font-black text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-40"
                  disabled={!canMove || v !== 0}
                  onClick={() => runAction(`move ${idx}`, async () => playSingle(idx))}
                >
                  {v === 1 ? "X" : v === 2 ? "O" : ""}
                </button>
              ))}
            </div>
          </section>

          <aside className="rounded-3xl border border-white/10 bg-black/40 backdrop-blur-xl p-3 md:p-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col gap-2 md:gap-3 min-h-0 max-h-none md:max-h-[calc(100dvh-6.5rem)] overflow-hidden md:overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              <button
                className="rounded-xl border border-cyan-300/30 bg-cyan-500/20 px-3 py-2 text-xs font-bold uppercase tracking-wider text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-40"
                disabled={!walletConnected || busy || !!accounts?.profile}
                onClick={() => runAction("initialize", initializeGame)}
              >
                {accounts?.profile ? "Profile Ready" : "Init Profile"}
              </button>
              <button
                className="rounded-xl border border-cyan-300/30 bg-cyan-500/20 px-3 py-2 text-xs font-bold uppercase tracking-wider text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-40"
                disabled={!walletConnected || busy}
                onClick={() => runAction("new single match", createSingleMatch)}
              >
                New Match
              </button>
            </div>

            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-2 text-xs font-mono text-cyan-100/80">
              <div className="mb-2 flex items-center justify-between">
                <div className="relative group/session-help flex items-center gap-1.5">
                  <div className="uppercase tracking-widest text-cyan-300/70">Session</div>
                  <button
                    type="button"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-cyan-300/35 text-[9px] font-bold text-cyan-200/90 hover:bg-cyan-400/15"
                  >
                    ?
                  </button>
                  <div className="pointer-events-none absolute left-0 top-6 z-20 hidden w-64 rounded-lg border border-cyan-300/30 bg-cyan-950/95 p-2 text-[10px] font-medium normal-case leading-relaxed tracking-normal text-cyan-100 shadow-xl group-hover/session-help:block group-focus-within/session-help:block">
                    Session mode lets you approve once, then a delegate can submit your moves until the session expires.
                  </div>
                </div>
                <span className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider bg-white/10 text-cyan-100/80">
                  {session.status}
                </span>
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button
                  className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                    playMode === "direct"
                      ? "border border-cyan-300/50 bg-cyan-500/25 text-cyan-100"
                      : "border border-white/15 bg-white/5 text-cyan-100 hover:bg-white/10"
                  }`}
                  disabled={busy}
                  onClick={() => setPlayMode("direct")}
                >
                  Direct
                </button>
                <button
                  className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                    playMode === "session"
                      ? "border border-cyan-300/50 bg-cyan-500/25 text-cyan-100"
                      : "border border-white/15 bg-white/5 text-cyan-100 hover:bg-white/10"
                  }`}
                  disabled={busy}
                  onClick={() => setPlayMode("session")}
                >
                  Session
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="rounded-lg border border-cyan-400/40 bg-cyan-500/20 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-40"
                  disabled={!walletConnected || busy || !accounts || !accounts.match_state}
                  onClick={() => runAction("create session", createSession)}
                >
                  Create Session
                </button>
                <button
                  className="rounded-lg border border-rose-400/40 bg-rose-500/20 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-100 hover:bg-rose-500/30 disabled:opacity-40"
                  disabled={!walletConnected || busy || !session.sessionAccount}
                  onClick={() => runAction("revoke session", revokeSession)}
                >
                  Revoke Session
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/25 p-2 text-[10px] font-mono text-cyan-500/80 space-y-1 break-words">
              <div>vm: {vmProgramId}</div>
              <div>script: {scriptAccount || "MISSING NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT_DEVNET/MAINNET"}</div>
              <div>network: {network}</div>
              <div>rpc: {endpoint}</div>
              <div>match: {statusLabel(match.status)} turn={match.currentTurn} moves={match.moveCount}</div>
              <div className="break-words whitespace-pre-wrap text-rose-300/90">last_error: {lastTxError || "none"}</div>
              <div>
                accounts:{" "}
                {accounts ? (
                  <>
                    <a
                      href={`https://solscan.io/account/${accounts.config}${solscanClusterSuffix}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-300 hover:underline"
                    >
                      c={shortKey(accounts.config)}
                    </a>{" "}
                    {accounts.match_state ? (
                      <a
                        href={`https://solscan.io/account/${accounts.match_state}${solscanClusterSuffix}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-300 hover:underline"
                      >
                        m={shortKey(accounts.match_state)}
                      </a>
                    ) : (
                      "m=none"
                    )}{" "}
                    <a
                      href={`https://solscan.io/account/${accounts.profile}${solscanClusterSuffix}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-300 hover:underline"
                    >
                      p={shortKey(accounts.profile)}
                    </a>
                  </>
                ) : (
                  "unset"
                )}
              </div>
              <div>
                txs:{" "}
                {sigs.length ? (
                  sigs.map((sig, idx) => (
                    <span key={sig}>
                      <a
                        href={`https://solscan.io/tx/${sig}${solscanClusterSuffix}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-300 hover:underline"
                      >
                        {shortSig(sig)}
                      </a>
                      {idx < sigs.length - 1 ? " | " : ""}
                    </span>
                  ))
                ) : (
                  "none"
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
