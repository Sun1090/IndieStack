# 架构决策记录（ADR）

> 记录重要的架构决策及其背景。每个决策一个文件，编号递增，只追加不修改。

## 格式模板

```markdown
# ADR-NNN: <决策标题>

日期: YYYY-MM-DD
状态: 提议 | 已接受 | 已废弃（被 ADR-XXX 取代）

## 背景
<为什么需要做这个决策>

## 决策
<选择了什么方案>

## 理由
<为什么选它，放弃了什么备选方案>

## 影响
<带来的正面/负面后果>
```

## 索引

| 编号 | 决策 | 状态 |
|------|------|------|
| [ADR-001](adr-001-data-channel.md) | 写操作统一走 Server Actions | 已接受 |
| [ADR-002](adr-002-cookie-i18n.md) | i18n 采用 Cookie 方案而非 URL 前缀 | 已接受 |
| [ADR-003](adr-003-tanstack-query.md) | 客户端数据层引入 TanStack Query | 已接受 |
