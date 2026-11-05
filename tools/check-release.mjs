// Scan only the code repository. Optional private terms stay outside this checkout.
import { execFileSync } from 'node:child_process'
import { readFileSync, lstatSync, realpathSync } from 'node:fs'
import { relative, isAbsolute, sep } from 'node:path'
const args = process.argv.slice(2)
let history = false, staged = false, denyFile
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--history') history = true
  else if (args[i] === '--staged') staged = true
  else if (args[i] === '--deny-file' && args[i + 1]) denyFile = args[++i]
  else throw new Error('Usage: check-release.mjs [--staged] [--history] [--deny-file OUTSIDE_REPO.json]')
}
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const root = realpathSync(git('rev-parse', '--show-toplevel').trim())
const denyPath = denyFile ? realpathSync(denyFile) : null
process.chdir(root)
let privateTerms = []
if (denyPath) {
  const rel = relative(root, denyPath)
  if (rel === '' || (!rel.startsWith('..' + sep) && !isAbsolute(rel))) throw new Error('Private term file must be outside the checkout')
  privateTerms = JSON.parse(readFileSync(denyPath, 'utf8'))
  if (!Array.isArray(privateTerms) || privateTerms.some(t => typeof t !== 'string' || !t.trim())) throw new Error('Expected a JSON array of nonempty private terms')
}
const files = execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean)
if (!files.length) throw new Error('No staged/tracked release files to inspect')
const allowed = /^(?:README\.md|AGENTS\.md|SECURITY\.md|\.nvmrc|\.gitignore|docs\/[\w-]+\.md|examples\/[\w-]+\.json|tools\/[\w-]+(?:\.test)?\.mjs|\.github\/(?:workflows\/[\w-]+\.yml|dependabot\.yml)|web\/(?:app|features|shared|server|tests|config|tools)\/.+\.(?:ts|tsx|css|svg|py|mjs)|web\/(?:package(?:-lock)?\.json|tsconfig\.json|next-env\.d\.ts|next\.config\.ts|middleware\.ts|\.env\.example))$/
const issues=[]
function checkPath(name, mode = '100644') {
  if (!allowed.test(name) || /(?:^|\/)(?:node_modules|\.data|\.next|private|memory|sessions)(?:\/|$)/.test(name)) issues.push(name+': unexpected file')
  if (!['100644', '100755'].includes(mode)) issues.push(name+': link or unsupported object')
}
function checkText(name, text) {
  if (text.includes('\0')) issues.push(name+': binary content')
  if (/(?:\/Users\/[a-zA-Z0-9._-]+\/|\/home\/[a-zA-Z0-9._-]+\/|\/Volumes\/[^\s"']+)/.test(text)) issues.push(name+': absolute personal path')
  if (/\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b/.test(text) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) issues.push(name+': possible credential')
  if (privateTerms.some(term => text.includes(term))) issues.push(name+': private-context match (content withheld)')
}
const seenBlobs = new Set()
function checkBlob(name, sha, mode) {
  checkPath(name, mode)
  if (seenBlobs.has(sha) || mode === '160000') return
  seenBlobs.add(sha)
  checkText(name, git('cat-file', 'blob', sha))
}
for (const row of git('ls-files', '--stage', '-z').split('\0').filter(Boolean)) {
  const tab = row.indexOf('\t'), [mode, sha, stage] = row.slice(0, tab).split(' '), name = row.slice(tab + 1)
  if (stage !== '0') issues.push(name+': unmerged index')
  if (staged) checkBlob(name, sha, mode)
  else {
    checkPath(name, mode)
    if (lstatSync(name).isSymbolicLink()) issues.push(name+': symlink')
    else checkText(name, readFileSync(name, 'utf8'))
  }
}
let commits = []
if (history) {
  commits = git('rev-list', '--all').trim().split('\n').filter(Boolean)
  const trees = new Set()
  for (const commit of commits) {
    const tree = git('rev-parse', commit + '^{tree}').trim()
    if (trees.has(tree)) continue
    trees.add(tree)
    for (const row of git('ls-tree', '-rz', tree).split('\0').filter(Boolean)) {
      const tab = row.indexOf('\t'), [mode, , sha] = row.slice(0, tab).split(' ')
      checkBlob(row.slice(tab + 1), sha, mode)
    }
  }
}
if(issues.length) throw new Error([...new Set(issues)].join('\n'))
console.log(`PASS: ${files.length} release files${history ? `, ${commits.length} reachable commits` : ''}; no detected forbidden paths or sensitive patterns. Manual privacy review still required.`)
