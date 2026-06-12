import { Link } from 'react-router-dom';
import { ChevronLeft, Settings } from 'lucide-react';

interface TopBarProps {
  novelTitle: string;
  chapterTitle: string;
  backTo: string;
  onOpenSettings: () => void;
}

export function TopBar({ novelTitle, chapterTitle, backTo, onOpenSettings }: TopBarProps) {
  return (
    <header
      className="flex items-center gap-2 border-b border-edge bg-app/90 px-2 pb-2 backdrop-blur"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
    >
      <Link
        to={backTo}
        aria-label="Back"
        className="rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-main"
      >
        <ChevronLeft className="h-5 w-5" />
      </Link>
      <div className="min-w-0 flex-1 text-center">
        <p className="truncate text-sm font-medium text-main">{novelTitle}</p>
        {chapterTitle && <p className="truncate text-xs text-faint">{chapterTitle}</p>}
      </div>
      <button
        onClick={onOpenSettings}
        aria-label="Reader settings"
        className="rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-main"
      >
        <Settings className="h-5 w-5" />
      </button>
    </header>
  );
}
