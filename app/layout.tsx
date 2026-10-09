import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const preview = `${protocol}://${host}/og-brand-v6.png`;
  return {
    title: "Token Lens — 加密市场资金结构与基本面终端",
    description: "跟踪稳定币、价格趋势、未平仓合约、资金费率、成交结构、ETF 资金流，以及 HYPE、UNI、BP 基本面。",
    openGraph: { title: "Token Lens · Crypto Capital Structure", description: "稳定币 · 杠杆 · ETF · 代币基本面", images: [{ url: preview }] },
    twitter: { card: "summary_large_image", title: "Token Lens · Crypto Capital Structure", description: "稳定币 · 杠杆 · ETF · 代币基本面", images: [preview] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
