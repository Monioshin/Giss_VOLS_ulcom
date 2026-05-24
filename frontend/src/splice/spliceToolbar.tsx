const ONBOARDING_KEY = 'gis_splice_onboarding_dismissed'

type Props = {
  connectMode: boolean
  connectModeDisabled?: boolean
  snapGrid: boolean
  showItuColors: boolean
  linkPickLabel: string | null
  statsLine: string
  onConnectModeChange: (v: boolean) => void
  onSnapGridChange: (v: boolean) => void
  onShowItuChange: (v: boolean) => void
  onResetView: () => void
  onExportSvg: () => void
  onExportPng: () => void
}

export function SpliceToolbar({
  connectMode,
  connectModeDisabled = false,
  snapGrid,
  showItuColors,
  linkPickLabel,
  statsLine,
  onConnectModeChange,
  onSnapGridChange,
  onShowItuChange,
  onResetView,
  onExportSvg,
  onExportPng,
}: Props) {
  const showOnboarding =
    typeof localStorage !== 'undefined' && !localStorage.getItem(ONBOARDING_KEY)

  const dismissOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, '1')
  }

  return (
    <div className="splice-workspace__toolbar splice-pan-toolbar gis-toolbar">
      <label className="splice-workspace__toggle">
        <input type="checkbox" checked={connectMode} disabled={connectModeDisabled} onChange={() => onConnectModeChange(!connectMode)} />
        Режим связей <kbd>C</kbd>
      </label>
      <label className="splice-workspace__toggle">
        <input type="checkbox" checked={snapGrid} onChange={() => onSnapGridChange(!snapGrid)} />
        Snap 8px
      </label>
      <label className="splice-workspace__toggle">
        <input type="checkbox" checked={showItuColors} onChange={() => onShowItuChange(!showItuColors)} />
        Цвета ITU-T
      </label>
      <button type="button" className="splice-workspace__btn splice-workspace__btn--small gis-btn gis-btn--secondary" onClick={onResetView}>
        Сброс вида <kbd>F</kbd>
      </button>
      <button type="button" className="splice-workspace__btn splice-workspace__btn--small gis-btn gis-btn--secondary" onClick={onExportSvg}>
        SVG
      </button>
      <button type="button" className="splice-workspace__btn splice-workspace__btn--small gis-btn gis-btn--secondary" onClick={onExportPng}>
        PNG
      </button>
      <span className="hint splice-workspace__stats">{statsLine}</span>
      {connectMode && linkPickLabel ? <span className="hint">{linkPickLabel}</span> : null}
      <div className="splice-legend" aria-label="Легенда">
        <span className="splice-legend__item">
          <i className="splice-legend__dot splice-legend__dot--free" /> свободно
        </span>
        <span className="splice-legend__item">
          <i className="splice-legend__dot splice-legend__dot--busy" /> занято
        </span>
        <span className="splice-legend__item">
          <i className="splice-legend__dot splice-legend__dot--pick" /> выбор
        </span>
        <span className="splice-legend__item">
          <i className="splice-legend__line splice-legend__line--draft" /> черновик
        </span>
      </div>
      {showOnboarding ? (
        <p className="hint splice-onboarding">
          <strong>Подсказка:</strong> режим связей — два клика по волокнам или перетаскивание; ПКМ по полю — изгиб;
          клик по линии — выбор связи. <button type="button" className="splice-onboarding__dismiss" onClick={dismissOnboarding}>OK</button>
        </p>
      ) : null}
      <p className="hint splice-workspace__hint-rule">
        Панорама: перетаскивание, колесо — масштаб. <kbd>Esc</kbd> — сброс, <kbd>Del</kbd> — удалить связь, <kbd>Ctrl+S</kbd> — сохранить.
      </p>
    </div>
  )
}
