Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookSecret = Deno.env.get("KBK_WEBHOOK_SECRET");
  const providedSecret = request.headers.get("x-kbk-webhook-secret");
  if (!webhookSecret || !providedSecret || providedSecret !== webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const recipient = Deno.env.get("KBK_NOTIFICATION_EMAIL");
  const sender = Deno.env.get("KBK_NOTIFICATION_FROM");
  if (!apiKey || !recipient || !sender) {
    console.error("Inbox notification secrets are not configured.");
    return new Response("Inbox notification service is not configured", { status: 500 });
  }

  let payload: {
    type?: string;
    schema?: string;
    table?: string;
  };
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  if (
    payload.type !== "INSERT" ||
    payload.schema !== "public" ||
    !["kbk_assistance_requests", "kbk_public_feedback_messages"].includes(payload.table ?? "")
  ) {
    return new Response("Ignored event");
  }

  const isAssistance = payload.table === "kbk_assistance_requests";
  const subject = isAssistance ? "New KBK assistance request" : "New KBK contact message";
  const inboxUrl = Deno.env.get("KBK_INBOX_URL") ?? "";
  const text = [
    subject,
    "",
    "A new submission has been saved to the private KBK inbox.",
    "",
    "Open the admin Requests page to review it. Message and contact details are intentionally omitted from this notification.",
    inboxUrl,
  ].filter(Boolean).join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: sender, to: [recipient], subject, text }),
  });

  if (!response.ok) {
    console.error(`Resend rejected inbox notification with status ${response.status}.`);
    return new Response("Unable to deliver notification", { status: 502 });
  }
  return new Response("Notification sent");
});
