/**
 * 联系表单客户端组件
 * 提供姓名、邮箱、主题、消息等字段的输入和提交功能
 * 使用客户端 i18n 显示文本
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";

export function ContactForm() {
  const t = useTranslations("contact");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Simulate sending — in production, integrate with a form service or API route
    await new Promise((resolve) => setTimeout(resolve, 1000));

    toast({
      title: t("form.success"),
    });

    setName("");
    setEmail("");
    setSubject("");
    setMessage("");
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="name">{t("form.nameLabel")}</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("form.namePlaceholder")}
          required
          disabled={loading}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="contact-email">{t("form.emailLabel")}</Label>
        <Input
          id="contact-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("form.emailPlaceholder")}
          required
          disabled={loading}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="subject">{t("form.subjectLabel")}</Label>
        <Input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t("form.subjectPlaceholder")}
          required
          disabled={loading}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="message">{t("form.messageLabel")}</Label>
        <Textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("form.messagePlaceholder")}
          rows={5}
          required
          disabled={loading}
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? t("form.sending") : t("form.submit")}
        <Send className="ml-2 h-4 w-4" />
      </Button>
    </form>
  );
}
