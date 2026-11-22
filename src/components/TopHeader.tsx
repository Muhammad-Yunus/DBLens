import React, { useState, useRef, useEffect } from 'react';
import {
  Menu,
  ChevronsUpDown,
  Bell,
  Plus,
  Check,
  Database,
  LogOut,
  LogIn,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import type { AuthUserDTO, WorkspaceDTO } from '../types/schema.ts';

interface TopHeaderProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  workspace: WorkspaceDTO;
  workspaces: WorkspaceDTO[];
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  user: AuthUserDTO | null;
  storageMode: 'postgresql' | 'memory';
  onOpenAuth: () => void;
  onLogout: () => void;
  notifications: { id: string; title: string; time: string }[];
  onOpenSettings: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  onToggleSidebar,
  workspace,
  workspaces,
  onSelectWorkspace,
  onCreateWorkspace,
  user,
  storageMode,
  onOpenAuth,
  onLogout,
  notifications,
  onOpenSettings,
}) => {
  const [wsOpen, setWsOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const wsRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) setWsOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="h-12 bg-white border-b border-[#E5E7EB] px-3 sm:px-4 flex items-center justify-between shrink-0 z-30 relative">
      {/* Left: Hamburger + Breadcrumb Switcher */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle schema sidebar"
          className="w-7 h-7 rounded-[6px] border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] flex items-center justify-center text-[#4B5563] transition-colors shrink-0 cursor-pointer"
        >
          <Menu className="w-3.5 h-3.5" strokeWidth={1.8} />
        </button>

        <div className="relative min-w-0" ref={wsRef}>
          <button
            type="button"
            onClick={() => setWsOpen((v) => !v)}
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-[#F3F4F6] transition-colors text-[13.5px] leading-none min-w-0 cursor-pointer"
            title="Switch DBLens workspace or schema"
          >
            <span className="text-[#6B7280] font-medium truncate max-w-[110px] sm:max-w-[160px]">
              {workspace.orgSlug}
            </span>
            <span className="text-[#9CA3AF] font-normal">/</span>
            <span className="text-[#111827] font-semibold truncate max-w-[110px] sm:max-w-[160px]">
              {workspace.name}
            </span>
            <ChevronsUpDown className="w-3.5 h-3.5 text-[#6B7280] shrink-0 ml-0.5" />
          </button>

          {wsOpen && (
            <div className="absolute left-0 mt-1.5 w-64 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1.5 z-50">
              <div className="px-3 py-1.5 border-b border-[#F3F4F6] flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  DBLens Workspaces
                </span>
                <span className="text-[11px] text-[#6B7280] font-mono">
                  {storageMode === 'postgresql' ? 'pg' : 'mem'}
                </span>
              </div>
              <div className="max-h-52 overflow-y-auto py-1">
                {(workspaces.length > 0 ? workspaces : [workspace]).map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => {
                      onSelectWorkspace(w.id);
                      setWsOpen(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[13px] flex items-center justify-between hover:bg-[#F9FAFB] transition-colors cursor-pointer"
                  >
                    <span className="truncate">
                      <span className="text-[#6B7280]">{w.orgSlug} / </span>
                      <span className="font-medium text-[#111827]">{w.name}</span>
                    </span>
                    {w.id === workspace.id && (
                      <Check className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
                    )}
                  </button>
                ))}
              </div>
              <div className="border-t border-[#F3F4F6] pt-1 mt-1 px-1.5 flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setWsOpen(false);
                    onCreateWorkspace();
                  }}
                  className="w-full px-2 py-1.5 text-left text-[12.5px] font-medium text-[#374151] hover:bg-[#F3F4F6] rounded flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#6B7280]" />
                  New Schema Workspace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWsOpen(false);
                    onOpenSettings();
                  }}
                  className="w-full px-2 py-1.5 text-left text-[12.5px] font-medium text-[#374151] hover:bg-[#F3F4F6] rounded flex items-center gap-2 cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5 text-[#6B7280]" />
                  Manage DB Connections
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Notification Bell & Circular Avatar */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            aria-label="Notifications"
            className="w-8 h-8 rounded-md hover:bg-[#F3F4F6] flex items-center justify-center text-[#4B5563] transition-colors cursor-pointer"
          >
            <Bell className="w-[17px] h-[17px]" strokeWidth={1.7} />
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-1.5 w-72 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-2 z-50">
              <div className="px-3 pb-1.5 border-b border-[#F3F4F6] flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[#111827]">Schema Activity</span>
                <span className="text-[11px] text-[#6B7280] tabular-nums">
                  {notifications.length} events
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-[#F3F4F6]">
                {notifications.map((n) => (
                  <div key={n.id} className="px-3 py-2 text-[12px]">
                    <p className="text-[#111827] font-medium leading-snug">{n.title}</p>
                    <p className="text-[#9CA3AF] text-[11px] mt-0.5 tabular-nums">{n.time}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={userRef}>
          <button
            type="button"
            onClick={() => setUserOpen((v) => !v)}
            aria-label="Account menu"
            className="w-7 h-7 rounded-full border border-[#D1D5DB] bg-gradient-to-br from-[#F9FAFB] to-[#E5E7EB] hover:border-[#9CA3AF] flex items-center justify-center overflow-hidden transition-colors cursor-pointer"
          >
            {user ? (
              <span className="text-[11px] font-semibold text-[#111827]">
                {user.name.slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <svg viewBox="0 0 28 28" className="w-7 h-7" aria-hidden="true">
                <circle cx="14" cy="14" r="13" fill="#F3F4F6" />
                <circle cx="14" cy="14" r="10.5" fill="none" stroke="#9CA3AF" strokeWidth="0.7" />
                <circle cx="14" cy="14" r="7.5" fill="none" stroke="#9CA3AF" strokeWidth="0.7" />
                <circle cx="14" cy="14" r="4.5" fill="none" stroke="#6B7280" strokeWidth="0.7" />
                <path d="M5 10 Q14 14 23 10" fill="none" stroke="#9CA3AF" strokeWidth="0.6" />
                <path d="M5 18 Q14 14 23 18" fill="none" stroke="#9CA3AF" strokeWidth="0.6" />
              </svg>
            )}
          </button>

          {userOpen && (
            <div className="absolute right-0 mt-1.5 w-60 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1.5 z-50">
              {user ? (
                <>
                  <div className="px-3 py-2 border-b border-[#F3F4F6]">
                    <div className="flex items-center gap-1.5">
                      <UserIcon className="w-3.5 h-3.5 text-[#6B7280]" />
                      <p className="text-[13px] font-semibold text-[#111827] truncate">{user.name}</p>
                    </div>
                    <p className="text-[11.5px] text-[#6B7280] truncate mt-0.5">{user.email}</p>
                    <p className="text-[11px] text-[#4B5563] mt-1 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-[#16A34A]" />
                      Role: {user.role} · {storageMode === 'postgresql' ? 'PostgreSQL' : 'Preview'}
                    </p>
                  </div>
                  <div className="p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setUserOpen(false);
                        onOpenSettings();
                      }}
                      className="w-full px-2.5 py-1.5 text-left text-[12.5px] text-[#374151] hover:bg-[#F3F4F6] rounded flex items-center gap-2 cursor-pointer"
                    >
                      <Database className="w-3.5 h-3.5 text-[#6B7280]" />
                      Datasources & Storage
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUserOpen(false);
                        onLogout();
                      }}
                      className="w-full px-2.5 py-1.5 text-left text-[12.5px] text-[#DC2626] hover:bg-[#FEF2F2] rounded flex items-center gap-2 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out
                    </button>
                  </div>
                </>
              ) : (
                <div className="p-2">
                  <p className="px-1.5 py-1 text-[12px] text-[#6B7280]">
                    Preview session. Sign in to save workspaces and connect PostgreSQL datasources.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setUserOpen(false);
                      onOpenAuth();
                    }}
                    className="mt-1.5 w-full px-3 py-1.5 bg-[#111827] hover:bg-[#1F2937] text-white text-[12.5px] font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    Sign In / Setup Account
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
