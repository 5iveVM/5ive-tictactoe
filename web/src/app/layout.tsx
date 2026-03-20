import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { WalletContextProvider } from "@/components/providers/WalletContextProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tictactoe.5ive.tech"),
  title: "5ive TicTacToe Web",
  description: "Play on-chain TicTacToe on 5ive with session keys.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "https://tictactoe.5ive.tech",
    siteName: "5ive TicTacToe",
    title: "5ive TicTacToe Web",
    description: "Play on-chain TicTacToe on 5ive with session keys.",
    images: [
      {
        url: "/social-card.png",
        width: 1200,
        height: 630,
        alt: "5ive TicTacToe board with X and O marks",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "5ive TicTacToe Web",
    description: "Play on-chain TicTacToe on 5ive with session keys.",
    images: ["/social-card.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background text-foreground`}
      >
        <WalletContextProvider>
          {children}
        </WalletContextProvider>
      </body>
    </html>
  );
}
