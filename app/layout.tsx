import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "JARVIS — සජීවී හඬ සහායක",
  description: "සජීවී සිංහල සහ ඉංග්‍රීසි හඬ සංවාද සඳහා JARVIS පාලක තිරය.",
  applicationName: "JARVIS",
};

export const viewport: Viewport = {
  themeColor: "#03070d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="si">
      <body>{children}</body>
    </html>
  );
}
