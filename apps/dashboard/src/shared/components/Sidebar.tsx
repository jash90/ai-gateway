import * as React from 'react'
import {
  LayoutDashboard,
  BarChart3,
  AppWindow,
  Key,
  Terminal,
  Settings,
  Bell,
  Link,
  FileText,
  BookOpen,
  ChevronLeft,
  LogOut,
} from 'lucide-react'
import { Link as RouterLink, useRouter } from '@tanstack/react-router'
import { cn } from '@shared/utils/cn'
import { useAuthStore } from '@shared/stores/auth-store'
import { Button } from '@shared/ui/Button'
import { Separator } from '@shared/ui/Separator'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
}

const userNav: NavItem[] = [
  { label: 'Przegląd', href: '/overview', icon: <LayoutDashboard className="h-4 w-4" /> },
  { label: 'Aplikacje', href: '/applications', icon: <AppWindow className="h-4 w-4" /> },
  { label: 'Klucze BYOK', href: '/settings/provider-keys', icon: <Key className="h-4 w-4" /> },
  { label: 'Analityka', href: '/analytics', icon: <BarChart3 className="h-4 w-4" /> },
  { label: 'Playground', href: '/proxy/playground', icon: <Terminal className="h-4 w-4" /> },
  { label: 'Ustawienia', href: '/settings', icon: <Settings className="h-4 w-4" /> },
  { label: 'Webhooki', href: '/settings/webhooks', icon: <Link className="h-4 w-4" /> },
  { label: 'Alerty', href: '/settings/alerts', icon: <Bell className="h-4 w-4" /> },
  { label: 'Dokumentacja', href: '/docs', icon: <BookOpen className="h-4 w-4" /> },
]

const adminNav: NavItem[] = [
  { label: 'Admin', href: '/admin', icon: <FileText className="h-4 w-4" /> },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export const Sidebar = React.memo(function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const router = useRouter()
  const pathname = router.state.location.pathname
  const { account, logout } = useAuthStore()

  const handleLogout = () => {
    logout()
    router.navigate({ to: '/login' })
  }

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-neutral-200 bg-white transition-all duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-neutral-200 px-4">
        {!collapsed && (
          <span className="text-lg font-bold text-neutral-900">AI Gateway</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          aria-label={collapsed ? 'Rozwiń menu' : 'Zwiń menu'}
        >
          <ChevronLeft
            className={cn(
              'h-4 w-4 transition-transform',
              collapsed && 'rotate-180',
            )}
          />
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {userNav.map((item) => (
            <RouterLink
              key={item.href}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-100',
                pathname.startsWith(item.href)
                  ? 'bg-neutral-100 text-neutral-900'
                  : 'text-neutral-600',
                collapsed && 'justify-center px-2',
              )}
            >
              {item.icon}
              {!collapsed && <span>{item.label}</span>}
            </RouterLink>
          ))}
        </div>

        {account?.role === 'ADMIN' && (
          <>
            <Separator className="my-2" />
            <div className="space-y-1">
              {adminNav.map((item) => (
                <RouterLink
                  key={item.href}
                  to={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-100',
                    pathname.startsWith(item.href)
                      ? 'bg-neutral-100 text-neutral-900'
                      : 'text-neutral-600',
                    collapsed && 'justify-center px-2',
                  )}
                >
                  {item.icon}
                  {!collapsed && <span>{item.label}</span>}
                </RouterLink>
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-neutral-200 p-2">
        {!collapsed && account && (
          <div className="mb-2 px-3 py-1">
            <p className="text-sm font-medium text-neutral-900 truncate">
              {account.name ?? account.email}
            </p>
            {account.name && (
              <p className="text-xs text-neutral-500 truncate">{account.email}</p>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'default'}
          className={cn('w-full', !collapsed && 'justify-start')}
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Wyloguj</span>}
        </Button>
      </div>
    </aside>
  )
})
Sidebar.displayName = 'Sidebar'
