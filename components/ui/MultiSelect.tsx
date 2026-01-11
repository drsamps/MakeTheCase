import React, { useState, useRef, useEffect } from 'react';

export interface MultiSelectOption {
  value: string;
  label: string;
  subtitle?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  allLabel?: string;
  className?: string;
  countLabel?: string; // e.g., "columns showing" - used instead of "selected"
  defaultLabel?: string; // e.g., "Default Columns" - shown as button in dropdown
  defaultValues?: string[]; // Values to set when default is clicked
}

const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  selected,
  onChange,
  placeholder = 'Select...',
  allLabel = 'ALL',
  className = '',
  countLabel = 'selected',
  defaultLabel,
  defaultValues
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const isAllSelected = selected.includes('all') || selected.length === 0;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggleAll = () => {
    if (isAllSelected) {
      // If all is selected, do nothing (can't deselect all)
      return;
    }
    onChange(['all']);
  };

  const handleToggleOption = (value: string) => {
    if (value === 'all') {
      handleToggleAll();
      return;
    }

    let newSelected: string[];

    if (isAllSelected) {
      // Switching from "all" to specific selection
      newSelected = [value];
    } else if (selected.includes(value)) {
      // Deselecting an option
      const filtered = selected.filter(v => v !== value);
      newSelected = filtered.length === 0 ? ['all'] : filtered;
    } else {
      // Adding an option
      newSelected = [...selected.filter(v => v !== 'all'), value];
    }

    onChange(newSelected);
  };

  const filteredOptions = options.filter(opt =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (opt.subtitle && opt.subtitle.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getDisplayText = () => {
    if (isAllSelected) return allLabel;
    if (selected.length === 1) {
      const opt = options.find(o => o.value === selected[0]);
      return opt ? opt.label : selected[0];
    }
    return `${selected.length} ${countLabel}`;
  };

  const handleSetDefault = () => {
    if (defaultValues && defaultValues.length > 0) {
      onChange(defaultValues);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white hover:border-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <span className={isAllSelected ? 'text-gray-500' : 'text-gray-900'}>
          {getDisplayText()}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-hidden">
          {options.length > 5 && (
            <div className="p-2 border-b border-gray-200">
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          )}

          <div className="overflow-y-auto max-h-48">
            {/* ALL option */}
            <label className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={handleToggleAll}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm font-medium text-gray-700">{allLabel}</span>
            </label>

            {/* Default option button */}
            {defaultLabel && defaultValues && (
              <button
                type="button"
                onClick={handleSetDefault}
                className="w-full flex items-center px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 text-left"
              >
                <svg className="h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
                <span className="ml-2 text-sm font-medium text-blue-600">{defaultLabel}</span>
              </button>
            )}

            {/* Individual options */}
            {filteredOptions.map(option => (
              <label
                key={option.value}
                className="flex items-start px-3 py-2 hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!isAllSelected && selected.includes(option.value)}
                  onChange={() => handleToggleOption(option.value)}
                  className="h-4 w-4 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="ml-2">
                  <span className="text-sm text-gray-900">{option.label}</span>
                  {option.subtitle && (
                    <span className="block text-xs text-gray-500">{option.subtitle}</span>
                  )}
                </div>
              </label>
            ))}

            {filteredOptions.length === 0 && searchTerm && (
              <div className="px-3 py-2 text-sm text-gray-500">No matches found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiSelect;
