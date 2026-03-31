import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grid Art Generator",
  description: "Transform photos into grid art — entirely in your browser",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <header className="mb-8 text-center">
            <h1 className="text-2xl font-bold tracking-tight">
              Grid Art Generator
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              100% client-side — no upload, no server, your images never leave your browser
            </p>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
