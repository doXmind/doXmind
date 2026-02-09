"use client";

import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-8">
          <Link href="/" className="inline-block">
            <Logo size="md" />
          </Link>
        </div>

        <h1 className="mb-2 text-3xl font-bold">Terms of Service</h1>
        <p className="mb-8 text-sm text-muted-foreground">Last updated: January 15, 2026</p>

        <div className="prose prose-neutral max-w-none space-y-6 dark:prose-invert">
          <section>
            <h2 className="mb-3 text-xl font-semibold">1. Acceptance of Terms</h2>
            <p className="leading-relaxed text-muted-foreground">
              By accessing or using doXmind (&quot;the Service&quot;), you agree to be bound by
              these Terms of Service. If you do not agree to these terms, please do not use the
              Service.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">2. Description of Service</h2>
            <p className="leading-relaxed text-muted-foreground">
              doXmind is an AI-powered writing and document editing platform. The Service provides
              tools for creating, editing, and managing documents with AI assistance.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">3. User Accounts</h2>
            <p className="leading-relaxed text-muted-foreground">
              To use certain features of the Service, you must create an account using Google OAuth.
              You are responsible for maintaining the security of your account and all activities
              that occur under your account.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">4. User Content</h2>
            <p className="leading-relaxed text-muted-foreground">
              You retain ownership of all content you create using the Service. By using the
              Service, you grant us a limited license to process your content solely for the purpose
              of providing the Service. We do not claim ownership of your content.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">5. Acceptable Use</h2>
            <p className="leading-relaxed text-muted-foreground">You agree not to:</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              <li>Use the Service for any illegal purpose</li>
              <li>Upload malicious content or attempt to compromise the Service</li>
              <li>Violate any applicable laws or regulations</li>
              <li>Infringe on the intellectual property rights of others</li>
              <li>Attempt to gain unauthorized access to the Service or its systems</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">6. AI-Generated Content</h2>
            <p className="leading-relaxed text-muted-foreground">
              The Service uses AI to assist with writing and editing. AI-generated content is
              provided &quot;as is&quot; and you are responsible for reviewing and verifying any
              AI-generated content before use. We do not guarantee the accuracy or appropriateness
              of AI-generated content.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">7. Limitation of Liability</h2>
            <p className="leading-relaxed text-muted-foreground">
              The Service is provided &quot;as is&quot; without warranties of any kind. We are not
              liable for any indirect, incidental, special, or consequential damages arising from
              your use of the Service.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">8. Changes to Terms</h2>
            <p className="leading-relaxed text-muted-foreground">
              We may update these Terms of Service from time to time. We will notify users of any
              material changes by posting the new Terms on this page with an updated date.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">9. Contact</h2>
            <p className="leading-relaxed text-muted-foreground">
              If you have any questions about these Terms, please contact us at support@doxmind.com.
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
