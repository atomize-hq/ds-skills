import { matchCommand, type CommandSpec } from "./commands.js";

export type Invocation =
  | { readonly kind: "help"; readonly command: CommandSpec | undefined }
  | { readonly kind: "version" }
  | {
      readonly kind: "command";
      readonly command: CommandSpec;
      readonly json: boolean;
      readonly options: Readonly<Record<string, string>>;
      readonly rest: readonly string[];
    }
  | { readonly kind: "unknown"; readonly tokens: readonly string[] }
  | { readonly kind: "json-unsupported"; readonly command: CommandSpec };

/**
 * Parses argv into an invocation. Deliberately does no filesystem work: `--help`
 * and `--version` have to answer from outside any consumer repository.
 */
export function parseArgv(argv: readonly string[]): Invocation {
  const wantsHelp = argv.includes("--help") || argv.includes("-h");
  const wantsVersion = argv.includes("--version") || argv.includes("-V");
  const json = argv.includes("--json");

  const positional = argv.filter((token) => !token.startsWith("-"));
  const command = matchCommand(positional);

  // `--version` is only meaningful for the program itself, so it wins over a
  // command but not over `--help` for that command.
  if (wantsHelp) return { kind: "help", command };
  if (wantsVersion) return { kind: "version" };

  if (positional.length === 0) return { kind: "help", command: undefined };
  if (command === undefined) return { kind: "unknown", tokens: positional };

  // `--json` on a command nothing parses is a silent lie about the interface.
  if (json && !command.machineReadable)
    return { kind: "json-unsupported", command };

  const { options, rest } = splitOptions(argv, command);
  return { kind: "command", command, json, options, rest };
}

const booleanFlags = new Set([
  "--json",
  "--help",
  "-h",
  "--version",
  "-V",
  "--force",
]);

/**
 * `--key value` pairs and positionals. Deliberately dumb: the CLI validates
 * which options a command requires, so an unrecognized one is passed through
 * rather than silently dropped here.
 */
function splitOptions(
  argv: readonly string[],
  command: CommandSpec,
): { options: Record<string, string>; rest: string[] } {
  const options: Record<string, string> = {};
  const rest: string[] = [];
  const remainingPath = [...command.path];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (booleanFlags.has(token)) {
      options[token.replace(/^--?/, "")] = "true";
      continue;
    }
    if (token.startsWith("--")) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        options[token.slice(2)] = next;
        index += 1;
      } else {
        options[token.slice(2)] = "true";
      }
      continue;
    }
    if (remainingPath.length > 0 && remainingPath[0] === token) {
      remainingPath.shift();
      continue;
    }
    rest.push(token);
  }

  return { options, rest };
}
