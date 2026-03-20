"use client";

import dynamic from "next/dynamic";
import { Github } from "lucide-react";
import { useNetworkConfig } from "@/components/providers/WalletContextProvider";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

type NavbarProps = {
  status?: string;
  moveCount?: number;
  mode?: string;
};

export function Navbar({ status, moveCount, mode }: NavbarProps) {
  const { network, setNetwork } = useNetworkConfig();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-2 py-2 sm:px-4 md:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="glass flex items-center justify-between gap-2 sm:gap-3 rounded-2xl border border-[#c4a7e7]/25 bg-[#2a273f]/75 px-3 py-2 sm:px-4 sm:py-3 md:px-6">
          <a
            href="https://5ive.tech"
            target="_blank"
            rel="noreferrer"
            className="text-lg font-black tracking-[0.3em] uppercase text-primary transition-all hover:text-[#06b6d4] hover:drop-shadow-[0_0_8px_rgba(6,182,212,0.6)] md:text-xl"
          >
            5IVE
          </a>

          <div className="hidden lg:flex items-center gap-6 text-[11px] font-mono uppercase tracking-widest text-[#e0def4]/80">
            <span>status: {status || "ready"}</span>
            <span>moves: {moveCount ?? 0}</span>
            <span>mode: {mode || "direct"}</span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="hidden sm:flex items-center rounded-xl border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setNetwork("localnet")}
                className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  network === "localnet"
                    ? "bg-[#c4a7e7]/35 text-[#e0def4]"
                    : "text-[#908caa] hover:bg-white/10"
                }`}
              >
                Localnet
              </button>
              <button
                type="button"
                onClick={() => setNetwork("devnet")}
                className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  network === "devnet"
                    ? "bg-[#c4a7e7]/35 text-[#e0def4]"
                    : "text-[#908caa] hover:bg-white/10"
                }`}
              >
                Devnet
              </button>
              <button
                type="button"
                onClick={() => setNetwork("mainnet")}
                className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  network === "mainnet"
                    ? "bg-[#c4a7e7]/35 text-[#e0def4]"
                    : "text-[#908caa] hover:bg-white/10"
                }`}
              >
                Mainnet
              </button>
            </div>
            <div className="[&_.wallet-adapter-button]:h-9 sm:[&_.wallet-adapter-button]:h-10 [&_.wallet-adapter-button]:rounded-xl [&_.wallet-adapter-button]:border [&_.wallet-adapter-button]:border-primary/30 [&_.wallet-adapter-button]:bg-primary/10 [&_.wallet-adapter-button]:px-3 sm:[&_.wallet-adapter-button]:px-5 [&_.wallet-adapter-button]:text-[#e0def4] [&_.wallet-adapter-button]:font-bold [&_.wallet-adapter-button]:text-xs sm:[&_.wallet-adapter-button]:text-sm [&_.wallet-adapter-button]:hover:bg-primary/20 transition-all active:scale-95 rounded-xl">
              <WalletMultiButton />
            </div>
            <a
              href="https://github.com/5iveVM/5ive-tictactoe"
              target="_blank"
              rel="noreferrer"
              aria-label="5ive TicTacToe GitHub repository"
              className="inline-flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border border-[#c4a7e7]/30 bg-[#c4a7e7]/10 text-[#e0def4] transition-colors hover:bg-[#c4a7e7]/20"
            >
              <Github className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
}
