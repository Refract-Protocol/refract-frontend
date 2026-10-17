import { describe, expect, it } from 'vitest';
import { NotificationCenterStore } from '../notification-center-store';

describe('NotificationCenterStore', () => {
  it('deduplicates realtime and REST items by ID and groups related events ordered by server timestamp', () => {
    const store = new NotificationCenterStore();

    store.ingestBatch([
      {
        id: 'notif-1',
        title: 'Claim Submitted',
        message: 'Claim #42 was submitted',
        entityType: 'claim',
        entityId: 'claim-42',
        serverTimestampMs: 1_000,
        source: 'rest',
      },
      {
        id: 'notif-1',
        title: 'Claim Submitted',
        message: 'Duplicate from realtime',
        entityType: 'claim',
        entityId: 'claim-42',
        serverTimestampMs: 1_000,
        source: 'realtime',
      },
      {
        id: 'notif-2',
        title: 'Claim Settled',
        message: 'Claim #42 payout settled',
        entityType: 'claim',
        entityId: 'claim-42',
        serverTimestampMs: 5_000,
        source: 'realtime',
      },
      {
        id: 'notif-3',
        title: 'Policy Active',
        message: 'Policy #99 is now active',
        entityType: 'policy',
        entityId: 'policy-99',
        serverTimestampMs: 3_000,
        source: 'realtime',
      },
    ]);

    const snapshot = store.getSnapshot();
    expect(snapshot.totalCount).toBe(3);
    expect(snapshot.unreadCount).toBe(3);
    expect(snapshot.groups).toHaveLength(2);
    expect(snapshot.groups[0].groupKey).toBe('claim:claim-42');
    expect(snapshot.groups[0].items.map((i) => i.id)).toEqual(['notif-2', 'notif-1']);
    expect(snapshot.latestAriaAnnouncement).toBe('New notification: Policy Active');
  });

  it('persists markAsRead and markAllAsRead across reloads and supports group collapse toggles', () => {
    let persistedIds: string[] = [];
    const persistence = {
      loadReadIds: () => persistedIds,
      saveReadIds: (ids: string[]) => {
        persistedIds = [...ids];
      },
    };

    const store = new NotificationCenterStore({ persistence });
    store.ingest({
      id: 'n-10',
      title: 'Oracle Triggered',
      message: 'Trigger fired',
      entityType: 'claim',
      entityId: 'c-10',
      serverTimestampMs: 2_000,
      source: 'realtime',
    });
    store.ingest({
      id: 'n-11',
      title: 'Payout Sent',
      message: 'Sent to wallet',
      entityType: 'claim',
      entityId: 'c-10',
      serverTimestampMs: 4_000,
      source: 'realtime',
    });

    store.markAsRead('n-10');
    expect(store.getSnapshot().unreadCount).toBe(1);

    // Reloaded store restores persisted read state
    const reloaded = new NotificationCenterStore({ persistence });
    reloaded.ingest({
      id: 'n-10',
      title: 'Oracle Triggered',
      message: 'Trigger fired',
      entityType: 'claim',
      entityId: 'c-10',
      serverTimestampMs: 2_000,
      source: 'rest',
    });
    expect(reloaded.getSnapshot().unreadCount).toBe(0);

    // Collapse toggle
    expect(store.toggleGroupCollapsed('claim:c-10')).toBe(true);
    expect(store.getSnapshot().groups[0].collapsed).toBe(true);

    store.markAllAsRead();
    expect(store.getSnapshot().unreadCount).toBe(0);
  });
});
