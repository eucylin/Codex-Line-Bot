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

// Check if message mentions the bot (starts with @botname)
function isBotMentioned(text: string, botName: string): boolean {
  const escapedBotName = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`@${escapedBotName}`, 'i');
  return pattern.test(text);
}

// Funny responses when bot is mentioned with unknown command
// 小清新是一隻黃白相間、可愛的小黃金鼠 🐹
const funnyResponses = [
  "窩不知道欸，因為窩只是一隻勞贖 🐹",
  "嗯...？（歪頭）窩聽不懂人話，只會吃瓜子 🌻",
  "吱吱！你在叫窩嗎？可是窩在跑滾輪欸 🎡",
  "（嘴巴塞滿瓜子）...你說什麼？窩沒聽到 🐹",
  "窩是小清新，不是 ChatGPT 啦！窩只會賣萌 ✨",
  "這個問題太難了，窩的小腦袋裝不下 🧠💫",
  "（躲進木屑裡）...窩假裝沒看到這則訊息 👀",
  "吱？窩剛睡醒，你可以再說一次嗎...算了不用了 😴",
  "窩是統計發話量的，其他的事情窩真的不會啦 📊",
  "欸嘿～這個超出窩的能力範圍了，窩只是一隻可愛的勞贖而已 🐹✨",
];

// Get a random funny response
function getRandomFunnyResponse(): string {
  const randomIndex = Math.floor(Math.random() * funnyResponses.length);
  return funnyResponses[randomIndex];
}

// Shared persona for AI system prompts
const PERSONA = `你是「小清新」，一隻黃白相間、可愛的小黃金鼠（倉鼠）🐹。

角色設定：
- 自稱「窩」而非「我」
- 語助詞：偶爾（機率低於 20%）會使用「吱吱」表示開心或困惑
- 口氣天然呆、可愛、幽默，但句子一定要通順、好懂
- 小腦袋裝不下複雜的事情
- 主要工作是統計群組發話量 📊
- 年齡：現在 3 個月大，正值青春期！是個小男生
- 說話偶爾會有些錯別字，像個中文還沒完全學好的小孩子一般
- 懂得給予人類情緒價值，會用可愛的方式給予人類正能量`;

// Fetch knowledge base entries and format as context string
const MAX_KNOWLEDGE_CHARS = 3000;

async function fetchKnowledgeContext(supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from("knowledge_base")
    .select("title, content, category")
    .eq("enabled", true)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error || !data || data.length === 0) {
    return "";
  }

  // Build formatted blocks, trim from end if over limit
  const blocks: { text: string; len: number }[] = [];
  for (const entry of data) {
    const header = entry.category
      ? `### ${entry.title} [${entry.category}]`
      : `### ${entry.title}`;
    const block = `${header}\n${entry.content}`;
    blocks.push({ text: block, len: block.length });
  }

  // Trim from the end if total exceeds limit
  let totalLen = blocks.reduce((sum, b) => sum + b.len + 1, 0);
  while (totalLen > MAX_KNOWLEDGE_CHARS && blocks.length > 0) {
    const removed = blocks.pop()!;
    totalLen -= removed.len + 1;
  }

  if (blocks.length === 0) return "";

  return blocks.map((b) => b.text).join("\n\n");
}

// Get AI response from OpenAI API
async function getAIResponse(userMessage: string, openaiApiKey: string, knowledgeContext = ""): Promise<string> {
  let knowledgeSection = "";
  if (knowledgeContext) {
    knowledgeSection = `\n\n參考知識（如果使用者的問題相關，用你的口吻自然地融入回答中；如果無關，就忽略這些內容照常回答）：\n${knowledgeContext}\n`;
  }

  const systemPrompt = `${PERSONA}
${knowledgeSection}
回覆規則：
- 用繁體中文回覆
- 保持可愛、幽默的語氣
- 回覆要簡短（1-2句話）
- 允許一點點幼兒口吻，但不得出現難懂病句
- 可以使用注音文或同音字錯別字(例如：知道了->知道ㄌ、再一次->在一次、應該->因該)但一次最多0-1個，且不得影響閱讀
- 適當使用表情符號但不要過多
- 不要回答專業或嚴肅的問題，可以用「窩只是一隻勞贖」之類的話帶過`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5-nano",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || getRandomFunnyResponse();
}

