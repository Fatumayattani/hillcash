import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Hillcash | Buy better together",
  description: "Agent assisted group purchasing for digital services with buyer controlled settlement."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
