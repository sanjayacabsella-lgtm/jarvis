import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "JARVIS — Live Voice Assistant",
  description: "A real-time voice assistant powered by Google Gemini Live.",
  applicationName: "JARVIS",
};

export const viewport: Viewport = {
  themeColor: "#03070d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