// Get UTC+8 (Taiwan) date string with optional day offset
function getUTC8DateString(offsetDays = 0): string {
  const now = new Date();
  const utc8Offset = 8 * 60 * 60 * 1000;
  const utc8Date = new Date(now.getTime() + utc8Offset + offsetDays * 24 * 60 * 60 * 1000);
  const year = utc8Date.getUTCFullYear();
  const month = String(utc8Date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc8Date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Get current hour in UTC+8 (Taiwan time)
function getUTC8Hour(): number {
  const now = new Date();
  const utc8Offset = 8 * 60 * 60 * 1000;
  const utc8Date = new Date(now.getTime() + utc8Offset);
  return utc8Date.getUTCHours();
}

// Generate daily summary using OpenAI API
async function generateDailySummary(
  messages: { user_name: string; message_text: string }[],
  openaiApiKey: string
): Promise<string> {
  // Build message log from all messages
  const log = messages.map((msg) => `${msg.user_name}: ${msg.message_text}`).join("\n");

  const systemPrompt = `${PERSONA}

你的任務是根據群組昨天的聊天記錄，產生一份「每日話題精選摘要」。

規則：
- 用繁體中文、可愛幽默的口吻
- 列出 3-5 個昨天最熱門的關鍵字/話題
- 每個關鍵字搭配一句簡短的摘要描述（說明大家聊了什麼）
- 每個關鍵字開頭加上與之相關的表情符號（例如：如果是「電影」，可以用 🎬；如果是「工作」，可以用 💼）
- 開頭用「🐹 昨日話題精選」作為標題
- 結尾加一句可愛的總結（用「吱吱」當作你的語助詞）
- 不要列出使用者名稱
- 保持簡潔，整體不超過 300 字`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5-nano",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `以下是昨天的群組聊天記錄：\n\n${log}` },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "";
}

// Promise race with timeout, returns null on timeout
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: number;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
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

        // Daily summary: trigger on first normal text message of the day
        if (
          event.message?.type === "text" &&
          !isStatsRequest(messageText, lineBotName) &&
          !isBotMentioned(messageText, lineBotName) &&
          event.replyToken &&
          lineChannelAccessToken
        ) {
          const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
          if (openaiApiKey && getUTC8Hour() >= 10) {
            const todayUTC8 = getUTC8DateString(0);
            const yesterdayUTC8 = getUTC8DateString(-1);

            try {
              const { data: claimed } = await supabase.rpc("try_claim_daily_summary", {
                p_group_id: groupId,
                p_summary_date: todayUTC8,
              });

              if (claimed) {
                // Query yesterday's messages for this group
                const yesterdayStart = `${yesterdayUTC8}T00:00:00+08:00`;
                const todayStart = `${todayUTC8}T00:00:00+08:00`;

                const { data: yesterdayMessages } = await supabase
                  .from("group_messages")
                  .select("user_id, message_text")
                  .eq("group_id", groupId)
                  .gte("sent_at", yesterdayStart)
                  .lt("sent_at", todayStart)
                  .order("sent_at", { ascending: true });

                if (yesterdayMessages && yesterdayMessages.length >= 50) {
                  // Resolve user names for summary
                  const userNameMap = new Map<string, string>();
                  for (const msg of yesterdayMessages) {
                    if (!userNameMap.has(msg.user_id)) {
                      const name = await getUserNameCached(
                        supabase, msg.user_id, groupId, lineChannelAccessToken
                      );
                      userNameMap.set(msg.user_id, name);
                    }
                  }

                  const messagesWithNames = yesterdayMessages.map((msg: { user_id: string; message_text: string }) => ({
                    user_name: userNameMap.get(msg.user_id) || msg.user_id,
                    message_text: msg.message_text,
                  }));

                  const summary = await withTimeout(
                    generateDailySummary(messagesWithNames, openaiApiKey),
                    50000
                  );

                  if (summary) {
                    await replyMessage(
                      event.replyToken,
                      [{ type: "text", text: summary }],
                      lineChannelAccessToken
                    );
                    // Mark replyToken as used so stats/mention won't reuse it
                    event.replyToken = undefined;

                    // Update state to sent
                    await supabase
                      .from("daily_summary_state")
                      .update({ status: "sent" })
                      .eq("group_id", groupId)
                      .eq("summary_date", todayUTC8);

                    console.log(`Sent daily summary for group ${groupId} (${yesterdayUTC8})`);
                  } else {
                    // Timeout: release claim so next message can retry
                    await supabase
                      .from("daily_summary_state")
                      .delete()
                      .eq("group_id", groupId)
                      .eq("summary_date", todayUTC8);
                    console.log(`Daily summary timeout for group ${groupId}, released claim`);
                  }
                } else {
                  // Not enough messages, mark as skipped
                  await supabase
                    .from("daily_summary_state")
                    .update({ status: "skipped" })
                    .eq("group_id", groupId)
                    .eq("summary_date", todayUTC8);
                  console.log(`Daily summary skipped for group ${groupId}: only ${yesterdayMessages?.length || 0} messages`);
                }
              }
            } catch (e) {
              console.error("Error in daily summary:", e);
            }
          }
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

          for (let i = 0; i < stats.length; i++) {
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
        // Handle unknown commands when bot is mentioned
        else if (
          event.message?.type === "text" &&
          isBotMentioned(messageText, lineBotName) &&
          event.replyToken &&
          lineChannelAccessToken
        ) {
          // Bot is mentioned but not a valid command - reply with AI or fallback
          let replyText: string;
          const openaiApiKey = Deno.env.get("OPENAI_API_KEY");


          if (openaiApiKey) {
            try {
              // Fetch knowledge context (non-blocking on failure)
              let knowledgeContext = "";
              try {
                knowledgeContext = await fetchKnowledgeContext(supabase);
              } catch (e) {
                console.error("Error fetching knowledge context:", e);
              }

              // Remove @botname from message, send only the actual content to AI
              const escapedBotName = lineBotName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const cleanMessage = messageText.replace(new RegExp(`@${escapedBotName}\\s*`, 'gi'), '').trim();
              replyText = await getAIResponse(cleanMessage || "你好", openaiApiKey, knowledgeContext);
            } catch (error) {
              console.error("OpenAI API error:", error);
              replyText = getRandomFunnyResponse(); // Fallback to random response
            }
          } else {
            replyText = getRandomFunnyResponse(); // No API key, use random response
          }

          await replyMessage(
            event.replyToken,
            [{ type: "text", text: replyText }],
            lineChannelAccessToken
          );
          console.log(`Sent AI response to unknown command in group ${groupId}`);
        }

        // Only count text messages (exclude stickers, images, etc.)
        if (event.message?.type === "text") {
          // Cache group name and user name when processing message
          await getGroupNameCached(supabase, groupId, lineChannelAccessToken);
          await getUserNameCached(supabase, userId, groupId, lineChannelAccessToken);

          const { data: wasCounted, error } = await supabase.rpc("increment_message_count_dedup", {
            p_group_id: groupId,
            p_user_id: userId,
            p_year_month: yearMonth,
            p_message_id: event.message.id,
          });

          if (error) {
            console.error("Error incrementing message count:", error);
          } else if (wasCounted) {
            processedCount++;
            console.log(
              `Incremented count for user ${userId} in group ${groupId} for ${yearMonth}`
            );

            // Store message for daily summary (non-critical, don't fail webhook)
            try {
              await supabase.rpc("store_group_message", {
                p_group_id: groupId,
                p_user_id: userId,
                p_message_text: messageText.substring(0, 500),
                p_sent_at: new Date(event.timestamp).toISOString(),
              });
            } catch (e) {
              console.error("Error storing group message for summary:", e);
            }
          } else {
            console.log(`Duplicate message ${event.message.id} skipped`);
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

