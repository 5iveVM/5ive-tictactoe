"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { resolveRuntimeConfig } from "@/lib/runtime-config";

import "@solana/wallet-adapter-react-ui/styles.css";

export type NetworkName = "localnet" | "devnet" | "mainnet";

type NetworkContextValue = {
  network: NetworkName;
  endpoint: string;
  setNetwork: (network: NetworkName) => void;
};

const LOCALNET_ENDPOINT = resolveRuntimeConfig("localnet").rpcUrl;
const DEVNET_ENDPOINT = resolveRuntimeConfig("devnet").rpcUrl;
const MAINNET_ENDPOINT = resolveRuntimeConfig("mainnet").rpcUrl;
const DEFAULT_NETWORK: NetworkName =
  process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "localnet" ||
  process.env.NEXT_PUBLIC_RPC_URL?.includes("127.0.0.1")
    ? "localnet"
    : process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "mainnet" ||
        process.env.NEXT_PUBLIC_RPC_URL?.includes("mainnet")
      ? "mainnet"
      : "devnet";
const NETWORK_STORAGE_KEY = "five-tictactoe-network";

const NetworkContext = createContext<NetworkContextValue | null>(null);

function isUserRejectedWalletAction(error: WalletError): boolean {
  return /user rejected|rejected the request|declined|cancelled/i.test(error.message);
}

export function useNetworkConfig(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetworkConfig must be used within WalletContextProvider.");
  return ctx;
}

export function WalletContextProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetwork] = useState<NetworkName>(DEFAULT_NETWORK);
  const endpoint = useMemo(() => {
    if (network === "localnet") return LOCALNET_ENDPOINT;
    if (network === "mainnet") return MAINNET_ENDPOINT;
    return DEVNET_ENDPOINT;
  }, [network]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(NETWORK_STORAGE_KEY);
    if (stored === "mainnet" || stored === "devnet" || stored === "localnet") {
      const frame = window.requestAnimationFrame(() => setNetwork(stored));
      return () => window.cancelAnimationFrame(frame);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NETWORK_STORAGE_KEY, network);
  }, [network]);

  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  const value = useMemo(() => ({ network, endpoint, setNetwork }), [network, endpoint]);

  const onWalletError = (error: WalletError, adapter?: Adapter) => {
    if (isUserRejectedWalletAction(error)) return;
    if (adapter?.name) {
      console.error(`[wallet:${adapter.name}]`, error);
      return;
    }
    console.error(error);
  };

  return (
    <NetworkContext.Provider value={value}>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect onError={onWalletError}>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </NetworkContext.Provider>
  );
}
