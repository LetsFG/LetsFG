import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEBSITE_ROOT = path.resolve(TEST_DIR, '..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(WEBSITE_ROOT, relativePath), 'utf8')
}

test('home search form merges Gemini trip_purposes and uses normalized purpose presence for convo gating', () => {
  const source = readSource('app/home-search-form.tsx')
  const parseRouteSource = readSource('app/api/parse-query/route.ts')
  const vertexParseSource = readSource('app/lib/vertex-parse.ts')

  assert.doesNotMatch(source, /import \{ applyVertexIntent \} from '\.\/lib\/vertex-intent'/)
  assert.doesNotMatch(source, /import \{ parseNLQuery \} from '\.\/lib\/searchParsing'/)
  assert.doesNotMatch(source, /buildPartySizeQuestionSpec/)
  assert.doesNotMatch(source, /buildPriorityQuestionSpec/)
  assert.match(source, /trip_purposes\?: TripPurpose\[\] \| null/)
  assert.match(source, /follow_up_questions\?: GeminiClarificationQuestion\[\] \| null/)
  assert.doesNotMatch(source, /const needsGeminiAssist =/)
  assert.doesNotMatch(source, /const needsLaunchClarification = !isSearchLaunchReady\(trimmed, _nlp\)/)
  assert.match(source, /const aiFollowUpPlanPromise = fetch\('\/api\/parse-query'/)
  assert.match(source, /const aiFollowUpResponse = await aiFollowUpPlanPromise/)
  assert.match(source, /const buildAiConvoQuestions = useCallback\(/)
  assert.match(source, /const CONVO_QUESTIONS = convo\?\.questions \?\? \[\]/)
  assert.match(source, /const aiQuestions = buildAiConvoQuestions\(ai\)/)
  assert.match(source, /if \(aiQuestions\.length === 0\) \{\s+setConvo\(null\)/)
  assert.match(source, /openClarificationConvo\(trimmed, ai\)/)
  assert.match(parseRouteSource, /import \{ vertexClarify \} from '\.\.\/\.\.\/lib\/vertex-parse'/)
  assert.match(parseRouteSource, /const ai = await vertexClarify\(query, today\)/)
  assert.match(vertexParseSource, /import \{ getLetsfgApiBase, withLetsfgWebsiteApiHeaders \} from '\.\.\/\.\.\/lib\/letsfg-api'/)
  assert.match(vertexParseSource, /export interface VertexFollowUpQuestion \{/)
  assert.match(vertexParseSource, /const url = `\$\{getLetsfgApiBase\(\)\}\/api\/v1\/flights\/ai-intent`/)
  assert.match(vertexParseSource, /headers: withLetsfgWebsiteApiHeaders\(\{ 'Content-Type': 'application\/json' \}\)/)
  assert.match(vertexParseSource, /body: JSON\.stringify\(\{ query, today, mode: options\.mode \}\)/)
  assert.doesNotMatch(vertexParseSource, /GEMINI_API_KEY/)
  assert.doesNotMatch(vertexParseSource, /metadata\.google\.internal/)
})