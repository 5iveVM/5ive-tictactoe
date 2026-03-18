"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Github, Hexagon } from "lucide-react";
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
        <div className="glass flex items-center justify-between gap-2 sm:gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-950/65 px-3 py-2 sm:px-4 sm:py-3 md:px-6">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <Hexagon className="h-6 w-6 text-cyan-300" />
            <span className="text-lg font-black tracking-wide uppercase text-cyan-50 md:text-xl">
              5ive<span className="text-cyan-300">TicTacToe</span>
            </span>
          </Link>

          <div className="hidden lg:flex items-center gap-6 text-[11px] font-mono uppercase tracking-widest text-cyan-100/80">
            <span>status: {status || "ready"}</span>
            <span>moves: {moveCount ?? 0}</span>
            <span>mode: {mode || "direct"}</span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="hidden sm:flex items-center rounded-xl border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setNetwork("devnet")}
                className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  network === "devnet"
                    ? "bg-cyan-500/35 text-cyan-50"
                    : "text-cyan-200/75 hover:bg-white/10"
                }`}
              >
                Devnet
              </button>
              <button
                type="button"
                onClick={() => setNetwork("mainnet")}
                className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  network === "mainnet"
                    ? "bg-cyan-500/35 text-cyan-50"
                    : "text-cyan-200/75 hover:bg-white/10"
                }`}
              >
                Mainnet
              </button>
            </div>
            <div className="[&_.wallet-adapter-button]:h-9 sm:[&_.wallet-adapter-button]:h-10 [&_.wallet-adapter-button]:rounded-xl [&_.wallet-adapter-button]:border [&_.wallet-adapter-button]:border-cyan-300/30 [&_.wallet-adapter-button]:bg-cyan-500/20 [&_.wallet-adapter-button]:px-3 sm:[&_.wallet-adapter-button]:px-5 [&_.wallet-adapter-button]:text-cyan-50 [&_.wallet-adapter-button]:font-bold [&_.wallet-adapter-button]:text-xs sm:[&_.wallet-adapter-button]:text-sm [&_.wallet-adapter-button]:hover:bg-cyan-500/35 transition-all active:scale-95 rounded-xl">
              <WalletMultiButton />
            </div>
            <a
              href="https://github.com/5iveVM/5ive-tictactoe"
              target="_blank"
              rel="noreferrer"
              aria-label="5ive TicTacToe GitHub repository"
              className="inline-flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-500/10 text-cyan-100 transition-colors hover:bg-cyan-500/20"
            >
              <Github className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
}
