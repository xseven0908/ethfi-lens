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
  const preview = `${protocol}://${host}/og-brand-v5.png`;
  return {
    title: "Token Lens — ETHFI、BP、PENDLE 与 HYPE 对比看板",
    description: "横向比较 ETHFI、BP、PENDLE 与 HYPE 的市场、供应、质押、协议经营、价值回流和风险。",
    openGraph: { title: "Token Lens · 四币对比研究", description: "市场 · 供应 · 质押 · 价值回流 · 风险", images: [{ url: preview }] },
    twitter: { card: "summary_large_image", title: "Token Lens · 四币对比研究", description: "市场 · 供应 · 质押 · 价值回流 · 风险", images: [preview] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
