/**
 * Dashboard Help Content
 *
 * This directory contains help content for the Instructor Dashboard.
 * Each file exports a React component that provides help text for a
 * specific section of the dashboard.
 *
 * To add new help content:
 * 1. Create a new file (e.g., NewFeatureHelp.tsx)
 * 2. Export it from this index file
 * 3. Import and use with <HelpTooltip> component
 *
 * See CLAUDE.md for styling guidelines.
 */

export { default as ChatOptionsHelp } from './ChatOptionsHelp';
export { default as ResultsHelp } from './ResultsHelp';

// Future help content exports:
// export { default as AssignmentsHelp } from './AssignmentsHelp';
// export { default as SectionsHelp } from './SectionsHelp';
// export { default as StudentsHelp } from './StudentsHelp';
// export { default as MonitorHelp } from './MonitorHelp';
