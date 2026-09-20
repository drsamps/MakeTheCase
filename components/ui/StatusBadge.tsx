import React from 'react';

/**
 * Every value `case_chats.status` actually holds. The column is a varchar(20),
 * not an ENUM, so the authoritative list is the POSITION_STATUSES whitelist in
 * server/routes/analytics.js; `not_started` is the client-side COALESCE default
 * for a student with no chat row.
 *
 * Keep this union in step with that whitelist. It carried only three of the six
 * real values until 2026-09, so `started`, `abandoned`, `canceled` and `killed`
 * looked up `undefined` in both maps below and rendered as an empty, colourless
 * pill -- most often `abandoned`, which scripts/mark-abandoned-chats.js assigns
 * to every chat left idle for an hour.
 */
export type StatusType =
  | 'started'
  | 'in_progress'
  | 'abandoned'
  | 'canceled'
  | 'killed'
  | 'completed'
  | 'not_started';

const styles: Record<StatusType, string> = {
  started: 'bg-blue-100 text-blue-800 border-blue-200',
  in_progress: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  abandoned: 'bg-gray-100 text-gray-600 border-gray-200',
  canceled: 'bg-gray-100 text-gray-600 border-gray-200',
  killed: 'bg-red-100 text-red-800 border-red-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  not_started: 'bg-gray-100 text-gray-600 border-gray-200',
};

const labels: Record<StatusType, string> = {
  started: 'Started',
  in_progress: 'In Progress',
  abandoned: 'Abandoned',
  canceled: 'Canceled',
  killed: 'Ended by Instructor',
  completed: 'Completed',
  not_started: 'No Evaluation',
};

const tooltips: Record<StatusType, string> = {
  started: 'Chat opened but no messages exchanged yet',
  in_progress: 'Student started but has not completed an evaluation yet',
  abandoned: 'Left idle for more than 60 minutes and closed automatically',
  canceled: 'Student canceled the chat',
  killed: 'An instructor killed this chat from the Monitor screen',
  completed: 'Student has completed the case and received an evaluation',
  not_started: 'No evaluation record yet (student may have an active chat - check Monitor tab)',
};

const UNKNOWN_STYLE = 'bg-gray-100 text-gray-600 border-gray-200';

interface StatusBadgeProps {
  /** Typed for convenience, but treated as a plain string: the value comes from the database. */
  status: StatusType | string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const known = Object.prototype.hasOwnProperty.call(labels, status);
  // A status this component has not been taught renders its raw value rather
  // than an empty pill, so a new one added server-side is visible, not invisible.
  const label = known ? labels[status as StatusType] : String(status || '');
  const style = known ? styles[status as StatusType] : UNKNOWN_STYLE;
  const tooltip = known ? tooltips[status as StatusType] : `Unrecognized status: ${status}`;

  return (
    <span
      className={`px-2 py-1 text-xs font-medium rounded-full border ${style}`}
      title={tooltip}
    >
      {label}
    </span>
  );
};

export default StatusBadge;
