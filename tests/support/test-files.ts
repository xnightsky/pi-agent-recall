/**
 * @module tests/support/test-files
 * 测试发现安全边界；必须在模块执行前排除付费后缀，而不是按标题 skip。
 */
/** 仅选择零 token 集成文件；目录名称不承担安全语义。 */
export function integrationTestFiles(files: readonly string[]): string[] {
  return files.filter((file) => file.endsWith(".ittest.ts") && !file.endsWith(".token.ittest.ts")).sort();
}
