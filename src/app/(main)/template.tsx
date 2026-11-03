/**
 * 每次路由切换重新挂载，让页面入场动画重放一次。
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
