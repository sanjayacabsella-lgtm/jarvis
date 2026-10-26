import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "JARVIS — සජීවී හඬ සහායක",
  description: "Sinhala සහ English හඬ සංවාද සඳහා පුද්ගලික JARVIS interface එක.",
  applicationName: "JARVIS",
};

export const viewport: Viewport = {
  themeColor: "#070c12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="si">
      <body>{children}</body>
    </html>
  );
}
