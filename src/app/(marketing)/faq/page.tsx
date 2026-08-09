/** * 常见问题页面（服务端组件） * 按分类展示用户常见问题及其答案 * 包含入门指南、技术问题、计费相关、支持社区等分类 */

import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/lib/constants";
import { ChevronDown } from "lucide-react";
 
export const metadata: Metadata = {
   title: "FAQ",
   description: "Frequently asked questions about IndieStack",
 };
 
 const faqCategories = [
   {
     name: "Getting Started",
     questions: [
       {
         q: "What is IndieStack?",
         a: "IndieStack is a production-ready IndieStack for independent developers. It combines Next.js 15, Tailwind CSS, shadcn/ui, Supabase, PostgreSQL, Sentry, and more into one cohesive stack so you can ship your product faster.",
       },
       {
         q: "How do I get started?",
         a: "Clone the repository, install dependencies with pnpm install, configure your .env.local with Supabase credentials, run the database migrations, and start building. See the setup guide for detailed instructions.",
       },
       {
         q: "Do I need any paid services?",
         a: "For local development, you only need a free Supabase project. For production, you'll need to deploy to Vercel (free tier available), Supabase (free tier available), and optionally Sentry (free tier) and Alibaba Cloud OSS (pay-as-you-go).",
       },
       {
         q: "Can I use this for commercial projects?",
         a: "Yes! IndieStack is MIT licensed. You can use it for personal projects, commercial SaaS products, client work — anything you like.",
       },
     ],
   },
   {
     name: "Authentication & Users",
     questions: [
       {
         q: "What authentication methods are supported?",
         a: "We support Email/Password login, GitHub OAuth, and Google OAuth out of the box. You can add more providers via Supabase Auth settings.",
       },
       {
         q: "How does session management work?",
         a: "Sessions are managed via Supabase SSR with HTTP-only cookies. The middleware automatically refreshes sessions on every request. Server components use createClient() with cookie-based auth.",
       },
       {
         q: "Is there role-based access control?",
         a: "Yes. Teams support owner, admin, and member roles. Row Level Security in PostgreSQL ensures data isolation between users and teams.",
       },
     ],
   },
   {
     name: "Database & Storage",
     questions: [
       {
         q: "What database does IndieStack use?",
         a: "PostgreSQL via Supabase. The schema includes profiles, teams, team_members, subscriptions, user_sessions, and api_usage tables with RLS policies.",
       },
       {
         q: "Can I use my own PostgreSQL database?",
         a: "Yes. While we recommend Supabase for the tight integration, you can point the app to any PostgreSQL instance by configuring the connection string.",
       },
       {
         q: "How is file storage handled?",
         a: "Files are stored on Alibaba Cloud OSS with CDN delivery. The integration supports signed URLs for secure uploads and public URLs for served assets.",
       },
     ],
   },
   {
     name: "Deployment",
     questions: [
       {
         q: "Where can I deploy IndieStack?",
         a: "The primary deployment target is Vercel for the frontend, with Supabase Cloud for the database. GitHub Actions handles CI/CD. You can also deploy to any Node.js hosting provider.",
       },
       {
         q: "How do I set up a custom domain?",
         a: "Add your domain in Vercel Dashboard under Project → Domains. Vercel automatically provisions SSL certificates. Update your DNS records to point to Vercel's nameservers.",
       },
       {
         q: "What about preview deployments?",
         a: "Vercel automatically creates preview deployments for every PR. Each preview gets a unique URL. Configure this in Vercel's GitHub integration settings.",
       },
     ],
   },
   {
     name: "Billing & Support",
     questions: [
       {
         q: "How does Stripe billing work?",
         a: "We provide Stripe integration ready for subscription billing. The pricing tiers are configured in src/lib/constants.ts. The webhook handler at /api/webhooks/stripe handles subscription lifecycle events.",
       },
       {
         q: "Is there support available?",
         a: "Community support is available through GitHub Issues. Priority support is included with Pro and Enterprise plans. Documentation covers all major features and workflows.",
       },
     ],
   },
 ];
 
export default function FAQPage() {
   return (
     <div className="container py-12 lg:py-20">
       {/* Header */}
       <div className="mx-auto max-w-3xl text-center">
         <Badge variant="secondary" className="mb-4">FAQ</Badge>
         <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
           Frequently asked questions
         </h1>
         <p className="mt-4 text-lg text-muted-foreground">
           Everything you need to know about IndieStack.
         </p>
       </div>
 
       {/* FAQ Categories */}
       <div className="mx-auto mt-16 max-w-3xl space-y-12">
         {faqCategories.map((category) => (
           <div key={category.name}>
             <h2 className="mb-6 text-2xl font-bold">{category.name}</h2>
             <div className="space-y-3">
               {category.questions.map((item) => (
                 <details
                   key={item.q}
                   className="group rounded-lg border bg-card transition-colors hover:border-primary/50"
                 >
                   <summary className="flex cursor-pointer items-center justify-between p-4 text-sm font-medium">
                     {item.q}
                     <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                   </summary>
                   <div className="border-t px-4 py-3 text-sm text-muted-foreground">
                     {item.a}
                   </div>
                 </details>
               ))}
             </div>
           </div>
         ))}
       </div>
 
       {/* Still have questions? */}
       <div className="mx-auto mt-20 max-w-3xl rounded-2xl bg-muted/50 p-12 text-center">
         <h2 className="text-3xl font-bold">Still have questions?</h2>
         <p className="mt-2 text-muted-foreground">
           Can&apos;t find what you&apos;re looking for? Reach out to our team.
         </p>
         <div className="mt-6 flex justify-center gap-4">
           <Button asChild size="lg">
             <Link href={ROUTES.contact}>Contact Us</Link>
           </Button>
           <Button variant="outline" size="lg" asChild>
             <Link href={ROUTES.dashboard}>Go to Dashboard</Link>
           </Button>
         </div>
       </div>
     </div>
   );
 }
