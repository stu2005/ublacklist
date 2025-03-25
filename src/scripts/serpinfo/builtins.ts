import brave from "@serpinfo/brave.yml";

export type BuiltinSerpInfo = {
  url: string;
  content: string;
};

export const builtins: readonly BuiltinSerpInfo[] = [
  {
    url: "https://raw.githubusercontent.com/iorate/serpinfo/refs/heads/dist/serpinfo/brave.yml",
    content: brave,
  },
];
