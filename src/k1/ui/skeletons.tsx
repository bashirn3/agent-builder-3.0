import { useCopy } from '../i18n'
import { Skeleton } from './controls'

const EDITOR_LINES = [92, 78, 86, 64, 90, 70, 82, 58, 88]

// The app frame while sign-in is still resolving, so the page never starts blank.
export function AppSkeleton({ compact }: { compact: boolean }) {
  const t = useCopy()
  return (
    <div className="k1-app" role="status" aria-label={t.common.loading}>
      <header className={`k1-header${compact ? ' k1-header--mobile' : ''}`}>
        <Skeleton width={96} height={22} />
        {!compact && <span className="k1-skel-crumbs"><Skeleton width={96} height={12} /><Skeleton width={110} height={12} /></span>}
        <span className="k1-skel-header-end"><Skeleton width={compact ? 24 : 26} height={compact ? 24 : 26} radius={999} /></span>
      </header>
      <div className="k1-body">
        {!compact && (
          <aside className="k1-sidebar">
            <div className="k1-skel-nav">
              {[70, 56, 48, 44, 52, 46].map((width, index) => <Skeleton key={index} width={`${width}%`} height={14} />)}
            </div>
          </aside>
        )}
        <main className="k1-main k1-skel-page">
          <Skeleton width={160} height={24} />
          <Skeleton height={36} radius={10} className="k1-skel-page__bar" />
          <div className="k1-skel-card k1-skel-card--editor">
            {EDITOR_LINES.map((width, index) => <Skeleton key={index} height={12} width={`${width}%`} />)}
          </div>
        </main>
      </div>
    </div>
  )
}

export function EditorSkeleton({ label }: { label: string }) {
  return (
    <div className="k1-skel-card k1-skel-card--editor" role="status" aria-label={label}>
      {EDITOR_LINES.map((width, index) => <Skeleton key={index} height={12} width={`${width}%`} />)}
    </div>
  )
}

// A chat opening: title, tabs and a few alternating bubbles.
export function ThreadSkeleton({ label }: { label: string }) {
  const bubbles: Array<['agent' | 'user', string, number]> = [['agent', '64%', 76], ['user', '38%', 40], ['agent', '56%', 58], ['user', '30%', 40]]
  return (
    <section className="k1-detail" role="status" aria-label={label}>
      <header className="k1-detail__head">
        <div className="k1-detail__titlebar"><Skeleton width="45%" height={18} /><Skeleton width={32} height={32} /></div>
        <div className="k1-skel-tabs"><Skeleton width={48} height={14} /><Skeleton width={56} height={14} /></div>
      </header>
      <div className="k1-detail__body k1-skel-thread">
        <Skeleton width={180} height={12} />
        {bubbles.map(([role, width, height], index) => (
          <span key={index} className={`k1-skel-bubble k1-skel-bubble--${role}`}><Skeleton width={width} height={height} radius={20} /></span>
        ))}
      </div>
    </section>
  )
}

// Rows shaped like the version and member cards they stand in for.
export function RowCardsSkeleton({ rows = 3, avatar = false, label }: { rows?: number; avatar?: boolean; label: string }) {
  return (
    <ul className="k1-versions" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="k1-version k1-skel-version">
          {avatar && <Skeleton width={36} height={36} radius={999} />}
          <span className="k1-skel-card__lines">
            <Skeleton width={avatar ? '34%' : 48} height={14} />
            <Skeleton width={avatar ? '46%' : '38%'} height={12} />
            <Skeleton width={avatar ? '22%' : '52%'} height={10} />
          </span>
          {!avatar && <Skeleton width={148} height={32} />}
        </li>
      ))}
    </ul>
  )
}

const CELL_WIDTHS = [64, 150, 80, 80, 48, 110, 120]

// Keeps the real column headings so the table does not jump when rows arrive.
export function TableSkeleton({ columns, rows = 6, label }: { columns: string[]; rows?: number; label: string }) {
  return (
    <table className="k1-table k1-skel-table" role="status" aria-label={label}>
      <thead>
        <tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, row) => (
          <tr key={row}>
            {columns.map((column, index) => (
              <td key={column}><Skeleton width={Math.max(32, CELL_WIDTHS[index % CELL_WIDTHS.length] - ((row * 13 + index * 7) % 24))} height={12} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function CardListSkeleton({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <ul className="k1-lead-cards" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index}>
          <span className="k1-lead-card k1-skel-lead-card">
            <span className="k1-skel-row__top"><Skeleton width={72} height={14} /><Skeleton width={64} height={12} /></span>
            <Skeleton width="55%" height={12} />
            <Skeleton width="40%" height={12} />
          </span>
        </li>
      ))}
    </ul>
  )
}

// One Compare column before its version is ready.
export function CompareColumnSkeleton() {
  return (
    <div className="k1-compare__col k1-skel-compare">
      <div className="k1-compare__head"><Skeleton height={34} style={{ flex: 1 }} /><Skeleton width={28} height={28} /><Skeleton width={28} height={28} /></div>
      <div className="k1-compare__thread"><Skeleton width="72%" height={76} radius={20} /></div>
      <div className="k1-tester__composer k1-tester__composer--skeleton"><Skeleton width="40%" height={12} /></div>
    </div>
  )
}
