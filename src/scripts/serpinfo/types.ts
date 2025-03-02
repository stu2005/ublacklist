import { z } from "zod";
import {
  MatchPatternMap,
  type MatchPatternMapJSON,
  parseMatchPattern,
} from "../../common/match-pattern.ts";
import {
  RootsCommandSchema,
  buttonCommandSchema,
  propertyCommandSchema,
} from "./commands.ts";

const matchPatternSchema = z
  .string()
  .refine((value) => parseMatchPattern(value) != null, {
    message: "Invalid match pattern",
  });

export type ResultDescription = z.infer<typeof resultDescriptionSchema>;

const resultDescriptionSchema = z.object({
  root: RootsCommandSchema,
  url: propertyCommandSchema,
  props: z.record(z.string(), propertyCommandSchema).optional(),
  button: buttonCommandSchema.optional(),
});

export type SerpDescription = z.infer<typeof serpDescriptionSchema>;

const serpDescriptionSchema = z.object({
  name: z.string(),
  matches: matchPatternSchema.array(),
  excludeMatches: matchPatternSchema.array().optional(),
  userAgent: z.enum(["any", "desktop", "mobile"]).optional(),
  results: resultDescriptionSchema
    .nullable()
    .catch(() => null)
    .array(),
  commonProps: z.record(z.string(), z.string()).optional(),
  delay: z.boolean().or(z.number()).optional(),
});

export type SerpInfo = z.infer<typeof serpInfoSchema>;

export const serpInfoSchema = z.object({
  version: z.literal(1).optional(),
  name: z.string(),
  serps: serpDescriptionSchema.array(),
});

export type SerpInfoStrict = z.infer<typeof serpInfoStrictSchema>;

export const serpInfoStrictSchema = serpInfoSchema.merge(
  z.object({
    serps: serpDescriptionSchema
      .merge(
        z.object({
          results: resultDescriptionSchema.array(),
        }),
      )
      .array(),
  }),
);

export type CompiledSerpInfo = {
  urlToSerpIndices: MatchPatternMapJSON<number>;
  serps: SerpDescription[];
};

export const defaultCompiledSerpInfo: CompiledSerpInfo = {
  urlToSerpIndices: new MatchPatternMap<number>().toJSON(),
  serps: [],
};

export type Result = {
  root: Element;
  url: string;
  props: Record<string, string>;
  removeButton: (() => void) | null;
  description: ResultDescription;
  serpDescription: SerpDescription;
};
