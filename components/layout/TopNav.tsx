"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/catalog", label: "首页" },
  { href: "/style-library", label: "款式库" },
  { href: "/quick-try-on", label: "一键试戴" },
  { href: "/precise-try-on", label: "精准试戴" },
  { href: "/batch-results", label: "一键试戴结果" },
  { href: "/recommend", label: "智能助手" },
  { href: "/want-list", label: "我的" },
];

export default function TopNav() {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <Link className="brand" href="/catalog" aria-label="美甲 AI 试戴首页">
        <span className="brand-mark" />
        <span>指尖灵感</span>
        <span style={{ fontSize: "10px", opacity: 0.5, fontWeight: 400, letterSpacing: "0.02em", marginLeft: "4px", alignSelf: "flex-end", lineHeight: 1.6 }}>v1.0.1</span>
      </Link>
      <nav className="tabs" aria-label="页面导航">
        {navItems.map((item) => {
          const active =
            pathname === item.href ||
            (item.label === "首页" && pathname === "/catalog");
          return (
            <Link key={`${item.href}-${item.label}`} className={cn("tab", active && "active")} href={item.href}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="user-chip" aria-label="当前用户身份">
        <span>匿名用户</span>
        <strong>guest-nail-2026</strong>
        <button type="button">模拟登录</button>
      </div>
    </header>
  );
}
