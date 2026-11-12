import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "login_with_pin") {
      const identifier = String(body?.identifier || "").trim();
      const pin = String(body?.pin || "");
      if (!identifier || !/^\d{6,8}$/.test(pin)) return json({ error: "Enter your name, phone or email and a 6–8 digit PIN." }, 400);

      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const ipHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip))), b => b.toString(16).padStart(2, "0")).join("");
      const { data: verified, error: verifyError } = await admin.rpc("verify_merchant_member_pin", {
        p_identifier: identifier,
        p_pin: pin,
        p_ip_hash: ipHash,
      });
      if (verifyError) throw verifyError;
      if (!verified?.ok) return json({ error: verified?.rate_limited ? "Too many attempts. Try again in 15 minutes." : "The sign-in details were not recognized." }, 401);

      const { data: authUser, error: userError } = await admin.auth.admin.getUserById(verified.user_id);
      if (userError || !authUser?.user) throw userError || new Error("User account not found");
      const target = verified.email
        ? { email: verified.email }
        : verified.phone
          ? { phone: verified.phone }
          : null;
      if (!target) return json({ error: "This team member needs a verified email address or phone number before PIN sign-in." }, 409);

      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        ...target,
      } as any);
      if (linkError) throw linkError;
      const tokenHash = link?.properties?.hashed_token;
      if (!tokenHash) throw new Error("Secure sign-in token could not be created.");
      return json({
        ok: true,
        token_hash: tokenHash,
        type: "magiclink",
        email: verified.email || null,
        phone: verified.phone || null,
        merchant_id: verified.merchant_id,
      });
    }

    if (action === "create_member") {
      const authHeader = req.headers.get("Authorization") || "";
      const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!bearer) return json({ error: "Manager sign-in required." }, 401);

      const caller = createClient(url, anonKey, {
        global: { headers: { Authorization: "Bearer " + bearer } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: callerData, error: callerError } = await caller.auth.getUser(bearer);
      if (callerError || !callerData?.user) return json({ error: "Manager session is invalid." }, 401);

      const merchantId = String(body?.merchant_id || "");
      const fullName = String(body?.full_name || "").trim();
      const email = String(body?.email || "").trim().toLowerCase() || null;
      const phone = String(body?.phone || "").trim() || null;
      const username = String(body?.username || "").trim().toLowerCase() || null;
      const pin = String(body?.pin || "");
      const role = String(body?.role || "cashier");
      const permissions = body?.permissions && typeof body.permissions === "object" ? body.permissions : {};

      if (!merchantId || fullName.length < 2 || (!email && !phone) || !/^\d{6,8}$/.test(pin)) {
        return json({ error: "Provide a business, full name, verified email or phone, and a 6–8 digit PIN." }, 400);
      }
      if (!["admin", "manager", "cashier", "inventory", "accountant", "custom"].includes(role)) {
        return json({ error: "Invalid team role." }, 400);
      }

      const { data: merchant, error: merchantError } = await admin
        .from("merchants").select("id,user_id").eq("id", merchantId).maybeSingle();
      if (merchantError || !merchant) return json({ error: "Business account not found." }, 404);

      let canManage = merchant.user_id === callerData.user.id;
      if (!canManage) {
        const { data: membership, error: memberError } = await admin
          .from("merchant_members").select("role,permissions,status")
          .eq("merchant_id", merchantId).eq("user_id", callerData.user.id).maybeSingle();
        if (memberError) throw memberError;
        canManage = membership?.status === "active" &&
          (membership.role === "admin" || membership.permissions?.manage_team === true);
      }
      if (!canManage) return json({ error: "You do not have permission to manage this team." }, 403);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: email || undefined,
        phone: phone || undefined,
        password: randomPassword(),
        email_confirm: !!email,
        phone_confirm: !!phone,
        user_metadata: { full_name: fullName },
      });
      if (createError || !created?.user) throw createError || new Error("Could not create the login identity.");

      const { data: member, error: insertError } = await admin.from("merchant_members").insert({
        merchant_id: merchantId,
        user_id: created.user.id,
        full_name: fullName,
        username,
        email,
        phone,
        role,
        permissions,
        created_by: callerData.user.id,
      }).select("id,merchant_id,user_id,full_name,username,email,phone,role,permissions,status,created_at").single();

      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw insertError;
      }

      const { error: pinError } = await admin.rpc("set_merchant_member_pin", {
        p_member_id: member.id,
        p_pin: pin,
      });
      if (pinError) {
        await admin.from("merchant_members").delete().eq("id", member.id);
        await admin.auth.admin.deleteUser(created.user.id);
        throw pinError;
      }

      return json({ ok: true, member });
    }

    return json({ error: "Unsupported action." }, 400);
  } catch (error) {
    console.error("[team-access]", error);
    return json({ error: "The team access request could not be completed. Check the supplied details and try again." }, 500);
  }
});
