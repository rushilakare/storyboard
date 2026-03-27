import type { FeatureIssue } from '@/lib/database.types';

export function issueStatusLabel(status: string): string {
  const map: Record<string, string> = {
    open: 'Open',
    in_progress: 'In progress',
    in_review: 'In review',
    done: 'Done',
    blocked: 'Blocked',
    cancelled: 'Cancelled',
  };
  return map[status] ?? status.replace(/_/g, ' ');
}

export function issuePriorityLabel(priority: string): string {
  const map: Record<string, string> = {
    lowest: 'Lowest',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    highest: 'Highest',
  };
  return map[priority] ?? priority;
}

export const ISSUE_STATUS_OPTIONS: FeatureIssue['status'][] = [
  'open',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
];

export const ISSUE_PRIORITY_OPTIONS: FeatureIssue['priority'][] = [
  'lowest',
  'low',
  'medium',
  'high',
  'highest',
];
