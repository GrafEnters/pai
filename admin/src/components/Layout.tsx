import { NavLink, Outlet } from 'react-router-dom';
import {
  BookOpen,
  Image as ImageIcon,
  FolderTree,
  BarChart3,
  Users as UsersIcon,
  Ticket,
  DatabaseBackup,
  ScrollText,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../auth';
import type { Role } from '../api';

interface NavItem {
  to: string;
  label: string;
  icon: typeof BookOpen;
  role: Role;
  /** Раздел появляется в меню, только когда соответствующий этап сделан —
   *  чтобы в интерфейсе не было ссылок в никуда. */
  ready: boolean;
}

const NAV: NavItem[] = [
  { to: '/guides', label: 'Гайды', icon: BookOpen, role: 'EDITOR', ready: true },
  { to: '/media', label: 'Медиа', icon: ImageIcon, role: 'EDITOR', ready: true },
  { to: '/structure', label: 'Структура', icon: FolderTree, role: 'EDITOR', ready: true },
  { to: '/stats', label: 'Статистика', icon: BarChart3, role: 'ADMIN', ready: true },
  { to: '/users', label: 'Пользователи', icon: UsersIcon, role: 'ADMIN', ready: true },
  { to: '/invites', label: 'Приглашения', icon: Ticket, role: 'ADMIN', ready: true },
  { to: '/backups', label: 'Бэкапы', icon: DatabaseBackup, role: 'ADMIN', ready: true },
  { to: '/audit', label: 'Аудит', icon: ScrollText, role: 'ADMIN', ready: true },
];

const ROLE_LABEL: Record<Role, string> = {
  NONE: 'без доступа',
  VIEWER: 'читатель',
  EDITOR: 'редактор',
  ADMIN: 'администратор',
};

export function Layout() {
  const { user, logout, atLeast } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        <div className="px-4 py-5">
          <div className="text-lg font-semibold text-white">PAI Guides</div>
          <div className="text-xs text-ink-500">админка</div>
        </div>

        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.filter((n) => n.ready && atLeast(n.role)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive ? 'bg-brand-500/15 text-brand-300' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
                }`
              }
            >
              <n.icon size={16} />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-800 p-3">
          <div className="truncate text-sm text-ink-200">{user?.name}</div>
          <div className="text-xs text-ink-500">{user ? ROLE_LABEL[user.role] : ''}</div>
          <button onClick={() => void logout()} className="btn-ghost mt-2 w-full text-xs">
            <LogOut size={14} />
            Выйти
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
