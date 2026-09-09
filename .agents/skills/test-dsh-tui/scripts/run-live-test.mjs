import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const scriptRoot = dirname(fileURLToPath(import.meta.url))
const skillRoot = resolve(scriptRoot, '..')

function usage() {
  return [
    'Usage: node run-live-test.mjs --scenario <name|path> [options]',
    '  --project-root <path>       TUI source root (default: skill repository)',
    '  --tui-package <tgz>         Test an existing package instead of packing source',
    '  --extra-bundle <tgz>        Install another bundle; repeat for multiple bundles',
    '  --keep-artifacts            Retain logs and snapshots after success',
    '  --allow-model-requests      Forward credential-like environment variables',
  ].join('\n')
}

const { values } = parseArgs({
  options: {
    scenario: { type: 'string', short: 's' },
    'project-root': { type: 'string' },
    'tui-package': { type: 'string' },
    'extra-bundle': { type: 'string', multiple: true, default: [] },
    'keep-artifacts': { type: 'boolean', default: false },
    'allow-model-requests': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
})

if (values.help) {
  process.stdout.write(`${usage()}\n`)
  process.exit(0)
}
if (values.scenario === undefined || values.scenario.trim() === '') {
  process.stderr.write(`${usage()}\n`)
  process.exit(2)
}

function existingPath(value, label) {
  const path = resolve(value)
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`)
  return path
}

const projectRoot = existingPath(values['project-root'] ?? resolve(skillRoot, '../../..'), 'project root')
const scenarioCandidate = isAbsolute(values.scenario) ? values.scenario : resolve(values.scenario)
const scenarioPath = existsSync(scenarioCandidate)
  ? scenarioCandidate
  : existingPath(join(skillRoot, 'scenarios', `${values.scenario}.mjs`), 'scenario')
let tuiPackage = values['tui-package'] === undefined
  ? undefined
  : existingPath(values['tui-package'], 'TUI package')
const extraBundles = values['extra-bundle'].map((path, index) => existingPath(path, `extra bundle ${index + 1}`))

function resolveCommand(command) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(locator, [command], { encoding: 'utf8' })
  const candidates = result.status === 0 ? result.stdout.split(/\r?\n/).filter(Boolean) : []
  const path = process.platform === 'win32'
    ? candidates.find(candidate => /\.(?:exe|com|cmd|bat)$/i.test(candidate)) ?? candidates[0]
    : candidates[0]
  if (path === undefined) throw new Error(`Required command '${command}' is not available on PATH.`)
  return path
}

const commandPaths = new Map(['node', 'pnpm', 'dsh'].map(command => [command, resolveCommand(command)]))


function run(command, args, { cwd, env = process.env, logPath, inherit = false }) {
  const resolved = commandPaths.get(command) ?? command
  const windowsScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(resolved)
  const application = windowsScript ? process.env.ComSpec ?? 'cmd.exe' : resolved
  const argv = windowsScript ? ['/d', '/s', '/c', resolved, ...args] : args
  const result = spawnSync(application, argv, {
    cwd,
    env,
    encoding: inherit ? undefined : 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  })
  if (!inherit && logPath !== undefined) writeFileSync(logPath, `${result.stdout ?? ''}${result.stderr ?? ''}`)
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    if (!inherit && logPath !== undefined) process.stderr.write(readFileSync(logPath, 'utf8'))
    throw new Error(`${command} exited with code ${String(result.status)}.`)
  }
}

function newestPackage(directory) {
  return readdirSync(directory)
    .filter(name => /^yoke233-omdsh-.*\.tgz$/.test(name))
    .map(name => ({ path: join(directory, name), mtime: statSync(join(directory, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)[0]?.path
}

function printPtyTail(path, count = 80) {
  if (!existsSync(path)) return
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  process.stderr.write(`--- pty-output.log (last ${count} lines) ---\n${lines.slice(-count).join('\n')}\n`)
}

const id = `dsh-tui-live-${crypto.randomUUID().replaceAll('-', '')}`
const testRoot = join(tmpdir(), id)
const dshHome = join(testRoot, 'dsh-home')
const artifacts = join(testRoot, 'artifacts')
const harnessRoot = join(testRoot, 'harness')
mkdirSync(dshHome, { recursive: true })
mkdirSync(artifacts, { recursive: true })
mkdirSync(harnessRoot, { recursive: true })
let success = false

try {
  let packageSource = 'provided-package'
  if (tuiPackage === undefined) {
    packageSource = 'source-pack'
    run('pnpm', ['pack', '--pack-destination', artifacts], {
      cwd: projectRoot,
      logPath: join(artifacts, 'pack-tui.log'),
    })
    tuiPackage = newestPackage(artifacts)
    if (tuiPackage === undefined) throw new Error('pnpm pack did not produce a @yoke233/omdsh tarball.')
  }

  const isolatedEnv = { ...process.env, DSH_HOME: dshHome }
  run('dsh', ['plugin', '--profile', 'tui', 'add', tuiPackage], {
    cwd: projectRoot,
    env: isolatedEnv,
    logPath: join(artifacts, 'install-tui.log'),
  })
  for (const [index, bundle] of extraBundles.entries()) {
    run('dsh', ['plugin', '--profile', 'tui', 'add', bundle], {
      cwd: projectRoot,
      env: isolatedEnv,
      logPath: join(artifacts, `install-extra-${index + 1}.log`),
    })
  }

  writeFileSync(join(harnessRoot, 'package.json'), '{"private":true,"type":"module"}')
  const harnessPackages = ['add', 'node-pty@1.1.0', '@xterm/headless@5.5.0', '--allow-build=node-pty']
  if (values['keep-artifacts']) harnessPackages.push('sharp@0.34.5', '--allow-build=sharp')
  run('pnpm', harnessPackages, {
    cwd: harnessRoot,
    logPath: join(artifacts, 'install-harness.log'),
  })

  const configPath = join(testRoot, 'config.json')
  writeFileSync(configPath, `${JSON.stringify({
    id,
    projectRoot,
    dshHome,
    artifacts,
    harnessRoot,
    keepArtifacts: values['keep-artifacts'],
    allowModelRequests: values['allow-model-requests'],
    packageSource,
    tuiPackage,
    extraBundles,
  }, undefined, 2)}\n`)

  run(process.execPath, [join(scriptRoot, 'run-scenario.mjs'), configPath, scenarioPath], {
    cwd: projectRoot,
    env: isolatedEnv,
    inherit: true,
  })
  success = true
} finally {
  if (!success) printPtyTail(join(artifacts, 'pty-output.log'))
  if (success && !values['keep-artifacts']) {
    rmSync(testRoot, { recursive: true, force: true })
    process.stdout.write(`Live TUI artifacts cleaned: ${testRoot}\n`)
  } else {
    process.stdout.write(`Live TUI artifacts retained: ${testRoot}\n`)
  }
}
