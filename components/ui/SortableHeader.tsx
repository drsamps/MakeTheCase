import React from 'react';

interface SortableHeaderProps<T extends string> {
  label: string;
  sortKey: T;
  currentSortKey: T | null;
  sortDirection: 'asc' | 'desc';
  onSort: (key: T) => void;
}

function SortableHeader<T extends string>({
  label,
  sortKey,
  currentSortKey,
  sortDirection,
  onSort
}: SortableHeaderProps<T>) {
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
    >
      <div className="flex items-center gap-2">
        <span>{label}</span>
        {currentSortKey === sortKey && (
          <svg
            className={`w-4 h-4 transition-transform ${sortDirection === 'asc' ? 'rotate-180' : ''}`}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.5a.75.75 0 01-1.5 0V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
            <path fillRule="evenodd" d="M5.22 9.22a.75.75 0 011.06 0L10 12.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 10.28a.75.75 0 010-1.06z" clipRule="evenodd" />
          </svg>
        )}
      </div>
    </th>
  );
}

export default SortableHeader;
