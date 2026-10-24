// The type checker, as the Worker runs it.
import checkerModule from './scrap-check.wasm';
import { Checker, type CheckResult } from './scrap-check.ts';

// Each isolate starts one checker and reuses it.
const checker = new Checker(checkerModule);

// check checks source, given the sources of the scraps it refers to by hash.
export function check(
  source: string,
  sources: Record<string, string>
): CheckResult {
  return checker.check({ source, sources });
}
