// Shared types for LINE Bot webhook
export interface LineWebhookEvent {
  type: string;
  message?: {
    type: string;
    id: string;
    text?: string;
  };
  source: {
    type: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  timestamp: number;
  replyToken?: string;
}

export interface LineWebhookBody {
  destination: string;
  events: LineWebhookEvent[];
}

export interface MessageCount {
  id: number;
  group_id: string;
  user_id: string;
  year_month: string;
  count: number;
  created_at: string;
  updated_at: string;
}

export interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: unknown;
}
