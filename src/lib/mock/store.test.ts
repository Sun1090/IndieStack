import { describe, expect, it } from "vitest";
import { createMockRequestStore } from "./store";

describe("createMockRequestStore()", () => {
  it("在同一 request scope 内缓存并复用值", () => {
    const store = createMockRequestStore();
    const factory = () => ({ count: 0 });

    const first = store.getOrCreate("fixture", factory);
    first.count += 1;
    const second = store.getOrCreate("fixture", factory);

    expect(second).toBe(first);
    expect(second.count).toBe(1);
    expect(store.get("missing")).toBeUndefined();
  });

  it("不同 request scope 之间不共享可变 fixture", () => {
    const first = createMockRequestStore();
    const second = createMockRequestStore();

    const firstRows = first.getOrCreate("rows", () => [] as string[]);
    firstRows.push("first-request");
    const secondRows = second.getOrCreate("rows", () => [] as string[]);

    expect(secondRows).toEqual([]);
    expect(secondRows).not.toBe(firstRows);
  });

  it("支持预置值、覆盖值和清空 scope", () => {
    const store = createMockRequestStore({ user: { id: "u1" } });

    expect(store.get<{ id: string }>("user")).toEqual({ id: "u1" });
    expect(store.set("user", { id: "u2" })).toEqual({ id: "u2" });
    expect(store.get("user")).toEqual({ id: "u2" });

    store.clear();
    expect(store.get("user")).toBeUndefined();
  });
});
