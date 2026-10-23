export type PushPromptTrigger =
  | 'page_load'
  | 'post_purchase'
  | 'notification_settings'

export type PushPermissionStatus =
  | 'default'
  | 'granted'
  | 'denied'
  | 'unsupported'

export interface RawClaimPushPayload {
  eventId: string
  eventType: 'claim_settled' | 'claim_approved' | 'claim_denied' | 'oracle_triggered'
  claimId?: string
  policyId?: string
  riskClass?: string
  walletAddress?: string
  payoutAmountUsd?: number
}

export interface SanitizedWebPushNotification {
  eventId: string
  title: string
  body: string
  deepLinkUrl: string
  tag: string
}

export interface WebPushCoordinatorOptions {
  vapidPublicKey?: string
  browserSupported?: boolean
  initialPermission?: PushPermissionStatus
  initialOptOut?: boolean
  requestBrowserPermission?: () => Promise<'granted' | 'denied' | 'default'>
  hasOpenVisibleTab?: () => boolean
  maxClaimedEventIds?: number
}

const VAPID_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{40,120}$/

export function validateVapidPublicKey(key?: string): boolean {
  if (!key) return false
  return VAPID_BASE64URL_PATTERN.test(key.trim())
}

/**
 * Sanitizes an untrusted incoming Web Push payload into a lock-screen-safe
 * notification summary with a deep-link route, stripping wallet addresses
 * and exact financial amounts.
 */
export function buildLockScreenSafePushNotification(
  raw: unknown,
): SanitizedWebPushNotification | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const obj = raw as Partial<RawClaimPushPayload>
  if (typeof obj.eventId !== 'string' || !obj.eventId.trim()) {
    return null
  }

  const eventId = obj.eventId.trim()
  const safeClaimId =
    typeof obj.claimId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(obj.claimId)
      ? obj.claimId
      : null

  const deepLinkUrl = safeClaimId
    ? `/claims?claimId=${encodeURIComponent(safeClaimId)}`
    : '/claims'

  let title = 'Refract Claim Update'
  let body = 'A critical update occurred on your coverage policy. Tap to view details.'

  if (obj.eventType === 'claim_settled') {
    title = 'Claim Payout Settled'
    body = 'Your coverage payout has been settled on Stellar. Tap to view your claim.'
  } else if (obj.eventType === 'claim_approved') {
    title = 'Claim Approved'
    body = 'Your coverage claim was approved and is queued for settlement.'
  } else if (obj.eventType === 'claim_denied') {
    title = 'Claim Status Updated'
    body = 'A decision has been recorded for your coverage claim.'
  } else if (obj.eventType === 'oracle_triggered') {
    title = 'Parametric Oracle Triggered'
    body = 'An oracle trigger event was detected for a covered risk class.'
  }

  return {
    eventId,
    title,
    body,
    deepLinkUrl,
    tag: `refract-claim:${eventId}`,
  }
}

/**
 * Coordinates Web Push permission prompting, user opt-out persistence,
 * and cross-channel `eventId` claiming so open tabs never double-notify.
 */
export class WebPushClaimNotificationCoordinator {
  private readonly vapidPublicKey?: string
  private readonly browserSupported: boolean
  private readonly requestBrowserPermission: () => Promise<
    'granted' | 'denied' | 'default'
  >
  private readonly hasOpenVisibleTab: () => boolean
  private readonly maxClaimedIds: number

  private permission: PushPermissionStatus
  private userOptOut: boolean
  private readonly claimedEventIds = new Set<string>()
  private readonly claimedOrder: string[] = []

  constructor(options: WebPushCoordinatorOptions = {}) {
    this.vapidPublicKey = options.vapidPublicKey
    this.browserSupported = options.browserSupported ?? true
    this.permission = this.browserSupported
      ? (options.initialPermission ?? 'default')
      : 'unsupported'
    this.userOptOut = Boolean(options.initialOptOut)
    this.requestBrowserPermission =
      options.requestBrowserPermission ?? (async () => 'granted')
    this.hasOpenVisibleTab = options.hasOpenVisibleTab ?? (() => false)
    this.maxClaimedIds = options.maxClaimedEventIds ?? 250
  }

  public isToggleVisible(): boolean {
    return (
      this.browserSupported &&
      validateVapidPublicKey(this.vapidPublicKey)
    )
  }

  public getPermissionStatus(): PushPermissionStatus {
    return this.permission
  }

  public isOptedOut(): boolean {
    return this.userOptOut
  }

  public setUserOptOut(optOut: boolean): void {
    this.userOptOut = optOut
  }

  /**
   * Requests browser push permission ONLY on user-initiated triggers (`post_purchase`
   * or `notification_settings`), never on `page_load`, and never when opted out or denied.
   */
  public async requestPermission(
    trigger: PushPromptTrigger,
  ): Promise<{ prompted: boolean; status: PushPermissionStatus }> {
    if (
      trigger === 'page_load' ||
      !this.isToggleVisible() ||
      this.userOptOut ||
      this.permission === 'denied' ||
      this.permission === 'granted'
    ) {
      return { prompted: false, status: this.permission }
    }

    const outcome = await this.requestBrowserPermission()
    this.permission = outcome
    return { prompted: true, status: this.permission }
  }

  /**
   * Marks an `eventId` as already presented by an open in-app realtime tab
   * so the Service Worker Web Push path suppresses duplicate notifications.
   */
  public claimEventInOpenTab(eventId: string): void {
    const clean = eventId.trim()
    if (!clean || this.claimedEventIds.has(clean)) return
    this.claimedEventIds.add(clean)
    this.claimedOrder.push(clean)
    while (this.claimedOrder.length > this.maxClaimedIds) {
      const oldest = this.claimedOrder.shift()
      if (oldest !== undefined) {
        this.claimedEventIds.delete(oldest)
      }
    }
  }

  /**
   * Evaluates an incoming Service Worker push event and returns a sanitized
   * notification descriptor only when no open tab has claimed the event.
   */
  public evaluateIncomingPush(
    rawPayload: unknown,
  ): { shouldDisplay: boolean; notification: SanitizedWebPushNotification | null } {
    if (this.userOptOut || this.permission !== 'granted') {
      return { shouldDisplay: false, notification: null }
    }

    const sanitized = buildLockScreenSafePushNotification(rawPayload)
    if (!sanitized) {
      return { shouldDisplay: false, notification: null }
    }

    if (
      this.claimedEventIds.has(sanitized.eventId) ||
      this.hasOpenVisibleTab()
    ) {
      return { shouldDisplay: false, notification: null }
    }

    this.claimEventInOpenTab(sanitized.eventId)
    return {
      shouldDisplay: true,
      notification: sanitized,
    }
  }
}
