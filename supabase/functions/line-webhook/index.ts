// LINE Bot Webhook Handler for Supabase Edge Functions
// Tracks group message counts per user per month

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { crypto } from "jsr:@std/crypto";

// Types for LINE Webhook Events
interface LineWebhookEvent {
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

interface LineWebhookBody {
  destination: string;
  events: LineWebhookEvent[];
}

interface MessageCount {
  user_id: string;
  count: number;
}

// Verify LINE signature
async function verifySignature(
  body: string,
  signature: string,
  channelSecret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body)
  );
  
  const expectedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signatureBuffer))
  );
  
  return signature === expectedSignature;
}

// Get current year-month in YYYY-MM format (Asia/Tokyo timezone)
function getCurrentYearMonth(): string {
  const now = new Date();
  // Convert to JST (UTC+9)
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstDate = new Date(now.getTime() + jstOffset);
  const year = jstDate.getUTCFullYear();
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// Parse month from text like "@botname 12月發話" - returns month if valid stats request
function parseStatsRequest(text: string, botName: string): string | null {
  // Only match pattern: @botname X月發話
  // Example: "@MyBot 12月發話" or "@統計機器人 1月發話"
  const escapedBotName = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`@${escapedBotName}\\s*(\\d{1,2})月發話`, 'i');
  const match = text.match(pattern);
  
  if (match) {
    const month = parseInt(match[1], 10);
    if (month >= 1 && month <= 12) {
      const now = new Date();
      const jstOffset = 9 * 60 * 60 * 1000;
      const jstDate = new Date(now.getTime() + jstOffset);
      const year = jstDate.getUTCFullYear();
      return `${year}-${String(month).padStart(2, "0")}`;
    }
  }
  return null;
}

// Check if text is a stats request (must be @botname X月發話 format)
function isStatsRequest(text: string, botName: string): boolean {
  return parseStatsRequest(text, botName) !== null;
}

// Get LINE user profile
async function getUserProfile(
  userId: string,
  groupId: string,
  accessToken: string
): Promise<string> {
  try {
    const response = await fetch(
      `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (response.ok) {
      const profile = await response.json();
      return profile.displayName || userId;
    }
  } catch (e) {
    console.error("Error fetching user profile:", e);
  }
  return userId.substring(0, 8) + "...";
}

// Get LINE group summary
async function getGroupSummary(
  groupId: string,
  accessToken: string
): Promise<string> {
  try {
    const response = await fetch(
      `https://api.line.me/v2/bot/group/${groupId}/summary`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (response.ok) {
      const summary = await response.json();
      return summary.groupName || groupId;
    }
  } catch (e) {
    console.error("Error fetching group summary:", e);
  }
  return groupId.substring(0, 10) + "...";
}

// Cache user name in database
async function cacheUserName(
  supabase: any,
  userId: string,
  userName: string
): Promise<void> {
  try {
    await supabase.rpc("upsert_user_name", {
      p_user_id: userId,
      p_user_name: userName,
    });
  } catch (e) {
    console.error("Error caching user name:", e);
  }
}

// Cache group name in database
async function cacheGroupName(
  supabase: any,
  groupId: string,
  groupName: string
): Promise<void> {
  try {
    await supabase.rpc("upsert_group_name", {
      p_group_id: groupId,
      p_group_name: groupName,
    });
  } catch (e) {
    console.error("Error caching group name:", e);
  }
}

// Get cached user name or fetch from LINE API
async function getUserNameCached(
  supabase: any,
  userId: string,
  groupId: string,
  accessToken: string
): Promise<string> {
  // Try to get from cache
  const { data } = await supabase.rpc("get_user_name", {
    p_user_id: userId,
  });

  if (data) {
    return data;
  }

  // Fetch from LINE API and cache
  const userName = await getUserProfile(userId, groupId, accessToken);
  await cacheUserName(supabase, userId, userName);
  return userName;
}

// Get cached group name or fetch from LINE API
async function getGroupNameCached(
  supabase: any,
  groupId: string,
  accessToken: string
): Promise<string> {
  // Try to get from cache
  const { data } = await supabase.rpc("get_group_name", {
    p_group_id: groupId,
  });

  if (data) {
    return data;
  }

  // Fetch from LINE API and cache
  const groupName = await getGroupSummary(groupId, accessToken);
  await cacheGroupName(supabase, groupId, groupName);
  return groupName;
}

