/** * 服务条款页面（服务端组件） * 详细说明服务的接受条件、账户责任、使用限制和知识产权 */

import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms and conditions for using our service",
};

export default function TermsPage() {
  return (
    <div className="container py-12 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <Badge variant="secondary" className="mb-4">Legal</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Terms of Service</h1>
        <p className="mt-4 text-muted-foreground">Last updated: July 19, 2026</p>

        <div className="mt-12 space-y-8 leading-relaxed">
          <section>
            <h2 className="text-2xl font-semibold">1. Acceptance of Terms</h2>
            <p className="mt-2 text-muted-foreground">
              By accessing or using IndieStack (&ldquo;the Service&rdquo;), you agree to be bound
              by these Terms of Service. If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">2. Description of Service</h2>
            <p className="mt-2 text-muted-foreground">
              IndieStack provides a IndieStack template and hosting infrastructure for independent
              developers. The Service includes Next.js-based frontend templates, Supabase-backed
              database and authentication, and deployment tooling.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">3. User Obligations</h2>
            <p className="mt-2 text-muted-foreground">
              You are responsible for maintaining the confidentiality of your account credentials
              and for all activities that occur under your account. You agree to use the Service
              in compliance with all applicable laws and regulations.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">4. Intellectual Property</h2>
            <p className="mt-2 text-muted-foreground">
              The Service and its original content, features, and functionality are owned by
              IndieStack and are protected by international copyright, trademark, and other
              intellectual property laws. The underlying template code is provided under an
              open-source license.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">5. Limitation of Liability</h2>
            <p className="mt-2 text-muted-foreground">
              In no event shall IndieStack be liable for any indirect, incidental, special,
              consequential, or punitive damages arising out of or related to your use of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">6. Termination</h2>
            <p className="mt-2 text-muted-foreground">
              We reserve the right to terminate or suspend your account at any time, without prior
              notice, for conduct that we believe violates these Terms or is harmful to other users,
              us, or third parties.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">7. Changes to Terms</h2>
            <p className="mt-2 text-muted-foreground">
              We reserve the right to modify these terms at any time. We will notify users of
              material changes via email or through the Service. Continued use of the Service
              after changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">8. Contact</h2>
            <p className="mt-2 text-muted-foreground">
              For any questions about these Terms, please contact us at{" "}
              <a href="mailto:legal@indiestack.dev" className="text-primary underline-offset-4 hover:underline">
                legal@indiestack.dev
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
