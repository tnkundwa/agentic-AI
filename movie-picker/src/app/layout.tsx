import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Movie Picker",
  description: "Recommendations that learn your taste",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
