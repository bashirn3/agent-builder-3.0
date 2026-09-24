import { SVGProps } from 'react'

function Svg(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...props} />
}

export function ChevronIcon() {
  return <Svg><path d="M4 6.25 8 10l4-3.75" /></Svg>
}
export function CloseIcon() {
  return <Svg><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></Svg>
}
export function ArrowUpIcon() {
  return <Svg><path d="M8 13V4M8 4 4.4 7.6M8 4l3.6 3.6" /></Svg>
}
export function MenuIcon() {
  return <Svg><path d="M3 4.5h10M3 8h10M3 11.5h10" /></Svg>
}
export function CollapseIcon() {
  return <Svg><path d="M10.5 3.5 6 8l4.5 4.5" /></Svg>
}
export function ExpandIcon() {
  return <Svg><path d="M5.5 3.5 10 8 5.5 12.5" /></Svg>
}
export function ExpandDialogIcon() {
  return <Svg><path d="M6 3.5H3.5V6M10 3.5h2.5V6M6 12.5H3.5V10M10 12.5h2.5V10" /></Svg>
}
export function ResetIcon() {
  return <Svg><path d="M12.2 8A4.2 4.2 0 1 1 8 3.8h1.4M9.4 2.4 11.2 3.8 9.4 5.2" /></Svg>
}
export function PlaygroundIcon() {
  return <Svg><path d="M4.2 3.6 12 8 4.2 12.4z" /></Svg>
}
export function ActivityIcon() {
  return <Svg><path d="M3.2 10.8 6 7.4l2.2 2.4 4.6-5.6" /></Svg>
}
export function ChatIcon() {
  return <Svg><path d="M3.4 4.2h9.2v6.4H7.1L4.4 12.8V10.6H3.4z" /></Svg>
}
export function LeadsIcon() {
  return (
    <Svg>
      <circle cx="6.2" cy="6" r="2" />
      <path d="M3.4 12.4c.4-2 1.8-3 2.8-3s2.4 1 2.8 3" />
    </Svg>
  )
}
export function ChartIcon() {
  return <Svg><path d="M3.4 12.2V8.4M6.8 12.2V4.2M10.2 12.2V6.6M13 12.2v-3" /></Svg>
}
export function SourceIcon() {
  return <Svg><path d="M4 3.4h6.2L12.6 5.8V12.6H4zM10.2 3.4v2.6h2.4" /></Svg>
}
export function BoltIcon() {
  return <Svg><path d="M9.2 2.8 4.6 8.6h3.2L6.8 13.2l5.2-6.4H8.6z" /></Svg>
}
export function PeopleIcon() {
  return (
    <Svg>
      <circle cx="6" cy="5.6" r="1.8" />
      <circle cx="10.4" cy="6.2" r="1.4" />
      <path d="M3.4 12.4c.4-2 1.7-3 2.6-3s2.2 1 2.6 3M9.2 12.2c.2-1.4 1.1-2.1 1.8-2.1s1.4.6 1.6 1.8" />
    </Svg>
  )
}
export function RocketIcon() {
  return <Svg><path d="M9.8 3.2c2 1.2 3 3.4 2.2 5.2L8.6 12.2 4 13.8l1.6-4.6 3.6-3.4C10.8 4.2 9.2 3.6 9.8 3.2zM6.4 9.8 5.2 11" /></Svg>
}
export function GearIcon() {
  return (
    <Svg>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 3.2v1.4M8 11.4v1.4M3.2 8h1.4M11.4 8h1.4M4.6 4.6l1 1M10.4 10.4l1 1M11.4 4.6l-1 1M5.6 10.4l-1 1" />
    </Svg>
  )
}
export function FilterIcon() {
  return <Svg><path d="M3 4.2h10L9.6 8.4v3.8L6.4 13.4V8.4z" /></Svg>
}
export function EyeIcon() {
  return (
    <Svg>
      <path d="M2.4 8S4.6 4.6 8 4.6 13.6 8 13.6 8 11.4 11.4 8 11.4 2.4 8 2.4 8z" />
      <circle cx="8" cy="8" r="1.5" />
    </Svg>
  )
}
export function EyeOffIcon() {
  return (
    <Svg>
      <path d="M3.2 3.2 12.8 12.8M6.2 6.3A2.4 2.4 0 0 0 6.6 9.6M9.7 9.8A2.4 2.4 0 0 0 9.4 6.4M4.2 5.2C3 6.1 2.4 8 2.4 8S4.6 11.4 8 11.4c.8 0 1.5-.1 2.2-.4M11.7 10.2C12.8 9.3 13.6 8 13.6 8S11.4 4.6 8 4.6c-.5 0-1 .05-1.4.14" />
    </Svg>
  )
}
export function CheckIcon() {
  return <Svg><path d="M3.6 8.2 6.4 11l6-6.4" /></Svg>
}
export function SearchIcon() {
  return (
    <Svg>
      <circle cx="7" cy="7" r="3.2" />
      <path d="m9.4 9.4 3 3" />
    </Svg>
  )
}
export function BackIcon() {
  return <Svg><path d="M10.4 3.6 5.6 8l4.8 4.4" /></Svg>
}
export function GoogleMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path fill="#4285F4" d="M14.9 8.16c0-.56-.05-1.1-.14-1.62H8.1v3.06h3.82a3.27 3.27 0 0 1-1.42 2.14v1.78h2.3c1.34-1.24 2.1-3.06 2.1-5.36z" />
      <path fill="#34A853" d="M8.1 15c1.92 0 3.53-.64 4.7-1.72l-2.3-1.78c-.64.43-1.46.68-2.4.68-1.85 0-3.41-1.25-3.97-2.93H1.76v1.84A6.9 6.9 0 0 0 8.1 15z" />
      <path fill="#FBBC05" d="M4.13 9.25A4.14 4.14 0 0 1 3.91 8c0-.43.08-.85.22-1.25V4.91H1.76A6.9 6.9 0 0 0 1.2 8c0 1.11.27 2.16.76 3.09l2.17-1.84z" />
      <path fill="#EA4335" d="M8.1 3.82c1.04 0 1.98.36 2.72 1.06l2.04-2.04A6.86 6.86 0 0 0 8.1 1a6.9 6.9 0 0 0-6.34 3.91l2.17 1.84C4.69 5.07 6.25 3.82 8.1 3.82z" />
    </svg>
  )
}
export function LockIcon() {
  return <Svg><path d="M5.2 7.2V5.6a2.8 2.8 0 0 1 5.6 0v1.6M4.4 7.2h7.2v5.6H4.4z" /></Svg>
}
export function RefreshIcon() {
  return <Svg><path d="M12.2 8A4.2 4.2 0 1 1 8 3.8h1.6M10 2.6 12 3.8 10 5" /></Svg>
}
export function MicIcon() {
  return <Svg><path d="M8 2.8a2 2 0 0 1 2 2v3.4a2 2 0 0 1-4 0V4.8a2 2 0 0 1 2-2zM4.2 7.6A3.8 3.8 0 0 0 8 11.4 3.8 3.8 0 0 0 11.8 7.6M8 11.4V13.2" /></Svg>
}
export function DotsIcon() {
  return <Svg><path d="M4 8h.01M8 8h.01M12 8h.01" /></Svg>
}
export function ChatFabIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M5 6.5h14v9.2H9.2L5 19.2z" />
    </svg>
  )
}
