import {
  ArrowRight,
  ArrowUpRight,
  Archive,
  BriefcaseBusiness,
  CalendarDays,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  FileClock,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';

const ICONS = {
  archive: Archive,
  arrowRight: ArrowRight,
  arrowUpRight: ArrowUpRight,
  briefcase: BriefcaseBusiness,
  calendar: CalendarDays,
  calendarClock: CalendarClock,
  check: Check,
  checkCircle: CircleCheck,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  clock: Clock3,
  dashboard: LayoutDashboard,
  download: Download,
  eye: Eye,
  eyeOff: EyeOff,
  file: FileText,
  fileCheck: FileCheck2,
  fileClock: FileClock,
  history: History,
  info: CircleAlert,
  logout: LogOut,
  mapPin: MapPin,
  pencil: Pencil,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  settings: Settings2,
  shield: ShieldCheck,
  trash: Trash2,
  upload: Upload,
  user: UserRound,
  users: UsersRound,
  warning: CircleAlert,
  x: X,
};

export function Icon({ name, size = 18, strokeWidth = 1.8, className = '', ...props }) {
  const IconComponent = ICONS[name];
  if (!IconComponent) throw new Error(`Unknown icon: ${name}`);

  return (
    <IconComponent
      aria-hidden="true"
      className={`ui-icon ${className}`.trim()}
      size={size}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}
