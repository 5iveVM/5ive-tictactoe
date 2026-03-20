"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  type Connection,
  Keypair,
  PublicKey,
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
import { resolveRuntimeConfig } from "@/lib/runtime-config";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Zap, 
  Shield, 
  Cpu, 
  RotateCcw, 
  X as XIcon, 
  Circle, 
  ExternalLink, 
  AlertTriangle,
  Settings2,
  Terminal as TerminalIcon,
  HelpCircle,
} from "lucide-react";

// --- Animated Pieces ---

function XMark() {
  return (
    <motion.svg
      viewBox="0 0 100 100"
      className="w-16 h-16 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 15 }}
    >
      <motion.path
        d="M 20 20 L 80 80"
        fill="transparent"
        stroke="#06b6d4"
        strokeWidth="10"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3 }}
      />
      <motion.path
        d="M 80 20 L 20 80"
        fill="transparent"
        stroke="#06b6d4"
        strokeWidth="10"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      />
    </motion.svg>
  );
}

function OMark() {
  return (
    <motion.svg
      viewBox="0 0 100 100"
      className="w-16 h-16 drop-shadow-[0_0_8px_rgba(236,72,153,0.8)]"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 15 }}
    >
      <motion.circle
        cx="50"
        cy="50"
        r="35"
        fill="transparent"
        stroke="#ec4899"
        strokeWidth="10"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5 }}
      />
    </motion.svg>
  );
}

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
  schema: "minimal";
  sessionAddress: string;
  createSessionIx: TransactionInstruction;
  createSessionAccountIx: TransactionInstruction | null;
  topupDelegateIx: TransactionInstruction | null;
};

type StoredMatchSnapshot = {
  matchStateAccount: string;
  status: number;
  currentTurn: number;
  winner: number;
  moveCount: number;
  board: number[];
};

type ResumePromptCandidate = {
  accounts: GameAccounts;
  snapshot: StoredMatchSnapshot | null;
};

type TrackedSessionRecord = {
  sessionAccount: string;
  managerScriptAccount: string;
  status: "active" | "unknown" | "expired";
  expiresAtSlot: number | null;
  createdAt: string;
  updatedAt: string;
};

const MATCH_WAITING = 0;
const MATCH_ACTIVE = 1;
const MATCH_P1_WIN = 2;
const MATCH_P2_WIN = 3;
const MATCH_DRAW = 4;
const MATCH_CANCELLED = 5;

const TURN_P1 = 1;
const TURN_P2 = 2;

const SESSION_TTL_SLOTS = Number(process.env.NEXT_PUBLIC_SESSION_TTL_SLOTS || "3000");
const SESSION_DELEGATE_MIN_FEE_LAMPORTS = 500_000;
const SESSION_DELEGATE_TOPUP_LAMPORTS = 2_000_000;
const DEFAULT_CONFIG_TURN_TIMEOUT_SECS = Number(process.env.NEXT_PUBLIC_TTT_TURN_TIMEOUT_SECS || "120");
const DEFAULT_CONFIG_ALLOW_OPEN_MATCHES = 1;
const DEFAULT_CONFIG_ALLOW_INVITES = 1;

const ACCOUNTS_STORAGE_PREFIX = "five-tictactoe-accounts";
const SESSION_STORAGE_PREFIX = "five-tictactoe-session";
const MATCH_STORAGE_PREFIX = "five-tictactoe-match";
const SESSION_TRACKER_STORAGE_PREFIX = "five-tictactoe-open-sessions";

const DEFAULT_SESSION_SCOPE_HASH = scopeHashForFunctions([
  "start_single_player",
  "play_ttt_single",
  "close_finished_match",
]);
const SESSION_SCOPE_HASH = process.env.NEXT_PUBLIC_SESSION_SCOPE_HASH || DEFAULT_SESSION_SCOPE_HASH;

const CONFIRM_OPTS: ConfirmOptions = {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
  skipPreflight: false,
};

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

