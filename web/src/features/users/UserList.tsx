// User management (§6.2, REQ-041–044). List, create, edit role, suspend/reactivate, and delete
// users. Deletion is a §8 dangerous operation naming the user and requiring the operator to type
// the username to confirm (REQ-082).

import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import { DangerConfirm } from '../../components/DangerConfirm';
import type { User } from '../../api/types';

const ROLES = ['default', 'admin', 'manager'] as const;

export function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create form.
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<string>('default');
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUsers(await api.listUsers());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load users');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setBusy(true);
    try {
      await api.createUser({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
      });
      setNewUsername('');
      setNewPassword('');
      setNewRole('default');
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function patch(user: User, changes: Parameters<typeof api.updateUser>[1]) {
    setError(null);
    try {
      await api.updateUser(user.id, changes);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setBusy(true);
    try {
      await api.deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="user-list">
      <ErrorBanner message={error} />

      <form className="create-user" onSubmit={create}>
        <h3>Create user</h3>
        <input
          type="text"
          placeholder="username"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <ErrorBanner message={createError} />
        <button
          type="submit"
          disabled={busy || newUsername.trim() === '' || newPassword === ''}
        >
          Create
        </button>
      </form>

      <table className="entity-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>
                <select
                  value={user.role}
                  onChange={(e) => patch(user, { role: e.target.value })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </td>
              <td>{user.suspended ? 'suspended' : 'active'}</td>
              <td>
                <button
                  type="button"
                  onClick={() => patch(user, { suspended: !user.suspended })}
                >
                  {user.suspended ? 'Reactivate' : 'Suspend'}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => setDeleteTarget(user)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {deleteTarget && (
        <DangerConfirm
          title="Delete user"
          target={deleteTarget.username}
          consequence="Deleting this user permanently removes their account and they lose access. This cannot be undone."
          expectedToken={deleteTarget.username}
          tokenLabel="username"
          confirmLabel="Delete user"
          error={deleteError}
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
        />
      )}
    </section>
  );
}
