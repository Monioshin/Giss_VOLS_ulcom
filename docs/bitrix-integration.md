# Интеграция GIS с Bitrix24

**Пошаговая инструкция (чеклист):** [bitrix24-integration-steps.md](./bitrix24-integration-steps.md)

Ниже — справочник по переменным, полям UF и телам запросов. Все входящие вызовы (кроме выпуска embed-токена) защищены секретом.

## Переменные окружения

| Переменная | Назначение |
|------------|------------|
| `BITRIX_INBOUND_SECRET` | Общий секрет: заголовок `X-GIS-Bitrix-Secret` или query `?secret=` |
| `BITRIX_REST_WEBHOOK_URL` | URL входящего webhook Bitrix с правами REST, **с завершающим `/`**. Пример: `https://YOUR_PORTAL.bitrix24.ru/rest/1/xxxxxxxx/` |
| `GIS_PUBLIC_URL` | Публичный URL фронтенда для ссылок в задачах (по умолчанию `http://localhost:5173`) |
| `BITRIX_DEFAULT_TASK_RESPONSIBLE_ID` | ID пользователя Bitrix — ответственный за задачу «авария» (по умолчанию `1`) |

### Пользовательские поля сделки (UF)

Создайте в CRM поля с кодами по умолчанию или задайте свои через env:

| Env | Значение по умолчанию | Смысл |
|-----|----------------------|--------|
| `BITRIX_UF_GIS_PROJECT_ID` | `UF_CRM_GIS_PROJECT_ID` | ID проекта GIS |
| `BITRIX_UF_GIS_FIBER_ORDER_ID` | `UF_CRM_GIS_FIBER_ORDER_ID` | ID заказа по волокну |
| `BITRIX_UF_ROUTE_LENGTH_M` | `UF_CRM_ROUTE_LENGTH_M` | Длина лучшего маршрута, м |
| `BITRIX_UF_ROUTE_FREE_FIBERS` | `UF_CRM_ROUTE_FREE_FIBERS` | Мин. свободных волокон на маршруте |
| `BITRIX_UF_ROUTE_FOUND` | `UF_CRM_ROUTE_FOUND` | `Y` / `N` — маршрут найден |

Справочник с текущими значениями из env:

```http
GET /integrations/bitrix/field-catalog
X-GIS-Bitrix-Secret: <BITRIX_INBOUND_SECRET>
```

## Эндпоинты (Bitrix → GIS)

### Проверка маршрута (MVP-1)

`POST /integrations/bitrix/route-check`

```json
{
  "start_node_id": 1,
  "end_node_id": 2,
  "required_free_fibers": 1,
  "deal_id": 99,
  "update_bitrix_deal": true
}
```

При `update_bitrix_deal: true` и `deal_id` вызывается `crm.deal.update` с UF полями маршрута.

### Ближайшие муфты/кроссы к точке

`POST /integrations/bitrix/nearest-endpoints`

```json
{ "lat": 55.75, "lng": 37.62, "limit": 10 }
```

### Сделка выиграна → проект GIS (Phase-2)

`POST /integrations/bitrix/deal-won`

```json
{
  "deal_id": 99,
  "title": "Подключение офиса",
  "description": "Комментарий",
  "update_bitrix_deal": true
}
```

### Массовая смена статуса ВОЛС по проекту (строительство)

`POST /integrations/bitrix/project-edges-status`

```json
{ "project_id": 5, "cable_status": "IN_WORK" }
```

### Webhook: заявка закрыта → снять аварию в GIS

`POST /integrations/bitrix/webhook`

```json
{
  "type": "task_completed",
  "workspace_slug": "test",
  "edge_id": 12,
  "new_cable_status": "READY"
}
```

`workspace_slug` должен совпадать с **активной** базой GIS на сервере (перед вызовом переключите workspace в админке или вызывайте с того же инстанса, где активна нужная база).

## Заказ по волокну + Bitrix

В теле `POST /fiber-orders` (обычная авторизация GIS) можно передать:

```json
"bitrix_deal_id": 99
```

После создания заказа выполняется `crm.deal.update` с UF заказа и длины.

## Авария → задача Bitrix

При смене статуса оптического участка на `ACCIDENT` создаётся задача в Bitrix (если задан `BITRIX_REST_WEBHOOK_URL`). Пара `(workspace_slug, edge_id)` сохраняется в `system.sqlite` → таблица `bitrix_edge_incidents`.

## Embed карты (MVP-2)

1. Администратор GIS: `GET /integrations/bitrix/embed-token?highlight_edge_id=5` (Bearer JWT).
2. Ответ: `{ "token", "embedUrl", "expiresInSeconds" }`.
3. Откройте `embedUrl` в iframe в карточке Bitrix. Фронтенд читает `#embed=...`, сохраняет токен в `sessionStorage` и работает в режиме **только чтение** (роль USER).

## Робот Bitrix

Создайте исходящий webhook на URL вашего GIS, например:

`POST https://gis.company.ru/integrations/bitrix/route-check`

с телом JSON и заголовком `X-GIS-Bitrix-Secret`.
