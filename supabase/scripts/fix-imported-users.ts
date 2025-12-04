// Database cleanup script - Run with: deno run --allow-net --allow-env fix-imported-users.ts
// This script merges imported_ records with real user records

const SUPABASE_URL = "https://zycyybbmoxpuzbrlaoqx.supabase.co";
// You need to set this - get it from Supabase Dashboard > Settings > API > service_role key
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!SUPABASE_SERVICE_KEY) {
  console.error("Please set SUPABASE_SERVICE_ROLE_KEY environment variable");
  console.log("Run: export SUPABASE_SERVICE_ROLE_KEY='your_key_here'");
  Deno.exit(1);
}

const headers = {
  "apikey": SUPABASE_SERVICE_KEY,
  "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation",
};

async function query(table: string, params: string = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params ? '?' + params : ''}`;
  const res = await fetch(url, { headers });
  return res.json();
}

async function deleteRecord(table: string, params: string) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, { method: "DELETE", headers });
  return res.ok;
}

async function updateRecord(table: string, params: string, data: any) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, { 
    method: "PATCH", 
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify(data)
  });
  return res.json();
}

async function main() {
  console.log("🔍 Step 1: Finding all imported_ records in message_counts...\n");
  
  // Get all imported records
  const importedRecords = await query("message_counts", "user_id=like.imported_%25&order=count.desc");
  console.log(`Found ${importedRecords.length} imported_ records:\n`);
  
  for (const rec of importedRecords) {
    // Get the name from user_names
    const userNames = await query("user_names", `user_id=eq.${rec.user_id}`);
    const name = userNames[0]?.user_name || "Unknown";
    console.log(`  - ${name}: ${rec.count} messages (${rec.year_month})`);
  }
  
  console.log("\n🔍 Step 2: Finding real user_names to match...\n");
  
  // Get all real user_names (not imported)
  const realUsers = await query("user_names", "user_id=not.like.imported_%25");
  console.log("Real users in database:");
  for (const u of realUsers) {
    console.log(`  - ${u.user_name} (${u.user_id.substring(0, 10)}...)`);
  }
  
  console.log("\n🔧 Step 3: Cleaning up imported_ records...\n");
  
  for (const rec of importedRecords) {
    const userNames = await query("user_names", `user_id=eq.${rec.user_id}`);
    const importedName = userNames[0]?.user_name || "";
    
    console.log(`Processing: ${importedName} (${rec.user_id})`);
    
    // Try to find matching real user (case-insensitive, trim spaces)
    const normalizedName = importedName.toLowerCase().trim();
    const matchingUser = realUsers.find((u: any) => 
      u.user_name.toLowerCase().trim() === normalizedName
    );
    
    if (matchingUser) {
      console.log(`  ✅ Found match: ${matchingUser.user_name} (${matchingUser.user_id.substring(0, 10)}...)`);
      
      // Check if real user has record for same group/month
      const existingRecords = await query("message_counts", 
        `group_id=eq.${rec.group_id}&user_id=eq.${matchingUser.user_id}&year_month=eq.${rec.year_month}`
      );
      
      if (existingRecords.length > 0) {
        // Merge: add counts together
        const newCount = existingRecords[0].count + rec.count;
        console.log(`  📊 Merging counts: ${existingRecords[0].count} + ${rec.count} = ${newCount}`);
        
        await updateRecord("message_counts", 
          `id=eq.${existingRecords[0].id}`,
          { count: newCount, updated_at: new Date().toISOString() }
        );
      } else {
        // Update the imported record to use real user_id
        console.log(`  📝 Updating user_id to real one`);
        await updateRecord("message_counts",
          `id=eq.${rec.id}`,
          { user_id: matchingUser.user_id, updated_at: new Date().toISOString() }
        );
      }
      
      // Delete the imported record if we merged
      if (existingRecords.length > 0) {
        console.log(`  🗑️ Deleting imported record`);
        await deleteRecord("message_counts", `id=eq.${rec.id}`);
      }
      
      // Delete the imported user_name
      console.log(`  🗑️ Deleting imported user_name`);
      await deleteRecord("user_names", `user_id=eq.${rec.user_id}`);
      
    } else {
      console.log(`  ❌ No matching real user found - will delete this imported record`);
      // Delete orphan imported records
      await deleteRecord("message_counts", `id=eq.${rec.id}`);
      await deleteRecord("user_names", `user_id=eq.${rec.user_id}`);
    }
    
    console.log("");
  }
  
  console.log("✨ Cleanup complete!");
  
  // Verify
  console.log("\n📋 Verification - remaining imported_ records:");
  const remaining = await query("message_counts", "user_id=like.imported_%25");
  console.log(`  ${remaining.length} records remaining`);
}

main().catch(console.error);
