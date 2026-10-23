import { apiRequest } from "./client";

export function markNotificationRead(id: string): Promise<void> {
  return apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
}
