// Admin API for importing message counts
// This endpoint requires an admin secret key to access

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
};

interface ImportEntry {
  name: string;
  count: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Verify admin key
    const adminKey = Deno.env.get("ADMIN_SECRET_KEY");
    const providedKey = req.headers.get("X-Admin-Key");

    if (!adminKey || providedKey !== adminKey) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body = await req.json();
    const { group_id, year_month, data, mode = "update" } = body;

    // Validate required fields
    if (!group_id || !year_month || !data) {
      return new Response(
        JSON.stringify({ 
          error: "Missing required fields",
          required: ["group_id", "year_month", "data"],
          example: {
            group_id: "Cxxxxxxxx",
            year_month: "2025-12",
            mode: "update | replace",
            data: "Loud One: 703\nAlan Lin: 621\nRay Shen: 584"
          }
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the data string
    // Format: "Name: count" per line
    const lines = data.trim().split("\n");
    const entries: ImportEntry[] = [];
    const errors: string[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Match "Name: count" format
      const match = trimmedLine.match(/^(.+?):\s*(\d+)$/);
      if (match) {
        entries.push({
          name: match[1].trim(),
          count: parseInt(match[2], 10),
        });
      } else {
        errors.push(`Invalid format: "${trimmedLine}"`);
      }
    }

    if (entries.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "No valid entries found",
          parse_errors: errors 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If mode is "replace", delete existing data for this group/month first
    if (mode === "replace") {
      const { error: deleteError } = await supabase
        .from("message_counts")
        .delete()
        .eq("group_id", group_id)
        .eq("year_month", year_month);

      if (deleteError) {
        console.error("Error deleting existing data:", deleteError);
        return new Response(
          JSON.stringify({ error: "Failed to delete existing data" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Process each entry
    const results: { name: string; status: string; count: number; user_id?: string }[] = [];
    const notFoundNames: string[] = [];

    for (const entry of entries) {
      // First, try to find user_id by name from user_names table
      const { data: userRecord } = await supabase
        .from("user_names")
        .select("user_id")
        .eq("user_name", entry.name)
        .limit(1)
        .single();

      if (!userRecord) {
        // User not found - DO NOT create fake ID, just record as not found
        notFoundNames.push(entry.name);
        results.push({ name: entry.name, status: "not_found", count: entry.count });
        continue;
      }

      const userId = userRecord.user_id;

      // Upsert the message count
      const { error: upsertError } = await supabase
        .from("message_counts")
        .upsert({
          group_id: group_id,
          user_id: userId,
          year_month: year_month,
          count: entry.count,
        }, { onConflict: "group_id,user_id,year_month" });

      if (upsertError) {
        console.error(`Error upserting count for ${entry.name}:`, upsertError);
        results.push({ name: entry.name, status: "error", count: entry.count, user_id: userId });
      } else {
        results.push({ name: entry.name, status: "success", count: entry.count, user_id: userId });
      }
    }

    const successCount = results.filter(r => r.status === "success").length;
    const notFoundCount = results.filter(r => r.status === "not_found").length;

    return new Response(
      JSON.stringify({
        success: notFoundCount === 0,
        message: notFoundCount > 0 
          ? `Imported ${successCount}/${entries.length} entries. ${notFoundCount} users not found in database.`
          : `Imported ${successCount}/${entries.length} entries`,
        group_id: group_id,
        year_month: year_month,
        mode: mode,
        results: results,
        not_found_users: notFoundNames.length > 0 ? notFoundNames : undefined,
        parse_errors: errors.length > 0 ? errors : undefined,
        hint: notFoundNames.length > 0 
          ? "Users must have sent at least one message in the group before they can be imported. Please check the exact display names in user_names table."
          : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
