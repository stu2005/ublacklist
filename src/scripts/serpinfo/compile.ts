import yaml from "js-yaml";
import { fromError } from "zod-validation-error";
import { MatchPatternMap } from "../../common/match-pattern.ts";
import {
  type CompiledSerpInfo,
  type SerpDescription,
  type SerpInfo,
  serpInfoSchema,
  serpInfoStrictSchema,
} from "./types.ts";

type Result<T> =
  | { success: true; data: T; error: string | null }
  | { success: false; error: string };

export type CompileResult = { data: CompiledSerpInfo; error: string | null };

function parse(input: string): Result<unknown> {
  try {
    return { success: true, data: yaml.load(input), error: null };
  } catch (error) {
    if (!(error instanceof yaml.YAMLException)) {
      throw error;
    }
    return {
      success: false,
      error: `Parse error: ${error.toString(true).slice(/* "YAMLException: ".length */ 15)}`,
    };
  }
}

function validate(doc: unknown, strict: boolean): Result<SerpInfo> {
  let error: string | null = null;
  if (strict) {
    const result = serpInfoStrictSchema.safeParse(doc);
    if (!result.success) {
      error = fromError(result.error).toString();
    }
  }
  const result = serpInfoSchema.safeParse(doc);
  return result.success
    ? { success: true, data: result.data, error }
    : { success: false, error: fromError(result.error).toString() };
}

function parseAndValidate(input: string, strict: boolean): Result<SerpInfo> {
  const parseResult = parse(input);
  if (!parseResult.success) {
    return { success: false, error: parseResult.error };
  }
  return validate(parseResult.data, strict);
}

export function compile(
  userSerpInfo: string,
  communitySerpInfo: readonly string[],
  strict = false,
): CompileResult {
  const urlToSerpIndices = new MatchPatternMap<number>();
  const serps: SerpDescription[] = [];
  const add = (result: Result<SerpInfo>) => {
    if (!result.success) {
      return;
    }
    for (const serp of result.data.serps) {
      serps.push(serp);
      for (const match of serp.matches) {
        urlToSerpIndices.set(match, serps.length - 1);
      }
    }
  };
  const userResult = parseAndValidate(userSerpInfo, strict);
  add(userResult);
  for (const result of communitySerpInfo.map((serpInfo) =>
    parseAndValidate(serpInfo, false),
  )) {
    add(result);
  }
  return {
    data: { urlToSerpIndices: urlToSerpIndices.toJSON(), serps },
    error: userResult.error,
  };
}
