export function mobileSearchPickerBounds(viewportTop: number, viewportHeight: number, inputBottom: number, dockTop?: number) {
  const bottom = Math.min(viewportTop + viewportHeight, dockTop ?? Infinity)
  const summaryTop = Math.max(viewportTop, bottom - 44)
  const top = Math.max(viewportTop, Math.min(inputBottom + 16, summaryTop - 44))
  return { top, height: Math.max(0, summaryTop - top), summaryTop }
}

export function isMobileSearchSubmit(inputType: string, composing: boolean) {
  return !composing && (inputType === 'insertLineBreak' || inputType === 'insertParagraph')
}
