import React from 'react';

export type StatusType = 'completed' | 'in_progress' | 'not_started';

interface StatusBadgeProps {
  status: StatusType;
}

const styles: Record<StatusType, string> = {
  completed: 'bg-green-100 text-green-800 border-green-200',
  in_progress: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  not_started: 'bg-gray-100 text-gray-600 border-gray-200',
};

const labels: Record<StatusType, string> = {
  completed: 'Completed',
  in_progress: 'In Progress',
  not_started: 'No Evaluation',
};

const tooltips: Record<StatusType, string> = {
  completed: 'Student has completed the case and received an evaluation',
  in_progress: 'Student started but has not completed an evaluation yet',
  not_started: 'No evaluation record yet (student may have an active chat - check Monitor tab)',
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  return (
    <span
      className={`px-2 py-1 text-xs font-medium rounded-full border ${styles[status]}`}
      title={tooltips[status]}
    >
      {labels[status]}
    </span>
  );
};

export default StatusBadge;
