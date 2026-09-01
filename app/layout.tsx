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
  const preview = `${protocol}://${host}/og-brand-v4.png`;
  return {
    title: "Token Lens — ETHFI、BP 与 PENDLE 数据看板",
    description: "追踪 ETHFI、BP 与 PENDLE 的价格、供应、质押、协议收入及收益市场。",
    openGraph: { title: "Token Lens · ETHFI / BP / PENDLE", description: "市场 · 供应 · 质押 · 收益", images: [{ url: preview }] },
    twitter: { card: "summary_large_image", title: "Token Lens · ETHFI / BP / PENDLE", description: "市场 · 供应 · 质押 · 收益", images: [preview] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
