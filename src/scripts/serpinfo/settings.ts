import { z } from "zod";
import {
  MatchPatternMap,
  type MatchPatternMapJSON,
} from "../../common/match-pattern.ts";
import { builtins } from "./builtins.ts";
import { parse } from "./parse.ts";
import type { SerpInfo } from "./types.ts";

export type UserSerpInfo = {
  input: string;
  parsed: SerpInfo | null;
};

export type RemoteSerpInfo = {
  url: string;
  custom: boolean;
  enabled: boolean;
  downloaded: string | null;
  downloadError: string | null;
  parsed: SerpInfo | null;
  parseError: string | null;
};

export type SerpIndex = ["user", number] | ["remote", number, number];

export type SerpInfoSettings = {
  enabled: boolean;
  user: UserSerpInfo;
  remote: RemoteSerpInfo[];
  serpIndexMap: MatchPatternMapJSON<SerpIndex>;
  lastModified: string;
};

function sync(
  settings: Readonly<SerpInfoSettings>,
  lastModified: Date | null = null,
): SerpInfoSettings {
  const enabled = settings.enabled;
  const parseResult = parse(settings.user.input);
  const user = parseResult.success
    ? { input: settings.user.input, parsed: parseResult.data }
    : { input: settings.user.input, parsed: null };
  const remoteURLs = new Set<string>();
  const remote = settings.remote.flatMap((r) => {
    if (remoteURLs.has(r.url)) {
      return [];
    }
    remoteURLs.add(r.url);
    if (r.downloaded == null) {
      return { ...r, parsed: null, parseError: null };
    }
    const parseResult = parse(r.downloaded);
    return parseResult.success
      ? { ...r, parsed: parseResult.data, parseError: null }
      : { ...r, parsed: null, parseError: parseResult.error };
  });
  const serpIndexMap = new MatchPatternMap<SerpIndex>();
  if (enabled) {
    if (user.parsed) {
      for (const [i, serp] of user.parsed.pages.entries()) {
        for (const match of serp.matches) {
          serpIndexMap.set(match, ["user", i]);
        }
      }
    }
    for (const [i, r] of remote.entries()) {
      if (r.enabled && r.parsed) {
        for (const [j, serp] of r.parsed.pages.entries()) {
          for (const match of serp.matches) {
            serpIndexMap.set(match, ["remote", i, j]);
          }
        }
      }
    }
  }
  return {
    enabled,
    user,
    remote,
    serpIndexMap: serpIndexMap.toJSON(),
    lastModified: lastModified?.toISOString() ?? settings.lastModified,
  };
}

export function setEnabled(
  settings: Readonly<SerpInfoSettings>,
  enabled: boolean,
  when: Date,
): SerpInfoSettings {
  return sync({ ...settings, enabled }, when);
}

export function setUser(
  settings: Readonly<SerpInfoSettings>,
  input: string,
  when: Date,
): SerpInfoSettings {
  return sync({ ...settings, user: { ...settings.user, input } }, when);
}

export function addRemote(
  settings: Readonly<SerpInfoSettings>,
  url: string,
  when: Date,
): SerpInfoSettings {
  const remote = [
    ...settings.remote,
    {
      url,
      custom: true,
      enabled: true,
      downloaded: null,
      downloadError: null,
      parsed: null,
      parseError: null,
    },
  ];
  return sync({ ...settings, remote }, when);
}

export function removeRemote(
  settings: Readonly<SerpInfoSettings>,
  url: string,
  when: Date,
): SerpInfoSettings {
  const remote = settings.remote.filter((r) => r.url !== url);
  return sync({ ...settings, remote }, when);
}

export function setRemoteEnabled(
  settings: Readonly<SerpInfoSettings>,
  url: string,
  enabled: boolean,
  when: Date,
): SerpInfoSettings {
  const remote = settings.remote.map((r) => {
    if (r.url === url) {
      return { ...r, enabled };
    }
    return r;
  });
  return sync({ ...settings, remote }, when);
}

export function setRemoteDownloaded(
  settings: Readonly<SerpInfoSettings>,
  url: string,
  downloaded: string | null,
  downloadError: string | null,
): SerpInfoSettings {
  const remote = settings.remote.map((r) => {
    if (r.url === url) {
      return { ...r, downloaded, downloadError };
    }
    return r;
  });
  return sync({ ...settings, remote });
}

export function getDefault(): Readonly<SerpInfoSettings> {
  const USER_INPUT_DEFAULT = `name: My SERPINFO

pages:
  - name: Example
    matches:
      - "*://*.example.com/*"
    results:
      - root: body > div
        url: a
        props:
          title: h1
`;
  return sync({
    enabled: false,
    user: { input: USER_INPUT_DEFAULT, parsed: null },
    remote: [],
    serpIndexMap: new MatchPatternMap<SerpIndex>().toJSON(),
    lastModified: new Date(0).toISOString(),
  });
}

export function mergeBuiltins(
  settings: Readonly<SerpInfoSettings>,
): SerpInfoSettings {
  const builtin = builtins.map((b) => {
    const r = settings.remote.find((r) => !r.custom && r.url === b.url);
    return (
      r || {
        url: b.url,
        custom: false,
        enabled: true,
        downloaded: b.content,
        downloadError: null,
        parsed: null,
        parseError: null,
      }
    );
  });
  const custom = settings.remote.filter((r) => r.custom);
  const remote = [...builtin, ...custom];
  return sync({ ...settings, remote });
}

export const serializableSchema = z.object({
  enabled: z.boolean(),
  user: z.object({
    input: z.string(),
  }),
  remote: z.array(
    z.object({
      url: z.string(),
      custom: z.boolean(),
      enabled: z.boolean(),
    }),
  ),
});

export type Serializable = z.infer<typeof serializableSchema>;

export function toSerializable(
  settings: Readonly<SerpInfoSettings>,
): Serializable {
  return {
    enabled: settings.enabled,
    user: { input: settings.user.input },
    remote: settings.remote.map((r) => ({
      url: r.url,
      custom: r.custom,
      enabled: r.enabled,
    })),
  };
}

export function serialize(settings: Readonly<SerpInfoSettings>): string {
  return JSON.stringify(toSerializable(settings));
}

export function fromSerializable(serializable: Serializable): SerpInfoSettings {
  const { enabled, user, remote } = serializable;
  return mergeBuiltins({
    enabled,
    user: { input: user.input, parsed: null },
    remote: remote.map((r) => ({
      url: r.url,
      custom: r.custom,
      enabled: r.enabled,
      downloaded: null,
      downloadError: null,
      parsed: null,
      parseError: null,
    })),
    serpIndexMap: new MatchPatternMap<SerpIndex>().toJSON(),
    lastModified: new Date(0).toISOString(),
  });
}

export function deserialize(input: string): SerpInfoSettings | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }
  const result = serializableSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }
  return fromSerializable(result.data);
}
