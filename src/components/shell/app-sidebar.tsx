"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Activity,
  LayoutDashboard,
  Gauge,
  Bell,
  Settings,
  Bot,
  Users,
  Search,
  Cpu,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

const navGroups = [
  {
    label: "运营观测",
    items: [
      { label: "概览", href: "/", icon: LayoutDashboard },
      { label: "用户看板", href: "/user-stats", icon: Users, matchPrefixes: ["/user-stats"] },
      { label: "Agent 看板", href: "/agent-board", icon: Bot, matchPrefixes: ["/agent-board"] },
      { label: "Session 看板", href: "/trace", icon: Activity, matchPrefixes: ["/trace"], keywords: ["链路", "追踪", "trace", "会话"] },
      { label: "LLM 看板", href: "/llm", icon: Cpu, matchPrefixes: ["/llm"], keywords: ["模型", "成本", "缓存", "token", "llm"] },
      {
        label: "Tool & Skill 看板",
        href: "/skills",
        icon: Wrench,
        matchPrefixes: ["/skills"],
        keywords: ["工具", "skill", "技能", "tool", "调用", "失败"],
      },
    ],
  },
  {
    label: "质量与告警",
    items: [
      { label: "评测中心", href: "/experiments", icon: Gauge, matchPrefixes: ["/experiments"] },
      { label: "告警中心", href: "/alerts", icon: Bell },
    ],
  },
  {
    label: "系统",
    items: [{ label: "设置", href: "/settings", icon: Settings }],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd + K 聚焦导航搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const kw = query.trim().toLowerCase();
  const visibleGroups = kw
    ? navGroups
        .map((g) => ({
          ...g,
          items: g.items.filter(
            (i) =>
              i.label.toLowerCase().includes(kw) ||
              // 旧名字/英文别名也命中，改名后老习惯不会失效
              ((i as { keywords?: string[] }).keywords ?? []).some((k) => k.toLowerCase().includes(kw)),
          ),
        }))
        .filter((g) => g.items.length > 0)
    : navGroups;

  return (
    <aside className="relative flex h-full w-60 shrink-0 flex-col overflow-hidden bg-sidebar/70 backdrop-blur-xl dark:bg-sidebar/85">
      {/* HUD 装饰层（仅深色模式渲染出效果）：角落辉光 + 噪点 + 缓慢扫光 */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="hud-glow absolute inset-0" />
        <div className="hud-noise absolute inset-0" />
        <div className="hud-sweep absolute -left-[40%] -top-[30%] h-[60%] w-[80%]" />
      </div>

      {/* 右边缘发丝线：中间实、两端渐隐（深色下中段发光） */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-sidebar-border to-transparent"
      />
      <span aria-hidden className="hud-hairline pointer-events-none absolute inset-y-0 right-0 w-px" />

      {/* 品牌区：项目 logo + 渐变光环 + 柔光投影 */}
      <div className="relative flex h-14 items-center gap-2.5 px-4">
        <div className="relative shrink-0 rounded-md bg-brand-gradient p-px shadow-[0_2px_12px_-2px_rgb(90_80_235/0.45)]">
          <Image
            src="/logo.jpg"
            alt="LinkAI Insight"
            width={28}
            height={28}
            className="h-7 w-7 rounded-[7px]"
            priority
          />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-tight">LinkAI Insight</span>
          <span className="font-mono text-[10px] leading-tight tracking-[0.14em] text-muted-foreground">
            AGENT OPS PLATFORM
          </span>
        </div>
      </div>

      {/* 导航搜索：Ctrl/Cmd + K 过滤导航项 */}
      <div className="relative px-3 pb-1">
        <div className="flex h-8 items-center gap-2 rounded-lg bg-foreground/[0.04] px-2.5 ring-1 ring-foreground/5 transition-all focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/25">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索导航"
            className="h-full w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="shrink-0 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              清空
            </button>
          ) : (
            <kbd className="shrink-0 rounded border border-border/80 bg-background/60 px-1 font-mono text-[10px] leading-4 text-muted-foreground/80">
              ⌘K
            </kbd>
          )}
        </div>
      </div>

      <nav className="relative flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-3 py-3 scrollbar-thin">
        {visibleGroups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">无匹配的导航项</p>
        ) : (
          visibleGroups.map((group, gi) => (
            <div key={group.label}>
              {/* 分组标题：mono 编号 + 渐变发丝分隔线 */}
              <div className="mb-1.5 flex items-center gap-2 px-2">
                <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground/70">
                  {String(navGroups.findIndex((g) => g.label === group.label) + 1).padStart(2, "0")}
                </span>
                <span className="text-[11px] font-medium tracking-wider text-muted-foreground/80">
                  {group.label}
                </span>
                <span
                  aria-hidden
                  className="h-px flex-1 bg-gradient-to-r from-primary/25 via-border/40 to-transparent"
                />
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = item.matchPrefixes
                    ? item.matchPrefixes.some((p) => pathname.startsWith(p))
                    : pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onMouseMove={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
                      }}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] transition-all duration-150",
                        active
                          ? "nav-pill bg-card font-medium text-primary shadow-sm ring-1 ring-foreground/[0.06] dark:bg-transparent dark:text-foreground dark:shadow-none dark:ring-0"
                          : "nav-spotlight text-muted-foreground hover:bg-foreground/[0.04] hover:text-sidebar-accent-foreground dark:hover:bg-transparent",
                      )}
                    >
                      {active && (
                        <>
                          {/* 身后的品牌光晕（收紧的小光斑） */}
                          <span
                            aria-hidden
                            className="nav-halo pointer-events-none absolute left-1 top-1/2 h-6 w-10 -translate-y-1/2 rounded-full"
                          />
                          {/* 左侧流动渐变指示条 */}
                          <span className="nav-indicator-flow absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand-gradient" />
                        </>
                      )}
                      <Icon
                        className={cn(
                          "relative h-4 w-4 shrink-0",
                          active
                            ? "text-primary dark:text-primary dark:drop-shadow-[0_0_6px_rgba(88,166,255,0.75)]"
                            : "text-muted-foreground/70",
                        )}
                      />
                      <span className="relative">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </nav>

      {/* 底部用户卡片 */}
      <div className="relative p-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-sidebar-border/60 bg-card/80 px-2.5 py-2 shadow-sm dark:bg-white/[0.04] dark:shadow-none">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-[11px] font-medium text-white shadow-sm">
            Pi
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium text-foreground">管理员</span>
            <span className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
              admin@linkai
            </span>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
