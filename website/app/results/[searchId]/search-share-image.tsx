import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SearchShareSummary } from './search-share-model'

export const RESULTS_SHARE_IMAGE_SIZE = {
  width: 1738,
  height: 905,
}

const backgroundImagePromise = readFile(join(process.cwd(), 'public', 'results-share-template.png'))
  .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)

const FROM_PLACE_MAX_CHARS_PER_LINE = 11
const TO_PLACE_MAX_CHARS_PER_LINE = 13
const PLACE_MAX_LINES = 2

function metricValueFontSize(value: string) {
  if (value.length >= 12) return 54
  if (value.length >= 9) return 62
  if (value.length >= 7) return 70
  if (value.length >= 6) return 74
  if (value.length >= 5) return 78
  return 82
}

function placeValueFontSize(maxLineLength: number, lineCount: number) {
  if (lineCount > 1) {
    if (maxLineLength >= 13) return 34
    if (maxLineLength >= 11) return 38
    return 42
  }

  if (maxLineLength >= 16) return 40
  if (maxLineLength >= 12) return 46
  return 50
}

function ellipsizeText(value: string, limit: number) {
  if (value.length <= limit) {
    return value
  }

  const trimmed = value.slice(0, Math.max(1, limit - 1)).trimEnd()
  return `${trimmed}…`
}

function normalizePlaceLabelForImage(label: string) {
  const compact = label.replace(/\s+/g, ' ').trim()
  const withoutParens = compact.replace(/\s*\([^)]*\)\s*$/g, '').trim()
  const beforeComma = (withoutParens.split(',')[0] || withoutParens).trim()
  const beforeDash = beforeComma.replace(/\s+[–-]\s+.*$/, '').trim()
  const withoutAirportSuffix = beforeDash
    .replace(
      /\s+(international airport|intercontinental airport|regional airport|municipal airport|domestic airport|airport|international|intl\.?|airfield|terminal)\s*$/i,
      '',
    )
    .trim()

  return withoutAirportSuffix || beforeDash || beforeComma || withoutParens || compact || 'Anywhere'
}

function splitLongWord(value: string, maxCharsPerLine: number) {
  const chunkSize = Math.max(4, maxCharsPerLine - 1)
  const parts: string[] = []
  let remaining = value

  while (remaining.length > maxCharsPerLine) {
    parts.push(`${remaining.slice(0, chunkSize)}-`)
    remaining = remaining.slice(chunkSize)
  }

  if (remaining.length > 0) {
    parts.push(remaining)
  }

  return parts
}

function joinWrappedSegments(segments: string[]) {
  return segments.reduce((acc, segment) => {
    if (!acc) {
      return segment
    }

    return acc.endsWith('-') ? `${acc}${segment}` : `${acc} ${segment}`
  }, '')
}

function buildPlaceLines(label: string, maxCharsPerLine: number) {
  const compact = normalizePlaceLabelForImage(label)
  if (!compact) {
    return ['Anywhere']
  }

  const lines: string[] = []
  let currentLine = ''

  for (const word of compact.split(' ')) {
    if (word.length > maxCharsPerLine) {
      if (currentLine) {
        lines.push(currentLine)
        currentLine = ''
      }

      lines.push(...splitLongWord(word, maxCharsPerLine))
      continue
    }

    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (candidate.length <= maxCharsPerLine) {
      currentLine = candidate
      continue
    }

    if (currentLine) {
      lines.push(currentLine)
    }
    currentLine = word
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines
}

export function wrapPlaceLabel(label: string, maxCharsPerLine: number, maxLines = PLACE_MAX_LINES) {
  const lines = buildPlaceLines(label, maxCharsPerLine)

  if (lines.length <= maxLines) {
    return lines
  }

  const visible = lines.slice(0, Math.max(0, maxLines - 1))
  const remainder = joinWrappedSegments(lines.slice(Math.max(0, maxLines - 1)))
  return [...visible, ellipsizeText(remainder, maxCharsPerLine)]
}

function longestLineLength(lines: string[]) {
  return lines.reduce((max, line) => Math.max(max, line.length), 0)
}

function placeLabelTop(lineCount: number) {
  return lineCount > 1 ? 488 : 503
}

function placeLabelHeight(lineCount: number) {
  return lineCount > 1 ? 88 : 58
}

function escapeSvgText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function buildGradientNumberDataUrl(value: string, fontSize: number) {
  const safeValue = escapeSvgText(value)
  const width = Math.max(240, Math.ceil(value.length * fontSize * 0.62 + fontSize * 0.9))
  const height = Math.ceil(fontSize * 1.08)
  const baseline = Math.round(height * 0.82)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="offersGradient" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stop-color="#ff5a00" />
          <stop offset="48%" stop-color="#ff9300" />
          <stop offset="100%" stop-color="#ffd11a" />
        </linearGradient>
      </defs>
      <text
        x="50%"
        y="${baseline}"
        text-anchor="middle"
        font-family="Arial Black, Arial, Helvetica, sans-serif"
        font-size="${fontSize}"
        font-weight="900"
        letter-spacing="-0.055em"
        fill="url(#offersGradient)"
      >${safeValue}</text>
    </svg>
  `.trim()

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function renderGradientNumber(value: string, fontSize: number) {
  const src = buildGradientNumberDataUrl(value, fontSize)

  return (
    <img
      src={src}
      alt=""
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
      }}
    />
  )
}

function renderPlaceLabel(lines: string[], fontSize: number) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: lines.length > 1 ? 'flex-start' : 'center',
        overflow: 'hidden',
        fontSize,
        fontWeight: 500,
        lineHeight: 0.98,
        letterSpacing: '-0.035em',
        color: '#1d1d22',
      }}
    >
      {lines.map((line, index) => (
        <div
          key={`${line}-${index}`}
          style={{
            display: 'block',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'clip',
          }}
        >
          {line}
        </div>
      ))}
    </div>
  )
}

export async function renderSearchShareImage(summary: SearchShareSummary) {
  const backgroundSrc = await backgroundImagePromise
  const fromLines = wrapPlaceLabel(summary.fromLabel, FROM_PLACE_MAX_CHARS_PER_LINE)
  const toLines = wrapPlaceLabel(summary.toLabel, TO_PLACE_MAX_CHARS_PER_LINE)
  const placeFontSize = placeValueFontSize(
    Math.max(longestLineLength(fromLines), longestLineLength(toLines)),
    Math.max(fromLines.length, toLines.length),
  )
  const offersFontSize = metricValueFontSize(summary.offersMetric.value)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 42,
          fontFamily: 'sans-serif',
          color: '#101321',
        }}
      >
        <img
          src={backgroundSrc}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: 208,
            top: placeLabelTop(fromLines.length),
            width: 238,
            height: placeLabelHeight(fromLines.length),
            display: 'flex',
            alignItems: 'stretch',
          }}
        >
          {renderPlaceLabel(fromLines, placeFontSize)}
        </div>

        <div
          style={{
            position: 'absolute',
            left: 492,
            top: placeLabelTop(toLines.length),
            width: 286,
            height: placeLabelHeight(toLines.length),
            display: 'flex',
            alignItems: 'stretch',
          }}
        >
          {renderPlaceLabel(toLines, placeFontSize)}
        </div>

        <div
          style={{
            position: 'absolute',
            left: 744,
            top: 478,
            width: 372,
            height: 108,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {renderGradientNumber(summary.offersMetric.value, offersFontSize)}
        </div>

        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
        </div>
      </div>
    ),
    RESULTS_SHARE_IMAGE_SIZE,
  )
}