import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grid Art Generator — Transform Photos into Grid Art",
  description: "Transform any photo into stunning grid art — 8 render modes, paint-by-numbers, interactive drawing, smart color refinement. 100% client-side, your images never leave your browser.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-purple-50 text-gray-900 antialiased">
        <main>{children}</main>
      </body>
    </html>
  );
}
