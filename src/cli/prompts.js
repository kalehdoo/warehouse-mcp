/**
 * Tiny wrapper around node:readline/promises so the rest of the CLI doesn't
 * have to mess with raw streams. Intentionally minimal — no fancy widgets,
 * just text input, choice menus, and yes/no.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

let _rl;

function rl() {
  if (!_rl) _rl = createInterface({ input, output });
  return _rl;
}

export function closePrompts() {
  if (_rl) {
    _rl.close();
    _rl = undefined;
  }
}

export async function ask(question, { defaultValue, hidden = false } = {}) {
  const suffix = defaultValue !== undefined ? ` [${hidden ? "***" : defaultValue}]` : "";
  const answer = await rl().question(`${question}${suffix}: `);
  const trimmed = answer.trim();
  if (!trimmed && defaultValue !== undefined) return String(defaultValue);
  return trimmed;
}

export async function askRequired(question, opts) {
  while (true) {
    const v = await ask(question, opts);
    if (v) return v;
    process.stdout.write("  Required.\n");
  }
}

export async function askYesNo(question, defaultValue = false) {
  const def = defaultValue ? "Y/n" : "y/N";
  while (true) {
    const a = (await rl().question(`${question} [${def}]: `)).trim().toLowerCase();
    if (!a) return defaultValue;
    if (a === "y" || a === "yes") return true;
    if (a === "n" || a === "no") return false;
    process.stdout.write("  Please answer y or n.\n");
  }
}

export async function askChoice(question, choices) {
  process.stdout.write(`${question}\n`);
  choices.forEach((c, i) => {
    process.stdout.write(`  ${i + 1}. ${c.label}\n`);
  });
  while (true) {
    const a = (await rl().question(`Choose [1-${choices.length}]: `)).trim();
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
      return choices[n - 1];
    }
    process.stdout.write(`  Enter a number 1-${choices.length}.\n`);
  }
}
