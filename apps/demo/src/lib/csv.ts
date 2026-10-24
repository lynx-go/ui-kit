/**
 * 导出 CSV 配方（design.md §3 派生表：`list.rows` + 消费方 unparse 纯函数——
 * 不是块，不是内置动词；拷走即用）。RFC4180 最小实现：引号转义 + 逗号换行。
 */

function escapeCell(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** rows 的列已由调用方投影（列选择是页面词汇） */
export function toCsv(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>,
): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** 触发浏览器下载（配方收尾动作） */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