function formatSolFromLamports(lamports: number | null | undefined): string {
  if (lamports == null) return "n/a";
  return `${(lamports / 1_000_000_000).toFixed(6)} SOL`;
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

function matchStorageKey(input: {
  network: NetworkName | "localnet";
  wallet: string;
  vmProgramId: string;
  scriptAccount: string;
}): string {
  return `${MATCH_STORAGE_PREFIX}:${input.network}:${input.wallet}:${input.vmProgramId}:${input.scriptAccount}`;
}

function sessionTrackerStorageKey(input: {
  network: NetworkName | "localnet";
  wallet: string;
  vmProgramId: string;
  scriptAccount: string;
}): string {
  return `${SESSION_TRACKER_STORAGE_PREFIX}:${input.network}:${input.wallet}:${input.vmProgramId}:${input.scriptAccount}`;
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

function readStoredMatch(input: {
  network: NetworkName | "localnet";
  wallet: string | null;
  vmProgramId: string;
  scriptAccount: string;
}): StoredMatchSnapshot | null {
  if (typeof window === "undefined") return null;
  if (input.network === "localnet" || !input.wallet || !input.scriptAccount) return null;
  const raw = window.localStorage.getItem(
    matchStorageKey({
      network: input.network,
      wallet: input.wallet,
      vmProgramId: input.vmProgramId,
      scriptAccount: input.scriptAccount,
    })
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredMatchSnapshot>;
    if (!parsed.matchStateAccount || !Array.isArray(parsed.board) || parsed.board.length !== 9) return null;
    const board = parsed.board.map((v) => (v === 1 || v === 2 ? v : 0));
    return {
      matchStateAccount: new PublicKey(parsed.matchStateAccount).toBase58(),
      status: Number(parsed.status || MATCH_WAITING),
      currentTurn: Number(parsed.currentTurn || TURN_P1),
      winner: Number(parsed.winner || 0),
      moveCount: Number(parsed.moveCount || 0),
      board,
    };
  } catch {
    return null;
  }
}

function persistStoredMatch(input: {
  network: NetworkName | "localnet";
  wallet: string | null;
  vmProgramId: string;
  scriptAccount: string;
  snapshot: StoredMatchSnapshot | null;
}) {
  if (typeof window === "undefined") return;
  if (input.network === "localnet" || !input.wallet || !input.scriptAccount) return;
  const key = matchStorageKey({
    network: input.network,
    wallet: input.wallet,
    vmProgramId: input.vmProgramId,
    scriptAccount: input.scriptAccount,
  });
  if (!input.snapshot) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(input.snapshot));
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

function upsertTrackedSessionRecord(
  records: TrackedSessionRecord[],
  next: Omit<TrackedSessionRecord, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }
): TrackedSessionRecord[] {
  const nowIso = new Date().toISOString();
  const idx = records.findIndex((r) => r.sessionAccount === next.sessionAccount);
  if (idx === -1) {
    return [
      {
        ...next,
        createdAt: next.createdAt || nowIso,
        updatedAt: next.updatedAt || nowIso,
      },
      ...records,
    ];
  }
  const prev = records[idx];
  const merged: TrackedSessionRecord = {
    ...prev,
    ...next,
    createdAt: prev.createdAt || next.createdAt || nowIso,
    updatedAt: next.updatedAt || nowIso,
  };
  const out = [...records];
  out[idx] = merged;
  return out;
}

function readTrackedSessions(input: {
  network: NetworkName | "localnet";
  wallet: string | null;
  vmProgramId: string;
  scriptAccount: string;
}): TrackedSessionRecord[] {
  if (typeof window === "undefined") return [];
  if (input.network === "localnet" || !input.wallet || !input.scriptAccount) return [];
  const raw = window.localStorage.getItem(
    sessionTrackerStorageKey({
      network: input.network,
      wallet: input.wallet,
      vmProgramId: input.vmProgramId,
      scriptAccount: input.scriptAccount,
    })
  );
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Partial<TrackedSessionRecord>>;
    if (!Array.isArray(parsed)) return [];
    const out: TrackedSessionRecord[] = [];
    for (const row of parsed) {
      if (!row?.sessionAccount || !row?.managerScriptAccount) continue;
      try {
        out.push({
          sessionAccount: new PublicKey(row.sessionAccount).toBase58(),
          managerScriptAccount: new PublicKey(row.managerScriptAccount).toBase58(),
          status:
            row.status === "active" || row.status === "unknown" || row.status === "expired"
              ? row.status
              : "unknown",
          expiresAtSlot: typeof row.expiresAtSlot === "number" ? row.expiresAtSlot : null,
          createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
          updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
        });
      } catch {
        // Ignore malformed record.
      }
    }
    return out;
  } catch {
    return [];
  }
}

function persistTrackedSessions(input: {
  network: NetworkName | "localnet";
  wallet: string | null;
  vmProgramId: string;
  scriptAccount: string;
  sessions: TrackedSessionRecord[];
}) {
  if (typeof window === "undefined") return;
  if (input.network === "localnet" || !input.wallet || !input.scriptAccount) return;
  const key = sessionTrackerStorageKey({
    network: input.network,
    wallet: input.wallet,
    vmProgramId: input.vmProgramId,
    scriptAccount: input.scriptAccount,
  });
  if (input.sessions.length === 0) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(input.sessions));
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

function deriveCanonicalSessionAddress(input: {
  managerScriptAccount: string;
  vmProgramId: string;
  authority: string;
  delegate: string;
  targetProgram: string;
}): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(input.managerScriptAccount).toBytes(),
      Buffer.from("session"),
      new PublicKey(input.authority).toBytes(),
      new PublicKey(input.delegate).toBytes(),
      new PublicKey(input.targetProgram).toBytes(),
    ],
    new PublicKey(input.vmProgramId)
  );
  return pda.toBase58();
}

