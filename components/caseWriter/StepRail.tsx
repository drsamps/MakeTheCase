import React from 'react';

export type RailStatus = 'empty' | 'draft' | 'approved';

export interface RailItem {
  key: string;
  label: string;
  status?: RailStatus;
  divider?: boolean;
}

interface Props {
  items: RailItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}

function dotForStatus(status: RailStatus | undefined, active: boolean): React.ReactNode {
  if (active) return <span className="text-blue-600 font-bold">▶</span>;
  if (status === 'approved') return <span className="text-green-600">●</span>;
  if (status === 'draft') return <span className="text-blue-500">◉</span>;
  return <span className="text-gray-300">○</span>;
}

const StepRail: React.FC<Props> = ({ items, activeKey, onSelect }) => {
  return (
    <nav className="w-56 flex-shrink-0 border-r border-gray-200 bg-white">
      <ul className="py-2">
        {items.map((item) => {
          if (item.divider) {
            return (
              <li key={item.key} className="px-3 py-1">
                <div className="border-t border-gray-200" />
              </li>
            );
          }
          const active = item.key === activeKey;
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onSelect(item.key)}
                className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                  active ? 'bg-blue-50 text-blue-900 font-medium border-l-2 border-blue-600' : 'text-gray-700 border-l-2 border-transparent'
                }`}
              >
                <span className="w-4 inline-block text-center">{dotForStatus(item.status, active)}</span>
                <span>{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default StepRail;
