"use client";

/**
 * Collapsible — 折叠面板组件（基于 Radix UI）
 * 用于展开/收起内容区域，如 FAQ、侧边栏菜单等
 *
 * @example
 * <Collapsible>
 *   <CollapsibleTrigger>点击展开</CollapsibleTrigger>
 *   <CollapsibleContent>隐藏的内容</CollapsibleContent>
 * </Collapsible>
 */

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

const Collapsible = CollapsiblePrimitive.Root;
const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
const CollapsibleContent = CollapsiblePrimitive.Content;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
