/** * 隐私政策页面（服务端组件） * 详细说明数据收集、使用、存储和安全保护措施 * 包含第三方服务说明和用户权利声明 */

import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Our privacy policy and data handling practices",
};

export default function PrivacyPage() {
  return (
    <div className="container py-12 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <Badge variant="secondary" className="mb-4">Legal</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Privacy Policy</h1>
        <p className="mt-4 text-muted-foreground">Last updated: July 19, 2026</p>

        <div className="mt-12 space-y-8 leading-relaxed">
          <section>
            <h2 className="text-2xl font-semibold">1. Information We Collect</h2>
            <p className="mt-2 text-muted-foreground">
              We collect information you provide directly to us, including your name, email address,
              and profile information when you create an account. We also collect usage data such as
              page views, API calls, and feature interactions to improve our service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">2. How We Use Your Information</h2>
            <p className="mt-2 text-muted-foreground">
              We use the information we collect to provide, maintain, and improve our services,
              to send you technical notices and support messages, and to communicate with you about
              product updates and marketing (with your consent).
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">3. Data Storage and Security</h2>
            <p className="mt-2 text-muted-foreground">
              Your data is stored on secure servers provided by Supabase (PostgreSQL database),
              Alibaba Cloud OSS (file storage), and Vercel (application hosting). We implement
              industry-standard security measures including encryption at rest and in transit.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">4. Third-Party Services</h2>
            <p className="mt-2 text-muted-foreground">
              We use the following third-party services to operate our platform:
              Supabase (authentication and database), Vercel (hosting), Sentry (error monitoring),
              Stripe (payment processing), Alibaba Cloud (file storage), and Appark (performance monitoring).
              Each service has its own privacy policy governing data handling.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">5. Data Retention</h2>
            <p className="mt-2 text-muted-foreground">
              We retain your personal information for as long as your account is active. If you
              delete your account, we will delete or anonymize your data within 30 days, except
              where we are required to retain it for legal purposes.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">6. Your Rights</h2>
            <p className="mt-2 text-muted-foreground">
              You have the right to access, correct, or delete your personal data at any time
              through your account settings. You can also export your data or request its deletion
              by contacting us. We will respond to your request within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold">7. Contact</h2>
            <p className="mt-2 text-muted-foreground">
              If you have any questions about this Privacy Policy, please contact us at{" "}
              <a href="mailto:privacy@indiestack.dev" className="text-primary underline-offset-4 hover:underline">
                privacy@indiestack.dev
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
