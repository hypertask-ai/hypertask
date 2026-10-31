import {stringifyPosition} from 'unist-util-stringify-position'

export class VFileMessage extends Error {
  constructor(causeOrReason, optionsOrParentOrPlace, origin) {
    super()

    if (typeof optionsOrParentOrPlace === 'string') {
      origin = optionsOrParentOrPlace
      optionsOrParentOrPlace = undefined
    }

    /** @type {string} */
    let reason = ''
    /** @type {Options} */
    let options = {}
    let legacyCause = false

    if (optionsOrParentOrPlace) {
      if (
        'line' in optionsOrParentOrPlace &&
        'column' in optionsOrParentOrPlace
      ) {
        options = {place: optionsOrParentOrPlace}
      }
      else if (
        'start' in optionsOrParentOrPlace &&
        'end' in optionsOrParentOrPlace
      ) {
        options = {place: optionsOrParentOrPlace}
      }
      else if ('type' in optionsOrParentOrPlace) {
        options = {
          ancestors: [optionsOrParentOrPlace],
          place: optionsOrParentOrPlace.position
        }
      }
      else {
        options = {...optionsOrParentOrPlace}
      }
    }

    if (typeof causeOrReason === 'string') {
      reason = causeOrReason
    }
    else if (!options.cause && causeOrReason) {
      legacyCause = true
      reason = causeOrReason.message
      options.cause = causeOrReason
    }

    if (!options.ruleId && !options.source && typeof origin === 'string') {
      const index = origin.indexOf(':')

      if (index === -1) {
        options.ruleId = origin
      } else {
        options.source = origin.slice(0, index)
        options.ruleId = origin.slice(index + 1)
      }
    }

    if (!options.place && options.ancestors && options.ancestors) {
      const parent = options.ancestors[options.ancestors.length - 1]

      if (parent) {
        options.place = parent.position
      }
    }

    const start =
      options.place && 'start' in options.place
        ? options.place.start
        : options.place

    this.ancestors = options.ancestors || undefined

    this.cause = options.cause || undefined

    this.column = start ? start.column : undefined

    this.fatal = undefined

    this.file = ''

    this.message = reason

    this.line = start ? start.line : undefined

    this.name = stringifyPosition(options.place) || '1:1'

    this.place = options.place || undefined

    this.reason = this.message

    this.ruleId = options.ruleId || undefined

    this.source = options.source || undefined

    this.stack =
      legacyCause && options.cause && typeof options.cause.stack === 'string'
        ? options.cause.stack
        : ''


    this.actual = undefined

    this.expected = undefined

    this.note = undefined

    this.url = undefined
  }
}

for (const [key, value] of Object.entries({
  file: '',
  name: '',
  reason: '',
  message: '',
  stack: '',
  column: undefined,
  line: undefined,
  ancestors: undefined,
  cause: undefined,
  fatal: undefined,
  place: undefined,
  ruleId: undefined,
  source: undefined
})) {
  Object.defineProperty(VFileMessage.prototype, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true
  })
}
