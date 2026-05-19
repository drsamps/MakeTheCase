import React from 'react';

interface HeaderLinkProps {
  onClick: () => void;
  className?: string;
}

const HeaderLink: React.FC<HeaderLinkProps> = ({ onClick, className = '' }) => (
  <button
    onClick={onClick}
    className={`text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline ${className}`}
    type="button"
  >
    Feedback
  </button>
);

export default HeaderLink;
