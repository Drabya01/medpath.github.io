// ═══════════════════════════════════════════════════════════════════
// MedPath — Push Notification Edge Function
// Save as:  supabase/functions/send-notifications/index.ts
//
// SETUP (one-time):
//   1. npm i -g web-push
//   2. web-push generate-vapid-keys
//   3. Paste PUBLIC key into script.js  →  PUSH_PUBLIC_KEY constant
//   4. Supabase Dashboard → Settings → Edge Functions → Add secrets:
//        VAPID_PUBLIC_KEY    = <your public key>
//        VAPID_PRIVATE_KEY   = <your private key>
//        VAPID_EMAIL         = mailto:you@yourdomain.com
//        SUPABASE_SERVICE_KEY = <service_role key from API settings>
//   5. supabase functions deploy send-notifications
//   6. Schedule: Dashboard → Database → Cron Jobs → New cron
//        Schedule: 0 19 * * *  (7 pm UTC daily)
//        Command: select net.http_post(
//          url := 'https://<project>.supabase.co/functions/v1/send-notifications',
//          headers := '{"Authorization":"Bearer <service_role_key>"}'::jsonb
//        );
// ═══════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_KEY");
const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_EMAIL   = Deno.env.get("VAPID_EMAIL") || "mailto:admin@medpath.app";

// Configure VAPID once at startup — not inside the send loop
webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async () => {
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false }
  });

  try {
    const today = new Date().toISOString().split("T")[0];

    // 1. Fetch all stored push subscriptions
    const { data: allSubs, error: subErr } = await db
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth_key");

    if (subErr) throw subErr;

    if (!allSubs || allSubs.length === 0) {
      return respond({ sent: 0, reason: "no subscriptions" });
    }

    // 2. Fetch users who already studied today (separate query — no raw SQL)
    const { data: active } = await db
      .from("daily_activity")
      .select("user_id")
      .eq("activity_date", today)
      .gt("cards_reviewed", 0);

    const activeIds = new Set((active || []).map((r) => r.user_id));

    // 3. Only notify users who have NOT studied today
    const targets = allSubs.filter((s) => !activeIds.has(s.user_id));

    if (targets.length === 0) {
      return respond({ sent: 0, reason: "all users already studied today" });
    }

    let sent = 0;
    let failed = 0;

    for (const sub of targets) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key }
          },
          JSON.stringify({
            title: "MedPath — Don't break your streak! 🔥",
            body:  "You haven't studied today. 5 minutes keeps the streak alive.",
            icon:  "/icons/icon-192.png",
            badge: "/icons/icon-96.png",
            url:   "/"
          })
        );

        // Record when this user was last notified
        await db
          .from("push_subscriptions")
          .update({ last_notified_at: new Date().toISOString() })
          .eq("user_id", sub.user_id)
          .eq("endpoint", sub.endpoint);

        sent++;

      } catch (err) {
        console.error("Push failed for", sub.user_id, err.message);

        // 410 = subscription expired — remove it so we stop trying
        if (err.statusCode === 410) {
          await db
            .from("push_subscriptions")
            .delete()
            .eq("user_id", sub.user_id)
            .eq("endpoint", sub.endpoint);
        }

        failed++;
      }
    }

    return respond({ sent, failed, total_checked: targets.length });

  } catch (err) {
    console.error("Edge function error:", err.message);
    return respond({ error: err.message }, 500);
  }
});

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { "Content-Type": "application/json" }
  });
}
