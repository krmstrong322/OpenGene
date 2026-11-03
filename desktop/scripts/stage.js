// Stage the built frontend and the packaged backend into the desktop package,
// so both `electron .` (dev) and electron-builder (dist) see them at a stable
// path. Run by `npm run stage` (invoked automatically by start/dist).
//
//   ../frontend/dist              -> ./renderer
//   ../backend/dist/opengene-backend -> ./backend
//
// Both inputs must be built first:
//   cd ../frontend && npm run build
//   cd ../backend  && pyinstaller opengene-backend.spec --noconfirm

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const repo = path.resolve(root, "..");

const jobs = [
  {
    from: path.join(repo, "frontend", "dist"),
    to: path.join(root, "renderer"),
    hint: "cd frontend && npm run build",
  },
  {
    from: path.join(repo, "backend", "dist", "opengene-backend"),
    to: path.join(root, "backend"),
    hint: "cd backend && pyinstaller opengene-backend.spec --noconfirm",
  },
];

let ok = true;
for (const job of jobs) {
  if (!fs.existsSync(job.from)) {
    console.error(`✗ missing ${path.relative(repo, job.from)} — build it first: ${job.hint}`);
    ok = false;
    continue;
  }
  fs.rmSync(job.to, { recursive: true, force: true });
  fs.cpSync(job.from, job.to, { recursive: true });
  console.log(`✓ staged ${path.relative(repo, job.from)} -> desktop/${path.basename(job.to)}`);
}

if (!ok) {
  process.exit(1);
}
