// Content CLI, run with plain `node` (built-in type stripping, no build step):
//   node packages/content/src/cli.ts validate [instanceDir] [--strict]
//   node packages/content/src/cli.ts bake [--strict] [--web-dir <dir>]
import process from 'node:process';
import { runCli } from './node/cli.ts';

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    env: process.env,
    io: {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
  });
} catch (cause) {
  // Error messages can contain file paths of a private instance, and deploy logs are public:
  // print only the error kind unless CONTENT_DEBUG is set locally.
  const kind =
    cause instanceof Error ? ('code' in cause && String(cause.code)) || cause.name : 'Error';
  process.stderr.write(
    process.env.CONTENT_DEBUG
      ? `${String(cause instanceof Error ? cause.stack : cause)}\n`
      : `Unexpected ${kind}. Set CONTENT_DEBUG=1 for details.\n`,
  );
  process.exitCode = 1;
}
