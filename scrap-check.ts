// Runs scrap-check.wasm, the scrapscript type checker compiled to
// WebAssembly from cmd/scrap-check in Victorystick/scrapscript (see
// `npm run build:checker`), in the Worker, the browser and tests alike.

export interface CheckRequest {
  source: string;
  // The sources of the scraps that source refers to by hash, by hash.
  sources: Record<string, string>;
  // Whether to evaluate source if it checks.
  eval?: boolean;
}

export type CheckResult =
  | { type: string; value?: string; error?: string }
  | { error: string }
  | { missing: string[] };

interface Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  alloc(n: number): number;
  check(): number;
  output(): number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A Checker checks scraps with an instance of scrap-check.wasm. Starting
// the Go runtime takes far longer than a check, so hosts make one Checker
// and reuse it.
export class Checker {
  #module: WebAssembly.Module;
  #instance: Exports | null = null;

  constructor(module: WebAssembly.Module) {
    this.#module = module;
  }

  check(request: CheckRequest): CheckResult {
    const c = (this.#instance ??= start(this.#module));
    try {
      const input = encoder.encode(JSON.stringify(request));
      const ptr = c.alloc(input.length);
      new Uint8Array(c.memory.buffer, ptr, input.length).set(input);
      const n = c.check();
      return JSON.parse(
        decoder.decode(new Uint8Array(c.memory.buffer, c.output(), n))
      );
    } catch (e) {
      // A trap leaves the Go runtime broken; start afresh next time.
      this.#instance = null;
      throw e;
    }
  }
}

function start(module: WebAssembly.Module): Exports {
  let exports: Exports;
  const memory = () => new DataView(exports.memory.buffer);
  const instance = new WebAssembly.Instance(module, {
    wasi_snapshot_preview1: wasi(memory),
  });
  exports = instance.exports as unknown as Exports;
  exports._initialize();
  return exports;
}

const ESUCCESS = 0;
const EBADF = 8;
const ENOSYS = 52;

// wasi implements what the Go runtime imports from WASI preview 1, for a
// module that has no arguments, environment, files or sleeping, and only
// writes to stdout and stderr, as when it panics.
function wasi(memory: () => DataView) {
  const zero = (...ptrs: number[]) => {
    for (const p of ptrs) memory().setUint32(p, 0, true);
    return ESUCCESS;
  };
  const lines: Record<number, string> = { 1: '', 2: '' };

  return {
    args_sizes_get: zero,
    args_get: () => ESUCCESS,
    environ_sizes_get: zero,
    environ_get: () => ESUCCESS,
    clock_time_get(_id: number, _precision: bigint, ptr: number) {
      memory().setBigUint64(ptr, BigInt(Date.now()) * 1_000_000n, true);
      return ESUCCESS;
    },
    random_get(ptr: number, len: number) {
      const buf = new Uint8Array(memory().buffer, ptr, len);
      for (let i = 0; i < len; i += 65536) {
        crypto.getRandomValues(buf.subarray(i, i + 65536));
      }
      return ESUCCESS;
    },
    fd_write(fd: number, iovs: number, iovsLen: number, nwritten: number) {
      if (!(fd in lines)) return EBADF;
      const view = memory();
      let n = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view.getUint32(iovs + 8 * i, true);
        const len = view.getUint32(iovs + 8 * i + 4, true);
        lines[fd] += decoder.decode(new Uint8Array(view.buffer, ptr, len));
        n += len;
      }
      const parts = lines[fd].split('\n');
      lines[fd] = parts.pop()!;
      for (const line of parts) console.error(line);
      view.setUint32(nwritten, n, true);
      return ESUCCESS;
    },
    fd_fdstat_get(fd: number, ptr: number) {
      if (fd > 2) return EBADF;
      new Uint8Array(memory().buffer, ptr, 24).fill(0);
      memory().setUint8(ptr, 2); // A character device.
      return ESUCCESS;
    },
    fd_fdstat_set_flags: () => ESUCCESS,
    fd_read: () => EBADF,
    fd_close: () => EBADF,
    fd_prestat_get: () => EBADF,
    fd_prestat_dir_name: () => EBADF,
    poll_oneoff: () => ENOSYS,
    sched_yield: () => ESUCCESS,
    proc_exit(code: number) {
      throw new Error('the checker exited with status ' + code);
    },
  };
}
