// Admin API for managing knowledge base entries
// This endpoint requires an admin secret key to access

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Verify admin key
    const adminKey = Deno.env.get("ADMIN_SECRET_KEY");
    const providedKey = req.headers.get("X-Admin-Key");

    if (!adminKey || providedKey !== adminKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // GET - List all entries
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("knowledge_base")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      if (error) {
        console.error("Error fetching knowledge base:", error);
        return jsonResponse({ error: "Failed to fetch entries" }, 500);
      }

      return jsonResponse({ success: true, data });
    }

    // POST - Create new entry
    if (req.method === "POST") {
      const body = await req.json();
      const { title, content, category, sort_order, enabled } = body;

      if (!title || !content) {
        return jsonResponse({
          error: "Missing required fields",
          required: ["title", "content"],
        }, 400);
      }

      const insertData: Record<string, unknown> = { title, content };
      if (category !== undefined) insertData.category = category;
      if (sort_order !== undefined) insertData.sort_order = sort_order;
      if (enabled !== undefined) insertData.enabled = enabled;

      const { data, error } = await supabase
        .from("knowledge_base")
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error("Error creating entry:", error);
        return jsonResponse({ error: "Failed to create entry" }, 500);
      }

      return jsonResponse({ success: true, data, message: "Entry created" });
    }

    // PUT - Update entry
    if (req.method === "PUT") {
      const body = await req.json();
      const { id, ...updates } = body;

      if (!id) {
        return jsonResponse({ error: "Missing required field: id" }, 400);
      }

      // Only allow updating specific fields
      const allowedFields = ["title", "content", "category", "sort_order", "enabled"];
      const updateData: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updateData[field] = updates[field];
        }
      }

      if (Object.keys(updateData).length === 0) {
        return jsonResponse({ error: "No valid fields to update" }, 400);
      }

      const { data, error } = await supabase
        .from("knowledge_base")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("Error updating entry:", error);
        return jsonResponse({ error: "Failed to update entry" }, 500);
      }

      return jsonResponse({ success: true, data, message: "Entry updated" });
    }

    // DELETE - Delete entry
    if (req.method === "DELETE") {
      const body = await req.json();
      const { id } = body;

      if (!id) {
        return jsonResponse({ error: "Missing required field: id" }, 400);
      }

      const { error } = await supabase
        .from("knowledge_base")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Error deleting entry:", error);
        return jsonResponse({ error: "Failed to delete entry" }, 500);
      }

      return jsonResponse({ success: true, message: "Entry deleted" });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("Error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
