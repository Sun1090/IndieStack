# ADR-006: Server Actions 统一 ActionResult 判别联合

日期: 2026-08-23
状态: 已接受

## 背景
存量 Action 返回形状混乱：`{error}` / `{success:true,data}` / `{data,error:null}` 三种并存，
客户端判空逻辑各写各的。

## 决策
定义 `ActionResult<T> = { ok:true; data?:T } | { ok:false; error:string }`（lib/types/action-result.ts），
error 一律为 i18n 键。全部 6 个 action 文件与消费方已迁移。

## 影响
- 正面：客户端统一 `if (!result.ok)` 收窄；类型系统强制处理失败分支
- 负面：ok 字段使响应体略大；旧调用方升级需同步修改测试断言
