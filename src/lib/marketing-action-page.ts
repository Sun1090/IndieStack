export type MarketingAction = "confirm" | "unsubscribe";

const ACTION_PATHS: Record<MarketingAction, string> = {
  confirm: "/api/marketing/confirm",
  unsubscribe: "/api/marketing/unsubscribe",
};

interface MarketingActionPageProps {
  action: MarketingAction;
  title: string;
  submitLabel: string;
  token: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders the non-mutating GET confirmation page. The action path is selected
 * from a fixed map and all dynamic values are explicitly HTML-escaped.
 */
export function renderMarketingActionPage({
  action,
  title,
  submitLabel,
  token,
}: MarketingActionPageProps): string {
  const actionPath = ACTION_PATHS[action];
  const safeToken = escapeHtml(token);

  return `<!doctype html><html lang="zh-CN"><head><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1><form method="post" action="${escapeHtml(actionPath)}"><input type="hidden" name="token" value="${safeToken}"><button type="submit">${escapeHtml(submitLabel)}</button></form></main></body></html>`;
}
