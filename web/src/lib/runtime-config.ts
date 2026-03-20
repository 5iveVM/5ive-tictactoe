import { PublicKey } from "@solana/web3.js";
import type { RuntimeNetwork } from "@/generated/deployment-config";
import { DEPLOYMENT_CONFIGS } from "@/generated/deployment-config";

export type TictactoeRuntimeConfig = {
  network: RuntimeNetwork;
  rpcUrl: string;
  fiveProgramId: string;
  tictactoeScriptAccount: string;
  tictactoeConfigAccount: string;
};

type RuntimeOverrides = Partial<Pick<TictactoeRuntimeConfig, "rpcUrl" | "fiveProgramId" | "tictactoeScriptAccount" | "tictactoeConfigAccount">>;

function assertPubkey(value: string, label: string): string {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

function pickSuffix(network: RuntimeNetwork): "LOCALNET" | "DEVNET" | "MAINNET" {
  return network === "localnet" ? "LOCALNET" : network === "devnet" ? "DEVNET" : "MAINNET";
}

export function resolveRuntimeConfig(
  network: RuntimeNetwork,
  overrides: RuntimeOverrides = {}
): TictactoeRuntimeConfig {
  const base = DEPLOYMENT_CONFIGS[network];
  const suffix = pickSuffix(network);
  const useEnvOverrides = process.env.NEXT_PUBLIC_TTT_USE_ENV_OVERRIDES === "1";
  const envOverrides: RuntimeOverrides = useEnvOverrides
    ? {
        rpcUrl: process.env[`NEXT_PUBLIC_${suffix}_RPC_URL`] || process.env.NEXT_PUBLIC_RPC_URL || undefined,
        fiveProgramId: process.env.NEXT_PUBLIC_FIVE_VM_PROGRAM_ID || undefined,
        tictactoeScriptAccount:
          process.env[`NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT_${suffix}`] ||
          process.env.NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT ||
          undefined,
        tictactoeConfigAccount:
          process.env[`NEXT_PUBLIC_TTT_CONFIG_ACCOUNT_${suffix}`] ||
          process.env.NEXT_PUBLIC_TTT_CONFIG_ACCOUNT ||
          undefined,
      }
    : {};
  const merged = {
    rpcUrl: base.rpcUrl,
    fiveProgramId: base.fiveProgramId,
    tictactoeScriptAccount: base.tictactoeScriptAccount,
    tictactoeConfigAccount: base.tictactoeConfigAccount,
    ...envOverrides,
    ...overrides,
  };

  if (!merged.rpcUrl) throw new Error(`missing rpcUrl for ${network}`);
  return {
    network,
    rpcUrl: merged.rpcUrl,
    fiveProgramId: assertPubkey(merged.fiveProgramId, `${network}.fiveProgramId`),
    tictactoeScriptAccount: assertPubkey(merged.tictactoeScriptAccount, `${network}.tictactoeScriptAccount`),
    tictactoeConfigAccount: assertPubkey(merged.tictactoeConfigAccount, `${network}.tictactoeConfigAccount`),
  };
}
