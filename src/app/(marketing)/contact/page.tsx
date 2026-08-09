/** * 联系我们页面（服务端组件） * 提供联系表单和联系方式信息（邮箱、GitHub、Twitter） * 表单使用 ContactForm 客户端组件实现提交功能 */

import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with our team",
};

export default function ContactPage() {
  return (
    <div className="container py-12 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <Badge variant="secondary" className="mb-4">Contact</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Get in Touch</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Have a question, feature request, or just want to say hi? We&apos;d love to hear from you.
        </p>

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Send us a Message</CardTitle>
              <CardDescription>
                Fill out the form and we&apos;ll get back to you within 24 hours.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ContactForm />
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Email</CardTitle>
                <CardDescription>hello@indiestack.dev</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>GitHub</CardTitle>
                <CardDescription>github.com/indiestack</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Twitter / X</CardTitle>
                <CardDescription>@indiestack</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Response Time</CardTitle>
                <CardDescription>We typically respond within 24 hours on business days.</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
