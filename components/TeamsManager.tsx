/**
 * TeamsManager
 *
 * Self-service team management for instructors. Lists teams the caller
 * belongs to, lets them create new teams, view members, send invitations,
 * and respond to pending invitations addressed to them.
 *
 * Admins not impersonating an instructor see all teams (read-only summary).
 * Owners can rename, invite, remove members, and delete their team.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../services/apiClient';
import HelpTooltip from './ui/HelpTooltip';
import { TeamsHelp } from '../help/dashboard';

type Role = 'owner' | 'editor' | 'viewer';

interface TeamSummary {
  id: string;
  team_name: string;
  description: string | null;
  created_by: string;
  member_count: number;
  my_role?: Role;
  created_at: string;
}

interface MemberRow {
  instructor_id: string;
  role: Role;
  joined_at: string;
  email: string;
  full_name: string;
}

interface InvitationRow {
  id: number;
  invited_email: string;
  invited_by: string;
  proposed_role: Role;
  status: string;
  created_at: string;
  responded_at: string | null;
}

interface TeamDetail extends TeamSummary {
  my_role: Role | null;
  members: MemberRow[];
  invitations: InvitationRow[];
}

interface MyInvite {
  id: number;
  team_id: string;
  team_name: string;
  invited_by: string;
  invited_by_name: string | null;
  proposed_role: Role;
  created_at: string;
}

const ROLE_OPTIONS: Role[] = ['owner', 'editor', 'viewer'];

function apiErrorMessage(message: unknown): string {
  return typeof message === 'string' ? message : 'Request failed';
}

const TeamsManager: React.FC = () => {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [myInvites, setMyInvites] = useState<MyInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Create-team form
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('viewer');
  const [inviting, setInviting] = useState(false);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data: tData, error: tErr }, { data: iData }] = await Promise.all([
      api.get<TeamSummary[]>('/teams'),
      api.get<MyInvite[]>('/teams/invitations/mine'),
    ]);
    setLoading(false);
    if (tErr) setError(apiErrorMessage(tErr.message));
    setTeams(tData || []);
    setMyInvites(iData || []);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setError(null);
    const { data, error } = await api.get<TeamDetail>(`/teams/${id}`);
    if (error) {
      setError(apiErrorMessage(error.message));
      setDetail(null);
      return;
    }
    setDetail(data);
  }, []);

  useEffect(() => { loadTeams(); }, [loadTeams]);
  useEffect(() => {
    if (selectedTeamId) loadDetail(selectedTeamId);
    else setDetail(null);
  }, [selectedTeamId, loadDetail]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    const { data, error } = await api.post<TeamSummary>('/teams', {
      team_name: newName.trim(),
      description: newDesc.trim() || null,
    });
    setCreating(false);
    if (error) { setError(apiErrorMessage(error.message)); return; }
    setNewName('');
    setNewDesc('');
    setMessage(`Team "${data?.team_name}" created`);
    await loadTeams();
    if (data?.id) setSelectedTeamId(data.id);
  };

  const handleDeleteTeam = async (id: string, name: string) => {
    if (!confirm(`Delete team "${name}"? This revokes all shares and removes all members.`)) return;
    const { error } = await api.delete(`/teams/${id}`);
    if (error) { setError(apiErrorMessage(error.message)); return; }
    setMessage(`Team "${name}" deleted`);
    setSelectedTeamId(null);
    await loadTeams();
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeamId || !inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    const { error } = await api.post(`/teams/${selectedTeamId}/invitations`, {
      email: inviteEmail.trim(),
      role: inviteRole,
    });
    setInviting(false);
    if (error) { setError(apiErrorMessage(error.message)); return; }
    setMessage(`Invitation sent to ${inviteEmail}`);
    setInviteEmail('');
    await loadDetail(selectedTeamId);
  };

  const handleRevokeInvite = async (inv: InvitationRow) => {
    if (!confirm(`Revoke invitation for ${inv.invited_email} (${inv.proposed_role})?`)) return;
    const { error } = await api.post(`/teams/invitations/${inv.id}/revoke`);
    if (error) { setError(apiErrorMessage(error.message)); return; }
    if (selectedTeamId) await loadDetail(selectedTeamId);
  };

  const handleRemoveMember = async (instructorId: string, name: string) => {
    if (!selectedTeamId) return;
    if (!confirm(`Remove ${name} from this team?`)) return;
    const { error } = await api.delete(`/teams/${selectedTeamId}/members/${instructorId}`);
    if (error) { setError(apiErrorMessage(error.message)); return; }
    await loadDetail(selectedTeamId);
  };

  const handleChangeRole = async (instructorId: string, role: Role) => {
    if (!selectedTeamId) return;
    const { error } = await api.patch(`/teams/${selectedTeamId}/members/${instructorId}`, { role });
    if (error) { setError(apiErrorMessage(error.message)); return; }
    await loadDetail(selectedTeamId);
  };

  const handleAcceptInvite = async (invId: number) => {
    const { error } = await api.post(`/teams/invitations/${invId}/accept`);
    if (error) { setError(apiErrorMessage(error.message)); return; }
    setMessage('Invitation accepted');
    await loadTeams();
  };

  const handleDeclineInvite = async (invId: number) => {
    const { error } = await api.post(`/teams/invitations/${invId}/decline`);
    if (error) { setError(apiErrorMessage(error.message)); return; }
    await loadTeams();
  };

  const isOwner = detail?.my_role === 'owner';

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Teams</h2>
        <HelpTooltip title="Teams"><TeamsHelp /></HelpTooltip>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
          {message}
        </div>
      )}

      {myInvites.length > 0 && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded">
          <h3 className="font-medium text-blue-900 mb-2">Pending invitations ({myInvites.length})</h3>
          <div className="space-y-2">
            {myInvites.map(inv => (
              <div key={inv.id} className="flex items-center justify-between bg-white p-2 rounded border border-blue-100">
                <div className="text-sm">
                  <span className="font-medium">{inv.team_name}</span>
                  <span className="text-gray-600"> &mdash; invited by {inv.invited_by_name || inv.invited_by} as {inv.proposed_role}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleAcceptInvite(inv.id)} className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700">Accept</button>
                  <button onClick={() => handleDeclineInvite(inv.id)} className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">Decline</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left column: team list + create */}
        <div className="md:col-span-1">
          <div className="bg-white border border-gray-200 rounded">
            <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-gray-900 text-sm">Your teams</h3>
            </div>
            <div className="divide-y divide-gray-100">
              {loading ? (
                <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>
              ) : teams.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">No teams yet.</div>
              ) : teams.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTeamId(t.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                    selectedTeamId === t.id ? 'bg-purple-50' : ''
                  }`}
                >
                  <div className="font-medium text-gray-900">{t.team_name}</div>
                  <div className="text-xs text-gray-500">
                    {t.member_count} member{t.member_count === 1 ? '' : 's'}
                    {t.my_role && ` · ${t.my_role}`}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleCreate} className="mt-4 bg-white border border-gray-200 rounded p-3">
            <h3 className="font-medium text-gray-900 text-sm mb-2">Create new team</h3>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Team name"
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded mb-2"
              maxLength={150}
              required
            />
            <textarea
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded mb-2"
              rows={2}
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="w-full px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create team'}
            </button>
          </form>
        </div>

        {/* Right column: team detail */}
        <div className="md:col-span-2">
          {!detail ? (
            <div className="bg-white border border-gray-200 rounded p-6 text-center text-sm text-gray-500">
              Select a team to manage members and invitations.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">{detail.team_name}</h3>
                  {detail.description && (
                    <p className="text-sm text-gray-500 mt-0.5">{detail.description}</p>
                  )}
                </div>
                {isOwner && (
                  <button
                    onClick={() => handleDeleteTeam(detail.id, detail.team_name)}
                    className="px-2 py-1 text-xs text-red-700 border border-red-200 rounded hover:bg-red-50"
                  >
                    Delete team
                  </button>
                )}
              </div>

              {/* Members */}
              <div className="px-4 py-3">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Members ({(detail.members ?? []).length})</h4>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {(detail.members ?? []).map(m => (
                      <tr key={m.instructor_id}>
                        <td className="py-1.5">
                          <div className="font-medium text-gray-900">{m.full_name}</div>
                          <div className="text-xs text-gray-500">{m.email}</div>
                        </td>
                        <td className="py-1.5 w-32">
                          {isOwner ? (
                            <select
                              value={m.role}
                              onChange={e => handleChangeRole(m.instructor_id, e.target.value as Role)}
                              className="text-xs border border-gray-300 rounded px-1 py-0.5"
                            >
                              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          ) : (
                            <span className="text-xs text-gray-600">{m.role}</span>
                          )}
                        </td>
                        <td className="py-1.5 w-20 text-right">
                          {isOwner && (
                            <button
                              onClick={() => handleRemoveMember(m.instructor_id, m.full_name)}
                              className="text-xs text-red-700 hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pending invitations */}
              {(detail.invitations ?? []).length > 0 && (
                <div className="px-4 py-3 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Pending invitations</h4>
                  <ul className="space-y-1 text-sm">
                    {(detail.invitations ?? []).map(inv => (
                      <li key={inv.id} className="flex items-center justify-between">
                        <span>{inv.invited_email} <span className="text-xs text-gray-500">({inv.proposed_role})</span></span>
                        {isOwner && (
                          <button
                            onClick={() => handleRevokeInvite(inv)}
                            className="text-xs text-red-700 hover:underline"
                          >
                            Revoke
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Invite form */}
              {isOwner && (
                <form onSubmit={handleInvite} className="px-4 py-3 border-t border-gray-100 bg-gray-50">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Invite an instructor</h4>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="instructor@example.com"
                      className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                      required
                    />
                    <select
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as Role)}
                      className="text-sm border border-gray-300 rounded px-1 py-1"
                    >
                      {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button
                      type="submit"
                      disabled={inviting || !inviteEmail.trim()}
                      className="px-3 py-1 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                    >
                      {inviting ? 'Sending...' : 'Invite'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeamsManager;
