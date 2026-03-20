import { readFile } from "fs/promises";
import { resolve } from "path";
import { PublicKey } from "@solana/web3.js";

export type RuntimeNetwork = "localnet" | "devnet" | "mainnet";

export type RuntimeConfig = {
  network: RuntimeNetwork;
  rpcUrl: string;
  fiveProgramId: string;
  tictactoeScriptAccount: string;
  tictactoeConfigAccount: string;
};

type RuntimeOverrides = Partial<Pick<RuntimeConfig, "rpcUrl" | "fiveProgramId" | "tictactoeScriptAccount" | "tictactoeConfigAccount">>;

function normalizeNetwork(input: string): RuntimeNetwork {
  const raw = (input || "").toLowerCase();
  if (raw === "local" || raw === "localnet") return "localnet";
  if (raw === "devnet") return "devnet";
  if (raw === "mainnet" || raw === "mainnet-beta") return "mainnet";
  throw new Error(`unsupported network '${input}'`);
}

function assertPubkey(value: string, label: string): string {
  if (!value) throw new Error(`missing ${label}`);
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

function assertUrl(value: string, label: string): string {
  if (!value) throw new Error(`missing ${label}`);
  try {
    const parsed = new URL(value);
    if (!parsed.protocol.startsWith("http")) throw new Error("invalid protocol");
    return value;
  } catch {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

export async function resolveClientRuntimeConfig(
  projectRoot: string,
  networkInput: string,
  env: NodeJS.ProcessEnv = process.env,
  overrides: RuntimeOverrides = {}
): Promise<RuntimeConfig> {
  const network = normalizeNetwork(networkInput);
  const path = resolve(projectRoot, `deployment-config.${network}.json`);
  const raw = JSON.parse(await readFile(path, "utf8"));
  const useEnvOverrides = env.FIVE_USE_ENV_OVERRIDES === "1";
  const envOverrides: RuntimeOverrides = useEnvOverrides
    ? {
        rpcUrl: env.FIVE_RPC_URL || undefined,
        fiveProgramId: env.FIVE_VM_PROGRAM_ID || undefined,
        tictactoeScriptAccount: env.FIVE_SCRIPT_ACCOUNT || undefined,
        tictactoeConfigAccount: env.FIVE_TTT_CONFIG_ACCOUNT || undefined,
      }
    : {};
  const merged = {
    rpcUrl: raw.rpcUrl,
    fiveProgramId: raw.fiveProgramId,
    tictactoeScriptAccount: raw.tictactoeScriptAccount,
    tictactoeConfigAccount: raw.tictactoeConfigAccount,
    ...envOverrides,
    ...overrides,
  };

  return {
    network,
    rpcUrl: assertUrl(merged.rpcUrl, `${network}.rpcUrl`),
    fiveProgramId: assertPubkey(merged.fiveProgramId, `${network}.fiveProgramId`),
    tictactoeScriptAccount: assertPubkey(merged.tictactoeScriptAccount, `${network}.tictactoeScriptAccount`),
    tictactoeConfigAccount: assertPubkey(merged.tictactoeConfigAccount, `${network}.tictactoeConfigAccount`),
  };
}
