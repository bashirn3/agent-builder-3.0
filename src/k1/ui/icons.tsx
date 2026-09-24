import type { CSSProperties } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  ArrowDown01Icon, ArrowExpand01Icon, ArrowLeft01Icon, ArrowRight01Icon, ArrowUp02Icon,
  Calendar03Icon, Copy01Icon, Download04Icon, EyeIcon, FileEditIcon, FilterHorizontalIcon,
  Heading01Icon, InformationCircleIcon, LeftToRightListBulletIcon, LeftToRightListNumberIcon,
  Link01Icon, Logout01Icon, Menu01Icon, Message01Icon, MessageMultiple01Icon, PlayIcon,
  HistoryIcon, Refresh01Icon, RefreshIcon, Rocket01Icon, SquareLock02Icon, SquareUnlock02Icon, TextBoldIcon,
  TextItalicIcon, ThumbsDownIcon, ThumbsUpIcon, UserIcon,  WhatsappIcon, BookOpen01Icon,
  Clock01Icon,
} from '@hugeicons/core-free-icons'
import { Check as LucideCheck, ChevronsUpDown as LucideUpDown, Eye as LucideEye, EyeOff as LucideEyeOff, MoreHorizontal as LucideMore, Pencil as PencilLucide, Plus as PlusLucide, Search as LucideSearch, Trash2 as Trash2Lucide, X as LucideX } from 'lucide-react'

type IconProps = { size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }

// Chatbase draws its navigation and section icons with Hugeicons (stroke-rounded) at 1.5.
function huge(icon: IconSvgElement, weight = 1.5) {
  return function Icon({ size = 16, className, style }: IconProps) {
    return <HugeiconsIcon icon={icon} size={size} strokeWidth={weight} className={className} style={style} aria-hidden="true" focusable="false" />
  }
}

// The few glyphs Chatbase takes from Lucide (search, more, close, chevrons, check).
function lucide(Component: typeof LucideX, weight = 1.75) {
  return function Icon({ size = 16, className, style }: IconProps) {
    return <Component size={size} strokeWidth={weight} className={className} style={style} aria-hidden="true" focusable="false" />
  }
}

export const ArrowLeft = huge(ArrowLeft01Icon)
export const ArrowUp = huge(ArrowUp02Icon, 2)
export const Bold = huge(TextBoldIcon)
export const Book = huge(BookOpen01Icon)
export const CalendarDays = huge(Calendar03Icon)
export const Plus = lucide(PlusLucide)
export const Pencil = lucide(PencilLucide)
export const Trash = lucide(Trash2Lucide)
export const Check = lucide(LucideCheck, 2)
export const ChevronDown = huge(ArrowDown01Icon)
export const ChevronLeft = huge(ArrowLeft01Icon)
export const ChevronRight = huge(ArrowRight01Icon)
export const ChevronsUpDown = lucide(LucideUpDown)
export const Clock = huge(Clock01Icon)
export const Copy = huge(Copy01Icon)
export const Download = huge(Download04Icon)
export const Eye = lucide(LucideEye)
export const EyeOff = lucide(LucideEyeOff)
export const FileText = huge(FileEditIcon)
export const Heading = huge(Heading01Icon)
export const History = huge(HistoryIcon)
export const Info = huge(InformationCircleIcon)
export const Link2 = huge(Link01Icon)
export const List = huge(LeftToRightListBulletIcon)
export const ListOrdered = huge(LeftToRightListNumberIcon)
export const Lock = huge(SquareLock02Icon)
export const Italic = huge(TextItalicIcon)
export const LockOpen = huge(SquareUnlock02Icon)
export const LogOut = huge(Logout01Icon)
export const Maximize2 = huge(ArrowExpand01Icon)
export const MenuIcon = huge(Menu01Icon)
export const MessageCircle = huge(Message01Icon)
export const MessageSquareMore = huge(Message01Icon)
export const MessagesSquare = huge(MessageMultiple01Icon)
export const MoreHorizontal = lucide(LucideMore)
export const Play = huge(PlayIcon)
export const RefreshCw = huge(Refresh01Icon)
export const Rocket = huge(Rocket01Icon)
export const RotateCcw = huge(RefreshIcon)
export const Search = lucide(LucideSearch)
export const SlidersHorizontal = huge(FilterHorizontalIcon)
export const ThumbsDown = huge(ThumbsDownIcon)
export const ThumbsUp = huge(ThumbsUpIcon)
export const UserRound = huge(UserIcon)
export const Activity = huge(EyeIcon)
export const WhatsApp = huge(WhatsappIcon)
export const X = lucide(LucideX)
