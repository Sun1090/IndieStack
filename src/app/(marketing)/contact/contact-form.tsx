/**
 * 联系表单客户端组件
 * 提供姓名、邮箱、主题、消息等字段的输入和提交功能
 * 使用客户端 i18n 显示文本
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormFieldControl } from "@/components/shared/form-field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { submitContactMessage } from "@/lib/actions/contact";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";

export function ContactForm() {
  const t = useTranslations("contact");
  const ta = useTranslations("actions");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.target as HTMLFormElement);
    const result = await submitContactMessage(formData);

    if (!result.ok) {
      toast({ title: t("form.unavailable"), description: ta(result.error), variant: "destructive" });
      setLoading(false);
      return;
    }

    toast({ title: t("form.success") });

    setName("");
    setEmail("");
    setSubject("");
    setMessage("");
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormField htmlFor="name" label={t("form.nameLabel")} className="grid gap-2">
        <FormFieldControl>
          <Input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("form.namePlaceholder")}
            required
            disabled={loading}
          />
        </FormFieldControl>
      </FormField>
      <FormField htmlFor="contact-email" label={t("form.emailLabel")} className="grid gap-2">
        <FormFieldControl>
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("form.emailPlaceholder")}
            required
            disabled={loading}
          />
        </FormFieldControl>
      </FormField>
      <FormField htmlFor="subject" label={t("form.subjectLabel")} className="grid gap-2">
        <FormFieldControl>
          <Input
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("form.subjectPlaceholder")}
            required
            disabled={loading}
          />
        </FormFieldControl>
      </FormField>
      <FormField htmlFor="message" label={t("form.messageLabel")} className="grid gap-2">
        <FormFieldControl>
          <Textarea
            name="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("form.messagePlaceholder")}
            rows={5}
            required
            disabled={loading}
          />
        </FormFieldControl>
      </FormField>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? t("form.sending") : t("form.submit")}
        <Send className="ms-2 h-4 w-4" />
      </Button>
    </form>
  );
}
