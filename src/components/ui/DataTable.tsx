import { useMemo, useState } from 'react'
import { EmptyState } from './EmptyState'
import { Skeleton } from './Skeleton'
import '../../styles/components/data-table.css'

export interface Column<T> {
  key: keyof T
  label: string
  /** Render custom — primește valoarea celulei și întregul rând. */
  render?: (value: T[keyof T], row: T) => React.ReactNode
  width?: string
  align?: 'left' | 'right' | 'center'
  /** Activează sortarea client-side pe această coloană. */
  sortable?: boolean
}

interface DataTableProps<T extends { id: string }> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  /** Câte skeleton row-uri să afișeze cât timp loading=true. */
  loadingRows?: number
  /** Titlu empty state (când data.length === 0 și nu e loading). */
  emptyTitle?: string
  emptyDescription?: string
  emptyIcon?: React.ReactNode
  emptyAction?: React.ReactNode
  /** Click pe rând — activează cursor pointer + hover. */
  onRowClick?: (row: T) => void
  /** Sortare inițială. */
  defaultSort?: SortState<T>
}

// Notă: exportat ca tip-util în jos ar fi un export non-componentă →
// react-refresh warning; păstrez intern + folosesc prin DataTableProps.
type SortState<T> = { key: keyof T; direction: 'asc' | 'desc' } | null

export function DataTable<T extends { id: string }>({
  columns,
  data,
  loading = false,
  loadingRows = 5,
  emptyTitle = 'Nicio înregistrare',
  emptyDescription,
  emptyIcon,
  emptyAction,
  onRowClick,
  defaultSort = null,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState<T>>(defaultSort)

  // Sortare in-place (creează un array nou).
  const sortedData = useMemo(() => {
    if (!sort) return data
    const { key, direction } = sort
    const factor = direction === 'asc' ? 1 : -1
    return [...data].sort((a, b) => {
      const av = a[key]
      const bv = b[key]
      if (av == null && bv == null) return 0
      if (av == null) return 1 * factor
      if (bv == null) return -1 * factor
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor
      return String(av).localeCompare(String(bv), 'ro', { numeric: true }) * factor
    })
  }, [data, sort])

  const toggleSort = (col: Column<T>) => {
    if (!col.sortable) return
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, direction: 'asc' }
      if (prev.direction === 'asc') return { key: col.key, direction: 'desc' }
      return null // ciclu: asc → desc → unsorted
    })
  }

  if (loading) {
    return (
      <div className="dt-skeleton">
        {Array.from({ length: loadingRows }).map((_, i) => (
          <Skeleton key={i} variant="table-row" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    )
  }

  return (
    <div className="dt-wrapper">
      <table className="dt">
        <thead>
          <tr>
            {columns.map((c) => {
              const isSorted = sort && sort.key === c.key
              const ariaSort: 'ascending' | 'descending' | 'none' = isSorted
                ? sort.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none'
              return (
                <th
                  key={String(c.key)}
                  style={{ width: c.width }}
                  className={`dt-th dt-align-${c.align ?? 'left'} ${
                    c.sortable ? 'dt-th--sortable' : ''
                  }`}
                  aria-sort={c.sortable ? ariaSort : undefined}
                  onClick={() => toggleSort(c)}
                >
                  {c.label}
                  {c.sortable && (
                    <span className="dt-sort-indicator" aria-hidden="true">
                      {isSorted ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, i) => (
            <tr
              key={row.id}
              className={`dt-row ${onRowClick ? 'dt-row--clickable' : ''}`}
              style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((c) => (
                <td key={String(c.key)} className={`dt-td dt-align-${c.align ?? 'left'}`}>
                  {c.render ? c.render(row[c.key], row) : String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