function assertCanonicalSessionState(input: {
  session: SessionState;
  authority: string;
  vmProgramId: string;
  targetProgram: string;
  managerScriptAccount: string;
}) {
  if (!input.session.delegate || !input.session.sessionAccount) return;
  const canonicalSession = deriveCanonicalSessionAddress({
    managerScriptAccount: input.managerScriptAccount,
    vmProgramId: input.vmProgramId,
    authority: input.authority,
    delegate: input.session.delegate.publicKey.toBase58(),
    targetProgram: input.targetProgram,
  });
  if (input.session.sessionAccount.toBase58() !== canonicalSession) {
    throw new Error("stored session rejected: non-canonical session PDA");
  }
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
  const [trackedSessions, setTrackedSessions] = useState<TrackedSessionRecord[]>([]);
  const [sessionLamportsByAccount, setSessionLamportsByAccount] = useState<Record<string, number | null>>({});
  const [playMode, setPlayMode] = useState<PlayMode>("direct");
  const [resumeCandidate, setResumeCandidate] = useState<ResumePromptCandidate | null>(null);
  const [resumePromptSuppressed, setResumePromptSuppressed] = useState(false);
  const previousNetworkRef = useRef(network);

  const runtimeConfig = useMemo(() => resolveRuntimeConfig(network), [network]);
  const vmProgramId = runtimeConfig.fiveProgramId;
  const scriptAccount = runtimeConfig.tictactoeScriptAccount;
  const canonicalConfigAccount = runtimeConfig.tictactoeConfigAccount;
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
    const restoredTrackedSessions = readTrackedSessions({
      network,
      wallet: walletBase58,
      vmProgramId,
      scriptAccount,
    });
    setAccounts(restoredAccounts || { config: canonicalConfigAccount, match_state: null, profile: null });
    setMatch(initialMatchState());
    const nextSession = restoredSession || emptySessionState();
    if (
      restoredSession &&
      restoredSession.delegate &&
      restoredSession.sessionAccount &&
      walletBase58 &&
      scriptAccount
    ) {
      const managerScriptAccount = resolveSessionManagerScriptAccount();
      const canonicalSession = deriveCanonicalSessionAddress({
        managerScriptAccount,
        vmProgramId,
        authority: walletBase58,
        delegate: restoredSession.delegate.publicKey.toBase58(),
        targetProgram: scriptAccount,
      });
      if (restoredSession.sessionAccount.toBase58() !== canonicalSession) {
        setSession(emptySessionState());
        setStatus("stored session rejected: non-canonical session PDA");
        return;
      }
    }
    setSession(nextSession);
    setTrackedSessions(restoredTrackedSessions);
    setResumeCandidate(null);
    setResumePromptSuppressed(false);
  }, [network, walletBase58, vmProgramId, scriptAccount, canonicalConfigAccount]);

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

  useEffect(() => {
    persistTrackedSessions({
      network,
      wallet: walletBase58,
      vmProgramId,
      scriptAccount,
      sessions: trackedSessions,
    });
  }, [network, walletBase58, vmProgramId, scriptAccount, trackedSessions]);

  useEffect(() => {
    if (!accounts?.match_state) {
      persistStoredMatch({
        network,
        wallet: walletBase58,
        vmProgramId,
        scriptAccount,
        snapshot: null,
      });
      return;
    }
    const isBlankSnapshot =
      match.status === MATCH_WAITING &&
      match.currentTurn === TURN_P1 &&
      match.winner === 0 &&
      match.moveCount === 0 &&
      match.board.every((cell) => cell === 0);
    if (isBlankSnapshot) return;
    persistStoredMatch({
      network,
      wallet: walletBase58,
      vmProgramId,
      scriptAccount,
      snapshot: {
        matchStateAccount: accounts.match_state,
        status: match.status,
        currentTurn: match.currentTurn,
        winner: match.winner,
        moveCount: match.moveCount,
        board: match.board,
      },
    });
  }, [
    accounts?.match_state,
    match.board,
    match.currentTurn,
    match.moveCount,
    match.status,
    match.winner,
    network,
    scriptAccount,
    vmProgramId,
    walletBase58,
  ]);

  useEffect(() => {
    if (!session.sessionAccount) return;
    const manager = session.managerScriptAccount || resolveSessionManagerScriptAccount();
    const account = session.sessionAccount.toBase58();
    if (session.status === "revoked") {
      setTrackedSessions((prev) => prev.filter((row) => row.sessionAccount !== account));
      return;
    }
    const trackedStatus: TrackedSessionRecord["status"] =
      session.status === "active" ? "active" : session.status === "expired" ? "expired" : "unknown";
    setTrackedSessions((prev) =>
      upsertTrackedSessionRecord(prev, {
        sessionAccount: account,
        managerScriptAccount: manager,
        status: trackedStatus,
        expiresAtSlot: session.expiresAtSlot,
      })
    );
  }, [session.expiresAtSlot, session.managerScriptAccount, session.sessionAccount, session.status]);

  useEffect(() => {
    let cancelled = false;
    async function refreshSessionBalances() {
      if (trackedSessions.length === 0) {
        if (!cancelled) setSessionLamportsByAccount({});
        return;
      }
      try {
        const keys = trackedSessions.map((s) => new PublicKey(s.sessionAccount));
        const infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
        if (cancelled) return;
        const next: Record<string, number | null> = {};
        for (let i = 0; i < trackedSessions.length; i += 1) {
          next[trackedSessions[i].sessionAccount] = infos[i]?.lamports ?? null;
        }
        setSessionLamportsByAccount(next);
      } catch {
        if (!cancelled) setSessionLamportsByAccount({});
      }
    }
    void refreshSessionBalances();
    return () => {
      cancelled = true;
    };
  }, [connection, trackedSessions]);

  useEffect(() => {
    let cancelled = false;

    async function probeResumableMatch() {
      if (network === "localnet") {
        if (!cancelled) setResumeCandidate(null);
        return;
      }
      if (resumePromptSuppressed || !walletBase58 || !scriptAccount) {
        if (!cancelled) setResumeCandidate(null);
        return;
      }
      const storedAccounts = readStoredAccounts({
        network,
        wallet: walletBase58,
        vmProgramId,
        scriptAccount,
      });
      if (!storedAccounts?.match_state) {
        if (!cancelled) setResumeCandidate(null);
        return;
      }
      try {
        const onchainMatch = await connection.getAccountInfo(new PublicKey(storedAccounts.match_state), "confirmed");
        if (!onchainMatch) {
          const cleared = { ...storedAccounts, match_state: null };
          persistAccounts({
            network,
            wallet: walletBase58,
            vmProgramId,
            scriptAccount,
            accounts: cleared,
          });
          persistStoredMatch({
            network,
            wallet: walletBase58,
            vmProgramId,
            scriptAccount,
            snapshot: null,
          });
          if (!cancelled) {
            setAccounts((prev) =>
              prev?.match_state === storedAccounts.match_state ? { ...prev, match_state: null } : prev
            );
            setResumeCandidate(null);
          }
          return;
        }
        const storedSnapshot = readStoredMatch({
          network,
          wallet: walletBase58,
          vmProgramId,
          scriptAccount,
        });
        const snapshot =
          storedSnapshot && storedSnapshot.matchStateAccount === storedAccounts.match_state ? storedSnapshot : null;
        if (!cancelled) {
          setResumeCandidate({
            accounts: storedAccounts,
            snapshot,
          });
        }
      } catch {
        if (!cancelled) setResumeCandidate(null);
      }
    }

    void probeResumableMatch();
    return () => {
      cancelled = true;
    };
  }, [connection, network, resumePromptSuppressed, scriptAccount, vmProgramId, walletBase58]);

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
  const annotateVmError = (message: string): string => {
    if (message.includes("0x232b")) return `${message} (0x232b = ConstraintViolation / 9003)`;
    if (message.includes("0x232e")) return `${message} (0x232e = InvalidAccountData / 9006)`;
    return message;
  };

  function resolveSessionManagerScriptAccount(): string {
    const explicit = process.env.NEXT_PUBLIC_SESSION_MANAGER_SCRIPT_ACCOUNT || "";
    if (explicit) return explicit;
    return SessionClient.canonicalManagerScriptAccount(vmProgramId);
  }

  function rememberOpenSession(
    sessionAccount: string,
    managerScriptAccount: string,
    status: TrackedSessionRecord["status"],
    expiresAtSlot: number | null
  ) {
    setTrackedSessions((prev) =>
      upsertTrackedSessionRecord(prev, {
        sessionAccount,
        managerScriptAccount,
        status,
        expiresAtSlot,
      })
    );
  }

  function forgetOpenSession(sessionAccount: string) {
    setTrackedSessions((prev) => prev.filter((row) => row.sessionAccount !== sessionAccount));
  }

  function resumeStoredMatch() {
    if (!resumeCandidate) return;
    const restored = resumeCandidate.snapshot
      ? {
          status: resumeCandidate.snapshot.status,
          currentTurn: resumeCandidate.snapshot.currentTurn,
          winner: resumeCandidate.snapshot.winner,
          moveCount: resumeCandidate.snapshot.moveCount,
          board: resumeCandidate.snapshot.board,
        }
      : {
          ...initialMatchState(),
          status: MATCH_ACTIVE,
        };
    setAccounts(resumeCandidate.accounts);
    setMatch(restored);
    setResumeCandidate(null);
    setResumePromptSuppressed(true);
    setStatus("resumed saved match");
  }

  function startFreshMatch() {
    const nextAccounts =
      resumeCandidate?.accounts || accounts || { config: canonicalConfigAccount, match_state: null, profile: null };
    const cleared = { ...nextAccounts, match_state: null };
    setAccounts(cleared);
    setMatch(initialMatchState());
    persistAccounts({
      network,
      wallet: walletBase58,
      vmProgramId,
      scriptAccount,
      accounts: cleared,
    });
    persistStoredMatch({
      network,
      wallet: walletBase58,
      vmProgramId,
      scriptAccount,
      snapshot: null,
    });
    setResumeCandidate(null);
    setResumePromptSuppressed(true);
    setStatus("cleared saved match reference");
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
      throw new Error(`transaction submit failed: ${annotateVmError(message)}`);
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
    const configuredConfig = accounts?.config || canonicalConfigAccount || "";
    if (!configuredConfig) {
      throw new Error("Missing shared config account in deployment-config.<network>.json.");
    }
    let configPubkey = configuredConfig;
    let existingConfig = null;
    try {
      existingConfig = await connection.getAccountInfo(new PublicKey(configuredConfig), "confirmed");
    } catch {
      existingConfig = null;
    }
    if (!existingConfig) {
      const config = Keypair.generate();
      const initConfigIx = await buildInstruction(
        "init_config",
        {
          config: config.publicKey.toBase58(),
          authority: wallet.publicKey.toBase58(),
        },
        {
          turn_timeout_secs: Math.max(1, DEFAULT_CONFIG_TURN_TIMEOUT_SECS),
          allow_open_matches: DEFAULT_CONFIG_ALLOW_OPEN_MATCHES,
          allow_invites: DEFAULT_CONFIG_ALLOW_INVITES,
        },
        wallet.publicKey.toBase58(),
        undefined,
        [config.publicKey.toBase58()]
      );
      await sendAndConfirm(new Transaction().add(initConfigIx), [config]);
      configPubkey = config.publicKey.toBase58();
    }

    const profile = Keypair.generate();

    const profileInitIx = await buildInstruction(
      "init_profile",
      { profile: profile.publicKey.toBase58(), owner: wallet.publicKey.toBase58() },
      {},
      wallet.publicKey.toBase58(),
      undefined,
      [profile.publicKey.toBase58()]
    );

    const tx = new Transaction().add(profileInitIx);
    await sendAndConfirm(tx, [profile]);
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
    sessionState?: SessionState,
    initSignerPubkeys: string[] = []
  ): Promise<TransactionInstruction> {
    if (!scriptAccount) {
      throw new Error("Missing TicTacToe script account in deployment-config.<network>.json.");
    }
    let program = await loadProgram(scriptAccount, vmProgramId);
    const delegated = isDelegatedSessionActive(sessionState);
    if (delegated && (functionName === "play_ttt_single" || functionName === "close_finished_match")) {
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
    const initSignerSet = new Set(initSignerPubkeys);
    return new TransactionInstruction({
      programId: new PublicKey(encoded.programId),
      keys: encoded.keys.map((k: { pubkey: string; isSigner: boolean; isWritable: boolean }) => ({
        pubkey: new PublicKey(k.pubkey),
        isSigner: !!k.isSigner || initSignerSet.has(k.pubkey),
        isWritable: !!k.isWritable || initSignerSet.has(k.pubkey),
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
    let resolved = accounts;
    if (!resolved) {
      resolved = await provisionAccounts();
    } else {
      try {
        const existingConfig = await connection.getAccountInfo(new PublicKey(resolved.config), "confirmed");
        if (!existingConfig) {
          resolved = await provisionAccounts();
        }
      } catch {
        resolved = await provisionAccounts();
      }
    }
    const matchState = Keypair.generate();

    const createIx = await buildInstruction(
      "create_open_match",
      {
        config: resolved.config,
        match_state: matchState.publicKey.toBase58(),
        player1: wallet.publicKey.toBase58(),
      },
      {},
      wallet.publicKey.toBase58(),
      undefined,
      [matchState.publicKey.toBase58()]
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
    const tx = new Transaction().add(createIx, startIx);
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
    setMatch({
      ...initialMatchState(),
      status: MATCH_ACTIVE,
    });
    setResumeCandidate(null);
    setResumePromptSuppressed(true);
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

    const sessionParams: CreateSessionParams & { rpcLabel?: string } = {
      authority: wallet.publicKey.toBase58(),
      delegate: delegate.publicKey.toBase58(),
      targetProgram: scriptAccount,
      expiresAtSlot,
      scopeHash: SESSION_SCOPE_HASH,
      bindAccount: accounts.match_state,
      nonce: session.nonce,
      payer: wallet.publicKey.toBase58(),
      rpcLabel: endpoint,
    };
    const plan = await (sessionClient as unknown as {
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
    }).buildCreateSessionPlan(sessionParams, {
      connection,
      payer: wallet.publicKey,
      delegateMinLamports: SESSION_DELEGATE_MIN_FEE_LAMPORTS,
      delegateTopupLamports: SESSION_DELEGATE_TOPUP_LAMPORTS,
      rpcLabel: endpoint,
    });
    const tx = new Transaction();
    if (plan.createSessionAccountIx) {
      throw new Error("legacy session account creation is not supported");
    }
    if (plan.topupDelegateIx) tx.add(plan.topupDelegateIx);
    tx.add(plan.createSessionIx);
    await sendAndConfirm(tx);
    const sessionAddress = await sessionClient.deriveSessionAddress(
      wallet.publicKey.toBase58(),
      delegate.publicKey.toBase58(),
      scriptAccount
    );
    if (sessionAddress !== plan.sessionAddress) {
      throw new Error("session derivation mismatch: non-canonical PDA");
    }
    rememberOpenSession(sessionAddress, managerScriptAccount, "active", expiresAtSlot);
    setSession((prev) => ({
      ...prev,
      delegate,
      sessionAccount: new PublicKey(sessionAddress),
      status: "active",
      nonce: prev.nonce + 1,
      expiresAtSlot,
      managerScriptAccount,
    }));
    setPlayMode("session");
  }

  async function revokeSessionAccount(sessionAccount: string, managerScriptAccount: string) {
    if (!wallet.publicKey) throw new Error("Connect wallet first.");
    const revokeAbi = {
      name: "SessionManager",
      functions: [
        {
          name: "revoke_session",
          index: 1,
          parameters: [
            { name: "session", type: "Account", is_account: true, attributes: ["mut"] },
            { name: "authority", type: "Account", is_account: true, attributes: ["signer", "mut"] },
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
      .accounts({ session: sessionAccount, authority })
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
  }

  async function revokeSession() {
    if (!wallet.publicKey || !session.sessionAccount) throw new Error("No session to revoke.");
    const sessionAccount = session.sessionAccount.toBase58();
    const managerScriptAccount = session.managerScriptAccount || resolveSessionManagerScriptAccount();
    await revokeSessionAccount(sessionAccount, managerScriptAccount);
    forgetOpenSession(sessionAccount);
    setSession((prev) => ({ ...prev, status: "revoked", delegate: null, sessionAccount: null, expiresAtSlot: null }));
  }

  async function closeTrackedSession(record: TrackedSessionRecord) {
    await revokeSessionAccount(record.sessionAccount, record.managerScriptAccount);
    forgetOpenSession(record.sessionAccount);
    if (session.sessionAccount?.toBase58() === record.sessionAccount) {
      setSession((prev) => ({
        ...prev,
        status: "revoked",
        delegate: null,
        sessionAccount: null,
        expiresAtSlot: null,
      }));
    }
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
    if (delegated) {
      assertCanonicalSessionState({
        session,
        authority: wallet.publicKey.toBase58(),
        vmProgramId,
        targetProgram: scriptAccount,
        managerScriptAccount: resolveSessionManagerScriptAccount(),
      });
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

    if (nextStatus !== MATCH_ACTIVE) {
      const closeDelegated = delegated && !!session.delegate && !!session.sessionAccount;
      const closeCaller = closeDelegated ? session.delegate!.publicKey.toBase58() : wallet.publicKey.toBase58();
      const closeSessionShadow =
        closeDelegated && session.sessionAccount ? session.sessionAccount.toBase58() : vmProgramId;
      const closeIx = await buildInstruction(
        "close_finished_match",
        {
          match_state: accounts.match_state,
          caller: closeCaller,
          owner_refund: wallet.publicKey.toBase58(),
          __session: closeSessionShadow,
        },
        {},
        closeCaller,
        closeDelegated ? session : undefined
      );
      await sendAndConfirm(new Transaction().add(closeIx), closeDelegated ? [session.delegate!] : [], {
        feePayer: closeDelegated ? session.delegate!.publicKey : wallet.publicKey,
        requireWalletSignature: !closeDelegated,
      });
      const clearedAccounts = { ...accounts, match_state: null };
      setAccounts(clearedAccounts);
      persistAccounts({
        network,
        wallet: wallet.publicKey.toBase58(),
        vmProgramId,
        scriptAccount,
        accounts: clearedAccounts,
      });
      persistStoredMatch({
        network,
        wallet: wallet.publicKey.toBase58(),
        vmProgramId,
        scriptAccount,
        snapshot: null,
      });
      setResumeCandidate(null);
      setResumePromptSuppressed(true);
      setStatus("match ended: match account closed and rent reclaimed");
    }
  }

  async function runAction(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setStatus(`${label}...`);
    try {
      await fn();
      setStatus(`${label} complete`);
    } catch (err) {
      const message = annotateVmError(errText(err));
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
    <div className="h-[100dvh] relative overflow-hidden flex flex-col bg-[#0b0a15] text-[#e0def4]">
      {/* Visual background layers */}
      <div className="absolute inset-0 grid-bg pointer-events-none z-0" />
      <div className="scanline z-50 pointer-events-none" />
      
      <Navbar status={status} moveCount={match.moveCount} mode={playMode} />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 pt-24 pb-6 relative z-10 flex flex-col min-h-0 overflow-hidden">
        <div className="grid h-full gap-6 lg:grid-cols-[1fr_380px] min-h-0">
          
          {/* Main Game Stage */}
          <section className="flex flex-col items-center justify-center min-h-0">
            <motion.div
              layout
              className="game-card rounded-[2rem] p-8 flex flex-col items-center justify-center relative overflow-hidden group"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
            >
              {/* Decorative corners */}
              <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-primary/30 rounded-tl-[1.8rem] group-hover:border-primary/60 transition-colors" />
              <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-primary/30 rounded-br-[1.8rem] group-hover:border-primary/60 transition-colors" />

              <div className="mb-8 text-center">
                <motion.div 
                  key={resultBanner}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 text-sm font-mono uppercase tracking-[0.2em] text-primary"
                >
                  {resultBanner}
                </motion.div>
              </div>

              <div className="grid grid-cols-3 gap-3 md:gap-4 w-[300px] md:w-[400px]">
                {match.board.map((v, idx) => (
                  <button
                    key={idx}
                    className="game-cell aspect-square rounded-2xl disabled:cursor-not-allowed group/cell"
                    disabled={!canMove || v !== 0}
                    onClick={() => runAction(`move ${idx}`, async () => playSingle(idx))}
                  >
                    <AnimatePresence mode="wait">
                      {v === 1 ? (
                        <XMark key={`x-${idx}`} />
                      ) : v === 2 ? (
                        <OMark key={`o-${idx}`} />
                      ) : null}
                    </AnimatePresence>
                    
                    {!v && canMove && (
                      <div className="absolute inset-0 opacity-0 group-hover/cell:opacity-20 flex items-center justify-center transition-opacity">
                        <XIcon className="w-12 h-12 text-[#06b6d4]" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          </section>

          {/* Game Console (Sidebar) */}
          <aside className="flex flex-col gap-4 min-h-0 overflow-hidden">
            {resumeCandidate && !resumePromptSuppressed && (
              <div className="rounded-3xl border border-amber-400/30 bg-amber-500/10 backdrop-blur-xl p-4">
                <div className="text-[10px] uppercase tracking-[0.2em] font-black text-amber-200">Resume Available</div>
                <div className="mt-1 text-xs text-amber-100">
                  Found a saved match for this wallet on {network}.
                </div>
                <div className="mt-2 text-[10px] font-mono text-amber-100/80">
                  Match: {shortKey(resumeCandidate.accounts.match_state)} | Moves: {resumeCandidate.snapshot?.moveCount ?? 0}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    className="rounded-xl border border-emerald-400/40 bg-emerald-500/15 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                    disabled={busy}
                    onClick={resumeStoredMatch}
                  >
                    Resume
                  </button>
                  <button
                    className="rounded-xl border border-white/20 bg-white/5 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/80 hover:bg-white/10 disabled:opacity-40"
                    disabled={busy}
                    onClick={startFreshMatch}
                  >
                    Start Fresh
                  </button>
                </div>
              </div>
            )}
            
            {/* Control Panel */}
            <div className="game-card rounded-3xl p-6 flex flex-col gap-5">
              <div className="flex items-center gap-2 mb-1">
                <Settings2 className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-black uppercase tracking-widest text-[#908caa]">Game Console</h3>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  className="game-cell rounded-xl py-3 text-xs font-black uppercase tracking-wider text-white bg-primary/20 hover:bg-primary/30 disabled:opacity-30 flex flex-col items-center gap-2 group transition-all"
                  disabled={!walletConnected || busy || !!accounts?.profile}
                  onClick={() => runAction("initialize", initializeGame)}
                >
                  <Shield className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                  {accounts?.profile ? "Ready" : "Init Profile"}
                </button>
                <button
                  className="game-cell rounded-xl py-3 text-xs font-black uppercase tracking-wider text-white bg-[#06b6d4]/10 hover:bg-[#06b6d4]/20 border-[#06b6d4]/20 disabled:opacity-30 flex flex-col items-center gap-2 group transition-all"
                  disabled={!walletConnected || busy}
                  onClick={() => runAction("new single match", createSingleMatch)}
                >
                  <Zap className="w-4 h-4 text-[#06b6d4] group-hover:scale-110 transition-transform" />
                  New Match
                </button>
              </div>

              {/* Session Controls */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em] text-[#908caa]">
                  <span>On-Chain Session</span>
                  <span className={`px-2 py-0.5 rounded-full ${session.status === 'active' ? 'bg-[#10b981]/20 text-[#10b981]' : 'bg-white/5 text-[#908caa]'}`}>
                    {session.status}
                  </span>
                </div>
                
                <div className="flex gap-2">
                  {(['direct', 'session'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setPlayMode(mode)}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all ${
                        playMode === mode 
                        ? 'border-primary/50 bg-primary/10 text-primary' 
                        : 'border-white/5 bg-white/5 text-[#908caa] hover:bg-white/10'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-40"
                    disabled={!walletConnected || busy || !accounts || !accounts.match_state}
                    onClick={() => runAction("create session", createSession)}
                  >
                    Auth Session
                  </button>
                  <button
                    className="py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-40"
                    disabled={!walletConnected || busy || !session.sessionAccount}
                    onClick={() => runAction("revoke session", revokeSession)}
                  >
                    Revoke
                  </button>
                </div>

                <div className="pt-2 border-t border-white/5">
                  <div className="text-[9px] text-[#908caa] uppercase tracking-widest mb-1 font-bold">Open Sessions</div>
                  <div className="space-y-1.5">
                    {trackedSessions.length === 0 && (
                      <div className="text-[9px] opacity-40 italic">No open sessions tracked</div>
                    )}
                    {trackedSessions.map((tracked) => (
                      <div key={tracked.sessionAccount} className="rounded-lg border border-white/10 bg-white/5 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[9px] font-mono text-[#9ccfd8] truncate">{shortKey(tracked.sessionAccount)}</span>
                          <button
                            className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40"
                            disabled={busy}
                            onClick={() =>
                              runAction(`close session ${shortKey(tracked.sessionAccount)}`, async () => {
                                await closeTrackedSession(tracked);
                              })
                            }
                          >
                            Close
                          </button>
                        </div>
                        <div className="mt-1 text-[9px] font-mono text-[#908caa]">
                          {tracked.status}
                          {tracked.expiresAtSlot != null ? ` @${tracked.expiresAtSlot}` : ""}
                          {` | ${formatSolFromLamports(sessionLamportsByAccount[tracked.sessionAccount])}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* System Info & Logs */}
            <div className="game-card flex-1 rounded-3xl p-5 font-mono text-[10px] overflow-hidden flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <div className="flex items-center gap-2">
                  <TerminalIcon className="w-3 h-3 text-[#9ccfd8]" />
                  <span className="uppercase text-[#9ccfd8] font-bold">System Log</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                  <span className="text-[9px] text-[#10b981]">{network}</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 opacity-80 custom-scrollbar">
                <div className="flex justify-between items-start">
                  <span className="text-[#908caa]">VM_ID:</span>
                  <span className="text-right truncate ml-4">{shortKey(vmProgramId)}</span>
                </div>
                <div className="flex justify-between items-start">
                  <span className="text-[#908caa]">STATUS:</span>
                  <span className="text-right">{statusLabel(match.status)}</span>
                </div>
                {lastTxError && (
                  <div className="text-accent bg-accent/5 p-1.5 rounded-lg border border-accent/10 leading-relaxed">
                    <AlertTriangle className="w-3 h-3 inline mr-1 mb-0.5" />
                    ERROR: {lastTxError}
                  </div>
                )}
                
                <div className="pt-2 border-t border-white/5 space-y-1.5">
                  <div className="text-[9px] text-[#908caa] uppercase tracking-widest mb-1 font-bold">Accounts</div>
                  {accounts && (
                    <div className="grid grid-cols-1 gap-1">
                      <a href={`https://solscan.io/account/${accounts.config}${solscanClusterSuffix}`} target="_blank" className="flex justify-between hover:text-primary transition-colors">
                        <span>CONFIG</span>
                        <span>{shortKey(accounts.config)}</span>
                      </a>
                      {accounts.match_state && (
                        <a href={`https://solscan.io/account/${accounts.match_state}${solscanClusterSuffix}`} target="_blank" className="flex justify-between hover:text-primary transition-colors">
                          <span>MATCH</span>
                          <span>{shortKey(accounts.match_state)}</span>
                        </a>
                      )}
                      <a href={`https://solscan.io/account/${accounts.profile}${solscanClusterSuffix}`} target="_blank" className="flex justify-between hover:text-primary transition-colors">
                        <span>PROFILE</span>
                        <span>{shortKey(accounts.profile)}</span>
                      </a>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-white/5">
                <div className="text-[9px] text-[#908caa] uppercase tracking-widest mb-1 font-bold">Recent Signatures</div>
                  {sigs.length > 0 ? sigs.map((sig) => (
                    <a key={sig} href={`https://solscan.io/tx/${sig}${solscanClusterSuffix}`} target="_blank" className="block text-[#9ccfd8] hover:underline transition-all">
                       &gt; {shortSig(sig)}
                    </a>
                  )) : (
                    <span className="opacity-40 italic">Waiting for transactions...</span>
                  )}
                </div>
              </div>

              <div className="pt-3 flex gap-2 border-t border-white/5">
                <a href="https://5ive.tech" target="_blank" className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                  <HelpCircle className="w-3 h-3" />
                </a>
                <div className="flex-1 p-1 bg-[#191724] rounded-lg border border-white/5 flex items-center px-3">
                   <div className="w-1 h-1 bg-primary rounded-full mr-2" />
                   <span className="text-[8px] uppercase tracking-widest text-[#908caa]">Kernel Stable</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
