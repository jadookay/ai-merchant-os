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
      const merchantCode = String(body?.merchant_code || "").trim();
      const pin = String(body?.pin || "");
      if (!identifier || !merchantCode || pin.length < 6 || pin.length > 8 || !/^[0-9]+$/.test(pin)) return json({ error: "Enter your business ID, name, phone or email, and a 6–8 digit PIN." }, 400);

      const ip = req.headers.get("cf-connecting-ip") || "unknown";
      const ipHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip))), b => b.toString(16).padStart(2, "0")).join("");
      const { data: merchant, error: merchantError } = await admin.from("merchants").select("id").eq("shericeri_id", Number(merchantCode)).maybeSingle();
      if (merchantError || !merchant) return json({ error: "Business account ID was not recognized." }, 404);
      const { data: verified, error: verifyError } = await admin.rpc("verify_merchant_member_pin", {
        p_merchant_id: merchant.id,
        p_identifier: identifier,
        p_pin: pin,
        p_ip_hash: ipHash,
      });
      if (verifyError) throw verifyError;
      if (!verified?.ok) return json({ error: verified?.rate_limited ? "Too many attempts. Try again in 15 minutes." : "The sign-in details were not recognized." }, 401);

      const { data: authUser, error: userError } = await admin.auth.admin.getUserById(verified.user_id);
      if (userError || !authUser?.user) throw userError || new Error("User account not found");
      // Supabase magic links are email-only. Phone-only staff receive a non-deliverable
      // internal Auth alias; the PIN was already verified against their phone identity.
      const loginEmail = authUser.user.email;
      if (!loginEmail) return json({ error: "This staff account needs an email-based Auth identity." }, 409);
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: loginEmail,
      });
      if (linkError) throw linkError;
      const tokenHash = link?.properties?.hashed_token;
      if (!tokenHash) throw new Error("Secure sign-in token could not be created.");
      return json({
        ok: true,
        token_hash: tokenHash,
        type: "magiclink",
        email: loginEmail,
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
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      if (phone && !/^\+?\d{7,15}$/.test(phone)) return json({ error: "Enter a phone number in international format." }, 400);
      if (username && !/^[a-z0-9._-]{3,40}$/.test(username)) return json({ error: "Username must be 3 to 40 letters, numbers, dots, underscores or hyphens." }, 400);
      if (!["admin", "manager", "cashier", "inventory", "accountant", "custom"].includes(role)) {
        return json({ error: "Invalid team role." }, 400);
      }

      const { data: merchant, error: merchantError } = await admin
        .from("merchants").select("id,user_id").eq("id", merchantId).maybeSingle();
      if (merchantError || !merchant) return json({ error: "Business account not found." }, 404);

      let canManage = merchant.user_id === callerData.user.id;
      let callerRole = canManage ? "owner" : null;
      let callerPermissions: Record<string, boolean> = {};
      if (!canManage) {
        const { data: membership, error: memberError } = await admin
          .from("merchant_members").select("role,permissions,status")
          .eq("merchant_id", merchantId).eq("user_id", callerData.user.id).maybeSingle();
        if (memberError) throw memberError;
        callerRole = membership?.role || null;
        callerPermissions = membership?.permissions && typeof membership.permissions === "object" ? membership.permissions : {};
        canManage = membership?.status === "active" &&
          (membership.role === "admin" || (membership.role === "manager" && callerPermissions.manage_team === true));
      }
      if (!canManage) return json({ error: "You do not have permission to manage this team." }, 403);
      const isPrivilegedGrantor = callerRole === "owner" || callerRole === "admin";
      // A manager can delegate only permissions they personally hold. Otherwise a
      // manager could create a custom account with finance/admin rights and escalate.
      const grantablePermissions = new Set([
        "view_sales", "create_sale", "manage_sales", "view_inventory", "manage_inventory",
        "view_expenses", "manage_expenses", "view_financial_reports", "manage_finance",
        "view_customers", "manage_customers", "view_suppliers", "manage_suppliers",
        "view_audit_log", "manage_team"
      ]);
      for (const [permission, enabled] of Object.entries(permissions)) {
        if (!grantablePermissions.has(permission) && enabled === true) {
          return json({ error: "The requested permission is not recognized." }, 400);
        }
        if (enabled === true && !isPrivilegedGrantor &&
            callerPermissions[permission] !== true &&
            !(permission === "view_inventory" && callerPermissions.create_sale === true)) {
          return json({ error: "You cannot grant a permission you do not have." }, 403);
        }
      }
      // Only the owner or an existing administrator may create an administrator.
      if ((permissions.manage_team === true || permissions.manage_sales === true) && role !== "manager" && role !== "admin") return json({ error: "Manager-level controls can only be assigned to a manager or administrator role." }, 400);
      if (role === "admin" && !isPrivilegedGrantor) {
        return json({ error: "Only the business owner or an administrator can create another administrator." }, 403);
      }

      const authEmail = email || ("staff-" + crypto.randomUUID() + "@example.com");
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: authEmail,
        phone: phone || undefined,
        password: randomPassword(),
        email_confirm: true,
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
        responsibility: String(body?.responsibility || "").trim() || null,
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

    if (action === "update_member") {
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
      const memberId = String(body?.member_id || "");
      const fullName = String(body?.full_name || "").trim();
      const email = body?.email === undefined ? undefined : (String(body.email || "").trim().toLowerCase() || null);
      const phone = body?.phone === undefined ? undefined : (String(body.phone || "").replace(/[^0-9+]/g, "") || null);
      const username = body?.username === undefined ? undefined : (String(body.username || "").trim().toLowerCase() || null);
      const responsibility = String(body?.responsibility || "").trim() || null;
      const role = String(body?.role || "cashier");
      const status = String(body?.status || "active");
      const permissions = body?.permissions && typeof body.permissions === "object" ? body.permissions : {};
      const pin = String(body?.pin || "");
      if (!merchantId || !memberId || fullName.length < 2) return json({ error: "Business, member and full name are required." }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      if (phone && !/^\+?\d{7,15}$/.test(phone)) return json({ error: "Enter a phone number in international format." }, 400);
      if (username && !/^[a-z0-9._-]{3,40}$/.test(username)) return json({ error: "Username must be 3 to 40 letters, numbers, dots, underscores or hyphens." }, 400);
      if (!["admin", "manager", "cashier", "inventory", "accountant", "custom"].includes(role)) return json({ error: "Invalid team role." }, 400);
      if (!["active", "suspended"].includes(status)) return json({ error: "Invalid team status." }, 400);
      if (pin && !/^\d{6,8}$/.test(pin)) return json({ error: "A new PIN must contain 6 to 8 digits." }, 400);

      const { data: merchant, error: merchantError } = await admin.from("merchants").select("id,user_id").eq("id", merchantId).maybeSingle();
      if (merchantError || !merchant) return json({ error: "Business account not found." }, 404);
      let callerRole = merchant.user_id === callerData.user.id ? "owner" : null;
      let callerPermissions: Record<string, boolean> = {};
      if (!callerRole) {
        const { data: membership, error: memberError } = await admin.from("merchant_members")
          .select("role,permissions,status").eq("merchant_id", merchantId).eq("user_id", callerData.user.id).maybeSingle();
        if (memberError) throw memberError;
        callerRole = membership?.role || null;
        callerPermissions = membership?.permissions && typeof membership.permissions === "object" ? membership.permissions : {};
        if (membership?.status !== "active" || (callerRole !== "admin" && !(callerRole === "manager" && callerPermissions.manage_team === true))) {
          return json({ error: "You do not have permission to manage this team." }, 403);
        }
      }
      const privileged = callerRole === "owner" || callerRole === "admin";
      const { data: target, error: targetError } = await admin.from("merchant_members")
        .select("id,user_id,full_name,role,status,email,phone,username,permissions,responsibility").eq("id", memberId).eq("merchant_id", merchantId).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ error: "Team member not found." }, 404);
      const nextEmail = email === undefined ? target.email : email;
      const nextPhone = phone === undefined ? target.phone : phone;
      const nextUsername = username === undefined ? target.username : username;
      if (!nextEmail && !nextPhone && !nextUsername) return json({ error: "Keep at least one staff login identifier: email, phone or username." }, 400);
      if (target.user_id === callerData.user.id) return json({ error: "Use the owner account to change another administrator's access; self-edits are disabled here." }, 403);
      if (target.role === "admin" && !privileged) return json({ error: "Only the owner or an administrator can change an administrator account." }, 403);
      if ((permissions.manage_team === true || permissions.manage_sales === true) && role !== "manager" && role !== "admin") return json({ error: "Manager-level controls can only be assigned to a manager or administrator role." }, 400);
      if (role === "admin" && !privileged) return json({ error: "Only the owner or an administrator can assign administrator access." }, 403);

      const grantable = new Set(["view_sales","create_sale","manage_sales","view_inventory","manage_inventory","view_expenses","manage_expenses","view_financial_reports","manage_finance","view_customers","manage_customers","view_suppliers","manage_suppliers","view_audit_log","manage_team"]);
      for (const [permission, enabled] of Object.entries(permissions)) {
        if (!grantable.has(permission) && enabled === true) return json({ error: "The requested permission is not recognized." }, 400);
        if (enabled === true && !privileged && callerPermissions[permission] !== true &&
            !(permission === "view_inventory" && callerPermissions.create_sale === true)) {
          return json({ error: "You cannot grant a permission you do not have." }, 403);
        }
      }

      const memberPatch: Record<string, unknown> = { full_name: fullName, responsibility, role, permissions, status, updated_at: new Date().toISOString() };
      if (email !== undefined) memberPatch.email = email;
      if (phone !== undefined) memberPatch.phone = phone;
      if (username !== undefined) memberPatch.username = username;
      const { data: updated, error: updateError } = await admin.from("merchant_members")
        .update(memberPatch)
        .eq("id", memberId).eq("merchant_id", merchantId)
        .select("id,merchant_id,user_id,full_name,username,email,phone,role,permissions,responsibility,status,created_at,updated_at,last_login_at").single();
      if (updateError) throw updateError;
      if (status !== target.status) {
        // A suspended member must be unable to refresh or start Auth sessions.
        // RLS and SECURITY DEFINER authorization also check active membership,
        // so already-issued JWTs lose business access immediately on the next API call.
        const { error: authStatusError } = await admin.auth.admin.updateUserById(
          target.user_id,
          { ban_duration: status === "suspended" ? "876000h" : "none" },
        );
        if (authStatusError) {
          await admin.from("merchant_members").update({
            status: target.status,
            full_name: target.full_name,
            email: target.email,
            phone: target.phone,
            username: target.username,
            role: target.role,
            permissions: target.permissions,
            responsibility: target.responsibility,
            updated_at: new Date().toISOString(),
          }).eq("id", memberId).eq("merchant_id", merchantId);
          throw authStatusError;
        }
      }
      if (email && email !== target.email) {
        const { error: authEmailError } = await admin.auth.admin.updateUserById(target.user_id, { email, email_confirm: true });
        if (authEmailError) {
          await admin.from("merchant_members").update({ email: target.email, phone: target.phone, username: target.username }).eq("id", memberId).eq("merchant_id", merchantId);
          throw authEmailError;
        }
      }
      if (pin) {
        const { error: pinError } = await admin.rpc("set_merchant_member_pin", { p_member_id: memberId, p_pin: pin });
        if (pinError) throw pinError;
      }
      return json({ ok: true, member: updated });
    }

    if (action === "delete_member") {
      return json({ error: "Team accounts are suspended, not deleted, to preserve transaction and audit history. Use update_member with status=suspended." }, 409);
    }

    return json({ error: "Unsupported action." }, 400);
  } catch (error) {
    console.error("[team-access]", error);
    return json({ error: "The team access request could not be completed. Check the supplied details and try again." }, 500);
  }
});
