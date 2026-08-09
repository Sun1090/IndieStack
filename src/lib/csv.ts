/**
 * CSV 导出工具
 * 提供将数据导出为 CSV 文件并下载的功能
 */

/**
 * 将二维数组/对象数组转换为 CSV 字符串
 */
export function toCsvString(data: Record<string, unknown>[]): string {
  if (data.length === 0) return "";

  const headers = Object.keys(data[0]);
  const headerRow = headers.map(escapeCsvField).join(",");
  const dataRows = data.map((row) =>
    headers.map((key) => escapeCsvField(String(row[key] ?? ""))).join(","),
  );

  return [headerRow, ...dataRows].join("\n");
}

/**
 * 转义 CSV 字段（处理包含逗号、引号、换行符的情况）
 */
function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * 下载 CSV 文件
 */
export function downloadCsv(
  data: Record<string, unknown>[],
  filename: string = "export.csv",
): void {
  const csvContent = toCsvString(data);
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 生成时间序列数据（用于图表）
 */
export function generateTimeSeriesData(days: number) {
  const data: { date: string; users: number; apiCalls: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    data.push({
      date: date.toISOString().slice(0, 10),
      users: Math.floor(Math.random() * 200) + 50,
      apiCalls: Math.floor(Math.random() * 5000) + 500,
    });
  }
  return data;
}

/**
 * 生成最近事件数据
 */
export function generateRecentEvents() {
  return [
    { event: "新用户注册", time: "12 分钟前", severity: "info" as const },
    { event: "API 速率限制触发", time: "45 分钟前", severity: "warning" as const },
    { event: "数据库备份完成", time: "2 小时前", severity: "success" as const },
    { event: "新部署推送", time: "4 小时前", severity: "info" as const },
    { event: "缓存清理完成", time: "6 小时前", severity: "success" as const },
    { event: "异常流量检测", time: "8 小时前", severity: "warning" as const },
    { event: "SSL 证书即将过期", time: "1 天前", severity: "error" as const },
    { event: "每周数据汇总", time: "1 天前", severity: "info" as const },
  ];
}
