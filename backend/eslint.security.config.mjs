// @ts-check
// SAST-only ESLint config for the Jenkinsfile's "SAST — ESLint" stage.
//
// The Lab 06 manual runs `npx eslint --plugin security src/`, but ESLint 9's
// flat config has no --plugin flag, so the security plugin is wired in here.
// It is a separate file from eslint.config.mjs on purpose: this run reports
// only security findings (as SARIF), while `npm run lint` stays a style/
// correctness check.
import pluginSecurity from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', '**/*.spec.ts'] },
  // Parser + @typescript-eslint plugin with no rules enabled: needed to read
  // TypeScript and to resolve existing `eslint-disable` comments that name
  // @typescript-eslint rules.
  { files: ['**/*.ts'], ...tseslint.configs.base },
  // Those disable comments target rules this SAST run does not enable, so do
  // not report them as unused here; keep the report to security findings.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  pluginSecurity.configs.recommended,
);
