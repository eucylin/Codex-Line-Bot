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

        // Call the increment function
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
