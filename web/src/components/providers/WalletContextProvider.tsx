"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";

import "@solana/wallet-adapter-react-ui/styles.css";

export type NetworkName = "localnet" | "devnet" | "mainnet";

type NetworkContextValue = {
  network: NetworkName;
  endpoint: string;
  displayEndpoint: string;
  wsEndpoint: string;
  setNetwork: (network: NetworkName) => void;
};

const PUBLIC_DEVNET_ENDPOINT = "https://api.devnet.solana.com";
const PUBLIC_MAINNET_ENDPOINT = "https://api.mainnet-beta.solana.com";
const DEVNET_PROXY_PATH = "/api/solana-devnet";
const MAINNET_PROXY_PATH = "/api/solana-mainnet";
const LOCALNET_ENDPOINT =
  process.env.NEXT_PUBLIC_LOCALNET_RPC_URL ||
  (process.env.NEXT_PUBLIC_RPC_URL?.includes("127.0.0.1") ? process.env.NEXT_PUBLIC_RPC_URL : "") ||
  "http://127.0.0.1:8899";
const DEFAULT_NETWORK: NetworkName = "mainnet";
const NETWORK_STORAGE_KEY = "five-tictactoe-network";

const NetworkContext = createContext<NetworkContextValue | null>(null);

function resolveProxyPath(path: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return new URL(path, window.location.origin).toString();
}

function resolveWsEnv(network: NetworkName): string | undefined {
  if (network === "localnet") {
    return process.env.NEXT_PUBLIC_LOCALNET_WS_URL || process.env.NEXT_PUBLIC_WS_URL;
  }
  if (network === "mainnet") {
    return process.env.NEXT_PUBLIC_MAINNET_WS_URL || process.env.NEXT_PUBLIC_WS_URL;
  }
  return process.env.NEXT_PUBLIC_DEVNET_WS_URL || process.env.NEXT_PUBLIC_WS_URL;
}

function deriveWsEndpoint(network: NetworkName): string {
  const explicit = resolveWsEnv(network);
  if (explicit) return explicit;
  if (network === "localnet") return "ws://127.0.0.1:8900";
  if (network === "mainnet") return "wss://api.mainnet-beta.solana.com/";
  return "wss://api.devnet.solana.com/";
}

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
    if (network === "mainnet") return resolveProxyPath(MAINNET_PROXY_PATH, PUBLIC_MAINNET_ENDPOINT);
    return resolveProxyPath(DEVNET_PROXY_PATH, PUBLIC_DEVNET_ENDPOINT);
  }, [network]);
  const displayEndpoint = useMemo(() => {
    if (network === "localnet") return LOCALNET_ENDPOINT;
    if (network === "mainnet") return PUBLIC_MAINNET_ENDPOINT;
    return PUBLIC_DEVNET_ENDPOINT;
  }, [network]);
  const wsEndpoint = useMemo(() => {
    return deriveWsEndpoint(network);
  }, [network]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(NETWORK_STORAGE_KEY);
    if (stored === "mainnet") {
      const frame = window.requestAnimationFrame(() => setNetwork("mainnet"));
      return () => window.cancelAnimationFrame(frame);
    }
    if (stored === "devnet" || stored === "localnet") {
      window.localStorage.setItem(NETWORK_STORAGE_KEY, "mainnet");
      const frame = window.requestAnimationFrame(() => setNetwork("mainnet"));
      return () => window.cancelAnimationFrame(frame);
    }
    window.localStorage.setItem(NETWORK_STORAGE_KEY, "mainnet");
    const frame = window.requestAnimationFrame(() => setNetwork("mainnet"));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NETWORK_STORAGE_KEY, network);
  }, [network]);

  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  const value = useMemo(
    () => ({ network, endpoint, displayEndpoint, wsEndpoint, setNetwork }),
    [network, endpoint, displayEndpoint, wsEndpoint, setNetwork]
  );

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
      <ConnectionProvider endpoint={endpoint} wsEndpoint={wsEndpoint}>
        <WalletProvider wallets={wallets} autoConnect onError={onWalletError}>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </NetworkContext.Provider>
  );
}
