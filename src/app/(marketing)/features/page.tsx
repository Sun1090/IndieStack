/** * 功能特性页面（服务端组件） * 展示 IndieStack 提供的所有功能模块，按分类展示 * 包含认证安全、数据库存储、团队协作、监控追踪、计费订阅、部署运维等六大类 */

import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  Shield,
  BarChart3,
  Users,
  Bot,
  Globe,
  Lock,
  Bell,
  Code2,
  Cloud,
  Database,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Features",
  description: "Everything you need to build and scale your SaaS product",
};

const features = [
  {
    title: "Authentication",
    description: "Email, OAuth (GitHub, Google), and social login out of the box. Session management included.",
    icon: Shield,
    category: "Core",
  },
  {
    title: "Database",
    description: "PostgreSQL via Supabase with real-time subscriptions, row-level security, and auto-generated APIs.",
    icon: Database,
    category: "Core",
  },
  {
    title: "Team Management",
    description: "Multi-tenant architecture with team invites, roles (owner, admin, member), and permissions.",
    icon: Users,
    category: "Core",
  },
  {
    title: "Real-time Updates",
    description: "Supabase Realtime for live data synchronization across clients without polling.",
    icon: Zap,
    category: "Infrastructure",
  },
  {
    title: "File Storage",
    description: "Alibaba Cloud OSS integration for scalable file storage with CDN delivery.",
    icon: Cloud,
    category: "Infrastructure",
  },
  {
    title: "Analytics",
    description: "Track usage, API calls, user growth, and revenue with built-in analytics dashboard.",
    icon: BarChart3,
    category: "Business",
  },
  {
    title: "Billing & Subscriptions",
    description: "Stripe integration for subscription management, pricing tiers, and payment history.",
    icon: Lock,
    category: "Business",
  },
  {
    title: "Error Monitoring",
    description: "Sentry integration for real-time error tracking, performance monitoring, and crash reports.",
    icon: Bot,
    category: "Infrastructure",
  },
  {
    title: "Notifications",
    description: "Email notifications for account activity, security alerts, and team invitations.",
    icon: Bell,
    category: "Experience",
  },
  {
    title: "API Access",
    description: "RESTful API with rate limiting, authentication, and usage tracking.",
    icon: Code2,
    category: "Developer",
  },
  {
    title: "Internationalization",
    description: "Multi-language support with timezone and locale configuration.",
    icon: Globe,
    category: "Experience",
  },
  {
    title: "Responsive Design",
    description: "Mobile-first responsive UI built with Tailwind CSS. Works on all devices.",
    icon: Smartphone,
    category: "Experience",
  },
];

const categories = ["Core", "Infrastructure", "Business", "Experience", "Developer"];

export default function FeaturesPage() {
  return (
    <div className="container py-12 lg:py-20">
      {/* Header */}
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="secondary" className="mb-4">Features</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Everything you need to ship fast
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          A complete, production-ready stack for independent developers. No boilerplate, no compromises.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href={ROUTES.register}>Get Started Free</Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href={ROUTES.pricing}>View Pricing</Link>
          </Button>
        </div>
      </div>

      {/* Features by Category */}
      <div className="mt-20 space-y-16">
        {categories.map((category) => {
          const categoryFeatures = features.filter((f) => f.category === category);
          return (
            <div key={category}>
              <h2 className="mb-8 text-2xl font-bold">{category}</h2>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {categoryFeatures.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <Card key={feature.title} className="transition-colors hover:border-primary/50">
                      <CardHeader>
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <CardTitle className="mt-4">{feature.title}</CardTitle>
                        <CardDescription>{feature.description}</CardDescription>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div className="mt-20 rounded-2xl bg-muted/50 p-12 text-center">
        <h2 className="text-3xl font-bold">Ready to get started?</h2>
        <p className="mt-2 text-muted-foreground">
          Join thousands of developers using IndieStack to ship faster.
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href={ROUTES.register}>Start Building</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
