import path from "node:path";
import { glob } from "glob";
import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 20000 });
  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    glob("**/*.test.js", { cwd: testsRoot })
      .then((files) => {
        files.forEach((file) => mocha.addFile(path.resolve(testsRoot, file)));
        mocha.run((failures) => {
          if (failures > 0) {
            reject(new Error(`${failures} VS Code integration tests failed.`));
            return;
          }
          resolve();
        });
      })
      .catch((error) => reject(error));
  });
}
