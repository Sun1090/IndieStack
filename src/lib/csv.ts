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
 * 转义 CSV 字段（处理包含逗号、引号、**任意一种**换行符的情况）
 * 同时防御 CSV 公式注入：以 = + - @ 开头的字段加前缀单引号
 */
function escapeCsvField(value: string): string {
  if (/^[=+\-@]/.test(value.trimStart())) {
    value = `'${value}`;
  }
  // CR 单独出现时也算行界：RFC 4180 要求 CR / LF / 引号任一命中都要给整个字段加引号，
  // 否则表格软件把裸 CR 读成一行的结束，一个字段就能在表里造出额外一行。
  if (/["\r\n,]/.test(value)) {
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
