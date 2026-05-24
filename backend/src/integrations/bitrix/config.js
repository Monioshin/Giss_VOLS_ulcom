function getBitrixInboundSecret() {
  return process.env.BITRIX_INBOUND_SECRET?.trim() || "";
}

/** Базовый URL входящего webhook Bitrix REST, с завершающим слэшем. Пример: https://portal.bitrix24.ru/rest/1/xxxxx/ */
function getBitrixRestWebhookBase() {
  const u = process.env.BITRIX_REST_WEBHOOK_URL?.trim() || "";
  return u.endsWith("/") ? u : u ? `${u}/` : "";
}

function getGisPublicUrl() {
  return (process.env.GIS_PUBLIC_URL || "http://localhost:5173").replace(/\/$/, "");
}

function isBitrixOutboundEnabled() {
  return Boolean(getBitrixRestWebhookBase());
}

module.exports = {
  getBitrixInboundSecret,
  getBitrixRestWebhookBase,
  getGisPublicUrl,
  isBitrixOutboundEnabled,
};
