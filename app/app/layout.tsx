import type { Metadata } from "next";
import { GeistMono } from 'geist/font/mono';
import "./globals.css";

export const metadata: Metadata = {
  title: "Synapse — Real-time Collaborative AI Whiteboard",
  description: "A real-time collaborative whiteboard with AI assistance. Draw shapes, sticky notes, and arrows. Invite teammates and brainstorm together with Gemini AI.",
  keywords: ["whiteboard", "collaborative", "AI", "real-time", "canvas", "brainstorm"],
  openGraph: {
    title: "Synapse — Real-time Collaborative AI Whiteboard",
    description: "Draw, collaborate, and think together with AI assistance.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Inter is loaded via @import in globals.css (Google Fonts)
    // GeistMono still used for monospaced text (room IDs, code, etc.)
    <html lang="en" className={GeistMono.variable}>
      <body>
        {children}
      </body>
    </html>
  );
}
