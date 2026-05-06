import { parseNLQuery } from './app/lib/searchParsing'
const r = parseNLQuery('Stuttgart to anywhere for less than 200 euros, in June')
console.log(JSON.stringify(r, null, 2))
