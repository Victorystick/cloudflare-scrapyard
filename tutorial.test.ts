import { beforeAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The scrap CLI at the version that go.mod pins, which runs each example in
// tutorial.html as a reader would.
const scrap = './build/scrap';

interface Example {
  source: string;
  run?: string;
  outputs: Record<string, string>;
}

// examples returns the examples in html: a .example div holds the scrap
// in a <pre><code>, and what running it prints in <samp>s of a pre.out.
function examples(html: string): Example[] {
  const found: Example[] = [];
  const example =
    /<div class="example"(?: data-run="(\w+)")?>\s*<pre><code>([\s\S]*?)<\/code><\/pre>\s*<pre class="out">([\s\S]*?)<\/pre>\s*<\/div>/g;
  for (const [, run, source, out] of html.matchAll(example)) {
    const outputs: Record<string, string> = {};
    for (const [, kind, text] of out.matchAll(
      /<samp class="(\w+)">([\s\S]*?)<\/samp>/g
    )) {
      outputs[kind] = unescape(text);
    }
    found.push({ source: unescape(source), run, outputs });
  }
  return found;
}

function unescape(html: string): string {
  return html
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}

// run runs a scrap command on source, and returns what it prints.
function run(command: string, source: string): string {
  const result = spawnSync(scrap, [command, '--cache', './build/scraps'], {
    input: source,
    encoding: 'utf8',
  });
  return (result.stdout + result.stderr).trimEnd();
}

describe('tutorial', () => {
  beforeAll(() => {
    const build = spawnSync(
      'go build -o build/scrap github.com/Victorystick/scrapscript/cmd/scrap',
      { shell: true, stdio: 'pipe' }
    );
    if (build.status !== 0) {
      throw new Error('go build failed:\n' + build.stderr);
    }
  });

  const all = examples(readFileSync('./tutorial.html', 'utf8'));

  test('has examples', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  for (const { source, run: command, outputs } of all) {
    test(source, () => {
      if (command) {
        expect(run(command, source)).toBe(outputs.output);
      } else if ('error' in outputs) {
        expect(run('type', source)).toBe(outputs.error);
      } else {
        expect(run('eval', source)).toBe(outputs.value);
        expect(run('type', source)).toBe(outputs.type);
      }
    });
  }
});
