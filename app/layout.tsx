import "./globals.css";
import { Fraunces, Manrope, Space_Mono } from "next/font/google";
import packageJson from "../package.json";

import { ThemeProvider } from "../components/theme-provider";

export const metadata = { title: "UNDERWIRE", description: "UNDERWIRE" };

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

const mono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${display.variable} ${body.variable} ${mono.variable} min-h-dvh relative`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <div className="pointer-events-none fixed bottom-2 right-3 z-[60] font-mono text-[10px] uppercase tracking-[0.16em] muted-text">
            v{packageJson.version}
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
