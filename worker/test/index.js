// Entry point so that `node --test worker/test` works on Node 22, which treats a directory argument as a module path
// rather than a folder to scan. Imports every test file. (On Node 20, `node --test worker/test` scans the folder and
// runs each file itself; the same tests then run twice, which is harmless.)
import "./paths.test.mjs";
import "./worker.test.mjs";
