import yaml from "js-yaml";
import { fromError } from "zod-validation-error";
import {
  type SerpInfo,
  serpInfoSchema,
  serpInfoStrictSchema,
} from "./types.ts";

export type ParseResult =
  | { success: true; data: SerpInfo }
  | { success: false; error: string };

export function parse(input: string, strict = false): ParseResult {
  let doc: unknown;
  try {
    doc = yaml.load(input, { schema: yaml.CORE_SCHEMA });
  } catch (error) {
    if (!(error instanceof yaml.YAMLException)) {
      throw error;
    }
    return {
      success: false,
      error: `Parse error: ${error.toString(true).slice(/* "YAMLException: ".length */ 15)}`,
    };
  }
  const result = (strict ? serpInfoStrictSchema : serpInfoSchema).safeParse(
    doc,
  );
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: fromError(result.error).toString() };
}
