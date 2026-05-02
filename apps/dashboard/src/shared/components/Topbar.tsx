import * as React from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@shared/ui/Button'

interface TopbarProps {
  onMenuToggle: () => void
}

export const Topbar = React.memo(function Topbar({ onMenuToggle }: TopbarProps) {
  return (
    <header className="flex h-14 items-center border-b border-neutral-200 bg-white px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMenuToggle}
        aria-label="Menu"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <div className="ml-auto flex items-center gap-4">
        {/* Placeholder for future notifications / user menu */}
      </div>
    </header>
  )
})
Topbar.displayName = 'Topbar'