// Reply to LINE message
async function replyMessage(
  replyToken: string,
  messages: { type: string; text: string }[],
  accessToken: string
): Promise<void> {
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages,
      }),
    });
    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to reply:", error);
    }
  } catch (e) {
    console.error("Error replying to message:", e);
  }
}

// Main handler
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Line-Signature",
      },
    });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Get environment variables
    const lineChannelSecret = Deno.env.get("LINE_CHANNEL_SECRET");
    const lineChannelAccessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
    const lineBotName = Deno.env.get("LINE_BOT_NAME") || "Bot";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!lineChannelSecret || !supabaseUrl || !supabaseServiceKey) {
      console.error("Missing required environment variables");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get request body and signature
    const bodyText = await req.text();
    const signature = req.headers.get("X-Line-Signature");

    if (!signature) {
      console.error("Missing X-Line-Signature header");
      return new Response(
        JSON.stringify({ error: "Missing signature" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify signature
    const isValid = await verifySignature(bodyText, signature, lineChannelSecret);
    if (!isValid) {
      console.error("Invalid signature");
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse webhook body
    const webhookBody: LineWebhookBody = JSON.parse(bodyText);
    
    // Initialize Supabase client with service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Process events
    const yearMonth = getCurrentYearMonth();
    let processedCount = 0;

    for (const event of webhookBody.events) {
      // Only process message events from groups
      if (
        event.type === "message" &&
        event.source.type === "group" &&
        event.source.groupId &&
        event.source.userId
      ) {
        const { groupId, userId } = event.source;
        const messageText = event.message?.text || "";

        // Check if this group is in the whitelist
        const { data: isAllowed } = await supabase.rpc("is_group_allowed", {
          p_group_id: groupId,
        });

        if (!isAllowed) {
          console.log(`Group ${groupId} is not in the whitelist, ignoring message`);
          continue; // Skip this message, group not allowed
        }

        // Check if this is a stats request (must be @botname X月發話 format)
        const targetMonth = parseStatsRequest(messageText, lineBotName);
        if (
          event.message?.type === "text" &&
          targetMonth &&
          event.replyToken &&
          lineChannelAccessToken
        ) {
          const monthDisplay = parseInt(targetMonth.split("-")[1], 10);

          // Fetch stats for this group and month
          const { data: stats, error: statsError } = await supabase
            .from("message_counts")
            .select("user_id, count")
            .eq("group_id", groupId)
            .eq("year_month", targetMonth)
            .order("count", { ascending: false });

          if (statsError) {
            console.error("Error fetching stats:", statsError);
            continue;
          }

          if (!stats || stats.length === 0) {
            await replyMessage(
              event.replyToken,
              [{ type: "text", text: `📊 ${monthDisplay}月發話統計\n\n目前沒有任何記錄` }],
              lineChannelAccessToken
            );
            continue;
          }

          // Build stats message with user names
          const statsLines: string[] = [];
          let totalMessages = 0;

          for (let i = 0; i < Math.min(stats.length, 20); i++) {
            const stat = stats[i] as MessageCount;
            // Use cached user name
            const displayName = await getUserNameCached(
              supabase,
              stat.user_id,
              groupId,
              lineChannelAccessToken
            );
            const rank = i + 1;
            const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
            statsLines.push(`${medal} ${displayName}: ${stat.count} 則`);
            totalMessages += stat.count;
          }

          const replyText = `📊 ${monthDisplay}月發話統計\n\n${statsLines.join("\n")}\n\n📈 總計: ${totalMessages} 則訊息\n👥 活躍人數: ${stats.length} 人`;

          await replyMessage(
            event.replyToken,
            [{ type: "text", text: replyText }],
            lineChannelAccessToken
          );

          console.log(`Sent stats for group ${groupId} for ${targetMonth}`);
        }

        // Always increment message count (except for stats requests to avoid double counting)
        if (!isStatsRequest(messageText, lineBotName)) {
          // Cache group name and user name when processing message
          await getGroupNameCached(supabase, groupId, lineChannelAccessToken);
          await getUserNameCached(supabase, userId, groupId, lineChannelAccessToken);

          const { error } = await supabase.rpc("increment_message_count", {
            p_group_id: groupId,
            p_user_id: userId,
            p_year_month: yearMonth,
          });

          if (error) {
            console.error("Error incrementing message count:", error);
          } else {
            processedCount++;
            console.log(
              `Incremented count for user ${userId} in group ${groupId} for ${yearMonth}`
            );
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${processedCount} message events`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
