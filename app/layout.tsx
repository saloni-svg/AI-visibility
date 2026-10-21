import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";

export const metadata = { title: "AI Visibility Tracker" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
