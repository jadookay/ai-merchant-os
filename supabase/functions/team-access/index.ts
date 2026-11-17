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
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function normalizePhoneForAuth(value: string | null, country: string | null): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  let normalized = "";
  if (raw.startsWith("+")) normalized = "+" + digits;
  else if (digits.startsWith("00")) normalized = "+" + digits.slice(2);
  else if (String(country || "").toUpperCase() === "RW") {
    if (digits.startsWith("250")) normalized = "+" + digits;
    else if (digits.startsWith("0")) normalized = "+250" + digits.slice(1);
    else if (digits.length === 9) normalized = "+250" + digits;
  }
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}
function sessionIdFromJwt(token: string): string {
  const segment = token.split(".")[1];
  if (!segment) return "";
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return String(payload?.session_id || "");
  } catch {
    return "";
  }
}

async function hasActiveDeviceSession(admin: ReturnType<typeof createClient>, merchantId: string, userId: string, token: string): Promise<boolean> {
  const sessionId = sessionIdFromJwt(token);
  if (!sessionId) return false;
  const { data, error } = await admin.from("merchant_device_sessions")
    .select("id").eq("merchant_id", merchantId).eq("user_id", userId)
    .eq("session_id", sessionId).is("revoked_at", null).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const { data: authSessionActive, error: authSessionError } = await admin.rpc("shericeri_is_auth_session_active", {
    p_user_id: userId, p_session_id: sessionId,
  });
  if (authSessionError) throw authSessionError;
  return authSessionActive === true;
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
      if (!identifier || !/^\d{1,6}$/.test(merchantCode) || pin.length < 6 || pin.length > 8 || !/^[0-9]+$/.test(pin)) return json({ error: "Enter your 1–6 digit business ID, name, phone or email, and a 6–8 digit PIN." }, 400);

      const ip = req.headers.get("cf-connecting-ip") || "unknown";
      const ipHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip))), b => b.toString(16).padStart(2, "0")).join("");
      const { data: merchant, error: merchantError } = await admin.from("merchants").select("id,country").eq("shericeri_id", Number(merchantCode)).maybeSingle();
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
        type: "email",
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
      const ownerAccountId = String(body?.owner_account_id || "").trim();
      const fullName = String(body?.full_name || "").trim();
      const email = String(body?.email || "").trim().toLowerCase() || null;
      let phone = String(body?.phone || "").trim() || null;
      const username = String(body?.username || "").trim().toLowerCase() || null;
      const pin = String(body?.pin || "");
      const role = String(body?.role || "cashier");
      const permissions = body?.permissions && typeof body.permissions === "object" ? body.permissions : {};

      if (!merchantId || !ownerAccountId || fullName.length < 2 || !phone || !/^\d{6,8}$/.test(pin)) {
        return json({ error: "Provide the business account, full name, phone number and a 6–8 digit PIN. Email is optional." }, 400);
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      
      if (username && !/^[a-z0-9._-]{3,40}$/.test(username)) return json({ error: "Username must be 3 to 40 letters, numbers, dots, underscores or hyphens." }, 400);
      if (!["admin", "manager", "cashier", "inventory", "accountant", "custom"].includes(role)) {
        return json({ error: "Invalid team role." }, 400);
      }

      const { data: merchant, error: merchantError } = await admin
        .from("merchants").select("id,user_id,country,shericeri_id").eq("id", merchantId).maybeSingle();
      if (merchantError || !merchant) return json({ error: "Business account not found." }, 404);
      if (String(merchant.shericeri_id || "") !== ownerAccountId) return json({ error: "The owner business ID does not match the selected business account." }, 403);
      if (phone) {
        phone = normalizePhoneForAuth(phone, merchant.country);
        if (!phone) return json({ error: "Enter a valid international phone number. For Rwanda, you may enter 078… or +25078… ." }, 400);
      }
      const isOwner = merchant.user_id === callerData.user.id;
      if (!isOwner && !(await hasActiveDeviceSession(admin, merchantId, callerData.user.id, bearer))) {
        return json({ error: "This device session is no longer authorized. Sign in again." }, 403);
      }
      let canManage = isOwner;
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
        "view_expenses", "manage_expenses", "view_financial_reports", "view_inventory_costs", "manage_finance",
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

      // Reuse an existing verified Auth identity when the owner is adding an
      // employee who already has an account. Never create a duplicate identity.
      let authUser: any = null;
      let createdAuthUser = false;
      if (email || (!email && phone)) {
        // Auth listUsers is paginated. Searching only page 1 can miss an existing
        // identity and make createUser fail with a misleading HTTP 500.
        const perPage = 1000;
        for (let page = 1; page <= 50 && !authUser; page++) {
          const { data: userPage, error: listError } = await admin.auth.admin.listUsers({ page, perPage });
          if (listError) throw listError;
          const users = userPage?.users || [];
          authUser = users.find((u: any) =>
            email ? String(u.email || "").toLowerCase() === email :
            String(u.phone || "").replace(/[^0-9+]/g, "") === phone
          ) || null;
          if (users.length < perPage) break;
        }
      }
      if (authUser?.id === merchant.user_id) {
        return json({ ok: false, code: "owner_identity", error: "The business owner's login cannot also be added as an employee." }, 409);
      }
      // An email already present in Supabase Auth belongs to an existing login.
      // Do not silently attach that identity to a new staff record or treat it as
      // a newly-created employee account. Require a unique, unused email for each
      // newly-created staff login; phone-only staff may still use their own flow.
      if (email && authUser) {
        return json({
          ok: false,
          code: "email_already_registered",
          error: "This email is already registered to an existing account. It cannot be reused to create or add a new staff login. Use an unused email address for a new staff account.",
        }, 409);
      }
      if (authUser && !authUser.email) {
        const internalEmail = "staff-" + authUser.id + "@example.com";
        const { data: updatedIdentity, error: identityError } = await admin.auth.admin.updateUserById(authUser.id, {
          email: internalEmail,
          email_confirm: true,
        });
        if (identityError || !updatedIdentity?.user) throw identityError || new Error("Could not prepare the staff sign-in identity.");
        authUser = updatedIdentity.user;
      }
      if (authUser) {
        const { data: existingMember, error: existingMemberError } = await admin.from("merchant_members")
          .select("id").eq("merchant_id", merchantId).eq("user_id", authUser.id).maybeSingle();
        if (existingMemberError) throw existingMemberError;
        if (existingMember) {
          return json({ ok: false, code: "member_exists", error: "This person is already on this business team. Use Edit access to change permissions or reset their PIN." }, 409);
        }
      } else {
        const authEmail = email || ("staff-" + crypto.randomUUID() + "@example.com");
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: authEmail,
          phone: phone || undefined,
          password: randomPassword(),
          email_confirm: true,
          phone_confirm: !!phone,
          user_metadata: { full_name: fullName },
        });
        if (createError || !created?.user) {
          const createFailure = createError as any;
          const createMessage = String(createFailure?.message || "").toLowerCase();
          const code = createFailure?.code ||
            (createFailure?.status === 422 && createMessage.includes("email") ? "email_exists" :
             createFailure?.status === 422 && createMessage.includes("phone") ? "phone_exists" : undefined);
          if (code === "email_exists" || code === "phone_exists") {
            return json({ ok: false, code, error: code === "email_exists"
              ? "This email already belongs to an account. If it is the employee's account, sign in using that account or contact support to link it; otherwise use another email."
              : "This phone number is already linked to an account. Use the employee's existing account or another phone number." }, 409);
          }
          throw createError || new Error("Could not create the login identity.");
        }
        authUser = created.user;
        createdAuthUser = true;
      }

      const { data: member, error: insertError } = await admin.from("merchant_members").insert({
        merchant_id: merchantId,
        user_id: authUser.id,
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
        if (createdAuthUser) await admin.auth.admin.deleteUser(authUser.id);
        throw insertError;
      }

      const { error: pinError } = await admin.rpc("set_merchant_member_pin", {
        p_member_id: member.id,
        p_pin: pin,
      });
      if (pinError) {
        await admin.from("merchant_members").delete().eq("id", member.id);
        if (createdAuthUser) await admin.auth.admin.deleteUser(authUser.id);
        throw pinError;
      }

      return json({ ok: true, member, reused_existing_auth_user: !createdAuthUser });
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
      let phone = body?.phone === undefined ? undefined : (String(body.phone || "").trim() || null);
      const username = body?.username === undefined ? undefined : (String(body.username || "").trim().toLowerCase() || null);
      const responsibility = String(body?.responsibility || "").trim() || null;
      const role = String(body?.role || "cashier");
      const status = String(body?.status || "active");
      const permissions = body?.permissions && typeof body.permissions === "object" ? body.permissions : {};
      const pin = String(body?.pin || "");
      if (!merchantId || !memberId || fullName.length < 2 || phone === null) return json({ error: "Business, member, full name and phone number are required. Email is optional." }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      
      if (username && !/^[a-z0-9._-]{3,40}$/.test(username)) return json({ error: "Username must be 3 to 40 letters, numbers, dots, underscores or hyphens." }, 400);
      if (!["admin", "manager", "cashier", "inventory", "accountant", "custom"].includes(role)) return json({ error: "Invalid team role." }, 400);
      if (!["active", "suspended"].includes(status)) return json({ error: "Invalid team status." }, 400);
      if (pin && !/^\d{6,8}$/.test(pin)) return json({ error: "A new PIN must contain 6 to 8 digits." }, 400);

      const { data: merchant, error: merchantError } = await admin.from("merchants").select("id,user_id,country,shericeri_id").eq("id", merchantId).maybeSingle();
      if (merchantError || !merchant) return json({ error: "Business account not found." }, 404);
      if (phone) {
        phone = normalizePhoneForAuth(phone, merchant.country);
        if (!phone) return json({ error: "Enter a valid international phone number. For Rwanda, you may enter 078… or +25078… ." }, 400);
      }
      const isOwner = merchant.user_id === callerData.user.id;
      if (!isOwner && !(await hasActiveDeviceSession(admin, merchantId, callerData.user.id, bearer))) {
        return json({ error: "This device session is no longer authorized. Sign in again." }, 403);
      }
      let callerRole = isOwner ? "owner" : null;
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
        .select("id,user_id,full_name,responsibility,permissions,role,status,email,phone,username").eq("id", memberId).eq("merchant_id", merchantId).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ error: "Team member not found." }, 404);
      const nextEmail = email === undefined ? target.email : email;
      const nextPhone = phone === undefined ? target.phone : phone;
      const nextUsername = username === undefined ? target.username : username;
      if (!nextPhone) return json({ error: "A staff phone number is mandatory. Email and username are optional." }, 400);
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

      // Revoke every registered device before suspending the membership.
      // The database authorization helper also checks revoked_at on every request.
      if (status === "suspended") {
        const { error: revokeError } = await admin.from("merchant_device_sessions")
          .update({ revoked_at: new Date().toISOString(), revoked_by: callerData.user.id })
          .eq("merchant_id", merchantId).eq("user_id", target.user_id).is("revoked_at", null);
        if (revokeError) throw revokeError;
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
      const authPatch: { email?: string; email_confirm?: boolean; phone?: string; phone_confirm?: boolean } = {};
      if (email && email !== target.email) {
        authPatch.email = email;
        authPatch.email_confirm = true;
      }
      if (phone !== undefined && phone !== target.phone) {
        authPatch.phone = phone;
        authPatch.phone_confirm = true;
      }
      if (Object.keys(authPatch).length) {
        const { error: authIdentityError } = await admin.auth.admin.updateUserById(target.user_id, authPatch);
        if (authIdentityError) {
          await admin.from("merchant_members").update({
            email: target.email, phone: target.phone, username: target.username,
            full_name: target.full_name, responsibility: target.responsibility,
            role: target.role, permissions: target.permissions, status: target.status
          }).eq("id", memberId).eq("merchant_id", merchantId);
          throw authIdentityError;
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
    const failure = error as any;
    const message = String(failure?.message || "").toLowerCase();
    const code = failure?.code ||
      (failure?.status === 422 && message.includes("email") ? "email_exists" :
       failure?.status === 422 && message.includes("phone") ? "phone_exists" : undefined);
    if (code === "email_exists" || code === "phone_exists") {
      return json({ ok: false, code, error: code === "email_exists"
        ? "This email is already registered. Use the employee's existing account or another email address."
        : "This phone number is already registered. Use the employee's existing account or another phone number." }, 409);
    }
    if (code === "23505") {
      return json({ ok: false, code: "duplicate_member_identifier", error: "This email, phone or username is already assigned to a team member in this business. Open that member's access settings instead." }, 409);
    }
    return json({ ok: false, error: "The team access request failed on the server. Check the details and try again." }, 500);
  }
});
