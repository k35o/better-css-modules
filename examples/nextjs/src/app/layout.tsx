import type { ReactNode } from "react";

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
