"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback } from "react";
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
    // 从站内跳进来的才 back（保留来源页的筛选/页码体验）；
    // 新标签页或外站直达没有可回的历史，退回列表页
    const sameOriginReferrer =
      typeof document !== "undefined" &&
      document.referrer.startsWith(window.location.origin) &&
      window.history.length > 1;
    if (sameOriginReferrer) router.back();
    else router.push("/trace");
  }, [router]);

  return <SessionDetailView sessionId={sessionId} onBack={handleBack} />;
}
