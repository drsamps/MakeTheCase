/**
 * VisibilityPicker
 *
 * Reusable Private / Team / Public selector. When Team is chosen, exposes a
 * multi-select of the caller's teams. The Public option is hidden unless the
 * caller has can_publish=1 (admin always can).
 */
import React, { useEffect, useState } from 'react';
import { api } from '../../services/apiClient';

export type Visibility = 'private' | 'team' | 'public';

export interface TeamShare {
  team_id: number;
  access_level?: 'view' | 'edit';
}

interface TeamRow {
  team_id: number;
  team_name: string;
}

interface Props {
  value: Visibility;
  onChange: (v: Visibility) => void;
  teamShares: TeamShare[];
  onTeamSharesChange: (shares: TeamShare[]) => void;
  canPublish: boolean;
  className?: string;
  /** Use text-lg section title (e.g. Case Writer Overview) instead of a field label. */
  sectionHeading?: boolean;
  /** Rendered on the same row as the Private / Team / Public radios (e.g. Save visibility). */
  radioTrailing?: React.ReactNode;
}

const VisibilityPicker: React.FC<Props> = ({
  value, onChange, teamShares, onTeamSharesChange, canPublish, className, sectionHeading, radioTrailing
}) => {
  const [teams, setTeams] = useState<TeamRow[]>([]);

  useEffect(() => {
    if (value === 'team' && teams.length === 0) {
      api.get<TeamRow[]>('/teams/mine').then(({ data, error }) => {
        if (!error && data) setTeams(data);
      });
    }
  }, [value]);

  const toggleTeam = (teamId: number) => {
    const exists = teamShares.find(s => s.team_id === teamId);
    if (exists) {
      onTeamSharesChange(teamShares.filter(s => s.team_id !== teamId));
    } else {
      onTeamSharesChange([...teamShares, { team_id: teamId, access_level: 'view' }]);
    }
  };

  return (
    <div className={className}>
      {sectionHeading ? (
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Visibility</h2>
      ) : (
        <label className="block text-sm font-medium text-gray-700 mb-1">Visibility</label>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={value === 'private'}
            onChange={() => onChange('private')}
          />
          Private
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={value === 'team'}
            onChange={() => onChange('team')}
          />
          Team
        </label>
        {canPublish && (
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={value === 'public'}
              onChange={() => onChange('public')}
            />
            Public
          </label>
        )}
        {radioTrailing}
      </div>

      {value === 'team' && (
        <div className="mt-2 p-2 border border-gray-200 rounded bg-gray-50">
          {teams.length === 0 ? (
            <div className="text-xs text-gray-500">
              You aren't a member of any teams yet. Create one in Teams.
            </div>
          ) : (
            <div className="space-y-1">
              {teams.map(t => {
                const share = teamShares.find(s => s.team_id === t.team_id);
                return (
                  <div key={t.team_id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!share}
                      onChange={() => toggleTeam(t.team_id)}
                    />
                    <span className="flex-1">{t.team_name}</span>
                    {share && (
                      <select
                        value={share.access_level || 'view'}
                        onChange={e => {
                          onTeamSharesChange(
                            teamShares.map(s =>
                              s.team_id === t.team_id
                                ? { ...s, access_level: e.target.value as 'view' | 'edit' }
                                : s
                            )
                          );
                        }}
                        className="text-xs border border-gray-300 rounded px-1 py-0.5"
                      >
                        <option value="view">view</option>
                        <option value="edit">edit</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VisibilityPicker;
