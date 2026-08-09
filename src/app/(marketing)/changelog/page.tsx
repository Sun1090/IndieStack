/** * 更新日志页面（服务端组件） * 按时间线展示版本发布历史 * 分类标注：新功能 ✨、改进 🔧、Bug 修复 🐛、重大发布 🚀 */

import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/lib/constants";
import { ChevronRight } from "lucide-react";
 
export const metadata: Metadata = {
   title: "Changelog",
   description: "Latest updates, features, and improvements",
 };
 
 const releases = [
   {
     version: "v1.2.0",
     date: "July 15, 2026",
     category: "feature",
     changes: [
       { type: "feature", text: "New analytics dashboard with real-time metrics" },
       { type: "feature", text: "Team invite system with role-based permissions" },
       { type: "improvement", text: "Improved session management and auth performance" },
       { type: "fix", text: "Fixed pagination bug on mobile devices" },
     ],
   },
   {
     version: "v1.1.0",
     date: "June 20, 2026",
     category: "feature",
     changes: [
       { type: "feature", text: "Notification preferences system" },
       { type: "feature", text: "Profile editing with avatar upload" },
       { type: "improvement", text: "Enhanced mobile responsive layout" },
       { type: "fix", text: "OAuth callback handling improvements" },
     ],
   },
   {
     version: "v1.0.0",
     date: "June 1, 2026",
     category: "major",
     changes: [
       { type: "major", text: "Initial public release of IndieStack" },
       { type: "feature", text: "Supabase Auth integration (Email + OAuth)" },
       { type: "feature", text: "Team management with multi-tenancy" },
       { type: "feature", text: "Stripe subscription billing ready" },
       { type: "feature", text: "Sentry error monitoring" },
       { type: "feature", text: "Alibaba Cloud OSS file storage" },
     ],
   },
 ];
 
 const typeStyles: Record<string, string> = {
   feature: "bg-blue-500/10 text-blue-500 border-blue-500/20",
   improvement: "bg-green-500/10 text-green-500 border-green-500/20",
   fix: "bg-amber-500/10 text-amber-500 border-amber-500/20",
   major: "bg-purple-500/10 text-purple-500 border-purple-500/20",
 };
 
 const typeLabels: Record<string, string> = {
   feature: "New Feature",
   improvement: "Improvement",
   fix: "Bug Fix",
   major: "Major Release",
 };
 
export default function ChangelogPage() {
   return (
     <div className="container py-12 lg:py-20">
       {/* Header */}
       <div className="mx-auto max-w-3xl">
         <Badge variant="secondary" className="mb-4">Changelog</Badge>
         <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
           What&apos;s new
         </h1>
         <p className="mt-4 text-lg text-muted-foreground">
           Latest updates, features, and improvements to IndieStack.
         </p>
       </div>
 
       {/* Timeline */}
       <div className="relative mx-auto mt-16 max-w-3xl">
         {/* Timeline line */}
         <div className="absolute left-0 top-0 h-full w-px bg-border md:left-8" />
 
         {releases.map((release, index) => (
           <div key={release.version} className="relative pl-8 pb-12 last:pb-0 md:pl-20">
             {/* Timeline dot */}
             <div className="absolute left-[-4px] top-1 h-2.5 w-2.5 rounded-full border-2 border-primary bg-background md:left-[calc(2rem-4px)]" />
 
             {/* Version badge */}
             <div className="mb-3 flex items-center gap-3">
               <span className="text-lg font-bold">{release.version}</span>
               <span className="text-sm text-muted-foreground">{release.date}</span>
               <Badge variant="outline" className={typeStyles[release.category]}>
                 {typeLabels[release.category]}
               </Badge>
             </div>
 
             {/* Changes */}
             <div className="space-y-2">
               {release.changes.map((change, i) => (
                 <div key={i} className="flex items-start gap-2 text-sm">
                   <span className="mt-1 shrink-0">
                     {change.type === "feature" && "✨"}
                     {change.type === "improvement" && "🔧"}
                     {change.type === "fix" && "🐛"}
                     {change.type === "major" && "🚀"}
                   </span>
                   <span>{change.text}</span>
                 </div>
               ))}
             </div>
           </div>
         ))}
       </div>
 
       {/* CTA */}
       <div className="mx-auto mt-20 max-w-3xl rounded-2xl bg-muted/50 p-12 text-center">
         <h2 className="text-3xl font-bold">Stay up to date</h2>
         <p className="mt-2 text-muted-foreground">
           Follow along with every release. New features ship weekly.
         </p>
         <div className="mt-6 flex justify-center gap-4">
           <Button asChild size="lg">
             <Link href={ROUTES.register}>
               Get Started <ChevronRight className="ml-1 h-4 w-4" />
             </Link>
           </Button>
         </div>
       </div>
     </div>
   );
 }
