// Installs local git hooks via simple-git-hooks — silently.
//
// `npm pack` / `npm publish` run the `prepare` lifecycle script, and the Signal K plugin validator
// parses `npm pack --json`. Any stdout emitted here would corrupt that JSON, so ALL output is
// suppressed and failures are swallowed (e.g. when installed as a dependency, with no .git dir).
import { execSync } from 'node:child_process';

try {
  execSync('npx --no-install simple-git-hooks', { stdio: 'ignore' });
} catch {
  // Not a git checkout, or hooks unavailable — nothing to do.
}
