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
  const preview = `${protocol}://${host}/og.png`;
  return {
    title: "ETHFI Lens — 代币数据看板",
    description: "清晰追踪 ETHFI 价格、供应、质押、解押、解锁与协议动作。",
    openGraph: { title: "ETHFI Lens", description: "价格 · 供应 · 质押 · 解锁", images: [{ url: preview }] },
    twitter: { card: "summary_large_image", title: "ETHFI Lens", description: "价格 · 供应 · 质押 · 解锁", images: [preview] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
