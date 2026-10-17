export type NotificationEntityType = 'claim' | 'policy' | 'system';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  entityId: string;
  serverTimestampMs: number;
  source: 'realtime' | 'rest';
}

export interface NotificationGroup {
  groupKey: string;
  entityType: NotificationEntityType;
  entityId: string;
  latestTimestampMs: number;
  unreadCount: number;
  collapsed: boolean;
  items: Array<NotificationItem & { read: boolean }>;
}

export interface NotificationCenterSnapshot {
  totalCount: number;
  unreadCount: number;
  groups: NotificationGroup[];
  latestAriaAnnouncement: string | null;
}

export interface NotificationPersistenceAdapter {
  loadReadIds: () => string[];
  saveReadIds: (ids: string[]) => void;
}

/**
 * Manages the realtime + REST notification inbox with event-ID deduplication,
 * entity grouping, collapse/expand toggles, and cross-tab persisted read state.
 */
export class NotificationCenterStore {
  private readonly itemsById = new Map<string, NotificationItem>();
  private readonly readIds = new Set<string>();
  private readonly collapsedGroups = new Set<string>();
  private readonly persistence?: NotificationPersistenceAdapter;
  private readonly maxItems: number;
  private latestAriaAnnouncement: string | null = null;

  constructor(options: {
    persistence?: NotificationPersistenceAdapter;
    maxItems?: number;
  } = {}) {
    this.persistence = options.persistence;
    this.maxItems = options.maxItems ?? 500;
    if (this.persistence) {
      for (const id of this.persistence.loadReadIds()) {
        this.readIds.add(id);
      }
    }
  }

  /**
   * Ingests a single realtime or REST notification, deduplicating by ID and
   * updating the polite ARIA announcement when a fresh realtime item arrives.
   */
  ingest(item: NotificationItem): boolean {
    const existing = this.itemsById.get(item.id);
    if (existing) {
      // Keep the most recent server timestamp if updated, but do not re-announce
      if (item.serverTimestampMs > existing.serverTimestampMs) {
        this.itemsById.set(item.id, item);
      }
      return false;
    }

    this.itemsById.set(item.id, { ...item });
    this.enforceMaxCapacity();

    if (item.source === 'realtime' && !this.readIds.has(item.id)) {
      this.latestAriaAnnouncement = `New notification: ${item.title}`;
    }

    return true;
  }

  ingestBatch(items: readonly NotificationItem[]): number {
    let added = 0;
    for (const item of items) {
      if (this.ingest(item)) {
        added += 1;
      }
    }
    return added;
  }

  markAsRead(notificationId: string): void {
    if (this.itemsById.has(notificationId) || notificationId.trim().length > 0) {
      this.readIds.add(notificationId);
      this.persistReadState();
    }
  }

  markGroupAsRead(groupKey: string): void {
    for (const item of this.itemsById.values()) {
      if (this.getGroupKey(item) === groupKey) {
        this.readIds.add(item.id);
      }
    }
    this.persistReadState();
  }

  markAllAsRead(): void {
    for (const id of this.itemsById.keys()) {
      this.readIds.add(id);
    }
    this.persistReadState();
  }

  /**
   * Synchronizes read IDs received from another browser tab via storage/BroadcastChannel.
   */
  syncExternalReadIds(externalIds: readonly string[]): void {
    for (const id of externalIds) {
      this.readIds.add(id);
    }
  }

  toggleGroupCollapsed(groupKey: string): boolean {
    if (this.collapsedGroups.has(groupKey)) {
      this.collapsedGroups.delete(groupKey);
      return false;
    }
    this.collapsedGroups.add(groupKey);
    return true;
  }

  getSnapshot(): NotificationCenterSnapshot {
    const sortedItems = Array.from(this.itemsById.values()).sort(
      (a, b) => b.serverTimestampMs - a.serverTimestampMs || a.id.localeCompare(b.id)
    );

    const groupMap = new Map<string, NotificationGroup>();
    let totalUnread = 0;

    for (const item of sortedItems) {
      const isRead = this.readIds.has(item.id);
      if (!isRead) {
        totalUnread += 1;
      }

      const groupKey = this.getGroupKey(item);
      let group = groupMap.get(groupKey);
      if (!group) {
        group = {
          groupKey,
          entityType: item.entityType,
          entityId: item.entityId,
          latestTimestampMs: item.serverTimestampMs,
          unreadCount: 0,
          collapsed: this.collapsedGroups.has(groupKey),
          items: [],
        };
        groupMap.set(groupKey, group);
      }

      if (!isRead) {
        group.unreadCount += 1;
      }
      if (item.serverTimestampMs > group.latestTimestampMs) {
        group.latestTimestampMs = item.serverTimestampMs;
      }
      group.items.push({ ...item, read: isRead });
    }

    const groups = Array.from(groupMap.values()).sort(
      (a, b) => b.latestTimestampMs - a.latestTimestampMs
    );

    return {
      totalCount: sortedItems.length,
      unreadCount: totalUnread,
      groups,
      latestAriaAnnouncement: this.latestAriaAnnouncement,
    };
  }

  private getGroupKey(item: NotificationItem): string {
    return `${item.entityType}:${item.entityId}`;
  }

  private persistReadState(): void {
    this.persistence?.saveReadIds(Array.from(this.readIds));
  }

  private enforceMaxCapacity(): void {
    if (this.itemsById.size <= this.maxItems) return;
    const sorted = Array.from(this.itemsById.values()).sort(
      (a, b) => a.serverTimestampMs - b.serverTimestampMs
    );
    const excess = this.itemsById.size - this.maxItems;
    for (let i = 0; i < excess; i++) {
      this.itemsById.delete(sorted[i].id);
    }
  }
}
