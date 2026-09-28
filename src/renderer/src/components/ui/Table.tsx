import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes
} from 'react'
import { cn } from '@/lib/utils'

/** Styled table primitives: neutral headers, hairline rows, numeric columns right-aligned
 *  with tabular figures. Pages keep their own row content. */
export function Table({ className, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return <table {...rest} className={cn('ui-table', className)} />
}

/** The header row: pass the header cells (`TableHeaderCell` or `<th>`) as children. */
export function TableHead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr>{children}</tr>
    </thead>
  )
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean
}

/** A column header; `numeric` aligns it with its right-aligned cells. */
export function TableHeaderCell({ numeric, scope = 'col', ...rest }: TableHeaderCellProps) {
  return <th {...rest} scope={scope} data-numeric={numeric || undefined} />
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** An amber rule on the first cell: a row the app recommends (pre-selected, "Consigliato"). */
  recommended?: boolean
  /** Marks a checked row for styling hooks; the row's checkbox carries the state. */
  selected?: boolean
}

export function TableRow({ recommended, selected, ...rest }: TableRowProps) {
  return (
    <tr
      {...rest}
      data-recommended={recommended || undefined}
      data-selected={selected || undefined}
    />
  )
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** Right-aligned, tabular figures, no wrapping. */
  numeric?: boolean
  /** Secondary information ("più vecchi di 24 ore"). */
  muted?: boolean
}

export function TableCell({ numeric, muted, ...rest }: TableCellProps) {
  return <td {...rest} data-numeric={numeric || undefined} data-muted={muted || undefined} />
}

export interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  /** Same amber rule as a recommended table row. */
  recommended?: boolean
}

/** A div-based row for lists that are not tables; consecutive rows get a hairline. */
export function ListRow({ recommended, className, ...rest }: ListRowProps) {
  return (
    <div
      {...rest}
      className={cn('ui-list-row', className)}
      data-recommended={recommended || undefined}
    />
  )
}
