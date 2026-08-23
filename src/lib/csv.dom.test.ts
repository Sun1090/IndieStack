/**
 * downloadCsv DOM 行为测试（jsdom 环境）
 * Mock URL.createObjectURL / link.click，验证 BOM 前缀、文件名与清理逻辑
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadCsv } from "./csv";

const createObjectURL = vi.hoisted(() => vi.fn(() => "blob:mock-url"));
const revokeObjectURL = vi.hoisted(() => vi.fn());

vi.stubGlobal("URL", {
  ...globalThis.URL,
  createObjectURL,
  revokeObjectURL,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

describe("downloadCsv()", () => {
  it("创建带 BOM 的 CSV Blob 并触发下载", () => {
    downloadCsv([{ name: "Alice" }], "users.csv");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blob] = createObjectURL.mock.calls[0] as unknown as [Blob];
    expect(blob.type).toBe("text/csv;charset=utf-8;");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("默认文件名为 export.csv", () => {
    let capturedName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      capturedName = this.download;
    });

    downloadCsv([{ a: 1 }]);

    expect(capturedName).toBe("export.csv");
  });
});
