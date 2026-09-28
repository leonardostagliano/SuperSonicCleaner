import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CopyCheck,
  Cpu,
  Database,
  Download,
  Eraser,
  ExternalLink,
  EyeOff,
  FileUp,
  FileX2,
  FolderClock,
  FolderX,
  Gamepad2,
  HardDrive,
  History,
  Info,
  LayoutDashboard,
  ListChecks,
  ListFilter,
  MousePointerClick,
  Package,
  PackageMinus,
  PackageX,
  Power,
  RotateCcw,
  Server,
  Settings,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Wifi,
  Wrench,
  type LucideIcon
} from 'lucide-react'
// The AI glyph marks AI features only (spec 3.6). Its lines carry the check's allow marker.
import { Sparkles } from 'lucide-react' // design-allow

/**
 * One glyph per concept, used by the sidebar, headers and actions alike, so a concept
 * never changes icon from one page to the next. Draw at 16 (inline), 20 (sidebar) or
 * 24 (empty states) with stroke 1.75.
 */
const conceptIcons = {
  home: LayoutDashboard,
  clean: Eraser,
  registry: Database,
  startup: Power,
  network: Wifi,
  schedule: CalendarClock,
  /** The Protection group of the sidebar. */
  protection: Shield,
  malware: ShieldAlert,
  privacy: EyeOff,
  firewall: ShieldCheck,
  performance: Activity,
  diagnostics: Stethoscope,
  services: Server,
  gameMode: Gamepad2,
  software: Package,
  updates: Download,
  drivers: Cpu,
  uninstall: PackageMinus,
  debloat: PackageX,
  contextMenu: MousePointerClick,
  storage: HardDrive,
  duplicates: CopyCheck,
  largeFiles: FileUp,
  emptyFolders: FolderX,
  shredder: FileX2,
  repair: Wrench,
  maintenance: Settings2,
  storageHistory: FolderClock,
  history: History,
  recovery: RotateCcw,
  settings: Settings,
  ai: Sparkles, // design-allow
  about: Info,
  applyRecommended: ListChecks,
  selectStale: ListFilter,
  allUpToDate: CheckCircle2,
  warning: AlertTriangle,
  note: Info,
  external: ExternalLink,
  next: ChevronRight
}

export type IconConcept = keyof typeof conceptIcons

export const icons: Record<IconConcept, LucideIcon> = conceptIcons
