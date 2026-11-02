import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  /**
   * 「Agent 性能看板」已改造为「Agent 看板」并迁到 /agent-board。
   * 重定向放在 src/app/(main)/agent-stats/page.tsx 里用 redirect() 做：
   * 在 Next 16 的 dev 下，config 级 redirects() 与 App Router 路由叠加会互相触发
   * （/agent-board 收到 308 指向自己，形成自循环），页面级 redirect 没有这个问题，
   * 且对外链 / 书签 / router.push 都生效。
   */
};

export default nextConfig;
