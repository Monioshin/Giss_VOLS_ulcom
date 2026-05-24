const { getBitrixRestWebhookBase } = require("./config");

function appendFormFields(body, obj, prefix) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = `${prefix}[${k}]`;
    if (typeof v === "object" && !Array.isArray(v)) {
      appendFormFields(body, v, key);
    } else {
      body.set(key, typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));
    }
  }
}

/**
 * @param {string} method например "tasks.task.add"
 * @param {Record<string, unknown>} params верхнеуровневые параметры (id, fields — объект)
 */
async function bitrixRestCall(method, params = {}) {
  const base = getBitrixRestWebhookBase();
  if (!base) {
    return { skipped: true, reason: "BITRIX_REST_WEBHOOK_URL not set" };
  }
  const url = `${base}${method}`;
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (k === "fields" && typeof v === "object" && !Array.isArray(v)) {
      appendFormFields(body, v, "fields");
    } else if (typeof v === "object") {
      body.set(k, JSON.stringify(v));
    } else {
      body.set(k, String(v));
    }
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: body.toString(),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, result: json };
    }
    if (json.error) {
      return { ok: false, result: json };
    }
    return { ok: true, result: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function bitrixTasksTaskAdd(taskFields) {
  return bitrixRestCall("tasks.task.add", { fields: taskFields });
}

async function bitrixCrmDealUpdate(dealId, dealFields) {
  return bitrixRestCall("crm.deal.update", { id: dealId, fields: dealFields });
}

module.exports = { bitrixRestCall, bitrixTasksTaskAdd, bitrixCrmDealUpdate, appendFormFields };
