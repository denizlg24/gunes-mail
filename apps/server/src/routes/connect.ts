import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { connectAccount, revokeSession } from "../auth";
import { env } from "../env";
import { IMAP_PRESETS, type ImapCredentials, verifyImapCredentials } from "../providers/imap";

const MICROSOFT_SCOPE =
  "offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read https://graph.microsoft.com/Contacts.Read https://graph.microsoft.com/People.Read";

const refreshBody = z.object({ refreshToken: z.string().min(10) });

async function exchangeRefreshToken(url: string, form: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", ...form }),
  });
  if (!res.ok) throw new HTTPException(401, { message: "The provider rejected the sign-in" });
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
}

export const connect = new Hono()
  .post("/google", async (c) => {
    const { refreshToken } = refreshBody.parse(await c.req.json());
    // Refreshing with our client secret proves the token was issued to this app.
    const token = await exchangeRefreshToken("https://oauth2.googleapis.com/token", {
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    });
    const info = (await (
      await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${token.access_token}` },
      })
    ).json()) as { sub: string; email: string; name?: string; picture?: string };
    if (!info.sub || !info.email) throw new HTTPException(401, { message: "Couldn't read the Google profile" });
    const result = await connectAccount(c, {
      provider: "gmail",
      providerUserId: info.sub,
      email: info.email,
      name: info.name ?? info.email,
      picture: info.picture,
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? refreshToken,
        expiresAt: Math.floor(Date.now() / 1000) + token.expires_in,
      },
    });
    return c.json(result);
  })
  .post("/microsoft", async (c) => {
    if (!env.MICROSOFT_CLIENT_ID) throw new HTTPException(501, { message: "Microsoft accounts aren't enabled" });
    const { refreshToken } = refreshBody.parse(await c.req.json());
    const token = await exchangeRefreshToken("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      refresh_token: refreshToken,
      client_id: env.MICROSOFT_CLIENT_ID,
      scope: MICROSOFT_SCOPE,
    });
    const me = (await (
      await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
        headers: { authorization: `Bearer ${token.access_token}` },
      })
    ).json()) as { id: string; displayName?: string; mail?: string | null; userPrincipalName?: string };
    const email = me.mail ?? me.userPrincipalName;
    if (!me.id || !email) throw new HTTPException(401, { message: "Couldn't read the Microsoft profile" });
    const result = await connectAccount(c, {
      provider: "microsoft",
      providerUserId: me.id,
      email,
      name: me.displayName ?? email,
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? refreshToken,
        expiresAt: Math.floor(Date.now() / 1000) + token.expires_in,
      },
    });
    return c.json(result);
  })
  .get("/imap/presets", (c) =>
    c.json(
      Object.entries(IMAP_PRESETS).map(([id, p]) => ({ id, label: p.label, appPasswordUrl: p.appPasswordUrl })),
    ),
  )
  .post("/imap", async (c) => {
    const server = z.object({ host: z.string().min(1), port: z.number().int(), secure: z.boolean() });
    const body = z
      .object({
        preset: z
          .string()
          .refine((v): v is keyof typeof IMAP_PRESETS => v in IMAP_PRESETS, "Unknown provider")
          .optional(),
        email: z.email(),
        name: z.string().default(""),
        username: z.string().optional(),
        password: z.string().min(1),
        imap: server.optional(),
        smtp: server.optional(),
      })
      .parse(await c.req.json());
    const preset = body.preset ? IMAP_PRESETS[body.preset] : undefined;
    const imap = body.imap ?? preset?.imap;
    const smtp = body.smtp ?? preset?.smtp;
    if (!imap || !smtp) throw new HTTPException(400, { message: "Server settings are required" });
    const credentials: ImapCredentials = {
      email: body.email.toLowerCase(),
      name: body.name || body.email,
      username: body.username || body.email,
      password: body.password,
      imap,
      smtp,
    };
    await verifyImapCredentials(credentials);
    const result = await connectAccount(c, {
      provider: "imap",
      providerUserId: `${credentials.username}@${imap.host}`,
      email: credentials.email,
      name: credentials.name,
      credentials,
    });
    return c.json(result);
  })
  .post("/sign-out", async (c) => {
    const header = c.req.header("authorization");
    if (header?.startsWith("Bearer ")) await revokeSession(header.slice(7));
    return c.body(null, 204);
  });
