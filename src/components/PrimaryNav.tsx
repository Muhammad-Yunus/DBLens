import React from 'react';
import {
  LayoutPanelLeft,
  BookOpen,
  ListChecks,
  PlayCircle,
  Globe,
  Tag,
  Settings,
} from 'lucide-react';

export type PrimaryTabId =
  | 'overview'
  | 'docs'
  | 'ci-runs'
  | 'migrations'
  | 'webhooks'
  | 'tags'
  | 'settings';

interface PrimaryNavProps {
  activeTab: PrimaryTabId;
  onChangeTab: (tab: PrimaryTabId) => void;
}

const NAV_ITEMS: { id: PrimaryTabId; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutPanelLeft },
  { id: 'docs', label: 'Docs', icon: BookOpen },
  { id: 'ci-runs', label: 'CI Runs', icon: ListChecks },
  { id: 'migrations', label: 'Migrations', icon: PlayCircle },
  { id: 'webhooks', label: 'Webhooks', icon: Globe },
  { id: 'tags', label: 'Tags', icon: Tag },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const PrimaryNav: React.FC<PrimaryNavProps> = ({ activeTab, onChangeTab }) => {
  return (
    <nav
      aria-label="Primary sections"
      className="h-11 bg-white border-b border-[#E5E7EB] px-3 sm:px-4 flex items-center gap-5 sm:gap-6 overflow-x-auto no-scrollbar shrink-0 z-20"
    >
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChangeTab(item.id)}
            className={`h-full flex items-center gap-1.5 text-[13px] whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
              isActive
                ? 'border-[#111827] text-[#111827] font-semibold'
                : 'border-transparent text-[#4B5563] hover:text-[#111827] font-medium'
            }`}
          >
            <Icon
              className={`w-[15px] h-[15px] shrink-0 ${
                isActive ? 'text-[#111827]' : 'text-[#6B7280]'
              }`}
              strokeWidth={1.7}
            />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
