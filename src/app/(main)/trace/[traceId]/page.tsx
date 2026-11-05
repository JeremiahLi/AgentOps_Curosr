"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import { canReturnInApp } from "@/components/shell/preserve-main-scroll";
import { SessionDetailView } from "@/components/trace/session-detail-view";

/**
 * Session 详情页（/trace/{sessionId}）。
 *
 * 原来点列表行弹的是右侧浮窗，现在改成真路由页：URL 可分享、刷新不丢、
 * 浏览器后退即返回列表。视图本体在 SessionDetailView 里（与浮窗共用同一套三栏）。
 */
export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = String(params.traceId ?? "");

  const handleBack = useCallback(() => {
    // document.referrer 只反映整页加载来源，站内从看板点进来时它往往是空的。
    // 客户端跳转过才 back，这样能回到进入前的滚动位置；直链打开则去列表。
    if (canReturnInApp()) router.back();
    else router.push("/trace");
  }, [router]);

  return <SessionDetailView sessionId={sessionId} onBack={handleBack} />;
}
