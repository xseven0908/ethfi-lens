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
    title: "Token Lens — HYPE、UNI、BP 基本面终端",
    description: "集中研究 HYPE、UNI 与 BP 的市场、协议业务、供应压力、质押机制和回购销毁。",
    openGraph: { title: "Token Lens · HYPE / UNI / BP", description: "业务增长 · 供应压力 · 回购销毁", images: [{ url: preview }] },
    twitter: { card: "summary_large_image", title: "Token Lens · HYPE / UNI / BP", description: "业务增长 · 供应压力 · 回购销毁", images: [preview] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
