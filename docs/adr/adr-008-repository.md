# ADR-008: 引入 Repository 数据访问层

日期: 2026-08-23
状态: 已接受（渐进落地）

## 背景
profiles/api_keys/notifications 等表的查询散布在 17+ 个文件，重复的 select/update 链与
as unknown as 类型断言随处可见。

## 决策
新增 `src/lib/repositories/<table>.ts`，按表收口数据访问；Action/Route 只调用仓库函数。
已落地：profiles、api-keys、notifications、audit-logs、webhook-events。

## 迁移策略
触碰即迁移——修改某文件涉及表查询时顺手迁移到 repository，不做一次性大改。

## 影响
- 正面：查询可测试（对 mock 透明）、类型集中、错误处理一致
- 代价：多一层间接；简单查询略显啰嗦
