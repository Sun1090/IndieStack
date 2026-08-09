/** * 关于页面（服务端组件） * 介绍 IndieStack 的项目背景、团队价值观和技术栈 */

import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { SITE_CONFIG } from "@/lib/constants";

export const metadata: Metadata = {
  title: "About",
  description: `About ${SITE_CONFIG.name}`,
};

const values = [
  {
    title: "Developer First",
    description: "Built by developers, for developers. Every feature is designed to make your life easier.",
  },
  {
    title: "Production Ready",
    description: "Not a demo. Every component, API, and integration is built for real-world use.",
  },
  {
    title: "Open Core",
    description: "The core stack is open source. You own your code and your data.",
  },
  {
    title: "Independent Friendly",
    description: "Designed for solo founders and small teams who want to move fast.",
  },
];

export default function AboutPage() {
  return (
    <div className="container py-12 lg:py-20">
      {/* Hero */}
      <div className="mx-auto max-w-3xl">
        <Badge variant="secondary" className="mb-4">About</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          The independent developer&apos;s stack
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          {SITE_CONFIG.description}
        </p>
        <p className="mt-4 text-muted-foreground">
          We believe in giving developers a complete, production-ready foundation so they can focus on
          what makes their product unique, not on reinventing the wheel.
        </p>
      </div>

      {/* Tech Stack */}
      <div className="mt-16">
        <h2 className="mb-8 text-2xl font-bold">Our Stack</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { name: "Next.js 15", role: "React Framework", desc: "App Router, Server Components, Streaming" },
            { name: "Tailwind CSS", role: "Styling", desc: "Utility-first CSS with shadcn/ui components" },
            { name: "Supabase", role: "Backend", desc: "Auth, PostgreSQL, Realtime, Storage" },
            { name: "Sentry", role: "Monitoring", desc: "Error tracking and performance monitoring" },
          ].map((tech) => (
            <Card key={tech.name}>
              <CardHeader>
                <CardTitle className="text-lg">{tech.name}</CardTitle>
                <CardDescription>{tech.role}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{tech.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Values */}
      <div className="mt-16">
        <h2 className="mb-8 text-2xl font-bold">Our Values</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {values.map((value) => (
            <div key={value.title} className="rounded-lg border p-6">
              <h3 className="font-semibold">{value.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{value.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-16 rounded-2xl bg-muted/50 p-12 text-center">
        <h2 className="text-3xl font-bold">Start building today</h2>
        <p className="mt-2 text-muted-foreground">
          Join the waitlist or start building immediately.
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href={ROUTES.register}>Get Started</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
