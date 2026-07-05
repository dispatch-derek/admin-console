// §6 users area. The multi-user gate wraps everything: when multi-user mode is OFF the gate shows
// the out-of-band notice and no §6 controls render (REQ-040). When ON, a sub-tab switch selects
// between users, invites, membership, and chat oversight.

import { useState } from 'react';
import { MultiUserGate } from './MultiUserGate';
import { UserList } from './UserList';
import { InviteList } from './InviteList';
import { MembershipPanel } from './MembershipPanel';
import { ChatOversight } from './ChatOversight';

type Tab = 'users' | 'invites' | 'membership' | 'oversight';

const TABS: { id: Tab; label: string }[] = [
  { id: 'users', label: 'Users' },
  { id: 'invites', label: 'Invites' },
  { id: 'membership', label: 'Membership' },
  { id: 'oversight', label: 'Chat Oversight' },
];

export function UsersView() {
  const [tab, setTab] = useState<Tab>('users');

  return (
    <MultiUserGate>
      <div className="users-view">
        <nav className="subnav">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? 'active' : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {tab === 'users' && <UserList />}
        {tab === 'invites' && <InviteList />}
        {tab === 'membership' && <MembershipPanel />}
        {tab === 'oversight' && <ChatOversight />}
      </div>
    </MultiUserGate>
  );
}
