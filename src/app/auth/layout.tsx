/** 认证页面统一提供主内容 landmark，保证全局 skip link 可用。 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main id="main-content">{children}</main>;
}
