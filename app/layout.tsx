import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";
import "./ryzeiq.css";
import { Sora } from "next/font/google";

// Headings and numbers in Sora (RyzeIQ's display face); body text stays Schibsted Grotesk.
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });

export const metadata = {
  title: "RyzeIQ",
  description: "RyzeIQ by DigitalRyze: Google rankings, Search Console data and AI visibility, with AI agents that plan your SEO.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={sora.variable}>
      <body>{children}</body>
    </html>
  );
}
