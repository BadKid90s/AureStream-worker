import { build } from "esbuild";
import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";

// 确保 dist 目录存在
if (!existsSync("dist")) {
  mkdirSync("dist", { recursive: true });
}

// 步骤 1：使用 esbuild 将 TypeScript 源码打包为单个 JS 文件
console.log("[build] 步骤 1/2：打包 TypeScript → dist/index.js");
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "esm",
  target: "es2022",
  platform: "neutral",
  minify: false,
  external: ["cloudflare:*"],
});
console.log("[build] 打包完成");

// 步骤 2：使用 javascript-obfuscator 对打包后的代码进行混淆
console.log("[build] 步骤 2/2：混淆 dist/index.js");
execSync(
  [
    "npx javascript-obfuscator dist/index.js",
    "--output dist/index.js",
    "--compact true",
    "--self-defending false",
    "--string-array true",
    "--string-array-encoding base64,rc4",
    "--string-array-threshold 0.75",
    "--rename-globals false",
    "--identifier-names-generator hexadecimal",
    "--unicode-escape-sequence true",
    "--control-flow-flattening true",
    "--control-flow-flattening-threshold 0.5",
    "--dead-code-injection true",
    "--dead-code-injection-threshold 0.2",
  ].join(" "),
  { stdio: "inherit" }
);
console.log("[build] 混淆完成");
