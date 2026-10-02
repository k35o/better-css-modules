import type { ReactNode } from "react";
import "./global.css";

export const metadata = {
  title: "better-css-modules - Next.js example",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
