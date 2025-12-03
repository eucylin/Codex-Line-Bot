// Get message statistics for a group
// This endpoint can be used to retrieve monthly message counts

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only accept GET requests
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const groupId = url.searchParams.get("group_id");
    const yearMonth = url.searchParams.get("year_month");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Action: list all groups
    if (action === "groups") {
      const { data, error } = await supabase
        .from("message_counts")
        .select("group_id")
        .order("group_id");

      if (error) {
        console.error("Database error:", error);
        return new Response(
          JSON.stringify({ error: "Database error" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get unique group IDs
      const uniqueGroupIds = [...new Set(data?.map((row) => row.group_id) || [])];

      // Fetch group names from cache
      const { data: groupNames } = await supabase
        .from("group_names")
        .select("group_id, group_name")
        .in("group_id", uniqueGroupIds);

      // Create a map of group_id -> group_name
      const groupNameMap = new Map(
        groupNames?.map((g) => [g.group_id, g.group_name]) || []
      );

      // Build response with names
      const groupsWithNames = uniqueGroupIds.map((groupId) => ({
        group_id: groupId,
        group_name: groupNameMap.get(groupId) || groupId.substring(0, 10) + "...",
      }));

      return new Response(
        JSON.stringify({
          success: true,
          groups: groupsWithNames,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: list available months for a group
    if (action === "months") {
      let query = supabase
        .from("message_counts")
        .select("year_month")
        .order("year_month", { ascending: false });

      if (groupId) {
        query = query.eq("group_id", groupId);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Database error:", error);
        return new Response(
          JSON.stringify({ error: "Database error" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get unique months
      const uniqueMonths = [...new Set(data?.map((row) => row.year_month) || [])];

      return new Response(
        JSON.stringify({
          success: true,
          months: uniqueMonths,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default action: get stats for a group
    if (!groupId) {
      return new Response(
        JSON.stringify({ error: "group_id parameter is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let query = supabase
      .from("message_counts")
      .select("*")
      .eq("group_id", groupId)
      .order("count", { ascending: false });

    if (yearMonth) {
      query = query.eq("year_month", yearMonth);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Database error:", error);
      return new Response(
        JSON.stringify({ error: "Database error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch user names from cache
    const userIds = data?.map((row: any) => row.user_id) || [];
    const { data: userNames } = await supabase
      .from("user_names")
      .select("user_id, user_name")
      .in("user_id", userIds);

    // Create a map of user_id -> user_name
    const userNameMap = new Map(
      userNames?.map((u: any) => [u.user_id, u.user_name]) || []
    );

    // Add user names to the data
    const dataWithNames = data?.map((row: any) => ({
      ...row,
      user_name: userNameMap.get(row.user_id) || row.user_id.substring(0, 10) + "...",
    }));

    return new Response(
      JSON.stringify({
        success: true,
        data: dataWithNames,
        total_users: data?.length || 0,
        total_messages: data?.reduce((sum: number, row: any) => sum + row.count, 0) || 0,
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
