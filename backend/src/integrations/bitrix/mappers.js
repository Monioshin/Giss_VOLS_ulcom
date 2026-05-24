/**
 * Согласованный маппинг пользовательских полей Bitrix24 ↔ GIS.
 * В Bitrix создайте UF_* поля в карточке сделки и укажите их коды в переменных окружения
 * (см. docs/bitrix-integration.md в корне репозитория).
 *
 * Переменные окружения (опционально, дефолты — типичные коды):
 * - BITRIX_UF_GIS_PROJECT_ID
 * - BITRIX_UF_GIS_FIBER_ORDER_ID
 * - BITRIX_UF_ROUTE_LENGTH_M
 * - BITRIX_UF_ROUTE_FREE_FIBERS
 * - BITRIX_UF_ROUTE_FOUND
 */

const DEFAULT_UF = {
  GIS_PROJECT_ID: "UF_CRM_GIS_PROJECT_ID",
  GIS_FIBER_ORDER_ID: "UF_CRM_GIS_FIBER_ORDER_ID",
  ROUTE_LENGTH_M: "UF_CRM_ROUTE_LENGTH_M",
  ROUTE_FREE_FIBERS: "UF_CRM_ROUTE_FREE_FIBERS",
  ROUTE_FOUND: "UF_CRM_ROUTE_FOUND",
};

function envOr(key, fallback) {
  const v = process.env[key];
  return v && String(v).trim() ? String(v).trim() : fallback;
}

function getBitrixUfCodes() {
  return {
    GIS_PROJECT_ID: envOr("BITRIX_UF_GIS_PROJECT_ID", DEFAULT_UF.GIS_PROJECT_ID),
    GIS_FIBER_ORDER_ID: envOr("BITRIX_UF_GIS_FIBER_ORDER_ID", DEFAULT_UF.GIS_FIBER_ORDER_ID),
    ROUTE_LENGTH_M: envOr("BITRIX_UF_ROUTE_LENGTH_M", DEFAULT_UF.ROUTE_LENGTH_M),
    ROUTE_FREE_FIBERS: envOr("BITRIX_UF_ROUTE_FREE_FIBERS", DEFAULT_UF.ROUTE_FREE_FIBERS),
    ROUTE_FOUND: envOr("BITRIX_UF_ROUTE_FOUND", DEFAULT_UF.ROUTE_FOUND),
  };
}

/** Поля для crm.deal.update после проверки маршрута */
function dealFieldsAfterRouteCheck(uf, { bestLengthM, minFreeFibers, routesCount }) {
  const fields = {};
  if (uf.ROUTE_LENGTH_M) fields[uf.ROUTE_LENGTH_M] = bestLengthM ?? "";
  if (uf.ROUTE_FREE_FIBERS) fields[uf.ROUTE_FREE_FIBERS] = minFreeFibers ?? "";
  if (uf.ROUTE_FOUND) fields[uf.ROUTE_FOUND] = routesCount > 0 ? "Y" : "N";
  return fields;
}

/** Поля для crm.deal.update после создания проекта GIS */
function dealFieldsAfterProjectCreated(uf, projectId) {
  const fields = {};
  if (uf.GIS_PROJECT_ID) fields[uf.GIS_PROJECT_ID] = projectId;
  return fields;
}

/** Поля для crm.deal.update после заказа по волокну */
function dealFieldsAfterFiberOrder(uf, fiberOrderId, totalLengthM, fiberCount) {
  const fields = {};
  if (uf.GIS_FIBER_ORDER_ID) fields[uf.GIS_FIBER_ORDER_ID] = fiberOrderId;
  if (uf.ROUTE_LENGTH_M) fields[uf.ROUTE_LENGTH_M] = totalLengthM ?? "";
  if (uf.ROUTE_FREE_FIBERS) fields[uf.ROUTE_FREE_FIBERS] = fiberCount ?? "";
  return fields;
}

module.exports = {
  getBitrixUfCodes,
  dealFieldsAfterRouteCheck,
  dealFieldsAfterProjectCreated,
  dealFieldsAfterFiberOrder,
  DEFAULT_UF,
};
