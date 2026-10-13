import { spawn } from "node:child_process";

export interface PtySize {
  cols: number;
  rows: number;
}

export type PtyExit = { kind: "exited"; code: number | null } | { kind: "failed"; message: string };

export interface Pty {
  write(data: string): void;
  resize(size: PtySize): void;
  kill(): void;
}

/*
 * Why not node-pty: ネイティブモジュールは Obsidian の Electron ABI に合わせたビルドが要り、
 * Obsidian の更新で壊れる。python3 の標準ライブラリ pty なら macOS と Linux でそのまま動く。
 * fd 0/1 が端末の入出力、fd 3 が "cols rows\n" 形式のリサイズ通知。
 */
const HELPER = `
import fcntl, os, pty, select, signal, struct, sys, termios

def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

def write_all(fd, data):
    while data:
        data = data[os.write(fd, data):]

cols, rows, argv = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
pid, master = pty.fork()
if pid == 0:
    set_size(0, cols, rows)
    os.execvp(argv[0], argv)

control = b""
sources = [0, master, 3]
while True:
    readable, _, _ = select.select(sources, [], [])
    if master in readable:
        try:
            data = os.read(master, 65536)
        except OSError:
            data = b""
        if not data:
            break
        write_all(1, data)
    if 0 in readable:
        data = os.read(0, 65536)
        if not data:
            os.kill(pid, signal.SIGHUP)
            break
        write_all(master, data)
    if 3 in readable:
        data = os.read(3, 4096)
        if not data:
            sources.remove(3)
            continue
        *lines, control = (control + data).split(b"\\n")
        for line in lines:
            c, r = line.split()
            set_size(master, int(c), int(r))

os.close(master)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`;

export function spawnPty(args: {
  command: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  size: PtySize;
  onData: (chunk: Uint8Array) => void;
  onExit: (exit: PtyExit) => void;
}): Pty {
  const child = spawn(
    "python3",
    ["-c", HELPER, String(args.size.cols), String(args.size.rows), ...args.command],
    { cwd: args.cwd, env: args.env, stdio: ["pipe", "pipe", "pipe", "pipe"] },
  );
  const control = child.stdio[3];
  if (!control || !("write" in control)) throw new Error("pty の制御用パイプ (fd 3) を開けなかった");
  let stderr = "";
  let done = false;
  const finish = (exit: PtyExit) => {
    if (done) return;
    done = true;
    args.onExit(exit);
  };

  child.stdout.on("data", (chunk: Buffer) => args.onData(chunk));
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-2000);
  });
  for (const stream of [child.stdin, control]) stream.on("error", () => {});
  child.on("error", (error) => finish({ kind: "failed", message: error.message }));
  child.on("close", (code) =>
    finish(stderr.trim() && code !== 0 ? { kind: "failed", message: stderr.trim() } : { kind: "exited", code }),
  );

  return {
    write: (data) => {
      if (!done) child.stdin.write(data);
    },
    resize: ({ cols, rows }) => {
      if (!done) control.write(`${cols} ${rows}\n`);
    },
    kill: () => {
      if (!done) child.kill();
    },
  };
}
