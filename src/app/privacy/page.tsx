"use client";

import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-8">
          <Link href="/" className="inline-block">
            <Logo size="md" />
          </Link>
        </div>

        <h1 className="mb-2 text-3xl font-bold">Privacy Policy</h1>
        <p className="mb-8 text-sm text-muted-foreground">Last updated: January 15, 2026</p>

        <div className="prose prose-neutral max-w-none space-y-6 dark:prose-invert">
          <section>
            <h2 className="mb-3 text-xl font-semibold">1. Information We Collect</h2>
            <p className="leading-relaxed text-muted-foreground">
              When you use doXmind, we collect the following information:
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              <li>
                <strong>Account Information:</strong> Email address and name from your Google
                account
              </li>
              <li>
                <strong>Content:</strong> Documents and files you create using the Service
              </li>
              <li>
                <strong>Usage Data:</strong> How you interact with the Service
              </li>
              <li>
                <strong>Device Information:</strong> Browser type, operating system, and device
                identifiers
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">2. How We Use Your Information</h2>
            <p className="leading-relaxed text-muted-foreground">We use your information to:</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              <li>Provide and maintain the Service</li>
              <li>Process your documents with AI assistance</li>
              <li>Improve and personalize your experience</li>
              <li>Communicate with you about the Service</li>
              <li>Ensure the security of the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">3. AI Processing</h2>
            <p className="leading-relaxed text-muted-foreground">
              Your documents may be processed by third-party AI services (such as Anthropic Claude)
              to provide AI writing assistance. This processing is done in accordance with our
              agreements with these providers. We do not use your content to train AI models.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">4. Data Storage and Security</h2>
            <p className="leading-relaxed text-muted-foreground">
              Your data is stored securely using industry-standard encryption. We implement
              appropriate technical and organizational measures to protect your personal information
              against unauthorized access, alteration, disclosure, or destruction.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">5. Data Sharing</h2>
            <p className="leading-relaxed text-muted-foreground">
              We do not sell your personal information. We may share your information only in the
              following circumstances:
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              <li>With your consent</li>
              <li>With service providers who assist in operating the Service</li>
              <li>To comply with legal obligations</li>
              <li>To protect our rights and prevent fraud</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">6. Your Rights</h2>
            <p className="leading-relaxed text-muted-foreground">You have the right to:</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              <li>Access your personal information</li>
              <li>Correct inaccurate information</li>
              <li>Delete your account and associated data</li>
              <li>Export your documents</li>
              <li>Opt out of certain data processing</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">7. Cookies</h2>
            <p className="leading-relaxed text-muted-foreground">
              We use cookies and similar technologies to maintain your session, remember your
              preferences, and improve your experience. You can control cookie settings through your
              browser preferences.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">8. Data Retention</h2>
            <p className="leading-relaxed text-muted-foreground">
              We retain your data for as long as your account is active or as needed to provide the
              Service. You can delete your account at any time, and we will delete your data within
              30 days of account deletion.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">9. Children&apos;s Privacy</h2>
            <p className="leading-relaxed text-muted-foreground">
              The Service is not intended for children under 13. We do not knowingly collect
              personal information from children under 13.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">10. Changes to This Policy</h2>
            <p className="leading-relaxed text-muted-foreground">
              We may update this Privacy Policy from time to time. We will notify you of any changes
              by posting the new Privacy Policy on this page with an updated date.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">11. Contact Us</h2>
            <p className="leading-relaxed text-muted-foreground">
              If you have any questions about this Privacy Policy, please contact us at
              privacy@doxmind.com.
            </p>
          </section>
        </div>

        <div className="mt-12 border-t border-border pt-8">
          <Link href="/login" className="text-primary hover:underline">
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
