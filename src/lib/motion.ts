export const ease = [0.16, 1, 0.3, 1] as const
export const motionMs = 200
export const space = { duration: 0.2, ease }
export const fade = { duration: 0.18, ease }
export const dialogMotion = { duration: 0.2, ease }
export const sheetMotion = { duration: 0.22, ease }

export const dialogVariants = {
  hidden: { opacity: 0, scale: 0.97, filter: 'blur(4px)' },
  shown: { opacity: 1, scale: 1, filter: 'blur(0px)' },
}

export const backdropVariants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1 },
}
