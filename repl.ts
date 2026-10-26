/// <reference lib="dom" />
// Makes the examples on a page editable, and runs them in the browser with
// scrap-wasm.wasm, which prints what `scrap eval` and `scrap type` do, or
// `scrap test` for an example with data-run="test". Without this script,
// the examples show what they print as they are.
import { button, editable, highlight, Runner, runKeys, show } from './runner.ts';

const runner = new Runner();

// enhance makes an example editable, with a button that runs it.
function enhance(example: HTMLElement) {
  const code = example.querySelector<HTMLElement>('pre:first-child > code')!;
  const out = example.querySelector<HTMLElement>('pre.out')!;
  const command = example.dataset.run === 'test' ? 'test' : 'eval';
  const original = code.textContent!;
  // The page is built with the original code's highlights.
  const built = JSON.parse(code.dataset.highlights ?? '{}');
  highlight(code, built);

  const rehighlight = editable(runner, code, edited, run);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const hint = document.createElement('span');
  hint.textContent = runKeys;
  const reset = button('Reset', () => {
    code.textContent = original;
    highlight(code, built);
    edited();
    run();
  });
  reset.hidden = true;
  const runButton = button('Run', () => run());
  actions.append(hint, reset, runButton);
  code.parentElement!.after(actions);

  const share = example.hasAttribute('data-share');
  if (share && location.hash.length > 1) {
    code.textContent = decodeURIComponent(location.hash.slice(1));
    edited();
    rehighlight();
    run();
  }

  function edited() {
    reset.hidden = code.textContent === original;
    out.classList.add('stale');
  }

  async function run() {
    const source = code.textContent!;
    if (share) {
      history.replaceState(null, '', '#' + encodeURIComponent(source));
    }
    runButton.disabled = true;
    out.classList.add('stale');
    const result = await runner.run({ source, command });
    runButton.disabled = false;
    // Show only the latest run.
    if (code.textContent === source) {
      show(out, result);
    }
  }
}

for (const example of document.querySelectorAll<HTMLElement>('.example')) {
  enhance(example);
}
