import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Demo - doXmind",
  description:
    "See doXmind in action — AI-powered writing with inline suggestions, diff review, chat assistance, and more.",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
