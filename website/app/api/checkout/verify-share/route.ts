import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUid } from '../../../../lib/session-uid'
import { setUnlockCookie } from '../../../../lib/unlock-cookie'
import { createUnlockToken } from '../../../../lib/unlock-token'

export const runtime = 'nodejs'

const execFileAsync = promisify(execFile)

async function getAccessTokenFromGcloud(): Promise<string | null> {
  try {
    const command = process.platform === 'win32'
      ? {
          file: 'cmd.exe',
          args: ['/d', '/s', '/c', 'gcloud auth print-access-token'],
        }
      : {
          file: 'gcloud',
          args: ['auth', 'print-access-token'],
        }

    const { stdout } = await execFileAsync(command.file, command.args, {
      timeout: 5_000,
      windowsHide: true,
    })
    const token = stdout.trim()
    return token || null
  } catch (err) {
    console.warn('[verify-share] gcloud token refresh failed:', err)
    return null
  }
}

/**
 * POST /api/checkout/verify-share
 *
 * Accepts a screenshot (multipart/form-data: image + searchId).
 * Sends the image to Vertex AI Gemini for yes/no classification: does this look like
 * a social media share, post, story, or message? If yes, sets the unlock cookie.
 */

const VERTEX_PROJECT  = process.env.VERTEX_PROJECT  || 'sms-caller'
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'global'
const GEMINI_MODEL    = process.env.GEMINI_MODEL    || 'gemini-2.5-flash-lite'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])
const MAX_TRACKED_SCREENSHOTS_PER_UID = 50
const usedScreenshotFingerprintsByUid = new Map<string, Map<string, number>>()

function getScreenshotFingerprint(imageFile: File): string {
  const normalizedName = (imageFile.name || 'clipboard-image')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

  return `${normalizedName}|${imageFile.size}|${imageFile.lastModified || 0}`
}

function hasSeenScreenshot(uid: string, fingerprint: string): boolean {
  return usedScreenshotFingerprintsByUid.get(uid)?.has(fingerprint) ?? false
}

function rememberScreenshot(uid: string, fingerprint: string) {
  let seen = usedScreenshotFingerprintsByUid.get(uid)
  if (!seen) {
    seen = new Map<string, number>()
    usedScreenshotFingerprintsByUid.set(uid, seen)
  }

  seen.set(fingerprint, Date.now())

  while (seen.size > MAX_TRACKED_SCREENSHOTS_PER_UID) {
    const oldestKey = seen.keys().next().value
    if (!oldestKey) break
    seen.delete(oldestKey)
  }
}

/**
 * Fetch an OAuth2 access token.
 * On Cloud Run / GCE the metadata server always has a token.
 * For local dev, set GOOGLE_ACCESS_TOKEN (from: gcloud auth print-access-token).
 */
async function getAccessToken(forceFresh = false): Promise<string> {
  // Local dev override
  if (!forceFresh && process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN

  // Local dev fallback: refresh directly from gcloud instead of relying on a stale .env token.
  const gcloudToken = await getAccessTokenFromGcloud()
  if (gcloudToken) return gcloudToken

  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(3_000),
    },
  )
  if (!res.ok) throw new Error(`GCP metadata server responded ${res.status}`)
  const data = await res.json() as { access_token: string }
  return data.access_token
}

async function callVertexClassification(token: string, imageBase64: string, mimeType: string) {
  // https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest
  const apiBase = VERTEX_LOCATION === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${VERTEX_LOCATION}-aiplatform.googleapis.com`

  const url = `${apiBase}/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent`

  const body = {
    contents: [{
      role: 'user',
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: imageBase64,
          },
        },
        {
          text: 'Is this image a screenshot of social media content, a social media post, story, message, or a chat conversation? Answer with exactly one word: YES or NO.',
        },
      ],
    }],
    generationConfig: {
      maxOutputTokens: 5,
      temperature: 0,
    },
  }

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
}

async function classifyScreenshot(imageBase64: string, mimeType: string): Promise<boolean> {
  let token: string
  try {
    token = await getAccessToken()
  } catch (err) {
    console.error('[verify-share] Could not obtain access token:', err)
    return false
  }

  let res = await callVertexClassification(token, imageBase64, mimeType)
  if (res.status === 401) {
    try {
      const freshToken = await getAccessToken(true)
      if (freshToken && freshToken !== token) {
        console.warn('[verify-share] Vertex rejected cached token; retrying with fresh gcloud token')
        res = await callVertexClassification(freshToken, imageBase64, mimeType)
      }
    } catch (err) {
      console.error('[verify-share] Could not refresh access token after 401:', err)
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`[verify-share] Vertex AI error ${res.status}: ${text.slice(0, 200)}`)
    return false
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> }
    }>
  }

  const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() ?? ''
  return answer === 'YES'
}

export async function POST(req: NextRequest) {
  const uid = getSessionUid(req)
  if (!uid) {
    return NextResponse.json({ unlocked: false, error: 'No session' }, { status: 400 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ unlocked: false, error: 'Invalid form data' }, { status: 400 })
  }

  const searchId = formData.get('searchId')
  if (typeof searchId !== 'string' || !searchId || searchId.length > 128) {
    return NextResponse.json({ unlocked: false, error: 'Missing or invalid searchId' }, { status: 400 })
  }

  const imageFile = formData.get('image')
  if (!(imageFile instanceof File)) {
    return NextResponse.json({ unlocked: false, error: 'Missing image' }, { status: 400 })
  }

  if (imageFile.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ unlocked: false, error: 'Image too large (max 10 MB)' }, { status: 413 })
  }

  const mimeType = imageFile.type || 'image/jpeg'
  if (!ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json({ unlocked: false, error: 'Unsupported image type' }, { status: 415 })
  }

  const fingerprint = getScreenshotFingerprint(imageFile)
  if (hasSeenScreenshot(uid, fingerprint)) {
    console.info('[verify-share] duplicate screenshot blocked', {
      searchId,
      filename: imageFile.name || 'clipboard-image',
      uid,
    })
    return NextResponse.json({
      unlocked: false,
      error: 'This screenshot was already used. Please take a fresh screenshot and try again.',
      reason: 'duplicate_screenshot',
    }, { status: 409 })
  }

  try {
    const imageBase64 = Buffer.from(await imageFile.arrayBuffer()).toString('base64')
    const valid = await classifyScreenshot(imageBase64, mimeType)

    if (!valid) {
      console.info('[verify-share] screenshot rejected by classifier', {
        searchId,
        filename: imageFile.name || 'clipboard-image',
        mimeType,
        uid,
      })
      return NextResponse.json({
        unlocked: false,
        error: 'Screenshot not valid. Please take a clear screenshot and try again.',
        reason: 'invalid_screenshot',
      })
    }

    rememberScreenshot(uid, fingerprint)

    const response = NextResponse.json({
      unlocked: true,
      unlockToken: createUnlockToken(uid, searchId),
    })
    setUnlockCookie(response, req, searchId)
    return response
  } catch (err) {
    console.error('[verify-share] Unexpected error:', err)
    return NextResponse.json({ unlocked: false, error: 'Verification failed' }, { status: 500 })
  }
}
