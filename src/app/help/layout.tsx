import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Help - doXmind",
  description:
    "Learn how to use doXmind's AI-powered writing assistant, editor features, and more.",
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
