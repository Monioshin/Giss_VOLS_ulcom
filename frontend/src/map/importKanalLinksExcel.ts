import { parseKanalLinksWorkbook } from '../import/excelImport'
import { createKanalLinksBulk, type KanalLinkBulkError } from './createKanalLink'

export type KanalLinksImportReport = {
  created: number
  skippedNotFound: number
  skippedOther: number
  parseErrors: number
  total: number
}

function countSkipReasons(errors: KanalLinkBulkError[]) {
  let skippedNotFound = 0
  let skippedOther = 0
  for (const e of errors) {
    if (e.code === 'not_found' || e.code === 'empty') skippedNotFound++
    else skippedOther++
  }
  return { skippedNotFound, skippedOther }
}

function formatReport(report: KanalLinksImportReport, errLines: string[]): string {
  const lines = [
    `Создано участков канализации: ${report.created}`,
    `Пропущено (ТК не найден в базе): ${report.skippedNotFound}`,
  ]
  if (report.skippedOther > 0) lines.push(`Пропущено (другие причины): ${report.skippedOther}`)
  if (report.parseErrors > 0) lines.push(`Ошибок разбора в Excel: ${report.parseErrors}`)
  lines.push(`Всего строк в файле: ${report.total}`)
  if (errLines.length) lines.push('', 'Примеры:', ...errLines)
  return lines.join('\n')
}

export async function importKanalLinksFromExcelBuffer(
  buffer: ArrayBuffer,
  apiBase: string,
  getAuthHeaders: () => HeadersInit,
  opts?: {
    onProgress?: (done: number, total: number) => void
    confirm?: (message: string) => boolean
    alert?: (message: string) => void
  },
): Promise<KanalLinksImportReport | null> {
  const confirm = opts?.confirm ?? ((msg: string) => window.confirm(msg))
  const alertFn = opts?.alert ?? ((msg: string) => window.alert(msg))

  const { rows, errors: parseErrors } = parseKanalLinksWorkbook(buffer)
  if (!rows.length) {
    const preview = parseErrors.slice(0, 8).join('\n')
    alertFn(parseErrors.length ? `Нет строк для импорта канализации:\n${preview}` : 'В файле нет строк для импорта')
    return null
  }

  const preview = rows
    .slice(0, 5)
    .map((r) => `стр. ${r.row}: ${r.start_tk_name} → ${r.end_tk_name}, ${r.length_m} м`)
    .join('\n')
  let confirmMsg =
    `Импорт канализации по ТК: ${rows.length} строк.\n\n` +
    `Строки, где колодец не найден в базе, будут пропущены.\n\n` +
    `${preview}${rows.length > 5 ? '\n…' : ''}`
  if (rows.length > 500) {
    confirmMsg += '\n\nФайл большой — загрузка частями по 500 строк (несколько минут).'
  }
  if (parseErrors.length) {
    confirmMsg += `\n\nОшибок разбора в файле: ${parseErrors.length} (будут пропущены).`
  }
  if (!confirm(confirmMsg)) return null

  const payload = rows.map((r) => ({
    row: r.row,
    start_tk_name: r.start_tk_name,
    end_tk_name: r.end_tk_name,
    length_m: r.length_m,
    passport_data: r.passport_data,
  }))

  const res = await createKanalLinksBulk(apiBase, getAuthHeaders, payload, opts?.onProgress)
  const { skippedNotFound, skippedOther } = countSkipReasons(res.errors)

  const report: KanalLinksImportReport = {
    created: res.summary.ok,
    skippedNotFound,
    skippedOther,
    parseErrors: parseErrors.length,
    total: rows.length + parseErrors.length,
  }

  const errLines = [
    ...parseErrors.slice(0, 3),
    ...res.errors.slice(0, 8).map((e) => `стр. ${e.row}: ${e.message}`),
  ]
  if (res.errors_truncated) errLines.push('…')
  alertFn(formatReport(report, errLines))

  return report
}
